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

  // ── Webhook رسائل ليبيانا (يُحمى بمفتاح سري لا بمصادقة المستخدم) ──
  if (path === '/api/sms/webhook' && request.method === 'POST') {
    return handleSmsWebhook(request, env);
  }

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
      bank: num(s.rate_bank, 9.5),
      usdt: num(s.rate_usdt, 1),
    },
    deposit_phone: s.deposit_phone || '',
    max_deposit_lyd: num(s.max_deposit_lyd, 5000),
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
  if (!s.issuing_enabled) {
    throw httpError(503, s.maintenance_message || 'إصدار البطاقات متوقف مؤقتًا');
  }

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
    logOp(env, user.uid, 'create_card', { amount, bin }, redact(res), true),
  ]);

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
  if (!s.funding_enabled) throw httpError(503, 'إعادة الشحن متوقفة مؤقتًا');

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
    'rate_libyana', 'rate_bank', 'rate_usdt', 'max_deposit_lyd',
  ];
  const allowedOps = [
    'issuing_enabled', 'funding_enabled', 'provider_float',
    'low_balance_threshold', 'maintenance_message', 'deposit_phone',
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
    await fsPatch(env, `wallet_deposits/${depositId}`, {
      status: 'rejected',
      reject_reason: String(body.reason || '').slice(0, 200),
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

  if (phone.length !== 9) throw httpError(400, 'رقم الهاتف غير صحيح');
  if (!Number.isFinite(amountLyd) || amountLyd <= 0) {
    throw httpError(400, 'أدخل المبلغ الذي حوّلته');
  }

  const s = await getSettings(env);
  const rate = num(s.rate_libyana, 11.8);
  const amountUsd = round2(amountLyd / rate);

  const maxLyd = num(s.max_deposit_lyd, 5000);
  if (amountLyd > maxLyd) throw httpError(400, `الحد الأقصى ${maxLyd} د.ل`);

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
        method: method === 'libyana' ? 'ليبيانا — تلقائي' : 'المدار — تلقائي',
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
  const res = await fsFetch(env, ':runQuery', {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'sms_transactions' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL',
                value: { stringValue: 'unclaimed' } } },
              { fieldFilter: { field: { fieldPath: 'sender' }, op: 'EQUAL',
                value: { stringValue: phone } } },
              { fieldFilter: { field: { fieldPath: 'amount_lyd' }, op: 'EQUAL',
                value: { doubleValue: amountLyd } } },
            ],
          },
        },
        limit: 1,
      },
    }),
  });

  const row = (Array.isArray(res) ? res : []).find(r => r && r.document);
  if (!row) return null;

  const data = fromFsFields(row.document.fields || {});
  data._id = row.document.name.split('/documents/sms_transactions/')[1];
  return data;
}

/** البحث عن إعلان معلّق ينتظر رسالة بنفس الرقم والمبلغ */
async function findPendingClaim(env, phone, amountLyd) {
  const res = await fsFetch(env, ':runQuery', {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'wallet_deposits' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL',
                value: { stringValue: 'pending' } } },
              { fieldFilter: { field: { fieldPath: 'claim_phone' }, op: 'EQUAL',
                value: { stringValue: phone } } },
              { fieldFilter: { field: { fieldPath: 'amount_lyd' }, op: 'EQUAL',
                value: { doubleValue: amountLyd } } },
            ],
          },
        },
        orderBy: [{ field: { fieldPath: 'created_at' }, direction: 'ASCENDING' }],
        limit: 1,
      },
    }),
  });

  const row = (Array.isArray(res) ? res : []).find(r => r && r.document);
  if (!row) return null;

  const data = fromFsFields(row.document.fields || {});
  data._id = row.document.name.split('/documents/wallet_deposits/')[1];
  return data;
}

// ═══════════════════════════════════════════════════════════
//  الشحن التلقائي عبر رسائل ليبيانا
// ═══════════════════════════════════════════════════════════

/**
 * صيغة الرسالة المؤكدة:
 *   "تم تحويل 10.000 دينار من الرقم 944406147 إلى رصيدك بنجاح."
 *
 * ملاحظة: ليبيانا تكتب المبلغ بثلاث خانات عشرية،
 * فـ"10.000" تعني 10 دنانير وليس عشرة آلاف.
 */
function parseLibyanaSms(text) {
  const s = String(text || '').replace(/[\u200e\u200f]/g, '').trim();

  // المبلغ: رقم متبوع بنقطة وثلاث خانات ثم كلمة دينار
  const amountMatch = s.match(/([\d,]+)[.\u066B](\d{1,3})\s*دينار/);
  // رقم المرسل: 9 أرقام بعد كلمة "الرقم"
  const phoneMatch = s.match(/الرقم\s*[:\s]?\s*(\d{9,10})/);

  if (!amountMatch || !phoneMatch) return null;
  if (!/تم\s*تحويل/.test(s)) return null;

  const whole = parseInt(String(amountMatch[1]).replace(/,/g, ''), 10);
  const frac = parseInt(amountMatch[2].padEnd(3, '0'), 10) / 1000;
  const amountLyd = round2(whole + frac);

  if (!Number.isFinite(amountLyd) || amountLyd <= 0) return null;

  return { amount_lyd: amountLyd, sender: normalizePhone(phoneMatch[1]) };
}

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

  try {
    rawBody = await request.text();
  } catch { rawBody = ''; }

  if (rawBody) {
    if (ctype.includes('json') || /^\s*\{/.test(rawBody)) {
      try { body = JSON.parse(rawBody); } catch { body = {}; }
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

  const s = await getSettings(env);
  const rate = num(s.rate_libyana, num(s.usd_to_lyd, 11.8));
  const amountUsd = round2(parsed.amount_lyd / rate);

  // ── 1) هل يوجد إعلان معلّق ينتظر هذه الحوالة؟ ──
  const claim = await findPendingClaim(env, parsed.sender, parsed.amount_lyd);

  if (claim && claim.uid) {
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
  }

  // ── 2) وإلا: مطابقة بالرقم المسجّل في حساب العميل ──
  const matchUid = await findUserByPhone(env, parsed.sender);

  const record = {
    raw_text: String(text).slice(0, 500),
    amount_lyd: parsed.amount_lyd,
    amount_usd: amountUsd,
    rate,
    sender: parsed.sender,
    method: 'libyana',
    received_at: receivedAt,
    created_at: nowIso(),
  };

  if (!matchUid) {
    // لا يوجد عميل بهذا الرقم — تُعرض في اللوحة لربطها يدويًا
    await fsSet(env, `sms_transactions/${fingerprint}`, {
      ...record, status: 'unclaimed',
    });
    return { success: true, parsed: true, matched: false, amount_lyd: parsed.amount_lyd };
  }

  // ── مطابقة ناجحة: نُثبّت السجل أولًا ثم نضيف الرصيد ──
  await fsSet(env, `sms_transactions/${fingerprint}`, {
    ...record, status: 'claimed', uid: matchUid, claimed_at: nowIso(),
  });

  await Promise.all([
    fsIncrement(env, `users/${matchUid}`, { wallet_balance: amountUsd }),
    fsSet(env, `wallet_deposits/${fingerprint}`, {
      uid: matchUid,
      amount_usd: amountUsd,
      amount_lyd: parsed.amount_lyd,
      method: 'ليبيانا — تلقائي',
      proof_url: '',
      note: 'حوالة من ' + parsed.sender,
      status: 'approved',
      auto: true,
      created_at: nowIso(),
    }),
    logOp(env, matchUid, 'sms_auto_deposit',
      { sender: parsed.sender, amount_lyd: parsed.amount_lyd },
      { credited: amountUsd }, true),
  ]);

  return {
    success: true, parsed: true, matched: true,
    credited_usd: amountUsd, amount_lyd: parsed.amount_lyd,
  };
}

/** البحث عن مستخدم برقم هاتفه — يعتمد على حقل phone_key الموحّد */
async function findUserByPhone(env, phone9) {
  if (!phone9 || phone9.length < 9) return null;

  const res = await fsFetch(env, ':runQuery', {
    method: 'POST',
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'users' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'phone_key' },
            op: 'EQUAL',
            value: { stringValue: phone9 },
          },
        },
        limit: 2,
      },
    }),
  });

  const rows = (Array.isArray(res) ? res : []).filter(r => r && r.document);
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
    rate_usdt: 1.0,       // شحن بالـUSDT
    max_deposit_lyd: 5000,
    default_bin: BINS_NO_DOB[0],
    issuing_enabled: false,   // آمن افتراضيًا — فعّله من اللوحة
    funding_enabled: false,
    provider_float: 0,
    low_balance_threshold: 30,
    maintenance_message: '',
    deposit_phone: '',
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
