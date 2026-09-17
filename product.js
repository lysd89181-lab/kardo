/**
 * ═══════════════════════════════════════════════════════════
 *  Product Import System
 *  كاردو — نظام استيراد المنتجات
 * ═══════════════════════════════════════════════════════════
 *
 * يسمح للإدارة بـ:
 * 1. اختيار المنتجات من قائمة المزود
 * 2. تعيين الفئات في كاردو
 * 3. تحديد الأسعار والربح
 * 4. اختيار الصور
 * 5. استيراد مجموعة منتجات دفعة واحدة
 *
 * ═══════════════════════════════════════════════════════════
 */

/**
 * GET /api/admin/import/provider/:providerId/preview
 * عرض معاينة المنتجات المتاحة للاستيراد
 */
async function handleImportPreview(user, body, env, providerId) {
  requireAdmin(user);

  const provider = await fsGet(env, `providers/${providerId}`);
  if (!provider) throw httpError(404, 'المزود غير موجود');

  // الحصول على المنتجات من provider_products
  const providerProducts = await fsQuery(env, {
    from: [{ collectionId: 'provider_products' }],
    where: [{ fieldPath: 'provider_id', opStr: '==', value: providerId }],
    limit: 500,
  });

  if (!providerProducts.length) {
    throw httpError(400, 'لم يتم العثور على منتجات — يرجى مزامنة المزود أولاً');
  }

  // الحصول على الفئات الموجودة
  const categories = await fsQuery(env, {
    from: [{ collectionId: 'categories' }],
  });

  const categoryMap = {};
  categories.forEach(doc => {
    const cat = withId(doc, 'categories');
    categoryMap[cat.id] = cat.name;
  });

  return {
    success: true,
    provider: {
      id: provider.id,
      name: provider.name,
    },
    products: providerProducts.map(doc => {
      const p = withId(doc, 'provider_products');
      return {
        id: p.external_product_id,
        name: p.name,
        provider_category: p.category,
        cost_usd: p.cost_usd,
        currency: p.currency,
        availability: p.availability,
        region: p.region,
        metadata: p.metadata,
      };
    }),
    available_categories: categoryMap,
  };
}

/**
 * POST /api/admin/import/products
 * استيراد مجموعة منتجات
 *
 * Body:
 * {
 *   products: [
 *     {
 *       provider_id: "wdgzone_001",
 *       provider_product_id: "PUBG_60_UC",
 *       name: "PUBG Mobile 60 UC",
 *       name_ar: "ببجي موبايل 60 يو سي",
 *       category_id: "games",
 *       price_usd: 0.93,
 *       delivery_method: "API_DIRECT_TOPUP",
 *       required_fields: [
 *         {
 *           id: "player_id",
 *           name: "Player ID",
 *           type: "text",
 *           required: true,
 *           minLength: 5,
 *           maxLength: 20
 *         }
 *       ],
 *       image_source: "PROVIDER",
 *       badges: ["تسليم فوري"],
 *       homepage_visible: true,
 *       is_featured: false
 *     },
 *     ...
 *   ]
 * }
 */
async function handleImportProducts(user, body, env) {
  requireAdmin(user);

  const { products } = body;
  if (!Array.isArray(products) || !products.length) {
    throw httpError(400, 'قائمة المنتجات مطلوبة');
  }

  if (products.length > 100) {
    throw httpError(400, 'الحد الأقصى 100 منتج في كل استيراد');
  }

  const s = await getSettings(env);
  const results = [];
  let imported = 0;
  let errors = [];

  for (const item of products) {
    try {
      // التحقق من البيانات المطلوبة
      if (!item.provider_id || !item.provider_product_id || !item.name || !item.category_id) {
        errors.push(`${item.name}: بيانات مطلوبة ناقصة`);
        continue;
      }

      // التحقق من وجود المزود
      const provider = await fsGet(env, `providers/${item.provider_id}`);
      if (!provider) {
        errors.push(`${item.name}: المزود غير موجود`);
        continue;
      }

      // التحقق من وجود الفئة
      const category = await fsGet(env, `categories/${item.category_id}`);
      if (!category) {
        errors.push(`${item.name}: الفئة غير موجودة`);
        continue;
      }

      // إنشاء معرّف فريد للمنتج
      const productId = generateProductId(item.name);

      // التحقق من عدم وجود المنتج مسبقًا
      const existing = await fsGet(env, `products/${productId}`);
      if (existing) {
        errors.push(`${item.name}: المنتج موجود بالفعل`);
        continue;
      }

      // حساب السعر والربح
      const costUsd = num(item.cost_usd || provider.balance_usd, 0);
      const priceUsd = num(item.price_usd || calculatePrice(costUsd, s), 0);
      const profitUsd = round2(priceUsd - costUsd);

      // إنشاء مستند المنتج
      const productDoc = {
        id: productId,
        name: item.name,
        name_ar: item.name_ar || item.name,
        description: item.description || '',
        category_id: item.category_id,
        
        // معلومات المزود
        provider_id: item.provider_id,
        provider_product_id: item.provider_product_id,
        
        // طريقة التسليم
        delivery_method: item.delivery_method || 'API_DIRECT_TOPUP',
        required_fields: item.required_fields || [],
        
        // التسعير
        cost_usd: costUsd,
        price_usd: priceUsd,
        price_lyd: Math.ceil(priceUsd * num(s.usd_to_lyd, 7.0)),
        profit_usd: profitUsd,
        profit_percentage: costUsd > 0 ? round2((profitUsd / costUsd) * 100) : 0,
        cost_locked_at: nowIso(),
        
        // الصور
        images: item.image_source === 'PROVIDER'
          ? [{ source: 'PROVIDER', url: item.provider_image_url || '', is_primary: true }]
          : [],
        image_source_preference: item.image_source || 'PROVIDER',
        
        // العرض والتسويق
        badges: item.badges || [],
        homepage_visible: item.homepage_visible !== false,
        homepage_priority: num(item.homepage_priority, 100),
        is_featured: item.is_featured === true,
        search_visible: item.search_visible !== false,
        
        // البيانات الوصفية
        region: item.region || 'GLOBAL',
        game: item.game || null,
        status: 'ACTIVE',
        stock_count: null,
        last_synced: nowIso(),
        sync_notes: 'استيراد من المزود',
        
        // التتبع
        created_at: nowIso(),
        updated_at: nowIso(),
        updated_by: user.uid,
        version: 1,
      };

      // حفظ المنتج
      await fsSet(env, `products/${productId}`, productDoc);

      // إنشاء مستند المراسلة (mapping)
      const mappingId = productId;
      await fsSet(env, `product_provider_mappings/${mappingId}`, {
        kardo_product_id: productId,
        primary_provider_id: item.provider_id,
        primary_provider_product_id: item.provider_product_id,
        fallback_providers: item.fallback_providers || [],
        is_direct_api: item.delivery_method === 'API_DIRECT_TOPUP' || item.delivery_method === 'API_CODE',
        last_updated: nowIso(),
        notes: 'تم إنشاؤه من خلال الاستيراد التلقائي',
      });

      // تسجيل الإجراء
      await logAdminAction(env, user.uid, 'imported_product', 'product', productId, null, productDoc, 'استيراد من المزود');

      results.push({
        success: true,
        product_id: productId,
        name: item.name,
      });

      imported++;
    } catch (err) {
      errors.push(`${item.name}: ${err.message}`);
    }
  }

  return {
    success: true,
    imported_count: imported,
    error_count: errors.length,
    results,
    errors: errors.slice(0, 10), // إرجاع أول 10 أخطاء فقط
  };
}

/**
 * POST /api/admin/import/preview-check
 * التحقق من المنتجات قبل الاستيراد النهائي
 * (اختياري — للتحقق من عدم وجود نسخ مكررة)
 */
async function handleImportPreviewCheck(user, body, env) {
  requireAdmin(user);

  const { products } = body;
  if (!Array.isArray(products) || !products.length) {
    throw httpError(400, 'قائمة المنتجات مطلوبة');
  }

  const checks = [];

  for (const item of products) {
    const productId = generateProductId(item.name);
    const existing = await fsGet(env, `products/${productId}`);

    checks.push({
      name: item.name,
      product_id: productId,
      exists: !!existing,
      message: existing ? 'المنتج موجود بالفعل' : 'جاهز للاستيراد',
    });
  }

  const duplicates = checks.filter(c => c.exists).length;
  const ready = checks.filter(c => !c.exists).length;

  return {
    success: true,
    total: checks.length,
    ready,
    duplicates,
    checks,
  };
}

/**
 * ═══════════════════════════════════════════════════════════
 *  Helper Functions
 * ═══════════════════════════════════════════════════════════
 */

/**
 * توليد معرّف منتج فريد من الاسم
 */
function generateProductId(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 50);
}

/**
 * حساب السعر بناءً على القواعد
 * (استخدم نفس الدالة من pricing engine)
 */
function calculatePrice(costUsd, settings) {
  const margin = num(settings.default_margin, 0.05);
  return round2(costUsd + margin);
}

/**
 * تسجيل إجراء إداري
 */
async function logAdminAction(env, adminUid, action, targetType, targetId, before, after, reason = '') {
  const actionId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  
  try {
    await fsSet(env, `admin_actions/${actionId}`, {
      id: actionId,
      admin_uid: adminUid,
      action,
      target_type: targetType,
      target_id: targetId,
      before: before || null,
      after: after || null,
      reason,
      timestamp: nowIso(),
    });
  } catch (err) {
    console.error('Failed to log admin action:', err.message);
  }
}

/**
 * Export
 */
export {
  handleImportPreview,
  handleImportProducts,
  handleImportPreviewCheck,
};
