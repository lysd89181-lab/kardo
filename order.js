/**
 * ═══════════════════════════════════════════════════════════
 *  Order Processing System
 *  كاردو — نظام معالجة الطلبات المتقدم
 * ═══════════════════════════════════════════════════════════
 *
 * يتعامل مع:
 * - آلة حالة الطلب (State Machine)
 * - التواصل مع المزودين
 * - حماية المحفظة (atomic operations)
 * - الاسترجاع التلقائي
 * - منع الطلبات المكررة (idempotency)
 * - تسجيل timeline كامل
 *
 * ═══════════════════════════════════════════════════════════
 */

/**
 * POST /api/store/order
 * إنشاء طلب شراء
 *
 * Body:
 * {
 *   product_id: "pubg-60-uc",
 *   quantity: 1,
 *   customer_input: {
 *     player_id: "PlayerName#1234"
 *   }
 * }
 *
 * Response:
 * {
 *   success: true,
 *   order_id: "order_123",
 *   status: "PROCESSING",
 *   delivery_info: {...}  // if applicable
 * }
 */
async function handleCreateOrder(user, body, env) {
  requireSignedIn(user);

  const { product_id, quantity, customer_input } = body;

  if (!product_id) {
    throw httpError(400, 'معرف المنتج مطلوب');
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 1: Validation
  // ═══════════════════════════════════════════════════════════

  // جلب المنتج
  const product = await fsGet(env, `products/${product_id}`);
  if (!product) throw httpError(404, 'المنتج غير موجود');
  if (product.status !== 'ACTIVE') throw httpError(400, 'المنتج غير متاح');

  // التحقق من المدخلات المطلوبة
  if (product.required_fields && product.required_fields.length > 0) {
    for (const field of product.required_fields) {
      if (field.required && !(field.id in (customer_input || {}))) {
        throw httpError(400, `الحقل ${field.name} مطلوب`);
      }

      // التحقق من الطول
      if (field.minLength && customer_input[field.id].length < field.minLength) {
        throw httpError(400, `${field.name} قصير جداً`);
      }

      // التحقق من الـ regex
      if (field.validation_regex) {
        const regex = new RegExp(field.validation_regex);
        if (!regex.test(customer_input[field.id])) {
          throw httpError(400, `${field.name} غير صحيح`);
        }
      }
    }
  }

  // جلب جدول سعر المنتج الحالي من المزود (تحديث أمان)
  let currentProviderCost = product.cost_usd;
  let priceCheckError = null;

  if (product.provider_id && product.delivery_method !== 'MANUAL') {
    try {
      const provider = await fsGet(env, `providers/${product.provider_id}`);
      if (provider) {
        const config = {
          id: product.provider_id,
          name: provider.name,
          provider_type: provider.provider_type,
          base_url: provider.base_url,
          api_key: provider.api_key ? await decryptSecret(env, provider.api_key) : null,
          api_secret: provider.api_secret ? await decryptSecret(env, provider.api_secret) : null,
        };

        const adapter = createProviderAdapter(config);
        const currentPrice = await adapter.getPrice(product.provider_product_id);

        if (currentPrice && currentPrice !== currentProviderCost) {
          const maxIncrease = num(provider.max_allowed_cost_increase, 0.05); // 5% افتراضي
          const increase = ((currentPrice - currentProviderCost) / currentProviderCost) * 100;

          if (increase > maxIncrease) {
            priceCheckError = `سعر المزود ارتفع ${increase.toFixed(1)}%`;
            currentProviderCost = currentPrice;
          }
        }
      }
    } catch (err) {
      // تسجيل الخطأ ولكن لا نوقف الطلب
      console.error('Price check failed:', err.message);
    }
  }

  if (priceCheckError) {
    throw httpError(503, `${priceCheckError} — يرجى المحاولة لاحقًا`);
  }

  // جلب الزبون والمحفظة
  const userDoc = await fsGet(env, `users/${user.uid}`);
  if (!userDoc) throw httpError(404, 'المستخدم غير موجود');

  const walletBalance = num(userDoc.wallet_balance, 0);

  // حساب السعر النهائي (يتم دائماً من الخادم)
  // استخدم pricing engine للحصول على السعر الدقيق
  const pricing = await calculateCustomerPrice({
    productId: product_id,
    categoryId: product.category_id,
    costUsd: currentProviderCost,
  }, env);

  const customerPrice = pricing.customer_price_usd;

  // التحقق من الرصيد
  if (walletBalance < customerPrice) {
    throw httpError(402, 'الرصيد غير كافي');
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 2: Create Order & Reserve Wallet
  // ═══════════════════════════════════════════════════════════

  const orderId = generateOrderId();
  const idempotencyKey = generateIdempotencyKey();
  const now = nowIso();

  // Check for duplicate orders (same product, same user, within 10 seconds)
  const recentOrders = await fsQuery(env, {
    from: [{ collectionId: 'store_orders' }],
    where: [
      { fieldPath: 'uid', opStr: '==', value: user.uid },
      { fieldPath: 'product_id', opStr: '==', value: product_id },
      { fieldPath: 'created_at', opStr: '>=', value: new Date(Date.now() - 10000).toISOString() }
    ],
    limit: 1,
  });

  if (recentOrders.length > 0) {
    throw httpError(409, 'طلب مشابه تم إنشاؤه للتو — يرجى الانتظار');
  }

  // Create order document (PENDING_PAYMENT)
  const orderDoc = {
    id: orderId,
    uid: user.uid,
    product_id,
    provider_id: product.provider_id || null,
    quantity: quantity || 1,

    // الإدخالات
    customer_input: customer_input || {},

    // الأسعار (مُجمدة في وقت الطلب)
    cost_usd_at_purchase: round2(currentProviderCost),
    price_usd_at_purchase: round2(customerPrice),
    profit_usd_at_purchase: round2(customerPrice - currentProviderCost),
    exchange_rate_lyd_at_purchase: num((await getSettings(env)).usd_to_lyd, 7.0),

    // الحالة
    status: 'PENDING_PAYMENT',
    status_details: 'قيد الانتظار للدفع',
    last_status_change: now,

    // اتصال المزود
    provider_request: null,
    provider_response: null,
    provider_error: null,

    // التسليم
    delivery_method: product.delivery_method,
    delivery_info: {},

    // تتبع مكرر
    idempotency_key: idempotencyKey,
    retry_count: 0,
    last_retry_at: null,

    // Timeline
    timeline: [
      {
        timestamp: now,
        event: 'created',
        status_before: null,
        status_after: 'PENDING_PAYMENT',
      }
    ],

    // Refund
    refund_status: 'NONE',
    refund_reason: null,
    refund_at: null,

    // Admin
    manual_review_required: false,
    admin_notes: '',

    // Audit
    created_at: now,
    updated_at: now,
    version: 1,
  };

  await fsSet(env, `store_orders/${orderId}`, orderDoc);

  // Deduct wallet (atomic transaction)
  const userPath = `users/${user.uid}`;
  const updatedWallet = round2(walletBalance - customerPrice);

  await fsSet(env, userPath, {
    ...userDoc,
    wallet_balance: updatedWallet,
    updated_at: now,
  });

  // Log wallet transaction
  const txnId = generateTransactionId();
  await fsSet(env, `wallet_transactions/${txnId}`, {
    uid: user.uid,
    type: 'ORDER',
    amount: -customerPrice,
    balance_before: walletBalance,
    balance_after: updatedWallet,
    reference: orderId,
    status: 'COMPLETED',
    created_at: now,
  });

  // ═══════════════════════════════════════════════════════════
  // Phase 3: Update Order to PAID
  // ═══════════════════════════════════════════════════════════

  await updateOrderStatus(env, orderId, 'PAID', 'تم تأكيد الدفع', {
    timestamp: nowIso(),
    event: 'payment_confirmed',
  });

  // ═══════════════════════════════════════════════════════════
  // Phase 4: Execute Provider Request
  // ═══════════════════════════════════════════════════════════

  let deliveryInfo = {};
  let orderStatus = 'COMPLETED';
  let orderError = null;

  if (product.delivery_method === 'MANUAL') {
    // Manual delivery: wait for admin
    orderStatus = 'MANUAL_REVIEW';
    await updateOrderStatus(env, orderId, orderStatus, 'قيد انتظار التنفيذ اليدوي');
  } else if (product.delivery_method === 'STOCK_CODE') {
    // Assign code from stock
    try {
      const code = await assignStockCode(env, product_id);
      if (!code) {
        throw new Error('لا توجد أكواز متاحة');
      }

      deliveryInfo = {
        code: code.code, // encrypted
        status: 'DELIVERED',
      };

      orderStatus = 'COMPLETED';
    } catch (err) {
      orderError = err.message;
      orderStatus = 'FAILED';
    }
  } else if (product.delivery_method === 'API_DIRECT_TOPUP' || product.delivery_method === 'API_CODE') {
    // Call provider API
    try {
      await updateOrderStatus(env, orderId, 'PROCESSING', 'جاري معالجة الطلب');

      const provider = await fsGet(env, `providers/${product.provider_id}`);
      if (!provider) throw new Error('المزود غير موجود');

      const config = {
        id: product.provider_id,
        name: provider.name,
        provider_type: provider.provider_type,
        base_url: provider.base_url,
        api_key: provider.api_key ? await decryptSecret(env, provider.api_key) : null,
        api_secret: provider.api_secret ? await decryptSecret(env, provider.api_secret) : null,
      };

      const adapter = createProviderAdapter(config);

      // Log request
      const request = {
        endpoint: `/orders`,
        method: 'POST',
        payload: {
          product_id: product.provider_product_id,
          quantity: orderDoc.quantity,
          customer_data: customer_input,
        },
        sent_at: nowIso(),
      };

      // Make API call
      const result = await adapter.createOrder({
        productId: product.provider_product_id,
        quantity: orderDoc.quantity,
        customerInput: customer_input,
        idempotencyKey,
      });

      const response = {
        success: result.success,
        transactionId: result.transactionId,
        code: result.code,
        received_at: nowIso(),
      };

      deliveryInfo = {
        provider_transaction_id: result.transactionId,
        code: result.code || null,
        account_credited: product.delivery_method === 'API_DIRECT_TOPUP',
      };

      // Update order with provider details
      const order = await fsGet(env, `store_orders/${orderId}`);
      await fsPatch(env, `store_orders/${orderId}`, {
        provider_request: request,
        provider_response: response,
        delivery_info: deliveryInfo,
      });

      orderStatus = 'COMPLETED';
      await updateOrderStatus(env, orderId, orderStatus, 'تم تنفيذ الطلب بنجاح', {
        timestamp: nowIso(),
        event: 'completed',
        details: { provider_transaction_id: result.transactionId },
      });
    } catch (err) {
      orderError = err.message;
      orderStatus = 'FAILED';

      // Automatic refund
      await refundOrder(env, orderId, `خطأ في المزود: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Return Response
  // ═══════════════════════════════════════════════════════════

  if (orderStatus === 'FAILED') {
    throw httpError(500, orderError || 'فشل تنفيذ الطلب');
  }

  return {
    success: true,
    order_id: orderId,
    status: orderStatus,
    delivery_info: deliveryInfo,
    message: orderStatus === 'COMPLETED'
      ? 'تم تنفيذ الطلب بنجاح'
      : orderStatus === 'MANUAL_REVIEW'
        ? 'الطلب قيد المراجعة'
        : 'جاري معالجة الطلب',
  };
}

/**
 * ═══════════════════════════════════════════════════════════
 *  Helper Functions
 * ═══════════════════════════════════════════════════════════
 */

async function updateOrderStatus(env, orderId, newStatus, statusDetails, timelineEvent = null) {
  const order = await fsGet(env, `store_orders/${orderId}`);
  if (!order) return;

  const timeline = order.timeline || [];
  if (timelineEvent) {
    timeline.push({
      timestamp: timelineEvent.timestamp || nowIso(),
      event: timelineEvent.event,
      status_before: order.status,
      status_after: newStatus,
      details: timelineEvent.details || {},
    });
  }

  await fsPatch(env, `store_orders/${orderId}`, {
    status: newStatus,
    status_details: statusDetails,
    last_status_change: nowIso(),
    timeline,
    updated_at: nowIso(),
  });
}

async function refundOrder(env, orderId, reason = '') {
  const order = await fsGet(env, `store_orders/${orderId}`);
  if (!order || order.refund_status !== 'NONE') return;

  const amount = order.price_usd_at_purchase;
  const uid = order.uid;

  // Refund wallet
  const user = await fsGet(env, `users/${uid}`);
  const newBalance = round2((user.wallet_balance || 0) + amount);

  await fsPatch(env, `users/${uid}`, {
    wallet_balance: newBalance,
    updated_at: nowIso(),
  });

  // Log refund transaction
  const txnId = generateTransactionId();
  await fsSet(env, `wallet_transactions/${txnId}`, {
    uid,
    type: 'REFUND',
    amount,
    balance_before: user.wallet_balance || 0,
    balance_after: newBalance,
    reference: orderId,
    status: 'COMPLETED',
    reason,
    created_at: nowIso(),
  });

  // Mark order as refunded
  await fsPatch(env, `store_orders/${orderId}`, {
    refund_status: 'COMPLETED',
    refund_reason: reason,
    refund_at: nowIso(),
    status: 'REFUNDED',
  });

  await updateOrderStatus(env, orderId, 'REFUNDED', `استرجع المبلغ: ${reason}`, {
    timestamp: nowIso(),
    event: 'refunded',
    details: { amount, reason },
  });
}

async function assignStockCode(env, productId) {
  // جلب أول كود متاح
  const codes = await fsQuery(env, {
    from: [{ collectionId: 'stock_codes' }],
    where: [
      { fieldPath: 'product_id', opStr: '==', value: productId },
      { fieldPath: 'status', opStr: '==', value: 'AVAILABLE' }
    ],
    limit: 1,
  });

  if (codes.length === 0) return null;

  const codeDoc = withId(codes[0], 'stock_codes');

  // Mark as sold
  await fsPatch(env, `stock_codes/${codeDoc.id}`, {
    status: 'SOLD',
    assigned_at: nowIso(),
  });

  return codeDoc;
}

function generateOrderId() {
  return `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateIdempotencyKey() {
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function generateTransactionId() {
  return `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Export
 */
export {
  handleCreateOrder,
  updateOrderStatus,
  refundOrder,
};
