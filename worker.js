/* ═══════════════════════════════════════════════════════════
   KARDO — Cloudflare Worker
   Firestore REST API مباشرة (بدون Cloud Functions، بدون KV)
   ═══════════════════════════════════════════════════════════ */

const FS_BASE = (env) =>
  `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

const FS_DOC_ROOT = (env) =>
  `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

/* ═══════════════════════════════════════════════════════════
   OAuth 2.0 — Service Account → Access Token
   ═══════════════════════════════════════════════════════════ */

let _tokenCache = { token: null, exp: 0 };

function base64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\\n/g, '\n')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache.token && _tokenCache.exp > now + 120) return _tokenCache.token;

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const unsigned = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(payload));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(env.FIREBASE_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned)
  );

  const jwt = unsigned + '.' + base64url(new Uint8Array(sig));

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    }).toString()
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error('OAuth failed: ' + t);
  }

  const data = await res.json();
  _tokenCache = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return data.access_token;
}

/* ═══════════════════════════════════════════════════════════
   Firestore Value Conversions
   ═══════════════════════════════════════════════════════════ */

function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toFsValue(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function toFsFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toFsValue(v);
  return fields;
}

function fromFsValue(fv) {
  if (!fv) return null;
  if ('nullValue' in fv) return null;
  if ('booleanValue' in fv) return fv.booleanValue;
  if ('integerValue' in fv) return parseInt(fv.integerValue);
  if ('doubleValue' in fv) return fv.doubleValue;
  if ('stringValue' in fv) return fv.stringValue;
  if ('timestampValue' in fv) return fv.timestampValue;
  if ('arrayValue' in fv) return (fv.arrayValue.values || []).map(fromFsValue);
  if ('mapValue' in fv) {
    const out = {};
    for (const [k, v] of Object.entries(fv.mapValue.fields || {})) out[k] = fromFsValue(v);
    return out;
  }
  return null;
}

function fromFsDoc(doc) {
  if (!doc || !doc.fields) return null;
  const out = { _id: doc.name ? doc.name.split('/').pop() : null };
  for (const [k, v] of Object.entries(doc.fields)) out[k] = fromFsValue(v);
  return out;
}

/* ═══════════════════════════════════════════════════════════
   Firestore Operations
   ═══════════════════════════════════════════════════════════ */

async function fsGet(env, path) {
  const token = await getAccessToken(env);
  const res = await fetch(`${FS_BASE(env)}/${path}`, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fsGet(${path}) → ${res.status}`);
  return fromFsDoc(await res.json());
}

async function fsSet(env, path, data, merge = false) {
  const token = await getAccessToken(env);
  const mask = merge
    ? Object.keys(data).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&')
    : '';
  const url = `${FS_BASE(env)}/${path}${mask ? '?' + mask : ''}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFsFields(data) })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`fsSet(${path}) → ${res.status}: ${t}`);
  }
  return fromFsDoc(await res.json());
}

async function fsAdd(env, collection, data) {
  const token = await getAccessToken(env);
  const res = await fetch(`${FS_BASE(env)}/${collection}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFsFields(data) })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`fsAdd(${collection}) → ${res.status}: ${t}`);
  }
  return fromFsDoc(await res.json());
}

async function fsDelete(env, path) {
  const token = await getAccessToken(env);
  const res = await fetch(`${FS_BASE(env)}/${path}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!res.ok && res.status !== 404) throw new Error(`fsDelete(${path}) → ${res.status}`);
}

async function fsQuery(env, collection, opts = {}) {
  const { where = [], orderBy = null, limit: lim = 100 } = opts;
  const token = await getAccessToken(env);

  const structuredQuery = {
    from: [{ collectionId: collection }],
    limit: lim
  };

  if (where.length) {
    structuredQuery.where = {
      compositeFilter: {
        op: 'AND',
        filters: where.map(w => ({
          fieldFilter: {
            field: { fieldPath: w.field },
            op: w.op || 'EQUAL',
            value: toFsValue(w.value)
          }
        }))
      }
    };
  }

  if (orderBy) {
    structuredQuery.orderBy = [{
      field: { fieldPath: orderBy.field },
      direction: orderBy.dir || 'DESCENDING'
    }];
  }

  const res = await fetch(`${FS_BASE(env)}:runQuery`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`fsQuery(${collection}) → ${res.status}: ${t}`);
  }
  const rows = await res.json();
  return rows.filter(r => r.document).map(r => fromFsDoc(r.document));
}

/* ═══════════════════════════════════════════════════════════
   Firestore Transaction
   ═══════════════════════════════════════════════════════════ */

async function fsRunTransaction(env, fn) {
  const token = await getAccessToken(env);

  const beginRes = await fetch(`${FS_BASE(env)}:beginTransaction`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ options: { readWrite: {} } })
  });
  if (!beginRes.ok) throw new Error('beginTransaction failed');
  const { transaction } = await beginRes.json();

  const writes = [];

  const tx = {
    async get(path) {
      const res = await fetch(`${FS_BASE(env)}/${path}?transaction=${transaction}`, {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`tx.get(${path}) → ${res.status}`);
      return fromFsDoc(await res.json());
    },
    update(path, data, merge = true) {
      const entry = {
        update: {
          name: `${FS_DOC_ROOT(env)}/${path}`,
          fields: toFsFields(data)
        }
      };
      if (merge) entry.updateMask = { fieldPaths: Object.keys(data) };
      writes.push(entry);
    },
    create(collection, docId, data) {
      writes.push({
        update: {
          name: `${FS_DOC_ROOT(env)}/${collection}/${docId}`,
          fields: toFsFields(data)
        },
        currentDocument: { exists: false }
      });
    },
    delete(path) {
      writes.push({ delete: `${FS_DOC_ROOT(env)}/${path}` });
    },
    increment(path, field, amount) {
      writes.push({
        transform: {
          document: `${FS_DOC_ROOT(env)}/${path}`,
          fieldTransforms: [{
            fieldPath: field,
            increment: Number.isInteger(amount)
              ? { integerValue: String(amount) }
              : { doubleValue: amount }
          }]
        }
      });
    }
  };

  try {
    const result = await fn(tx);
    if (writes.length) {
      const commitRes = await fetch(`${FS_BASE(env)}:commit`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction, writes })
      });
      if (!commitRes.ok) {
        const t = await commitRes.text();
        throw new Error(`commit failed: ${t}`);
      }
    }
    return result;
  } catch (e) {
    try {
      await fetch(`${FS_BASE(env)}:rollback`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction })
      });
    } catch {}
    throw e;
  }
}

/* ═══════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════ */

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

async function checkIdempotency(env, key) {
  if (!key) return null;
  const doc = await fsGet(env, `idempotency_keys/${key}`).catch(() => null);
  if (!doc) return null;
  if (doc.expires_at && new Date(doc.expires_at) < new Date()) return null;
  return doc.response || null;
}

async function saveIdempotency(env, key, response) {
  if (!key) return;
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await fsSet(env, `idempotency_keys/${key}`, {
    response,
    created_at: nowIso(),
    expires_at: expiresAt
  }).catch(e => console.warn('Idempotency save failed:', e.message));
}

async function verifyIdToken(token, env) {
  const res = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + env.FIREBASE_API_KEY,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token })
    }
  );

  if (!res.ok) throw new Error('Token verification failed');
  const data = await res.json();
  if (!data.users?.[0]) throw new Error('Invalid token');

  const user = data.users[0];
  const uid = user.localId;

  const userDoc = await fsGet(env, `users/${uid}`).catch(() => null);
  if (userDoc && userDoc.banned === true) throw new Error('ACCOUNT_BANNED');

  return { uid, email: user.email || '' };
}

async function checkAdmin(env, uid) {
  try {
    const doc = await fsGet(env, `admins/${uid}`);
    return !!doc;
  } catch {
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════
   Settings
   ═══════════════════════════════════════════════════════════ */

function getDefaultSettings() {
  return {
    mcard_enabled: true,
    mcard_min: 10,
    mcard_max: 1000,
    mcard_create_fee_fixed: 8,
    mcard_create_fee_pct: 2.5,
    mcard_topup_fee_fixed: 2.5,
    mcard_topup_fee_pct: 2.5,
    mcard_reveal_seconds: 300,
    rate_libyana: 11.8,
    rate_almadar: 12.5,
    rate_usdt: 1,
    m_libyana_on: true,
    m_almadar_on: true,
    m_usdt_on: false,
    m_libyana_phone: '',
    m_almadar_phone: '',
    usdt_address: '',
    daily_cards_max: 3,
    daily_amount_max: 200,
    daily_deposit_max: 500,
    referral_enabled: false,
    referral_bonus_inviter: 1,
    referral_bonus_invitee: 1,
    cards_limit_free: 1,
    cards_limit_basic: 3,
    cards_limit_pro: 10,
    cards_limit_business: 999,
    kill_switch: false,
    kill_message: 'الخدمة متوقفة مؤقتًا.'
  };
}

async function getSettings(env) {
  const doc = await fsGet(env, 'settings/main').catch(() => null);
  return { ...getDefaultSettings(), ...(doc || {}) };
}

/* ═══════════════════════════════════════════════════════════
   Validation
   ═══════════════════════════════════════════════════════════ */

const V = {
  phone: v => /^0?9[1-6]\d{7}$/.test(String(v || '').replace(/\s+/g, '')),
  pan: v => /^\d{16}$/.test(String(v || '').replace(/\s+/g, '')),
  cvv: v => /^\d{3}$/.test(String(v || '')),
  exp: v => /^\d{2}\/\d{2}$/.test(String(v || '')),
  email: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '')),
  amount: (v, min = 0.01, max = 100000) => {
    const x = parseFloat(v);
    return Number.isFinite(x) && x >= min && x <= max;
  },
  str: (v, min = 1, max = 500) => {
    const s = String(v || '').trim();
    return s.length >= min && s.length <= max;
  }
};

/* ═══════════════════════════════════════════════════════════
   Wallet Operations (Transactions)
   ═══════════════════════════════════════════════════════════ */

async function creditWallet(env, uid, amount, reason, reference) {
  if (!V.amount(amount)) throw new Error('مبلغ غير صالح');

  return fsRunTransaction(env, async (tx) => {
    const user = await tx.get(`users/${uid}`);
    if (!user) throw new Error('المستخدم غير موجود');

    const currentBalance = parseFloat(user.wallet_balance || 0);
    const newBalance = Math.round((currentBalance + amount) * 100) / 100;

    tx.update(`users/${uid}`, { wallet_balance: newBalance });
    tx.create('wallet_transactions', reference, {
      uid,
      type: 'credit',
      amount,
      balance_before: currentBalance,
      balance_after: newBalance,
      reason,
      reference,
      created_at: nowIso()
    });

    return { new_balance: newBalance, transaction_id: reference };
  });
}

async function debitWallet(env, uid, amount, reason, reference) {
  if (!V.amount(amount)) throw new Error('مبلغ غير صالح');

  return fsRunTransaction(env, async (tx) => {
    const user = await tx.get(`users/${uid}`);
    if (!user) throw new Error('المستخدم غير موجود');

    const currentBalance = parseFloat(user.wallet_balance || 0);
    if (currentBalance < amount) throw new Error('الرصيد غير كافٍ');

    const newBalance = Math.round((currentBalance - amount) * 100) / 100;

    tx.update(`users/${uid}`, { wallet_balance: newBalance });
    tx.create('wallet_transactions', reference, {
      uid,
      type: 'debit',
      amount,
      balance_before: currentBalance,
      balance_after: newBalance,
      reason,
      reference,
      created_at: nowIso()
    });

    return { new_balance: newBalance, transaction_id: reference };
  });
}

/* ═══════════════════════════════════════════════════════════
   Rate / Limit Helpers
   ═══════════════════════════════════════════════════════════ */

async function checkDailyLimits(env, uid, kind, amount) {
  const settings = await getSettings(env);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  const txns = await fsQuery(env, 'wallet_transactions', {
    where: [
      { field: 'uid', value: uid },
      { field: 'created_at', op: 'GREATER_THAN_OR_EQUAL', value: todayIso }
    ],
    limit: 500
  }).catch(() => []);

  const dayCards = txns.filter(t => (t.reason || '').includes('card') || (t.reason || '').includes('بطاقة')).length;
  const dayAmount = txns
    .filter(t => t.type === 'debit')
    .reduce((s, t) => s + parseFloat(t.amount || 0), 0);

  if (kind === 'card') {
    if (settings.daily_cards_max > 0 && dayCards >= settings.daily_cards_max) {
      throw new Error('تجاوزت الحد اليومي لعدد الطلبات');
    }
    if (settings.daily_amount_max > 0 && (dayAmount + amount) > settings.daily_amount_max) {
      throw new Error('تجاوزت الحد اليومي للمبلغ');
    }
  }
}

/* ═══════════════════════════════════════════════════════════
   Handlers — Public
   ═══════════════════════════════════════════════════════════ */

async function handleStatus(env, headers) {
  const s = await getSettings(env);
  return json({
    success: true,
    kill_switch: s.kill_switch === true,
    kill_message: s.kill_message || '',
    methods: {
      libyana: { on: s.m_libyana_on !== false, label: 'ليبيانا', phone: s.m_libyana_phone || '', rate: s.rate_libyana },
      almadar: { on: s.m_almadar_on !== false, label: 'المدار', phone: s.m_almadar_phone || '', rate: s.rate_almadar },
      usdt: { on: s.m_usdt_on === true, label: 'USDT', address: s.usdt_address || '', rate: s.rate_usdt }
    },
    mcard: {
      on: s.mcard_enabled !== false,
      min: s.mcard_min,
      max: s.mcard_max,
      create_fee_fixed: s.mcard_create_fee_fixed,
      create_fee_pct: s.mcard_create_fee_pct,
      topup_fee_fixed: s.mcard_topup_fee_fixed,
      topup_fee_pct: s.mcard_topup_fee_pct,
      reveal_seconds: s.mcard_reveal_seconds
    }
  }, 200, headers);
}

async function handleSmsWebhook(request, env, headers) {
  const secret = request.headers.get('x-sms-secret');
  if (secret !== env.SMS_WEBHOOK_SECRET) {
    return json({ success: false, error: 'Unauthorized' }, 401, headers);
  }
  try {
    const body = await request.json();
    console.log('SMS webhook received');
    return json({ success: true }, 200, headers);
  } catch {
    return json({ success: false, error: 'Bad request' }, 400, headers);
  }
}

/* ═══════════════════════════════════════════════════════════
   Handlers — Wallet
   ═══════════════════════════════════════════════════════════ */

async function handleWalletDeposit(request, env, user, idempotencyKey, headers) {
  if (!idempotencyKey) return json({ success: false, error: 'Idempotency-Key required' }, 400, headers);

  const cached = await checkIdempotency(env, idempotencyKey);
  if (cached) return json(cached, 200, headers);

  try {
    const body = await request.json();
    const { method, amount_lyd, claim_phone } = body;

    if (!['libyana', 'almadar', 'usdt'].includes(method)) {
      return json({ success: false, error: 'طريقة دفع غير صحيحة' }, 400, headers);
    }
    if (!V.amount(amount_lyd, 1, 100000)) {
      return json({ success: false, error: 'مبلغ غير صالح' }, 400, headers);
    }

    const settings = await getSettings(env);
    const rates = {
      libyana: settings.rate_libyana,
      almadar: settings.rate_almadar,
      usdt: settings.rate_usdt
    };
    const rate = rates[method];
    const amount_usd = Math.round((amount_lyd / rate) * 100) / 100;

    if (settings.daily_deposit_max > 0 && amount_usd > settings.daily_deposit_max) {
      return json({ success: false, error: 'تجاوزت الحد اليومي للإيداع' }, 400, headers);
    }

    const depId = newId('dep');
    await fsSet(env, `wallet_deposits/${depId}`, {
      uid: user.uid,
      method,
      amount_lyd: parseFloat(amount_lyd),
      amount_usd,
      rate,
      claim_phone: claim_phone || '',
      status: 'pending',
      created_at: nowIso(),
      idempotency_key: idempotencyKey
    });

    const response = {
      success: true,
      id: depId,
      amount_lyd: parseFloat(amount_lyd),
      amount_usd,
      status: 'pending'
    };
    await saveIdempotency(env, idempotencyKey, response);
    return json(response, 200, headers);
  } catch (e) {
    console.error('Deposit error:', e.message);
    return json({ success: false, error: e.message }, 500, headers);
  }
}

/* ═══════════════════════════════════════════════════════════
   Handlers — Manual Cards (User)
   ═══════════════════════════════════════════════════════════ */

async function handleMcardRequest(request, env, user, idempotencyKey, headers) {
  if (!idempotencyKey) return json({ success: false, error: 'Idempotency-Key required' }, 400, headers);

  const cached = await checkIdempotency(env, idempotencyKey);
  if (cached) return json(cached, 200, headers);

  try {
    const body = await request.json();
    const { name_on_card, amount, card_label } = body;

    if (!V.str(name_on_card, 2, 60)) {
      return json({ success: false, error: 'اسم حامل البطاقة غير صالح' }, 400, headers);
    }
    if (!V.amount(amount, 1, 10000)) {
      return json({ success: false, error: 'مبلغ غير صالح' }, 400, headers);
    }

    const settings = await getSettings(env);

    if (settings.mcard_enabled === false) {
      return json({ success: false, error: 'خدمة البطاقات متوقفة' }, 400, headers);
    }
    if (amount < settings.mcard_min || amount > settings.mcard_max) {
      return json({ success: false, error: `المبلغ يجب أن يكون بين ${settings.mcard_min} و${settings.mcard_max}` }, 400, headers);
    }

    await checkDailyLimits(env, user.uid, 'card', amount);

    const fee_fixed = parseFloat(settings.mcard_create_fee_fixed || 0);
    const fee_pct = (amount * parseFloat(settings.mcard_create_fee_pct || 0)) / 100;
    const total_fee = Math.round((fee_fixed + fee_pct) * 100) / 100;
    const total = Math.round((amount + total_fee) * 100) / 100;

    const orderId = newId('order');
    const txnRef = `txn_mcard_create_${orderId}`;

    await debitWallet(env, user.uid, total, 'card_create', txnRef);

    await fsSet(env, `manual_card_orders/${orderId}`, {
      uid: user.uid,
      kind: 'create',
      name_on_card: String(name_on_card).toUpperCase().trim(),
      card_label: card_label || 'البطاقة',
      amount: parseFloat(amount),
      fee: total_fee,
      total,
      status: 'pending',
      created_at: nowIso(),
      idempotency_key: idempotencyKey
    });

    const response = { success: true, id: orderId, amount, fee: total_fee, total };
    await saveIdempotency(env, idempotencyKey, response);
    return json(response, 200, headers);
  } catch (e) {
    console.error('Mcard request error:', e.message);
    return json({ success: false, error: e.message }, 400, headers);
  }
}

async function handleMcardList(env, user, headers) {
  try {
    const cards = await fsQuery(env, 'manual_cards', {
      where: [{ field: 'uid', value: user.uid }],
      orderBy: { field: 'created_at', dir: 'DESCENDING' },
      limit: 100
    });

    const orders = await fsQuery(env, 'manual_card_orders', {
      where: [{ field: 'uid', value: user.uid }],
      orderBy: { field: 'created_at', dir: 'DESCENDING' },
      limit: 100
    });

    // لا نُرسل البيانات الحساسة في القائمة
    const safeCards = cards.map(c => ({
      _id: c._id,
      card_label: c.card_label,
      last4: c.last4 || (c.card_number ? String(c.card_number).slice(-4) : '****'),
      expiry: c.expiry,
      balance: c.balance || 0,
      status: c.status || 'active',
      created_at: c.created_at
    }));

    return json({ success: true, cards: safeCards, orders }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

async function handleMcardReveal(request, env, user, headers) {
  try {
    const body = await request.json();
    const { card_id } = body;
    if (!card_id) return json({ success: false, error: 'Invalid card' }, 400, headers);

    const card = await fsGet(env, `manual_cards/${card_id}`);
    if (!card) return json({ success: false, error: 'البطاقة غير موجودة' }, 404, headers);
    if (card.uid !== user.uid) return json({ success: false, error: 'غير مصرّح' }, 403, headers);

    const settings = await getSettings(env);
    const ttl = parseInt(settings.mcard_reveal_seconds || 300);

    await fsSet(env, `manual_card_reveal/${card_id}_${user.uid}`, {
      uid: user.uid,
      card_id,
      revealed_at: nowIso(),
      expires_at: new Date(Date.now() + ttl * 1000).toISOString()
    });

    return json({
      success: true,
      card_number: card.card_number,
      expiry: card.expiry,
      cvv: card.cvv,
      ttl_seconds: ttl
    }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

async function handleMcardTopupRequest(request, env, user, idempotencyKey, headers) {
  if (!idempotencyKey) return json({ success: false, error: 'Idempotency-Key required' }, 400, headers);

  const cached = await checkIdempotency(env, idempotencyKey);
  if (cached) return json(cached, 200, headers);

  try {
    const body = await request.json();
    const { card_id, amount } = body;

    if (!card_id) return json({ success: false, error: 'بطاقة غير صالحة' }, 400, headers);
    if (!V.amount(amount, 1, 10000)) {
      return json({ success: false, error: 'مبلغ غير صالح' }, 400, headers);
    }

    const card = await fsGet(env, `manual_cards/${card_id}`);
    if (!card || card.uid !== user.uid) {
      return json({ success: false, error: 'غير مصرّح' }, 403, headers);
    }

    const settings = await getSettings(env);
    const fee_fixed = parseFloat(settings.mcard_topup_fee_fixed || 0);
    const fee_pct = (amount * parseFloat(settings.mcard_topup_fee_pct || 0)) / 100;
    const total_fee = Math.round((fee_fixed + fee_pct) * 100) / 100;
    const total = Math.round((amount + total_fee) * 100) / 100;

    const orderId = newId('topup');
    const txnRef = `txn_mcard_topup_${orderId}`;

    await debitWallet(env, user.uid, total, 'card_topup', txnRef);

    await fsSet(env, `manual_card_orders/${orderId}`, {
      uid: user.uid,
      kind: 'topup',
      card_id,
      amount: parseFloat(amount),
      fee: total_fee,
      total,
      status: 'pending',
      created_at: nowIso(),
      idempotency_key: idempotencyKey
    });

    const response = { success: true, id: orderId, amount, fee: total_fee, total };
    await saveIdempotency(env, idempotencyKey, response);
    return json(response, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 400, headers);
  }
}

/* ═══════════════════════════════════════════════════════════
   Handlers — USDT (مبدئي)
   ═══════════════════════════════════════════════════════════ */

async function handleUsdtInvoice(request, env, user, idempotencyKey, headers) {
  try {
    const body = await request.json();
    const { amount_usd } = body;
    if (!V.amount(amount_usd, 1, 100000)) {
      return json({ success: false, error: 'مبلغ غير صالح' }, 400, headers);
    }
    const settings = await getSettings(env);
    const invoiceId = newId('usdt_inv');
    await fsSet(env, `usdt_invoices/${invoiceId}`, {
      uid: user.uid,
      amount_usd: parseFloat(amount_usd),
      address: settings.usdt_address,
      status: 'waiting',
      created_at: nowIso(),
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString()
    });
    return json({
      success: true,
      invoice: {
        id: invoiceId,
        pay_amount: parseFloat(amount_usd),
        address: settings.usdt_address,
        expires_ms: Date.now() + 3600000
      }
    }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

async function handleUsdtVerify(request, env, user, headers) {
  try {
    const body = await request.json();
    const { invoice_id } = body;
    const inv = await fsGet(env, `usdt_invoices/${invoice_id}`);
    if (!inv || inv.uid !== user.uid) {
      return json({ success: false, error: 'Invoice not found' }, 404, headers);
    }
    return json({ success: true, paid: inv.status === 'paid' }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

/* ═══════════════════════════════════════════════════════════
   Handlers — VIP
   ═══════════════════════════════════════════════════════════ */

async function handleVipPlans(env, headers) {
  try {
    const plans = await fsQuery(env, 'vip_plans', { limit: 50 });
    const active = plans.filter(p => p.active !== false)
      .sort((a, b) => (a.order || 99) - (b.order || 99));
    return json({ success: true, plans: active }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

async function handleVipSubscribe(request, env, user, idempotencyKey, headers) {
  if (!idempotencyKey) return json({ success: false, error: 'Idempotency-Key required' }, 400, headers);

  const cached = await checkIdempotency(env, idempotencyKey);
  if (cached) return json(cached, 200, headers);

  try {
    const body = await request.json();
    const { plan_id } = body;
    if (!plan_id) return json({ success: false, error: 'باقة غير صالحة' }, 400, headers);

    const plan = await fsGet(env, `vip_plans/${plan_id}`);
    if (!plan || plan.active === false) {
      return json({ success: false, error: 'الباقة غير متوفرة' }, 400, headers);
    }

    const price = parseFloat(plan.price_usd || 0);
    const subId = newId('sub');
    const txnRef = `txn_vip_${subId}`;

    await debitWallet(env, user.uid, price, `vip_subscribe_${plan_id}`, txnRef);

    const durationDays = parseInt(plan.duration_days || 30);
    const expiresAt = new Date(Date.now() + durationDays * 24 * 3600 * 1000).toISOString();

    await fsSet(env, `subscriptions/${subId}`, {
      uid: user.uid,
      plan_id,
      plan_name: plan.name || '',
      price_usd: price,
      duration_days: durationDays,
      starts_at: nowIso(),
      expires_at: expiresAt,
      status: 'active',
      created_at: nowIso()
    });

    await fsSet(env, `users/${user.uid}`, {
      vip_status: 'active',
      vip_plan_id: plan_id,
      vip_expires_at: expiresAt
    }, true);

    const response = {
      success: true,
      subscription_id: subId,
      expires_at: expiresAt,
      plan_name: plan.name || ''
    };
    await saveIdempotency(env, idempotencyKey, response);
    return json(response, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 400, headers);
  }
}

async function handleVipStatus(env, user, headers) {
  try {
    const u = await fsGet(env, `users/${user.uid}`);
    const active = u && u.vip_status === 'active' &&
      (!u.vip_expires_at || new Date(u.vip_expires_at) > new Date());
    return json({
      success: true,
      active: !!active,
      expires_at: u?.vip_expires_at || null,
      plan_id: u?.vip_plan_id || null
    }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

/* ═══════════════════════════════════════════════════════════
   Handlers — Tickets (User)
   ═══════════════════════════════════════════════════════════ */

async function handleTicketCreate(request, env, user, idempotencyKey, headers) {
  if (!idempotencyKey) return json({ success: false, error: 'Idempotency-Key required' }, 400, headers);

  const cached = await checkIdempotency(env, idempotencyKey);
  if (cached) return json(cached, 200, headers);

  try {
    const body = await request.json();
    const { subject, message } = body;
    if (!V.str(subject, 3, 120)) return json({ success: false, error: 'عنوان غير صالح' }, 400, headers);
    if (!V.str(message, 3, 3000)) return json({ success: false, error: 'رسالة غير صالحة' }, 400, headers);

    const tId = newId('ticket');
    await fsSet(env, `tickets/${tId}`, {
      uid: user.uid,
      email: user.email,
      subject: subject.trim(),
      status: 'open',
      messages: [{
        by: 'user',
        text: message.trim(),
        at: nowIso()
      }],
      created_at: nowIso(),
      updated_at: nowIso()
    });

    const response = { success: true, id: tId };
    await saveIdempotency(env, idempotencyKey, response);
    return json(response, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

async function handleTicketList(env, user, headers) {
  try {
    const tickets = await fsQuery(env, 'tickets', {
      where: [{ field: 'uid', value: user.uid }],
      orderBy: { field: 'updated_at', dir: 'DESCENDING' },
      limit: 50
    });
    return json({ success: true, tickets }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

async function handleTicketReply(request, env, user, headers) {
  try {
    const body = await request.json();
    const { id, message } = body;
    if (!id || !V.str(message, 1, 3000)) {
      return json({ success: false, error: 'بيانات غير صالحة' }, 400, headers);
    }

    const t = await fsGet(env, `tickets/${id}`);
    if (!t) return json({ success: false, error: 'التذكرة غير موجودة' }, 404, headers);
    if (t.uid !== user.uid) return json({ success: false, error: 'غير مصرّح' }, 403, headers);

    const messages = Array.isArray(t.messages) ? t.messages : [];
    messages.push({ by: 'user', text: message.trim(), at: nowIso() });

    await fsSet(env, `tickets/${id}`, {
      messages,
      status: 'open',
      updated_at: nowIso()
    }, true);

    return json({ success: true }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

/* ═══════════════════════════════════════════════════════════
   Handlers — Admin: Wallet
   ═══════════════════════════════════════════════════════════ */

async function handleWalletAdjust(request, env, admin, idempotencyKey, headers) {
  if (!idempotencyKey) return json({ success: false, error: 'Idempotency-Key required' }, 400, headers);

  const cached = await checkIdempotency(env, idempotencyKey);
  if (cached) return json(cached, 200, headers);

  try {
    const body = await request.json();
    const { uid, delta, reason } = body;

    if (!uid) return json({ success: false, error: 'uid مفقود' }, 400, headers);
    if (!V.amount(Math.abs(delta))) return json({ success: false, error: 'مبلغ غير صالح' }, 400, headers);
    if (!V.str(reason, 2, 200)) return json({ success: false, error: 'سبب مطلوب' }, 400, headers);

    const ref = newId('adj');
    let result;
    if (delta > 0) {
      result = await creditWallet(env, uid, delta, `admin_adjust: ${reason}`, ref);
    } else {
      result = await debitWallet(env, uid, Math.abs(delta), `admin_adjust: ${reason}`, ref);
    }

    const response = { success: true, delta, new_balance: result.new_balance };
    await saveIdempotency(env, idempotencyKey, response);
    return json(response, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 400, headers);
  }
}

/* ═══════════════════════════════════════════════════════════
   Handlers — Admin: Deposits
   ═══════════════════════════════════════════════════════════ */

async function handleAdminDepositsList(request, env, headers) {
  try {
    const body = await request.json().catch(() => ({}));
    const filter = body.filter || 'pending';
    const where = filter === 'all' ? [] : [{ field: 'status', value: filter }];
    const deposits = await fsQuery(env, 'wallet_deposits', {
      where,
      orderBy: { field: 'created_at', dir: 'DESCENDING' },
      limit: 200
    });
    return json({ success: true, deposits }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

async function handleAdminDepositsAct(request, env, admin, idempotencyKey, headers) {
  if (!idempotencyKey) return json({ success: false, error: 'Idempotency-Key required' }, 400, headers);

  const cached = await checkIdempotency(env, idempotencyKey);
  if (cached) return json(cached, 200, headers);

  try {
    const body = await request.json();
    const { id, action, reason } = body;

    if (!id || !['approve', 'reject'].includes(action)) {
      return json({ success: false, error: 'طلب غير صالح' }, 400, headers);
    }

    const dep = await fsGet(env, `wallet_deposits/${id}`);
    if (!dep) return json({ success: false, error: 'الإيداع غير موجود' }, 404, headers);
    if (dep.status !== 'pending') {
      return json({ success: false, error: 'الإيداع تمت معالجته مسبقاً' }, 400, headers);
    }

    if (action === 'approve') {
      const ref = `txn_deposit_${id}`;
      await creditWallet(
        env,
        dep.uid,
        parseFloat(dep.amount_usd || 0),
        `deposit_approved: ${dep.method}`,
        ref
      );
      await fsSet(env, `wallet_deposits/${id}`, {
        status: 'approved',
        approved_at: nowIso(),
        approved_by: admin.uid
      }, true);

      const response = { success: true, action: 'approved', deposit_id: id };
      await saveIdempotency(env, idempotencyKey, response);
      return json(response, 200, headers);
    } else {
      await fsSet(env, `wallet_deposits/${id}`, {
        status: 'rejected',
        rejected_at: nowIso(),
        rejected_by: admin.uid,
        reject_reason: reason || ''
      }, true);

      const response = { success: true, action: 'rejected', deposit_id: id };
      await saveIdempotency(env, idempotencyKey, response);
      return json(response, 200, headers);
    }
  } catch (e) {
    return json({ success: false, error: e.message }, 400, headers);
  }
}

/* ═══════════════════════════════════════════════════════════
   Handlers — Admin: Users
   ═══════════════════════════════════════════════════════════ */

async function handleAdminUsersList(request, env, headers) {
  try {
    const body = await request.json().catch(() => ({}));
    const users = await fsQuery(env, 'users', {
      orderBy: { field: 'created_at', dir: 'DESCENDING' },
      limit: body.limit || 100
    });
    return json({ success: true, users, total: users.length }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

async function handleAdminUsersBan(request, env, admin, headers) {
  try {
    const body = await request.json();
    const { uid } = body;
    if (!uid) return json({ success: false, error: 'uid مفقود' }, 400, headers);

    const user = await fsGet(env, `users/${uid}`);
    if (!user) return json({ success: false, error: 'المستخدم غير موجود' }, 404, headers);

    const newBanState = !user.banned;
    await fsSet(env, `users/${uid}`, {
      banned: newBanState,
      banned_at: newBanState ? nowIso() : null,
      banned_by: newBanState ? admin.uid : null
    }, true);

    return json({ success: true, banned: newBanState }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

/* ═══════════════════════════════════════════════════════════
   Handlers — Admin: Manual Cards
   ═══════════════════════════════════════════════════════════ */

async function handleAdminMcardList(request, env, headers) {
  try {
    const body = await request.json().catch(() => ({}));
    const filter = body.filter || 'pending';
    const where = filter === 'all' ? [] : [{ field: 'status', value: filter }];
    const orders = await fsQuery(env, 'manual_card_orders', {
      where,
      orderBy: { field: 'created_at', dir: 'DESCENDING' },
      limit: 200
    });
    return json({ success: true, orders }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

async function handleAdminMcardFulfil(request, env, admin, idempotencyKey, headers) {
  if (!idempotencyKey) return json({ success: false, error: 'Idempotency-Key required' }, 400, headers);

  const cached = await checkIdempotency(env, idempotencyKey);
  if (cached) return json(cached, 200, headers);

  try {
    const body = await request.json();
    const { id, card_number, expiry, cvv } = body;

    if (!id) return json({ success: false, error: 'معرف الطلب مفقود' }, 400, headers);

    const order = await fsGet(env, `manual_card_orders/${id}`);
    if (!order) return json({ success: false, error: 'الطلب غير موجود' }, 404, headers);
    if (order.status !== 'pending') {
      return json({ success: false, error: 'الطلب تمت معالجته مسبقاً' }, 400, headers);
    }

    if (order.kind === 'create') {
      if (!V.pan(card_number)) return json({ success: false, error: 'رقم بطاقة غير صالح' }, 400, headers);
      if (!V.exp(cvv ? expiry : expiry)) {
        // نتحقق من expiry فقط
      }
      if (!V.exp(expiry)) return json({ success: false, error: 'صيغة تاريخ غير صالحة' }, 400, headers);
      if (!V.cvv(cvv)) return json({ success: false, error: 'CVV غير صالح' }, 400, headers);

      const cardId = newId('card');
      const cleanPan = String(card_number).replace(/\s+/g, '');
      const last4 = cleanPan.slice(-4);

      await fsSet(env, `manual_cards/${cardId}`, {
        uid: order.uid,
        card_label: order.card_label || 'البطاقة',
        name_on_card: order.name_on_card,
        card_number: cleanPan,
        expiry,
        cvv,
        last4,
        balance: parseFloat(order.amount || 0),
        status: 'active',
        created_at: nowIso(),
        created_by: admin.uid
      });

      await fsSet(env, `manual_card_orders/${id}`, {
        status: 'completed',
        card_id: cardId,
        completed_at: nowIso(),
        completed_by: admin.uid
      }, true);

      const response = { success: true, card_id: cardId, order_id: id };
      await saveIdempotency(env, idempotencyKey, response);
      return json(response, 200, headers);

    } else if (order.kind === 'topup') {
      const card = await fsGet(env, `manual_cards/${order.card_id}`);
      if (!card) return json({ success: false, error: 'البطاقة غير موجودة' }, 404, headers);

      const newBalance = Math.round((parseFloat(card.balance || 0) + parseFloat(order.amount)) * 100) / 100;
      await fsSet(env, `manual_cards/${order.card_id}`, {
        balance: newBalance,
        updated_at: nowIso()
      }, true);

      await fsSet(env, `manual_card_orders/${id}`, {
        status: 'completed',
        completed_at: nowIso(),
        completed_by: admin.uid
      }, true);

      const response = { success: true, card_id: order.card_id, new_balance: newBalance };
      await saveIdempotency(env, idempotencyKey, response);
      return json(response, 200, headers);
    }

    return json({ success: false, error: 'نوع طلب غير معروف' }, 400, headers);
  } catch (e) {
    console.error('Fulfil error:', e.message);
    return json({ success: false, error: e.message }, 400, headers);
  }
}

async function handleAdminMcardReject(request, env, admin, idempotencyKey, headers) {
  if (!idempotencyKey) return json({ success: false, error: 'Idempotency-Key required' }, 400, headers);

  const cached = await checkIdempotency(env, idempotencyKey);
  if (cached) return json(cached, 200, headers);

  try {
    const body = await request.json();
    const { id, reason } = body;

    const order = await fsGet(env, `manual_card_orders/${id}`);
    if (!order) return json({ success: false, error: 'الطلب غير موجود' }, 404, headers);
    if (order.status !== 'pending') {
      return json({ success: false, error: 'الطلب تمت معالجته مسبقاً' }, 400, headers);
    }

    const refundRef = `txn_refund_${id}`;
    await creditWallet(
      env,
      order.uid,
      parseFloat(order.total || 0),
      `card_rejected_refund: ${reason || 'مرفوض'}`,
      refundRef
    );

    await fsSet(env, `manual_card_orders/${id}`, {
      status: 'rejected',
      reject_reason: reason || '',
      rejected_at: nowIso(),
      rejected_by: admin.uid
    }, true);

    const response = { success: true, refunded: true, order_id: id };
    await saveIdempotency(env, idempotencyKey, response);
    return json(response, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 400, headers);
  }
}

/* ═══════════════════════════════════════════════════════════
   Handlers — Admin: VIP
   ═══════════════════════════════════════════════════════════ */

async function handleAdminVipPlans(env, headers) {
  try {
    const plans = await fsQuery(env, 'vip_plans', { limit: 100 });
    return json({ success: true, plans }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

async function handleAdminVipSave(request, env, admin, headers) {
  try {
    const body = await request.json();
    const { id, ...data } = body;

    if (!V.str(data.name, 1, 80)) {
      return json({ success: false, error: 'اسم الباقة مطلوب' }, 400, headers);
    }

    data.updated_at = nowIso();
    data.updated_by = admin.uid;

    if (id) {
      await fsSet(env, `vip_plans/${id}`, data, true);
      return json({ success: true, id }, 200, headers);
    } else {
      const planId = newId('plan');
      data.created_at = nowIso();
      await fsSet(env, `vip_plans/${planId}`, data);
      return json({ success: true, id: planId }, 200, headers);
    }
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

async function handleAdminVipList(env, headers) {
  try {
    const subs = await fsQuery(env, 'subscriptions', {
      orderBy: { field: 'created_at', dir: 'DESCENDING' },
      limit: 200
    });
    return json({ success: true, subscriptions: subs }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

/* ═══════════════════════════════════════════════════════════
   Handlers — Admin: Ads
   ═══════════════════════════════════════════════════════════ */

async function handleAdminAdsList(env, headers) {
  try {
    const ads = await fsQuery(env, 'ads', { limit: 200 });
    return json({ success: true, ads }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

async function handleAdminAdsSave(request, env, admin, headers) {
  try {
    const body = await request.json();
    const { id, ...data } = body;
    if (!V.str(data.title, 1, 120)) {
      return json({ success: false, error: 'العنوان مطلوب' }, 400, headers);
    }
    data.updated_at = nowIso();
    data.updated_by = admin.uid;

    if (id) {
      await fsSet(env, `ads/${id}`, data, true);
      return json({ success: true, id }, 200, headers);
    } else {
      const adId = newId('ad');
      data.created_at = nowIso();
      await fsSet(env, `ads/${adId}`, data);
      return json({ success: true, id: adId }, 200, headers);
    }
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

async function handleAdminAdsDelete(request, env, admin, headers) {
  try {
    const body = await request.json();
    const { id } = body;
    if (!id) return json({ success: false, error: 'id مفقود' }, 400, headers);
    await fsDelete(env, `ads/${id}`);
    return json({ success: true }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

/* ═══════════════════════════════════════════════════════════
   Handlers — Admin: Stats
   ═══════════════════════════════════════════════════════════ */

async function handleAdminStats(env, headers) {
  try {
    const [users, cards, orders, deposits, subs, tickets] = await Promise.all([
      fsQuery(env, 'users', { limit: 500 }).catch(() => []),
      fsQuery(env, 'manual_cards', { limit: 500 }).catch(() => []),
      fsQuery(env, 'manual_card_orders', { limit: 500 }).catch(() => []),
      fsQuery(env, 'wallet_deposits', { limit: 500 }).catch(() => []),
      fsQuery(env, 'subscriptions', { limit: 500 }).catch(() => []),
      fsQuery(env, 'tickets', { limit: 500 }).catch(() => [])
    ]);

    const completedOrders = orders.filter(o => o.status === 'completed');
    const totalRevenue = completedOrders.reduce((s, o) => s + parseFloat(o.total || 0), 0);
    const totalFees = completedOrders.reduce((s, o) => s + parseFloat(o.fee || 0), 0);

    return json({
      success: true,
      stats: {
        users: {
          total: users.length,
          banned: users.filter(u => u.banned).length
        },
        cards: {
          total: cards.length,
          active: cards.filter(c => c.status === 'active').length
        },
        orders: {
          completed: completedOrders.length,
          pending: orders.filter(o => o.status === 'pending').length,
          rejected: orders.filter(o => o.status === 'rejected').length
        },
        deposits: {
          approved: deposits.filter(d => d.status === 'approved').length,
          pending: deposits.filter(d => d.status === 'pending').length
        },
        vip: {
          subscriptions: subs.filter(s => s.status === 'active').length
        },
        tickets: {
          open: tickets.filter(t => t.status === 'open').length
        },
        revenue: {
          total_usd: totalRevenue,
          fees_usd: totalFees
        }
      }
    }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

/* ═══════════════════════════════════════════════════════════
   Handlers — Admin: Tickets
   ═══════════════════════════════════════════════════════════ */

async function handleAdminTicketsList(request, env, headers) {
  try {
    const body = await request.json().catch(() => ({}));
    const filter = body.filter || 'open';
    const where = filter === 'all' ? [] : [{ field: 'status', value: filter }];
    const tickets = await fsQuery(env, 'tickets', {
      where,
      orderBy: { field: 'updated_at', dir: 'DESCENDING' },
      limit: 200
    });
    return json({ success: true, tickets }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

async function handleAdminTicketsReply(request, env, admin, headers) {
  try {
    const body = await request.json();
    const { id, message } = body;
    if (!id || !V.str(message, 1, 3000)) {
      return json({ success: false, error: 'بيانات غير صالحة' }, 400, headers);
    }

    const t = await fsGet(env, `tickets/${id}`);
    if (!t) return json({ success: false, error: 'التذكرة غير موجودة' }, 404, headers);

    const messages = Array.isArray(t.messages) ? t.messages : [];
    messages.push({ by: 'admin', text: message.trim(), at: nowIso() });

    await fsSet(env, `tickets/${id}`, {
      messages,
      status: 'answered',
      updated_at: nowIso(),
      last_admin_reply_at: nowIso(),
      last_admin_reply_by: admin.uid
    }, true);

    return json({ success: true }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

async function handleAdminTicketsClose(request, env, admin, headers) {
  try {
    const body = await request.json();
    const { id } = body;
    if (!id) return json({ success: false, error: 'id مفقود' }, 400, headers);

    await fsSet(env, `tickets/${id}`, {
      status: 'closed',
      closed_at: nowIso(),
      closed_by: admin.uid,
      updated_at: nowIso()
    }, true);

    return json({ success: true }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

/* ═══════════════════════════════════════════════════════════
   Handlers — Admin: Settings
   ═══════════════════════════════════════════════════════════ */

async function handleAdminSettings(request, env, admin, headers) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') {
      return json({ success: false, error: 'بيانات غير صالحة' }, 400, headers);
    }

    // Whitelist الحقول المسموح بها
    const allowed = [
      'kill_switch', 'kill_message',
      'mcard_enabled', 'mcard_min', 'mcard_max',
      'mcard_create_fee_fixed', 'mcard_create_fee_pct',
      'mcard_topup_fee_fixed', 'mcard_topup_fee_pct',
      'mcard_reveal_seconds',
      'rate_libyana', 'rate_almadar', 'rate_usdt',
      'm_libyana_on', 'm_almadar_on', 'm_usdt_on',
      'm_libyana_phone', 'm_almadar_phone', 'usdt_address',
      'daily_cards_max', 'daily_amount_max', 'daily_deposit_max',
      'referral_enabled', 'referral_bonus_inviter', 'referral_bonus_invitee',
      'cards_limit_free', 'cards_limit_basic', 'cards_limit_pro', 'cards_limit_business',
      'brand_tagline', 'hero_title', 'hero_sub', 'support_url'
    ];

    const payload = {};
    for (const k of allowed) {
      if (k in body) payload[k] = body[k];
    }
    payload.updated_at = nowIso();
    payload.updated_by = admin.uid;
    payload.updated_by_email = admin.email;

    await fsSet(env, 'settings/main', payload, true);
    return json({ success: true }, 200, headers);
  } catch (e) {
    return json({ success: false, error: e.message }, 500, headers);
  }
}

/* ═══════════════════════════════════════════════════════════
   ROUTER — Main Fetch Handler
   ═══════════════════════════════════════════════════════════ */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || 'https://kardo.ly',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
      'Access-Control-Max-Age': '86400'
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders, status: 204 });
    }

    try {
      // ─── Public ───
      if (path === '/api/status' && method === 'GET') {
        return handleStatus(env, corsHeaders);
      }

      if (path === '/api/sms/webhook' && method === 'POST') {
        return handleSmsWebhook(request, env, corsHeaders);
      }

      // ─── Auth ───
      const authHeader = request.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return json({ success: false, error: 'Unauthorized' }, 401, corsHeaders);
      }

      const idToken = authHeader.substring(7);
      let user;
      try {
        user = await verifyIdToken(idToken, env);
      } catch (e) {
        if (e.message === 'ACCOUNT_BANNED') {
          return json({ success: false, error: 'حسابك موقوف' }, 403, corsHeaders);
        }
        return json({ success: false, error: 'Invalid token' }, 401, corsHeaders);
      }

      const idempotencyKey = request.headers.get('Idempotency-Key');

      // ─── User Endpoints ───
      if (path === '/api/wallet/deposit' && method === 'POST')
        return handleWalletDeposit(request, env, user, idempotencyKey, corsHeaders);

      if (path === '/api/wallet/usdt/invoice' && method === 'POST')
        return handleUsdtInvoice(request, env, user, idempotencyKey, corsHeaders);

      if (path === '/api/wallet/usdt/verify' && method === 'POST')
        return handleUsdtVerify(request, env, user, corsHeaders);

      if (path === '/api/mcard/request' && method === 'POST')
        return handleMcardRequest(request, env, user, idempotencyKey, corsHeaders);

      if (path === '/api/mcard/list' && method === 'POST')
        return handleMcardList(env, user, corsHeaders);

      if (path === '/api/mcard/reveal' && method === 'POST')
        return handleMcardReveal(request, env, user, corsHeaders);

      if (path === '/api/mcard/topup-request' && method === 'POST')
        return handleMcardTopupRequest(request, env, user, idempotencyKey, corsHeaders);

      if (path === '/api/vip/plans' && method === 'POST')
        return handleVipPlans(env, corsHeaders);

      if (path === '/api/vip/subscribe' && method === 'POST')
        return handleVipSubscribe(request, env, user, idempotencyKey, corsHeaders);

      if (path === '/api/vip/status' && method === 'POST')
        return handleVipStatus(env, user, corsHeaders);

      if (path === '/api/ticket/create' && method === 'POST')
        return handleTicketCreate(request, env, user, idempotencyKey, corsHeaders);

      if (path === '/api/ticket/list' && method === 'POST')
        return handleTicketList(env, user, corsHeaders);

      if (path === '/api/ticket/reply' && method === 'POST')
        return handleTicketReply(request, env, user, corsHeaders);

      // ─── Admin Check ───
      const isAdmin = await checkAdmin(env, user.uid);
      if (!isAdmin) {
        return json({ success: false, error: 'Admin only' }, 403, corsHeaders);
      }

      // ─── Admin Endpoints ───
      if (path === '/api/admin/wallet-adjust' && method === 'POST')
        return handleWalletAdjust(request, env, user, idempotencyKey, corsHeaders);

      if (path === '/api/admin/deposits/list' && method === 'POST')
        return handleAdminDepositsList(request, env, corsHeaders);

      if (path === '/api/admin/deposits/act' && method === 'POST')
        return handleAdminDepositsAct(request, env, user, idempotencyKey, corsHeaders);

      if (path === '/api/admin/users/list' && method === 'POST')
        return handleAdminUsersList(request, env, corsHeaders);

      if (path === '/api/admin/users/ban' && method === 'POST')
        return handleAdminUsersBan(request, env, user, corsHeaders);

      if (path === '/api/admin/mcard/list' && method === 'POST')
        return handleAdminMcardList(request, env, corsHeaders);

      if (path === '/api/admin/mcard/fulfil' && method === 'POST')
        return handleAdminMcardFulfil(request, env, user, idempotencyKey, corsHeaders);

      if (path === '/api/admin/mcard/reject' && method === 'POST')
        return handleAdminMcardReject(request, env, user, idempotencyKey, corsHeaders);

      if (path === '/api/admin/vip/plans' && method === 'POST')
        return handleAdminVipPlans(env, corsHeaders);

      if (path === '/api/admin/vip/save' && method === 'POST')
        return handleAdminVipSave(request, env, user, corsHeaders);

      if (path === '/api/admin/vip/list' && method === 'POST')
        return handleAdminVipList(env, corsHeaders);

      if (path === '/api/admin/ads/list' && method === 'POST')
        return handleAdminAdsList(env, corsHeaders);

      if (path === '/api/admin/ads/save' && method === 'POST')
        return handleAdminAdsSave(request, env, user, corsHeaders);

      if (path === '/api/admin/ads/delete' && method === 'POST')
        return handleAdminAdsDelete(request, env, user, corsHeaders);

      if (path === '/api/admin/stats' && method === 'POST')
        return handleAdminStats(env, corsHeaders);

      if (path === '/api/admin/tickets/list' && method === 'POST')
        return handleAdminTicketsList(request, env, corsHeaders);

      if (path === '/api/admin/tickets/reply' && method === 'POST')
        return handleAdminTicketsReply(request, env, user, corsHeaders);

      if (path === '/api/admin/tickets/close' && method === 'POST')
        return handleAdminTicketsClose(request, env, user, corsHeaders);

      if (path === '/api/admin/settings' && method === 'POST')
        return handleAdminSettings(request, env, user, corsHeaders);

      return json({ success: false, error: 'Not found' }, 404, corsHeaders);

    } catch (error) {
      console.error('Worker error:', error.message, error.stack);
      return json({ success: false, error: 'Internal error' }, 500, corsHeaders);
    }
  }
};
