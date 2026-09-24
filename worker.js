/**
 * ═══════════════════════════════════════════════════════════
 *  KARDO — Cloudflare Worker Backend
 *  Version: 2.3.0 (Added Digital Services System)
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
    case '/api/services/list':       return handleServicesList(user, env);
    case '/api/services/order':      return handleServiceOrder(user, body, env);
    case '/api/admin/service/save':  return handleAdminServiceSave(user, body, env);
    case '/api/admin/service/delete': return handleAdminServiceDelete(user, body, env);
    case '/api/admin/stock/add':     return handleAdminStockAdd(user, body, env);
    case '/api/admin/stock/delete':  return handleAdminStockDelete(user, body, env);
    case '/api/admin/stock/list':    return handleAdminStockList(user, body, env);
    case '/api/admin/service-order': return handleAdminServiceOrder(user, body, env);
  }
  throw httpError(404, 'المسار غير موجود');
}

/* ═══════════════════════════════════════════════════════════
   Digital Services
   ═══════════════════════════════════════════════════════════ */

async function handleServicesList(user, env) {
  const rows = await fsQueryRaw(env, {
    from: [{ collectionId: 'services' }],
    where: [{ fieldFilter: { field: { fieldPath: 'is_active' }, value: { booleanValue: true } } }],
    orderBy: [{ field: { fieldPath: 'sort' }, direction: 'ASCENDING' }],
  });
  
  const services = rows.map(r => withId(r, 'services'));
  
  return {
    success: true,
    services: services.map(s => ({
      id: s._id,
      name: s.name || '',
      desc: s.desc || '',
      icon_emoji: s.icon_emoji || '',
      icon_url: s.icon_url || '',
      price_usd: num(s.price_usd, 0),
      delivery_type: s.delivery_type || 'auto',
      fields: Array.isArray(s.fields) ? s.fields : [],
      sort: num(s.sort, 0),
    })),
  };
}

async function handleServiceOrder(user, body, env) {
  const { service_id, inputs } = body;
  if (!service_id) throw httpError(400, 'معرّف الخدمة مطلوب');
  if (typeof inputs !== 'object') throw httpError(400, 'البيانات مطلوبة');
  
  const rlOk = await checkRateLimit(env, `svc_order_${user.uid}`, 20, 3600);
  if (!rlOk) throw httpError(429, '20 طلب في الساعة الواحدة');
  
  const idempKey = body.idempotency_key || `${user.uid}_${Date.now()}`;
  
  const service = await fsGet(env, `services/${service_id}`).catch(() => null);
  if (!service) throw httpError(404, 'الخدمة غير موجودة');
  if (service.is_active !== true) throw httpError(400, 'الخدمة غير متاحة');
  
  const price = num(service.price_usd, 0);
  
  const fields = Array.isArray(service.fields) ? service.fields : [];
  for (const f of fields) {
    if (f.required && !inputs[f.key]) throw httpError(400, `${f.label} مطلوب`);
    const val = inputs[f.key];
    if (val && typeof val === 'string' && val.length > 200) {
      throw httpError(400, `${f.label} يجب أن يكون أقل من 200 حرف`);
    }
  }
  
  const userDoc = await fsGet(env, `users/${user.uid}`).catch(() => null);
  const balance = num(userDoc && userDoc.wallet_balance, 0);
  if (balance < price) throw httpError(400, 'رصيد غير كافي');
  
  return await fsRunTransaction(env, async (tx) => {
    const userRead = await tx.get(env, `users/${user.uid}`);
    const balRead = num(userRead.wallet_balance, 0);
    if (balRead < price) throw httpError(400, 'رصيد غير كافي');
    
    const orderId = `svc_${Date.now()}_${randomSuffix(6)}`;
    
    if (service.delivery_type === 'auto') {
      const stockRows = await fsQueryRaw(env, {
        from: [{ collectionId: 'service_stock' }],
        where: [
          { fieldFilter: { field: { fieldPath: 'service_id' }, value: { stringValue: service_id } } },
          { fieldFilter: { field: { fieldPath: 'is_used' }, value: { booleanValue: false } } },
        ],
        limit: 1,
      });
      
      if (!stockRows.length) {
        await tx.set(env, `users/${user.uid}`, { wallet_balance: balRead }, 'update');
        await tx.set(env, `wallet_transactions/${Date.now()}_${randomSuffix(4)}`, {
          uid: user.uid,
          type: 'service_refund',
          amount_usd: price,
          reason: 'الخدمة غير متوفرة',
          created_at: nowIso(),
        }, 'create');
        throw httpError(400, 'الخدمة غير متوفرة حالياً');
      }
      
      const stockId = stockRows[0].name.split('/').pop();
      const stockRead = await tx.get(env, `service_stock/${stockId}`);
      
      if (stockRead.is_used === true) throw httpError(400, 'الكود مستخدم بالفعل');
      
      tx.set(env, `users/${user.uid}`, { wallet_balance: balRead - price }, 'update');
      tx.set(env, `service_stock/${stockId}`, {
        is_used: true,
        used_by: user.uid,
        used_at: nowIso(),
        order_id: orderId,
      }, 'update');
      tx.set(env, `service_orders/${orderId}`, {
        uid: user.uid,
        service_id,
        service_name: service.name || '',
        service_icon: service.icon_emoji || '',
        price_usd: price,
        delivery_type: 'auto',
        inputs,
        status: 'completed',
        delivered_data: stockRead.code || '',
        delivered_at: nowIso(),
        created_at: nowIso(),
      }, 'create');
      tx.set(env, `wallet_transactions/${Date.now()}_${randomSuffix(4)}`, {
        uid: user.uid,
        type: 'service_purchase',
        amount_usd: -price,
        service_id,
        order_id: orderId,
        created_at: nowIso(),
      }, 'create');
      
      return {
        success: true,
        order_id: orderId,
        delivered_data: stockRead.code || '',
        message: 'تم توصيل الخدمة بنجاح',
      };
    } else {
      tx.set(env, `users/${user.uid}`, { wallet_balance: balRead - price }, 'update');
      tx.set(env, `service_orders/${orderId}`, {
        uid: user.uid,
        service_id,
        service_name: service.name || '',
        service_icon: service.icon_emoji || '',
        price_usd: price,
        delivery_type: 'manual',
        inputs,
        status: 'pending',
        delivered_data: '',
        created_at: nowIso(),
      }, 'create');
      tx.set(env, `wallet_transactions/${Date.now()}_${randomSuffix(4)}`, {
        uid: user.uid,
        type: 'service_purchase',
        amount_usd: -price,
        service_id,
        order_id: orderId,
        created_at: nowIso(),
      }, 'create');
      
      return {
        success: true,
        order_id: orderId,
        message: 'طلبك قيد التنفيذ — سيتم الانتهاء منه قريباً',
      };
    }
  });
}

async function handleAdminServiceSave(user, body, env) {
  await requireAdmin(user, env);
  
  const { id, name, desc, icon_emoji, icon_url, price_usd, delivery_type, fields, is_active, sort } = body;
  
  if (!name) throw httpError(400, 'اسم الخدمة مطلوب');
  if (!['auto', 'manual'].includes(delivery_type)) throw httpError(400, 'نوع التسليم غير صحيح');
  if (num(price_usd, 0) < 0.1) throw httpError(400, 'السعر يجب أن يكون أكبر من 0');
  
  if (icon_url && icon_url.startsWith('data:')) {
    const sizeKB = (icon_url.length / 1024);
    if (sizeKB > 60) throw httpError(400, 'الصورة يجب أن تكون أقل من 60KB');
  }
  
  const cleanFields = Array.isArray(fields) ? fields.slice(0, 5).map(f => ({
    key: String(f.key || '').slice(0, 50),
    label: String(f.label || '').slice(0, 100),
    type: String(f.type || 'text'),
    placeholder: String(f.placeholder || ''),
    required: f.required === true,
    options: Array.isArray(f.options) ? f.options.map(o => String(o).slice(0, 100)) : [],
  })) : [];
  
  const serviceId = id || `svc_${Date.now()}_${randomSuffix(4)}`;
  
  await fsSet(env, `services/${serviceId}`, {
    name: String(name),
    desc: String(desc || ''),
    icon_emoji: String(icon_emoji || ''),
    icon_url: String(icon_url || ''),
    price_usd: num(price_usd, 0),
    delivery_type: String(delivery_type),
    fields: cleanFields,
    is_active: is_active === true,
    sort: num(sort, 0),
    created_at: nowIso(),
  });
  
  return {
    success: true,
    id: serviceId,
    message: 'تم حفظ الخدمة بنجاح',
  };
}

async function handleAdminServiceDelete(user, body, env) {
  await requireAdmin(user, env);
  
  const { id } = body;
  if (!id) throw httpError(400, 'معرّف الخدمة مطلوب');
  
  await fsDelete(env, `services/${id}`);
  
  return {
    success: true,
    message: 'تم حذف الخدمة بنجاح',
  };
}

async function handleAdminStockAdd(user, body, env) {
  await requireAdmin(user, env);
  
  const { service_id, codes } = body;
  if (!service_id) throw httpError(400, 'معرّف الخدمة مطلوب');
  if (!Array.isArray(codes)) throw httpError(400, 'القائمة مطلوبة');
  if (codes.length > 500) throw httpError(400, 'حد أقصى 500 كود في العملية');
  
  const service = await fsGet(env, `services/${service_id}`).catch(() => null);
  if (!service) throw httpError(404, 'الخدمة غير موجودة');
  
  let added = 0;
  for (const code of codes) {
    if (!code || typeof code !== 'string') continue;
    const stockId = `stock_${Date.now()}_${randomSuffix(6)}`;
    await fsSet(env, `service_stock/${stockId}`, {
      service_id,
      code: String(code).slice(0, 500),
      is_used: false,
      used_by: '',
      used_at: '',
      order_id: '',
      created_at: nowIso(),
    }).catch(() => {});
    added++;
  }
  
  return {
    success: true,
    added,
    message: `تم إضافة ${added} كود`,
  };
}

async function handleAdminStockDelete(user, body, env) {
  await requireAdmin(user, env);
  
  const { id } = body;
  if (!id) throw httpError(400, 'معرّف الكود مطلوب');
  
  await fsDelete(env, `service_stock/${id}`);
  
  return {
    success: true,
    message: 'تم حذف الكود بنجاح',
  };
}

async function handleAdminStockList(user, body, env) {
  await requireAdmin(user, env);
  
  const { service_id } = body;
  if (!service_id) throw httpError(400, 'معرّف الخدمة مطلوب');
  
  const rows = await fsQueryRaw(env, {
    from: [{ collectionId: 'service_stock' }],
    where: [{ fieldFilter: { field: { fieldPath: 'service_id' }, value: { stringValue: service_id } } }],
  });
  
  const items = rows.map(r => {
    const d = withId(r, 'service_stock');
    return {
      id: d._id,
      code: d.code || '',
      is_used: d.is_used === true,
      used_by: d.used_by || '',
      used_at: d.used_at || '',
      order_id: d.order_id || '',
      created_at: d.created_at || '',
    };
  });
  
  return {
    success: true,
    items,
    total: items.length,
    used: items.filter(x => x.is_used).length,
  };
}

async function handleAdminServiceOrder(user, body, env) {
  await requireAdmin(user, env);
  
  const { order_id, action, delivered_data, reason } = body;
  if (!order_id) throw httpError(400, 'معرّف الطلب مطلوب');
  if (!['complete', 'reject'].includes(action)) throw httpError(400, 'الإجراء غير صحيح');
  
  return await fsRunTransaction(env, async (tx) => {
    const order = await tx.get(env, `service_orders/${order_id}`);
    if (!order) throw httpError(404, 'الطلب غير موجود');
    if (order.status !== 'pending') throw httpError(400, 'حالة الطلب غير صحيحة');
    
    if (action === 'complete') {
      tx.set(env, `service_orders/${order_id}`, {
        status: 'completed',
        delivered_data: String(delivered_data || ''),
        delivered_at: nowIso(),
      }, 'update');
      
      return {
        success: true,
        message: 'تم تنفيذ الطلب بنجاح',
      };
    } else {
      const price = num(order.price_usd, 0);
      const uid = order.uid;
      
      const userRead = await tx.get(env, `users/${uid}`);
      const balance = num(userRead.wallet_balance, 0);
      
      tx.set(env, `users/${uid}`, { wallet_balance: balance + price }, 'update');
      tx.set(env, `service_orders/${order_id}`, {
        status: 'rejected',
        rejected_reason: String(reason || 'تم رفض الطلب'),
      }, 'update');
      tx.set(env, `wallet_transactions/${Date.now()}_${randomSuffix(4)}`, {
        uid,
        type: 'service_refund',
        amount_usd: price,
        order_id,
        reason: String(reason || ''),
        created_at: nowIso(),
      }, 'create');
      
      return {
        success: true,
        message: 'تم رفض الطلب وإرجاع المبلغ',
      };
    }
  });
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
      bank: num(s.bank_rate, 9.5),
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
      libyana: { rate: num(s.rate_libyana, 11.8), desc: 'ليبيانا' },
      almadar: { rate: num(s.rate_almadar, 12.5), desc: 'المدار' },
      bank: { rate: num(s.rate_bank, 9.5), desc: 'التحويل البنكي' },
      usdt: { rate: num(s.rate_usdt, 1), desc: 'USDT (TRC20)' },
    },
  };
}

async function handleCatalog(env) {
  const categories = await fsQueryRaw(env, {
    from: [{ collectionId: 'catalog_categories' }],
    orderBy: [{ field: { fieldPath: 'sort' }, direction: 'ASCENDING' }],
  });
  const catMap = {};
  for (const r of categories) {
    const c = withId(r, 'catalog_categories');
    catMap[c._id] = { _id: c._id, name: c.name, sort: c.sort, icon: c.icon };
  }
  
  const products = await fsQueryRaw(env, {
    from: [{ collectionId: 'catalog_products' }],
    orderBy: [{ field: { fieldPath: 'sort' }, direction: 'ASCENDING' }],
  });
  const prodMap = {};
  for (const r of products) {
    const p = withId(r, 'catalog_products');
    prodMap[p._id] = p;
  }
  
  return { success: true, categories: Object.values(catMap), products: Object.values(prodMap) };
}

async function handleSmsWebhook(request, env) {
  const body = await safeJson(request);
  const { from, text } = body;
  if (!from || !text) return { success: true };
  
  const sms_logs = await fsQueryRaw(env, {
    from: [{ collectionId: 'sms_logs' }],
    where: [{ fieldFilter: { field: { fieldPath: 'from' }, value: { stringValue: from } } }],
    limit: 1,
    orderBy: [{ field: { fieldPath: 'created_at' }, direction: 'DESCENDING' }],
  });
  
  if (!sms_logs.length) return { success: true };
  const log = withId(sms_logs[0], 'sms_logs');
  
  try {
    await fsSet(env, `sms_logs/${log._id}`, { reply: text, reply_at: nowIso() }, 'update');
  } catch {}
  
  return { success: true };
}

/* ═══════════════════════════════════════════════════════════
   Wallet — Main Operations
   ═══════════════════════════════════════════════════════════ */

async function handleWalletClaim(user, body, env) {
  throw httpError(400, 'هذه الميزة معطلة حالياً');
}

async function handleWithdrawRequest(user, body, env) {
  const { amount_usd, method, phone } = body;
  const s = await getSettings(env);
  const minW = num(s.withdraw_min, 10);
  const maxW = num(s.withdraw_max, 500);
  const amountNum = num(amount_usd, 0);
  
  if (s.withdraw_enabled !== true) throw httpError(400, 'السحب معطل حالياً');
  if (amountNum < minW || amountNum > maxW) throw httpError(400, `المبلغ يجب أن يكون بين ${minW} و ${maxW}`);
  if (!method || !phone) throw httpError(400, 'الطريقة والهاتف مطلوبان');
  
  return await fsRunTransaction(env, async (tx) => {
    const userRead = await tx.get(env, `users/${user.uid}`);
    const balRead = num(userRead.wallet_balance, 0);
    if (balRead < amountNum) throw httpError(400, 'رصيد غير كافي');
    
    const fee = round2((amountNum * num(s.withdraw_fee_pct, 0)) / 100 + num(s.withdraw_fee_fixed, 0));
    const total = amountNum + fee;
    
    const wr_id = `wr_${Date.now()}_${randomSuffix(6)}`;
    
    tx.set(env, `users/${user.uid}`, { wallet_balance: balRead - total }, 'update');
    tx.set(env, `withdrawal_requests/${wr_id}`, {
      uid: user.uid,
      amount_usd: amountNum,
      fee_usd: fee,
      method,
      phone: phoneKey(phone),
      status: 'pending',
      created_at: nowIso(),
    }, 'create');
    
    await logOp(env, user.uid, 'withdraw_request', body, { wr_id }, true);
    
    return { success: true, wr_id, fee };
  });
}

async function handleTransfer(user, body, env) {
  const { amount_usd, to_uid } = body;
  const s = await getSettings(env);
  const amountNum = num(amount_usd, 0);
  const minT = num(s.transfer_min, 1);
  
  if (s.transfer_enabled !== true) throw httpError(400, 'التحويل معطل');
  if (amountNum < minT) throw httpError(400, `الحد الأدنى ${minT} دولار`);
  if (!to_uid || to_uid === user.uid) throw httpError(400, 'مستقبل غير صحيح');
  
  return await fsRunTransaction(env, async (tx) => {
    const fromRead = await tx.get(env, `users/${user.uid}`);
    const fromBal = num(fromRead.wallet_balance, 0);
    if (fromBal < amountNum) throw httpError(400, 'رصيد غير كافي');
    
    const toRead = await tx.get(env, `users/${to_uid}`).catch(() => ({ wallet_balance: 0 }));
    
    const fee = round2((amountNum * num(s.transfer_fee_pct, 0)) / 100);
    const total = amountNum + fee;
    
    const txid = `tx_${Date.now()}_${randomSuffix(6)}`;
    
    tx.set(env, `users/${user.uid}`, { wallet_balance: fromBal - total }, 'update');
    tx.set(env, `users/${to_uid}`, { wallet_balance: num(toRead.wallet_balance, 0) + amountNum }, 'update');
    tx.set(env, `wallet_transactions/${txid}`, {
      uid: user.uid,
      type: 'transfer',
      to_uid,
      amount_usd: amountNum,
      fee_usd: fee,
      status: 'completed',
      created_at: nowIso(),
    }, 'create');
    
    return { success: true, txid, fee };
  });
}

async function handleUsdtInvoice(user, body, env) {
  const { amount_usd } = body;
  const amountNum = num(amount_usd, 0);
  if (amountNum < 1 || amountNum > 10000) throw httpError(400, 'المبلغ غير صحيح');
  
  const inv_id = `inv_${Date.now()}_${randomSuffix(6)}`;
  const addr = USDT_TRC20;
  
  await fsSet(env, `usdt_invoices/${inv_id}`, {
    uid: user.uid,
    amount_usd: amountNum,
    address: addr,
    status: 'pending',
    expires_at: new Date(Date.now() + 15 * 60000).toISOString(),
    created_at: nowIso(),
  });
  
  return {
    success: true,
    invoice_id: inv_id,
    address: addr,
    amount_usd: amountNum,
    expires_in_sec: 900,
  };
}

async function handleUsdtVerify(user, body, env, request) {
  const { invoice_id, tx_hash } = body;
  if (!invoice_id || !tx_hash) throw httpError(400, 'المعاملة والفاتورة مطلوبان');
  
  const inv = await fsGet(env, `usdt_invoices/${invoice_id}`).catch(() => null);
  if (!inv) throw httpError(404, 'الفاتورة غير موجودة');
  if (new Date(inv.expires_at) < new Date()) throw httpError(400, 'انتهت صلاحية الفاتورة');
  if (inv.status !== 'pending') throw httpError(400, 'حالة الفاتورة غير صحيحة');
  
  let verified = false;
  try {
    const res = await fetch(`${TRON_API}/v1/accounts/${USDT_TRC20}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('TRON API');
    verified = true;
  } catch (e) {
    console.error('TRON_CHECK', e.message);
  }
  
  if (!verified) throw httpError(503, 'فشل التحقق — حاول لاحقاً');
  
  return await fsRunTransaction(env, async (tx) => {
    const invRead = await tx.get(env, `usdt_invoices/${invoice_id}`);
    if (invRead.status !== 'pending') throw httpError(400, 'المعاملة تمت معالجتها بالفعل');
    
    const userRead = await tx.get(env, `users/${user.uid}`);
    const balance = num(userRead.wallet_balance, 0);
    
    const amountAdd = num(invRead.amount_usd, 0);
    
    tx.set(env, `usdt_invoices/${invoice_id}`, {
      status: 'completed',
      verified_at: nowIso(),
      tx_hash,
    }, 'update');
    tx.set(env, `users/${user.uid}`, { wallet_balance: balance + amountAdd }, 'update');
    tx.set(env, `wallet_transactions/${Date.now()}_${randomSuffix(4)}`, {
      uid: user.uid,
      type: 'deposit',
      method: 'usdt',
      amount_usd: amountAdd,
      invoice_id,
      tx_hash,
      created_at: nowIso(),
    }, 'create');
    
    return { success: true, message: 'تم تأكيد الإيداع' };
  });
}

async function handleManualCardRequest(user, body, env) {
  const { amount_usd } = body;
  const s = await getSettings(env);
  const minA = num(s.mc_create_min, 10);
  const maxA = num(s.mc_create_max, 500);
  const amountNum = num(amount_usd, 0);
  
  if (s.manual_cards_enabled !== true) throw httpError(400, 'البطاقات اليدوية معطلة');
  if (amountNum < minA || amountNum > maxA) throw httpError(400, `المبلغ بين ${minA} و ${maxA}`);
  
  return await fsRunTransaction(env, async (tx) => {
    const userRead = await tx.get(env, `users/${user.uid}`);
    const balance = num(userRead.wallet_balance, 0);
    
    const fixedFee = num(s.mc_create_fee_fixed, 8);
    const pctFee = round2((amountNum * num(s.mc_create_fee_pct, 2.5)) / 100);
    const totalFee = fixedFee + pctFee;
    
    if (balance < amountNum + totalFee) throw httpError(400, 'رصيد غير كافي');
    
    const mc_id = `mc_${Date.now()}_${randomSuffix(6)}`;
    
    tx.set(env, `users/${user.uid}`, { wallet_balance: balance - (amountNum + totalFee) }, 'update');
    tx.set(env, `manual_cards/${mc_id}`, {
      uid: user.uid,
      amount_usd: amountNum,
      fee_usd: totalFee,
      status: 'pending',
      card_data: '',
      created_at: nowIso(),
    }, 'create');
    
    return { success: true, mc_id };
  });
}

async function handleManualCardTopup(user, body, env) {
  const { card_id, amount_usd } = body;
  const s = await getSettings(env);
  const minA = num(s.mc_topup_min, 10);
  const maxA = num(s.mc_topup_max, 500);
  const amountNum = num(amount_usd, 0);
  
  if (amountNum < minA || amountNum > maxA) throw httpError(400, `المبلغ بين ${minA} و ${maxA}`);
  
  return await fsRunTransaction(env, async (tx) => {
    const card = await tx.get(env, `manual_cards/${card_id}`);
    if (card.uid !== user.uid) throw httpError(403, 'غير مصرّح');
    
    const userRead = await tx.get(env, `users/${user.uid}`);
    const balance = num(userRead.wallet_balance, 0);
    
    const fixedFee = num(s.mc_topup_fee_fixed, 8);
    const pctFee = round2((amountNum * num(s.mc_topup_fee_pct, 2.5)) / 100);
    const totalFee = fixedFee + pctFee;
    
    if (balance < amountNum + totalFee) throw httpError(400, 'رصيد غير كافي');
    
    const top_id = `top_${Date.now()}_${randomSuffix(6)}`;
    
    tx.set(env, `users/${user.uid}`, { wallet_balance: balance - (amountNum + totalFee) }, 'update');
    tx.set(env, `manual_card_topups/${top_id}`, {
      uid: user.uid,
      card_id,
      amount_usd: amountNum,
      fee_usd: totalFee,
      status: 'pending',
      created_at: nowIso(),
    }, 'create');
    
    return { success: true, top_id };
  });
}

async function handleManualCardList(user, env) {
  const rows = await fsQueryRaw(env, {
    from: [{ collectionId: 'manual_cards' }],
    where: [{ fieldFilter: { field: { fieldPath: 'uid' }, value: { stringValue: user.uid } } }],
    orderBy: [{ field: { fieldPath: 'created_at' }, direction: 'DESCENDING' }],
    limit: 50,
  });
  
  const cards = rows.map(r => {
    const c = withId(r, 'manual_cards');
    return {
      id: c._id,
      amount_usd: num(c.amount_usd, 0),
      status: c.status || 'pending',
      card_data: c.card_data || '',
      created_at: c.created_at,
    };
  });
  
  return { success: true, cards };
}

async function handleRevealCard(user, body, env, request) {
  const { card_id } = body;
  const s = await getSettings(env);
  const revealHours = num(s.mc_reveal_hours, 24);
  
  const card = await fsGet(env, `manual_cards/${card_id}`).catch(() => null);
  if (!card) throw httpError(404, 'البطاقة غير موجودة');
  if (card.uid !== user.uid) throw httpError(403, 'غير مصرّح');
  
  const createdAt = new Date(card.created_at || 0);
  const nowTime = new Date();
  const diffHours = (nowTime - createdAt) / (1000 * 60 * 60);
  
  if (diffHours < revealHours) {
    throw httpError(400, `يمكنك الكشف بعد ${Math.ceil(revealHours - diffHours)} ساعات`);
  }
  
  await fsSet(env, `card_logs/${Date.now()}_${randomSuffix(6)}`, {
    uid: user.uid,
    action: 'reveal',
    card_id,
    ip: request.headers.get('cf-connecting-ip') || '',
    created_at: nowIso(),
  }).catch(() => {});
  
  return {
    success: true,
    card_data: card.card_data || '',
  };
}

async function handleStoreOrder(user, body, env) {
  const { product_id, quantity } = body;
  if (!product_id) throw httpError(400, 'معرّف المنتج مطلوب');
  
  const product = await fsGet(env, `catalog_products/${product_id}`).catch(() => null);
  if (!product) throw httpError(404, 'المنتج غير موجود');
  
  const qty = Math.max(1, Math.floor(num(quantity, 1)));
  const price = num(product.price, 0) * qty;
  
  return await fsRunTransaction(env, async (tx) => {
    const userRead = await tx.get(env, `users/${user.uid}`);
    const balance = num(userRead.wallet_balance, 0);
    
    if (balance < price) throw httpError(400, 'رصيد غير كافي');
    
    const order_id = `ord_${Date.now()}_${randomSuffix(6)}`;
    
    tx.set(env, `users/${user.uid}`, { wallet_balance: balance - price }, 'update');
    tx.set(env, `store_orders/${order_id}`, {
      uid: user.uid,
      product_id,
      quantity: qty,
      price_total: price,
      status: 'pending',
      created_at: nowIso(),
    }, 'create');
    
    return { success: true, order_id };
  });
}

async function handleCouponCheck(user, body, env) {
  const { code } = body;
  if (!code) throw httpError(400, 'الرمز مطلوب');
  
  const coupon = await fsGet(env, `coupons/${code}`).catch(() => null);
  if (!coupon) throw httpError(404, 'الرمز غير صحيح');
  if (coupon.is_active !== true) throw httpError(400, 'الرمز غير متاح');
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) throw httpError(400, 'انتهى الرمز');
  
  return {
    success: true,
    discount_pct: num(coupon.discount_pct, 0),
    max_uses: num(coupon.max_uses, 0),
    used: num(coupon.used_count, 0),
  };
}

async function handleRedeemPoints(user, body, env) {
  const { points } = body;
  const s = await getSettings(env);
  const minP = num(s.points_min_redeem, 100);
  const pointsNum = Math.floor(num(points, 0));
  
  if (s.points_enabled !== true) throw httpError(400, 'النقاط معطلة');
  if (pointsNum < minP) throw httpError(400, `الحد الأدنى ${minP} نقطة`);
  
  return await fsRunTransaction(env, async (tx) => {
    const userRead = await tx.get(env, `users/${user.uid}`);
    const userPoints = num(userRead.points, 0);
    
    if (userPoints < pointsNum) throw httpError(400, 'نقاط غير كافية');
    
    const pointValue = num(s.points_value_lyd, 0.01);
    const amountAdd = round2(pointsNum * pointValue);
    
    const balance = num(userRead.wallet_balance, 0);
    
    tx.set(env, `users/${user.uid}`, {
      points: userPoints - pointsNum,
      wallet_balance: balance + amountAdd,
    }, 'update');
    tx.set(env, `wallet_transactions/${Date.now()}_${randomSuffix(4)}`, {
      uid: user.uid,
      type: 'points_redeem',
      points: pointsNum,
      amount_usd: amountAdd,
      created_at: nowIso(),
    }, 'create');
    
    return { success: true, amount_usd: amountAdd };
  });
}

async function handleRefCode(user, env) {
  const code = `REF_${user.uid.slice(-8).toUpperCase()}_${randomSuffix(4)}`;
  
  const ref = await fsGet(env, `referral_codes/${user.uid}`).catch(() => null);
  if (ref) return { success: true, code: ref.code };
  
  await fsSet(env, `referral_codes/${user.uid}`, {
    code,
    uid: user.uid,
    invites: 0,
    rewards_usd: 0,
    created_at: nowIso(),
  }).catch(() => {});
  
  return { success: true, code };
}

async function handleRefClaim(user, body, env) {
  const { ref_code } = body;
  if (!ref_code) throw httpError(400, 'الرمز مطلوب');
  
  const refDoc = await fsQueryRaw(env, {
    from: [{ collectionId: 'referral_codes' }],
    where: [{ fieldFilter: { field: { fieldPath: 'code' }, value: { stringValue: ref_code } } }],
    limit: 1,
  }).then(rows => rows[0] ? withId(rows[0], 'referral_codes') : null);
  
  if (!refDoc) throw httpError(404, 'الرمز غير صحيح');
  
  const s = await getSettings(env);
  if (s.referral_enabled !== true) throw httpError(400, 'البرنامج معطل');
  
  return await fsRunTransaction(env, async (tx) => {
    const userRead = await tx.get(env, `users/${user.uid}`);
    const refRead = await tx.get(env, `referral_codes/${refDoc._id}`);
    
    const inviterBonus = num(s.referral_bonus_inviter, 1);
    const inviteeBonus = num(s.referral_bonus_invitee, 1);
    
    const inviterBalance = num(userRead.wallet_balance, 0);
    const inviteeBalance = num(userRead.wallet_balance, 0);
    
    tx.set(env, `users/${refDoc.uid}`, {
      wallet_balance: inviterBalance + inviterBonus,
    }, 'update');
    tx.set(env, `users/${user.uid}`, {
      wallet_balance: inviteeBalance + inviteeBonus,
    }, 'update');
    tx.set(env, `referral_codes/${refDoc._id}`, {
      invites: num(refRead.invites, 0) + 1,
      rewards_usd: num(refRead.rewards_usd, 0) + inviterBonus,
    }, 'update');
    
    return { success: true, bonus_usd: inviteeBonus };
  });
}

async function handleTicketCreate(user, body, env) {
  const { subject, message } = body;
  if (!subject || !message) throw httpError(400, 'الموضوع والرسالة مطلوبان');
  
  const ticket_id = `tkt_${Date.now()}_${randomSuffix(6)}`;
  
  await fsSet(env, `support_tickets/${ticket_id}`, {
    uid: user.uid,
    subject: String(subject).slice(0, 200),
    status: 'open',
    replies_count: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  await fsSet(env, `support_tickets/${ticket_id}/messages/${Date.now()}`, {
    uid: user.uid,
    message: String(message).slice(0, 2000),
    created_at: nowIso(),
  });
  
  return { success: true, ticket_id };
}

async function handleTicketReply(user, body, env) {
  const { ticket_id, message } = body;
  if (!ticket_id || !message) throw httpError(400, 'معرّف التذكرة والرسالة مطلوبان');
  
  const ticket = await fsGet(env, `support_tickets/${ticket_id}`).catch(() => null);
  if (!ticket) throw httpError(404, 'التذكرة غير موجودة');
  if (ticket.uid !== user.uid) throw httpError(403, 'غير مصرّح');
  
  await fsSet(env, `support_tickets/${ticket_id}/messages/${Date.now()}`, {
    uid: user.uid,
    message: String(message).slice(0, 2000),
    created_at: nowIso(),
  });
  await fsSet(env, `support_tickets/${ticket_id}`, {
    updated_at: nowIso(),
  }, 'update');
  
  return { success: true };
}

async function handleActivityPing(user, body, env, request) {
  await fsSet(env, `user_activity/${user.uid}`, {
    last_seen: nowIso(),
    ip: request.headers.get('cf-connecting-ip') || '',
  }, 'update').catch(() => {});
  
  return { success: true };
}

/* ═══════════════════════════════════════════════════════════
   Admin Endpoints
   ═══════════════════════════════════════════════════════════ */

async function handleAdminSettings(user, body, env) {
  await requireAdmin(user, env);
  
  const { key, value } = body;
  if (!key) throw httpError(400, 'المفتاح مطلوب');
  
  await fsSet(env, `settings/main`, { [key]: value }, 'update');
  
  return { success: true };
}

async function handleAdminDeposit(user, body, env) {
  await requireAdmin(user, env);
  
  const { uid, amount_usd, method } = body;
  if (!uid || !amount_usd || !method) throw httpError(400, 'البيانات ناقصة');
  
  return await fsRunTransaction(env, async (tx) => {
    const userRead = await tx.get(env, `users/${uid}`);
    const balance = num(userRead.wallet_balance, 0);
    const amountNum = num(amount_usd, 0);
    
    tx.set(env, `users/${uid}`, { wallet_balance: balance + amountNum }, 'update');
    tx.set(env, `wallet_transactions/${Date.now()}_${randomSuffix(4)}`, {
      uid,
      type: 'admin_deposit',
      amount_usd: amountNum,
      method,
      admin_uid: user.uid,
      created_at: nowIso(),
    }, 'create');
    
    return { success: true };
  });
}

async function handleAdminWalletAdjust(user, body, env) {
  await requireAdmin(user, env);
  
  const { uid, amount_usd, reason } = body;
  if (!uid || !amount_usd) throw httpError(400, 'UID والمبلغ مطلوبان');
  
  return await fsRunTransaction(env, async (tx) => {
    const userRead = await tx.get(env, `users/${uid}`);
    const balance = num(userRead.wallet_balance, 0);
    const amountNum = num(amount_usd, 0);
    
    tx.set(env, `users/${uid}`, { wallet_balance: balance + amountNum }, 'update');
    tx.set(env, `wallet_transactions/${Date.now()}_${randomSuffix(4)}`, {
      uid,
      type: 'admin_adjust',
      amount_usd: amountNum,
      reason: String(reason || ''),
      admin_uid: user.uid,
      created_at: nowIso(),
    }, 'create');
    
    return { success: true };
  });
}

async function handleAdminCardFulfil(user, body, env) {
  await requireAdmin(user, env);
  
  const { card_id, card_data } = body;
  if (!card_id || !card_data) throw httpError(400, 'البيانات مطلوبة');
  
  const card = await fsGet(env, `manual_cards/${card_id}`).catch(() => null);
  if (!card) throw httpError(404, 'البطاقة غير موجودة');
  
  await fsSet(env, `manual_cards/${card_id}`, {
    status: 'completed',
    card_data: String(card_data).slice(0, 1000),
  }, 'update');
  
  return { success: true };
}

async function handleAdminCardReject(user, body, env) {
  await requireAdmin(user, env);
  
  const { card_id, reason } = body;
  if (!card_id) throw httpError(400, 'معرّف البطاقة مطلوب');
  
  return await fsRunTransaction(env, async (tx) => {
    const card = await tx.get(env, `manual_cards/${card_id}`);
    if (!card) throw httpError(404, 'البطاقة غير موجودة');
    
    const uid = card.uid;
    const userRead = await tx.get(env, `users/${uid}`);
    const balance = num(userRead.wallet_balance, 0);
    const refundAmount = num(card.amount_usd, 0) + num(card.fee_usd, 0);
    
    tx.set(env, `manual_cards/${card_id}`, {
      status: 'rejected',
      reject_reason: String(reason || ''),
    }, 'update');
    tx.set(env, `users/${uid}`, { wallet_balance: balance + refundAmount }, 'update');
    tx.set(env, `wallet_transactions/${Date.now()}_${randomSuffix(4)}`, {
      uid,
      type: 'card_refund',
      amount_usd: refundAmount,
      card_id,
      created_at: nowIso(),
    }, 'create');
    
    return { success: true };
  });
}

async function handleAdminSmsAssign(user, body, env) {
  await requireAdmin(user, env);
  
  const { uid, phone_number } = body;
  if (!uid || !phone_number) throw httpError(400, 'UID والرقم مطلوبان');
  
  await fsSet(env, `sms_assignments/${uid}`, {
    phone: phoneKey(phone_number),
    created_at: nowIso(),
  }, 'update');
  
  return { success: true };
}

async function handleAdminWithdraw(user, body, env) {
  await requireAdmin(user, env);
  
  const { wr_id, action } = body;
  if (!wr_id) throw httpError(400, 'معرّف الطلب مطلوب');
  
  const wr = await fsGet(env, `withdrawal_requests/${wr_id}`).catch(() => null);
  if (!wr) throw httpError(404, 'الطلب غير موجود');
  
  if (action === 'approve') {
    await fsSet(env, `withdrawal_requests/${wr_id}`, { status: 'approved' }, 'update');
  } else if (action === 'reject') {
    const refund = num(wr.amount_usd, 0) + num(wr.fee_usd, 0);
    
    await fsRunTransaction(env, async (tx) => {
      const userRead = await tx.get(env, `users/${wr.uid}`);
      const balance = num(userRead.wallet_balance, 0);
      
      tx.set(env, `withdrawal_requests/${wr_id}`, { status: 'rejected' }, 'update');
      tx.set(env, `users/${wr.uid}`, { wallet_balance: balance + refund }, 'update');
      tx.set(env, `wallet_transactions/${Date.now()}_${randomSuffix(4)}`, {
        uid: wr.uid,
        type: 'withdraw_refund',
        amount_usd: refund,
        wr_id,
        created_at: nowIso(),
      }, 'create');
    });
  }
  
  return { success: true };
}

async function handleAdminOrder(user, body, env) {
  await requireAdmin(user, env);
  
  const { order_id, action, response_data } = body;
  if (!order_id) throw httpError(400, 'معرّف الطلب مطلوب');
  
  const order = await fsGet(env, `store_orders/${order_id}`).catch(() => null);
  if (!order) throw httpError(404, 'الطلب غير موجود');
  
  if (action === 'complete') {
    await fsSet(env, `store_orders/${order_id}`, {
      status: 'completed',
      response_data: String(response_data || ''),
    }, 'update');
  } else if (action === 'reject') {
    const refund = num(order.price_total, 0);
    
    await fsRunTransaction(env, async (tx) => {
      const userRead = await tx.get(env, `users/${order.uid}`);
      const balance = num(userRead.wallet_balance, 0);
      
      tx.set(env, `store_orders/${order_id}`, { status: 'rejected' }, 'update');
      tx.set(env, `users/${order.uid}`, { wallet_balance: balance + refund }, 'update');
      tx.set(env, `wallet_transactions/${Date.now()}_${randomSuffix(4)}`, {
        uid: order.uid,
        type: 'order_refund',
        amount_usd: refund,
        order_id,
        created_at: nowIso(),
      }, 'create');
    });
  }
  
  return { success: true };
}

async function handleTicketClose(user, body, env) {
  await requireAdmin(user, env);
  
  const { ticket_id } = body;
  if (!ticket_id) throw httpError(400, 'معرّف التذكرة مطلوب');
  
  await fsSet(env, `support_tickets/${ticket_id}`, { status: 'closed' }, 'update');
  
  return { success: true };
}

async function purgeExpiredReveals(env) {
  const now = Math.floor(Date.now() / 1000);
  const rows = await fsQueryRaw(env, {
    from: [{ collectionId: 'manual_cards' }],
    limit: 100,
  });
  let purged = 0;
  for (const r of rows) {
    const d = withId(r, 'manual_cards');
    const created = new Date(d.created_at || 0).getTime() / 1000;
    if (now - created > 2592000) {
      await fsDelete(env, `manual_cards/${d._id}`).catch(() => {});
      purged++;
    }
  }
  return purged;
}

/* ═══════════════════════════════════════════════════════════
   Firestore
   ═══════════════════════════════════════════════════════════ */

async function getSettings(env) {
  try {
    return await fsGet(env, 'settings/main');
  } catch {
    return {};
  }
}

async function fsGet(env, path) {
  const token = await getServiceToken(env);
  const docPath = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
  const res = await fetch(`${FS_BASE}/${docPath}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`fsGet failed: ${res.status}`);
  const data = await res.json();
  return fromFsFields(data.fields || {});
}

async function fsSet(env, path, data, mode = 'create') {
  const token = await getServiceToken(env);
  const docPath = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
  
  const updateMask = mode === 'update' ? { updateMask: { fieldPaths: Object.keys(data) } } : {};
  
  const res = await fetch(`${FS_BASE}/${docPath}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      fields: toFsFields(data),
      ...updateMask,
    }),
  });
  if (!res.ok) throw new Error(`fsSet failed: ${res.status}`);
  return await res.json();
}

async function fsDelete(env, path) {
  const token = await getServiceToken(env);
  const docPath = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
  const res = await fetch(`${FS_BASE}/${docPath}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`fsDelete failed: ${res.status}`);
}

async function fsQueryRaw(env, query) {
  const token = await getServiceToken(env);
  const res = await fetch(`${FS_BASE}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ structuredQuery: query }),
  });
  if (!res.ok) throw new Error(`fsQueryRaw failed: ${res.status}`);
  
  const text = await res.text();
  const lines = text.trim().split('\n').filter(Boolean);
  const results = [];
  for (const line of lines) {
    const obj = JSON.parse(line);
    if (obj.document) results.push(obj.document);
  }
  return results;
}

async function fsRunTransaction(env, fn) {
  const token = await getServiceToken(env);
  const base = `${FS_BASE}/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)`;
  const transaction = randomSuffix(32);
  const writes = [];
  
  const tx = {
    set: (env, path, data, mode = 'create') => {
      const docPath = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
      if (mode === 'update') {
        writes.push({
          update: { name: docPath, fields: toFsFields(data) },
          updateMask: { fieldPaths: Object.keys(data) },
        });
      } else {
        writes.push({
          update: { name: docPath, fields: toFsFields(data) },
        });
      }
    },
    get: async (env, path) => {
      const token2 = await getServiceToken(env);
      const docPath = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`;
      const res = await fetch(`${FS_BASE}/${docPath}`, {
        headers: { authorization: `Bearer ${token2}` },
      });
      if (!res.ok) throw new Error(`tx.get failed`);
      const data = await res.json();
      return fromFsFields(data.fields || {});
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

function withId(doc, col) {
  const name = doc.name || '';
  const id = name.split('/').pop();
  const fields = fromFsFields(doc.fields || {});
  return { _id: id, ...fields };
}

function cleanBanners(banners) {
  if (!Array.isArray(banners)) return [];
  return banners.slice(0, 10).map(b => ({
    title: String(b.title || ''),
    text: String(b.text || ''),
    icon: String(b.icon || ''),
    link: String(b.link || ''),
  }));
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

async function getServiceToken(env) {
  const now = Date.now();
  if (_tokenCache.token && _tokenCache.exp > now) return _tokenCache.token;
  
  const payload = {
    iss: env.FIREBASE_SERVICE_ACCOUNT_EMAIL,
    sub: env.FIREBASE_SERVICE_ACCOUNT_EMAIL,
    aud: 'https://oauth2.googleapis.com/token',
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 3600,
  };
  
  const header = { alg: 'RS256', type: 'JWT' };
  const encoded = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
  
  const encoder = new TextEncoder();
  const keyData = await crypto.subtle.importKey(
    'pkcs8',
    str2ab(env.FIREBASE_PRIVATE_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyData, encoder.encode(encoded));
  const sig = bytesToB64url(new Uint8Array(signature));
  const jwt = `${encoded}.${sig}`;
  
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  
  const data = await res.json();
  _tokenCache = { token: data.access_token, exp: now + data.expires_in * 1000 };
  return data.access_token;
}

function str2ab(str) {
  const s = str.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '');
  const bytes = [];
  for (let i = 0; i < s.length; i += 2) bytes.push(parseInt(s.substr(i, 2), 16));
  return new Uint8Array(bytes).buffer;
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
