/**
 * ═══════════════════════════════════════════════════════════
 *  KARDO — Cloudflare Worker Backend v3
 *  نظام إصدار البطاقات الافتراضية
 * ═══════════════════════════════════════════════════════════
 *
 *  السرّيات المطلوبة في Cloudflare:
 *   FIREBASE_PROJECT_ID    kardo-1c657
 *   FIREBASE_CLIENT_EMAIL  من service account
 *   FIREBASE_PRIVATE_KEY   من service account
 *   ALLOWED_ORIGIN         https://kardo.ly
 *   SMS_WEBHOOK_SECRET     سلسلة عشوائية
 * ═══════════════════════════════════════════════════════════
 */

const FS_BASE = 'https://firestore.googleapis.com/v1';
const TRON_API = 'https://api.trongrid.io';
const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

let _tokenCache = { token: null, exp: 0 };
let _jwksCache = { keys: null, exp: 0 };

/* ═══ Entry Point ═══ */
export default {
  async fetch(request, env, ctx) {
    const origin = env.ALLOWED_ORIGIN || '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    try {
      const result = await route(path, request, url, env);
      return json(result, 200, origin);
    } catch (err) {
      const status = err.status || 500;
      const body = { success: false, error: err.publicMessage || 'حدث خطأ غير متوقع' };
      if (status === 500) console.error('UNHANDLED', err.stack || err.message);
      return json(body, status, origin);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      purgeExpiredReveals(env).catch(e => console.error('PURGE_FAILED', e.message))
    );
  },
};

/* ═══ Router ═══ */
async function route(path, request, url, env) {
  /* ── عام ── */
  if (path === '/api/status' && request.method === 'GET') return handleStatus(env);
  if (path === '/api/sms/webhook') return handleSmsWebhook(request, env);

  /* ── يتطلب مصادقة ── */
  const body = request.method === 'POST' ? await safeJson(request) : {};
  const user = await requireAuth(request, env);

  switch (path) {
    // البطاقات الافتراضية (نظام Zid Cash اليدوي)
    case '/api/mcard/request':       return handleMcardRequest(user, body, env);
    case '/api/mcard/list':          return handleMcardList(user, body, env);
    case '/api/mcard/reveal':        return handleMcardReveal(user, body, env);
    case '/api/mcard/topup-request': return handleMcardTopupRequest(user, body, env);

    // المحفظة
    case '/api/wallet/claim':        return handleWalletClaim(user, body, env);
    case '/api/wallet/withdraw':     return handleWithdrawRequest(user, body, env);
    case '/api/wallet/usdt/invoice': return handleUsdtInvoice(user, body, env);
    case '/api/wallet/usdt/verify':  return handleUsdtVerify(user, body, env);

    // الاشتراكات VIP
    case '/api/vip/plans':           return handleVipPlans(user, body, env);
    case '/api/vip/subscribe':       return handleVipSubscribe(user, body, env);
    case '/api/vip/status':          return handleVipStatus(user, body, env);

    // الإعلانات
    case '/api/ads':                 return handleAds(user, body, env);

    // الدعم
    case '/api/ticket/create':       return handleTicketCreate(user, body, env);
    case '/api/ticket/list':         return handleTicketList(user, body, env);
    case '/api/ticket/reply':        return handleTicketReply(user, body, env);

    // النقاط
    case '/api/points/balance':      return handlePointsBalance(user, body, env);

    // الدعوات
    case '/api/ref/code':            return handleRefCode(user, body, env);
    case '/api/ref/claim':           return handleRefClaim(user, body, env);

    // الإعدادات العامة
    case '/api/settings/public':     return handlePublicSettings(user, body, env);

    // ── Admin ──
    case '/api/admin/settings':      return handleAdminSettings(user, body, env);
    case '/api/admin/deposit':       return handleAdminDeposit(user, body, env);
    case '/api/admin/wallet-adjust': return handleAdminWalletAdjust(user, body, env);
    case '/api/admin/sms/assign':    return handleAdminSmsAssign(user, body, env);

    // Admin: البطاقات اليدوية
    case '/api/admin/mcard/list':    return handleAdminMcardList(user, body, env);
    case '/api/admin/mcard/fulfil':  return handleAdminMcardFulfil(user, body, env);
    case '/api/admin/mcard/reject':  return handleAdminMcardReject(user, body, env);

    // Admin: المستخدمون
    case '/api/admin/users/list':    return handleAdminUsersList(user, body, env);
    case '/api/admin/users/ban':     return handleAdminUserBan(user, body, env);

    // Admin: VIP
    case '/api/admin/vip/plans':     return handleAdminVipPlans(user, body, env);
    case '/api/admin/vip/save':      return handleAdminVipSave(user, body, env);
    case '/api/admin/vip/list':      return handleAdminVipList(user, body, env);

    // Admin: الإعلانات
    case '/api/admin/ads/list':      return handleAdminAdsList(user, body, env);
    case '/api/admin/ads/save':      return handleAdminAdsSave(user, body, env);
    case '/api/admin/ads/delete':    return handleAdminAdsDelete(user, body, env);

    // Admin: Stats
    case '/api/admin/stats':         return handleAdminStats(user, body, env);

    // Admin: Tickets
    case '/api/admin/tickets/list':  return handleAdminTicketsList(user, body, env);
    case '/api/admin/tickets/close': return handleAdminTicketClose(user, body, env);
    case '/api/admin/tickets/reply': return handleAdminTicketReply(user, body, env);

    // Admin: Deposits
    case '/api/admin/deposits/list': return handleAdminDepositsList(user, body, env);
    case '/api/admin/deposits/act':  return handleAdminDepositAction(user, body, env);
  }

  throw httpError(404, 'المسار غير موجود');
}

/* ═══ Status (public) ═══ */
async function handleStatus(env) {
  const s = await getSettings(env);
  return {
    success: true,
    store_enabled: s.store_enabled !== false,
    kill_switch: s.kill_switch === true,
    kill_message: s.kill_message || 'الخدمة متوقفة مؤقتًا.',
    min_amount: num(s.min_amount, 10),
    max_amount: num(s.max_amount, 200),
    usd_to_lyd: num(s.usd_to_lyd, 11.8),
    rates: {
      libyana: num(s.rate_libyana, 11.8),
      almadar: num(s.rate_almadar, 12.5),
      bank: num(s.rate_bank, 9.5),
      usdt: num(s.rate_usdt, 1),
    },
    deposit_phone: s.deposit_phone || '',
    max_deposit_lyd: num(s.max_deposit_lyd, 5000),
    deposit_note: s.deposit_note || '',
    method_order: s.method_order || 'libyana,almadar,usdt,bank',
    banners: cleanBanners(s.banners),
    theme: {
      navy: s.theme_navy || '#0F172A',
      emerald: s.theme_emerald || '#10B981',
      bg: s.theme_bg || '#020617',
      radius: num(s.theme_radius, 14),
    },
    texts: {
      tagline: s.brand_tagline || 'بطاقتك الرقمية الأولى في ليبيا',
      hero_title: s.hero_title || 'بطاقتك الرقمية الأولى في ليبيا',
      hero_sub: s.hero_sub || 'بأمان، بساطة، وسرعة',
      support_url: s.support_url || '',
    },
    mcard: {
      on: s.mcard_enabled !== false,
      min: num(s.mcard_min, 10),
      max: num(s.mcard_max, 200),
      create_fee_fixed: num(s.mcard_create_fee_fixed, 8),
      create_fee_pct: num(s.mcard_create_fee_pct, 2.5),
      topup_fee_fixed: num(s.mcard_topup_fee_fixed, 2.5),
      topup_fee_pct: num(s.mcard_topup_fee_pct, 2.5),
      reveal_seconds: num(s.mcard_reveal_seconds, 300),
    },
    methods: {
      libyana: {
        on: s.m_libyana_on !== false, logo: s.m_libyana_logo || '',
        label: s.m_libyana_label || 'ليبيانا',
        phone: s.m_libyana_phone || s.deposit_phone || '',
        rate: num(s.rate_libyana, 11.8), auto: true,
      },
      almadar: {
        on: s.m_almadar_on !== false, logo: s.m_almadar_logo || '',
        label: s.m_almadar_label || 'المدار',
        phone: s.m_almadar_phone || s.deposit_phone || '',
        rate: num(s.rate_almadar, 12.5), auto: true,
      },
      usdt: {
        on: s.m_usdt_on === true, logo: s.m_usdt_logo || '',
        label: s.m_usdt_label || 'USDT',
        rate: num(s.rate_usdt, 1), auto: true, invoice: true,
        address: s.usdt_address || '',
        min: num(s.usdt_min, 5), max: num(s.usdt_max, 1000),
        window_min: num(s.usdt_window_min, 30),
      },
    },
  };
}

/* ═══ Settings (internal) ═══ */
async function getSettings(env) {
  const [pricing, ops] = await Promise.all([
    fsGet(env, 'card_settings/pricing'),
    fsGet(env, 'card_settings/ops'),
  ]);
  return {
    // الأساسيات
    store_enabled: true,
    kill_switch: false,
    kill_message: 'الخدمة متوقفة مؤقتًا.',

    // الحدود
    min_amount: 10, max_amount: 200,
    usd_to_lyd: 11.8,
    rate_libyana: 11.8, rate_almadar: 12.5, rate_bank: 9.5, rate_usdt: 1.0,
    max_deposit_lyd: 5000,

    // البطاقات اليدوية (Zid Cash)
    mcard_enabled: true,
    mcard_min: 10,
    mcard_max: 200,
    mcard_create_fee_fixed: 8,
    mcard_create_fee_pct: 2.5,
    mcard_topup_fee_fixed: 2.5,
    mcard_topup_fee_pct: 2.5,
    mcard_reveal_seconds: 300,

    // طرق الدفع
    m_libyana_on: true, m_libyana_label: 'ليبيانا',
    m_almadar_on: true, m_almadar_label: 'المدار',
    m_usdt_on: false, m_usdt_label: 'USDT',
    m_libyana_phone: '', m_almadar_phone: '',
    usdt_address: '', usdt_min: 5, usdt_max: 1000, usdt_window_min: 30,
    deposit_phone: '', deposit_note: '',
    method_order: 'libyana,almadar,usdt',

    // سجل الرسائل
    sms_allowed_senders: 'Libyana,ليبيانا,المدار,Almadar',

    // الدعم والتذاكر
    tickets_enabled: true,

    // المظهر
    theme_navy: '#0F172A',
    theme_emerald: '#10B981',
    theme_bg: '#020617',
    theme_radius: 14,

    // النصوص
    brand_tagline: 'بطاقتك الرقمية الأولى في ليبيا',
    hero_title: 'بطاقتك الرقمية الأولى في ليبيا',
    hero_sub: 'بأمان، بساطة، وسرعة',
    support_url: '',

    // البانرات
    banners: [],
    banner_rotate_sec: 6,

    // الحدود اليومية
    daily_cards_max: 3,
    daily_amount_max: 200,
    daily_deposit_max: 500,

    // الـVIP
    referral_enabled: false,
    referral_bonus_inviter: 1,
    referral_bonus_invitee: 1,
    referral_min_spend: 10,

    // سجل النشاط
    activity_log_enabled: true,

    ...(pricing || {}),
    ...(ops || {}),
  };
}

/* ═══ Helpers ═══ */
function cleanBanners(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(b => b && b.img).slice(0, 8)
    .map(b => ({
      img: String(b.img).slice(0, 900000),
      link: String(b.link || '').slice(0, 300),
      title: String(b.title || '').slice(0, 80),
      subtitle: String(b.subtitle || '').slice(0, 120),
    }));
}

function cleanFields(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(f => f && f.value).slice(0, 8)
    .map(f => ({
      label: String(f.label || '').slice(0, 40),
      value: String(f.value || '').slice(0, 200),
      copy: f.copy === true,
    }));
}

function assertLive(s) {
  if (s.kill_switch === true) {
    throw httpError(503, s.kill_message || 'الخدمة متوقفة مؤقتًا.');
  }
}

async function requireAdmin(user, env) {
  const admin = await fsGet(env, `admins/${user.uid}`);
  if (!admin) throw httpError(403, 'غير مصرّح');
  return admin;
}

async function requireAuth(request, env) {
  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) throw httpError(401, 'يجب تسجيل الدخول');

  const payload = await verifyIdToken(m[1], env.FIREBASE_PROJECT_ID);
  return { uid: payload.user_id || payload.sub, email: payload.email || '' };
}

async function verifyIdToken(idToken, projectId) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw httpError(401, 'رمز غير صالح');

  const header = JSON.parse(b64urlToStr(parts[0]));
  const payload = JSON.parse(b64urlToStr(parts[1]));
  const now = Math.floor(Date.now() / 1000);

  if (payload.aud !== projectId) throw httpError(401, 'رمز غير صالح');
  if (payload.exp <= now) throw httpError(401, 'انتهت الجلسة');

  const jwks = await getJwks();
  const jwk = jwks.find(k => k.kid === header.kid);
  if (!jwk) throw httpError(401, 'رمز غير صالح');

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['verify']
  );

  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  if (!ok) throw httpError(401, 'رمز غير صالح');

  return payload;
}

async function getJwks() {
  const now = Date.now();
  if (_jwksCache.keys && _jwksCache.exp > now) return _jwksCache.keys;
  const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  const data = await res.json();
  _jwksCache = { keys: data.keys, exp: now + 3600_000 };
  return data.keys;
}

/* ═══ Firestore REST ═══ */
async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache.token && _tokenCache.exp > now + 60) return _tokenCache.token;

  const claim = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  };

  const jwt = await signRS256(claim, env.FIREBASE_PRIVATE_KEY);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw httpError(500, 'خطأ في إعداد السيرفر');

  _tokenCache = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return data.access_token;
}

async function signRS256(claim, pemKey) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;

  const pem = String(pemKey).replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');

  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8', der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key,
    new TextEncoder().encode(input)
  );

  return `${input}.${bytesToB64url(new Uint8Array(sig))}`;
}

function docPath(env, path) {
  return `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
}

async function fsFetch(env, suffix, init = {}) {
  const token = await getAccessToken(env);
  const base = `${FS_BASE}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const res = await fetch(base + suffix, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });

  if (res.status === 404) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw httpError(500, 'خطأ في قاعدة البيانات');
  return data;
}

async function fsGet(env, path) {
  const doc = await fsFetch(env, `/${path}`);
  return doc ? fromFsFields(doc.fields || {}) : null;
}

async function fsSet(env, path, data) {
  return fsCommit(env, [write(env, path, data)]);
}

async function fsPatch(env, path, data) {
  return fsCommit(env, [writeMask(env, path, data, Object.keys(data))]);
}

async function fsDelete(env, path) {
  return fsCommit(env, [{ delete: docPath(env, path) }]);
}

async function fsIncrement(env, path, deltas) {
  const transforms = Object.entries(deltas).map(([fieldPath, v]) => ({
    fieldPath,
    increment: Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v },
  }));
  return fsCommit(env, [{ transform: { document: docPath(env, path), fieldTransforms: transforms } }]);
}

function write(env, path, data) {
  return { update: { name: docPath(env, path), fields: toFsFields(data) } };
}

function writeMask(env, path, data, fieldPaths) {
  return {
    update: { name: docPath(env, path), fields: toFsFields(data) },
    updateMask: { fieldPaths },
  };
}

async function fsCommit(env, writes) {
  return fsFetch(env, ':commit', { method: 'POST', body: JSON.stringify({ writes }) });
}

async function fsQuery(env, structuredQuery) {
  try {
    const res = await fsFetch(env, ':runQuery', {
      method: 'POST',
      body: JSON.stringify({ structuredQuery }),
    });
    return (Array.isArray(res) ? res : []).filter(r => r && r.document);
  } catch (e) {
    console.error('QUERY_FAILED', e.message);
    return [];
  }
}

function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFsFields(v) } };
  return { stringValue: String(v) };
}

function toFsFields(obj) {
  const f = {};
  for (const [k, v] of Object.entries(obj)) f[k] = toFsValue(v);
  return f;
}

function fromFsValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFsValue);
  if ('mapValue' in v) return fromFsFields(v.mapValue.fields || {});
  return null;
}

function fromFsFields(fields) {
  const o = {};
  for (const [k, v] of Object.entries(fields)) o[k] = fromFsValue(v);
  return o;
}

function withId(row, coll) {
  const d = fromFsFields(row.document.fields || {});
  d._id = row.document.name.split(`/documents/${coll}/`)[1];
  return d;
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  });
}

function httpError(status, publicMessage) {
  const e = new Error(publicMessage);
  e.status = status;
  e.publicMessage = publicMessage;
  return e;
}

async function safeJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function num(v, fallback) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n) { return Math.round(n * 100) / 100; }
function nowIso() { return new Date().toISOString(); }

function randomSuffix(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

function b64url(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesToB64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToStr(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(b64 + '='.repeat((4 - b64.length % 4) % 4))));
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
/* ═══════════════════════════════════════════════════════════
   PART 2 — البطاقات + المحفظة + الإعلانات + التذاكر
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   نظام البطاقات الافتراضية (Zid Cash — يدوي)
   ═══════════════════════════════════════════════════════════ */

/**
 * طلب بطاقة جديدة.
 * يُخصم المبلغ فورًا، وينتظر التنفيذ اليدوي من الأدمن.
 */
async function handleMcardRequest(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.mcard_enabled === false) throw httpError(503, 'إصدار البطاقات متوقف مؤقتًا');

  const amount = round2(num(body.amount, NaN));
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'أدخل المبلغ');

  const mn = num(s.mcard_min, 10);
  const mx = num(s.mcard_max, 200);
  if (amount < mn) throw httpError(400, `الحد الأدنى $${mn}`);
  if (amount > mx) throw httpError(400, `الحد الأقصى $${mx}`);

  const nameOnCard = String(body.name_on_card || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z .'-]{1,24}$/.test(nameOnCard)) {
    throw httpError(400, 'اكتب اسم البطاقة بحروف لاتينية');
  }

  const cardLabel = String(body.card_label || 'بطاقتي').trim().slice(0, 40);

  // حساب الرسوم
  const feeFixed = num(s.mcard_create_fee_fixed, 8);
  const feePct = num(s.mcard_create_fee_pct, 2.5);
  const fee = round2(feeFixed + amount * feePct / 100);
  const totalUsd = round2(amount + fee);

  // التحقق من المحفظة
  const me = await fsGet(env, `users/${user.uid}`);
  if (!me) throw httpError(400, 'الحساب غير مكتمل');
  if (me.banned === true) throw httpError(403, 'الحساب موقوف');
  if (num(me.wallet_balance, 0) < totalUsd) {
    throw httpError(402, `رصيدك غير كافٍ — تحتاج ${totalUsd.toFixed(2)}$`);
  }

  // خصم فوري
  await fsIncrement(env, `users/${user.uid}`, { wallet_balance: -totalUsd });

  const id = `MC${Date.now()}${randomSuffix(4)}`;

  await fsSet(env, `manual_card_orders/${id}`, {
    uid: user.uid,
    kind: 'create',
    amount,
    fee,
    total: totalUsd,
    name_on_card: nameOnCard,
    card_label: cardLabel,
    status: 'pending',
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  return {
    success: true,
    id,
    fee,
    total: totalUsd,
    message: 'تم استلام طلبك — سيُنفذ خلال 1-4 ساعات',
  };
}

/**
 * طلب إعادة شحن بطاقة موجودة.
 */
async function handleMcardTopupRequest(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.mcard_enabled === false) throw httpError(503, 'الشحن متوقف مؤقتًا');

  const amount = round2(num(body.amount, NaN));
  const cardId = String(body.card_id || '').trim();

  if (!cardId) throw httpError(400, 'اختر البطاقة');
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'أدخل المبلغ');

  const mn = num(s.mcard_min, 10);
  const mx = num(s.mcard_max, 200);
  if (amount < mn) throw httpError(400, `الحد الأدنى $${mn}`);
  if (amount > mx) throw httpError(400, `الحد الأقصى $${mx}`);

  // التحقق من ملكية البطاقة
  const card = await fsGet(env, `manual_cards/${cardId}`);
  if (!card || card.uid !== user.uid) throw httpError(404, 'البطاقة غير موجودة');
  if (card.status !== 'active') throw httpError(400, 'البطاقة غير نشطة');

  // حساب الرسوم
  const feeFixed = num(s.mcard_topup_fee_fixed, 2.5);
  const feePct = num(s.mcard_topup_fee_pct, 2.5);
  const fee = round2(feeFixed + amount * feePct / 100);
  const totalUsd = round2(amount + fee);

  const me = await fsGet(env, `users/${user.uid}`);
  if (num(me.wallet_balance, 0) < totalUsd) {
    throw httpError(402, `رصيدك غير كافٍ — تحتاج ${totalUsd.toFixed(2)}$`);
  }

  await fsIncrement(env, `users/${user.uid}`, { wallet_balance: -totalUsd });

  const id = `MCT${Date.now()}${randomSuffix(4)}`;

  await fsSet(env, `manual_card_orders/${id}`, {
    uid: user.uid,
    kind: 'topup',
    card_id: cardId,
    amount,
    fee,
    total: totalUsd,
    status: 'pending',
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  return {
    success: true,
    id,
    fee,
    total: totalUsd,
    message: 'تم استلام طلب الشحن — سيُنفذ خلال 1-4 ساعات',
  };
}

/**
 * قائمة بطاقات المستخدم.
 */
async function handleMcardList(user, body, env) {
  const rows = await fsQuery(env, {
    from: [{ collectionId: 'manual_cards' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'uid' },
        op: 'EQUAL',
        value: { stringValue: user.uid },
      },
    },
    limit: 50,
  });

  const cards = rows.map(r => withId(r, 'manual_cards'))
    .filter(c => c.status !== 'deleted')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map(c => ({
      id: c._id,
      card_label: c.card_label || 'بطاقتي',
      name_on_card: c.name_on_card || '',
      last4: c.last4 || '0000',
      brand: c.brand || 'Visa',
      balance: round2(num(c.balance, 0)),
      status: c.status || 'active',
      created_at: c.created_at || '',
    }));

  // قائمة الطلبات قيد التنفيذ
  const orderRows = await fsQuery(env, {
    from: [{ collectionId: 'manual_card_orders' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'uid' },
        op: 'EQUAL',
        value: { stringValue: user.uid },
      },
    },
    limit: 50,
  });

  const orders = orderRows.map(r => withId(r, 'manual_card_orders'))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 20)
    .map(o => ({
      id: o._id,
      kind: o.kind || 'create',
      amount: round2(num(o.amount, 0)),
      fee: round2(num(o.fee, 0)),
      total: round2(num(o.total, 0)),
      status: o.status || 'pending',
      created_at: o.created_at || '',
      reject_reason: o.reject_reason || '',
    }));

  return { success: true, cards, orders };
}

/**
 * عرض بيانات البطاقة (PAN + CVV + Expiry).
 * تُعرض مؤقتًا، ثم تُمسح تلقائيًا بعد X ثانية.
 */
async function handleMcardReveal(user, body, env) {
  const cardId = String(body.card_id || '').trim();
  if (!cardId) throw httpError(400, 'معرّف البطاقة مفقود');

  // التحقق من الملكية
  const card = await fsGet(env, `manual_cards/${cardId}`);
  if (!card) throw httpError(404, 'البطاقة غير موجودة');
  if (card.uid !== user.uid) throw httpError(403, 'غير مصرّح');
  if (card.status !== 'active') throw httpError(400, 'البطاقة غير نشطة');

  // جلب البيانات الكاملة
  const reveal = await fsGet(env, `manual_card_reveal/${cardId}`);
  if (!reveal) {
    throw httpError(404, 'لا توجد بيانات متاحة لهذه البطاقة');
  }

  // هل انتهت صلاحية العرض؟
  if (reveal.expires_at && new Date(reveal.expires_at) < new Date()) {
    // احذف البيانات منتهية الصلاحية
    await fsDelete(env, `manual_card_reveal/${cardId}`).catch(() => {});
    throw httpError(410, 'انتهت صلاحية عرض البيانات — تواصل مع الدعم');
  }

  // حساب المدة المتبقية
  const s = await getSettings(env);
  const ttl = num(s.mcard_reveal_seconds, 300);
  const nowMs = Date.now();
  const revealUntil = nowMs + ttl * 1000;

  // تسجيل العرض
  await logOp(env, user.uid, 'mcard_reveal', { cardId }, { ok: true }, true);

  return {
    success: true,
    card_number: reveal.card_number || '',
    expiry: reveal.expiry || '',
    cvv: reveal.cvv || '',
    name_on_card: reveal.name_on_card || '',
    ttl_seconds: ttl,
    reveal_until: revealUntil,
  };
}

/**
 * Cron — يمسح بيانات البطاقات منتهية الصلاحية.
 */
async function purgeExpiredReveals(env) {
  const rows = await fsQuery(env, {
    from: [{ collectionId: 'manual_card_reveal' }],
    limit: 200,
  });

  const now = Date.now();
  let purged = 0;

  for (const r of rows) {
    const d = withId(r, 'manual_card_reveal');
    if (d.expires_at && new Date(d.expires_at).getTime() < now) {
      await fsDelete(env, `manual_card_reveal/${d._id}`).catch(() => {});
      purged++;
    }
  }

  return purged;
}

/* ═══════════════════════════════════════════════════════════
   المحفظة — إيداع + USDT + SMS
   ═══════════════════════════════════════════════════════════ */

async function handleWalletClaim(user, body, env) {
  const phone = normalizePhone(body.phone || '');
  const amountLyd = round2(num(body.amount_lyd, NaN));
  const method = body.method === 'almadar' ? 'almadar' : 'libyana';

  if (phone.length !== 9) throw httpError(400, 'رقم غير صحيح');
  if (!Number.isFinite(amountLyd) || amountLyd <= 0) throw httpError(400, 'أدخل المبلغ');

  const st = await getSettings(env);
  assertLive(st);

  const rate = method === 'almadar'
    ? num(st.rate_almadar, 12.5)
    : num(st.rate_libyana, 11.8);
  const amountUsd = round2(amountLyd / rate);

  const maxLyd = num(st.max_deposit_lyd, 5000);
  if (amountLyd > maxLyd) throw httpError(400, `الحد الأقصى ${maxLyd} د.ل`);

  // هل وصلت رسالة SMS بالفعل؟
  const sms = await findUnclaimedSms(env, phone, amountLyd);

  if (sms) {
    const credited = round2(num(sms.amount_usd, amountUsd));
    await Promise.all([
      fsPatch(env, `sms_transactions/${sms._id}`, {
        status: 'claimed', uid: user.uid, claimed_at: nowIso(),
      }),
      fsIncrement(env, `users/${user.uid}`, { wallet_balance: credited }),
      fsSet(env, `wallet_deposits/${sms._id}`, {
        uid: user.uid,
        amount_usd: credited,
        amount_lyd: num(sms.amount_lyd, amountLyd),
        method: method === 'libyana' ? 'ليبيانا' : 'المدار',
        status: 'approved', auto: true, created_at: nowIso(),
      }),
      logOp(env, user.uid, 'wallet_claim_matched', { phone }, { credited }, true),
    ]);
    return { success: true, matched: true, credited_usd: credited };
  }

  // إعلان معلّق
  const claimId = `CLM${Date.now()}${randomSuffix(4)}`;
  await fsSet(env, `wallet_deposits/${claimId}`, {
    uid: user.uid,
    amount_usd: amountUsd,
    amount_lyd: amountLyd,
    method: method === 'libyana' ? 'ليبيانا' : 'المدار',
    claim_phone: phone,
    status: 'pending',
    awaiting_sms: true,
    created_at: nowIso(),
  });

  return { success: true, matched: false, claim_id: claimId };
}

async function findUnclaimedSms(env, phone, amountLyd) {
  const res = await fsQuery(env, {
    from: [{ collectionId: 'sms_transactions' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL',
            value: { stringValue: 'unclaimed' } } },
          { fieldFilter: { field: { fieldPath: 'sender' }, op: 'EQUAL',
            value: { stringValue: phone } } },
        ],
      },
    },
    limit: 20,
  });

  const rows = res.map(r => {
    const d = fromFsFields(r.document.fields || {});
    d._id = r.document.name.split('/documents/sms_transactions/')[1];
    return d;
  }).filter(d => Math.abs(num(d.amount_lyd, -1) - amountLyd) < 0.005);

  return rows[0] || null;
}

/* ═══ USDT ═══ */
async function handleUsdtInvoice(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.m_usdt_on !== true) throw httpError(503, 'USDT غير متاح');

  const address = String(s.usdt_address || '').trim();
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
    throw httpError(503, 'عنوان الاستقبال غير مضبوط');
  }

  const amount = round2(num(body.amount_usd, NaN));
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'أدخل المبلغ');

  const minU = num(s.usdt_min, 5);
  const maxU = num(s.usdt_max, 1000);
  if (amount < minU) throw httpError(400, `الحد الأدنى ${minU} USDT`);
  if (amount > maxU) throw httpError(400, `الحد الأقصى ${maxU} USDT`);

  let payAmount = null;
  for (let i = 0; i < 80; i++) {
    const b = crypto.getRandomValues(new Uint8Array(2));
    const frac = ((((b[0] << 8) | b[1]) % 900) + 100) / 10000;
    const cand = Number((amount + frac).toFixed(4));
    payAmount = cand;
    break;
  }
  if (payAmount === null) throw httpError(503, 'ازدحام');

  const minutes = num(s.usdt_window_min, 30);
  const now = Date.now();
  const id = `INV${now}${randomSuffix(4)}`;

  await fsSet(env, `usdt_invoices/${id}`, {
    uid: user.uid,
    amount_usd: amount,
    pay_amount: payAmount,
    address,
    status: 'awaiting',
    created_at: new Date(now).toISOString(),
    created_ms: now,
    expires_ms: now + minutes * 60000,
  });

  return {
    success: true,
    invoice: {
      id, amount_usd: amount, pay_amount: payAmount,
      address, network: 'TRC20',
      expires_ms: now + minutes * 60000,
    },
  };
}

async function handleUsdtVerify(user, body, env) {
  const id = String(body.invoice_id || '').trim();
  if (!id) throw httpError(400, 'رقم الفاتورة مفقود');

  const inv = await fsGet(env, `usdt_invoices/${id}`);
  if (!inv) throw httpError(404, 'الفاتورة غير موجودة');
  if (inv.uid !== user.uid) throw httpError(403, 'غير مصرّح');

  if (inv.status === 'paid') {
    return {
      success: true, paid: true,
      credited: num(inv.received, num(inv.amount_usd, 0)),
    };
  }

  const now = Date.now();
  if (num(inv.expires_ms, 0) < now && inv.status === 'awaiting') {
    await fsPatch(env, `usdt_invoices/${id}`, { status: 'expired' });
    throw httpError(400, 'انتهت المهلة');
  }

  const s = await getSettings(env);
  const address = String(inv.address || s.usdt_address || '').trim();
  const want = num(inv.pay_amount, 0);

  let txs = [];
  try {
    const url = `${TRON_API}/v1/accounts/${address}/transactions/trc20`
      + `?limit=60&only_to=true&contract_address=${USDT_TRC20}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    const data = await res.json();
    txs = Array.isArray(data.data) ? data.data : [];
  } catch (e) {
    throw httpError(502, 'تعذّر الاتصال بالشبكة');
  }

  const since = num(inv.created_ms, 0) - 5 * 60000;

  const hit = txs.find(t => {
    const val = Number(t.value || 0) / 1e6;
    const ts = Number(t.block_timestamp || 0);
    return ts >= since && Math.abs(val - want) < 0.00005;
  });

  if (!hit) return { success: true, paid: false };

  const txid = String(hit.transaction_id || '');
  if (!txid) return { success: true, paid: false };

  const seen = await fsGet(env, `usdt_txids/${txid}`);
  if (seen) return { success: true, paid: false, duplicate: true };

  const received = round2(Number(hit.value || 0) / 1e6);

  await Promise.all([
    fsSet(env, `usdt_txids/${txid}`, {
      invoice_id: id, uid: user.uid, amount: received,
      from: String(hit.from || ''), created_at: nowIso(),
    }),
    fsPatch(env, `usdt_invoices/${id}`, {
      status: 'paid', txid, paid_at: nowIso(), received,
    }),
    fsIncrement(env, `users/${user.uid}`, { wallet_balance: received }),
    fsSet(env, `wallet_deposits/${id}`, {
      uid: user.uid,
      amount_usd: received,
      amount_lyd: 0,
      method: 'USDT — تلقائي',
      status: 'approved', auto: true,
      created_at: nowIso(),
    }),
  ]);

  return { success: true, paid: true, credited: received, txid };
}

/* ═══════════════════════════════════════════════════════════
   VIP — الاشتراكات الشهرية
   ═══════════════════════════════════════════════════════════ */

async function handleVipPlans(user, body, env) {
  const rows = await fsQuery(env, {
    from: [{ collectionId: 'vip_plans' }],
    limit: 20,
  });

  const plans = rows.map(r => withId(r, 'vip_plans'))
    .filter(p => p.active !== false)
    .sort((a, b) => num(a.order, 99) - num(b.order, 99))
    .map(p => ({
      id: p._id,
      name: p.name || '',
      name_en: p.name_en || '',
      price_usd: round2(num(p.price_usd, 0)),
      duration_days: num(p.duration_days, 30),
      cards_count: num(p.cards_count, 0),
      features: Array.isArray(p.features) ? p.features : [],
      popular: p.popular === true,
      order: num(p.order, 99),
    }));

  return { success: true, plans };
}

async function handleVipSubscribe(user, body, env) {
  const planId = String(body.plan_id || '').trim();
  if (!planId) throw httpError(400, 'اختر الباقة');

  const plan = await fsGet(env, `vip_plans/${planId}`);
  if (!plan || plan.active === false) throw httpError(404, 'الباقة غير متاحة');

  const priceUsd = round2(num(plan.price_usd, 0));
  if (priceUsd <= 0) throw httpError(400, 'سعر الباقة غير صحيح');

  const me = await fsGet(env, `users/${user.uid}`);
  if (!me) throw httpError(400, 'الحساب غير مكتمل');
  if (num(me.wallet_balance, 0) < priceUsd) {
    throw httpError(402, `رصيدك غير كافٍ — تحتاج ${priceUsd.toFixed(2)}$`);
  }

  await fsIncrement(env, `users/${user.uid}`, { wallet_balance: -priceUsd });

  const days = num(plan.duration_days, 30);
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();

  const subId = `SUB${Date.now()}${randomSuffix(4)}`;

  await Promise.all([
    fsSet(env, `subscriptions/${subId}`, {
      uid: user.uid,
      plan_id: planId,
      plan_name: plan.name || '',
      price_usd: priceUsd,
      cards_count: num(plan.cards_count, 0),
      status: 'active',
      started_at: nowIso(),
      expires_at: expiresAt,
    }),
    fsPatch(env, `users/${user.uid}`, {
      vip_status: 'active',
      vip_plan_id: planId,
      vip_expires_at: expiresAt,
      vip_cards_limit: num(plan.cards_count, 0),
    }),
    logOp(env, user.uid, 'vip_subscribe', { planId }, { subId, priceUsd }, true),
  ]);

  return {
    success: true,
    subscription_id: subId,
    expires_at: expiresAt,
    cards_count: num(plan.cards_count, 0),
  };
}

async function handleVipStatus(user, body, env) {
  const me = await fsGet(env, `users/${user.uid}`);
  if (!me) throw httpError(400, 'الحساب غير مكتمل');

  const status = me.vip_status || 'none';
  const expiresAt = me.vip_expires_at || '';

  // هل انتهى الاشتراك؟
  let active = false;
  if (status === 'active' && expiresAt) {
    active = new Date(expiresAt) > new Date();
    if (!active) {
      await fsPatch(env, `users/${user.uid}`, { vip_status: 'expired' });
    }
  }

  // عدد البطاقات الحالية
  const cardsRows = await fsQuery(env, {
    from: [{ collectionId: 'manual_cards' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL',
            value: { stringValue: user.uid } } },
          { fieldFilter: { field: { fieldPath: 'status' }, op: 'NOT_EQUAL',
            value: { stringValue: 'deleted' } } },
        ],
      },
    },
    limit: 100,
  });

  return {
    success: true,
    active,
    status: active ? 'active' : (status === 'expired' ? 'expired' : 'none'),
    expires_at: expiresAt,
    cards_limit: num(me.vip_cards_limit, 1),
    cards_count: cardsRows.length,
  };
}

/* ═══════════════════════════════════════════════════════════
   الإعلانات
   ═══════════════════════════════════════════════════════════ */

async function handleAds(user, body, env) {
  const rows = await fsQuery(env, {
    from: [{ collectionId: 'ads' }],
    limit: 30,
  });

  const ads = rows.map(r => withId(r, 'ads'))
    .filter(a => a.active !== false)
    .sort((a, b) => num(a.order, 99) - num(b.order, 99))
    .map(a => ({
      id: a._id,
      title: a.title || '',
      subtitle: a.subtitle || '',
      image: a.image || '',
      link: a.link || '',
      cta: a.cta || 'اعرف المزيد',
      advertiser: a.advertiser || '',
    }));

  return { success: true, ads };
}

/* ═══════════════════════════════════════════════════════════
   النقاط
   ═══════════════════════════════════════════════════════════ */

async function handlePointsBalance(user, body, env) {
  const me = await fsGet(env, `users/${user.uid}`);
  return {
    success: true,
    points: num(me && me.points, 0),
  };
}

/* ═══════════════════════════════════════════════════════════
   التذاكر (دعم)
   ═══════════════════════════════════════════════════════════ */

async function handleTicketCreate(user, body, env) {
  const subject = String(body.subject || '').trim().slice(0, 120);
  const msg = String(body.message || '').trim().slice(0, 1500);
  if (!subject || !msg) throw httpError(400, 'بيانات ناقصة');

  const id = `TIC${Date.now()}${randomSuffix(3)}`;
  await fsSet(env, `tickets/${id}`, {
    uid: user.uid,
    subject,
    order_id: String(body.order_id || '').slice(0, 40),
    status: 'open',
    messages: [{ by: 'user', text: msg, at: nowIso() }],
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  return { success: true, id };
}

async function handleTicketList(user, body, env) {
  const rows = await fsQuery(env, {
    from: [{ collectionId: 'tickets' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'uid' },
        op: 'EQUAL',
        value: { stringValue: user.uid },
      },
    },
    limit: 30,
  });

  const tickets = rows.map(r => withId(r, 'tickets'))
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .map(t => ({
      id: t._id,
      subject: t.subject,
      status: t.status,
      messages_count: (t.messages || []).length,
      updated_at: t.updated_at,
    }));

  return { success: true, tickets };
}

async function handleTicketReply(user, body, env) {
  const id = String(body.id || '').trim();
  const msg = String(body.message || '').trim().slice(0, 1500);
  if (!id || !msg) throw httpError(400, 'بيانات ناقصة');

  const t = await fsGet(env, `tickets/${id}`);
  if (!t) throw httpError(404, 'التذكرة غير موجودة');

  const isAdmin = await isAdminUid(env, user.uid);
  if (!isAdmin && t.uid !== user.uid) throw httpError(403, 'غير مصرّح');

  const msgs = Array.isArray(t.messages) ? t.messages : [];
  msgs.push({ by: isAdmin ? 'admin' : 'user', text: msg, at: nowIso() });

  await fsPatch(env, `tickets/${id}`, {
    messages: msgs.slice(-40),
    status: isAdmin ? 'answered' : 'open',
    updated_at: nowIso(),
  });

  return { success: true };
}

async function isAdminUid(env, uid) {
  try { return !!(await fsGet(env, `admins/${uid}`)); } catch { return false; }
}

/* ═══════════════════════════════════════════════════════════
   الدعوات
   ═══════════════════════════════════════════════════════════ */

function makeRefCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, x => A[x % A.length]).join('');
}

async function handleRefCode(user, body, env) {
  const s = await getSettings(env);
  if (s.referral_enabled !== true) throw httpError(503, 'غير مفعّل');

  const me = await fsGet(env, `users/${user.uid}`);
  if (me && me.ref_code) return { success: true, code: me.ref_code };

  let code = null;
  for (let i = 0; i < 12; i++) {
    const c = makeRefCode();
    if (!await fsGet(env, `ref_codes/${c}`)) { code = c; break; }
  }
  if (!code) throw httpError(503, 'تعذّر التوليد');

  await Promise.all([
    fsSet(env, `ref_codes/${code}`, { uid: user.uid, created_at: nowIso() }),
    fsPatch(env, `users/${user.uid}`, { ref_code: code }),
  ]);

  return { success: true, code };
}

async function handleRefClaim(user, body, env) {
  const s = await getSettings(env);
  if (s.referral_enabled !== true) throw httpError(503, 'غير مفعّل');

  const code = String(body.code || '').trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) throw httpError(400, 'رمز غير صحيح');

  const me = await fsGet(env, `users/${user.uid}`);
  if (!me) throw httpError(400, 'الحساب غير مكتمل');
  if (me.referred_by) throw httpError(400, 'استخدمت رمزًا من قبل');

  const owner = await fsGet(env, `ref_codes/${code}`);
  if (!owner) throw httpError(404, 'الرمز غير موجود');

  await fsPatch(env, `users/${user.uid}`, {
    referred_by: owner.uid,
    referred_code: code,
    referral_paid: false,
  });

  return { success: true, bonus: num(s.referral_bonus_invitee, 1) };
}

/* ═══════════════════════════════════════════════════════════
   SMM Webhook — رسائل ليبيانا / المدار
   ═══════════════════════════════════════════════════════════ */

function parseTransferSms(text) {
  const s = String(text || '').replace(/[\u200e\u200f]/g, '').trim();
  if (!/تم\s*تحويل/.test(s)) return null;

  const incoming = /رصيد[كه]/.test(s) || /من\s*الرقم/.test(s);
  const outgoing = /تحويل[^\n]{0,40}\s(?:الى|الي|إلى)\s*\+?\d/.test(s)
                   && !/من\s*الرقم/.test(s);
  if (!incoming || outgoing) return null;

  const almadar = s.match(/تم\s*تحويل\s*([\d,]+(?:[.\u066B]\d{1,3})?)\s*د\.?\s*ل/);
  if (almadar && /د\.?\s*ل/.test(s)) {
    const phone = s.match(/من\s*الرقم\s*[:\s]?\s*(\d{9,14})/);
    if (!phone) return null;
    return {
      amount_lyd: round2(parseFloat(String(almadar[1]).replace(/,/g, ''))),
      sender: normalizePhone(phone[1]),
      network: 'almadar',
    };
  }

  const libyana = s.match(/([\d,]+)[.\u066B](\d{1,3})\s*دينار/);
  const phone = s.match(/الرقم\s*[:\s]?\s*(\d{9,14})/);
  if (!libyana || !phone) return null;

  const whole = parseInt(String(libyana[1]).replace(/,/g, ''), 10);
  const frac = parseInt(libyana[2].padEnd(3, '0'), 10) / 1000;

  return {
    amount_lyd: round2(whole + frac),
    sender: normalizePhone(phone[1]),
    network: 'libyana',
  };
}

function normalizePhone(raw) {
  let p = String(raw || '').replace(/\D/g, '');
  if (p.startsWith('00218')) p = p.slice(5);
  else if (p.startsWith('218')) p = p.slice(3);
  if (p.startsWith('0')) p = p.slice(1);
  return p.slice(-9);
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

async function handleSmsWebhook(request, env) {
  const url = new URL(request.url);
  const provided = request.headers.get('x-sms-secret')
    || url.searchParams.get('secret') || '';
  const expected = env.SMS_WEBHOOK_SECRET || '';

  if (!expected || provided !== expected) {
    throw httpError(401, 'unauthorized');
  }

  let rawBody = '';
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try { rawBody = await request.text(); } catch {}
  }

  let body = {};
  if (rawBody) {
    try { body = JSON.parse(rawBody); } catch { body = {}; }
  }

  const text = body.text || body.message || body.body
    || url.searchParams.get('text') || rawBody || '';

  const parsed = parseTransferSms(text);
  const fingerprint = await sha256Hex(String(text).trim());

  if (!parsed) {
    await fsSet(env, `sms_transactions/${fingerprint}`, {
      raw_text: String(text).slice(0, 500),
      status: 'unparsed',
      created_at: nowIso(),
    });
    return { success: true, parsed: false };
  }

  const s = await getSettings(env);
  const rate = parsed.network === 'almadar'
    ? num(s.rate_almadar, 12.5)
    : num(s.rate_libyana, 11.8);

  await fsSet(env, `sms_transactions/${fingerprint}`, {
    raw_text: String(text).slice(0, 500),
    amount_lyd: parsed.amount_lyd,
    amount_usd: round2(parsed.amount_lyd / rate),
    rate,
    sender: parsed.sender,
    method: parsed.network,
    status: 'unclaimed',
    created_at: nowIso(),
  });

  return { success: true, parsed: true };
}

/* ═══════════════════════════════════════════════════════════
   الإعدادات العامة
   ═══════════════════════════════════════════════════════════ */

async function handlePublicSettings(user, body, env) {
  const s = await getSettings(env);
  return {
    success: true,
    theme: {
      navy: s.theme_navy || '#0F172A',
      emerald: s.theme_emerald || '#10B981',
      bg: s.theme_bg || '#020617',
    },
    texts: {
      tagline: s.brand_tagline || '',
      hero_title: s.hero_title || '',
      hero_sub: s.hero_sub || '',
      support_url: s.support_url || '',
    },
    banners: cleanBanners(s.banners),
  };
}

/* ═══ logOp ═══ */
async function logOp(env, uid, action, request, response, ok) {
  const id = `${Date.now()}_${randomSuffix(6)}`;
  try {
    await fsSet(env, `card_logs/${id}`, {
      uid, action, ok: !!ok,
      request: JSON.stringify(request).slice(0, 900),
      response: JSON.stringify(response || {}).slice(0, 900),
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('LOG_FAILED', e.message);
  }
}

/* ═══ Withdrawals ═══ */
async function handleWithdrawRequest(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);

  const amount = round2(num(body.amount_usd, NaN));
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'أدخل المبلغ');

  const me = await fsGet(env, `users/${user.uid}`);
  if (!me || num(me.wallet_balance, 0) < amount) throw httpError(402, 'رصيد غير كافٍ');

  const id = `WD${Date.now()}${randomSuffix(4)}`;
  await fsIncrement(env, `users/${user.uid}`, { wallet_balance: -amount });
  await fsSet(env, `withdrawals/${id}`, {
    uid: user.uid,
    amount_usd: amount,
    method: String(body.method || '').slice(0, 40),
    destination: String(body.destination || '').slice(0, 120),
    status: 'pending',
    created_at: nowIso(),
  });

  return { success: true, id };
}

/* ═══════════════════════════════════════════════════════════
   ADMIN — المسارات الإدارية
   ═══════════════════════════════════════════════════════════ */

async function handleAdminSettings(user, body, env) {
  await requireAdmin(user, env);

  const allowedPricing = [
    'min_amount', 'max_amount', 'usd_to_lyd',
    'rate_libyana', 'rate_almadar', 'rate_usdt', 'max_deposit_lyd',
    'mcard_min', 'mcard_max',
    'mcard_create_fee_fixed', 'mcard_create_fee_pct',
    'mcard_topup_fee_fixed', 'mcard_topup_fee_pct',
    'mcard_reveal_seconds',
    'referral_bonus_inviter', 'referral_bonus_invitee', 'referral_min_spend',
  ];

  const allowedOps = [
    'kill_switch', 'kill_message',
    'mcard_enabled', 'tickets_enabled',
    'm_libyana_on', 'm_libyana_label', 'm_almadar_on', 'm_almadar_label',
    'm_usdt_on', 'm_usdt_label',
    'm_libyana_phone', 'm_almadar_phone', 'usdt_address',
    'usdt_min', 'usdt_max', 'usdt_window_min',
    'deposit_phone', 'deposit_note', 'method_order',
    'referral_enabled',
    'theme_navy', 'theme_emerald', 'theme_bg',
    'brand_tagline', 'hero_title', 'hero_sub', 'support_url',
    'banners', 'banner_rotate_sec',
    'daily_cards_max', 'daily_amount_max', 'daily_deposit_max',
  ];

  const pricing = {}, ops = {};
  for (const k of allowedPricing) if (k in body) pricing[k] = body[k];
  for (const k of allowedOps) if (k in body) ops[k] = body[k];

  const writes = [];
  if (Object.keys(pricing).length) {
    writes.push(writeMask(env, 'card_settings/pricing', pricing, Object.keys(pricing)));
  }
  if (Object.keys(ops).length) {
    writes.push(writeMask(env, 'card_settings/ops', ops, Object.keys(ops)));
  }
  if (!writes.length) throw httpError(400, 'لا يوجد شيء للتحديث');

  await fsCommit(env, writes);
  await logOp(env, user.uid, 'admin_settings', { pricing, ops }, { ok: true }, true);

  return { success: true };
}

async function handleAdminDeposit(user, body, env) {
  await requireAdmin(user, env);
  const depositId = String(body.deposit_id || '').trim();
  const action = body.action === 'reject' ? 'reject' : 'approve';

  const dep = await fsGet(env, `wallet_deposits/${depositId}`);
  if (!dep || dep.status !== 'pending') throw httpError(400, 'مُعالج مسبقًا');

  if (action === 'reject') {
    await fsPatch(env, `wallet_deposits/${depositId}`, {
      status: 'rejected',
      reject_reason: String(body.reason || '').slice(0, 200),
      reviewed_by: user.uid,
      reviewed_at: nowIso(),
    });
    return { success: true };
  }

  const amountUsd = round2(num(dep.amount_usd, 0));
  await Promise.all([
    fsIncrement(env, `users/${dep.uid}`, { wallet_balance: amountUsd }),
    fsPatch(env, `wallet_deposits/${depositId}`, {
      status: 'approved',
      reviewed_by: user.uid,
      reviewed_at: nowIso(),
    }),
  ]);

  return { success: true, credited: amountUsd };
}

async function handleAdminWalletAdjust(user, body, env) {
  await requireAdmin(user, env);
  const uid = String(body.uid || '').trim();
  const delta = num(body.delta, NaN);

  if (!uid || !Number.isFinite(delta) || delta === 0) {
    throw httpError(400, 'بيانات ناقصة');
  }

  await fsIncrement(env, `users/${uid}`, { wallet_balance: round2(delta) });
  await logOp(env, user.uid, 'wallet_adjust', { uid, delta }, { ok: true }, true);

  return { success: true, delta };
}

async function handleAdminSmsAssign(user, body, env) {
  await requireAdmin(user, env);
  const smsId = String(body.sms_id || '').trim();
  const uid = String(body.uid || '').trim();

  const sms = await fsGet(env, `sms_transactions/${smsId}`);
  if (!sms) throw httpError(404, 'غير موجودة');

  const amountUsd = round2(num(sms.amount_usd, 0));
  await Promise.all([
    fsPatch(env, `sms_transactions/${smsId}`, {
      status: 'claimed', uid, claimed_at: nowIso(),
    }),
    fsIncrement(env, `users/${uid}`, { wallet_balance: amountUsd }),
    fsSet(env, `wallet_deposits/${smsId}`, {
      uid,
      amount_usd: amountUsd,
      amount_lyd: num(sms.amount_lyd, 0),
      method: 'يدوي',
      status: 'approved', auto: false,
      created_at: nowIso(),
    }),
  ]);

  return { success: true, credited: amountUsd };
}

/* ═══════════════════════════════════════════════════════════
   ADMIN — البطاقات اليدوية
   ═══════════════════════════════════════════════════════════ */

async function handleAdminMcardList(user, body, env) {
  await requireAdmin(user, env);

  const filter = String(body.filter || 'all');
  const rows = await fsQuery(env, {
    from: [{ collectionId: 'manual_card_orders' }],
    limit: 300,
  });

  let orders = rows.map(r => withId(r, 'manual_card_orders'))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  if (filter === 'pending') {
    orders = orders.filter(o => o.status === 'pending');
  } else if (filter === 'completed') {
    orders = orders.filter(o => o.status === 'completed');
  } else if (filter === 'rejected') {
    orders = orders.filter(o => o.status === 'rejected');
  }

  // جلب بيانات المستخدمين
  const uids = [...new Set(orders.map(o => o.uid))];
  const users = {};
  for (const uid of uids.slice(0, 100)) {
    const u = await fsGet(env, `users/${uid}`).catch(() => null);
    if (u) users[uid] = { name: u.name || '', email: u.email || '', phone: u.phone || '' };
  }

  const items = orders.slice(0, 100).map(o => ({
    id: o._id,
    uid: o.uid,
    user: users[o.uid] || { name: '—', email: '—' },
    kind: o.kind || 'create',
    amount: round2(num(o.amount, 0)),
    fee: round2(num(o.fee, 0)),
    total: round2(num(o.total, 0)),
    name_on_card: o.name_on_card || '',
    card_label: o.card_label || '',
    card_id: o.card_id || '',
    status: o.status || 'pending',
    reject_reason: o.reject_reason || '',
    created_at: o.created_at || '',
  }));

  return { success: true, orders: items };
}

/**
 * الأدمن يُدخل بيانات البطاقة ويُسلّمها للعميل.
 */
async function handleAdminMcardFulfil(user, body, env) {
  await requireAdmin(user, env);

  const id = String(body.id || '').trim();
  if (!id) throw httpError(400, 'رقم الطلب مفقود');

  const o = await fsGet(env, `manual_card_orders/${id}`);
  if (!o) throw httpError(404, 'الطلب غير موجود');
  if (o.status !== 'pending') throw httpError(400, 'الطلب مُعالج');

  // للطلبات الجديدة: قراءة رقم البطاقة
  const pan = String(body.card_number || '').replace(/\s+/g, '');
  const expiry = String(body.expiry || '').trim();
  const cvv = String(body.cvv || '').trim();

  if (!/^\d{16}$/.test(pan)) {
    throw httpError(400, 'رقم البطاقة يجب أن يكون 16 رقمًا');
  }
  if (!/^\d{2}\/\d{2}$/.test(expiry)) {
    throw httpError(400, 'صيغة التاريخ MM/YY');
  }
  if (!/^\d{3}$/.test(cvv)) {
    throw httpError(400, 'CVV يجب أن يكون 3 أرقام');
  }

  const s = await getSettings(env);
  const ttlSec = num(s.mcard_reveal_seconds, 300);
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();

  let cardId = o.card_id;

  // إنشاء بطاقة جديدة
  if (o.kind === 'create') {
    cardId = `MCX${Date.now()}${randomSuffix(4)}`;
    await fsSet(env, `manual_cards/${cardId}`, {
      uid: o.uid,
      card_label: o.card_label || 'بطاقتي',
      name_on_card: o.name_on_card || '',
      last4: pan.slice(-4),
      brand: 'Visa',
      status: 'active',
      balance: o.amount,
      created_at: nowIso(),
    });
  } else {
    // إعادة شحن
    await fsIncrement(env, `manual_cards/${cardId}`, { balance: o.amount });
  }

  await Promise.all([
    // البيانات الكاملة — مؤقتة
    fsSet(env, `manual_card_reveal/${cardId}`, {
      uid: o.uid,
      card_id: cardId,
      card_number: pan,
      expiry,
      cvv,
      name_on_card: o.name_on_card || '',
      created_at: nowIso(),
      expires_at: expiresAt,
    }),
    // تحديث الطلب
    fsPatch(env, `manual_card_orders/${id}`, {
      status: 'completed',
      card_id: cardId,
      delivered_at: nowIso(),
      updated_at: nowIso(),
    }),
    logOp(env, user.uid, 'mcard_fulfilled', { id }, { cardId }, true),
  ]);

  return { success: true, card_id: cardId };
}

/**
 * الأدمن يرفض الطلب → يُرجع المبلغ للعميل.
 */
async function handleAdminMcardReject(user, body, env) {
  await requireAdmin(user, env);

  const id = String(body.id || '').trim();
  if (!id) throw httpError(400, 'رقم الطلب مفقود');

  const o = await fsGet(env, `manual_card_orders/${id}`);
  if (!o) throw httpError(404, 'الطلب غير موجود');
  if (o.status !== 'pending') throw httpError(400, 'الطلب مُعالج');

  const back = round2(num(o.total, 0));

  await Promise.all([
    fsPatch(env, `manual_card_orders/${id}`, {
      status: 'rejected',
      reject_reason: String(body.reason || '').slice(0, 200),
      updated_at: nowIso(),
    }),
    fsIncrement(env, `users/${o.uid}`, { wallet_balance: back }),
    logOp(env, user.uid, 'mcard_rejected', { id }, { refunded: back }, true),
  ]);

  return { success: true, refunded: back };
}

/* ═══════════════════════════════════════════════════════════
   ADMIN — المستخدمون
   ═══════════════════════════════════════════════════════════ */

async function handleAdminUsersList(user, body, env) {
  await requireAdmin(user, env);

  const search = String(body.search || '').toLowerCase();
  const rows = await fsQuery(env, {
    from: [{ collectionId: 'users' }],
    limit: 200,
  });

  let users = rows.map(r => withId(r, 'users'));

  if (search) {
    users = users.filter(u =>
      (u.name || '').toLowerCase().includes(search) ||
      (u.email || '').toLowerCase().includes(search) ||
      (u.phone || '').includes(search)
    );
  }

  users = users.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  const items = users.slice(0, 100).map(u => ({
    id: u._id,
    name: u.name || '',
    email: u.email || '',
    phone: u.phone || '',
    wallet_balance: round2(num(u.wallet_balance, 0)),
    total_spent: round2(num(u.total_spent, 0)),
    vip_status: u.vip_status || 'none',
    banned: u.banned === true,
    cards_count: num(u.cards_count, 0),
    created_at: u.created_at || '',
  }));

  return { success: true, users: items };
}

async function handleAdminUserBan(user, body, env) {
  await requireAdmin(user, env);
  const uid = String(body.uid || '').trim();
  if (!uid) throw httpError(400, 'معرّف المستخدم مفقود');

  const u = await fsGet(env, `users/${uid}`);
  if (!u) throw httpError(404, 'غير موجود');

  const banned = !u.banned;
  await fsPatch(env, `users/${uid}`, { banned });

  return { success: true, banned };
}

/* ═══════════════════════════════════════════════════════════
   ADMIN — VIP
   ═══════════════════════════════════════════════════════════ */

async function handleAdminVipPlans(user, body, env) {
  await requireAdmin(user, env);

  const rows = await fsQuery(env, {
    from: [{ collectionId: 'vip_plans' }],
    limit: 20,
  });

  const plans = rows.map(r => withId(r, 'vip_plans'))
    .sort((a, b) => num(a.order, 99) - num(b.order, 99))
    .map(p => ({
      id: p._id,
      name: p.name || '',
      name_en: p.name_en || '',
      price_usd: round2(num(p.price_usd, 0)),
      duration_days: num(p.duration_days, 30),
      cards_count: num(p.cards_count, 0),
      features: Array.isArray(p.features) ? p.features : [],
      popular: p.popular === true,
      active: p.active !== false,
      order: num(p.order, 99),
    }));

  return { success: true, plans };
}

async function handleAdminVipSave(user, body, env) {
  await requireAdmin(user, env);

  const id = String(body.id || '').trim();
  const data = {
    name: String(body.name || '').slice(0, 60),
    name_en: String(body.name_en || '').slice(0, 60),
    price_usd: round2(num(body.price_usd, 0)),
    duration_days: num(body.duration_days, 30),
    cards_count: num(body.cards_count, 0),
    features: Array.isArray(body.features) ? body.features.slice(0, 10).map(f => String(f).slice(0, 100)) : [],
    popular: body.popular === true,
    active: body.active !== false,
    order: num(body.order, 99),
    updated_at: nowIso(),
  };

  if (!data.name) throw httpError(400, 'اسم الباقة مطلوب');
  if (data.price_usd <= 0) throw httpError(400, 'سعر الباقة مطلوب');

  let planId = id;
  if (id) {
    await fsPatch(env, `vip_plans/${id}`, data);
  } else {
    planId = `VP${Date.now()}${randomSuffix(3)}`;
    await fsSet(env, `vip_plans/${planId}`, {
      ...data,
      created_at: nowIso(),
    });
  }

  return { success: true, id: planId };
}

async function handleAdminVipList(user, body, env) {
  await requireAdmin(user, env);

  const rows = await fsQuery(env, {
    from: [{ collectionId: 'subscriptions' }],
    limit: 200,
  });

  const subs = rows.map(r => withId(r, 'subscriptions'))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  // جلب بيانات المستخدمين
  const uids = [...new Set(subs.map(s => s.uid))];
  const users = {};
  for (const uid of uids.slice(0, 100)) {
    const u = await fsGet(env, `users/${uid}`).catch(() => null);
    if (u) users[uid] = { name: u.name || '', email: u.email || '' };
  }

  const items = subs.slice(0, 100).map(s => ({
    id: s._id,
    uid: s.uid,
    user: users[s.uid] || { name: '—', email: '—' },
    plan_name: s.plan_name || '',
    price_usd: round2(num(s.price_usd, 0)),
    status: s.status || 'active',
    started_at: s.started_at || '',
    expires_at: s.expires_at || '',
  }));

  return { success: true, subscriptions: items };
}

/* ═══════════════════════════════════════════════════════════
   ADMIN — الإعلانات
   ═══════════════════════════════════════════════════════════ */

async function handleAdminAdsList(user, body, env) {
  await requireAdmin(user, env);

  const rows = await fsQuery(env, {
    from: [{ collectionId: 'ads' }],
    limit: 30,
  });

  const ads = rows.map(r => withId(r, 'ads'))
    .sort((a, b) => num(a.order, 99) - num(b.order, 99))
    .map(a => ({
      id: a._id,
      title: a.title || '',
      subtitle: a.subtitle || '',
      image: a.image || '',
      link: a.link || '',
      cta: a.cta || '',
      advertiser: a.advertiser || '',
      active: a.active !== false,
      order: num(a.order, 99),
    }));

  return { success: true, ads };
}

async function handleAdminAdsSave(user, body, env) {
  await requireAdmin(user, env);

  const id = String(body.id || '').trim();
  const data = {
    title: String(body.title || '').slice(0, 80),
    subtitle: String(body.subtitle || '').slice(0, 120),
    image: String(body.image || '').slice(0, 900000),
    link: String(body.link || '').slice(0, 300),
    cta: String(body.cta || 'اعرف المزيد').slice(0, 40),
    advertiser: String(body.advertiser || '').slice(0, 80),
    active: body.active !== false,
    order: num(body.order, 99),
    updated_at: nowIso(),
  };

  if (!data.title) throw httpError(400, 'العنوان مطلوب');

  let adId = id;
  if (id) {
    await fsPatch(env, `ads/${id}`, data);
  } else {
    adId = `AD${Date.now()}${randomSuffix(3)}`;
    await fsSet(env, `ads/${adId}`, {
      ...data,
      created_at: nowIso(),
    });
  }

  return { success: true, id: adId };
}

async function handleAdminAdsDelete(user, body, env) {
  await requireAdmin(user, env);
  const id = String(body.id || '').trim();
  if (!id) throw httpError(400, 'معرّف الإعلان مفقود');

  await fsDelete(env, `ads/${id}`);
  return { success: true };
}

/* ═══════════════════════════════════════════════════════════
   ADMIN — Stats Dashboard
   ═══════════════════════════════════════════════════════════ */

async function handleAdminStats(user, body, env) {
  await requireAdmin(user, env);

  const [users, cards, orders, deposits, subscriptions, tickets] = await Promise.all([
    fsQuery(env, { from: [{ collectionId: 'users' }], limit: 500 }),
    fsQuery(env, { from: [{ collectionId: 'manual_cards' }], limit: 500 }),
    fsQuery(env, { from: [{ collectionId: 'manual_card_orders' }], limit: 500 }),
    fsQuery(env, { from: [{ collectionId: 'wallet_deposits' }], limit: 500 }),
    fsQuery(env, { from: [{ collectionId: 'subscriptions' }], limit: 500 }),
    fsQuery(env, { from: [{ collectionId: 'tickets' }], limit: 500 }),
  ]);

  const usersList = users.map(r => withId(r, 'users'));
  const ordersList = orders.map(r => withId(r, 'manual_card_orders'));
  const depositsList = deposits.map(r => withId(r, 'wallet_deposits'));
  const subsList = subscriptions.map(r => withId(r, 'subscriptions'));

  // إحصائيات
  const totalUsers = usersList.length;
  const activeUsers = usersList.filter(u => !u.banned).length;
  const bannedUsers = usersList.filter(u => u.banned).length;

  const totalCards = cards.length;
  const activeCards = cards.filter(c => {
    const d = withId(c, 'manual_cards');
    return d.status === 'active';
  }).length;

  const completedOrders = ordersList.filter(o => o.status === 'completed').length;
  const pendingOrders = ordersList.filter(o => o.status === 'pending').length;
  const rejectedOrders = ordersList.filter(o => o.status === 'rejected').length;

  const totalDeposits = depositsList
    .filter(d => d.status === 'approved')
    .reduce((sum, d) => sum + num(d.amount_usd, 0), 0);

  const totalVipSubs = subsList.filter(s => s.status === 'active').length;
  const totalVipRevenue = subsList
    .reduce((sum, s) => sum + num(s.price_usd, 0), 0);

  // آخر 14 يوم إيرادات (من الطلبات المكتملة)
  const days = [...Array(14)].map((_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (13 - i));
    const nx = new Date(d);
    nx.setDate(nx.getDate() + 1);
    const dayOrders = ordersList.filter(o => {
      if (o.status !== 'completed') return false;
      const t = new Date(o.created_at || 0);
      return t >= d && t < nx;
    });
    const revenue = dayOrders.reduce((sum, o) => sum + num(o.total, 0), 0);
    return { date: d.toISOString().slice(0, 10), revenue };
  });

  const pendingTickets = tickets.map(r => withId(r, 'tickets'))
    .filter(t => t.status === 'open').length;

  return {
    success: true,
    stats: {
      users: { total: totalUsers, active: activeUsers, banned: bannedUsers },
      cards: { total: totalCards, active: activeCards },
      orders: { completed: completedOrders, pending: pendingOrders, rejected: rejectedOrders },
      deposits: { total_usd: round2(totalDeposits) },
      vip: { subscriptions: totalVipSubs, revenue_usd: round2(totalVipRevenue) },
      tickets: { open: pendingTickets },
      revenue_chart: days,
    },
  };
}

/* ═══════════════════════════════════════════════════════════
   ADMIN — Tickets
   ═══════════════════════════════════════════════════════════ */

async function handleAdminTicketsList(user, body, env) {
  await requireAdmin(user, env);

  const filter = String(body.filter || 'all');
  const rows = await fsQuery(env, {
    from: [{ collectionId: 'tickets' }],
    limit: 200,
  });

  let tickets = rows.map(r => withId(r, 'tickets'))
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));

  if (filter !== 'all') {
    tickets = tickets.filter(t => t.status === filter);
  }

  // جلب بيانات المستخدمين
  const uids = [...new Set(tickets.map(t => t.uid))];
  const users = {};
  for (const uid of uids.slice(0, 100)) {
    const u = await fsGet(env, `users/${uid}`).catch(() => null);
    if (u) users[uid] = { name: u.name || '', email: u.email || '' };
  }

  const items = tickets.slice(0, 100).map(t => ({
    id: t._id,
    uid: t.uid,
    user: users[t.uid] || { name: '—', email: '—' },
    subject: t.subject || '',
    status: t.status || 'open',
    messages: t.messages || [],
    order_id: t.order_id || '',
    created_at: t.created_at || '',
    updated_at: t.updated_at || '',
  }));

  return { success: true, tickets: items };
}

async function handleAdminTicketClose(user, body, env) {
  await requireAdmin(user, env);
  const id = String(body.id || '').trim();
  if (!id) throw httpError(400, 'رقم التذكرة مفقود');

  await fsPatch(env, `tickets/${id}`, {
    status: 'closed',
    updated_at: nowIso(),
  });

  return { success: true };
}

async function handleAdminTicketReply(user, body, env) {
  await requireAdmin(user, env);
  const id = String(body.id || '').trim();
  const msg = String(body.message || '').trim().slice(0, 1500);

  if (!id || !msg) throw httpError(400, 'بيانات ناقصة');

  const t = await fsGet(env, `tickets/${id}`);
  if (!t) throw httpError(404, 'غير موجودة');

  const msgs = Array.isArray(t.messages) ? t.messages : [];
  msgs.push({ by: 'admin', text: msg, at: nowIso() });

  await fsPatch(env, `tickets/${id}`, {
    messages: msgs.slice(-40),
    status: 'answered',
    updated_at: nowIso(),
  });

  return { success: true };
}

/* ═══════════════════════════════════════════════════════════
   ADMIN — Deposits
   ═══════════════════════════════════════════════════════════ */

async function handleAdminDepositsList(user, body, env) {
  await requireAdmin(user, env);

  const filter = String(body.filter || 'pending');
  const rows = await fsQuery(env, {
    from: [{ collectionId: 'wallet_deposits' }],
    limit: 200,
  });

  let deposits = rows.map(r => withId(r, 'wallet_deposits'))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  if (filter !== 'all') {
    deposits = deposits.filter(d => d.status === filter);
  }

  // جلب بيانات المستخدمين
  const uids = [...new Set(deposits.map(d => d.uid))];
  const users = {};
  for (const uid of uids.slice(0, 100)) {
    const u = await fsGet(env, `users/${uid}`).catch(() => null);
    if (u) users[uid] = { name: u.name || '', email: u.email || '', phone: u.phone || '' };
  }

  const items = deposits.slice(0, 100).map(d => ({
    id: d._id,
    uid: d.uid,
    user: users[d.uid] || { name: '—', email: '—' },
    amount_usd: round2(num(d.amount_usd, 0)),
    amount_lyd: round2(num(d.amount_lyd, 0)),
    method: d.method || '',
    claim_phone: d.claim_phone || '',
    status: d.status || 'pending',
    proof_url: d.proof_url || '',
    created_at: d.created_at || '',
  }));

  return { success: true, deposits: items };
}

async function handleAdminDepositAction(user, body, env) {
  await requireAdmin(user, env);
  const id = String(body.id || '').trim();
  const action = body.action === 'reject' ? 'reject' : 'approve';

  if (!id) throw httpError(400, 'معرّف الإيداع مفقود');

  const dep = await fsGet(env, `wallet_deposits/${id}`);
  if (!dep) throw httpError(404, 'غير موجود');
  if (dep.status !== 'pending') throw httpError(400, 'مُعالج مسبقًا');

  if (action === 'reject') {
    await fsPatch(env, `wallet_deposits/${id}`, {
      status: 'rejected',
      reject_reason: String(body.reason || '').slice(0, 200),
      reviewed_by: user.uid,
      reviewed_at: nowIso(),
    });
    return { success: true };
  }

  const amountUsd = round2(num(dep.amount_usd, 0));
  await Promise.all([
    fsIncrement(env, `users/${dep.uid}`, { wallet_balance: amountUsd }),
    fsPatch(env, `wallet_deposits/${id}`, {
      status: 'approved',
      reviewed_by: user.uid,
      reviewed_at: nowIso(),
    }),
  ]);

  return { success: true, credited: amountUsd };
      }
/* ═══════════════════════════════════════════════════════════
   PART 3 — مكملات نهائية
   ═══════════════════════════════════════════════════════════ */

/* ═══ Activity Log (اختياري — للمستخدم) ═══ */
async function logActivity(env, s, uid, request, action) {
  if (s.activity_log_enabled === false) return;
  try {
    await fsSet(env, `activity/${uid}_${Date.now()}`, {
      uid,
      action,
      created_at: nowIso(),
    });
  } catch { /* ignore */ }
}

/* ═══ Bank Transfer (method) ═══ */
/* يبقى معطّلًا افتراضيًا — يُفعّل من الإعدادات */

/* ═══ Export for tests ═══ */
/* لا شيء إضافي — كل الدوال معرّفة */

/* ═══════════════════════════════════════════════════════════
   نهاية الملف
   ═══════════════════════════════════════════════════════════ */
