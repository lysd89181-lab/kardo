/**
 * ═══════════════════════════════════════════════════════════
 *  KARDO — Cloudflare Worker Backend
 *  Version: 2.2.0 (Fixed BatchGet Document Name)
 * ═══════════════════════════════════════════════════════════
 */

const FS_BASE = 'https://firestore.googleapis.com/v1';
const TRON_API = 'https://api.trongrid.io';
const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

let _tokenCache = { token: null, exp: 0 };
let _jwksCache = { keys: null, exp: 0 };

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
      Promise.all([
        purgeExpiredReveals(env).catch(e => console.error('PURGE_FAILED', e.message)),
        purgeOldRateLimits(env).catch(e => console.error('RL_PURGE_FAILED', e.message)),
      ])
    );
  },
};

async function route(path, request, url, env) {
  if (path === '/api/status' && request.method === 'GET') return handleStatus(env);
  if (path === '/api/catalog' && request.method === 'GET') return handleCatalog(env);
  if (path === '/api/sms/webhook') return handleSmsWebhook(request, env);

  const body = request.method === 'POST' ? await safeJson(request) : {};
  const user = await requireAuth(request, env);
  await enforceGlobalRateLimit(env, user.uid);

  switch (path) {
    case '/api/wallet/claim':        return handleWalletClaim(user, body, env);
    case '/api/wallet/withdraw':     return handleWithdrawRequest(user, body, env);
    case '/api/wallet/transfer':     return handleTransfer(user, body, env);
    case '/api/wallet/usdt/invoice': return handleUsdtInvoice(user, body, env);
    case '/api/wallet/usdt/verify':  return handleUsdtVerify(user, body, env, request);
    case '/api/mcard/request':       return handleManualCardRequest(user, body, env);
    case '/api/mcard/topup-request': return handleManualCardTopup(user, body, env);
    case '/api/mcard/list':          return handleManualCardList(user, env);
    case '/api/mcard/reveal':        return handleRevealCard(user, body, env, request);
    case '/api/store/order':         return handleStoreOrder(user, body, env);
    case '/api/coupon/check':        return handleCouponCheck(user, body, env);
    case '/api/points/redeem':       return handleRedeemPoints(user, body, env);
    case '/api/ref/code':            return handleRefCode(user, body, env);
    case '/api/ref/claim':           return handleRefClaim(user, body, env);
    case '/api/ticket/create':       return handleTicketCreate(user, body, env);
    case '/api/ticket/reply':        return handleTicketReply(user, body, env);
    case '/api/activity/ping':       return handleActivityPing(user, body, env, request);
    case '/api/admin/settings':      return handleAdminSettings(user, body, env);
    case '/api/admin/deposit':       return handleAdminDeposit(user, body, env);
    case '/api/admin/wallet-adjust': return handleAdminWalletAdjust(user, body, env);
    case '/api/admin/mcard/fulfil':  return handleAdminCardFulfil(user, body, env);
    case '/api/admin/mcard/reject':  return handleAdminCardReject(user, body, env);
    case '/api/admin/sms/assign':    return handleAdminSmsAssign(user, body, env);
    case '/api/admin/withdraw':      return handleAdminWithdraw(user, body, env);
    case '/api/admin/order':         return handleAdminOrder(user, body, env);
    case '/api/admin/ticket/close':  return handleTicketClose(user, body, env);
  }
  throw httpError(404, 'المسار غير موجود');
}

/* ═══════════════════════════════════════════════════════════
   Rate Limiting
   ═══════════════════════════════════════════════════════════ */

async function enforceGlobalRateLimit(env, uid) {
  const windowSec = 60;
  const max = 120;
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / windowSec);
  const key = `rl_g_${uid}_${bucket}`;

  try {
    const cur = await fsGet(env, `rate_limits/${key}`).catch(() => null);
    const count = num(cur && cur.count, 0);
    if (count >= max) throw httpError(429, 'محاولات كثيرة — انتظر قليلاً');
    await fsSet(env, `rate_limits/${key}`, {
      uid, count: count + 1, bucket, expires_at: now + 120,
    }).catch(() => {});
  } catch (e) {
    if (e.status === 429) throw e;
  }
}

async function checkRateLimit(env, key, limit, windowSec) {
  const bucket = Math.floor(Date.now() / windowSec);
  const rlKey = `rl_${key}_${bucket}`;
  try {
    const cur = await fsGet(env, `rate_limits/${rlKey}`).catch(() => null);
    const count = num(cur && cur.count, 0);
    if (count >= limit) return false;
    await fsSet(env, `rate_limits/${rlKey}`, {
      key: rlKey, count: count + 1,
      expires_at: Math.floor(Date.now() / 1000) + windowSec + 60,
    }).catch(() => {});
    return true;
  } catch { return true; }
}

async function purgeOldRateLimits(env) {
  const now = Math.floor(Date.now() / 1000);
  const rows = await fsQueryRaw(env, {
    from: [{ collectionId: 'rate_limits' }], limit: 300,
  });
  let purged = 0;
  for (const r of rows) {
    const d = withId(r, 'rate_limits');
    if (num(d.expires_at, 0) < now) {
      await fsDelete(env, `rate_limits/${d._id}`).catch(() => {});
      purged++;
    }
  }
  return purged;
}

/* ═══════════════════════════════════════════════════════════
   Status
   ═══════════════════════════════════════════════════════════ */

async function handleStatus(env) {
  const s = await getSettings(env);
  return {
    success: true,
    min_amount: num(s.mc_create_min, 10),
    max_amount: num(s.mc_create_max, 500),
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
    method_order: s.method_order || 'libyana,almadar,usdt,bank,binance',
    banners: cleanBanners(s.banners),
    subscriptions_visible: s.subscriptions_visible !== false,
    manual_cards: {
      on: s.manual_cards_enabled !== false,
      create_min: num(s.mc_create_min, 10),
      create_max: num(s.mc_create_max, 500),
      create_fee_fixed: num(s.mc_create_fee_fixed, 8),
      create_fee_pct: num(s.mc_create_fee_pct, 2.5),
      topup_min: num(s.mc_topup_min, 10),
      topup_max: num(s.mc_topup_max, 500),
      topup_fee_fixed: num(s.mc_topup_fee_fixed, 8),
      topup_fee_pct: num(s.mc_topup_fee_pct, 2.5),
      reveal_hours: num(s.mc_reveal_hours, 24),
    },
    withdraw: {
      on: s.withdraw_enabled === true,
      min: num(s.withdraw_min, 10), max: num(s.withdraw_max, 500),
      fee_pct: num(s.withdraw_fee_pct, 0), fee_fixed: num(s.withdraw_fee_fixed, 0),
      methods: String(s.withdraw_methods || 'ليبيانا,المدار').split(',').map(x => x.trim()).filter(Boolean),
    },
    transfer: {
      on: s.transfer_enabled === true,
      min: num(s.transfer_min, 1), fee_pct: num(s.transfer_fee_pct, 0),
    },
    tickets_on: s.tickets_enabled !== false,
    coupons_on: s.coupons_enabled !== false,
    points: {
      on: s.points_enabled === true,
      per_lyd: num(s.points_per_lyd, 1),
      value_lyd: num(s.points_value_lyd, 0.01),
      min_redeem: num(s.points_min_redeem, 100),
    },
    banner_rotate_sec: num(s.banner_rotate_sec, 6),
    kill_switch: s.kill_switch === true,
    kill_message: s.kill_message || 'الخدمة متوقفة مؤقتًا للصيانة.',
    referral: {
      on: s.referral_enabled === true,
      inviter: num(s.referral_bonus_inviter, 1),
      invitee: num(s.referral_bonus_invitee, 1),
      min_spend: num(s.referral_min_spend, 10),
    },
    theme: {
      navy: s.theme_navy || '#0F172A', emerald: s.theme_emerald || '#10B981',
      bg: s.theme_bg || '#F8FAFC', radius: num(s.theme_radius, 14),
    },
    nav: {
      home: s.nav_home !== false, mcards: s.nav_mcards !== false,
      wallet: s.nav_wallet !== false, tx: s.nav_tx !== false,
      help: s.nav_help !== false, settings: s.nav_settings !== false,
    },
    texts: {
      tagline: s.brand_tagline || 'بطاقات أكثر .. فرص أكبر',
      hero_title: s.hero_title || 'بطاقة تعمل في كل مكان يقبل الدفع الإلكتروني',
      hero_sub: s.hero_sub || 'بالدولار · بدون رسوم شهرية · تُصدر خلال دقائق',
      support_url: s.support_url || '',
    },
    methods: {
      libyana: { on: s.m_libyana_on !== false, logo: s.m_libyana_logo || '',
                 label: s.m_libyana_label || 'ليبيانا',
                 phone: s.m_libyana_phone || s.deposit_phone || '',
                 rate: num(s.rate_libyana, 11.8), auto: true },
      almadar: { on: s.m_almadar_on !== false, logo: s.m_almadar_logo || '',
                 label: s.m_almadar_label || 'المدار',
                 phone: s.m_almadar_phone || s.deposit_phone || '',
                 rate: num(s.rate_almadar, 12.5), auto: true },
      bank:    { on: s.m_bank_on === true, logo: s.m_bank_logo || '',
                 label: s.m_bank_label || 'تحويل مصرفي',
                 rate: num(s.rate_bank, 9.5), auto: false,
                 fields: cleanFields(s.m_bank_fields) },
      usdt:    { on: s.m_usdt_on === true, logo: s.m_usdt_logo || '',
                 label: s.m_usdt_label || 'USDT',
                 rate: num(s.rate_usdt, 1), auto: true, invoice: true,
                 address: s.usdt_address || '',
                 min: num(s.usdt_min, 5), max: num(s.usdt_max, 1000),
                 window_min: num(s.usdt_window_min, 30),
                 fields: cleanFields(s.m_usdt_fields) },
      binance: { on: s.m_binance_on === true, logo: s.m_binance_logo || '',
                 label: s.m_binance_label || 'Binance Pay',
                 rate: num(s.rate_usdt, 1), auto: false,
                 fields: cleanFields(s.m_binance_fields) },
      ...cleanCustomMethods(s.custom_methods),
    },
    maintenance_message: s.maintenance_message || '',
  };
}

/* ═══════════════════════════════════════════════════════════
   Manual Cards
   ═══════════════════════════════════════════════════════════ */

async function handleManualCardRequest(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.manual_cards_enabled === false) throw httpError(503, 'إصدار البطاقات متوقف مؤقتًا');

  const amount = round2(num(body.amount, NaN));
  const nameOnCard = String(body.name_on_card || '').trim().toUpperCase().slice(0, 40);
  const cardName = String(body.card_name || 'بطاقتي').trim().slice(0, 40);

  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'أدخل المبلغ');
  if (!/^[A-Z][A-Z .'-]{1,39}$/.test(nameOnCard)) {
    throw httpError(400, 'اسم حامل البطاقة يجب أن يكون بحروف لاتينية');
  }

  const mn = num(s.mc_create_min, 10);
  const mx = num(s.mc_create_max, 500);
  if (amount < mn) throw httpError(400, `الحد الأدنى ${mn}$`);
  if (amount > mx) throw httpError(400, `الحد الأقصى ${mx}$`);

  const fixedFee = num(s.mc_create_fee_fixed, 8);
  const pct = num(s.mc_create_fee_pct, 2.5);
  const fee = round2(fixedFee + amount * pct / 100);
  const total = round2(amount + fee);

  await assertDailyLimit(env, s, user.uid, 'card', total);

  const id = `MC${Date.now()}${randomSuffix(4)}`;

  await fsRunTransaction(env, async (tx) => {
    const me = await tx.get(`users/${user.uid}`);
    if (!me) throw httpError(400, 'الحساب غير مكتمل');
    if (me.banned === true) throw httpError(403, 'الحساب موقوف');

    const balance = num(me.wallet_balance, 0);
    if (balance < total) throw httpError(402, `رصيدك غير كافٍ`);
    const newBalance = round2(balance - total);

    tx.update(`users/${user.uid}`, { wallet_balance: newBalance });
    tx.create('wallet_transactions', `txn_mc_create_${id}`, {
      uid: user.uid, type: 'debit', amount: total,
      balance_before: balance, balance_after: newBalance,
      reason: 'card_create', reference: id, created_at: nowIso(),
    });
    tx.create('manual_card_orders', id, {
      uid: user.uid, kind: 'create', amount, fee, total,
      card_name: cardName, name_on_card: nameOnCard,
      status: 'pending', created_at: nowIso(), updated_at: nowIso(),
    });
  });

  await logOp(env, user.uid, 'manual_card_request', { kind: 'create', amount }, { id }, true);
  return { success: true, id, amount, fee, total };
}

async function handleManualCardTopup(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.manual_cards_enabled === false) throw httpError(503, 'خدمة البطاقات متوقفة مؤقتًا');

  const cardId = String(body.card_id || '').trim();
  const amount = round2(num(body.amount, NaN));

  if (!cardId) throw httpError(400, 'اختر البطاقة');
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'أدخل المبلغ');

  const mn = num(s.mc_topup_min, 10);
  const mx = num(s.mc_topup_max, 500);
  if (amount < mn) throw httpError(400, `الحد الأدنى للشحن ${mn}$`);
  if (amount > mx) throw httpError(400, `الحد الأقصى للشحن ${mx}$`);

  const fixedFee = num(s.mc_topup_fee_fixed, 8);
  const pct = num(s.mc_topup_fee_pct, 2.5);
  const fee = round2(fixedFee + amount * pct / 100);
  const total = round2(amount + fee);

  await assertDailyLimit(env, s, user.uid, 'card', total);

  const id = `MCT${Date.now()}${randomSuffix(4)}`;

  let cardName = '';
  await fsRunTransaction(env, async (tx) => {
    const me = await tx.get(`users/${user.uid}`);
    if (!me) throw httpError(400, 'الحساب غير مكتمل');
    if (me.banned === true) throw httpError(403, 'الحساب موقوف');

    const card = await tx.get(`manual_cards/${cardId}`);
    if (!card || card.uid !== user.uid) throw httpError(404, 'البطاقة غير موجودة');
    if (card.status !== 'active') throw httpError(400, 'هذه البطاقة غير نشطة');
    cardName = card.card_name || '';

    const balance = num(me.wallet_balance, 0);
    if (balance < total) throw httpError(402, 'رصيدك غير كافٍ');
    const newBalance = round2(balance - total);

    tx.update(`users/${user.uid}`, { wallet_balance: newBalance });
    tx.create('wallet_transactions', `txn_mc_topup_${id}`, {
      uid: user.uid, type: 'debit', amount: total,
      balance_before: balance, balance_after: newBalance,
      reason: 'card_topup', reference: id, created_at: nowIso(),
    });
    tx.create('manual_card_orders', id, {
      uid: user.uid, kind: 'topup', card_id: cardId, amount, fee, total,
      card_name: cardName, status: 'pending',
      created_at: nowIso(), updated_at: nowIso(),
    });
  });

  await logOp(env, user.uid, 'manual_card_request', { kind: 'topup', amount }, { id }, true);
  return { success: true, id, amount, fee, total };
}

async function handleManualCardList(user, env) {
  const rows = await fsQueryRaw(env, {
    from: [{ collectionId: 'manual_cards' }],
    where: {
      fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: user.uid } },
    },
    limit: 50,
  });

  const cards = rows.map(r => {
    const d = withId(r, 'manual_cards');
    return {
      id: d._id, card_name: d.card_name || 'بطاقتي',
      name_on_card: d.name_on_card || '', last4: d.last4 || '****',
      balance: round2(num(d.balance, 0)), status: d.status || 'active',
      created_at: d.created_at,
    };
  }).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  const orderRows = await fsQueryRaw(env, {
    from: [{ collectionId: 'manual_card_orders' }],
    where: {
      fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: user.uid } },
    },
    limit: 60,
  });

  const orders = orderRows.map(r => withId(r, 'manual_card_orders'))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .map(o => ({
      id: o._id, kind: o.kind,
      amount: round2(num(o.amount, 0)), fee: round2(num(o.fee, 0)),
      total: round2(num(o.total, 0)),
      card_id: o.card_id || '', card_name: o.card_name || '',
      status: o.status, reject_reason: o.reject_reason || '',
      created_at: o.created_at,
    }));

  return { success: true, cards, orders };
}

async function handleRevealCard(user, body, env, request) {
  const orderId = String(body.order_id || '').trim();
  if (!orderId) throw httpError(400, 'رقم الطلب مفقود');

  const rlOk = await checkRateLimit(env, `reveal_${user.uid}`, 20, 3600);
  if (!rlOk) {
    await logOp(env, user.uid, 'reveal_rate_limited', { orderId }, {}, false);
    throw httpError(429, 'بلغت حد عرض البيانات — انتظر ساعة');
  }

  const rv = await fsGet(env, `manual_card_reveal/${orderId}`);
  if (!rv || rv.uid !== user.uid) throw httpError(404, 'لا بيانات متاحة لهذا الطلب');
  if (new Date(rv.expires_at) < new Date()) {
    throw httpError(410, 'انتهت صلاحية عرض البيانات');
  }

  const logId = `RV${Date.now()}${randomSuffix(4)}`;
  await fsSet(env, `reveal_logs/${logId}`, {
    uid: user.uid, order_id: orderId, card_id: rv.card_id || '',
    ip: (request.headers.get('cf-connecting-ip') || '').slice(0, 45),
    ua: (request.headers.get('user-agent') || '').slice(0, 160),
    country: String(request.cf?.country || '').slice(0, 4),
    city: String(request.cf?.city || '').slice(0, 60),
    revealed_at: nowIso(),
  }).catch(() => {});

  return {
    success: true,
    card_number: rv.card_number,
    expiry: rv.expiry,
    cvv: rv.cvv,
    expires_at: rv.expires_at,
  };
}

async function handleAdminCardFulfil(user, body, env) {
  await requireAdmin(user, env);
  const id = String(body.id || '').trim();
  if (!id) throw httpError(400, 'رقم الطلب مفقود');

  const isReject = body.action === 'reject';

  if (isReject) {
    const reason = String(body.reason || '').slice(0, 200);
    await fsRunTransaction(env, async (tx) => {
      const o = await tx.get(`manual_card_orders/${id}`);
      if (!o) throw httpError(404, 'الطلب غير موجود');
      if (o.status !== 'pending') throw httpError(400, 'الطلب مُغلق بالفعل');

      const back = round2(num(o.total, 0));
      const u = await tx.get(`users/${o.uid}`);
      const curBalance = num(u?.wallet_balance, 0);
      const newBalance = round2(curBalance + back);

      tx.update(`users/${o.uid}`, { wallet_balance: newBalance });
      tx.update(`manual_card_orders/${id}`, {
        status: 'rejected', reject_reason: reason,
        rejected_at: nowIso(), rejected_by: user.uid,
      });
      tx.create('wallet_transactions', `txn_mc_refund_${id}`, {
        uid: o.uid, type: 'credit', amount: back,
        balance_before: curBalance, balance_after: newBalance,
        reason: 'card_rejected_refund', reference: id, created_at: nowIso(),
      });
    });
    await logOp(env, user.uid, 'manual_card_rejected', { id }, { refunded: true }, true);
    return { success: true, refunded: true };
  }

  const pan = String(body.card_number || '').replace(/\s+/g, '');
  const expiry = String(body.expiry || '').trim();
  const cvv = String(body.cvv || '').trim();
  const providerRef = String(body.provider_ref || '').slice(0, 120);

  const s = await getSettings(env);
  const ttlHours = num(s.mc_reveal_hours, 24);
  const expiresAt = new Date(Date.now() + ttlHours * 3600000).toISOString();

  const o = await fsGet(env, `manual_card_orders/${id}`);
  if (!o) throw httpError(404, 'الطلب غير موجود');

  const isCreate = o.kind === 'create';

  if (isCreate) {
    if (!/^\d{13,19}$/.test(pan)) throw httpError(400, 'رقم البطاقة غير صالح');
    if (!/^\d{2}\/\d{2}$/.test(expiry)) throw httpError(400, 'صيغة التاريخ MM/YY');
    if (!/^\d{3,4}$/.test(cvv)) throw httpError(400, 'CVV غير صالح');
  }

  let cardId = '';
  let oUid = '';

  await fsRunTransaction(env, async (tx) => {
    const oo = await tx.get(`manual_card_orders/${id}`);
    if (!oo) throw httpError(404, 'الطلب غير موجود');
    if (oo.status !== 'pending') throw httpError(400, 'الطلب مُغلق بالفعل');
    oUid = oo.uid;

    if (oo.kind === 'create') {
      cardId = `MCX${Date.now()}${randomSuffix(4)}`;
      tx.create('manual_cards', cardId, {
        uid: oo.uid, card_name: oo.card_name || 'بطاقتي',
        name_on_card: oo.name_on_card || '',
        last4: pan.slice(-4), status: 'active',
        balance: round2(num(oo.amount, 0)),
        created_at: nowIso(), created_by: user.uid,
        provider_ref: providerRef,
      });
    } else {
      cardId = oo.card_id;
      const card = await tx.get(`manual_cards/${cardId}`);
      if (!card) throw httpError(404, 'البطاقة الأصلية غير موجودة');
      const newBal = round2(num(card.balance, 0) + num(oo.amount, 0));
      tx.update(`manual_cards/${cardId}`, {
        balance: newBal, updated_at: nowIso(), last_topup_by: user.uid,
      });
    }

    tx.update(`manual_card_orders/${id}`, {
      status: 'completed', card_id: cardId,
      completed_at: nowIso(), completed_by: user.uid,
      provider_ref: providerRef, reveal_expires_at: expiresAt,
    });
  });

  if (isCreate) {
    await fsSet(env, `manual_card_reveal/${id}`, {
      uid: oUid, card_id: cardId, card_number: pan,
      expiry, cvv, created_at: nowIso(), expires_at: expiresAt,
    });
  }

  await logOp(env, user.uid, 'manual_card_fulfilled', { id }, { cardId }, true);
  return { success: true, card_id: cardId, expires_at: expiresAt };
}

async function handleAdminCardReject(user, body, env) {
  await requireAdmin(user, env);
  const id = String(body.id || '').trim();
  const reason = String(body.reason || '').slice(0, 200);
  if (!id) throw httpError(400, 'رقم الطلب مفقود');

  const o = await fsGet(env, `manual_card_orders/${id}`);
  if (!o) throw httpError(404, 'الطلب غير موجود');
  if (o.status !== 'pending') throw httpError(400, 'الطلب مُغلق بالفعل');

  const back = round2(num(o.total, 0));

  await fsRunTransaction(env, async (tx) => {
    const cur = await tx.get(`manual_card_orders/${id}`);
    if (cur.status !== 'pending') throw httpError(400, 'الطلب مُغلق بالفعل');
    const u = await tx.get(`users/${o.uid}`);
    const curBalance = num(u?.wallet_balance, 0);
    const newBalance = round2(curBalance + back);

    tx.update(`users/${o.uid}`, { wallet_balance: newBalance });
    tx.update(`manual_card_orders/${id}`, {
      status: 'rejected', reject_reason: reason,
      rejected_at: nowIso(), rejected_by: user.uid,
    });
    tx.create('wallet_transactions', `txn_mc_refund_${id}`, {
      uid: o.uid, type: 'credit', amount: back,
      balance_before: curBalance, balance_after: newBalance,
      reason: 'card_rejected_refund', reference: id, created_at: nowIso(),
    });
  });

  await logOp(env, user.uid, 'manual_card_rejected', { id }, { refunded: back }, true);
  return { success: true, refunded: back };
}

async function purgeExpiredReveals(env) {
  const rows = await fsQueryRaw(env, {
    from: [{ collectionId: 'manual_card_reveal' }], limit: 200,
  });
  const now = Date.now();
  let purged = 0;
  for (const r of rows) {
    const d = withId(r, 'manual_card_reveal');
    if (new Date(d.expires_at).getTime() < now) {
      await fsDelete(env, `manual_card_reveal/${d._id}`).catch(() => {});
      purged++;
    }
  }
  return purged;
}

/* ═══════════════════════════════════════════════════════════
   Wallet
   ═══════════════════════════════════════════════════════════ */

async function handleWalletClaim(user, body, env) {
  const phone = normalizePhone(body.phone || '');
  const amountLyd = round2(num(body.amount_lyd, NaN));
  const method = body.method === 'almadar' ? 'almadar' : 'libyana';

  const st = await getSettings(env);
  assertLive(st);
  const enabled = method === 'almadar' ? st.m_almadar_on !== false : st.m_libyana_on !== false;
  if (!enabled) throw httpError(503, 'طريقة الدفع هذه غير متاحة حاليًا');

  if (phone.length !== 9) throw httpError(400, 'رقم الهاتف غير صحيح');
  if (!Number.isFinite(amountLyd) || amountLyd <= 0) throw httpError(400, 'أدخل المبلغ');

  const rate = method === 'almadar' ? num(st.rate_almadar, 12.5) : num(st.rate_libyana, 11.8);
  const amountUsd = round2(amountLyd / rate);

  const maxLyd = num(st.max_deposit_lyd, 5000);
  if (amountLyd > maxLyd) throw httpError(400, `الحد الأقصى ${maxLyd} د.ل`);
  await assertDailyLimit(env, st, user.uid, 'deposit', amountUsd);

  const sms = await findUnclaimedSms(env, phone, amountLyd);

  if (sms) {
    let credited = 0;
    await fsRunTransaction(env, async (tx) => {
      const smsDoc = await tx.get(`sms_transactions/${sms._id}`);
      if (!smsDoc) throw httpError(404, 'الحوالة غير موجودة');
      if (smsDoc.status === 'claimed') throw httpError(409, 'الحوالة مربوطة مسبقًا');

      const u = await tx.get(`users/${user.uid}`);
      const curBalance = num(u?.wallet_balance, 0);
      credited = round2(num(smsDoc.amount_usd, amountUsd));

      tx.update(`users/${user.uid}`, { wallet_balance: round2(curBalance + credited) });
      tx.update(`sms_transactions/${sms._id}`, {
        status: 'claimed', uid: user.uid, claimed_at: nowIso(), matched_by: 'claim',
      });
      tx.create('wallet_deposits', sms._id, {
        uid: user.uid, amount_usd: credited,
        amount_lyd: num(smsDoc.amount_lyd, amountLyd),
        method: (method === 'libyana' ? 'ليبيانا' : 'المدار') + ' — تلقائي',
        claim_phone: phone, proof_url: '', note: 'حوالة من ' + phone,
        status: 'approved', auto: true, created_at: nowIso(),
      });
      tx.create('wallet_transactions', `txn_dep_${sms._id}`, {
        uid: user.uid, type: 'credit', amount: credited,
        balance_before: curBalance, balance_after: round2(curBalance + credited),
        reason: 'deposit_claim', reference: sms._id, created_at: nowIso(),
      });
    });

    await Promise.all([
      bumpCounter(env, user.uid, { deposit: credited }),
      bumpCounter(env, '_platform', { deposit: credited }),
      logOp(env, user.uid, 'claim_matched', { phone, amountLyd }, { credited }, true),
    ]);

    return { success: true, matched: true, credited_usd: credited };
  }

  const claimId = `CLM${Date.now()}${randomSuffix(4)}`;
  await fsSet(env, `wallet_deposits/${claimId}`, {
    uid: user.uid, amount_usd: amountUsd, amount_lyd: amountLyd,
    method: method === 'libyana' ? 'ليبيانا' : 'المدار',
    claim_phone: phone, proof_url: '', note: '',
    status: 'pending', awaiting_sms: true, created_at: nowIso(),
  });

  return { success: true, matched: false, claim_id: claimId };
}

async function findUnclaimedSms(env, phone, amountLyd) {
  const res = await fsQueryRaw(env, {
    from: [{ collectionId: 'sms_transactions' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'unclaimed' } } },
          { fieldFilter: { field: { fieldPath: 'sender' }, op: 'EQUAL', value: { stringValue: phone } } },
        ],
      },
    },
    limit: 20,
  });

  return res
    .map(r => {
      const d = fromFsFields(r.document.fields || {});
      d._id = r.document.name.split('/documents/sms_transactions/')[1];
      return d;
    })
    .filter(d => Math.abs(num(d.amount_lyd, -1) - amountLyd) < 0.005)[0] || null;
}

async function findPendingClaim(env, phone, amountLyd) {
  const res = await fsQueryRaw(env, {
    from: [{ collectionId: 'wallet_deposits' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
          { fieldFilter: { field: { fieldPath: 'claim_phone' }, op: 'EQUAL', value: { stringValue: phone } } },
        ],
      },
    },
    limit: 20,
  });

  return res
    .map(r => {
      const d = fromFsFields(r.document.fields || {});
      d._id = r.document.name.split('/documents/wallet_deposits/')[1];
      return d;
    })
    .filter(d => Math.abs(num(d.amount_lyd, -1) - amountLyd) < 0.005)
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))[0] || null;
}

/* ═══════════════════════════════════════════════════════════
   USDT
   ═══════════════════════════════════════════════════════════ */

async function handleUsdtInvoice(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.m_usdt_on !== true) throw httpError(503, 'الدفع بـ USDT غير متاح');

  const address = String(s.usdt_address || '').trim();
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) throw httpError(503, 'عنوان الاستقبال غير مضبوط');

  const amount = round2(num(body.amount_usd, NaN));
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'أدخل المبلغ');

  const minU = num(s.usdt_min, 5), maxU = num(s.usdt_max, 1000);
  if (amount < minU) throw httpError(400, `الحد الأدنى ${minU} USDT`);
  if (amount > maxU) throw httpError(400, `الحد الأقصى ${maxU} USDT`);
  await assertDailyLimit(env, s, user.uid, 'deposit', amount);

  const open = await fsQueryRaw(env, {
    from: [{ collectionId: 'usdt_invoices' }],
    where: {
      fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'awaiting' } },
    },
    limit: 200,
  });
  const taken = new Set(open.map(r => {
    const d = fromFsFields(r.document.fields || {});
    return Number(num(d.pay_amount, 0)).toFixed(4);
  }));

  let payAmount = null;
  for (let i = 0; i < 80; i++) {
    const b = crypto.getRandomValues(new Uint8Array(2));
    const frac = ((((b[0] << 8) | b[1]) % 900) + 100) / 10000;
    const cand = Number((amount + frac).toFixed(4));
    if (!taken.has(cand.toFixed(4))) { payAmount = cand; break; }
  }
  if (payAmount === null) throw httpError(503, 'ازدحام مؤقت، حاول بعد قليل');

  const minutes = num(s.usdt_window_min, 30);
  const now = Date.now();
  const id = `INV${now}${randomSuffix(4)}`;

  await fsSet(env, `usdt_invoices/${id}`, {
    uid: user.uid, amount_usd: amount, pay_amount: payAmount,
    address, status: 'awaiting',
    created_at: new Date(now).toISOString(),
    created_ms: now, expires_ms: now + minutes * 60000,
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

async function handleUsdtVerify(user, body, env, request) {
  const id = String(body.invoice_id || '').trim();
  if (!id) throw httpError(400, 'رقم الفاتورة مفقود');

  const inv = await fsGet(env, `usdt_invoices/${id}`);
  if (!inv) throw httpError(404, 'الفاتورة غير موجودة');
  if (inv.uid !== user.uid) throw httpError(403, 'غير مصرّح');

  if (inv.status === 'paid') {
    return { success: true, paid: true, already: true,
             credited: num(inv.received, num(inv.amount_usd, 0)) };
  }

  const now = Date.now();
  if (num(inv.expires_ms, 0) < now && inv.status === 'awaiting') {
    await fsPatch(env, `usdt_invoices/${id}`, { status: 'expired' });
    throw httpError(400, 'انتهت مهلة الفاتورة');
  }

  const s = await getSettings(env);
  const address = String(inv.address || s.usdt_address || '').trim();
  const want = num(inv.pay_amount, 0);

  let txs = [];
  try {
    const url = `${TRON_API}/v1/accounts/${address}/transactions/trc20?limit=60&only_to=true&contract_address=${USDT_TRC20}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    const data = await res.json();
    txs = Array.isArray(data.data) ? data.data : [];
  } catch (e) {
    console.error('TRON_FETCH_FAILED', e.message);
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

  const received = round2(Number(hit.value || 0) / 1e6);

  let credited = 0, duplicate = false;
  await fsRunTransaction(env, async (tx) => {
    const seen = await tx.get(`usdt_txids/${txid}`);
    if (seen) { duplicate = true; return; }

    const cur = await tx.get(`usdt_invoices/${id}`);
    if (!cur || cur.status === 'paid') { duplicate = true; return; }

    const u = await tx.get(`users/${user.uid}`);
    const curBalance = num(u?.wallet_balance, 0);
    credited = received;

    tx.create('usdt_txids', txid, {
      invoice_id: id, uid: user.uid, amount: received,
      from: String(hit.from || '').slice(0, 60), created_at: nowIso(),
    });
    tx.update(`usdt_invoices/${id}`, {
      status: 'paid', txid, paid_at: nowIso(), received,
    });
    tx.update(`users/${user.uid}`, { wallet_balance: round2(curBalance + credited) });
    tx.create('wallet_deposits', id, {
      uid: user.uid, amount_usd: credited, amount_lyd: 0,
      method: 'USDT — تلقائي', proof_url: '',
      note: 'TRC20 · ' + txid.slice(0, 12) + '…',
      status: 'approved', auto: true, created_at: nowIso(),
    });
    tx.create('wallet_transactions', `txn_usdt_${id}`, {
      uid: user.uid, type: 'credit', amount: credited,
      balance_before: curBalance, balance_after: round2(curBalance + credited),
      reason: 'usdt_deposit', reference: txid, created_at: nowIso(),
    });
  });

  if (duplicate) return { success: true, paid: false, duplicate: true };

  await Promise.all([
    bumpCounter(env, user.uid, { deposit: credited }),
    bumpCounter(env, '_platform', { deposit: credited }),
    logOp(env, user.uid, 'usdt_paid', { id, want }, { txid, credited }, true),
  ]);

  return { success: true, paid: true, credited, txid };
}

/* ═══════════════════════════════════════════════════════════
   SMS Webhook
   ═══════════════════════════════════════════════════════════ */

function parseTransferSms(text) {
  const s = String(text || '').replace(/[\u200e\u200f]/g, '').trim();
  if (!/تم\s*تحويل/.test(s)) return null;

  const incoming = /رصيد[كه]/.test(s) || /من\s*الرقم/.test(s);
  const outgoing = /تحويل[^\n]{0,40}\s(?:الى|الي|إلى)\s*\+?\d/.test(s) && !/من\s*الرقم/.test(s);
  if (!incoming || outgoing) return null;

  const almadar = s.match(/تم\s*تحويل\s*([\d,]+(?:[.\u066B]\d{1,3})?)\s*د\.?\s*ل/);
  if (almadar && /د\.?\s*ل/.test(s)) {
    const phone = s.match(/من\s*الرقم\s*[:\s]?\s*(\d{9,14})/);
    if (!phone) return null;
    const amount = round2(parseFloat(String(almadar[1]).replace(/,/g, '')));
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return { amount_lyd: amount, sender: normalizePhone(phone[1]), network: 'almadar' };
  }

  const libyana = s.match(/([\d,]+)[.\u066B](\d{1,3})\s*دينار/);
  const phone = s.match(/الرقم\s*[:\s]?\s*(\d{9,14})/);
  if (!libyana || !phone) return null;

  const whole = parseInt(String(libyana[1]).replace(/,/g, ''), 10);
  const frac = parseInt(libyana[2].padEnd(3, '0'), 10) / 1000;
  const amount = round2(whole + frac);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return { amount_lyd: amount, sender: normalizePhone(phone[1]), network: 'libyana' };
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

function salvageJson(raw) {
  const out = {};
  const s = String(raw || '');
  const pick = (key) => {
    const re = new RegExp(`"${key}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?:,\\s*"|\\s*\\})`);
    const m = s.match(re);
    return m ? m[1] : undefined;
  };
  for (const k of ['text', 'message', 'body', 'from', 'sim', 'sms_id', 'id']) {
    const v = pick(k);
    if (v !== undefined) out[k] = v;
  }
  const stamp = s.match(/"(?:sentStamp|receivedStamp|timestamp)"\s*:\s*"?(\d+)"?/);
  if (stamp) out.timestamp = Number(stamp[1]);
  return out;
}

async function handleSmsWebhook(request, env) {
  const url = new URL(request.url);
  const provided = request.headers.get('x-sms-secret') || url.searchParams.get('secret') || '';
  const expected = env.SMS_WEBHOOK_SECRET || '';

  if (!expected || provided !== expected) throw httpError(401, 'unauthorized');

  const ctype = (request.headers.get('content-type') || '').toLowerCase();
  let body = {};
  let rawBody = '';

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try { rawBody = await request.text(); } catch { rawBody = ''; }
  }

  if (rawBody) {
    if (ctype.includes('json') || /^\s*\{/.test(rawBody)) {
      try { body = JSON.parse(rawBody); }
      catch { body = salvageJson(rawBody); }
    } else if (ctype.includes('x-www-form-urlencoded')) {
      body = Object.fromEntries(new URLSearchParams(rawBody));
    }
  }

  const text = body.text || body.message || body.body || body.msg || body.content ||
    url.searchParams.get('text') || url.searchParams.get('message') ||
    (ctype.includes('json') ? '' : rawBody) || '';

  const receivedAt = body.receivedAt || body.timestamp || body.date ||
    url.searchParams.get('timestamp') || nowIso();
  const smsId = String(body.sms_id || body.id || url.searchParams.get('sms_id') || '').trim();

  const parsed = parseTransferSms(text);
  const s0 = await getSettings(env);
  const from = String(body.from || body.sender || url.searchParams.get('from') || '').trim();

  const allow = String(s0.sms_allowed_senders || 'Libyana,ليبيانا,المدار,Almadar')
    .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

  const fromLc = from.toLowerCase();
  const senderOk = allow.length === 0 || allow.some(a => fromLc.includes(a));

  const fingerprint = smsId
    ? await sha256Hex('id:' + smsId)
    : await sha256Hex(String(text).trim() + '|' + String(receivedAt).slice(0, 16));

  if (parsed && !senderOk) {
    await fsSet(env, `sms_transactions/${fingerprint}`, {
      raw_text: String(text).slice(0, 500),
      from: from.slice(0, 60), amount_lyd: parsed.amount_lyd,
      sender: parsed.sender, method: parsed.network,
      status: 'untrusted', needs_attention: true,
      received_at: receivedAt, created_at: nowIso(),
    });
    console.warn('UNTRUSTED_SENDER', from);
    return { success: true, parsed: true, matched: false, untrusted: true };
  }

  const existing = await fsGet(env, `sms_transactions/${fingerprint}`);
  if (existing) return { success: true, duplicate: true, status: existing.status };

  if (!parsed) {
    await fsSet(env, `sms_transactions/${fingerprint}`, {
      raw_text: String(text).slice(0, 500),
      status: 'unparsed',
      received_at: receivedAt, created_at: nowIso(),
    });
    return { success: true, parsed: false };
  }

  const rate = parsed.network === 'almadar' ? num(s0.rate_almadar, 12.5) : num(s0.rate_libyana, 11.8);
  const amountUsd = round2(parsed.amount_lyd / rate);

  const record = {
    raw_text: String(text).slice(0, 500),
    amount_lyd: parsed.amount_lyd, amount_usd: amountUsd, rate,
    sender: parsed.sender, from: from.slice(0, 60), method: parsed.network,
    received_at: receivedAt, created_at: nowIso(),
  };

  let claim = null;
  try { claim = await findPendingClaim(env, parsed.sender, parsed.amount_lyd); }
  catch (e) { console.error('CLAIM_LOOKUP_FAILED', e.message); }

  if (claim && claim.uid) {
    try {
      await fsRunTransaction(env, async (tx) => {
        const dep = await tx.get(`wallet_deposits/${claim._id}`);
        if (!dep || dep.status !== 'pending') throw new Error('DUPLICATE');
        const u = await tx.get(`users/${claim.uid}`);
        const curBalance = num(u?.wallet_balance, 0);

        tx.update(`wallet_deposits/${claim._id}`, {
          status: 'approved', auto: true,
          awaiting_sms: false, approved_at: nowIso(),
        });
        tx.update(`users/${claim.uid}`, { wallet_balance: round2(curBalance + amountUsd) });
        tx.create('sms_transactions', fingerprint, {
          ...record, status: 'claimed', uid: claim.uid,
          claimed_at: nowIso(), matched_by: 'pending_claim',
        });
        tx.create('wallet_transactions', `txn_sms_${fingerprint}`, {
          uid: claim.uid, type: 'credit', amount: amountUsd,
          balance_before: curBalance, balance_after: round2(curBalance + amountUsd),
          reason: 'sms_deposit', reference: fingerprint, created_at: nowIso(),
        });
      });

      await Promise.all([
        bumpCounter(env, claim.uid, { deposit: amountUsd }),
        bumpCounter(env, '_platform', { deposit: amountUsd }),
        logOp(env, claim.uid, 'sms_matched_claim',
          { sender: parsed.sender, amount_lyd: parsed.amount_lyd },
          { credited: amountUsd }, true),
      ]);

      return { success: true, parsed: true, matched: true, via: 'claim', credited_usd: amountUsd };
    } catch (e) {
      if (e.message === 'DUPLICATE') {
        return { success: true, parsed: true, matched: false, duplicate: true };
      }
      console.error('CLAIM_CREDIT_FAILED', e.message);
      await fsSet(env, `sms_transactions/${fingerprint}`, {
        ...record, status: 'unclaimed', needs_attention: true,
        error: String(e.message).slice(0, 200),
      }).catch(() => {});
      return { success: true, parsed: true, matched: false, deferred: true };
    }
  }

  await fsSet(env, `sms_transactions/${fingerprint}`, { ...record, status: 'unclaimed' });
  return { success: true, parsed: true, matched: false, amount_lyd: parsed.amount_lyd };
}

async function handleAdminSmsAssign(user, body, env) {
  await requireAdmin(user, env);
  const smsId = String(body.sms_id || '').trim();
  const uid = String(body.uid || '').trim();
  if (!smsId || !uid) throw httpError(400, 'بيانات ناقصة');

  const sms = await fsGet(env, `sms_transactions/${smsId}`);
  if (!sms) throw httpError(404, 'الحوالة غير موجودة');
  if (sms.status === 'claimed') throw httpError(400, 'مربوطة بالفعل');

  const amountUsd = round2(num(sms.amount_usd, 0));
  if (amountUsd <= 0) throw httpError(400, 'مبلغ غير صالح');

  await fsRunTransaction(env, async (tx) => {
    const cur = await tx.get(`sms_transactions/${smsId}`);
    if (cur.status === 'claimed') throw httpError(400, 'مربوطة بالفعل');
    const u = await tx.get(`users/${uid}`);
    const curBalance = num(u?.wallet_balance, 0);

    tx.update(`sms_transactions/${smsId}`, {
      status: 'claimed', uid, claimed_at: nowIso(), claimed_by: user.uid,
    });
    tx.update(`users/${uid}`, { wallet_balance: round2(curBalance + amountUsd) });
    tx.create('wallet_deposits', smsId, {
      uid, amount_usd: amountUsd, amount_lyd: num(sms.amount_lyd, 0),
      method: 'ليبيانا — ربط يدوي', proof_url: '',
      note: 'حوالة من ' + (sms.sender || '—'),
      status: 'approved', auto: false, created_at: nowIso(),
    });
    tx.create('wallet_transactions', `txn_sms_manual_${smsId}`, {
      uid, type: 'credit', amount: amountUsd,
      balance_before: curBalance, balance_after: round2(curBalance + amountUsd),
      reason: 'sms_manual', reference: smsId, created_at: nowIso(),
    });
  });

  await logOp(env, user.uid, 'sms_manual_assign', { smsId, uid }, { credited: amountUsd }, true);
  return { success: true, credited: amountUsd };
}

/* ═══════════════════════════════════════════════════════════
   Store
   ═══════════════════════════════════════════════════════════ */

async function handleCatalog(env) {
  const [cats, prods] = await Promise.all([
    fsQueryRaw(env, { from: [{ collectionId: 'categories' }], limit: 40 }),
    fsQueryRaw(env, { from: [{ collectionId: 'products' }], limit: 300 }),
  ]);

  const categories = cats.map(r => withId(r, 'categories'))
    .filter(c => c.active !== false)
    .sort((a, b) => num(a.sort, 99) - num(b.sort, 99))
    .map(c => ({
      id: c._id, name: c.name || '', parent: c.parent || '',
      icon: c.icon || '', image: c.image || '',
      soon: c.soon === true, sort: num(c.sort, 99),
    }));

  const now = Date.now();
  const products = prods.map(r => withId(r, 'products'))
    .filter(p => p.active !== false)
    .sort((a, b) => num(a.sort, 99) - num(b.sort, 99))
    .map(p => {
      const pr = proration(p, now);
      const inStock = p.kind === 'stock' ? num(p.stock_count, 0) > 0 : true;
      return {
        id: p._id, cat: p.cat || '', name: p.name || '',
        desc: p.desc || '', image: p.image || '',
        price: pr ? pr.price : round2(num(p.price, 0)),
        old_price: pr ? round2(num(p.price, 0)) : round2(num(p.old_price, 0)),
        featured: p.featured === true,
        kind: p.kind === 'stock' ? 'stock' : 'manual',
        fields: cleanProductFields(p.fields),
        note: p.note || '',
        stock: p.kind === 'stock' ? num(p.stock_count, 0) : null,
        countdown: pr,
        available: inStock && (!pr || pr.state === 'active'),
      };
    });

  return { success: true, categories, products };
}

function withId(row, coll) {
  const d = fromFsFields(row.document.fields || {});
  d._id = row.document.name.split(`/documents/${coll}/`)[1];
  return d;
}

function proration(p, nowMs) {
  if (p.countdown !== true) return null;
  const DAY = 86400000;
  const start = Date.parse(p.starts_at || '');
  const endRaw = Date.parse(p.ends_at || '');
  const end = Number.isFinite(endRaw) ? endRaw + DAY : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  const now = nowMs || Date.now();
  const total = Math.max(1, Math.round((end - start) / DAY));
  const full = round2(num(p.price, 0));
  const perDay = round2(full / total);

  if (now < start) {
    return { state: 'upcoming', total_days: total, days_left: total,
             per_day: perDay, price: full, starts_at: p.starts_at, ends_at: p.ends_at };
  }
  if (now >= end) {
    return { state: 'expired', total_days: total, days_left: 0,
             per_day: perDay, price: 0, starts_at: p.starts_at, ends_at: p.ends_at };
  }

  const left = Math.max(1, Math.ceil((end - now) / DAY));
  const minP = round2(num(p.min_price, 0));
  let price = Math.min(full, round2(perDay * left));
  if (minP > 0 && price < minP) price = minP;

  return { state: 'active', total_days: total, days_left: left, per_day: perDay, price,
           starts_at: p.starts_at, ends_at: p.ends_at };
}

function cleanProductFields(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 8).map(f => ({
    key: String(f && f.key || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24)
         || 'f' + Math.random().toString(36).slice(2, 7),
    label: String(f && f.label || '').slice(0, 60),
    type: ['text', 'number', 'email', 'tel'].includes(f && f.type) ? f.type : 'text',
    required: f && f.required !== false,
    hint: String(f && f.hint || '').slice(0, 80),
  })).filter(f => f.label);
}

async function handleStoreOrder(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.store_enabled === false) throw httpError(503, 'المتجر متوقف مؤقتًا');

  const items = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
  if (!items.length) throw httpError(400, 'السلة فارغة');

  const idem = String(body.idempotency_key || '').slice(0, 64);
  if (!idem) throw httpError(400, 'مفتاح العملية مفقود');

  const lock = await fsGet(env, `idempotency/${idem}`);
  if (lock) throw httpError(409, 'هذا الطلب قيد التنفيذ بالفعل');

  const lines = [];
  let totalLyd = 0;

  for (const it of items) {
    const pid = String(it && it.id || '').trim();
    const qty = Math.max(1, Math.min(20, Math.floor(num(it && it.qty, 1))));
    if (!pid) throw httpError(400, 'منتج غير صالح');

    const p = await fsGet(env, `products/${pid}`);
    if (!p || p.active === false) throw httpError(404, 'منتج غير متاح');

    const kind = p.kind === 'stock' ? 'stock' : 'manual';
    if (kind === 'stock' && num(p.stock_count, 0) < qty) throw httpError(409, `الكمية غير متوفرة`);

    const defs = cleanProductFields(p.fields);
    const vals = {};
    for (const f of defs) {
      const v = String((it.values && it.values[f.key]) || '').trim().slice(0, 120);
      if (f.required && !v) throw httpError(400, `${f.label} مطلوب`);
      if (v) vals[f.key] = v;
    }

    const pr = proration(p, Date.now());
    if (pr && pr.state !== 'active') throw httpError(409, `المنتج غير متاح`);
    const price = pr ? pr.price : round2(num(p.price, 0));
    totalLyd = round2(totalLyd + price * qty);

    lines.push({
      pid, qty, kind, values: vals,
      name: p.name || '', image: p.image || '',
      price_lyd: price, line_lyd: round2(price * qty),
      days_left: pr ? pr.days_left : null, ends_at: pr ? pr.ends_at : '',
    });
  }

  let coupon = null, discountLyd = 0;
  if (body.coupon) {
    coupon = await checkCoupon(env, body.coupon, user.uid, totalLyd);
    if (coupon) {
      discountLyd = coupon.off_lyd;
      totalLyd = round2(totalLyd - discountLyd);
    }
  }

  const rateVal = num(s.usd_to_lyd, 11.8);
  const totalUsd = round2(totalLyd / rateVal);

  const orderId = `ORD${Date.now()}${randomSuffix(4)}`;
  const allStock = lines.every(l => l.kind === 'stock');

  await fsRunTransaction(env, async (tx) => {
    const idemDoc = await tx.get(`idempotency/${idem}`);
    if (idemDoc) throw httpError(409, 'هذا الطلب قيد التنفيذ بالفعل');

    const me = await tx.get(`users/${user.uid}`);
    if (!me) throw httpError(400, 'الحساب غير مكتمل');
    if (me.banned === true) throw httpError(403, 'الحساب موقوف');

    const balance = num(me.wallet_balance, 0);
    if (balance < totalUsd) throw httpError(402, `رصيدك غير كافٍ`);

    const newBalance = round2(balance - totalUsd);
    tx.update(`users/${user.uid}`, {
      wallet_balance: newBalance,
      total_spent: round2(num(me.total_spent, 0) + totalUsd),
    });

    tx.create('orders', orderId, {
      uid: user.uid, items: lines,
      coupon: coupon ? coupon.code : '',
      discount_lyd: discountLyd, total_lyd: totalLyd, total_usd: totalUsd, rate: rateVal,
      status: allStock ? 'completed' : 'pending',
      idempotency_key: idem,
      created_at: nowIso(), updated_at: nowIso(),
    });

    tx.create('idempotency', idem, { uid: user.uid, order_id: orderId, created_at: nowIso() });

    tx.create('wallet_transactions', `txn_order_${orderId}`, {
      uid: user.uid, type: 'debit', amount: totalUsd,
      balance_before: balance, balance_after: newBalance,
      reason: 'store_order', reference: orderId, created_at: nowIso(),
    });

    if (allStock) {
      for (const l of lines) {
        if (l.kind !== 'stock') continue;
        tx.increment(`products/${l.pid}`, 'stock_count', -l.qty);
      }
    }
  });

  if (allStock) {
    try {
      for (const l of lines) {
        if (l.kind !== 'stock') continue;
        const codes = await takeStock(env, l.pid, l.qty);
        l.codes = codes;
      }
      await fsPatch(env, `orders/${orderId}`, { items: lines });
    } catch (e) {
      console.error('STOCK_TAKE_FAILED', e.message);
      await fsIncrement(env, `users/${user.uid}`, { wallet_balance: totalUsd });
      throw httpError(503, 'نفد المخزون — أُعيد رصيدك');
    }
  }

  await Promise.all([
    maybePayReferral(env, s, user.uid, totalUsd),
    awardPoints(env, s, user.uid, totalLyd),
    coupon ? consumeCoupon(env, coupon.code, user.uid) : Promise.resolve(),
    logOp(env, user.uid, 'store_order',
      { items: lines.length, totalLyd },
      { orderId, status: allStock ? 'completed' : 'pending' }, true),
  ]).catch(e => console.error('POST_ORDER_FAILED', e.message));

  return {
    success: true,
    order: {
      id: orderId,
      status: allStock ? 'completed' : 'pending',
      total_lyd: totalLyd, total_usd: totalUsd,
      items: lines.map(l => ({ name: l.name, qty: l.qty, codes: l.codes || null })),
    },
  };
}

async function takeStock(env, pid, qty) {
  const rows = await fsQueryRaw(env, {
    from: [{ collectionId: 'stock' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: 'pid' }, op: 'EQUAL', value: { stringValue: pid } } },
          { fieldFilter: { field: { fieldPath: 'used' }, op: 'EQUAL', value: { booleanValue: false } } },
        ],
      },
    },
    limit: qty,
  });

  const codes = [];
  for (const r of rows.slice(0, qty)) {
    const d = withId(r, 'stock');
    await fsPatch(env, `stock/${d._id}`, { used: true, used_at: nowIso() });
    codes.push(String(d.code || ''));
  }
  return codes;
}

async function handleAdminOrder(user, body, env) {
  await requireAdmin(user, env);
  const id = String(body.order_id || '').trim();
  const action = body.action === 'reject' ? 'reject' : 'complete';
  if (!id) throw httpError(400, 'رقم الطلب مفقود');

  if (action === 'reject') {
    await fsRunTransaction(env, async (tx) => {
      const o = await tx.get(`orders/${id}`);
      if (!o) throw httpError(404, 'الطلب غير موجود');
      if (o.status !== 'pending' && o.status !== 'processing') throw httpError(400, 'الطلب مُغلق');

      const back = round2(num(o.total_usd, 0));
      const u = await tx.get(`users/${o.uid}`);
      const curBalance = num(u?.wallet_balance, 0);

      tx.update(`orders/${id}`, {
        status: 'rejected',
        reject_reason: String(body.reason || '').slice(0, 160),
        updated_at: nowIso(),
      });
      tx.update(`users/${o.uid}`, {
        wallet_balance: round2(curBalance + back),
        total_spent: round2(num(u?.total_spent, 0) - back),
      });
      tx.create('wallet_transactions', `txn_order_refund_${id}`, {
        uid: o.uid, type: 'credit', amount: back,
        balance_before: curBalance, balance_after: round2(curBalance + back),
        reason: 'order_rejected', reference: id, created_at: nowIso(),
      });
    });
    await logOp(env, user.uid, 'order_rejected', { id }, { refunded: true }, true);
    return { success: true, refunded: true };
  }

  await fsPatch(env, `orders/${id}`, {
    status: 'completed',
    delivery: String(body.delivery || '').slice(0, 900),
    updated_at: nowIso(),
  });
  await logOp(env, user.uid, 'order_completed', { id }, {}, true);
  return { success: true };
}

/* ═══════════════════════════════════════════════════════════
   Withdraw / Transfer
   ═══════════════════════════════════════════════════════════ */

async function handleWithdrawRequest(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.withdraw_enabled !== true) throw httpError(503, 'السحب غير متاح حاليًا');

  const amount = round2(num(body.amount_usd, NaN));
  const method = String(body.method || '').slice(0, 40);
  const dest = String(body.destination || '').trim().slice(0, 120);

  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'أدخل المبلغ');
  if (!method) throw httpError(400, 'اختر طريقة السحب');
  if (!dest) throw httpError(400, 'أدخل وجهة السحب');

  const mn = num(s.withdraw_min, 10), mx = num(s.withdraw_max, 500);
  if (amount < mn) throw httpError(400, `الحد الأدنى ${mn}$`);
  if (amount > mx) throw httpError(400, `الحد الأقصى ${mx}$`);

  const feePct = num(s.withdraw_fee_pct, 0), feeFix = num(s.withdraw_fee_fixed, 0);
  const fee = round2(feeFix + amount * feePct / 100);
  const net = round2(amount - fee);
  if (net <= 0) throw httpError(400, 'المبلغ لا يغطي الرسوم');

  const id = `WD${Date.now()}${randomSuffix(4)}`;

  await fsRunTransaction(env, async (tx) => {
    const me = await tx.get(`users/${user.uid}`);
    if (!me) throw httpError(400, 'الحساب غير مكتمل');
    if (me.banned === true) throw httpError(403, 'الحساب موقوف');

    const curBalance = num(me.wallet_balance, 0);
    if (curBalance < amount) throw httpError(402, 'رصيدك غير كافٍ');

    tx.update(`users/${user.uid}`, { wallet_balance: round2(curBalance - amount) });
    tx.create('withdrawals', id, {
      uid: user.uid, amount_usd: amount, fee, net,
      method, destination: dest, status: 'pending',
      created_at: nowIso(), updated_at: nowIso(),
    });
    tx.create('wallet_transactions', `txn_wd_${id}`, {
      uid: user.uid, type: 'debit', amount,
      balance_before: curBalance, balance_after: round2(curBalance - amount),
      reason: 'withdraw_request', reference: id, created_at: nowIso(),
    });
  });

  await logOp(env, user.uid, 'withdraw_request', { amount, method }, { id }, true);
  return { success: true, id, fee, net };
}

async function handleAdminWithdraw(user, body, env) {
  await requireAdmin(user, env);
  const id = String(body.id || '').trim();
  const action = body.action === 'reject' ? 'reject' : 'complete';
  if (!id) throw httpError(400, 'رقم الطلب مفقود');

  if (action === 'reject') {
    await fsRunTransaction(env, async (tx) => {
      const w = await tx.get(`withdrawals/${id}`);
      if (!w) throw httpError(404, 'الطلب غير موجود');
      if (w.status !== 'pending') throw httpError(400, 'الطلب مُغلق');

      const back = round2(num(w.amount_usd, 0));
      const u = await tx.get(`users/${w.uid}`);
      const curBalance = num(u?.wallet_balance, 0);

      tx.update(`withdrawals/${id}`, {
        status: 'rejected',
        reject_reason: String(body.reason || '').slice(0, 160),
        updated_at: nowIso(),
      });
      tx.update(`users/${w.uid}`, { wallet_balance: round2(curBalance + back) });
      tx.create('wallet_transactions', `txn_wd_refund_${id}`, {
        uid: w.uid, type: 'credit', amount: back,
        balance_before: curBalance, balance_after: round2(curBalance + back),
        reason: 'withdraw_rejected', reference: id, created_at: nowIso(),
      });
    });
    await logOp(env, user.uid, 'withdraw_rejected', { id }, { refunded: true }, true);
    return { success: true, refunded: true };
  }

  const w = await fsGet(env, `withdrawals/${id}`);
  if (!w) throw httpError(404, 'الطلب غير موجود');
  if (w.status !== 'pending') throw httpError(400, 'الطلب مُغلق');

  await fsPatch(env, `withdrawals/${id}`, {
    status: 'completed',
    note: String(body.note || '').slice(0, 200),
    updated_at: nowIso(),
  });
  await logOp(env, user.uid, 'withdraw_completed', { id }, {}, true);
  return { success: true };
}

async function handleTransfer(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.transfer_enabled !== true) throw httpError(503, 'التحويل غير متاح');

  const amount = round2(num(body.amount_usd, NaN));
  const to = String(body.to || '').trim().toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'أدخل المبلغ');
  if (!to) throw httpError(400, 'أدخل بيانات المستلم');

  const mn = num(s.transfer_min, 1);
  if (amount < mn) throw httpError(400, `الحد الأدنى ${mn}$`);

  const feePct = num(s.transfer_fee_pct, 0);
  const fee = round2(amount * feePct / 100);
  const total = round2(amount + fee);

  let target = null;
  if (to.includes('@')) {
    const rows = await fsQueryRaw(env, {
      from: [{ collectionId: 'users' }],
      where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: to } } },
      limit: 2,
    });
    if (rows.length === 1) target = rows[0];
  } else {
    const key = normalizePhone(to);
    const rows = await fsQueryRaw(env, {
      from: [{ collectionId: 'users' }],
      where: { fieldFilter: { field: { fieldPath: 'phone_key' }, op: 'EQUAL', value: { stringValue: key } } },
      limit: 2,
    });
    if (rows.length === 1) target = rows[0];
  }
  if (!target) throw httpError(404, 'لم نجد مستخدمًا بهذه البيانات');

  const toUid = target.document.name.split('/documents/users/')[1];
  if (toUid === user.uid) throw httpError(400, 'لا يمكنك التحويل لنفسك');

  const id = `TR${Date.now()}${randomSuffix(4)}`;

  await fsRunTransaction(env, async (tx) => {
    const me = await tx.get(`users/${user.uid}`);
    const you = await tx.get(`users/${toUid}`);
    if (!me) throw httpError(400, 'الحساب غير مكتمل');
    if (me.banned === true) throw httpError(403, 'الحساب موقوف');

    const curBalance = num(me.wallet_balance, 0);
    if (curBalance < total) throw httpError(402, 'رصيدك غير كافٍ');

    const yourBalance = num(you?.wallet_balance, 0);

    tx.update(`users/${user.uid}`, { wallet_balance: round2(curBalance - total) });
    tx.update(`users/${toUid}`, { wallet_balance: round2(yourBalance + amount) });
    tx.create('transfers', id, {
      from_uid: user.uid, to_uid: toUid,
      amount_usd: amount, fee, status: 'completed', created_at: nowIso(),
    });
    tx.create('wallet_transactions', `txn_tr_out_${id}`, {
      uid: user.uid, type: 'debit', amount: total,
      balance_before: curBalance, balance_after: round2(curBalance - total),
      reason: 'transfer_out', reference: id, created_at: nowIso(),
    });
    tx.create('wallet_transactions', `txn_tr_in_${id}`, {
      uid: toUid, type: 'credit', amount,
      balance_before: yourBalance, balance_after: round2(yourBalance + amount),
      reason: 'transfer_in', reference: id, created_at: nowIso(),
    });
  });

  await logOp(env, user.uid, 'transfer', { to: toUid, amount }, { id }, true);
  return { success: true, id, amount, fee };
}

/* ═══════════════════════════════════════════════════════════
   Tickets
   ═══════════════════════════════════════════════════════════ */

async function handleTicketCreate(user, body, env) {
  const subject = String(body.subject || '').trim().slice(0, 120);
  const msg = String(body.message || '').trim().slice(0, 1500);
  if (!subject) throw httpError(400, 'اكتب موضوع التذكرة');
  if (!msg) throw httpError(400, 'اكتب رسالتك');

  const id = `TIC${Date.now()}${randomSuffix(3)}`;
  await fsSet(env, `tickets/${id}`, {
    uid: user.uid, subject,
    order_id: String(body.order_id || '').slice(0, 40),
    status: 'open',
    messages: [{ by: 'user', text: msg, at: nowIso() }],
    created_at: nowIso(), updated_at: nowIso(),
  });
  return { success: true, id };
}

async function handleTicketReply(user, body, env) {
  const id = String(body.id || '').trim();
  const msg = String(body.message || '').trim().slice(0, 1500);
  if (!id || !msg) throw httpError(400, 'بيانات ناقصة');

  const t = await fsGet(env, `tickets/${id}`);
  if (!t) throw httpError(404, 'التذكرة غير موجودة');

  const isAdmin = await isAdminUid(env, user.uid);
  if (!isAdmin && t.uid !== user.uid) throw httpError(403, 'غير مصرّح');
  if (t.status === 'closed' && !isAdmin) throw httpError(400, 'التذكرة مغلقة');

  const msgs = Array.isArray(t.messages) ? t.messages : [];
  msgs.push({ by: isAdmin ? 'admin' : 'user', text: msg, at: nowIso() });

  await fsPatch(env, `tickets/${id}`, {
    messages: msgs.slice(-40),
    status: isAdmin ? 'answered' : 'open',
    updated_at: nowIso(),
  });
  return { success: true };
}

async function handleTicketClose(user, body, env) {
  await requireAdmin(user, env);
  const id = String(body.id || '').trim();
  if (!id) throw httpError(400, 'رقم التذكرة مفقود');
  await fsPatch(env, `tickets/${id}`, { status: 'closed', updated_at: nowIso() });
  return { success: true };
}

async function isAdminUid(env, uid) {
  try { return !!(await fsGet(env, `admins/${uid}`)); } catch { return false; }
}

/* ═══════════════════════════════════════════════════════════
   Coupons & Points
   ═══════════════════════════════════════════════════════════ */

async function checkCoupon(env, code, uid, subtotalLyd) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;

  const cp = await fsGet(env, `coupons/${c}`);
  if (!cp || cp.active === false) throw httpError(404, 'كوبون غير صالح');

  if (cp.expires_at && new Date(cp.expires_at) < new Date()) throw httpError(400, 'انتهت صلاحية الكوبون');
  const maxUses = num(cp.max_uses, 0);
  if (maxUses > 0 && num(cp.used_count, 0) >= maxUses) throw httpError(400, 'استُنفد هذا الكوبون');
  const minOrder = num(cp.min_order_lyd, 0);
  if (minOrder > 0 && subtotalLyd < minOrder) throw httpError(400, `الكوبون يتطلب طلبًا بـ${minOrder} د.ل`);

  const used = await fsGet(env, `coupon_uses/${c}_${uid}`);
  if (used && cp.once_per_user !== false) throw httpError(400, 'استخدمت هذا الكوبون من قبل');

  const pct = num(cp.percent, 0);
  const fixed = num(cp.amount_lyd, 0);
  let off = pct > 0 ? subtotalLyd * pct / 100 : fixed;
  const cap = num(cp.max_off_lyd, 0);
  if (cap > 0 && off > cap) off = cap;
  off = round2(Math.min(off, subtotalLyd));

  return { code: c, off_lyd: off, percent: pct, fixed };
}

async function handleCouponCheck(user, body, env) {
  const sub = round2(num(body.subtotal_lyd, 0));
  if (sub <= 0) throw httpError(400, 'السلة فارغة');
  const r = await checkCoupon(env, body.code, user.uid, sub);
  return { success: true, coupon: r };
}

async function consumeCoupon(env, code, uid) {
  try {
    await Promise.all([
      fsIncrement(env, `coupons/${code}`, { used_count: 1 }),
      fsSet(env, `coupon_uses/${code}_${uid}`, { uid, code, at: nowIso() }),
    ]);
  } catch (e) { console.error('COUPON_CONSUME_FAILED', e.message); }
}

async function awardPoints(env, s, uid, spentLyd) {
  if (s.points_enabled !== true) return;
  const per = num(s.points_per_lyd, 1);
  const pts = Math.floor(spentLyd * per);
  if (pts <= 0) return;
  try { await fsIncrement(env, `users/${uid}`, { points: pts }); }
  catch (e) { console.error('POINTS_FAILED', e.message); }
}

async function handleRedeemPoints(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.points_enabled !== true) throw httpError(503, 'نظام النقاط غير مفعّل');

  const pts = Math.floor(num(body.points, 0));
  const minP = num(s.points_min_redeem, 100);
  if (pts < minP) throw httpError(400, `الحد الأدنى ${minP} نقطة`);

  const rateP = num(s.points_value_lyd, 0.01);
  const lydVal = round2(pts * rateP);
  const usdVal = round2(lydVal / num(s.usd_to_lyd, 11.8));
  if (usdVal <= 0) throw httpError(400, 'قيمة غير صالحة');

  const id = `PTS${Date.now()}${randomSuffix(3)}`;

  await fsRunTransaction(env, async (tx) => {
    const me = await tx.get(`users/${user.uid}`);
    if (!me || num(me.points, 0) < pts) throw httpError(400, 'نقاطك غير كافية');

    const curBalance = num(me.wallet_balance, 0);
    tx.update(`users/${user.uid}`, {
      points: num(me.points, 0) - pts,
      wallet_balance: round2(curBalance + usdVal),
    });
    tx.create('wallet_deposits', id, {
      uid: user.uid, amount_usd: usdVal, amount_lyd: lydVal,
      method: 'استبدال نقاط', proof_url: '', note: pts + ' نقطة',
      status: 'approved', auto: true, created_at: nowIso(),
    });
  });

  await logOp(env, user.uid, 'redeem_points', { pts }, { usdVal }, true);
  return { success: true, credited: usdVal };
}

/* ═══════════════════════════════════════════════════════════
   Referrals
   ═══════════════════════════════════════════════════════════ */

function makeRefCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, x => A[x % A.length]).join('');
}

async function handleRefCode(user, body, env) {
  const s = await getSettings(env);
  if (s.referral_enabled !== true) throw httpError(503, 'نظام الدعوات غير مفعّل');

  const me = await fsGet(env, `users/${user.uid}`);
  if (me && me.ref_code) return { success: true, code: me.ref_code, bonus: num(s.referral_bonus_invitee, 1) };

  let code = null;
  for (let i = 0; i < 12; i++) {
    const c = makeRefCode();
    const taken = await fsGet(env, `ref_codes/${c}`);
    if (!taken) { code = c; break; }
  }
  if (!code) throw httpError(503, 'تعذّر توليد الرمز');

  await Promise.all([
    fsSet(env, `ref_codes/${code}`, { uid: user.uid, created_at: nowIso() }),
    fsPatch(env, `users/${user.uid}`, { ref_code: code }),
  ]);

  return { success: true, code, bonus: num(s.referral_bonus_invitee, 1) };
}

async function handleRefClaim(user, body, env) {
  const s = await getSettings(env);
  if (s.referral_enabled !== true) throw httpError(503, 'نظام الدعوات غير مفعّل');

  const code = String(body.code || '').trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) throw httpError(400, 'رمز غير صحيح');

  const me = await fsGet(env, `users/${user.uid}`);
  if (!me) throw httpError(400, 'الحساب غير مكتمل');
  if (me.referred_by) throw httpError(400, 'استخدمت رمز دعوة من قبل');
  if (me.ref_code === code) throw httpError(400, 'لا يمكنك استخدام رمزك');

  const owner = await fsGet(env, `ref_codes/${code}`);
  if (!owner || !owner.uid) throw httpError(404, 'الرمز غير موجود');
  if (owner.uid === user.uid) throw httpError(400, 'لا يمكنك استخدام رمزك');

  await fsPatch(env, `users/${user.uid}`, {
    referred_by: owner.uid, referred_code: code, referral_paid: false,
  });

  return { success: true, bonus: num(s.referral_bonus_invitee, 1), min_spend: num(s.referral_min_spend, 10) };
}

async function maybePayReferral(env, s, uid, spent) {
  if (s.referral_enabled !== true) return;
  try {
    const me = await fsGet(env, `users/${uid}`);
    if (!me || !me.referred_by || me.referral_paid === true) return;

    const need = num(s.referral_min_spend, 10);
    const total = num(me.total_spent, 0) + num(spent, 0);
    if (total < need) return;

    const forInvitee = round2(num(s.referral_bonus_invitee, 1));
    const forInviter = round2(num(s.referral_bonus_inviter, 1));

    await Promise.all([
      fsPatch(env, `users/${uid}`, { referral_paid: true }),
      forInvitee > 0 ? fsIncrement(env, `users/${uid}`, { wallet_balance: forInvitee }) : Promise.resolve(),
      forInviter > 0 ? fsIncrement(env, `users/${me.referred_by}`, { wallet_balance: forInviter, referrals_count: 1 }) : Promise.resolve(),
      fsSet(env, `wallet_deposits/REF${Date.now()}${randomSuffix(3)}`, {
        uid, amount_usd: forInvitee, amount_lyd: 0,
        method: 'مكافأة دعوة', proof_url: '', note: 'رمز ' + (me.referred_code || ''),
        status: 'approved', auto: true, created_at: nowIso(),
      }),
      logOp(env, uid, 'referral_paid', { inviter: me.referred_by }, { forInvitee, forInviter }, true),
    ]);
  } catch (e) { console.error('REFERRAL_FAILED', e.message); }
}

/* ═══════════════════════════════════════════════════════════
   Admin Settings / Deposits / Adjust
   ═══════════════════════════════════════════════════════════ */

async function handleAdminSettings(user, body, env) {
  await requireAdmin(user, env);

  const allowedOps = [
    'issuing_enabled', 'funding_enabled', 'provider_float', 'low_balance_threshold', 'maintenance_message', 'deposit_phone',
    'm_libyana_on', 'm_libyana_label', 'm_almadar_on', 'm_almadar_label', 'm_bank_on', 'm_bank_label',
    'm_usdt_on', 'm_usdt_label', 'm_binance_on', 'm_binance_label',
    'm_libyana_phone', 'm_almadar_phone', 'method_order', 'sms_allowed_senders',
    'banners', 'banner_rotate_sec', 'custom_methods',
    'kill_switch', 'kill_message',
    'daily_cards_max', 'daily_amount_max', 'daily_deposit_max', 'platform_daily_max', 'limits_enabled',
    'referral_enabled', 'referral_bonus_inviter', 'referral_bonus_invitee', 'referral_min_spend', 'activity_log_enabled',
    'usdt_address', 'usdt_min', 'usdt_max', 'usdt_window_min',
    'm_libyana_logo', 'm_almadar_logo', 'm_bank_logo', 'm_usdt_logo', 'm_binance_logo',
    'm_bank_fields', 'm_usdt_fields', 'm_binance_fields', 'deposit_note',
    'theme_navy', 'theme_emerald', 'theme_bg', 'theme_radius',
    'nav_home', 'nav_mcards', 'nav_wallet', 'nav_tx', 'nav_help', 'nav_settings',
    'brand_tagline', 'hero_title', 'hero_sub', 'support_url',
    'withdraw_enabled', 'withdraw_min', 'withdraw_max', 'withdraw_fee_pct', 'withdraw_fee_fixed', 'withdraw_methods',
    'transfer_enabled', 'transfer_min', 'transfer_fee_pct',
    'tickets_enabled', 'coupons_enabled',
    'points_enabled', 'points_per_lyd', 'points_value_lyd', 'points_min_redeem',
    'subscriptions_visible', 'manual_cards_enabled',
    'mc_create_min', 'mc_create_max', 'mc_create_fee_fixed', 'mc_create_fee_pct',
    'mc_topup_min', 'mc_topup_max', 'mc_topup_fee_fixed', 'mc_topup_fee_pct',
    'mc_tx_fee', 'mc_reveal_hours',
    'rate_libyana', 'rate_almadar', 'rate_bank', 'rate_usdt', 'usd_to_lyd', 'max_deposit_lyd',
  ];

  const ops = {};
  for (const k of allowedOps) if (k in body) ops[k] = body[k];
  if (!Object.keys(ops).length) throw httpError(400, 'لا يوجد شيء للتحديث');

  await fsPatch(env, 'settings/main', ops);
  await logOp(env, user.uid, 'admin_settings', { ops }, { ok: true }, true);
  return { success: true, updated: ops };
}

async function handleAdminDeposit(user, body, env) {
  await requireAdmin(user, env);

  const depositId = String(body.deposit_id || '').trim();
  const action = body.action === 'reject' ? 'reject' : 'approve';
  if (!depositId) throw httpError(400, 'معرّف الإيداع مفقود');

  if (action === 'reject') {
    const why = String(body.reason || '').slice(0, 200);
    await fsPatch(env, `wallet_deposits/${depositId}`, {
      status: 'rejected', reject_reason: why,
      reviewed_by: user.uid, reviewed_at: nowIso(),
    });
    return { success: true, status: 'rejected' };
  }

  await fsRunTransaction(env, async (tx) => {
    const dep = await tx.get(`wallet_deposits/${depositId}`);
    if (!dep) throw httpError(404, 'الإيداع غير موجود');
    if (dep.status !== 'pending') throw httpError(400, 'تمت معالجة هذا الإيداع مسبقًا');

    const amountUsd = round2(num(dep.amount_usd, 0));
    if (amountUsd <= 0) throw httpError(400, 'مبلغ غير صحيح');

    const u = await tx.get(`users/${dep.uid}`);
    const curBalance = num(u?.wallet_balance, 0);

    tx.update(`wallet_deposits/${depositId}`, {
      status: 'approved', reviewed_by: user.uid, reviewed_at: nowIso(),
    });
    tx.update(`users/${dep.uid}`, { wallet_balance: round2(curBalance + amountUsd) });
    tx.create('wallet_transactions', `txn_dep_manual_${depositId}`, {
      uid: dep.uid, type: 'credit', amount: amountUsd,
      balance_before: curBalance, balance_after: round2(curBalance + amountUsd),
      reason: 'deposit_approved', reference: depositId, created_at: nowIso(),
    });
  });

  await logOp(env, user.uid, 'approve_deposit', { depositId }, { ok: true }, true);
  return { success: true, status: 'approved' };
}

async function handleAdminWalletAdjust(user, body, env) {
  await requireAdmin(user, env);
  const uid = String(body.uid || '').trim();
  const delta = num(body.delta, NaN);
  const reason = String(body.reason || '').trim();

  if (!uid) throw httpError(400, 'معرّف المستخدم مفقود');
  if (!Number.isFinite(delta) || delta === 0) throw httpError(400, 'المبلغ غير صحيح');
  if (reason.length < 3) throw httpError(400, 'السبب مطلوب');

  const id = `ADJ${Date.now()}${randomSuffix(4)}`;

  await fsRunTransaction(env, async (tx) => {
    const u = await tx.get(`users/${uid}`);
    if (!u) throw httpError(404, 'المستخدم غير موجود');

    const curBalance = num(u.wallet_balance, 0);
    const newBalance = round2(curBalance + delta);
    if (newBalance < 0) throw httpError(400, 'الرصيد لا يمكن أن يصبح سالباً');

    tx.update(`users/${uid}`, { wallet_balance: newBalance });
    tx.create('wallet_transactions', id, {
      uid, type: delta > 0 ? 'credit' : 'debit',
      amount: Math.abs(delta),
      balance_before: curBalance, balance_after: newBalance,
      reason: 'admin_adjust: ' + reason, reference: id,
      admin_uid: user.uid, created_at: nowIso(),
    });
  });

  await logOp(env, user.uid, 'wallet_adjust', { uid, delta, reason }, { ok: true }, true);
  return { success: true, delta };
}

/* ═══════════════════════════════════════════════════════════
   Limits
   ═══════════════════════════════════════════════════════════ */

function assertLive(s) {
  if (s.kill_switch === true) throw httpError(503, s.kill_message || 'الخدمة متوقفة مؤقتًا للصيانة.');
}

function todayKey() {
  const d = new Date(Date.now() + 2 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

async function readCounter(env, uid) {
  const d = await fsGet(env, `daily_counters/${uid}_${todayKey()}`);
  return { cards: num(d && d.cards, 0), amount: num(d && d.amount, 0), deposit: num(d && d.deposit, 0) };
}

async function bumpCounter(env, uid, deltas) {
  const id = `${uid}_${todayKey()}`;
  try {
    const cur = await fsGet(env, `daily_counters/${id}`);
    if (!cur) {
      await fsSet(env, `daily_counters/${id}`, {
        uid, day: todayKey(),
        cards: num(deltas.cards, 0),
        amount: round2(num(deltas.amount, 0)),
        deposit: round2(num(deltas.deposit, 0)),
        created_at: nowIso(),
      });
    } else {
      await fsIncrement(env, `daily_counters/${id}`, deltas);
    }
  } catch (e) { console.error('COUNTER_FAILED', id, e.message); }
}

async function assertDailyLimit(env, s, uid, kind, amount) {
  if (s.limits_enabled === false) return;
  const me = await readCounter(env, uid);

  if (kind === 'card') {
    const maxCards = num(s.daily_cards_max, 3);
    const maxAmt = num(s.daily_amount_max, 200);
    if (maxCards > 0 && me.cards >= maxCards) throw httpError(429, `بلغت حدّك اليومي (${maxCards} بطاقات). حاول غدًا.`);
    if (maxAmt > 0 && me.amount + amount > maxAmt) throw httpError(429, `بلغت حدّك اليومي ($${maxAmt}). حاول غدًا.`);
  }

  if (kind === 'deposit') {
    const maxDep = num(s.daily_deposit_max, 500);
    if (maxDep > 0 && me.deposit + amount > maxDep) throw httpError(429, `بلغت حدّ الإيداع اليومي ($${maxDep}).`);
    const platMax = num(s.platform_daily_max, 0);
    if (platMax > 0) {
      const plat = await readCounter(env, '_platform');
      if (plat.deposit + amount > platMax) throw httpError(503, 'بلغت المنصة سقفها اليومي. حاول غدًا.');
    }
  }
}

async function logActivity(env, s, uid, request, action) {
  if (s.activity_log_enabled === false) return;
  const cf = request.cf || {};
  try {
    await fsSet(env, `activity/${uid}_${Date.now()}`, {
      uid, action,
      ip: (request.headers.get('cf-connecting-ip') || '').slice(0, 45),
      country: String(cf.country || '').slice(0, 4),
      city: String(cf.city || '').slice(0, 60),
      ua: (request.headers.get('user-agent') || '').slice(0, 160),
      created_at: nowIso(),
    });
  } catch { }
}

async function handleActivityPing(user, body, env, request) {
  const s = await getSettings(env);
  await logActivity(env, s, user.uid, request, 'login');
  return { success: true };
}

/* ═══════════════════════════════════════════════════════════
   Settings
   ═══════════════════════════════════════════════════════════ */

async function getSettings(env) {
  const ops = await fsGet(env, 'settings/main');
  return {
    usd_to_lyd: 11.8, rate_libyana: 11.8, rate_almadar: 12.5, rate_bank: 9.5, rate_usdt: 1.0,
    max_deposit_lyd: 5000, issuing_enabled: false, funding_enabled: false,
    provider_float: 0, low_balance_threshold: 30, maintenance_message: '', deposit_phone: '',
    m_libyana_on: true, m_libyana_label: 'ليبيانا', m_almadar_on: true, m_almadar_label: 'المدار',
    m_bank_on: false, m_bank_label: 'تحويل مصرفي', m_usdt_on: false, m_usdt_label: 'USDT',
    m_binance_on: false, m_binance_label: 'Binance Pay',
    m_libyana_phone: '', m_almadar_phone: '',
    sms_allowed_senders: 'Libyana,ليبيانا,المدار,Almadar',
    banners: [], banner_rotate_sec: 6, custom_methods: [],
    method_order: 'libyana,almadar,usdt,bank,binance', deposit_note: '',
    store_enabled: true, subscriptions_visible: true, manual_cards_enabled: true,
    mc_create_min: 10, mc_create_max: 500, mc_create_fee_fixed: 8, mc_create_fee_pct: 2.5,
    mc_topup_min: 10, mc_topup_max: 500, mc_topup_fee_fixed: 8, mc_topup_fee_pct: 2.5,
    mc_tx_fee: 0, mc_reveal_hours: 24,
    withdraw_enabled: false, withdraw_min: 10, withdraw_max: 500, withdraw_fee_pct: 0, withdraw_fee_fixed: 0,
    withdraw_methods: 'ليبيانا,المدار,تحويل مصرفي,USDT',
    transfer_enabled: false, transfer_min: 1, transfer_fee_pct: 0,
    tickets_enabled: true, points_enabled: false, points_per_lyd: 1,
    points_value_lyd: 0.01, points_min_redeem: 100, coupons_enabled: true,
    kill_switch: false, kill_message: 'الخدمة متوقفة مؤقتًا للصيانة.',
    daily_cards_max: 3, daily_amount_max: 200, daily_deposit_max: 500, platform_daily_max: 2000,
    limits_enabled: true, referral_enabled: false, referral_bonus_inviter: 1,
    referral_bonus_invitee: 1, referral_min_spend: 10, activity_log_enabled: true,
    usdt_address: '', usdt_min: 5, usdt_max: 1000, usdt_window_min: 30,
    m_libyana_logo: '', m_almadar_logo: '', m_bank_logo: '', m_usdt_logo: '', m_binance_logo: '',
    m_bank_fields: [], m_usdt_fields: [], m_binance_fields: [],
    theme_navy: '#0F172A', theme_emerald: '#10B981', theme_bg: '#F8FAFC', theme_radius: 14,
    nav_home: true, nav_mcards: true, nav_wallet: true, nav_tx: true, nav_help: true, nav_settings: true,
    brand_tagline: 'بطاقات أكثر .. فرص أكبر',
    hero_title: 'بطاقة تعمل في كل مكان يقبل الدفع الإلكتروني',
    hero_sub: 'بالدولار · بدون رسوم شهرية · تُصدر خلال دقائق',
    support_url: '',
    ...(ops || {}),
  };
}

function cleanBanners(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(b => b && String(b.img || '').trim()).slice(0, 8).map(b => ({
    img: String(b.img).slice(0, 900000),
    link: String(b.link || '').slice(0, 300),
    title: String(b.title || '').slice(0, 80),
  }));
}

function cleanFields(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(f => f && String(f.value || '').trim()).slice(0, 8).map(f => ({
    label: String(f.label || '').slice(0, 40),
    value: String(f.value || '').slice(0, 120),
    copy: f.copy === true,
  }));
}

function cleanCustomMethods(arr) {
  if (!Array.isArray(arr)) return {};
  const out = {};
  arr.slice(0, 10).forEach((m, i) => {
    if (!m || !m.label) return;
    const key = String(m.key || `custom${i}`).replace(/[^a-z0-9_]/gi, '').slice(0, 20) || `custom${i}`;
    out[key] = {
      on: m.on !== false, custom: true,
      logo: String(m.logo || '').slice(0, 400000),
      label: String(m.label).slice(0, 40),
      rate: num(m.rate, 1), auto: false,
      fields: cleanFields(m.fields),
    };
  });
  return out;
}

/* ═══════════════════════════════════════════════════════════
   Firestore REST
   ═══════════════════════════════════════════════════════════ */

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
  if (!data.access_token) {
    console.error('TOKEN_FAILED', JSON.stringify(data));
    throw httpError(500, 'خطأ في إعداد السيرفر');
  }

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
  if (!res.ok) {
    console.error('FS_ERROR', res.status, JSON.stringify(data));
    throw httpError(500, 'خطأ في قاعدة البيانات');
  }
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
  return fsCommit(env, [
    { transform: { document: docPath(env, path), fieldTransforms: transforms } },
  ]);
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
  return fsFetch(env, ':commit', {
    method: 'POST',
    body: JSON.stringify({ writes }),
  });
}

async function fsQueryRaw(env, structuredQuery) {
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

/* ✅ Transaction مُصلحة — تستخدم document name الصحيح */
async function fsRunTransaction(env, fn) {
  const token = await getAccessToken(env);
  const base = `${FS_BASE}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const projectRoot = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

  const beginRes = await fetch(`${base}:beginTransaction`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ options: { readWrite: {} } }),
  });
  if (!beginRes.ok) throw httpError(500, 'تعذّر بدء المعاملة');
  const { transaction } = await beginRes.json();

  const writes = [];

  const tx = {
    async get(path) {
      const res = await fetch(`${base}:batchGet`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          documents: [`${projectRoot}/${path}`],
          transaction,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        console.error('TX_GET_FAILED', path, res.status, t);
        throw httpError(500, `خطأ في القراءة (${res.status})`);
      }
      const data = await res.json();
      const arr = Array.isArray(data) ? data : [];
      const found = arr[0] && arr[0].found;
      if (!found) return null;
      return fromFsFields(found.fields || {});
    },
    update(path, data, merge = true) {
      const entry = {
        update: {
          name: docPath(env, path),
          fields: toFsFields(data),
        },
      };
      if (merge) entry.updateMask = { fieldPaths: Object.keys(data) };
      writes.push(entry);
    },
    create(collection, docId, data) {
      writes.push({
        update: {
          name: docPath(env, `${collection}/${docId}`),
          fields: toFsFields(data),
        },
        currentDocument: { exists: false },
      });
    },
    delete(path) {
      writes.push({ delete: docPath(env, path) });
    },
    increment(path, field, amount) {
      writes.push({
        transform: {
          document: docPath(env, path),
          fieldTransforms: [{
            fieldPath: field,
            increment: Number.isInteger(amount)
              ? { integerValue: String(amount) }
              : { doubleValue: amount },
          }],
        },
      });
    },
  };

  try {
    const result = await fn(tx);
    if (writes.length) {
      const commitRes = await fetch(`${base}:commit`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ transaction, writes }),
      });
      if (!commitRes.ok) {
        const t = await commitRes.text();
        console.error('TX_COMMIT_FAILED', commitRes.status, t);
        throw new Error(`commit failed: ${commitRes.status}`);
      }
    }
    return result;
  } catch (e) {
    try {
      await fetch(`${base}:rollback`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ transaction }),
      });
    } catch {}
    throw e;
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
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFsValue);
  if ('mapValue' in v) return fromFsFields(v.mapValue.fields || {});
  return null;
}

function fromFsFields(fields) {
  const o = {};
  for (const [k, v] of Object.entries(fields)) o[k] = fromFsValue(v);
  return o;
}

/* ═══════════════════════════════════════════════════════════
   Auth
   ═══════════════════════════════════════════════════════════ */

async function requireAuth(request, env) {
  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) throw httpError(401, 'يجب تسجيل الدخول');

  const payload = await verifyIdToken(m[1], env.FIREBASE_PROJECT_ID);

  const userDoc = await fsGet(env, `users/${payload.user_id || payload.sub}`).catch(() => null);
  if (userDoc && userDoc.banned === true) throw httpError(403, 'حسابك موقوف — تواصل مع الدعم');

  return { uid: payload.user_id || payload.sub, email: payload.email || '' };
}

async function verifyIdToken(idToken, projectId) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw httpError(401, 'رمز الدخول غير صالح');

  const header = JSON.parse(b64urlToStr(parts[0]));
  const payload = JSON.parse(b64urlToStr(parts[1]));
  const now = Math.floor(Date.now() / 1000);

  if (payload.aud !== projectId) throw httpError(401, 'رمز الدخول غير صالح');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw httpError(401, 'رمز الدخول غير صالح');
  if (!payload.sub) throw httpError(401, 'رمز الدخول غير صالح');
  if (payload.exp <= now) throw httpError(401, 'انتهت صلاحية الجلسة');

  const jwks = await getJwks();
  const jwk = jwks.find(k => k.kid === header.kid);
  if (!jwk) throw httpError(401, 'رمز الدخول غير صالح');

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
  if (!ok) throw httpError(401, 'رمز الدخول غير صالح');

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

async function requireAdmin(user, env) {
  const admin = await fsGet(env, `admins/${user.uid}`);
  if (!admin) throw httpError(403, 'غير مصرّح');
  return admin;
}

/* ═══════════════════════════════════════════════════════════
   Utilities
   ═══════════════════════════════════════════════════════════ */

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
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

async function logOp(env, uid, action, request, response, ok) {
  const id = `${Date.now()}_${randomSuffix(6)}`;
  try {
    await fsSet(env, `card_logs/${id}`, {
      uid, action, ok: !!ok,
      request: JSON.stringify(request).slice(0, 900),
      response: JSON.stringify(response || {}).slice(0, 900),
      created_at: nowIso(),
    });
  } catch (e) { console.error('LOG_FAILED', e.message); }
}

function b64url(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
