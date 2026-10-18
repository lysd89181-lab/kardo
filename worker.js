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
  store_enabled: true, subscriptions_visible: true, manual_cards_enabled: true, mc_topup_on: false, mc_maint_on: false,
  site_maint_on: true, site_maint_msg: '', promo_first_on: true, promo_first_min: 20, promo_first_bonus: 0.5, promo_first_until: '', paused_methods: '', new_acct_days: 7, new_acct_crypto_max: 50, binance_pay_qr_v: 0, invoice_check_hours: 24, rsc_on: true, rsc_margin_pct: 10, rsc_low_usd: 20,
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
  contact_whatsapp: '', contact_email: '', social_fb: '', social_ig: '', social_tt: '', social_tg: '', faq_text: '', reviews_min: 5,
  deposit_mode: 'auto',
  m_libyana_mode: '', m_almadar_mode: '', m_bank_receipt: true, m_binance_receipt: true,
  require_email_verify: true,
  plans_enabled: true, plan_free_cards: 1, plan_basic_cards: 3, plan_premium_cards: 6, plan_vip_cards: 0,
  plan_premium_price: 10, plan_premium_days: 30, card_warning: '', card_points: '', otp_fee_usd: 0.03, kardo_store_on: false, merchants_on: false, referral_cards_enabled: true, usdt_bep20_on: false, usdt_bep20_address: '', usdt_polygon_on: false, usdt_polygon_address: '', binance_pay_on: false, binance_pay_id: '', require_phone_verified: false, sms_sender_exact: true, sms_auto_max_lyd: 100, admin_reauth_hours: 12, quota_save_at: 25000, merchant_free_days: 30, merchant_default_pct: 5, pv_amount_lyd: 1, require_verified_money: true, card_types: [], referral_card_inviter: 1, referral_card_invitee: 0.2, referral_store_enabled: false,
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
    d1Stat('req');                                                    // v34: عدّاد طلبات اليوم (لوحة D1)
    if (env.DB && Date.now() - _d1St.last > 60000) ctx.waitUntil(d1FlushStats(env).catch(() => {}));
    const origin = resolveOrigin(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    if (request.method === 'GET') {
      const im = /^\/img\/([pcmbslvxygq])\/([A-Za-z0-9_-]{1,60})$/.exec(path);
      if (im) { try { return await handleImage(request, env, ctx, im[1], decodeURIComponent(im[2])); } catch { return new Response('Error', { status: 500 }); } }
      if (path === '/bpq') { try { return await serveBinanceQr(env); } catch { return new Response('Error', { status: 500 }); } }
      { const hm = /^\/hti\/([a-z0-9_]{3,60})$/.exec(path); if (hm) { try { return await serveHowtoImg(env, hm[1]); } catch { return new Response('Error', { status: 500 }); } } }
      if (path.startsWith('/rsc/img/') || path === '/rsc/pimg') { try { return await handleRscImage(request, env, ctx, url); } catch { return new Response('Error', { status: 500 }); } }
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
      d1Cron(env, event.scheduledTime).catch(e => console.error('D1_CRON_FAILED', e.message)),
    ];
    { const _m = new Date(event.scheduledTime || Date.now()).getUTCMinutes(); jobs.push(rscCron(env, _m < 5).catch(e => console.error('RSC_CRON_FAILED', e.message))); }
    jobs.push(invoiceCron(env).catch(e => console.error('INVOICE_CRON_FAILED', e.message)));
    const _t = new Date(event.scheduledTime || Date.now());
    const minute = _t.getUTCMinutes(), hour = _t.getUTCHours();
    if (minute < 5) {
      jobs.push(purgeExpiredOtp(env).catch(e => console.error('OTP_PURGE_FAILED', e.message)));
      jobs.push(
        purgeExpiredReveals(env).catch(e => console.error('PURGE_FAILED', e.message)),
        purgeOldRateLimits(env).catch(e => console.error('RL_PURGE_FAILED', e.message)),
        migrateAndPurgeCodes(env).catch(e => console.error('CODES_JOB_FAILED', e.message)),
        purgeExpiredIdempotency(env).catch(e => console.error('IDEM_PURGE_FAILED', e.message)),
      );
      if (hour === 6) jobs.push(statementsCron(env).catch(e => console.error('STATEMENTS_CRON_FAILED', e.message)));
    }
    ctx.waitUntil(Promise.all(jobs).then(() => Promise.allSettled(drainBackground())));
  },
};

async function route(path, request, url, env) {
  if (request.method === 'GET') {
    const h = { '/api/status': handleStatus, '/api/catalog': handleCatalog, '/api/services/list': handleServicesList, '/api/merchants/list': async () => ({ success: true, merchants: [], removed: true }), '/api/rsc/catalog': handleRscCatalog, '/api/platforms': handlePlatformsList, '/api/howto': handleHowto, '/api/reviews': handleReviewsPublic }[path];
    if (!h) throw httpError(404, 'المسار غير موجود');
    const hit = _pubCache.get(path);
    if (hit && hit.exp > Date.now()) return hit.v;
    const ttl = (PUB_TTL[path] || 30) * 1000;
    const edge = await edgeGet(path, false);
    if (edge) { _pubCache.set(path, { v: edge, exp: Date.now() + Math.min(ttl, 60000) }); return edge; }
    try {
      const v = await h(env);
      _pubCache.set(path, { v, exp: Date.now() + Math.min(ttl, 60000) });
      await edgePut(path, v);
      return v;
    } catch (e) {
      const st = await edgeGet(path, true);            // حصة Firestore منتهية؟ نعرض آخر نسخة محفوظة
      if (st) return { ...st, stale: true };
      throw e;
    }
  }
  if (path === '/api/sms/webhook') return handleSmsWebhook(request, env);
  if (path === '/api/otp/inbound') return handleOtpInbound(request, env);
  if (path === '/api/t') return handleTrack(request, env);
  if (path === '/api/pay/view') return handlePayView(request, env);
  if (request.method !== 'POST') throw httpError(405, 'طريقة غير مسموحة');
  if (Number(request.headers.get('content-length') || 0) > 1_500_000) throw httpError(413, 'الطلب كبير جدًا');

  _envForUsage = env;
  if (!ipAllow(request, 'post', 90)) throw httpError(429, 'طلبات كثيرة من نفس الشبكة — انتظر دقيقة');
  const user = await requireAuth(request, env);
  _ipByUid.set(user.uid, (request.headers.get('cf-connecting-ip') || '').slice(0, 45));
  if (_ipByUid.size > 5000) _ipByUid.clear();
  await verifyAppCheck(request, env);
  await enforceGlobalRateLimit(env, user.uid);
  const body = await safeJson(request);
  if (path.startsWith('/api/m/') || path.startsWith('/api/admin/merchant')) throw httpError(410, 'خدمة المتاجر أُلغيت');
  if (!path.startsWith('/api/admin/')) {
    const s0 = await getSettings(env);
    if (s0.site_maint_on === true && !(await isStaffCached(env, user.uid))) throw httpError(503, s0.site_maint_msg || 'الموقع قيد الصيانة — نعود قريبًا');
  }

  switch (path) {
    case '/api/rsc/order':             return handleRscOrder(user, body, env);
    case '/api/rsc/my-orders':         return handleRscMyOrders(user, body, env);
    case '/api/admin/rsc':             return handleAdminRsc(user, body, env);
    case '/api/admin/usdt/find':       return handleAdminUsdtFind(user, body, env);
    case '/api/admin/usdt/credit':     return handleAdminUsdtCredit(user, body, env);
    case '/api/admin/crypto/unmatched': return handleAdminUnmatched(user, body, env);
    case '/api/admin/invoices':        return handleAdminInvoices(user, body, env);
    case '/api/admin/binance-qr':      return handleAdminBinanceQr(user, body, env);
    case '/api/admin/overview':        return handleAdminOverview(user, body, env);
    case '/api/card/sec/status':       return handleCardSecStatus(user, body, env);
    case '/api/card/sec/code':         return handleCardSecCode(user, body, env);
    case '/api/card/sec/verify':       return handleCardSecVerify(user, body, env, request);
    case '/api/card/sec/change':       return handleCardSecChange(user, body, env);
    case '/api/card/vault/reveal':     return handleCardVaultReveal(user, body, env, request);
    case '/api/admin/card/state':      return handleAdminCardState(user, body, env);
    case '/api/admin/cards':           return handleAdminCards(user, body, env);
    case '/api/admin/analytics':       return handleAdminAnalytics(user, body, env);
    case '/api/admin/howto':           return handleAdminHowto(user, body, env);
    case '/api/admin/export':          return handleAdminExport(user, body, env);
    case '/api/review':                return handleReviewSubmit(user, body, env);
    case '/api/admin/reviews':         return handleAdminReviews(user, body, env);
    case '/api/admin/users/find':      return handleAdminUsersFind(user, body, env);
    case '/api/admin/user/file':       return handleAdminUserFile(user, body, env);
    case '/api/wallet/invoice':        return handleInvoiceGet(user, body, env);
    case '/api/wallet/invoice/cancel': return handleInvoiceCancel(user, body, env);
    case '/api/wallet/invoices':       return handleInvoiceList(user, body, env);
    case '/api/wallet/invoice/share':  return handleInvoiceShare(user, body, env);
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
    case '/api/admin/funnel':          return handleAdminFunnel(user, body, env);
    case '/api/admin/usage':           return handleAdminUsage(user, body, env);
    case '/api/db/q':                  return handleDbQuery(user, body, env);
    case '/api/db/doc':                return handleDbDoc(user, body, env);
    case '/api/db/batch':              return handleDbBatch(user, body, env);
    case '/api/db/set':                return handleDbSet(user, body, env);
    case '/api/sync/notifs':           return handleSyncNotifs(user, body, env);
    case '/api/sync/chats':            return handleSyncChats(user, body, env);
    case '/api/sync/chat':             return handleSyncChat(user, body, env);
    case '/api/admin/d1/status':       return handleAdminD1Status(user, body, env);
    case '/api/admin/d1/flag':         return handleAdminD1Flag(user, body, env);
    case '/api/admin/d1/action':       return handleAdminD1Action(user, body, env);
    case '/api/admin/d1/rows':         return handleAdminD1Rows(user, body, env);
    case '/api/admin/crypto/test':     return handleAdminCryptoTest(user, body, env);
    case '/api/admin/merchants/billing-default': return handleAdminMerchantsBillingDefault(user, body, env);
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
    case '/api/admin/card/replace':    return handleAdminCardReplace(user, body, env);
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
  if (c > 45) throw httpError(429, 'محاولات كثيرة — انتظر قليلاً');
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
      topup_on: s.mc_topup_on === true,
      maint: s.mc_maint_on === true,
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
      points: String(s.card_points || '').slice(0, 600),
      otp_fee: num(s.otp_fee_usd, 0.03),
    },
    store_on: s.kardo_store_on === true,
    merchants_on: false,
    site_maint: s.site_maint_on === true,
    site_maint_msg: String(s.site_maint_msg || '').slice(0, 300),
    rsc_on: s.rsc_on !== false,
    paused_methods: String(s.paused_methods || '').split(',').map(x => x.trim()).filter(Boolean),
    promo_first: promoFirstActive(s) ? { min: num(s.promo_first_min, 20), bonus: num(s.promo_first_bonus, 0.5), until: s.promo_first_until || '' } : null,
    binance_pay_qr: num(s.binance_pay_qr_v, 0) ? `/bpq?v=${num(s.binance_pay_qr_v, 0)}` : '',
    new_acct: { days: num(s.new_acct_days, 7), max: num(s.new_acct_crypto_max, 50) },
    d1: await d1PublicFlags(env),
    d1p: await d1IsPrimary(env).catch(() => false),
    crypto_nets: s.m_usdt_on === true ? Object.entries(CRYPTO_NETS).filter(([k, n]) => k === 'trc20' ? /^T/.test(String(s.usdt_address || '')) : s[n.onKey] === true && n.addrRe.test(String(s[n.addrKey] || ''))).map(([k, n]) => ({ id: k, label: n.label })) : [],
    card_types: cardTypesOf(s).map(({ provider, ...t }) => t),
    require_verified_money: s.require_verified_money !== false,
    require_phone_verified: s.require_phone_verified === true,
    pv_amount_lyd: pickVerifyAmount(s),
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
    contact: {                                                      // v54: بيانات خاتمة الصفحات (تُعدَّل من الإدارة)
      whatsapp: String(s.contact_whatsapp || '').replace(/[^\d+]/g, '').slice(0, 16), email: /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(String(s.contact_email || '')) ? String(s.contact_email) : '',
      fb: safeUrl(s.social_fb), ig: safeUrl(s.social_ig), tt: safeUrl(s.social_tt), tg: safeUrl(s.social_tg),
      faq: String(s.faq_text || '').split('\n').map(l => l.split('|')).filter(x => x[0] && x[1]).slice(0, 12).map(([q, ...a]) => [q.trim().slice(0, 120), a.join('|').trim().slice(0, 500)]),
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

function pickVerifyAmount(s) {
  // المدار لا يحوّل كسورًا: مبلغ كامل (افتراضي 1 دينار). التطابق يتم برقم المُرسِل نفسه.
  const v = Math.round(num(s && s.pv_amount_lyd, 1));
  return Math.min(10, Math.max(1, v));
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
    out = { amount_lyd: pickVerifyAmount(s), to_phone: toPhone, expires_ms: now + PV_TTL_MIN * 60000 };
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

function cardTypesOf(s) {
  const arr = Array.isArray(s.card_types) ? s.card_types : [];
  return arr.filter(t => t && t.active !== false && t.id && t.name).slice(0, 6).map(t => ({
    id: String(t.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20), name: String(t.name).slice(0, 30), desc: String(t.desc || '').slice(0, 160),
    provider: String(t.provider || '').slice(0, 30), badge: String(t.badge || '').slice(0, 20),
    fee_fixed: Math.max(0, num(t.fee_fixed, 8)), fee_pct: Math.min(50, Math.max(0, num(t.fee_pct, 2.5))),
    topup_fixed: Math.max(0, num(t.topup_fixed, 2.5)), topup_pct: Math.min(50, Math.max(0, num(t.topup_pct, 2.5))),
    min: Math.max(1, num(t.min, 10)), max: Math.max(1, num(t.max, 500)),
    rules: String(t.rules || '').slice(0, 2000), blocked: String(t.blocked || '').slice(0, 600), supports_3d: t.supports_3d !== false,
  }));
}
function cleanBanners(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(b => b && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(String(b.img || '')) && String(b.img).length <= 300000).slice(0, 6).map(b => ({
    img: String(b.img),
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
  if (res.status === 404) { countReads(1); return null; }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error('FS_ERROR', res.status, JSON.stringify(data));
    if (res.status === 429) { _quotaHitAt = Date.now(); throw httpError(503, 'ضغط كبير على كاردو الآن — حاول بعد قليل، وبياناتك محفوظة بأمان'); }
    throw httpError(500, 'خطأ في قاعدة البيانات');
  }
  countReads(Array.isArray(data) ? Math.max(1, data.filter(r => r && r.document).length) : 1);
  return data;
}

async function fsGetFS(env, path) {
  const doc = await fsFetch(env, `/${path}`);
  return doc ? fromFsFields(doc.fields || {}) : null;
}
// v34: مجموعات المرحلة 1 تُقرأ من D1 عند تفعيل مفتاحها (الرجوع تلقائي لـ Firestore عند أي خطأ)
async function fsGet(env, path) {
  const t = env && env.DB ? d1PathOf(path) : null;
  if (t) {
    try { if (await d1ReadOn(env, t.coll)) return await d1GetDoc(env, t.coll, t.id); }
    catch (e) { console.error('D1_READ_FALLBACK', e.message); if (await d1IsPrimary(env)) throw httpError(503, 'قاعدة البيانات غير متاحة مؤقتًا — أعد المحاولة'); }
  }
  return fsGetFS(env, path);
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
  await d1WriteGate(env);                                                       // v35: نافذة التحويل
  if (await d1IsPrimary(env)) {                                                 // v35: D1 أساسي
    try { return await d1CommitPrimary(env, writes); }
    catch (e) { if (e.aborted) throw httpError(500, 'خطأ في قاعدة البيانات'); throw e; }
  }
  const res = await fsFetch(env, ':commit', {
    method: 'POST',
    body: JSON.stringify({ writes }),
  });
  await d1MirrorWrites(env, writes).catch(e => console.error('D1_MIRROR', e.message));   // v34: كتابة مزدوجة
  return res;
}

async function fsQueryRaw(env, structuredQuery) {
  try { const r = await d1QueryAsFs(env, structuredQuery); if (r) return r; }
  catch (e) { console.error('D1_READ_FALLBACK', e.message); if (await d1IsPrimary(env)) return []; }
  return fsQueryRawFS(env, structuredQuery);
}
async function fsQueryRawFS(env, structuredQuery) {
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
  await d1WriteGate(env);                                                       // v35
  if (await d1IsPrimary(env)) return d1RunTransaction(env, fn, Math.max(6, attempts));
  return fsRunTransactionFS(env, fn, attempts);
}
async function fsRunTransactionFS(env, fn, attempts = 4) {
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
      await d1MirrorWrites(env, writes).catch(e => console.error('D1_MIRROR_TX', e.message));   // v34
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

const _staffMemM = new Map();
async function isStaffCached(env, uid) {
  const h = _staffMemM.get(uid);
  if (h && h.exp > Date.now()) return h.v;
  const v = !!(await getStaff(env, uid).catch(() => null));
  _staffMemM.set(uid, { v, exp: Date.now() + 60000 });
  if (_staffMemM.size > 2000) _staffMemM.clear();
  return v;
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

const REAUTH_PERMS = /^(deposit\.|deposits\.approve|withdraw|wallet|cards\.edit|mcards|settings\.|users\.edit|merchants\.edit|staff)/;
async function requirePermission(user, env, perm) {
  if (REAUTH_PERMS.test(String(perm)) && user && user.auth_time) {
    const hrs = num((await getSettings(env)).admin_reauth_hours, 12);
    if (hrs > 0 && Date.now() / 1000 - user.auth_time > hrs * 3600) throw httpError(401, 'لأمان العمليات المالية: سجّل الخروج ثم الدخول مجددًا إلى لوحة الإدارة');
  }
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
  if ('card_types' in out) out.card_types = out.card_types.slice(0, 6).map((t, i) => ({
    id: String((t && t.id) || ('t' + i)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20) || ('t' + i), name: String((t && t.name) || '').replace(/[<>]/g, '').slice(0, 30),
    desc: String((t && t.desc) || '').replace(/[<>]/g, '').slice(0, 160), provider: String((t && t.provider) || '').replace(/[<>]/g, '').slice(0, 30),
    badge: String((t && t.badge) || '').replace(/[<>]/g, '').slice(0, 20), active: !t || t.active !== false,
    fee_fixed: Math.max(0, num(t && t.fee_fixed, 8)), fee_pct: Math.min(50, Math.max(0, num(t && t.fee_pct, 2.5))),
    topup_fixed: Math.max(0, num(t && t.topup_fixed, 2.5)), topup_pct: Math.min(50, Math.max(0, num(t && t.topup_pct, 2.5))),
    min: Math.max(1, num(t && t.min, 10)), max: Math.max(1, num(t && t.max, 500)),
    rules: String((t && t.rules) || '').replace(/[<>]/g, '').slice(0, 2000), blocked: String((t && t.blocked) || '').replace(/[<>]/g, '').slice(0, 600),
    supports_3d: !t || t.supports_3d !== false,
  })).filter(t => t.name);
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
  if (methodPaused(st, method)) throw httpError(503, 'هذه الطريقة متوقفة مؤقتًا — اختر طريقة أخرى');
  if (!Number.isFinite(amountLyd) || amountLyd <= 0) throw httpError(400, 'أدخل المبلغ');

  const manualMode = (st[`m_${method}_mode`] || st.deposit_mode) === 'manual';
  const meDoc = await fsGet(env, `users/${user.uid}`);
  assertMoneyVerified(env, st, meDoc);
  const verifiedPhone = meDoc && meDoc.phone_verified ? String(meDoc.phone_verified) : '';
  // بدون توثيق: الزبون يكتب الرقم الذي حوّل منه + المبلغ. أول حساب ينجح إيداعه من رقم «يملكه».
  const phone = normalizePhone(body.phone || '') || verifiedPhone;
  if (!phone) throw httpError(400, 'أدخل رقمك الذي حوّلت منه (10 أرقام)');
  const [owner, binding] = await Promise.all([fsGet(env, `phone_owners/${phone}`), fsGet(env, `phone_bindings/${phone}`)]);
  const ownedByOther = !!((owner && owner.uid && owner.uid !== user.uid) || (binding && binding.uid && binding.uid !== user.uid));

  if (!(await checkRateLimit(env, `claim_${user.uid}`, 5, 3600))) throw httpError(429, 'محاولات كثيرة — حاول بعد ساعة');

  const maxLyd = num(st.max_deposit_lyd, 5000);
  if (amountLyd > maxLyd) throw httpError(400, `الحد الأقصى ${maxLyd} د.ل`);
  const rate = method === 'almadar' ? num(st.rate_almadar, 12.5) : num(st.rate_libyana, 11.8);
  await assertDailyLimit(env, st, user.uid, 'deposit', round2(amountLyd / rate));

  const sms = !ownedByOther && !manualMode ? await findUnclaimedSms(env, phone, amountLyd) : null;
  if (sms) {
    const credited = await fsRunTransaction(env, async (tx) => {
      const smsDoc = await tx.get(`sms_transactions/${sms._id}`);
      if (!smsDoc || smsDoc.status !== 'unclaimed') throw httpError(409, 'الحوالة مربوطة مسبقًا');
      if (smsDoc.sender !== phone) throw httpError(403, 'غير مصرّح');
      const own = await tx.get(`phone_owners/${phone}`);
      if (own && own.uid && own.uid !== user.uid) throw httpError(409, 'هذا الرقم مرتبط بحساب آخر — أُرسل طلبك للمراجعة');
      const amt = round2(num(smsDoc.amount_usd, 0));
      const L = await ledgerOpen(tx, user.uid);
      await ledgerPost(L, { type: 'credit', amount: amt, reason: 'deposit_claim', reference: sms._id, entryId: `txn_dep_${sms._id}` });
      ledgerClose(tx, L);
      await dailyCheckTx(tx, st, user.uid, 'deposit', amt);
      tx.update(`sms_transactions/${sms._id}`, { status: 'claimed', uid: user.uid, claimed_at: nowIso(), matched_by: 'claim' });
      if (!own) tx.create('phone_owners', phone, { uid: user.uid, network: smsDoc.method || method, at: nowIso() });
      if (!verifiedPhone) tx.update(`users/${user.uid}`, { phone_verified: phone, phone_network: smsDoc.method || method, phone_verified_at: nowIso() });
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
    background(promoFirstDeposit(env, user.uid, credited, 'claim'));
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
    status: 'pending', awaiting_sms: !manualMode && !ownedByOther, verified: !manualMode && !ownedByOther, manual: manualMode || ownedByOther, owned_by_other: ownedByOther,
    expires_ms: manualMode ? 0 : Date.now() + 2 * 3600000, created_at: nowIso(),
  });
  notify(env, user.uid, 'deposit_pending', { amount: amountLyd.toFixed(2) + ' د.ل', method: method === 'libyana' ? 'ليبيانا' : 'المدار' });
  return { success: true, matched: false, manual: manualMode || ownedByOther, claim_id: claimId };
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
  { const _s = await getSettings(env); const _u = await fsGet(env, `users/${user.uid}`); assertMoneyVerified(env, _s, _u); }
  const s = await getSettings(env);
  assertLive(s);
  if (s.m_usdt_on !== true) throw httpError(503, 'الدفع بالعملات الرقمية غير متاح');
  const network = CRYPTO_NETS[String(body.network || 'trc20')] ? String(body.network || 'trc20') : 'trc20';
  const net = CRYPTO_NETS[network];
  if (s[net.onKey] === false || (network !== 'trc20' && s[net.onKey] !== true)) throw httpError(503, `${net.label} غير مفعّل`);
  const address = String(s[net.addrKey] || '').trim();
  if (!net.addrRe.test(address)) throw httpError(503, `بيانات الاستقبال لـ ${net.label} غير مضبوطة`);
  if (network === 'binance_pay' && !(env.BINANCE_API_KEY && env.BINANCE_API_SECRET)) throw httpError(503, 'Binance Pay غير مربوط بعد');

  const amount = money(body.amount_usd);
  if (!Number.isFinite(amount)) throw httpError(400, 'أدخل المبلغ');
  const minU = num(s.usdt_min, 5), maxU = num(s.usdt_max, 1000);
  if (amount < minU) throw httpError(400, `الحد الأدنى ${minU} USDT`);
  if (amount > maxU) throw httpError(400, `الحد الأقصى ${maxU} USDT`);
  await assertDailyLimit(env, s, user.uid, 'deposit', amount);
  if (methodPaused(s, network)) throw httpError(503, `${net.label} متوقفة مؤقتًا — اختر طريقة أخرى`);
  if (!(await checkRateLimit(env, `usdt_inv_${user.uid}`, 15, 3600))) throw httpError(429, 'محاولات كثيرة — حاول بعد ساعة');
  // حماية: فواتير كثيرة غير مدفوعة في آخر ساعة
  if (env.DB) {
    const open = await d1All(env, `SELECT COUNT(*) AS n FROM usdt_invoices WHERE uid = ? AND status IN ('awaiting','cancelled') AND json_extract(data, '$.created_ms') > ?`, [user.uid, Date.now() - 3600000]).catch(() => [{ n: 0 }]);
    if (num(open[0] && open[0].n, 0) >= 5) throw httpError(429, 'عندك فواتير كثيرة غير مدفوعة — ادفع واحدة منها أو انتظر ساعة');
  }
  // حماية: سقف للحسابات الجديدة
  { const me = await fsGet(env, `users/${user.uid}`).catch(() => null);
    const ageDays = me && me.created_at ? (Date.now() - new Date(me.created_at).getTime()) / 86400000 : 999;
    const cap = num(s.new_acct_crypto_max, 50);
    if (cap > 0 && ageDays < num(s.new_acct_days, 7)) {
      const today = await readCounter(env, user.uid).catch(() => ({ deposit: 0 }));
      if (amount + num(today.deposit, 0) > cap) throw httpError(400, `الحسابات الجديدة حدّها ${cap}$ يوميًا بالعملات الرقمية خلال أول ${num(s.new_acct_days, 7)} أيام`);
    } }

  const minutes = num(s.usdt_window_min, 30);
  const now = Date.now();
  const checkUntil = now + Math.min(72, Math.max(1, num(s.invoice_check_hours, 24))) * 3600000;
  const invNo = 'KRD-' + String(now).slice(-7);
  const id = `INV${now}${randomSuffix(4)}`;
  const expires = now + minutes * 60000;

  // حجز مبلغ دفع فريد ذرّيًا — مستند لكل مبلغ
  for (let i = 0; i < 25; i++) {
    const b = crypto.getRandomValues(new Uint8Array(2));
    const frac = ((((b[0] << 8) | b[1]) % 900) + 100) / 10000;
    const payAmount = Number((amount + frac).toFixed(4));
    const slot = (network === 'trc20' ? '' : network + '_') + payAmount.toFixed(4).replace('.', '_');
    const ok = await fsRunTransaction(env, async (tx) => {
      const r = await tx.get(`usdt_amounts/${slot}`);
      if (r && num(r.expires_ms, 0) > now) return false;
      tx.update(`usdt_amounts/${slot}`, { invoice_id: id, expires_ms: checkUntil + 10 * 60000 }, false);   // محجوز طوال فترة الفحص (24 ساعة)
      tx.create('usdt_invoices', id, {
        uid: user.uid, no: invNo, amount_usd: amount, pay_amount: payAmount, address, network, status: 'awaiting',
        created_at: new Date(now).toISOString(), created_ms: now, expires_ms: expires, check_until_ms: checkUntil,
      });
      return true;
    });
    if (ok) { await logOp(env, user.uid, 'invoice.create', { id, network, amount }, { payAmount }, true);
      return { success: true, invoice: invView({ _id: id, uid: user.uid, no: invNo, amount_usd: amount, pay_amount: payAmount, address, network, status: 'awaiting', created_ms: now, created_at: new Date(now).toISOString(), expires_ms: expires, check_until_ms: checkUntil }) }; }
  }
  throw httpError(503, 'ازدحام مؤقت، حاول بعد قليل');
}

async function handleUsdtVerify(user, body, env) {
  const id = String(body.invoice_id || '').trim();
  if (!/^INV\d+[A-Z0-9]{4}$/.test(id)) throw httpError(400, 'رقم الفاتورة غير صالح');
  if (!memAllowWin(`usdt_v_${user.uid}`, 240, 3600)) throw httpError(429, 'محاولات كثيرة');
  const inv = await fsGet(env, `usdt_invoices/${id}`);
  if (!inv || inv.uid !== user.uid) throw httpError(404, 'الفاتورة غير موجودة');
  if (inv.status === 'paid') return { success: true, paid: true, already: true, credited: num(inv.received, 0), invoice: invView({ ...inv, _id: id }) };
  if (!INV_OPEN.includes(inv.status)) return { success: true, paid: false, invoice: invView({ ...inv, _id: id }) };
  return invoiceCheck(env, id, inv, 'user');
}
// فحص فاتورة مفتوحة على الشبكة/بايننس (مرة كل 20 ثانية كحد أقصى لكل فاتورة) — يُستعمل من صفحة صاحبها ورابط الدفع المشترك
async function invoiceCheck(env, id, inv, by) {
  if (!memAllowWin(`inv_chk_${id}`, 1, 20)) return { success: true, paid: false, invoice: invView({ ...inv, _id: id }) };
  const network = inv.network && CRYPTO_NETS[inv.network] ? inv.network : 'trc20';
  const until = Math.min(Date.now(), invCheckUntil(inv));
  let hit = null;
  try { hit = await findCryptoPayment(env, network, inv.address, num(inv.pay_amount, 0), num(inv.created_ms, 0) - 60000, until); }
  catch (e) { console.error('CRYPTO_FETCH_FAILED', network, e.message); return { success: true, paid: false, retry: true, invoice: invView({ ...inv, _id: id }) }; }
  if (!hit) {
    if (invCheckUntil(inv) < Date.now()) { inv.status = inv.status === 'cancelled' ? 'cancelled_closed' : 'expired'; await fsPatch(env, `usdt_invoices/${id}`, { status: inv.status }); }
    return { success: true, paid: false, invoice: invView({ ...inv, _id: id }) };
  }
  const r = await settleInvoice(env, id, hit, by || 'user');
  const fresh = await fsGet(env, `usdt_invoices/${id}`);
  return { success: true, paid: !!r.paid, credited: r.credited || 0, duplicate: !!r.dup, invoice: invView({ ...(fresh || inv), _id: id }) };
}

/* ─── فواتير الإيداع الرقمية: الحالة، التسوية، الإلغاء ─── */
const INV_OPEN = ['awaiting', 'cancelled'];
const invCheckUntil = inv => num(inv.check_until_ms, 0) || (num(inv.created_ms, 0) + 24 * 3600000);
function invView(inv) {
  return { id: inv._id, no: inv.no || ('KRD-' + String(inv.created_ms || '').slice(-7)), amount_usd: num(inv.amount_usd, 0), pay_amount: num(inv.pay_amount, 0),
    address: inv.address || '', network: inv.network || 'trc20', network_label: (CRYPTO_NETS[inv.network || 'trc20'] || {}).label || 'USDT', status: inv.status,
    created_ms: num(inv.created_ms, 0), expires_ms: num(inv.expires_ms, 0), check_until_ms: invCheckUntil(inv),
    paid_at: inv.paid_at || '', received: num(inv.received, 0), txid: inv.txid || '', late: inv.late === true, shared: !!inv.share_h };
}
// تُضيف الرصيد لصاحب الفاتورة — آمنة من التكرار (المعاملة الواحدة لا تُحسب مرتين)
async function settleInvoice(env, id, hit, by) {
  const txid = String((hit && hit.txid) || '');
  if (!/^[0-9A-Za-z_-]{6,90}$/.test(txid)) return { paid: false };
  const received = round2(num(hit.amount, 0));
  if (!(received > 0)) return { paid: false };
  const s = await getSettings(env);
  let owner = '', network = 'trc20';
  const r = await fsRunTransaction(env, async (tx) => {
    const cur = await tx.get(`usdt_invoices/${id}`);
    if (!cur || !INV_OPEN.includes(cur.status)) return { dup: true };
    network = cur.network && CRYPTO_NETS[cur.network] ? cur.network : 'trc20';
    const norm = /^0x[0-9a-fA-F]{64}$/.test(txid) ? txid.toLowerCase() : txid;
    const txKey = network === 'trc20' ? norm : `${network}_${norm}`;
    if (await tx.get(`usdt_txids/${txKey}`)) return { dup: true };
    if (norm !== txid && await tx.get(`usdt_txids/${network === 'trc20' ? txid : `${network}_${txid}`}`)) return { dup: true };
    owner = cur.uid;
    const L = await ledgerOpen(tx, cur.uid);
    await ledgerPost(L, { type: 'credit', amount: received, reason: 'usdt_deposit', reference: txid, entryId: `txn_usdt_${id}` });
    ledgerClose(tx, L);
    await dailyCheckTx(tx, s, cur.uid, 'deposit', received);
    tx.create('usdt_txids', txKey, { invoice_id: id, uid: cur.uid, amount: received, network, from: String(hit.from || '').slice(0, 60), by: String(by || 'system').slice(0, 64), created_at: nowIso() });
    const late = Date.now() > num(cur.expires_ms, 0) + 10 * 60000;
    tx.update(`usdt_invoices/${id}`, { status: 'paid', txid, paid_at: nowIso(), received, late, paid_by: String(by || 'system').slice(0, 64) });
    tx.create('wallet_deposits', id, {
      uid: cur.uid, amount_usd: received, amount_lyd: 0, method: `${CRYPTO_NETS[network].label} — تلقائي`, proof_url: '',
      note: (cur.no || '') + ' · ' + CRYPTO_NETS[network].label + ' · ' + txid.slice(0, 12) + '…', status: 'approved', auto: true, created_at: nowIso(),
    });
    return { dup: false };
  });
  if (r.dup) return { paid: false, dup: true };
  await logOp(env, owner, 'deposit.usdt', { id, by }, { txid, received }, true);
  notify(env, owner, 'deposit_ok', { amount: received.toFixed(2), method: CRYPTO_NETS[network].label });
  background(promoFirstDeposit(env, owner, received, id));
  return { paid: true, credited: received, txid };
}

async function handleInvoiceGet(user, body, env) {
  if (!memAllowWin(`inv_get_${user.uid}`, 240, 3600)) throw httpError(429, 'محاولات كثيرة');
  const id = String(body.id || '').trim();
  if (!/^INV\d+[A-Z0-9]{4}$/.test(id)) throw httpError(400, 'رقم الفاتورة غير صالح');
  const inv = await fsGet(env, `usdt_invoices/${id}`);
  if (!inv || inv.uid !== user.uid) throw httpError(404, 'الفاتورة غير موجودة');
  return { success: true, invoice: invView({ ...inv, _id: id }) };
}
async function handleInvoiceCancel(user, body, env) {
  if (!memAllowWin(`inv_cx_${user.uid}`, 30, 3600)) throw httpError(429, 'محاولات كثيرة');
  const id = String(body.id || '').trim();
  if (!/^INV\d+[A-Z0-9]{4}$/.test(id)) throw httpError(400, 'رقم الفاتورة غير صالح');
  let out = null;
  await fsRunTransaction(env, async (tx) => {
    const inv = await tx.get(`usdt_invoices/${id}`);
    if (!inv || inv.uid !== user.uid) throw httpError(404, 'الفاتورة غير موجودة');
    if (inv.status !== 'awaiting') { out = inv; return; }
    tx.update(`usdt_invoices/${id}`, { status: 'cancelled', cancelled_at: nowIso() });   // تبقى تحت الفحص 24 ساعة: لو حوّل بالخطأ يُضاف رصيده
    out = { ...inv, status: 'cancelled' };
  });
  return { success: true, invoice: invView({ ...out, _id: id }) };
}
async function handleInvoiceList(user, body, env) {
  if (!memAllowWin(`inv_ls_${user.uid}`, 120, 3600)) throw httpError(429, 'محاولات كثيرة');
  let docs;
  if (env.DB) {
    const rows = await d1All(env, `SELECT id, data FROM usdt_invoices WHERE uid = ? ORDER BY json_extract(data, '$.created_ms') DESC LIMIT 40`, [user.uid]);
    docs = rows.map(r => { let d = {}; try { d = JSON.parse(r.data); } catch {} return { ...d, _id: r.id }; });
  } else {
    const rows = await fsQueryRaw(env, { from: [{ collectionId: 'usdt_invoices' }],
      where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: user.uid } } }, limit: 60 });
    docs = rows.map(r => withId(r, 'usdt_invoices'));
  }
  const list = docs.sort((a, b) => num(b.created_ms, 0) - num(a.created_ms, 0)).slice(0, 40).map(invView);
  return { success: true, invoices: list };
}

async function handleWithdrawRequest(user, body, env) {
  { const _s = await getSettings(env); const _u = await fsGet(env, `users/${user.uid}`); assertMoneyVerified(env, _s, _u); }
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
  if (depInfo && action !== 'reject') background(promoFirstDeposit(env, depInfo.uid, num(depInfo.amount_usd, 0), depositId));
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
  if (s.mc_maint_on === true) throw httpError(503, 'قسم البطاقات قيد الصيانة حاليًا');
  const key = idemKeyOf(body);

  const amount = money(body.amount);
  const nameOnCard = String(body.name_on_card || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const cardName = String(body.card_name || 'بطاقتي').trim().slice(0, 40) || 'بطاقتي';
  if (!Number.isFinite(amount)) throw httpError(400, 'أدخل مبلغًا صحيحًا');
  if (!/^[A-Z][A-Z .'-]{1,39}$/.test(nameOnCard)) throw httpError(400, 'اسم حامل البطاقة يجب أن يكون بحروف لاتينية');
  const mn = num(s.mc_create_min, 10), mx = num(s.mc_create_max, 500);
  if (amount < mn) throw httpError(400, `الحد الأدنى ${mn}$`);
  if (amount > mx) throw httpError(400, `الحد الأقصى ${mx}$`);

  const types = cardTypesOf(s);
  let ctype = null;
  if (types.length) {
    ctype = types.find(t => t.id === String(body.type_id || ''));
    if (!ctype) throw httpError(400, 'اختر نوع البطاقة');
    if (amount < ctype.min) throw httpError(400, `الحد الأدنى لهذا النوع ${ctype.min}$`);
    if (amount > ctype.max) throw httpError(400, `الحد الأقصى لهذا النوع ${ctype.max}$`);
  }
  const fee = ctype ? round2(ctype.fee_fixed + amount * ctype.fee_pct / 100)
    : round2(num(s.mc_create_fee_fixed, 8) + amount * num(s.mc_create_fee_pct, 2.5) / 100);
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
      type_id: ctype ? ctype.id : '', type_name: ctype ? ctype.name : '', provider: ctype ? ctype.provider : '',
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
  if (s.mc_maint_on === true) throw httpError(503, 'قسم البطاقات قيد الصيانة حاليًا');
  if (s.mc_topup_on !== true) throw httpError(503, 'إعادة التعبئة غير متاحة حاليًا');
  const key = idemKeyOf(body, false);

  const cardId = String(body.card_id || '').trim();
  const amount = money(body.amount);
  if (!cardId) throw httpError(400, 'اختر البطاقة');
  if (!Number.isFinite(amount)) throw httpError(400, 'أدخل مبلغًا صحيحًا');
  const mn = num(s.mc_topup_min, 10), mx = num(s.mc_topup_max, 500);
  if (amount < mn) throw httpError(400, `الحد الأدنى للشحن ${mn}$`);
  if (amount > mx) throw httpError(400, `الحد الأقصى للشحن ${mx}$`);
    let tfx = num(s.mc_topup_fee_fixed, 8), tpc = num(s.mc_topup_fee_pct, 2.5);
  { const c0 = await fsGet(env, `manual_cards/${cardId}`).catch(() => null); const ct = c0 && c0.type_id ? cardTypesOf(s).find(t => t.id === c0.type_id) : null; if (ct) { tfx = ct.topup_fixed; tpc = ct.topup_pct; } }
  const fee = round2(tfx + amount * tpc / 100);
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
    if (rv.card_id) {                                    // بطاقة استُبدلت → البيانات القديمة لم تعد صالحة
      const cd = await tx.get(`manual_cards/${rv.card_id}`);
      if (cd && cd.reveal_order && cd.reveal_order !== orderId) throw httpError(410, 'استُبدلت هذه البطاقة — افتح بياناتها الجديدة');
    }
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
  const billingAddr = cleanAddr(body.billing_address);
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
  }

  const now = Date.now();
  const expiresAt = new Date(now + revealMs).toISOString();
  const cardId = isCreate ? `MCX${now}${randomSuffix(4)}` : String(o0.card_id || '');
  const encVault = isCreate ? await encryptV2(env, `vault:${cardId}`, { card_number: pan, expiry, cvv }) : null;   // v52: خزنة دائمة مشفّرة (تُفتح بالرمز السري)
  cvv = '';                                                // لا نحتفظ به في الذاكرة بعد التشفير

  await fsRunTransaction(env, async (tx) => {
    const o = await tx.get(`manual_card_orders/${id}`);
    if (!o) throw httpError(404, 'الطلب غير موجود');
    if (o.status !== 'pending') throw httpError(409, 'الطلب مُغلق بالفعل');
    if (o.kind === 'create') rewardOut = await referralRewardTx(tx, s, { ...o, id });
    if (o.kind === 'create') {
      tx.create('manual_cards', cardId, {
        uid: o.uid, card_name: o.card_name || 'بطاقتي', name_on_card: o.name_on_card || '',
        last4: pan.slice(-4), first6: pan.slice(0, 6), vault: true, status: 'active', balance: round2(num(o.amount, 0)),
        type_id: o.type_id || '', type_name: o.type_name || '', provider: o.provider || '',
        created_at: nowIso(), created_by: staff.uid, provider_ref: providerRef, billing_address: billingAddr,
      });
      tx.create('card_vault', cardId, { uid: o.uid, enc: encVault, first6: pan.slice(0, 6), last4: pan.slice(-4), created_at: nowIso(), by: staff.uid });
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
  if (!memAllowWin(`svc_${user.uid}`, 20, 3600)) throw httpError(429, 'محاولات كثيرة — حاول بعد ساعة');

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
  if (!memAllowWin(`store_${user.uid}`, 30, 3600)) throw httpError(429, 'محاولات كثيرة — حاول بعد ساعة');

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
  if (!memAllowWin(`cpn_${user.uid}`, 20, 3600)) throw httpError(429, 'محاولات كثيرة');
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
  const feeCap = Math.max(0, num(order.fee, 0) * 0.5);           // المكافآت لا تتجاوز نصف رسوم الإصدار (تمنع الحسابات الوهمية المربحة)
  let inviterAmt = round2(num(s.referral_card_inviter, 1)), inviteeAmt = round2(num(s.referral_card_invitee, 0.2));
  if (inviterAmt + inviteeAmt > feeCap) { const k = feeCap / Math.max(0.01, inviterAmt + inviteeAmt); inviterAmt = round2(inviterAmt * k); inviteeAmt = round2(inviteeAmt * k); }
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
  bustPublic();
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
  bustPublic();
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
  background(promoFirstDeposit(env, uid, credited, smsId));
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
  if (!asStaff && !memAllowWin(`tktr_${user.uid}`, 30, 3600)) throw httpError(429, 'محاولات كثيرة');

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
  const fromL = from.toLowerCase().replace(/\s+/g, '');
  const senderOk = allow.length > 0 && allow.some(a => s0.sms_sender_exact === false ? fromL.includes(a.replace(/\s+/g, '')) : fromL === a.replace(/\s+/g, ''));

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
  else if (num(s0.sms_auto_max_lyd, 100) > 0 && parsed.amount_lyd > num(s0.sms_auto_max_lyd, 100)) hold = 'amount_over_auto_limit';   // مراجعة يدوية للمبالغ الكبيرة
  if (hold) {
    await fsSet(env, `sms_transactions/${fingerprint}`, { ...record, status: 'review', needs_attention: true, error: hold });
    return { success: true, parsed: true, matched: false, review: true };
  }

  try {
    const pvRes = await tryPhoneVerification(env, parsed, network, record, fingerprint, rate);
    if (pvRes) { if (pvRes.verified || pvRes.bound || pvRes.via === 'phone_verification') background(alertAdmins(env, 'phone_bound_admin', { phone: '0' + parsed.sender, network })); return pvRes; }
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
        const own = await tx.get(`phone_owners/${parsed.sender}`);
        if (!u || (own && own.uid && own.uid !== claim.uid)) throw httpError(409, 'PHONE_OWNED');
        const L = await ledgerOpen(tx, claim.uid);
        await ledgerPost(L, { type: 'credit', amount: amountUsd, reason: 'sms_deposit', reference: fingerprint, entryId: `txn_sms_${fingerprint}` });
        ledgerClose(tx, L);
        await dailyCheckTx(tx, s0, claim.uid, 'deposit', amountUsd);
        tx.update(`wallet_deposits/${claim._id}`, { status: 'approved', auto: true, awaiting_sms: false, amount_usd: amountUsd, approved_at: nowIso() });
        if (!own) tx.create('phone_owners', parsed.sender, { uid: claim.uid, network, at: nowIso() });
        if (!u.phone_verified) tx.update(`users/${claim.uid}`, { phone_verified: parsed.sender, phone_network: network, phone_verified_at: nowIso() });
        tx.create('sms_transactions', fingerprint, { ...record, status: 'claimed', uid: claim.uid, claimed_at: nowIso(), matched_by: 'pending_claim' });
      });
      await logOp(env, claim.uid, 'deposit.sms_matched', { amount_lyd: parsed.amount_lyd }, { credited: amountUsd }, true);
      notify(env, claim.uid, 'deposit_ok', { amount: amountUsd.toFixed(2) });
      background(promoFirstDeposit(env, claim.uid, amountUsd, fingerprint));
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
    b = { banned: !!(userDoc && userDoc.banned === true), exp: Date.now() + 300000 };
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

// v35: رد جاهز كنص JSON (البيانات تخرج من D1 كما هي — بلا تحليل/إعادة بناء يستهلك المعالج)
class RawJson { constructor(s) { this.s = s; } }
function json(data, status, origin) {
  return new Response(data instanceof RawJson ? data.s : JSON.stringify(data), {
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
  let ops = await kvGetJSON(env, 'settings:main');
  if (!ops) { ops = await fsGet(env, 'settings/main'); if (ops) kvPutJSON(env, 'settings:main', ops, 600); };
  const v = { ...DEFAULT_SETTINGS, ...(ops || {}) };
  _settingsCache = { v, exp: Date.now() + 120000 };
  return v;
}
function clearSettingsCache() { _settingsCache = { v: null, exp: 0 }; bustPublic(); if (_envForUsage && _envForUsage.KV) _envForUsage.KV.delete('settings:main').catch(() => {}); }

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
  { const _s = await getSettings(env); const _u = await fsGet(env, `users/${user.uid}`); assertMoneyVerified(env, _s, _u); }
  const s = await getSettings(env);
  assertLive(s);
  const method = String(body.method || '').replace(/[^a-z0-9_]/gi, '').slice(0, 20);
  const status = await handleStatus(env);
  const m = status.methods[method];
  if (!m || m.on === false) throw httpError(400, 'طريقة الدفع غير متاحة');
  if (['libyana', 'almadar', 'usdt'].includes(method)) throw httpError(400, 'استخدم مسار الإيداع الخاص بهذه الطريقة');
  if (methodPaused(s, method)) throw httpError(503, 'هذه الطريقة متوقفة مؤقتًا — اختر طريقة أخرى');
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
  bustPublic();
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
  bustPublic();
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
  bustPublic();
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
  bustPublic();
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
    'بيانات البطاقة محفوظة ومشفّرة في حسابك، وتعرضها في أي وقت برمزك السري (PIN).',
    'لا تشارك بيانات البطاقة أو رمزك السري مع أي أحد — كاردو لن تطلبهما منك أبدًا.'], 'عرض البطاقة الآن'],
  card_replaced: (v) => ['تم تحديث بطاقتك', [
    `حدّثنا بيانات بطاقتك <b>${escHtml(v.card_name)}</b> ببطاقة جديدة.`,
    'اعرض البيانات الجديدة من حسابك برمزك السري (PIN).',
    'البيانات القديمة لم تعد صالحة.'], 'عرض البطاقة الآن'],
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
  card_code: (v) => ['رمز حماية بطاقتك', [v.purpose === 'reset' ? 'طلبت تغيير الرمز السري لبطاقاتك. رمزك هو:' : 'رمز تأكيد جهازك لعرض بيانات البطاقة:', `<div style="font-size:30px;letter-spacing:8px;font-weight:bold;color:#e8b64c;font-family:monospace;direction:ltr;text-align:center;padding:10px 0">${escHtml(v.code)}</div>`, 'صالح لمدة 10 دقائق. إذا لم تطلبه، غيّر كلمة مرور حسابك وتواصل معنا فورًا.'], ''],
  card_viewed: (v) => ['عُرضت بيانات بطاقتك', [`عُرضت بيانات بطاقتك <b>${escHtml(v.card_name)}</b> المنتهية بـ <b dir="ltr">${escHtml(v.last4)}</b> الآن (${escHtml(v.at)}).`, 'إذا لم تكن أنت، جمّد البطاقة فورًا وتواصل معنا.'], 'فتح كاردو'],
  card_state: (v) => [v.state === 'frozen' ? 'جُمّدت بطاقتك مؤقتًا' : v.state === 'active' ? 'أُعيد تفعيل بطاقتك' : 'أُوقفت بطاقتك', [`بطاقتك <b>${escHtml(v.card_name)}</b> المنتهية بـ <b dir="ltr">${escHtml(v.last4)}</b> ${v.state === 'frozen' ? 'مجمّدة مؤقتًا — لا يمكن عرض بياناتها أو شحنها حتى يُفك التجميد' : v.state === 'active' ? 'تعمل الآن من جديد' : 'أُوقفت نهائيًا'}.`, v.reason ? `السبب: ${escHtml(v.reason)}` : ''], 'فتح كاردو'],
  promo_bonus: (v) => ['هدية أول شحنة 🎁', [`أُضيف <b>$${escHtml(v.amount)}</b> هدية لمحفظتك لأنك شحنت أول مرة بـ ${escHtml(v.min)}$ أو أكثر.`, 'شكرًا لثقتك في كاردو!'], 'فتح المحفظة'],
  verify_code: (v) => ['رمز تأكيد بريدك', [`رمزك هو:`, `<div style="font-size:30px;letter-spacing:8px;font-weight:bold;color:#e8b64c;font-family:monospace;direction:ltr;text-align:center;padding:10px 0">${escHtml(v.code)}</div>`, 'صالح لمدة 10 دقائق. إذا لم تطلبه، تجاهل هذه الرسالة.'], ''],
  crypto_unmatched: (v) => ['تحويل يحتاج مراجعة', [`وصل <b>${escHtml(v.amount)} USDT</b> عبر ${escHtml(v.network)} ولم يرتبط بأي فاتورة بالضبط.`, 'افتح الإيداعات ← تحويلات تحتاج مراجعة.'], 'لوحة الإدارة'],
  rsc_done: (v) => ['تم تنفيذ طلبك ✓', [`اكتمل طلبك <b>${escHtml(v.name)}</b>.`, v.codes ? 'الكود جاهز في «طلباتي».' : 'وصل الشحن إلى حسابك.'], 'عرض طلباتي'],
  rsc_failed: (v) => ['تعذّر تنفيذ طلبك', [`طلبك <b>${escHtml(v.name)}</b> لم يكتمل: ${escHtml(v.reason || '')}.`, `أُعيد <b>$${escHtml(v.amount)}</b> إلى محفظتك.`], 'فتح كاردو'],
  rsc_admin: (v) => ['طلب متجر يحتاج مراجعة', [`الطلب <b>${escHtml(v.oid)}</b>: ${escHtml(v.why)}.`, 'افتح «متجر كاردو» في لوحة الإدارة.'], 'لوحة الإدارة'],
  order_placed: (v) => ['تم الشراء ✓', [`تم شراء <b>${escHtml(v.name)}</b> بقيمة <b>${escHtml(v.amount)}</b>.`, v.instant ? 'الكود جاهز في «طلباتي».' : 'سيُنفَّذ طلبك يدويًا ونُعلمك فور اكتماله.'], 'عرض طلباتي'],
  card_requested: (v) => ['وصل طلب البطاقة', [`طلبك لإصدار بطاقة بقيمة <b>$${escHtml(v.amount)}</b> قيد التنفيذ. سنُعلمك فور إصدارها.`], 'فتح كاردو'],
  deposit_pending: (v) => ['وصل طلب الإيداع', [`طلب إيداع <b>${escHtml(v.amount)}</b> عبر ${escHtml(v.method)} قيد المراجعة.`], 'فتح كاردو'],
  m_new_order: (v) => ['طلب جديد في متجرك 🛒', [`طلب جديد: <b>${escHtml(v.service)}</b> بقيمة ${escHtml(String(v.price))}.`, v.dup ? '⚠️ تنبيه: صورة الإيصال استُخدمت في طلب سابق — تحقّق جيدًا.' : '', 'راجع الإيصال وأكّد الطلب من لوحة متجرك.'], 'فتح الطلبات'],
  referral_reward: (v) => ['مكافأة دعوة 🎁', [`أصدر صديقك الذي دعوته بطاقة، وأضفنا <b>$${escHtml(v.amount)}</b> إلى محفظتك.`, 'شكرًا لأنك تنشر كاردو.'], 'فتح المحفظة'],
  referral_welcome: (v) => ['هدية ترحيب 🎁', [`أضفنا <b>$${escHtml(v.amount)}</b> إلى محفظتك لأنك انضممت عبر رمز دعوة وأصدرت بطاقتك الأولى.`], 'فتح المحفظة'],
  phone_bound_admin: (v) => ['رقم جديد وُثّق تلقائيًا 📱', [`وُثّق الرقم <b>${escHtml(v.phone)}</b> (${escHtml(v.network || '')}) عبر رسالة تحويل.`, 'إذا لم يكن طبيعيًا، راجع الحساب من لوحة الإدارة.'], 'لوحة الإدارة'],
  m_pay_changed_admin: (v) => ['تاجر غيّر أرقام الدفع ⚠️', [`متجر <b>${escHtml(v.store)}</b> غيّر طرق الدفع إلى:`, `<i>${escHtml(v.now)}</i>`, 'تأكد أن التغيير صادر من التاجر نفسه.'], 'لوحة الإدارة'],
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

function assertMoneyVerified(env, s, doc) {
  if (s.require_verified_money === false) return;
  assertEmailVerified(env, s, doc);
  if (s.require_phone_verified === true && (!doc || !doc.phone_verified)) throw httpError(403, 'وثّق رقم ليبيانا أو المدار أولًا من الإعدادات');
}
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
  try { const r = await d1QueryAsFs(env, structuredQuery); if (r) return r; }
  catch (e) { console.error('D1_READ_FALLBACK', e.message); if (await d1IsPrimary(env)) throw e.status ? e : httpError(503, 'قاعدة البيانات غير متاحة مؤقتًا'); }
  return fsQueryStrictFS(env, structuredQuery);
}
async function fsQueryStrictFS(env, structuredQuery) {
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
  if (kind === 'q') { const k = id.lastIndexOf('_'); const mm = await fsGet(env, `merchants/${id.slice(0, k)}`); const pm = mm && Array.isArray(mm.pay_methods) ? mm.pay_methods[Number(id.slice(k + 1))] : null; return pm ? pm.logo : ''; }
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
  if (!ipAllow(request, 'img', 120)) return new Response('Too many', { status: 429 });
  const vkey = `img:${kind}:${id}:${u.searchParams.get('v') || ''}`;
  const memHit = _imgMem.get(vkey);
  if (memHit) return imgResponse(memHit.bytes, memHit.type);
  if (env.KV) {
    try {
      const kv = await env.KV.getWithMetadata(vkey, 'arrayBuffer');
      if (kv && kv.value) { imgMemPut(vkey, new Uint8Array(kv.value), (kv.metadata && kv.metadata.type) || 'image/jpeg'); return imgResponse(new Uint8Array(kv.value), (kv.metadata && kv.metadata.type) || 'image/jpeg'); }
    } catch {}
  }
  if (!(await imageIdKnown(env, kind, id))) return new Response('Not found', { status: 404, headers: { 'cache-control': 'public, max-age=600' } });
  const data = String(await loadImageData(env, kind, id) || '');
  const m = /^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!m) { const nf = new Response('Not found', { status: 404, headers: { 'cache-control': 'public, max-age=300' } }); ctx.waitUntil(cache.put(ck, nf.clone())); return nf; }
  const bin = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
  imgMemPut(vkey, bin, m[1]);
  if (env.KV && bin.length < 400000) ctx.waitUntil(env.KV.put(vkey, bin, { expirationTtl: 1209600, metadata: { type: m[1] } }).catch(() => {}));
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
  if (!memAllowWin(`otp_${user.uid}`, 30, 3600)) throw httpError(429, 'محاولات كثيرة — حاول بعد قليل');
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
function cleanAddr(v) { return String(v || '').replace(/\r/g, '').replace(/[<>]/g, '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 6).join('\n').slice(0, 300); }
async function handleAdminCardBalance(user, body, env) {
  const staff = await requirePermission(user, env, 'cards.edit');
  const cardId = String(body.card_id || '').trim();
  const bal = round2(num(body.balance, NaN));
  const hasAddr = typeof body.billing_address === 'string';
  if (!cardId) throw httpError(400, 'البطاقة مفقودة');
  if (!(bal >= 0) || bal > 1000000) throw httpError(400, 'الرصيد غير صالح');
  let before = 0, owner = '';
  await fsRunTransaction(env, async (tx) => {
    const c = await tx.get(`manual_cards/${cardId}`);
    if (!c) throw httpError(404, 'البطاقة غير موجودة');
    before = num(c.balance, 0); owner = c.uid;
    const upd = { balance: bal, balance_updated_at: nowIso(), balance_updated_by: staff.uid };
    if (hasAddr) upd.billing_address = cleanAddr(body.billing_address);
    tx.update(`manual_cards/${cardId}`, upd);
  });
  await logOp(env, staff.uid, 'card.balance', { cardId, before, after: bal }, {}, true);
  return { success: true, balance: bal };
}

/* ═══ v42 — تغيير بطاقة الزبون (استبدال بيانات بطاقة محذوفة) ═══ */
async function handleAdminCardReplace(user, body, env) {
  const staff = await requirePermission(user, env, 'card.fulfil');
  const s = await getSettings(env);
  const cardId = String(body.card_id || '').trim();
  if (!cardId) throw httpError(400, 'البطاقة مفقودة');
  const pan = toLatinDigits(body.card_number || '').replace(/\D/g, '');
  const expRaw = toLatinDigits(body.expiry || '').replace(/\D/g, '');
  const expiry = expRaw.length === 4 ? expRaw.slice(0, 2) + '/' + expRaw.slice(2)
    : expRaw.length === 6 ? expRaw.slice(0, 2) + '/' + expRaw.slice(4) : '';
  let cvv = toLatinDigits(body.cvv || '').replace(/\D/g, '');
  if (!/^\d{13,19}$/.test(pan) || !luhnOk(pan)) throw httpError(400, 'رقم البطاقة غير صالح');
  if (!validExpiry(expiry)) throw httpError(400, 'تاريخ الانتهاء غير صالح (MM/YY في المستقبل)');
  if (!/^\d{3,4}$/.test(cvv)) throw httpError(400, 'CVV غير صالح');
  const hasBal = body.balance !== '' && body.balance != null;
  const bal = hasBal ? round2(num(body.balance, NaN)) : null;
  if (hasBal && (!(bal >= 0) || bal > 1000000)) throw httpError(400, 'الرصيد غير صالح');

  const now = Date.now();
  const rid = `MC${now}${randomSuffix(4)}`;                 // مفتاح عرض جديد بنفس صيغة الطلبات
  const encData = await encryptV2(env, `card:${rid}`, { card_number: pan, expiry });
  const encCvv = await encryptV2(env, `cvv:${rid}`, { cvv });
  const encVault = await encryptV2(env, `vault:${cardId}`, { card_number: pan, expiry, cvv });
  cvv = '';
  const revealMs = Math.min(72, Math.max(1, num(s.mc_reveal_hours, CARD_TTL_DEFAULT_HOURS))) * 3600000;
  const cvvMs = Math.min(60, Math.max(1, num(s.mc_cvv_minutes, CVV_WINDOW_MIN_DEFAULT))) * 60000;
  const expiresAt = new Date(now + revealMs).toISOString();
  let owner = '', cname = '', oldLast4 = '';

  await fsRunTransaction(env, async (tx) => {
    const c = await tx.get(`manual_cards/${cardId}`);
    if (!c) throw httpError(404, 'البطاقة غير موجودة');
    owner = c.uid; cname = c.card_name || 'بطاقتي'; oldLast4 = c.last4 || '';
    const upd = { last4: pan.slice(-4), first6: pan.slice(0, 6), vault: true, status: 'active', reveal_order: rid, reveal_expires_at: expiresAt,
      replaced_at: nowIso(), replaced_by: staff.uid, prev_last4: oldLast4, updated_at: nowIso() };
    if (typeof body.billing_address === 'string') upd.billing_address = cleanAddr(body.billing_address);
    if (hasBal) { upd.balance = bal; upd.balance_updated_at = nowIso(); upd.balance_updated_by = staff.uid; }
    tx.update(`manual_cards/${cardId}`, upd);
    tx.create('manual_card_reveal', rid, { uid: c.uid, card_id: cardId, encrypted_data: encData, created_at: nowIso(), expires_at: expiresAt });
    tx.create('card_cvv_once', rid, { uid: c.uid, enc: encCvv, expires_ms: now + cvvMs, created_at: nowIso() });
    tx.update(`card_vault/${cardId}`, { uid: c.uid, enc: encVault, first6: pan.slice(0, 6), last4: pan.slice(-4), updated_at: nowIso(), by: staff.uid }, false);
  });
  await logOp(env, staff.uid, 'card.replace', { cardId, old: oldLast4, new: pan.slice(-4) }, {}, true);
  notify(env, owner, 'card_replaced', { card_name: cname, cvv_min: Math.round(cvvMs / 60000) });
  return { success: true, reveal_order: rid, expires_at: expiresAt };
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
  bustPublic();
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
  if (num(m.commission_from_ms, 0) > Date.now()) return;            // الشهر المجاني
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
function billingOf(b, s) {
  if (!b.billing_mode && s) return { billing_mode: 'percent', commission_pct: Math.min(50, Math.max(0, num(s.merchant_default_pct, 5))) };
  const mode = ['fixed', 'percent', 'hybrid'].includes(b.billing_mode) ? b.billing_mode : 'fixed';
  const pct = Math.max(0, Math.min(50, round2(num(b.commission_pct, 0))));
  if (mode !== 'fixed' && !(pct > 0)) throw httpError(400, 'حدد نسبة العمولة (أكبر من صفر)');
  return { billing_mode: mode, commission_pct: mode === 'fixed' ? 0 : pct };
}
// طرق دفع التاجر: نوع + عملة + سعر صرف من السعر الأساسي + صورة
const PAY_TYPES = { libyana: 'د.ل', almadar: 'د.ل', bank: 'د.ل', binance: 'USDT', usdt: 'USDT', other: '' };
function cleanPayMethods(arr, prev) {
  const old = Array.isArray(prev) ? prev : [];
  return (Array.isArray(arr) ? arr : []).slice(0, 6).map((p, i) => {
    const type = Object.prototype.hasOwnProperty.call(PAY_TYPES, p && p.type) ? p.type : 'other';
    const id = String((p && p.id) || ('pm' + i)).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16) || ('pm' + i);
    const prevM = old.find(x => x.id === id) || {};
    let logo = prevM.logo || '';
    if (p && 'logo' in p && p.logo !== undefined && p.logo !== null && !/^\/img\//.test(String(p.logo))) logo = cleanImg(p.logo, 60000);
    return {
      id, type, label: String((p && p.label) || '').replace(/[<>]/g, '').slice(0, 30), value: String((p && p.value) || '').replace(/[<>]/g, '').slice(0, 60),
      currency: String((p && p.currency) || PAY_TYPES[type] || '').replace(/[<>]/g, '').slice(0, 8),
      rate: Math.min(100000, Math.max(0.0001, num(p && p.rate, 1))), logo,
    };
  }).filter(p => p.label && p.value);
}
function payPrice(base, pm) { return round2(num(base, 0) * num(pm && pm.rate, 1)); }
function cleanSlug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').slice(0, 30); }
function cleanImg(raw, max = 300000) {
  const s = String(raw || '');
  if (!s) return '';
  if (/^https?:\/\//.test(s)) throw httpError(400, 'ارفع الصورة من جهازك (الروابط الخارجية غير مسموحة)');
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
    const snap = await getMerchantsSnapshot(env);
    const merchants = snap.m.filter(M_ACTIVE).map(m => ({
      id: m._id, slug: m.slug || '', name: m.name, category: m.category || 'أخرى', bio: m.bio || '',
      logo: m.logo || '', cover: m.cover || '',
      contacts: cleanContacts(m.contacts), pay_methods: (Array.isArray(m.pay_methods) ? m.pay_methods.slice(0, 6) : []).map((p, i) => ({
        id: p.id || ('pm' + i), type: p.type || 'other', label: p.label, value: p.value, currency: p.currency || PAY_TYPES[p.type] || 'د.ل',
        rate: num(p.rate, 1), logo: p.logo || '' })),
      base_currency: m.base_currency === 'USD' ? 'USD' : 'LYD', pricing_mode: m.pricing_mode === 'manual' ? 'manual' : 'auto',
      orders_done: num(m.orders_done, 0), rating: num(m.rating_count, 0) ? round2(num(m.rating_sum, 0) / num(m.rating_count, 1)) : 0,
      rating_count: num(m.rating_count, 0), featured: m.featured === true || num(m.featured_until, 0) > Date.now(),
      verified: m.verified === true, verified_since: m.verified === true ? String(m.verified_at || '').slice(0, 7) : '',
      promo: num(m.featured_until, 0) > Date.now(), open: openNow(m), hours: (scheduleText(m.schedule) || String(m.hours || '')).slice(0, 80), tier: merchantTier(m),
      avg_confirm_min: num(m.confirm_count, 0) ? Math.round(num(m.confirm_ms_sum, 0) / num(m.confirm_count, 1) / 60000) : null,
    })).sort((a, b) => (b.featured - a.featured) || (b.orders_done - a.orders_done));
    // المتجر لا يظهر للزبائن حتى يكتمل: شعار + أرقام دفع + خدمة واحدة على الأقل
    const svcCount = {};
    snap.s.filter(x => x.active !== false).forEach(x => { svcCount[x.mid] = (svcCount[x.mid] || 0) + 1; });
    for (let k = merchants.length - 1; k >= 0; k--) {
      const mm = merchants[k];
      if (!mm.logo || !(mm.pay_methods || []).length || !svcCount[mm.id]) merchants.splice(k, 1);
    }
    const live = new Set(merchants.map(m => m.id));
    const services = snap.s.filter(s => live.has(s.mid) && s.active !== false).map(s => ({
      id: s._id, mid: s.mid, name: s.name, desc: s.desc || '', price: num(s.price, 0), image: s.image || '',
      delivery: s.delivery === 'stock' ? 'stock' : 'manual', stock: s.delivery === 'stock' ? num(s.stock_count, 0) : null,
      fields: Array.isArray(s.fields) ? s.fields.slice(0, 3) : [], eta: String(s.eta || '').slice(0, 40),
      old_price: num(s.old_price, 0) > num(s.price, 0) ? num(s.old_price, 0) : 0, section: String(s.section || '').slice(0, 30),
      section_id: String(s.section_id || ''), prices: s.prices && typeof s.prices === 'object' ? s.prices : {},
    }));
    const sections = snap.c.filter(x => live.has(x.mid)).map(x => ({
      id: x._id, mid: x.mid, name: x.name, image: x.image || '', order: num(x.order, 0), delivery: x.delivery === 'auto' ? 'auto' : 'manual',
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
  svc.delivery = 'manual';                                            // v40: كل طلبات المتاجر يدوية
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
  const methods = Array.isArray(m.pay_methods) ? m.pay_methods : [];
  const withIds = methods.map((x, i) => ({ ...x, id: x.id || ('pm' + i) }));
  const pm = withIds.find(x => x.id === String(body.pay_method_id || '')) || withIds.find(x => x.label === String(body.pay_method || '')) || withIds[0] || null;
  const payMethod = pm ? pm.label : String(body.pay_method || '').slice(0, 40);
  const manual = pm && svc.prices && num(svc.prices[pm.id], 0) > 0 ? round2(num(svc.prices[pm.id], 0)) : 0;
  if (m.pricing_mode === 'manual' && pm && !manual) throw httpError(400, 'هذه الخدمة غير متاحة بطريقة الدفع هذه — اختر طريقة أخرى');
  const payAmount = manual || (pm ? payPrice(svc.price, pm) : num(svc.price, 0));
  const payCurrency = pm ? (pm.currency || PAY_TYPES[pm.type] || 'د.ل') : 'د.ل';
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
    pay_method_id: pm ? pm.id || '' : '', pay_type: pm ? pm.type || '' : '', pay_amount: payAmount, pay_currency: payCurrency, pay_to: pm ? pm.value : '',
    proof_hash: proofHash, dup_proof: dupOf.length > 0, dup_of: dupOf.slice(0, 3), eta: String(svc.eta || '').slice(0, 40),
    messages: [], status: 'pending', created_at: nowIso(), updated_at: nowIso(),
  });
  notify(env, m.owner_uid, 'm_new_order', { service: svc.name, price: `${payAmount} ${payCurrency} (${payMethod})`, dup: dupOf.length > 0, link: 'mstore:orders' });
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
  await markMerchantDirty(env, mid);
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
const _meCache = new Map();
async function handleMerchantMe(user, body, env) {
  const hit = _meCache.get(user.uid);
  if (hit && hit.exp > Date.now() && body.fresh !== true) return hit.v;
  const out = await merchantMeInner(user, body, env);
  if (out && out.merchant) _meCache.set(user.uid, { v: out, mid: out.merchant.id, exp: Date.now() + 45000 });
  if (_meCache.size > 500) _meCache.clear();
  return out;
}
async function merchantMeInner(user, body, env) {
  const u = await fsGet(env, `users/${user.uid}`);
  if (!u || !u.merchant_id) return { success: true, merchant: null };
  const m = await fsGet(env, `merchants/${u.merchant_id}`);
  if (!m || m.owner_uid !== user.uid) return { success: true, merchant: null };
  const snapM = await getMerchantsSnapshot(env).catch(() => null);
  const sv = snapM ? snapM.s.filter(x => x.mid === u.merchant_id).map(x => ({ ...x, __snap: true }))
    : await fsQueryStrict(env, { from: [{ collectionId: 'merchant_services' }],
      where: { fieldFilter: { field: { fieldPath: 'mid' }, op: 'EQUAL', value: { stringValue: u.merchant_id } } }, limit: 300 });
  return { success: true, categories: M_CATEGORIES, merchant: {
    terms_accepted: !!m.terms_accepted_at, open: m.open !== false, contact_phone: m.contact_phone || '', commission_from_ms: num(m.commission_from_ms, 0),
    base_currency: m.base_currency === 'USD' ? 'USD' : 'LYD', pricing_mode: m.pricing_mode === 'manual' ? 'manual' : 'auto', verified: m.verified === true, open_now: openNow(m), schedule: m.schedule || { enabled: false }, billing_mode: m.billing_mode || 'fixed', commission_pct: num(m.commission_pct, 0), billing_hold: m.billing_hold === true, hours: m.hours || '', quick_replies: m.quick_replies || [],
    blocked: (m.blocked || []).length, tier: merchantTier(m),
    avg_confirm_min: num(m.confirm_count, 0) ? Math.round(num(m.confirm_ms_sum, 0) / num(m.confirm_count, 1) / 60000) : null,
    id: u.merchant_id, name: m.name, slug: m.slug || '', category: m.category, bio: m.bio || '', logo: m.logo || '', cover: m.cover || '',
    contacts: cleanContacts(m.contacts), pay_methods: m.pay_methods || [], status: m.status, active: M_ACTIVE(m),
    sub_expires_ms: num(m.sub_expires_ms, 0), sub_price: num(m.sub_price, 0), orders_done: num(m.orders_done, 0),
    rating: num(m.rating_count, 0) ? round2(num(m.rating_sum, 0) / num(m.rating_count, 1)) : 0,
  }, services: sv.map(r => r.__snap ? r : withId(r, 'merchant_services')).map(s => ({   // v35: عناصر اللقطة جاهزة (كانت تنهار هنا)
    id: s._id, name: s.name, desc: s.desc || '', price: num(s.price, 0), image: s.image || '', active: s.active !== false,
    delivery: s.delivery === 'stock' ? 'stock' : 'manual', stock: num(s.stock_count, 0), fields: s.fields || [],
    eta: s.eta || '', section: s.section || '', old_price: num(s.old_price, 0), section_id: s.section_id || '', prices: s.prices || {},
  })), sections: (await fsQueryStrict(env, { from: [{ collectionId: 'merchant_sections' }],
    where: { fieldFilter: { field: { fieldPath: 'mid' }, op: 'EQUAL', value: { stringValue: u.merchant_id } } }, limit: 60 }))
    .map(r => withId(r, 'merchant_sections')).map(x => ({ id: x._id, name: x.name, image: x.image || '', order: num(x.order, 0), delivery: x.delivery === 'auto' ? 'auto' : 'manual' }))
    .sort((a, b) => a.order - b.order) };
}

async function handleMerchantProfileSave(user, body, env) {
  await assertNotSaving(env);
  const m = await getMyMerchant(env, user.uid);
  const name = String(body.name || '').replace(/[<>]/g, '').trim().slice(0, 40);
  if (name.length < 2) throw httpError(400, 'اسم المتجر قصير');
  const category = M_CATEGORIES.includes(body.category) ? body.category : 'أخرى';
  const pay = cleanPayMethods(body.pay_methods, m.pay_methods);
  const payKey = x => (x || []).map(p => `${p.type}:${p.value}`).sort().join('|');
  const payChanged = payKey(pay) !== payKey(m.pay_methods);
  if (!pay.length) throw httpError(400, 'أضف طريقة دفع واحدة على الأقل (رقم ليبيانا/المدار/حساب)');
  const patch = {
    name, category, bio: String(body.bio || '').replace(/[<>]/g, '').slice(0, 500), pay_methods: pay,
    ...(payChanged ? { pay_changed_at: nowIso(), pay_history: [{ at: nowIso(), methods: (m.pay_methods || []).map(p => ({ type: p.type || '', label: p.label, value: p.value })) }, ...(Array.isArray(m.pay_history) ? m.pay_history : [])].slice(0, 10) } : {}),
    base_currency: body.base_currency === 'USD' ? 'USD' : body.base_currency === 'LYD' ? 'LYD' : (m.base_currency || 'LYD'),
    pricing_mode: body.pricing_mode === 'manual' ? 'manual' : body.pricing_mode === 'auto' ? 'auto' : (m.pricing_mode === 'manual' ? 'manual' : 'auto'),   // v38: تلقائي بسعر الصرف أو يدوي لكل طريقة
    contacts: cleanContacts(body.contacts), updated_at: nowIso(),
    open: body.open !== false, hours: String(body.hours || '').replace(/[<>]/g, '').slice(0, 80), schedule: cleanSchedule(body.schedule),
    contact_phone: (() => { const p = normalizePhone(body.contact_phone || ''); if (!p) throw httpError(400, 'أدخل رقم تواصل صحيح (ليبيانا أو المدار) — إجباري لتتواصل معك الإدارة'); return '0' + p; })(),
    quick_replies: (Array.isArray(body.quick_replies) ? body.quick_replies : []).map(q => String(q || '').replace(/[<>]/g, '').trim().slice(0, 300)).filter(Boolean).slice(0, 10),
  };
  if (payChanged && (m.pay_methods || []).length) background(alertAdmins(env, 'm_pay_changed_admin', { store: name, now: pay.map(p => `${p.label}: ${p.value}`).join(' · ').slice(0, 200) }));
  if ('logo' in body) patch.logo = cleanImg(body.logo, 120000);
  if ('cover' in body) patch.cover = cleanImg(body.cover, 300000);
  await fsPatch(env, `merchants/${m._id}`, patch);
  await markMerchantDirty(env, m._id);
  return { success: true };
}

async function handleMerchantServiceSave(user, body, env) {
  await assertNotSaving(env);
  const m = await getMyMerchant(env, user.uid);
  const name = String(body.name || '').replace(/[<>]/g, '').trim().slice(0, 60);
  let price = round2(num(body.price, NaN));
  if (!(price > 0) && body.prices && typeof body.prices === 'object') {           // بدون سعر أساسي: نأخذ سعر أول طريقة بالدينار، ثم أول سعر
    const pms = Array.isArray(m.pay_methods) ? m.pay_methods : [];
    const ids = pms.map((p, i) => ({ p, id: p.id || ('pm' + i) }));
    const lyd = ids.find(x => (x.p.currency || PAY_TYPES[x.p.type] || 'د.ل') === 'د.ل' && num(body.prices[x.id], 0) > 0);
    const any = ids.find(x => num(body.prices[x.id], 0) > 0);
    price = round2(num(body.prices[(lyd || any || {}).id], NaN));
  }
  if (name.length < 2) throw httpError(400, 'اسم الخدمة قصير');
  if (!(price > 0) || price > 100000) throw httpError(400, 'السعر غير صالح');
  const fields = (Array.isArray(body.fields) ? body.fields : []).map(f => String(f || '').replace(/[<>]/g, '').trim().slice(0, 40)).filter(Boolean).slice(0, 3);
  if (body.id) { const own = await fsGet(env, `merchant_services/${String(body.id)}`); if (!own || own.mid !== m._id) throw httpError(404, 'الخدمة غير موجودة'); }
  const secId = String(body.section_id || '');
  const sec = secId && await fsGet(env, `merchant_sections/${secId}`);
  if (!sec || sec.mid !== m._id) throw httpError(400, 'اختر القسم الذي تنتمي له الخدمة (أنشئ قسمًا أولًا)');
  body.delivery = 'manual';                                           // v40: التسليم التلقائي متوقف
  // أسعار يدوية لكل طريقة دفع أضافها التاجر: { pmId: amount }
  const prices = {};
  (Array.isArray(m.pay_methods) ? m.pay_methods : []).forEach((pm, i) => {
    const pid = pm.id || ('pm' + i);
    const v = round2(num(body.prices && body.prices[pid], NaN));
    if (body.prices && pid in body.prices) { if (!(v > 0) || v > 1000000) throw httpError(400, `سعر غير صالح لطريقة «${pm.label}»`); prices[pid] = v; }
  });
  if (m.pricing_mode === 'manual') {                                   // v38: الوضع اليدوي — سعر لكل طريقة دفع إلزامي
    const miss = (Array.isArray(m.pay_methods) ? m.pay_methods : []).find((pm, i) => !(prices[pm.id || ('pm' + i)] > 0));
    if (miss) throw httpError(400, `اكتب سعر الخدمة لطريقة «${miss.label}»`);
  }
  const data = { section_id: secId, prices,
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
  await markMerchantDirty(env, m._id);
  return { success: true, id };
}

async function handleMerchantServiceDelete(user, body, env) {
  await assertNotSaving(env);
  const m = await getMyMerchant(env, user.uid);
  const id = String(body.id || '');
  const cur = await fsGet(env, `merchant_services/${id}`);
  if (!cur || cur.mid !== m._id) throw httpError(404, 'الخدمة غير موجودة');
  await fsPatch(env, `merchant_services/${id}`, { active: false, deleted: true, updated_at: nowIso() });
  await fsDelete(env, `merchant_services/${id}`);
  await markMerchantDirty(env, m._id);
  return { success: true };
}

async function handleMerchantStockAdd(user, body, env) {
  throw httpError(400, 'التسليم التلقائي متوقف حاليًا — نفّذ الطلبات يدويًا');
  await assertNotSaving(env);
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
  await markMerchantDirty(env, m._id);
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
      result = { status: 'rejected', after_paid: o.status === 'processing', order: o };
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
  await markMerchantDirty(env, m._id);
  if (result.low_stock) notify(env, m.owner_uid, 'm_low_stock', { service: result.low_stock.name, left: result.low_stock.left, link: 'mstore:services' });
  if (result.status === 'completed') notify(env, customer, 'm_order_done', { service: svcName, store: m.name, link: 'morders' });
  if (result.status === 'processing') notify(env, customer, 'm_order_paid', { service: svcName, store: m.name, link: 'morders' });
  if (result.status === 'rejected' && result.after_paid) {
    const o = result.order, rid = `RP${Date.now()}${randomSuffix(4)}`;
    await fsSet(env, `merchant_reports/${rid}`, { mid: m._id, merchant_name: m.name, merchant_owner: m.owner_uid, uid: o.uid, customer_name: o.customer_name || '', oid,
      reason: 'رفض بعد تأكيد الدفع', text: 'فتح تلقائيًا: التاجر أكّد استلام الدفع ثم رفض الطلب.', messages: [{ by: 'admin', text: 'فتحت كاردو هذا النزاع تلقائيًا لأن الطلب رُفض بعد تأكيد الدفع.', at: nowIso() }],
      status: 'open', auto: true, created_at: nowIso(), updated_at: nowIso() }).catch(() => {});
    background(alertAdmins(env, 'm_report_admin', { store: m.name, reason: 'رفض بعد تأكيد الدفع', text: o.service_name }));
  }
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
    await markMerchantDirty(env, body.id);
    return { success: true, id: body.id };
  }
  const email = String(body.email || '').trim().toLowerCase();
  const rows = await fsQueryStrict(env, { from: [{ collectionId: 'users' }],
    where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: email } } }, limit: 1 });
  if (!rows.length) throw httpError(404, 'لا يوجد مستخدم بهذا البريد — يجب أن يسجّل التاجر في كاردو أولًا');
  const owner = withId(rows[0], 'users');
  if (owner.merchant_id) throw httpError(409, 'هذا المستخدم يملك متجرًا مسبقًا');
  const days = Math.max(1, Math.min(366, Math.floor(num(body.days, 30))));
  const app = await fsGet(env, `merchant_applications/${owner._id}`).catch(() => null);
  const cphone = normalizePhone(body.phone || (app && app.phone) || owner.phone_verified || owner.phone || '');
  const id = `M${Date.now()}${randomSuffix(4)}`;
  await fsSet(env, `merchants/${id}`, {
    owner_uid: owner._id, name, slug, category, bio: '', logo: '', cover: '', pay_methods: [], contacts: {},
    status: 'active', sub_price: subPrice, sub_expires_ms: Date.now() + days * 86400000, featured: body.featured === true, ...billingOf(body, await getSettings(env)),
    commission_from_ms: Date.now() + Math.max(0, Math.floor(num((await getSettings(env)).merchant_free_days, 30))) * 86400000,
    contact_phone: cphone ? '0' + cphone : '', verified: false,
    orders_done: 0, rating_sum: 0, rating_count: 0, created_at: nowIso(), created_by: staff.uid,
  });
  await fsPatch(env, `users/${owner._id}`, { merchant_id: id });
  if (await fsGet(env, `merchant_applications/${owner._id}`)) await fsPatch(env, `merchant_applications/${owner._id}`, { status: 'approved', merchant_id: id, decided_at: nowIso() });
  await logOp(env, staff.uid, 'merchant.create', { id, owner: owner._id, days }, {}, true);
  notify(env, owner._id, 'm_welcome', { store: name, link: 'mstore:home' });
  await markMerchantDirty(env, id);
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
  await markMerchantDirty(env, id);
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
  if (!memAllowWin(`mmsg_${user.uid}`, 60, 3600)) throw httpError(429, 'رسائل كثيرة — انتظر قليلًا');
  await pushThread(env, `merchant_orders/${id}`, who, text);
  const vars = { service: o.service_name, text: text.slice(0, 140) };
  if (who !== 'customer') notify(env, o.uid, 'm_msg', { ...vars, from: who === 'admin' ? 'إدارة كاردو' : o.merchant_name, link: 'morders' });
  if (who !== 'merchant') notify(env, o.merchant_owner, 'm_msg', { ...vars, from: who === 'admin' ? 'إدارة كاردو' : (o.customer_name || 'الزبون'), link: 'mstore:orders' });
  return { success: true };
}
const _reviewsMem = new Map();
async function handleMerchantReviews(user, body, env) {
  const mid = String(body.mid || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
  if (!memAllow('rv:' + user.uid, 20)) throw httpError(429, 'طلبات كثيرة — انتظر قليلًا');
  const hit = _reviewsMem.get(mid);
  if (hit && hit.exp > Date.now()) return hit.v;
  const rows = await fsQueryStrict(env, { from: [{ collectionId: 'merchant_reviews' }],
    where: { fieldFilter: { field: { fieldPath: 'mid' }, op: 'EQUAL', value: { stringValue: mid } } }, limit: 40 });
  const list = rows.map(r => withId(r, 'merchant_reviews')).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 30).map(r => ({ name: r.name, stars: r.stars, text: r.text, service: r.service, at: r.created_at }));
  const out = { success: true, reviews: list };
  _reviewsMem.set(mid, { v: out, exp: Date.now() + 300000 });
  if (_reviewsMem.size > 2000) _reviewsMem.clear();
  return out;
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
  if (!memAllowWin(`rmsg_${user.uid}`, 40, 3600)) throw httpError(429, 'رسائل كثيرة');
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
  if (body.verified !== undefined) { patch.verified = body.verified === true; if (patch.verified && !m.verified_at) patch.verified_at = nowIso(); }
  await fsPatch(env, `merchants/${id}`, patch);
  await logOp(env, staff.uid, 'merchant.promo', { id, ...patch }, {}, true);
  await markMerchantDirty(env, id);
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
  await assertNotSaving(env);
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
  const m = await userNamesMap(env, ids);                 // v51: طلب واحد بدل قراءة لكل مستخدم
  for (const id of ids) { const u = m.get(id); out[id] = u ? String(u.name || u.email || 'مستخدم').slice(0, 60) : ''; }
  return { success: true, names: out };
}


/* ═══ v16 — إشعارات الهاتف (Web Push عبر FCM) ═══ */
async function handlePushRegister(user, body, env) {
  const token = String(body.token || '').trim();
  if (!/^[A-Za-z0-9_:\-]{100,400}$/.test(token)) throw httpError(400, 'رمز إشعارات غير صالح');
  if (!memAllowWin(`push_${user.uid}`, 20, 3600)) throw httpError(429, 'محاولات كثيرة');
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
  await markMerchantDirty(env, st.mid);
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
      await markMerchantDirty(env, st.mid);
      await fsPatch(env, `merchant_statements/${st._id}`, { hold_applied: true });
      await notifyUser(env, st.merchant_owner, 'm_billing_hold', { store: st.merchant_name, amount: st.commission, link: 'mstore:billing' });
    }
  }
}


/* ═══ v20 — أقسام المتجر + محادثات الزبون والتاجر ═══ */
async function handleMerchantSectionSave(user, body, env) {
  await assertNotSaving(env);
  const m = await getMyMerchant(env, user.uid);
  const name = String(body.name || '').replace(/[<>]/g, '').trim().slice(0, 30);
  if (name.length < 2) throw httpError(400, 'اسم القسم قصير');
  const data = { mid: m._id, name, order: Math.max(0, Math.min(999, Math.floor(num(body.order, 0)))), delivery: 'manual', updated_at: nowIso() };   // v40
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
  await markMerchantDirty(env, m._id);
  return { success: true, id };
}
async function handleMerchantSectionDelete(user, body, env) {
  await assertNotSaving(env);
  const m = await getMyMerchant(env, user.uid);
  const id = String(body.id || '');
  const cur = await fsGet(env, `merchant_sections/${id}`);
  if (!cur || cur.mid !== m._id) throw httpError(404, 'القسم غير موجود');
  const sv = await fsQueryStrict(env, { from: [{ collectionId: 'merchant_services' }],
    where: { fieldFilter: { field: { fieldPath: 'section_id' }, op: 'EQUAL', value: { stringValue: id } } }, limit: 1 });
  if (sv.length) throw httpError(409, 'انقل خدمات القسم أو احذفها أولًا');
  await fsDelete(env, `merchant_sections/${id}`);
  await markMerchantDirty(env, m._id);
  return { success: true };
}

async function handleMerchantChat(user, body, env) {
  const text = String(body.text || '').replace(/[<>]/g, '').trim().slice(0, 1000);
  if (!text) throw httpError(400, 'اكتب رسالتك');
  if (!memAllowWin(`mchat_${user.uid}`, 80, 3600)) throw httpError(429, 'رسائل كثيرة — انتظر قليلًا');
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
  bustPublic();
  return { success: true, id };
}
async function handleAdminPlatformDelete(user, body, env) {
  const staff = await requirePermission(user, env, 'stickers.edit');
  const id = String(body.id || '');
  if (!(await fsGet(env, `platforms/${id}`))) throw httpError(404, 'المنصة غير موجودة');
  await fsDelete(env, `platforms/${id}`);
  await logOp(env, staff.uid, 'platform.delete', { id }, {}, true);
  bustPublic();
  return { success: true };
}


/* ═══ v24 — قمع التحويل (عدّ رخيص عبر Aggregation) ═══ */
async function fsCount(env, collectionId, where, forceFs) {
  if (!forceFs && env && env.DB) { try { if (await d1ReadOn(env, collectionId)) return await d1Count(env, collectionId, where); } catch (e) { console.error('D1_COUNT', e.message); if (await d1IsPrimary(env)) return null; } }
  const sq = { from: [{ collectionId }] };
  if (where) sq.where = where;
  const body = { structuredAggregationQuery: { structuredQuery: sq, aggregations: [{ alias: 'n', count: {} }] } };
  let res; try { res = await fsFetch(env, ':runAggregationQuery', { method: 'POST', body: JSON.stringify(body) }); } catch { return null; }
  const row = Array.isArray(res) ? res.find(r => r && r.result) : null;
  return Number(row && row.result && row.result.aggregateFields && row.result.aggregateFields.n && row.result.aggregateFields.n.integerValue || 0);
}
async function handleAdminFunnel(user, body, env) {
  await requirePermission(user, env, 'users.view');
  const f = (field, op, value) => ({ fieldFilter: { field: { fieldPath: field }, op, value } });
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [users, users30, emailOk, phoneOk, deposited, cardsDone, cardOrders] = await Promise.all([
    fsCount(env, 'users'),
    fsCount(env, 'users', f('created_at', 'GREATER_THAN_OR_EQUAL', { stringValue: since })),
    fsCount(env, 'users', f('email_verified', 'EQUAL', { booleanValue: true })),
    fsCount(env, 'users', f('phone_verified', 'GREATER_THAN', { stringValue: '' })),
    fsCount(env, 'wallet_transactions', f('reason', 'IN', { arrayValue: { values: ['deposit', 'sms_deposit', 'manual_deposit', 'deposit_manual', 'usdt_deposit', 'phone_verification_deposit'].map(v => ({ stringValue: v })) } })),
    fsCount(env, 'manual_card_orders', { compositeFilter: { op: 'AND', filters: [f('kind', 'EQUAL', { stringValue: 'create' }), f('status', 'EQUAL', { stringValue: 'completed' })] } }),
    fsCount(env, 'manual_card_orders', f('kind', 'EQUAL', { stringValue: 'create' })),
  ]);
  return { success: true, funnel: { users, users30, emailOk, phoneOk, deposited, cardOrders, cardsDone } };
}


/* ═══ v25 — تطبيق «شهر مجاني ثم نسبة» على كل التجار الحاليين ═══ */
async function handleAdminMerchantsBillingDefault(user, body, env) {
  const staff = await requirePermission(user, env, 'merchants.edit');
  const s = await getSettings(env);
  const pct = Math.min(50, Math.max(0, num(body.pct, num(s.merchant_default_pct, 5))));
  const freeDays = Math.max(0, Math.floor(num(body.free_days, num(s.merchant_free_days, 30))));
  const rows = (await fsQueryStrict(env, { from: [{ collectionId: 'merchants' }], limit: 500 })).map(r => withId(r, 'merchants'));
  let n = 0;
  for (const m of rows) {
    const joined = new Date(m.created_at || Date.now()).getTime() || Date.now();
    await fsPatch(env, `merchants/${m._id}`, { billing_mode: 'percent', commission_pct: pct, commission_from_ms: joined + freeDays * 86400000, updated_at: nowIso() });
    n++;
  }
  await logOp(env, staff.uid, 'merchants.billing_default', { pct, freeDays, n }, {}, true);
  await markMerchantDirty(env, null);
  return { success: true, updated: n, pct, free_days: freeDays };
}


/* ═══ v27 — توفير قراءات Firestore: لقطة المتاجر + كاش Cloudflare المشترك ═══
   • public/merchants_snapshot: نسخة خفيفة من كل المتاجر/الخدمات/الأقسام (الصور روابط لا base64).
   • public/merchants_dirty: معرّفات المتاجر التي تغيّرت — يُعاد بناء جزئها فقط.
   • النتيجة: زيارة المتاجر = قراءة أو اثنتان بدل مئات.                                  */
const SNAP_PATH = 'public/merchants_snapshot', DIRTY_PATH = 'public/merchants_dirty';
let _snapMem = { v: null, exp: 0 }, _lastFullBuild = 0;
function slimMerchant(env, m) {
  const o = { ...m };
  delete o.blocked; delete o.quick_replies; delete o.contact_phone;
  o.logo = m.logo ? mImgRef(env, 'l', m._id, m.logo) : '';
  o.cover = m.cover ? mImgRef(env, 'v', m._id, m.cover) : '';
  o.pay_methods = (Array.isArray(m.pay_methods) ? m.pay_methods.slice(0, 6) : []).map((p, i) => ({ ...p, logo: p.logo ? mImgRef(env, 'q', `${m._id}_${i}`, p.logo) : '' }));
  return o;
}
const slimService = (env, s) => ({ ...s, image: s.image ? mImgRef(env, 'x', s._id, s.image) : '' });
const slimSection = (env, x) => ({ ...x, image: x.image ? mImgRef(env, 'y', x._id, x.image) : '' });
const qEq = (field, v) => ({ fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: v } } });

async function buildMerchantPart(env, mid) {
  const [m, sv, sc] = await Promise.all([
    fsGet(env, `merchants/${mid}`),
    fsQueryStrict(env, { from: [{ collectionId: 'merchant_services' }], where: qEq('mid', mid), limit: 300 }),
    fsQueryStrict(env, { from: [{ collectionId: 'merchant_sections' }], where: qEq('mid', mid), limit: 60 }),
  ]);
  return {
    m: m ? slimMerchant(env, { ...m, _id: mid }) : null,
    s: sv.map(r => withId(r, 'merchant_services')).map(x => slimService(env, x)),
    c: sc.map(r => withId(r, 'merchant_sections')).map(x => slimSection(env, x)),
  };
}
async function buildFullSnapshot(env) {
  const [mRows, sRows, secRows] = await Promise.all([
    fsQueryStrict(env, { from: [{ collectionId: 'merchants' }], limit: 400 }),
    fsQueryStrict(env, { from: [{ collectionId: 'merchant_services' }], limit: 3000 }),
    fsQueryStrict(env, { from: [{ collectionId: 'merchant_sections' }], limit: 1500 }),
  ]);
  return {
    m: mRows.map(r => withId(r, 'merchants')).map(x => slimMerchant(env, x)),
    s: sRows.map(r => withId(r, 'merchant_services')).map(x => slimService(env, x)),
    c: secRows.map(r => withId(r, 'merchant_sections')).map(x => slimSection(env, x)),
  };
}
async function getMerchantsSnapshot(env) {
  if (_snapMem.v && _snapMem.exp > Date.now()) return _snapMem.v;
  const [doc, dirty] = await Promise.all([fsGet(env, SNAP_PATH), fsGet(env, DIRTY_PATH)]);
  let snap = null;
  try { snap = doc && doc.json ? JSON.parse(doc.json) : null; } catch { snap = null; }
  const mids = dirty && Array.isArray(dirty.mids) ? dirty.mids : [];
  let full = !snap || (dirty && dirty.full === true);
  if (full && snap && Date.now() - _lastFullBuild < 600000) full = false;      // حماية من إعادة البناء المتكررة
  if (full) _lastFullBuild = Date.now();
  if (full || mids.length) {
    if (full) snap = await buildFullSnapshot(env);
    else {
      for (const mid of mids.slice(0, 40)) {
        const part = await buildMerchantPart(env, mid);
        snap.m = snap.m.filter(x => x._id !== mid); if (part.m) snap.m.push(part.m);
        snap.s = snap.s.filter(x => x.mid !== mid).concat(part.s);
        snap.c = snap.c.filter(x => x.mid !== mid).concat(part.c);
      }
    }
    const json = JSON.stringify(snap);
    await fsSet(env, SNAP_PATH, { json, built_at: nowIso() }).catch(e => console.error('SNAP_SAVE', e.message));
    await fsSet(env, DIRTY_PATH, { mids: [], full: false, at: nowIso() }).catch(() => {});
  }
  _snapMem = { v: snap, exp: Date.now() + 60000 };
  return snap;
}
// تُستدعى بعد أي تغيير في متجر/خدماته/أقسامه (كتابة واحدة، بلا قراءات كثيرة)
async function markMerchantDirty(env, mid) {
  _snapMem = { v: null, exp: 0 };
  for (const [k, v] of _meCache) if (!mid || v.mid === mid) _meCache.delete(k);
  try {
    await fsRunTransaction(env, async (tx) => {
      const d = await tx.get(DIRTY_PATH);
      const mids = d && Array.isArray(d.mids) ? d.mids : [];
      const next = mid ? [...new Set([...mids, String(mid)])].slice(0, 200) : mids;
      if (d) tx.update(DIRTY_PATH, { mids: next, full: d.full === true || !mid || next.length >= 200, at: nowIso() });
      else tx.create('public', 'merchants_dirty', { mids: next, full: !mid, at: nowIso() });
    });
  } catch (e) { console.error('MARK_DIRTY', e.message); }
  bustPublic();
}

// كاش Cloudflare المشترك لكل الزوار (لا يصل لـ Firestore) + نسخة احتياطية تُستخدم إذا رفض Firestore (حصة منتهية)
const PUB_TTL = { '/api/reviews': 300, '/api/howto': 600, '/api/rsc/catalog': 120, '/api/status': 60, '/api/platforms': 600, '/api/merchants/list': 180, '/api/catalog': 300, '/api/services/list': 300 };
const edgeKey = (p, stale) => new Request(`https://kardo-edge.cache${stale ? '/stale' : ''}${p}`);
async function edgeGet(p, stale) {
  if (typeof caches === 'undefined') return null;
  try { const r = await caches.default.match(edgeKey(p, stale)); return r ? await r.json() : null; } catch { return null; }
}
async function edgePut(p, v) {
  if (typeof caches === 'undefined') return;
  try {
    const body = JSON.stringify(v);
    await caches.default.put(edgeKey(p, false), new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${PUB_TTL[p] || 60}` } }));
    await caches.default.put(edgeKey(p, true), new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=172800' } }));
  } catch {}
}
function bustPublic() {
  _pubCache.clear();
  if (typeof caches === 'undefined') return;
  Object.keys(PUB_TTL).forEach(p => { try { caches.default.delete(edgeKey(p, false)).catch(() => {}); } catch {} });
}

// للاختبارات والطوارئ: إعادة بناء كاملة للّقطة في الطلب التالي
async function resetMerchantsSnapshot(env) { _snapMem = { v: null, exp: 0 }; _lastFullBuild = 0; _meCache.clear(); await fsSet(env, DIRTY_PATH, { mids: [], full: true, at: nowIso() }); }


/* ═══ v27 — عدّاد قراءات تقديري + وضع التوفير ═══
   يعدّ قراءات الخادم فقط (شاشات المتصفح تقرأ مباشرة ولا تُحسب هنا)، ويُحفظ كل 400 قراءة.  */
let _readsPending = 0, _quotaHitAt = 0, _usageMem = { v: null, exp: 0 };
// v35: يوم حصة Firebase يبدأ منتصف الليل بتوقيت المحيط الهادئ (09:00 أو 10:00 بتوقيت ليبيا) — لا منتصف ليل UTC
function fbDay(t = Date.now()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t)); }
  catch { return new Date(t - 8 * 3600000).toISOString().slice(0, 10); }
}
const usagePath = () => `public/usage_${fbDay()}`;
function countReads(n) {
  _readsPending += n;
  if (_readsPending >= 400 && typeof _flushingUsage === 'undefined') background(flushUsage());
}
var _flushingUsage;
async function flushUsage() {
  const n = _readsPending; if (!n) return;
  if (d1IsPrimaryCached()) { _readsPending = 0; return; }                    // v35: بعد التحويل لا قراءات Firestore تُحسب
  _readsPending = 0; _flushingUsage = true;
  try {
    const p = usagePath();
    const cur = await fsGetRaw(p);
    await fsSetRaw(p, { reads: num(cur && cur.reads, 0) + n, at: nowIso() });
  } catch (e) { _readsPending += n; } finally { _flushingUsage = undefined; }
}
// قراءة/كتابة بدون تمريرها بالعدّاد (لتفادي حلقة لا نهائية)
let _envForUsage = null;
async function fsGetRaw(path) { const e = _envForUsage; if (!e) return null; const token = await getAccessToken(e);
  const r = await fetch(`${FS_BASE}/projects/${e.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) return null; const d = await r.json().catch(() => null); return d ? fromFsFields(d.fields || {}) : null; }
async function fsSetRaw(path, data) { const e = _envForUsage; if (!e) return; return fsCommit(e, [write(e, path, data)]); }
async function usageToday(env) {
  if (_usageMem.v !== null && _usageMem.exp > Date.now()) return _usageMem.v;
  _envForUsage = env;
  const d = await fsGetRaw(usagePath()).catch(() => null);
  _usageMem = { v: num(d && d.reads, 0) + _readsPending, exp: Date.now() + 120000 };
  return _usageMem.v;
}
async function savingMode(env) {
  if (await d1IsPrimary(env)) return false;                                  // v35: D1 أساسي → لا وضع توفير
  const s = await getSettings(env);
  if (_quotaHitAt && Date.now() - _quotaHitAt < 3600000) return true;
  return (await usageToday(env)) >= num(s.quota_save_at, 25000);
}
async function assertNotSaving(env) {
  if (await savingMode(env)) throw httpError(503, 'التعديلات متوقفة مؤقتًا لضغط الاستخدام اليوم — تعود تلقائيًا غدًا. الطلبات والمدفوعات تعمل عاديًا.');
}
async function handleAdminUsage(user, body, env) {
  await requirePermission(user, env, 'users.view');
  const s = await getSettings(env);
  _usageMem = { v: null, exp: 0 };
  if (await d1IsPrimary(env)) return { success: true, reads: 0, save_at: num(s.quota_save_at, 25000), saving: false, quota_hit: false, d1_primary: true };
  return { success: true, reads: await usageToday(env), save_at: num(s.quota_save_at, 25000), saving: await savingMode(env), quota_hit: !!(_quotaHitAt && Date.now() - _quotaHitAt < 3600000) };
}


/* ═══ v28 — تقوية أمنية: محدّدات رخيصة بالذاكرة، تحقق معرّفات الصور، تنبيهات الإدارة ═══ */
const _mem = new Map();
function memAllow(key, perMin) {
  const b = Math.floor(Date.now() / 60000), k = key + ':' + b;
  const c = (_mem.get(k) || 0) + 1; _mem.set(k, c);
  if (_mem.size > 20000) for (const kk of _mem.keys()) if (!kk.endsWith(':' + b)) _mem.delete(kk);
  return c <= perMin;
}
function memAllowWin(key, limit, sec) {
  const b = Math.floor(Date.now() / (sec * 1000)), k = `w:${key}:${sec}:${b}`;
  const c = (_mem.get(k) || 0) + 1; _mem.set(k, c);
  return c <= limit;
}
function ipAllow(request, scope, perMin) {
  const ip = request.headers.get('cf-connecting-ip') || '';
  return !ip || memAllow(`ip:${scope}:${ip}`, perMin);
}
let _platIds = { v: null, exp: 0 };
async function imageIdKnown(env, kind, id) {
  if (kind === 's') return STICKER_SLOTS.includes(id);
  if (kind === 'b') return /^\d$/.test(id);
  if (kind === 'p' || kind === 'c') return (await getSettings(env)).kardo_store_on === true;
  if (kind === 'g') {
    if (!_platIds.v || _platIds.exp < Date.now()) {
      const rows = await fsQueryStrict(env, { from: [{ collectionId: 'platforms' }], limit: 60 }).catch(() => []);
      _platIds = { v: new Set(rows.map(r => withId(r, 'platforms')._id)), exp: Date.now() + 600000 };
    }
    return _platIds.v.has(id);
  }
  const snap = await getMerchantsSnapshot(env).catch(() => null);
  if (!snap) return false;
  if (kind === 'l' || kind === 'v') return snap.m.some(x => x._id === id);
  if (kind === 'q') { const k = id.lastIndexOf('_'); const idx = Number(id.slice(k + 1)); return k > 0 && idx >= 0 && idx < 6 && snap.m.some(x => x._id === id.slice(0, k)); }
  if (kind === 'x') return snap.s.some(x => x._id === id);
  if (kind === 'y') return snap.c.some(x => x._id === id);
  return false;
}
async function alertAdmins(env, kind, vars) {
  const admins = await fsQueryRaw(env, { from: [{ collectionId: 'admins' }], limit: 50 }).catch(() => []);
  for (const a of admins.map(r => withId(r, 'admins')).filter(a => a.role === 'super_admin')) await notifyUser(env, a._id, kind, vars).catch(() => {});
}


/* ═══ v31 — كاش يعمل فعلًا على workers.dev: ذاكرة + KV اختياري (Cache API لا يعمل هناك) ═══ */
async function kvGetJSON(env, key) {
  if (!env || !env.KV) return null;
  try { const v = await env.KV.get(key, 'json'); return v || null; } catch { return null; }
}
function kvPutJSON(env, key, val, ttl) {
  if (!env || !env.KV) return;
  try { background(env.KV.put(key, JSON.stringify(val), { expirationTtl: Math.max(60, ttl || 300) }).catch(() => {})); } catch {}
}
const _imgMem = new Map(); let _imgMemBytes = 0;
function imgMemPut(k, bytes, type) {
  if (!bytes || bytes.length > 400000) return;
  if (_imgMem.has(k)) return;
  _imgMem.set(k, { bytes, type }); _imgMemBytes += bytes.length;
  while (_imgMemBytes > 24e6 && _imgMem.size) { const [fk, fv] = _imgMem.entries().next().value; _imgMem.delete(fk); _imgMemBytes -= fv.bytes.length; }
}
function imgResponse(bytes, type) {
  return new Response(bytes, { headers: { 'content-type': type, 'cache-control': 'public, max-age=604800, immutable',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*' } });
}


/* ═══ v33 — إيداع رقمي تلقائي على 4 شبكات: TRC20 · BEP20 · Polygon · Binance Pay ═══
   كل فاتورة لها مبلغ فريد (4 خانات)، ونبحث عن تحويل وارد بنفس المبلغ داخل مهلة الفاتورة.
   v34 — مراجعة مقابل التوثيق الرسمي:
   • مهلة 9 ثوانٍ لكل طلب شبكة (كان بلا مهلة).
   • TRC20: only_confirmed=true + min_timestamp (TronGrid)، ومفتاح TRONGRID_API_KEY اختياري.
   • BEP20/Polygon: مدى الكتل يُحسب من الطوابع الزمنية الفعلية للكتل (زمن كتلة BSC تغيّر)، بعد تأكيدات،
     ومقسّم لقطع ≤ 2000 كتلة (حدود eth_getLogs في العُقد العامة)، مع تجاهل السجلات removed.
   • Binance Pay: GET /sapi/v1/pay/transactions موقّع HMAC-SHA256، مع استبعاد الاسترجاعات، ونطاق زمني صحيح،
     وكاش 15 ثانية (وزن الطلب 3000)، وتبديل خوادم بايننس عند 451/5xx.
   • عنوان إيداع بايننس على TRC20/BEP20/Polygon: التحويل من حساب بايننس آخر يكون داخليًا (لا يظهر على الشبكة)،
     لذا نبحث أيضًا في سجل إيداعات بايننس (GET /sapi/v1/capital/deposit/hisrec) إن كان المفتاح مضبوطًا.       */
const EVM_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const CRYPTO_NETS = {
  trc20:       { label: 'USDT TRC20', onKey: 'm_usdt_on', addrKey: 'usdt_address', addrRe: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, bnNets: ['TRX'] },
  bep20:       { label: 'USDT BEP20', onKey: 'usdt_bep20_on', addrKey: 'usdt_bep20_address', addrRe: /^0x[0-9a-fA-F]{40}$/, bnNets: ['BSC'],
                 token: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, chainId: '0x38', conf: 5, chunk: 2000, maxScan: 12000, rpcEnv: 'BSC_RPC',
                 rpcs: ['https://bsc-rpc.publicnode.com', 'https://bsc.drpc.org', 'https://bsc-dataseed.bnbchain.org'] },
  polygon:     { label: 'USDT Polygon', onKey: 'usdt_polygon_on', addrKey: 'usdt_polygon_address', addrRe: /^0x[0-9a-fA-F]{40}$/, bnNets: ['MATIC', 'POLYGON', 'POL'],
                 token: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6, chainId: '0x89', conf: 10, chunk: 2000, maxScan: 6000, rpcEnv: 'POLYGON_RPC',
                 rpcs: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org', 'https://polygon-rpc.com'] },
  binance_pay: { label: 'Binance Pay', onKey: 'binance_pay_on', addrKey: 'binance_pay_id', addrRe: /^\d{5,15}$/ },
};
function cryptoErr(code, detail) { const e = new Error(code); e.code = code; e.detail = String(detail || '').slice(0, 160); return e; }
async function cFetch(url, init = {}, ms = 9000) {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(ms) }); }
  catch (e) { throw cryptoErr(e && e.name === 'TimeoutError' ? 'timeout' : 'network', e && e.message); }
}
const rpcList = (env, net) => [...String(env[net.rpcEnv] || '').split(',').map(x => x.trim()).filter(x => /^https:\/\//.test(x)), ...net.rpcs];
function evmClient(rpc) {
  return async (method, params) => {
    const r = await cFetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (!r.ok) throw cryptoErr('rpc_http_' + r.status);
    const j = await r.json().catch(() => null);
    if (!j) throw cryptoErr('rpc_bad_json');
    if (j.error) throw cryptoErr('rpc_error', j.error.message || JSON.stringify(j.error));
    return j.result;
  };
}
const usdtAmt = (raw, decimals) => Number(BigInt(raw || '0x0') / (10n ** BigInt(decimals - 4))) / 1e4;   // 4 خانات بدقة

async function trc20Find(env, address, want, since, until) {
  const close = v => Math.abs(v - want) < 0.00005;
  const url = `${TRON_API}/v1/accounts/${address}/transactions/trc20?limit=100&only_to=true&only_confirmed=true&contract_address=${USDT_TRC20}&min_timestamp=${Math.max(0, Math.floor(since))}`;
  const headers = { accept: 'application/json' };
  if (env.TRONGRID_API_KEY) headers['TRON-PRO-API-KEY'] = env.TRONGRID_API_KEY;
  const r = await cFetch(url, { headers });
  if (!r.ok) throw cryptoErr('trongrid_' + r.status);
  const data = await r.json().catch(() => null);
  if (!data || data.success === false) throw cryptoErr('trongrid_bad', data && data.error);
  const t = (Array.isArray(data.data) ? data.data : []).find(t => {
    const ts = Number(t.block_timestamp || 0);
    return t.to === address && t.token_info && t.token_info.address === USDT_TRC20 && (!t.type || t.type === 'Transfer')
      && ts >= since && ts <= until && close(Number(t.value || 0) / 1e6);
  });
  return t ? { txid: String(t.transaction_id), amount: Number(t.value) / 1e6, from: t.from } : null;
}

async function evmFind(env, network, address, want, since, until) {
  const net = CRYPTO_NETS[network], close = v => Math.abs(v - want) < 0.00005;
  const toTopic = '0x000000000000000000000000' + address.slice(2).toLowerCase();
  let lastErr = null;
  for (const rpc of rpcList(env, net)) {
    try {
      const call = evmClient(rpc);
      const latest = parseInt(await call('eth_blockNumber', []), 16);
      const safe = latest - net.conf;
      const [bA, bB] = await Promise.all([call('eth_getBlockByNumber', ['0x' + safe.toString(16), false]), call('eth_getBlockByNumber', ['0x' + (safe - 1000).toString(16), false])]);
      if (!bA || !bB) throw cryptoErr('rpc_no_block');
      const tA = parseInt(bA.timestamp, 16), tB = parseInt(bB.timestamp, 16);
      const spb = Math.max(0.05, (tA - tB) / 1000);                                  // ثوانٍ لكل كتلة (فعليًا)
      let from = safe - Math.ceil(Math.max(0, tA - since / 1000) / spb) - 30;
      let to = until < tA * 1000 ? safe - Math.floor((tA - until / 1000) / spb) + 30 : safe;
      to = Math.min(to, safe); from = Math.max(0, from, safe - net.maxScan);
      if (to < from) return null;
      for (let end = to; end >= from; end -= net.chunk) {                            // الأحدث أولًا
        const start = Math.max(from, end - net.chunk + 1);
        const logs = await call('eth_getLogs', [{ fromBlock: '0x' + start.toString(16), toBlock: '0x' + end.toString(16), address: net.token, topics: [EVM_TRANSFER, null, toTopic] }]);
        for (const lg of (Array.isArray(logs) ? logs : [])) {
          if (lg.removed === true || String(lg.address || '').toLowerCase() !== net.token.toLowerCase()) continue;
          const amt = usdtAmt(lg.data, net.decimals);
          if (close(amt)) return { txid: String(lg.transactionHash), amount: amt, from: '0x' + String(lg.topics[1] || '').slice(-40) };
        }
      }
      return null;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || cryptoErr('rpc_unavailable');
}

/* ─── بايننس: طلب موقّع (القراءة فقط) ─── */
const BN_HOSTS = ['https://api.binance.com', 'https://api-gcp.binance.com', 'https://api1.binance.com', 'https://api2.binance.com'];
const binanceReady = env => !!(env.BINANCE_API_KEY && env.BINANCE_API_SECRET);
async function binanceSigned(env, path, params = {}) {
  if (!binanceReady(env)) throw cryptoErr('binance_keys');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(env.BINANCE_API_SECRET).trim()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  let last = null;
  for (const host of BN_HOSTS) {
    const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), recvWindow: '10000', timestamp: String(Date.now()) }).toString();
    const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(qs)))].map(b => b.toString(16).padStart(2, '0')).join('');
    let r;
    try { r = await cFetch(`${host}${path}?${qs}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': String(env.BINANCE_API_KEY).trim() } }); }
    catch (e) { last = e; continue; }
    const j = await r.json().catch(() => null);
    if (r.status === 451 || r.status === 403 && !(j && j.code)) { last = cryptoErr('binance_' + r.status); continue; }   // موقع خادم محظور / جدار حماية
    if (r.status >= 500 || r.status === 429 || r.status === 418) { last = cryptoErr('binance_' + r.status); continue; }
    if (!r.ok || !j) throw cryptoErr('binance_' + ((j && j.code) || r.status), j && (j.msg || j.message));
    if (typeof j.code === 'number' && j.code < 0) throw cryptoErr('binance_' + j.code, j.msg);
    if (typeof j.code === 'string' && j.code !== '000000') throw cryptoErr('binance_' + j.code, j.message || j.errorMessage);
    return j;
  }
  throw last || cryptoErr('binance_unreachable');
}
let _bnPay = { at: 0, v: null, h: 0 }, _bnDep = { at: 0, v: null, h: 0 };
async function binancePayRecent(env, hours = 26) {
  if (_bnPay.v && _bnPay.h >= hours && Date.now() - _bnPay.at < 15000) return _bnPay.v;
  const j = await binanceSigned(env, '/sapi/v1/pay/transactions', { startTime: Date.now() - hours * 3600000, endTime: Date.now(), limit: 100 });
  _bnPay = { at: Date.now(), v: Array.isArray(j.data) ? j.data : [], h: hours };
  return _bnPay.v;
}
async function binanceDepositsRecent(env, hours = 26) {
  if (_bnDep.v && _bnDep.h >= hours && Date.now() - _bnDep.at < 15000) return _bnDep.v;
  const j = await binanceSigned(env, '/sapi/v1/capital/deposit/hisrec', { coin: 'USDT', startTime: Date.now() - hours * 3600000, endTime: Date.now(), limit: 1000 });
  _bnDep = { at: Date.now(), v: Array.isArray(j) ? j : [], h: hours };
  return _bnDep.v;
}
async function binancePayFind(env, want, since, until) {
  const close = v => Math.abs(v - want) < 0.00005;
  const t = (await binancePayRecent(env)).find(t => String(t.currency || '').toUpperCase() === 'USDT' && Number(t.amount) > 0
    && !/REFUND|_RF$/i.test(String(t.orderType || ''))
    && Number(t.transactionTime || 0) >= since && Number(t.transactionTime || 0) <= until && close(Number(t.amount)));
  if (!t) return null;
  const txid = String(t.transactionId || t.orderId || '').replace(/[^0-9A-Za-z_-]/g, '').slice(0, 80);
  return { txid, amount: Number(t.amount), from: String((t.payerInfo && (t.payerInfo.name || t.payerInfo.binanceId)) || '') };
}
async function binanceDepositFind(env, network, address, want, since, until) {
  const net = CRYPTO_NETS[network], close = v => Math.abs(v - want) < 0.00005;
  const same = a => network === 'trc20' ? String(a || '') === address : String(a || '').toLowerCase() === address.toLowerCase();
  const d = (await binanceDepositsRecent(env)).find(d => String(d.coin || '').toUpperCase() === 'USDT' && net.bnNets.includes(String(d.network || '').toUpperCase())
    && (Number(d.status) === 1 || Number(d.status) === 6) && same(d.address) && !d.addressTag
    && Number(d.insertTime || 0) >= since && Number(d.insertTime || 0) <= until && close(Number(d.amount)));
  if (!d) return null;
  const tx = String(d.txId || '');
  const onChain = /^(0x)?[0-9a-fA-F]{64}$/.test(tx);
  return { txid: onChain ? tx : 'bn' + String(d.id || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 60), amount: Number(d.amount), from: onChain ? '' : 'Binance (تحويل داخلي)' };
}

async function findCryptoPayment(env, network, address, want, since, until) {
  if (network === 'binance_pay') return binancePayFind(env, want, since, until);
  if (!CRYPTO_NETS[network]) return null;
  let hit = null, chainErr = null;
  try { hit = network === 'trc20' ? await trc20Find(env, address, want, since, until) : await evmFind(env, network, address, want, since, until); }
  catch (e) { chainErr = e; }
  if (!hit && binanceReady(env)) {                       // عنوان بايننس: التحويلات الداخلية لا تظهر على الشبكة
    try { hit = await binanceDepositFind(env, network, address, want, since, until); }
    catch (e) { if (chainErr) throw chainErr; console.error('BINANCE_DEPOSIT_CHECK', e.code || e.message); }
  }
  if (!hit && chainErr) throw chainErr;
  return hit;
}

/* ─── زر «اختبار الاتصال» في لوحة الإدارة (لا يعرض أي مفتاح) ─── */
function cryptoErrAr(e) {
  const c = String((e && e.code) || (e && e.message) || '');
  const map = {
    binance_keys: 'المفتاحان BINANCE_API_KEY و BINANCE_API_SECRET غير موجودين في Cloudflare (Secrets)',
    'binance_-2015': 'بايننس رفض المفتاح: إما المفتاح خاطئ، أو صلاحية «القراءة» غير مفعّلة، أو عليه تقييد IP',
    'binance_-2014': 'صيغة BINANCE_API_KEY خاطئة — انسخه كاملًا بلا مسافات',
    'binance_-1022': 'التوقيع خاطئ — BINANCE_API_SECRET غير صحيح (انسخه كاملًا بلا مسافات)',
    'binance_-1021': 'فرق في الوقت بين الخادم وبايننس — أعد المحاولة',
    'binance_-2008': 'المفتاح غير موجود في حساب بايننس (حُذف؟)',
    binance_451: 'بايننس رفض موقع خادم Cloudflare (منطقة محظورة) — أعد المحاولة لاحقًا',
    binance_403: 'جدار حماية بايننس رفض الطلب مؤقتًا — أعد المحاولة بعد دقائق',
    binance_429: 'طلبات كثيرة لبايننس — انتظر دقيقة', binance_418: 'بايننس حظر الطلبات مؤقتًا — انتظر',
    timeout: 'انتهت مهلة الاتصال (9 ثوانٍ)', network: 'تعذّر الوصول للخادم',
  };
  if (map[c]) return map[c];
  if (/^binance_02/.test(c) || /^binance_4/.test(c)) return 'بايننس رفض الطلب (' + c.replace('binance_', '') + ')' + (e.detail ? ': ' + e.detail : '');
  if (/^rpc_error/.test(c)) return 'العقدة رفضت الاستعلام' + (e.detail ? ': ' + e.detail.slice(0, 90) : '');
  if (/^rpc_http_/.test(c)) return 'العقدة ردّت بخطأ ' + c.slice(9);
  if (/^trongrid_/.test(c)) return 'TronGrid ردّ بخطأ ' + c.slice(9);
  return 'خطأ: ' + c.slice(0, 60);
}
async function handleAdminCryptoTest(user, body, env) {
  await requirePermission(user, env, 'settings.manage');
  if (!memAllowWin(`ctest_${user.uid}`, 20, 600)) throw httpError(429, 'محاولات كثيرة — انتظر دقائق');
  const network = String(body.network || '');
  const net = CRYPTO_NETS[network];
  if (!net) throw httpError(400, 'شبكة غير معروفة');
  const s = await getSettings(env);
  const address = String(s[net.addrKey] || '').trim();
  const lines = [], add = (ok, text) => lines.push({ ok, text });
  if (!net.addrRe.test(address)) add(false, network === 'binance_pay' ? 'Pay ID غير محفوظ أو غير صالح (أرقام فقط) — احفظه أولًا' : 'العنوان غير محفوظ أو صيغته خاطئة — احفظه أولًا');
  else add(true, (network === 'binance_pay' ? 'Pay ID' : 'العنوان') + ' محفوظ وصيغته صحيحة');
  const onKey = network === 'trc20' ? s.m_usdt_on === true : s[net.onKey] === true && s.m_usdt_on === true;
  add(onKey, onKey ? 'الطريقة مفعّلة وتظهر للعملاء' : 'الطريقة غير ظاهرة للعملاء (المفتاح مطفأ' + (network !== 'trc20' ? ' أو مفتاح USDT العام مطفأ' : '') + ')');

  if (network === 'trc20' && net.addrRe.test(address)) {
    try {
      const t0 = Date.now();
      const r = await cFetch(`${TRON_API}/v1/accounts/${address}/transactions/trc20?limit=1&only_to=true&only_confirmed=true&contract_address=${USDT_TRC20}`, { headers: { accept: 'application/json', ...(env.TRONGRID_API_KEY ? { 'TRON-PRO-API-KEY': env.TRONGRID_API_KEY } : {}) } });
      if (!r.ok) throw cryptoErr('trongrid_' + r.status);
      const j = await r.json(); const t = (j.data || [])[0];
      add(true, `TronGrid يعمل ✓ (${Date.now() - t0}ms)` + (t ? ` — آخر وارد: ${Number(t.value) / 1e6} USDT` : ' — لا تحويلات واردة بعد'));
    } catch (e) { add(false, 'TronGrid: ' + cryptoErrAr(e)); }
  }
  if ((network === 'bep20' || network === 'polygon') && net.addrRe.test(address)) {
    let any = false;
    for (const rpc of rpcList(env, net)) {
      const host = rpc.replace(/^https:\/\//, '').split('/')[0];
      try {
        const t0 = Date.now(), call = evmClient(rpc);
        const chain = await call('eth_chainId', []);
        if (String(chain).toLowerCase() !== net.chainId) throw cryptoErr('rpc_error', 'شبكة خاطئة ' + chain);
        const latest = parseInt(await call('eth_blockNumber', []), 16);
        await call('eth_getLogs', [{ fromBlock: '0x' + (latest - 500).toString(16), toBlock: '0x' + latest.toString(16), address: net.token, topics: [EVM_TRANSFER, null, '0x000000000000000000000000' + address.slice(2).toLowerCase()] }]);
        any = true; add(true, `${host} يعمل ✓ (${Date.now() - t0}ms)`);
      } catch (e) { add(null, `${host}: ${cryptoErrAr(e)}`); }
    }
    if (!any) add(false, 'كل العُقد فشلت — لن تُكتشف المدفوعات على الشبكة');
  }
  if (network === 'binance_pay' || binanceReady(env)) {
    if (!binanceReady(env)) add(false, cryptoErrAr({ code: 'binance_keys' }));
    else {
      try {
        const rs = await binanceSigned(env, '/sapi/v1/account/apiRestrictions');
        if (rs.enableReading !== true) add(false, 'صلاحية «القراءة» غير مفعّلة على المفتاح');
        else add(true, 'مفتاح بايننس صحيح وصلاحية القراءة مفعّلة ✓');
        const extra = [['enableSpotAndMarginTrading', 'التداول'], ['enableWithdrawals', 'السحب'], ['enableInternalTransfer', 'التحويل الداخلي'], ['enableMargin', 'الهامش'], ['enableFutures', 'العقود'], ['permitsUniversalTransfer', 'التحويل الشامل'], ['enableVanillaOptions', 'الخيارات']].filter(([k]) => rs[k] === true).map(([, t]) => t);
        if (extra.length) add(false, '⚠️ صلاحيات زائدة خطيرة: ' + extra.join('، ') + ' — عطّلها فورًا من بايننس');
        add(null, rs.ipRestrict ? 'المفتاح مقيّد بـ IP — قد يرفض Cloudflare (عناوينه متغيرة)' : 'بلا تقييد IP (طبيعي مع Cloudflare؛ آمن لأنه قراءة فقط)');
      } catch (e) { add(false, 'بايننس: ' + cryptoErrAr(e)); }
      if (network === 'binance_pay') {
        try { _bnPay.at = 0; const list = await binancePayRecent(env); add(true, `سجل Binance Pay يعمل ✓ — ${list.length} عملية آخر 3 ساعات`); }
        catch (e) { add(false, 'Binance Pay: ' + cryptoErrAr(e)); }
      } else {
        try { _bnDep.at = 0; const list = await binanceDepositsRecent(env); add(true, `سجل إيداعات بايننس يعمل ✓ — يدعم التحويلات الداخلية من حسابات بايننس (${list.length} إيداع USDT آخر 3 ساعات)`); }
        catch (e) { add(null, 'سجل إيداعات بايننس: ' + cryptoErrAr(e) + ' (يكفي إن كان العنوان محفظة خارجية)'); }
      }
    }
  }
  const ok = lines.every(l => l.ok !== false);
  return { success: true, ok, network, label: net.label, lines };
}


/* ═══════════════════════════════════════════════════════════
   v35 — النقل الكامل إلى Cloudflare D1
   1) قبل التحويل: Firestore أساسي + كل كتابة تُنسخ لـ D1 (كل المجموعات) + نسخ تدريجي + مطابقة.
   2) زر «التحويل الكامل»: بعد 90 ثانية يصبح D1 أساسيًا لكل القراءة والكتابة والمعاملات المالية.
      حول لحظة التحويل نافذة تجميد قصيرة: أي كتابة تنتظر ثوانيَ ثم تُكمل (لا ضياع، ولا تضارب أرصدة).
   3) بعد التحويل: Firestore نسخة احتياطية فقط (صندوق صادر مرتّب) — والرجوع ممكن بضغطة بعد فراغه.
   4) Firebase Auth يبقى كما هو.
   ═══════════════════════════════════════════════════════════ */
const D1_PHASE1 = ['notifications', 'merchant_chats', 'merchant_sections', 'merchant_services', 'merchants', 'merchant_reviews'];
const D1_GEN = ['uid', 'status', 'mid', 'merchant_owner', 'owner_uid', 'created_at', 'updated_at', 'slug', 'section_id', 'sid', 'service_id', 'pid', 'kind',
  'read', 'used', 'is_used', 'expires_ms', 'sender', 'email', 'parent', 'cat', 'claim_phone', 'proof_hash', 'k'];
const D1_IDX = {
  notifications: [['uid', 'created_at'], ['uid', 'read']], merchant_chats: [['uid', 'updated_at'], ['merchant_owner', 'updated_at'], ['mid']],
  merchant_sections: [['mid']], merchant_services: [['mid'], ['section_id']], merchants: [['owner_uid'], ['slug'], ['status']],
  merchant_reviews: [['mid', 'created_at'], ['uid']], users: [['created_at'], ['email']], wallet_transactions: [['uid', 'created_at']],
  wallet_deposits: [['uid'], ['status'], ['created_at'], ['proof_hash']], withdrawals: [['uid'], ['status'], ['created_at']],
  manual_cards: [['uid'], ['created_at']], manual_card_orders: [['uid'], ['created_at'], ['status']], orders: [['uid'], ['created_at']],
  service_orders: [['uid'], ['created_at']], merchant_orders: [['uid'], ['merchant_owner'], ['mid'], ['status']],
  merchant_reports: [['uid'], ['merchant_owner'], ['created_at']], merchant_statements: [['merchant_owner'], ['mid'], ['status']],
  merchant_applications: [['status']], merchant_stock: [['sid', 'used']], stock: [['pid', 'used']], service_stock: [['service_id', 'is_used']],
  tickets: [['uid'], ['updated_at'], ['status']], sms_transactions: [['created_at'], ['sender'], ['status']], audit_log: [['created_at']], products: [['cat']],
  categories: [['parent']], coupon_uses: [['uid']], plan_orders: [['uid']], transfers: [['uid']], usdt_invoices: [['uid'], ['status'], ['created_at']], ref_codes: [['uid']],
  rsc_orders: [['uid'], ['status'], ['created_at']], crypto_unmatched: [['status']], reviews: [['status'], ['created_at']],
  rate_limits: [], idempotency: [], otp_codes: [], otp_waits: [], email_codes: [], card_cvv_once: [], manual_card_reveal: [], public: [], settings: [],
  admins: [], stickers: [], platforms: [], daily_counters: [], usdt_amounts: [], usdt_txids: [], phone_bindings: [], phone_owners: [], phone_verifications: [['status']],
};
const D1_IDX_DEFAULT = [['uid'], ['created_at']];
const D1_PAGE = { merchants: 25, merchant_services: 50, merchant_sections: 50, settings: 2, public: 2, stickers: 10, platforms: 25, products: 50, categories: 100, services: 50, merchant_chats: 100 };
const D1_KNOWN = Object.keys(D1_IDX);
const D1_SAFETY = 3000;
const D1_CAPS = [8000, 15000, 25000];
const D1_LABEL = { notifications: 'الإشعارات', merchant_chats: 'المحادثات', merchant_sections: 'الأقسام', merchant_services: 'الخدمات', merchants: 'المتاجر',
  merchant_reviews: 'التقييمات', users: 'المستخدمون', wallet_transactions: 'سجل المحفظة', wallet_deposits: 'الإيداعات', withdrawals: 'السحوبات',
  manual_cards: 'البطاقات', manual_card_orders: 'طلبات البطاقات', orders: 'طلبات المتجر', service_orders: 'طلبات الخدمات', merchant_orders: 'طلبات المتاجر',
  tickets: 'التذاكر', sms_transactions: 'رسائل التحويل', audit_log: 'سجل التدقيق', settings: 'الإعدادات', admins: 'الموظفون', products: 'المنتجات',
  categories: 'الأقسام (المتجر)', coupons: 'الكوبونات', usdt_invoices: 'فواتير USDT', merchant_statements: 'كشوف المتاجر' };
const d1CollOk = c => typeof c === 'string' && /^[a-z][a-z0-9_]{0,48}$/.test(c) && !c.startsWith('_d1') && !c.startsWith('_fs');
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));

function d1SchemaSql() {
  return [
    'CREATE TABLE IF NOT EXISTS _d1_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL DEFAULT 0)',
    'CREATE TABLE IF NOT EXISTS _d1_retry (coll TEXT NOT NULL, doc_id TEXT NOT NULL, at INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, err TEXT, PRIMARY KEY (coll, doc_id))',
    'CREATE TABLE IF NOT EXISTS _d1_stats (day TEXT NOT NULL, k TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, k))',
    'CREATE TABLE IF NOT EXISTS _d1_guard (ok INTEGER NOT NULL)',
    'CREATE TABLE IF NOT EXISTS _fs_outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, coll TEXT NOT NULL, doc_id TEXT NOT NULL, at INTEGER NOT NULL)',
  ];
}
let _d1InitP = null;
function d1Ready(env) {
  if (!env || !env.DB) return Promise.resolve(false);
  if (!_d1InitP) {
    _d1InitP = env.DB.batch(d1SchemaSql().map(s => env.DB.prepare(s)))
      .then(() => true)
      .catch(e => { console.error('D1_INIT_FAILED', e.message); _d1InitP = null; return false; });
  }
  return _d1InitP;
}
// جدول لكل مجموعة: id + data(JSON) + ts + rev، وأعمدة مولّدة للحقول المستعلَم عنها (لا تكلّف شيئًا) + فهارس حسب الاستخدام
const _d1T = new Map();
function d1Table(env, coll) {
  if (!env || !env.DB || !d1CollOk(coll)) return Promise.resolve(false);
  let p = _d1T.get(coll);
  if (!p) {
    p = (async () => {
      if (!(await d1Ready(env))) return false;
      const gen = D1_GEN.map(g => `"${g}" GENERATED ALWAYS AS (json_extract(data, '$.${g}')) VIRTUAL`).join(', ');
      // طلب واحد: إنشاء الجدول بكل أعمدته + قراءة أعمدته الحالية (table_xinfo يُظهر الأعمدة المولّدة؛ table_info يخفيها)
      const [, info] = await env.DB.batch([
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS "${coll}" (id TEXT PRIMARY KEY, data TEXT NOT NULL, ts INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL DEFAULT 0, ${gen})`),
        env.DB.prepare(`PRAGMA table_xinfo("${coll}")`),
      ]);
      const cols = new Set(((info && info.results) || []).map(r => r.name));
      const stmts = [];
      if (!cols.has('rev')) stmts.push(`ALTER TABLE "${coll}" ADD COLUMN rev INTEGER NOT NULL DEFAULT 0`);
      for (const g of D1_GEN) if (!cols.has(g)) stmts.push(`ALTER TABLE "${coll}" ADD COLUMN "${g}" GENERATED ALWAYS AS (json_extract(data, '$.${g}')) VIRTUAL`);
      for (const ix of (D1_IDX[coll] || D1_IDX_DEFAULT)) stmts.push(`CREATE INDEX IF NOT EXISTS "ix_${coll}_${ix.join('_')}" ON "${coll}" (${ix.map(c => `"${c}"`).join(', ')})`);
      if (stmts.length) await env.DB.batch(stmts.map(x => env.DB.prepare(x)));     // طلب ثانٍ (دفعة واحدة)
      return true;
    })().catch(e => { _d1T.delete(coll); console.error('D1_TABLE', coll, e.message); return false; });
    _d1T.set(coll, p);
  }
  return p;
}
async function d1Tables(env, colls) { const r = await Promise.all([...new Set(colls)].map(c => d1Table(env, c))); return r.every(Boolean); }

/* ─── عدّادات اليوم ─── */
const _d1St = { req: 0, poll: 0, rr: 0, rw: 0, mfail: 0, cron: 0, bk: 0, bkfail: 0, last: Date.now() };
const D1_STAT_KEYS = ['req', 'poll', 'rr', 'rw', 'mfail', 'cron', 'bk', 'bkfail'];
function d1Stat(k, n = 1) { _d1St[k] = (_d1St[k] || 0) + n; }
function d1Meta(res) { const m = res && res.meta; if (m) { d1Stat('rr', num(m.rows_read, 0)); d1Stat('rw', num(m.rows_written, 0)); } }
async function d1FlushStats(env, force) {
  if (!env || !env.DB) return;
  if (!force && Date.now() - _d1St.last < 60000) return;
  const ks = D1_STAT_KEYS.filter(k => _d1St[k] > 0);
  _d1St.last = Date.now();
  if (!ks.length || !(await d1Ready(env))) return;
  const snap = {}; ks.forEach(k => { snap[k] = _d1St[k]; _d1St[k] = 0; });
  const day = new Date().toISOString().slice(0, 10);
  try {
    await env.DB.batch(ks.map(k => env.DB.prepare('INSERT INTO _d1_stats (day, k, n) VALUES (?, ?, ?) ON CONFLICT(day, k) DO UPDATE SET n = n + excluded.n').bind(day, k, snap[k])));
  } catch { ks.forEach(k => { _d1St[k] += snap[k]; }); }
}
async function d1All(env, sql, args = []) {
  const r = await env.DB.prepare(sql).bind(...args).all();
  d1Meta(r);
  return r.results || [];
}
async function d1MetaGet(env, k, def) {
  const r = await env.DB.prepare('SELECT v FROM _d1_meta WHERE k = ?').bind(k).first();
  if (!r) return def;
  try { return JSON.parse(r.v); } catch { return def; }
}
async function d1MetaSet(env, k, v) {
  await env.DB.prepare('INSERT INTO _d1_meta (k, v, at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, at = excluded.at')
    .bind(k, JSON.stringify(v), Date.now()).run();
}

/* ─── الإعداد: مفاتيح القراءة + الوضع الأساسي (fs | d1) + النسخة الاحتياطية ─── */
let _d1Cfg = { v: null, exp: 0, p: null };
async function d1Cfg(env) {
  if (!env || !env.DB) return { flags: {}, primary: null, backup: true };
  if (_d1Cfg.v && _d1Cfg.exp > Date.now()) return _d1Cfg.v;
  if (_d1Cfg.p) return _d1Cfg.p;
  _d1Cfg.p = (async () => {
    let v = _d1Cfg.v || { flags: {}, primary: null, backup: true };
    try {
      if (await d1Ready(env)) {
        const rows = (await env.DB.prepare("SELECT k, v FROM _d1_meta WHERE k IN ('flags', 'primary', 'backup')").all()).results || [];
        const m = Object.fromEntries(rows.map(r => { try { return [r.k, JSON.parse(r.v)]; } catch { return [r.k, null]; } }));
        v = { flags: m.flags || {}, primary: m.primary || null, backup: m.backup !== false };
      }
    } catch (e) { console.error('D1_CFG', e.message); }
    _d1Cfg = { v, exp: Date.now() + 20000, p: null };
    return v;
  })();
  return _d1Cfg.p;
}
const d1Flags = async env => (await d1Cfg(env)).flags;
function d1PrimaryNow(cfg, t = Date.now()) { const p = cfg && cfg.primary; if (!p) return false; return (t >= num(p.at, 0) ? p.mode : p.prev) === 'd1'; }
function d1Frozen(cfg, t = Date.now()) { const p = cfg && cfg.primary; return !!(p && p.mode !== p.prev && t >= num(p.at, 0) - 25000 && t < num(p.at, 0) + 10000); }
async function d1IsPrimary(env) { if (!env || !env.DB) return false; return d1PrimaryNow(await d1Cfg(env)); }
function d1IsPrimaryCached() { return !!(_d1Cfg.v && d1PrimaryNow(_d1Cfg.v)); }
async function d1ReadOn(env, coll) {
  if (!env || !env.DB || !d1CollOk(coll)) return false;
  const c = await d1Cfg(env);
  return d1PrimaryNow(c) || c.flags[coll] === true;
}
async function d1PublicFlags(env) {
  const c = await d1Cfg(env).catch(() => ({ flags: {} }));
  const all = d1PrimaryNow(c), o = {};
  for (const k of D1_PHASE1) if (all || c.flags[k] === true) o[k] = true;
  return o;
}
// نافذة التجميد حول لحظة التحويل: الكتابة تنتظر ثم تكمل في الوضع الجديد (لا رفض، لا تضارب)
async function d1WriteGate(env) {
  if (!env || !env.DB) return;
  for (let i = 0; i < 10; i++) {
    const c = await d1Cfg(env);
    if (!d1Frozen(c)) return;
    await sleep(Math.min(6000, num(c.primary.at, 0) + 10000 - Date.now() + 250));
    _d1Cfg.exp = 0;
  }
  throw httpError(503, 'تحديث قصير للنظام — أعد المحاولة بعد دقيقة');
}

/* ─── مسارات JSON والحقول ─── */
function fpSplit(p) {                       // a.b · `a.b`.c
  const out = []; let cur = '', bt = false;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (bt) { if (c === '\\' && i + 1 < p.length) { cur += p[++i]; continue; } if (c === '`') { bt = false; continue; } cur += c; }
    else if (c === '`') bt = true;
    else if (c === '.') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function d1Jp(segs) {
  if (!segs.length || segs.some(s => !s || /["\\]/.test(s))) return null;
  return '$' + segs.map(s => `."${s}"`).join('');
}
function d1Target(env, name) {
  const pre = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/`;
  if (typeof name !== 'string' || !name.startsWith(pre)) return null;
  const p = name.slice(pre.length).split('/');
  return p.length === 2 && d1CollOk(p[0]) && p[1] ? { coll: p[0], id: p[1] } : null;
}
function d1PathOf(path) {
  const p = String(path || '').split('/');
  return p.length === 2 && d1CollOk(p[0]) && p[1] ? { coll: p[0], id: p[1] } : null;
}
const d1NameOf = w => w.update ? w.update.name : w.delete ? w.delete : w.transform ? w.transform.document : null;
function d1GetIn(o, segs) { let c = o; for (const s of segs) { if (!c || typeof c !== 'object' || !(s in c)) return { has: false }; c = c[s]; } return { has: true, v: c }; }
function d1SetIn(o, segs, v) { let c = o; segs.slice(0, -1).forEach(s => { if (!c[s] || typeof c[s] !== 'object') c[s] = {}; c = c[s]; }); c[segs[segs.length - 1]] = v; }

/* ─── بناء عبارات SQL من كتابات بصيغة Firestore ─── */
function d1UpsertFull(t, data, ts) {
  return { sql: `INSERT INTO "${t.coll}" (id, data, ts, rev) VALUES (?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET data = excluded.data, ts = excluded.ts, rev = "${t.coll}".rev + 1`,
    args: [t.id, JSON.stringify(data), ts] };
}
// تعبير json_set/json_remove لحقول القناع (يدعم الحقول المتداخلة)
function d1MaskExpr(data, paths) {
  let expr = 'data'; const args = [], ins = {};
  for (const p of paths) {
    const segs = fpSplit(String(p)); const jp = d1Jp(segs); if (!jp) return null;
    const g = d1GetIn(data, segs);
    for (let i = 1; i < segs.length; i++) {                    // تأكد من وجود الآباء
      const pj = d1Jp(segs.slice(0, i));
      expr = `json_set(${expr}, ?, json(coalesce(json_extract(data, ?), '{}')))`; args.push(pj, pj);
    }
    if (g.has) { expr = `json_set(${expr}, ?, json(?))`; args.push(jp, JSON.stringify(g.v === undefined ? null : g.v)); d1SetIn(ins, segs, g.v === undefined ? null : g.v); }
    else { expr = `json_remove(${expr}, ?)`; args.push(jp); }
  }
  if (args.length > 90) return null;
  return { expr, args, ins };
}
function d1TransformExpr(fts) {
  let expr = 'data'; const args = [], ins = {};
  for (const ft of fts || []) {
    const segs = fpSplit(String(ft.fieldPath || '')); const jp = d1Jp(segs); if (!jp) return null;
    const op = ft.increment ? 'inc' : ft.maximum ? 'max' : ft.minimum ? 'min' : null;
    if (!op) return null;
    const v = Number(fromFsValue(ft.increment || ft.maximum || ft.minimum)) || 0;
    if (op === 'inc') { expr = `json_set(${expr}, ?, coalesce(json_extract(data, ?), 0) + ?)`; args.push(jp, jp, v); }
    else { expr = `json_set(${expr}, ?, ${op}(coalesce(json_extract(data, ?), ?), ?))`; args.push(jp, jp, v, v); }
    d1SetIn(ins, segs, v);
  }
  if (!args.length || args.length > 90) return null;
  return { expr, args, ins };
}
const d1UpdateSql = (t, e, ts) => ({ sql: `UPDATE "${t.coll}" SET data = ${e.expr}, ts = ?, rev = rev + 1 WHERE id = ?`, args: [...e.args, ts, t.id] });
const d1UpsertSql = (t, e, ts) => ({ sql: `INSERT INTO "${t.coll}" (id, data, ts, rev) VALUES (?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET data = ${e.expr}, ts = excluded.ts, rev = "${t.coll}".rev + 1`,
  args: [t.id, JSON.stringify(e.ins), ts, ...e.args] });
const d1GuardExists = t => ({ sql: `INSERT INTO _d1_guard (ok) SELECT CASE WHEN EXISTS (SELECT 1 FROM "${t.coll}" WHERE id = ?) THEN 1 END`, args: [t.id], guard: true });
const d1GuardRev = (t, rev) => rev === null
  ? { sql: `INSERT INTO _d1_guard (ok) SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM "${t.coll}" WHERE id = ?) THEN 1 END`, args: [t.id], guard: true }
  : { sql: `INSERT INTO _d1_guard (ok) SELECT CASE WHEN (SELECT rev FROM "${t.coll}" WHERE id = ?) = ? THEN 1 END`, args: [t.id, rev], guard: true };

/* ─── (أ) قبل التحويل: نسخ كل كتابة Firestore إلى D1 ─── */
async function d1MirrorWrites(env, writes) {
  if (!env || !env.DB || !Array.isArray(writes) || !writes.length) return;
  const plan = [], resync = new Map(), ts = Date.now();
  const need = t => resync.set(t.coll + '/' + t.id, t);
  const targets = writes.map(w => d1Target(env, d1NameOf(w)));
  if (!targets.some(Boolean)) return;
  for (let i = 0; i < writes.length; i++) {
    const w = writes[i], t = targets[i]; if (!t) continue;
    try {
      if (w.delete) { plan.push({ t, patch: false, sql: `DELETE FROM "${t.coll}" WHERE id = ?`, args: [t.id] }); continue; }
      if (w.update) {
        const data = fromFsFields(w.update.fields || {});
        if (!w.updateMask) plan.push({ t, patch: false, ...d1UpsertFull(t, data, ts) });
        else { const e = d1MaskExpr(data, w.updateMask.fieldPaths || []); if (e) plan.push({ t, patch: true, ...d1UpdateSql(t, e, ts) }); else need(t); }
        if (Array.isArray(w.updateTransforms) && w.updateTransforms.length) { const e = d1TransformExpr(w.updateTransforms); if (e) plan.push({ t, patch: true, ...d1UpdateSql(t, e, ts) }); else need(t); }
        continue;
      }
      if (w.transform) { const e = d1TransformExpr(w.transform.fieldTransforms); if (e) plan.push({ t, patch: true, ...d1UpdateSql(t, e, ts) }); else need(t); }
    } catch { need(t); }
  }
  let err = '';
  if (plan.length) {
    try {
      if (!(await d1Tables(env, plan.map(p => p.t.coll)))) throw new Error('d1_unavailable');
      const res = await env.DB.batch(plan.map(p => env.DB.prepare(p.sql).bind(...p.args)));
      res.forEach((r, i) => { d1Meta(r); if (plan[i].patch && !(r && r.meta && r.meta.changes > 0)) need(plan[i].t); });  // تعديل جزئي لصف لم يُنسخ بعد
    } catch (e) {
      err = String(e.message || e).slice(0, 180); d1Stat('mfail');
      console.error('D1_MIRROR_FAILED', err);
      plan.forEach(p => need(p.t));
    }
  }
  if (resync.size) await d1Enqueue(env, [...resync.values()], err || 'partial');
}
async function d1Enqueue(env, targets, err) {
  const now = Date.now();
  try {
    if (!(await d1Ready(env))) throw new Error('d1_unavailable');
    await env.DB.batch(targets.map(t => env.DB.prepare('INSERT INTO _d1_retry (coll, doc_id, at, tries, err) VALUES (?, ?, ?, 0, ?) ON CONFLICT(coll, doc_id) DO UPDATE SET at = excluded.at, err = excluded.err')
      .bind(t.coll, t.id, now, String(err || '').slice(0, 200))));
  } catch (e) {
    console.error('D1_ENQUEUE_FALLBACK_KV', e.message);
    if (env.KV) for (const t of targets) { try { await env.KV.put(`d1q:${t.coll}/${t.id}`, String(now), { expirationTtl: 30 * 86400 }); } catch {} }
  }
}
async function d1ResyncDoc(env, coll, id) {
  const d = await fsGetFS(env, `${coll}/${id}`);
  if (!(await d1Table(env, coll))) throw new Error('d1_table');
  const s = d ? d1UpsertFull({ coll, id }, d, Date.now()) : { sql: `DELETE FROM "${coll}" WHERE id = ?`, args: [id] };
  d1Meta(await env.DB.prepare(s.sql).bind(...s.args).run());
}
async function d1ProcessRetry(env, max = 40) {
  const rows = await d1All(env, 'SELECT coll, doc_id, at, tries FROM _d1_retry WHERE tries < 20 ORDER BY at LIMIT ?', [max]);
  let ok = 0;
  for (const r of rows) {
    if (!d1CollOk(r.coll)) { await env.DB.prepare('DELETE FROM _d1_retry WHERE coll = ? AND doc_id = ?').bind(r.coll, r.doc_id).run(); continue; }
    try {
      await d1ResyncDoc(env, r.coll, r.doc_id);
      await env.DB.prepare('DELETE FROM _d1_retry WHERE coll = ? AND doc_id = ? AND at = ?').bind(r.coll, r.doc_id, r.at).run();
      ok++;
    } catch (e) {
      await env.DB.prepare('UPDATE _d1_retry SET tries = tries + 1, err = ? WHERE coll = ? AND doc_id = ?').bind(String(e.message || e).slice(0, 200), r.coll, r.doc_id).run().catch(() => {});
      if (e.status === 503) break;
    }
  }
  return ok;
}
async function d1DrainKvQueue(env) {
  if (!env.KV) return 0;
  const l = await env.KV.list({ prefix: 'd1q:', limit: 100 }).catch(() => null);
  if (!l || !l.keys.length) return 0;
  const targets = l.keys.map(k => { const [coll, id] = k.name.slice(4).split('/'); return { coll, id }; }).filter(t => d1CollOk(t.coll) && t.id);
  if (targets.length) await env.DB.batch(targets.map(t => env.DB.prepare('INSERT INTO _d1_retry (coll, doc_id, at, tries, err) VALUES (?, ?, ?, 0, ?) ON CONFLICT(coll, doc_id) DO NOTHING').bind(t.coll, t.id, Date.now(), 'kv')));
  for (const k of l.keys) await env.KV.delete(k.name).catch(() => {});
  return targets.length;
}

/* ─── (ب) بعد التحويل: D1 أساسي — كتابة ذرّية بشروط Firestore نفسها ─── */
function d1AbortErr(m) { const e = new Error(m || 'd1_aborted'); e.aborted = true; return e; }
function d1PrimaryStmts(env, writes, ts) {
  const out = [], touched = [];
  for (const w of writes) {
    const t = d1Target(env, d1NameOf(w));
    if (!t) throw httpError(500, 'مسار بيانات غير صالح');
    touched.push(t);
    const pre = w.currentDocument || null;
    if (pre && pre.exists === true) out.push(d1GuardExists(t));
    if (w.delete) { out.push({ sql: `DELETE FROM "${t.coll}" WHERE id = ?`, args: [t.id] }); continue; }
    if (w.update) {
      const data = fromFsFields(w.update.fields || {});
      if (!w.updateMask) {
        out.push(pre && pre.exists === false
          ? { sql: `INSERT INTO "${t.coll}" (id, data, ts, rev) VALUES (?, ?, ?, 1)`, args: [t.id, JSON.stringify(data), ts] }
          : d1UpsertFull(t, data, ts));
      } else {
        const e = d1MaskExpr(data, w.updateMask.fieldPaths || []);
        if (!e) throw httpError(500, 'حقل غير مدعوم في قاعدة البيانات');
        out.push(pre && pre.exists === false
          ? { sql: `INSERT INTO "${t.coll}" (id, data, ts, rev) VALUES (?, ?, ?, 1)`, args: [t.id, JSON.stringify(e.ins), ts] }
          : d1UpsertSql(t, e, ts));
      }
      if (Array.isArray(w.updateTransforms) && w.updateTransforms.length) {
        const e = d1TransformExpr(w.updateTransforms); if (!e) throw httpError(500, 'تحويل غير مدعوم');
        out.push(d1UpsertSql(t, e, ts));
      }
      continue;
    }
    if (w.transform) { const e = d1TransformExpr(w.transform.fieldTransforms); if (!e) throw httpError(500, 'تحويل غير مدعوم'); out.push(d1UpsertSql(t, e, ts)); continue; }
    throw httpError(500, 'عملية غير مدعومة');
  }
  return { stmts: out, touched };
}
async function d1CommitPrimary(env, writes, guards = []) {
  if (!Array.isArray(writes) || !writes.length) return { writeResults: [] };
  const ts = Date.now();
  const { stmts, touched } = d1PrimaryStmts(env, writes, ts);
  if (!(await d1Tables(env, [...touched.map(t => t.coll), ...guards.map(g => g.coll)]))) throw httpError(503, 'قاعدة البيانات غير متاحة مؤقتًا');
  const all = [...guards, ...stmts];
  const cfg = await d1Cfg(env);
  if (cfg.backup) for (const t of touched) all.push({ sql: 'INSERT INTO _fs_outbox (coll, doc_id, at) VALUES (?, ?, ?)', args: [t.coll, t.id, ts] });   // نسخة Firestore الاحتياطية (بالترتيب)
  if (all.some(s => s.guard)) all.push({ sql: 'DELETE FROM _d1_guard', args: [] });
  try {
    const res = await env.DB.batch(all.map(s => env.DB.prepare(s.sql).bind(...s.args)));
    res.forEach(d1Meta);
  } catch (e) {
    const m = String(e.message || e);
    if (/UNIQUE|NOT NULL|constraint/i.test(m)) throw d1AbortErr(m);
    console.error('D1_COMMIT_FAILED', m.slice(0, 200));
    throw httpError(500, 'خطأ في قاعدة البيانات');
  }
  if (cfg.backup) background(d1DrainOutbox(env, 60).catch(() => {}));
  return { writeResults: [] };
}
// معاملة D1 «تفاؤلية»: نقرأ مع رقم النسخة، ونكتب كل شيء في دفعة ذرّية واحدة تفشل إن تغيّر أي مستند قرأناه → إعادة
async function d1RunTransaction(env, fn, attempts = 6) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await d1TxAttempt(env, fn); }
    catch (e) {
      if (!e.aborted) throw e;
      last = e;
      await sleep(25 * (i + 1) + Math.floor(Math.random() * 40));
    }
  }
  console.error('D1_TX_CONTENTION', last && last.message);
  throw httpError(409, 'ضغط مؤقت على النظام — أعد المحاولة');
}
async function d1TxAttempt(env, fn) {
  const reads = new Map(), writes = [];
  const note = (coll, id, rev) => { const k = coll + '/' + id; if (!reads.has(k)) reads.set(k, { coll, id, rev }); };
  const tx = {
    async get(path) {
      const t = d1PathOf(path); if (!t) throw httpError(500, 'مسار غير صالح');
      if (!(await d1Table(env, t.coll))) throw httpError(503, 'قاعدة البيانات غير متاحة مؤقتًا');
      const r = await env.DB.prepare(`SELECT data, rev FROM "${t.coll}" WHERE id = ?`).bind(t.id).first();
      d1Stat('rr', 1);
      note(t.coll, t.id, r ? num(r.rev, 0) : null);
      return r ? JSON.parse(r.data) : null;
    },
    async query(structuredQuery) {
      const coll = structuredQuery && structuredQuery.from && structuredQuery.from[0] && structuredQuery.from[0].collectionId;
      if (!d1CollOk(coll) || !(await d1Table(env, coll))) throw httpError(503, 'قاعدة البيانات غير متاحة مؤقتًا');
      const q = d1BuildQuery(coll, structuredQuery);
      const rows = await d1All(env, q.sql, q.args);
      rows.forEach(r => note(coll, r.id, num(r.rev, 0)));
      return rows.map(r => d1RowToFs(env, coll, r));
    },
    update(path, data, merge = true) {
      const entry = { update: { name: docPath(env, path), fields: toFsFields(data) } };
      if (merge) entry.updateMask = { fieldPaths: Object.keys(data).map(fieldPathEscape) };
      writes.push(entry);
    },
    create(collection, docId, data) { writes.push({ update: { name: docPath(env, `${collection}/${docId}`), fields: toFsFields(data) }, currentDocument: { exists: false } }); },
    delete(path) { writes.push({ delete: docPath(env, path) }); },
    increment(path, field, amount) {
      writes.push({ transform: { document: docPath(env, path), fieldTransforms: [{ fieldPath: fieldPathEscape(field),
        increment: Number.isInteger(amount) ? { integerValue: String(amount) } : { doubleValue: amount } }] } });
    },
  };
  const result = await fn(tx);
  if (writes.length) {
    const guards = [...reads.values()].map(g => ({ ...d1GuardRev({ coll: g.coll, id: g.id }, g.rev), coll: g.coll }));
    await d1CommitPrimary(env, writes, guards);
  }
  return result;
}

/* ─── صندوق الصادر: نسخة Firestore احتياطية مرتّبة (للرجوع الآمن) ─── */
async function d1DrainOutbox(env, max = 200) {
  if (!env || !env.DB) return 0;
  const now = Date.now();
  const lock = await env.DB.prepare("INSERT INTO _d1_meta (k, v, at) VALUES ('outbox_lock', ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, at = excluded.at WHERE _d1_meta.at < ?")
    .bind(JSON.stringify(now + 50000), now, now - 50000).run().catch(() => null);
  if (!lock || !(lock.meta && lock.meta.changes > 0)) return 0;              // مصرّف آخر يعمل الآن
  let done = 0;
  try {
    const rows = await d1All(env, 'SELECT seq, coll, doc_id FROM _fs_outbox ORDER BY seq LIMIT ?', [max]);
    if (!rows.length) return 0;
    const maxSeq = rows[rows.length - 1].seq;
    const uniq = new Map(); rows.forEach(r => uniq.set(r.coll + '/' + r.doc_id, r));
    const writes = [];
    for (const r of uniq.values()) {
      const d = await env.DB.prepare(`SELECT data FROM "${r.coll}" WHERE id = ?`).bind(r.doc_id).first().catch(() => null);
      writes.push(d ? { update: { name: docPath(env, `${r.coll}/${r.doc_id}`), fields: toFsFields(JSON.parse(d.data)) } } : { delete: docPath(env, `${r.coll}/${r.doc_id}`) });
    }
    for (let i = 0; i < writes.length; i += 400) await fsFetch(env, ':commit', { method: 'POST', body: JSON.stringify({ writes: writes.slice(i, i + 400) }) });
    await env.DB.prepare('DELETE FROM _fs_outbox WHERE seq <= ?').bind(maxSeq).run();
    d1Stat('bk', writes.length); done = writes.length;
  } catch (e) { d1Stat('bkfail'); console.error('FS_BACKUP_FAILED', String(e.message || e).slice(0, 160)); }
  finally { await env.DB.prepare("UPDATE _d1_meta SET at = 0 WHERE k = 'outbox_lock'").run().catch(() => {}); }
  return done;
}

/* ─── القراءة من D1 بصيغة Firestore (الدوال الحالية لا تتغير) ─── */
function d1Unsupported(m) { const e = new Error('d1_unsupported: ' + m); e.unsupported = true; return e; }
function d1Val(v) {
  if (v && typeof v === 'object' && 'referenceValue' in v) return String(v.referenceValue).split('/').pop();
  if (v && typeof v === 'object' && 'mapValue' in v) throw d1Unsupported('map value');
  const x = fromFsValue(v);
  if (Array.isArray(x)) throw d1Unsupported('array value');
  return typeof x === 'boolean' ? (x ? 1 : 0) : x;
}
function d1Field(fp, args) {
  if (fp === '__name__') return 'id';
  const segs = fpSplit(String(fp || ''));
  if (segs.length === 1 && D1_GEN.includes(segs[0])) return `"${segs[0]}"`;
  const jp = d1Jp(segs); if (!jp) throw d1Unsupported('field ' + fp);
  args.push(jp);
  return 'json_extract(data, ?)';
}
const D1_OPS = { EQUAL: '=', NOT_EQUAL: '!=', LESS_THAN: '<', LESS_THAN_OR_EQUAL: '<=', GREATER_THAN: '>', GREATER_THAN_OR_EQUAL: '>=' };
function d1Where(f, args) {
  if (!f) return '';
  if (f.compositeFilter) {
    const op = f.compositeFilter.op === 'OR' ? ' OR ' : ' AND ';
    const parts = (f.compositeFilter.filters || []).map(x => d1Where(x, args)).filter(Boolean);
    return parts.length ? '(' + parts.join(op) + ')' : '';
  }
  if (f.fieldFilter) {
    const ff = f.fieldFilter, fp = ff.field && ff.field.fieldPath;
    if (D1_OPS[ff.op]) { const col = d1Field(fp, args); args.push(d1Val(ff.value)); return `${col} ${D1_OPS[ff.op]} ?`; }
    if (ff.op === 'IN' || ff.op === 'NOT_IN') {
      const col = d1Field(fp, args);
      args.push(JSON.stringify(((ff.value && ff.value.arrayValue && ff.value.arrayValue.values) || []).map(d1Val)));
      return `${col} ${ff.op === 'IN' ? 'IN' : 'NOT IN'} (SELECT value FROM json_each(?))`;
    }
    if (ff.op === 'ARRAY_CONTAINS' || ff.op === 'ARRAY_CONTAINS_ANY') {
      const jp = d1Jp(fpSplit(String(fp || ''))); if (!jp) throw d1Unsupported('array field');
      args.push(jp);
      if (ff.op === 'ARRAY_CONTAINS') { args.push(d1Val(ff.value)); return 'EXISTS (SELECT 1 FROM json_each(data, ?) WHERE value = ?)'; }
      args.push(JSON.stringify(((ff.value && ff.value.arrayValue && ff.value.arrayValue.values) || []).map(d1Val)));
      return 'EXISTS (SELECT 1 FROM json_each(data, ?) WHERE value IN (SELECT value FROM json_each(?)))';
    }
    throw d1Unsupported('op ' + ff.op);
  }
  if (f.unaryFilter) {
    const jp = d1Jp(fpSplit(String((f.unaryFilter.field && f.unaryFilter.field.fieldPath) || ''))); if (!jp) throw d1Unsupported('unary field');
    if (f.unaryFilter.op === 'IS_NULL') { args.push(jp); return "json_type(data, ?) = 'null'"; }
    if (f.unaryFilter.op === 'IS_NOT_NULL') { args.push(jp, jp); return "(json_type(data, ?) IS NOT NULL AND json_type(data, ?) != 'null')"; }
    throw d1Unsupported('unary ' + f.unaryFilter.op);
  }
  throw d1Unsupported('filter');
}
function d1BuildQuery(coll, sq, countOnly, sel) {
  if (!sq || !Array.isArray(sq.from) || sq.from.length !== 1 || sq.from[0].collectionId !== coll || sq.from[0].allDescendants) throw d1Unsupported('from');
  const args = [], conds = [];
  const w = d1Where(sq.where, args); if (w) conds.push(w);
  const ob = Array.isArray(sq.orderBy) ? sq.orderBy : [];
  const orderParts = [];
  let lastDir = 'ASC';
  for (const o of ob) {
    const fp = o.field && o.field.fieldPath;
    const dir = o.direction === 'DESCENDING' ? 'DESC' : 'ASC';
    lastDir = dir;
    if (fp === '__name__') { orderParts.push({ sql: `id ${dir}`, args: [] }); continue; }
    const ca = []; const col = d1Field(fp, ca);
    conds.push(`${col} IS NOT NULL`); args.push(...ca);                         // Firestore يستبعد ما ليس فيه الحقل
    const oa = []; const col2 = d1Field(fp, oa);
    orderParts.push({ sql: `${col2} ${dir}`, args: oa });
  }
  if (!orderParts.some(p => p.sql.startsWith('id '))) orderParts.push({ sql: `id ${lastDir}`, args: [] });
  const onlyName = ob.length === 1 && ob[0].field && ob[0].field.fieldPath === '__name__';
  for (const [cur, isStart] of [[sq.startAt, true], [sq.endAt, false]]) {
    if (!cur) continue;
    if (!onlyName || !cur.values || cur.values.length !== 1) throw d1Unsupported('cursor');
    const asc = ob[0].direction !== 'DESCENDING';
    const inc = isStart ? cur.before === true : cur.before !== true;
    const gt = isStart === asc;
    conds.push(`id ${gt ? (inc ? '>=' : '>') : (inc ? '<=' : '<')} ?`);
    args.push(d1Val(cur.values[0]));
  }
  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
  if (countOnly) return { sql: `SELECT count(*) AS n FROM "${coll}"${where}`, args };
  let sql = `SELECT ${sel || 'id, data, ts, rev'} FROM "${coll}"${where} ORDER BY ` + orderParts.map(p => p.sql).join(', ');
  orderParts.forEach(p => args.push(...p.args));
  const lim = sq.limit && typeof sq.limit === 'object' ? sq.limit.value : sq.limit;
  sql += ' LIMIT ?'; args.push(lim ? Math.max(1, Math.floor(num(lim, 1000))) : 10000);
  if (sq.offset) { sql += ' OFFSET ?'; args.push(Math.max(0, Math.floor(num(sq.offset, 0)))); }
  return { sql, args };
}
function d1RowToFs(env, coll, r) {
  let d = {}; try { d = JSON.parse(r.data); } catch {}
  return { document: { name: docPath(env, `${coll}/${r.id}`), fields: toFsFields(d) } };
}
async function d1QueryAsFs(env, sq) {
  const coll = sq && sq.from && sq.from[0] && sq.from[0].collectionId;
  if (!coll || !(await d1ReadOn(env, coll))) return null;
  const primary = await d1IsPrimary(env);
  let q;
  try { q = d1BuildQuery(coll, sq); }
  catch (e) {
    if (e.unsupported) { console.error('D1_QUERY_UNSUPPORTED', coll, e.message); if (primary) throw httpError(500, 'استعلام غير مدعوم'); return null; }
    throw e;
  }
  if (!(await d1Table(env, coll))) { if (primary) throw httpError(503, 'قاعدة البيانات غير متاحة مؤقتًا'); return null; }
  return (await d1All(env, q.sql, q.args)).map(r => d1RowToFs(env, coll, r));
}
async function d1GetDoc(env, coll, id) {
  if (!(await d1Table(env, coll))) throw new Error('d1_table');
  const r = await env.DB.prepare(`SELECT data FROM "${coll}" WHERE id = ?`).bind(id).first();
  d1Stat('rr', 1);
  return r ? JSON.parse(r.data) : null;
}
async function d1Count(env, coll, where) {
  if (!(await d1Table(env, coll))) return null;
  const q = d1BuildQuery(coll, { from: [{ collectionId: coll }], where }, true);
  const r = await env.DB.prepare(q.sql).bind(...q.args).first();
  return num(r && r.n, 0);
}

/* ─── فحص ذاتي (قبل بدء النسخ) ─── */
async function d1SelfTest(env) {
  const id = '__d1_selftest__', name = docPath(env, `notifications/${id}`);
  try {
    await d1MirrorWrites(env, [
      { update: { name, fields: toFsFields({ uid: '__selftest__', read: false, created_at: nowIso(), n: 1 }) } },
      { update: { name, fields: toFsFields({ read: true }) }, updateMask: { fieldPaths: ['read', 'n'] } },
      { transform: { document: name, fieldTransforms: [{ fieldPath: 'k', increment: { integerValue: '2' } }] } },
    ]);
    const r = await env.DB.prepare('SELECT data, "read" AS rd, uid FROM notifications WHERE id = ?').bind(id).first();
    const d = r ? JSON.parse(r.data) : null;
    const ok1 = !!(d && d.read === true && !('n' in d) && d.k === 2 && r.rd === 1 && r.uid === '__selftest__');
    await d1MirrorWrites(env, [{ delete: name }]);
    const gone = !(await env.DB.prepare('SELECT 1 FROM notifications WHERE id = ?').bind(id).first());
    await env.DB.prepare('DELETE FROM _d1_retry WHERE doc_id = ?').bind(id).run();
    return ok1 && gone;
  } catch (e) { console.error('D1_SELFTEST_FAILED', e.message); return false; }
}

/* ─── النسخ الأولي + المطابقة (كل المجموعات) ─── */
const d1Day = () => new Date().toISOString().slice(0, 10);
async function d1State(env, coll) { return await d1MetaGet(env, 'sync:' + coll, null) || { state: 'pending', cursor: '', copied: 0 }; }
// كل الحالات في طلب واحد (بدل طلب لكل مجموعة)
async function d1AllStates(env) {
  const rows = (await env.DB.prepare("SELECT k, v FROM _d1_meta WHERE k LIKE 'sync:%'").all()).results || [];
  const m = {}; for (const r of rows) { try { m[r.k.slice(5)] = JSON.parse(r.v); } catch {} }
  return m;
}
const d1StateOf = (m, c) => m[c] || { state: 'pending', cursor: '', copied: 0 };
// أعداد كل الجداول الموجودة في طلبين (بدون إنشاء أي جدول)
async function d1TableCounts(env) {
  const names = ((await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results || []).map(r => r.name).filter(d1CollOk);
  const out = {};
  for (let i = 0; i < names.length; i += 50) {
    const part = names.slice(i, i + 50);
    const res = await env.DB.batch(part.map(n => env.DB.prepare(`SELECT count(*) AS n FROM "${n}"`)));
    res.forEach((r, k) => { out[part[k]] = num(r && r.results && r.results[0] && r.results[0].n, 0); });
  }
  return out;
}
async function d1SetState(env, coll, st) { await d1MetaSet(env, 'sync:' + coll, st); }
async function d1CollList(env, refresh) {
  let m = await d1MetaGet(env, 'colls', null);
  if (refresh || !m || Date.now() - num(m.at, 0) > 86400000) {
    try {
      const ids = []; let pageToken = '';
      for (let i = 0; i < 5; i++) {
        const r = await fsFetch(env, ':listCollectionIds', { method: 'POST', body: JSON.stringify({ pageSize: 300, ...(pageToken ? { pageToken } : {}) }) });
        (r && r.collectionIds || []).forEach(c => ids.push(c));
        pageToken = r && r.nextPageToken; if (!pageToken) break;
      }
      m = { list: ids.filter(d1CollOk), at: Date.now() };
      await d1MetaSet(env, 'colls', m);
    } catch (e) { console.error('D1_LIST_COLLS', e.message); if (!m) m = { list: [], at: 0 }; }
  }
  const set = new Set([...D1_PHASE1, ...(m.list || [])]);
  return [...D1_PHASE1, ...[...set].filter(c => !D1_PHASE1.includes(c)).sort()];
}
async function d1CopyPage(env, coll, st) {
  const t0 = Date.now(), size = D1_PAGE[coll] || 200;
  if (!(await d1Table(env, coll))) throw new Error('d1_table');
  const q = { from: [{ collectionId: coll }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: size };
  if (st.cursor) q.startAt = { values: [{ referenceValue: docPath(env, `${coll}/${st.cursor}`) }], before: false };
  const rows = await fsQueryStrictFS(env, q);
  const docs = rows.map(r => ({ id: r.document.name.split(`/documents/${coll}/`)[1], data: fromFsFields(r.document.fields || {}) })).filter(d => d.id && !d.id.includes('/'));
  const repair = st.state === 'repair';
  const stmts = docs.map(d => repair
    ? env.DB.prepare(`INSERT INTO "${coll}" (id, data, ts, rev) VALUES (?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET data = excluded.data, ts = excluded.ts, rev = "${coll}".rev + 1 WHERE "${coll}".ts < ?`).bind(d.id, JSON.stringify(d.data), t0, t0)
    : env.DB.prepare(`INSERT OR IGNORE INTO "${coll}" (id, data, ts, rev) VALUES (?, ?, ?, 0)`).bind(d.id, JSON.stringify(d.data), t0));
  const last = docs.length ? docs[docs.length - 1].id : st.cursor;
  const end = docs.length < size;
  if (repair) {
    const ids = JSON.stringify(docs.map(d => d.id));
    stmts.push(end
      ? env.DB.prepare(`DELETE FROM "${coll}" WHERE id > ? AND ts < ? AND id NOT IN (SELECT value FROM json_each(?))`).bind(st.cursor || '', t0, ids)
      : env.DB.prepare(`DELETE FROM "${coll}" WHERE id > ? AND id <= ? AND ts < ? AND id NOT IN (SELECT value FROM json_each(?))`).bind(st.cursor || '', last, t0, ids));
  }
  let chunk = [], bytes = 0;
  const flush = async () => { if (chunk.length) { (await env.DB.batch(chunk)).forEach(d1Meta); chunk = []; bytes = 0; } };
  for (let i = 0; i < stmts.length; i++) {
    const sz = i < docs.length ? JSON.stringify(docs[i].data).length : 1000;
    if (bytes + sz > 3_000_000) await flush();
    chunk.push(stmts[i]); bytes += sz;
  }
  await flush();
  st.cursor = last; st.copied = num(st.copied, 0) + docs.length; st.updated_at = Date.now();
  if (!st.started_at) st.started_at = t0;
  if (end) { st.state = 'verify'; st.streak = 0; }
  else st.state = repair ? 'repair' : 'copying';
  await d1SetState(env, coll, st);
  return Math.max(1, docs.length);
}
async function d1Verify(env, coll, st) {
  const fsN = await fsCount(env, coll, null, true);
  if (fsN === null) return false;
  if (!(await d1Table(env, coll))) return false;
  const r = await env.DB.prepare(`SELECT count(*) AS n FROM "${coll}"`).first();
  const d1N = num(r && r.n, 0);
  Object.assign(st, { fs_count: fsN, d1_count: d1N, checked_at: Date.now(), match: fsN === d1N });
  if (st.match) { st.state = 'done'; st.streak = 0; st.repairs = 0; if (!st.done_at) st.done_at = Date.now(); }
  else {
    st.streak = num(st.streak, 0) + 1;
    if (st.streak < 2) st.state = 'verify';
    else if (num(st.repairs, 0) < 3) { st.state = 'repair'; st.cursor = ''; st.repairs = num(st.repairs, 0) + 1; st.streak = 0; }
    else st.state = 'mismatch';
  }
  await d1SetState(env, coll, st);
  return true;
}
async function d1MigrateStep(env, log) {
  const dayKey = 'mig_reads:' + fbDay();
  let used = num(await d1MetaGet(env, dayKey, 0), 0);
  const cap = num(await d1MetaGet(env, 'mig_cap', 15000), 15000);
  const colls = await d1CollList(env);
  const all = await d1AllStates(env);
  let verifies = 0;
  for (const coll of colls) {                                          // المطابقة رخيصة: حتى 6 لكل دورة
    const st = d1StateOf(all, coll);
    if (st.state === 'verify' && verifies < 6) { verifies++; if (await d1Verify(env, coll, st)) used += 1; all[coll] = st; }
  }
  log.verifies = verifies;
  if (used >= cap) { await d1MetaSet(env, dayKey, used); return 'cap'; }
  if (_quotaHitAt && Date.now() - _quotaHitAt < 3600000) { await d1MetaSet(env, dayKey, used); return 'quota'; }
  const s = await getSettings(env);
  let usage = await usageToday(env).catch(() => 1e9);
  let pages = 0;
  for (const coll of colls) {
    if (pages >= 2) break;                                               // حتى صفحتين لكل دورة (حدود الخطة المجانية)
    let st = d1StateOf(all, coll);
    while (['pending', 'copying', 'repair'].includes(st.state) && pages < 2) {
      const size = D1_PAGE[coll] || 200;
      if (usage + size >= num(s.quota_save_at, 25000) - D1_SAFETY || used + size > cap) { await d1MetaSet(env, dayKey, used); log.pages = pages; return 'budget'; }
      const n = await d1CopyPage(env, coll, st);
      used += n; usage += n; pages++;
      log.last_coll = coll;
    }
  }
  log.pages = pages;
  await d1MetaSet(env, dayKey, used);
  return pages || verifies ? 'ok' : 'idle';
}
async function d1Cron(env, scheduledTime) {
  if (!(await d1Ready(env))) return;
  d1Stat('cron');
  _envForUsage = env;
  _d1Cfg.exp = 0;
  const t = new Date(scheduledTime || Date.now()), minute = t.getUTCMinutes(), hour = t.getUTCHours();
  try {
    const cfg = await d1Cfg(env);
    if (d1PrimaryNow(cfg)) {                                     // بعد التحويل: فقط تصريف النسخة الاحتياطية
      if (cfg.backup) for (let i = 0; i < 5; i++) { if (!(await d1DrainOutbox(env, 300))) break; }
      return;
    }
    let armed = await d1MetaGet(env, 'armed', null);
    if (!armed || !armed.selftest) {
      const ok = await d1SelfTest(env);
      await d1MetaSet(env, 'armed', { at: Date.now(), selftest: ok, first: armed ? armed.first || armed.at : Date.now() });
      if (!ok) console.error('D1_SELFTEST: dual-write check failed — migration paused');
      return;
    }
    if (Date.now() - num(armed.at, 0) < 240000) return;
    const log = { at: Date.now(), ok: true };
    const step = async (name, fn) => { try { const r = await fn(); if (r !== undefined) log[name] = r; } catch (e) { log.ok = false; log.err = `${name}: ${String(e.message || e).slice(0, 140)}`; console.error('D1_CRON_' + name, e.message); } };
    await step('outbox', () => d1DrainOutbox(env, 100));            // بقايا ما قبل الرجوع (إن وُجدت)
    if (minute < 5) {
      await step('kvq', () => d1DrainKvQueue(env));
      // العالقة (فشلت 20 مرة): فرصة جديدة كل ساعة بدل التوقف نهائيًا
      await step('unstuck', async () => { const r = await env.DB.prepare('UPDATE _d1_retry SET tries = 10 WHERE tries >= 20').run(); return num(r && r.meta && r.meta.changes, 0) || undefined; });
    }
    await step('retry', () => d1ProcessRetry(env, 10));
    if (hour === 3 && minute < 5) {
      const allSt = await d1AllStates(env);
      for (const coll of await d1CollList(env, true)) {
        const st = d1StateOf(allSt, coll);
        if (st.state === 'done' || st.state === 'mismatch') { if (st.state === 'mismatch') st.repairs = 0; st.state = 'verify'; st.streak = 0; await d1SetState(env, coll, st); }
      }
    }
    await step('result', () => d1MigrateStep(env, log));
    await d1MetaSet(env, 'cron_last', log).catch(() => {});
  } finally {
    await d1FlushStats(env, true);
  }
}

/* ─── واجهات المتصفح: الإشعارات والمحادثات (تحديث خفيف) ─── */
function d1Rows(rows) { return rows.map(r => { let d = {}; try { d = JSON.parse(r.data); } catch {} return { id: r.id, ...d }; }); }
function fsRowsPlain(rows, coll) { return rows.map(r => { const d = withId(r, coll); d.id = d._id; delete d._id; return d; }); }
function syncReply(rows, since, n) {                    // rows: {j (JSON جاهز), ts}
  const ts = rows.reduce((a, r) => Math.max(a, num(r.ts, 0)), 0);
  if (since && ts && ts <= since && n === rows.length) return { success: true, changed: false, ts };
  return new RawJson('{"success":true,"changed":true,"ts":' + ts + ',"list":[' + rows.map(r => r.j).join(',') + ']}');
}
async function handleSyncNotifs(user, body, env) {
  d1Stat('poll');
  const since = num(body.since, 0), n = num(body.n, -1);
  if (await d1ReadOn(env, 'notifications') && await d1Table(env, 'notifications')) {
    const rows = await d1All(env, "SELECT ts, json_set(data, '$.id', id) AS j FROM notifications WHERE uid = ? ORDER BY created_at DESC LIMIT 40", [user.uid]);
    return syncReply(rows, since, n);
  }
  const rows = await fsQueryStrict(env, { from: [{ collectionId: 'notifications' }], where: qEq('uid', user.uid), limit: 40 });
  return { success: true, changed: true, ts: Date.now(), list: fsRowsPlain(rows, 'notifications') };
}
async function handleSyncChats(user, body, env) {
  d1Stat('poll');
  const merchant = body.role === 'merchant', field = merchant ? 'merchant_owner' : 'uid', lim = merchant ? 30 : 25;
  const since = num(body.since, 0), n = num(body.n, -1);
  if (await d1ReadOn(env, 'merchant_chats') && await d1Table(env, 'merchant_chats')) {
    const rows = await d1All(env, `SELECT ts, json_set(data, '$.id', id) AS j FROM merchant_chats WHERE "${field}" = ? ORDER BY updated_at DESC LIMIT ?`, [user.uid, lim]);
    return syncReply(rows, since, n);
  }
  const rows = await fsQueryStrict(env, { from: [{ collectionId: 'merchant_chats' }], where: qEq(field, user.uid), limit: lim });
  return { success: true, changed: true, ts: Date.now(), list: fsRowsPlain(rows, 'merchant_chats') };
}
async function handleSyncChat(user, body, env) {
  d1Stat('poll');
  const id = String(body.id || '');
  if (!/^[A-Za-z0-9_-]{3,160}$/.test(id)) throw httpError(400, 'محادثة غير صالحة');
  let c = null, ts = Date.now();
  if (await d1ReadOn(env, 'merchant_chats') && await d1Table(env, 'merchant_chats')) {
    const r = await env.DB.prepare('SELECT data, ts FROM merchant_chats WHERE id = ?').bind(id).first();
    d1Stat('rr', 1);
    if (r) { c = JSON.parse(r.data); ts = num(r.ts, 0); }
  } else c = await fsGet(env, `merchant_chats/${id}`);
  if (!c) return { success: true, changed: true, ts: 0, chat: null };
  if (!(await orderParty(env, user, { uid: c.uid, merchant_owner: c.merchant_owner }))) throw httpError(403, 'غير مصرّح');
  if (num(body.since, 0) && ts <= num(body.since, 0)) return { success: true, changed: false, ts };
  return { success: true, changed: true, ts, chat: { id, ...c } };
}

/* ─── بعد التحويل: واجهة بيانات عامة للمتصفح (بديل Firestore SDK) مع صلاحيات صارمة ─── */
const DB_OWNER = {           // مجموعات يقرأ المستخدم منها ما يخصّه فقط (حسب الحقل)
  manual_cards: ['uid'], service_orders: ['uid'], orders: ['uid'], wallet_transactions: ['uid'], wallet_deposits: ['uid'], withdrawals: ['uid'],
  manual_card_orders: ['uid'], tickets: ['uid'], notifications: ['uid'], merchant_orders: ['uid', 'merchant_owner'], merchant_reports: ['uid', 'merchant_owner'],
  merchant_statements: ['merchant_owner'], merchant_chats: ['uid', 'merchant_owner'],
};
const DB_STAFF_SEC = {       // أقسام الصلاحية التي تسمح للموظف بقراءة المجموعة
  users: ['users'], manual_cards: ['cards', 'mcards', 'users'], manual_card_orders: ['mcards', 'users'], orders: ['orders', 'users'],
  wallet_deposits: ['deposits', 'users'], withdrawals: ['withdraw', 'users'], tickets: ['tickets', 'users'], coupons: ['coupons'], sms_transactions: ['sms'],
  services: ['services', 'store'], service_orders: ['services', 'users'], wallet_transactions: ['users', 'deposits'], merchants: ['merchants'],
  merchant_reports: ['merchants'], merchant_applications: ['merchants'], merchant_statements: ['merchants'], merchant_orders: ['merchants'],
  merchant_services: ['merchants'], merchant_chats: ['merchants'], merchant_sections: ['merchants'], merchant_reviews: ['merchants'],
  platforms: ['stickers'], stickers: ['stickers'], categories: ['store'], products: ['store'], settings: ['*'],
};
const DB_OPS = { '==': 'EQUAL', '!=': 'NOT_EQUAL', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL', '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL', in: 'IN', 'array-contains': 'ARRAY_CONTAINS' };
const _staffMem = new Map();
async function dbStaff(env, uid) {
  const h = _staffMem.get(uid); if (h && h.exp > Date.now()) return h.v;
  const v = await getStaff(env, uid).catch(() => null);
  _staffMem.set(uid, { v, exp: Date.now() + 60000 }); if (_staffMem.size > 500) _staffMem.clear();
  return v;
}
async function dbStaffAllowed(env, user, coll) {
  const st = await dbStaff(env, user.uid); if (!st) return false;
  if (st.role === 'super_admin') return true;
  const secs = DB_STAFF_SEC[coll]; if (!secs) return false;
  return secs.includes('*') || secs.some(s => staffCan(st, s + '.view'));
}
// مجموعات سرية لا تُقرأ من واجهة البيانات العامة أبدًا — حتى للمسؤول الرئيسي
const DB_SECRET = new Set(['card_vault', 'card_pins', 'card_devices', 'card_codes', 'card_cvv_once', 'manual_card_reveal', 'email_codes', 'otp_codes', 'otp_waits', 'idempotency', 'rate_limits', 'usdt_amounts', 'inv_links']);
function dbBuildSq(q) {
  const coll = String(q && q.c || '');
  if (!d1CollOk(coll) || DB_SECRET.has(coll)) throw httpError(400, 'مجموعة غير صالحة');
  const filters = (Array.isArray(q.w) ? q.w : []).slice(0, 6).map(([f, op, v]) => {
    if (!DB_OPS[op] || typeof f !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.]{0,60}$/.test(f)) throw httpError(400, 'شرط غير صالح');
    return { fieldFilter: { field: { fieldPath: f }, op: DB_OPS[op], value: toFsValue(v) } };
  });
  const sq = { from: [{ collectionId: coll }], limit: Math.min(500, Math.max(1, Math.floor(num(q.l, 100)))) };
  if (filters.length === 1) sq.where = filters[0]; else if (filters.length > 1) sq.where = { compositeFilter: { op: 'AND', filters } };
  const ob = (Array.isArray(q.o) ? q.o : []).slice(0, 2).map(([f, d]) => {
    if (typeof f !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test(f)) throw httpError(400, 'ترتيب غير صالح');
    return { field: { fieldPath: f }, direction: d === 'desc' ? 'DESCENDING' : 'ASCENDING' };
  });
  if (ob.length) sq.orderBy = ob;
  return { coll, sq };
}
async function dbRunQuery(env, user, q, prevH) {
  const { coll, sq } = dbBuildSq(q);
  const owners = DB_OWNER[coll] || [];
  const ownField = owners.find(f => (q.w || []).some(([wf, op, v]) => wf === f && op === '==' && v === user.uid));
  if (!ownField && !(await dbStaffAllowed(env, user, coll))) throw httpError(403, 'غير مصرّح');
  if (await d1ReadOn(env, coll) && await d1Table(env, coll)) {                 // مسار D1: D1 يبني JSON بنفسه، والخادم يمرره كما هو
    const hashOf = rows => rows.length + ':' + rows.reduce((a, r) => a + num(r.rev, 0), 0) + ':' + rows.reduce((a, r) => Math.max(a, num(r.ts, 0)), 0) + ':' + rows.map(r => r.id).join(',');
    if (prevH) {                                                                 // بصمة خفيفة أولًا: إن لم يتغير شيء لا نجلب البيانات أصلًا
      const m = d1BuildQuery(coll, sq, false, 'id, ts, rev');
      const h0 = await sha256Hex(hashOf(await d1All(env, m.sql, m.args)));
      if (h0 === prevH) return { same: true, h: h0 };
    }
    const b = d1BuildQuery(coll, sq, false, `id, ts, rev, json_set(data, '$.__id', id) AS j`);
    const rows = await d1All(env, b.sql, b.args);                                // شرط المالك (uid == أنت) داخل WHERE نفسه
    return { raw: '[' + rows.map(r => r.j).join(',') + ']', h: await sha256Hex(hashOf(rows)) };
  }
  let docs = (await fsQueryStrict(env, sq)).map(r => { const d = withId(r, coll); const id = d._id; delete d._id; return { ...d, __id: id }; });
  if (ownField) docs = docs.filter(r => r[ownField] === user.uid);
  return { raw: JSON.stringify(docs), h: null };
}
async function dbReadDoc(env, user, c, id) {
  if (DB_SECRET.has(c)) throw httpError(403, 'غير مصرّح');
  if (!d1CollOk(c) || !/^[A-Za-z0-9_@.+:-]{1,200}$/.test(String(id || ''))) throw httpError(400, 'مستند غير صالح');
  let d = null, h = null;
  if (await d1ReadOn(env, c) && await d1Table(env, c)) {
    const r = await env.DB.prepare(`SELECT data, ts, rev FROM "${c}" WHERE id = ?`).bind(id).first();
    d1Stat('rr', 1);
    if (r) { d = JSON.parse(r.data); h = r.ts + ':' + r.rev; } else h = 'none';
  } else d = await fsGet(env, `${c}/${id}`);
  const self = (c === 'users' || c === 'admins') && id === user.uid;
  const owners = DB_OWNER[c] || [];
  if (self || (d && owners.some(f => d[f] === user.uid))) return { d, h };
  if (await dbStaffAllowed(env, user, c)) return { d, h };
  if (!d && owners.length) return { d: null, h };
  throw httpError(403, 'غير مصرّح');
}
async function handleDbQuery(user, body, env) { d1Stat('poll'); return new RawJson('{"success":true,"docs":' + (await dbRunQuery(env, user, body.q || {})).raw + '}'); }
async function handleDbDoc(user, body, env) { d1Stat('poll'); const { d } = await dbReadDoc(env, user, String(body.c || ''), String(body.id || '')); return { success: true, exists: !!d, data: d || null }; }
// دفعة واحدة لكل الاشتراكات المفتوحة في الصفحة (طلب واحد بدل عشرات) — ما لم يتغيّر يُرد عليه بـ same
async function handleDbBatch(user, body, env) {
  d1Stat('poll');
  const subs = (Array.isArray(body.subs) ? body.subs : []).slice(0, 25);
  const parts = [];
  await Promise.all(subs.map(async s => {
    const key = JSON.stringify(String(s.k || '').slice(0, 40));
    try {
      if (s.d) {
        const { d, h } = await dbReadDoc(env, user, String(s.d.c || ''), String(s.d.id || ''));
        parts.push(key + ':' + JSON.stringify(h && h === s.h ? { same: true } : { exists: !!d, data: d || null, h }));
      } else {
        const r = await dbRunQuery(env, user, s.q || {}, typeof s.h === 'string' ? s.h : null);
        parts.push(key + ':' + (r.same || (r.h && r.h === s.h) ? '{"same":true}' : '{"docs":' + r.raw + ',"h":' + JSON.stringify(r.h) + '}'));
      }
    } catch (e) { parts.push(key + ':' + JSON.stringify({ error: e.publicMessage || 'خطأ', status: e.status || 500 })); }
  }));
  return new RawJson('{"success":true,"res":{' + parts.join(',') + '}}');
}
// الكتابات التي كان المتصفح يقوم بها مباشرة: إنشاء ملف المستخدم وتعديل الاسم فقط
async function handleDbSet(user, body, env) {
  const c = String(body.c || ''), id = String(body.id || ''), data = body.data && typeof body.data === 'object' ? body.data : {};
  if (c !== 'users' || id !== user.uid) throw httpError(403, 'غير مصرّح');
  const cur = await fsGet(env, `users/${id}`);
  if (!cur) {
    const fresh = { name: String(data.name || 'مستخدم').replace(/[<>]/g, '').slice(0, 60), email: String(user.email || '').slice(0, 120), phone: '', phone_key: '',
      wallet_balance: 0, total_spent: 0, cards_count: 0, banned: false, created_at: nowIso() };
    await fsCommit(env, [{ update: { name: docPath(env, `users/${id}`), fields: toFsFields(fresh) }, currentDocument: { exists: false } }]).catch(async e => { if (!(await fsGet(env, `users/${id}`))) throw e; });
    return { success: true, created: true };
  }
  const name = String(data.name || '').replace(/[<>]/g, '').trim().slice(0, 60);
  if (Object.keys(data).some(k => k !== 'name') || name.length < 2) throw httpError(400, 'يمكن تعديل الاسم فقط');
  await fsPatch(env, `users/${id}`, { name });
  return { success: true };
}

/* ─── لوحة الإدارة ─── */
async function d1RequireSuper(user, env) {
  const staff = await requirePermission(user, env, 'settings.manage');
  if (staff.role !== 'super_admin') throw httpError(403, 'للمسؤول الرئيسي فقط');
  return staff;
}
async function d1CutoverInfo(env) {
  const colls = await d1CollList(env);
  const all = await d1AllStates(env);
  const states = colls.map(c => ({ id: c, ...d1StateOf(all, c) }));
  const retry = await env.DB.prepare('SELECT count(*) AS n FROM _d1_retry').first();
  const outbox = await env.DB.prepare('SELECT count(*) AS n FROM _fs_outbox').first();
  const ready = states.length > 0 && states.every(s => s.state === 'done' && s.match === true) && num(retry && retry.n, 0) === 0;
  return { states, ready, retry: num(retry && retry.n, 0), outbox: num(outbox && outbox.n, 0) };
}
async function handleAdminD1Status(user, body, env) {
  await d1RequireSuper(user, env);
  if (!env.DB) return { success: true, bound: false };
  if (!(await d1Ready(env))) return { success: true, bound: true, ready: false };
  await d1FlushStats(env, true);
  _d1Cfg.exp = 0;
  const cfg = await d1Cfg(env);
  const info = await d1CutoverInfo(env);
  const counts = await d1TableCounts(env).catch(() => ({}));
  const colls = info.states.map(s => ({ id: s.id, label: D1_LABEL[s.id] || s.id, phase1: D1_PHASE1.includes(s.id), read_d1: d1PrimaryNow(cfg) || cfg.flags[s.id] === true,
    rows: counts[s.id] || 0, state: s.state, copied: s.copied, fs_count: s.fs_count, d1_count: s.d1_count, match: s.match, checked_at: s.checked_at }));
  const day = d1Day(), yday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const stats = {};
  for (const r of await d1All(env, 'SELECT day, k, n FROM _d1_stats WHERE day IN (?, ?)', [day, yday])) { (stats[r.day] = stats[r.day] || {})[r.k] = r.n; }
  const stuck = await env.DB.prepare('SELECT count(*) AS n, max(err) AS err FROM _d1_retry WHERE tries >= 20').first();
  return { success: true, bound: true, ready: true, armed: await d1MetaGet(env, 'armed', null), cron_last: await d1MetaGet(env, 'cron_last', null), colls,
    primary: { now: d1PrimaryNow(cfg) ? 'd1' : 'fs', sched: cfg.primary, frozen: d1Frozen(cfg), backup: cfg.backup, can_cutover: info.ready, outbox: info.outbox, server_now: Date.now() },
    stats: { today: stats[day] || {}, yesterday: stats[yday] || {} }, mig_reads: num(await d1MetaGet(env, 'mig_reads:' + fbDay(), 0), 0),
    mig_cap: num(await d1MetaGet(env, 'mig_cap', 15000), 15000), caps: D1_CAPS,
    retry: { n: info.retry, stuck: num(stuck && stuck.n, 0), err: (stuck && stuck.err) || '' }, limits: { requests: 100000, rows_read: 5000000, rows_written: 100000 } };
}
async function handleAdminD1Flag(user, body, env) {
  const staff = await d1RequireSuper(user, env);
  const coll = String(body.coll || ''), on = body.on === true;
  if (!D1_PHASE1.includes(coll)) throw httpError(400, 'مجموعة غير معروفة');
  if (!(await d1Ready(env))) throw httpError(503, 'D1 غير مربوط — راجع wrangler.toml');
  if (on) {
    const st = await d1State(env, coll);
    if (st.state !== 'done' || st.match !== true) throw httpError(409, 'لا يمكن التفعيل قبل اكتمال النسخ ونجاح المطابقة');
    const pend = await env.DB.prepare('SELECT count(*) AS n FROM _d1_retry WHERE coll = ?').bind(coll).first();
    if (num(pend && pend.n, 0) > 0) throw httpError(409, 'توجد عناصر في قائمة الإعادة لهذه المجموعة — انتظر دورة واحدة (5 دقائق)');
  }
  const flags = { ...(await d1MetaGet(env, 'flags', {}) || {}) };
  if (on) flags[coll] = true; else delete flags[coll];
  await d1MetaSet(env, 'flags', flags);
  _d1Cfg.exp = 0;
  bustPublic();
  await logOp(env, staff.uid, 'd1.flag', { coll }, { on }, true);
  return { success: true, flags };
}
async function handleAdminD1Action(user, body, env) {
  const staff = await d1RequireSuper(user, env);
  const act = String(body.action || '');
  if (!(await d1Ready(env))) throw httpError(503, 'D1 غير مربوط');
  _d1Cfg.exp = 0;
  const cfg = await d1Cfg(env);
  if (act === 'cap') {
    const cap = num(body.cap, 0); if (!D1_CAPS.includes(cap)) throw httpError(400, 'قيمة غير صالحة');
    await d1MetaSet(env, 'mig_cap', cap);
    await logOp(env, staff.uid, 'd1.cap', {}, { cap }, true);
    return { success: true };
  }
  if (act === 'rescan') { await d1CollList(env, true); return { success: true }; }
  if (act === 'cutover' || act === 'rollback') {
    requireFreshAuth(user);
    if (d1Frozen(cfg) || (cfg.primary && num(cfg.primary.at, 0) > Date.now())) throw httpError(409, 'تحويل آخر قيد التنفيذ');
    const now = d1PrimaryNow(cfg) ? 'd1' : 'fs';
    if (act === 'cutover') {
      if (now === 'd1') throw httpError(409, 'D1 هو الأساسي بالفعل');
      const info = await d1CutoverInfo(env);
      if (!info.ready) throw httpError(409, 'لم تكتمل كل المجموعات بعد (أو توجد عناصر في قائمة الإعادة)');
    } else {
      if (now === 'fs') throw httpError(409, 'Firestore هو الأساسي بالفعل');
      if (!cfg.backup || await d1MetaGet(env, 'backup_gap', false)) throw httpError(409, 'النسخة الاحتياطية في Firestore توقفت لفترة — الرجوع غير آمن (Firestore ينقصه بيانات)');
      const ob = await env.DB.prepare('SELECT count(*) AS n FROM _fs_outbox').first();
      if (num(ob && ob.n, 0) > 0) throw httpError(409, `انتظر اكتمال النسخة الاحتياطية (${num(ob.n, 0)} مستند متبقٍ) — تُصرّف كل 5 دقائق`);
    }
    const sched = { mode: act === 'cutover' ? 'd1' : 'fs', prev: now, at: Date.now() + 90000, by: staff.uid };
    if (act === 'cutover') { await d1MetaSet(env, 'backup_gap', false); if (!cfg.backup) await d1MetaSet(env, 'backup', true); }
    await d1MetaSet(env, 'primary', sched);
    _d1Cfg.exp = 0;
    bustPublic();
    await logOp(env, staff.uid, 'd1.' + act, {}, { at: sched.at }, true);
    return { success: true, at: sched.at };
  }
  if (act === 'backup') {
    if (d1PrimaryNow(cfg) && body.on === false) await d1MetaSet(env, 'backup_gap', true);   // فجوة في النسخة الاحتياطية → الرجوع يُمنع
    await d1MetaSet(env, 'backup', body.on !== false);
    _d1Cfg.exp = 0;
    await logOp(env, staff.uid, 'd1.backup', {}, { on: body.on !== false }, true);
    return { success: true };
  }
  if (act === 'drain') { const n = await d1DrainOutbox(env, 400); return { success: true, drained: n }; }
  if (act === 'retry_all') {                                     // إعادة كل العالقة الآن
    await env.DB.prepare('UPDATE _d1_retry SET tries = 0').run();
    const fixed = await d1ProcessRetry(env, 15);
    const left = await env.DB.prepare('SELECT count(*) AS n FROM _d1_retry').first();
    await logOp(env, staff.uid, 'd1.retry_all', {}, { fixed }, true);
    return { success: true, fixed, left: num(left && left.n, 0) };
  }
  const coll = String(body.coll || '');
  if (!d1CollOk(coll)) throw httpError(400, 'مجموعة غير معروفة');
  if (d1PrimaryNow(cfg)) throw httpError(409, 'غير متاح بعد التحويل الكامل');
  const st = await d1State(env, coll);
  if (act === 'verify') { if (st.state !== 'pending') { Object.assign(st, { state: 'verify', streak: 0 }); await d1Verify(env, coll, st); } }
  else if (act === 'repair') { Object.assign(st, { state: 'repair', cursor: '', repairs: 0, streak: 0 }); await d1SetState(env, coll, st); }
  else if (act === 'retry_clear') { await env.DB.prepare('UPDATE _d1_retry SET tries = 0 WHERE coll = ?').bind(coll).run(); }
  else throw httpError(400, 'إجراء غير معروف');
  await logOp(env, staff.uid, 'd1.' + act, { coll }, {}, true);
  return { success: true, state: await d1State(env, coll) };
}
async function handleAdminD1Rows(user, body, env) {
  await requirePermission(user, env, 'merchants.view');
  d1Stat('poll');
  const coll = String(body.coll || '');
  const allow = { merchants: [], merchant_services: ['mid'], merchant_chats: ['mid'] };
  if (!allow[coll]) throw httpError(400, 'مجموعة غير مسموحة');
  const sq = { from: [{ collectionId: coll }], limit: Math.min(500, Math.max(1, Math.floor(num(body.limit, 200)))) };
  if (body.field) { if (!allow[coll].includes(body.field)) throw httpError(400, 'حقل غير مسموح'); sq.where = qEq(String(body.field), String(body.value || '')); }
  const rows = await fsQueryStrict(env, sq);
  return { success: true, list: fsRowsPlain(rows, coll), d1: await d1ReadOn(env, coll) };
}

/* ═══════════════════════════════════════════════════════════
   v44 — متجر كاردو عبر Resell Codes (RSC)
   - الكتالوج يُسحب ويُخزَّن (KV)، والعروض تُحدَّث للأقسام المفعّلة فقط
   - الشراء: خصم من المحفظة ← طلب للمزود ← متابعة حتى الاكتمال
   - لا إعادة إرسال تلقائي لطلب الشراء أبدًا (المزود بلا idempotency)
   ═══════════════════════════════════════════════════════════ */
const RSC_BASE = 'https://resell.codes/api/v1';
const RSC_ORIGIN = 'https://resell.codes';
const RSC_FAIL_AR = {
  out_of_stock: 'نفدت الكمية لدى المزود', stock_short: 'الكمية المتوفرة غير كافية', price_changed: 'تغيّر السعر لدى المزود',
  offer_gone: 'العرض لم يعد متاحًا', account_problem: 'مشكلة في حساب اللاعب', region_restricted: 'المنطقة غير مدعومة لهذا المنتج',
  limit_exceeded: 'تجاوز الحد المسموح', timed_out: 'انتهت مهلة التنفيذ', cancelled: 'أُلغي الطلب', declined: 'رُفض الطلب',
};
const RSC_OPEN = ['created', 'processing'];

async function rscCall(env, method, path, body) {
  if (!env.RSC_API_KEY) throw httpError(503, 'مفتاح المزود غير مضاف بعد (RSC_API_KEY)');
  const r = await fetch(RSC_BASE + path, {
    method, signal: AbortSignal.timeout(20000),
    headers: { authorization: 'Bearer ' + env.RSC_API_KEY, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) {
    const e = new Error((j && j.error && j.error.message) || ('HTTP ' + r.status));
    e.rscStatus = r.status; e.rscType = j && j.error && j.error.type;
    throw e;
  }
  return j || {};
}
const rscKey = (type, id) => (type === 'topup' ? 't' : 'g') + '~' + String(id);
const rscKeyOk = k => /^[gt]~[A-Za-z0-9_.:-]{1,80}$/.test(String(k || ''));
const rscSplit = k => ({ type: k[0] === 't' ? 'topup' : 'gift', id: k.slice(2) });
function rscImg(env, key, cfg, cat) {
  const c = cfg && cfg.cats && cfg.cats[key] || {};
  if (c.img_v) return `/rsc/img/${encodeURIComponent(key)}?v=${c.img_v}`;
  if (cat && /^https:\/\//.test(cat.image || '')) return cat.image;
  if (cat && cat.image) return `/rsc/pimg?p=${encodeURIComponent(cat.image)}`;
  return '';
}

/* ─── الإعدادات (KV + نسخة في القاعدة) ─── */
let _rscCfg = { v: null, exp: 0 };
async function rscCfg(env) {
  if (_rscCfg.v && _rscCfg.exp > Date.now()) return _rscCfg.v;
  let v = await kvGetJSON(env, 'rsc:cfg');
  if (!v) { v = await fsGet(env, 'settings/rsc_cfg').catch(() => null); if (v) kvPutJSON(env, 'rsc:cfg', v, 86400 * 30); }
  v = v && typeof v === 'object' ? v : {};
  v.cats = v.cats && typeof v.cats === 'object' ? v.cats : {};
  _rscCfg = { v, exp: Date.now() + 60000 };
  return v;
}
async function rscCfgSave(env, v) {
  _rscCfg = { v, exp: Date.now() + 60000 };
  if (env.KV) await env.KV.put('rsc:cfg', JSON.stringify(v), { expirationTtl: 86400 * 30 }).catch(() => {});
  await fsSet(env, 'settings/rsc_cfg', v).catch(() => {});
  bustPublic();
}
async function rscKvGet(env, k) { return env.KV ? env.KV.get(k, 'json').catch(() => null) : null; }
async function rscKvPut(env, k, v, ttl) { if (env.KV) await env.KV.put(k, JSON.stringify(v), { expirationTtl: ttl || 86400 * 7 }).catch(() => {}); }

/* ─── مزامنة قائمة الأقسام (طلبان أو أكثر) ─── */
async function rscSyncCategories(env) {
  const out = [];
  for (const [type, path] of [['gift', '/gift-cards/categories'], ['topup', '/top-ups/categories']]) {
    let cursor = null;
    for (let page = 0; page < 10; page++) {
      const j = await rscCall(env, 'GET', `${path}?limit=100${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
      for (const c of (j.data || [])) {
        if (!c || !c.category_id) continue;
        out.push({ key: rscKey(type, c.category_id), type, id: String(c.category_id), name: String(c.name || c.category_id).slice(0, 80),
          image: typeof c.image === 'string' ? c.image.slice(0, 300) : '', note: String(c.note || '').slice(0, 300) });
      }
      if (!j.has_more || !j.next_cursor) break;
      cursor = j.next_cursor;
    }
  }
  if (out.length) await rscKvPut(env, 'rsc:cats', { at: Date.now(), list: out }, 86400 * 30);
  return out;
}
async function rscCats(env) { const v = await rscKvGet(env, 'rsc:cats'); return (v && v.list) || []; }

/* ─── عروض قسم واحد (طلب واحد) ─── */
async function rscFetchOffers(env, key) {
  const { type, id } = rscSplit(key);
  const j = await rscCall(env, 'GET', type === 'topup'
    ? `/top-ups/categories/${encodeURIComponent(id)}/offers`
    : `/gift-cards/categories/${encodeURIComponent(id)}/cards`);
  const offers = (j.offers || []).map(o => ({
    id: String(type === 'topup' ? o.offer_id : o.card_id), name: String(o.name || '').slice(0, 120),
    cost: num(o.price_usd, 0), stock: o.stock == null ? null : num(o.stock, 0),
    min: Math.max(1, Math.floor(num(o.min_quantity, 1))), max: Math.min(100, Math.max(1, Math.floor(num(o.max_quantity, type === 'topup' ? 1 : 20)))),
  })).filter(o => o.id && o.cost > 0);
  const fields = type === 'topup' ? (j.fields || []).slice(0, 6).map(f => ({ key: String(f.key || '').slice(0, 40), label: String(f.label || f.key || '').slice(0, 60), type: f.type === 'number' ? 'number' : 'text' })).filter(f => f.key) : [];
  const v = { at: Date.now(), offers, fields };
  await rscKvPut(env, 'rsc:off:' + key, v, 86400 * 7);
  return v;
}
async function rscOffers(env, key, maxAgeMs) {
  const v = await rscKvGet(env, 'rsc:off:' + key);
  if (v && (!maxAgeMs || Date.now() - num(v.at, 0) < maxAgeMs)) return v;
  return rscFetchOffers(env, key);
}
const rscSell = (cost, margin) => Math.ceil(cost * (1 + Math.max(0, margin) / 100) * 100) / 100;
function rscMargin(s, cfg, key) {
  const c = cfg.cats[key] || {};
  return c.margin != null && c.margin !== '' && Number.isFinite(Number(c.margin)) ? Number(c.margin) : num(s.rsc_margin_pct, 10);
}

/* ─── الكتالوج العام (مخزّن مؤقتًا) ─── */
async function handleRscCatalog(env) {
  const s = await getSettings(env);
  if (s.rsc_on === false) return { success: true, on: false, categories: [] };
  const cfg = await rscCfg(env);
  const all = await rscCats(env);
  const byKey = new Map(all.map(c => [c.key, c]));
  const keys = Object.keys(cfg.cats).filter(k => cfg.cats[k] && cfg.cats[k].on === true && byKey.has(k));
  const categories = [];
  // v53: شعبية كل قسم (طلبات مكتملة آخر 30 يومًا) — الكتالوج مخزّن على الحافة فالاستعلام نادر
  const pop = {};
  if (env.DB && await d1Table(env, 'rsc_orders').catch(() => false)) {
    const rows = await d1All(env, `SELECT json_extract(data, '$.cat') AS c, COUNT(*) AS n FROM rsc_orders WHERE status = 'completed' AND created_at > ? GROUP BY c`, [new Date(Date.now() - 30 * 86400000).toISOString()]).catch(() => []);
    for (const r of rows) if (r.c) pop[r.c] = num(r.n, 0);
  }
  for (const key of keys) {
    const cat = byKey.get(key), c = cfg.cats[key];
    const off = await rscKvGet(env, 'rsc:off:' + key);
    if (!off) continue;
    const m = rscMargin(s, cfg, key);
    categories.push({
      key, type: cat.type, name: c.name || cat.name, image: rscImg(env, key, cfg, cat), note: c.note || cat.note || '',
      sort: num(c.sort, 99), fields: off.fields || [], featured: c.featured === true, promo: c.promo || '', group: c.group || '', pop: pop[key] || 0,
      offers: (off.offers || []).filter(o => o.stock == null || o.stock > 0).map(o => ({ id: o.id, name: o.name, price: rscSell(o.cost, m), min: o.min, max: o.max })),
    });
  }
  categories.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  return { success: true, on: true, rate: num(s.usd_to_lyd, 11.8), categories: categories.filter(c => c.offers.length) };
}

/* ─── صور الأقسام: مخصّصة (KV) أو من المزود (وكيل مع تخزين) ─── */
async function handleRscImage(request, env, ctx, url) {
  const cache = caches.default;
  const ck = new Request(url.origin + url.pathname + url.search);
  const hit = await cache.match(ck); if (hit) return hit;
  let bytes = null, type = 'image/jpeg';
  const m = /^\/rsc\/img\/([^/]+)$/.exec(url.pathname);
  if (m) {
    const key = decodeURIComponent(m[1]);
    if (!rscKeyOk(key) || !env.KV) return new Response('Not found', { status: 404 });
    const kv = await env.KV.getWithMetadata('rsc:img:' + key, 'arrayBuffer').catch(() => null);
    if (!kv || !kv.value) return new Response('Not found', { status: 404 });
    bytes = kv.value; type = (kv.metadata && kv.metadata.type) || type;
  } else {
    const p = String(url.searchParams.get('p') || '');
    if (!/^\/api\/media\/[^\s"'<>\\]{1,300}$/.test(p) || p.includes('..')) return new Response('Bad', { status: 400 });
    if (!ipAllow(request, 'img', 120)) return new Response('Too many', { status: 429 });
    const r = await fetch(RSC_ORIGIN + p, { headers: env.RSC_API_KEY ? { authorization: 'Bearer ' + env.RSC_API_KEY } : {}, signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (!r || !r.ok || !/^image\//.test(r.headers.get('content-type') || '')) return new Response('Not found', { status: 404, headers: { 'cache-control': 'public, max-age=600' } });
    bytes = await r.arrayBuffer(); type = r.headers.get('content-type');
    if (bytes.byteLength > 800000) return new Response('Too big', { status: 404 });
  }
  const res = new Response(bytes, { headers: { 'content-type': type, 'cache-control': 'public, max-age=86400', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' } });
  ctx.waitUntil(cache.put(ck, res.clone()));
  return res;
}

/* ─── الشراء ─── */
function rscCodesOf(j) {
  const raw = (j && (j.codes || j.keys)) || [];
  return (Array.isArray(raw) ? raw : []).slice(0, 100).map(c => {
    if (typeof c === 'string' || typeof c === 'number') return String(c);
    if (c && typeof c === 'object') return [c.code, c.pin, c.serial, c.key].filter(Boolean).map(String).join(' | ') || JSON.stringify(c).slice(0, 300);
    return '';
  }).filter(Boolean);
}
const rscNumOf = j => { const v = j && (j.number ?? j.order_number ?? j.order_id ?? j.id); return v == null ? '' : String(v).slice(0, 60); };
const rscStatusOf = j => String((j && j.status) || 'created').toLowerCase();

async function handleRscOrder(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.rsc_on === false) throw httpError(503, 'المتجر متوقف مؤقتًا');
  const key = idemKeyOf(body);
  if (!memAllowWin(`rsc_${user.uid}`, 20, 3600)) throw httpError(429, 'محاولات كثيرة — حاول بعد ساعة');
  const ckey = String(body.cat || '');
  if (!rscKeyOk(ckey)) throw httpError(400, 'قسم غير صالح');
  const cfg = await rscCfg(env);
  if (!cfg.cats[ckey] || cfg.cats[ckey].on !== true) throw httpError(404, 'القسم غير متاح');
  const { type, id: catId } = rscSplit(ckey);
  const offerId = String(body.offer || '').slice(0, 80);

  let live;
  try { live = await rscFetchOffers(env, ckey); }                     // سعر ومخزون لحظي قبل الخصم
  catch (e) { throw httpError(502, 'تعذّر الوصول للمزود الآن — حاول بعد قليل'); }
  const off = live.offers.find(o => o.id === offerId);
  if (!off) throw httpError(404, 'العرض لم يعد متاحًا — حدّث الصفحة');
  const qty = type === 'topup' ? 1 : Math.floor(num(body.qty, 1));
  if (!(qty >= off.min && qty <= off.max)) throw httpError(400, `الكمية من ${off.min} إلى ${off.max}`);
  if (off.stock != null && off.stock < qty) throw httpError(409, 'الكمية غير متوفرة حاليًا');
  const fields = {};
  if (type === 'topup') {
    for (const f of live.fields) {
      const v = toLatinDigits(String((body.fields || {})[f.key] || '')).trim().slice(0, 120);
      if (!v) throw httpError(400, `${f.label} مطلوب`);
      fields[f.key] = v;
    }
  }
  const unit = rscSell(off.cost, rscMargin(s, cfg, ckey));
  const total = round2(unit * qty);
  const expect = num(body.expect, 0);
  if (!(expect > 0) || total > round2(expect + 0.009)) throw httpError(409, 'تغيّر السعر — حدّث الصفحة وأعد المحاولة');
  if (!(total > 0) || total < round2(off.cost * qty)) throw httpError(409, 'السعر غير متاح الآن — حاول بعد قليل');   // لا بيع بخسارة
  const cats = await rscCats(env);
  const cat = cats.find(c => c.key === ckey) || {};
  const catName = (cfg.cats[ckey] && cfg.cats[ckey].name) || cat.name || catId;
  const oid = `RSC${Date.now()}${randomSuffix(4)}`;

  const resp = await fsRunTransaction(env, async (tx) => {
    const hit = await idemRead(tx, user.uid, key); if (hit) return hit;
    const L = await ledgerOpen(tx, user.uid);
    if (L.doc.banned === true) throw httpError(403, 'الحساب موقوف');
    assertEmailVerified(env, s, L.doc);
    await ledgerPost(L, { type: 'debit', amount: total, reason: 'rsc_order', reference: oid, entryId: `txn_rsc_${oid}` });
    ledgerClose(tx, L, { total_spent: round2(num(L.doc.total_spent, 0) + total) });
    tx.create('rsc_orders', oid, {
      uid: user.uid, kind: type, cat: ckey, cat_name: catName, offer_id: off.id, offer_name: off.name, qty, fields,
      cost_usd: round2(off.cost * qty), total_usd: total, status: 'submitting', created_at: nowIso(), updated_at: nowIso(),
    });
    const r = { success: true, id: oid, total };
    idemWrite(tx, user.uid, key, r);
    return r;
  });
  if (resp.replayed) return rscOrderView(env, resp.id, user.uid);

  // إرسال واحد فقط للمزود
  let j = null;
  try {
    j = await rscCall(env, 'POST', type === 'topup' ? '/top-ups/order' : '/gift-cards/order',
      type === 'topup' ? { category_id: catId, offer_id: off.id, fields } : { category_id: catId, card_id: off.id, quantity: qty });
  } catch (e) {
    const definite = e.rscStatus && e.rscStatus >= 400 && e.rscStatus < 500;   // رفض صريح ← لم يُنفَّذ ← نُرجع المبلغ
    if (definite) {
      await rscRefund(env, oid, 'تعذّر تنفيذ الطلب لدى المزود', 'system', e.message);
    } else {
      await fsPatch(env, `rsc_orders/${oid}`, { status: 'unknown', provider_error: String(e.message || '').slice(0, 200), updated_at: nowIso() }).catch(() => {});
      rscAlertAdmins(env, oid, 'طلب بحالة غير معروفة يحتاج مراجعة');
    }
    await logOp(env, user.uid, 'rsc.order', { oid, cat: ckey }, { error: String(e.message || '').slice(0, 120) }, false);
    return rscOrderView(env, oid, user.uid);
  }
  const number = rscNumOf(j);
  await fsPatch(env, `rsc_orders/${oid}`, { number, status: rscStatusOf(j), updated_at: nowIso() });
  await rscApply(env, oid, j);
  // متابعة قصيرة: بطاقات الهدايا غالبًا تكتمل خلال ثوانٍ
  for (let i = 0; i < 3 && number; i++) {
    const o = await fsGet(env, `rsc_orders/${oid}`);
    if (!o || !RSC_OPEN.includes(o.status)) break;
    await sleep(2500);
    try { await rscApply(env, oid, await rscCall(env, 'GET', `/orders/${encodeURIComponent(number)}`)); } catch { break; }
  }
  await logOp(env, user.uid, 'rsc.order', { oid, cat: ckey, qty }, { number }, true);
  return rscOrderView(env, oid, user.uid);
}

// تطبيق حالة المزود على طلبنا (آمن للتكرار)
async function rscApply(env, oid, j) {
  const st = rscStatusOf(j);
  const o = await fsGet(env, `rsc_orders/${oid}`);
  if (!o || ['completed', 'refunded'].includes(o.status)) return;
  if (st === 'completed') {
    const codes = rscCodesOf(j);
    await fsPatch(env, `rsc_orders/${oid}`, { status: 'completed', codes_enc: await encCodes(env, `rsc:${oid}`, codes), codes_n: codes.length,
      completed_at: nowIso(), updated_at: nowIso(), charged_usd: num(j.charged_usd, 0) });
    notify(env, o.uid, 'rsc_done', { name: `${o.cat_name} — ${o.offer_name}`, codes: codes.length > 0 });
  } else if (st === 'failed' || st === 'refund' || st === 'refunded' || st === 'cancelled') {
    const code = String(j.fail_code || '').toLowerCase();
    await rscRefund(env, oid, RSC_FAIL_AR[code] || String(j.status_reason || 'تعذّر تنفيذ الطلب').slice(0, 120), 'system', code);
  } else if (st !== o.status) {
    await fsPatch(env, `rsc_orders/${oid}`, { status: st, updated_at: nowIso() });
  }
}

async function rscRefund(env, oid, reason, by, code) {
  let o0 = null;
  await fsRunTransaction(env, async (tx) => {
    const o = await tx.get(`rsc_orders/${oid}`);
    if (!o || ['refunded', 'completed'].includes(o.status)) return;
    o0 = o;
    const L = await ledgerOpen(tx, o.uid);
    await ledgerPost(L, { type: 'credit', amount: num(o.total_usd, 0), reason: 'rsc_refund', reference: oid, entryId: `txn_rsc_refund_${oid}`, created_by: by || 'system' });
    ledgerClose(tx, L, { total_spent: Math.max(0, round2(num(L.doc.total_spent, 0) - num(o.total_usd, 0))) });
    tx.update(`rsc_orders/${oid}`, { status: 'refunded', fail_reason: String(reason || '').slice(0, 160), fail_code: String(code || '').slice(0, 60), refunded_by: by || 'system', updated_at: nowIso() });
  });
  if (o0) notify(env, o0.uid, 'rsc_failed', { name: `${o0.cat_name} — ${o0.offer_name}`, amount: num(o0.total_usd, 0).toFixed(2), reason });
}

async function rscOrderView(env, oid, uid) {
  const o = await fsGet(env, `rsc_orders/${oid}`);
  if (!o || (uid && o.uid !== uid)) throw httpError(404, 'الطلب غير موجود');
  return { success: true, order: await rscPublic(env, { ...o, _id: oid }) };
}
async function rscPublic(env, o) {
  return { id: o._id, status: o.status, kind: o.kind, cat: o.cat || '', offer_id: o.offer_id || '', reviewed: o.reviewed === true, cat_name: o.cat_name, offer_name: o.offer_name, qty: o.qty, fields: o.fields || {},
    total_usd: num(o.total_usd, 0), created_at: o.created_at, fail_reason: o.fail_reason || '',
    codes: o.status === 'completed' && o.codes_enc ? (await decCodes(env, `rsc:${o._id}`, o.codes_enc)) || [] : [] };
}

async function handleRscMyOrders(user, body, env) {
  if (!memAllowWin(`rscmy_${user.uid}`, 120, 3600)) throw httpError(429, 'محاولات كثيرة');
  let docs;
  if (env.DB && await d1Table(env, 'rsc_orders')) {                 // v53: آخر 40 بالترتيب من الفهرس (بدل 60 عشوائية)
    const rows = await d1All(env, 'SELECT id, data FROM rsc_orders WHERE uid = ? ORDER BY created_at DESC LIMIT 40', [user.uid]);
    docs = rows.map(r => { let d = {}; try { d = JSON.parse(r.data); } catch {} return { ...d, _id: r.id }; });
  } else {
    const rows = await fsQueryRaw(env, { from: [{ collectionId: 'rsc_orders' }], where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: user.uid } } }, limit: 60 });
    docs = rows.map(r => withId(r, 'rsc_orders'));
  }
  const list = docs.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 40);
  const orders = [];
  for (const o of list) orders.push(await rscPublic(env, o));
  return { success: true, orders };
}

function rscAlertAdmins(env, oid, why) {
  background((async () => {
    const admins = await fsQueryRaw(env, { from: [{ collectionId: 'admins' }], limit: 30 }).catch(() => []);
    for (const a of admins.map(r => withId(r, 'admins')).filter(a => a.role === 'super_admin')) await pushInApp(env, a._id, 'rsc_admin', { oid, why }).catch(() => {});
  })());
}

/* ─── المتابعة الدورية (كل 5 دقائق) + تحديث العروض (كل ساعة) ─── */
async function rscCron(env, hourly) {
  if (!env.RSC_API_KEY) return;
  let polled = 0;
  for (const st of RSC_OPEN) {
    const rows = await fsQueryRaw(env, { from: [{ collectionId: 'rsc_orders' }],
      where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: st } } }, limit: 25 }).catch(() => []);
    for (const r of rows) {
      const o = withId(r, 'rsc_orders');
      if (!o.number || polled >= 15) continue;
      polled++;
      try { await rscApply(env, o._id, await rscCall(env, 'GET', `/orders/${encodeURIComponent(o.number)}`)); } catch {}
    }
  }
  if (!hourly) return;
  const cfg = await rscCfg(env);
  const on = Object.keys(cfg.cats).filter(k => cfg.cats[k] && cfg.cats[k].on === true).slice(0, 20);
  for (const k of on) { try { await rscFetchOffers(env, k); } catch {} }
  if (on.length) bustPublic();
  const cats = await rscKvGet(env, 'rsc:cats');
  if (!cats || Date.now() - num(cats.at, 0) > 86400000) await rscSyncCategories(env).catch(() => {});
}

/* ─── الأدمن ─── */
async function handleAdminRsc(user, body, env) {
  const action = String(body.action || 'state');
  const perm = ['state', 'orders'].includes(action) ? 'orders.view' : action === 'order' ? 'orders.approve' : 'store.edit';
  const staff = await requirePermission(user, env, perm);
  const s = await getSettings(env);
  const cfg = await rscCfg(env);

  if (action === 'state') {
    let me = null, err = '';
    try { me = await rscCall(env, 'GET', '/me'); } catch (e) { err = e.message; }
    let cats = await rscCats(env);
    if (!cats.length && env.RSC_API_KEY) { try { cats = await rscSyncCategories(env); } catch (e) { err = err || e.message; } }
    const list = [];
    for (const c of cats) {
      const cc = cfg.cats[c.key] || {};
      const off = cc.on ? await rscKvGet(env, 'rsc:off:' + c.key) : null;
      list.push({ key: c.key, type: c.type, name: c.name, alias: cc.name || '', on: cc.on === true, margin: cc.margin ?? '', sort: cc.sort ?? '', featured: cc.featured === true, promo: cc.promo || '', group: cc.group || '',
        image: rscImg(env, c.key, cfg, c), custom_img: !!cc.img_v, offers: off ? off.offers.length : null, synced_at: off ? off.at : null });
    }
    const bal = me && (me.balance_usd ?? me.balance ?? (me.account && me.account.balance));
    return { success: true, key_set: !!env.RSC_API_KEY, error: err, balance: bal == null ? null : num(bal, 0), me: me ? { email: me.email || '', limits: me.limits || me.rate_limits || null } : null,
      margin: num(s.rsc_margin_pct, 10), low: num(s.rsc_low_usd, 20), on: s.rsc_on !== false, cats: list };
  }
  if (action === 'sync') {
    const cats = await rscSyncCategories(env);
    let n = 0;
    for (const k of Object.keys(cfg.cats).filter(k => cfg.cats[k].on === true).slice(0, 20)) { try { await rscFetchOffers(env, k); n++; } catch {} }
    bustPublic();
    await logOp(env, staff.uid, 'rsc.sync', {}, { cats: cats.length, offers: n }, true);
    return { success: true, cats: cats.length, refreshed: n };
  }
  if (action === 'cat') {
    const key = String(body.key || '');
    if (!rscKeyOk(key)) throw httpError(400, 'قسم غير صالح');
    const cur = { ...(cfg.cats[key] || {}) };
    if ('on' in body) cur.on = body.on === true;
    if ('name' in body) cur.name = String(body.name || '').trim().slice(0, 60);
    if ('note' in body) cur.note = String(body.note || '').trim().slice(0, 300);
    if ('margin' in body) cur.margin = body.margin === '' || body.margin == null ? '' : Math.min(300, Math.max(0, num(body.margin, 0)));
    if ('sort' in body) cur.sort = body.sort === '' || body.sort == null ? '' : Math.floor(num(body.sort, 99));
    if ('featured' in body) cur.featured = body.featured === true;                                   // v53: يظهر في «عروض اليوم»
    if ('promo' in body) cur.promo = String(body.promo || '').replace(/[<>]/g, '').trim().slice(0, 70);
    if ('group' in body) cur.group = ['subs', 'apps', ''].includes(String(body.group || '')) ? String(body.group || '') : '';
    if ('image' in body) {
      const img = String(body.image || '');
      if (!img) { cur.img_v = 0; if (env.KV) await env.KV.delete('rsc:img:' + key).catch(() => {}); }
      else {
        const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(img);
        if (!m || m[2].length > 400000) throw httpError(400, 'صورة غير صالحة أو كبيرة');
        const bin = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
        if (env.KV) await env.KV.put('rsc:img:' + key, bin, { metadata: { type: m[1] } });
        cur.img_v = Date.now();
      }
    }
    if (cur.on) { try { await rscFetchOffers(env, key); } catch (e) { if (!(await rscKvGet(env, 'rsc:off:' + key))) throw httpError(502, 'تعذّر جلب عروض القسم: ' + e.message); } }
    cfg.cats[key] = cur;
    await rscCfgSave(env, cfg);
    await logOp(env, staff.uid, 'rsc.cat', { key }, { on: cur.on }, true);
    return { success: true };
  }
  if (action === 'orders') {
    const out = [];
    for (const st of ['unknown', 'submitting', 'created', 'processing', 'completed', 'refunded']) {
      const rows = await fsQueryRaw(env, { from: [{ collectionId: 'rsc_orders' }],
        where: { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: st } } }, limit: st === 'completed' || st === 'refunded' ? 40 : 30 }).catch(() => []);
      rows.forEach(r => { const o = withId(r, 'rsc_orders'); out.push({ id: o._id, uid: o.uid, status: o.status, cat_name: o.cat_name, offer_name: o.offer_name, qty: o.qty,
        total_usd: num(o.total_usd, 0), cost_usd: num(o.cost_usd, 0), number: o.number || '', fields: o.fields || {}, fail_reason: o.fail_reason || '', provider_error: o.provider_error || '', created_at: o.created_at }); });
    }
    out.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return { success: true, orders: out.slice(0, 150) };
  }
  if (action === 'order') {
    const oid = String(body.id || '');
    const o = await fsGet(env, `rsc_orders/${oid}`);
    if (!o) throw httpError(404, 'الطلب غير موجود');
    const op = String(body.op || '');
    if (op === 'recheck') {
      if (body.number) await fsPatch(env, `rsc_orders/${oid}`, { number: String(body.number).slice(0, 60), status: 'processing', updated_at: nowIso() });
      const n = String(body.number || o.number || '');
      if (!n) throw httpError(400, 'أدخل رقم الطلب لدى المزود');
      await rscApply(env, oid, await rscCall(env, 'GET', `/orders/${encodeURIComponent(n)}`));
    } else if (op === 'refund') {
      if (['completed', 'refunded'].includes(o.status)) throw httpError(409, 'الطلب مُغلق');
      await rscRefund(env, oid, String(body.reason || 'أُلغي الطلب وأُعيد المبلغ').slice(0, 160), staff.uid, 'admin');
    } else throw httpError(400, 'إجراء غير معروف');
    await logOp(env, staff.uid, 'rsc.order.' + op, { oid }, {}, true);
    return rscOrderView(env, oid, null);
  }
  throw httpError(400, 'إجراء غير معروف');
}

/* ═══ v48 — أداة الأدمن: البحث عن صاحب إيداع USDT واعتماده ═══ */
async function handleAdminUsdtFind(user, body, env) {
  await requirePermission(user, env, 'deposits.view');
  const amount = num(toLatinDigits(String(body.amount || '')).replace(/[^\d.]/g, ''), 0);
  const txid = String(body.txid || '').trim().toLowerCase().replace(/[^0-9a-zx_-]/g, '').slice(0, 90);
  if (!(amount > 0) && txid.length < 8) throw httpError(400, 'أدخل المبلغ أو رقم المعاملة (TxID)');
  const out = { success: true, invoices: [], txid_used: null };
  const rowsToInv = async rows => {
    const list = [];
    for (const r of rows) {
      let d = {}; try { d = JSON.parse(r.data); } catch {}
      const u = d.uid ? await fsGet(env, `users/${d.uid}`).catch(() => null) : null;
      list.push({ id: r.id, uid: d.uid || '', name: u ? (u.name || '') : '', email: u ? (u.email || '') : '', phone: u ? String(u.phone_verified || '') : '',
        amount: num(d.amount_usd, 0), pay_amount: num(d.pay_amount, 0), network: d.network || 'trc20', status: d.status || '',
        created_at: d.created_at || '', txid: d.txid || '' });
    }
    return list;
  };
  if (!env.DB) throw httpError(503, 'قاعدة البيانات غير متاحة');
  if (amount > 0) {
    const rows = await d1All(env, `SELECT id, data FROM usdt_invoices WHERE json_extract(data, '$.pay_amount') BETWEEN ? AND ? ORDER BY ts DESC LIMIT 20`,
      [round4(amount - (amount % 1 ? 0.00005 : 0)), round4(amount + (amount % 1 ? 0.00005 : 0.9999))]).catch(() => []);
    out.invoices = await rowsToInv(rows);
    if (!out.invoices.length) {        // قريب منه (اختلاف كسور بسيط)
      const near = await d1All(env, `SELECT id, data FROM usdt_invoices WHERE json_extract(data, '$.pay_amount') BETWEEN ? AND ? ORDER BY ts DESC LIMIT 20`,
        [Math.floor(amount) - 0.5, Math.floor(amount) + 1.5]).catch(() => []);
      out.invoices = await rowsToInv(near); out.near = true;
    }
  }
  if (txid) {
    const t = await d1All(env, `SELECT id, data FROM usdt_txids WHERE lower(id) LIKE ? LIMIT 5`, ['%' + txid.replace(/^0x/, '').slice(0, 40) + '%']).catch(() => []);
    if (t.length) { let d = {}; try { d = JSON.parse(t[0].data); } catch {} const u = d.uid ? await fsGet(env, `users/${d.uid}`).catch(() => null) : null;
      out.txid_used = { invoice_id: d.invoice_id || '', uid: d.uid || '', name: u ? u.name || '' : '', email: u ? u.email || '' : '', amount: num(d.amount, 0), at: d.created_at || '' }; }
  }
  return out;
}
function round4(x) { return Math.round(x * 10000) / 10000; }

// يعيد فحص الفاتورة على البلوكشين (حتى 48 ساعة بعد إنشائها) ويضيف الرصيد لصاحبها إن وُجد التحويل — آمن من التكرار
async function handleAdminUsdtCredit(user, body, env) {
  const staff = await requirePermission(user, env, 'deposits.approve');
  const id = String(body.invoice_id || '').trim();
  if (!/^INV\d+[A-Z0-9]{4}$/.test(id)) throw httpError(400, 'رقم الفاتورة غير صالح');
  const inv = await fsGet(env, `usdt_invoices/${id}`);
  if (!inv) throw httpError(404, 'الفاتورة غير موجودة');
  if (inv.status === 'paid') return { success: true, paid: true, already: true, credited: num(inv.received, 0) };
  if (inv.status === 'expired') await fsPatch(env, `usdt_invoices/${id}`, { status: 'awaiting', reopened_by: staff.uid });
  const network = inv.network && CRYPTO_NETS[inv.network] ? inv.network : 'trc20';
  let hit = null;
  try { hit = await findCryptoPayment(env, network, inv.address, num(inv.pay_amount, 0), num(inv.created_ms, 0) - 60000, Math.min(Date.now(), num(inv.created_ms, 0) + 48 * 3600000)); }
  catch (e) { if (inv.status === 'expired') await fsPatch(env, `usdt_invoices/${id}`, { status: 'expired' }).catch(() => {}); throw httpError(502, 'تعذّر الوصول للشبكة: ' + cryptoErrAr(e)); }
  const r = hit ? await settleInvoice(env, id, hit, staff.uid) : { paid: false };
  if (!r.paid && inv.status === 'expired') await fsPatch(env, `usdt_invoices/${id}`, { status: 'expired' }).catch(() => {});
  await logOp(env, staff.uid, 'deposit.usdt.admin_credit', { id }, { paid: !!r.paid, credited: r.credited || 0 }, true);
  return { success: true, paid: !!r.paid, credited: r.credited || 0, duplicate: !!r.dup };
}

/* ═══════════════════════════════════════════════════════════
   v49 — فواتير الإيداع: فحص تلقائي كل 5 دقائق (24 ساعة)،
   كشف التحويلات غير المطابقة / بدون صاحب، طرق متوقفة مؤقتًا، QR بايننس
   ═══════════════════════════════════════════════════════════ */
function methodPaused(s, key) {
  return String(s.paused_methods || '').split(',').map(x => x.trim()).filter(Boolean).includes(String(key));
}

async function invoiceCron(env) {
  if (!env.DB) return;
  const s = await getSettings(env);
  const now = Date.now();
  const since = now - 26 * 3600000;
  const rows = await d1All(env, `SELECT id, data FROM usdt_invoices WHERE status IN ('awaiting','cancelled') AND json_extract(data, '$.created_ms') > ? ORDER BY ts DESC LIMIT 200`, [since - 48 * 3600000]).catch(() => []);
  const open = rows.map(r => { let d = {}; try { d = JSON.parse(r.data); } catch {} return { ...d, _id: r.id }; });
  if (!open.length && new Date(now).getUTCMinutes() % 15 >= 5) return;     // لا فواتير مفتوحة: فحص التحويلات اليتيمة كل 15 دقيقة فقط
  let dep = [], pay = [];
  if (binanceReady(env)) {
    try { dep = await binanceDepositsRecent(env, 26); } catch (e) { console.error('INV_CRON_DEP', e.code || e.message); }
    try { if (s.binance_pay_on === true) pay = await binancePayRecent(env, 26); } catch (e) { console.error('INV_CRON_PAY', e.code || e.message); }
  }
  const close = (a, b) => Math.abs(a - b) < 0.00005;
  const matched = new Set();
  let chainChecks = 0;
  for (const inv of open) {
    const network = inv.network && CRYPTO_NETS[inv.network] ? inv.network : 'trc20';
    const want = num(inv.pay_amount, 0), from = num(inv.created_ms, 0) - 60000, until = Math.min(now, invCheckUntil(inv));
    if (invCheckUntil(inv) < now - 15 * 60000) { await fsPatch(env, `usdt_invoices/${inv._id}`, { status: inv.status === 'cancelled' ? 'cancelled_closed' : 'expired' }).catch(() => {}); continue; }
    let hit = null;
    if (network === 'binance_pay') {
      const t = pay.find(t => String(t.currency || '').toUpperCase() === 'USDT' && Number(t.amount) > 0 && !/REFUND|_RF$/i.test(String(t.orderType || ''))
        && Number(t.transactionTime || 0) >= from && Number(t.transactionTime || 0) <= until && close(Number(t.amount), want));
      if (t) hit = { txid: String(t.transactionId || t.orderId || '').replace(/[^0-9A-Za-z_-]/g, '').slice(0, 80), amount: Number(t.amount), from: String((t.payerInfo && (t.payerInfo.name || t.payerInfo.binanceId)) || '') };
    } else if (dep.length || binanceReady(env)) {
      const net = CRYPTO_NETS[network];
      const same = a => network === 'trc20' ? String(a || '') === inv.address : String(a || '').toLowerCase() === String(inv.address || '').toLowerCase();
      const d = dep.find(d => String(d.coin || '').toUpperCase() === 'USDT' && net.bnNets.includes(String(d.network || '').toUpperCase())
        && (Number(d.status) === 1 || Number(d.status) === 6) && same(d.address) && !d.addressTag
        && Number(d.insertTime || 0) >= from && Number(d.insertTime || 0) <= until && close(Number(d.amount), want));
      if (d) { const tx = String(d.txId || ''); const onChain = /^(0x)?[0-9a-fA-F]{64}$/.test(tx);
        hit = { txid: onChain ? tx : 'bn' + String(d.id || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 60), amount: Number(d.amount), from: onChain ? '' : 'Binance (تحويل داخلي)' }; }
    }
    if (!hit && !binanceReady(env) && chainChecks < 6) {   // بدون مفتاح بايننس: فحص الشبكة مباشرة (بحد أقصى 6 فواتير كل دورة)
      chainChecks++;
      try { hit = await findCryptoPayment(env, network, inv.address, want, from, until); } catch {}
    }
    if (hit) { matched.add(hit.txid); await settleInvoice(env, inv._id, hit, 'cron').catch(e => console.error('INV_SETTLE', e.message)); }
  }
  if (binanceReady(env)) await scanUnmatched(env, s, dep, pay).catch(e => console.error('UNMATCHED_SCAN', e.message));
}

// أي تحويل وصل ولم يرتبط بفاتورة → يُسجَّل للأدمن مع أقرب فاتورة، وتنبيه فوري
async function scanUnmatched(env, s, dep, pay) {
  const items = [];
  const addrs = Object.fromEntries(Object.entries(CRYPTO_NETS).filter(([k]) => k !== 'binance_pay').map(([k, n]) => [k, String(s[n.addrKey] || '').toLowerCase()]));
  for (const d of dep) {
    if (String(d.coin || '').toUpperCase() !== 'USDT' || !(Number(d.status) === 1 || Number(d.status) === 6) || d.addressTag) continue;
    const network = Object.keys(addrs).find(k => CRYPTO_NETS[k].bnNets.includes(String(d.network || '').toUpperCase()) && addrs[k] && addrs[k] === String(d.address || '').toLowerCase());
    if (!network) continue;
    const tx = String(d.txId || ''), onChain = /^(0x)?[0-9a-fA-F]{64}$/.test(tx);
    const txid = onChain ? tx : 'bn' + String(d.id || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 60);
    items.push({ network, txid, amount: Number(d.amount), at: Number(d.insertTime || 0) });
  }
  for (const t of pay) {
    if (String(t.currency || '').toUpperCase() !== 'USDT' || !(Number(t.amount) > 0) || /REFUND|_RF$/i.test(String(t.orderType || ''))) continue;
    items.push({ network: 'binance_pay', txid: String(t.transactionId || t.orderId || '').replace(/[^0-9A-Za-z_-]/g, '').slice(0, 80), amount: Number(t.amount), at: Number(t.transactionTime || 0),
      from: String((t.payerInfo && (t.payerInfo.name || t.payerInfo.binanceId)) || '').slice(0, 60) });
  }
  const fresh = items.filter(i => i.txid && Date.now() - i.at > 10 * 60000);   // نعطي الفاتورة 10 دقائق لتلتقطه أولًا
  if (!fresh.length) return;
  // فحص جماعي: ما سُجّل أو حُسب سابقًا يُستبعد بطلبين فقط (بدل 2–3 قراءات لكل تحويل كل 5 دقائق)
  for (const i of fresh) {
    i.norm = /^0x[0-9a-fA-F]{64}$/.test(i.txid) ? i.txid.toLowerCase() : i.txid;
    i.key = i.network === 'trc20' ? i.norm : `${i.network}_${i.norm}`;
    i.alt = i.network === 'trc20' ? i.txid : `${i.network}_${i.txid}`;
    i.uid = 'U' + (await sha256Hex(i.key)).slice(0, 30);
  }
  const known = new Set();
  if (env.DB && await d1Table(env, 'usdt_txids') && await d1Table(env, 'crypto_unmatched')) {
    const keys = [...new Set(fresh.flatMap(i => [i.key, i.alt]))].slice(0, 90), uids = fresh.map(i => i.uid).slice(0, 90);
    for (const r of await d1All(env, `SELECT id FROM usdt_txids WHERE id IN (${keys.map(() => '?').join(',')})`, keys)) known.add(r.id);
    for (const r of await d1All(env, `SELECT id FROM crypto_unmatched WHERE id IN (${uids.map(() => '?').join(',')})`, uids)) known.add(r.id);
  } else {
    for (const i of fresh) for (const k of [`usdt_txids/${i.key}`, `usdt_txids/${i.alt}`, `crypto_unmatched/${i.uid}`]) if (await fsGet(env, k).catch(() => null)) known.add(k.split('/')[1]);
  }
  for (const i of fresh) {
    if (known.has(i.key) || known.has(i.alt) || known.has(i.uid)) continue;
    const key = i.key, uid = i.uid;
    // أقرب فاتورة (نفس الشبكة، أُنشئت قبل التحويل بـ 24 ساعة كحد أقصى، فرق ≤ 0.5) — بحث بالفهرس على التاريخ
    const near = await d1All(env, `SELECT id, data FROM usdt_invoices WHERE created_at BETWEEN ? AND ? AND json_extract(data, '$.network') = ?
      AND abs(json_extract(data, '$.pay_amount') - ?) <= 0.5 ORDER BY abs(json_extract(data, '$.pay_amount') - ?) LIMIT 1`,
      [new Date(i.at - 24 * 3600000).toISOString(), new Date(i.at + 60000).toISOString(), i.network, i.amount, i.amount]).catch(() => []);
    let cand = null;
    if (near[0]) { let d = {}; try { d = JSON.parse(near[0].data); } catch {} cand = { invoice_id: near[0].id, uid: d.uid || '', pay_amount: num(d.pay_amount, 0), status: d.status || '', diff: round4(i.amount - num(d.pay_amount, 0)) }; }
    await fsSet(env, `crypto_unmatched/${uid}`, { key, txid: i.txid, network: i.network, amount: i.amount, at_ms: i.at, from: i.from || '',
      status: 'open', kind: cand && cand.status !== 'paid' ? 'mismatch' : 'orphan', candidate: cand, created_at: nowIso() });
    background((async () => {
      const admins = await fsQueryRaw(env, { from: [{ collectionId: 'admins' }], limit: 30 }).catch(() => []);
      for (const a of admins.map(r => withId(r, 'admins')).filter(a => a.role === 'super_admin' || staffCan(a, 'deposits.approve')))
        await notifyUser(env, a._id, 'crypto_unmatched', { amount: i.amount.toFixed(4), network: (CRYPTO_NETS[i.network] || {}).label || i.network }).catch(() => {});
    })());
  }
}

async function handleAdminUnmatched(user, body, env) {
  const action = String(body.action || 'list');
  const staff = await requirePermission(user, env, action === 'list' ? 'deposits.view' : 'deposits.approve');
  if (action === 'list') {
    const rows = await d1All(env, `SELECT id, data FROM crypto_unmatched WHERE status = 'open' ORDER BY ts DESC LIMIT 50`).catch(() => []);
    const items = rows.map(r => { let d = {}; try { d = JSON.parse(r.data); } catch {} return { id: r.id, ...d }; });
    const names = await userNamesMap(env, items.map(d => d.candidate && d.candidate.uid).filter(Boolean));
    const list = items.map(d => ({ ...d, candidate_user: (d.candidate && names.get(d.candidate.uid)) || null }));
    return { success: true, items: list };
  }
  const id = String(body.id || '');
  if (!/^U[0-9a-f]{30}$/.test(id)) throw httpError(400, 'معرّف غير صالح');
  const it = await fsGet(env, `crypto_unmatched/${id}`);
  if (!it || it.status !== 'open') throw httpError(409, 'تمت معالجته مسبقًا');
  if (action === 'ignore') {
    await fsPatch(env, `crypto_unmatched/${id}`, { status: 'ignored', resolved_by: staff.uid, resolved_at: nowIso() });
    await logOp(env, staff.uid, 'crypto.unmatched.ignore', { id }, {}, true);
    return { success: true };
  }
  if (action !== 'assign') throw httpError(400, 'إجراء غير معروف');
  // إسناد للمستخدم: إما عبر فاتورة (المرشّحة) أو عبر البريد
  let uid = '', invoiceId = '';
  if (body.invoice_id) {
    invoiceId = String(body.invoice_id);
    if (!/^INV\d+[A-Z0-9]{4}$/.test(invoiceId)) throw httpError(400, 'رقم الفاتورة غير صالح');
    const inv = await fsGet(env, `usdt_invoices/${invoiceId}`);
    if (!inv) throw httpError(404, 'الفاتورة غير موجودة');
    uid = inv.uid;
  } else {
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpError(400, 'أدخل بريد المستخدم');
    const r = await fsQueryRaw(env, { from: [{ collectionId: 'users' }], where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: email } } }, limit: 2 });
    if (r.length !== 1) throw httpError(404, 'ما لقينا مستخدم بهذا البريد');
    uid = withId(r[0], 'users')._id;
  }
  const amt = round2(num(it.amount, 0));
  if (!(amt > 0)) throw httpError(400, 'مبلغ غير صالح');
  const s = await getSettings(env);
  const depId = 'UNM' + id.slice(1, 25);
  await fsRunTransaction(env, async (tx) => {
    const cur = await tx.get(`crypto_unmatched/${id}`);
    if (!cur || cur.status !== 'open') throw httpError(409, 'تمت معالجته مسبقًا');
    if (await tx.get(`usdt_txids/${cur.key}`)) throw httpError(409, 'هذه المعاملة محسوبة مسبقًا');
    const L = await ledgerOpen(tx, uid);
    await ledgerPost(L, { type: 'credit', amount: amt, reason: 'usdt_deposit', reference: String(cur.txid).slice(0, 100), entryId: `txn_unm_${id}`, created_by: staff.uid });
    ledgerClose(tx, L);
    await dailyCheckTx(tx, s, uid, 'deposit', amt);
    tx.create('usdt_txids', cur.key, { invoice_id: invoiceId, uid, amount: amt, network: cur.network, from: String(cur.from || '').slice(0, 60), by: staff.uid, created_at: nowIso() });
    if (invoiceId) {
      const inv = await tx.get(`usdt_invoices/${invoiceId}`);
      if (inv && inv.status !== 'paid') tx.update(`usdt_invoices/${invoiceId}`, { status: 'paid', txid: cur.txid, paid_at: nowIso(), received: amt, late: true, paid_by: staff.uid });
    }
    tx.create('wallet_deposits', depId, { uid, amount_usd: amt, amount_lyd: 0, method: `${(CRYPTO_NETS[cur.network] || {}).label || 'USDT'} — اعتماد إداري`, proof_url: '',
      note: String(cur.txid).slice(0, 14) + '…', status: 'approved', auto: false, created_at: nowIso(), reviewed_by: staff.uid });
    tx.update(`crypto_unmatched/${id}`, { status: 'assigned', uid, invoice_id: invoiceId, resolved_by: staff.uid, resolved_at: nowIso() });
  });
  await logOp(env, staff.uid, 'crypto.unmatched.assign', { id, uid, invoiceId }, { amount: amt }, true);
  notify(env, uid, 'deposit_ok', { amount: amt.toFixed(2), method: 'USDT' });
  background(promoFirstDeposit(env, uid, amt, id));
  return { success: true, credited: amt };
}

// لوحة الفواتير للأدمن: إحصاء اليوم + آخر الفواتير بسجلها
async function handleAdminInvoices(user, body, env) {
  await requirePermission(user, env, 'deposits.view');
  const days = Math.min(30, Math.max(1, Math.floor(num(body.days, 1))));
  const since = Date.now() - days * 86400000;
  const q = String(body.q || '').trim().toLowerCase().slice(0, 60);
  const rows = await d1All(env, `SELECT id, data FROM usdt_invoices WHERE created_at > ? ORDER BY created_at DESC LIMIT 400`, [new Date(since).toISOString()]).catch(() => []);
  const all = rows.map(r => { let d = {}; try { d = JSON.parse(r.data); } catch {} return { ...d, _id: r.id }; });
  const stats = { opened: all.length, paid: 0, expired: 0, open: 0, sum_paid: 0, by_net: {} };
  for (const v of all) {
    if (v.status === 'paid') { stats.paid++; stats.sum_paid = round2(stats.sum_paid + num(v.received, 0)); const k = v.network || 'trc20'; stats.by_net[k] = round2((stats.by_net[k] || 0) + num(v.received, 0)); }
    else if (INV_OPEN.includes(v.status) && invCheckUntil(v) > Date.now()) stats.open++;
    else stats.expired++;
  }
  const names = await userNamesMap(env, all.slice(0, 120).map(v => v.uid));
  const out = [];
  for (const v of all.slice(0, 120)) {
    const u = names.get(v.uid) || { name: '', email: '' };
    const row = { ...invView(v), uid: v.uid, name: u.name, email: u.email, paid_by: v.paid_by || '', cancelled_at: v.cancelled_at || '', created_at: v.created_at || '' };
    if (q && !(`${row.no} ${row.name} ${row.email} ${row.pay_amount}`.toLowerCase().includes(q))) continue;
    out.push(row);
  }
  return { success: true, stats, invoices: out.slice(0, 80) };
}

// QR حساب Binance Pay (يرفعه الأدمن مرة واحدة)
async function handleAdminBinanceQr(user, body, env) {
  const staff = await requirePermission(user, env, 'settings.manage');
  requireFreshAuth(user);
  if (!memAllowWin(`bpq_${user.uid}`, 20, 3600)) throw httpError(429, 'محاولات كثيرة');
  const img = String(body.image || '');
  if (!env.KV) throw httpError(503, 'التخزين غير متاح');
  if (!img) { await env.KV.delete('img:bpq'); await saveSettingsPatch(env, { binance_pay_qr_v: 0 }); return { success: true }; }
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(img);
  if (!m || m[2].length > 400000) throw httpError(400, 'صورة غير صالحة أو كبيرة');
  const bin = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
  await env.KV.put('img:bpq', bin, { metadata: { type: m[1] } });
  await saveSettingsPatch(env, { binance_pay_qr_v: Date.now() });
  await logOp(env, staff.uid, 'settings.binance_qr', {}, {}, true);
  return { success: true };
}
async function serveBinanceQr(env) {
  const kv = env.KV ? await env.KV.getWithMetadata('img:bpq', 'arrayBuffer').catch(() => null) : null;
  if (!kv || !kv.value) return new Response('Not found', { status: 404 });
  return new Response(kv.value, { headers: { 'content-type': (kv.metadata && kv.metadata.type) || 'image/png', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' } });
}

// أسماء وبريد عدة مستخدمين بطلب واحد (بدل قراءة مستند لكل مستخدم)
async function userNamesMap(env, uids) {
  const ids = [...new Set(uids.filter(u => typeof u === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(u)))].slice(0, 100);
  const m = new Map();
  if (!ids.length) return m;
  if (env.DB && await d1Table(env, 'users')) {
    const rows = await d1All(env, `SELECT id, json_extract(data, '$.name') AS name, json_extract(data, '$.email') AS email FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ids).catch(() => []);
    for (const r of rows) m.set(r.id, { name: r.name || '', email: r.email || '' });
    return m;
  }
  for (const u of ids) { const d = await fsGet(env, `users/${u}`).catch(() => null); if (d) m.set(u, { name: d.name || '', email: d.email || '' }); }
  return m;
}
async function saveSettingsPatch(env, ops) { await fsPatch(env, 'settings/main', ops); clearSettingsCache(); }


/* ═══ v51 — لوحة الإدارة: ملخص بطلب واحد (بدل الاشتراك في 7 مجموعات كل دقيقة) ═══ */
const _ovMem = new Map();
let _rscBalMem = { v: null, exp: 0 };
async function d1Count(env, coll, where, args) {
  if (!(await d1Table(env, coll))) return 0;
  const r = await d1All(env, `SELECT COUNT(*) AS n FROM "${coll}" WHERE ${where}`, args || []).catch(() => [{ n: 0 }]);
  return num(r[0] && r[0].n, 0);
}
async function d1Sum(env, coll, expr, where, args) {
  if (!(await d1Table(env, coll))) return { n: 0, s: 0, s2: 0 };
  const r = await d1All(env, `SELECT COUNT(*) AS n, COALESCE(SUM(${expr[0]}), 0) AS s${expr[1] ? `, COALESCE(SUM(${expr[1]}), 0) AS s2` : ''} FROM "${coll}" WHERE ${where}`, args || []).catch(() => [{}]);
  return { n: num(r[0] && r[0].n, 0), s: round2(num(r[0] && r[0].s, 0)), s2: round2(num(r[0] && r[0].s2, 0)) };
}
async function handleAdminOverview(user, body, env) {
  const staff = await getStaff(env, user.uid);
  if (!staff) throw httpError(403, 'غير مصرّح');
  if (!env.DB) throw httpError(503, 'قاعدة البيانات غير متاحة');
  const can = p => staffCan(staff, p);
  const ck = staff.role === 'super_admin' ? '*' : JSON.stringify(staff.perms || staff.role);
  const hit = _ovMem.get(ck);
  if (hit && hit.exp > Date.now() && !body.fresh) return hit.v;
  const day0 = new Date(todayKey() + 'T00:00:00+02:00').toISOString();
  const y0 = new Date(Date.parse(day0) - 86400000).toISOString();
  const out = { success: true, at: Date.now(), attn: {}, today: {}, yesterday: {} };
  const J = (f) => `json_extract(data, '$.${f}')`;
  const jobs = [];
  if (can('deposits.view')) {
    jobs.push(d1Sum(env, 'wallet_deposits', [J('amount_usd')], `status = 'pending'`).then(r => { out.attn.deposits = r.n; out.attn.deposits_usd = r.s; }));
    jobs.push(d1Count(env, 'crypto_unmatched', `status = 'open'`).then(n => { out.attn.unmatched = n; }));
    jobs.push(d1Sum(env, 'wallet_deposits', [J('amount_usd')], `status = 'approved' AND created_at >= ?`, [day0]).then(r => { out.today.deposits = r.s; out.today.deposits_n = r.n; }));
    jobs.push(d1Count(env, 'usdt_invoices', `status = 'paid' AND created_at >= ?`, [day0]).then(n => { out.today.invoices_paid = n; }));
  }
  if (can('withdraw.view')) jobs.push(d1Count(env, 'withdrawals', `status = 'pending'`).then(n => { out.attn.withdrawals = n; }));
  if (can('sms.view')) jobs.push(d1Count(env, 'sms_transactions', `status = 'review'`).then(n => { out.attn.sms = n; }));
  if (can('tickets.view')) jobs.push(d1Count(env, 'tickets', `status = 'open'`).then(n => { out.attn.tickets = n; }));
  if (can('mcards.view')) jobs.push(d1Count(env, 'manual_card_orders', `status = 'pending'`).then(n => { out.attn.mcards = n; }));
  if (can('orders.view')) {
    jobs.push(d1Count(env, 'rsc_orders', `status = 'unknown' OR (status IN ('submitting','created','processing') AND created_at < ?)`, [new Date(Date.now() - 20 * 60000).toISOString()]).then(n => { out.attn.rsc = n; }));
    jobs.push(d1Sum(env, 'rsc_orders', [J('total_usd'), J('cost_usd')], `status = 'completed' AND created_at >= ?`, [day0]).then(r => { out.today.sales = r.s; out.today.orders = r.n; out.today.profit = round2(r.s - r.s2); }));
    jobs.push(d1Sum(env, 'rsc_orders', [J('total_usd')], `status = 'completed' AND created_at >= ? AND created_at < ?`, [y0, day0]).then(r => { out.yesterday.sales = r.s; }));
    if (env.RSC_API_KEY) jobs.push((async () => {
      if (_rscBalMem.exp > Date.now()) { out.rsc_balance = _rscBalMem.v; return; }
      try { const me = await rscCall(env, 'GET', '/me'); const b = me && (me.balance_usd ?? me.balance ?? (me.account && me.account.balance)); _rscBalMem = { v: b == null ? null : num(b, 0), exp: Date.now() + 300000 }; out.rsc_balance = _rscBalMem.v; }
      catch { _rscBalMem = { v: null, exp: Date.now() + 60000 }; }
    })());
  }
  if (can('users.view')) jobs.push(d1All(env, `SELECT COUNT(*) AS n, SUM(CASE WHEN ${J('phone_verified')} IS NOT NULL AND ${J('phone_verified')} != '' THEN 1 ELSE 0 END) AS v FROM users WHERE created_at >= ?`, [day0])
    .then(r => { out.today.users = num(r[0] && r[0].n, 0); out.today.users_verified = num(r[0] && r[0].v, 0); }).catch(() => {}));
  await Promise.all(jobs.map(j => j.catch(e => console.error('OVERVIEW', e.message))));
  _ovMem.set(ck, { v: out, exp: Date.now() + 30000 });
  if (_ovMem.size > 50) _ovMem.clear();
  return out;
}

// بحث العملاء من الخادم (30 نتيجة كحد أقصى) بدل تحميل 150 مستخدم كل دقيقة
async function handleAdminUsersFind(user, body, env) {
  await requirePermission(user, env, 'users.view');
  if (!memAllowWin(`ufind_${user.uid}`, 300, 3600)) throw httpError(429, 'محاولات كثيرة');
  const q = String(body.q || '').trim().toLowerCase().slice(0, 60);
  const view = r => ({ id: r.id, name: r.name || '', email: r.email || '', phone_verified: r.phone_verified || '', wallet_balance: num(r.wallet_balance, 0), total_spent: num(r.total_spent, 0),
    banned: r.banned === true, plan: r.plan || 'free', plan_expires_ms: num(r.plan_expires_ms, 0), created_at: r.created_at || '', email_verified: r.email_verified === true });
  if (!env.DB || !(await d1Table(env, 'users'))) throw httpError(503, 'قاعدة البيانات غير متاحة');
  const SEL = `SELECT id, json_extract(data, '$.name') AS name, email, json_extract(data, '$.phone_verified') AS phone_verified, json_extract(data, '$.wallet_balance') AS wallet_balance,
    json_extract(data, '$.total_spent') AS total_spent, json_extract(data, '$.banned') AS banned, json_extract(data, '$.plan') AS plan, json_extract(data, '$.plan_expires_ms') AS plan_expires_ms,
    created_at, json_extract(data, '$.email_verified') AS email_verified FROM users`;
  let rows;
  if (!q) rows = await d1All(env, `${SEL} ORDER BY created_at DESC LIMIT 30`);
  else if (/^[a-z0-9_-]{20,40}$/i.test(q) && !q.includes('@')) rows = await d1All(env, `${SEL} WHERE id = ? LIMIT 1`, [String(body.q).trim()]);
  else if (q.includes('@')) rows = await d1All(env, `${SEL} WHERE email = ? OR email LIKE ? LIMIT 30`, [q, q.replace(/[%_]/g, '') + '%']);
  else {
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 6) rows = await d1All(env, `${SEL} WHERE CAST(json_extract(data, '$.phone_verified') AS TEXT) LIKE ? LIMIT 30`, ['%' + digits.replace(/^0/, '').slice(-9) + '%']);
    else rows = await d1All(env, `${SEL} WHERE json_extract(data, '$.name') LIKE ? OR email LIKE ? ORDER BY created_at DESC LIMIT 30`, ['%' + q.replace(/[%_]/g, '') + '%', q.replace(/[%_]/g, '') + '%']);
  }
  rows = rows.map(r => ({ ...r, banned: r.banned === 1 || r.banned === true, email_verified: r.email_verified === 1 || r.email_verified === true }));
  return { success: true, users: rows.map(view) };
}

// ملف العميل: كل ما يحتاجه الأدمن بطلب واحد وبحدود صغيرة
async function handleAdminUserFile(user, body, env) {
  const staff = await requirePermission(user, env, 'users.view');
  if (!memAllowWin(`ufile_${user.uid}`, 300, 3600)) throw httpError(429, 'محاولات كثيرة');
  const uid = String(body.uid || '').trim();
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) throw httpError(400, 'معرّف غير صالح');
  const u = await fsGet(env, `users/${uid}`);
  if (!u) throw httpError(404, 'العميل غير موجود');
  const L = async (coll, n, order = 'created_at') => {
    if (!env.DB || !(await d1Table(env, coll))) return [];
    const rows = await d1All(env, `SELECT id, data FROM "${coll}" WHERE uid = ? ORDER BY ${order} DESC LIMIT ?`, [uid, n]).catch(() => []);
    return rows.map(r => { let d = {}; try { d = JSON.parse(r.data); } catch {} return { id: r.id, ...d }; });
  };
  const pick = (o, ks) => Object.fromEntries(ks.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
  const [led, deps, rsc, inv, tks, wds] = await Promise.all([
    L('wallet_transactions', 25), staffCan(staff, 'deposits.view') ? L('wallet_deposits', 10) : null, staffCan(staff, 'orders.view') ? L('rsc_orders', 10) : null,
    staffCan(staff, 'deposits.view') ? L('usdt_invoices', 10) : null, staffCan(staff, 'tickets.view') ? L('tickets', 5, 'updated_at') : null, staffCan(staff, 'withdraw.view') ? L('withdrawals', 5) : null]);
  return { success: true,
    user: { id: uid, ...pick(u, ['name', 'email', 'phone_verified', 'wallet_balance', 'total_spent', 'banned', 'ban_reason', 'plan', 'plan_expires_ms', 'created_at', 'email_verified', 'last_seen_at']) },
    ledger: led.map(t => pick(t, ['id', 'type', 'amount', 'reason', 'reference', 'balance_after', 'created_at', 'note'])),
    deposits: deps && deps.map(d => pick(d, ['id', 'method', 'amount_usd', 'amount_lyd', 'status', 'created_at'])),
    orders: rsc && rsc.map(o => pick(o, ['id', 'cat_name', 'offer_name', 'qty', 'total_usd', 'status', 'created_at'])),
    invoices: inv && inv.map(v => invView({ ...v, _id: v.id })),
    tickets: tks && tks.map(t => pick(t, ['id', 'subject', 'status', 'updated_at', 'created_at'])),
    withdrawals: wds && wds.map(w => pick(w, ['id', 'method', 'amount_usd', 'status', 'created_at'])) };
}


/* ═══════════════════════════════════════════════════════════
   v52 — خزنة بيانات البطاقة: تبقى محفوظة مشفّرة، وتُعرض بالرمز السري (PIN) على جهاز مؤكَّد بالبريد
   • الرمز لا يُخزَّن: HMAC بمفتاح سري في Cloudflare + ملح لكل مستخدم — لا يمكن تخمينه حتى لو سُرّبت القاعدة
   • 5 محاولات خاطئة = قفل، ولا يُفتح إلا بكود البريد
   • الأدمن لا يرى البيانات أبدًا
   ═══════════════════════════════════════════════════════════ */
const CARD_DEV_DAYS = 90;
async function cardHmac(env, msg) {
  const hex = String(env.CARD_MASTER_KEY || '');
  if (hex.length !== 64) throw httpError(500, 'مفتاح التشفير غير مضبوط');
  const raw = new Uint8Array(32); for (let i = 0; i < 32; i++) raw[i] = parseInt(hex.substr(i * 2, 2), 16);
  const k = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('kardo-card-pin-v1|' + msg)));
  return [...sig].map(b => b.toString(16).padStart(2, '0')).join('');
}
function pinOk(pin) {
  if (!/^\d{4}$/.test(pin)) return 'الرمز 4 أرقام';
  if (/^(\d)\1{3}$/.test(pin)) return 'رمز سهل جدًا — لا تكرر نفس الرقم';
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) return 'رمز سهل جدًا — لا تستعمل أرقامًا متتالية';
  return '';
}
async function cardDeviceOk(env, uid, token) {
  token = String(token || '');
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return false;
  const h = (await sha256Hex('cdev:' + token)).slice(0, 32);
  const d = await fsGet(env, `card_devices/${uid}_${h}`).catch(() => null);
  return !!(d && d.uid === uid && num(d.exp_ms, 0) > Date.now());
}
async function handleCardSecStatus(user, body, env) {
  if (!memAllowWin(`csec_${user.uid}`, 120, 3600)) throw httpError(429, 'محاولات كثيرة');
  const [p, u] = await Promise.all([fsGet(env, `card_pins/${user.uid}`).catch(() => null), fsGet(env, `users/${user.uid}`).catch(() => null)]);
  const email = String((u && u.email) || user.email || '');
  return { success: true, has_pin: !!(p && p.hash), locked: !!(p && p.locked), device_ok: await cardDeviceOk(env, user.uid, body.device),
    email: email.replace(/^(.{2}).*(@.*)$/, '$1•••$2'), mail_on: mailOn(env) };
}
async function handleCardSecCode(user, body, env) {
  if (!mailOn(env)) throw httpError(503, 'البريد غير متاح حاليًا — تواصل مع الدعم');
  const purpose = body.purpose === 'reset' ? 'reset' : 'device';
  const u = await fsGet(env, `users/${user.uid}`);
  const email = String((u && u.email) || '').trim().toLowerCase();
  if (!/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(email)) throw httpError(400, 'لا يوجد بريد صالح في حسابك');
  if (!(await checkRateLimit(env, `ccode_${user.uid}`, 5, 3600))) throw httpError(429, 'طلبات كثيرة — حاول بعد ساعة');
  const b = crypto.getRandomValues(new Uint32Array(1))[0];
  const code = String(100000 + (b % 900000));
  await fsSet(env, `card_codes/${user.uid}`, { hash: await sha256Hex(`ccode:${user.uid}:${code}`), purpose, attempts: 0, expires_ms: Date.now() + 10 * 60000, created_at: nowIso() });
  const [title, lines] = MAIL.card_code({ code, purpose });
  const ok = await sendEmail(env, email, `كاردو — ${title}`, mailLayout(env, title, lines, ''));
  if (!ok) throw httpError(502, 'تعذّر إرسال البريد — حاول بعد قليل');
  await logOp(env, user.uid, 'card.sec.code', { purpose }, {}, true);
  return { success: true, sent_to: email.replace(/^(.{2}).*(@.*)$/, '$1•••$2') };
}
async function handleCardSecVerify(user, body, env, request) {
  const code = toLatinDigits(body.code || '').replace(/\D/g, '');
  if (code.length !== 6) throw httpError(400, 'الكود 6 أرقام');
  const pin = toLatinDigits(body.pin || '').replace(/\D/g, '');
  const cur = await fsGet(env, `card_pins/${user.uid}`).catch(() => null);
  const res = await fsRunTransaction(env, async (tx) => {
    const d = await tx.get(`card_codes/${user.uid}`);
    if (!d) throw httpError(404, 'اطلب كودًا جديدًا');
    if (num(d.expires_ms, 0) < Date.now()) { tx.delete(`card_codes/${user.uid}`); return { st: 'expired' }; }
    if (num(d.attempts, 0) >= 5) { tx.delete(`card_codes/${user.uid}`); return { st: 'locked' }; }
    if (!(await safeEqual(await sha256Hex(`ccode:${user.uid}:${code}`), d.hash))) { tx.update(`card_codes/${user.uid}`, { attempts: num(d.attempts, 0) + 1 }); return { st: 'wrong' }; }
    const needPin = d.purpose === 'reset' || !(cur && cur.hash);
    if (needPin) { const why = pinOk(pin); if (why) throw httpError(400, why); }
    tx.delete(`card_codes/${user.uid}`);
    return { st: 'ok', needPin };
  });
  if (res.st === 'expired') throw httpError(410, 'انتهت صلاحية الكود — اطلب كودًا جديدًا');
  if (res.st === 'locked') throw httpError(429, 'محاولات كثيرة — اطلب كودًا جديدًا');
  if (res.st === 'wrong') throw httpError(400, 'الكود غير صحيح');
  if (res.needPin) {
    const salt = bytesToB64url(crypto.getRandomValues(new Uint8Array(16)));
    await fsSet(env, `card_pins/${user.uid}`, { hash: await cardHmac(env, `${user.uid}:${salt}:${pin}`), salt, fails: 0, locked: false, set_at: nowIso() });
  }
  const token = bytesToB64url(crypto.getRandomValues(new Uint8Array(32)));
  const h = (await sha256Hex('cdev:' + token)).slice(0, 32);
  await fsSet(env, `card_devices/${user.uid}_${h}`, { uid: user.uid, exp_ms: Date.now() + CARD_DEV_DAYS * 86400000, created_at: nowIso(),
    ua: String(request.headers.get('user-agent') || '').slice(0, 120) });
  await logOp(env, user.uid, res.needPin ? 'card.sec.pin_set' : 'card.sec.device', {}, {}, true);
  return { success: true, device: token, pin_set: res.needPin };
}
async function cardPinCheck(env, uid, pin) {
  return fsRunTransaction(env, async (tx) => {
    const p = await tx.get(`card_pins/${uid}`);
    if (!p || !p.hash) throw httpError(428, 'أنشئ رمزك السري أولًا');
    if (p.locked) throw httpError(423, 'الرمز مقفول بعد محاولات خاطئة — استعمل «نسيت الرمز»');
    const ok = await safeEqual(await cardHmac(env, `${uid}:${p.salt}:${pin}`), p.hash);
    if (!ok) {
      const fails = num(p.fails, 0) + 1;
      tx.update(`card_pins/${uid}`, { fails, locked: fails >= 5, last_fail_at: nowIso() });
      return { ok: false, left: Math.max(0, 5 - fails) };
    }
    if (num(p.fails, 0)) tx.update(`card_pins/${uid}`, { fails: 0 });
    return { ok: true };
  });
}
async function handleCardSecChange(user, body, env) {
  if (!(await cardDeviceOk(env, user.uid, body.device))) throw httpError(401, 'أكّد جهازك أولًا بكود البريد');
  const oldPin = toLatinDigits(body.old_pin || '').replace(/\D/g, ''), pin = toLatinDigits(body.pin || '').replace(/\D/g, '');
  const why = pinOk(pin); if (why) throw httpError(400, why);
  const r = await cardPinCheck(env, user.uid, oldPin);
  if (!r.ok) throw httpError(400, r.left ? `الرمز الحالي غير صحيح — باقي ${r.left} محاولات` : 'قُفل الرمز — استعمل «نسيت الرمز»');
  const salt = bytesToB64url(crypto.getRandomValues(new Uint8Array(16)));
  await fsSet(env, `card_pins/${user.uid}`, { hash: await cardHmac(env, `${user.uid}:${salt}:${pin}`), salt, fails: 0, locked: false, set_at: nowIso() });
  await logOp(env, user.uid, 'card.sec.pin_change', {}, {}, true);
  return { success: true };
}
// بطاقات قديمة (قبل الخزنة): نُنشئ خزنتها من بيانات العرض المؤقتة إن كانت ما زالت موجودة
async function cardVaultMigrate(env, card, cardId) {
  let rid = card.reveal_order || '';
  if (!rid) {
    const rows = await fsQueryRaw(env, { from: [{ collectionId: 'manual_card_orders' }], where: qEq('card_id', cardId), limit: 10 }).catch(() => []);
    const o = rows.map(r => withId(r, 'manual_card_orders')).find(x => x.kind === 'create' && x.status === 'completed');
    rid = o ? o._id : '';
  }
  if (!rid) return null;
  const rv = await fsGet(env, `manual_card_reveal/${rid}`).catch(() => null);
  if (!rv || rv.uid !== card.uid || !rv.encrypted_data) return null;
  const d = await decryptAny(env, `card:${rid}`, rv.encrypted_data);
  let cvv = '';
  const cv = await fsGet(env, `card_cvv_once/${rid}`).catch(() => null);
  if (cv && cv.uid === card.uid && cv.enc) { try { cvv = (await decryptAny(env, `cvv:${rid}`, cv.enc)).cvv || ''; } catch {} }
  const pan = String(d.card_number || '');
  const enc = await encryptV2(env, `vault:${cardId}`, { card_number: pan, expiry: d.expiry || '', cvv });
  await fsSet(env, `card_vault/${cardId}`, { uid: card.uid, enc, first6: pan.slice(0, 6), last4: pan.slice(-4), created_at: nowIso(), by: 'migrate' });
  await fsPatch(env, `manual_cards/${cardId}`, { vault: true, first6: pan.slice(0, 6) }).catch(() => {});
  return { enc };
}
async function handleCardVaultReveal(user, body, env, request) {
  const cardId = String(body.card_id || '').trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(cardId)) throw httpError(400, 'بطاقة غير صالحة');
  if (!(await checkRateLimit(env, `vrev_${user.uid}`, 30, 3600))) throw httpError(429, 'بلغت حد عرض البيانات — انتظر ساعة');
  if (!(await cardDeviceOk(env, user.uid, body.device))) throw httpError(401, 'أكّد جهازك أولًا بكود البريد');
  const pin = toLatinDigits(body.pin || '').replace(/\D/g, '');
  if (!/^\d{4}$/.test(pin)) throw httpError(400, 'اكتب رمزك السري (4 أرقام)');
  const card = await fsGet(env, `manual_cards/${cardId}`);
  if (!card || card.uid !== user.uid) throw httpError(404, 'البطاقة غير موجودة');
  if (card.status === 'frozen') throw httpError(423, 'البطاقة مجمّدة مؤقتًا — تواصل مع الدعم');
  if (card.status !== 'active') throw httpError(410, 'البطاقة موقوفة');
  const r = await cardPinCheck(env, user.uid, pin);
  if (!r.ok) {
    await logOp(env, user.uid, 'card.vault.bad_pin', { cardId }, { left: r.left }, false);
    throw httpError(400, r.left ? `الرمز غير صحيح — باقي ${r.left} محاولات` : 'قُفل الرمز بعد 5 محاولات — استعمل «نسيت الرمز»');
  }
  let v = await fsGet(env, `card_vault/${cardId}`).catch(() => null);
  if (v && v.uid !== user.uid) throw httpError(404, 'البطاقة غير موجودة');
  if (!v) v = await cardVaultMigrate(env, card, cardId).catch(e => { console.error('VAULT_MIGRATE', e.message); return null; });
  if (!v) throw httpError(404, 'بيانات هذه البطاقة غير محفوظة — تواصل مع الدعم لتحديثها');
  let d;
  try { d = await decryptAny(env, `vault:${cardId}`, v.enc); } catch { console.error('VAULT_DECRYPT_FAILED'); throw httpError(500, 'خطأ في فك تشفير البيانات'); }
  await fsSet(env, `reveal_logs/RV${Date.now()}${randomSuffix(4)}`, { uid: user.uid, card_id: cardId, via: 'vault', with_cvv: !!d.cvv,
    ip: (request.headers.get('cf-connecting-ip') || '').slice(0, 45), ua: (request.headers.get('user-agent') || '').slice(0, 160),
    country: String(request.cf?.country || '').slice(0, 4), revealed_at: nowIso() }).catch(() => {});
  background(fsPatch(env, `manual_cards/${cardId}`, { last_view_at: nowIso() }).catch(() => {}));
  if (memAllowWin(`vmail_${cardId}`, 1, 600)) notify(env, user.uid, 'card_viewed', { card_name: card.card_name || 'بطاقتي', last4: card.last4 || '',
    at: new Date(Date.now() + 2 * 3600000).toISOString().slice(11, 16) + ' بتوقيت ليبيا' });
  return { success: true, card_number: d.card_number, expiry: d.expiry, cvv: d.cvv || '', name_on_card: card.name_on_card || '', billing_address: card.billing_address || '', ttl: 60 };
}

/* ─── الإدارة: البطاقات (بدون أي بيانات حساسة) والتجميد ─── */
async function handleAdminCards(user, body, env) {
  const staff = await requirePermission(user, env, 'cards.view');
  if (!memAllowWin(`acards_${user.uid}`, 300, 3600)) throw httpError(429, 'محاولات كثيرة');
  const q = String(body.q || '').trim().toLowerCase().slice(0, 60);
  const uid = String(body.uid || '').trim();
  let rows = [];
  if (env.DB && await d1Table(env, 'manual_cards')) {
    if (uid) rows = await d1All(env, `SELECT id, data FROM manual_cards WHERE uid = ? ORDER BY created_at DESC LIMIT 30`, [uid]);
    else if (/^\d{4}$/.test(q)) rows = await d1All(env, `SELECT id, data FROM manual_cards WHERE json_extract(data, '$.last4') = ? LIMIT 30`, [q]);
    else if (q) rows = await d1All(env, `SELECT id, data FROM manual_cards WHERE lower(json_extract(data, '$.provider_ref')) LIKE ? OR lower(json_extract(data, '$.card_name')) LIKE ? OR id LIKE ? ORDER BY created_at DESC LIMIT 30`,
      ['%' + q.replace(/[%_]/g, '') + '%', '%' + q.replace(/[%_]/g, '') + '%', '%' + q.replace(/[%_]/g, '').toUpperCase() + '%']);
    else rows = await d1All(env, `SELECT id, data FROM manual_cards ORDER BY created_at DESC LIMIT 60`);
  }
  let list = rows.map(r => { let d = {}; try { d = JSON.parse(r.data); } catch {} return { id: r.id, ...d }; });
  if (q && !/^\d{4}$/.test(q) && !uid && list.length < 30) {          // البحث باسم العميل أو بريده
    const urows = await d1All(env, `SELECT id FROM users WHERE json_extract(data, '$.name') LIKE ? OR email LIKE ? LIMIT 20`, ['%' + q.replace(/[%_]/g, '') + '%', q.replace(/[%_]/g, '') + '%']).catch(() => []);
    if (urows.length) {
      const ids = urows.map(x => x.id);
      const more = await d1All(env, `SELECT id, data FROM manual_cards WHERE uid IN (${ids.map(() => '?').join(',')}) LIMIT 30`, ids).catch(() => []);
      for (const r of more) if (!list.find(x => x.id === r.id)) { let d = {}; try { d = JSON.parse(r.data); } catch {} list.push({ id: r.id, ...d }); }
    }
  }
  const names = await userNamesMap(env, list.map(c => c.uid));
  return { success: true, cards: list.slice(0, 60).map(c => ({ id: c.id, uid: c.uid, user: (names.get(c.uid) || {}).name || '', email: (names.get(c.uid) || {}).email || '',
    card_name: c.card_name || '', first6: c.first6 || '', last4: c.last4 || '', status: c.status || '', balance: num(c.balance, 0), provider: c.provider || '', provider_ref: c.provider_ref || '',
    type_name: c.type_name || '', created_at: c.created_at || '', last_view_at: c.last_view_at || '', vault: c.vault === true, frozen_by: c.frozen_by || '', frozen_at: c.frozen_at || '', state_reason: c.state_reason || '' })) };
}
async function handleAdminCardState(user, body, env) {
  const staff = await requirePermission(user, env, 'cards.edit');
  const cardId = String(body.card_id || '').trim(), action = String(body.action || '');
  const reason = String(body.reason || '').replace(/[<>]/g, '').trim().slice(0, 200);
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(cardId)) throw httpError(400, 'بطاقة غير صالحة');
  if (!['freeze', 'unfreeze', 'terminate'].includes(action)) throw httpError(400, 'إجراء غير معروف');
  if (action === 'terminate' && reason.length < 3) throw httpError(400, 'اكتب سبب الإيقاف');
  let card = null, next = '';
  await fsRunTransaction(env, async (tx) => {
    card = await tx.get(`manual_cards/${cardId}`);
    if (!card) throw httpError(404, 'البطاقة غير موجودة');
    if (action === 'freeze') { if (card.status !== 'active') throw httpError(409, 'البطاقة ليست نشطة'); next = 'frozen'; }
    if (action === 'unfreeze') { if (card.status !== 'frozen') throw httpError(409, 'البطاقة ليست مجمّدة'); next = 'active'; }
    if (action === 'terminate') { if (card.status === 'terminated') throw httpError(409, 'موقوفة مسبقًا'); next = 'terminated'; }
    tx.update(`manual_cards/${cardId}`, { status: next, state_reason: reason, ...(next === 'frozen' ? { frozen_by: staff.uid, frozen_at: nowIso() } : {}), state_by: staff.uid, state_at: nowIso(), updated_at: nowIso() });
    if (next === 'terminated') tx.delete(`card_vault/${cardId}`);       // بطاقة منتهية: لا داعي للاحتفاظ ببياناتها
  });
  await logOp(env, staff.uid, 'card.' + action, { cardId, reason }, { from: card.status, to: next }, true);
  notify(env, card.uid, 'card_state', { state: next, card_name: card.card_name || 'بطاقتي', last4: card.last4 || '', reason });
  return { success: true, status: next };
}


/* ═══ v52 — تحليل الزوار: أعداد مجمّعة يوميًا فقط (بدون بيانات شخصية ولا عنوان IP) ═══
   المتصفح يجمع التحركات ويبعثها مرة كل دقيقة؛ الخادم يجمعها في صفوف يومية (يوم × مفتاح) */
const AN_PAGES = new Set(['dashboard', 'kstore', 'cards', 'orders', 'settings', 'wallet', 'transactions', 'plans', 'referral', 'support', 'trust', 'invoices', 'landing', 'deposit', 'store_cat', 'howto']);
const AN_EVENTS = new Set(['signup', 'login', 'dep_open', 'inv_create', 'paid', 'buy', 'buy_short', 'install', 'card_view', 'share_inv']);
let _anReady = false;
async function anInit(env) {
  if (_anReady || !env.DB) return !!env.DB;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS an_daily (day TEXT NOT NULL, k TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, k))'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS an_live (id TEXT PRIMARY KEY, ts INTEGER NOT NULL)'),
  ]);
  _anReady = true; return true;
}
async function handleTrack(request, env) {
  if (request.method !== 'POST') throw httpError(405, 'method');
  if (!ipAllow(request, 'track', 12)) return { success: true, skipped: true };
  if (Number(request.headers.get('content-length') || 0) > 6000) throw httpError(413, 'كبير');
  let b = {};
  try { b = JSON.parse((await request.text()).slice(0, 6000)); } catch { throw httpError(400, 'bad'); }
  if (!(await anInit(env))) return { success: true };
  const day = todayKey();
  const inc = new Map();
  const add = (k, v) => { if (v > 0) inc.set(k, Math.min(1e6, (inc.get(k) || 0) + v)); };
  const pv = b.pv && typeof b.pv === 'object' ? b.pv : {}, dur = b.dur && typeof b.dur === 'object' ? b.dur : {}, ev = b.ev && typeof b.ev === 'object' ? b.ev : {};
  for (const [k, v] of Object.entries(pv)) if (AN_PAGES.has(k)) add('pv:' + k, Math.min(50, Math.floor(num(v, 0))));
  for (const [k, v] of Object.entries(dur)) if (AN_PAGES.has(k)) add('dur:' + k, Math.min(600, Math.floor(num(v, 0))));
  for (const [k, v] of Object.entries(ev)) if (AN_EVENTS.has(k)) add('ev:' + k, Math.min(20, Math.floor(num(v, 0))));
  if (b.nv === 1) {                                                  // أول زيارة اليوم لهذا الجهاز
    add('vis', 1);
    const lt = new Date(Date.now() + 2 * 3600000);
    add(`hr:${lt.getUTCDay()}:${lt.getUTCHours()}`, 1);
    if (b.dev === 'm' || b.dev === 'd') add('dev:' + b.dev, 1);
    if (b.pwa === 1) add('dev:pwa', 1);
  }
  const stmts = [...inc].slice(0, 40).map(([k, n]) => env.DB.prepare('INSERT INTO an_daily (day, k, n) VALUES (?, ?, ?) ON CONFLICT(day, k) DO UPDATE SET n = n + excluded.n').bind(day, k, n));
  const aid = String(b.a || '');
  if (/^[A-Za-z0-9]{12,32}$/.test(aid)) stmts.push(env.DB.prepare('INSERT INTO an_live (id, ts) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET ts = excluded.ts').bind(aid, Date.now()));
  if (stmts.length) await env.DB.batch(stmts).catch(e => console.error('TRACK', e.message));
  return { success: true };
}
async function handleAdminAnalytics(user, body, env) {
  await requirePermission(user, env, 'users.view');
  if (!(await anInit(env))) throw httpError(503, 'قاعدة البيانات غير متاحة');
  const days = Math.min(90, Math.max(1, Math.floor(num(body.days, 7))));
  const from = new Date(Date.now() + 2 * 3600000 - (days - 1) * 86400000).toISOString().slice(0, 10);
  const [rows, live, perDay] = await Promise.all([
    d1All(env, 'SELECT k, SUM(n) AS n FROM an_daily WHERE day >= ? GROUP BY k', [from]),
    d1All(env, 'SELECT COUNT(*) AS n FROM an_live WHERE ts > ?', [Date.now() - 5 * 60000]),
    d1All(env, "SELECT day, n FROM an_daily WHERE day >= ? AND k = 'vis' ORDER BY day", [from]),
  ]);
  if (Math.random() < 0.05) env.DB.prepare('DELETE FROM an_live WHERE ts < ?').bind(Date.now() - 86400000).run().catch(() => {});
  const m = {}; for (const r of rows) m[r.k] = num(r.n, 0);
  return { success: true, days, totals: m, live: num(live[0] && live[0].n, 0), per_day: perDay.map(r => ({ day: r.day, n: num(r.n, 0) })) };
}


/* ═══ v52 — «كيف أدفع؟»: خطوات لكل طريقة، يعدّلها الأدمن (النص والصور) — الافتراضي مرسوم في الموقع ═══ */
const HOWTO_KEYS = ['binance_pay', 'binance_withdraw', 'mexc', 'libyana', 'almadar', 'bank'];
async function handleHowto(env) {
  const g = env.KV ? await kvGetJSON(env, 'howto:v1') : null;
  return { success: true, guides: g && typeof g === 'object' ? g : {} };
}
async function serveHowtoImg(env, key) {
  const kv = env.KV ? await env.KV.getWithMetadata('img:ht:' + key, 'arrayBuffer').catch(() => null) : null;
  if (!kv || !kv.value) return new Response('Not found', { status: 404 });
  return new Response(kv.value, { headers: { 'content-type': (kv.metadata && kv.metadata.type) || 'image/jpeg', 'cache-control': 'public, max-age=604800, immutable', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' } });
}
async function handleAdminHowto(user, body, env) {
  const staff = await requirePermission(user, env, 'settings.manage');
  if (!env.KV) throw httpError(503, 'التخزين غير متاح');
  if (!memAllowWin(`howto_${user.uid}`, 120, 3600)) throw httpError(429, 'محاولات كثيرة');
  if (body.action === 'img') {                                            // رفع صورة خطوة
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(body.image || ''));
    if (!m || m[2].length > 500000) throw httpError(400, 'صورة غير صالحة أو كبيرة');
    const key = `${String(body.guide || 'x').replace(/[^a-z_]/g, '').slice(0, 20)}_${Date.now().toString(36)}${randomSuffix(3).toLowerCase()}`;
    await env.KV.put('img:ht:' + key, Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)), { metadata: { type: m[1] } });
    return { success: true, url: '/hti/' + key };
  }
  const src = body.guides && typeof body.guides === 'object' ? body.guides : {};
  const out = {};
  for (const k of HOWTO_KEYS) {
    const g = src[k]; if (!g || !Array.isArray(g.steps)) continue;
    out[k] = { steps: g.steps.slice(0, 8).map(st => ({ t: String((st && st.t) || '').replace(/[<>]/g, '').trim().slice(0, 240), img: /^\/hti\/[a-z0-9_]{3,60}$/.test(String(st && st.img || '')) ? st.img : '' })).filter(st => st.t) };
    if (g.note) out[k].note = String(g.note).replace(/[<>]/g, '').slice(0, 300);
  }
  await env.KV.put('howto:v1', JSON.stringify(out));                    // دائم (بدون انتهاء)
  bustPublic();
  await logOp(env, staff.uid, 'howto.save', { keys: Object.keys(out) }, {}, true);
  return { success: true, guides: out };
}


/* ═══ v52 — رابط دفع الفاتورة (للعملات الرقمية): أي أحد يدفع عنك بدون ما يدخل حسابك ═══
   • الرابط فيه رمز عشوائي طويل (لا علاقة له برقم الفاتورة) ويوضع بعد # فلا يصل لسجلات أي خادم
   • يعرض الدفع فقط: المبلغ والعنوان والحالة واسم مختصر — لا رصيد ولا بيانات حساب */
async function handleInvoiceShare(user, body, env) {
  if (!memAllowWin(`inv_sh_${user.uid}`, 30, 3600)) throw httpError(429, 'محاولات كثيرة');
  const id = String(body.id || '').trim();
  if (!/^INV\d+[A-Z0-9]{4}$/.test(id)) throw httpError(400, 'رقم الفاتورة غير صالح');
  const inv = await fsGet(env, `usdt_invoices/${id}`);
  if (!inv || inv.uid !== user.uid) throw httpError(404, 'الفاتورة غير موجودة');
  if (inv.share_h) await fsDelete(env, `inv_links/${inv.share_h}`).catch(() => {});
  if (body.on === false) { await fsPatch(env, `usdt_invoices/${id}`, { share_h: '' }); return { success: true, on: false }; }
  if (!INV_OPEN.includes(inv.status) || invCheckUntil(inv) < Date.now()) throw httpError(409, 'الفاتورة منتهية — أنشئ فاتورة جديدة');
  const token = bytesToB64url(crypto.getRandomValues(new Uint8Array(24)));
  const h = (await sha256Hex('invlink:' + token)).slice(0, 40);
  await fsSet(env, `inv_links/${h}`, { inv_id: id, uid: user.uid, exp_ms: invCheckUntil(inv), created_at: nowIso() });
  await fsPatch(env, `usdt_invoices/${id}`, { share_h: h });
  await logOp(env, user.uid, 'invoice.share', { id }, {}, true);
  const origin = String(env.ALLOWED_ORIGIN || 'https://kardo.ly').split(',')[0].trim().replace(/\/+$/, '') || 'https://kardo.ly';
  return { success: true, on: true, url: `${origin}/pay.html#t=${token}` };
}
async function handlePayView(request, env) {
  if (request.method !== 'POST') throw httpError(405, 'method');
  if (!ipAllow(request, 'payv', 20)) throw httpError(429, 'طلبات كثيرة — انتظر دقيقة');
  let b = {}; try { b = JSON.parse((await request.text()).slice(0, 500)); } catch { throw httpError(400, 'bad'); }
  const token = String(b.t || '');
  if (!/^[A-Za-z0-9_-]{30,40}$/.test(token)) throw httpError(404, 'الرابط غير صالح');
  const h = (await sha256Hex('invlink:' + token)).slice(0, 40);
  const ln = await fsGet(env, `inv_links/${h}`).catch(() => null);
  if (!ln || num(ln.exp_ms, 0) < Date.now() - 86400000) throw httpError(404, 'الرابط غير صالح أو انتهى');
  let inv = await fsGet(env, `usdt_invoices/${ln.inv_id}`);
  if (!inv || inv.uid !== ln.uid || inv.share_h !== h) throw httpError(404, 'أوقف صاحب الفاتورة هذا الرابط');
  if (INV_OPEN.includes(inv.status) && invCheckUntil(inv) > Date.now() && b.check === true) {
    try { const r = await invoiceCheck(env, ln.inv_id, inv, 'link'); if (r && r.invoice) inv = { ...inv, status: r.invoice.status, received: r.invoice.received, paid_at: r.invoice.paid_at }; } catch {}
  }
  const u = await fsGet(env, `users/${ln.uid}`).catch(() => null);
  const parts = String((u && u.name) || 'عميل كاردو').trim().split(/\s+/);
  const shortName = parts[0].slice(0, 20) + (parts[1] ? ' ' + parts[1].charAt(0) + '.' : '');
  const s = await getSettings(env);
  const v = invView({ ...inv, _id: ln.inv_id });
  return { success: true, invoice: { no: v.no, amount_usd: v.amount_usd, pay_amount: v.pay_amount, address: v.address, network: v.network, network_label: v.network_label,
    status: v.status, expires_ms: v.expires_ms, check_until_ms: v.check_until_ms, paid_at: v.paid_at }, owner: shortName,
    binance_pay_qr: num(s.binance_pay_qr_v, 0) ? `/bpq?v=${num(s.binance_pay_qr_v, 0)}` : '' };
}


/* ═══ v52 — تصدير المحاسبة: الفواتير والإيداعات حسب التاريخ (الملف يُبنى في المتصفح) ═══ */
async function handleAdminExport(user, body, env) {
  const staff = await requirePermission(user, env, 'deposits.view');
  if (!memAllowWin(`exp_${user.uid}`, 20, 3600)) throw httpError(429, 'محاولات كثيرة');
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const from = String(body.from || ''), to = String(body.to || '');
  if (!re.test(from) || !re.test(to) || from > to) throw httpError(400, 'اختر تاريخ البداية والنهاية');
  const f = new Date(from + 'T00:00:00+02:00'), t = new Date(Date.parse(to + 'T00:00:00+02:00') + 86400000);
  if (t - f > 93 * 86400000) throw httpError(400, 'أقصى مدة 3 شهور في الملف الواحد');
  const F = f.toISOString(), T = t.toISOString();
  const parse = rows => rows.map(r => { let d = {}; try { d = JSON.parse(r.data); } catch {} return { id: r.id, ...d }; });
  const [inv, dep] = await Promise.all([
    d1Table(env, 'usdt_invoices').then(ok => ok ? d1All(env, 'SELECT id, data FROM usdt_invoices WHERE created_at >= ? AND created_at < ? ORDER BY created_at LIMIT 5000', [F, T]) : []).then(parse),
    d1Table(env, 'wallet_deposits').then(ok => ok ? d1All(env, 'SELECT id, data FROM wallet_deposits WHERE created_at >= ? AND created_at < ? ORDER BY created_at LIMIT 5000', [F, T]) : []).then(parse),
  ]);
  const names = await userNamesMap(env, [...new Set([...inv, ...dep].map(x => x.uid))].slice(0, 100));
  const more = [...new Set([...inv, ...dep].map(x => x.uid))].slice(100);
  if (more.length) for (let i = 0; i < more.length; i += 100) { const m = await userNamesMap(env, more.slice(i, i + 100)); m.forEach((v, k) => names.set(k, v)); }
  const nm = uid => names.get(uid) || { name: '', email: '' };
  await logOp(env, staff.uid, 'export.accounting', { from, to }, { inv: inv.length, dep: dep.length }, true);
  return { success: true, from, to,
    invoices: inv.map(v => ({ no: v.no || '', created_at: v.created_at || '', name: nm(v.uid).name, email: nm(v.uid).email, network: (CRYPTO_NETS[v.network || 'trc20'] || {}).label || v.network || '',
      amount_usd: num(v.amount_usd, 0), pay_amount: num(v.pay_amount, 0), received: num(v.received, 0), status: v.status || '', paid_at: v.paid_at || '', txid: v.txid || '', late: v.late === true, by: v.paid_by || '' })),
    deposits: dep.map(d => ({ id: d.id, created_at: d.created_at || '', name: nm(d.uid).name, email: nm(d.uid).email, method: d.method || '', amount_usd: num(d.amount_usd, 0), amount_lyd: num(d.amount_lyd, 0),
      status: d.status || '', auto: d.auto === true, phone: d.claim_phone ? '0' + String(d.claim_phone).replace(/^0/, '') : '', reference: String(d.reference || d.note || '').slice(0, 60) })) };
}


/* ═══ v52 — هدية أول شحنة: مرة وحدة لكل رقم هاتف موثّق (يمنع فتح حسابات وهمية للهدية) ═══ */
function promoFirstActive(s) {
  if (s.promo_first_on !== true || !(num(s.promo_first_bonus, 0) > 0)) return false;
  const until = String(s.promo_first_until || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(until) && todayKey() > until) return false;
  return true;
}
async function promoFirstDeposit(env, uid, amount, ref) {
  try {
    const s = await getSettings(env);
    if (!promoFirstActive(s)) return;
    const min = num(s.promo_first_min, 20), bonus = round2(Math.min(50, num(s.promo_first_bonus, 0.5)));
    if (!(round2(amount) >= min) || !(bonus > 0)) return;
    const u = await fsGet(env, `users/${uid}`);
    if (!u || u.promo_first_done === true || u.banned === true) return;
    const phone = String(u.phone_verified || '').replace(/\D/g, '');
    if (phone.length < 9) return;                                      // لازم رقم موثّق
    const done = await fsRunTransaction(env, async (tx) => {
      if (await tx.get(`promo_phones/${phone}`)) return false;           // نفس الرقم أخذ الهدية في حساب آخر
      const L = await ledgerOpen(tx, uid);
      if (L.doc.promo_first_done === true) return false;
      await ledgerPost(L, { type: 'credit', amount: bonus, reason: 'promo_first', reference: String(ref || '').slice(0, 60), entryId: `txn_promo1_${uid}` });
      ledgerClose(tx, L, { promo_first_done: true });
      tx.create('promo_phones', phone, { uid, bonus, ref: String(ref || '').slice(0, 60), created_at: nowIso() });
      return true;
    });
    if (!done) return;
    await logOp(env, uid, 'promo.first_deposit', { ref }, { bonus }, true);
    notify(env, uid, 'promo_bonus', { amount: bonus.toFixed(2), min: String(min) });
  } catch (e) { console.error('PROMO_FIRST', e.message); }
}


/* ═══ v54 — تقييمات حقيقية: بعد طلب مكتمل فقط، ولا تظهر إلا بعد موافقة الإدارة ═══ */
function safeUrl(u) { u = String(u || '').trim(); return /^https:\/\/[^\s"'<>]{4,200}$/.test(u) ? u : ''; }
function maskName(n) { const w = String(n || '').trim().split(/\s+/)[0] || 'عميل'; return Array.from(w)[0] + '*****'; }
async function handleReviewSubmit(user, body, env) {
  if (!memAllowWin(`rev_${user.uid}`, 10, 3600)) throw httpError(429, 'محاولات كثيرة');
  const oid = String(body.order_id || '').trim();
  if (!/^RSC\d+[A-Z0-9]{4}$/.test(oid)) throw httpError(400, 'طلب غير صالح');
  const stars = Math.floor(num(body.stars, 0));
  if (!(stars >= 1 && stars <= 5)) throw httpError(400, 'اختر عدد النجوم');
  const text = String(body.text || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const u = await fsGet(env, `users/${user.uid}`).catch(() => null);
  await fsRunTransaction(env, async (tx) => {
    const o = await tx.get(`rsc_orders/${oid}`);
    if (!o || o.uid !== user.uid) throw httpError(404, 'الطلب غير موجود');
    if (o.status !== 'completed') throw httpError(409, 'تقدر تقيّم بعد ما يكتمل الطلب');
    if (o.reviewed === true) throw httpError(409, 'قيّمت هذا الطلب من قبل');
    tx.create('reviews', oid, { uid: user.uid, stars, text, name: maskName(u && u.name), item: `${o.cat_name || ''} · ${o.offer_name || ''}`.slice(0, 80),
      status: text ? 'pending' : 'approved', created_at: nowIso() });                      // تقييم بنجوم بدون نص لا يحتاج مراجعة
    tx.update(`rsc_orders/${oid}`, { reviewed: true });
  });
  bustPublic();
  return { success: true };
}
async function handleReviewsPublic(env) {
  const s = await getSettings(env);
  if (!env.DB || !(await d1Table(env, 'reviews'))) return { success: true, count: 0, avg: 0, list: [] };
  const [agg, rows] = await Promise.all([
    d1All(env, `SELECT COUNT(*) AS n, AVG(json_extract(data, '$.stars')) AS a FROM reviews WHERE status = 'approved'`),
    d1All(env, `SELECT data FROM reviews WHERE status = 'approved' AND json_extract(data, '$.text') != '' ORDER BY created_at DESC LIMIT 8`),
  ]);
  const count = num(agg[0] && agg[0].n, 0);
  if (count < Math.max(1, num(s.reviews_min, 5))) return { success: true, count, avg: 0, list: [], hidden: true };
  return { success: true, count, avg: Math.round(num(agg[0].a, 0) * 10) / 10,
    list: rows.map(r => { let d = {}; try { d = JSON.parse(r.data); } catch {} return { name: d.name, stars: d.stars, text: d.text, item: d.item, at: d.created_at }; }) };
}
async function handleAdminReviews(user, body, env) {
  const staff = await requirePermission(user, env, body.action === 'list' || !body.action ? 'users.view' : 'users.edit');
  if (!env.DB || !(await d1Table(env, 'reviews'))) return { success: true, items: [] };
  if (!body.action || body.action === 'list') {
    const st = ['pending', 'approved', 'hidden'].includes(body.status) ? body.status : 'pending';
    const rows = await d1All(env, `SELECT id, data FROM reviews WHERE status = ? ORDER BY created_at DESC LIMIT 60`, [st]);
    const cnt = await d1All(env, `SELECT status, COUNT(*) AS n FROM reviews GROUP BY status`);
    return { success: true, items: rows.map(r => { let d = {}; try { d = JSON.parse(r.data); } catch {} return { id: r.id, ...d }; }), counts: Object.fromEntries(cnt.map(c => [c.status, num(c.n, 0)])) };
  }
  const id = String(body.id || '');
  if (!/^RSC\d+[A-Z0-9]{4}$/.test(id)) throw httpError(400, 'غير صالح');
  const to = body.action === 'approve' ? 'approved' : body.action === 'hide' ? 'hidden' : '';
  if (!to) throw httpError(400, 'إجراء غير معروف');
  if (!(await fsGet(env, `reviews/${id}`))) throw httpError(404, 'غير موجود');
  await fsPatch(env, `reviews/${id}`, { status: to, by: staff.uid, at: nowIso() });
  bustPublic();
  await logOp(env, staff.uid, 'review.' + body.action, { id }, {}, true);
  return { success: true };
}
