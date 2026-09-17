/**
 * ═══════════════════════════════════════════════════════════
 *  Pricing Engine
 *  كاردو — محرك التسعير المرن
 * ═══════════════════════════════════════════════════════════
 *
 * لا يتم تحديد السعر في الكود — بل يُدار من الإدارة
 *
 * أولويات التسعير (من الأعلى إلى الأقل):
 * 1. السعر المخصص للمنتج (PRODUCT rule)
 * 2. الربح الثابت للمنتج
 * 3. قاعدة الفئة (CATEGORY rule)
 * 4. القاعدة العام (GLOBAL rule)
 *
 * ═══════════════════════════════════════════════════════════
 */

/**
 * نقاط البيانات الأساسية:
 * - cost_usd: ما ندفعه للمزود
 * - customer_price_usd: ما يدفعه الزبون
 * - profit_usd: الفرق
 */

/**
 * GET /api/admin/pricing-rules
 * قائمة جميع قواعد التسعير
 */
async function handleGetPricingRules(user, body, env) {
  requireAdmin(user);

  const rules = await fsQuery(env, {
    from: [{ collectionId: 'pricing_rules' }],
    orderBy: [{ fieldPath: 'priority', direction: 'DESCENDING' }],
  });

  return {
    success: true,
    rules: rules.map(doc => withId(doc, 'pricing_rules')),
  };
}

/**
 * POST /api/admin/pricing-rules
 * إنشاء قاعدة تسعير جديدة
 */
async function handleCreatePricingRule(user, body, env) {
  requireAdmin(user);

  const {
    rule_type, // GLOBAL | CATEGORY | PRODUCT
    category_id,
    product_id,
    markup_type, // PERCENTAGE | FIXED | CUSTOM
    markup_value,
    priority,
    enabled,
    notes,
  } = body;

  if (!rule_type || !markup_type || typeof markup_value === 'undefined') {
    throw httpError(400, 'معلومات القاعدة ناقصة');
  }

  if (!['GLOBAL', 'CATEGORY', 'PRODUCT'].includes(rule_type)) {
    throw httpError(400, 'نوع القاعدة غير صحيح');
  }

  if (!['PERCENTAGE', 'FIXED', 'CUSTOM'].includes(markup_type)) {
    throw httpError(400, 'نوع الترميز غير صحيح');
  }

  // التحقق من التوافق
  if (rule_type === 'CATEGORY' && !category_id) {
    throw httpError(400, 'معرف الفئة مطلوب للقواعس من نوع CATEGORY');
  }
  if (rule_type === 'PRODUCT' && !product_id) {
    throw httpError(400, 'معرف المنتج مطلوب للقواعد من نوع PRODUCT');
  }

  const ruleId = `${rule_type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const rule = {
    id: ruleId,
    rule_type,
    category_id: category_id || null,
    product_id: product_id || null,
    markup_type,
    markup_value: parseFloat(markup_value),
    priority: parseInt(priority) || 10,
    enabled: enabled !== false,
    notes: notes || '',
    created_at: nowIso(),
    created_by: user.uid,
    version: 1,
  };

  await fsSet(env, `pricing_rules/${ruleId}`, rule);

  // تسجيل الإجراء
  await logAdminAction(env, user.uid, 'created_pricing_rule', 'pricing_rule', ruleId, null, rule);

  return {
    success: true,
    rule_id: ruleId,
    rule,
  };
}

/**
 * PATCH /api/admin/pricing-rules/:id
 * تحديث قاعدة تسعير
 */
async function handleUpdatePricingRule(user, body, env, ruleId) {
  requireAdmin(user);

  const rule = await fsGet(env, `pricing_rules/${ruleId}`);
  if (!rule) throw httpError(404, 'القاعدة غير موجودة');

  const updates = {};
  const allowedFields = ['enabled', 'priority', 'markup_value', 'notes'];

  for (const field of allowedFields) {
    if (field in body) {
      updates[field] = body[field];
    }
  }

  updates.updated_at = nowIso();
  updates.updated_by = user.uid;
  updates.version = (rule.version || 1) + 1;

  await fsPatch(env, `pricing_rules/${ruleId}`, updates);

  const updated = { ...rule, ...updates };
  await logAdminAction(env, user.uid, 'updated_pricing_rule', 'pricing_rule', ruleId, rule, updated);

  return {
    success: true,
    rule: updated,
  };
}

/**
 * DELETE /api/admin/pricing-rules/:id
 * حذف قاعدة تسعير
 */
async function handleDeletePricingRule(user, body, env, ruleId) {
  requireAdmin(user);

  const rule = await fsGet(env, `pricing_rules/${ruleId}`);
  if (!rule) throw httpError(404, 'القاعدة غير موجودة');

  await fsDelete(env, `pricing_rules/${ruleId}`);

  await logAdminAction(env, user.uid, 'deleted_pricing_rule', 'pricing_rule', ruleId, rule, null);

  return { success: true };
}

/**
 * ═══════════════════════════════════════════════════════════
 *  Core Pricing Calculation
 * ═══════════════════════════════════════════════════════════
 */

/**
 * حساب سعر الزبون بناءً على التكلفة والقواعس
 *
 * @param {Object} params
 *   productId: معرف المنتج
 *   categoryId: معرف الفئة
 *   costUsd: التكلفة من المزود
 *   env: بيئة Worker
 * @returns {Object}
 *   customer_price_usd: السعر النهائي
 *   profit_usd: الربح
 *   markup_type: نوع الترميز المستخدم
 *   profit_percentage: نسبة الربح %
 */
async function calculateCustomerPrice(params, env) {
  const { productId, categoryId, costUsd } = params;

  if (!Number.isFinite(costUsd) || costUsd <= 0) {
    throw new Error('التكلفة يجب أن تكون رقم موجب');
  }

  // جلب جميع القواعس المُفعّلة
  const rules = await fsQuery(env, {
    from: [{ collectionId: 'pricing_rules' }],
    where: [{ fieldPath: 'enabled', opStr: '==', value: true }],
    orderBy: [{ fieldPath: 'priority', direction: 'DESCENDING' }],
  });

  // ترتيب الأولويات (من الأعلى إلى الأقل)
  const ruleLists = {
    PRODUCT: [],
    CATEGORY: [],
    GLOBAL: [],
  };

  for (const doc of rules) {
    const rule = withId(doc, 'pricing_rules');

    // تصفية حسب النوع والمعرّفات
    if (rule.rule_type === 'PRODUCT' && rule.product_id === productId) {
      ruleLists.PRODUCT.push(rule);
    } else if (rule.rule_type === 'CATEGORY' && rule.category_id === categoryId) {
      ruleLists.CATEGORY.push(rule);
    } else if (rule.rule_type === 'GLOBAL') {
      ruleLists.GLOBAL.push(rule);
    }
  }

  // البحث عن أول قاعدة موجودة (حسب الأولوية)
  let applicableRule = null;

  if (ruleLists.PRODUCT.length > 0) {
    applicableRule = ruleLists.PRODUCT[0]; // الأعلى أولوية
  } else if (ruleLists.CATEGORY.length > 0) {
    applicableRule = ruleLists.CATEGORY[0];
  } else if (ruleLists.GLOBAL.length > 0) {
    applicableRule = ruleLists.GLOBAL[0];
  }

  // إذا لم توجد قاعدة، استخدم إعدادات افتراضية
  if (!applicableRule) {
    const s = await getSettings(env);
    const defaultMarkup = num(s.default_margin, 0.05);
    return {
      customer_price_usd: round2(costUsd + defaultMarkup),
      profit_usd: round2(defaultMarkup),
      markup_type: 'FIXED',
      profit_percentage: costUsd > 0 ? round2((defaultMarkup / costUsd) * 100) : 0,
      rule_applied: 'DEFAULT',
    };
  }

  // تطبيق القاعدة
  let customerPriceUsd, profitUsd, profitPercentage;

  if (applicableRule.markup_type === 'PERCENTAGE') {
    // نسبة مئوية من التكلفة
    const markupAmount = costUsd * (applicableRule.markup_value / 100);
    customerPriceUsd = round2(costUsd + markupAmount);
    profitUsd = round2(markupAmount);
    profitPercentage = applicableRule.markup_value;
  } else if (applicableRule.markup_type === 'FIXED') {
    // ربح ثابت
    customerPriceUsd = round2(costUsd + applicableRule.markup_value);
    profitUsd = round2(applicableRule.markup_value);
    profitPercentage = costUsd > 0 ? round2((applicableRule.markup_value / costUsd) * 100) : 0;
  } else if (applicableRule.markup_type === 'CUSTOM') {
    // سعر مخصص (ignorة التكلفة، استخدم السعر المحدد مباشرة)
    customerPriceUsd = round2(applicableRule.markup_value);
    profitUsd = round2(customerPriceUsd - costUsd);
    profitPercentage = costUsd > 0 ? round2((profitUsd / costUsd) * 100) : 0;
  }

  return {
    customer_price_usd: customerPriceUsd,
    profit_usd: profitUsd,
    markup_type: applicableRule.markup_type,
    profit_percentage: profitPercentage,
    rule_applied: `${applicableRule.rule_type}:${applicableRule.id}`,
  };
}

/**
 * GET /api/admin/pricing/calculate
 * اختبار السعر (للإدارة)
 *
 * Query params:
 *   product_id: معرف المنتج (اختياري)
 *   category_id: معرف الفئة
 *   cost_usd: التكلفة
 */
async function handleCalculatePrice(user, body, env, url) {
  requireAdmin(user);

  const productId = url.searchParams.get('product_id');
  const categoryId = url.searchParams.get('category_id');
  const costUsd = parseFloat(url.searchParams.get('cost_usd'));

  if (!Number.isFinite(costUsd) || costUsd <= 0) {
    throw httpError(400, 'التكلفة يجب أن تكون رقم موجب');
  }

  if (!categoryId && !productId) {
    throw httpError(400, 'معرف الفئة أو المنتج مطلوب');
  }

  const pricing = await calculateCustomerPrice({
    productId: productId || null,
    categoryId: categoryId || null,
    costUsd,
  }, env);

  const settings = await getSettings(env);
  const rate = num(settings.usd_to_lyd, 7.0);

  return {
    success: true,
    input: {
      cost_usd: costUsd,
      category_id: categoryId,
      product_id: productId,
    },
    output: {
      customer_price_usd: pricing.customer_price_usd,
      customer_price_lyd: Math.ceil(pricing.customer_price_usd * rate),
      profit_usd: pricing.profit_usd,
      profit_percentage: `${pricing.profit_percentage}%`,
      markup_type: pricing.markup_type,
      rule_applied: pricing.rule_applied,
    },
  };
}

/**
 * ═══════════════════════════════════════════════════════════
 *  Quick Pricing Update (Admin)
 * ═══════════════════════════════════════════════════════════
 */

/**
 * PATCH /api/admin/products/:id/price
 * تحديث سعر المنتج مباشرة
 *
 * Body:
 * {
 *   price_usd: 0.99,
 *   reason: "تعديل السعر"
 * }
 */
async function handleUpdateProductPrice(user, body, env, productId) {
  requireAdmin(user);

  const product = await fsGet(env, `products/${productId}`);
  if (!product) throw httpError(404, 'المنتج غير موجود');

  const { price_usd, reason } = body;
  if (!Number.isFinite(price_usd) || price_usd <= 0) {
    throw httpError(400, 'السعر غير صحيح');
  }

  const settings = await getSettings(env);
  const rate = num(settings.usd_to_lyd, 7.0);

  const updates = {
    price_usd: round2(price_usd),
    price_lyd: Math.ceil(price_usd * rate),
    profit_usd: round2(price_usd - product.cost_usd),
    profit_percentage: product.cost_usd > 0
      ? round2(((price_usd - product.cost_usd) / product.cost_usd) * 100)
      : 0,
    updated_at: nowIso(),
    updated_by: user.uid,
  };

  await fsPatch(env, `products/${productId}`, updates);

  await logAdminAction(env, user.uid, 'changed_product_price', 'product', productId, product, updates, reason || 'تحديث يدوي');

  return {
    success: true,
    product_id: productId,
    updated: updates,
  };
}

/**
 * ═══════════════════════════════════════════════════════════
 *  Bulk Price Update
 * ═══════════════════════════════════════════════════════════
 */

/**
 * POST /api/admin/pricing/bulk-update
 * تطبيق قاعدة على مجموعة منتجات
 *
 * Body:
 * {
 *   rule_type: "CATEGORY",
 *   category_id: "games",
 *   markup_type: "PERCENTAGE",
 *   markup_value: 12,
 *   dry_run: true  // عرض ما سيحدث بدون تطبيق
 * }
 */
async function handleBulkPriceUpdate(user, body, env) {
  requireAdmin(user);

  const { rule_type, category_id, markup_type, markup_value, dry_run } = body;

  if (!['CATEGORY', 'PRODUCT'].includes(rule_type)) {
    throw httpError(400, 'نوع القاعدة غير صحيح');
  }

  // جلب المنتجات المتأثرة
  let query = {
    from: [{ collectionId: 'products' }],
  };

  if (rule_type === 'CATEGORY') {
    query.where = [
      { fieldPath: 'category_id', opStr: '==', value: category_id },
      { fieldPath: 'status', opStr: '==', value: 'ACTIVE' }
    ];
  }

  const products = await fsQuery(env, query);

  const updates = [];
  const settings = await getSettings(env);
  const rate = num(settings.usd_to_lyd, 7.0);

  for (const doc of products) {
    const product = withId(doc, 'products');

    // حساب السعر الجديد
    let newPriceUsd;
    if (markup_type === 'PERCENTAGE') {
      const markup = product.cost_usd * (markup_value / 100);
      newPriceUsd = round2(product.cost_usd + markup);
    } else if (markup_type === 'FIXED') {
      newPriceUsd = round2(product.cost_usd + markup_value);
    }

    const newProfit = round2(newPriceUsd - product.cost_usd);

    updates.push({
      product_id: product.id,
      product_name: product.name,
      old_price: product.price_usd,
      new_price: newPriceUsd,
      old_profit: product.profit_usd,
      new_profit: newProfit,
    });

    // تطبيق التحديث (إن لم يكن dry_run)
    if (!dry_run) {
      await fsPatch(env, `products/${product.id}`, {
        price_usd: newPriceUsd,
        price_lyd: Math.ceil(newPriceUsd * rate),
        profit_usd: newProfit,
        profit_percentage: product.cost_usd > 0
          ? round2((newProfit / product.cost_usd) * 100)
          : 0,
        updated_at: nowIso(),
        updated_by: user.uid,
      });
    }
  }

  return {
    success: true,
    dry_run,
    affected_products: updates.length,
    updates: updates.slice(0, 50), // إرجاع أول 50
  };
}

/**
 * Export
 */
export {
  handleGetPricingRules,
  handleCreatePricingRule,
  handleUpdatePricingRule,
  handleDeletePricingRule,
  calculateCustomerPrice,
  handleCalculatePrice,
  handleUpdateProductPrice,
  handleBulkPriceUpdate,
};
