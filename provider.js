/**
 * ═══════════════════════════════════════════════════════════
 *  Provider Adapter Pattern
 *  كاردو — نمط المزودين
 * ═══════════════════════════════════════════════════════════
 *
 * فكرة: كل مزود يُنفّذ نفس الـinterface
 * بهذا نستطيع تبديل المزودين دون تغيير الـorder logic
 *
 * Types:
 *   API        — اتصال مباشر مع API خارجي
 *   STOCK      — أكواد محملة مسبقًا
 *   MANUAL     — تنفيذ يدوي من الإدارة
 *
 * ═══════════════════════════════════════════════════════════
 */

/**
 * Base adapter — الواجهة الأساسية
 */
class ProviderAdapter {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.type = config.type; // API, STOCK, MANUAL
    this.enabled = config.enabled !== false;
  }

  /**
   * الحصول على قائمة المنتجات من المزود
   * @returns {Object[]} products
   *   id, name, category, cost, currency, availability, metadata
   */
  async getProducts() {
    throw new Error('getProducts() must be implemented');
  }

  /**
   * التحقق من صحة معرف المنتج عند المزود
   * @param {string} productId — معرف المنتج عند المزود
   * @returns {Object} product details or null
   */
  async getProduct(productId) {
    throw new Error('getProduct() must be implemented');
  }

  /**
   * الحصول على السعر الحالي للمنتج
   * ملاحظة: قد يختلف عن السعر المحفوظ (تحديث سعر المزود)
   * @param {string} productId
   * @returns {number} price in USD
   */
  async getPrice(productId) {
    throw new Error('getPrice() must be implemented');
  }

  /**
   * الحصول على رصيد الحساب عند المزود
   * @returns {number} balance in USD
   */
  async getBalance() {
    throw new Error('getBalance() must be implemented');
  }

  /**
   * إنشاء طلب عند المزود
   * @param {Object} order
   *   productId, customerInput (required fields), idempotencyKey
   * @returns {Object} { success, transactionId, reference, ... }
   */
  async createOrder(order) {
    throw new Error('createOrder() must be implemented');
  }

  /**
   * الاستعلام عن حالة الطلب عند المزود
   * @param {string} transactionId — معرف الطلب عند المزود
   * @returns {Object} { status, result, error, ... }
   */
  async getOrderStatus(transactionId) {
    throw new Error('getOrderStatus() must be implemented');
  }

  /**
   * اختبار الاتصال بالمزود
   * @returns {Object} { success, latency, httpStatus, error }
   */
  async testConnection() {
    throw new Error('testConnection() must be implemented');
  }

  /**
   * التحقق من توقيع webhook (إن وُجد)
   * @param {Object} body — جسم الرسالة
   * @param {string} signature — التوقيع من headers
   * @returns {boolean}
   */
  verifyWebhook(body, signature) {
    return true; // override in subclasses
  }

  /**
   * معالجة webhook من المزود (إن وُجد)
   * @param {Object} event
   * @returns {Object} { processed, status, ... }
   */
  async handleWebhook(event) {
    throw new Error('handleWebhook() must be implemented');
  }
}

/**
 * ═══════════════════════════════════════════════════════════
 *  WDGZone Adapter
 * ═══════════════════════════════════════════════════════════
 */
class WDGZoneAdapter extends ProviderAdapter {
  constructor(config) {
    super(config);
    this.baseUrl = config.base_url || 'https://api.wdgzone.com';
    this.apiKey = config.api_key;
    this.apiSecret = config.api_secret;
  }

  async request(endpoint, method = 'GET', body = null) {
    const url = new URL(endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`);

    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'KARDO/1.0',
    };

    if (this.apiSecret) {
      headers['X-API-Secret'] = this.apiSecret;
    }

    const init = { method, headers };
    if (body) init.body = JSON.stringify(body);

    const start = Date.now();
    try {
      const res = await fetch(url, init);
      const latency = Date.now() - start;
      const data = await res.json();

      return {
        success: res.ok,
        status: res.status,
        data,
        latency,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        latency: Date.now() - start,
      };
    }
  }

  async getProducts() {
    // Example: GET /api/v1/products
    const res = await this.request('/api/v1/products');
    if (!res.success) throw new Error(`WDGZone getProducts failed: ${res.error}`);

    return (res.data.products || []).map(p => ({
      id: p.product_id,
      name: p.product_name,
      category: p.category,
      cost: parseFloat(p.cost),
      currency: p.currency || 'USD',
      availability: p.stock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK',
      region: p.region,
      metadata: {
        provider_sku: p.sku,
        game: p.game,
        quantity: p.quantity,
      },
    }));
  }

  async getProduct(productId) {
    const res = await this.request(`/api/v1/products/${productId}`);
    if (!res.success) return null;

    const p = res.data.product;
    return {
      id: p.product_id,
      name: p.product_name,
      cost: parseFloat(p.cost),
      availability: p.stock > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK',
    };
  }

  async getPrice(productId) {
    const product = await this.getProduct(productId);
    return product ? product.cost : null;
  }

  async getBalance() {
    const res = await this.request('/api/v1/account/balance');
    if (!res.success) throw new Error(`WDGZone getBalance failed: ${res.error}`);
    return parseFloat(res.data.balance);
  }

  async createOrder(order) {
    const payload = {
      product_id: order.productId,
      quantity: order.quantity || 1,
      idempotency_key: order.idempotencyKey,
      customer_data: order.customerInput,
    };

    const res = await this.request('/api/v1/orders', 'POST', payload);
    if (!res.success) {
      throw new Error(`WDGZone createOrder failed: ${res.error}`);
    }

    return {
      success: true,
      transactionId: res.data.order_id,
      reference: res.data.reference,
      deliveryInfo: res.data.delivery_info,
      code: res.data.code,
    };
  }

  async getOrderStatus(transactionId) {
    const res = await this.request(`/api/v1/orders/${transactionId}`);
    if (!res.success) {
      return { status: 'UNKNOWN', error: res.error };
    }

    const o = res.data.order;
    return {
      status: o.status, // PENDING, COMPLETED, FAILED
      code: o.code,
      deliveryInfo: o.delivery_info,
      error: o.error_message,
    };
  }

  async testConnection() {
    const start = Date.now();
    try {
      const res = await this.request('/api/v1/ping');
      const latency = Date.now() - start;

      if (res.success) {
        return {
          success: true,
          latency,
          httpStatus: res.status,
          message: 'الاتصال ناجح',
        };
      } else {
        return {
          success: false,
          latency,
          httpStatus: res.status,
          error: res.error || 'Failed to connect',
        };
      }
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  }
}

/**
 * ═══════════════════════════════════════════════════════════
 *  Libya Play Adapter
 * ═══════════════════════════════════════════════════════════
 */
class LibyaPlayAdapter extends ProviderAdapter {
  constructor(config) {
    super(config);
    this.baseUrl = config.base_url || 'https://api.libiaplay.com';
    this.apiKey = config.api_key;
    this.merchantId = config.merchant_id;
  }

  async request(endpoint, method = 'GET', body = null) {
    const url = new URL(endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`);

    const headers = {
      'X-API-Key': this.apiKey,
      'X-Merchant-ID': this.merchantId,
      'Content-Type': 'application/json',
    };

    const init = { method, headers };
    if (body) init.body = JSON.stringify(body);

    const start = Date.now();
    try {
      const res = await fetch(url, init);
      const latency = Date.now() - start;
      const data = await res.json();

      return {
        success: res.ok,
        status: res.status,
        data,
        latency,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        latency: Date.now() - start,
      };
    }
  }

  async getProducts() {
    const res = await this.request('/api/v2/products');
    if (!res.success) throw new Error(`Libya Play getProducts failed: ${res.error}`);

    return (res.data.items || []).map(p => ({
      id: p.id,
      name: p.name,
      category: p.service_type, // netflix, spotify, shahid, etc.
      cost: parseFloat(p.cost_usd),
      currency: 'USD',
      availability: p.active ? 'AVAILABLE' : 'OUT_OF_STOCK',
      metadata: {
        service: p.service_type,
        region: p.region,
      },
    }));
  }

  async getProduct(productId) {
    const res = await this.request(`/api/v2/products/${productId}`);
    if (!res.success) return null;

    const p = res.data;
    return {
      id: p.id,
      name: p.name,
      cost: parseFloat(p.cost_usd),
      availability: p.active ? 'AVAILABLE' : 'OUT_OF_STOCK',
    };
  }

  async getPrice(productId) {
    const product = await this.getProduct(productId);
    return product ? product.cost : null;
  }

  async getBalance() {
    const res = await this.request('/api/v2/account/balance');
    if (!res.success) throw new Error(`Libya Play getBalance failed: ${res.error}`);
    return parseFloat(res.data.wallet_usd);
  }

  async createOrder(order) {
    const payload = {
      product_id: order.productId,
      quantity: order.quantity || 1,
      customer: order.customerInput,
      request_id: order.idempotencyKey,
    };

    const res = await this.request('/api/v2/orders', 'POST', payload);
    if (!res.success) {
      throw new Error(`Libya Play createOrder failed: ${res.error}`);
    }

    return {
      success: true,
      transactionId: res.data.transaction_id,
      status: res.data.status,
      code: res.data.code,
    };
  }

  async getOrderStatus(transactionId) {
    const res = await this.request(`/api/v2/orders/${transactionId}`);
    if (!res.success) {
      return { status: 'UNKNOWN', error: res.error };
    }

    return {
      status: res.data.status,
      code: res.data.code,
      error: res.data.error_message,
    };
  }

  async testConnection() {
    const start = Date.now();
    try {
      const res = await this.request('/api/v2/health');
      const latency = Date.now() - start;

      if (res.success) {
        return {
          success: true,
          latency,
          httpStatus: res.status,
          message: 'الاتصال ناجح',
        };
      } else {
        return {
          success: false,
          latency,
          httpStatus: res.status,
          error: res.data.error || 'Failed to connect',
        };
      }
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  }
}

/**
 * ═══════════════════════════════════════════════════════════
 *  Stock Code Adapter
 *  للأكواز المحملة مسبقًا (Steam, Google Play, etc.)
 * ═══════════════════════════════════════════════════════════
 */
class StockCodeAdapter extends ProviderAdapter {
  constructor(config) {
    super(config);
    this.type = 'STOCK';
  }

  async getProducts() {
    // لا يُرجع قائمة ديناميكية — الأكواز مُدارة عبر UI الإدارة
    return [];
  }

  async getProduct(productId) {
    return null;
  }

  async getPrice(productId) {
    return null;
  }

  async getBalance() {
    // لا يوجد رصيد — الأكواز محملة مسبقًا
    return null;
  }

  async createOrder(order) {
    // سيتم اختيار الكود من قاعدة البيانات في order logic
    // هنا نُرجع success فقط
    return {
      success: true,
      transactionId: `STOCK_${Date.now()}`,
      status: 'PENDING_CODE_ASSIGNMENT',
    };
  }

  async getOrderStatus(transactionId) {
    // يتم التحقق من الكود المعيّن في قاعدة البيانات
    return {
      status: 'COMPLETED',
    };
  }

  async testConnection() {
    return {
      success: true,
      message: 'محلي (أكواز محملة)',
    };
  }
}

/**
 * ═══════════════════════════════════════════════════════════
 *  Manual Adapter
 *  للخدمات التي تتطلب تنفيذًا يدويًا
 * ═══════════════════════════════════════════════════════════
 */
class ManualAdapter extends ProviderAdapter {
  constructor(config) {
    super(config);
    this.type = 'MANUAL';
  }

  async getProducts() {
    return [];
  }

  async getProduct(productId) {
    return null;
  }

  async getPrice(productId) {
    return null;
  }

  async getBalance() {
    return null;
  }

  async createOrder(order) {
    return {
      success: true,
      transactionId: `MANUAL_${Date.now()}`,
      status: 'PENDING_ADMIN_REVIEW',
    };
  }

  async getOrderStatus(transactionId) {
    // يتم التحقق من الحالة في قاعدة البيانات
    return {
      status: 'PENDING_ADMIN_REVIEW',
    };
  }

  async testConnection() {
    return {
      success: true,
      message: 'تنفيذ يدوي',
    };
  }
}

/**
 * ═══════════════════════════════════════════════════════════
 *  Provider Factory
 *  إنشاء adapter مناسب حسب النوع
 * ═══════════════════════════════════════════════════════════
 */
function createProviderAdapter(config) {
  const { type, provider_name, ...rest } = config;

  switch (provider_name?.toLowerCase()) {
    case 'wdgzone':
      return new WDGZoneAdapter(config);
    case 'libiaplay':
    case 'libya play':
      return new LibyaPlayAdapter(config);
    case 'stock':
    case 'stock_code':
      return new StockCodeAdapter(config);
    case 'manual':
      return new ManualAdapter(config);
    default:
      throw new Error(`Unknown provider: ${provider_name}`);
  }
}

// Exports
export {
  ProviderAdapter,
  WDGZoneAdapter,
  LibyaPlayAdapter,
  StockCodeAdapter,
  ManualAdapter,
  createProviderAdapter,
};
