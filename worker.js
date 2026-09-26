/**
 * ═══════════════════════════════════════════════════════════
 *  KARDO — Cloudflare Worker Backend
 *  Version: 5.0.0
 *  - Per-user hash-chained ledger (every balance change)
 *  - Atomic idempotency + rate limiting (inside transactions)
 *  - Roles: super_admin | finance | support | ops
 *  - Verified-phone SMS deposits
 *  - HKDF per-record card encryption, one-time CVV (5 min)
 *  - App Check (off | monitor | enforce)
 * ═══════════════════════════════════════════════════════════
 */

const FS_BASE = 'https://firestore.googleapis.com/v1';
const TRON_API = 'https://api.trongrid.io';
const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

const MAX_ICON_BYTES = 60000;
const DELIVERED_TTL_DAYS = 7;
const CARD_TTL_DEFAULT_HOURS = 24;

let _tokenCache = { token: null, exp: 0 };
let _jwksCache = { keys: null, exp: 0 };

const DEFAULT_SETTINGS = {
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
  mc_tx_fee: 0, mc_reveal_hours: 24, mc_cvv_minutes: 5,
  withdraw_enabled: false, withdraw_min: 10, withdraw_max: 500,
  withdraw_fee_pct: 0, withdraw_fee_fixed: 0,
  withdraw_methods: 'ليبيانا,المدار,تحويل مصرفي,USDT',
  transfer_enabled: false, transfer_min: 1, transfer_max: 500, transfer_fee_pct: 0,
  tickets_enabled: true, points_enabled: false, points_per_lyd: 1,
  points_value_lyd: 0.01, points_min_redeem: 100, coupons_enabled: true,
  kill_switch: false, kill_message: 'الخدمة متوقفة مؤقتًا للصيانة.',
  daily_cards_max: 3, daily_amount_max: 200, daily_deposit_max: 500,
  platform_daily_max: 2000,
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
};

const ADMIN_SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);

export default {
  async fetch(request, env, ctx) {
    const origin = resolveOrigin(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    try {
      const result = await route(path, request, url, env);
      return json(result, 200, origin);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error('UNHANDLED', err.stack || err.message);
      return json({ success: false, error: err.publicMessage || 'حدث خطأ غير متوقع' }, status, origin);
    }
  },

  async scheduled(event, env, ctx) {
    const jobs = [purgeExpiredCvv(env).catch(e => console.error('CVV_PURGE_FAILED', e.message))];
    const minute = new Date(event.scheduledTime || Date.now()).getUTCMinutes();
    if (minute < 5) {
      jobs.push(
        purgeExpiredReveals(env).catch(e => console.error('PURGE_FAILED', e.message)),
        purgeOldRateLimits(env).catch(e => console.error('RL_PURGE_FAILED', e.message)),
        purgeDeliveredData(env).catch(e => console.error('DELIVERED_PURGE_FAILED', e.message)),
        purgeExpiredIdempotency(env).catch(e => console.error('IDEM_PURGE_FAILED', e.message)),
      );
    }
    ctx.waitUntil(Promise.all(jobs));
  },
};

async function route(path, request, url, env) {
  if (request.method === 'GET') {
    if (path === '/api/status') return handleStatus(env);
    if (path === '/api/catalog') return handleCatalog(env);
    if (path === '/api/services/list') return handleServicesList(env);
    throw httpError(404, 'المسار غير موجود');
  }
  if (path === '/api/sms/webhook') return handleSmsWebhook(request, env);
  if (request.method !== 'POST') throw httpError(405, 'طريقة غير مسموحة');
  if (Number(request.headers.get('content-length') || 0) > 1_500_000) throw httpError(413, 'الطلب كبير جدًا');

  const user = await requireAuth(request, env);
  await verifyAppCheck(request, env);
  await enforceGlobalRateLimit(env, user.uid);
  const body = await safeJson(request);

  switch (path) {
    case '/api/wallet/claim':          return handleWalletClaim(user, body, env);
    case '/api/wallet/withdraw':       return handleWithdrawRequest(user, body, env);
    case '/api/wallet/transfer':       return handleTransfer(user, body, env);
    case '/api/wallet/usdt/invoice':   return handleUsdtInvoice(user, body, env);
    case '/api/wallet/usdt/verify':    return handleUsdtVerify(user, body, env);
    case '/api/phone/verify/start':    return handlePhoneVerifyStart(user, body, env);

    case '/api/mcard/request':         return handleManualCardRequest(user, body, env);
    case '/api/mcard/topup-request':   return handleManualCardTopup(user, body, env);
    case '/api/mcard/list':            return handleManualCardList(user, env);
    case '/api/mcard/reveal':          return handleRevealCard(user, body, env, request);

    case '/api/store/order':           return handleStoreOrder(user, body, env);
    case '/api/coupon/check':          return handleCouponCheck(user, body, env);
    case '/api/points/redeem':         return handleRedeemPoints(user, body, env);
    case '/api/ref/code':              return handleRefCode(user, body, env);
    case '/api/ref/claim':             return handleRefClaim(user, body, env);

    case '/api/ticket/create':         return handleTicketCreate(user, body, env);
    case '/api/ticket/reply':          return handleTicketReply(user, body, env);
    case '/api/activity/ping':         return handleActivityPing(user, body, env, request);

    case '/api/service/create-order':  return handleServiceCreateOrder(user, body, env);
    case '/api/service/my-orders':     return handleServiceMyOrders(user, body, env);

    case '/api/admin/me':              return handleAdminMe(user, body, env);
    case '/api/admin/staff/set':       return handleAdminStaffSet(user, body, env);
    case '/api/admin/user/ban':        return handleAdminUserBan(user, body, env);
    case '/api/admin/phone/unbind':    return handleAdminPhoneUnbind(user, body, env);
    case '/api/admin/ledger/verify':   return handleAdminLedgerVerify(user, body, env);
    case '/api/admin/settings':        return handleAdminSettings(user, body, env);
    case '/api/admin/deposit':         return handleAdminDeposit(user, body, env);
    case '/api/admin/wallet-adjust':   return handleAdminWalletAdjust(user, body, env);
    case '/api/admin/withdraw':        return handleAdminWithdraw(user, body, env);
    case '/api/admin/sms/assign':      return handleAdminSmsAssign(user, body, env);
    case '/api/admin/mcard/fulfil':    return handleAdminCardFulfil(user, body, env);
    case '/api/admin/mcard/reject':    return handleAdminCardReject(user, body, env);
    case '/api/admin/order':           return handleAdminOrder(user, body, env);
    case '/api/admin/coupon/save':     return handleAdminCouponSave(user, body, env);
    case '/api/admin/coupon/delete':   return handleAdminCouponDelete(user, body, env);
    case '/api/admin/ticket/close':    return handleTicketClose(user, body, env);
    case '/api/admin/service/save':    return handleAdminServiceSave(user, body, env);
    case '/api/admin/service/delete':  return handleAdminServiceDelete(user, body, env);
    case '/api/admin/stock/add':       return handleAdminStockAdd(user, body, env);
    case '/api/admin/stock/delete':    return handleAdminStockDelete(user, body, env);
    case '/api/admin/stock/list':      return handleAdminStockList(user, body, env);
    case '/api/admin/service-order':   return handleAdminServiceOrder(user, body, env);
    case '/api/admin/service-order/inputs': return handleAdminServiceOrderInputs(user, body, env);
  }
  throw httpError(404, 'المسار غير موجود');
}

/* ═══════════════════════════════════════════════════════════
   AES-256-GCM Encryption (for card data)
   ═══════════════════════════════════════════════════════════ */

async function getEncryptionKey(env) {
  const keyHex = env.CARD_MASTER_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw httpError(500, 'مفتاح التشفير غير مضبوط');
  }
  const keyBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    keyBytes[i] = parseInt(keyHex.substr(i * 2, 2), 16);
  }
  return crypto.subtle.importKey(
    'raw', keyBytes,
    { name: 'AES-GCM' },
    false, ['encrypt', 'decrypt']
  );
}

async function decryptCard(encrypted, env) {
  const key = await getEncryptionKey(env);
  const parts = String(encrypted || '').split(':');
  if (parts.length !== 2) throw httpError(500, 'بيانات مشفرة غير صالحة');

  const iv = b64ToBytes(parts[0]);
  const ciphertext = b64ToBytes(parts[1]);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return JSON.parse(new TextDecoder().decode(plaintext));
}

function bytesToB64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64ToBytes(s) {
  const raw = atob(s);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

/* ═══════════════════════════════════════════════════════════
   Rate Limiting
   ═══════════════════════════════════════════════════════════ */

async function enforceGlobalRateLimit(env, uid) {
  const windowSec = 60, max = 120;
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(now / windowSec);
  const key = `rl_g_${uid}_${bucket}`;
  try {
    const cur = await fsGet(env, `rate_limits/${key}`).catch(() => null);
    const count = num(cur && cur.count, 0);
    if (count >= max) throw httpError(429, 'محاولات كثيرة — انتظر قليلاً');
    await fsSet(env, `rate_limits/${key}`, { uid, count: count + 1, bucket, expires_at: now + 120 }).catch(() => {});
  } catch (e) { if (e.status === 429) throw e; }
}

async function checkRateLimit(env, key, limit, windowSec) {
  const nowSec = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(nowSec / windowSec);
  const rlKey = `rl_${key}_${bucket}`;
  try {
    return await fsRunTransaction(env, async (tx) => {
      const cur = await tx.get(`rate_limits/${rlKey}`);
      const count = num(cur && cur.count, 0);
      if (count >= limit) return false;
      tx.update(`rate_limits/${rlKey}`, {
        key: rlKey, count: count + 1, expires_at: nowSec + windowSec + 60,
      }, false);
      return true;
    });
  } catch (e) {
    console.error('RL_FAILED', e.status || '', e.message);
    return false; // fail-closed
  }
}

async function purgeOldRateLimits(env) {
  const now = Math.floor(Date.now() / 1000);
  const rows = await fsQueryRaw(env, { from: [{ collectionId: 'rate_limits' }], limit: 300 });
  let purged = 0;
  for (const r of rows) {
    const d = withId(r, 'rate_limits');
    if (num(d.expires_at, 0) < now) { await fsDelete(env, `rate_limits/${d._id}`).catch(() => {}); purged++; }
  }
  return purged;
}

/* ═══════════════════════════════════════════════════════════
   Idempotency Helper
   ═══════════════════════════════════════════════════════════ */

async function purgeExpiredIdempotency(env) {
  const now = Date.now();
  const rows = await fsQueryRaw(env, { from: [{ collectionId: 'idempotency' }], limit: 300 });
  let purged = 0;
  for (const r of rows) {
    const d = withId(r, 'idempotency');
    if (num(d.expires_ms, 0) < now) { await fsDelete(env, `idempotency/${d._id}`).catch(() => {}); purged++; }
  }
  return purged;
}

/* ═══════════════════════════════════════════════════════════
   Status (Public)
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
      cvv_minutes: num(s.mc_cvv_minutes, 5),
    },
    withdraw: {
      on: s.withdraw_enabled === true,
      min: num(s.withdraw_min, 10),
      max: num(s.withdraw_max, 500),
      fee_pct: num(s.withdraw_fee_pct, 0),
      fee_fixed: num(s.withdraw_fee_fixed, 0),
      methods: String(s.withdraw_methods || 'ليبيانا,المدار').split(',').map(x => x.trim()).filter(Boolean),
    },
    transfer: {
      on: s.transfer_enabled === true,
      min: num(s.transfer_min, 1),
      max: num(s.transfer_max, 500),
      fee_pct: num(s.transfer_fee_pct, 0),
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
      navy: s.theme_navy || '#0F172A',
      emerald: s.theme_emerald || '#10B981',
      bg: s.theme_bg || '#F8FAFC',
      radius: num(s.theme_radius, 14),
    },
    nav: {
      home: s.nav_home !== false,
      mcards: s.nav_mcards !== false,
      wallet: s.nav_wallet !== false,
      tx: s.nav_tx !== false,
      help: s.nav_help !== false,
      settings: s.nav_settings !== false,
    },
    texts: {
      tagline: s.brand_tagline || 'بطاقات أكثر .. فرص أكبر',
      hero_title: s.hero_title || 'بطاقة تعمل في كل مكان يقبل الدفع الإلكتروني',
      hero_sub: s.hero_sub || 'بالدولار · بدون رسوم شهرية · تُصدر خلال دقائق',
      support_url: s.support_url || '',
    },
    methods: {
      libyana: { on: s.m_libyana_on !== false, logo: s.m_libyana_logo || '', label: s.m_libyana_label || 'ليبيانا', phone: s.m_libyana_phone || s.deposit_phone || '', rate: num(s.rate_libyana, 11.8), auto: true },
      almadar: { on: s.m_almadar_on !== false, logo: s.m_almadar_logo || '', label: s.m_almadar_label || 'المدار', phone: s.m_almadar_phone || s.deposit_phone || '', rate: num(s.rate_almadar, 12.5), auto: true },
      bank:    { on: s.m_bank_on === true, logo: s.m_bank_logo || '', label: s.m_bank_label || 'تحويل مصرفي', rate: num(s.rate_bank, 9.5), auto: false, fields: cleanFields(s.m_bank_fields) },
      usdt:    { on: s.m_usdt_on === true, logo: s.m_usdt_logo || '', label: s.m_usdt_label || 'USDT', rate: num(s.rate_usdt, 1), auto: true, invoice: true, address: s.usdt_address || '', min: num(s.usdt_min, 5), max: num(s.usdt_max, 1000), window_min: num(s.usdt_window_min, 30), fields: cleanFields(s.m_usdt_fields) },
      binance: { on: s.m_binance_on === true, logo: s.m_binance_logo || '', label: s.m_binance_label || 'Binance Pay', rate: num(s.rate_usdt, 1), auto: false, fields: cleanFields(s.m_binance_fields) },
      ...cleanCustomMethods(s.custom_methods),
    },
    maintenance_message: s.maintenance_message || '',
  };
}

/* ═══════════════════════════════════════════════════════════
   Digital Services — Public list
   ═══════════════════════════════════════════════════════════ */

async function handleServicesList(env) {
  const rows = await fsQueryRaw(env, { from: [{ collectionId: 'services' }], limit: 200 });

  const services = rows
    .map(r => withId(r, 'services'))
    .filter(s => s.is_active !== false)
    .sort((a, b) => num(a.sort, 999) - num(b.sort, 999))
    .map(s => ({
      id: s._id,
      name: s.name || '',
      desc: s.desc || '',
      icon_emoji: s.icon_emoji || '📦',
      icon_url: s.icon_url || '',
      price_usd: round2(num(s.price_usd, 0)),
      delivery_type: s.delivery_type === 'manual' ? 'manual' : 'auto',
      fields: cleanServiceFields(s.fields),
      in_stock: s.delivery_type === 'manual' ? null : (num(s.stock_count, 0) > 0),
    }));

  return { success: true, services };
}

function cleanServiceFields(arr) {
  if (!Array.isArray(arr)) return [];
  const ALLOWED = ['text', 'number', 'email', 'tel', 'password', 'select', 'textarea'];
  return arr.slice(0, 5).map((f, i) => {
    const key = String(f && f.key || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24) || 'f' + (i + 1);
    const type = ALLOWED.includes(f && f.type) ? f.type : 'text';
    const out = {
      key,
      label: String(f && f.label || '').slice(0, 60),
      type,
      placeholder: String(f && f.placeholder || '').slice(0, 80),
      required: f && f.required !== false,
    };
    if (type === 'select') {
      out.options = Array.isArray(f && f.options)
        ? f.options.slice(0, 20).map(x => String(x).slice(0, 40)).filter(Boolean)
        : [];
    }
    return out;
  }).filter(f => f.label);
}

/* ═══════════════════════════════════════════════════════════
   Digital Services — Create Order (Customer)
   Race-safe, idempotent, with encryption for password fields
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   Digital Services — My Orders
   ═══════════════════════════════════════════════════════════ */

async function handleServiceMyOrders(user, body, env) {
  const rows = await fsQueryRaw(env, {
    from: [{ collectionId: 'service_orders' }],
    where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: user.uid } } },
    limit: 60,
  });

  const orders = rows
    .map(r => withId(r, 'service_orders'))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .map(o => {
      // Check if delivered_data expired
      const expired = o.delivered_expires_at && new Date(o.delivered_expires_at) < new Date();
      return {
        id: o._id,
        service_id: o.service_id || '',
        service_name: o.service_name || '',
        service_icon: o.service_icon || '📦',
        service_icon_url: o.service_icon_url || '',
        price_usd: round2(num(o.price_usd, 0)),
        delivery_type: o.delivery_type || 'auto',
        status: o.status || 'pending',
        inputs: o.inputs || {},
        delivered_data: (o.status === 'delivered' && !expired) ? (o.delivered_data || '') : '',
        delivered_expired: expired,
        rejected_reason: o.rejected_reason || '',
        created_at: o.created_at,
        delivered_at: o.delivered_at || '',
      };
    });

  return { success: true, orders };
}

/* ═══════════════════════════════════════════════════════════
   Purge delivered_data after TTL
   ═══════════════════════════════════════════════════════════ */

async function purgeDeliveredData(env) {
  const now = Date.now();
  const rows = await fsQueryRaw(env, {
    from: [{ collectionId: 'service_orders' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'status' },
        op: 'EQUAL',
        value: { stringValue: 'delivered' },
      },
    },
    limit: 200,
  });

  let purged = 0;
  for (const r of rows) {
    const d = withId(r, 'service_orders');
    const expiresMs = new Date(d.delivered_expires_at || 0).getTime();
    if (expiresMs && expiresMs < now && d.delivered_data) {
      await fsPatch(env, `service_orders/${d._id}`, {
        delivered_data: '',
        delivered_purged_at: nowIso(),
      }).catch(() => {});
      purged++;
    }
  }
  return purged;
}

/* ═══════════════════════════════════════════════════════════
   Manual Cards
   ═══════════════════════════════════════════════════════════ */

async function handleManualCardList(user, env) {
  const rows = await fsQueryRaw(env, {
    from: [{ collectionId: 'manual_cards' }],
    where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: user.uid } } },
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
    where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: user.uid } } },
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

/* ═══════════════════════════════════════════════════════════
   Admin Card Fulfil / Reject
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   Wallet
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   USDT
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   SMS Webhook — Secret from header ONLY
   ═══════════════════════════════════════════════════════════ */

const PV_TTL_MIN = 15;
const PV_AMOUNTS = [1.25, 1.5, 1.75, 2.25, 2.5, 2.75, 3.25, 3.5, 3.75];

function toLatinDigits(s) {
  return String(s || '')
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0));
}

function normalizePhone(raw) {
  let p = toLatinDigits(raw).replace(/\D/g, '');
  if (p.startsWith('00218')) p = p.slice(5);
  else if (p.startsWith('218') && p.length === 12) p = p.slice(3);
  if (p.startsWith('0') && p.length === 10) p = p.slice(1);
  return /^9\d{8}$/.test(p) ? p : '';
}

function detectNetwork(from) {
  const f = String(from || '').toLowerCase();
  if (f.includes('libyana') || f.includes('ليبيانا')) return 'libyana';
  if (f.includes('almadar') || f.includes('madar') || f.includes('المدار')) return 'almadar';
  return '';
}

function round3(n) { return Math.round(n * 1000) / 1000; }

// يستخرج المبلغ الملاصق لعبارة "تم تحويل" فقط، ويتجاهل "رصيدك الحالي"
function parseTransferSms(text) {
  const s = toLatinDigits(text).replace(/[\u200e\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim();
  if (!/تم ?تحويل/.test(s)) return null;
  if (!/من ?الرقم/.test(s)) return null;                 // واردة فقط
  if (/(?:الى|الي|إلى) ?الرقم/.test(s)) return null;      // صادرة

  const m = s.match(/تم ?تحويل ?(\d{1,3}(?:,\d{3})+|\d+)(?:[.\u066B](\d{1,3}))? ?(دينار|د ?\. ?ل)/);
  if (!m) return null;
  const whole = parseInt(m[1].replace(/,/g, ''), 10);
  const frac = m[2] ? parseInt(m[2].padEnd(3, '0'), 10) / 1000 : 0;
  const amount = round3(whole + frac);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const ph = s.match(/من ?الرقم ?:? ?\+?(\d{9,14})/);
  const sender = ph ? normalizePhone(ph[1]) : '';
  if (!sender) return null;

  const textNetwork = /دينار/.test(m[3]) ? 'libyana' : 'almadar';
  return { amount_lyd: amount, sender, text_network: textNetwork };
}

function pickVerifyAmount() {
  const b = crypto.getRandomValues(new Uint8Array(1));
  return PV_AMOUNTS[b[0] % PV_AMOUNTS.length];
}

async function handlePhoneVerifyStart(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  const phone = normalizePhone(body.phone || '');
  if (!phone) throw httpError(400, 'رقم الهاتف غير صحيح');
  const network = body.network === 'almadar' ? 'almadar' : 'libyana';
  const toPhone = network === 'almadar'
    ? (s.m_almadar_phone || s.deposit_phone || '')
    : (s.m_libyana_phone || s.deposit_phone || '');
  if (!toPhone) throw httpError(503, 'رقم الاستقبال غير مضبوط');

  const rlOk = await checkRateLimit(env, `pv_${user.uid}`, 3, 3600);
  if (!rlOk) throw httpError(429, 'محاولات كثيرة — حاول بعد ساعة');

  const now = Date.now();
  let out = null;
  await fsRunTransaction(env, async (tx) => {
    const me = await tx.get(`users/${user.uid}`);
    if (!me) throw httpError(400, 'الحساب غير مكتمل');
    if (me.phone_verified === phone) throw httpError(409, 'رقمك موثّق مسبقًا');

    const bind = await tx.get(`phone_bindings/${phone}`);
    if (bind && bind.uid !== user.uid) throw httpError(409, 'هذا الرقم مرتبط بحساب آخر');

    const pv = await tx.get(`phone_verifications/${phone}`);
    if (pv && pv.status === 'pending' && num(pv.expires_ms, 0) > now) {
      if (pv.uid !== user.uid) throw httpError(409, 'هذا الرقم قيد التوثيق — حاول بعد 15 دقيقة');
      out = { amount_lyd: pv.amount_lyd, to_phone: pv.to_phone, expires_ms: pv.expires_ms };
      return;
    }
    out = { amount_lyd: pickVerifyAmount(), to_phone: toPhone, expires_ms: now + PV_TTL_MIN * 60000 };
    tx.update(`phone_verifications/${phone}`, {
      uid: user.uid, phone, network, status: 'pending',
      amount_lyd: out.amount_lyd, to_phone: toPhone,
      expires_ms: out.expires_ms, created_at: nowIso(),
    }, false);
  });

  await logOp(env, user.uid, 'phone_verify_start', { phone, network }, {}, true);
  return { success: true, phone, network, ...out };
}

// يُستدعى من الـ webhook: إن طابقت الرسالة طلب توثيق معلّقًا، يُربط الرقم ويُضاف المبلغ
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
    return { state: 'upcoming', total_days: total, days_left: total, per_day: perDay, price: full, starts_at: p.starts_at, ends_at: p.ends_at };
  }
  if (now >= end) {
    return { state: 'expired', total_days: total, days_left: 0, per_day: perDay, price: 0, starts_at: p.starts_at, ends_at: p.ends_at };
  }

  const left = Math.max(1, Math.ceil((end - now) / DAY));
  const minP = round2(num(p.min_price, 0));
  let price = Math.min(full, round2(perDay * left));
  if (minP > 0 && price < minP) price = minP;

  return { state: 'active', total_days: total, days_left: left, per_day: perDay, price, starts_at: p.starts_at, ends_at: p.ends_at };
}

function cleanProductFields(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 8).map(f => ({
    key: String(f && f.key || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24) || 'f' + Math.random().toString(36).slice(2, 7),
    label: String(f && f.label || '').slice(0, 60),
    type: ['text', 'number', 'email', 'tel'].includes(f && f.type) ? f.type : 'text',
    required: f && f.required !== false,
    hint: String(f && f.hint || '').slice(0, 80),
  })).filter(f => f.label);
}

/* ═══════════════════════════════════════════════════════════
   Withdraw / Transfer
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   Tickets
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   Coupons & Points
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   Referrals (with abuse protection)
   ═══════════════════════════════════════════════════════════ */

function makeRefCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, x => A[x % A.length]).join('');
}

/* ═══════════════════════════════════════════════════════════
   Admin — Digital Services
   ═══════════════════════════════════════════════════════════ */

function sanitizeIconUrl(raw) {
  const url = String(raw || '').trim().slice(0, MAX_ICON_BYTES);
  if (!url) return '';

  // Only allow these prefixes
  const allowedPrefixes = [
    'data:image/jpeg;base64,',
    'data:image/jpg;base64,',
    'data:image/png;base64,',
    'data:image/webp;base64,',
    'https://',
  ];

  const lower = url.toLowerCase();
  for (const prefix of allowedPrefixes) {
    if (lower.startsWith(prefix)) {
      // Additional size check
      if (url.length > MAX_ICON_BYTES) {
        throw httpError(400, `الصورة أكبر من ${Math.round(MAX_ICON_BYTES / 1024)}KB`);
      }
      return url;
    }
  }

  throw httpError(400, 'صيغة الصورة غير مدعومة');
}

function maskCode(code) {
  const s = String(code || '');
  if (s.length <= 8) return '••••••••';
  return s.slice(0, 4) + '•'.repeat(Math.min(12, s.length - 8)) + s.slice(-4);
}

/* ═══════════════════════════════════════════════════════════
   Admin Settings / Deposits / Adjust
   ═══════════════════════════════════════════════════════════ */

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
  return {
    cards: num(d && d.cards, 0),
    amount: num(d && d.amount, 0),
    deposit: num(d && d.deposit, 0),
  };
}

async function assertDailyLimit(env, s, uid, kind, amount) {
  if (s.limits_enabled === false) return;
  const me = await readCounter(env, uid);

  if (kind === 'card') {
    const maxCards = num(s.daily_cards_max, 3);
    const maxAmt = num(s.daily_amount_max, 200);
    if (maxCards > 0 && me.cards >= maxCards) {
      throw httpError(429, `بلغت حدّك اليومي (${maxCards} بطاقات). حاول غدًا.`);
    }
    if (maxAmt > 0 && me.amount + amount > maxAmt) {
      throw httpError(429, `بلغت حدّك اليومي ($${maxAmt}). حاول غدًا.`);
    }
  }

  if (kind === 'deposit') {
    const maxDep = num(s.daily_deposit_max, 500);
    if (maxDep > 0 && me.deposit + amount > maxDep) {
      throw httpError(429, `بلغت حدّ الإيداع اليومي ($${maxDep}).`);
    }
    const platMax = num(s.platform_daily_max, 0);
    if (platMax > 0) {
      const plat = await readCounter(env, '_platform');
      if (plat.deposit + amount > platMax) {
        throw httpError(503, 'بلغت المنصة سقفها اليومي. حاول غدًا.');
      }
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

/* ═══════════════════════════════════════════════════════════
   Utilities
   ═══════════════════════════════════════════════════════════ */

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
// ═══ END OF FILE ═══

async function fsRunTransaction(env, fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await fsTxAttempt(env, fn); }
    catch (e) {
      if (!e.aborted) throw e;
      last = e;
      await new Promise(r => setTimeout(r, 50 * (i + 1) + Math.floor(Math.random() * 50)));
    }
  }
  console.error('TX_CONTENTION', last && last.message);
  throw httpError(409, 'ضغط مؤقت على النظام — أعد المحاولة');
}

function txAborted(msg) { const e = new Error(msg); e.aborted = true; return e; }

async function fsTxAttempt(env, fn) {
  const token = await getAccessToken(env);
  const base = `${FS_BASE}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const projectRoot = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const H = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  const beginRes = await fetch(`${base}:beginTransaction`, {
    method: 'POST', headers: H, body: JSON.stringify({ options: { readWrite: {} } }),
  });
  if (!beginRes.ok) throw httpError(500, 'تعذّر بدء المعاملة');
  const { transaction } = await beginRes.json();

  const writes = [];
  let committed = false;

  const tx = {
    async get(path) {
      const res = await fetch(`${base}:batchGet`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ documents: [`${projectRoot}/${path}`], transaction }),
      });
      if (res.status === 409) throw txAborted('read aborted');
      if (!res.ok) {
        console.error('TX_GET_FAILED', res.status);
        throw httpError(500, 'خطأ في القراءة');
      }
      const data = await res.json();
      const found = Array.isArray(data) && data[0] && data[0].found;
      return found ? fromFsFields(found.fields || {}) : null;
    },
    async query(structuredQuery) {
      const res = await fetch(`${base}:runQuery`, {
        method: 'POST', headers: H, body: JSON.stringify({ structuredQuery, transaction }),
      });
      if (res.status === 409) throw txAborted('query aborted');
      if (!res.ok) { console.error('TX_QUERY_FAILED', res.status); throw httpError(500, 'خطأ في الاستعلام'); }
      const data = await res.json().catch(() => []);
      return (Array.isArray(data) ? data : []).filter(r => r && r.document);
    },
    update(path, data, merge = true) {
      const entry = { update: { name: docPath(env, path), fields: toFsFields(data) } };
      if (merge) entry.updateMask = { fieldPaths: Object.keys(data).map(fieldPathEscape) };
      writes.push(entry);
    },
    create(collection, docId, data) {
      writes.push({
        update: { name: docPath(env, `${collection}/${docId}`), fields: toFsFields(data) },
        currentDocument: { exists: false },
      });
    },
    delete(path) { writes.push({ delete: docPath(env, path) }); },
    increment(path, field, amount) {
      writes.push({
        transform: {
          document: docPath(env, path),
          fieldTransforms: [{
            fieldPath: fieldPathEscape(field),
            increment: Number.isInteger(amount) ? { integerValue: String(amount) } : { doubleValue: amount },
          }],
        },
      });
    },
  };

  try {
    const result = await fn(tx);
    if (writes.length) {
      const commitRes = await fetch(`${base}:commit`, {
        method: 'POST', headers: H, body: JSON.stringify({ transaction, writes }),
      });
      if (commitRes.status === 409) throw txAborted('commit aborted');
      if (!commitRes.ok) {
        const t = await commitRes.text();
        console.error('TX_COMMIT_FAILED', commitRes.status, t.slice(0, 300));
        throw httpError(500, 'تعذّر حفظ العملية');
      }
      committed = true;
    }
    return result;
  } finally {
    if (!committed) {
      fetch(`${base}:rollback`, { method: 'POST', headers: H, body: JSON.stringify({ transaction }) }).catch(() => {});
    }
  }
}

function fieldPathEscape(f) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(f) ? f : '`' + String(f).replace(/`/g, '\\`') + '`';
}

/* ═══════════════════════════════════════════════════════════
   Security core — roles, App Check, idempotency, ledger, crypto
   ═══════════════════════════════════════════════════════════ */

const ROLE_PERMISSIONS = {
  super_admin: ['*'],
  finance: ['deposit.review', 'withdraw.review', 'wallet.adjust', 'coupon.manage',
            'sms.assign', 'ledger.verify', 'user.read'],
  support: ['ticket.manage', 'user.read', 'user.ban'],
  ops:     ['service.manage', 'stock.manage', 'card.fulfil', 'order.fulfil', 'user.read'],
};
const FINANCE_ADJUST_CAP = 100;          // USD — سقف التعديل اليدوي لغير super_admin
const CVV_WINDOW_MIN_DEFAULT = 5;

async function getStaff(env, uid) {
  const a = await fsGet(env, `admins/${uid}`).catch(() => null);
  if (!a || a.disabled === true || !ROLE_PERMISSIONS[a.role]) return null;
  return { ...a, uid };
}

function staffCan(staff, perm) {
  if (!staff) return false;
  const rp = ROLE_PERMISSIONS[staff.role] || [];
  const extra = Array.isArray(staff.permissions) ? staff.permissions : [];
  return rp.includes('*') || rp.includes(perm) || extra.includes(perm);
}

async function requirePermission(user, env, perm) {
  const a = await fsGet(env, `admins/${user.uid}`).catch(() => null);
  if (!a || a.disabled === true) throw httpError(403, 'غير مصرّح');
  if (!ROLE_PERMISSIONS[a.role]) throw httpError(403, 'حسابك الإداري بلا دور صالح');
  const staff = { ...a, uid: user.uid };
  if (!staffCan(staff, perm)) throw httpError(403, 'لا تملك الصلاحية: ' + perm);
  return staff;
}

/* ─── App Check (off | monitor | enforce) ─── */
let _acJwks = { keys: null, exp: 0 };

async function verifyAppCheck(request, env) {
  const mode = String(env.APP_CHECK_MODE || 'off');
  if (mode === 'off') return;
  try {
    const token = request.headers.get('x-firebase-appcheck') || '';
    if (!token) throw new Error('missing');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('format');
    const header = JSON.parse(b64urlToStr(parts[0]));
    const payload = JSON.parse(b64urlToStr(parts[1]));
    const pn = String(env.FIREBASE_PROJECT_NUMBER || '');
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== 'RS256' || header.typ !== 'JWT') throw new Error('alg');
    if (payload.iss !== `https://firebaseappcheck.googleapis.com/${pn}`) throw new Error('iss');
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(`projects/${pn}`)) throw new Error('aud');
    if (!(payload.exp > now)) throw new Error('exp');

    if (!_acJwks.keys || _acJwks.exp < Date.now()) {
      const r = await fetch('https://firebaseappcheck.googleapis.com/v1/jwks');
      if (!r.ok) throw new Error('jwks');
      const j = await r.json();
      _acJwks = { keys: j.keys || [], exp: Date.now() + 6 * 3600000 };
    }
    const jwk = _acJwks.keys.find(k => k.kid === header.kid);
    if (!jwk) throw new Error('kid');
    const key = await crypto.subtle.importKey('jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key,
      b64urlToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) throw new Error('sig');
  } catch (e) {
    if (mode === 'enforce') throw httpError(401, 'تعذّر التحقق من سلامة التطبيق — حدّث الصفحة');
    console.warn('APPCHECK_MONITOR', e.message);
  }
}

/* ─── Constant-time compare ─── */
async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(a))),
    crypto.subtle.digest('SHA-256', enc.encode(String(b))),
  ]);
  const X = new Uint8Array(x), Y = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < X.length; i++) d |= X[i] ^ Y[i];
  return d === 0;
}

/* ─── Idempotency (atomic, inside the same transaction) ─── */
const IDEM_RE = /^[A-Za-z0-9_-]{8,64}$/;

function idemKeyOf(body, required = true) {
  const k = String((body && body.idempotency_key) || '');
  if (!k) { if (required) throw httpError(400, 'مفتاح العملية مفقود'); return null; }
  if (!IDEM_RE.test(k)) throw httpError(400, 'مفتاح العملية غير صالح');
  return k;
}

async function idemRead(tx, uid, key) {
  if (!key) return null;
  const d = await tx.get(`idempotency/${uid}_${key}`);
  if (!d) return null;
  return { ...(d.result || { success: true }), replayed: true };
}

function idemWrite(tx, uid, key, result) {
  if (!key) return;
  tx.create('idempotency', `${uid}_${key}`, {
    uid, result, created_at: nowIso(), expires_ms: Date.now() + 86400000,
  });
}

/* ─── Money helpers ─── */
function money(v, { min = 0.01, max = 1e6 } = {}) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return NaN;
  if (Math.round(n * 100) !== Math.round(n * 1e6) / 1e4) return NaN; // > 2 decimals
  const r = round2(n);
  if (r < min || r > max) return NaN;
  return r;
}

/* ═══ Ledger — per-user hash chain ═══
   كل تغيير على wallet_balance يمر من هنا فقط:
   ledgerOpen → ledgerPost (مرة أو أكثر) → ledgerClose            */

async function ledgerOpen(tx, uid) {
  const doc = await tx.get(`users/${uid}`);
  if (!doc) throw httpError(404, 'الحساب غير موجود');
  const L = {
    uid, doc,
    bal: round2(num(doc.wallet_balance, 0)),
    seq: Number.isInteger(doc.ledger_seq) ? doc.ledger_seq : null,
    head: doc.ledger_head || 'GENESIS',
    entries: [],
  };
  if (L.seq === null) {                     // ترحيل كسول: قيد رصيد افتتاحي
    L.seq = 0;
    if (L.bal !== 0) {
      await pushEntry(L, 'opening_' + uid, {
        type: L.bal > 0 ? 'credit' : 'debit', amount: Math.abs(L.bal),
        before: 0, after: L.bal, reason: 'opening_balance_migration',
        reference: 'MIGRATION_2026', created_by: 'system',
      });
    }
  }
  return L;
}

async function pushEntry(L, id, e) {
  const seq = L.seq + 1;
  const created_at = nowIso();
  const entry = {
    uid: L.uid, seq, type: e.type, amount: round2(e.amount),
    balance_before: round2(e.before), balance_after: round2(e.after),
    reason: String(e.reason).slice(0, 120), reference: String(e.reference || '').slice(0, 120),
    created_by: String(e.created_by || 'system').slice(0, 64),
    prev_hash: L.head, created_at,
  };
  if (e.note) entry.note = String(e.note).slice(0, 200);
  entry.hash = await ledgerHash(entry);
  L.entries.push({ id, entry });
  L.seq = seq;
  L.head = entry.hash;
}

function ledgerHash(e) {
  return sha256Hex([
    e.prev_hash, e.uid, e.seq, e.type, e.amount.toFixed(2),
    e.balance_before.toFixed(2), e.balance_after.toFixed(2),
    e.reason, e.reference, e.created_by, e.created_at,
  ].join('|'));
}

async function ledgerPost(L, { type, amount, reason, reference, entryId, created_by, note, allowNegative = false }) {
  const amt = round2(amount);
  if (!(amt > 0)) throw httpError(400, 'مبلغ غير صالح');
  if (type !== 'credit' && type !== 'debit') throw httpError(500, 'نوع قيد غير صالح');
  const before = L.bal;
  const after = round2(type === 'credit' ? before + amt : before - amt);
  if (after < 0 && !allowNegative) throw httpError(402, 'رصيدك غير كافٍ');
  await pushEntry(L, entryId, { type, amount: amt, before, after, reason, reference, created_by, note });
  L.bal = after;
  return after;
}

function ledgerClose(tx, L, extraUserFields = {}) {
  if (!L.entries.length && !Object.keys(extraUserFields).length) return;
  tx.update(`users/${L.uid}`, {
    ...extraUserFields,
    wallet_balance: L.bal, ledger_seq: L.seq, ledger_head: L.head,
  });
  for (const { id, entry } of L.entries) tx.create('wallet_transactions', id, entry);
}

async function handleAdminLedgerVerify(user, body, env) {
  const staff = await requirePermission(user, env, 'ledger.verify');
  const uid = String(body.uid || '').trim();
  if (!uid) throw httpError(400, 'معرّف المستخدم مفقود');
  const u = await fsGet(env, `users/${uid}`);
  if (!u) throw httpError(404, 'المستخدم غير موجود');

  const rows = await fsQueryRaw(env, {
    from: [{ collectionId: 'wallet_transactions' }],
    where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: uid } } },
    limit: 5000,
  });
  const chain = rows.map(r => withId(r, 'wallet_transactions'))
    .filter(e => Number.isInteger(e.seq)).sort((a, b) => a.seq - b.seq);

  const problems = [];
  let head = 'GENESIS', sum = 0;
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i];
    if (e.seq !== i + 1) problems.push(`فجوة في التسلسل عند ${i + 1}`);
    if (e.prev_hash !== head) problems.push(`prev_hash لا يطابق عند ${e.seq}`);
    const h = await ledgerHash({ ...e, amount: num(e.amount, 0), balance_before: num(e.balance_before, 0), balance_after: num(e.balance_after, 0) });
    if (h !== e.hash) problems.push(`hash تالف عند ${e.seq}`);
    sum = round2(sum + (e.type === 'credit' ? num(e.amount, 0) : -num(e.amount, 0)));
    if (round2(num(e.balance_after, 0)) !== sum) problems.push(`balance_after غير متّسق عند ${e.seq}`);
    head = e.hash;
  }
  const balance = round2(num(u.wallet_balance, 0));
  const migrated = Number.isInteger(u.ledger_seq);
  if (migrated) {
    if (u.ledger_seq !== chain.length) problems.push('ledger_seq لا يطابق عدد القيود');
    if (u.ledger_head !== head) problems.push('ledger_head لا يطابق آخر قيد');
    if (sum !== balance) problems.push(`المجموع ${sum} ≠ الرصيد ${balance}`);
  }
  await logOp(env, staff.uid, 'ledger.verify', { uid }, { ok: !problems.length }, true);
  return { success: true, uid, migrated, entries: chain.length, ledger_sum: sum, balance, ok: problems.length === 0, problems: problems.slice(0, 50) };
}

/* ─── Card crypto v2 — HKDF per-record key ─── */
function masterKeyBytes(env) {
  const hex = String(env.CARD_MASTER_KEY || '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw httpError(500, 'مفتاح التشفير غير مضبوط');
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16);
  return b;
}

async function deriveRecordKey(env, salt) {
  const base = await crypto.subtle.importKey('raw', masterKeyBytes(env), 'HKDF', false, ['deriveKey']);
  const enc = new TextEncoder();
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(salt), info: enc.encode('kardo-v2') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function encryptV2(env, salt, obj) {
  const key = await deriveRecordKey(env, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(salt) },
    key, new TextEncoder().encode(JSON.stringify(obj)));
  return 'v2:' + bytesToB64(iv) + ':' + bytesToB64(new Uint8Array(ct));
}

async function decryptAny(env, salt, blob) {
  const s = String(blob || '');
  if (!s.startsWith('v2:')) return decryptCard(s, env);        // legacy v1
  const [, ivB, ctB] = s.split(':');
  const key = await deriveRecordKey(env, salt);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(ivB), additionalData: new TextEncoder().encode(salt) },
    key, b64ToBytes(ctB));
  return JSON.parse(new TextDecoder().decode(pt));
}

function validExpiry(exp) {
  const m = String(exp || '').match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
  if (!m) return false;
  const month = parseInt(m[1], 10), year = 2000 + parseInt(m[2], 10);
  const now = new Date();
  const cy = now.getUTCFullYear(), cm = now.getUTCMonth() + 1;
  return year > cy || (year === cy && month >= cm);
}

function luhnOk(pan) {
  let sum = 0, alt = false;
  for (let i = pan.length - 1; i >= 0; i--) {
    let d = pan.charCodeAt(i) - 48;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  return sum % 10 === 0;
}

/* ─── Daily limits (atomic, inside tx) ─── */
async function dailyCheckTx(tx, s, uid, kind, amount) {
  if (s.limits_enabled === false) return;
  const id = `${uid}_${todayKey()}`;
  const d = await tx.get(`daily_counters/${id}`);
  const cur = { cards: num(d && d.cards, 0), amount: num(d && d.amount, 0), deposit: num(d && d.deposit, 0) };
  if (kind === 'card') {
    const maxCards = num(s.daily_cards_max, 3), maxAmt = num(s.daily_amount_max, 200);
    if (maxCards > 0 && cur.cards >= maxCards) throw httpError(429, `بلغت حدّك اليومي (${maxCards} بطاقات). حاول غدًا.`);
    if (maxAmt > 0 && cur.amount + amount > maxAmt) throw httpError(429, `بلغت حدّك اليومي ($${maxAmt}). حاول غدًا.`);
    tx.update(`daily_counters/${id}`, { uid, day: todayKey(), cards: cur.cards + 1, amount: round2(cur.amount + amount), deposit: cur.deposit }, false);
  } else if (kind === 'deposit') {
    tx.update(`daily_counters/${id}`, { uid, day: todayKey(), cards: cur.cards, amount: cur.amount, deposit: round2(cur.deposit + amount) }, false);
  }
}

/* ─── Settings sanitation ─── */
function sanitizeSettingsPatch(body) {
  const out = {};
  for (const k of ADMIN_SETTINGS_KEYS) {
    if (!(k in body)) continue;
    const def = DEFAULT_SETTINGS[k];
    let v = body[k];
    if (typeof def === 'number') {
      v = Number(v);
      if (!Number.isFinite(v) || v < 0 || v > 1e7) throw httpError(400, `قيمة غير صالحة: ${k}`);
    } else if (typeof def === 'boolean') {
      if (typeof v !== 'boolean') throw httpError(400, `قيمة غير صالحة: ${k}`);
    } else if (Array.isArray(def)) {
      if (!Array.isArray(v)) throw httpError(400, `قيمة غير صالحة: ${k}`);
      v = v.slice(0, 20);
      if (JSON.stringify(v).length > 700000) throw httpError(400, `حجم كبير: ${k}`);
    } else {
      v = String(v == null ? '' : v).slice(0, /_logo$/.test(k) ? 400000 : 2000);
    }
    out[k] = v;
  }
  for (const k of ['rate_libyana', 'rate_almadar', 'rate_bank', 'rate_usdt', 'usd_to_lyd']) {
    if (k in out && !(out[k] > 0)) throw httpError(400, `السعر يجب أن يكون أكبر من صفر: ${k}`);
  }
  for (const k of ['withdraw_fee_pct', 'transfer_fee_pct', 'mc_create_fee_pct', 'mc_topup_fee_pct']) {
    if (k in out && out[k] > 50) throw httpError(400, `نسبة غير منطقية: ${k}`);
  }
  for (const k of ['referral_bonus_inviter', 'referral_bonus_invitee']) {
    if (k in out && out[k] > 50) throw httpError(400, `مكافأة غير منطقية: ${k}`);
  }
  if ('points_value_lyd' in out && out.points_value_lyd > 1) throw httpError(400, 'قيمة النقطة غير منطقية');
  if ('mc_cvv_minutes' in out && (out.mc_cvv_minutes < 1 || out.mc_cvv_minutes > 60)) throw httpError(400, 'نافذة CVV بين 1 و60 دقيقة');
  if (out.usdt_address && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(out.usdt_address)) throw httpError(400, 'عنوان USDT غير صالح');
  for (const k of ['m_libyana_phone', 'm_almadar_phone', 'deposit_phone']) {
    if (out[k]) { const p = normalizePhone(out[k]); if (!p) throw httpError(400, `رقم غير صالح: ${k}`); out[k] = '0' + p; }
  }
  return out;
}

/* ═══ Wallet — claim / USDT / SMS credit / withdraw / transfer ═══ */

async function handleWalletClaim(user, body, env) {
  const amountLyd = round3(num(body.amount_lyd, NaN));
  const method = body.method === 'almadar' ? 'almadar' : 'libyana';

  const st = await getSettings(env);
  assertLive(st);
  const enabled = method === 'almadar' ? st.m_almadar_on !== false : st.m_libyana_on !== false;
  if (!enabled) throw httpError(503, 'طريقة الدفع هذه غير متاحة حاليًا');
  if (!Number.isFinite(amountLyd) || amountLyd <= 0) throw httpError(400, 'أدخل المبلغ');

  // الرقم من الحساب الموثّق فقط — لا من الطلب
  const meDoc = await fsGet(env, `users/${user.uid}`);
  const phone = meDoc && meDoc.phone_verified ? String(meDoc.phone_verified) : '';
  if (!phone) throw httpError(403, 'وثّق رقم هاتفك أولاً من صفحة الإعدادات');

  if (!(await checkRateLimit(env, `claim_${user.uid}`, 5, 3600))) throw httpError(429, 'محاولات كثيرة — حاول بعد ساعة');

  const maxLyd = num(st.max_deposit_lyd, 5000);
  if (amountLyd > maxLyd) throw httpError(400, `الحد الأقصى ${maxLyd} د.ل`);
  const rate = method === 'almadar' ? num(st.rate_almadar, 12.5) : num(st.rate_libyana, 11.8);
  await assertDailyLimit(env, st, user.uid, 'deposit', round2(amountLyd / rate));

  const sms = await findUnclaimedSms(env, phone, amountLyd);
  if (sms) {
    const credited = await fsRunTransaction(env, async (tx) => {
      const smsDoc = await tx.get(`sms_transactions/${sms._id}`);
      if (!smsDoc || smsDoc.status !== 'unclaimed') throw httpError(409, 'الحوالة مربوطة مسبقًا');
      if (smsDoc.sender !== phone) throw httpError(403, 'غير مصرّح');
      const amt = round2(num(smsDoc.amount_usd, 0));
      const L = await ledgerOpen(tx, user.uid);
      await ledgerPost(L, { type: 'credit', amount: amt, reason: 'deposit_claim', reference: sms._id, entryId: `txn_dep_${sms._id}` });
      ledgerClose(tx, L);
      await dailyCheckTx(tx, st, user.uid, 'deposit', amt);
      tx.update(`sms_transactions/${sms._id}`, { status: 'claimed', uid: user.uid, claimed_at: nowIso(), matched_by: 'claim' });
      tx.create('wallet_deposits', sms._id, {
        uid: user.uid, amount_usd: amt, amount_lyd: num(smsDoc.amount_lyd, amountLyd),
        method: (smsDoc.method === 'almadar' ? 'المدار' : 'ليبيانا') + ' — تلقائي',
        claim_phone: phone, proof_url: '', note: 'حوالة من 0' + phone,
        status: 'approved', auto: true, created_at: nowIso(),
      });
      return amt;
    });
    await logOp(env, user.uid, 'deposit.claim_matched', { amountLyd }, { credited }, true);
    return { success: true, matched: true, credited_usd: credited };
  }

  const pendingRows = await fsQueryRaw(env, {
    from: [{ collectionId: 'wallet_deposits' }],
    where: { compositeFilter: { op: 'AND', filters: [
      { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: user.uid } } },
      { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
    ] } },
    limit: 5,
  });
  if (pendingRows.length >= 3) throw httpError(429, 'لديك طلبات معلّقة كثيرة — انتظر معالجتها');

  const claimId = `CLM${Date.now()}${randomSuffix(4)}`;
  await fsSet(env, `wallet_deposits/${claimId}`, {
    uid: user.uid, amount_usd: round2(amountLyd / rate), amount_lyd: amountLyd,
    method: method === 'libyana' ? 'ليبيانا' : 'المدار',
    claim_phone: phone, proof_url: '', note: '',
    status: 'pending', awaiting_sms: true, verified: true,
    expires_ms: Date.now() + 2 * 3600000, created_at: nowIso(),
  });
  return { success: true, matched: false, claim_id: claimId };
}

async function findUnclaimedSms(env, phone, amountLyd) {
  const res = await fsQueryRaw(env, {
    from: [{ collectionId: 'sms_transactions' }],
    where: { compositeFilter: { op: 'AND', filters: [
      { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'unclaimed' } } },
      { fieldFilter: { field: { fieldPath: 'sender' }, op: 'EQUAL', value: { stringValue: phone } } },
    ] } },
    limit: 20,
  });
  return res.map(r => withId(r, 'sms_transactions'))
    .filter(d => Math.abs(num(d.amount_lyd, -1) - amountLyd) < 0.0005)
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))[0] || null;
}

async function findPendingClaim(env, phone, amountLyd) {
  const res = await fsQueryRaw(env, {
    from: [{ collectionId: 'wallet_deposits' }],
    where: { compositeFilter: { op: 'AND', filters: [
      { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
      { fieldFilter: { field: { fieldPath: 'claim_phone' }, op: 'EQUAL', value: { stringValue: phone } } },
    ] } },
    limit: 20,
  });
  return res.map(r => withId(r, 'wallet_deposits'))
    .filter(d => d.verified === true)
    .filter(d => Math.abs(num(d.amount_lyd, -1) - amountLyd) < 0.0005)
    .filter(d => !d.expires_ms || d.expires_ms > Date.now())
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))[0] || null;
}

async function handleUsdtInvoice(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.m_usdt_on !== true) throw httpError(503, 'الدفع بـ USDT غير متاح');
  const address = String(s.usdt_address || '').trim();
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) throw httpError(503, 'عنوان الاستقبال غير مضبوط');

  const amount = money(body.amount_usd);
  if (!Number.isFinite(amount)) throw httpError(400, 'أدخل المبلغ');
  const minU = num(s.usdt_min, 5), maxU = num(s.usdt_max, 1000);
  if (amount < minU) throw httpError(400, `الحد الأدنى ${minU} USDT`);
  if (amount > maxU) throw httpError(400, `الحد الأقصى ${maxU} USDT`);
  await assertDailyLimit(env, s, user.uid, 'deposit', amount);
  if (!(await checkRateLimit(env, `usdt_inv_${user.uid}`, 10, 3600))) throw httpError(429, 'محاولات كثيرة — حاول بعد ساعة');

  const minutes = num(s.usdt_window_min, 30);
  const now = Date.now();
  const id = `INV${now}${randomSuffix(4)}`;
  const expires = now + minutes * 60000;

  // حجز مبلغ دفع فريد ذرّيًا — مستند لكل مبلغ
  for (let i = 0; i < 25; i++) {
    const b = crypto.getRandomValues(new Uint8Array(2));
    const frac = ((((b[0] << 8) | b[1]) % 900) + 100) / 10000;
    const payAmount = Number((amount + frac).toFixed(4));
    const slot = payAmount.toFixed(4).replace('.', '_');
    const ok = await fsRunTransaction(env, async (tx) => {
      const r = await tx.get(`usdt_amounts/${slot}`);
      if (r && num(r.expires_ms, 0) > now) return false;
      tx.update(`usdt_amounts/${slot}`, { invoice_id: id, expires_ms: expires + 10 * 60000 }, false);
      tx.create('usdt_invoices', id, {
        uid: user.uid, amount_usd: amount, pay_amount: payAmount, address, status: 'awaiting',
        created_at: new Date(now).toISOString(), created_ms: now, expires_ms: expires,
      });
      return true;
    });
    if (ok) return { success: true, invoice: { id, amount_usd: amount, pay_amount: payAmount, address, network: 'TRC20', expires_ms: expires } };
  }
  throw httpError(503, 'ازدحام مؤقت، حاول بعد قليل');
}

async function handleUsdtVerify(user, body, env) {
  const id = String(body.invoice_id || '').trim();
  if (!/^INV\d+[A-Z0-9]{4}$/.test(id)) throw httpError(400, 'رقم الفاتورة غير صالح');
  if (!(await checkRateLimit(env, `usdt_v_${user.uid}`, 30, 3600))) throw httpError(429, 'محاولات كثيرة');

  const inv = await fsGet(env, `usdt_invoices/${id}`);
  if (!inv || inv.uid !== user.uid) throw httpError(404, 'الفاتورة غير موجودة');
  if (inv.status === 'paid') return { success: true, paid: true, already: true, credited: num(inv.received, 0) };
  if (inv.status !== 'awaiting') throw httpError(400, 'الفاتورة مغلقة');

  const want = num(inv.pay_amount, 0);
  let txs = [];
  try {
    const url = `${TRON_API}/v1/accounts/${inv.address}/transactions/trc20?limit=60&only_to=true&contract_address=${USDT_TRC20}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    const data = await res.json();
    txs = Array.isArray(data.data) ? data.data : [];
  } catch (e) {
    console.error('TRON_FETCH_FAILED', e.message);
    throw httpError(502, 'تعذّر الاتصال بالشبكة');
  }

  const since = num(inv.created_ms, 0) - 60000;
  const until = num(inv.expires_ms, 0) + 10 * 60000;
  const hit = txs.find(t => {
    const ts = Number(t.block_timestamp || 0);
    const val = Number(t.value || 0) / 1e6;
    return t.to === inv.address && t.token_info && t.token_info.address === USDT_TRC20
      && ts >= since && ts <= until && Math.abs(val - want) < 0.00005;
  });

  if (!hit) {
    if (num(inv.expires_ms, 0) + 10 * 60000 < Date.now()) {
      await fsPatch(env, `usdt_invoices/${id}`, { status: 'expired' });
      throw httpError(400, 'انتهت مهلة الفاتورة');
    }
    return { success: true, paid: false };
  }

  const txid = String(hit.transaction_id || '');
  if (!/^[0-9a-f]{64}$/i.test(txid)) return { success: true, paid: false };
  const received = round2(Number(hit.value) / 1e6);
  const s = await getSettings(env);

  const r = await fsRunTransaction(env, async (tx) => {
    if (await tx.get(`usdt_txids/${txid}`)) return { dup: true };
    const cur = await tx.get(`usdt_invoices/${id}`);
    if (!cur || cur.status !== 'awaiting') return { dup: true };
    const L = await ledgerOpen(tx, user.uid);
    await ledgerPost(L, { type: 'credit', amount: received, reason: 'usdt_deposit', reference: txid, entryId: `txn_usdt_${id}` });
    ledgerClose(tx, L);
    await dailyCheckTx(tx, s, user.uid, 'deposit', received);
    tx.create('usdt_txids', txid, { invoice_id: id, uid: user.uid, amount: received, from: String(hit.from || '').slice(0, 60), created_at: nowIso() });
    tx.update(`usdt_invoices/${id}`, { status: 'paid', txid, paid_at: nowIso(), received });
    tx.create('wallet_deposits', id, {
      uid: user.uid, amount_usd: received, amount_lyd: 0, method: 'USDT — تلقائي', proof_url: '',
      note: 'TRC20 · ' + txid.slice(0, 12) + '…', status: 'approved', auto: true, created_at: nowIso(),
    });
    return { dup: false };
  });
  if (r.dup) return { success: true, paid: false, duplicate: true };
  await logOp(env, user.uid, 'deposit.usdt', { id }, { txid, received }, true);
  return { success: true, paid: true, credited: received, txid };
}

async function handleWithdrawRequest(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.withdraw_enabled !== true) throw httpError(503, 'السحب غير متاح حاليًا');
  const key = idemKeyOf(body, false);

  const amount = money(body.amount_usd);
  const method = String(body.method || '').trim().slice(0, 40);
  let dest = String(body.destination || '').trim().slice(0, 120);
  if (!Number.isFinite(amount)) throw httpError(400, 'أدخل مبلغًا صحيحًا');
  const allowed = String(s.withdraw_methods || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!allowed.includes(method)) throw httpError(400, 'طريقة السحب غير متاحة');
  if (/usdt/i.test(method)) {
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(dest)) throw httpError(400, 'عنوان USDT (TRC20) غير صالح');
  } else if (/ليبيانا|المدار|libyana|almadar/i.test(method)) {
    const p = normalizePhone(dest);
    if (!p) throw httpError(400, 'رقم الهاتف غير صالح');
    dest = '0' + p;
  } else if (dest.length < 4) throw httpError(400, 'أدخل وجهة السحب');

  const mn = num(s.withdraw_min, 10), mx = num(s.withdraw_max, 500);
  if (amount < mn) throw httpError(400, `الحد الأدنى ${mn}$`);
  if (amount > mx) throw httpError(400, `الحد الأقصى ${mx}$`);
  const fee = round2(num(s.withdraw_fee_fixed, 0) + amount * num(s.withdraw_fee_pct, 0) / 100);
  const net = round2(amount - fee);
  if (net <= 0) throw httpError(400, 'المبلغ لا يغطي الرسوم');
  if (!(await checkRateLimit(env, `wd_${user.uid}`, 3, 3600))) throw httpError(429, 'محاولات كثيرة — حاول بعد ساعة');

  const id = `WD${Date.now()}${randomSuffix(4)}`;
  const resp = await fsRunTransaction(env, async (tx) => {
    const hit = await idemRead(tx, user.uid, key); if (hit) return hit;
    const L = await ledgerOpen(tx, user.uid);
    if (L.doc.banned === true) throw httpError(403, 'الحساب موقوف');
    await ledgerPost(L, { type: 'debit', amount, reason: 'withdraw_request', reference: id, entryId: `txn_wd_${id}` });
    ledgerClose(tx, L);
    tx.create('withdrawals', id, {
      uid: user.uid, amount_usd: amount, fee, net, method, destination: dest,
      status: 'pending', created_at: nowIso(), updated_at: nowIso(),
    });
    const r = { success: true, id, fee, net };
    idemWrite(tx, user.uid, key, r);
    return r;
  });
  if (!resp.replayed) await logOp(env, user.uid, 'withdraw.request', { amount, method }, { id }, true);
  return resp;
}

async function handleAdminWithdraw(user, body, env) {
  const staff = await requirePermission(user, env, 'withdraw.review');
  const id = String(body.id || '').trim();
  const action = body.action === 'reject' ? 'reject' : 'complete';
  if (!id) throw httpError(400, 'رقم الطلب مفقود');

  await fsRunTransaction(env, async (tx) => {
    const w = await tx.get(`withdrawals/${id}`);
    if (!w) throw httpError(404, 'الطلب غير موجود');
    if (w.status !== 'pending') throw httpError(409, 'الطلب مُغلق');
    if (action === 'reject') {
      const L = await ledgerOpen(tx, w.uid);
      await ledgerPost(L, { type: 'credit', amount: num(w.amount_usd, 0), reason: 'withdraw_rejected', reference: id, entryId: `txn_wd_refund_${id}`, created_by: staff.uid });
      ledgerClose(tx, L);
      tx.update(`withdrawals/${id}`, { status: 'rejected', reject_reason: String(body.reason || '').slice(0, 160), reviewed_by: staff.uid, updated_at: nowIso() });
    } else {
      tx.update(`withdrawals/${id}`, { status: 'completed', note: String(body.note || '').slice(0, 200), reviewed_by: staff.uid, updated_at: nowIso() });
    }
  });
  await logOp(env, staff.uid, 'withdraw.' + action, { id }, {}, true);
  return { success: true, refunded: action === 'reject' };
}

async function handleTransfer(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.transfer_enabled !== true) throw httpError(503, 'التحويل غير متاح');
  const key = idemKeyOf(body);

  const amount = money(body.amount_usd);
  const to = String(body.to || '').trim().toLowerCase().slice(0, 120);
  if (!Number.isFinite(amount)) throw httpError(400, 'أدخل مبلغًا صحيحًا');
  if (!to) throw httpError(400, 'أدخل بيانات المستلم');
  const mn = num(s.transfer_min, 1), mx = num(s.transfer_max, 500);
  if (amount < mn) throw httpError(400, `الحد الأدنى ${mn}$`);
  if (amount > mx) throw httpError(400, `الحد الأقصى ${mx}$`);
  if (!(await checkRateLimit(env, `tr_${user.uid}`, 10, 3600))) throw httpError(429, 'محاولات كثيرة — حاول بعد ساعة');

  const fee = round2(amount * num(s.transfer_fee_pct, 0) / 100);
  const total = round2(amount + fee);

  let field, value;
  if (to.includes('@')) { field = 'email'; value = to; }
  else { const k = normalizePhone(to); if (!k) throw httpError(400, 'رقم الهاتف غير صحيح'); field = 'phone_verified'; value = k; }
  const rows = await fsQueryRaw(env, {
    from: [{ collectionId: 'users' }],
    where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } },
    limit: 2,
  });
  if (rows.length !== 1) throw httpError(404, 'لم نجد مستخدمًا بهذه البيانات');
  const toUid = rows[0].document.name.split('/documents/users/')[1];
  if (toUid === user.uid) throw httpError(400, 'لا يمكنك التحويل لنفسك');

  const id = `TR${Date.now()}${randomSuffix(4)}`;
  const resp = await fsRunTransaction(env, async (tx) => {
    const hit = await idemRead(tx, user.uid, key); if (hit) return hit;
    const A = await ledgerOpen(tx, user.uid);
    const B = await ledgerOpen(tx, toUid);
    if (A.doc.banned === true) throw httpError(403, 'الحساب موقوف');
    if (B.doc.banned === true) throw httpError(400, 'حساب المستلم موقوف');
    await ledgerPost(A, { type: 'debit', amount: total, reason: 'transfer_out', reference: id, entryId: `txn_tr_out_${id}` });
    await ledgerPost(B, { type: 'credit', amount, reason: 'transfer_in', reference: id, entryId: `txn_tr_in_${id}` });
    ledgerClose(tx, A);
    ledgerClose(tx, B);
    tx.create('transfers', id, { from_uid: user.uid, to_uid: toUid, amount_usd: amount, fee, status: 'completed', created_at: nowIso() });
    const r = { success: true, id, amount, fee };
    idemWrite(tx, user.uid, key, r);
    return r;
  });
  if (!resp.replayed) await logOp(env, user.uid, 'transfer', { to: toUid, amount }, { id }, true);
  return resp;
}

async function handleAdminDeposit(user, body, env) {
  const staff = await requirePermission(user, env, 'deposit.review');
  const depositId = String(body.deposit_id || '').trim();
  const action = body.action === 'reject' ? 'reject' : 'approve';
  if (!depositId) throw httpError(400, 'معرّف الإيداع مفقود');

  const s = await getSettings(env);
  await fsRunTransaction(env, async (tx) => {
    const dep = await tx.get(`wallet_deposits/${depositId}`);
    if (!dep) throw httpError(404, 'الإيداع غير موجود');
    if (dep.status !== 'pending') throw httpError(409, 'تمت معالجة هذا الإيداع مسبقًا');
    if (action === 'reject') {
      tx.update(`wallet_deposits/${depositId}`, { status: 'rejected', reject_reason: String(body.reason || '').slice(0, 200), reviewed_by: staff.uid, reviewed_at: nowIso() });
      return;
    }
    const amountUsd = round2(num(dep.amount_usd, 0));
    if (!(amountUsd > 0)) throw httpError(400, 'مبلغ غير صحيح');
    const L = await ledgerOpen(tx, dep.uid);
    await ledgerPost(L, { type: 'credit', amount: amountUsd, reason: 'deposit_approved', reference: depositId, entryId: `txn_dep_manual_${depositId}`, created_by: staff.uid });
    ledgerClose(tx, L);
    await dailyCheckTx(tx, s, dep.uid, 'deposit', amountUsd);
    tx.update(`wallet_deposits/${depositId}`, { status: 'approved', reviewed_by: staff.uid, reviewed_at: nowIso() });
  });
  await logOp(env, staff.uid, 'deposit.' + action, { depositId }, {}, true);
  return { success: true, status: action === 'reject' ? 'rejected' : 'approved' };
}

async function handleAdminWalletAdjust(user, body, env) {
  const staff = await requirePermission(user, env, 'wallet.adjust');
  const key = idemKeyOf(body);
  const uid = String(body.uid || '').trim();
  const delta = round2(num(body.delta, NaN));
  const reason = String(body.reason || '').trim().slice(0, 200);
  if (!uid) throw httpError(400, 'معرّف المستخدم مفقود');
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 100000) throw httpError(400, 'المبلغ غير صحيح');
  if (reason.length < 5) throw httpError(400, 'اكتب سببًا واضحًا (5 أحرف على الأقل)');
  if (staff.role !== 'super_admin' && Math.abs(delta) > FINANCE_ADJUST_CAP) {
    throw httpError(403, `الحد الأقصى لتعديلك ${FINANCE_ADJUST_CAP}$ — يتطلب super_admin`);
  }
  if (uid === staff.uid) throw httpError(403, 'لا يمكنك تعديل رصيدك بنفسك');

  const id = `ADJ${Date.now()}${randomSuffix(4)}`;
  const resp = await fsRunTransaction(env, async (tx) => {
    const hit = await idemRead(tx, staff.uid, key); if (hit) return hit;
    const L = await ledgerOpen(tx, uid);
    const before = L.bal;
    await ledgerPost(L, {
      type: delta > 0 ? 'credit' : 'debit', amount: Math.abs(delta),
      reason: 'admin_adjust', note: reason, reference: id, entryId: id, created_by: staff.uid,
    });
    ledgerClose(tx, L);
    const r = { success: true, delta, before, after: L.bal };
    idemWrite(tx, staff.uid, key, r);
    return r;
  });
  if (!resp.replayed) await logOp(env, staff.uid, 'wallet.adjust', { uid, delta, reason, role: staff.role }, { before: resp.before, after: resp.after }, true);
  return resp;
}

/* ═══ Manual cards ═══ */

async function handleManualCardRequest(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.manual_cards_enabled === false) throw httpError(503, 'إصدار البطاقات متوقف مؤقتًا');
  const key = idemKeyOf(body);

  const amount = money(body.amount);
  const nameOnCard = String(body.name_on_card || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const cardName = String(body.card_name || 'بطاقتي').trim().slice(0, 40) || 'بطاقتي';
  if (!Number.isFinite(amount)) throw httpError(400, 'أدخل مبلغًا صحيحًا');
  if (!/^[A-Z][A-Z .'-]{1,39}$/.test(nameOnCard)) throw httpError(400, 'اسم حامل البطاقة يجب أن يكون بحروف لاتينية');
  const mn = num(s.mc_create_min, 10), mx = num(s.mc_create_max, 500);
  if (amount < mn) throw httpError(400, `الحد الأدنى ${mn}$`);
  if (amount > mx) throw httpError(400, `الحد الأقصى ${mx}$`);

  const fee = round2(num(s.mc_create_fee_fixed, 8) + amount * num(s.mc_create_fee_pct, 2.5) / 100);
  const total = round2(amount + fee);
  const id = `MC${Date.now()}${randomSuffix(4)}`;

  const resp = await fsRunTransaction(env, async (tx) => {
    const hit = await idemRead(tx, user.uid, key); if (hit) return hit;
    const L = await ledgerOpen(tx, user.uid);
    if (L.doc.banned === true) throw httpError(403, 'الحساب موقوف');
    await dailyCheckTx(tx, s, user.uid, 'card', total);
    await ledgerPost(L, { type: 'debit', amount: total, reason: 'card_create', reference: id, entryId: `txn_mc_create_${id}` });
    ledgerClose(tx, L);
    tx.create('manual_card_orders', id, {
      uid: user.uid, kind: 'create', amount, fee, total, card_name: cardName, name_on_card: nameOnCard,
      status: 'pending', created_at: nowIso(), updated_at: nowIso(),
    });
    const r = { success: true, id, amount, fee, total };
    idemWrite(tx, user.uid, key, r);
    return r;
  });
  if (!resp.replayed) await logOp(env, user.uid, 'card.request', { amount }, { id }, true);
  return resp;
}

async function handleManualCardTopup(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.manual_cards_enabled === false) throw httpError(503, 'خدمة البطاقات متوقفة مؤقتًا');
  const key = idemKeyOf(body, false);

  const cardId = String(body.card_id || '').trim();
  const amount = money(body.amount);
  if (!cardId) throw httpError(400, 'اختر البطاقة');
  if (!Number.isFinite(amount)) throw httpError(400, 'أدخل مبلغًا صحيحًا');
  const mn = num(s.mc_topup_min, 10), mx = num(s.mc_topup_max, 500);
  if (amount < mn) throw httpError(400, `الحد الأدنى للشحن ${mn}$`);
  if (amount > mx) throw httpError(400, `الحد الأقصى للشحن ${mx}$`);
  const fee = round2(num(s.mc_topup_fee_fixed, 8) + amount * num(s.mc_topup_fee_pct, 2.5) / 100);
  const total = round2(amount + fee);
  const id = `MCT${Date.now()}${randomSuffix(4)}`;

  const resp = await fsRunTransaction(env, async (tx) => {
    const hit = await idemRead(tx, user.uid, key); if (hit) return hit;
    const L = await ledgerOpen(tx, user.uid);
    if (L.doc.banned === true) throw httpError(403, 'الحساب موقوف');
    const card = await tx.get(`manual_cards/${cardId}`);
    if (!card || card.uid !== user.uid) throw httpError(404, 'البطاقة غير موجودة');
    if (card.status !== 'active') throw httpError(400, 'هذه البطاقة غير نشطة');
    await dailyCheckTx(tx, s, user.uid, 'card', total);
    await ledgerPost(L, { type: 'debit', amount: total, reason: 'card_topup', reference: id, entryId: `txn_mc_topup_${id}` });
    ledgerClose(tx, L);
    tx.create('manual_card_orders', id, {
      uid: user.uid, kind: 'topup', card_id: cardId, amount, fee, total,
      card_name: card.card_name || '', status: 'pending', created_at: nowIso(), updated_at: nowIso(),
    });
    const r = { success: true, id, amount, fee, total };
    idemWrite(tx, user.uid, key, r);
    return r;
  });
  if (!resp.replayed) await logOp(env, user.uid, 'card.topup_request', { amount }, { id }, true);
  return resp;
}

async function handleRevealCard(user, body, env, request) {
  const orderId = String(body.order_id || '').trim();
  if (!/^MC\d+[A-Z0-9]{4}$/.test(orderId)) throw httpError(400, 'رقم الطلب غير صالح');
  if (!(await checkRateLimit(env, `reveal_${user.uid}`, 20, 3600))) {
    await logOp(env, user.uid, 'card.reveal_rate_limited', { orderId }, {}, false);
    throw httpError(429, 'بلغت حد عرض البيانات — انتظر ساعة');
  }

  const now = Date.now();
  const got = await fsRunTransaction(env, async (tx) => {
    const rv = await tx.get(`manual_card_reveal/${orderId}`);
    if (!rv || rv.uid !== user.uid) throw httpError(404, 'لا بيانات متاحة لهذا الطلب');
    if (new Date(rv.expires_at).getTime() < now) throw httpError(410, 'انتهت صلاحية عرض البيانات');
    const cv = await tx.get(`card_cvv_once/${orderId}`);
    let cvvBlob = null;
    if (cv && cv.uid === user.uid) {
      if (num(cv.expires_ms, 0) > now) cvvBlob = cv.enc;
      tx.delete(`card_cvv_once/${orderId}`);           // مرة واحدة: يُحذف عند أول عرض
    }
    return { rv, cvvBlob };
  });

  let pan, expiry, cvv = null;
  try {
    const d = await decryptAny(env, `card:${orderId}`, got.rv.encrypted_data);
    pan = d.card_number; expiry = d.expiry;
    if (got.cvvBlob) cvv = (await decryptAny(env, `cvv:${orderId}`, got.cvvBlob)).cvv;
    else if (d.cvv && now - new Date(got.rv.created_at).getTime() < CVV_WINDOW_MIN_DEFAULT * 60000) cvv = d.cvv; // legacy v1
  } catch (e) {
    console.error('DECRYPT_FAILED');
    throw httpError(500, 'خطأ في فك تشفير البيانات');
  }

  await fsSet(env, `reveal_logs/RV${Date.now()}${randomSuffix(4)}`, {
    uid: user.uid, order_id: orderId, card_id: got.rv.card_id || '', with_cvv: !!cvv,
    ip: (request.headers.get('cf-connecting-ip') || '').slice(0, 45),
    ua: (request.headers.get('user-agent') || '').slice(0, 160),
    country: String(request.cf?.country || '').slice(0, 4), revealed_at: nowIso(),
  }).catch(() => {});

  return {
    success: true, card_number: pan, expiry, cvv,
    cvv_available: !!cvv, expires_at: got.rv.expires_at,
  };
}

async function cardRejectTx(env, staff, id, reason) {
  await fsRunTransaction(env, async (tx) => {
    const o = await tx.get(`manual_card_orders/${id}`);
    if (!o) throw httpError(404, 'الطلب غير موجود');
    if (o.status !== 'pending') throw httpError(409, 'الطلب مُغلق بالفعل');
    const L = await ledgerOpen(tx, o.uid);
    await ledgerPost(L, { type: 'credit', amount: num(o.total, 0), reason: 'card_rejected_refund', reference: id, entryId: `txn_mc_refund_${id}`, created_by: staff.uid });
    ledgerClose(tx, L);
    tx.update(`manual_card_orders/${id}`, { status: 'rejected', reject_reason: reason, rejected_at: nowIso(), rejected_by: staff.uid, updated_at: nowIso() });
  });
  await logOp(env, staff.uid, 'card.reject', { id, reason }, { refunded: true }, true);
  return { success: true, refunded: true };
}

async function handleAdminCardReject(user, body, env) {
  const staff = await requirePermission(user, env, 'card.fulfil');
  const id = String(body.id || '').trim();
  if (!id) throw httpError(400, 'رقم الطلب مفقود');
  return cardRejectTx(env, staff, id, String(body.reason || '').slice(0, 200));
}

async function handleAdminCardFulfil(user, body, env) {
  const staff = await requirePermission(user, env, 'card.fulfil');
  const id = String(body.id || '').trim();
  if (!id) throw httpError(400, 'رقم الطلب مفقود');
  if (body.action === 'reject') return cardRejectTx(env, staff, id, String(body.reason || '').slice(0, 200));

  const s = await getSettings(env);
  const pan = String(body.card_number || '').replace(/[\s-]+/g, '');
  const expiry = String(body.expiry || '').trim();
  let cvv = String(body.cvv || '').trim();
  const providerRef = String(body.provider_ref || '').slice(0, 120);
  const revealMs = Math.min(72, Math.max(1, num(s.mc_reveal_hours, CARD_TTL_DEFAULT_HOURS))) * 3600000;
  const cvvMs = Math.min(60, Math.max(1, num(s.mc_cvv_minutes, CVV_WINDOW_MIN_DEFAULT))) * 60000;

  const o0 = await fsGet(env, `manual_card_orders/${id}`);
  if (!o0) throw httpError(404, 'الطلب غير موجود');
  const isCreate = o0.kind === 'create';
  let encData = null, encCvv = null;
  if (isCreate) {
    if (!/^\d{13,19}$/.test(pan) || !luhnOk(pan)) throw httpError(400, 'رقم البطاقة غير صالح');
    if (!validExpiry(expiry)) throw httpError(400, 'تاريخ الانتهاء غير صالح (MM/YY في المستقبل)');
    if (!/^\d{3,4}$/.test(cvv)) throw httpError(400, 'CVV غير صالح');
    encData = await encryptV2(env, `card:${id}`, { card_number: pan, expiry });
    encCvv = await encryptV2(env, `cvv:${id}`, { cvv });
    cvv = '';                                              // لا نحتفظ به في الذاكرة بعد التشفير
  }

  const now = Date.now();
  const expiresAt = new Date(now + revealMs).toISOString();
  const cardId = isCreate ? `MCX${now}${randomSuffix(4)}` : String(o0.card_id || '');

  await fsRunTransaction(env, async (tx) => {
    const o = await tx.get(`manual_card_orders/${id}`);
    if (!o) throw httpError(404, 'الطلب غير موجود');
    if (o.status !== 'pending') throw httpError(409, 'الطلب مُغلق بالفعل');
    if (o.kind === 'create') {
      tx.create('manual_cards', cardId, {
        uid: o.uid, card_name: o.card_name || 'بطاقتي', name_on_card: o.name_on_card || '',
        last4: pan.slice(-4), status: 'active', balance: round2(num(o.amount, 0)),
        created_at: nowIso(), created_by: staff.uid, provider_ref: providerRef,
      });
      tx.create('manual_card_reveal', id, { uid: o.uid, card_id: cardId, encrypted_data: encData, created_at: nowIso(), expires_at: expiresAt });
      tx.create('card_cvv_once', id, { uid: o.uid, enc: encCvv, expires_ms: now + cvvMs, created_at: nowIso() });
    } else {
      const card = await tx.get(`manual_cards/${o.card_id}`);
      if (!card) throw httpError(404, 'البطاقة الأصلية غير موجودة');
      tx.update(`manual_cards/${o.card_id}`, { balance: round2(num(card.balance, 0) + num(o.amount, 0)), updated_at: nowIso(), last_topup_by: staff.uid });
    }
    tx.update(`manual_card_orders/${id}`, {
      status: 'completed', card_id: cardId, completed_at: nowIso(), completed_by: staff.uid,
      provider_ref: providerRef, reveal_expires_at: isCreate ? expiresAt : '',
      cvv_expires_ms: isCreate ? now + cvvMs : 0, updated_at: nowIso(),
    });
  });

  await logOp(env, staff.uid, 'card.fulfil', { id }, { cardId }, true);
  return { success: true, card_id: cardId, expires_at: expiresAt, cvv_window_min: Math.round(cvvMs / 60000) };
}

async function purgeExpiredReveals(env) {
  const now = Date.now();
  let purged = 0;
  const rows = await fsQueryRaw(env, { from: [{ collectionId: 'manual_card_reveal' }], limit: 300 });
  for (const r of rows) {
    const d = withId(r, 'manual_card_reveal');
    if (new Date(d.expires_at).getTime() < now) { await fsDelete(env, `manual_card_reveal/${d._id}`).catch(() => {}); purged++; }
  }
  return purged;
}

async function purgeExpiredCvv(env) {
  const now = Date.now();
  let purged = 0;
  const rows = await fsQueryRaw(env, { from: [{ collectionId: 'card_cvv_once' }], limit: 300 });
  for (const r of rows) {
    const d = withId(r, 'card_cvv_once');
    if (num(d.expires_ms, 0) < now) { await fsDelete(env, `card_cvv_once/${d._id}`).catch(() => {}); purged++; }
  }
  return purged;
}

/* ═══ Digital services ═══ */

async function handleServiceCreateOrder(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  const key = idemKeyOf(body);
  if (!(await checkRateLimit(env, `svc_${user.uid}`, 20, 3600))) throw httpError(429, 'محاولات كثيرة — حاول بعد ساعة');

  const serviceId = String(body.service_id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(serviceId)) throw httpError(400, 'اختر الخدمة');
  const svc = await fsGet(env, `services/${serviceId}`);
  if (!svc || svc.is_active === false) throw httpError(404, 'الخدمة غير متاحة');

  const defs = cleanServiceFields(svc.fields);
  const inputs = {}, sensitive = {};
  for (const f of defs) {
    const raw = body.inputs && body.inputs[f.key];
    const v = String(raw == null ? '' : raw).trim().slice(0, 300);
    if (f.required && !v) throw httpError(400, `${f.label} مطلوب`);
    if (!v) continue;
    if (f.type === 'number' && !Number.isFinite(Number(v))) throw httpError(400, `${f.label} يجب أن يكون رقماً`);
    if (f.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw httpError(400, `${f.label} غير صالح`);
    if (f.type === 'tel' && !/^[0-9+\-\s]{6,20}$/.test(v)) throw httpError(400, `${f.label} غير صالح`);
    if (f.type === 'select' && f.options && f.options.length && !f.options.includes(v)) throw httpError(400, `${f.label} غير صالح`);
    if (f.type === 'password') { sensitive[f.key] = v; inputs[f.key] = '••••••'; }
    else inputs[f.key] = v;
  }

  const orderId = `SVC${Date.now()}${randomSuffix(4)}`;
  const encInputs = Object.keys(sensitive).length ? await encryptV2(env, `svc:${orderId}`, sensitive) : null;

  const resp = await fsRunTransaction(env, async (tx) => {
    const hit = await idemRead(tx, user.uid, key); if (hit) return hit;
    const L = await ledgerOpen(tx, user.uid);
    if (L.doc.banned === true) throw httpError(403, 'الحساب موقوف');
    const sv = await tx.get(`services/${serviceId}`);
    if (!sv || sv.is_active === false) throw httpError(503, 'الخدمة غير متاحة');
    const price = round2(num(sv.price_usd, 0));
    if (!(price > 0)) throw httpError(400, 'سعر الخدمة غير صالح');
    const auto = sv.delivery_type !== 'manual';

    let code = '', stockId = '';
    if (auto) {
      const rows = await tx.query({
        from: [{ collectionId: 'service_stock' }],
        where: { compositeFilter: { op: 'AND', filters: [
          { fieldFilter: { field: { fieldPath: 'service_id' }, op: 'EQUAL', value: { stringValue: serviceId } } },
          { fieldFilter: { field: { fieldPath: 'is_used' }, op: 'EQUAL', value: { booleanValue: false } } },
        ] } },
        limit: 1,
      });
      if (!rows.length) throw httpError(409, 'نفد المخزون — تواصل مع الدعم');
      const row = withId(rows[0], 'service_stock');
      const fresh = await tx.get(`service_stock/${row._id}`);             // قفل المستند نفسه
      if (!fresh || fresh.is_used !== false) throw txAborted('stock taken');
      code = String(fresh.code || '').trim();
      stockId = row._id;
      if (!code) throw httpError(409, 'نفد المخزون — تواصل مع الدعم');
      tx.update(`service_stock/${stockId}`, { is_used: true, used_by: user.uid, used_at: nowIso(), order_id: orderId });
      tx.increment(`services/${serviceId}`, 'stock_count', -1);
    }

    await ledgerPost(L, { type: 'debit', amount: price, reason: 'service_order', reference: orderId, entryId: `txn_svc_${orderId}` });
    ledgerClose(tx, L, { total_spent: round2(num(L.doc.total_spent, 0) + price) });
    tx.increment(`services/${serviceId}`, 'sold_count', 1);

    tx.create('service_orders', orderId, {
      uid: user.uid, service_id: serviceId,
      service_name: String(sv.name || '').slice(0, 80), service_icon: String(sv.icon_emoji || '📦').slice(0, 8),
      service_icon_url: String(sv.icon_url || '').slice(0, 60000),
      price_usd: price, delivery_type: auto ? 'auto' : 'manual', inputs, encrypted_inputs: encInputs,
      status: auto ? 'delivered' : 'pending', delivered_data: code,
      delivered_at: auto ? nowIso() : '',
      delivered_expires_at: auto ? new Date(Date.now() + DELIVERED_TTL_DAYS * 86400000).toISOString() : '',
      stock_id: stockId, created_at: nowIso(), updated_at: nowIso(),
    });
    const r = { success: true, order: {
      id: orderId, status: auto ? 'delivered' : 'pending', service_name: sv.name || '',
      price_usd: price, delivered_data: code, delivery_type: auto ? 'auto' : 'manual',
    } };
    idemWrite(tx, user.uid, key, r);
    return r;
  });
  if (!resp.replayed) await logOp(env, user.uid, 'service.order', { serviceId }, { orderId: resp.order.id }, true);
  return resp;
}

async function handleAdminServiceOrder(user, body, env) {
  const staff = await requirePermission(user, env, 'order.fulfil');
  const orderId = String(body.id || '').trim();
  const action = body.action === 'reject' ? 'reject' : 'deliver';
  if (!orderId) throw httpError(400, 'رقم الطلب مفقود');
  const deliveredData = String(body.delivered_data || '').trim().slice(0, 2000);
  if (action === 'deliver' && !deliveredData) throw httpError(400, 'أدخل بيانات التسليم');

  await fsRunTransaction(env, async (tx) => {
    const o = await tx.get(`service_orders/${orderId}`);
    if (!o) throw httpError(404, 'الطلب غير موجود');
    if (o.status !== 'pending') throw httpError(409, 'الطلب مُغلق بالفعل');
    if (action === 'reject') {
      const L = await ledgerOpen(tx, o.uid);
      await ledgerPost(L, { type: 'credit', amount: num(o.price_usd, 0), reason: 'service_order_rejected', reference: orderId, entryId: `txn_svc_refund_${orderId}`, created_by: staff.uid });
      ledgerClose(tx, L, { total_spent: Math.max(0, round2(num(L.doc.total_spent, 0) - num(o.price_usd, 0))) });
      tx.update(`service_orders/${orderId}`, { status: 'rejected', rejected_reason: String(body.reason || '').slice(0, 200), rejected_at: nowIso(), rejected_by: staff.uid, updated_at: nowIso() });
    } else {
      tx.update(`service_orders/${orderId}`, {
        status: 'delivered', delivered_data: deliveredData, delivered_at: nowIso(),
        delivered_expires_at: new Date(Date.now() + DELIVERED_TTL_DAYS * 86400000).toISOString(),
        delivered_by: staff.uid, updated_at: nowIso(),
      });
    }
  });
  await logOp(env, staff.uid, 'service_order.' + action, { orderId }, {}, true);
  return { success: true };
}

async function handleAdminServiceOrderInputs(user, body, env) {
  const staff = await requirePermission(user, env, 'order.fulfil');
  const orderId = String(body.id || '').trim();
  const o = await fsGet(env, `service_orders/${orderId}`);
  if (!o) throw httpError(404, 'الطلب غير موجود');
  if (o.status !== 'pending') throw httpError(409, 'تُعرض البيانات للطلبات المعلّقة فقط');
  if (!o.encrypted_inputs) return { success: true, inputs: {} };
  let inputs;
  try { inputs = await decryptAny(env, `svc:${orderId}`, o.encrypted_inputs); }
  catch { throw httpError(500, 'تعذّر فك التشفير'); }
  await logOp(env, staff.uid, 'service_order.reveal_inputs', { orderId }, {}, true);
  return { success: true, inputs };
}

/* ═══ Store ═══ */

async function handleStoreOrder(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.store_enabled === false) throw httpError(503, 'المتجر متوقف مؤقتًا');
  const key = idemKeyOf(body);
  if (!(await checkRateLimit(env, `store_${user.uid}`, 30, 3600))) throw httpError(429, 'محاولات كثيرة — حاول بعد ساعة');

  const rawItems = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
  if (!rawItems.length) throw httpError(400, 'السلة فارغة');
  const merged = new Map();
  for (const it of rawItems) {
    const pid = String(it && it.id || '').trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(pid)) throw httpError(400, 'منتج غير صالح');
    const qty = Math.floor(num(it && it.qty, 1));
    if (!(qty >= 1 && qty <= 20)) throw httpError(400, 'كمية غير صالحة');
    if (merged.has(pid)) throw httpError(400, 'منتج مكرر في السلة');
    merged.set(pid, { pid, qty, values: (it && it.values) || {} });
  }
  const couponCode = String(body.coupon || '').trim().toUpperCase().slice(0, 40);
  const rateVal = num(s.usd_to_lyd, 11.8);
  const orderId = `ORD${Date.now()}${randomSuffix(4)}`;

  const resp = await fsRunTransaction(env, async (tx) => {
    const hit = await idemRead(tx, user.uid, key); if (hit) return hit;
    const L = await ledgerOpen(tx, user.uid);
    if (L.doc.banned === true) throw httpError(403, 'الحساب موقوف');

    const lines = [];
    let totalLyd = 0;
    for (const it of merged.values()) {
      const p = await tx.get(`products/${it.pid}`);
      if (!p || p.active === false) throw httpError(404, 'منتج غير متاح');
      const kind = p.kind === 'stock' ? 'stock' : 'manual';
      const vals = {};
      for (const f of cleanProductFields(p.fields)) {
        const v = String(it.values[f.key] || '').trim().slice(0, 120);
        if (f.required && !v) throw httpError(400, `${f.label} مطلوب`);
        if (v) vals[f.key] = v;
      }
      const pr = proration(p, Date.now());
      if (pr && pr.state !== 'active') throw httpError(409, 'المنتج غير متاح');
      const price = pr ? pr.price : round2(num(p.price, 0));
      if (!(price > 0)) throw httpError(400, 'سعر غير صالح');
      totalLyd = round2(totalLyd + price * it.qty);

      let codes = null;
      if (kind === 'stock') {
        const rows = await tx.query({
          from: [{ collectionId: 'stock' }],
          where: { compositeFilter: { op: 'AND', filters: [
            { fieldFilter: { field: { fieldPath: 'pid' }, op: 'EQUAL', value: { stringValue: it.pid } } },
            { fieldFilter: { field: { fieldPath: 'used' }, op: 'EQUAL', value: { booleanValue: false } } },
          ] } },
          limit: it.qty,
        });
        if (rows.length < it.qty) throw httpError(409, 'الكمية غير متوفرة');
        codes = [];
        for (const r of rows) {
          const st = withId(r, 'stock');
          tx.update(`stock/${st._id}`, { used: true, used_at: nowIso(), used_by: user.uid, order_id: orderId });
          codes.push(String(st.code || ''));
        }
        tx.increment(`products/${it.pid}`, 'stock_count', -it.qty);
      }
      lines.push({ pid: it.pid, qty: it.qty, kind, values: vals, name: p.name || '', image: p.image || '',
        price_lyd: price, line_lyd: round2(price * it.qty), days_left: pr ? pr.days_left : null,
        ends_at: pr ? pr.ends_at : '', codes });
    }

    let discountLyd = 0;
    if (couponCode) {
      if (s.coupons_enabled === false) throw httpError(503, 'الكوبونات متوقفة');
      const cp = await tx.get(`coupons/${couponCode}`);
      const use = await tx.get(`coupon_uses/${couponCode}_${user.uid}`);
      discountLyd = couponDiscount(cp, use, totalLyd);
      tx.update(`coupons/${couponCode}`, { used_count: num(cp.used_count, 0) + 1 });
      if (cp.once_per_user !== false) tx.create('coupon_uses', `${couponCode}_${user.uid}`, { uid: user.uid, code: couponCode, order_id: orderId, at: nowIso() });
      totalLyd = round2(totalLyd - discountLyd);
    }
    const totalUsd = round2(totalLyd / rateVal);
    if (!(totalUsd > 0)) throw httpError(400, 'إجمالي غير صالح');

    await ledgerPost(L, { type: 'debit', amount: totalUsd, reason: 'store_order', reference: orderId, entryId: `txn_order_${orderId}` });
    const extra = { total_spent: round2(num(L.doc.total_spent, 0) + totalUsd) };

    if (s.points_enabled === true) {
      const pts = Math.floor(totalLyd * num(s.points_per_lyd, 1));
      if (pts > 0) extra.points = Math.floor(num(L.doc.points, 0)) + pts;
    }

    // مكافأة الإحالة — داخل نفس المعاملة وبقيد في السجل
    if (s.referral_enabled === true && L.doc.referred_by && L.doc.referral_paid !== true
        && extra.total_spent >= num(s.referral_min_spend, 10) && L.doc.referred_by !== user.uid) {
      const inv = round2(num(s.referral_bonus_invitee, 1)), invr = round2(num(s.referral_bonus_inviter, 1));
      extra.referral_paid = true;
      if (inv > 0) await ledgerPost(L, { type: 'credit', amount: inv, reason: 'referral_bonus_invitee', reference: orderId, entryId: `txn_ref_in_${orderId}` });
      if (invr > 0) {
        const R = await ledgerOpen(tx, L.doc.referred_by);
        await ledgerPost(R, { type: 'credit', amount: invr, reason: 'referral_bonus_inviter', reference: orderId, entryId: `txn_ref_out_${orderId}` });
        ledgerClose(tx, R, { referrals_count: Math.floor(num(R.doc.referrals_count, 0)) + 1 });
      }
    }
    ledgerClose(tx, L, extra);

    const allStock = lines.every(l => l.kind === 'stock');
    tx.create('orders', orderId, {
      uid: user.uid, items: lines, coupon: couponCode, discount_lyd: discountLyd,
      total_lyd: totalLyd, total_usd: totalUsd, rate: rateVal,
      status: allStock ? 'completed' : 'pending', created_at: nowIso(), updated_at: nowIso(),
    });
    const r = { success: true, order: { id: orderId, status: allStock ? 'completed' : 'pending',
      total_lyd: totalLyd, total_usd: totalUsd,
      items: lines.map(l => ({ name: l.name, qty: l.qty, codes: l.codes })) } };
    idemWrite(tx, user.uid, key, r);
    return r;
  });
  if (!resp.replayed) await logOp(env, user.uid, 'store.order', { items: merged.size }, { orderId: resp.order.id }, true);
  return resp;
}

async function handleAdminOrder(user, body, env) {
  const staff = await requirePermission(user, env, 'order.fulfil');
  const id = String(body.order_id || '').trim();
  const action = body.action === 'reject' ? 'reject' : 'complete';
  if (!id) throw httpError(400, 'رقم الطلب مفقود');

  await fsRunTransaction(env, async (tx) => {
    const o = await tx.get(`orders/${id}`);
    if (!o) throw httpError(404, 'الطلب غير موجود');
    if (o.status !== 'pending' && o.status !== 'processing') throw httpError(409, 'الطلب مُغلق');
    if (action === 'reject') {
      const back = round2(num(o.total_usd, 0));
      const L = await ledgerOpen(tx, o.uid);
      await ledgerPost(L, { type: 'credit', amount: back, reason: 'order_rejected', reference: id, entryId: `txn_order_refund_${id}`, created_by: staff.uid });
      ledgerClose(tx, L, { total_spent: Math.max(0, round2(num(L.doc.total_spent, 0) - back)) });
      tx.update(`orders/${id}`, { status: 'rejected', reject_reason: String(body.reason || '').slice(0, 160), reviewed_by: staff.uid, updated_at: nowIso() });
    } else {
      tx.update(`orders/${id}`, { status: 'completed', delivery: String(body.delivery || '').slice(0, 900), reviewed_by: staff.uid, updated_at: nowIso() });
    }
  });
  await logOp(env, staff.uid, 'order.' + action, { id }, {}, true);
  return { success: true, refunded: action === 'reject' };
}

/* ═══ Coupons ═══ */

function couponDiscount(cp, use, subtotalLyd) {
  if (!cp || cp.active === false) throw httpError(404, 'كوبون غير صالح');
  if (cp.expires_at && new Date(cp.expires_at).getTime() < Date.now()) throw httpError(400, 'انتهت صلاحية الكوبون');
  const maxUses = num(cp.max_uses, 0);
  if (maxUses > 0 && num(cp.used_count, 0) >= maxUses) throw httpError(400, 'استُنفد هذا الكوبون');
  const minOrder = num(cp.min_order_lyd, 0);
  if (minOrder > 0 && subtotalLyd < minOrder) throw httpError(400, `الكوبون يتطلب طلبًا بـ${minOrder} د.ل`);
  if (use && cp.once_per_user !== false) throw httpError(400, 'استخدمت هذا الكوبون من قبل');
  const pct = Math.min(100, Math.max(0, num(cp.percent, 0)));
  let off = pct > 0 ? subtotalLyd * pct / 100 : Math.max(0, num(cp.amount_lyd, 0));
  const cap = num(cp.max_off_lyd, 0);
  if (cap > 0 && off > cap) off = cap;
  return round2(Math.min(off, subtotalLyd));
}

async function handleCouponCheck(user, body, env) {
  const sub = round2(num(body.subtotal_lyd, 0));
  if (!(sub > 0)) throw httpError(400, 'السلة فارغة');
  const c = String(body.code || '').trim().toUpperCase().slice(0, 40);
  if (!/^[A-Z0-9_-]{2,40}$/.test(c)) throw httpError(400, 'كوبون غير صالح');
  if (!(await checkRateLimit(env, `cpn_${user.uid}`, 20, 3600))) throw httpError(429, 'محاولات كثيرة');
  const [cp, use] = await Promise.all([fsGet(env, `coupons/${c}`), fsGet(env, `coupon_uses/${c}_${user.uid}`)]);
  const off = couponDiscount(cp, use, sub);
  return { success: true, coupon: { code: c, off_lyd: off, percent: num(cp.percent, 0), fixed: num(cp.amount_lyd, 0) } };
}

async function handleAdminCouponSave(user, body, env) {
  const staff = await requirePermission(user, env, 'coupon.manage');
  const code = String(body.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(code)) throw httpError(400, 'رمز الكوبون: حروف لاتينية وأرقام فقط');
  const percent = num(body.percent, 0), amount = num(body.amount_lyd, 0);
  if (percent < 0 || percent > 100 || amount < 0 || amount > 100000) throw httpError(400, 'قيمة الخصم غير صالحة');
  if (!(percent > 0) && !(amount > 0)) throw httpError(400, 'حدّد نسبة أو مبلغ خصم');
  const exp = String(body.expires_at || '').trim();
  if (exp && !Number.isFinite(Date.parse(exp))) throw httpError(400, 'تاريخ غير صالح');
  const data = {
    code, active: body.active !== false, percent, amount_lyd: amount,
    max_off_lyd: Math.max(0, num(body.max_off_lyd, 0)), min_order_lyd: Math.max(0, num(body.min_order_lyd, 0)),
    max_uses: Math.max(0, Math.floor(num(body.max_uses, 0))), once_per_user: body.once_per_user !== false,
    expires_at: exp, updated_at: nowIso(), updated_by: staff.uid,
  };
  await fsRunTransaction(env, async (tx) => {
    const cur = await tx.get(`coupons/${code}`);
    tx.update(`coupons/${code}`, cur ? data : { ...data, used_count: 0, created_at: nowIso() }, !!cur);
  });
  await logOp(env, staff.uid, 'coupon.save', { code }, data, true);
  return { success: true, code };
}

async function handleAdminCouponDelete(user, body, env) {
  const staff = await requirePermission(user, env, 'coupon.manage');
  const code = String(body.code || body.id || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(code)) throw httpError(400, 'رمز غير صالح');
  await fsDelete(env, `coupons/${code}`);
  await logOp(env, staff.uid, 'coupon.delete', { code }, {}, true);
  return { success: true };
}

/* ═══ Points & referrals ═══ */

async function handleRedeemPoints(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.points_enabled !== true) throw httpError(503, 'نظام النقاط غير مفعّل');
  const key = idemKeyOf(body, false);
  const pts = Math.floor(num(body.points, 0));
  const minP = num(s.points_min_redeem, 100);
  if (!(pts >= minP) || pts > 1e7) throw httpError(400, `الحد الأدنى ${minP} نقطة`);
  const lydVal = round2(pts * num(s.points_value_lyd, 0.01));
  const usdVal = round2(lydVal / num(s.usd_to_lyd, 11.8));
  if (!(usdVal > 0)) throw httpError(400, 'قيمة غير صالحة');
  const id = `PTS${Date.now()}${randomSuffix(4)}`;

  const resp = await fsRunTransaction(env, async (tx) => {
    const hit = await idemRead(tx, user.uid, key); if (hit) return hit;
    const L = await ledgerOpen(tx, user.uid);
    const have = Math.floor(num(L.doc.points, 0));
    if (have < pts) throw httpError(400, 'نقاطك غير كافية');
    await ledgerPost(L, { type: 'credit', amount: usdVal, reason: 'points_redeem', reference: id, entryId: `txn_pts_${id}` });
    ledgerClose(tx, L, { points: have - pts });
    tx.create('wallet_deposits', id, {
      uid: user.uid, amount_usd: usdVal, amount_lyd: lydVal, method: 'استبدال نقاط', proof_url: '',
      note: pts + ' نقطة', status: 'approved', auto: true, created_at: nowIso(),
    });
    const r = { success: true, credited: usdVal };
    idemWrite(tx, user.uid, key, r);
    return r;
  });
  if (!resp.replayed) await logOp(env, user.uid, 'points.redeem', { pts }, { usdVal }, true);
  return resp;
}

async function handleRefCode(user, body, env) {
  const s = await getSettings(env);
  if (s.referral_enabled !== true) throw httpError(503, 'نظام الدعوات غير مفعّل');
  const me = await fsGet(env, `users/${user.uid}`);
  if (me && me.ref_code) return { success: true, code: me.ref_code, bonus: num(s.referral_bonus_invitee, 1) };

  for (let i = 0; i < 8; i++) {
    const c = makeRefCode();
    const ok = await fsRunTransaction(env, async (tx) => {
      const u = await tx.get(`users/${user.uid}`);
      if (!u) throw httpError(400, 'الحساب غير مكتمل');
      if (u.ref_code) return u.ref_code;
      if (await tx.get(`ref_codes/${c}`)) return null;
      tx.create('ref_codes', c, { uid: user.uid, created_at: nowIso() });
      tx.update(`users/${user.uid}`, { ref_code: c });
      return c;
    });
    if (ok) return { success: true, code: ok, bonus: num(s.referral_bonus_invitee, 1) };
  }
  throw httpError(503, 'تعذّر توليد الرمز');
}

async function handleRefClaim(user, body, env) {
  const s = await getSettings(env);
  if (s.referral_enabled !== true) throw httpError(503, 'نظام الدعوات غير مفعّل');
  const code = String(body.code || '').trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) throw httpError(400, 'رمز غير صحيح');
  if (!(await checkRateLimit(env, `refc_${user.uid}`, 5, 86400))) throw httpError(429, 'محاولات كثيرة');

  const owner = await fsGet(env, `ref_codes/${code}`);
  if (!owner || !owner.uid) throw httpError(404, 'الرمز غير موجود');
  if (owner.uid === user.uid) throw httpError(400, 'لا يمكنك استخدام رمزك');
  if (!(await checkRateLimit(env, `refo_${owner.uid}`, 5, 86400))) throw httpError(429, 'هذا الرمز تجاوز حدّه اليومي — حاول غدًا');

  await fsRunTransaction(env, async (tx) => {
    const me = await tx.get(`users/${user.uid}`);
    if (!me) throw httpError(400, 'الحساب غير مكتمل');
    if (me.referred_by) throw httpError(400, 'استخدمت رمز دعوة من قبل');
    if (num(me.total_spent, 0) > 0) throw httpError(400, 'رمز الدعوة للحسابات الجديدة فقط');
    tx.update(`users/${user.uid}`, { referred_by: owner.uid, referred_code: code, referral_paid: false });
  });
  return { success: true, bonus: num(s.referral_bonus_invitee, 1), min_spend: num(s.referral_min_spend, 10) };
}

/* ═══ Admin — services & stock ═══ */

async function handleAdminServiceSave(user, body, env) {
  const staff = await requirePermission(user, env, 'service.manage');
  const id = String(body.id || '').trim();
  const name = String(body.name || '').trim().slice(0, 80);
  if (name.length < 2) throw httpError(400, 'اسم الخدمة مطلوب');
  const price = money(body.price_usd, { min: 0.01, max: 100000 });
  if (!Number.isFinite(price)) throw httpError(400, 'السعر يجب أن يكون أكبر من صفر');
  const data = {
    name, desc: String(body.desc || '').slice(0, 200),
    icon_emoji: String(body.icon_emoji || '📦').slice(0, 8), icon_url: sanitizeIconUrl(body.icon_url),
    price_usd: price, delivery_type: body.delivery_type === 'manual' ? 'manual' : 'auto',
    fields: cleanServiceFields(body.fields), is_active: body.is_active !== false,
    sort: Math.floor(num(body.sort, 100)), updated_at: nowIso(),
  };
  if (id) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw httpError(400, 'معرّف غير صالح');
    const before = await fsGet(env, `services/${id}`);
    if (!before) throw httpError(404, 'الخدمة غير موجودة');
    await fsPatch(env, `services/${id}`, data);
    await logOp(env, staff.uid, 'service.update', { id, price_before: before.price_usd }, { price_after: price }, true);
    return { success: true, id, updated: true };
  }
  const newId = `SRV${Date.now()}${randomSuffix(4)}`;
  await fsSet(env, `services/${newId}`, { ...data, stock_count: 0, sold_count: 0, created_at: nowIso() });
  await logOp(env, staff.uid, 'service.create', { id: newId, name }, {}, true);
  return { success: true, id: newId, created: true };
}

async function handleAdminServiceDelete(user, body, env) {
  const staff = await requirePermission(user, env, 'service.manage');
  const id = String(body.id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw httpError(400, 'معرّف الخدمة مفقود');
  if (!(await fsGet(env, `services/${id}`))) throw httpError(404, 'الخدمة غير موجودة');
  await fsDelete(env, `services/${id}`);
  await logOp(env, staff.uid, 'service.delete', { id }, {}, true);
  return { success: true };
}

async function handleAdminStockAdd(user, body, env) {
  const staff = await requirePermission(user, env, 'stock.manage');
  const serviceId = String(body.service_id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(serviceId)) throw httpError(400, 'اختر الخدمة');
  if (!(await fsGet(env, `services/${serviceId}`))) throw httpError(404, 'الخدمة غير موجودة');

  let codes = [];
  if (body.bulk_text) codes = String(body.bulk_text).split(/\r?\n/);
  else if (Array.isArray(body.codes)) codes = body.codes;
  else if (body.code) codes = [body.code];
  codes = [...new Set(codes.map(x => String(x).trim().slice(0, 500)).filter(Boolean))];
  if (!codes.length) throw httpError(400, 'لا توجد أكواد للإضافة');
  if (codes.length > 500) throw httpError(400, 'الحد الأقصى 500 كود في المرة');

  let added = 0;
  for (let i = 0; i < codes.length; i += 200) {
    const chunk = codes.slice(i, i + 200);
    const writes = chunk.map(code => write(env, `service_stock/STK${Date.now()}${randomSuffix(8)}`, {
      service_id: serviceId, code, is_used: false, used_by: '', used_at: '', order_id: '',
      created_at: nowIso(), created_by: staff.uid,
    }));
    writes.push({ transform: { document: docPath(env, `services/${serviceId}`),
      fieldTransforms: [{ fieldPath: 'stock_count', increment: { integerValue: String(chunk.length) } }] } });
    await fsCommit(env, writes);                     // ذرّي: الأكواد والعدّاد معًا
    added += chunk.length;
  }
  await logOp(env, staff.uid, 'stock.add', { serviceId, count: added }, {}, true);
  return { success: true, added };
}

async function handleAdminStockDelete(user, body, env) {
  const staff = await requirePermission(user, env, 'stock.manage');
  const id = String(body.id || '').trim();
  if (!id) throw httpError(400, 'معرّف الكود مفقود');
  await fsRunTransaction(env, async (tx) => {
    const row = await tx.get(`service_stock/${id}`);
    if (!row) throw httpError(404, 'الكود غير موجود');
    if (row.is_used !== false) throw httpError(400, 'لا يمكن حذف كود مستخدم');
    tx.delete(`service_stock/${id}`);
    if (row.service_id) tx.increment(`services/${row.service_id}`, 'stock_count', -1);
  });
  await logOp(env, staff.uid, 'stock.delete', { id }, {}, true);
  return { success: true };
}

async function handleAdminStockList(user, body, env) {
  const staff = await requirePermission(user, env, 'stock.manage');
  const serviceId = String(body.service_id || '').trim();
  if (!serviceId) throw httpError(400, 'معرّف الخدمة مفقود');
  const reveal = body.reveal === true;
  if (reveal && !staffCan(staff, 'stock.reveal')) throw httpError(403, 'كشف الأكواد يتطلب super_admin');

  const filterUsed = body.filter === 'used' ? true : body.filter === 'unused' ? false : null;
  const filters = [{ fieldFilter: { field: { fieldPath: 'service_id' }, op: 'EQUAL', value: { stringValue: serviceId } } }];
  if (filterUsed !== null) filters.push({ fieldFilter: { field: { fieldPath: 'is_used' }, op: 'EQUAL', value: { booleanValue: filterUsed } } });
  const rows = await fsQueryRaw(env, { from: [{ collectionId: 'service_stock' }], where: { compositeFilter: { op: 'AND', filters } }, limit: 200 });

  const items = rows.map(r => withId(r, 'service_stock'))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .map(x => ({ id: x._id, code: reveal ? (x.code || '') : maskCode(x.code || ''), code_masked: !reveal,
      is_used: x.is_used === true, used_by: x.used_by || '', used_at: x.used_at || '', order_id: x.order_id || '', created_at: x.created_at }));
  if (reveal) await logOp(env, staff.uid, 'stock.reveal', { serviceId, count: items.length }, {}, true);
  return { success: true, items, stats: { unused: items.filter(x => !x.is_used).length, used: items.filter(x => x.is_used).length, total: items.length } };
}

/* ═══ Admin — staff, users, tickets, settings, SMS ═══ */

async function handleAdminMe(user, body, env) {
  const staff = await getStaff(env, user.uid);
  if (!staff) throw httpError(403, 'غير مصرّح');
  const all = ['deposit.review', 'withdraw.review', 'wallet.adjust', 'coupon.manage', 'sms.assign', 'ledger.verify',
    'user.read', 'user.ban', 'user.manage', 'ticket.manage', 'service.manage', 'stock.manage', 'stock.reveal',
    'card.fulfil', 'order.fulfil', 'settings.manage', 'staff.manage'];
  await fsPatch(env, `admins/${user.uid}`, { last_login: nowIso() }).catch(() => {});
  return { success: true, uid: user.uid, role: staff.role, permissions: all.filter(p => staffCan(staff, p)) };
}

async function handleAdminStaffSet(user, body, env) {
  const staff = await requirePermission(user, env, 'staff.manage');
  const uid = String(body.uid || '').trim();
  const role = String(body.role || '').trim();
  if (!/^[A-Za-z0-9]{10,64}$/.test(uid)) throw httpError(400, 'معرّف غير صالح');
  if (uid === staff.uid) throw httpError(400, 'لا يمكنك تعديل دورك بنفسك');
  if (role && !ROLE_PERMISSIONS[role]) throw httpError(400, 'دور غير معروف');
  if (!(await fsGet(env, `users/${uid}`))) throw httpError(404, 'المستخدم غير موجود');
  const perms = Array.isArray(body.permissions) ? body.permissions.map(String).filter(p => /^[a-z]+\.[a-z_]+$/.test(p)).slice(0, 20) : [];
  if (!role) {
    await fsDelete(env, `admins/${uid}`);
  } else {
    await fsSet(env, `admins/${uid}`, { uid, role, permissions: perms, disabled: false, created_by: staff.uid, created_at: nowIso() });
  }
  await logOp(env, staff.uid, 'staff.set', { uid, role: role || 'removed', perms }, {}, true);
  return { success: true };
}

async function handleAdminUserBan(user, body, env) {
  const staff = await requirePermission(user, env, 'user.ban');
  const uid = String(body.uid || '').trim();
  const ban = body.banned === true;
  const reason = String(body.reason || '').trim().slice(0, 200);
  if (!uid) throw httpError(400, 'معرّف المستخدم مفقود');
  if (uid === staff.uid) throw httpError(400, 'لا يمكنك إيقاف نفسك');
  if (ban && reason.length < 3) throw httpError(400, 'السبب مطلوب');
  const target = await getStaff(env, uid);
  if (target && staff.role !== 'super_admin') throw httpError(403, 'إيقاف حساب إداري يتطلب super_admin');
  await fsRunTransaction(env, async (tx) => {
    const u = await tx.get(`users/${uid}`);
    if (!u) throw httpError(404, 'المستخدم غير موجود');
    tx.update(`users/${uid}`, { banned: ban, banned_at: ban ? nowIso() : '', ban_reason: ban ? reason : '', banned_by: staff.uid });
  });
  await logOp(env, staff.uid, ban ? 'user.ban' : 'user.unban', { uid, reason }, {}, true);
  return { success: true, banned: ban };
}

async function handleAdminPhoneUnbind(user, body, env) {
  const staff = await requirePermission(user, env, 'user.manage');
  const uid = String(body.uid || '').trim();
  const reason = String(body.reason || '').trim().slice(0, 200);
  if (!uid) throw httpError(400, 'معرّف المستخدم مفقود');
  if (reason.length < 3) throw httpError(400, 'السبب مطلوب');
  let phone = '';
  await fsRunTransaction(env, async (tx) => {
    const u = await tx.get(`users/${uid}`);
    if (!u || !u.phone_verified) throw httpError(404, 'لا يوجد رقم موثّق');
    phone = u.phone_verified;
    tx.delete(`phone_bindings/${phone}`);
    tx.update(`users/${uid}`, { phone_verified: '', phone_verified_at: '' });
  });
  await logOp(env, staff.uid, 'user.phone_unbind', { uid, phone, reason }, {}, true);
  return { success: true };
}

async function handleAdminSmsAssign(user, body, env) {
  const staff = await requirePermission(user, env, 'sms.assign');
  const smsId = String(body.sms_id || '').trim();
  const uid = String(body.uid || '').trim();
  const reason = String(body.reason || 'ربط يدوي').slice(0, 200);
  if (!smsId || !uid) throw httpError(400, 'بيانات ناقصة');

  const credited = await fsRunTransaction(env, async (tx) => {
    const sms = await tx.get(`sms_transactions/${smsId}`);
    if (!sms) throw httpError(404, 'الحوالة غير موجودة');
    if (sms.status === 'claimed') throw httpError(409, 'مربوطة بالفعل');
    const amt = round2(num(sms.amount_usd, 0));
    if (!(amt > 0)) throw httpError(400, 'مبلغ غير صالح');
    const L = await ledgerOpen(tx, uid);
    await ledgerPost(L, { type: 'credit', amount: amt, reason: 'sms_manual', note: reason, reference: smsId, entryId: `txn_sms_manual_${smsId}`, created_by: staff.uid });
    ledgerClose(tx, L);
    tx.update(`sms_transactions/${smsId}`, { status: 'claimed', uid, claimed_at: nowIso(), claimed_by: staff.uid });
    tx.create('wallet_deposits', `SMSM_${smsId.slice(0, 40)}`, {
      uid, amount_usd: amt, amount_lyd: num(sms.amount_lyd, 0),
      method: (sms.method === 'almadar' ? 'المدار' : 'ليبيانا') + ' — ربط يدوي', proof_url: '',
      note: 'حوالة من 0' + (sms.sender || '—'), status: 'approved', auto: false, created_at: nowIso(),
    });
    return amt;
  });
  await logOp(env, staff.uid, 'sms.assign', { smsId, uid, reason }, { credited }, true);
  return { success: true, credited };
}

async function handleTicketCreate(user, body, env) {
  const s = await getSettings(env);
  if (s.tickets_enabled === false) throw httpError(503, 'الدعم غير متاح حاليًا');
  const subject = String(body.subject || '').trim().slice(0, 120);
  const msg = String(body.message || '').trim().slice(0, 1500);
  if (subject.length < 3) throw httpError(400, 'اكتب موضوع التذكرة');
  if (!msg) throw httpError(400, 'اكتب رسالتك');
  if (!(await checkRateLimit(env, `tkt_${user.uid}`, 5, 86400))) throw httpError(429, 'تذاكر كثيرة — حاول غدًا');
  const id = `TIC${Date.now()}${randomSuffix(4)}`;
  await fsSet(env, `tickets/${id}`, {
    uid: user.uid, subject, order_id: String(body.order_id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40),
    status: 'open', messages: [{ by: 'user', text: msg, at: nowIso() }], created_at: nowIso(), updated_at: nowIso(),
  });
  return { success: true, id };
}

async function handleTicketReply(user, body, env) {
  const id = String(body.id || '').trim();
  const msg = String(body.message || '').trim().slice(0, 1500);
  if (!id || !msg) throw httpError(400, 'بيانات ناقصة');
  const staff = await getStaff(env, user.uid);
  const asStaff = staffCan(staff, 'ticket.manage');
  if (!asStaff && !(await checkRateLimit(env, `tktr_${user.uid}`, 30, 3600))) throw httpError(429, 'محاولات كثيرة');

  await fsRunTransaction(env, async (tx) => {
    const t = await tx.get(`tickets/${id}`);
    if (!t) throw httpError(404, 'التذكرة غير موجودة');
    if (!asStaff && t.uid !== user.uid) throw httpError(404, 'التذكرة غير موجودة');
    if (t.status === 'closed' && !asStaff) throw httpError(400, 'التذكرة مغلقة');
    const msgs = Array.isArray(t.messages) ? t.messages : [];
    msgs.push({ by: asStaff ? 'admin' : 'user', text: msg, at: nowIso() });
    tx.update(`tickets/${id}`, { messages: msgs.slice(-40), status: asStaff ? 'answered' : 'open', updated_at: nowIso() });
  });
  if (asStaff) await logOp(env, user.uid, 'ticket.reply', { id }, {}, true);
  return { success: true };
}

async function handleTicketClose(user, body, env) {
  const staff = await requirePermission(user, env, 'ticket.manage');
  const id = String(body.id || '').trim();
  if (!id) throw httpError(400, 'رقم التذكرة مفقود');
  if (!(await fsGet(env, `tickets/${id}`))) throw httpError(404, 'التذكرة غير موجودة');
  await fsPatch(env, `tickets/${id}`, { status: 'closed', closed_by: staff.uid, updated_at: nowIso() });
  await logOp(env, staff.uid, 'ticket.close', { id }, {}, true);
  return { success: true };
}

async function handleAdminSettings(user, body, env) {
  const staff = await requirePermission(user, env, 'settings.manage');
  const ops = sanitizeSettingsPatch(body || {});
  if (!Object.keys(ops).length) throw httpError(400, 'لا يوجد شيء للتحديث');
  const before = (await fsGet(env, 'settings/main')) || {};
  await fsPatch(env, 'settings/main', ops);
  const diff = {};
  for (const k of Object.keys(ops)) {
    if (/_logo$|^banners$|_fields$|^custom_methods$/.test(k)) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(ops[k])) diff[k] = { from: before[k] ?? null, to: ops[k] };
  }
  await logOp(env, staff.uid, 'settings.update', diff, {}, true);
  return { success: true, updated: Object.keys(ops) };
}

async function tryPhoneVerification(env, parsed, network, record, fingerprint, rate) {
  const pv = await fsGet(env, `phone_verifications/${parsed.sender}`).catch(() => null);
  if (!pv || pv.status !== 'pending') return null;
  if (num(pv.expires_ms, 0) < Date.now()) return null;
  if (Math.abs(num(pv.amount_lyd, -1) - parsed.amount_lyd) > 0.0005) return null;

  const credited = round2(parsed.amount_lyd / rate);
  await fsRunTransaction(env, async (tx) => {
    const cur = await tx.get(`phone_verifications/${parsed.sender}`);
    if (!cur || cur.status !== 'pending' || cur.uid !== pv.uid) throw httpError(409, 'DUPLICATE');
    const bind = await tx.get(`phone_bindings/${parsed.sender}`);
    if (bind && bind.uid !== pv.uid) throw httpError(409, 'BOUND_ELSEWHERE');
    const L = await ledgerOpen(tx, pv.uid);
    await ledgerPost(L, { type: 'credit', amount: credited, reason: 'phone_verification_deposit', reference: fingerprint, entryId: `txn_pv_${fingerprint}` });
    ledgerClose(tx, L, { phone_verified: parsed.sender, phone_verified_at: nowIso(), phone: '0' + parsed.sender });
    if (!bind) tx.create('phone_bindings', parsed.sender, { uid: pv.uid, network, created_at: nowIso() });
    tx.update(`phone_verifications/${parsed.sender}`, { status: 'done', done_at: nowIso() });
    tx.create('sms_transactions', fingerprint, { ...record, status: 'claimed', uid: pv.uid, claimed_at: nowIso(), matched_by: 'phone_verification' });
    tx.create('wallet_deposits', `PV_${fingerprint.slice(0, 24)}`, {
      uid: pv.uid, amount_usd: credited, amount_lyd: parsed.amount_lyd, method: 'توثيق رقم الهاتف',
      claim_phone: parsed.sender, proof_url: '', note: 'حوالة توثيق', status: 'approved', auto: true, created_at: nowIso(),
    });
  });
  await logOp(env, pv.uid, 'phone.verified', { phone: parsed.sender }, { credited }, true);
  return { success: true, parsed: true, matched: true, via: 'phone_verification', credited_usd: credited };
}

async function handleSmsWebhook(request, env) {
  if (request.method !== 'POST') throw httpError(405, 'method');
  const provided = request.headers.get('x-sms-secret') || '';
  const expected = env.SMS_WEBHOOK_SECRET || '';
  if (!expected || expected.length < 16 || !(await safeEqual(provided, expected))) {
    console.warn('SMS_WEBHOOK_UNAUTHORIZED');
    throw httpError(401, 'unauthorized');
  }

  const ctype = (request.headers.get('content-type') || '').toLowerCase();
  let rawBody = '';
  try { rawBody = (await request.text()).slice(0, 16000); } catch { rawBody = ''; }
  let body = {};
  if (rawBody) {
    if (ctype.includes('json') || /^\s*\{/.test(rawBody)) {
      try { body = JSON.parse(rawBody); } catch { body = salvageJson(rawBody); }
    } else if (ctype.includes('x-www-form-urlencoded')) {
      body = Object.fromEntries(new URLSearchParams(rawBody));
    }
  }

  const text = String(body.text || body.message || body.body || body.msg || body.content ||
    (ctype.includes('json') ? '' : rawBody) || '').slice(0, 1000);
  const receivedAt = String(body.receivedAt || body.timestamp || body.date || nowIso()).slice(0, 40);
  const smsId = String(body.sms_id || body.id || '').trim().slice(0, 120);
  const from = String(body.from || body.sender || '').trim().slice(0, 60);

  const parsed = parseTransferSms(text);
  const s0 = await getSettings(env);
  const allow = String(s0.sms_allowed_senders || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const senderOk = allow.length > 0 && allow.some(a => from.toLowerCase().includes(a));

  const fingerprint = smsId
    ? await sha256Hex('id:' + smsId)
    : await sha256Hex(String(text).trim() + '|' + receivedAt);

  const existing = await fsGet(env, `sms_transactions/${fingerprint}`);
  if (existing) return { success: true, duplicate: true, status: existing.status };

  if (!parsed) {
    await fsSet(env, `sms_transactions/${fingerprint}`, { raw_text: text.slice(0, 500), from, status: 'unparsed', received_at: receivedAt, created_at: nowIso() });
    return { success: true, parsed: false };
  }

  const fromNet = detectNetwork(from);
  const network = fromNet || parsed.text_network;
  const rate = network === 'almadar' ? num(s0.rate_almadar, 12.5) : num(s0.rate_libyana, 11.8);
  const amountUsd = round2(parsed.amount_lyd / rate);
  const record = {
    raw_text: text.slice(0, 500), amount_lyd: parsed.amount_lyd, amount_usd: amountUsd, rate,
    sender: parsed.sender, from, method: network, received_at: receivedAt, created_at: nowIso(),
  };

  let hold = '';
  if (!senderOk) hold = 'untrusted_sender';
  else if (fromNet && fromNet !== parsed.text_network) hold = 'network_mismatch';
  else if (parsed.amount_lyd > num(s0.max_deposit_lyd, 5000)) hold = 'amount_over_max';
  if (hold) {
    await fsSet(env, `sms_transactions/${fingerprint}`, { ...record, status: 'review', needs_attention: true, error: hold });
    return { success: true, parsed: true, matched: false, review: true };
  }

  try {
    const pvRes = await tryPhoneVerification(env, parsed, network, record, fingerprint, rate);
    if (pvRes) return pvRes;
  } catch (e) {
    if (e.publicMessage === 'DUPLICATE') return { success: true, parsed: true, matched: false, duplicate: true };
    console.error('PV_FAILED', e.publicMessage || e.message);
  }

  let claim = null;
  try { claim = await findPendingClaim(env, parsed.sender, parsed.amount_lyd); }
  catch (e) { console.error('CLAIM_LOOKUP_FAILED', e.message); }

  if (claim && claim.uid) {
    try {
      await fsRunTransaction(env, async (tx) => {
        const dep = await tx.get(`wallet_deposits/${claim._id}`);
        if (!dep || dep.status !== 'pending' || dep.verified !== true) throw httpError(409, 'DUPLICATE');
        const u = await tx.get(`users/${claim.uid}`);
        if (!u || u.phone_verified !== parsed.sender) throw httpError(409, 'PHONE_CHANGED');
        const L = await ledgerOpen(tx, claim.uid);
        await ledgerPost(L, { type: 'credit', amount: amountUsd, reason: 'sms_deposit', reference: fingerprint, entryId: `txn_sms_${fingerprint}` });
        ledgerClose(tx, L);
        await dailyCheckTx(tx, s0, claim.uid, 'deposit', amountUsd);
        tx.update(`wallet_deposits/${claim._id}`, { status: 'approved', auto: true, awaiting_sms: false, amount_usd: amountUsd, approved_at: nowIso() });
        tx.create('sms_transactions', fingerprint, { ...record, status: 'claimed', uid: claim.uid, claimed_at: nowIso(), matched_by: 'pending_claim' });
      });
      await logOp(env, claim.uid, 'deposit.sms_matched', { amount_lyd: parsed.amount_lyd }, { credited: amountUsd }, true);
      return { success: true, parsed: true, matched: true, via: 'claim', credited_usd: amountUsd };
    } catch (e) {
      if (e.publicMessage === 'DUPLICATE') return { success: true, parsed: true, matched: false, duplicate: true };
      console.error('CLAIM_CREDIT_FAILED', e.publicMessage || e.message);
      await fsSet(env, `sms_transactions/${fingerprint}`, { ...record, status: 'unclaimed', needs_attention: true, error: String(e.publicMessage || e.message).slice(0, 200) }).catch(() => {});
      return { success: true, parsed: true, matched: false, deferred: true };
    }
  }

  await fsSet(env, `sms_transactions/${fingerprint}`, { ...record, status: 'unclaimed' });
  return { success: true, parsed: true, matched: false, amount_lyd: parsed.amount_lyd };
}

async function logOp(env, uid, action, request, response, ok) {
  const id = `${Date.now()}_${randomSuffix(8)}`;
  try {
    await fsCommit(env, [{
      update: { name: docPath(env, `audit_log/${id}`), fields: toFsFields({
        actor: uid, action, ok: !!ok,
        details: JSON.stringify(request || {}).slice(0, 1500),
        result: JSON.stringify(response || {}).slice(0, 900),
        created_at: nowIso(),
      }) },
      currentDocument: { exists: false },
    }]);
  } catch (e) { console.error('AUDIT_FAILED', action); }
}

async function getJwks() {
  const now = Date.now();
  if (_jwksCache.keys && _jwksCache.exp > now) return _jwksCache.keys;
  const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!res.ok) throw httpError(503, 'تعذّر التحقق من الجلسة — حاول بعد قليل');
  const data = await res.json();
  if (!Array.isArray(data.keys)) throw httpError(503, 'تعذّر التحقق من الجلسة');
  _jwksCache = { keys: data.keys, exp: now + 3600_000 };
  return data.keys;
}

async function verifyIdToken(idToken, projectId) {
  const parts = String(idToken).split('.');
  if (parts.length !== 3) throw httpError(401, 'رمز الدخول غير صالح');
  let header, payload;
  try { header = JSON.parse(b64urlToStr(parts[0])); payload = JSON.parse(b64urlToStr(parts[1])); }
  catch { throw httpError(401, 'رمز الدخول غير صالح'); }
  const now = Math.floor(Date.now() / 1000);
  if (header.alg !== 'RS256') throw httpError(401, 'رمز الدخول غير صالح');
  if (payload.aud !== projectId) throw httpError(401, 'رمز الدخول غير صالح');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw httpError(401, 'رمز الدخول غير صالح');
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.length > 128) throw httpError(401, 'رمز الدخول غير صالح');
  if (!(payload.exp > now)) throw httpError(401, 'انتهت صلاحية الجلسة');
  if (!(payload.iat <= now + 300)) throw httpError(401, 'رمز الدخول غير صالح');
  if (payload.auth_time && payload.auth_time > now + 300) throw httpError(401, 'رمز الدخول غير صالح');

  const jwks = await getJwks();
  const jwk = jwks.find(k => k.kid === header.kid);
  if (!jwk) throw httpError(401, 'رمز الدخول غير صالح');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw httpError(401, 'رمز الدخول غير صالح');
  return payload;
}

async function requireAuth(request, env) {
  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+([A-Za-z0-9_\-.]{20,4096})$/);
  if (!m) throw httpError(401, 'يجب تسجيل الدخول');
  const payload = await verifyIdToken(m[1], env.FIREBASE_PROJECT_ID);
  const uid = payload.user_id || payload.sub;
  const userDoc = await fsGet(env, `users/${uid}`);
  if (userDoc && userDoc.banned === true) throw httpError(403, 'حسابك موقوف — تواصل مع الدعم');
  return { uid, email: payload.email || '' };
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization, x-firebase-appcheck',
    'access-control-max-age': '86400',
    'vary': 'Origin',
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...corsHeaders(origin),
    },
  });
}

function resolveOrigin(request, env) {
  const allowed = String(env.ALLOWED_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);
  const o = request.headers.get('origin') || '';
  if (allowed.includes(o)) return o;
  return allowed[0] || 'null';
}

async function getSettings(env) {
  const ops = await fsGet(env, 'settings/main');
  return { ...DEFAULT_SETTINGS, ...(ops || {}) };
}
