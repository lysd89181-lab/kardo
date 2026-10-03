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
const STORE_CODES_TTL_DAYS = 30;

let _tokenCache = { token: null, exp: 0 };
let _jwksCache = { keys: null, exp: 0 };
const _banCache = new Map();

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
  deposit_mode: 'auto',
  m_libyana_mode: '', m_almadar_mode: '', m_bank_receipt: true, m_binance_receipt: true,
  require_email_verify: true,
  plans_enabled: true, plan_free_cards: 1, plan_basic_cards: 3, plan_premium_cards: 6, plan_vip_cards: 0,
  plan_premium_price: 10, plan_premium_days: 30, card_warning: '', otp_fee_usd: 0.03, kardo_store_on: false, merchants_on: false, referral_cards_enabled: true, referral_card_inviter: 1, referral_card_invitee: 0.2, referral_store_enabled: false,
  plan_basic_price: 5, plan_basic_days: 30, plan_vip_price: 15, plan_vip_days: 30,
};

const ADMIN_SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);
const _pubCache = new Map();          // كاش ردود GET العامة (30 ثانية لكل نسخة)

// يقبل ملف مفتاح Firebase كاملًا في سر واحد FIREBASE_SERVICE_ACCOUNT (أسهل من نسخ الحقول)
function withServiceAccount(env) {
  if (env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY && env.FIREBASE_PROJECT_ID) return env;
  try {
    const sa = JSON.parse(String(env.FIREBASE_SERVICE_ACCOUNT || '{}'));
    return { ...env,
      FIREBASE_CLIENT_EMAIL: env.FIREBASE_CLIENT_EMAIL || sa.client_email,
      FIREBASE_PRIVATE_KEY: env.FIREBASE_PRIVATE_KEY || sa.private_key,
      FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID || sa.project_id };
  } catch { console.error('SERVICE_ACCOUNT_PARSE_FAILED'); return env; }
}

export default {
  async fetch(request, env, ctx) {
    env = withServiceAccount(env);
    const origin = resolveOrigin(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    if (request.method === 'GET') {
      const im = /^\/img\/([pcmbslvxyg])\/([A-Za-z0-9_-]{1,60})$/.exec(path);
      if (im) { try { return await handleImage(request, env, ctx, im[1], decodeURIComponent(im[2])); } catch { return new Response('Error', { status: 500 }); } }
      if (path === '/sitemap.xml') {
        try {
          const ck = new Request(url.origin + '/sitemap.xml');
          const hit = await caches.default.match(ck);
          if (hit) return hit;
          const memo = _pubCache.get('sitemap');
          const xml = memo && memo.exp > Date.now() ? memo.v : await (await handleSitemap(env)).text();
          _pubCache.set('sitemap', { v: xml, exp: Date.now() + 3600000 });
          const res = new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
          ctx.waitUntil(caches.default.put(ck, res.clone()));
          return res;
        } catch { return new Response('Error', { status: 500 }); }
      }
    }
    try {
      const result = await route(path, request, url, env);
      ctx.waitUntil(Promise.allSettled(drainBackground()));
      const res = json(result, 200, origin);
      if (request.method === 'GET') res.headers.set('cache-control', 'public, max-age=30');
      return res;
    } catch (err) {
      ctx.waitUntil(Promise.allSettled(drainBackground()));
      const status = err.status || 500;
      if (status === 500) console.error('UNHANDLED', err.stack || err.message);
      return json({ success: false, error: err.publicMessage || 'حدث خطأ غير متوقع' }, status, origin);
    }
  },

  async scheduled(event, env, ctx) {
    env = withServiceAccount(env);
    const jobs = [purgeExpiredCvv(env).catch(e => console.error('CVV_PURGE_FAILED', e.message)),
      purgeExpiredOtp(env).catch(e => console.error('OTP_PURGE_FAILED', e.message))];
    const minute = new Date(event.scheduledTime || Date.now()).getUTCMinutes();
    if (minute < 5) {
      jobs.push(
        purgeExpiredReveals(env).catch(e => console.error('PURGE_FAILED', e.message)),
        purgeOldRateLimits(env).catch(e => console.error('RL_PURGE_FAILED', e.message)),
        migrateAndPurgeCodes(env).catch(e => console.error('CODES_JOB_FAILED', e.message)),
        purgeExpiredIdempotency(env).catch(e => console.error('IDEM_PURGE_FAILED', e.message)),
        merchantsCron(env).catch(e => console.error('MERCHANT_CRON_FAILED', e.message)),
        statementsCron(env).catch(e => console.error('STATEMENTS_CRON_FAILED', e.message)),
      );
    }
    ctx.waitUntil(Promise.all(jobs));
  },
};

async function route(path, request, url, env) {
  if (request.method === 'GET') {
    const h = { '/api/status': handleStatus, '/api/catalog': handleCatalog, '/api/services/list': handleServicesList, '/api/merchants/list': handleMerchantsList, '/api/platforms': handlePlatformsList }[path];
    if (!h) throw httpError(404, 'المسار غير موجود');
    const hit = _pubCache.get(path);
    if (hit && hit.exp > Date.now()) return hit.v;
    const v = await h(env);
    _pubCache.set(path, { v, exp: Date.now() + 30000 });
    return v;
  }
  if (path === '/api/sms/webhook') return handleSmsWebhook(request, env);
  if (path === '/api/otp/inbound') return handleOtpInbound(request, env);
  if (request.method !== 'POST') throw httpError(405, 'طريقة غير مسموحة');
  if (Number(request.headers.get('content-length') || 0) > 1_500_000) throw httpError(413, 'الطلب كبير جدًا');

  const user = await requireAuth(request, env);
  _ipByUid.set(user.uid, (request.headers.get('cf-connecting-ip') || '').slice(0, 45));
  if (_ipByUid.size > 5000) _ipByUid.clear();
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
    case '/api/wallet/manual-deposit': return handleManualDeposit(user, body, env);
    case '/api/plan/subscribe':        return handlePlanSubscribe(user, body, env);
    case '/api/store/my-orders':       return handleStoreMyOrders(user, body, env);

    case '/api/mcard/request':         return handleManualCardRequest(user, body, env);
    case '/api/mcard/topup-request':   return handleManualCardTopup(user, body, env);
    case '/api/mcard/list':            return handleManualCardList(user, env);
    case '/api/mcard/reveal':          return handleRevealCard(user, body, env, request);
    case '/api/otp/claim':             return handleOtpClaim(user, body, env);
    case '/api/m/order':               return handleMerchantOrder(user, body, env);
    case '/api/m/order/code':          return handleMerchantOrderCode(user, body, env);
    case '/api/m/rate':                return handleMerchantRate(user, body, env);
    case '/api/m/report':              return handleMerchantReport(user, body, env);
    case '/api/m/me':                  return handleMerchantMe(user, body, env);
    case '/api/m/profile':             return handleMerchantProfileSave(user, body, env);
    case '/api/m/service/save':        return handleMerchantServiceSave(user, body, env);
    case '/api/m/service/delete':      return handleMerchantServiceDelete(user, body, env);
    case '/api/m/stock/add':           return handleMerchantStockAdd(user, body, env);
    case '/api/m/order/action':        return handleMerchantOrderAction(user, body, env);
    case '/api/m/order/msg':           return handleMerchantOrderMsg(user, body, env);
    case '/api/m/reviews':             return handleMerchantReviews(user, body, env);
    case '/api/m/fav':                 return handleMerchantFav(user, body, env);
    case '/api/m/block':               return handleMerchantBlock(user, body, env);
    case '/api/m/accept-terms':        return handleMerchantAcceptTerms(user, body, env);
    case '/api/m/report/msg':          return handleReportMsg(user, body, env);
    case '/api/admin/merchant/promo':  return handleAdminMerchantPromo(user, body, env);
    case '/api/admin/merchant/statement/pay': return handleAdminStatementPay(user, body, env);
    case '/api/m/apply':               return handleMerchantApply(user, body, env);
    case '/api/admin/platform/save':   return handleAdminPlatformSave(user, body, env);
    case '/api/admin/platform/delete': return handleAdminPlatformDelete(user, body, env);
    case '/api/m/section/save':        return handleMerchantSectionSave(user, body, env);
    case '/api/m/section/delete':      return handleMerchantSectionDelete(user, body, env);
    case '/api/m/chat':                return handleMerchantChat(user, body, env);
    case '/api/m/chat/read':           return handleMerchantChatRead(user, body, env);
    case '/api/push/register':         return handlePushRegister(user, body, env);
    case '/api/admin/names':           return handleAdminNames(user, body, env);
    case '/api/m/apply/status':        return handleMerchantApplyStatus(user, body, env);
    case '/api/admin/merchant/apply':  return handleAdminApplyDecide(user, body, env);
    case '/api/admin/merchant/save':   return handleAdminMerchantSave(user, body, env);
    case '/api/admin/merchant/sub':    return handleAdminMerchantSub(user, body, env);
    case '/api/admin/report/resolve':  return handleAdminReportResolve(user, body, env);
    case '/api/admin/card/balance':    return handleAdminCardBalance(user, body, env);
    case '/api/admin/sticker/save':    return handleAdminStickerSave(user, body, env);

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
    case '/api/admin/user/plan':       return handleAdminUserPlan(user, body, env);
    case '/api/admin/mail/test':       return handleAdminMailTest(user, body, env);
    case '/api/admin/backup':          return handleAdminBackup(user, body, env);
    case '/api/notify/prefs':          return handleNotifyPrefs(user, body, env);
    case '/api/notify/read':           return handleNotifyRead(user, body, env);
    case '/api/email/send-code':       return handleEmailSendCode(user, body, env);
    case '/api/email/verify-code':     return handleEmailVerifyCode(user, body, env);
    case '/api/admin/phone/pending':   return handleAdminPhonePending(user, body, env);
    case '/api/admin/phone/approve':   return handleAdminPhoneApprove(user, body, env);
    case '/api/admin/category/save':   return handleAdminCategorySave(user, body, env);
    case '/api/admin/category/delete': return handleAdminCategoryDelete(user, body, env);
    case '/api/admin/product/save':    return handleAdminProductSave(user, body, env);
    case '/api/admin/product/delete':  return handleAdminProductDelete(user, body, env);
    case '/api/admin/store-stock/add': return handleAdminStoreStockAdd(user, body, env);
    case '/api/admin/store-stock/list': return handleAdminStoreStockList(user, body, env);
    case '/api/admin/store-stock/delete': return handleAdminStoreStockDelete(user, body, env);
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

const _grl = new Map();
async function enforceGlobalRateLimit(env, uid) {
  // حد عام تقريبي داخل الذاكرة (بلا Firestore). الحدود المالية الدقيقة تبقى ذرّية في Firestore.
  const bucket = Math.floor(Date.now() / 60000);
  const k = uid + ':' + bucket;
  const c = (_grl.get(k) || 0) + 1;
  _grl.set(k, c);
  if (_grl.size > 5000) for (const key of _grl.keys()) { if (!key.endsWith(':' + bucket)) _grl.delete(key); }
  if (c > 120) throw httpError(429, 'محاولات كثيرة — انتظر قليلاً');
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
  return withMail(env, s, {
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
    banners: cleanBanners(s.banners).map((b, i) => ({ ...b, img: imgRef(env, 'b', String(i), b.img) })),
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
      warning: String(s.card_warning || '').slice(0, 2000),
      otp_fee: num(s.otp_fee_usd, 0.03),
    },
    store_on: s.kardo_store_on === true,
    merchants_on: s.merchants_on === true,
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
      on: s.referral_cards_enabled !== false,
      inviter: num(s.referral_card_inviter, 1),
      invitee: num(s.referral_card_invitee, 0.2),
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
      libyana: { on: s.m_libyana_on !== false, logo: imgRef(env, 'm', 'libyana', s.m_libyana_logo), label: s.m_libyana_label || 'ليبيانا', phone: s.m_libyana_phone || s.deposit_phone || '', rate: num(s.rate_libyana, 11.8), auto: true, mode: (s.m_libyana_mode || s.deposit_mode) === 'manual' ? 'manual' : 'auto' },
      almadar: { on: s.m_almadar_on !== false, logo: imgRef(env, 'm', 'almadar', s.m_almadar_logo), label: s.m_almadar_label || 'المدار', phone: s.m_almadar_phone || s.deposit_phone || '', rate: num(s.rate_almadar, 12.5), auto: true, mode: (s.m_almadar_mode || s.deposit_mode) === 'manual' ? 'manual' : 'auto' },
      bank:    { on: s.m_bank_on === true, logo: imgRef(env, 'm', 'bank', s.m_bank_logo), label: s.m_bank_label || 'تحويل مصرفي', rate: num(s.rate_bank, 9.5), auto: false, receipt: s.m_bank_receipt !== false, fields: cleanFields(s.m_bank_fields) },
      usdt:    { on: s.m_usdt_on === true, logo: imgRef(env, 'm', 'usdt', s.m_usdt_logo), label: s.m_usdt_label || 'USDT', rate: num(s.rate_usdt, 1), auto: true, invoice: true, address: s.usdt_address || '', min: num(s.usdt_min, 5), max: num(s.usdt_max, 1000), window_min: num(s.usdt_window_min, 30), fields: cleanFields(s.m_usdt_fields) },
      binance: { on: s.m_binance_on === true, logo: imgRef(env, 'm', 'binance', s.m_binance_logo), label: s.m_binance_label || 'Binance Pay', rate: num(s.rate_usdt, 1), auto: false, receipt: s.m_binance_receipt !== false, fields: cleanFields(s.m_binance_fields) },
      ...Object.fromEntries(Object.entries(cleanCustomMethods(s.custom_methods)).map(([k, v]) => [k, { ...v, logo: imgRef(env, 'm', k, v.logo) }])),
    },
    maintenance_message: s.maintenance_message || '',
    deposit_mode: s.deposit_mode === 'manual' ? 'manual' : 'auto',
    mail_on: false,
    plans: {
      on: s.plans_enabled !== false,
      free:    { cards: planCardLimit(s, 'free') },
      basic:   { cards: planCardLimit(s, 'basic'),   price: planPrice(s, 'basic'),   days: planDays(s, 'basic') },
      premium: { cards: planCardLimit(s, 'premium'), price: planPrice(s, 'premium'), days: planDays(s, 'premium') },
      vip:     { cards: planCardLimit(s, 'vip'),     price: planPrice(s, 'vip'),     days: planDays(s, 'vip') },
    },
  });
}

async function withMail(env, s, o) { o.mail_on = mailOn(env) && s.require_email_verify !== false; o.stickers = await loadStickerRefs(env).catch(() => ({})); return o; }

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

  const list = rows.map(r => withId(r, 'service_orders'));
  for (const o of list) {
    const expired = o.delivered_expires_at && new Date(o.delivered_expires_at) < new Date();
    if (o.status === 'delivered' && !expired && o.delivered_enc) {
      const c = await decCodes(env, `svcd:${o._id}`, o.delivered_enc);
      o.delivered_data = c ? c[0] : '';
    }
  }
  const orders = list
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
      icon: c.icon || '', image: imgRef(env, 'c', c._id, c.image),
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
        desc: p.desc || '', image: imgRef(env, 'p', p._id, p.image),
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
    const maxAmt = num(s.daily_amount_max, 200);
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
      rate: num(m.rate, 1), auto: false, receipt: m.receipt !== false,
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
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging',
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
            'sms.assign', 'ledger.verify', 'user.read', 'plan.manage'],
  support: ['ticket.manage', 'user.read', 'user.ban'],
  ops:     ['service.manage', 'stock.manage', 'store.manage', 'card.fulfil', 'order.fulfil', 'user.read'],
};
const FINANCE_ADJUST_CAP = 100;          // USD — سقف التعديل اليدوي لغير super_admin
const CVV_WINDOW_MIN_DEFAULT = 5;

// ─── صلاحيات مفصّلة لكل موظف: قسم × إجراء ───
const PERM_SECTIONS = {
  deposits: ['view', 'approve'], withdraw: ['view', 'approve'], sms: ['view', 'approve'],
  mcards: ['view', 'approve'], cards: ['view', 'edit'], orders: ['view', 'approve'],
  store: ['view', 'add', 'edit', 'delete'], services: ['view', 'add', 'edit', 'delete', 'approve'],
  users: ['view', 'wallet', 'plan', 'ban', 'edit'], tickets: ['view', 'reply', 'close'],
  coupons: ['view', 'add', 'edit', 'delete'], stickers: ['view', 'edit'], merchants: ['view', 'add', 'edit'],
};
const ROLE_DEFAULT_PERMS = {       // توافق مع الأدوار القديمة
  finance: { deposits: ['view', 'approve'], withdraw: ['view', 'approve'], sms: ['view', 'approve'], users: ['view', 'wallet', 'plan'], coupons: ['view', 'add', 'edit', 'delete'] },
  support: { tickets: ['view', 'reply', 'close'], users: ['view', 'ban'] },
  ops: { mcards: ['view', 'approve'], cards: ['view', 'edit'], orders: ['view', 'approve'], store: ['view', 'add', 'edit', 'delete'], services: ['view', 'add', 'edit', 'delete', 'approve'], users: ['view'] },
};
const LEGACY_PERM = {
  'withdraw.review': 'withdraw.approve', 'deposit.review': 'deposits.approve', 'wallet.adjust': 'users.wallet',
  'card.fulfil': 'mcards.approve', 'order.fulfil': 'orders.approve', 'coupon.manage': 'coupons.edit',
  'service.manage': 'services.edit', 'stock.manage': 'store.edit', 'store.manage': 'store.edit',
  'user.ban': 'users.ban', 'user.manage': 'users.edit', 'sms.assign': 'sms.approve', 'ticket.manage': 'tickets.reply',
  'plan.manage': 'users.plan', 'ledger.verify': 'users.view', 'user.read': 'users.view',
  'settings.manage': '__super', 'staff.manage': '__super',
};
const STAFF_ROLES = ['super_admin', 'staff', 'finance', 'support', 'ops'];
function staffPerms(a) {
  if (a && a.perms && typeof a.perms === 'object' && !Array.isArray(a.perms)) return a.perms;
  return ROLE_DEFAULT_PERMS[a && a.role] || {};
}
function cleanPerms(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [sec, acts] of Object.entries(input)) {
    if (!PERM_SECTIONS[sec] || !Array.isArray(acts)) continue;
    const ok = [...new Set(acts.map(String).filter(a => PERM_SECTIONS[sec].includes(a)))];
    if (ok.length && !ok.includes('view')) ok.unshift('view');     // أي إجراء يستلزم رؤية القسم
    if (ok.length) out[sec] = ok;
  }
  return out;
}

async function getStaff(env, uid) {
  const a = await fsGet(env, `admins/${uid}`).catch(() => null);
  if (!a || a.disabled === true || !STAFF_ROLES.includes(a.role)) return null;
  return { ...a, uid };
}

function staffCan(staff, perm) {
  if (!staff) return false;
  if (staff.role === 'super_admin') return true;
  perm = LEGACY_PERM[perm] || perm;
  if (perm === '__super') return false;
  const [sec, act] = perm.split('.');
  const p = staffPerms(staff)[sec];
  return Array.isArray(p) && p.includes(act);
}

async function requirePermission(user, env, perm) {
  const a = await fsGet(env, `admins/${user.uid}`).catch(() => null);
  if (!a || a.disabled === true) throw httpError(403, 'غير مصرّح');
  if (!STAFF_ROLES.includes(a.role)) throw httpError(403, 'حسابك الإداري بلا دور صالح');
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
    const maxAmt = num(s.daily_amount_max, 200);
    if (maxAmt > 0 && cur.amount + amount > maxAmt) throw httpError(429, `بلغت حدّك اليومي ($${maxAmt}). حاول غدًا.`);
    tx.update(`daily_counters/${id}`, { uid, day: todayKey(), cards: cur.cards + 1, amount: round2(cur.amount + amount), deposit: cur.deposit }, false);
  } else if (kind === 'deposit') {
    tx.update(`daily_counters/${id}`, { uid, day: todayKey(), cards: cur.cards, amount: cur.amount, deposit: round2(cur.deposit + amount) }, false);
    tx.increment(`daily_counters/_platform_${todayKey()}`, 'deposit', round2(amount));   // سقف المنصة اليومي
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
  for (const k of ['referral_bonus_inviter', 'referral_bonus_invitee', 'referral_card_inviter', 'referral_card_invitee']) {
    if (k in out && out[k] > 50) throw httpError(400, `مكافأة غير منطقية: ${k}`);
  }
  if ('deposit_mode' in out && !['auto', 'manual'].includes(out.deposit_mode)) throw httpError(400, 'وضع الإيداع غير صالح');
  for (const k of ['m_bank_fields', 'm_usdt_fields', 'm_binance_fields']) if (k in out) out[k] = cleanFields(out[k]);
  if ('custom_methods' in out) {
    out.custom_methods = out.custom_methods.slice(0, 10).map(m => ({
      key: String((m && m.key) || '').replace(/[^a-z0-9_]/gi, '').slice(0, 20),
      label: String((m && m.label) || '').trim().slice(0, 40),
      rate: num(m && m.rate, 1) > 0 ? round2(num(m.rate, 1)) : 1,
      on: !m || m.on !== false, receipt: !m || m.receipt !== false,
      fields: cleanFields(m && m.fields),
      logo: /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(String((m && m.logo) || '')) ? String(m.logo).slice(0, 400000) : '',
    })).filter(m => m.label && m.key && !['libyana', 'almadar', 'bank', 'usdt', 'binance'].includes(m.key));
  }
  for (const k of ['m_libyana_mode', 'm_almadar_mode']) if (k in out && !['', 'auto', 'manual'].includes(out[k])) throw httpError(400, 'وضع غير صالح');
  for (const k of ['plan_basic_days', 'plan_premium_days', 'plan_vip_days']) if (k in out && (out[k] < 1 || out[k] > 366)) throw httpError(400, 'مدة الباقة بين 1 و 366 يومًا');
  for (const k of ['plan_free_cards', 'plan_basic_cards', 'plan_premium_cards', 'plan_vip_cards']) if (k in out && out[k] > 1000) throw httpError(400, 'عدد بطاقات غير منطقي');
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

  const manualMode = (st[`m_${method}_mode`] || st.deposit_mode) === 'manual';
  const meDoc = await fsGet(env, `users/${user.uid}`);
  const verifiedPhone = meDoc && meDoc.phone_verified ? String(meDoc.phone_verified) : '';
  // الوضع التلقائي: الرقم من الحساب الموثّق فقط. اليدوي: يُقبل رقم مكتوب لأن الأدمن يطابق بنفسه.
  const phone = verifiedPhone || (manualMode ? normalizePhone(body.phone || '') : '');
  if (!phone) throw httpError(manualMode ? 400 : 403, manualMode ? 'أدخل رقمك الذي حوّلت منه (10 أرقام)' : 'وثّق رقم هاتفك أولاً من صفحة الإعدادات');

  if (!(await checkRateLimit(env, `claim_${user.uid}`, 5, 3600))) throw httpError(429, 'محاولات كثيرة — حاول بعد ساعة');

  const maxLyd = num(st.max_deposit_lyd, 5000);
  if (amountLyd > maxLyd) throw httpError(400, `الحد الأقصى ${maxLyd} د.ل`);
  const rate = method === 'almadar' ? num(st.rate_almadar, 12.5) : num(st.rate_libyana, 11.8);
  await assertDailyLimit(env, st, user.uid, 'deposit', round2(amountLyd / rate));

  const sms = verifiedPhone ? await findUnclaimedSms(env, phone, amountLyd) : null;
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
    notify(env, user.uid, 'deposit_ok', { amount: credited.toFixed(2) });
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
    status: 'pending', awaiting_sms: !manualMode && !!verifiedPhone, verified: !!verifiedPhone, manual: manualMode,
    expires_ms: manualMode ? 0 : Date.now() + 2 * 3600000, created_at: nowIso(),
  });
  notify(env, user.uid, 'deposit_pending', { amount: amountLyd.toFixed(2) + ' د.ل', method: method === 'libyana' ? 'ليبيانا' : 'المدار' });
  return { success: true, matched: false, manual: manualMode, claim_id: claimId };
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
    assertEmailVerified(env, s, L.doc);
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

  let wInfo = null;
  await fsRunTransaction(env, async (tx) => {
    const w = await tx.get(`withdrawals/${id}`);
    if (!w) throw httpError(404, 'الطلب غير موجود');
    if (w.status !== 'pending') throw httpError(409, 'الطلب مُغلق');
    wInfo = w;
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
  if (wInfo) notify(env, wInfo.uid, action === 'reject' ? 'withdraw_no' : 'withdraw_ok',
    { amount: num(action === 'reject' ? wInfo.amount_usd : wInfo.net, 0).toFixed(2), dest: String(wInfo.destination || '').replace(/.(?=.{4})/g, '•'), reason: String(body.reason || '').slice(0, 160) });
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

  if (to.includes('@')) throw httpError(400, 'التحويل برقم الهاتف الموثّق فقط');
  const k = normalizePhone(to);
  if (!k) throw httpError(400, 'رقم الهاتف غير صحيح');
  const field = 'phone_verified', value = k;
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
    if (!A.doc.phone_verified) throw httpError(403, 'وثّق رقمك أولًا لتتمكن من التحويل');
    assertEmailVerified(env, s, A.doc);
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
  if (!resp.replayed) { await logOp(env, user.uid, 'transfer', { to: toUid, amount }, { id }, true); notify(env, toUid, 'transfer_in', { amount: amount.toFixed(2) }); }
  return resp;
}

async function handleAdminDeposit(user, body, env) {
  const staff = await requirePermission(user, env, 'deposit.review');
  const depositId = String(body.deposit_id || '').trim();
  const action = body.action === 'reject' ? 'reject' : 'approve';
  if (!depositId) throw httpError(400, 'معرّف الإيداع مفقود');

  const s = await getSettings(env);
  let depInfo = null;
  await fsRunTransaction(env, async (tx) => {
    const dep = await tx.get(`wallet_deposits/${depositId}`);
    depInfo = dep;
    if (!dep) throw httpError(404, 'الإيداع غير موجود');
    if (dep.status !== 'pending') throw httpError(409, 'تمت معالجة هذا الإيداع مسبقًا');
    if (action === 'reject') {
      tx.update(`wallet_deposits/${depositId}`, { status: 'rejected', reject_reason: String(body.reason || '').slice(0, 200), reviewed_by: staff.uid, reviewed_at: nowIso() });
      return;
    }
    let amountUsd = round2(num(dep.amount_usd, 0));
    if (body.approved_usd !== undefined && body.approved_usd !== null && body.approved_usd !== '') {
      const ap = round2(num(body.approved_usd, NaN));
      if (!(ap > 0) || ap > amountUsd * 1.0001) throw httpError(400, 'المبلغ المعتمد يجب أن يكون موجبًا ولا يزيد عمّا طلبه الزبون');
      if (ap !== amountUsd) tx.update(`wallet_deposits/${depositId}`, { requested_usd: amountUsd, amount_usd: ap });
      amountUsd = ap;
    }
    if (!(amountUsd > 0)) throw httpError(400, 'مبلغ غير صحيح');
    const L = await ledgerOpen(tx, dep.uid);
    await ledgerPost(L, { type: 'credit', amount: amountUsd, reason: 'deposit_approved', reference: depositId, entryId: `txn_dep_manual_${depositId}`, created_by: staff.uid });
    ledgerClose(tx, L);
    await dailyCheckTx(tx, s, dep.uid, 'deposit', amountUsd);
    tx.update(`wallet_deposits/${depositId}`, { status: 'approved', reviewed_by: staff.uid, reviewed_at: nowIso() });
  });
  await logOp(env, staff.uid, 'deposit.' + action, { depositId }, {}, true);
  if (depInfo) notify(env, depInfo.uid, action === 'reject' ? 'deposit_no' : 'deposit_ok',
    { amount: num(depInfo.amount_usd, 0).toFixed(2), method: depInfo.method || '', reason: String(body.reason || '').slice(0, 200) });
  return { success: true, status: action === 'reject' ? 'rejected' : 'approved' };
}

async function handleAdminWalletAdjust(user, body, env) {
  const staff = await requirePermission(user, env, 'wallet.adjust');
  requireFreshAuth(user);
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
  if (body.accept_terms !== true) throw httpError(400, 'يجب الموافقة على تحذيرات وشروط البطاقات');
  const termsVersion = String(body.terms_version || '').slice(0, 10);
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
    assertEmailVerified(env, s, L.doc);
    const plan = userPlan(L.doc);
    const limit = planCardLimit(s, plan);
    const mine = await tx.query({
      from: [{ collectionId: 'manual_card_orders' }],
      where: { compositeFilter: { op: 'AND', filters: [
        { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: user.uid } } },
        { fieldFilter: { field: { fieldPath: 'kind' }, op: 'EQUAL', value: { stringValue: 'create' } } },
      ] } }, limit: 200,
    });
    const orders = mine.map(r => withId(r, 'manual_card_orders')).filter(o => o.status !== 'rejected');
    const freeN = planCardLimit(s, 'free');
    const sorted = [...orders].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const extras = sorted.slice(freeN);                         // البطاقة الأولى (المجانية) لا تُحسب من حصة الباقة
    if (orders.length < freeN) {
      // ما زالت عنده بطاقته المجانية — مسموح لكل الباقات
    } else if (plan === 'free') {
      throw httpError(403, `الباقة العادية تشمل ${freeN === 1 ? 'بطاقة واحدة' : freeN + ' بطاقات'} — اشترك في باقة لإصدار بطاقات إضافية`);
    } else if (limit > 0) {
      const since = planQuotaSince(L.doc, s, plan);
      const used = extras.filter(o => new Date(o.created_at).getTime() >= since).length;
      if (used >= limit) throw httpError(403, `وصلت لحد باقتك (${limit} بطاقات إضافية في الشهر) — رقِّ باقتك أو انتظر التجديد`);
    }
    await dailyCheckTx(tx, s, user.uid, 'card', total);
    await ledgerPost(L, { type: 'debit', amount: total, reason: 'card_create', reference: id, entryId: `txn_mc_create_${id}` });
    ledgerClose(tx, L);
    tx.create('manual_card_orders', id, {
      uid: user.uid, kind: 'create', amount, fee, total, card_name: cardName, name_on_card: nameOnCard,
      terms_accepted: true, terms_version: termsVersion, terms_accepted_at: nowIso(),
      status: 'pending', created_at: nowIso(), updated_at: nowIso(),
    });
    const r = { success: true, id, amount, fee, total };
    idemWrite(tx, user.uid, key, r);
    return r;
  });
  if (!resp.replayed) { await logOp(env, user.uid, 'card.request', { amount }, { id }, true); notify(env, user.uid, 'card_requested', { amount: amount.toFixed(2) }); }
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
    assertEmailVerified(env, s, L.doc);
    const card = await tx.get(`manual_cards/${cardId}`);
    if (!card || card.uid !== user.uid) throw httpError(404, 'البطاقة غير موجودة');
    await assertCardVisible(env, s, L.doc, user.uid, cardId);
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
  let rejUid = '', rejAmt = 0;
  let rewardOut = { inviter: null, invitee: 0, inviterAmt: 0 };
  await fsRunTransaction(env, async (tx) => {
    const o = await tx.get(`manual_card_orders/${id}`);
    if (!o) throw httpError(404, 'الطلب غير موجود');
    if (o.status !== 'pending') throw httpError(409, 'الطلب مُغلق بالفعل');
    rejUid = o.uid; rejAmt = num(o.total, 0);
    const L = await ledgerOpen(tx, o.uid);
    await ledgerPost(L, { type: 'credit', amount: num(o.total, 0), reason: 'card_rejected_refund', reference: id, entryId: `txn_mc_refund_${id}`, created_by: staff.uid });
    ledgerClose(tx, L);
    tx.update(`manual_card_orders/${id}`, { status: 'rejected', reject_reason: reason, rejected_at: nowIso(), rejected_by: staff.uid, updated_at: nowIso() });
  });
  await logOp(env, staff.uid, 'card.reject', { id, reason }, { refunded: true }, true);
  if (rejUid) notify(env, rejUid, 'card_rejected', { amount: rejAmt.toFixed(2), reason });
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
  const pan = toLatinDigits(body.card_number || '').replace(/\D/g, '');
  const expRaw = toLatinDigits(body.expiry || '').replace(/\D/g, '');
  const expiry = expRaw.length === 4 ? expRaw.slice(0, 2) + '/' + expRaw.slice(2)
    : expRaw.length === 6 ? expRaw.slice(0, 2) + '/' + expRaw.slice(4) : '';
  let cvv = toLatinDigits(body.cvv || '').replace(/\D/g, '');
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
    if (o.kind === 'create') rewardOut = await referralRewardTx(tx, s, { ...o, id });
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
  if (rewardOut.inviter) notify(env, rewardOut.inviter, 'referral_reward', { amount: rewardOut.inviterAmt.toFixed(2), link: 'referral' });
  if (rewardOut.invitee > 0) notify(env, o0.uid, 'referral_welcome', { amount: rewardOut.invitee.toFixed(2) });
  if (isCreate) notify(env, o0.uid, 'card_issued', { card_name: o0.card_name || 'بطاقتي', amount: num(o0.amount, 0).toFixed(2), cvv_min: Math.round(cvvMs / 60000) });
  else notify(env, o0.uid, 'card_topup', { card_name: o0.card_name || '', amount: num(o0.amount, 0).toFixed(2) });
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
      status: auto ? 'delivered' : 'pending', delivered_data: '', delivered_enc: auto ? await encCodes(env, `svcd:${orderId}`, [code]) : '',
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
  if (!resp.replayed) {
    await logOp(env, user.uid, 'service.order', { serviceId }, { orderId: resp.order.id }, true);
    notify(env, user.uid, 'order_placed', { name: resp.order.service_name, amount: '$' + resp.order.price_usd.toFixed(2), instant: resp.order.status === 'delivered' });
  }
  return resp;
}

async function handleAdminServiceOrder(user, body, env) {
  const staff = await requirePermission(user, env, 'services.approve');
  const orderId = String(body.id || '').trim();
  const action = body.action === 'reject' ? 'reject' : 'deliver';
  if (!orderId) throw httpError(400, 'رقم الطلب مفقود');
  const deliveredData = String(body.delivered_data || '').trim().slice(0, 2000);
  if (action === 'deliver' && !deliveredData) throw httpError(400, 'أدخل بيانات التسليم');

  let soInfo = null;
  await fsRunTransaction(env, async (tx) => {
    const o = await tx.get(`service_orders/${orderId}`);
    if (!o) throw httpError(404, 'الطلب غير موجود');
    if (o.status !== 'pending') throw httpError(409, 'الطلب مُغلق بالفعل');
    soInfo = o;
    if (action === 'reject') {
      const L = await ledgerOpen(tx, o.uid);
      await ledgerPost(L, { type: 'credit', amount: num(o.price_usd, 0), reason: 'service_order_rejected', reference: orderId, entryId: `txn_svc_refund_${orderId}`, created_by: staff.uid });
      ledgerClose(tx, L, { total_spent: Math.max(0, round2(num(L.doc.total_spent, 0) - num(o.price_usd, 0))) });
      tx.update(`service_orders/${orderId}`, { status: 'rejected', rejected_reason: String(body.reason || '').slice(0, 200), rejected_at: nowIso(), rejected_by: staff.uid, updated_at: nowIso() });
    } else {
      tx.update(`service_orders/${orderId}`, {
        status: 'delivered', delivered_data: '', delivered_enc: await encCodes(env, `svcd:${orderId}`, [deliveredData]), delivered_at: nowIso(),
        delivered_expires_at: new Date(Date.now() + DELIVERED_TTL_DAYS * 86400000).toISOString(),
        delivered_by: staff.uid, updated_at: nowIso(),
      });
    }
  });
  await logOp(env, staff.uid, 'service_order.' + action, { orderId }, {}, true);
  if (soInfo) notify(env, soInfo.uid, action === 'reject' ? 'order_no' : 'order_ok', { id: orderId, amount: num(soInfo.price_usd, 0).toFixed(2), reason: String(body.reason || '').slice(0, 160) });
  return { success: true };
}

async function handleAdminServiceOrderInputs(user, body, env) {
  const staff = await requirePermission(user, env, 'services.view');
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
  if ((await getSettings(env)).kardo_store_on !== true) throw httpError(403, 'متجر كاردو متوقف — تسوّق من المتاجر الموثوقة');
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
    if (s.referral_store_enabled === true && L.doc.referred_by && L.doc.referral_paid !== true
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
    const stored = [];
    for (const l of lines) stored.push({ ...l, codes: null, codes_enc: await encCodes(env, `code:${orderId}:${l.pid}`, l.codes) });
    tx.create('orders', orderId, {
      uid: user.uid, items: stored, coupon: couponCode, discount_lyd: discountLyd,
      total_lyd: totalLyd, total_usd: totalUsd, rate: rateVal,
      status: allStock ? 'completed' : 'pending', created_at: nowIso(), updated_at: nowIso(),
    });
    const r = { success: true, order: { id: orderId, status: allStock ? 'completed' : 'pending',
      total_lyd: totalLyd, total_usd: totalUsd,
      items: lines.map(l => ({ name: l.name, qty: l.qty, codes: l.codes })) } };
    idemWrite(tx, user.uid, key, r);
    return r;
  });
  if (!resp.replayed) {
    await logOp(env, user.uid, 'store.order', { items: merged.size }, { orderId: resp.order.id }, true);
    notify(env, user.uid, 'order_placed', { name: resp.order.items.map(i => i.name).join('، '), amount: resp.order.total_lyd.toFixed(2) + ' د.ل', instant: resp.order.status === 'completed' });
  }
  return resp;
}

async function handleAdminOrder(user, body, env) {
  const staff = await requirePermission(user, env, 'order.fulfil');
  const id = String(body.order_id || '').trim();
  const action = body.action === 'reject' ? 'reject' : 'complete';
  if (!id) throw httpError(400, 'رقم الطلب مفقود');

  let oInfo = null;
  await fsRunTransaction(env, async (tx) => {
    const o = await tx.get(`orders/${id}`);
    if (!o) throw httpError(404, 'الطلب غير موجود');
    if (o.status !== 'pending' && o.status !== 'processing') throw httpError(409, 'الطلب مُغلق');
    oInfo = o;
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
  if (oInfo) notify(env, oInfo.uid, action === 'reject' ? 'order_no' : 'order_ok', { id, amount: num(oInfo.total_usd, 0).toFixed(2), reason: String(body.reason || '').slice(0, 160) });
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
  const staff = await requirePermission(user, env, 'coupons.view');
  const code = String(body.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(code)) throw httpError(400, 'رمز الكوبون: حروف لاتينية وأرقام فقط');
  const couponExists = !!(await fsGet(env, `coupons/${code}`));
  if (!staffCan(staff, couponExists ? 'coupons.edit' : 'coupons.add')) throw httpError(403, 'لا تملك الصلاحية: ' + (couponExists ? 'تعديل' : 'إضافة') + ' الكوبونات');
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
  const staff = await requirePermission(user, env, 'coupons.delete');
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
  if (s.referral_cards_enabled === false) throw httpError(503, 'نظام الدعوات غير مفعّل');
  const stats = u => ({ referrals: Math.floor(num(u && u.referrals_count, 0)), earned: round2(num(u && u.referral_earned, 0)) });
  const me = await fsGet(env, `users/${user.uid}`);
  const bonus = { inviter: num(s.referral_card_inviter, 1), invitee: num(s.referral_card_invitee, 0.2) };
  if (me && me.ref_code) return { success: true, code: me.ref_code, ...bonus, ...stats(me), used: me.referred_code || '' };

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
    if (ok) return { success: true, code: ok, ...bonus, ...stats(me), used: (me && me.referred_code) || '' };
  }
  throw httpError(503, 'تعذّر توليد الرمز');
}

// يُقبل الرمز فقط للحسابات التي لم تُصدر بطاقة بعد، ومرة واحدة لكل حساب
async function handleRefClaim(user, body, env) {
  const s = await getSettings(env);
  if (s.referral_cards_enabled === false) throw httpError(503, 'نظام الدعوات غير مفعّل');
  const code = String(body.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z2-9]{6}$/.test(code)) throw httpError(400, 'رمز غير صحيح');
  if (!(await checkRateLimit(env, `refc_${user.uid}`, 5, 86400))) throw httpError(429, 'محاولات كثيرة');

  const owner = await fsGet(env, `ref_codes/${code}`);
  if (!owner || !owner.uid) throw httpError(404, 'الرمز غير موجود');
  if (owner.uid === user.uid) throw httpError(400, 'لا يمكنك استخدام رمزك');
  if (!(await checkRateLimit(env, `refo_${owner.uid}`, 20, 86400))) throw httpError(429, 'هذا الرمز تجاوز حدّه اليومي — حاول غدًا');

  await fsRunTransaction(env, async (tx) => {
    const me = await tx.get(`users/${user.uid}`);
    if (!me) throw httpError(400, 'الحساب غير مكتمل');
    if (me.referred_by) throw httpError(400, 'استخدمت رمز دعوة من قبل');
    const mine = await tx.query({
      from: [{ collectionId: 'manual_card_orders' }],
      where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: user.uid } } }, limit: 5,
    });
    if (mine.map(r => withId(r, 'manual_card_orders')).some(o => o.status !== 'rejected')) throw httpError(400, 'رمز الدعوة للحسابات التي لم تُصدر بطاقة بعد');
    tx.update(`users/${user.uid}`, { referred_by: owner.uid, referred_code: code, referral_paid: false });
  });
  return { success: true, invitee: num(s.referral_card_invitee, 0.2) };
}

// مكافأة الدعوة عند اكتمال إصدار بطاقة (داخل نفس المعاملة وبقيد في السجل)
async function referralRewardTx(tx, s, order) {
  const none = { inviter: null, invitee: 0, inviterAmt: 0 };
  if (s.referral_cards_enabled === false || order.kind !== 'create') return none;
  const I = await ledgerOpen(tx, order.uid);
  const refUid = I.doc.referred_by;
  if (!refUid || refUid === order.uid) return none;
  const inviterAmt = round2(num(s.referral_card_inviter, 1)), inviteeAmt = round2(num(s.referral_card_invitee, 0.2));
  const rdoc = await tx.get(`users/${refUid}`);
  if (!rdoc || rdoc.banned === true) return none;
  const first = I.doc.referral_paid !== true;
  const out = { ...none };
  if (inviterAmt > 0) {
    const R = await ledgerOpen(tx, refUid);
    await ledgerPost(R, { type: 'credit', amount: inviterAmt, reason: 'referral_bonus_inviter', reference: order.id, entryId: `txn_ref_out_${order.id}` });
    ledgerClose(tx, R, { referrals_count: Math.floor(num(R.doc.referrals_count, 0)) + (first ? 1 : 0), referral_earned: round2(num(R.doc.referral_earned, 0) + inviterAmt) });
    out.inviter = refUid; out.inviterAmt = inviterAmt;
  }
  if (first) {
    if (inviteeAmt > 0) { await ledgerPost(I, { type: 'credit', amount: inviteeAmt, reason: 'referral_bonus_invitee', reference: order.id, entryId: `txn_ref_in_${order.id}` }); out.invitee = inviteeAmt; }
    ledgerClose(tx, I, { referral_paid: true });
  }
  return out;
}

/* ═══ Admin — services & stock ═══ */

async function handleAdminServiceSave(user, body, env) {
  _pubCache.clear();
  const staff = await requirePermission(user, env, body.id ? 'services.edit' : 'services.add');
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
  _pubCache.clear();
  const staff = await requirePermission(user, env, 'services.delete');
  const id = String(body.id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw httpError(400, 'معرّف الخدمة مفقود');
  if (!(await fsGet(env, `services/${id}`))) throw httpError(404, 'الخدمة غير موجودة');
  await fsDelete(env, `services/${id}`);
  await logOp(env, staff.uid, 'service.delete', { id }, {}, true);
  return { success: true };
}

async function handleAdminStockAdd(user, body, env) {
  const staff = await requirePermission(user, env, 'services.add');
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
  const staff = await requirePermission(user, env, 'services.delete');
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
  const staff = await requirePermission(user, env, 'services.view');
  const serviceId = String(body.service_id || '').trim();
  if (!serviceId) throw httpError(400, 'معرّف الخدمة مفقود');
  const reveal = body.reveal === true;
  if (reveal && !staffCan(staff, 'stock.reveal')) throw httpError(403, 'كشف الأكواد يتطلب super_admin');
  if (reveal) requireFreshAuth(user);

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
    'card.fulfil', 'order.fulfil', 'settings.manage', 'staff.manage', 'store.manage', 'plan.manage'];
  // mail status for admin UI
  await fsPatch(env, `admins/${user.uid}`, { last_login: nowIso() }).catch(() => {});
  return { success: true, uid: user.uid, role: staff.role, permissions: all.filter(p => staffCan(staff, p)) };
}

async function handleAdminStaffSet(user, body, env) {
  const staff = await requirePermission(user, env, 'staff.manage');
  requireFreshAuth(user);
  const uid = String(body.uid || '').trim();
  const role = String(body.role || '').trim();
  if (!/^[A-Za-z0-9]{10,64}$/.test(uid)) throw httpError(400, 'معرّف غير صالح');
  if (uid === staff.uid) throw httpError(400, 'لا يمكنك تعديل دورك بنفسك');
  if (role && !['super_admin', 'staff'].includes(role)) throw httpError(400, 'دور غير معروف');
  if (!(await fsGet(env, `users/${uid}`))) throw httpError(404, 'المستخدم غير موجود');
  const perms = role === 'staff' ? cleanPerms(body.perms) : {};
  if (role === 'staff' && !Object.keys(perms).length) throw httpError(400, 'اختر قسمًا واحدًا على الأقل');
  if (!role) {
    await fsDelete(env, `admins/${uid}`);
  } else {
    await fsSet(env, `admins/${uid}`, { uid, role, perms, disabled: false, created_by: staff.uid, created_at: nowIso() });
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
  requireFreshAuth(user);
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
  notify(env, uid, 'deposit_ok', { amount: credited.toFixed(2) });
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
  if (asStaff) {
    await logOp(env, user.uid, 'ticket.reply', { id }, {}, true);
    const t = await fsGet(env, `tickets/${id}`);
    if (t && t.uid) notify(env, t.uid, 'ticket_reply', { subject: t.subject || '', link: `ticket:${id}`, preview: msg.slice(0, 140) });
  }
  return { success: true };
}

async function handleTicketClose(user, body, env) {
  const staff = await requirePermission(user, env, 'tickets.close');
  const id = String(body.id || '').trim();
  if (!id) throw httpError(400, 'رقم التذكرة مفقود');
  if (!(await fsGet(env, `tickets/${id}`))) throw httpError(404, 'التذكرة غير موجودة');
  await fsPatch(env, `tickets/${id}`, { status: 'closed', closed_by: staff.uid, updated_at: nowIso() });
  await logOp(env, staff.uid, 'ticket.close', { id }, {}, true);
  return { success: true };
}

async function handleAdminSettings(user, body, env) {
  const staff = await requirePermission(user, env, 'settings.manage');
  requireFreshAuth(user);
  const ops = sanitizeSettingsPatch(body || {});
  if (!Object.keys(ops).length) throw httpError(400, 'لا يوجد شيء للتحديث');
  const before = (await fsGet(env, 'settings/main')) || {};
  await fsPatch(env, 'settings/main', ops);
  clearSettingsCache();
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
  notify(env, pv.uid, 'phone_ok', {});
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
      notify(env, claim.uid, 'deposit_ok', { amount: amountUsd.toFixed(2) });
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

const _ipByUid = new Map();
async function logOp(env, uid, action, request, response, ok) {
  const id = `${Date.now()}_${randomSuffix(8)}`;
  try {
    await fsCommit(env, [{
      update: { name: docPath(env, `audit_log/${id}`), fields: toFsFields({
        actor: uid, action, ok: !!ok, ip: _ipByUid.get(uid) || '',
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
  let b = _banCache.get(uid);
  if (!b || b.exp < Date.now()) {
    const userDoc = await fsGet(env, `users/${uid}`);
    b = { banned: !!(userDoc && userDoc.banned === true), exp: Date.now() + 20000 };
    _banCache.set(uid, b);
    if (_banCache.size > 5000) _banCache.clear();
  }
  if (b.banned) throw httpError(403, 'حسابك موقوف — تواصل مع الدعم');
  return { uid, email: payload.email || '', auth_time: Number(payload.auth_time) || 0 };
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
  const allowed = String(env.ALLOWED_ORIGIN || '').split(',')
    .map(x => x.trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean);
  const o = (request.headers.get('origin') || '').toLowerCase();
  if (allowed.includes(o)) return o;
  return allowed[0] || 'null';
}

let _settingsCache = { v: null, exp: 0 };
async function getSettings(env) {
  if (_settingsCache.v && _settingsCache.exp > Date.now()) return _settingsCache.v;
  const ops = await fsGet(env, 'settings/main');
  const v = { ...DEFAULT_SETTINGS, ...(ops || {}) };
  _settingsCache = { v, exp: Date.now() + 20000 };
  return v;
}
function clearSettingsCache() { _settingsCache = { v: null, exp: 0 }; _pubCache.clear(); }

/* ═══════════════════════════════════════════════════════════
   v6 — Plans (باقات), deposit modes, manual deposits, store admin
   ═══════════════════════════════════════════════════════════ */

// العادي: بطاقة واحدة (مدى الحياة). المدفوعة: حصة شهرية (نافذة 30 يومًا). 0 في المدفوعة = غير محدود.
const PLAN_ORDER = ['free', 'basic', 'premium', 'vip'];
const PAID_PLANS = ['basic', 'premium', 'vip'];
const PLAN_DEFAULT_CARDS = { free: 1, basic: 3, premium: 6, vip: 0 };
const PLAN_DEFAULT_PRICE = { basic: 5, premium: 10, vip: 15 };
const PLAN_NAME_AR = { free: 'العادي', basic: 'الأساسي', premium: 'بريميوم', vip: 'VIP' };

function userPlan(u, now = Date.now()) {
  const p = u && u.plan;
  if (PAID_PLANS.includes(p) && num(u.plan_expires_ms, 0) > now) return p;
  return 'free';
}
function planCardLimit(s, plan) {
  return Math.max(0, Math.floor(num(s[`plan_${plan}_cards`], PLAN_DEFAULT_CARDS[plan])));
}
function planPrice(s, plan) { return round2(num(s[`plan_${plan}_price`], PLAN_DEFAULT_PRICE[plan] || 0)); }
function planDays(s, plan) { return Math.floor(num(s[`plan_${plan}_days`], 30)); }
function planQuotaSince(u, s, plan, now = Date.now()) {
  const started = num(u.plan_started_ms, num(u.plan_expires_ms, now) - planDays(s, plan) * 86400000);
  return Math.max(started, now - 30 * 86400000);
}

// البطاقات الظاهرة: في العادي تظهر أقدم بطاقة/بطاقات ضمن حده فقط، والباقي يختفي حتى التجديد
async function assertCardVisible(env, s, uDoc, uid, cardId) {
  if (userPlan(uDoc) !== 'free') return;
  const rows = await fsQueryStrict(env, {
    from: [{ collectionId: 'manual_cards' }],
    where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: uid } } }, limit: 300,
  });
  const cards = rows.map(r => withId(r, 'manual_cards')).filter(c => c.status !== 'deleted')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const allowed = cards.slice(0, planCardLimit(s, 'free')).map(c => c._id);
  if (!allowed.includes(cardId)) throw httpError(403, 'هذه البطاقة مقفلة 🔒 — جدّد باقتك لفتحها واستخدامها');
}

function requireFreshAuth(user, maxSec = 900) {
  if (!user.auth_time || Math.floor(Date.now() / 1000) - user.auth_time > maxSec) {
    throw httpError(401, 'لأمانك: سجّل خروجًا ثم دخولًا لتأكيد هذه العملية');
  }
}

async function handlePlanSubscribe(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.plans_enabled === false) throw httpError(503, 'الباقات غير متاحة حاليًا');
  const plan = PAID_PLANS.includes(body.plan) ? body.plan : '';
  if (!plan) throw httpError(400, 'اختر الباقة');
  const key = idemKeyOf(body);
  const price = planPrice(s, plan);
  const days = planDays(s, plan);
  if (!(price >= 0) || days < 1 || days > 366) throw httpError(503, 'إعدادات الباقة غير صالحة');
  const id = `PLN${Date.now()}${randomSuffix(4)}`;

  const resp = await fsRunTransaction(env, async (tx) => {
    const hit = await idemRead(tx, user.uid, key); if (hit) return hit;
    const L = await ledgerOpen(tx, user.uid);
    if (L.doc.banned === true) throw httpError(403, 'الحساب موقوف');
    const now = Date.now();
    const cur = userPlan(L.doc, now);
    const rank = p => PLAN_ORDER.indexOf(p);
    if (cur !== 'free' && rank(plan) < rank(cur)) throw httpError(400, `باقتك الحالية ${PLAN_NAME_AR[cur]} — تُجدَّد بنفس الباقة أو تنتظر انتهاءها`);

    let charge = price, credit = 0, base = now, started = now;
    if (cur === plan) { base = num(L.doc.plan_expires_ms, now); started = num(L.doc.plan_started_ms, now); }   // تجديد
    else if (cur !== 'free') {                                                                                  // ترقية
      const cp = planPrice(s, cur), cd = Math.max(1, planDays(s, cur));
      credit = round2(Math.max(0, cp * (num(L.doc.plan_expires_ms, now) - now) / (cd * 86400000)));
      charge = round2(Math.max(0, price - credit));
    }
    const expires = base + days * 86400000;
    if (charge > 0) {
      await ledgerPost(L, { type: 'debit', amount: charge, reason: 'plan_' + plan, reference: id, entryId: `txn_plan_${id}` });
    }
    ledgerClose(tx, L, { plan, plan_expires_ms: expires, plan_started_ms: started, plan_updated_at: nowIso() });
    tx.create('plan_orders', id, { uid: user.uid, plan, price, charge, credit, days, from_plan: cur, expires_ms: expires, created_at: nowIso() });
    const r = { success: true, plan, expires_ms: expires, charged: charge, credit };
    idemWrite(tx, user.uid, key, r);
    return r;
  });
  if (!resp.replayed) {
    await logOp(env, user.uid, 'plan.subscribe', { plan }, { charged: resp.charged }, true);
    notify(env, user.uid, 'plan_ok', { plan: PLAN_NAME_AR[plan], until: new Date(resp.expires_ms).toISOString().slice(0, 10) });
  }
  return resp;
}

async function handleAdminUserPlan(user, body, env) {
  const staff = await requirePermission(user, env, 'plan.manage');
  const uid = String(body.uid || '').trim();
  const plan = PLAN_ORDER.includes(body.plan) ? body.plan : '';
  const days = Math.floor(num(body.days, 30));
  const reason = String(body.reason || '').trim().slice(0, 200);
  if (!uid || !plan) throw httpError(400, 'بيانات ناقصة');
  if (plan !== 'free' && (days < 1 || days > 366)) throw httpError(400, 'المدة بين 1 و 366 يومًا');
  if (reason.length < 3) throw httpError(400, 'السبب مطلوب');
  const expires = plan === 'free' ? 0 : Date.now() + days * 86400000;
  await fsRunTransaction(env, async (tx) => {
    const u = await tx.get(`users/${uid}`);
    if (!u) throw httpError(404, 'المستخدم غير موجود');
    tx.update(`users/${uid}`, { plan, plan_expires_ms: expires, plan_started_ms: plan === 'free' ? 0 : Date.now(), plan_updated_at: nowIso(), plan_set_by: staff.uid });
  });
  await logOp(env, staff.uid, 'plan.admin_set', { uid, plan, days, reason }, {}, true);
  return { success: true, plan, expires_ms: expires };
}

/* ─── Manual deposits (bank / Binance / custom) with receipt ─── */
function cleanProofImage(raw) {
  const s = String(raw || '');
  if (!s) return '';
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) throw httpError(400, 'صورة الإيصال غير صالحة');
  if (s.length > 400000) throw httpError(400, 'صورة الإيصال كبيرة — أعد المحاولة');
  return s;
}

async function handleManualDeposit(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  const method = String(body.method || '').replace(/[^a-z0-9_]/gi, '').slice(0, 20);
  const status = await handleStatus(env);
  const m = status.methods[method];
  if (!m || m.on === false) throw httpError(400, 'طريقة الدفع غير متاحة');
  if (['libyana', 'almadar', 'usdt'].includes(method)) throw httpError(400, 'استخدم مسار الإيداع الخاص بهذه الطريقة');
  const amount = money(body.amount, { min: 1, max: 100000 });
  if (!Number.isFinite(amount)) throw httpError(400, 'أدخل مبلغًا صحيحًا');
  const rate = num(m.rate, 1);
  const amountUsd = round2(amount / rate);
  const needProof = m.receipt !== false;
  const proof = cleanProofImage(body.proof);
  const reference = String(body.reference || '').trim().slice(0, 100);
  if (needProof && !proof) throw httpError(400, 'أرفق صورة الإيصال');
  if (!needProof && !proof && reference.length < 3) throw httpError(400, 'أدخل رقم العملية أو المرجع');
  const note = String(body.note || '').trim().slice(0, 200);
  await assertDailyLimit(env, s, user.uid, 'deposit', amountUsd);
  if (!(await checkRateLimit(env, `mdep_${user.uid}`, 5, 3600))) throw httpError(429, 'محاولات كثيرة — حاول بعد ساعة');

  const pend = await fsQueryRaw(env, {
    from: [{ collectionId: 'wallet_deposits' }],
    where: { compositeFilter: { op: 'AND', filters: [
      { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: user.uid } } },
      { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
    ] } }, limit: 5,
  });
  if (pend.length >= 3) throw httpError(429, 'لديك طلبات معلّقة كثيرة — انتظر معالجتها');

  const id = `MDP${Date.now()}${randomSuffix(4)}`;
  await fsSet(env, `wallet_deposits/${id}`, {
    uid: user.uid, amount_usd: amountUsd, amount_lyd: method === 'binance' ? 0 : amount, amount_input: amount, rate,
    method: String(m.label || method).slice(0, 40), method_key: method, proof_url: proof, reference, note,
    status: 'pending', manual: true, created_at: nowIso(),
  });
  notify(env, user.uid, 'deposit_pending', { amount: amount.toFixed(2) + (method === 'binance' ? ' USDT' : ' د.ل'), method: String(m.label || method) });
  return { success: true, id, amount_usd: amountUsd };
}

async function handleAdminPhoneApprove(user, body, env) {
  const staff = await requirePermission(user, env, 'deposit.review');
  const phone = normalizePhone(body.phone || '');
  const credit = body.credit !== false;
  if (!phone) throw httpError(400, 'رقم غير صالح');
  const s = await getSettings(env);
  let uid = '', credited = 0;
  await fsRunTransaction(env, async (tx) => {
    const pv = await tx.get(`phone_verifications/${phone}`);
    if (!pv || pv.status !== 'pending') throw httpError(404, 'لا يوجد طلب توثيق معلّق لهذا الرقم');
    const bind = await tx.get(`phone_bindings/${phone}`);
    if (bind && bind.uid !== pv.uid) throw httpError(409, 'الرقم مرتبط بحساب آخر');
    uid = pv.uid;
    const L = await ledgerOpen(tx, uid);
    if (credit) {
      const rate = pv.network === 'almadar' ? num(s.rate_almadar, 12.5) : num(s.rate_libyana, 11.8);
      credited = round2(num(pv.amount_lyd, 0) / rate);
      if (credited > 0) await ledgerPost(L, { type: 'credit', amount: credited, reason: 'phone_verification_deposit', reference: 'manual_' + phone, entryId: `txn_pvm_${phone}_${Date.now()}`, created_by: staff.uid });
    }
    ledgerClose(tx, L, { phone_verified: phone, phone_verified_at: nowIso(), phone: '0' + phone });
    if (!bind) tx.create('phone_bindings', phone, { uid, network: pv.network || '', created_at: nowIso(), by: staff.uid });
    tx.update(`phone_verifications/${phone}`, { status: 'done', done_at: nowIso(), approved_by: staff.uid });
  });
  await logOp(env, staff.uid, 'phone.approve_manual', { phone, uid }, { credited }, true);
  notify(env, uid, 'phone_ok', {});
  return { success: true, uid, credited };
}

async function handleAdminPhonePending(user, body, env) {
  await requirePermission(user, env, 'deposits.view');
  const rows = await fsQueryRaw(env, {
    from: [{ collectionId: 'phone_verifications' }],
    where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
    limit: 50,
  });
  const now = Date.now();
  return { success: true, items: rows.map(r => withId(r, 'phone_verifications')).map(p => ({
    phone: p._id, uid: p.uid, network: p.network, amount_lyd: p.amount_lyd, to_phone: p.to_phone,
    expires_ms: p.expires_ms, expired: num(p.expires_ms, 0) < now, created_at: p.created_at,
  })) };
}

/* ─── Store admin: categories / products / stock ─── */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function cleanImage(raw, max = 150000) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https:\/\/[^\s"'<>]+$/.test(s) && s.length <= 500) return s;
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) {
    if (s.length > max) throw httpError(400, `الصورة كبيرة (${Math.round(s.length / 1024)}KB) — الحد ${Math.round(max / 1024)}KB`);
    return s;
  }
  throw httpError(400, 'صيغة الصورة غير مدعومة (JPG/PNG/WebP أو رابط https)');
}

async function handleAdminCategorySave(user, body, env) {
  _pubCache.clear();
  const staff = await requirePermission(user, env, body.id ? 'store.edit' : 'store.add');
  const id = String(body.id || '').trim();
  const name = String(body.name || '').trim().slice(0, 60);
  if (name.length < 2) throw httpError(400, 'اسم القسم مطلوب');
  const parent = String(body.parent || '').trim();
  if (parent && !ID_RE.test(parent)) throw httpError(400, 'القسم الأب غير صالح');
  if (parent && parent === id) throw httpError(400, 'لا يمكن جعل القسم أبًا لنفسه');
  if (parent && !(await fsGet(env, `categories/${parent}`))) throw httpError(404, 'القسم الأب غير موجود');
  const data = {
    name, parent, icon: String(body.icon || '').slice(0, 8), image: cleanImage(body.image, 120000),
    active: body.active !== false, soon: body.soon === true, sort: Math.floor(num(body.sort, 99)), updated_at: nowIso(),
  };
  const cid = id || `CAT${Date.now()}${randomSuffix(4)}`;
  if (id) {
    if (!ID_RE.test(id)) throw httpError(400, 'معرّف غير صالح');
    if (!(await fsGet(env, `categories/${id}`))) throw httpError(404, 'القسم غير موجود');
    await fsPatch(env, `categories/${id}`, data);
  } else {
    await fsSet(env, `categories/${cid}`, { ...data, created_at: nowIso() });
  }
  await logOp(env, staff.uid, 'store.category_save', { id: cid, name }, {}, true);
  return { success: true, id: cid };
}

async function handleAdminCategoryDelete(user, body, env) {
  _pubCache.clear();
  const staff = await requirePermission(user, env, 'store.delete');
  const id = String(body.id || '').trim();
  if (!ID_RE.test(id)) throw httpError(400, 'معرّف غير صالح');
  const [kids, prods] = await Promise.all([
    fsQueryRaw(env, { from: [{ collectionId: 'categories' }], where: { fieldFilter: { field: { fieldPath: 'parent' }, op: 'EQUAL', value: { stringValue: id } } }, limit: 1 }),
    fsQueryRaw(env, { from: [{ collectionId: 'products' }], where: { fieldFilter: { field: { fieldPath: 'cat' }, op: 'EQUAL', value: { stringValue: id } } }, limit: 1 }),
  ]);
  if (kids.length || prods.length) throw httpError(409, 'القسم يحتوي أقسامًا أو منتجات — انقلها أولًا');
  await fsDelete(env, `categories/${id}`);
  await logOp(env, staff.uid, 'store.category_delete', { id }, {}, true);
  return { success: true };
}

async function handleAdminProductSave(user, body, env) {
  _pubCache.clear();
  const staff = await requirePermission(user, env, body.id ? 'store.edit' : 'store.add');
  const id = String(body.id || '').trim();
  const name = String(body.name || '').trim().slice(0, 100);
  if (name.length < 2) throw httpError(400, 'اسم المنتج مطلوب');
  const cat = String(body.cat || '').trim();
  if (!ID_RE.test(cat) || !(await fsGet(env, `categories/${cat}`))) throw httpError(400, 'اختر قسمًا صالحًا');
  const price = money(body.price, { min: 0.01, max: 1000000 });
  if (!Number.isFinite(price)) throw httpError(400, 'السعر غير صالح (رقم موجب بمنزلتين عشريتين كحد أقصى)');
  const oldPrice = body.old_price ? money(body.old_price, { min: 0.01, max: 1000000 }) : 0;
  if (body.old_price && !Number.isFinite(oldPrice)) throw httpError(400, 'السعر القديم غير صالح');
  const kind = body.kind === 'stock' ? 'stock' : 'manual';
  const data = {
    name, cat, desc: String(body.desc || '').slice(0, 600), note: String(body.note || '').slice(0, 300),
    image: cleanImage(body.image, 150000), price, old_price: oldPrice || 0, kind,
    fields: cleanProductFields(body.fields), featured: body.featured === true, active: body.active !== false,
    sort: Math.floor(num(body.sort, 99)), updated_at: nowIso(),
  };
  if (body.countdown === true) {
    const st = String(body.starts_at || ''), en = String(body.ends_at || '');
    if (!Number.isFinite(Date.parse(st)) || !Number.isFinite(Date.parse(en)) || Date.parse(en) < Date.parse(st)) throw httpError(400, 'تواريخ العرض غير صالحة');
    Object.assign(data, { countdown: true, starts_at: st, ends_at: en, min_price: money(body.min_price || 0.01, { min: 0.01 }) || 0 });
  } else data.countdown = false;

  const pid = id || `PRD${Date.now()}${randomSuffix(4)}`;
  if (id) {
    if (!ID_RE.test(id)) throw httpError(400, 'معرّف غير صالح');
    const before = await fsGet(env, `products/${id}`);
    if (!before) throw httpError(404, 'المنتج غير موجود');
    await fsPatch(env, `products/${id}`, data);
    await logOp(env, staff.uid, 'store.product_update', { id, price_before: before.price }, { price_after: price }, true);
  } else {
    await fsSet(env, `products/${pid}`, { ...data, stock_count: 0, sold_count: 0, created_at: nowIso() });
    await logOp(env, staff.uid, 'store.product_create', { id: pid, name }, {}, true);
  }
  return { success: true, id: pid };
}

async function handleAdminProductDelete(user, body, env) {
  _pubCache.clear();
  const staff = await requirePermission(user, env, 'store.delete');
  const id = String(body.id || '').trim();
  if (!ID_RE.test(id)) throw httpError(400, 'معرّف غير صالح');
  const p = await fsGet(env, `products/${id}`);
  if (!p) throw httpError(404, 'المنتج غير موجود');
  if (num(p.stock_count, 0) > 0) throw httpError(409, 'احذف أكواد المخزون أولًا أو أوقف المنتج بدل حذفه');
  await fsDelete(env, `products/${id}`);
  await logOp(env, staff.uid, 'store.product_delete', { id }, {}, true);
  return { success: true };
}

async function handleAdminStoreStockAdd(user, body, env) {
  const staff = await requirePermission(user, env, 'store.add');
  const pid = String(body.pid || '').trim();
  if (!ID_RE.test(pid)) throw httpError(400, 'اختر المنتج');
  const p = await fsGet(env, `products/${pid}`);
  if (!p) throw httpError(404, 'المنتج غير موجود');
  if (p.kind !== 'stock') throw httpError(400, 'هذا المنتج يدوي — غيّر نوعه إلى «أكواد» أولًا');
  let codes = Array.isArray(body.codes) ? body.codes : String(body.bulk_text || '').split(/\r?\n/);
  codes = [...new Set(codes.map(x => String(x).trim().slice(0, 500)).filter(Boolean))];
  if (!codes.length) throw httpError(400, 'لا توجد أكواد');
  if (codes.length > 500) throw httpError(400, 'الحد الأقصى 500 كود في المرة');
  let added = 0;
  for (let i = 0; i < codes.length; i += 200) {
    const chunk = codes.slice(i, i + 200);
    const writes = chunk.map(code => write(env, `stock/SK${Date.now()}${randomSuffix(8)}`, {
      pid, code, used: false, created_at: nowIso(), created_by: staff.uid,
    }));
    writes.push({ transform: { document: docPath(env, `products/${pid}`),
      fieldTransforms: [{ fieldPath: 'stock_count', increment: { integerValue: String(chunk.length) } }] } });
    await fsCommit(env, writes);
    added += chunk.length;
  }
  await logOp(env, staff.uid, 'store.stock_add', { pid, count: added }, {}, true);
  return { success: true, added };
}

async function handleAdminStoreStockList(user, body, env) {
  const staff = await requirePermission(user, env, 'store.view');
  const pid = String(body.pid || '').trim();
  if (!ID_RE.test(pid)) throw httpError(400, 'اختر المنتج');
  const reveal = body.reveal === true;
  if (reveal) { if (!staffCan(staff, 'stock.reveal')) throw httpError(403, 'كشف الأكواد يتطلب super_admin'); requireFreshAuth(user); }
  const rows = await fsQueryRaw(env, { from: [{ collectionId: 'stock' }], where: { fieldFilter: { field: { fieldPath: 'pid' }, op: 'EQUAL', value: { stringValue: pid } } }, limit: 300 });
  const items = rows.map(r => withId(r, 'stock')).sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .map(x => ({ id: x._id, code: reveal ? (x.code || '') : maskCode(x.code || ''), used: x.used === true, used_by: x.used_by || '', order_id: x.order_id || '', created_at: x.created_at }));
  if (reveal) await logOp(env, staff.uid, 'store.stock_reveal', { pid, count: items.length }, {}, true);
  return { success: true, items, stats: { unused: items.filter(x => !x.used).length, used: items.filter(x => x.used).length } };
}

async function handleAdminStoreStockDelete(user, body, env) {
  const staff = await requirePermission(user, env, 'store.delete');
  const id = String(body.id || '').trim();
  if (!ID_RE.test(id)) throw httpError(400, 'معرّف غير صالح');
  await fsRunTransaction(env, async (tx) => {
    const row = await tx.get(`stock/${id}`);
    if (!row) throw httpError(404, 'الكود غير موجود');
    if (row.used !== false) throw httpError(400, 'لا يمكن حذف كود مستخدم');
    tx.delete(`stock/${id}`);
    tx.increment(`products/${row.pid}`, 'stock_count', -1);
  });
  await logOp(env, staff.uid, 'store.stock_delete', { id }, {}, true);
  return { success: true };
}

/* ─── Customer: my store orders (codes only for owner) ─── */
async function handleStoreMyOrders(user, body, env) {
  const rows = await fsQueryRaw(env, {
    from: [{ collectionId: 'orders' }],
    where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: user.uid } } }, limit: 60,
  });
  const raw = rows.map(r => withId(r, 'orders'));
  for (const o of raw) for (const l of (o.items || [])) {
    if (l.codes_enc) l.codes = await decCodes(env, `code:${o._id}:${l.pid}`, l.codes_enc);
  }
  const orders = raw
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .map(o => ({ id: o._id, status: o.status, total_lyd: num(o.total_lyd, 0), total_usd: num(o.total_usd, 0),
      discount_lyd: num(o.discount_lyd, 0), coupon: o.coupon || '', delivery: o.delivery || '', reject_reason: o.reject_reason || '',
      created_at: o.created_at,
      items: (o.items || []).map(l => ({ name: l.name, qty: l.qty, price_lyd: l.price_lyd, line_lyd: l.line_lyd, image: l.image || '', codes: l.codes || null, codes_purged: l.codes_purged === true, values: l.values || {} })) }));
  return { success: true, orders };
}

/* ═══════════════════════════════════════════════════════════
   v7 — Email notifications (Resend), encrypted delivered codes
   ═══════════════════════════════════════════════════════════ */

const _bg = [];                       // مهام خلفية تُسلَّم لـ ctx.waitUntil بعد الرد
function background(p) { _bg.push(Promise.resolve(p).catch(() => {})); }
function drainBackground() { return _bg.splice(0, _bg.length); }

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let _lastMailError = '';
async function sendEmail(env, to, subject, html) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return false;
  if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(String(to || ''))) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      let msg = ''; try { msg = (await r.json()).message || ''; } catch {}
      _lastMailError = `${r.status} ${msg}`.slice(0, 200);
      console.error('MAIL_FAILED', _lastMailError); return false;
    }
    _lastMailError = '';
    return true;
  } catch (e) { _lastMailError = e.name; console.error('MAIL_FAILED', e.name); return false; }
}

function siteUrl(env) {
  return String(env.SITE_URL || String(env.ALLOWED_ORIGIN || '').split(',')[0] || 'https://kardo.ly').trim().replace(/\/+$/, '');
}

function mailLayout(env, title, lines, cta) {
  const url = siteUrl(env);
  return `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#0d1110;font-family:Tahoma,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0d1110;padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#161b19;border:1px solid #2a312d;border-radius:14px;padding:28px 24px;color:#e9e4d6;text-align:right">
    <tr><td style="font-size:13px;color:#c9a24a;letter-spacing:1px;padding-bottom:10px">KARDO · كاردو</td></tr>
    <tr><td style="font-size:20px;font-weight:bold;padding-bottom:14px">${escHtml(title)}</td></tr>
    ${lines.map(l => `<tr><td style="font-size:14px;line-height:1.9;color:#cfc9ba;padding-bottom:6px">${l}</td></tr>`).join('')}
    ${cta ? `<tr><td style="padding-top:18px"><a href="${escHtml(url)}" style="display:inline-block;background:#c9a24a;color:#111;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px">${escHtml(cta)}</a></td></tr>` : ''}
    <tr><td style="font-size:11px;color:#7d7869;padding-top:22px;border-top:1px solid #2a312d;margin-top:18px">لن نطلب منك أبدًا كلمة المرور أو رمز CVV عبر البريد. هذه رسالة تلقائية — لا ترد عليها.</td></tr>
  </table></td></tr></table></body></html>`;
}

// لا بيانات حساسة في البريد إطلاقًا: لا أرقام بطاقات، لا CVV، لا أكواد.
const MAIL = {
  card_issued: (v) => ['بطاقتك جاهزة ✓', [
    `بطاقتك <b>${escHtml(v.card_name)}</b> صدرت بنجاح بقيمة <b>$${escHtml(v.amount)}</b>.`,
    `<b style="color:#e8b64c">مهم:</b> رمز CVV يُعرض <b>مرة واحدة فقط</b> ومتاح لمدة <b>${escHtml(v.cvv_min)} دقيقة</b> من الآن. ادخل الآن واحفظه.`,
    'رقم البطاقة وتاريخ الانتهاء متاحان للعرض لمدة محدودة أيضًا.'], 'عرض البطاقة الآن'],
  card_topup: (v) => ['تم شحن بطاقتك', [`أُضيف <b>$${escHtml(v.amount)}</b> إلى بطاقتك <b>${escHtml(v.card_name)}</b>.`], 'فتح كاردو'],
  card_rejected: (v) => ['تعذّر تنفيذ طلب البطاقة', [`أُعيد المبلغ <b>$${escHtml(v.amount)}</b> إلى محفظتك.`, v.reason ? `السبب: ${escHtml(v.reason)}` : ''], 'فتح كاردو'],
  deposit_ok: (v) => ['أُضيف رصيد لمحفظتك', [`أُضيف <b>$${escHtml(v.amount)}</b> إلى محفظتك${v.method ? ` عبر ${escHtml(v.method)}` : ''}.`], 'فتح المحفظة'],
  deposit_no: (v) => ['لم يُقبل طلب الإيداع', [v.reason ? `السبب: ${escHtml(v.reason)}` : 'تواصل مع الدعم لمزيد من التفاصيل.'], 'فتح كاردو'],
  withdraw_ok: (v) => ['تم تنفيذ السحب', [`نُفّذ سحب <b>$${escHtml(v.amount)}</b> إلى ${escHtml(v.dest)}.`], 'فتح كاردو'],
  withdraw_no: (v) => ['لم يُنفَّذ السحب', [`أُعيد <b>$${escHtml(v.amount)}</b> إلى محفظتك.`, v.reason ? `السبب: ${escHtml(v.reason)}` : ''], 'فتح كاردو'],
  order_ok: (v) => ['طلبك جاهز ✓', [`طلبك رقم <b>${escHtml(v.id)}</b> اكتمل. ادخل إلى «طلباتي» لعرض التفاصيل.`], 'عرض الطلب'],
  order_no: (v) => ['أُلغي طلبك', [`أُعيد <b>$${escHtml(v.amount)}</b> إلى محفظتك.`, v.reason ? `السبب: ${escHtml(v.reason)}` : ''], 'فتح كاردو'],
  phone_ok: () => ['تم توثيق رقمك', ['رقم هاتفك موثّق الآن، وإيداعاتك منه تُضاف تلقائيًا.'], 'فتح كاردو'],
  plan_ok: (v) => [`تم تفعيل باقة ${escHtml(v.plan)}`, [`باقتك سارية حتى ${escHtml(v.until)}.`], 'فتح كاردو'],
  test: () => ['بريد تجريبي', ['إعداد البريد يعمل بشكل صحيح ✓'], ''],
  verify_code: (v) => ['رمز تأكيد بريدك', [`رمزك هو:`, `<div style="font-size:30px;letter-spacing:8px;font-weight:bold;color:#e8b64c;font-family:monospace;direction:ltr;text-align:center;padding:10px 0">${escHtml(v.code)}</div>`, 'صالح لمدة 10 دقائق. إذا لم تطلبه، تجاهل هذه الرسالة.'], ''],
  order_placed: (v) => ['تم الشراء ✓', [`تم شراء <b>${escHtml(v.name)}</b> بقيمة <b>${escHtml(v.amount)}</b>.`, v.instant ? 'الكود جاهز في «طلباتي».' : 'سيُنفَّذ طلبك يدويًا ونُعلمك فور اكتماله.'], 'عرض طلباتي'],
  card_requested: (v) => ['وصل طلب البطاقة', [`طلبك لإصدار بطاقة بقيمة <b>$${escHtml(v.amount)}</b> قيد التنفيذ. سنُعلمك فور إصدارها.`], 'فتح كاردو'],
  deposit_pending: (v) => ['وصل طلب الإيداع', [`طلب إيداع <b>${escHtml(v.amount)}</b> عبر ${escHtml(v.method)} قيد المراجعة.`], 'فتح كاردو'],
  m_new_order: (v) => ['طلب جديد في متجرك 🛒', [`طلب جديد: <b>${escHtml(v.service)}</b> بقيمة ${escHtml(String(v.price))} د.ل.`, v.dup ? '⚠️ تنبيه: صورة الإيصال استُخدمت في طلب سابق — تحقّق جيدًا.' : '', 'راجع الإيصال وأكّد الطلب من لوحة متجرك.'], 'فتح الطلبات'],
  referral_reward: (v) => ['مكافأة دعوة 🎁', [`أصدر صديقك الذي دعوته بطاقة، وأضفنا <b>$${escHtml(v.amount)}</b> إلى محفظتك.`, 'شكرًا لأنك تنشر كاردو.'], 'فتح المحفظة'],
  referral_welcome: (v) => ['هدية ترحيب 🎁', [`أضفنا <b>$${escHtml(v.amount)}</b> إلى محفظتك لأنك انضممت عبر رمز دعوة وأصدرت بطاقتك الأولى.`], 'فتح المحفظة'],
  m_apply_admin: (v) => ['طلب انضمام تاجر جديد 🏪', [`<b>${escHtml(v.name)}</b> يريد فتح متجر «<b>${escHtml(v.store)}</b>».`, 'راجع الطلب من لوحة الإدارة ← المتاجر الموثوقة.'], 'لوحة الإدارة'],
  m_apply_rejected: (v) => ['بخصوص طلب متجرك', [`نعتذر، لم يُقبل طلب متجر «<b>${escHtml(v.store)}</b>» حاليًا.`, v.reason ? `السبب: ${escHtml(v.reason)}` : ''], 'فتح كاردو'],
  m_statement: (v) => ['كشف حساب متجرك 🧾', [`مبيعات <b>${escHtml(v.store)}</b> لشهر ${escHtml(v.month)}: ${escHtml(String(v.sales))} د.ل.`, `عمولة كاردو (${escHtml(String(v.pct))}%): <b>${escHtml(String(v.amount))} د.ل</b>.`, 'يرجى الدفع خلال 5 أيام حتى لا يتوقف متجرك.'], 'عرض الكشف'],
  m_statement_paid: (v) => ['تم استلام دفعتك ✓', [`سُجّل دفع كشف ${escHtml(v.month)} بقيمة ${escHtml(String(v.amount))} د.ل. شكرًا لك.`], 'لوحة متجري'],
  m_billing_hold: (v) => ['تم إيقاف متجرك مؤقتًا ⚠️', [`لم يُسدَّد كشف متجر <b>${escHtml(v.store)}</b> (${escHtml(String(v.amount))} د.ل).`, 'يعود متجرك فور تسجيل الدفع — تواصل مع إدارة كاردو.'], 'لوحة متجري'],
  m_chat: (v) => ['رسالة جديدة 💬', [`من <b>${escHtml(v.from)}</b>:`, `<i>${escHtml(v.text)}</i>`], 'فتح المحادثة'],
  m_msg: (v) => ['رسالة جديدة في طلب 💬', [`من <b>${escHtml(v.from)}</b> بخصوص <b>${escHtml(v.service)}</b>:`, `<i>${escHtml(v.text)}</i>`], 'فتح المحادثة'],
  m_case_msg: (v) => ['تحديث في بلاغ ⚑', [`رد جديد في بلاغ متجر <b>${escHtml(v.store)}</b>:`, `<i>${escHtml(v.text)}</i>`], 'فتح البلاغ'],
  m_low_stock: (v) => ['المخزون قارب على النفاد 📦', [`بقي <b>${escHtml(String(v.left))}</b> كود فقط في خدمة <b>${escHtml(v.service)}</b>.`, 'أضف أكوادًا جديدة حتى لا تتوقف المبيعات.'], 'إضافة أكواد'],
  m_late: (v) => ['طلب متأخر ⏰', [`طلب <b>${escHtml(v.service)}</b> ينتظر تأكيدك منذ أكثر من ساعتين.`, 'التأخير يؤثر على تقييم متجرك.'], 'فتح الطلبات'],
  m_late_admin: (v) => ['طلب متأخر في متجر', [`${escHtml(v.store)}: طلب <b>${escHtml(v.service)}</b> لم يُؤكَّد منذ ساعتين.`], 'لوحة الإدارة'],
  m_renew_soon: (v) => ['اشتراك متجرك ينتهي قريبًا ⏳', [`اشتراك <b>${escHtml(v.store)}</b> ينتهي بعد <b>${escHtml(String(v.days))}</b> ${v.days === 1 ? 'يوم' : 'أيام'}.`, 'تواصل مع إدارة كاردو للتجديد حتى لا يختفي متجرك.'], 'لوحة متجري'],
  m_order_paid: (v) => ['تم تأكيد دفعك ✓', [`أكّد <b>${escHtml(v.store)}</b> استلام دفعتك لطلب <b>${escHtml(v.service)}</b>.`, 'طلبك قيد التنفيذ الآن، وسيصلك إشعار فور اكتماله.'], 'طلباتي'],
  m_order_done: (v) => ['طلبك جاهز 🎉', [`اكتمل طلبك <b>${escHtml(v.service)}</b> من <b>${escHtml(v.store)}</b>.`, 'افتح كاردو ← طلباتي لعرض الكود أو التفاصيل.'], 'عرض الطلب'],
  m_order_rejected: (v) => ['تعذّر تنفيذ طلبك', [`رفض <b>${escHtml(v.store)}</b> طلب <b>${escHtml(v.service)}</b>.`, v.reason ? `السبب: ${escHtml(v.reason)}` : '', 'إذا دفعت فعلًا، تواصل مع التاجر أو أبلغ عن المتجر من صفحته.'], 'طلباتي'],
  m_report: (v) => ['بلاغ على متجرك ⚠️', [`وصل بلاغ على متجر <b>${escHtml(v.store)}</b> — السبب: ${escHtml(v.reason)}.`, `<i>${escHtml(v.text)}</i>`, 'يرجى حل المشكلة مع الزبون سريعًا؛ إدارة كاردو اطّلعت على البلاغ.'], 'لوحة المتجر'],
  m_report_admin: (v) => ['بلاغ جديد على متجر', [`متجر: <b>${escHtml(v.store)}</b> — السبب: ${escHtml(v.reason)}.`, `<i>${escHtml(v.text)}</i>`], 'لوحة الإدارة'],
  m_welcome: (v) => ['مرحبًا بك تاجرًا في كاردو 🎉', [`تم إنشاء متجرك <b>${escHtml(v.store)}</b>.`, 'افتح كاردو ← الإعدادات ← «لوحة متجري» لإضافة شعارك وأرقام الدفع وخدماتك.'], 'لوحة متجري'],
  m_suspended: (v) => ['تم إيقاف متجرك', [`أُوقف متجر <b>${escHtml(v.store)}</b> مؤقتًا.`, 'تواصل مع إدارة كاردو لمعرفة السبب.'], 'فتح كاردو'],
  m_renewed: (v) => ['تم تجديد اشتراك متجرك ✓', [`متجر <b>${escHtml(v.store)}</b> فعّال حتى ${escHtml(v.until)}.`], 'لوحة متجري'],
  ticket_reply: (v) => ['ردّ فريق الدعم على تذكرتك 💬', [`تذكرتك «<b>${escHtml(v.subject)}</b>» وصلها رد جديد:`, `<i>${escHtml(v.preview)}</i>`, 'افتح كاردو ← الدعم لقراءة الرد كاملًا والرد عليه.'], 'عرض الرد'],
  transfer_in: (v) => ['وصلك تحويل', [`استلمت <b>$${escHtml(v.amount)}</b> من مستخدم في كاردو.`], 'فتح المحفظة'],
};

async function notifyUser(env, uid, kind, vars = {}) {
  try {
    await pushInApp(env, uid, kind, vars);
    const u = await fsGet(env, `users/${uid}`);
    await sendPush(env, uid, u, kind, vars).catch(() => {});
    if (!u || !u.email || u.notify_email === false) return false;
    if (u.email_verified !== true) return false;                 // لا بريد لعنوان غير مؤكَّد
    const [title, lines, cta] = MAIL[kind](vars);
    return await sendEmail(env, u.email, `كاردو — ${title}`, mailLayout(env, title, lines.filter(Boolean), cta));
  } catch (e) { console.error('NOTIFY_FAILED', kind); return false; }
}
function notify(env, uid, kind, vars) { background(notifyUser(env, uid, kind, vars)); }

async function handleAdminMailTest(user, body, env) {
  const staff = await requirePermission(user, env, 'settings.manage');
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) throw httpError(503, 'البريد غير مُعدّ: أضف RESEND_API_KEY و MAIL_FROM في Cloudflare');
  const ok = await notifyUser(env, staff.uid, 'test', {});
  if (!ok) throw httpError(502, `فشل الإرسال — رد Resend: ${_lastMailError || 'غير معروف'}`);
  return { success: true };
}

async function handleNotifyPrefs(user, body, env) {
  const on = body.email !== false;
  await fsPatch(env, `users/${user.uid}`, { notify_email: on });
  return { success: true, email: on };
}

/* ─── Encrypted delivered codes ─── */
async function encCodes(env, salt, codes) { return codes && codes.length ? encryptV2(env, salt, { c: codes }) : ''; }
async function decCodes(env, salt, blob) {
  if (!blob) return null;
  try { return (await decryptAny(env, salt, blob)).c || null; } catch { return null; }
}

async function migrateAndPurgeCodes(env) {
  const now = Date.now();
  let n = 0;
  const svc = await fsQueryRaw(env, { from: [{ collectionId: 'service_orders' }],
    where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'delivered' } } }, limit: 200 });
  for (const r of svc) {
    const d = withId(r, 'service_orders');
    const expired = new Date(d.delivered_expires_at || 0).getTime() < now;
    if (expired && (d.delivered_data || d.delivered_enc)) {
      await fsPatch(env, `service_orders/${d._id}`, { delivered_data: '', delivered_enc: '', delivered_purged_at: nowIso() }).catch(() => {}); n++;
    } else if (!expired && d.delivered_data) {
      const enc = await encCodes(env, `svcd:${d._id}`, [d.delivered_data]);
      await fsPatch(env, `service_orders/${d._id}`, { delivered_enc: enc, delivered_data: '' }).catch(() => {}); n++;
    }
  }
  const ords = await fsQueryRaw(env, { from: [{ collectionId: 'orders' }], limit: 300 });
  for (const r of ords) {
    const o = withId(r, 'orders');
    const items = Array.isArray(o.items) ? o.items : [];
    const old = now - new Date(o.created_at || 0).getTime() > STORE_CODES_TTL_DAYS * 86400000;
    let changed = false;
    for (const it of items) {
      if (old && (it.codes || it.codes_enc)) { it.codes = null; it.codes_enc = ''; it.codes_purged = true; changed = true; }
      else if (!old && Array.isArray(it.codes) && it.codes.length) { it.codes_enc = await encCodes(env, `code:${o._id}:${it.pid}`, it.codes); it.codes = null; changed = true; }
    }
    if (changed) { await fsPatch(env, `orders/${o._id}`, { items }).catch(() => {}); n++; }
  }
  return n;
}

/* ═══════════════════════════════════════════════════════════
   v8 — Email verification code, in-app notifications
   ═══════════════════════════════════════════════════════════ */

function mailOn(env) { return !!(env.RESEND_API_KEY && env.MAIL_FROM); }

function assertEmailVerified(env, s, doc) {
  if (!mailOn(env) || s.require_email_verify === false) return;
  if (!doc || doc.email_verified !== true) throw httpError(403, 'أكّد بريدك الإلكتروني أولًا من الإعدادات');
}

async function handleEmailSendCode(user, body, env) {
  if (!mailOn(env)) throw httpError(503, 'التحقق بالبريد غير متاح حاليًا');
  const u = await fsGet(env, `users/${user.uid}`);
  if (!u) throw httpError(400, 'الحساب غير مكتمل');
  if (u.email_verified === true) return { success: true, already: true };
  const email = String(u.email || user.email || '').trim().toLowerCase();
  if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(email)) throw httpError(400, 'لا يوجد بريد صالح في حسابك');
  if (!(await checkRateLimit(env, `evc_${user.uid}`, 4, 3600))) throw httpError(429, 'طلبات كثيرة — حاول بعد ساعة');
  if (!(await checkRateLimit(env, `evce_${(await sha256Hex('mail:' + email)).slice(0, 24)}`, 6, 86400))) throw httpError(429, 'أُرسلت رموز كثيرة لهذا البريد اليوم — حاول غدًا');
  const b = crypto.getRandomValues(new Uint32Array(1))[0];
  const code = String(100000 + (b % 900000));
  await fsSet(env, `email_codes/${user.uid}`, {
    hash: await sha256Hex(`${user.uid}:${code}`), email, attempts: 0,
    expires_ms: Date.now() + 10 * 60000, created_at: nowIso(),
  });
  const [title, lines] = MAIL.verify_code({ code });
  const ok = await sendEmail(env, email, `كاردو — ${title}`, mailLayout(env, title, lines, ''));
  if (!ok) throw httpError(502, 'تعذّر إرسال البريد — حاول بعد قليل');
  return { success: true, sent_to: email.replace(/^(.{2}).*(@.*)$/, '$1•••$2') };
}

async function handleEmailVerifyCode(user, body, env) {
  const code = toLatinDigits(body.code || '').replace(/\D/g, '');
  if (code.length !== 6) throw httpError(400, 'الرمز 6 أرقام');
  const res = await fsRunTransaction(env, async (tx) => {
    const d = await tx.get(`email_codes/${user.uid}`);
    if (!d) throw httpError(404, 'اطلب رمزًا جديدًا');
    if (num(d.expires_ms, 0) < Date.now()) { tx.delete(`email_codes/${user.uid}`); return 'expired'; }
    if (num(d.attempts, 0) >= 5) { tx.delete(`email_codes/${user.uid}`); return 'locked'; }
    const ok = await safeEqual(await sha256Hex(`${user.uid}:${code}`), d.hash);
    if (!ok) { tx.update(`email_codes/${user.uid}`, { attempts: num(d.attempts, 0) + 1 }); return 'wrong'; }
    const u = await tx.get(`users/${user.uid}`);
    if (!u) throw httpError(400, 'الحساب غير مكتمل');
    tx.update(`users/${user.uid}`, { email_verified: true, email_verified_at: nowIso() });
    tx.delete(`email_codes/${user.uid}`);
    return 'ok';
  });
  if (res === 'expired') throw httpError(410, 'انتهت صلاحية الرمز — اطلب رمزًا جديدًا');
  if (res === 'locked') throw httpError(429, 'محاولات كثيرة — اطلب رمزًا جديدًا');
  if (res === 'wrong') throw httpError(400, 'الرمز غير صحيح');
  await logOp(env, user.uid, 'email.verified', {}, {}, true);
  return { success: true };
}

function stripHtml(s) { return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim(); }

async function pushInApp(env, uid, kind, vars) {
  const [title, lines] = MAIL[kind](vars);
  const id = `N${Date.now()}${randomSuffix(6)}`;
  await fsCommit(env, [{
    update: { name: docPath(env, `notifications/${id}`), fields: toFsFields({
      uid, kind, title: stripHtml(title).slice(0, 120), link: String(vars.link || '').slice(0, 80),
      body: lines.filter(Boolean).map(stripHtml).join(' ').slice(0, 400),
      read: false, created_at: nowIso(),
    }) },
    currentDocument: { exists: false },
  }]).catch(() => {});
}

async function handleNotifyRead(user, body, env) {
  const rows = await fsQueryRaw(env, {
    from: [{ collectionId: 'notifications' }],
    where: { compositeFilter: { op: 'AND', filters: [
      { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: user.uid } } },
      { fieldFilter: { field: { fieldPath: 'read' }, op: 'EQUAL', value: { booleanValue: false } } },
    ] } }, limit: 100,
  });
  if (rows.length) {
    await fsCommit(env, rows.map(r => ({
      update: { name: r.document.name, fields: toFsFields({ read: true }) }, updateMask: { fieldPaths: ['read'] },
    })));
  }
  return { success: true, marked: rows.length };
}

/* ═══ v9.2 — نسخة احتياطية يدوية (بديل مجاني عن Scheduled Backups) ═══ */
const BACKUP_COLLECTIONS = [
  'users', 'admins', 'wallet_transactions', 'wallet_deposits', 'withdrawals', 'transfers',
  'manual_cards', 'manual_card_orders', 'manual_card_reveal', 'card_cvv_once',
  'orders', 'service_orders', 'products', 'categories', 'stock', 'services', 'service_stock',
  'coupons', 'coupon_uses', 'tickets', 'notifications', 'plan_orders', 'sms_transactions',
  'phone_bindings', 'usdt_invoices', 'usdt_txids', 'ref_codes', 'audit_log', 'settings', 'stickers', 'merchants', 'merchant_services', 'merchant_stock', 'merchant_orders', 'merchant_reports', 'merchant_reviews', 'merchant_applications', 'merchant_statements', 'merchant_sections', 'merchant_chats', 'platforms',
];

async function fsQueryStrict(env, structuredQuery) {
  const res = await fsFetch(env, ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery }) });
  return (Array.isArray(res) ? res : []).filter(r => r && r.document);
}

async function handleAdminBackup(user, body, env) {
  const staff = await requirePermission(user, env, 'settings.manage');
  if (staff.role !== 'super_admin') throw httpError(403, 'للمسؤول الرئيسي فقط');
  requireFreshAuth(user, 900);
  if (!(await checkRateLimit(env, `backup_${user.uid}`, 6, 3600))) throw httpError(429, 'انتظر قليلًا قبل نسخة أخرى');
  const out = {}, counts = {};
  for (const coll of BACKUP_COLLECTIONS) {
    const rows = [];
    let last = null;
    for (let page = 0; page < 40; page++) {                 // حتى 20 ألف مستند لكل مجموعة
      const q = { from: [{ collectionId: coll }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: 500 };
      if (last) q.startAt = { values: [{ referenceValue: last }], before: false };
      const res = await fsQueryStrict(env, q);
      for (const r of res) rows.push({ _id: r.document.name.split('/').pop(), ...fromFsFields(r.document.fields || {}) });
      if (res.length < 500) break;
      last = res[res.length - 1].document.name;
    }
    out[coll] = rows; counts[coll] = rows.length;
  }
  await logOp(env, staff.uid, 'system.backup', {}, { counts }, true);
  return { success: true, project: env.FIREBASE_PROJECT_ID, exported_at: nowIso(), note: 'البيانات الحساسة تبقى مشفّرة داخل النسخة', counts, data: out };
}

/* ═══════════════════════════════════════════════════════════
   v10 — صور عبر رابط (بدل base64 داخل JSON) + Sitemap
   ═══════════════════════════════════════════════════════════ */
const API_ORIGIN_DEFAULT = 'https://kardo.sdkhyrallh08.workers.dev';
function apiOrigin(env) { return String(env.API_ORIGIN || API_ORIGIN_DEFAULT).replace(/\/+$/, ''); }
function strHash(s) { let h = 5381; for (let i = 0; i < s.length; i += 7) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + s.length.toString(36); }

// data:image → رابط قابل للتخزين المؤقت؛ الروابط الخارجية تبقى كما هي
function imgRef(env, kind, id, data) {
  const v = String(data || '');
  if (!v) return '';
  if (!v.startsWith('data:')) return v;
  return `${apiOrigin(env)}/img/${kind}/${encodeURIComponent(id)}?v=${strHash(v)}`;
}

async function loadImageData(env, kind, id) {
  if (kind === 'p') return (await fsGet(env, `products/${id}`) || {}).image;
  if (kind === 'c') return (await fsGet(env, `categories/${id}`) || {}).image;
  if (kind === 's') return (await fsGet(env, `stickers/${id}`) || {}).image;
  if (kind === 'l') return (await fsGet(env, `merchants/${id}`) || {}).logo;
  if (kind === 'v') return (await fsGet(env, `merchants/${id}`) || {}).cover;
  if (kind === 'x') return (await fsGet(env, `merchant_services/${id}`) || {}).image;
  if (kind === 'y') return (await fsGet(env, `merchant_sections/${id}`) || {}).image;
  if (kind === 'g') return (await fsGet(env, `platforms/${id}`) || {}).image;
  if (kind === 'm' || kind === 'b') {
    const s = await getSettings(env);
    if (kind === 'b') { const b = (s.banners || [])[Number(id)]; return b && (b.img || b.image); }
    if (/^[a-z]+$/.test(id) && s[`m_${id}_logo`]) return s[`m_${id}_logo`];
    const cm = cleanCustomMethods(s.custom_methods)[id];
    return cm && cm.logo;
  }
  return '';
}

async function handleImage(request, env, ctx, kind, id) {
  const cache = caches.default;
  const u = new URL(request.url);
  const ck = new Request(u.origin + u.pathname);                 // مفتاح بلا ?v حتى لا يُتجاوز التخزين
  const hit = await cache.match(ck);
  if (hit) return hit;
  const data = String(await loadImageData(env, kind, id) || '');
  const m = /^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!m) { const nf = new Response('Not found', { status: 404, headers: { 'cache-control': 'public, max-age=300' } }); ctx.waitUntil(cache.put(ck, nf.clone())); return nf; }
  const bin = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
  const res = new Response(bin, { headers: {
    'content-type': m[1], 'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*',
    ...(m[1] === 'image/svg+xml' ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}),
  } });
  ctx.waitUntil(cache.put(ck, new Response(res.clone().body, { headers: { ...Object.fromEntries(res.headers), 'cache-control': 'public, max-age=3600' } })));
  return res;
}

async function handleSitemap(env) {
  const site = siteUrl(env);
  const s = await getSettings(env);
  const cat = s.kardo_store_on === true ? await handleCatalog(env) : { categories: [], products: [] };
  const ml = await handleMerchantsList(env);          // فارغة عند إيقاف المتاجر
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    [`${site}/`, '1.0'], ...(s.merchants_on === true ? [[`${site}/stores.html`, '0.9']] : []),
    ...ml.merchants.filter(m => m.slug).map(m => [`${site}/store.html?s=${encodeURIComponent(m.slug)}`, '0.85']),
    ...(s.kardo_store_on === true ? [[`${site}/category.html`, '0.9']] : []), [`${site}/visa-libya.html`, '0.9'], [`${site}/terms.html`, '0.3'],
    ...cat.categories.map(c => [`${site}/category.html?id=${encodeURIComponent(c.id)}`, '0.85']),
    ...cat.products.map(p => [`${site}/product.html?id=${encodeURIComponent(p.id)}`, '0.8']),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(([u, pr]) => `  <url><loc>${escHtml(u)}</loc><lastmod>${today}</lastmod><priority>${pr}</priority></url>`).join('\n') +
    `\n</urlset>\n`;
  return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}

/* ═══════════════════════════════════════════════════════════
   v11 — رموز 3D Secure من بريد المزوّد (Zid Cash) إلى العميل
   البريد لا يحتوي رقم البطاقة، فالمطابقة بالمبلغ + الوقت،
   والعميل يطلب الرمز بإدخال مبلغ عمليته. الرمز لا ينفع بدون بيانات البطاقة.
   ═══════════════════════════════════════════════════════════ */
const OTP_TTL_MS = 10 * 60000;

async function handleOtpInbound(request, env) {
  if (request.method !== 'POST') throw httpError(405, 'method');
  const provided = request.headers.get('x-otp-secret') || request.headers.get('x-sms-secret') || '';
  const expected = env.SMS_WEBHOOK_SECRET || '';
  if (!expected || expected.length < 16 || !(await safeEqual(provided, expected))) throw httpError(401, 'unauthorized');
  let body = {};
  try { body = JSON.parse((await request.text()).slice(0, 8000)); } catch { throw httpError(400, 'bad json'); }
  const code = toLatinDigits(body.code || '').replace(/\D/g, '');
  const amount = round2(num(String(body.amount || '').replace(/[^\d.]/g, ''), NaN));
  const merchant = String(body.merchant || '').replace(/[<>]/g, '').trim().slice(0, 80);
  const msgId = String(body.message_id || '').slice(0, 200);
  if (!/^\d{4,8}$/.test(code) || !(amount >= 0)) throw httpError(400, 'invalid');
  const id = (await sha256Hex('otp:' + (msgId || `${code}|${amount}|${merchant}|${body.received_at || ''}`))).slice(0, 40);
  const r = await fsCommit(env, [{
    update: { name: docPath(env, `otp_codes/${id}`), fields: toFsFields({
      code_enc: await encCodes(env, `otp:${id}`, [code]), amount, merchant, claimed_by: '',
      received_at: nowIso(), expires_ms: Date.now() + OTP_TTL_MS,
    }) },
    currentDocument: { exists: false },
  }]).catch(async e => { if (await fsGet(env, `otp_codes/${id}`)) return 'dup'; throw e; });
  return { success: true, duplicate: r === 'dup' };
}

async function handleOtpClaim(user, body, env) {
  const amount = round2(num(body.amount, NaN));
  if (!(amount > 0)) throw httpError(400, 'أدخل مبلغ العملية كما يظهر في صفحة الدفع');
  if (!(await checkRateLimit(env, `otp_${user.uid}`, 30, 3600))) throw httpError(429, 'محاولات كثيرة — حاول بعد قليل');
  const cards = await fsQueryStrict(env, {
    from: [{ collectionId: 'manual_cards' }],
    where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: user.uid } } }, limit: 50,
  });
  if (!cards.map(r => withId(r, 'manual_cards')).some(c => c.status === 'active')) throw httpError(403, 'هذه الخدمة لأصحاب البطاقات النشطة فقط');

  const now = Date.now();
  // يجب أن يبدأ العميل الانتظار بنفس المبلغ قبل وصول الرمز (يمنع سحب رموز الآخرين)
  const waitId = `${user.uid}_${Math.round(amount * 100)}`;
  let wait = await fsGet(env, `otp_waits/${waitId}`);
  if (!wait || num(wait.since_ms, 0) < now - 15 * 60000) {
    wait = { uid: user.uid, amount, since_ms: now, expires_ms: now + 15 * 60000 };
    await fsSet(env, `otp_waits/${waitId}`, wait);
  }
  const rows = await fsQueryStrict(env, {
    from: [{ collectionId: 'otp_codes' }],
    where: { fieldFilter: { field: { fieldPath: 'expires_ms' }, op: 'GREATER_THAN', value: { integerValue: String(now) } } }, limit: 50,
  });
  const list = rows.map(r => withId(r, 'otp_codes'))
    .filter(o => Math.abs(num(o.amount, -1) - amount) <= 0.01 && (!o.claimed_by || o.claimed_by === user.uid)
      && (o.claimed_by === user.uid || new Date(o.received_at).getTime() >= num(wait.since_ms, now) - 90000))
    .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)));
  if (!list.length) return { success: true, pending: true };

  const pick = list[0];
  const got = await fsRunTransaction(env, async (tx) => {
    const o = await tx.get(`otp_codes/${pick._id}`);
    if (!o || num(o.expires_ms, 0) < Date.now()) return null;
    if (o.claimed_by && o.claimed_by !== user.uid) return null;
    if (!o.claimed_by) tx.update(`otp_codes/${pick._id}`, { claimed_by: user.uid, claimed_at: nowIso() });
    return o;
  });
  if (!got) return { success: true, pending: true };
  const c = await decCodes(env, `otp:${pick._id}`, got.code_enc);
  if (!c) throw httpError(500, 'تعذّر قراءة الرمز');
  await logOp(env, user.uid, 'otp.claim', { amount }, { merchant: got.merchant }, true);
  return { success: true, code: c[0], merchant: got.merchant, amount: got.amount, valid_until: new Date(got.received_at).getTime() + 5 * 60000 };
}

async function purgeExpiredOtp(env) {
  const rows = await fsQueryRaw(env, {
    from: [{ collectionId: 'otp_codes' }],
    where: { fieldFilter: { field: { fieldPath: 'expires_ms' }, op: 'LESS_THAN', value: { integerValue: String(Date.now()) } } }, limit: 100,
  });
  for (const r of rows) await fsCommit(env, [{ delete: r.document.name }]).catch(() => {});
}


/* ═══ v11 — رصيد البطاقة اليدوي + الملصقات ═══ */
async function handleAdminCardBalance(user, body, env) {
  const staff = await requirePermission(user, env, 'cards.edit');
  const cardId = String(body.card_id || '').trim();
  const bal = round2(num(body.balance, NaN));
  if (!cardId) throw httpError(400, 'البطاقة مفقودة');
  if (!(bal >= 0) || bal > 1000000) throw httpError(400, 'الرصيد غير صالح');
  let before = 0, owner = '';
  await fsRunTransaction(env, async (tx) => {
    const c = await tx.get(`manual_cards/${cardId}`);
    if (!c) throw httpError(404, 'البطاقة غير موجودة');
    before = num(c.balance, 0); owner = c.uid;
    tx.update(`manual_cards/${cardId}`, { balance: bal, balance_updated_at: nowIso(), balance_updated_by: staff.uid });
  });
  await logOp(env, staff.uid, 'card.balance', { cardId, before, after: bal }, {}, true);
  return { success: true, balance: bal };
}

const STICKER_SLOTS = ['welcome', 'purchase', 'card', 'deposit', 'failed', 'wait', 'empty', 'no_cards', 'mail', 'offline', 'error', 'plan', 'ticket'];
async function handleAdminStickerSave(user, body, env) {
  const staff = await requirePermission(user, env, 'stickers.edit');
  const slot = String(body.slot || '');
  if (!STICKER_SLOTS.includes(slot)) throw httpError(400, 'موقف غير معروف');
  const img = String(body.image || '');
  if (img) {
    if (!/^data:image\/(png|webp|gif|jpeg);base64,[A-Za-z0-9+/=]+$/.test(img)) throw httpError(400, 'صيغة الصورة غير مدعومة');
    if (img.length > 250000) throw httpError(400, 'الصورة كبيرة — الحد 180KB تقريبًا');
    await fsSet(env, `stickers/${slot}`, { image: img, updated_at: nowIso(), updated_by: staff.uid });
  } else {
    await fsDelete(env, `stickers/${slot}`).catch(() => {});
  }
  _pubCache.clear();
  await logOp(env, staff.uid, 'sticker.' + (img ? 'set' : 'clear'), { slot }, {}, true);
  return { success: true };
}
async function loadStickerRefs(env) {
  const rows = await fsQueryRaw(env, { from: [{ collectionId: 'stickers' }], limit: 50 });
  const out = {};
  for (const r of rows) { const d = withId(r, 'stickers'); if (STICKER_SLOTS.includes(d._id) && d.image) out[d._id] = imgRef(env, 's', d._id, d.image); }
  return out;
}

/* ═══════════════════════════════════════════════════════════
   v12 — المتاجر الموثوقة (Marketplace)
   • كاردو لا تستلم أموال التجار: الزبون يحوّل لأرقام التاجر ويرفق الإيصال،
     والتاجر يؤكد وينفّذ (يدويًا أو من مخزون أكواد مشفّر).
   • التاجر يرى متجره فقط (تحقق الملكية في الخادم + قواعد Firestore).
   ═══════════════════════════════════════════════════════════ */
const M_CATEGORIES = ['ألعاب', 'اشتراكات', 'بطاقات رقمية', 'برامج', 'إلكترونيات', 'خدمات', 'أخرى'];
const M_ACTIVE = m => m && m.status === 'active' && m.billing_hold !== true
  && (m.billing_mode === 'percent' || num(m.sub_expires_ms, 0) > Date.now());
const ymOf = (t = Date.now()) => new Date(t).toISOString().slice(0, 7);          // YYYY-MM
const hasCommission = m => (m.billing_mode === 'percent' || m.billing_mode === 'hybrid') && num(m.commission_pct, 0) > 0;
async function accrueSale(tx, m, price) {
  if (!hasCommission(m)) return;
  const sid = `${m._id}_${ymOf()}`;
  const st = await tx.get(`merchant_statements/${sid}`);
  const pct = num(m.commission_pct, 0);
  if (!st) tx.create('merchant_statements', sid, { mid: m._id, merchant_owner: m.owner_uid, merchant_name: m.name, month: ymOf(),
    sales: round2(price), orders: 1, pct, commission: round2(price * pct / 100), status: 'open', created_at: nowIso() });
  else { const sales = round2(num(st.sales, 0) + price); tx.update(`merchant_statements/${sid}`, { sales, orders: num(st.orders, 0) + 1, pct, commission: round2(sales * pct / 100) }); }
}

function merchantTier(m) {
  if (['gold', 'silver', 'none'].includes(m.tier)) return m.tier === 'none' ? '' : m.tier;
  const done = num(m.orders_done, 0), rc = num(m.rating_count, 0), r = rc ? num(m.rating_sum, 0) / rc : 5;
  const rej = num(m.rejected_count, 0), reps = num(m.reports_count, 0);
  if (done >= 100 && r >= 4.5 && reps <= done * 0.02) return 'gold';
  if (done >= 20 && r >= 4 && rej <= done * 0.2) return 'silver';
  return '';
}
// جدول العمل التلقائي بتوقيت ليبيا (UTC+2)
function cleanSchedule(s) {
  if (!s || s.enabled !== true) return { enabled: false };
  const hm = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v) : null;
  const days = [...new Set((Array.isArray(s.days) ? s.days : []).map(Number).filter(d => d >= 0 && d <= 6))].sort();
  const from = hm(s.from), to = hm(s.to);
  if (!days.length || !from || !to || from === to) throw httpError(400, 'اختر أيام العمل ووقت البداية والنهاية');
  return { enabled: true, days, from, to };
}
const DAY_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
function scheduleText(sc) {
  if (!sc || !sc.enabled) return '';
  const d = sc.days.length === 7 ? 'يوميًا' : sc.days.map(x => DAY_AR[x]).join('، ');
  return `${d} ${sc.from}–${sc.to}`;
}
function openNow(m, now = Date.now()) {
  if (m.open === false) return false;
  const sc = m.schedule;
  if (!sc || !sc.enabled) return true;
  const ly = new Date(now + 2 * 3600000);                       // ليبيا UTC+2 بدون توقيت صيفي
  const mins = ly.getUTCHours() * 60 + ly.getUTCMinutes();
  const toMin = v => +v.slice(0, 2) * 60 + +v.slice(3, 5);
  const f = toMin(sc.from), t = toMin(sc.to), day = ly.getUTCDay();
  if (f < t) return sc.days.includes(day) && mins >= f && mins < t;
  // دوام يتجاوز منتصف الليل: الجزء بعد منتصف الليل يتبع يوم البداية (الأمس)
  if (mins >= f) return sc.days.includes(day);
  return mins < t && sc.days.includes((day + 6) % 7);
}
function billingOf(b) {
  const mode = ['fixed', 'percent', 'hybrid'].includes(b.billing_mode) ? b.billing_mode : 'fixed';
  const pct = Math.max(0, Math.min(50, round2(num(b.commission_pct, 0))));
  if (mode !== 'fixed' && !(pct > 0)) throw httpError(400, 'حدد نسبة العمولة (أكبر من صفر)');
  return { billing_mode: mode, commission_pct: mode === 'fixed' ? 0 : pct };
}
function cleanSlug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').slice(0, 30); }
function cleanImg(raw, max = 300000) {
  const s = String(raw || '');
  if (!s) return '';
  if (/^https:\/\//.test(s)) return s.slice(0, 500);
  if (!/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s)) throw httpError(400, 'صورة غير صالحة');
  if (s.length > max) throw httpError(400, 'الصورة كبيرة');
  return s;
}
function cleanContacts(c) {
  c = c || {};
  const phone = v => String(v || '').replace(/[^\d+]/g, '').slice(0, 16);
  const handle = v => String(v || '').replace(/[^A-Za-z0-9_.]/g, '').slice(0, 40);
  return { whatsapp: phone(c.whatsapp), telegram: handle(c.telegram), facebook: String(c.facebook || '').replace(/[<>"']/g, '').slice(0, 120) };
}

async function getMyMerchant(env, uid) {
  const u = await fsGet(env, `users/${uid}`);
  if (!u || !u.merchant_id) throw httpError(403, 'حسابك ليس حساب تاجر');
  const m = await fsGet(env, `merchants/${u.merchant_id}`);
  if (!m || m.owner_uid !== uid) throw httpError(403, 'المتجر غير مرتبط بحسابك');
  if (m.status === 'suspended') throw httpError(403, 'متجرك موقوف — تواصل مع إدارة كاردو');
  if (!m.terms_accepted_at) throw httpError(403, 'وافق على اتفاقية التاجر أولًا من لوحة متجرك');
  return { ...m, _id: u.merchant_id };
}
function mImgRef(env, kind, id, data) { return imgRef(env, kind, id, data); }

/* ─── عام: قائمة المتاجر وخدماتها (مخزّنة مؤقتًا) ─── */
async function handleMerchantsList(env) {
  if ((await getSettings(env)).merchants_on !== true) return { success: true, categories: M_CATEGORIES, merchants: [], services: [], sections: [], off: true };
  return (async () => {
    const [mRows, sRows, secRows] = await Promise.all([
      fsQueryStrict(env, { from: [{ collectionId: 'merchants' }], limit: 300 }),
      fsQueryStrict(env, { from: [{ collectionId: 'merchant_services' }], limit: 3000 }),
      fsQueryStrict(env, { from: [{ collectionId: 'merchant_sections' }], limit: 1500 }),
    ]);
    const merchants = mRows.map(r => withId(r, 'merchants')).filter(M_ACTIVE).map(m => ({
      id: m._id, slug: m.slug || '', name: m.name, category: m.category || 'أخرى', bio: m.bio || '',
      logo: mImgRef(env, 'l', m._id, m.logo), cover: mImgRef(env, 'v', m._id, m.cover),
      contacts: cleanContacts(m.contacts), pay_methods: Array.isArray(m.pay_methods) ? m.pay_methods.slice(0, 6) : [],
      orders_done: num(m.orders_done, 0), rating: num(m.rating_count, 0) ? round2(num(m.rating_sum, 0) / num(m.rating_count, 1)) : 0,
      rating_count: num(m.rating_count, 0), featured: m.featured === true || num(m.featured_until, 0) > Date.now(),
      promo: num(m.featured_until, 0) > Date.now(), open: openNow(m), hours: (scheduleText(m.schedule) || String(m.hours || '')).slice(0, 80), tier: merchantTier(m),
      avg_confirm_min: num(m.confirm_count, 0) ? Math.round(num(m.confirm_ms_sum, 0) / num(m.confirm_count, 1) / 60000) : null,
    })).sort((a, b) => (b.featured - a.featured) || (b.orders_done - a.orders_done));
    const live = new Set(merchants.map(m => m.id));
    const services = sRows.map(r => withId(r, 'merchant_services')).filter(s => live.has(s.mid) && s.active !== false).map(s => ({
      id: s._id, mid: s.mid, name: s.name, desc: s.desc || '', price: num(s.price, 0), image: mImgRef(env, 'x', s._id, s.image),
      delivery: s.delivery === 'stock' ? 'stock' : 'manual', stock: s.delivery === 'stock' ? num(s.stock_count, 0) : null,
      fields: Array.isArray(s.fields) ? s.fields.slice(0, 3) : [], eta: String(s.eta || '').slice(0, 40),
      old_price: num(s.old_price, 0) > num(s.price, 0) ? num(s.old_price, 0) : 0, section: String(s.section || '').slice(0, 30),
      section_id: String(s.section_id || ''),
    }));
    const sections = secRows.map(r => withId(r, 'merchant_sections')).filter(x => live.has(x.mid)).map(x => ({
      id: x._id, mid: x.mid, name: x.name, image: mImgRef(env, 'y', x._id, x.image), order: num(x.order, 0), delivery: x.delivery === 'auto' ? 'auto' : 'manual',
    })).sort((a, b) => a.order - b.order);
    return { success: true, categories: M_CATEGORIES, merchants, services, sections };
  })();
}

/* ─── الزبون: طلب خدمة (الدفع مباشرة للتاجر + إيصال) ─── */
async function handleMerchantOrder(user, body, env) {
  if ((await getSettings(env)).merchants_on !== true) throw httpError(403, 'المتاجر الموثوقة غير متاحة حاليًا');
  const s = await getSettings(env); assertLive(s);
  const sid = String(body.sid || '').trim();
  const svc = sid && await fsGet(env, `merchant_services/${sid}`);
  if (!svc || svc.active === false) throw httpError(404, 'الخدمة غير متاحة');
  const m = await fsGet(env, `merchants/${svc.mid}`);
  if (!M_ACTIVE(m)) throw httpError(403, 'هذا المتجر غير متاح حاليًا');
  if (m.owner_uid === user.uid) throw httpError(400, 'لا يمكنك الشراء من متجرك');
  if (!openNow(m)) throw httpError(403, `المتجر مغلق حاليًا${m.schedule && m.schedule.enabled ? ' — أوقات العمل: ' + scheduleText(m.schedule) : ''}`);
  if (Array.isArray(m.blocked) && m.blocked.includes(user.uid)) throw httpError(403, 'لا يمكنك الطلب من هذا المتجر');
  if (svc.delivery === 'stock' && num(svc.stock_count, 0) < 1) throw httpError(409, 'نفذت الكمية');
  const u = await fsGet(env, `users/${user.uid}`);
  if (!u || u.banned === true) throw httpError(403, 'الحساب موقوف');
  const idk = String(body.idempotency_key || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
  const fixedId = idk.length >= 8 ? `MO${(await sha256Hex(user.uid + ':' + idk)).slice(0, 22)}` : '';
  if (fixedId) { const ex = await fsGet(env, `merchant_orders/${fixedId}`); if (ex && ex.uid === user.uid) return { success: true, id: fixedId, duplicate: true }; }
  const proof = cleanProofImage(body.proof);
  if (!proof) throw httpError(400, 'أرفق صورة إيصال التحويل');
  const reference = '';
  const proofHash = (await sha256Hex('proof:' + proof)).slice(0, 40);
  const dupRows = await fsQueryStrict(env, { from: [{ collectionId: 'merchant_orders' }],
    where: { fieldFilter: { field: { fieldPath: 'proof_hash' }, op: 'EQUAL', value: { stringValue: proofHash } } }, limit: 3 });
  const dupOf = dupRows.map(r => withId(r, 'merchant_orders')).filter(o => o.status !== 'rejected').map(o => o._id);
  const payMethod = String(body.pay_method || '').slice(0, 40);
  const inputs = {};
  (Array.isArray(svc.fields) ? svc.fields : []).forEach((f, i) => {
    const v = String((body.inputs || {})[i] ?? '').trim().slice(0, 120);
    if (!v) throw httpError(400, `أدخل: ${f}`);
    inputs[f] = v;
  });
  if (!(await checkRateLimit(env, `morder_${user.uid}`, 10, 3600))) throw httpError(429, 'طلبات كثيرة — حاول بعد قليل');
  const pend = await fsQueryStrict(env, {
    from: [{ collectionId: 'merchant_orders' }],
    where: { compositeFilter: { op: 'AND', filters: [
      { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: user.uid } } },
      { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } },
    ] } }, limit: 6,
  });
  if (pend.length >= 5) throw httpError(429, 'لديك طلبات كثيرة بانتظار التأكيد');
  const id = fixedId || `MO${Date.now()}${randomSuffix(4)}`;
  await fsSet(env, `merchant_orders/${id}`, {
    mid: svc.mid, sid, uid: user.uid, customer_name: String(u.name || '').slice(0, 60),
    merchant_owner: m.owner_uid, merchant_name: m.name, service_name: svc.name, price: num(svc.price, 0),
    delivery: svc.delivery === 'stock' ? 'stock' : 'manual', pay_method: payMethod, proof, reference, inputs,
    proof_hash: proofHash, dup_proof: dupOf.length > 0, dup_of: dupOf.slice(0, 3), eta: String(svc.eta || '').slice(0, 40),
    messages: [], status: 'pending', created_at: nowIso(), updated_at: nowIso(),
  });
  notify(env, m.owner_uid, 'm_new_order', { service: svc.name, price: num(svc.price, 0), dup: dupOf.length > 0, link: 'mstore:orders' });
  return { success: true, id, dup_proof: dupOf.length > 0 };
}

async function handleMerchantOrderCode(user, body, env) {
  const oid = String(body.id || '');
  const o = await fsGet(env, `merchant_orders/${oid}`);
  if (!o || o.uid !== user.uid) throw httpError(404, 'الطلب غير موجود');
  if (o.status !== 'completed') throw httpError(400, 'الطلب لم يكتمل بعد');
  const c = await decCodes(env, `mo:${oid}`, o.delivered_enc);
  return { success: true, delivered: c ? c[0] : (o.delivered_note || '') };
}

async function handleMerchantRate(user, body, env) {
  const oid = String(body.id || ''), stars = Math.round(num(body.stars, 0));
  if (stars < 1 || stars > 5) throw httpError(400, 'تقييم غير صالح');
  let mid = '';
  await fsRunTransaction(env, async (tx) => {
    const o = await tx.get(`merchant_orders/${oid}`);
    if (!o || o.uid !== user.uid) throw httpError(404, 'الطلب غير موجود');
    if (o.status !== 'completed') throw httpError(400, 'قيّم بعد اكتمال الطلب');
    if (o.rated) throw httpError(409, 'قيّمت هذا الطلب مسبقًا');
    const m = await tx.get(`merchants/${o.mid}`);
    if (!m) throw httpError(404, 'المتجر غير موجود');
    mid = o.mid;
    tx.update(`merchant_orders/${oid}`, { rated: stars });
    tx.update(`merchants/${o.mid}`, { rating_sum: num(m.rating_sum, 0) + stars, rating_count: num(m.rating_count, 0) + 1 });
    const text = String(body.text || '').replace(/[<>]/g, '').trim().slice(0, 300);
    const cu = await tx.get(`users/${user.uid}`);
    tx.create('merchant_reviews', `RV${oid}`, { mid: o.mid, uid: user.uid, name: String((cu && cu.name) || 'زبون').split(' ')[0].slice(0, 20),
      stars, text, service: o.service_name, created_at: nowIso() });
  });
  _pubCache.clear();
  return { success: true, mid };
}

/* ─── الإبلاغ عن متجر: يصل للتاجر وللإدارة ─── */
async function handleMerchantReport(user, body, env) {
  const mid = String(body.mid || '');
  const m = await fsGet(env, `merchants/${mid}`);
  if (!m) throw httpError(404, 'المتجر غير موجود');
  const reason = String(body.reason || '').slice(0, 60);
  const text = String(body.text || '').replace(/[<>]/g, '').trim().slice(0, 1000);
  if (!reason || text.length < 5) throw httpError(400, 'اختر السبب واكتب التفاصيل');
  if (!(await checkRateLimit(env, `mreport_${user.uid}`, 5, 86400))) throw httpError(429, 'أرسلت بلاغات كثيرة اليوم');
  const oid = String(body.oid || '').slice(0, 40);
  const id = `RP${Date.now()}${randomSuffix(4)}`;
  const u = await fsGet(env, `users/${user.uid}`) || {};
  await fsSet(env, `merchant_reports/${id}`, { mid, merchant_name: m.name, merchant_owner: m.owner_uid, uid: user.uid, customer_name: String(u.name || ''), oid, reason, text,
    messages: [{ by: 'customer', text, at: nowIso() }], status: 'open', created_at: nowIso(), updated_at: nowIso() });
  await fsPatch(env, `merchants/${mid}`, { reports_count: num(m.reports_count, 0) + 1 });
  notify(env, m.owner_uid, 'm_report', { store: m.name, reason, text, link: 'mstore:home' });
  const admins = await fsQueryRaw(env, { from: [{ collectionId: 'admins' }], limit: 50 });
  admins.map(r => withId(r, 'admins')).filter(a => a.role === 'super_admin' || staffCan(a, 'merchants.view'))
    .forEach(a => notify(env, a._id, 'm_report_admin', { store: m.name, reason, text }));
  return { success: true, id };
}

/* ─── لوحة التاجر ─── */
async function handleMerchantMe(user, body, env) {
  const u = await fsGet(env, `users/${user.uid}`);
  if (!u || !u.merchant_id) return { success: true, merchant: null };
  const m = await fsGet(env, `merchants/${u.merchant_id}`);
  if (!m || m.owner_uid !== user.uid) return { success: true, merchant: null };
  const sv = await fsQueryStrict(env, { from: [{ collectionId: 'merchant_services' }],
    where: { fieldFilter: { field: { fieldPath: 'mid' }, op: 'EQUAL', value: { stringValue: u.merchant_id } } }, limit: 300 });
  return { success: true, categories: M_CATEGORIES, merchant: {
    terms_accepted: !!m.terms_accepted_at, open: m.open !== false, open_now: openNow(m), schedule: m.schedule || { enabled: false }, billing_mode: m.billing_mode || 'fixed', commission_pct: num(m.commission_pct, 0), billing_hold: m.billing_hold === true, hours: m.hours || '', quick_replies: m.quick_replies || [],
    blocked: (m.blocked || []).length, tier: merchantTier(m),
    avg_confirm_min: num(m.confirm_count, 0) ? Math.round(num(m.confirm_ms_sum, 0) / num(m.confirm_count, 1) / 60000) : null,
    id: u.merchant_id, name: m.name, slug: m.slug || '', category: m.category, bio: m.bio || '', logo: m.logo || '', cover: m.cover || '',
    contacts: cleanContacts(m.contacts), pay_methods: m.pay_methods || [], status: m.status, active: M_ACTIVE(m),
    sub_expires_ms: num(m.sub_expires_ms, 0), sub_price: num(m.sub_price, 0), orders_done: num(m.orders_done, 0),
    rating: num(m.rating_count, 0) ? round2(num(m.rating_sum, 0) / num(m.rating_count, 1)) : 0,
  }, services: sv.map(r => withId(r, 'merchant_services')).map(s => ({
    id: s._id, name: s.name, desc: s.desc || '', price: num(s.price, 0), image: s.image || '', active: s.active !== false,
    delivery: s.delivery === 'stock' ? 'stock' : 'manual', stock: num(s.stock_count, 0), fields: s.fields || [],
    eta: s.eta || '', section: s.section || '', old_price: num(s.old_price, 0), section_id: s.section_id || '',
  })), sections: (await fsQueryStrict(env, { from: [{ collectionId: 'merchant_sections' }],
    where: { fieldFilter: { field: { fieldPath: 'mid' }, op: 'EQUAL', value: { stringValue: u.merchant_id } } }, limit: 60 }))
    .map(r => withId(r, 'merchant_sections')).map(x => ({ id: x._id, name: x.name, image: x.image || '', order: num(x.order, 0), delivery: x.delivery === 'auto' ? 'auto' : 'manual' }))
    .sort((a, b) => a.order - b.order) };
}

async function handleMerchantProfileSave(user, body, env) {
  const m = await getMyMerchant(env, user.uid);
  const name = String(body.name || '').replace(/[<>]/g, '').trim().slice(0, 40);
  if (name.length < 2) throw httpError(400, 'اسم المتجر قصير');
  const category = M_CATEGORIES.includes(body.category) ? body.category : 'أخرى';
  const pay = (Array.isArray(body.pay_methods) ? body.pay_methods : []).slice(0, 6)
    .map(p => ({ label: String(p.label || '').replace(/[<>]/g, '').slice(0, 30), value: String(p.value || '').replace(/[<>]/g, '').slice(0, 60) }))
    .filter(p => p.label && p.value);
  if (!pay.length) throw httpError(400, 'أضف طريقة دفع واحدة على الأقل (رقم ليبيانا/المدار/حساب)');
  const patch = {
    name, category, bio: String(body.bio || '').replace(/[<>]/g, '').slice(0, 500), pay_methods: pay,
    contacts: cleanContacts(body.contacts), updated_at: nowIso(),
    open: body.open !== false, hours: String(body.hours || '').replace(/[<>]/g, '').slice(0, 80), schedule: cleanSchedule(body.schedule),
    quick_replies: (Array.isArray(body.quick_replies) ? body.quick_replies : []).map(q => String(q || '').replace(/[<>]/g, '').trim().slice(0, 300)).filter(Boolean).slice(0, 10),
  };
  if ('logo' in body) patch.logo = cleanImg(body.logo, 120000);
  if ('cover' in body) patch.cover = cleanImg(body.cover, 300000);
  await fsPatch(env, `merchants/${m._id}`, patch);
  _pubCache.clear();
  return { success: true };
}

async function handleMerchantServiceSave(user, body, env) {
  const m = await getMyMerchant(env, user.uid);
  const name = String(body.name || '').replace(/[<>]/g, '').trim().slice(0, 60);
  const price = round2(num(body.price, NaN));
  if (name.length < 2) throw httpError(400, 'اسم الخدمة قصير');
  if (!(price > 0) || price > 100000) throw httpError(400, 'السعر غير صالح');
  const fields = (Array.isArray(body.fields) ? body.fields : []).map(f => String(f || '').replace(/[<>]/g, '').trim().slice(0, 40)).filter(Boolean).slice(0, 3);
  if (body.id) { const own = await fsGet(env, `merchant_services/${String(body.id)}`); if (!own || own.mid !== m._id) throw httpError(404, 'الخدمة غير موجودة'); }
  const secId = String(body.section_id || '');
  const sec = secId && await fsGet(env, `merchant_sections/${secId}`);
  if (!sec || sec.mid !== m._id) throw httpError(400, 'اختر القسم الذي تنتمي له الخدمة (أنشئ قسمًا أولًا)');
  body.delivery = sec.delivery === 'auto' ? 'stock' : 'manual';
  const data = { section_id: secId,
    mid: m._id, name, price, desc: String(body.desc || '').replace(/[<>]/g, '').slice(0, 400), fields,
    delivery: body.delivery === 'stock' ? 'stock' : 'manual', active: body.active !== false, updated_at: nowIso(),
    eta: String(body.eta || '').replace(/[<>]/g, '').slice(0, 40), section: String(body.section || '').replace(/[<>]/g, '').trim().slice(0, 30),
    old_price: num(body.old_price, 0) > price ? round2(num(body.old_price, 0)) : 0,
  };
  if ('image' in body) data.image = cleanImg(body.image, 150000);
  let id = String(body.id || '');
  if (id) {
    const cur = await fsGet(env, `merchant_services/${id}`);
    if (!cur || cur.mid !== m._id) throw httpError(404, 'الخدمة غير موجودة');
    await fsPatch(env, `merchant_services/${id}`, data);
  } else {
    const cnt = await fsQueryStrict(env, { from: [{ collectionId: 'merchant_services' }],
      where: { fieldFilter: { field: { fieldPath: 'mid' }, op: 'EQUAL', value: { stringValue: m._id } } }, limit: 101 });
    if (cnt.length >= 100) throw httpError(400, 'الحد 100 خدمة');
    id = `MS${Date.now()}${randomSuffix(4)}`;
    await fsSet(env, `merchant_services/${id}`, { ...data, stock_count: 0, created_at: nowIso() });
  }
  _pubCache.clear();
  return { success: true, id };
}

async function handleMerchantServiceDelete(user, body, env) {
  const m = await getMyMerchant(env, user.uid);
  const id = String(body.id || '');
  const cur = await fsGet(env, `merchant_services/${id}`);
  if (!cur || cur.mid !== m._id) throw httpError(404, 'الخدمة غير موجودة');
  await fsPatch(env, `merchant_services/${id}`, { active: false, deleted: true, updated_at: nowIso() });
  await fsDelete(env, `merchant_services/${id}`);
  _pubCache.clear();
  return { success: true };
}

async function handleMerchantStockAdd(user, body, env) {
  const m = await getMyMerchant(env, user.uid);
  const sid = String(body.sid || '');
  const svc = await fsGet(env, `merchant_services/${sid}`);
  if (!svc || svc.mid !== m._id) throw httpError(404, 'الخدمة غير موجودة');
  if (svc.delivery !== 'stock') throw httpError(400, 'فعّل «تسليم تلقائي من المخزون» لهذه الخدمة أولًا');
  const codes = [...new Set((Array.isArray(body.codes) ? body.codes : String(body.codes || '').split('\n'))
    .map(c => String(c).trim()).filter(Boolean))].slice(0, 500);
  if (!codes.length) throw httpError(400, 'أدخل الأكواد (كل كود في سطر)');
  if (codes.some(c => c.length > 300)) throw httpError(400, 'كود طويل جدًا');
  for (let i = 0; i < codes.length; i += 100) {
    const writes = [];
    for (const c of codes.slice(i, i + 100)) {
      const id = `MK${Date.now()}${randomSuffix(8)}`;
      writes.push({ update: { name: docPath(env, `merchant_stock/${id}`), fields: toFsFields({
        mid: m._id, sid, code_enc: await encCodes(env, `mk:${id}`, [c]), used: false, created_at: nowIso() }) } });
    }
    await fsCommit(env, writes);
  }
  await fsRunTransaction(env, async (tx) => {
    const cur = await tx.get(`merchant_services/${sid}`);
    tx.update(`merchant_services/${sid}`, { stock_count: num(cur && cur.stock_count, 0) + codes.length });
  });
  _pubCache.clear();
  return { success: true, added: codes.length };
}

async function takeMerchantStock(env, tx, mid, sid) {
  const rows = await tx.query({
    from: [{ collectionId: 'merchant_stock' }],
    where: { compositeFilter: { op: 'AND', filters: [
      { fieldFilter: { field: { fieldPath: 'sid' }, op: 'EQUAL', value: { stringValue: sid } } },
      { fieldFilter: { field: { fieldPath: 'used' }, op: 'EQUAL', value: { booleanValue: false } } },
    ] } }, limit: 1,
  });
  if (!rows.length) return null;
  const k = withId(rows[0], 'merchant_stock');
  if (k.mid !== mid) return null;
  return k;
}

async function handleMerchantOrderAction(user, body, env) {
  const m = await getMyMerchant(env, user.uid);
  const oid = String(body.id || ''), action = String(body.action || '');
  if (!['confirm', 'deliver', 'reject'].includes(action)) throw httpError(400, 'إجراء غير معروف');
  let result = {}, customer = '', svcName = '';
  await fsRunTransaction(env, async (tx) => {
    const o = await tx.get(`merchant_orders/${oid}`);
    if (!o || o.mid !== m._id) throw httpError(404, 'الطلب غير موجود');
    customer = o.uid; svcName = o.service_name;
    if (action === 'reject') {
      if (!['pending', 'processing'].includes(o.status)) throw httpError(409, 'لا يمكن رفض هذا الطلب');
      tx.update(`merchant_orders/${oid}`, { status: 'rejected', reject_reason: String(body.reason || '').replace(/[<>]/g, '').slice(0, 200), proof: '', rejected_at: nowIso(), updated_at: nowIso() });
      tx.update(`merchants/${m._id}`, { rejected_count: num(m.rejected_count, 0) + 1 });
      result = { status: 'rejected' };
      return;
    }
    if (action === 'confirm') {
      if (o.status !== 'pending') throw httpError(409, 'الطلب ليس بانتظار التأكيد');
      const waitMs = Math.max(0, Date.now() - new Date(o.created_at).getTime());
      const stats = { confirm_count: num(m.confirm_count, 0) + 1, confirm_ms_sum: num(m.confirm_ms_sum, 0) + Math.min(waitMs, 86400000) };
      if (o.delivery === 'stock') {
        const k = await takeMerchantStock(env, tx, m._id, o.sid);
        if (k) {
          const code = await decCodes(env, `mk:${k._id}`, k.code_enc);
          const svc = await tx.get(`merchant_services/${o.sid}`);
          tx.update(`merchant_stock/${k._id}`, { used: true, used_by_order: oid, used_at: nowIso(), code_enc: '' });
          const left = Math.max(0, num(svc && svc.stock_count, 0) - 1);
          if (svc) tx.update(`merchant_services/${o.sid}`, { stock_count: left });
          tx.update(`merchant_orders/${oid}`, { status: 'completed', delivered_enc: await encCodes(env, `mo:${oid}`, [code ? code[0] : '']), proof: '', paid_at: nowIso(), completed_at: nowIso(), updated_at: nowIso() });
          tx.update(`merchants/${m._id}`, { orders_done: num(m.orders_done, 0) + 1, ...stats });
          await accrueSale(tx, m, num(o.price, 0));
          result = { status: 'completed', auto: true, low_stock: left <= 3 ? { name: o.service_name, left } : null };
          return;
        }
      }
      tx.update(`merchant_orders/${oid}`, { status: 'processing', proof: '', paid_at: nowIso(), updated_at: nowIso() });
      tx.update(`merchants/${m._id}`, stats);
      result = { status: 'processing' };
      return;
    }
    // deliver
    if (!['pending', 'processing'].includes(o.status)) throw httpError(409, 'لا يمكن تسليم هذا الطلب');
    const text = String(body.code || '').trim().slice(0, 1000);
    if (!text) throw httpError(400, 'اكتب الكود أو تفاصيل التفعيل');
    tx.update(`merchant_orders/${oid}`, { status: 'completed', delivered_enc: await encCodes(env, `mo:${oid}`, [text]), proof: '', completed_at: nowIso(), updated_at: nowIso() });
    tx.update(`merchants/${m._id}`, { orders_done: num(m.orders_done, 0) + 1 });
    await accrueSale(tx, m, num(o.price, 0));
    result = { status: 'completed' };
  });
  _pubCache.clear();
  if (result.low_stock) notify(env, m.owner_uid, 'm_low_stock', { service: result.low_stock.name, left: result.low_stock.left, link: 'mstore:services' });
  if (result.status === 'completed') notify(env, customer, 'm_order_done', { service: svcName, store: m.name, link: 'morders' });
  if (result.status === 'processing') notify(env, customer, 'm_order_paid', { service: svcName, store: m.name, link: 'morders' });
  if (result.status === 'rejected') notify(env, customer, 'm_order_rejected', { service: svcName, store: m.name, reason: String(body.reason || ''), link: 'morders' });
  return { success: true, ...result };
}

/* ─── الإدارة: إنشاء/تعديل متجر، الاشتراك، الإيقاف، البلاغات ─── */
async function handleAdminMerchantSave(user, body, env) {
  const staff = await requirePermission(user, env, body.id ? 'merchants.edit' : 'merchants.add');
  const name = String(body.name || '').replace(/[<>]/g, '').trim().slice(0, 40);
  if (name.length < 2) throw httpError(400, 'اسم المتجر مطلوب');
  const slug = cleanSlug(body.slug);
  if (slug.length < 3) throw httpError(400, 'الرابط المختصر: 3 أحرف إنجليزية على الأقل');
  const category = M_CATEGORIES.includes(body.category) ? body.category : 'أخرى';
  const subPrice = round2(num(body.sub_price, 0));
  const all = (await fsQueryStrict(env, { from: [{ collectionId: 'merchants' }], limit: 500 })).map(r => withId(r, 'merchants'));
  if (all.some(x => x.slug === slug && x._id !== body.id)) throw httpError(409, 'الرابط المختصر مستخدم');
  if (body.id) {
    const cur = all.find(x => x._id === body.id);
    if (!cur) throw httpError(404, 'المتجر غير موجود');
    await fsPatch(env, `merchants/${body.id}`, { name, slug, category, sub_price: subPrice, featured: body.featured === true, ...billingOf(body), updated_at: nowIso() });
    await logOp(env, staff.uid, 'merchant.update', { id: body.id }, {}, true);
    _pubCache.clear();
    return { success: true, id: body.id };
  }
  const email = String(body.email || '').trim().toLowerCase();
  const rows = await fsQueryStrict(env, { from: [{ collectionId: 'users' }],
    where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: email } } }, limit: 1 });
  if (!rows.length) throw httpError(404, 'لا يوجد مستخدم بهذا البريد — يجب أن يسجّل التاجر في كاردو أولًا');
  const owner = withId(rows[0], 'users');
  if (owner.merchant_id) throw httpError(409, 'هذا المستخدم يملك متجرًا مسبقًا');
  const days = Math.max(1, Math.min(366, Math.floor(num(body.days, 30))));
  const id = `M${Date.now()}${randomSuffix(4)}`;
  await fsSet(env, `merchants/${id}`, {
    owner_uid: owner._id, name, slug, category, bio: '', logo: '', cover: '', pay_methods: [], contacts: {},
    status: 'active', sub_price: subPrice, sub_expires_ms: Date.now() + days * 86400000, featured: body.featured === true, ...billingOf(body),
    orders_done: 0, rating_sum: 0, rating_count: 0, created_at: nowIso(), created_by: staff.uid,
  });
  await fsPatch(env, `users/${owner._id}`, { merchant_id: id });
  if (await fsGet(env, `merchant_applications/${owner._id}`)) await fsPatch(env, `merchant_applications/${owner._id}`, { status: 'approved', merchant_id: id, decided_at: nowIso() });
  await logOp(env, staff.uid, 'merchant.create', { id, owner: owner._id, days }, {}, true);
  notify(env, owner._id, 'm_welcome', { store: name, link: 'mstore:home' });
  _pubCache.clear();
  return { success: true, id };
}

async function handleAdminMerchantSub(user, body, env) {
  const staff = await requirePermission(user, env, 'merchants.edit');
  const id = String(body.id || '');
  const m = await fsGet(env, `merchants/${id}`);
  if (!m) throw httpError(404, 'المتجر غير موجود');
  const patch = { updated_at: nowIso() };
  if (body.status) {
    if (!['active', 'suspended'].includes(body.status)) throw httpError(400, 'حالة غير صالحة');
    patch.status = body.status;
  }
  if (body.days) {
    const days = Math.max(1, Math.min(366, Math.floor(num(body.days, 0))));
    patch.sub_expires_ms = Math.max(Date.now(), num(m.sub_expires_ms, 0)) + days * 86400000;
  }
  await fsPatch(env, `merchants/${id}`, patch);
  await logOp(env, staff.uid, 'merchant.sub', { id, ...patch }, {}, true);
  if (patch.status === 'suspended') notify(env, m.owner_uid, 'm_suspended', { store: m.name, link: 'mstore:home' });
  if (patch.sub_expires_ms) notify(env, m.owner_uid, 'm_renewed', { store: m.name, until: new Date(patch.sub_expires_ms).toISOString().slice(0, 10), link: 'mstore:home' });
  _pubCache.clear();
  return { success: true, sub_expires_ms: patch.sub_expires_ms || m.sub_expires_ms };
}

async function handleAdminReportResolve(user, body, env) {
  const staff = await requirePermission(user, env, 'merchants.edit');
  const id = String(body.id || '');
  if (!(await fsGet(env, `merchant_reports/${id}`))) throw httpError(404, 'البلاغ غير موجود');
  await fsPatch(env, `merchant_reports/${id}`, { status: 'resolved', resolved_by: staff.uid, resolved_at: nowIso(), note: String(body.note || '').slice(0, 300) });
  return { success: true };
}

/* ═══ v13 — محادثة الطلب، التقييمات، المفضلة، الحظر، الاتفاقية، النزاعات، المهام الدورية ═══ */
async function orderParty(env, user, o) {
  if (o.uid === user.uid) return 'customer';
  if (o.merchant_owner === user.uid) return 'merchant';
  const st = await getStaff(env, user.uid);
  if (st && staffCan(st, 'merchants.view')) return 'admin';
  return '';
}
async function pushThread(env, path, who, text, maxN = 100) {
  let doc = null;
  await fsRunTransaction(env, async (tx) => {
    doc = await tx.get(path);
    if (!doc) throw httpError(404, 'غير موجود');
    const msgs = (Array.isArray(doc.messages) ? doc.messages : []).concat([{ by: who, text, at: nowIso() }]).slice(-maxN);
    tx.update(path, { messages: msgs, updated_at: nowIso() });
  });
  return doc;
}
async function handleMerchantOrderMsg(user, body, env) {
  const id = String(body.id || ''), text = String(body.text || '').replace(/[<>]/g, '').trim().slice(0, 1000);
  if (!text) throw httpError(400, 'اكتب رسالتك');
  const o = await fsGet(env, `merchant_orders/${id}`);
  if (!o) throw httpError(404, 'الطلب غير موجود');
  const who = await orderParty(env, user, o);
  if (!who) throw httpError(403, 'غير مصرّح');
  if (!(await checkRateLimit(env, `mmsg_${user.uid}`, 60, 3600))) throw httpError(429, 'رسائل كثيرة — انتظر قليلًا');
  await pushThread(env, `merchant_orders/${id}`, who, text);
  const vars = { service: o.service_name, text: text.slice(0, 140) };
  if (who !== 'customer') notify(env, o.uid, 'm_msg', { ...vars, from: who === 'admin' ? 'إدارة كاردو' : o.merchant_name, link: 'morders' });
  if (who !== 'merchant') notify(env, o.merchant_owner, 'm_msg', { ...vars, from: who === 'admin' ? 'إدارة كاردو' : (o.customer_name || 'الزبون'), link: 'mstore:orders' });
  return { success: true };
}
async function handleMerchantReviews(user, body, env) {
  const mid = String(body.mid || '');
  const rows = await fsQueryStrict(env, { from: [{ collectionId: 'merchant_reviews' }],
    where: { fieldFilter: { field: { fieldPath: 'mid' }, op: 'EQUAL', value: { stringValue: mid } } }, limit: 200 });
  const list = rows.map(r => withId(r, 'merchant_reviews')).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 30).map(r => ({ name: r.name, stars: r.stars, text: r.text, service: r.service, at: r.created_at }));
  return { success: true, reviews: list };
}
async function handleMerchantFav(user, body, env) {
  const mid = String(body.mid || '');
  if (!(await fsGet(env, `merchants/${mid}`))) throw httpError(404, 'المتجر غير موجود');
  let list = [];
  await fsRunTransaction(env, async (tx) => {
    const u = await tx.get(`users/${user.uid}`);
    list = (u && Array.isArray(u.fav_merchants) ? u.fav_merchants : []).filter(x => x !== mid);
    if (body.on !== false) list = [mid, ...list].slice(0, 50);
    tx.update(`users/${user.uid}`, { fav_merchants: list });
  });
  return { success: true, favs: list };
}
async function handleMerchantBlock(user, body, env) {
  const m = await getMyMerchant(env, user.uid);
  const uid = String(body.uid || '');
  if (!uid || uid === user.uid) throw httpError(400, 'زبون غير صالح');
  let blocked = (m.blocked || []).filter(x => x !== uid);
  if (body.on !== false) blocked = [uid, ...blocked].slice(0, 500);
  await fsPatch(env, `merchants/${m._id}`, { blocked });
  return { success: true, blocked: body.on !== false };
}
async function handleMerchantAcceptTerms(user, body, env) {
  const u = await fsGet(env, `users/${user.uid}`);
  if (!u || !u.merchant_id) throw httpError(403, 'حسابك ليس حساب تاجر');
  const m = await fsGet(env, `merchants/${u.merchant_id}`);
  if (!m || m.owner_uid !== user.uid) throw httpError(403, 'غير مصرّح');
  await fsPatch(env, `merchants/${u.merchant_id}`, { terms_accepted_at: nowIso(), terms_version: String(body.version || '1.0').slice(0, 10) });
  return { success: true };
}
async function handleReportMsg(user, body, env) {
  const id = String(body.id || ''), text = String(body.text || '').replace(/[<>]/g, '').trim().slice(0, 1000);
  if (!text) throw httpError(400, 'اكتب رسالتك');
  const r = await fsGet(env, `merchant_reports/${id}`);
  if (!r) throw httpError(404, 'البلاغ غير موجود');
  const who = await orderParty(env, user, { uid: r.uid, merchant_owner: r.merchant_owner });
  if (!who) throw httpError(403, 'غير مصرّح');
  if (r.status !== 'open') throw httpError(409, 'البلاغ مغلق');
  if (!(await checkRateLimit(env, `rmsg_${user.uid}`, 40, 3600))) throw httpError(429, 'رسائل كثيرة');
  await pushThread(env, `merchant_reports/${id}`, who, text);
  const vars = { store: r.merchant_name, text: text.slice(0, 140) };
  if (who !== 'customer') notify(env, r.uid, 'm_case_msg', { ...vars, link: 'mcase:' + id });
  if (who !== 'merchant') notify(env, r.merchant_owner, 'm_case_msg', { ...vars, link: 'mstore:cases' });
  return { success: true };
}
async function handleAdminMerchantPromo(user, body, env) {
  const staff = await requirePermission(user, env, 'merchants.edit');
  const id = String(body.id || '');
  const m = await fsGet(env, `merchants/${id}`);
  if (!m) throw httpError(404, 'المتجر غير موجود');
  const patch = {};
  if (body.days !== undefined) {
    const days = Math.max(0, Math.min(366, Math.floor(num(body.days, 0))));
    patch.featured_until = days ? Math.max(Date.now(), num(m.featured_until, 0)) + days * 86400000 : 0;
    patch.promo_price = round2(num(body.price, 0));
  }
  if (body.tier !== undefined) patch.tier = ['gold', 'silver', 'none', 'auto'].includes(body.tier) ? body.tier : 'auto';
  await fsPatch(env, `merchants/${id}`, patch);
  await logOp(env, staff.uid, 'merchant.promo', { id, ...patch }, {}, true);
  _pubCache.clear();
  return { success: true, ...patch };
}

// مهام دورية: تذكير تجديد الاشتراك + تنبيه الطلبات المتأخرة
async function merchantsCron(env) {
  const now = Date.now();
  const ms = (await fsQueryRaw(env, { from: [{ collectionId: 'merchants' }], limit: 500 })).map(r => withId(r, 'merchants'));
  for (const m of ms) {
    if (m.status !== 'active') continue;
    const left = Math.ceil((num(m.sub_expires_ms, 0) - now) / 86400000);
    for (const d of [7, 3, 1]) {
      if (left === d && m[`reminded_${d}`] !== num(m.sub_expires_ms, 0)) {
        await notifyUser(env, m.owner_uid, 'm_renew_soon', { store: m.name, days: d, link: 'mstore:home' });
        await fsPatch(env, `merchants/${m._id}`, { [`reminded_${d}`]: num(m.sub_expires_ms, 0) });
      }
    }
  }
  const late = await fsQueryRaw(env, { from: [{ collectionId: 'merchant_orders' }],
    where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'pending' } } }, limit: 300 });
  const admins = (await fsQueryRaw(env, { from: [{ collectionId: 'admins' }], limit: 50 })).map(r => withId(r, 'admins'))
    .filter(a => a.role === 'super_admin' || staffCan(a, 'merchants.view'));
  for (const o of late.map(r => withId(r, 'merchant_orders'))) {
    if (o.late_alerted || now - new Date(o.created_at).getTime() < 2 * 3600000) continue;
    await notifyUser(env, o.merchant_owner, 'm_late', { service: o.service_name, link: 'mstore:orders' });
    for (const a of admins) await notifyUser(env, a._id, 'm_late_admin', { service: o.service_name, store: o.merchant_name });
    await fsPatch(env, `merchant_orders/${o._id}`, { late_alerted: true });
  }
}


/* ═══ v14 — طلبات الانضمام كتاجر ═══ */
async function handleMerchantApply(user, body, env) {
  if ((await getSettings(env)).merchants_on !== true) throw httpError(403, 'المتاجر الموثوقة غير متاحة حاليًا');
  const u = await fsGet(env, `users/${user.uid}`);
  if (!u) throw httpError(400, 'الحساب غير مكتمل');
  if (u.merchant_id) throw httpError(409, 'لديك متجر بالفعل');
  const store = String(body.store_name || '').replace(/[<>]/g, '').trim().slice(0, 40);
  const services = String(body.services || '').replace(/[<>]/g, '').trim().slice(0, 600);
  const phone = String(body.phone || '').replace(/[^\d+]/g, '').slice(0, 16);
  if (store.length < 2 || services.length < 5 || phone.length < 9) throw httpError(400, 'أكمل اسم المتجر والخدمات ورقم التواصل');
  if (!(await checkRateLimit(env, `mapply_${user.uid}`, 3, 86400))) throw httpError(429, 'قدّمت طلبات كثيرة اليوم');
  const cur = await fsGet(env, `merchant_applications/${user.uid}`);
  if (cur && cur.status === 'pending') throw httpError(409, 'طلبك قيد المراجعة بالفعل');
  await fsSet(env, `merchant_applications/${user.uid}`, {
    uid: user.uid, email: String(u.email || user.email || ''), name: String(u.name || ''), store_name: store,
    category: M_CATEGORIES.includes(body.category) ? body.category : 'أخرى', services, phone,
    note: String(body.note || '').replace(/[<>]/g, '').slice(0, 400), status: 'pending', created_at: nowIso(),
  });
  const admins = await fsQueryRaw(env, { from: [{ collectionId: 'admins' }], limit: 50 });
  admins.map(r => withId(r, 'admins')).filter(a => a.role === 'super_admin' || staffCan(a, 'merchants.add'))
    .forEach(a => notify(env, a._id, 'm_apply_admin', { store, name: String(u.name || '') }));
  return { success: true };
}
async function handleMerchantApplyStatus(user, body, env) {
  const a = await fsGet(env, `merchant_applications/${user.uid}`);
  return { success: true, application: a ? { status: a.status, store_name: a.store_name, reason: a.reason || '' } : null };
}
async function handleAdminApplyDecide(user, body, env) {
  const staff = await requirePermission(user, env, 'merchants.add');
  const uid = String(body.uid || '');
  const a = await fsGet(env, `merchant_applications/${uid}`);
  if (!a) throw httpError(404, 'الطلب غير موجود');
  if (body.action === 'reject') {
    await fsPatch(env, `merchant_applications/${uid}`, { status: 'rejected', reason: String(body.reason || '').slice(0, 200), decided_by: staff.uid, decided_at: nowIso() });
    notify(env, uid, 'm_apply_rejected', { store: a.store_name, reason: String(body.reason || '') });
  } else {
    await fsPatch(env, `merchant_applications/${uid}`, { status: 'approved', decided_by: staff.uid, decided_at: nowIso() });
  }
  return { success: true };
}


/* ═══ v15 — أسماء فقط للموظفين (بدون البريد والأرصدة) ═══ */
async function handleAdminNames(user, body, env) {
  const staff = await getStaff(env, user.uid);
  if (!staff) throw httpError(403, 'غير مصرّح');
  const ids = [...new Set((Array.isArray(body.uids) ? body.uids : []).map(String).filter(x => /^[A-Za-z0-9]{6,64}$/.test(x)))].slice(0, 40);
  const out = {};
  await Promise.all(ids.map(async id => { const u = await fsGet(env, `users/${id}`).catch(() => null); out[id] = u ? String(u.name || 'مستخدم').slice(0, 60) : ''; }));
  return { success: true, names: out };
}


/* ═══ v16 — إشعارات الهاتف (Web Push عبر FCM) ═══ */
async function handlePushRegister(user, body, env) {
  const token = String(body.token || '').trim();
  if (!/^[A-Za-z0-9_:\-]{100,400}$/.test(token)) throw httpError(400, 'رمز إشعارات غير صالح');
  if (!(await checkRateLimit(env, `push_${user.uid}`, 20, 3600))) throw httpError(429, 'محاولات كثيرة');
  await fsRunTransaction(env, async (tx) => {
    const u = await tx.get(`users/${user.uid}`);
    const list = (u && Array.isArray(u.push_tokens) ? u.push_tokens : []).filter(t => t !== token);
    tx.update(`users/${user.uid}`, { push_tokens: body.off === true ? list : [token, ...list].slice(0, 5) });
  });
  return { success: true };
}
async function sendPush(env, uid, u, kind, vars) {
  const tokens = u && Array.isArray(u.push_tokens) ? u.push_tokens.slice(0, 5) : [];
  if (!tokens.length || !MAIL[kind]) return;
  const [title, lines] = MAIL[kind](vars || {});
  const body = lines.filter(Boolean).map(stripHtml).join(' ').slice(0, 180);
  const link = /_admin$/.test(kind) ? `${siteUrl(env)}/admin.html` : `${siteUrl(env)}/${(vars || {}).link ? 'index.html#n=' + encodeURIComponent(vars.link) : 'index.html'}`;
  const at = await getAccessToken(env);
  const dead = [];
  await Promise.all(tokens.map(async token => {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
      method: 'POST', headers: { authorization: `Bearer ${at}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token,
        data: { title: stripHtml(title).slice(0, 100), body, link },
        webpush: { headers: { Urgency: 'high', TTL: '86400' } } } }),
    }).catch(() => null);
    if (r && (r.status === 404 || r.status === 400)) dead.push(token);
  }));
  if (dead.length) await fsPatch(env, `users/${uid}`, { push_tokens: tokens.filter(t => !dead.includes(t)) }).catch(() => {});
}


/* ═══ v17 — العمولات والكشوف الشهرية ═══ */
async function handleAdminStatementPay(user, body, env) {
  const staff = await requirePermission(user, env, 'merchants.edit');
  const id = String(body.id || '');
  const st = await fsGet(env, `merchant_statements/${id}`);
  if (!st) throw httpError(404, 'الكشف غير موجود');
  if (st.status === 'paid') throw httpError(409, 'مدفوع مسبقًا');
  await fsPatch(env, `merchant_statements/${id}`, { status: 'paid', paid_at: nowIso(), paid_by: staff.uid });
  const m = await fsGet(env, `merchants/${st.mid}`);
  if (m && m.billing_hold) {
    const others = await fsQueryRaw(env, { from: [{ collectionId: 'merchant_statements' }],
      where: { fieldFilter: { field: { fieldPath: 'mid' }, op: 'EQUAL', value: { stringValue: st.mid } } }, limit: 50 });
    if (!others.map(r => withId(r, 'merchant_statements')).some(x => x._id !== id && x.status === 'due')) await fsPatch(env, `merchants/${st.mid}`, { billing_hold: false });
  }
  await logOp(env, staff.uid, 'merchant.statement.paid', { id, amount: st.commission }, {}, true);
  if (m) notify(env, m.owner_uid, 'm_statement_paid', { store: m.name, month: st.month, amount: st.commission, link: 'mstore:billing' });
  _pubCache.clear();
  return { success: true };
}
// أول الشهر: إقفال كشف الشهر الماضي — ويُوقَف المتجر إذا تأخر الدفع 5 أيام
async function statementsCron(env) {
  const now = Date.now(), cur = ymOf(now);
  const rows = (await fsQueryRaw(env, { from: [{ collectionId: 'merchant_statements' }], limit: 500 })).map(r => withId(r, 'merchant_statements'));
  for (const st of rows) {
    if (st.status === 'open' && st.month < cur) {
      if (num(st.commission, 0) <= 0) { await fsPatch(env, `merchant_statements/${st._id}`, { status: 'paid', paid_at: nowIso() }); continue; }
      const due = now + 5 * 86400000;
      await fsPatch(env, `merchant_statements/${st._id}`, { status: 'due', due_ms: due, closed_at: nowIso() });
      await notifyUser(env, st.merchant_owner, 'm_statement', { store: st.merchant_name, month: st.month, sales: st.sales, pct: st.pct, amount: st.commission, link: 'mstore:billing' });
    } else if (st.status === 'due' && num(st.due_ms, 0) < now && !st.hold_applied) {
      await fsPatch(env, `merchants/${st.mid}`, { billing_hold: true });
      await fsPatch(env, `merchant_statements/${st._id}`, { hold_applied: true });
      await notifyUser(env, st.merchant_owner, 'm_billing_hold', { store: st.merchant_name, amount: st.commission, link: 'mstore:billing' });
    }
  }
}


/* ═══ v20 — أقسام المتجر + محادثات الزبون والتاجر ═══ */
async function handleMerchantSectionSave(user, body, env) {
  const m = await getMyMerchant(env, user.uid);
  const name = String(body.name || '').replace(/[<>]/g, '').trim().slice(0, 30);
  if (name.length < 2) throw httpError(400, 'اسم القسم قصير');
  const data = { mid: m._id, name, order: Math.max(0, Math.min(999, Math.floor(num(body.order, 0)))), delivery: body.delivery === 'auto' ? 'auto' : 'manual', updated_at: nowIso() };
  if ('image' in body) data.image = cleanImg(body.image, 150000);
  let id = String(body.id || '');
  if (id) {
    const cur = await fsGet(env, `merchant_sections/${id}`);
    if (!cur || cur.mid !== m._id) throw httpError(404, 'القسم غير موجود');
    await fsPatch(env, `merchant_sections/${id}`, data);
    if (cur.delivery !== data.delivery) {           // تغيير نوع القسم ينعكس على خدماته
      const sv = await fsQueryStrict(env, { from: [{ collectionId: 'merchant_services' }],
        where: { fieldFilter: { field: { fieldPath: 'section_id' }, op: 'EQUAL', value: { stringValue: id } } }, limit: 200 });
      for (const r of sv) { const s = withId(r, 'merchant_services'); if (s.mid === m._id) await fsPatch(env, `merchant_services/${s._id}`, { delivery: data.delivery === 'auto' ? 'stock' : 'manual' }); }
    }
  } else {
    const cnt = await fsQueryStrict(env, { from: [{ collectionId: 'merchant_sections' }],
      where: { fieldFilter: { field: { fieldPath: 'mid' }, op: 'EQUAL', value: { stringValue: m._id } } }, limit: 31 });
    if (cnt.length >= 30) throw httpError(400, 'الحد 30 قسمًا');
    id = `SC${Date.now()}${randomSuffix(4)}`;
    await fsSet(env, `merchant_sections/${id}`, { ...data, created_at: nowIso() });
  }
  _pubCache.clear();
  return { success: true, id };
}
async function handleMerchantSectionDelete(user, body, env) {
  const m = await getMyMerchant(env, user.uid);
  const id = String(body.id || '');
  const cur = await fsGet(env, `merchant_sections/${id}`);
  if (!cur || cur.mid !== m._id) throw httpError(404, 'القسم غير موجود');
  const sv = await fsQueryStrict(env, { from: [{ collectionId: 'merchant_services' }],
    where: { fieldFilter: { field: { fieldPath: 'section_id' }, op: 'EQUAL', value: { stringValue: id } } }, limit: 1 });
  if (sv.length) throw httpError(409, 'انقل خدمات القسم أو احذفها أولًا');
  await fsDelete(env, `merchant_sections/${id}`);
  _pubCache.clear();
  return { success: true };
}

async function handleMerchantChat(user, body, env) {
  const text = String(body.text || '').replace(/[<>]/g, '').trim().slice(0, 1000);
  if (!text) throw httpError(400, 'اكتب رسالتك');
  if (!(await checkRateLimit(env, `mchat_${user.uid}`, 80, 3600))) throw httpError(429, 'رسائل كثيرة — انتظر قليلًا');
  let id = String(body.id || ''), who = '', chat = null;
  if (body.mid) {                                   // الزبون يبدأ/يكمل محادثة مع متجر
    if ((await getSettings(env)).merchants_on !== true) throw httpError(403, 'المتاجر الموثوقة غير متاحة حاليًا');
    const m = await fsGet(env, `merchants/${String(body.mid)}`);
    if (!m || m.status !== 'active') throw httpError(404, 'المتجر غير متاح');
    if (m.owner_uid === user.uid) throw httpError(400, 'هذا متجرك');
    if (Array.isArray(m.blocked) && m.blocked.includes(user.uid)) throw httpError(403, 'لا يمكنك مراسلة هذا المتجر');
    id = `${String(body.mid)}_${user.uid}`; who = 'customer';
    chat = await fsGet(env, `merchant_chats/${id}`);
    if (!chat) {
      const u = await fsGet(env, `users/${user.uid}`) || {};
      chat = { mid: String(body.mid), uid: user.uid, merchant_owner: m.owner_uid, merchant_name: m.name, customer_name: String(u.name || 'زبون').slice(0, 60), messages: [], created_at: nowIso() };
      await fsSet(env, `merchant_chats/${id}`, { ...chat, unread_m: 0, unread_c: 0, updated_at: nowIso() });
    }
  } else {
    chat = await fsGet(env, `merchant_chats/${id}`);
    if (!chat) throw httpError(404, 'المحادثة غير موجودة');
    who = await orderParty(env, user, { uid: chat.uid, merchant_owner: chat.merchant_owner });
    if (!who) throw httpError(403, 'غير مصرّح');
  }
  await fsRunTransaction(env, async (tx) => {
    const c = await tx.get(`merchant_chats/${id}`);
    const msgs = (Array.isArray(c.messages) ? c.messages : []).concat([{ by: who, text, at: nowIso() }]).slice(-200);
    tx.update(`merchant_chats/${id}`, { messages: msgs, last_text: text.slice(0, 80), last_by: who, updated_at: nowIso(),
      unread_m: who === 'merchant' ? 0 : num(c.unread_m, 0) + 1, unread_c: who === 'customer' ? 0 : num(c.unread_c, 0) + 1 });
  });
  if (who !== 'customer') notify(env, chat.uid, 'm_chat', { from: who === 'admin' ? 'إدارة كاردو' : chat.merchant_name, text: text.slice(0, 140), link: 'mchat:' + id });
  if (who !== 'merchant') notify(env, chat.merchant_owner, 'm_chat', { from: who === 'admin' ? 'إدارة كاردو' : chat.customer_name, text: text.slice(0, 140), link: 'mstore:chats' });
  return { success: true, id };
}
async function handleMerchantChatRead(user, body, env) {
  const id = String(body.id || '');
  const c = await fsGet(env, `merchant_chats/${id}`);
  if (!c) throw httpError(404, 'المحادثة غير موجودة');
  if (c.uid === user.uid) await fsPatch(env, `merchant_chats/${id}`, { unread_c: 0 });
  else if (c.merchant_owner === user.uid) await fsPatch(env, `merchant_chats/${id}`, { unread_m: 0 });
  return { success: true };
}


/* ═══ v22 — منصات الاستخدام («أين تستخدم بطاقتك؟») ═══ */
async function handlePlatformsList(env) {
  const rows = await fsQueryStrict(env, { from: [{ collectionId: 'platforms' }], limit: 60 });
  const list = rows.map(r => withId(r, 'platforms')).filter(p => p.active !== false && p.image)
    .sort((a, b) => num(a.order, 0) - num(b.order, 0))
    .map(p => ({ id: p._id, name: String(p.name || '').slice(0, 30), image: imgRef(env, 'g', p._id, p.image) }));
  return { success: true, platforms: list };
}
async function handleAdminPlatformSave(user, body, env) {
  const staff = await requirePermission(user, env, 'stickers.edit');
  const name = String(body.name || '').replace(/[<>]/g, '').trim().slice(0, 30);
  if (name.length < 2) throw httpError(400, 'اكتب اسم المنصة');
  const data = { name, order: Math.max(0, Math.min(999, Math.floor(num(body.order, 0)))), active: body.active !== false, updated_at: nowIso(), updated_by: staff.uid };
  if ('image' in body) {
    const img = String(body.image || '');
    if (img && !/^data:image\/(png|jpeg|webp);base64,/.test(img)) throw httpError(400, 'صورة غير صالحة (PNG أو JPG أو WebP)');
    data.image = cleanImg(img, 150000);
  }
  let id = String(body.id || '');
  if (id) {
    const cur = await fsGet(env, `platforms/${id}`);
    if (!cur) throw httpError(404, 'المنصة غير موجودة');
    await fsPatch(env, `platforms/${id}`, data);
  } else {
    if (!data.image) throw httpError(400, 'ارفع صورة المنصة');
    const cnt = await fsQueryStrict(env, { from: [{ collectionId: 'platforms' }], limit: 61 });
    if (cnt.length >= 60) throw httpError(400, 'الحد 60 منصة');
    id = `PL${Date.now()}${randomSuffix(4)}`;
    await fsSet(env, `platforms/${id}`, { ...data, created_at: nowIso() });
  }
  await logOp(env, staff.uid, 'platform.save', { id }, {}, true);
  _pubCache.clear();
  return { success: true, id };
}
async function handleAdminPlatformDelete(user, body, env) {
  const staff = await requirePermission(user, env, 'stickers.edit');
  const id = String(body.id || '');
  if (!(await fsGet(env, `platforms/${id}`))) throw httpError(404, 'المنصة غير موجودة');
  await fsDelete(env, `platforms/${id}`);
  await logOp(env, staff.uid, 'platform.delete', { id }, {}, true);
  _pubCache.clear();
  return { success: true };
}
