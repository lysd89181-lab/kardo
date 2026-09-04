/**
 * ═══════════════════════════════════════════════════════════
 *  KARDO — Cloudflare Worker Backend
 *  كاردو — الخدمة الخلفية
 * ═══════════════════════════════════════════════════════════
 *
 *  المسؤوليات:
 *   1. إخفاء مفتاح Kripicard (لا يظهر في المتصفح أبدًا)
 *   2. حساب التسعير في السيرفر فقط
 *   3. خصم المحفظة بشكل ذري (atomic) قبل الإصدار
 *   4. منع تكرار الإصدار (idempotency)
 *   5. استرجاع تلقائي عند الفشل
 *   6. تسجيل كل عملية
 *
 *  السرّيات المطلوبة (wrangler secret put):
 *   KRIPI_API_KEY          مفتاح Kripicard
 *   FIREBASE_PROJECT_ID    cd-card-87365
 *   FIREBASE_CLIENT_EMAIL  من ملف service account
 *   FIREBASE_PRIVATE_KEY   من ملف service account (كامل مع BEGIN/END)
 *   ALLOWED_ORIGIN         https://cards.example.com
 *   SMS_WEBHOOK_SECRET     سلسلة عشوائية طويلة لحماية webhook الرسائل
 * ═══════════════════════════════════════════════════════════
 */

const KRIPI_BASE = 'https://appapi.kripicard.com';
const FS_BASE = 'https://firestore.googleapis.com/v1';

// BINs التي لا تتطلب تاريخ ميلاد — الأفضل للعملاء
const BINS_NO_DOB = ['539502', '525847'];
const BINS_NEED_DOB = ['537872', '533171', '246001'];

// كاش داخلي (يعيش طول عمر الـisolate)
let _tokenCache = { token: null, exp: 0 };
let _jwksCache = { keys: null, exp: 0 };

// ═══════════════════════════════════════════════════════════
//  نقطة الدخول
// ═══════════════════════════════════════════════════════════

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
      if (status === 500) {
        console.error('UNHANDLED', err.stack || err.message);
      }
      return json(body, status, origin);
    }
  },
};

async function route(path, request, url, env) {
  // ── عام (بدون مصادقة) ────────────────────────────────
  if (path === '/api/quote' && request.method === 'GET') {
    return handleQuote(url, env);
  }
  if (path === '/api/status' && request.method === 'GET') {
    return handleStatus(env);
  }

  if (path === '/api/catalog' && request.method === 'GET') {
    return handleCatalog(env);
  }

  // ── Webhook رسائل التحويل (يُحمى بمفتاح سري لا بمصادقة المستخدم) ──
  // يقبل POST من التطبيق، و GET للاختبار اليدوي من المتصفح
  if (path === '/api/sms/webhook') {
    return handleSmsWebhook(request, env);
  }

  // ── webhook بوت تليجرام ──
  // ── تتطلب مصادقة ─────────────────────────────────────
  const body = request.method === 'POST' ? await safeJson(request) : {};
  const user = await requireAuth(request, env);

  switch (path) {
    case '/api/cards/create':       return handleCreateCard(user, body, env);
    case '/api/cards/fund':         return handleFundCard(user, body, env);
    case '/api/cards/freeze':       return handleFreeze(user, body, env);
    case '/api/cards/details':      return handleDetails(user, body, env);
    case '/api/cards/transactions': return handleTransactions(user, body, env);
    case '/api/cards/delete':       return handleDeleteCard(user, body, env);
    case '/api/wallet/claim':       return handleWalletClaim(user, body, env);
    case '/api/store/order':        return handleStoreOrder(user, body, env);
    case '/api/admin/order':        return handleAdminOrder(user, body, env);
    case '/api/wallet/usdt/invoice':return handleUsdtInvoice(user, body, env);
    case '/api/wallet/usdt/verify': return handleUsdtVerify(user, body, env);
    case '/api/ref/code':           return handleRefCode(user, body, env);
    case '/api/ref/claim':          return handleRefClaim(user, body, env);
    case '/api/activity/ping':      return handleActivityPing(user, body, env, request);

    // ── إدارية ─────────────────────────────────────────
    case '/api/admin/settings':     return handleAdminSettings(user, body, env);
    case '/api/admin/deposit':      return handleAdminDeposit(user, body, env);
    case '/api/admin/wallet-adjust':return handleAdminWalletAdjust(user, body, env);
    case '/api/admin/reconcile':    return handleAdminReconcile(user, body, env);
    case '/api/admin/sms/assign':   return handleAdminSmsAssign(user, body, env);
  }

  throw httpError(404, 'المسار غير موجود');
}

// ═══════════════════════════════════════════════════════════
//  التسعير — يُحسب في السيرفر فقط
// ═══════════════════════════════════════════════════════════

/**
 * صيغة التكلفة عند المزود (من توثيق Kripicard):
 *   fee = provider_fixed_fee + (amount × provider_pct)
 *   حسب التوثيق: $1.00 + 4%
 *   ⚠️ عدّلها من لوحة الإدارة بعد أول استدعاء حقيقي
 */
function computePricing(amount, s, kind = 'create') {
  const fixed = num(s.provider_fixed_fee, 1.0);
  const pct = num(s.provider_pct, 4) / 100;
  const margin = kind === 'create'
    ? num(s.margin, 2.6)
    : num(s.fund_margin, 1.5);

  const providerFee = round2(fixed + amount * pct);
  const providerCost = round2(amount + providerFee);
  const customerPrice = round2(providerCost + margin);
  const rate = num(s.usd_to_lyd, 7.0);

  return {
    amount: round2(amount),
    provider_fee: providerFee,
    provider_cost: providerCost,
    service_fee: round2(providerFee + margin),
    customer_price: customerPrice,
    profit: round2(margin),
    price_lyd: Math.ceil(customerPrice * rate),
    usd_to_lyd: rate,
  };
}

async function handleQuote(url, env) {
  const amount = num(url.searchParams.get('amount'), NaN);
  const kind = url.searchParams.get('kind') === 'fund' ? 'fund' : 'create';

  const s = await getSettings(env);

  if (!Number.isFinite(amount)) throw httpError(400, 'المبلغ غير صحيح');

  const min = num(s.min_amount, 10);
  const max = num(s.max_amount, 200);
  if (amount < min) throw httpError(400, `الحد الأدنى $${min}`);
  if (amount > max) throw httpError(400, `الحد الأقصى $${max}`);

  const p = computePricing(amount, s, kind);

  // لا نكشف تكلفة المزود ولا الربح للعميل
  return {
    success: true,
    quote: {
      amount: p.amount,
      service_fee: p.service_fee,
      total: p.customer_price,
      total_lyd: p.price_lyd,
    },
  };
}

/** يُبقي البانرات الصالحة فقط */
function cleanBanners(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(b => b && String(b.img || '').trim())
    .slice(0, 8)
    .map(b => ({
      img: String(b.img).slice(0, 900000),
      link: String(b.link || '').slice(0, 300),
      title: String(b.title || '').slice(0, 80),
    }));
}

/** يُبقي الحقول المعبّأة فقط ويضمن شكلها */
function cleanFields(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(f => f && String(f.value || '').trim())
    .slice(0, 8)
    .map(f => ({
      label: String(f.label || '').slice(0, 40),
      value: String(f.value || '').slice(0, 120),
      copy: f.copy === true,
    }));
}

/**
 * Admin-defined payment methods.
 * Manual only — automated ones need dedicated parsing per provider.
 */
function cleanCustomMethods(arr) {
  if (!Array.isArray(arr)) return {};
  const out = {};
  arr.slice(0, 10).forEach((m, i) => {
    if (!m || !m.label) return;
    const key = String(m.key || `custom${i}`)
      .replace(/[^a-z0-9_]/gi, '').slice(0, 20) || `custom${i}`;
    out[key] = {
      on: m.on !== false,
      custom: true,
      logo: String(m.logo || '').slice(0, 400000),
      label: String(m.label).slice(0, 40),
      rate: num(m.rate, 1),
      auto: false,
      fields: cleanFields(m.fields),
    };
  });
  return out;
}

/** طرق دفع يدوية يعرّفها المسؤول بالكامل من اللوحة */
function customMethods(arr) {
  const out = {};
  if (!Array.isArray(arr)) return out;
  for (const m of arr.slice(0, 10)) {
    const key = String(m && m.key || '').trim().toLowerCase()
      .replace(/[^a-z0-9_]/g, '').slice(0, 24);
    if (!key || ['libyana','almadar','bank','usdt','binance'].includes(key)) continue;
    out[key] = {
      on: m.on === true,
      custom: true,
      logo: String(m.logo || '').slice(0, 900000),
      label: String(m.label || key).slice(0, 40),
      rate: num(m.rate, 1),
      auto: false,
      fields: cleanFields(m.fields),
    };
  }
  return out;
}

async function handleStatus(env) {
  const s = await getSettings(env);
  return {
    success: true,
    issuing_enabled: !!s.issuing_enabled,
    funding_enabled: !!s.funding_enabled,
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
    method_order: s.method_order || 'libyana,almadar,usdt,bank,binance',
    banners: cleanBanners(s.banners),
    banners: Array.isArray(s.banners)
      ? s.banners.filter(b => b && b.img).slice(0, 3)
                 .map(b => ({ img: String(b.img).slice(0, 400000),
                              link: String(b.link || '').slice(0, 300),
                              title: String(b.title || '').slice(0, 80) }))
      : [],
    banner_rotate_sec: num(s.banner_rotate_sec, 6),
    kill_switch: s.kill_switch === true,
    kill_message: s.kill_message || 'الخدمة متوقفة مؤقتًا للصيانة.',
    referral: {
      on: s.referral_enabled === true,
      inviter: num(s.referral_bonus_inviter, 1),
      invitee: num(s.referral_bonus_invitee, 1),
      min_spend: num(s.referral_min_spend, 10),
    },
    limits: {
      on: s.limits_enabled !== false,
      cards: num(s.daily_cards_max, 3),
      amount: num(s.daily_amount_max, 200),
      deposit: num(s.daily_deposit_max, 500),
    },
    theme: {
      navy: s.theme_navy || '#0F172A',
      emerald: s.theme_emerald || '#10B981',
      bg: s.theme_bg || '#F8FAFC',
      radius: num(s.theme_radius, 14),
    },
    nav: {
      home: s.nav_home !== false, issue: s.nav_issue !== false,
      cards: s.nav_cards !== false, wallet: s.nav_wallet !== false,
      tx: s.nav_tx !== false, help: s.nav_help !== false,
      settings: s.nav_settings !== false,
    },
    texts: {
      tagline: s.brand_tagline || 'بطاقات أكثر .. فرص أكبر',
      hero_title: s.hero_title || 'بطاقة تعمل في كل مكان يقبل الدفع الإلكتروني',
      hero_sub: s.hero_sub || 'بالدولار الأمريكي · بدون رسوم شهرية · تُصدر فورًا',
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
      bank:    { on: s.m_bank_on === true, logo: s.m_bank_logo || '', label: s.m_bank_label || 'تحويل مصرفي',
                 rate: num(s.rate_bank, 9.5), auto: false,
                 fields: cleanFields(s.m_bank_fields) },
      usdt:    { on: s.m_usdt_on === true, logo: s.m_usdt_logo || '',
                 label: s.m_usdt_label || 'USDT',
                 rate: num(s.rate_usdt, 1),
                 auto: true, invoice: true,   // تحقق فوري من الشبكة
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

// ═══════════════════════════════════════════════════════════
//  إصدار بطاقة — أهم مسار في النظام
// ═══════════════════════════════════════════════════════════

async function handleCreateCard(user, body, env) {
  const amount = num(body.amount, NaN);
  const nameOnCard = String(body.name_on_card || '').trim();
  const cardName = String(body.card_name || 'بطاقتي').trim().slice(0, 40);
  const idemKey = String(body.idempotency_key || '').trim();

  // ── تحقق من المدخلات ───────────────────────────────
  if (!idemKey || idemKey.length < 8) {
    throw httpError(400, 'مفتاح العملية مفقود');
  }
  if (!Number.isFinite(amount)) throw httpError(400, 'المبلغ غير صحيح');
  if (!/^[A-Za-z][A-Za-z .'-]{1,24}$/.test(nameOnCard)) {
    throw httpError(400, 'اسم حامل البطاقة يجب أن يكون بحروف لاتينية (حرفان على الأقل)');
  }

  const s = await getSettings(env);
  assertLive(s);
  if (!s.issuing_enabled) {
    throw httpError(503, s.maintenance_message || 'إصدار البطاقات متوقف مؤقتًا');
  }
  await assertDailyLimit(env, s, user.uid, 'card', amount);

  const min = num(s.min_amount, 10);
  const max = num(s.max_amount, 200);
  if (amount < min) throw httpError(400, `الحد الأدنى $${min}`);
  if (amount > max) throw httpError(400, `الحد الأقصى $${max}`);

  const bin = String(s.default_bin || BINS_NO_DOB[0]);
  const dob = String(body.date_of_birth || '').trim();
  if (BINS_NEED_DOB.includes(bin) && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    throw httpError(400, 'تاريخ الميلاد مطلوب لهذا النوع من البطاقات');
  }

  const p = computePricing(amount, s, 'create');

  // ── الحد اليومي: حماية رصيد المزود من استنزاف فردي ──
  await checkDailyLimit(env, user.uid, p.customer_price, s);

  // ── تحقق من رصيد المزود قبل أي خصم ─────────────────
  const float = num(s.provider_float, 0);
  if (float > 0 && float < p.provider_cost) {
    throw httpError(503, 'الخدمة غير متاحة حاليًا، حاول لاحقًا');
  }

  // ── منع التكرار + خصم ذري من المحفظة ───────────────
  const orderId = `KRD${Date.now()}${randomSuffix(4)}`;
  const claim = await claimOrderAtomic(env, {
    uid: user.uid,
    idemKey,
    orderId,
    type: 'create',
    amount,
    pricing: p,
    meta: { card_name: cardName, name_on_card: nameOnCard, bin },
  });

  // طلب مكرر — نُعيد نفس النتيجة بدل إصدار بطاقة ثانية
  if (claim.duplicate) {
    return { success: true, duplicate: true, order_id: claim.orderId, status: claim.status };
  }

  // ── نداء المزود ────────────────────────────────────
  const payload = {
    api_key: env.KRIPI_API_KEY,
    bin,
    amount,
    name_on_card: nameOnCard,
  };
  if (user.email) payload.email = user.email;
  if (dob) payload.dateOfBirth = dob;

  let res;
  try {
    res = await kripi('/api/external/cards/createcard', payload, env);
  } catch (err) {
    await refundOrder(env, orderId, user.uid, p.customer_price, err.publicMessage || 'تعذّر الاتصال بالمزود');
    await logOp(env, user.uid, 'create_card', { amount, bin }, { error: String(err.message) }, false);
    throw httpError(502, 'تعذّر إصدار البطاقة، تم إرجاع المبلغ إلى محفظتك');
  }

  if (!res.success || !res.card_id) {
    await refundOrder(env, orderId, user.uid, p.customer_price, res.message || 'رفض المزود');
    await logOp(env, user.uid, 'create_card', { amount, bin }, res, false);
    throw httpError(502, 'تعذّر إصدار البطاقة، تم إرجاع المبلغ إلى محفظتك');
  }

  // ── نجاح: التكلفة الفعلية من رد المزود ─────────────
  const actualFee = num(res.fee, p.provider_fee);
  const actualCost = num(res.total_charged, p.provider_cost);
  const actualProfit = round2(p.customer_price - actualCost);

  // تحذير إذا كانت التكلفة الفعلية أعلى من المتوقع
  const marginWarning = actualCost > p.provider_cost + 0.01;

  await Promise.all([
    // البطاقة
    fsSet(env, `cards/${res.card_id}`, {
      uid: user.uid,
      order_id: orderId,
      card_name: cardName,
      name_on_card: nameOnCard,
      kripi_card_id: res.card_id,
      bin: String(res.bin || bin),
      last4: String(res.last_4 || ''),
      brand: 'MasterCard',
      amount_loaded: round2(num(res.amount, amount)),
      customer_paid: p.customer_price,
      provider_cost: actualCost,
      provider_fee: actualFee,
      profit: actualProfit,
      status: 'active',
      created_at: nowIso(),
    }),
    // الطلب
    fsPatch(env, `card_orders/${orderId}`, {
      status: 'completed',
      card_id: res.card_id,
      provider_cost: actualCost,
      provider_fee: actualFee,
      profit: actualProfit,
      margin_warning: marginWarning,
      updated_at: nowIso(),
    }),
    // خصم رصيد المزود
    fsIncrement(env, 'card_settings/ops', { provider_float: -actualCost }),
    // إحصاء المستخدم
    fsIncrement(env, `users/${user.uid}`, { cards_count: 1, total_spent: p.customer_price }),
    bumpCounter(env, user.uid, { cards: 1, amount: round2(amount) }),
    maybePayReferral(env, s, user.uid, p.customer_price),
    logOp(env, user.uid, 'create_card', { amount, bin }, redact(res), true),
  ]);

  await bumpDailyUsage(env, user.uid, p.customer_price);
  await maybePayReferral(env, user.uid, s);

  return {
    success: true,
    order_id: orderId,
    card: {
      card_id: res.card_id,
      last4: String(res.last_4 || ''),
      card_name: cardName,
      name_on_card: nameOnCard,
      balance: round2(num(res.amount, amount)),
      status: 'active',
    },
  };
}

// ═══════════════════════════════════════════════════════════
//  شحن بطاقة
// ═══════════════════════════════════════════════════════════

async function handleFundCard(user, body, env) {
  const amount = num(body.amount, NaN);
  const cardId = String(body.card_id || '').trim();
  const idemKey = String(body.idempotency_key || '').trim();

  if (!idemKey || idemKey.length < 8) throw httpError(400, 'مفتاح العملية مفقود');
  if (!cardId) throw httpError(400, 'معرّف البطاقة مفقود');
  if (!Number.isFinite(amount)) throw httpError(400, 'المبلغ غير صحيح');

  const s = await getSettings(env);
  assertLive(s);
  if (!s.funding_enabled) throw httpError(503, 'إعادة الشحن متوقفة مؤقتًا');
  await assertDailyLimit(env, s, user.uid, 'card', amount);

  const min = num(s.min_amount, 10);
  if (amount < min) throw httpError(400, `الحد الأدنى للشحن $${min}`);

  await assertCardOwnership(env, cardId, user.uid);

  const p = computePricing(amount, s, 'fund');

  const float = num(s.provider_float, 0);
  if (float > 0 && float < p.provider_cost) {
    throw httpError(503, 'الخدمة غير متاحة حاليًا، حاول لاحقًا');
  }

  const orderId = `KRD${Date.now()}${randomSuffix(4)}`;
  const claim = await claimOrderAtomic(env, {
    uid: user.uid, idemKey, orderId, type: 'fund',
    amount, pricing: p, meta: { card_id: cardId },
  });
  if (claim.duplicate) {
    return { success: true, duplicate: true, order_id: claim.orderId, status: claim.status };
  }

  let res;
  try {
    res = await kripi('/api/external/cards/fundcard', {
      api_key: env.KRIPI_API_KEY, card_id: cardId, amount,
    }, env);
  } catch (err) {
    await refundOrder(env, orderId, user.uid, p.customer_price, 'تعذّر الاتصال بالمزود');
    throw httpError(502, 'تعذّر شحن البطاقة، تم إرجاع المبلغ إلى محفظتك');
  }

  if (!res.success) {
    await refundOrder(env, orderId, user.uid, p.customer_price, res.message || 'رفض المزود');
    await logOp(env, user.uid, 'fund_card', { cardId, amount }, res, false);
    throw httpError(502, 'تعذّر شحن البطاقة، تم إرجاع المبلغ إلى محفظتك');
  }

  const d = res.data || {};
  const actualCost = num(d.total_debited, p.provider_cost);
  const actualProfit = round2(p.customer_price - actualCost);

  await Promise.all([
    fsPatch(env, `card_orders/${orderId}`, {
      status: 'completed',
      card_id: cardId,
      provider_cost: actualCost,
      profit: actualProfit,
      margin_warning: actualCost > p.provider_cost + 0.01,
      updated_at: nowIso(),
    }),
    fsIncrement(env, `cards/${cardId}`, { amount_loaded: amount, customer_paid: p.customer_price, profit: actualProfit }),
    fsIncrement(env, 'card_settings/ops', { provider_float: -actualCost }),
    fsIncrement(env, `users/${user.uid}`, { total_spent: p.customer_price }),
    logOp(env, user.uid, 'fund_card', { cardId, amount }, res, true),
  ]);

  return { success: true, order_id: orderId, amount: round2(amount) };
}

// ═══════════════════════════════════════════════════════════
//  تجميد / تفاصيل / معاملات
// ═══════════════════════════════════════════════════════════

async function handleFreeze(user, body, env) {
  const cardId = String(body.card_id || '').trim();
  const action = body.action === 'unfreeze' ? 'unfreeze' : 'freeze';
  if (!cardId) throw httpError(400, 'معرّف البطاقة مفقود');

  await assertCardOwnership(env, cardId, user.uid);

  const res = await kripi('/api/external/premium/Freeze_Unfreeze', {
    api_key: env.KRIPI_API_KEY, card_id: cardId, action,
  }, env);

  if (!res.success) throw httpError(502, res.message || 'تعذّر تنفيذ العملية');

  await fsPatch(env, `cards/${cardId}`, {
    status: action === 'freeze' ? 'frozen' : 'active',
    updated_at: nowIso(),
  });
  await logOp(env, user.uid, `card_${action}`, { cardId }, res, true);

  return { success: true, status: action === 'freeze' ? 'frozen' : 'active' };
}

async function handleDetails(user, body, env) {
  const cardId = String(body.card_id || '').trim();
  if (!cardId) throw httpError(400, 'معرّف البطاقة مفقود');

  await assertCardOwnership(env, cardId, user.uid);

  const res = await kripi('/api/external/cards/carddetails', {
    api_key: env.KRIPI_API_KEY, card_id: cardId,
  }, env);

  if (!res.success) throw httpError(502, 'تعذّر جلب البيانات');

  // ⚠️ لا نخزّن رقم البطاقة ولا CVV في Firestore — تمرير مباشر فقط
  await logOp(env, user.uid, 'view_details', { cardId }, { viewed: true }, true);

  return {
    success: true,
    details: {
      card_number: res.card_number,
      expiry: res.expiry,
      cvv: res.cvv,
      balance: round2(num(res.balance, 0)),
      status: res.status,
    },
  };
}

async function handleTransactions(user, body, env) {
  const cardId = String(body.card_id || '').trim();
  if (!cardId) throw httpError(400, 'معرّف البطاقة مفقود');

  await assertCardOwnership(env, cardId, user.uid);

  const res = await kripi('/api/external/cards/transactions', {
    api_key: env.KRIPI_API_KEY, card_id: cardId,
  }, env);

  if (!res.success) throw httpError(502, 'تعذّر جلب المعاملات');

  const d = res.data || {};
  // مزامنة الرصيد المباشر
  if (Number.isFinite(num(d.balance, NaN))) {
    await fsPatch(env, `cards/${cardId}`, {
      live_balance: round2(num(d.balance, 0)),
      balance_synced_at: nowIso(),
    });
  }

  return {
    success: true,
    balance: round2(num(d.balance, 0)),
    total: num(d.total_transactions, 0),
    transactions: (d.transactions || []).map(t => ({
      date: t.date, type: t.type, merchant: t.merchant,
      amount: round2(num(t.amount, 0)), status: t.status, reason: t.reason,
    })),
  };
}

// ═══════════════════════════════════════════════════════════
//  حذف بطاقة (يرجّع الرصيد لمحفظة كاردو عند المزود)
// ═══════════════════════════════════════════════════════════

async function handleDeleteCard(user, body, env) {
  const cardId = String(body.card_id || '').trim();
  if (!cardId) throw httpError(400, 'معرّف البطاقة مفقود');

  const card = await assertCardOwnership(env, cardId, user.uid);
  if (card.status === 'deleted') throw httpError(400, 'البطاقة محذوفة بالفعل');

  const s = await getSettings(env);
  const deletionFee = num(s.deletion_fee, 2.0);

  const res = await kripi('/api/external/cards/deletecard', {
    api_key: env.KRIPI_API_KEY, card_id: cardId,
  }, env);

  if (!res.success) throw httpError(502, res.message || 'تعذّر حذف البطاقة');

  const refunded = round2(num(res.refunded, 0));
  // ما يُرجَع للعميل = ما استُرد من المزود (خصم رسوم الحذف يتحمّلها العميل)
  const toUser = Math.max(0, refunded);

  await Promise.all([
    fsPatch(env, `cards/${cardId}`, {
      status: 'deleted',
      deleted_at: nowIso(),
      refunded_amount: refunded,
      deletion_fee: num(res.fee, deletionFee),
    }),
    toUser > 0 ? fsIncrement(env, `users/${user.uid}`, { wallet_balance: toUser }) : Promise.resolve(),
    fsIncrement(env, 'card_settings/ops', { provider_float: refunded }),
    logOp(env, user.uid, 'delete_card', { cardId }, res, true),
  ]);

  return {
    success: true,
    refunded_to_wallet: toUser,
    deletion_fee: num(res.fee, deletionFee),
  };
}

// ═══════════════════════════════════════════════════════════
//  الخصم الذري ومنع التكرار
// ═══════════════════════════════════════════════════════════

/**
 * في معاملة Firestore واحدة:
 *   1. يتحقق من مفتاح idempotency (طلب مكرر؟)
 *   2. يقرأ رصيد المحفظة
 *   3. يخصم السعر
 *   4. ينشئ الطلب بحالة processing
 * إما تنجح كلها أو لا شيء.
 */
async function claimOrderAtomic(env, { uid, idemKey, orderId, type, amount, pricing, meta }) {
  const tx = await fsBeginTransaction(env);
  const idemPath = `idempotency/${idemKey}`;
  const userPath = `users/${uid}`;

  const docs = await fsBatchGet(env, [idemPath, userPath], tx);
  const existing = docs[idemPath];
  const userDoc = docs[userPath];

  // ── طلب مكرر ────────────────────────────────────────
  if (existing) {
    await fsRollback(env, tx);
    const prevOrder = existing.order_id;
    const prev = prevOrder ? await fsGet(env, `card_orders/${prevOrder}`) : null;
    return { duplicate: true, orderId: prevOrder, status: prev ? prev.status : 'unknown' };
  }

  if (!userDoc) {
    await fsRollback(env, tx);
    throw httpError(400, 'الحساب غير مكتمل، أعد تسجيل الدخول');
  }
  if (userDoc.banned) {
    await fsRollback(env, tx);
    throw httpError(403, 'الحساب موقوف');
  }

  const balance = num(userDoc.wallet_balance, 0);
  if (balance < pricing.customer_price) {
    await fsRollback(env, tx);
    throw httpError(400, `رصيدك غير كافٍ — المطلوب $${pricing.customer_price.toFixed(2)}، المتاح $${balance.toFixed(2)}`);
  }

  const newBalance = round2(balance - pricing.customer_price);

  await fsCommit(env, [
    // بصمة منع التكرار
    write(env, idemPath, { order_id: orderId, uid, created_at: nowIso() }),
    // خصم المحفظة (قيمة مقروءة داخل المعاملة = آمن)
    writeMask(env, userPath, { wallet_balance: newBalance }, ['wallet_balance']),
    // الطلب
    write(env, `card_orders/${orderId}`, {
      uid, type, status: 'processing',
      idempotency_key: idemKey,
      amount: round2(amount),
      customer_price: pricing.customer_price,
      provider_cost_expected: pricing.provider_cost,
      profit_expected: pricing.profit,
      ...meta,
      created_at: nowIso(),
      updated_at: nowIso(),
    }),
  ], tx);

  return { duplicate: false, orderId, newBalance };
}

async function refundOrder(env, orderId, uid, amount, reason) {
  try {
    await Promise.all([
      fsIncrement(env, `users/${uid}`, { wallet_balance: round2(amount) }),
      fsPatch(env, `card_orders/${orderId}`, {
        status: 'refunded',
        error: String(reason).slice(0, 300),
        refunded_at: nowIso(),
        updated_at: nowIso(),
      }),
      fsIncrement(env, 'card_settings/ops', { failed_ops: 1 }),
    ]);
  } catch (e) {
    // فشل الاسترجاع = يجب أن يُرى في اللوحة
    console.error('REFUND_FAILED', orderId, e.message);
    await fsSet(env, `card_logs/${Date.now()}_refund_fail`, {
      uid, action: 'refund_failed', order_id: orderId,
      amount: round2(amount), error: String(e.message),
      needs_attention: true, created_at: nowIso(),
    }).catch(() => {});
  }
}

async function assertCardOwnership(env, cardId, uid) {
  const card = await fsGet(env, `cards/${cardId}`);
  if (!card) throw httpError(404, 'البطاقة غير موجودة');
  if (card.uid !== uid) throw httpError(403, 'غير مصرّح');
  return card;
}

// ═══════════════════════════════════════════════════════════
//  المسارات الإدارية
// ═══════════════════════════════════════════════════════════

async function requireAdmin(user, env) {
  const admin = await fsGet(env, `admins/${user.uid}`);
  if (!admin) throw httpError(403, 'غير مصرّح');
  return admin;
}

async function handleAdminSettings(user, body, env) {
  await requireAdmin(user, env);

  const allowedPricing = [
    'provider_fixed_fee', 'provider_pct', 'margin', 'fund_margin',
    'deletion_fee', 'min_amount', 'max_amount', 'usd_to_lyd', 'default_bin',
    'rate_libyana', 'rate_almadar', 'rate_bank', 'rate_usdt', 'max_deposit_lyd',
  ];
  const allowedOps = [
    'issuing_enabled', 'funding_enabled', 'provider_float',
    'low_balance_threshold', 'maintenance_message', 'deposit_phone',
    'm_libyana_on', 'm_libyana_label', 'm_almadar_on', 'm_almadar_label',
    'm_bank_on', 'm_bank_label', 'm_usdt_on', 'm_usdt_label',
    'm_binance_on', 'm_binance_label',
    'm_libyana_phone', 'm_almadar_phone', 'method_order', 'sms_allowed_senders',
    'banners', 'banner_rotate_sec', 'custom_methods',
    'kill_switch', 'kill_message',
    'daily_cards_max', 'daily_amount_max', 'daily_deposit_max',
    'platform_daily_max', 'limits_enabled',
    'referral_enabled', 'referral_bonus_inviter', 'referral_bonus_invitee',
    'referral_min_spend', 'activity_log_enabled',
    'usdt_address', 'usdt_min', 'usdt_max', 'usdt_window_min',
    'usdt_frac_min', 'usdt_frac_max',
    'm_libyana_logo', 'm_almadar_logo', 'm_bank_logo',
    'm_usdt_logo', 'm_binance_logo',
    'm_bank_fields', 'm_usdt_fields', 'm_binance_fields', 'deposit_note',
    'theme_navy', 'theme_emerald', 'theme_bg', 'theme_radius',
    'nav_home', 'nav_issue', 'nav_cards', 'nav_wallet', 'nav_tx',
    'nav_help', 'nav_settings',
    'brand_tagline', 'hero_title', 'hero_sub', 'support_url',
  ];

  const pricing = {}, ops = {};
  for (const k of allowedPricing) if (k in body) pricing[k] = body[k];
  for (const k of allowedOps) if (k in body) ops[k] = body[k];

  if (pricing.default_bin && ![...BINS_NO_DOB, ...BINS_NEED_DOB].includes(String(pricing.default_bin))) {
    throw httpError(400, 'BIN غير مدعوم');
  }

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

  return { success: true, updated: { ...pricing, ...ops } };
}

async function handleAdminDeposit(user, body, env) {
  await requireAdmin(user, env);

  const depositId = String(body.deposit_id || '').trim();
  const action = body.action === 'reject' ? 'reject' : 'approve';
  if (!depositId) throw httpError(400, 'معرّف الإيداع مفقود');

  const dep = await fsGet(env, `wallet_deposits/${depositId}`);
  if (!dep) throw httpError(404, 'الإيداع غير موجود');
  if (dep.status !== 'pending') throw httpError(400, 'تمت معالجة هذا الإيداع مسبقًا');

  if (action === 'reject') {
    const why = String(body.reason || '').slice(0, 200);
    await fsPatch(env, `wallet_deposits/${depositId}`, {
      status: 'rejected', reject_reason: why,
      reviewed_by: user.uid, reviewed_at: nowIso(),
    });
    return { success: true, status: 'rejected' };
  }

  const amountUsd = round2(num(dep.amount_usd, 0));
  if (amountUsd <= 0) throw httpError(400, 'مبلغ غير صحيح');

  await Promise.all([
    fsIncrement(env, `users/${dep.uid}`, { wallet_balance: amountUsd }),
    fsPatch(env, `wallet_deposits/${depositId}`, {
      status: 'approved', reviewed_by: user.uid, reviewed_at: nowIso(),
    }),
    logOp(env, user.uid, 'approve_deposit', { depositId, amountUsd }, { ok: true }, true),
  ]);

  return { success: true, status: 'approved', credited: amountUsd };
}

async function handleAdminWalletAdjust(user, body, env) {
  await requireAdmin(user, env);

  const uid = String(body.uid || '').trim();
  const delta = num(body.delta, NaN);
  const reason = String(body.reason || '').trim();

  if (!uid) throw httpError(400, 'معرّف المستخدم مفقود');
  if (!Number.isFinite(delta) || delta === 0) throw httpError(400, 'المبلغ غير صحيح');
  if (reason.length < 3) throw httpError(400, 'السبب مطلوب');

  await fsIncrement(env, `users/${uid}`, { wallet_balance: round2(delta) });
  await logOp(env, user.uid, 'wallet_adjust', { uid, delta, reason }, { ok: true }, true);

  return { success: true, delta: round2(delta) };
}

/**
 * مطابقة البطاقات مع المزود — لاكتشاف بطاقات صُدرت
 * ولم تُسجّل في Firestore (فشل بعد نداء ناجح)
 */
async function handleAdminReconcile(user, body, env) {
  await requireAdmin(user, env);

  const res = await kripi('/api/external/cards/list', { api_key: env.KRIPI_API_KEY }, env);
  if (!res.success) throw httpError(502, 'تعذّر جلب قائمة البطاقات');

  const providerCards = res.data || [];
  const orphans = [];

  for (const c of providerCards) {
    const local = await fsGet(env, `cards/${c.card_id}`);
    if (!local) {
      orphans.push({
        card_id: c.card_id,
        last4: c.last4,
        name_on_card: c.name_on_card,
        balance: c.balance,
        created_at: c.created_at,
      });
    }
  }

  return { success: true, provider_total: providerCards.length, orphans };
}

/**
 * إعلان تحويل من العميل: رقمه + المبلغ بالدينار.
 * إن كانت رسالة التحويل قد وصلت مسبقًا → يُضاف الرصيد فورًا.
 * وإلا يُحفظ الإعلان معلّقًا، وتُطابقه أول رسالة مناسبة تصل.
 */
async function handleWalletClaim(user, body, env) {
  const phone = normalizePhone(body.phone || '');
  const amountLyd = round2(num(body.amount_lyd, NaN));
  const method = body.method === 'almadar' ? 'almadar' : 'libyana';

  const st = await getSettings(env);
  assertLive(st);
  const enabled = method === 'almadar'
    ? st.m_almadar_on !== false
    : st.m_libyana_on !== false;
  if (!enabled) throw httpError(503, 'طريقة الدفع هذه غير متاحة حاليًا');

  if (phone.length !== 9) throw httpError(400, 'رقم الهاتف غير صحيح');
  if (!Number.isFinite(amountLyd) || amountLyd <= 0) {
    throw httpError(400, 'أدخل المبلغ الذي حوّلته');
  }

  const rate = method === 'almadar'
    ? num(st.rate_almadar, 12.5)
    : num(st.rate_libyana, 11.8);
  const amountUsd = round2(amountLyd / rate);

  const maxLyd = num(st.max_deposit_lyd, 5000);
  if (amountLyd > maxLyd) throw httpError(400, `الحد الأقصى ${maxLyd} د.ل`);
  await assertDailyLimit(env, st, user.uid, 'deposit', amountUsd);

  // ── هل وصلت الرسالة قبل الإعلان؟ ──
  const sms = await findUnclaimedSms(env, phone, amountLyd);

  if (sms) {
    const credited = round2(num(sms.amount_usd, amountUsd));
    await Promise.all([
      fsPatch(env, `sms_transactions/${sms._id}`, {
        status: 'claimed', uid: user.uid, claimed_at: nowIso(), matched_by: 'claim',
      }),
      fsIncrement(env, `users/${user.uid}`, { wallet_balance: credited }),
      fsSet(env, `wallet_deposits/${sms._id}`, {
        uid: user.uid,
        amount_usd: credited,
        amount_lyd: num(sms.amount_lyd, amountLyd),
        method: (method === 'libyana' ? 'ليبيانا' : 'المدار') + ' — تلقائي',
        claim_phone: phone,
        proof_url: '', note: 'حوالة من ' + phone,
        status: 'approved', auto: true, created_at: nowIso(),
      }),
      logOp(env, user.uid, 'claim_matched', { phone, amountLyd }, { credited }, true),
    ]);
    return { success: true, matched: true, credited_usd: credited };
  }

  // ── لم تصل بعد: نحفظ الإعلان بانتظار الرسالة ──
  const claimId = `CLM${Date.now()}${randomSuffix(4)}`;
  await fsSet(env, `wallet_deposits/${claimId}`, {
    uid: user.uid,
    amount_usd: amountUsd,
    amount_lyd: amountLyd,
    method: method === 'libyana' ? 'ليبيانا' : 'المدار',
    claim_phone: phone,
    proof_url: '', note: '',
    status: 'pending',
    awaiting_sms: true,
    created_at: nowIso(),
  });

  return { success: true, matched: false, claim_id: claimId };
}

/** البحث عن رسالة وصلت ولم تُربط بعد، بنفس الرقم والمبلغ */
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

  const rows = res
    .map(r => {
      const d = fromFsFields(r.document.fields || {});
      d._id = r.document.name.split('/documents/sms_transactions/')[1];
      return d;
    })
    .filter(d => Math.abs(num(d.amount_lyd, -1) - amountLyd) < 0.005);

  return rows[0] || null;
}

/** البحث عن إعلان معلّق ينتظر رسالة بنفس الرقم والمبلغ */
async function findPendingClaim(env, phone, amountLyd) {
  // ملاحظة: استعلام بمساواة فقط بلا ترتيب — كي لا يحتاج
  // فهرسًا مركّبًا في Firestore. الترتيب يتم محليًا.
  const res = await fsQuery(env, {
    from: [{ collectionId: 'wallet_deposits' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL',
            value: { stringValue: 'pending' } } },
          { fieldFilter: { field: { fieldPath: 'claim_phone' }, op: 'EQUAL',
            value: { stringValue: phone } } },
        ],
      },
    },
    limit: 20,
  });

  // نطابق المبلغ محليًا ونأخذ الأقدم
  const rows = res
    .map(r => {
      const d = fromFsFields(r.document.fields || {});
      d._id = r.document.name.split('/documents/wallet_deposits/')[1];
      return d;
    })
    .filter(d => Math.abs(num(d.amount_lyd, -1) - amountLyd) < 0.005)
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));

  return rows[0] || null;
}

/**
 * ينفّذ استعلامًا ويُعيد الوثائق الموجودة.
 * أي فشل (فهرس ناقص، صلاحية، شبكة) يُعيد قائمة فارغة بدل
 * إسقاط الحوالة كلها — الرسالة تُحفظ ويُربط صاحبها يدويًا.
 */
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

// ═══════════════════════════════════════════════════════════
//  الحدود اليومية
// ═══════════════════════════════════════════════════════════

/**
 * يمنع عميلًا واحدًا من استنزاف رصيد المزود في يوم.
 * العدّاد يُخزَّن بمفتاح اليوم فيُصفَّر تلقائيًا كل 24 ساعة.
 */
async function checkDailyLimit(env, uid, amount, s) {
  const maxCards = num(s.daily_cards_max, 0);
  const maxAmount = num(s.daily_amount_max, 0);
  if (maxCards <= 0 && maxAmount <= 0) return;

  const day = new Date().toISOString().slice(0, 10);
  const usage = await fsGet(env, `daily_usage/${uid}_${day}`);
  const cards = num(usage && usage.cards, 0);
  const spent = num(usage && usage.amount, 0);

  if (maxCards > 0 && cards >= maxCards) {
    throw httpError(429, `بلغت حدّك اليومي (${maxCards} بطاقات). حاول غدًا.`);
  }
  if (maxAmount > 0 && spent + amount > maxAmount) {
    throw httpError(429, `بلغت حدّك اليومي ($${maxAmount}). حاول غدًا.`);
  }
}

async function bumpDailyUsage(env, uid, amount) {
  const day = new Date().toISOString().slice(0, 10);
  const path = `daily_usage/${uid}_${day}`;
  try {
    const cur = await fsGet(env, path);
    if (!cur) {
      await fsSet(env, path, { uid, day, cards: 1, amount: round2(amount) });
    } else {
      await fsIncrement(env, path, { cards: 1, amount: round2(amount) });
    }
  } catch (e) {
    console.error('DAILY_BUMP_FAILED', e.message);
  }
}

/** يسجّل دخول العميل — تناديه الواجهة مرة عند فتح الموقع */
async function handleActivityPing(user, body, env, request) {
  const s = await getSettings(env);
  await logActivity(env, s, user.uid, request, 'login');
  return { success: true };
}

// ═══════════════════════════════════════════════════════════
//  المتجر — الأقسام والمنتجات والطلبات
// ═══════════════════════════════════════════════════════════

/**
 * المنتج نوعان:
 *   stock  — أكواد مخزّنة تُسلَّم لحظة الدفع
 *   manual — يُنفَّذ يدويًا بعد أن يعبّي العميل حقوله
 * الحقول يعرّفها المسؤول لكل منتج، فلا يحتاج أي منتج جديد كودًا.
 */

/** يقرأ الأقسام والمنتجات المتاحة للعرض */
async function handleCatalog(env) {
  const [cats, prods] = await Promise.all([
    fsQuery(env, { from: [{ collectionId: 'categories' }], limit: 40 }),
    fsQuery(env, { from: [{ collectionId: 'products' }], limit: 300 }),
  ]);

  const categories = cats
    .map(r => withId(r, 'categories'))
    .filter(c => c.active !== false)
    .sort((a, b) => num(a.sort, 99) - num(b.sort, 99))
    .map(c => ({
      id: c._id, name: c.name || '', icon: c.icon || '', image: c.image || '',
      soon: c.soon === true, sort: num(c.sort, 99),
    }));

  const products = prods
    .map(r => withId(r, 'products'))
    .filter(p => p.active !== false)
    .sort((a, b) => num(a.sort, 99) - num(b.sort, 99))
    .map(p => ({
      id: p._id,
      cat: p.cat || '',
      name: p.name || '',
      desc: p.desc || '',
      image: p.image || '',
      price: round2(num(p.price, 0)),          // بالدينار
      kind: p.kind === 'stock' ? 'stock' : 'manual',
      fields: cleanProductFields(p.fields),
      note: p.note || '',
      stock: p.kind === 'stock' ? num(p.stock_count, 0) : null,
      available: p.kind === 'stock' ? num(p.stock_count, 0) > 0 : true,
    }));

  return { success: true, categories, products };
}

function withId(row, coll) {
  const d = fromFsFields(row.document.fields || {});
  d._id = row.document.name.split(`/documents/${coll}/`)[1];
  return d;
}

/** حقول يعبّيها العميل — يعرّفها المسؤول لكل منتج */
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

/**
 * ينفّذ طلب شراء لسلة كاملة.
 * الخصم من المحفظة ذرّي: نخصم أولًا ثم نسلّم، وإن فشل شيء نُعيد.
 */
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
  await fsSet(env, `idempotency/${idem}`, { uid: user.uid, created_at: nowIso() });

  // ── تجميع المنتجات والتحقق منها ──
  const lines = [];
  let totalLyd = 0;

  for (const it of items) {
    const pid = String(it && it.id || '').trim();
    const qty = Math.max(1, Math.min(20, Math.floor(num(it && it.qty, 1))));
    if (!pid) throw httpError(400, 'منتج غير صالح');

    const p = await fsGet(env, `products/${pid}`);
    if (!p || p.active === false) throw httpError(404, 'منتج غير متاح');

    const kind = p.kind === 'stock' ? 'stock' : 'manual';
    if (kind === 'stock' && num(p.stock_count, 0) < qty) {
      throw httpError(409, `الكمية غير متوفرة من ${p.name || 'المنتج'}`);
    }

    // الحقول الإجبارية
    const defs = cleanProductFields(p.fields);
    const vals = {};
    for (const f of defs) {
      const v = String((it.values && it.values[f.key]) || '').trim().slice(0, 120);
      if (f.required && !v) throw httpError(400, `${f.label} مطلوب لـ${p.name || 'المنتج'}`);
      if (v) vals[f.key] = v;
    }

    const price = round2(num(p.price, 0));
    totalLyd = round2(totalLyd + price * qty);

    lines.push({
      pid, qty, kind, values: vals,
      name: p.name || '', image: p.image || '',
      price_lyd: price, line_lyd: round2(price * qty),
    });
  }

  // ── التحويل للدولار والخصم ──
  const rate = num(s.usd_to_lyd, 11.8);
  const totalUsd = round2(totalLyd / rate);

  const me = await fsGet(env, `users/${user.uid}`);
  if (!me) throw httpError(400, 'الحساب غير مكتمل');
  if (me.banned === true) throw httpError(403, 'الحساب موقوف');
  if (num(me.wallet_balance, 0) < totalUsd) {
    throw httpError(402, `رصيدك غير كافٍ — تحتاج ${round2(totalUsd - num(me.wallet_balance, 0))}$`);
  }

  await fsIncrement(env, `users/${user.uid}`, { wallet_balance: -totalUsd });

  const orderId = `ORD${Date.now()}${randomSuffix(4)}`;
  const allStock = lines.every(l => l.kind === 'stock');

  try {
    // ── تسليم أكواد المخزون ──
    for (const l of lines) {
      if (l.kind !== 'stock') continue;
      l.codes = await takeStock(env, l.pid, l.qty);
      if (l.codes.length < l.qty) throw new Error('نفد المخزون أثناء التنفيذ');
    }

    await fsSet(env, `orders/${orderId}`, {
      uid: user.uid,
      items: lines,
      total_lyd: totalLyd,
      total_usd: totalUsd,
      rate,
      status: allStock ? 'completed' : 'pending',
      idempotency_key: idem,
      created_at: nowIso(),
      updated_at: nowIso(),
    });

    await Promise.all([
      fsIncrement(env, `users/${user.uid}`, { total_spent: totalUsd }),
      bumpCounter(env, user.uid, { deposit: 0 }),
      maybePayReferral(env, s, user.uid, totalUsd),
      logOp(env, user.uid, 'store_order',
        { items: lines.length, totalLyd }, { orderId, status: allStock ? 'completed' : 'pending' }, true),
    ]);

    return {
      success: true,
      order: { id: orderId, status: allStock ? 'completed' : 'pending',
               total_lyd: totalLyd, total_usd: totalUsd,
               items: lines.map(l => ({ name: l.name, qty: l.qty, codes: l.codes || null })) },
    };

  } catch (e) {
    // ── فشل التنفيذ: نُعيد المال فورًا ──
    await fsIncrement(env, `users/${user.uid}`, { wallet_balance: totalUsd }).catch(() => {});
    await logOp(env, user.uid, 'store_order_failed', { totalLyd }, { error: e.message }, false);
    throw httpError(503, e.message || 'تعذّر تنفيذ الطلب — أُعيد رصيدك');
  }
}

/** يسحب أكوادًا من مخزون منتج ويعلّمها مستهلكة */
async function takeStock(env, pid, qty) {
  const rows = await fsQuery(env, {
    from: [{ collectionId: 'stock' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: 'pid' }, op: 'EQUAL',
            value: { stringValue: pid } } },
          { fieldFilter: { field: { fieldPath: 'used' }, op: 'EQUAL',
            value: { booleanValue: false } } },
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
  if (codes.length) {
    await fsIncrement(env, `products/${pid}`, { stock_count: -codes.length }).catch(() => {});
  }
  return codes;
}

/** المسؤول ينفّذ طلبًا يدويًا أو يرفضه ويُعيد المال */
async function handleAdminOrder(user, body, env) {
  await requireAdmin(user, env);

  const id = String(body.order_id || '').trim();
  const action = body.action === 'reject' ? 'reject' : 'complete';
  if (!id) throw httpError(400, 'رقم الطلب مفقود');

  const o = await fsGet(env, `orders/${id}`);
  if (!o) throw httpError(404, 'الطلب غير موجود');
  if (o.status !== 'pending' && o.status !== 'processing') {
    throw httpError(400, 'الطلب مُغلق بالفعل');
  }

  if (action === 'reject') {
    const back = round2(num(o.total_usd, 0));
    await Promise.all([
      fsPatch(env, `orders/${id}`, {
        status: 'rejected',
        reject_reason: String(body.reason || '').slice(0, 160),
        updated_at: nowIso(),
      }),
      fsIncrement(env, `users/${o.uid}`, { wallet_balance: back, total_spent: -back }),
      logOp(env, user.uid, 'order_rejected', { id }, { refunded: back }, true),
    ]);
    return { success: true, refunded: back };
  }

  await Promise.all([
    fsPatch(env, `orders/${id}`, {
      status: 'completed',
      delivery: String(body.delivery || '').slice(0, 900),
      updated_at: nowIso(),
    }),
    logOp(env, user.uid, 'order_completed', { id }, {}, true),
  ]);
  return { success: true };
}

// ═══════════════════════════════════════════════════════════
//  الدعوات
// ═══════════════════════════════════════════════════════════

/** رمز قصير مقروء — بلا أحرف تلتبس بالأرقام */
function makeRefCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, x => A[x % A.length]).join('');
}

/** يُنشئ رمز الدعوة للعميل عند أول طلب */
async function handleRefCode(user, body, env) {
  const s = await getSettings(env);
  if (s.referral_enabled !== true) throw httpError(503, 'نظام الدعوات غير مفعّل');

  const me = await fsGet(env, `users/${user.uid}`);
  if (me && me.ref_code) {
    return { success: true, code: me.ref_code, bonus: num(s.referral_bonus_invitee, 1) };
  }

  // نحاول حتى نجد رمزًا غير مأخوذ
  let code = null;
  for (let i = 0; i < 12; i++) {
    const c = makeRefCode();
    const taken = await fsGet(env, `ref_codes/${c}`);
    if (!taken) { code = c; break; }
  }
  if (!code) throw httpError(503, 'تعذّر توليد الرمز، حاول مجددًا');

  await Promise.all([
    fsSet(env, `ref_codes/${code}`, { uid: user.uid, created_at: nowIso() }),
    fsPatch(env, `users/${user.uid}`, { ref_code: code }),
  ]);

  return { success: true, code, bonus: num(s.referral_bonus_invitee, 1) };
}

/** يربط العميل الجديد بمن دعاه — مرة واحدة فقط */
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

  // المكافأة تُصرف بعد أول إنفاق — لا عند التسجيل
  await fsPatch(env, `users/${user.uid}`, {
    referred_by: owner.uid,
    referred_code: code,
    referral_paid: false,
  });

  return {
    success: true,
    bonus: num(s.referral_bonus_invitee, 1),
    min_spend: num(s.referral_min_spend, 10),
  };
}

/**
 * تُستدعى بعد كل عملية شراء ناجحة.
 * تصرف المكافأة للطرفين متى بلغ المدعوّ حدّ الإنفاق.
 */
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
      forInvitee > 0
        ? fsIncrement(env, `users/${uid}`, { wallet_balance: forInvitee })
        : Promise.resolve(),
      forInviter > 0
        ? fsIncrement(env, `users/${me.referred_by}`,
            { wallet_balance: forInviter, referrals_count: 1 })
        : Promise.resolve(),
      fsSet(env, `wallet_deposits/REF${Date.now()}${randomSuffix(3)}`, {
        uid, amount_usd: forInvitee, amount_lyd: 0,
        method: 'مكافأة دعوة', proof_url: '', note: 'رمز ' + (me.referred_code || ''),
        status: 'approved', auto: true, created_at: nowIso(),
      }),
      logOp(env, uid, 'referral_paid',
        { inviter: me.referred_by }, { forInvitee, forInviter }, true),
    ]);
  } catch (e) {
    console.error('REFERRAL_FAILED', e.message);
  }
}

/**
 * زر الطوارئ — يوقف كل عملية مالية فورًا.
 * يُستدعى في مقدمة كل مسار يحرّك المال.
 */
function assertLive(s) {
  if (s.kill_switch === true) {
    throw httpError(503, s.kill_message || 'الخدمة متوقفة مؤقتًا للصيانة.');
  }
}

/** بداية اليوم الحالي بتوقيت ليبيا (UTC+2) بصيغة YYYY-MM-DD */
function todayKey() {
  const d = new Date(Date.now() + 2 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * عدّاد اليوم لمستخدم، أو للمنصة كلها إن كان uid = '_platform'.
 * مستندات مستقلة لكل يوم — بلا استعلامات ولا فهارس.
 */
async function readCounter(env, uid) {
  const d = await fsGet(env, `daily_counters/${uid}_${todayKey()}`);
  return {
    cards: num(d && d.cards, 0),
    amount: num(d && d.amount, 0),
    deposit: num(d && d.deposit, 0),
  };
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
  } catch (e) {
    console.error('COUNTER_FAILED', id, e.message);
  }
}

/**
 * يتحقق من الحدود اليومية قبل السماح بالعملية.
 * kind: 'card' لإصدار أو شحن بطاقة، 'deposit' لإضافة رصيد.
 */
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
    // سقف المنصة كلها — حماية من استنزاف الرصيد
    const platMax = num(s.platform_daily_max, 0);
    if (platMax > 0) {
      const plat = await readCounter(env, '_platform');
      if (plat.deposit + amount > platMax) {
        throw httpError(503, 'بلغت المنصة سقفها اليومي. حاول غدًا.');
      }
    }
  }
}

/** يسجّل دخول العميل — يظهر له في سجل نشاطه */
async function logActivity(env, s, uid, request, action) {
  if (s.activity_log_enabled === false) return;
  const cf = request.cf || {};
  try {
    await fsSet(env, `activity/${uid}_${Date.now()}`, {
      uid, action,
      ip: (request.headers.get('cf-connecting-ip') || '').slice(0, 45),
      country: String(cf.country || ''),
      city: String(cf.city || ''),
      ua: (request.headers.get('user-agent') || '').slice(0, 160),
      created_at: nowIso(),
    });
  } catch { /* السجل ليس حرجًا */ }
}

// ═══════════════════════════════════════════════════════════
//  فواتير USDT — تحقق فوري من شبكة TRON
// ═══════════════════════════════════════════════════════════

const TRON_API = 'https://api.trongrid.io';
// عقد USDT على شبكة TRC20 — ثابت عالميًا
const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

/**
 * ينشئ فاتورة بمبلغ فريد.
 * كل التحويلات تصل عنوانًا واحدًا، فنميّز صاحب كل تحويل
 * بكسور فريدة في المبلغ — نفس أسلوب منصات الكريبتو.
 */
async function handleUsdtInvoice(user, body, env) {
  const s = await getSettings(env);

  assertLive(s);
  if (s.m_usdt_on !== true) throw httpError(503, 'الدفع بـ USDT غير متاح حاليًا');

  const address = String(s.usdt_address || '').trim();
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
    throw httpError(503, 'عنوان الاستقبال غير مضبوط — تواصل مع الدعم');
  }

  const amount = round2(num(body.amount_usd, NaN));
  if (!Number.isFinite(amount) || amount <= 0) throw httpError(400, 'أدخل المبلغ');

  const minU = num(s.usdt_min, 5);
  const maxU = num(s.usdt_max, 1000);
  if (amount < minU) throw httpError(400, `الحد الأدنى ${minU} USDT`);
  if (amount > maxU) throw httpError(400, `الحد الأقصى ${maxU} USDT`);
  await assertDailyLimit(env, s, user.uid, 'deposit', amount);

  // ── توليد مبلغ فريد لا يتعارض مع فاتورة مفتوحة ──
  const open = await fsQuery(env, {
    from: [{ collectionId: 'usdt_invoices' }],
    where: {
      fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL',
        value: { stringValue: 'awaiting' } },
    },
    limit: 200,
  });
  const taken = new Set(
    open.map(r => {
      const d = fromFsFields(r.document.fields || {});
      return Number(num(d.pay_amount, 0)).toFixed(4);
    })
  );

  // كسور ضيّقة (0.0100–0.0999) كي لا يدفع العميل زيادة تُذكر،
  // والفرق يُحتسب له في محفظته على أي حال.
  let payAmount = null;
  for (let i = 0; i < 80; i++) {
    const b = crypto.getRandomValues(new Uint8Array(2));
    const frac = ((((b[0] << 8) | b[1]) % 900) + 100) / 10000; // 0.0100–0.0999
    const cand = Number((amount + frac).toFixed(4));
    if (!taken.has(cand.toFixed(4))) { payAmount = cand; break; }
  }
  if (payAmount === null) throw httpError(503, 'ازدحام مؤقت، حاول بعد قليل');

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

/** يتحقق من وصول التحويل على الشبكة ويضيف الرصيد */
async function handleUsdtVerify(user, body, env) {
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
    throw httpError(400, 'انتهت مهلة الفاتورة — أنشئ فاتورة جديدة');
  }

  const s = await getSettings(env);
  const address = String(inv.address || s.usdt_address || '').trim();
  const want = num(inv.pay_amount, 0);

  // ── قراءة التحويلات الواردة من الشبكة ──
  let txs = [];
  try {
    const url = `${TRON_API}/v1/accounts/${address}/transactions/trc20`
      + `?limit=60&only_to=true&contract_address=${USDT_TRC20}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    const data = await res.json();
    txs = Array.isArray(data.data) ? data.data : [];
  } catch (e) {
    console.error('TRON_FETCH_FAILED', e.message);
    throw httpError(502, 'تعذّر الاتصال بالشبكة، أعد المحاولة');
  }

  // نقبل التحويلات منذ إنشاء الفاتورة بخمس دقائق تسامح
  const since = num(inv.created_ms, 0) - 5 * 60000;

  const hit = txs.find(t => {
    const val = Number(t.value || 0) / 1e6;   // USDT بستة أرقام عشرية
    const ts = Number(t.block_timestamp || 0);
    return ts >= since && Math.abs(val - want) < 0.00005;
  });

  if (!hit) return { success: true, paid: false };

  const txid = String(hit.transaction_id || '');
  if (!txid) return { success: true, paid: false };

  // ── منع استخدام نفس التحويل مرتين ──
  const seen = await fsGet(env, `usdt_txids/${txid}`);
  if (seen) return { success: true, paid: false, duplicate: true };

  // يُحتسب للعميل ما وصل فعلًا — بما فيه كسور التمييز
  const received = round2(Number(hit.value || 0) / 1e6);
  const credited = received;

  await fsSet(env, `usdt_txids/${txid}`, {
    invoice_id: id, uid: user.uid, amount: received,
    from: String(hit.from || ''), created_at: nowIso(),
  });

  await Promise.all([
    fsPatch(env, `usdt_invoices/${id}`, {
      status: 'paid', txid, paid_at: nowIso(), received,
    }),
    fsIncrement(env, `users/${user.uid}`, { wallet_balance: credited }),
    fsSet(env, `wallet_deposits/${id}`, {
      uid: user.uid,
      amount_usd: credited,
      amount_lyd: 0,
      method: 'USDT — تلقائي',
      proof_url: '',
      note: 'TRC20 · ' + txid.slice(0, 12) + '…',
      status: 'approved',
      auto: true,
      created_at: nowIso(),
    }),
    bumpCounter(env, user.uid, { deposit: credited }),
    bumpCounter(env, '_platform', { deposit: credited }),
    logOp(env, user.uid, 'usdt_paid', { id, want }, { txid, credited }, true),
  ]);

  return { success: true, paid: true, credited, txid };
}

// ═══════════════════════════════════════════════════════════
//  الشحن التلقائي عبر رسائل ليبيانا
// ═══════════════════════════════════════════════════════════

/**
 * صيغتان مختلفتان تمامًا:
 *
 * ليبيانا: "تم تحويل 10.000 دينار من الرقم 944406147 إلى رصيدك بنجاح."
 *   المبلغ بثلاث خانات عشرية — "10.000" تعني 10 دنانير.
 *
 * المدار: "المشترك الكريم,لقد تم تحويل 18 د.ل الي رصيدك
 *          من الرقم 218934134532 ,رصيدك الحالي 33 د.ل"
 *   المبلغ صحيح بلا كسور، والرقم بمقدمة الدولة، وفي آخرها
 *   رقم ثانٍ (الرصيد الحالي) يجب ألا يُلتقط كمبلغ تحويل.
 */
function parseTransferSms(text) {
  const s = String(text || '').replace(/[\u200e\u200f]/g, '').trim();
  if (!/تم\s*تحويل/.test(s)) return null;

  // ── وارد أم صادر؟ ──
  // المشغّل يرسل رسالتين بنفس العبارة:
  //   الوارد: "... من الرقم 9xxxx إلى رصيدك"
  //   الصادر: "... الي 9xxxx"  ← تأكيد لمن حوّل
  // قبول الصادر يعني إضافة رصيد لمن أرسل المال للخارج.
  const incoming = /رصيد[كه]/.test(s) || /من\s*الرقم/.test(s);
  const outgoing = /تحويل[^\n]{0,40}\s(?:الى|الي|إلى)\s*\+?\d/.test(s)
                   && !/من\s*الرقم/.test(s);
  if (!incoming || outgoing) return null;

  // ── المدار ──
  // يُميَّز بوحدة "د.ل" ووجود "رصيدك الحالي"
  const almadar = s.match(
    /تم\s*تحويل\s*([\d,]+(?:[.\u066B]\d{1,3})?)\s*د\.?\s*ل/
  );
  if (almadar && /د\.?\s*ل/.test(s)) {
    const phone = s.match(/من\s*الرقم\s*[:\s]?\s*(\d{9,14})/);
    if (!phone) return null;
    const amount = round2(parseFloat(String(almadar[1]).replace(/,/g, '')));
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return {
      amount_lyd: amount,
      sender: normalizePhone(phone[1]),
      network: 'almadar',
    };
  }

  // ── ليبيانا ──
  const libyana = s.match(/([\d,]+)[.\u066B](\d{1,3})\s*دينار/);
  const phone = s.match(/الرقم\s*[:\s]?\s*(\d{9,14})/);
  if (!libyana || !phone) return null;

  const whole = parseInt(String(libyana[1]).replace(/,/g, ''), 10);
  const frac = parseInt(libyana[2].padEnd(3, '0'), 10) / 1000;
  const amount = round2(whole + frac);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return {
    amount_lyd: amount,
    sender: normalizePhone(phone[1]),
    network: 'libyana',
  };
}

/* يبقى الاسم القديم عاملًا لأي استدعاء سابق */
const parseLibyanaSms = parseTransferSms;

/** توحيد صيغة الرقم: 0912345678 و+218912345678 و912345678 → 912345678 */
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

/**
 * ينتشل الحقول من JSON تالف.
 * السبب: تطبيقات تحويل الرسائل تبني الحمولة بلصق النص داخل
 * قالب، فإن احتوى النص سطرًا جديدًا أو علامة اقتباس صار JSON
 * غير صالح. بدل إسقاط الحوالة نستخرج ما نحتاجه بالبحث.
 */
function salvageJson(raw) {
  const out = {};
  const s = String(raw || '');

  // نلتقط كل ما بين "text": " وأول اقتباس يليه فاصلة/قوس إغلاق،
  // مع السماح بالأسطر الجديدة داخل القيمة.
  const pick = (key) => {
    const re = new RegExp(
      `"${key}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?:,\\s*"|\\s*\\})`
    );
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
  // ── حماية: مفتاح سري بدل مصادقة المستخدم ──
  const url = new URL(request.url);
  const provided = request.headers.get('x-sms-secret')
    || url.searchParams.get('secret')
    || '';
  const expected = env.SMS_WEBHOOK_SECRET || '';

  if (!expected || provided !== expected) {
    throw httpError(401, 'unauthorized');
  }

  // ── قراءة الحمولة بأي صيغة يرسلها التطبيق ──
  // SMS Forwarder قد يرسل JSON، أو نصًا خامًا، أو معاملات في الرابط
  const ctype = (request.headers.get('content-type') || '').toLowerCase();
  let body = {};
  let rawBody = '';

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    try { rawBody = await request.text(); } catch { rawBody = ''; }
  }

  if (rawBody) {
    if (ctype.includes('json') || /^\s*\{/.test(rawBody)) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        // JSON تالف — يحدث حين يحتوي نص الرسالة على أسطر جديدة
        // أو علامات اقتباس، فيكسر القالب الذي بناه المرسل.
        // ننتشل الحقول يدويًا بدل إسقاط الرسالة.
        body = salvageJson(rawBody);
      }
    } else if (ctype.includes('x-www-form-urlencoded')) {
      body = Object.fromEntries(new URLSearchParams(rawBody));
    }
  }

  // نص الرسالة: من الحقول المعروفة، أو معاملات الرابط، أو النص الخام كما هو
  const text =
    body.text || body.message || body.body || body.msg || body.content ||
    url.searchParams.get('text') || url.searchParams.get('message') ||
    (ctype.includes('json') ? '' : rawBody) || '';

  const receivedAt = body.receivedAt || body.timestamp || body.date
    || url.searchParams.get('timestamp') || nowIso();
  const smsId = String(
    body.sms_id || body.id || url.searchParams.get('sms_id') || ''
  ).trim();

  const parsed = parseLibyanaSms(text);

  // ── من أرسل الرسالة فعلًا؟ ──
  // الرسائل الحقيقية تصل باسم المشغّل (ليبيانا / المدار).
  // أي شخص يستطيع كتابة نص تحويل وإرساله من رقمه الشخصي،
  // فبلا هذا الفحص يصير تزوير الرصيد برسالة نصية واحدة.
  const s0 = await getSettings(env);
  const from = String(
    body.from || body.sender || url.searchParams.get('from') || ''
  ).trim();

  const allow = String(s0.sms_allowed_senders || 'Libyana,ليبيانا,المدار,Almadar')
    .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);

  const fromLc = from.toLowerCase();
  const senderOk = allow.length === 0 || allow.some(a => fromLc.includes(a));

  if (parsed && !senderOk) {
    // تُحفظ للمراجعة، ولا يُضاف أي رصيد
    await fsSet(env, `sms_transactions/${fingerprint}`, {
      raw_text: String(text).slice(0, 500),
      from: from.slice(0, 60),
      amount_lyd: parsed.amount_lyd,
      sender: parsed.sender,
      method: parsed.network,
      status: 'untrusted',
      needs_attention: true,
      received_at: receivedAt,
      created_at: nowIso(),
    });
    console.warn('UNTRUSTED_SENDER', from);
    return { success: true, parsed: true, matched: false, untrusted: true };
  }

  // ── بصمة فريدة تمنع احتساب نفس الرسالة مرتين ──
  const fingerprint = smsId
    ? await sha256Hex('id:' + smsId)
    : await sha256Hex(String(text).trim() + '|' + String(receivedAt).slice(0, 16));

  const existing = await fsGet(env, `sms_transactions/${fingerprint}`);
  if (existing) {
    return { success: true, duplicate: true, status: existing.status };
  }

  // ── رسالة غير مفهومة: نسجّلها للمراجعة اليدوية ──
  if (!parsed) {
    await fsSet(env, `sms_transactions/${fingerprint}`, {
      raw_text: String(text).slice(0, 500),
      status: 'unparsed',
      received_at: receivedAt,
      created_at: nowIso(),
    });
    return { success: true, parsed: false };
  }

  const s = s0;
  const rate = parsed.network === 'almadar'
    ? num(s.rate_almadar, 12.5)
    : num(s.rate_libyana, 11.8);
  const amountUsd = round2(parsed.amount_lyd / rate);

  // يُعرَّف قبل أي استخدام — الكتل التالية كلها تعتمد عليه
  const record = {
    raw_text: String(text).slice(0, 500),
    amount_lyd: parsed.amount_lyd,
    amount_usd: amountUsd,
    rate,
    sender: parsed.sender,
    from: from.slice(0, 60),
    method: parsed.network,
    received_at: receivedAt,
    created_at: nowIso(),
  };

  // ── 1) هل يوجد إعلان معلّق ينتظر هذه الحوالة؟ ──
  let claim = null;
  try {
    claim = await findPendingClaim(env, parsed.sender, parsed.amount_lyd);
  } catch (e) {
    console.error('CLAIM_LOOKUP_FAILED', e.message);
  }

  if (claim && claim.uid) {
    try {
      await Promise.all([
        fsSet(env, `sms_transactions/${fingerprint}`, {
          ...record, status: 'claimed', uid: claim.uid,
          claimed_at: nowIso(), matched_by: 'pending_claim',
        }),
        fsPatch(env, `wallet_deposits/${claim._id}`, {
          status: 'approved', auto: true,
          awaiting_sms: false, approved_at: nowIso(),
        }),
        fsIncrement(env, `users/${claim.uid}`, { wallet_balance: amountUsd }),
        logOp(env, claim.uid, 'sms_matched_claim',
          { sender: parsed.sender, amount_lyd: parsed.amount_lyd },
          { credited: amountUsd }, true),
      ]);
      return {
        success: true, parsed: true, matched: true,
        via: 'claim', credited_usd: amountUsd,
      };
    } catch (e) {
      // فشل الإضافة — نحفظ الحوالة غير مربوطة كي لا تضيع
      console.error('CLAIM_CREDIT_FAILED', e.message);
      await fsSet(env, `sms_transactions/${fingerprint}`, {
        ...record, status: 'unclaimed', needs_attention: true,
        error: String(e.message).slice(0, 200),
      }).catch(() => {});
      return { success: true, parsed: true, matched: false, deferred: true };
    }
  }

  // ── لا مطابقة تلقائية بالرقم المسجّل ──
  // العميل يعلن تحويله دائمًا (رقمه + المبلغ)، لأنه قد يحوّل
  // من رقمه إلى حساب شخص آخر. فإن لم يوجد إعلان منتظر،
  // تُحفظ الحوالة غير مربوطة وتُربط من لوحة الإدارة.
  await fsSet(env, `sms_transactions/${fingerprint}`, {
    ...record, status: 'unclaimed',
  });

  return {
    success: true, parsed: true, matched: false,
    amount_lyd: parsed.amount_lyd,
  };
}

/** البحث عن مستخدم برقم هاتفه — يعتمد على حقل phone_key الموحّد */
async function findUserByPhone(env, phone9) {
  if (!phone9 || phone9.length < 9) return null;

  const rows = await fsQuery(env, {
    from: [{ collectionId: 'users' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'phone_key' },
        op: 'EQUAL',
        value: { stringValue: phone9 },
      },
    },
    limit: 2,
  });

  // رقم مسجّل لدى أكثر من حساب = التباس، نتركها للمراجعة اليدوية
  if (rows.length !== 1) return null;

  return rows[0].document.name.split('/documents/users/')[1] || null;
}

/** ربط حوالة غير مطابقة بعميل يدويًا من لوحة الإدارة */
async function handleAdminSmsAssign(user, body, env) {
  await requireAdmin(user, env);

  const smsId = String(body.sms_id || '').trim();
  const uid = String(body.uid || '').trim();
  if (!smsId || !uid) throw httpError(400, 'بيانات ناقصة');

  const sms = await fsGet(env, `sms_transactions/${smsId}`);
  if (!sms) throw httpError(404, 'الحوالة غير موجودة');
  if (sms.status === 'claimed') throw httpError(400, 'هذه الحوالة مربوطة بالفعل');

  const amountUsd = round2(num(sms.amount_usd, 0));
  if (amountUsd <= 0) throw httpError(400, 'مبلغ غير صالح');

  await Promise.all([
    fsPatch(env, `sms_transactions/${smsId}`, {
      status: 'claimed', uid, claimed_at: nowIso(), claimed_by: user.uid,
    }),
    fsIncrement(env, `users/${uid}`, { wallet_balance: amountUsd }),
    fsSet(env, `wallet_deposits/${smsId}`, {
      uid,
      amount_usd: amountUsd,
      amount_lyd: num(sms.amount_lyd, 0),
      method: 'ليبيانا — ربط يدوي',
      proof_url: '',
      note: 'حوالة من ' + (sms.sender || '—'),
      status: 'approved',
      auto: false,
      created_at: nowIso(),
    }),
    logOp(env, user.uid, 'sms_manual_assign', { smsId, uid }, { credited: amountUsd }, true),
  ]);

  return { success: true, credited: amountUsd };
}

// ═══════════════════════════════════════════════════════════
//  نداء Kripicard
// ═══════════════════════════════════════════════════════════

async function kripi(path, payload, env) {
  const res = await fetch(KRIPI_BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw httpError(502, 'رد غير مفهوم من المزود');
  }

  if (!res.ok && data.success === undefined) {
    throw httpError(502, data.message || `خطأ من المزود (${res.status})`);
  }
  return data;
}

/** إزالة أي بيانات حساسة قبل التسجيل */
function redact(obj) {
  const clone = { ...obj };
  delete clone.card_number;
  delete clone.cvv;
  return clone;
}

async function logOp(env, uid, action, request, response, ok) {
  const id = `${Date.now()}_${randomSuffix(6)}`;
  try {
    await fsSet(env, `card_logs/${id}`, {
      uid, action, ok: !!ok,
      request: JSON.stringify(request).slice(0, 900),
      response: JSON.stringify(redact(response || {})).slice(0, 900),
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('LOG_FAILED', e.message);
  }
}

// ═══════════════════════════════════════════════════════════
//  الإعدادات
// ═══════════════════════════════════════════════════════════

async function getSettings(env) {
  const [pricing, ops] = await Promise.all([
    fsGet(env, 'card_settings/pricing'),
    fsGet(env, 'card_settings/ops'),
  ]);
  return {
    // القيم الافتراضية = ما ورد في توثيق Kripicard
    provider_fixed_fee: 1.0,
    provider_pct: 4,
    margin: 2.6,
    fund_margin: 1.5,
    deletion_fee: 2.0,
    min_amount: 10,
    max_amount: 200,
    usd_to_lyd: 11.8,     // السعر المعروض للعميل (الأعلى)
    rate_libyana: 11.8,   // شحن المحفظة عبر ليبيانا
    rate_bank: 9.5,       // شحن المحفظة عبر المصارف
    rate_almadar: 12.5,   // شحن المحفظة عبر المدار
    rate_usdt: 1.0,       // شحن بالـUSDT
    max_deposit_lyd: 5000,
    default_bin: BINS_NO_DOB[0],
    issuing_enabled: false,   // آمن افتراضيًا — فعّله من اللوحة
    funding_enabled: false,
    provider_float: 0,
    low_balance_threshold: 30,
    maintenance_message: '',
    deposit_phone: '',
    m_libyana_on: true,   m_libyana_label: 'ليبيانا',
    m_almadar_on: true,   m_almadar_label: 'المدار',
    m_bank_on: false,     m_bank_label: 'تحويل مصرفي',
    m_usdt_on: false,     m_usdt_label: 'USDT',
    m_binance_on: false,  m_binance_label: 'Binance Pay',
    m_libyana_phone: '', m_almadar_phone: '',
    sms_allowed_senders: 'Libyana,ليبيانا,المدار,Almadar',
    banners: [],              // [{img, link, title}]
    store_enabled: true,
    custom_methods: [],       // طرق دفع يدوية يضيفها المسؤول
    // Home banners: [{img, link, title}]
    banners: [],
    banner_rotate_sec: 6,
    // Admin-defined manual methods: [{key,label,logo,rate,on,fields:[]}]
    custom_methods: [],
    method_order: 'libyana,almadar,usdt,bank,binance',
    // ── الطوارئ والحدود ──
    kill_switch: false,
    kill_message: 'الخدمة متوقفة مؤقتًا للصيانة.',
    daily_cards_max: 3,          // بطاقات لكل عميل يوميًا
    daily_amount_max: 200,       // إجمالي قيمة بطاقاته يوميًا
    daily_deposit_max: 500,      // إجمالي إيداعاته يوميًا
    platform_daily_max: 2000,    // سقف إيداعات المنصة كلها يوميًا
    limits_enabled: true,
    // ── الدعوات ──
    referral_enabled: false,
    referral_bonus_inviter: 1,
    referral_bonus_invitee: 1,
    referral_min_spend: 10,      // لا تُصرف المكافأة قبل إنفاق هذا
    // ── سجل النشاط ──
    activity_log_enabled: true,
    usdt_address: 'TGPCVkwW39Bznx5H6VaSheD4XZYJhzrAWF',
    usdt_min: 5, usdt_max: 1000, usdt_window_min: 30,
    usdt_frac_min: 0.01, usdt_frac_max: 0.0999,
    m_libyana_logo: '', m_almadar_logo: '', m_bank_logo: '',
    m_usdt_logo: '',    m_binance_logo: '',
    // حقول كل طريقة: [{label, value, copy}]
    m_bank_fields: [
      { label: 'اسم المصرف',      value: '', copy: false },
      { label: 'اسم صاحب الحساب', value: '', copy: false },
      { label: 'رقم الحساب',      value: '', copy: true  },
      { label: 'رقم LY',          value: '', copy: true  },
    ],
    m_usdt_fields: [
      { label: 'الشبكة',           value: 'TRC20', copy: false },
      { label: 'عنوان المحفظة',    value: '', copy: true  },
    ],
    m_binance_fields: [
      { label: 'معرّف Binance Pay', value: '', copy: true  },
      { label: 'الشبكة',            value: 'TRC20', copy: false },
    ],
    deposit_note: '',
    // ── المظهر ──
    theme_navy: '#0F172A',
    theme_emerald: '#10B981',
    theme_bg: '#F8FAFC',
    theme_radius: 14,
    // ── إظهار الأقسام ──
    nav_home: true, nav_issue: true, nav_cards: true,
    nav_wallet: true, nav_tx: true, nav_help: true, nav_settings: true,
    // ── نصوص الواجهة ──
    brand_tagline: 'بطاقات أكثر .. فرص أكبر',
    hero_title: 'بطاقة تعمل في كل مكان يقبل الدفع الإلكتروني',
    hero_sub: 'بالدولار الأمريكي · بدون رسوم شهرية · تُصدر فورًا',
    support_url: '',
    ...(pricing || {}),
    ...(ops || {}),
  };
}

// ═══════════════════════════════════════════════════════════
//  مصادقة Firebase
// ═══════════════════════════════════════════════════════════

async function requireAuth(request, env) {
  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) throw httpError(401, 'يجب تسجيل الدخول');

  const payload = await verifyIdToken(m[1], env.FIREBASE_PROJECT_ID);
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

// ═══════════════════════════════════════════════════════════
//  Firestore REST
// ═══════════════════════════════════════════════════════════

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache.token && _tokenCache.exp > now + 60) return _tokenCache.token;

  const claim = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
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

async function fsBeginTransaction(env) {
  const r = await fsFetch(env, ':beginTransaction', {
    method: 'POST',
    body: JSON.stringify({ options: { readWrite: {} } }),
  });
  return r.transaction;
}

async function fsRollback(env, transaction) {
  try {
    await fsFetch(env, ':rollback', {
      method: 'POST',
      body: JSON.stringify({ transaction }),
    });
  } catch { /* تجاهل */ }
}

async function fsBatchGet(env, paths, transaction) {
  const r = await fsFetch(env, ':batchGet', {
    method: 'POST',
    body: JSON.stringify({
      documents: paths.map(p => docPath(env, p)),
      transaction,
    }),
  });

  // batchGet يُعيد مصفوفة من عناصر {found} أو {missing}
  const entries = Array.isArray(r) ? r : (r && r.results) || [];

  const out = {};
  for (const e of entries) {
    if (e && e.found) {
      const short = e.found.name.split('/documents/')[1];
      out[short] = fromFsFields(e.found.fields || {});
    }
  }
  for (const p of paths) if (!(p in out)) out[p] = null;
  return out;
}

async function fsCommit(env, writes, transaction) {
  const body = transaction ? { writes, transaction } : { writes };
  return fsFetch(env, ':commit', { method: 'POST', body: JSON.stringify(body) });
}

// ── ترميز قيم Firestore ────────────────────────────────

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

// ═══════════════════════════════════════════════════════════
//  أدوات مساعدة
// ═══════════════════════════════════════════════════════════

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
