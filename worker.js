/**
 * ═══════════════════════════════════════════════════════════
 *  KARDO — Cloudflare Worker Backend (Unified)
 *  نسخة موحّدة — كل شيء في ملف واحد
 * ═══════════════════════════════════════════════════════════
 *
 *  السرّيات المطلوبة (wrangler secret put):
 *   FIREBASE_PROJECT_ID    kardo-1c657
 *   FIREBASE_CLIENT_EMAIL  من service account
 *   FIREBASE_PRIVATE_KEY   من service account
 *   ALLOWED_ORIGIN         https://kardo.ly
 *   SMS_WEBHOOK_SECRET     سلسلة عشوائية
 * ═══════════════════════════════════════════════════════════
 */

const FS_BASE = 'https://firestore.googleapis.com/v1';

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
};

/* ═══ Router ═══ */
async function route(path, request, url, env) {
  /* ── المسارات العامة ── */
  if (path === '/api/status' && request.method === 'GET') {
    return handleStatus(env);
  }
  if (path === '/api/catalog' && request.method === 'GET') {
    return handleCatalog(env);
  }
  if (path === '/api/sms/webhook') {
    return handleSmsWebhook(request, env);
  }

  /* ── كل الباقي يتطلب مصادقة ── */
  const body = request.method === 'POST' ? await safeJson(request) : {};
  const user = await requireAuth(request, env);

  /* ── مسارات المتجر والمحفظة ── */
  switch (path) {
    case '/api/wallet/claim':        return handleWalletClaim(user, body, env);
    case '/api/store/order':         return handleStoreOrder(user, body, env);
    case '/api/coupon/check':        return handleCouponCheck(user, body, env);
    case '/api/wallet/withdraw':     return handleWithdrawRequest(user, body, env);
    case '/api/wallet/transfer':     return handleTransfer(user, body, env);
    case '/api/points/redeem':       return handleRedeemPoints(user, body, env);
    case '/api/ticket/create':       return handleTicketCreate(user, body, env);
    case '/api/ticket/reply':        return handleTicketReply(user, body, env);
    case '/api/ref/code':            return handleRefCode(user, body, env);
    case '/api/ref/claim':           return handleRefClaim(user, body, env);
    case '/api/activity/ping':       return handleActivityPing(user, body, env, request);
    case '/api/wallet/usdt/invoice': return handleUsdtInvoice(user, body, env);
    case '/api/wallet/usdt/verify':  return handleUsdtVerify(user, body, env);

    /* ── إدارية ── */
    case '/api/admin/settings':      return handleAdminSettings(user, body, env);
    case '/api/admin/deposit':       return handleAdminDeposit(user, body, env);
    case '/api/admin/order':         return handleAdminOrder(user, body, env);
    case '/api/admin/withdraw':      return handleAdminWithdraw(user, body, env);
    case '/api/admin/ticket/close':  return handleTicketClose(user, body, env);
    case '/api/admin/wallet-adjust': return handleAdminWalletAdjust(user, body, env);
    case '/api/admin/sms/assign':    return handleAdminSmsAssign(user, body, env);

    /* ── المزودون — الجزء الجديد ── */
    case '/api/admin/providers':
      if (request.method === 'GET') return handleListProviders(user, body, env);
      if (request.method === 'POST') return handleCreateProvider(user, body, env);
      break;

    case '/api/admin/provider/test':
      return handleTestProvider(user, body, env);

    case '/api/admin/provider/fetch':
      return handleFetchProviderProducts(user, body, env);

    case '/api/admin/provider/import':
      return handleImportProviderProducts(user, body, env);
  }

  /* ── مسارات بـ ID في الرابط ── */
  if (path.match(/^\/api\/admin\/providers\/[^/]+$/)) {
    const id = path.split('/')[4];
    if (request.method === 'GET') return handleGetProvider(user, body, env, id);
    if (request.method === 'PATCH') return handleUpdateProvider(user, body, env, id);
    if (request.method === 'DELETE') return handleDeleteProvider(user, body, env, id);
  }

  throw httpError(404, 'المسار غير موجود');
}

/* ═══ Status (public) ═══ */
async function handleStatus(env) {
  const s = await getSettings(env);
  return {
    success: true,
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
    subscriptions_visible: s.subscriptions_visible !== false,
    kill_switch: s.kill_switch === true,
    kill_message: s.kill_message || 'الخدمة متوقفة مؤقتًا للصيانة.',
    withdraw: {
      on: s.withdraw_enabled === true,
      min: num(s.withdraw_min, 10), max: num(s.withdraw_max, 500),
      fee_pct: num(s.withdraw_fee_pct, 0), fee_fixed: num(s.withdraw_fee_fixed, 0),
      methods: String(s.withdraw_methods || 'ليبيانا,المدار')
        .split(',').map(x => x.trim()).filter(Boolean),
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
    texts: {
      tagline: s.brand_tagline || 'بطاقات أكثر .. فرص أكبر',
      hero_title: s.hero_title || '',
      hero_sub: s.hero_sub || '',
      support_url: s.support_url || '',
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
      bank: {
        on: s.m_bank_on === true, logo: s.m_bank_logo || '',
        label: s.m_bank_label || 'تحويل مصرفي',
        rate: num(s.rate_bank, 9.5), auto: false,
        fields: cleanFields(s.m_bank_fields),
      },
      usdt: {
        on: s.m_usdt_on === true, logo: s.m_usdt_logo || '',
        label: s.m_usdt_label || 'USDT',
        rate: num(s.rate_usdt, 1), auto: true, invoice: true,
        address: s.usdt_address || '',
        min: num(s.usdt_min, 5), max: num(s.usdt_max, 1000),
        window_min: num(s.usdt_window_min, 30),
        fields: cleanFields(s.m_usdt_fields),
      },
      binance: {
        on: s.m_binance_on === true, logo: s.m_binance_logo || '',
        label: s.m_binance_label || 'Binance Pay',
        rate: num(s.rate_usdt, 1), auto: false,
        fields: cleanFields(s.m_binance_fields),
      },
    },
  };
}

/* ═══ Catalog (public) ═══ */
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
      id: c._id,
      name: c.name || '',
      parent: c.parent || '',
      icon: c.icon || '',
      image: c.image || '',
      soon: c.soon === true,
      sort: num(c.sort, 99),
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
      price: round2(num(p.price, 0)),
      old_price: round2(num(p.old_price, 0)),
      featured: p.featured === true,
      kind: p.kind === 'stock' ? 'stock' : 'manual',
      fields: cleanProductFields(p.fields),
      note: p.note || '',
      stock: p.kind === 'stock' ? num(p.stock_count, 0) : null,
      available: p.kind === 'stock' ? num(p.stock_count, 0) > 0 : true,
    }));

  return { success: true, categories, products };
}

/* ═══ Store Order ═══ */
async function handleStoreOrder(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);

  const items = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
  if (!items.length) throw httpError(400, 'السلة فارغة');

  const idem = String(body.idempotency_key || '').slice(0, 64);
  if (!idem) throw httpError(400, 'مفتاح العملية مفقود');

  const lock = await fsGet(env, `idempotency/${idem}`);
  if (lock) throw httpError(409, 'هذا الطلب قيد التنفيذ بالفعل');
  await fsSet(env, `idempotency/${idem}`, { uid: user.uid, created_at: nowIso() });

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

  let coupon = null, discountLyd = 0;
  if (body.coupon) {
    coupon = await checkCoupon(env, body.coupon, user.uid, totalLyd);
    if (coupon) { discountLyd = coupon.off_lyd; totalLyd = round2(totalLyd - discountLyd); }
  }

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
    for (const l of lines) {
      if (l.kind !== 'stock') continue;
      l.codes = await takeStock(env, l.pid, l.qty);
      if (l.codes.length < l.qty) throw new Error('نفد المخزون أثناء التنفيذ');
    }

    await fsSet(env, `orders/${orderId}`, {
      uid: user.uid,
      items: lines,
      coupon: coupon ? coupon.code : '',
      discount_lyd: discountLyd,
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
      awardPoints(env, s, user.uid, totalLyd),
      coupon ? consumeCoupon(env, coupon.code, user.uid) : Promise.resolve(),
    ]);

    return {
      success: true,
      order: {
        id: orderId,
        status: allStock ? 'completed' : 'pending',
        total_lyd: totalLyd,
        total_usd: totalUsd,
        items: lines.map(l => ({ name: l.name, qty: l.qty, codes: l.codes || null })),
      },
    };
  } catch (e) {
    await fsIncrement(env, `users/${user.uid}`, { wallet_balance: totalUsd }).catch(() => {});
    throw httpError(503, e.message || 'تعذّر تنفيذ الطلب — أُعيد رصيدك');
  }
}

/* ═══ takeStock ═══ */
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

/* ═══ Wallet Claim (Libyana/Almadar) ═══ */
async function handleWalletClaim(user, body, env) {
  const phone = normalizePhone(body.phone || '');
  const amountLyd = round2(num(body.amount_lyd, NaN));
  const method = body.method === 'almadar' ? 'almadar' : 'libyana';

  const st = await getSettings(env);
  assertLive(st);

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
        method: (method === 'libyana' ? 'ليبيانا' : 'المدار') + ' — تلقائي',
        status: 'approved', auto: true, created_at: nowIso(),
      }),
    ]);
    return { success: true, matched: true, credited_usd: credited };
  }

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

/* ═══ Coupons ═══ */
async function checkCoupon(env, code, uid, subtotalLyd) {
  const c = String(code || '').trim().toUpperCase();
  if (!c) return null;

  const cp = await fsGet(env, `coupons/${c}`);
  if (!cp || cp.active === false) throw httpError(404, 'كوبون غير صالح');

  if (cp.expires_at && new Date(cp.expires_at) < new Date()) {
    throw httpError(400, 'انتهت صلاحية الكوبون');
  }
  const maxUses = num(cp.max_uses, 0);
  if (maxUses > 0 && num(cp.used_count, 0) >= maxUses) {
    throw httpError(400, 'استُنفد هذا الكوبون');
  }
  const minOrder = num(cp.min_order_lyd, 0);
  if (minOrder > 0 && subtotalLyd < minOrder) {
    throw httpError(400, `الكوبون يتطلب طلبًا بـ${minOrder} د.ل`);
  }
  const used = await fsGet(env, `coupon_uses/${c}_${uid}`);
  if (used && cp.once_per_user !== false) {
    throw httpError(400, 'استخدمت هذا الكوبون من قبل');
  }

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

/* ═══ Points ═══ */
async function awardPoints(env, s, uid, spentLyd) {
  if (s.points_enabled !== true) return;
  const per = num(s.points_per_lyd, 1);
  const pts = Math.floor(spentLyd * per);
  if (pts <= 0) return;
  try {
    await fsIncrement(env, `users/${uid}`, { points: pts });
  } catch (e) { console.error('POINTS_FAILED', e.message); }
}

async function handleRedeemPoints(user, body, env) {
  const s = await getSettings(env);
  assertLive(s);
  if (s.points_enabled !== true) throw httpError(503, 'نظام النقاط غير مفعّل');

  const pts = Math.floor(num(body.points, 0));
  const minP = num(s.points_min_redeem, 100);
  if (pts < minP) throw httpError(400, `الحد الأدنى ${minP} نقطة`);

  const me = await fsGet(env, `users/${user.uid}`);
  if (!me || num(me.points, 0) < pts) throw httpError(400, 'نقاطك غير كافية');

  const rateP = num(s.points_value_lyd, 0.01);
  const lydVal = round2(pts * rateP);
  const usdVal = round2(lydVal / num(s.usd_to_lyd, 11.8));
  if (usdVal <= 0) throw httpError(400, 'قيمة غير صالحة');

  await Promise.all([
    fsIncrement(env, `users/${user.uid}`, { points: -pts, wallet_balance: usdVal }),
    fsSet(env, `wallet_deposits/PTS${Date.now()}${randomSuffix(3)}`, {
      uid: user.uid, amount_usd: usdVal, amount_lyd: lydVal,
      method: 'استبدال نقاط', status: 'approved', auto: true, created_at: nowIso(),
    }),
  ]);

  return { success: true, credited: usdVal, points_left: num(me.points, 0) - pts };
}

/* ═══ Withdrawals ═══ */
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

  const mn = num(s.withdraw_min, 10);
  const mx = num(s.withdraw_max, 500);
  if (amount < mn) throw httpError(400, `الحد الأدنى ${mn}$`);
  if (amount > mx) throw httpError(400, `الحد الأقصى ${mx}$`);

  const feePct = num(s.withdraw_fee_pct, 0);
  const feeFix = num(s.withdraw_fee_fixed, 0);
  const fee = round2(feeFix + amount * feePct / 100);
  const net = round2(amount - fee);
  if (net <= 0) throw httpError(400, 'المبلغ لا يغطي الرسوم');

  const me = await fsGet(env, `users/${user.uid}`);
  if (!me) throw httpError(400, 'الحساب غير مكتمل');
  if (me.banned === true) throw httpError(403, 'الحساب موقوف');
  if (num(me.wallet_balance, 0) < amount) throw httpError(402, 'رصيدك غير كافٍ');

  const id = `WD${Date.now()}${randomSuffix(4)}`;
  await fsIncrement(env, `users/${user.uid}`, { wallet_balance: -amount });

  await fsSet(env, `withdrawals/${id}`, {
    uid: user.uid, amount_usd: amount, fee, net,
    method, destination: dest,
    status: 'pending', created_at: nowIso(), updated_at: nowIso(),
  });

  return { success: true, id, fee, net };
}

async function handleAdminWithdraw(user, body, env) {
  await requireAdmin(user, env);
  const id = String(body.id || '').trim();
  const action = body.action === 'reject' ? 'reject' : 'complete';
  if (!id) throw httpError(400, 'رقم الطلب مفقود');

  const w = await fsGet(env, `withdrawals/${id}`);
  if (!w) throw httpError(404, 'الطلب غير موجود');
  if (w.status !== 'pending') throw httpError(400, 'الطلب مُغلق بالفعل');

  if (action === 'reject') {
    const back = round2(num(w.amount_usd, 0));
    await Promise.all([
      fsPatch(env, `withdrawals/${id}`, {
        status: 'rejected',
        reject_reason: String(body.reason || '').slice(0, 160),
        updated_at: nowIso(),
      }),
      fsIncrement(env, `users/${w.uid}`, { wallet_balance: back }),
    ]);
    return { success: true, refunded: back };
  }

  await fsPatch(env, `withdrawals/${id}`, {
    status: 'completed',
    note: String(body.note || '').slice(0, 200),
    updated_at: nowIso(),
  });
  return { success: true };
}

/* ═══ Transfer ═══ */
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
    const rows = await fsQuery(env, {
      from: [{ collectionId: 'users' }],
      where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL',
        value: { stringValue: to } } },
      limit: 2,
    });
    if (rows.length === 1) target = rows[0];
  } else {
    const key = normalizePhone(to);
    const rows = await fsQuery(env, {
      from: [{ collectionId: 'users' }],
      where: { fieldFilter: { field: { fieldPath: 'phone_key' }, op: 'EQUAL',
        value: { stringValue: key } } },
      limit: 2,
    });
    if (rows.length === 1) target = rows[0];
  }
  if (!target) throw httpError(404, 'لم نجد مستخدمًا');

  const toUid = target.document.name.split('/documents/users/')[1];
  if (toUid === user.uid) throw httpError(400, 'لا يمكنك التحويل لنفسك');

  const me = await fsGet(env, `users/${user.uid}`);
  if (!me) throw httpError(400, 'الحساب غير مكتمل');
  if (num(me.wallet_balance, 0) < total) throw httpError(402, 'رصيدك غير كافٍ');

  const id = `TR${Date.now()}${randomSuffix(4)}`;
  await fsIncrement(env, `users/${user.uid}`, { wallet_balance: -total });
  await fsIncrement(env, `users/${toUid}`, { wallet_balance: amount });
  await fsSet(env, `transfers/${id}`, {
    from_uid: user.uid, to_uid: toUid,
    amount_usd: amount, fee, status: 'completed', created_at: nowIso(),
  });

  return { success: true, id, amount, fee };
}

/* ═══ Tickets ═══ */
async function handleTicketCreate(user, body, env) {
  const subject = String(body.subject || '').trim().slice(0, 120);
  const msg = String(body.message || '').trim().slice(0, 1500);
  if (!subject) throw httpError(400, 'اكتب الموضوع');
  if (!msg) throw httpError(400, 'اكتب الرسالة');

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

/* ═══ Referrals ═══ */
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
    const taken = await fsGet(env, `ref_codes/${c}`);
    if (!taken) { code = c; break; }
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
  if (!owner || !owner.uid) throw httpError(404, 'الرمز غير موجود');

  await fsPatch(env, `users/${user.uid}`, {
    referred_by: owner.uid, referred_code: code, referral_paid: false,
  });

  return { success: true, bonus: num(s.referral_bonus_invitee, 1) };
}

/* ═══ Admin: Deposit/Order/Settings/Wallet-Adjust/Sms-Assign ═══ */
async function handleAdminDeposit(user, body, env) {
  await requireAdmin(user, env);
  const depositId = String(body.deposit_id || '').trim();
  const action = body.action === 'reject' ? 'reject' : 'approve';
  if (!depositId) throw httpError(400, 'معرّف الإيداع مفقود');

  const dep = await fsGet(env, `wallet_deposits/${depositId}`);
  if (!dep) throw httpError(404, 'الإيداع غير موجود');
  if (dep.status !== 'pending') throw httpError(400, 'مُعالج مسبقًا');

  if (action === 'reject') {
    await fsPatch(env, `wallet_deposits/${depositId}`, {
      status: 'rejected', reject_reason: String(body.reason || '').slice(0, 200),
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
  ]);

  return { success: true, status: 'approved', credited: amountUsd };
}

async function handleAdminOrder(user, body, env) {
  await requireAdmin(user, env);
  const id = String(body.order_id || '').trim();
  const action = body.action === 'reject' ? 'reject' : 'complete';
  if (!id) throw httpError(400, 'رقم الطلب مفقود');

  const o = await fsGet(env, `orders/${id}`);
  if (!o) throw httpError(404, 'الطلب غير موجود');
  if (o.status !== 'pending' && o.status !== 'processing') {
    throw httpError(400, 'الطلب مُغلق');
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
    ]);
    return { success: true, refunded: back };
  }

  await fsPatch(env, `orders/${id}`, {
    status: 'completed',
    delivery: String(body.delivery || '').slice(0, 900),
    updated_at: nowIso(),
  });
  return { success: true };
}

async function handleAdminSettings(user, body, env) {
  await requireAdmin(user, env);
  const pricing = {}, ops = {};
  const allowedPricing = [
    'margin', 'deletion_fee', 'min_amount', 'max_amount',
    'usd_to_lyd', 'rate_libyana', 'rate_almadar', 'rate_bank', 'rate_usdt',
  ];
  const allowedOps = [
    'kill_switch', 'kill_message', 'subscriptions_visible',
    'coupons_enabled', 'tickets_enabled', 'points_enabled', 'referral_enabled',
    'm_libyana_on', 'm_almadar_on', 'm_bank_on', 'm_usdt_on', 'm_binance_on',
    'm_libyana_phone', 'm_almadar_phone', 'usdt_address',
    'deposit_phone', 'deposit_note',
    'daily_cards_max', 'daily_amount_max', 'daily_deposit_max',
  ];

  for (const k of allowedPricing) if (k in body) pricing[k] = body[k];
  for (const k of allowedOps) if (k in body) ops[k] = body[k];

  const writes = [];
  if (Object.keys(pricing).length)
    writes.push(writeMask(env, 'card_settings/pricing', pricing, Object.keys(pricing)));
  if (Object.keys(ops).length)
    writes.push(writeMask(env, 'card_settings/ops', ops, Object.keys(ops)));

  if (!writes.length) throw httpError(400, 'لا يوجد للتحديث');
  await fsCommit(env, writes);

  return { success: true };
}

async function handleAdminWalletAdjust(user, body, env) {
  await requireAdmin(user, env);
  const uid = String(body.uid || '').trim();
  const delta = num(body.delta, NaN);
  const reason = String(body.reason || '').trim();

  if (!uid) throw httpError(400, 'uid مفقود');
  if (!Number.isFinite(delta) || delta === 0) throw httpError(400, 'مبلغ خطأ');
  if (reason.length < 3) throw httpError(400, 'السبب مطلوب');

  await fsIncrement(env, `users/${uid}`, { wallet_balance: round2(delta) });
  return { success: true, delta: round2(delta) };
}

async function handleAdminSmsAssign(user, body, env) {
  await requireAdmin(user, env);
  const smsId = String(body.sms_id || '').trim();
  const uid = String(body.uid || '').trim();
  if (!smsId || !uid) throw httpError(400, 'بيانات ناقصة');

  const sms = await fsGet(env, `sms_transactions/${smsId}`);
  if (!sms) throw httpError(404, 'الحوالة غير موجودة');

  const amountUsd = round2(num(sms.amount_usd, 0));
  await Promise.all([
    fsPatch(env, `sms_transactions/${smsId}`, {
      status: 'claimed', uid, claimed_at: nowIso(),
    }),
    fsIncrement(env, `users/${uid}`, { wallet_balance: amountUsd }),
    fsSet(env, `wallet_deposits/${smsId}`, {
      uid, amount_usd: amountUsd, amount_lyd: num(sms.amount_lyd, 0),
      method: 'يدوي', status: 'approved', auto: false, created_at: nowIso(),
    }),
  ]);

  return { success: true, credited: amountUsd };
}

async function handleActivityPing(user, body, env, request) {
  return { success: true };
}

/* ═══ USDT ═══ */
const TRON_API = 'https://api.trongrid.io';
const USDT_TRC20 = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

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
    uid: user.uid, amount_usd: amount, pay_amount: payAmount,
    address, status: 'awaiting',
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
    return { success: true, paid: true, credited: num(inv.received, num(inv.amount_usd, 0)) };
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

  await fsSet(env, `usdt_txids/${txid}`, {
    invoice_id: id, uid: user.uid, amount: received,
    from: String(hit.from || ''), created_at: nowIso(),
  });

  await Promise.all([
    fsPatch(env, `usdt_invoices/${id}`, {
      status: 'paid', txid, paid_at: nowIso(), received,
    }),
    fsIncrement(env, `users/${user.uid}`, { wallet_balance: received }),
    fsSet(env, `wallet_deposits/${id}`, {
      uid: user.uid, amount_usd: received, amount_lyd: 0,
      method: 'USDT — تلقائي', status: 'approved', auto: true,
      created_at: nowIso(),
    }),
  ]);

  return { success: true, paid: true, credited: received, txid };
}

/* ═══ SMS Webhook ═══ */
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

async function handleSmsWebhook(request, env) {
  const url = new URL(request.url);
  const provided = request.headers.get('x-sms-secret') || url.searchParams.get('secret') || '';
  const expected = env.SMS_WEBHOOK_SECRET || '';

  if (!expected || provided !== expected) throw httpError(401, 'unauthorized');

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

  const receivedAt = body.receivedAt || body.timestamp || url.searchParams.get('timestamp') || nowIso();
  const parsed = parseTransferSms(text);

  const fingerprint = await sha256Hex(String(text).trim() + '|' + String(receivedAt).slice(0, 16));

  const existing = await fsGet(env, `sms_transactions/${fingerprint}`);
  if (existing) return { success: true, duplicate: true };

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
  const rate = parsed.network === 'almadar'
    ? num(s.rate_almadar, 12.5)
    : num(s.rate_libyana, 11.8);
  const amountUsd = round2(parsed.amount_lyd / rate);

  await fsSet(env, `sms_transactions/${fingerprint}`, {
    raw_text: String(text).slice(0, 500),
    amount_lyd: parsed.amount_lyd,
    amount_usd: amountUsd,
    rate,
    sender: parsed.sender,
    method: parsed.network,
    status: 'unclaimed',
    received_at: receivedAt,
    created_at: nowIso(),
  });

  return { success: true, parsed: true, matched: false };
}

/* ═══ Settings ═══ */
async function getSettings(env) {
  const [pricing, ops] = await Promise.all([
    fsGet(env, 'card_settings/pricing'),
    fsGet(env, 'card_settings/ops'),
  ]);
  return {
    min_amount: 10, max_amount: 200,
    usd_to_lyd: 11.8,
    rate_libyana: 11.8, rate_almadar: 12.5, rate_bank: 9.5, rate_usdt: 1.0,
    max_deposit_lyd: 5000,
    kill_switch: false, kill_message: 'الخدمة متوقفة مؤقتًا للصيانة.',
    m_libyana_on: true, m_almadar_on: true,
    m_bank_on: false, m_usdt_on: false, m_binance_on: false,
    m_libyana_label: 'ليبيانا', m_almadar_label: 'المدار',
    m_bank_label: 'تحويل مصرفي', m_usdt_label: 'USDT', m_binance_label: 'Binance Pay',
    m_libyana_phone: '', m_almadar_phone: '',
    deposit_phone: '', deposit_note: '',
    subscriptions_visible: true,
    withdraw_enabled: false, withdraw_min: 10, withdraw_max: 500,
    withdraw_fee_pct: 0, withdraw_fee_fixed: 0,
    withdraw_methods: 'ليبيانا,المدار',
    transfer_enabled: false, transfer_min: 1, transfer_fee_pct: 0,
    tickets_enabled: true, coupons_enabled: true,
    points_enabled: false, points_per_lyd: 1,
    points_value_lyd: 0.01, points_min_redeem: 100,
    referral_enabled: false,
    referral_bonus_inviter: 1, referral_bonus_invitee: 1,
    referral_min_spend: 10,
    usdt_address: '', usdt_min: 5, usdt_max: 1000, usdt_window_min: 30,
    banners: [], method_order: 'libyana,almadar,usdt,bank,binance',
    daily_cards_max: 3, daily_amount_max: 200, daily_deposit_max: 500,
    ...(pricing || {}),
    ...(ops || {}),
  };
}

/* ═══ Firebase Auth ═══ */
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

/* ═══ Helpers ═══ */
function cleanBanners(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(b => b && b.img).slice(0, 8)
    .map(b => ({ img: String(b.img), link: String(b.link || ''), title: String(b.title || '') }));
}

function cleanFields(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter(f => f && f.value).slice(0, 8)
    .map(f => ({ label: String(f.label || ''), value: String(f.value || ''), copy: f.copy === true }));
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
   PROVIDER SYSTEM — نظام المزودين
   يدعم: Libya Play + Manual + أي مزود API آخر
   ═══════════════════════════════════════════════════════════ */

/* ═══ قائمة المزودين ═══ */
async function handleListProviders(user, body, env) {
  await requireAdmin(user, env);

  const rows = await fsQuery(env, {
    from: [{ collectionId: 'providers' }],
    limit: 100,
  });

  const providers = rows.map(r => {
    const d = withId(r, 'providers');
    // لا نكشف المفاتيح الكاملة — فقط آخر 4 أحرف للتعريف
    return {
      id: d._id,
      name: d.name || 'مزود',
      type: d.type || 'manual',
      api_url: d.api_url || '',
      api_key_masked: d.api_key
        ? '••••' + String(d.api_key).slice(-4)
        : '',
      has_key: !!d.api_key,
      email: d.email || '',
      active: d.active !== false,
      balance: num(d.balance, 0),
      last_test_at: d.last_test_at || '',
      last_test_ok: d.last_test_ok === true,
      last_fetch_at: d.last_fetch_at || '',
      products_count: num(d.products_count, 0),
      created_at: d.created_at || '',
    };
  });

  return { success: true, providers };
}

/* ═══ جلب مزود واحد ═══ */
async function handleGetProvider(user, body, env, id) {
  await requireAdmin(user, env);

  const d = await fsGet(env, `providers/${id}`);
  if (!d) throw httpError(404, 'المزود غير موجود');

  return {
    success: true,
    provider: {
      id,
      name: d.name || '',
      type: d.type || 'manual',
      api_url: d.api_url || '',
      api_key_masked: d.api_key ? '••••' + String(d.api_key).slice(-4) : '',
      has_key: !!d.api_key,
      email: d.email || '',
      active: d.active !== false,
      balance: num(d.balance, 0),
      created_at: d.created_at || '',
    },
  };
}

/* ═══ إضافة مزود جديد ═══ */
async function handleCreateProvider(user, body, env) {
  await requireAdmin(user, env);

  const name = String(body.name || '').trim().slice(0, 80);
  const type = String(body.type || 'manual').trim();
  const apiUrl = String(body.api_url || '').trim().slice(0, 300);
  const apiKey = String(body.api_key || '').trim().slice(0, 500);
  const email = String(body.email || '').trim().slice(0, 120);

  if (!name) throw httpError(400, 'اسم المزود مطلوب');
  if (!['manual', 'libyaplay', 'wdgzone', 'custom'].includes(type)) {
    throw httpError(400, 'نوع المزود غير مدعوم');
  }

  // توليد ID
  const id = `${type}_${Date.now()}${randomSuffix(4)}`;

  await fsSet(env, `providers/${id}`, {
    name,
    type,
    api_url: apiUrl,
    api_key: apiKey,
    email,
    active: true,
    balance: 0,
    last_test_at: '',
    last_test_ok: false,
    last_fetch_at: '',
    products_count: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  });

  return { success: true, id, name };
}

/* ═══ تعديل مزود ═══ */
async function handleUpdateProvider(user, body, env, id) {
  await requireAdmin(user, env);

  const existing = await fsGet(env, `providers/${id}`);
  if (!existing) throw httpError(404, 'المزود غير موجود');

  const patch = { updated_at: nowIso() };

  if ('name' in body) patch.name = String(body.name).trim().slice(0, 80);
  if ('type' in body) patch.type = String(body.type).trim();
  if ('api_url' in body) patch.api_url = String(body.api_url).trim().slice(0, 300);
  if ('api_key' in body && body.api_key) {
    patch.api_key = String(body.api_key).trim().slice(0, 500);
  }
  if ('email' in body) patch.email = String(body.email).trim().slice(0, 120);
  if ('active' in body) patch.active = body.active === true;

  await fsPatch(env, `providers/${id}`, patch);
  return { success: true };
}

/* ═══ حذف مزود ═══ */
async function handleDeleteProvider(user, body, env, id) {
  await requireAdmin(user, env);

  const existing = await fsGet(env, `providers/${id}`);
  if (!existing) throw httpError(404, 'المزود غير موجود');

  await fsCommit(env, [{ delete: docPath(env, `providers/${id}`) }]);
  return { success: true };
}

/* ═══ اختبار الاتصال — الفعلي مع Libya Play ═══ */
async function handleTestProvider(user, body, env) {
  await requireAdmin(user, env);

  const providerId = String(body.provider_id || '').trim();
  if (!providerId) throw httpError(400, 'معرّف المزود مفقود');

  const provider = await fsGet(env, `providers/${providerId}`);
  if (!provider) throw httpError(404, 'المزود غير موجود');

  const type = provider.type || 'manual';
  const startTime = Date.now();

  let result;

  if (type === 'libyaplay') {
    result = await testLibyaPlay(provider);
  } else if (type === 'manual') {
    result = {
      ok: true,
      message: 'المزود اليدوي لا يحتاج اتصالًا',
      info: { app_name: 'Manual', app_version: 0, maintenance: 0 },
    };
  } else {
    result = {
      ok: false,
      message: 'نوع المزود غير مدعوم بعد — تواصل مع الدعم',
    };
  }

  const elapsed = Date.now() - startTime;

  // تحديث المزود بحالة الاختبار
  await fsPatch(env, `providers/${providerId}`, {
    last_test_at: nowIso(),
    last_test_ok: result.ok,
    last_test_message: result.message || '',
    last_test_ms: elapsed,
  });

  if (!result.ok) {
    throw httpError(400, result.message || 'فشل الاتصال');
  }

  return {
    success: true,
    ok: true,
    message: result.message || 'الاتصال ناجح',
    elapsed_ms: elapsed,
    info: result.info || {},
  };
}

/* ═══ اختبار Libya Play API الفعلي ═══ */
async function testLibyaPlay(provider) {
  const url = String(provider.api_url || 'https://api.libyaplay.com/portal').trim();
  const key = String(provider.api_key || '').trim();
  const email = String(provider.email || '').trim();

  if (!key) {
    return { ok: false, message: 'مفتاح API مفقود' };
  }

  // endpoint الاختبار الرسمي
  const testUrl = url.replace(/\/+$/, '') + '/general/app-info';

  try {
    const res = await fetch(testUrl, {
      method: 'GET',
      headers: {
        'x-api-key': key,
        'accept': 'application/json',
        ...(email ? { 'x-email': email } : {}),
      },
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch {
      return {
        ok: false,
        message: `رد غير JSON (${res.status}): ${text.slice(0, 100)}`,
      };
    }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: 'المفتاح غير صحيح أو منتهي' };
    }

    if (res.status === 404) {
      return {
        ok: false,
        message: `الرابط خطأ — ${testUrl} يرجّع 404`,
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        message: `HTTP ${res.status}: ${data.message || 'خطأ غير معروف'}`,
      };
    }

    if (data.status !== true) {
      return {
        ok: false,
        message: data.message || 'المزود رفض الطلب',
      };
    }

    const info = data.data || {};
    if (info.maintenance === 1) {
      return {
        ok: false,
        message: 'المزود في وضع الصيانة حاليًا',
        info,
      };
    }

    return {
      ok: true,
      message: `الاتصال ناجح — ${info.app_name || 'Libya Play'} v${info.app_version || 0}`,
      info,
    };

  } catch (e) {
    return {
      ok: false,
      message: `تعذّر الاتصال: ${e.message}`,
    };
  }
}

/* ═══ جلب الخدمات من المزود ═══ */
async function handleFetchProviderProducts(user, body, env) {
  await requireAdmin(user, env);

  const providerId = String(body.provider_id || '').trim();
  if (!providerId) throw httpError(400, 'معرّف المزود مفقود');

  const provider = await fsGet(env, `providers/${providerId}`);
  if (!provider) throw httpError(404, 'المزود غير موجود');

  const type = provider.type || 'manual';

  if (type !== 'libyaplay') {
    throw httpError(400, 'جلب الخدمات متاح فقط لمزودي Libya Play حاليًا');
  }

  const products = await fetchLibyaPlayProducts(provider);

  // نُخزّنها مؤقتًا في Firestore لاستخدامها في الاستيراد
  const cacheId = `cache_${providerId}`;
  await fsSet(env, `provider_cache/${cacheId}`, {
    provider_id: providerId,
    products,
    fetched_at: nowIso(),
    count: products.length,
  });

  await fsPatch(env, `providers/${providerId}`, {
    last_fetch_at: nowIso(),
    products_count: products.length,
  });

  return { success: true, products, count: products.length };
}

/* ═══ جلب منتجات Libya Play الفعلي ═══ */
async function fetchLibyaPlayProducts(provider) {
  const baseUrl = String(provider.api_url || 'https://api.libyaplay.com/portal')
    .trim().replace(/\/+$/, '');
  const key = String(provider.api_key || '').trim();
  const email = String(provider.email || '').trim();

  if (!key) throw httpError(400, 'مفتاح API مفقود');

  const headers = {
    'x-api-key': key,
    'accept': 'application/json',
    ...(email ? { 'x-email': email } : {}),
  };

  /* المحاولة 1: endpoint قائمة الخدمات القياسي */
  const endpoints = [
    '/services',
    '/products',
    '/general/services',
    '/general/products',
    '/store/products',
    '/store/services',
  ];

  let found = null;
  let lastError = '';

  for (const ep of endpoints) {
    try {
      const res = await fetch(baseUrl + ep, { method: 'GET', headers });
      if (res.status === 404) continue;

      const data = await res.json().catch(() => null);
      if (!data) continue;

      // الشكل المتوقع: { status: true, data: [...] }
      if (data.status === true && Array.isArray(data.data)) {
        found = data.data;
        break;
      }
      // أو مصفوفة مباشرة
      if (Array.isArray(data)) {
        found = data;
        break;
      }
      // أو { data: { services: [...] } }
      if (data.data && Array.isArray(data.data.services)) {
        found = data.data.services;
        break;
      }
      if (data.data && Array.isArray(data.data.products)) {
        found = data.data.products;
        break;
      }
    } catch (e) {
      lastError = e.message;
      continue;
    }
  }

  if (!found) {
    throw httpError(404,
      'لم نجد endpoint لخدمات Libya Play. تواصل مع دعم المزود للحصول على الوثائق الكاملة.' +
      (lastError ? ` (${lastError})` : ''));
  }

  // توحيد شكل المنتجات
  return found.slice(0, 500).map(p => ({
    provider_product_id: String(p.id || p.product_id || p.service_id || ''),
    name: String(p.name || p.title || p.service_name || ''),
    cost_usd: round2(num(p.price || p.cost || p.price_usd, 0)),
    currency: String(p.currency || 'USD'),
    category: String(p.category || p.category_name || ''),
    delivery_type: mapDeliveryType(p),
    available: (p.available !== false) && (p.status !== 'off') && (p.status !== 0),
    image: String(p.image || p.image_url || p.thumbnail || ''),
    min_amount: num(p.min_amount, 0),
    max_amount: num(p.max_amount, 0),
    raw: p,
  })).filter(p => p.provider_product_id && p.name);
}

/* ═══ تخمين نوع التسليم من رد المزود ═══ */
function mapDeliveryType(p) {
  const type = String(p.delivery_type || p.type || p.kind || '').toLowerCase();
  if (type.includes('topup') || type.includes('direct')) return 'API_DIRECT_TOPUP';
  if (type.includes('gift') || type.includes('code')) return 'GIFT_CODE';
  if (type.includes('stock')) return 'STOCK_CODE';
  if (type.includes('manual')) return 'MANUAL';
  // الافتراضي لخدمات الألعاب
  if (p.player_id_required || p.requires_player_id) return 'API_DIRECT_TOPUP';
  return 'MANUAL';
}

/* ═══ استيراد منتجات مختارة إلى Firestore ═══ */
async function handleImportProviderProducts(user, body, env) {
  await requireAdmin(user, env);

  const providerId = String(body.provider_id || '').trim();
  const items = Array.isArray(body.items) ? body.items.slice(0, 100) : [];

  if (!providerId) throw httpError(400, 'معرّف المزود مفقود');
  if (!items.length) throw httpError(400, 'لا منتجات مختارة');

  const provider = await fsGet(env, `providers/${providerId}`);
  if (!provider) throw httpError(404, 'المزود غير موجود');

  const results = { created: 0, skipped: 0, failed: 0, errors: [] };

  for (const item of items) {
    try {
      const pid = String(item.id || item.product_id || '').trim();
      const catId = String(item.cat || item.category_id || '').trim();
      const name = String(item.name || '').trim().slice(0, 120);
      const priceLyd = round2(num(item.price_lyd, 0));
      const costUsd = round2(num(item.cost_usd, 0));
      const deliveryType = String(item.delivery_type || 'MANUAL');
      const image = String(item.image || '').slice(0, 900000);
      const desc = String(item.desc || '').slice(0, 1000);
      const featured = item.featured === true;
      const fields = Array.isArray(item.fields) ? item.fields : [];

      if (!name || !priceLyd) {
        results.failed++;
        results.errors.push(`تخطي ${pid}: الاسم أو السعر مفقود`);
        continue;
      }

      // التحقق من عدم وجوده مسبقًا (نفس provider_product_id)
      const existing = await fsQuery(env, {
        from: [{ collectionId: 'products' }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              { fieldFilter: { field: { fieldPath: 'provider_id' }, op: 'EQUAL',
                value: { stringValue: providerId } } },
              { fieldFilter: { field: { fieldPath: 'provider_product_id' }, op: 'EQUAL',
                value: { stringValue: pid } } },
            ],
          },
        },
        limit: 1,
      });

      if (existing.length) {
        results.skipped++;
        continue;
      }

      // تحديد نوع التسليم في نظامنا
      const kind = (deliveryType === 'STOCK_CODE' || deliveryType === 'GIFT_CODE')
        ? 'stock'
        : 'manual';

      // الحقول الافتراضية حسب نوع الخدمة
      let productFields = fields;
      if (!productFields.length) {
        if (deliveryType === 'API_DIRECT_TOPUP') {
          productFields = [
            { key: 'player_id', label: 'رقم اللاعب', type: 'text',
              required: true, hint: '' },
          ];
        } else if (deliveryType === 'GIFT_CODE' || deliveryType === 'STOCK_CODE') {
          productFields = [
            { key: 'email', label: 'بريدك الإلكتروني', type: 'email',
              required: true, hint: '' },
          ];
        }
      }

      // إنشاء المنتج
      const docId = `p_${providerId}_${pid}_${Date.now()}${randomSuffix(3)}`;

      await fsSet(env, `products/${docId}`, {
        name,
        name_ar: String(item.name_ar || '').slice(0, 120),
        name_en: String(item.name_en || '').slice(0, 120),
        desc,
        image,
        cat: catId,
        price: priceLyd,
        old_price: round2(num(item.old_price, 0)),
        cost_usd: costUsd,
        kind,
        delivery_type: deliveryType,
        provider_id: providerId,
        provider_name: String(provider.name || ''),
        provider_product_id: pid,
        fields: productFields,
        note: String(item.note || '').slice(0, 200),
        featured,
        active: true,
        sort: num(item.sort, 99),
        stock_count: 0,
        created_at: nowIso(),
        updated_at: nowIso(),
      });

      results.created++;

    } catch (e) {
      results.failed++;
      results.errors.push(`${item.name || '?'}: ${e.message}`);
    }
  }

  return {
    success: true,
    results,
    message: `تم استيراد ${results.created} منتج، تخطي ${results.skipped}، فشل ${results.failed}`,
  };
                    }
