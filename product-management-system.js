/**
 * ═══════════════════════════════════════════════════════════
 *  Product Management System
 *  كاردو — إدارة المنتجات المتقدمة
 * ═══════════════════════════════════════════════════════════
 *
 * دعم:
 * - إنشاء منتجات يدويًا (بدون مزود)
 * - تحرير جميع جوانب المنتج
 * - إدارة الصور
 * - إدارة المتطلبات الديناميكية
 * - التحكم الكامل في العرض والتسويق
 *
 * ═══════════════════════════════════════════════════════════
 */

/**
 * GET /api/admin/products
 * قائمة جميع المنتجات مع التصفية والبحث
 *
 * Query params:
 *   category_id: تصفية حسب الفئة
 *   provider_id: تصفية حسب المزود
 *   status: ACTIVE | DISABLED | ARCHIVED
 *   search: بحث عن الاسم
 *   limit: 100 (افتراضي)
 *   offset: 0 (افتراضي)
 */
async function handleGetProducts(user, body, env, url) {
  requireAdmin(user);

  const categoryId = url.searchParams.get('category_id');
  const providerId = url.searchParams.get('provider_id');
  const status = url.searchParams.get('status') || 'ACTIVE';
  const search = url.searchParams.get('search');
  const limit = Math.min(parseInt(url.searchParams.get('limit')) || 100, 500);
  const offset = Math.max(parseInt(url.searchParams.get('offset')) || 0, 0);

  let where = [];
  
  if (status) {
    where.push({ fieldPath: 'status', opStr: '==', value: status });
  }
  
  if (categoryId) {
    where.push({ fieldPath: 'category_id', opStr: '==', value: categoryId });
  }
  
  if (providerId) {
    where.push({ fieldPath: 'provider_id', opStr: '==', value: providerId });
  }

  const products = await fsQuery(env, {
    from: [{ collectionId: 'products' }],
    where: where.length > 0 ? where : undefined,
    limit: limit + 1, // للكشف عن هناك المزيد
    offset,
  });

  let filtered = products;

  // بحث نصي (يتم محليًا لأن Firestore لا يدعم البحث النصي الكامل)
  if (search) {
    const q = search.toLowerCase();
    filtered = products.filter(doc => {
      const p = doc.fields;
      return (
        (p.name?.stringValue || '').toLowerCase().includes(q) ||
        (p.name_ar?.stringValue || '').toLowerCase().includes(q) ||
        (p.description?.stringValue || '').toLowerCase().includes(q)
      );
    });
  }

  const hasMore = filtered.length > limit;
  const items = filtered.slice(0, limit);

  return {
    success: true,
    total: items.length,
    has_more: hasMore,
    products: items.map(doc => withId(doc, 'products')),
  };
}

/**
 * GET /api/admin/products/:id
 * تفاصيل منتج واحد
 */
async function handleGetProduct(user, body, env, productId) {
  requireAdmin(user);

  const product = await fsGet(env, `products/${productId}`);
  if (!product) throw httpError(404, 'المنتج غير موجود');

  // جلب بيانات المزود إن وُجدت
  let provider = null;
  if (product.provider_id) {
    provider = await fsGet(env, `providers/${product.provider_id}`);
  }

  // جلب بيانات الفئة
  let category = null;
  if (product.category_id) {
    category = await fsGet(env, `categories/${product.category_id}`);
  }

  return {
    success: true,
    product: { ...product, id: productId },
    provider: provider ? sanitizeProviderForAdmin(provider) : null,
    category: category ? { ...category, id: product.category_id } : null,
  };
}

/**
 * POST /api/admin/products
 * إنشاء منتج جديد (يدويًا أو من استيراد)
 */
async function handleCreateProduct(user, body, env) {
  requireAdmin(user);

  const {
    name,
    name_ar,
    description,
    category_id,
    provider_id,
    provider_product_id,
    delivery_method,
    required_fields,
    cost_usd,
    price_usd,
    region,
    game,
    badges,
    homepage_visible,
    is_featured,
  } = body;

  if (!name || !category_id) {
    throw httpError(400, 'الاسم والفئة مطلوبان');
  }

  // التحقق من الفئة
  const category = await fsGet(env, `categories/${category_id}`);
  if (!category) {
    throw httpError(400, 'الفئة غير موجودة');
  }

  // التحقق من المزود (إن وُجد)
  if (provider_id) {
    const provider = await fsGet(env, `providers/${provider_id}`);
    if (!provider) {
      throw httpError(400, 'المزود غير موجود');
    }
  }

  const productId = generateProductId(name);
  
  // التحقق من عدم وجود المنتج
  const existing = await fsGet(env, `products/${productId}`);
  if (existing) {
    throw httpError(409, 'المنتج موجود بالفعل');
  }

  // حساب التسعير
  const s = await getSettings(env);
  const costValue = num(cost_usd, 0);
  const priceValue = num(price_usd, calculatePrice(costValue, s));
  const profitValue = round2(priceValue - costValue);
  const rate = num(s.usd_to_lyd, 7.0);

  const product = {
    id: productId,
    name: name.trim(),
    name_ar: name_ar || name,
    description: description || '',
    category_id,
    
    // معلومات المزود
    provider_id: provider_id || null,
    provider_product_id: provider_product_id || null,
    
    // التسليم
    delivery_method: delivery_method || 'MANUAL',
    required_fields: required_fields || [],
    
    // التسعير
    cost_usd: costValue,
    price_usd: round2(priceValue),
    price_lyd: Math.ceil(priceValue * rate),
    profit_usd: profitValue,
    profit_percentage: costValue > 0 ? round2((profitValue / costValue) * 100) : 0,
    cost_locked_at: nowIso(),
    
    // الصور
    images: [],
    image_source_preference: 'KARDO',
    
    // العرض
    badges: badges || [],
    homepage_visible: homepage_visible !== false,
    homepage_priority: 100,
    is_featured: is_featured === true,
    search_visible: true,
    
    // البيانات الوصفية
    region: region || 'GLOBAL',
    game: game || null,
    status: 'ACTIVE',
    stock_count: null,
    last_synced: null,
    
    // التتبع
    created_at: nowIso(),
    updated_at: nowIso(),
    created_by: user.uid,
    updated_by: user.uid,
    version: 1,
  };

  await fsSet(env, `products/${productId}`, product);

  // إنشاء mapping إذا كان هناك مزود
  if (provider_id && provider_product_id) {
    await fsSet(env, `product_provider_mappings/${productId}`, {
      kardo_product_id: productId,
      primary_provider_id: provider_id,
      primary_provider_product_id: provider_product_id,
      fallback_providers: [],
      is_direct_api: delivery_method === 'API_DIRECT_TOPUP' || delivery_method === 'API_CODE',
      last_updated: nowIso(),
    });
  }

  await logAdminAction(env, user.uid, 'created_product', 'product', productId, null, product);

  return {
    success: true,
    product_id: productId,
    product,
  };
}

/**
 * PATCH /api/admin/products/:id
 * تحديث منتج
 */
async function handleUpdateProduct(user, body, env, productId) {
  requireAdmin(user);

  const product = await fsGet(env, `products/${productId}`);
  if (!product) throw httpError(404, 'المنتج غير موجود');

  const updates = {};
  const allowedFields = [
    'name', 'name_ar', 'description', 'category_id', 'delivery_method',
    'required_fields', 'badges', 'homepage_visible', 'homepage_priority',
    'is_featured', 'search_visible', 'region', 'game', 'status',
    'image_source_preference'
  ];

  for (const field of allowedFields) {
    if (field in body) {
      updates[field] = body[field];
    }
  }

  // لا يمكن تغيير المزود هنا (استخدم منطق منفصل)
  
  updates.updated_at = nowIso();
  updates.updated_by = user.uid;
  updates.version = (product.version || 1) + 1;

  await fsPatch(env, `products/${productId}`, updates);

  const updated = { ...product, ...updates };
  await logAdminAction(env, user.uid, 'updated_product', 'product', productId, product, updated);

  return {
    success: true,
    product: updated,
  };
}

/**
 * DELETE /api/admin/products/:id
 * حذف منتج (حذف ناعم)
 */
async function handleDeleteProduct(user, body, env, productId) {
  requireAdmin(user);

  const product = await fsGet(env, `products/${productId}`);
  if (!product) throw httpError(404, 'المنتج غير موجود');

  // حذف ناعم: تعديل الحالة فقط
  await fsPatch(env, `products/${productId}`, {
    status: 'ARCHIVED',
    updated_at: nowIso(),
    updated_by: user.uid,
  });

  await logAdminAction(env, user.uid, 'archived_product', 'product', productId, product, { status: 'ARCHIVED' });

  return { success: true, message: 'تم أرشفة المنتج' };
}

/**
 * POST /api/admin/products/:id/duplicate
 * نسخ منتج موجود
 */
async function handleDuplicateProduct(user, body, env, productId) {
  requireAdmin(user);

  const product = await fsGet(env, `products/${productId}`);
  if (!product) throw httpError(404, 'المنتج غير موجود');

  // إنشاء نسخة جديدة
  const newId = `${productId}_copy_${Date.now()}`;
  const copy = {
    ...product,
    id: newId,
    name: `${product.name} (نسخة)`,
    created_at: nowIso(),
    created_by: user.uid,
    updated_at: nowIso(),
    updated_by: user.uid,
    version: 1,
  };

  await fsSet(env, `products/${newId}`, copy);

  // نسخ المراسلة أيضًا
  const mapping = await fsGet(env, `product_provider_mappings/${productId}`);
  if (mapping) {
    const newMapping = { ...mapping };
    newMapping.kardo_product_id = newId;
    await fsSet(env, `product_provider_mappings/${newId}`, newMapping);
  }

  return {
    success: true,
    new_product_id: newId,
    product: copy,
  };
}

/**
 * POST /api/admin/products/:id/images
 * إضافة صورة
 *
 * Body:
 * {
 *   source: "KARDO" | "PROVIDER" | "EXTERNAL",
 *   url: "https://...",
 *   is_primary: true
 * }
 */
async function handleAddProductImage(user, body, env, productId) {
  requireAdmin(user);

  const product = await fsGet(env, `products/${productId}`);
  if (!product) throw httpError(404, 'المنتج غير موجود');

  const { source, url, is_primary } = body;

  if (!source || !url) {
    throw httpError(400, 'المصدر و URL مطلوبان');
  }

  if (!['KARDO', 'PROVIDER', 'EXTERNAL'].includes(source)) {
    throw httpError(400, 'مصدر غير صحيح');
  }

  const images = product.images || [];

  // إذا كانت أساسية، أزل الحالة من باقي الصور
  if (is_primary) {
    images.forEach(img => img.is_primary = false);
  }

  images.push({
    source,
    url,
    uploaded_at: nowIso(),
    is_primary: is_primary === true,
  });

  await fsPatch(env, `products/${productId}`, {
    images,
    updated_at: nowIso(),
    updated_by: user.uid,
  });

  return {
    success: true,
    images,
  };
}

/**
 * DELETE /api/admin/products/:id/images/:index
 * حذف صورة
 */
async function handleDeleteProductImage(user, body, env, productId, imageIndex) {
  requireAdmin(user);

  const product = await fsGet(env, `products/${productId}`);
  if (!product) throw httpError(404, 'المنتج غير موجود');

  const images = (product.images || []).filter((_, i) => i !== parseInt(imageIndex));

  await fsPatch(env, `products/${productId}`, {
    images,
    updated_at: nowIso(),
    updated_by: user.uid,
  });

  return { success: true, images };
}

/**
 * ═══════════════════════════════════════════════════════════
 *  Required Fields Management
 * ═══════════════════════════════════════════════════════════
 */

/**
 * POST /api/admin/products/:id/required-fields
 * إضافة حقل مطلوب
 *
 * Body:
 * {
 *   id: "player_id",
 *   name: "Player ID",
 *   type: "text",
 *   required: true,
 *   minLength: 5,
 *   maxLength: 20,
 *   placeholder: "أدخل معرفك",
 *   validation_regex: "^[a-zA-Z0-9_]+$"
 * }
 */
async function handleAddRequiredField(user, body, env, productId) {
  requireAdmin(user);

  const product = await fsGet(env, `products/${productId}`);
  if (!product) throw httpError(404, 'المنتج غير موجود');

  const {
    id,
    name,
    type,
    required,
    minLength,
    maxLength,
    placeholder,
    validation_regex,
    options,
  } = body;

  if (!id || !name || !type) {
    throw httpError(400, 'البيانات المطلوبة ناقصة');
  }

  if (!['text', 'email', 'number', 'select', 'tel'].includes(type)) {
    throw httpError(400, 'نوع حقل غير صحيح');
  }

  const fields = product.required_fields || [];

  // التحقق من عدم تكرار المعرف
  if (fields.some(f => f.id === id)) {
    throw httpError(409, 'المعرف موجود بالفعل');
  }

  fields.push({
    id,
    name,
    type,
    required: required !== false,
    minLength: minLength || null,
    maxLength: maxLength || null,
    placeholder: placeholder || '',
    validation_regex: validation_regex || null,
    options: type === 'select' ? options || [] : undefined,
  });

  await fsPatch(env, `products/${productId}`, {
    required_fields: fields,
    updated_at: nowIso(),
    updated_by: user.uid,
  });

  return {
    success: true,
    fields,
  };
}

/**
 * DELETE /api/admin/products/:id/required-fields/:fieldId
 * حذف حقل مطلوب
 */
async function handleDeleteRequiredField(user, body, env, productId, fieldId) {
  requireAdmin(user);

  const product = await fsGet(env, `products/${productId}`);
  if (!product) throw httpError(404, 'المنتج غير موجود');

  const fields = (product.required_fields || []).filter(f => f.id !== fieldId);

  await fsPatch(env, `products/${productId}`, {
    required_fields: fields,
    updated_at: nowIso(),
    updated_by: user.uid,
  });

  return { success: true, fields };
}

/**
 * ═══════════════════════════════════════════════════════════
 *  Bulk Operations
 * ═══════════════════════════════════════════════════════════
 */

/**
 * POST /api/admin/products/bulk-action
 * تطبيق إجراء على مجموعة منتجات
 *
 * Body:
 * {
 *   product_ids: ["id1", "id2", ...],
 *   action: "enable" | "disable" | "feature" | "homepage",
 *   value: true/false
 * }
 */
async function handleBulkProductAction(user, body, env) {
  requireAdmin(user);

  const { product_ids, action, value } = body;

  if (!Array.isArray(product_ids) || !product_ids.length) {
    throw httpError(400, 'قائمة المنتجات مطلوبة');
  }

  if (product_ids.length > 100) {
    throw httpError(400, 'الحد الأقصى 100 منتج');
  }

  const updates = {};

  switch (action) {
    case 'enable':
      updates.status = 'ACTIVE';
      break;
    case 'disable':
      updates.status = 'DISABLED';
      break;
    case 'feature':
      updates.is_featured = value === true;
      break;
    case 'homepage':
      updates.homepage_visible = value === true;
      break;
    default:
      throw httpError(400, 'إجراء غير معروف');
  }

  updates.updated_at = nowIso();
  updates.updated_by = user.uid;

  let updated = 0;

  for (const productId of product_ids) {
    const product = await fsGet(env, `products/${productId}`);
    if (product) {
      await fsPatch(env, `products/${productId}`, updates);
      updated++;
    }
  }

  await logAdminAction(env, user.uid, `bulk_${action}`, 'products', product_ids.join(','), null, updates);

  return {
    success: true,
    updated,
    total: product_ids.length,
  };
}

/**
 * ═══════════════════════════════════════════════════════════
 *  Helper Functions
 * ═══════════════════════════════════════════════════════════
 */

function generateProductId(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 50);
}

function calculatePrice(costUsd, settings) {
  const margin = num(settings.default_margin, 0.05);
  return round2(costUsd + margin);
}

/**
 * Export
 */
export {
  handleGetProducts,
  handleGetProduct,
  handleCreateProduct,
  handleUpdateProduct,
  handleDeleteProduct,
  handleDuplicateProduct,
  handleAddProductImage,
  handleDeleteProductImage,
  handleAddRequiredField,
  handleDeleteRequiredField,
  handleBulkProductAction,
};
