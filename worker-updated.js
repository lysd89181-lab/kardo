/**
 * ═══════════════════════════════════════════════════════════
 *  KARDO v2.0 — Cloudflare Worker Backend
 *  كاردو — الخدمة الخلفية (النسخة 2 مع المزودين المتعددة)
 * ═══════════════════════════════════════════════════════════
 *
 *  Phase 2: Multi-Provider Architecture
 *  - Provider abstraction & adapters
 *  - Flexible product management
 *  - Advanced order processing
 *  - Pricing engine with rules
 *  - Bulk product import
 *  - Audit logging
 *
 *  السرّيات المطلوبة (wrangler secret put):
 *   KRIPI_API_KEY
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY
 *   ALLOWED_ORIGIN
 *   SMS_WEBHOOK_SECRET
 *   PROVIDER_ENCRYPTION_KEY (جديد — للتشفير)
 * ═══════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════
//  الاستيرادات
// ═══════════════════════════════════════════════════════════

// Phase 2 providers
import {
  ProviderAdapter,
  WDGZoneAdapter,
  LibyaPlayAdapter,
  StockCodeAdapter,
  ManualAdapter,
  createProviderAdapter,
} from './provider-adapters.js';

// Phase 2 API routes
import {
  handleGetProviders,
  handleGetProvider,
  handleCreateProvider,
  handleUpdateProvider,
  handleDeleteProvider,
  handleTestProviderConnection,
  handleGetProviderBalance,
  handleSyncProviderProducts,
  handleGetProviderProducts,
} from './provider-api-routes.js';

import {
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
} from './product-management-system.js';

import {
  handleImportPreview,
  handleImportProducts,
  handleImportPreviewCheck,
} from './product-import-system.js';

import {
  handleGetPricingRules,
  handleCreatePricingRule,
  handleUpdatePricingRule,
  handleDeletePricingRule,
  calculateCustomerPrice,
  handleCalculatePrice,
  handleUpdateProductPrice,
  handleBulkPriceUpdate,
} from './pricing-engine.js';

import {
  handleCreateOrder,
} from './order-processing-system.js';

// ═══════════════════════════════════════════════════════════
//  الثوابت
// ═══════════════════════════════════════════════════════════

const KRIPI_BASE = 'https://appapi.kripicard.com';
const FS_BASE = 'https://firestore.googleapis.com/v1';
const BINS_NO_DOB = ['539502', '525847'];
const BINS_NEED_DOB = ['537872', '533171', '246001'];

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

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      purgeExpiredReveals(env).catch(e => console.error('PURGE_FAILED', e.message))
    );
  },
};

// ═══════════════════════════════════════════════════════════
//  التوجيه الرئيسي
// ═══════════════════════════════════════════════════════════

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

  // ── Webhook رسائل التحويل ──
  if (path === '/api/sms/webhook') {
    return handleSmsWebhook(request, env);
  }

  // ── متطلب مصادقة ────────────────────────────────────────
  const body = request.method === 'POST' || request.method === 'PATCH' || request.method === 'DELETE'
    ? await safeJson(request)
    : {};
  const user = await requireAuth(request, env);

  // ═══════════════════════════════════════════════════════════
  //  المسارات الموجودة (الحفاظ على التوافق الخلفي)
  // ═══════════════════════════════════════════════════════════

  switch (path) {
    // Cards
    case '/api/cards/create':       return handleCreateCard(user, body, env);
    case '/api/cards/fund':         return handleFundCard(user, body, env);
    case '/api/cards/freeze':       return handleFreeze(user, body, env);
    case '/api/cards/details':      return handleDetails(user, body, env);
    case '/api/cards/transactions': return handleTransactions(user, body, env);
    case '/api/cards/delete':       return handleDeleteCard(user, body, env);

    // Wallet
    case '/api/wallet/claim':       return handleWalletClaim(user, body, env);
    case '/api/wallet/withdraw':    return handleWithdrawRequest(user, body, env);
    case '/api/wallet/transfer':    return handleTransfer(user, body, env);

    // Store
    case '/api/store/order':        return handleStoreOrder(user, body, env);
    case '/api/coupon/check':       return handleCouponCheck(user, body, env);

    // Points & tickets
    case '/api/points/redeem':      return handleRedeemPoints(user, body, env);
    case '/api/ticket/create':      return handleTicketCreate(user, body, env);
    case '/api/ticket/reply':       return handleTicketReply(user, body, env);

    // Admin
    case '/api/admin/ticket/close': return handleTicketClose(user, body, env);
    case '/api/admin/withdraw':     return handleAdminWithdraw(user, body, env);
    case '/api/admin/order':        return handleAdminOrder(user, body, env);
    case '/api/admin/settings':     return handleAdminSettings(user, body, env);
    case '/api/admin/deposit':      return handleAdminDeposit(user, body, env);
    case '/api/admin/wallet-adjust':return handleAdminWalletAdjust(user, body, env);
    case '/api/admin/reconcile':    return handleAdminReconcile(user, body, env);
    case '/api/admin/sms/assign':   return handleAdminSmsAssign(user, body, env);

    // Manual cards
    case '/api/mcard/request':      return handleManualCardRequest(user, body, env);
    case '/api/mcard/reveal':       return handleRevealCard(user, body, env);
    case '/api/admin/mcard/fulfil': return handleAdminCardFulfil(user, body, env);

    // USDT
    case '/api/wallet/usdt/invoice':return handleUsdtInvoice(user, body, env);
    case '/api/wallet/usdt/verify': return handleUsdtVerify(user, body, env);

    // Referrals
    case '/api/ref/code':           return handleRefCode(user, body, env);
    case '/api/ref/claim':          return handleRefClaim(user, body, env);

    // Activity
    case '/api/activity/ping':      return handleActivityPing(user, body, env, request);
  }

  // ═══════════════════════════════════════════════════════════
  //  Phase 2: مسارات إدارة المزودين (مصادقة إدارية)
  // ═══════════════════════════════════════════════════════════

  if (path === '/api/admin/providers' && request.method === 'GET') {
    return handleGetProviders(user, body, env);
  }
  if (path === '/api/admin/providers' && request.method === 'POST') {
    return handleCreateProvider(user, body, env);
  }

  if (path.match(/^\/api\/admin\/providers\/[^/]+$/) && request.method === 'GET') {
    const providerId = path.split('/')[4];
    return handleGetProvider(user, body, env, providerId);
  }
  if (path.match(/^\/api\/admin\/providers\/[^/]+$/) && request.method === 'PATCH') {
    const providerId = path.split('/')[4];
    return handleUpdateProvider(user, body, env, providerId);
  }
  if (path.match(/^\/api\/admin\/providers\/[^/]+$/) && request.method === 'DELETE') {
    const providerId = path.split('/')[4];
    return handleDeleteProvider(user, body, env, providerId);
  }

  if (path.match(/^\/api\/admin\/providers\/[^/]+\/test-connection$/)) {
    const providerId = path.split('/')[4];
    return handleTestProviderConnection(user, body, env, providerId);
  }
  if (path.match(/^\/api\/admin\/providers\/[^/]+\/get-balance$/)) {
    const providerId = path.split('/')[4];
    return handleGetProviderBalance(user, body, env, providerId);
  }
  if (path.match(/^\/api\/admin\/providers\/[^/]+\/sync-products$/)) {
    const providerId = path.split('/')[4];
    return handleSyncProviderProducts(user, body, env, providerId);
  }
  if (path.match(/^\/api\/admin\/providers\/[^/]+\/products$/)) {
    const providerId = path.split('/')[4];
    return handleGetProviderProducts(user, body, env, providerId);
  }

  // ═══════════════════════════════════════════════════════════
  //  Phase 2: مسارات إدارة المنتجات
  // ═══════════════════════════════════════════════════════════

  if (path === '/api/admin/products' && request.method === 'GET') {
    return handleGetProducts(user, body, env, url);
  }
  if (path === '/api/admin/products' && request.method === 'POST') {
    return handleCreateProduct(user, body, env);
  }

  if (path.match(/^\/api\/admin\/products\/[^/]+$/) && request.method === 'GET') {
    const productId = path.split('/')[4];
    return handleGetProduct(user, body, env, productId);
  }
  if (path.match(/^\/api\/admin\/products\/[^/]+$/) && request.method === 'PATCH') {
    const productId = path.split('/')[4];
    return handleUpdateProduct(user, body, env, productId);
  }
  if (path.match(/^\/api\/admin\/products\/[^/]+$/) && request.method === 'DELETE') {
    const productId = path.split('/')[4];
    return handleDeleteProduct(user, body, env, productId);
  }

  if (path.match(/^\/api\/admin\/products\/[^/]+\/duplicate$/)) {
    const productId = path.split('/')[4];
    return handleDuplicateProduct(user, body, env, productId);
  }
  if (path.match(/^\/api\/admin\/products\/[^/]+\/images$/)) {
    const productId = path.split('/')[4];
    return handleAddProductImage(user, body, env, productId);
  }
  if (path.match(/^\/api\/admin\/products\/[^/]+\/images\/\d+$/)) {
    const parts = path.split('/');
    const productId = parts[4];
    const imageIndex = parts[6];
    return handleDeleteProductImage(user, body, env, productId, imageIndex);
  }

  if (path.match(/^\/api\/admin\/products\/[^/]+\/required-fields$/)) {
    const productId = path.split('/')[4];
    return handleAddRequiredField(user, body, env, productId);
  }
  if (path.match(/^\/api\/admin\/products\/[^/]+\/required-fields\/[^/]+$/)) {
    const parts = path.split('/');
    const productId = parts[4];
    const fieldId = parts[6];
    return handleDeleteRequiredField(user, body, env, productId, fieldId);
  }

  if (path === '/api/admin/products/bulk-action') {
    return handleBulkProductAction(user, body, env);
  }

  // ═══════════════════════════════════════════════════════════
  //  Phase 2: استيراد المنتجات
  // ═══════════════════════════════════════════════════════════

  if (path === '/api/admin/import/preview' && request.method === 'GET') {
    const providerId = url.searchParams.get('provider_id');
    return handleImportPreview(user, body, env, providerId);
  }
  if (path === '/api/admin/import/products' && request.method === 'POST') {
    return handleImportProducts(user, body, env);
  }
  if (path === '/api/admin/import/preview-check' && request.method === 'POST') {
    return handleImportPreviewCheck(user, body, env);
  }

  // ═══════════════════════════════════════════════════════════
  //  Phase 2: محرك التسعير
  // ═══════════════════════════════════════════════════════════

  if (path === '/api/admin/pricing-rules' && request.method === 'GET') {
    return handleGetPricingRules(user, body, env);
  }
  if (path === '/api/admin/pricing-rules' && request.method === 'POST') {
    return handleCreatePricingRule(user, body, env);
  }

  if (path.match(/^\/api\/admin\/pricing-rules\/[^/]+$/) && request.method === 'PATCH') {
    const ruleId = path.split('/')[4];
    return handleUpdatePricingRule(user, body, env, ruleId);
  }
  if (path.match(/^\/api\/admin\/pricing-rules\/[^/]+$/) && request.method === 'DELETE') {
    const ruleId = path.split('/')[4];
    return handleDeletePricingRule(user, body, env, ruleId);
  }

  if (path === '/api/admin/pricing/calculate' && request.method === 'GET') {
    return handleCalculatePrice(user, body, env, url);
  }

  if (path.match(/^\/api\/admin\/products\/[^/]+\/price$/) && request.method === 'PATCH') {
    const productId = path.split('/')[4];
    return handleUpdateProductPrice(user, body, env, productId);
  }

  if (path === '/api/admin/pricing/bulk-update' && request.method === 'POST') {
    return handleBulkPriceUpdate(user, body, env);
  }

  // ═══════════════════════════════════════════════════════════
  //  Phase 2: معالجة الطلبات (محدّثة)
  // ═══════════════════════════════════════════════════════════

  // Note: /api/store/order موجود في الأعلى (الحالي)
  // هنا نمرره عبر النظام الجديد إذا أُضيف
  // for now، الحالي handleStoreOrder يعمل
  // سيتم تحديثه لاستخدام الـ new order system في مرحلة لاحقة

  throw httpError(404, 'المسار غير موجود');
}

// ═══════════════════════════════════════════════════════════
//  دوال مساعدة موجودة (الحفاظ على كل شيء)
// ═══════════════════════════════════════════════════════════

// (جميع الدوال القديمة تبقى كما هي)
// - handleQuote
// - handleStatus
// - handleCatalog
// - handleSmsWebhook
// - handleCreateCard
// - handleFundCard
// - ... وجميع الدوال الأخرى

// ملاحظة: هذا ملف كبير جداً
// الدوال القديمة تبقى في الملف الأصلي
// أضفنا هنا الاستيرادات والمسارات الجديدة فقط

// ═══════════════════════════════════════════════════════════
//  Utility Functions (موجودة في الأصل)
// ═══════════════════════════════════════════════════════════

function corsHeaders(origin = '*') {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

function json(obj, status = 200, origin = '*') {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.publicMessage = message;
  return err;
}

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function num(val, def) {
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : def;
}

function nowIso() {
  return new Date().toISOString();
}

function withId(doc, collection) {
  const obj = {};
  for (const [key, val] of Object.entries(doc.fields || {})) {
    obj[key] = val.stringValue || val.integerValue || val.booleanValue || val.doubleValue || val.arrayValue || val.mapValue || null;
  }
  obj.id = doc.name?.split('/').pop() || '';
  return obj;
}

// ═══════════════════════════════════════════════════════════
//  Firebase Utilities
// ═══════════════════════════════════════════════════════════

async function getFirebaseToken(env) {
  const now = Date.now();
  if (_tokenCache.token && _tokenCache.exp > now) {
    return _tokenCache.token;
  }

  const privateKey = env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const email = env.FIREBASE_CLIENT_EMAIL;

  if (!privateKey || !email) {
    throw httpError(500, 'Firebase not configured');
  }

  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    iss: email,
    sub: email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 3600,
  }));

  const signatureInput = `${header}.${payload}`;
  const signatureBytes = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    await crypto.subtle.importKey(
      'pkcs8',
      Uint8Array.from(atob(privateKey.replace(/-----BEGIN.*-----/g, '').replace(/-----END.*-----/g, '').replace(/\s/g, '')), c => c.charCodeAt(0)),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    ),
    new TextEncoder().encode(signatureInput)
  );

  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)));
  const token = `${signatureInput}.${signature}`;

  _tokenCache = { token, exp: now + 3300000 };
  return token;
}

async function fsQuery(env, query) {
  // Simplified query builder
  const token = await getFirebaseToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;

  // Build query
  const structured = {
    from: query.from || [{ collectionId: 'users' }],
    where: query.where || [],
    orderBy: query.orderBy || [],
    limit: query.limit || 100,
    offset: query.offset || 0,
  };

  const res = await fetch(`${FS_BASE}/projects/${projectId}/databases/(default)/documents:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(structured),
  });

  if (!res.ok) throw httpError(500, 'Firestore query failed');

  const data = await res.json();
  return data.filter(r => r.document).map(r => r.document);
}

async function fsGet(env, path) {
  const token = await getFirebaseToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;

  const res = await fetch(`${FS_BASE}/projects/${projectId}/databases/(default)/documents/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 404) return null;
  if (!res.ok) throw httpError(500, 'Firestore get failed');

  const doc = await res.json();
  return doc.fields ? withId(doc) : doc;
}

async function fsSet(env, path, data) {
  const token = await getFirebaseToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;

  const res = await fetch(`${FS_BASE}/projects/${projectId}/databases/(default)/documents/${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFirestore(data) }),
  });

  if (!res.ok) throw httpError(500, 'Firestore set failed');
  return res.json();
}

async function fsPatch(env, path, updates) {
  // Similar to fsSet but PATCH
  return fsSet(env, path, updates);
}

async function fsDelete(env, path) {
  const token = await getFirebaseToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;

  const res = await fetch(`${FS_BASE}/projects/${projectId}/databases/(default)/documents/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) throw httpError(500, 'Firestore delete failed');
  return true;
}

function toFirestore(obj) {
  if (obj === null || obj === undefined) return { nullValue: null };
  if (typeof obj === 'string') return { stringValue: obj };
  if (typeof obj === 'number') return { doubleValue: obj };
  if (typeof obj === 'boolean') return { booleanValue: obj };
  if (Array.isArray(obj)) return { arrayValue: { values: obj.map(toFirestore) } };
  if (typeof obj === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(obj)) {
      fields[k] = toFirestore(v);
    }
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

async function getSettings(env) {
  const doc = await fsGet(env, 'settings/main');
  return doc || {
    usd_to_lyd: 7.0,
    default_margin: 0.05,
    min_amount: 10,
    max_amount: 200,
  };
}

function requireAdmin(user) {
  if (!user.admin) {
    throw httpError(403, 'تصريح مرفوض — الإدارة فقط');
  }
}

function requireSignedIn(user) {
  if (!user || !user.uid) {
    throw httpError(401, 'يجب تسجيل الدخول');
  }
}

async function requireAuth(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    throw httpError(401, 'مصادقة مطلوبة');
  }

  const token = auth.slice(7);
  // Verify Firebase token
  // (تنفيذ التحقق من Firebase ID token)
  
  return { uid: 'user', admin: false }; // Placeholder
}

async function purgeExpiredReveals(env) {
  // Implementation here
}

// ═══════════════════════════════════════════════════════════
//  Existing handlers (from original worker.js)
// ═══════════════════════════════════════════════════════════

// NOTE: جميع الدوال التالية موجودة في worker.js الأصلي:
// - handleQuote
// - handleStatus
// - handleCatalog
// - handleSmsWebhook
// - handleCreateCard
// - handleFundCard
// - handleFreeze
// - handleDetails
// - handleTransactions
// - handleDeleteCard
// - handleWalletClaim
// - handleStoreOrder
// - handleCouponCheck
// - handleWithdrawRequest
// - handleTransfer
// - handleRedeemPoints
// - handleTicketCreate
// - handleTicketReply
// - handleTicketClose
// - handleAdminWithdraw
// - handleAdminOrder
// - handleManualCardRequest
// - handleRevealCard
// - handleAdminCardFulfil
// - handleUsdtInvoice
// - handleUsdtVerify
// - handleRefCode
// - handleRefClaim
// - handleActivityPing
// - handleAdminSettings
// - handleAdminDeposit
// - handleAdminWalletAdjust
// - handleAdminReconcile
// - handleAdminSmsAssign
// - computePricing
// - cleanBanners
// - cleanFields
// - cleanCustomMethods
// - customMethods
// ... وأي دوال أخرى

// في ملف worker.js الفعلي، احتفظ بجميع الدوال الموجودة
// هذا الملف يظهر الهيكل الجديد فقط
