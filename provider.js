/**
 * ═══════════════════════════════════════════════════════════
 *  Provider Management API Routes
 *  كاردو — مسارات إدارة المزودين
 * ═══════════════════════════════════════════════════════════
 *
 * تُضاف إلى worker.js في نقطة التوجيه (route function)
 * جميع هذه المسارات تتطلب مصادقة إدارية
 *
 * ═══════════════════════════════════════════════════════════
 */

/**
 * GET /api/admin/providers
 * قائمة جميع المزودين (مع الأسرار المخفية)
 */
async function handleGetProviders(user, body, env) {
  requireAdmin(user);

  const providers = await fsQuery(env, {
    from: [{ collectionId: 'providers' }],
  });

  return {
    success: true,
    providers: providers.map(doc => {
      const p = withId(doc, 'providers');
      return sanitizeProviderForAdmin(p);
    }),
  };
}

/**
 * GET /api/admin/providers/:id
 * تفاصيل مزود واحد
 */
async function handleGetProvider(user, body, env, providerId) {
  requireAdmin(user);

  const provider = await fsGet(env, `providers/${providerId}`);
  if (!provider) {
    throw httpError(404, 'المزود غير موجود');
  }

  return {
    success: true,
    provider: sanitizeProviderForAdmin({ ...provider, id: providerId }),
  };
}

/**
 * POST /api/admin/providers
 * إضافة مزود جديد
 */
async function handleCreateProvider(user, body, env) {
  requireAdmin(user);

  const {
    name,
    provider_type,
    base_url,
    logo_url,
    api_key,
    api_secret,
    auth_type,
    merchant_id,
  } = body;

  if (!name || !provider_type) {
    throw httpError(400, 'الاسم ونوع المزود مطلوبان');
  }

  if (!['API', 'STOCK', 'MANUAL'].includes(provider_type)) {
    throw httpError(400, 'نوع المزود غير صحيح');
  }

  // التحقق من البيانات الأساسية
  if (provider_type === 'API' && !base_url) {
    throw httpError(400, 'URL الـ API مطلوب للمزودين من نوع API');
  }

  const providerId = `${name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;

  const providerDoc = {
    id: providerId,
    name,
    provider_type,
    base_url: base_url || null,
    logo_url: logo_url || null,
    status: 'OFFLINE', // ستتغير بعد اختبار الاتصال
    enabled: false, // يجب تفعيله بعد الاختبار
    priority: 10,
    currency: 'USD',
    balance_usd: 0,
    balance_last_checked: null,
    last_sync: null,
    last_error: null,
    api_latency_ms: null,
    timeout_seconds: 30,
    retry_count: 2,
    rate_limit_requests_per_hour: 1000,
    min_balance_warning: 10,
    notes: '',
    contact_email: '',
    created_at: nowIso(),
    updated_at: nowIso(),
    created_by: user.uid,
  };

  // تشفير الأسرار (يجب استخدام دالة تشفير حقيقية)
  if (api_key) {
    providerDoc.api_key = await encryptSecret(env, api_key);
  }
  if (api_secret) {
    providerDoc.api_secret = await encryptSecret(env, api_secret);
  }
  if (auth_type) {
    providerDoc.auth_type = auth_type;
  }
  if (merchant_id) {
    providerDoc.merchant_id = await encryptSecret(env, merchant_id);
  }

  await fsSet(env, `providers/${providerId}`, providerDoc);

  return {
    success: true,
    provider_id: providerId,
    message: 'تم إضافة المزود — يرجى اختبار الاتصال',
    provider: sanitizeProviderForAdmin(providerDoc),
  };
}

/**
 * PATCH /api/admin/providers/:id
 * تحديث بيانات مزود
 */
async function handleUpdateProvider(user, body, env, providerId) {
  requireAdmin(user);

  const provider = await fsGet(env, `providers/${providerId}`);
  if (!provider) {
    throw httpError(404, 'المزود غير موجود');
  }

  const updates = {};

  // يمكن تحديث هذه الحقول فقط
  const allowedFields = [
    'name', 'logo_url', 'priority', 'enabled', 'notes', 'contact_email',
    'timeout_seconds', 'retry_count', 'min_balance_warning'
  ];

  for (const field of allowedFields) {
    if (field in body) {
      updates[field] = body[field];
    }
  }

  // تحديث الأسرار (اختياري)
  if ('api_key' in body && body.api_key) {
    updates.api_key = await encryptSecret(env, body.api_key);
  }
  if ('api_secret' in body && body.api_secret) {
    updates.api_secret = await encryptSecret(env, body.api_secret);
  }
  if ('merchant_id' in body && body.merchant_id) {
    updates.merchant_id = await encryptSecret(env, body.merchant_id);
  }

  updates.updated_at = nowIso();
  updates.updated_by = user.uid;

  await fsPatch(env, `providers/${providerId}`, updates);

  const updated = { ...provider, ...updates };
  return {
    success: true,
    provider: sanitizeProviderForAdmin(updated),
  };
}

/**
 * DELETE /api/admin/providers/:id
 * حذف مزود (آمن — لن يحذف الطلبات السابقة)
 */
async function handleDeleteProvider(user, body, env, providerId) {
  requireAdmin(user);

  const provider = await fsGet(env, `providers/${providerId}`);
  if (!provider) {
    throw httpError(404, 'المزود غير موجود');
  }

  // تحقق من وجود طلبات نشطة
  const activeOrders = await fsQuery(env, {
    from: [{ collectionId: 'store_orders' }],
    where: [
      { fieldPath: 'provider_id', opStr: '==', value: providerId },
      { fieldPath: 'status', opStr: 'in', value: ['PROCESSING', 'PENDING_PAYMENT'] }
    ],
    limit: 1,
  });

  if (activeOrders.length > 0) {
    throw httpError(409, 'لا يمكن حذف مزود به طلبات نشطة');
  }

  // حذف ناعم: عدّل الحالة فقط
  await fsPatch(env, `providers/${providerId}`, {
    enabled: false,
    status: 'DISABLED',
    updated_at: nowIso(),
  });

  return { success: true, message: 'تم تعطيل المزود' };
}

/**
 * POST /api/admin/providers/:id/test-connection
 * اختبار الاتصال بالمزود
 */
async function handleTestProviderConnection(user, body, env, providerId) {
  requireAdmin(user);

  const provider = await fsGet(env, `providers/${providerId}`);
  if (!provider) {
    throw httpError(404, 'المزود غير موجود');
  }

  try {
    // فك تشفير الأسرار مؤقتًا
    const config = {
      id: providerId,
      name: provider.name,
      provider_type: provider.provider_type,
      base_url: provider.base_url,
      api_key: provider.api_key ? await decryptSecret(env, provider.api_key) : null,
      api_secret: provider.api_secret ? await decryptSecret(env, provider.api_secret) : null,
      merchant_id: provider.merchant_id ? await decryptSecret(env, provider.merchant_id) : null,
      auth_type: provider.auth_type,
    };

    const adapter = createProviderAdapter(config);
    const result = await adapter.testConnection();

    // تحديث حالة المزود
    const status = result.success ? 'ONLINE' : 'OFFLINE';
    const updates = {
      status,
      last_successful_request: result.success ? nowIso() : provider.last_successful_request,
      last_error: result.success ? null : (result.error || 'اتصال فاشل'),
      api_latency_ms: result.latency || null,
      updated_at: nowIso(),
    };

    await fsPatch(env, `providers/${providerId}`, updates);

    return {
      success: true,
      connection: {
        status,
        latency: result.latency,
        httpStatus: result.httpStatus,
        message: result.message || result.error,
      },
    };
  } catch (err) {
    await fsPatch(env, `providers/${providerId}`, {
      status: 'OFFLINE',
      last_error: err.message,
      updated_at: nowIso(),
    });

    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * POST /api/admin/providers/:id/get-balance
 * الحصول على رصيد الحساب عند المزود
 */
async function handleGetProviderBalance(user, body, env, providerId) {
  requireAdmin(user);

  const provider = await fsGet(env, `providers/${providerId}`);
  if (!provider) {
    throw httpError(404, 'المزود غير موجود');
  }

  try {
    const config = {
      id: providerId,
      name: provider.name,
      provider_type: provider.provider_type,
      base_url: provider.base_url,
      api_key: provider.api_key ? await decryptSecret(env, provider.api_key) : null,
      api_secret: provider.api_secret ? await decryptSecret(env, provider.api_secret) : null,
    };

    const adapter = createProviderAdapter(config);
    const balance = await adapter.getBalance();

    // تحديث الرصيد المخزّن
    await fsPatch(env, `providers/${providerId}`, {
      balance_usd: balance,
      balance_last_checked: nowIso(),
      updated_at: nowIso(),
    });

    return {
      success: true,
      balance_usd: balance,
      currency: 'USD',
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * POST /api/admin/providers/:id/sync-products
 * مزامنة المنتجات من المزود
 * هذا ينسخ المنتجات من provider_products collection
 * (الخطوة الأولى من عملية الاستيراد)
 */
async function handleSyncProviderProducts(user, body, env, providerId) {
  requireAdmin(user);

  const provider = await fsGet(env, `providers/${providerId}`);
  if (!provider) {
    throw httpError(404, 'المزود غير موجود');
  }

  if (provider.provider_type !== 'API') {
    throw httpError(400, 'مزامنة المنتجات متاحة فقط للمزودين من نوع API');
  }

  try {
    const config = {
      id: providerId,
      name: provider.name,
      provider_type: provider.provider_type,
      base_url: provider.base_url,
      api_key: provider.api_key ? await decryptSecret(env, provider.api_key) : null,
      api_secret: provider.api_secret ? await decryptSecret(env, provider.api_secret) : null,
    };

    const adapter = createProviderAdapter(config);
    const products = await adapter.getProducts();

    if (!Array.isArray(products) || products.length === 0) {
      return {
        success: true,
        products_found: 0,
        message: 'لم يُرجع المزود أي منتجات',
      };
    }

    // حفظ المنتجات في provider_products collection
    let saved = 0;
    for (const product of products) {
      const docId = `${providerId}_${product.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      
      const providerProduct = {
        id: docId,
        provider_id: providerId,
        external_product_id: product.id,
        name: product.name,
        category: product.category || 'other',
        cost_usd: parseFloat(product.cost) || 0,
        currency: product.currency || 'USD',
        availability: product.availability || 'AVAILABLE',
        region: product.region || 'GLOBAL',
        metadata: product.metadata || {},
        last_synced: nowIso(),
        synced_by: user.uid,
      };

      await fsSet(env, `provider_products/${docId}`, providerProduct);
      saved++;
    }

    // تحديث آخر مزامنة
    await fsPatch(env, `providers/${providerId}`, {
      last_sync: nowIso(),
      status: 'ONLINE',
      updated_at: nowIso(),
    });

    return {
      success: true,
      products_found: products.length,
      products_saved: saved,
      message: `تم حفظ ${saved} منتج`,
    };
  } catch (err) {
    await fsPatch(env, `providers/${providerId}`, {
      last_error: err.message,
      status: 'OFFLINE',
      updated_at: nowIso(),
    });

    throw httpError(500, `خطأ في المزامنة: ${err.message}`);
  }
}

/**
 * GET /api/admin/providers/:id/products
 * قائمة المنتجات من هذا المزود (provider_products)
 */
async function handleGetProviderProducts(user, body, env, providerId) {
  requireAdmin(user);

  const provider = await fsGet(env, `providers/${providerId}`);
  if (!provider) {
    throw httpError(404, 'المزود غير موجود');
  }

  const providerProducts = await fsQuery(env, {
    from: [{ collectionId: 'provider_products' }],
    where: [{ fieldPath: 'provider_id', opStr: '==', value: providerId }],
    limit: 1000,
  });

  return {
    success: true,
    provider: { id: providerId, name: provider.name },
    products: providerProducts.map(doc => withId(doc, 'provider_products')),
  };
}

/**
 * ═══════════════════════════════════════════════════════════
 *  Helper Functions
 * ═══════════════════════════════════════════════════════════
 */

/**
 * تنظيف بيانات المزود لعرضها للإدارة (إخفاء الأسرار)
 */
function sanitizeProviderForAdmin(provider) {
  const sanitized = { ...provider };

  // إخفاء الأسرار — عرض آخر 4 أحرف فقط
  if (sanitized.api_key) {
    sanitized.api_key = `sk_live_****${sanitized.api_key.slice(-4)}`;
  }
  if (sanitized.api_secret) {
    sanitized.api_secret = `secret_****${sanitized.api_secret.slice(-4)}`;
  }
  if (sanitized.merchant_id) {
    sanitized.merchant_id = `merchant_****${sanitized.merchant_id.slice(-4)}`;
  }

  return sanitized;
}

/**
 * تشفير السر (يجب استخدام تشفير حقيقي مثل AES-256-GCM)
 * هنا placeholder فقط — في الإنتاج استخدم crypto library حقيقي
 */
async function encryptSecret(env, secret) {
  // TODO: استخدم AES-256-GCM أو مشابه
  // للآن: return simple base64 (NOT SECURE — هذا لاختبار فقط)
  return Buffer.from(secret).toString('base64');
}

/**
 * فك تشفير السر
 */
async function decryptSecret(env, encrypted) {
  // TODO: فك التشفير باستخدام نفس الخوارزمية
  // للآن: return base64 decoded
  return Buffer.from(encrypted, 'base64').toString('utf8');
}

/**
 * التحقق من أن المستخدم admin
 */
function requireAdmin(user) {
  if (!user.admin) {
    throw httpError(403, 'تصريح مرفوض — الإدارة فقط');
  }
}

/**
 * Export routes
 * يتم استدعاء هذه من نقطة التوجيه الرئيسية
 */
export {
  handleGetProviders,
  handleGetProvider,
  handleCreateProvider,
  handleUpdateProvider,
  handleDeleteProvider,
  handleTestProviderConnection,
  handleGetProviderBalance,
  handleSyncProviderProducts,
  handleGetProviderProducts,
};
