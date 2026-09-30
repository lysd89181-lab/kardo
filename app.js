/**
 * ═══════════════════════════════════════════════════════════
 *  KARDO — App Logic
 *  Version: 4.0.0 (Security Hardened)
 *
 *  New in v4:
 *  - App Check support
 *  - Idempotency keys for financial operations
 *  - XSS protection for icon URLs
 *  - Fetch timeout protection
 *  - Lazy loading for realtime listeners
 *  - prefers-reduced-motion support
 *  - Skeleton loading states
 * ═══════════════════════════════════════════════════════════
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getMessaging, getToken as getMsgToken, isSupported as isMsgSupported } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js';
import { getAuth, onAuthStateChanged, signOut, sendPasswordResetEmail }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, setDoc, getDoc, onSnapshot, collection,
  query, where, orderBy, limit }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initializeAppCheck, ReCaptchaV3Provider, getToken as getAppCheckToken }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js';

/* ═══ Config ═══ */
const firebaseConfig = {
  apiKey: "AIzaSyC-GntWur6r_Ow_v0wTNymQqQa6brzgvW8",
  authDomain: "kardo-1c657.firebaseapp.com",
  projectId: "kardo-1c657",
  storageBucket: "kardo-1c657.firebasestorage.app",
  messagingSenderId: "593934928630",
  appId: "1:593934928630:web:d36ea455a284e974043ad7"
};

const API_BASE = 'https://kardo.sdkhyrallh08.workers.dev';

// ⭐ App Check site key (from Firebase Console → App Check → reCAPTCHA v3)
const APP_CHECK_SITE_KEY = '';

const app = initializeApp(firebaseConfig);

let appCheckEnabled = false;
let appCheckInstance = null;
try {
  if (APP_CHECK_SITE_KEY) {
    appCheckInstance = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
    appCheckEnabled = true;
  }
} catch (e) {
  console.warn('App Check init failed:', e.message);
}

const auth = getAuth(app);
const db = getFirestore(app);

/* ═══ State ═══ */
const S = {
  user: null,
  profile: { wallet_balance: 0, cards_count: 0, total_spent: 0,
             name: '', email: '', phone: '', points: 0 },
  cards: [], orders: [], deposits: [], shopOrders: [],
  catalog: { categories: [], products: [] },
  services: [],
  svcOrders: [],
  cart: [], cat: null, q: '', filter: 'all',
  config: {
    usd_to_lyd: 11.8,
    manual_cards: { on: true, create_min: 10, create_max: 500,
                    create_fee_fixed: 8, create_fee_pct: 2.5,
                    topup_min: 10, topup_max: 500,
                    topup_fee_fixed: 8, topup_fee_pct: 2.5,
                    reveal_hours: 24 },
    methods: {}, nav: {}, texts: {}, referral: {},
  },
  withdrawals: [], tickets: [], coupon: null, dataErr: {},
  manualCards: [], manualOrders: [],
  page: 'dashboard', dir: null, unsub: [],
};

/* ═══ Utils ═══ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const n = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
const usd = v => '$' + Number(v || 0).toFixed(2);
const rate = () => n(S.config.usd_to_lyd) || 11.8;
const lyd = v => Number(v || 0).toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' د.ل';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const phoneKey = r => {
  let p = String(r || '').replace(/\D/g, '');
  if (p.startsWith('00218')) p = p.slice(5);
  else if (p.startsWith('218')) p = p.slice(3);
  if (p.startsWith('0')) p = p.slice(1);
  return p.slice(-9);
};
const dt = v => {
  if (!v) return '—';
  const d = v.toDate ? v.toDate() : new Date(v);
  return isNaN(d) ? '—' : d.toLocaleDateString('ar-LY', { day: '2-digit', month: 'short' }) +
    ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};
const shortDate = v => {
  const d = v?.toDate ? v.toDate() : new Date(v);
  return isNaN(d) ? '—' : d.toLocaleDateString('ar-LY', { day: 'numeric', month: 'long' });
};

function sortByDate(rows, key = 'created_at') {
  return rows.sort((a, b) => {
    const av = a[key]?.toDate?.() || new Date(a[key] || 0);
    const bv = b[key]?.toDate?.() || new Date(b[key] || 0);
    return bv - av;
  });
}

// ⭐ Idempotency key generator
function newIdemKey() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return 'k' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

// ⭐ Sanitize icon URLs (defense in depth — Worker validates too)
function safeIconUrl(url) {
  if (!url) return '';
  const s = String(url).trim();
  const allowed = [
    'data:image/jpeg;base64,',
    'data:image/jpg;base64,',
    'data:image/png;base64,',
    'data:image/webp;base64,',
    'https://',
  ];
  const lower = s.toLowerCase();
  for (const prefix of allowed) {
    if (lower.startsWith(prefix)) return s;
  }
  return '';
}

/* ═══ Icons (Lucide) ═══ */
const I = {
  home: '<path d="M3 10.4 12 3l9 7.4V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
  bag: '<path d="M4.5 8h15l-1.2 12.2a1.8 1.8 0 0 1-1.8 1.6H7.5a1.8 1.8 0 0 1-1.8-1.6z"/><path d="M8.5 8V6a3.5 3.5 0 0 1 7 0v2"/>',
  wallet: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5z"/><path d="M16.5 12h1.5"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3h2.3l2.5 12.2a1.6 1.6 0 0 0 1.6 1.3h8.6a1.6 1.6 0 0 0 1.6-1.3L21 7H6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5 16.5 16.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7"/><circle cx="12" cy="12" r="3"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  up: '<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>',
  down: '<path d="M12 5v14M18.5 12.5 12 19l-6.5-6.5"/>',
  swap: '<path d="M7 4v13M7 4 3.5 7.5M7 4l3.5 3.5M17 20V7M17 20l3.5-3.5M17 20l-3.5-3.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  gift: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.3"/><path d="M12 17h.01"/>',
  star: '<path d="m12 3 2.7 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17.2 6.4 20.3l1.2-6.3L3 9.6l6.3-.8z"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  shield: '<path d="M12 2.5 4 6v6c0 5 3.4 8.6 8 9.5 4.6-.9 8-4.5 8-9.5V6z"/>',
  bell: '<path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  bolt: '<path d="M13 2 4.5 12.5H11l-1 9.5 8.5-11H12z"/>',
};
const svg = (d, w = 1.75) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

/* ═══ UI Helpers ═══ */
const setHTML = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; };
const onTap = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };

/* ═══ Toast ═══ */
function toast(msg, kind = '') {
  const icons = { ok: I.check, bad: I.x, '': I.help };
  const el = document.createElement('div');
  el.className = 'toast ' + (kind === 'ok' ? 'success' : kind === 'bad' ? 'error' : '');
  el.innerHTML = `<span style="color:${kind === 'ok' ? 'var(--success)' : kind === 'bad' ? 'var(--error)' : 'var(--text-2)'}">${svg(icons[kind] || '', 2.2)}</span><span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
    el.style.transition = '.2s';
    setTimeout(() => el.remove(), 200);
  }, 3200);
}

/* ═══ Modal ═══ */
function modal(html) {
  window._lastFocused = document.activeElement;
  $('#modal').innerHTML = html;
  $('#overlay').classList.add('open');
  setTimeout(() => {
    const modalEl = $('#modal');
    const focusable = modalEl.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length) focusable[0].focus();
  }, 50);
}
window.closeModal = () => {
  $('#overlay').classList.remove('open');
  if (window._lastFocused) {
    try { window._lastFocused.focus(); } catch {}
  }
};
$('#overlay')?.addEventListener('click', e => { if (e.target.id === 'overlay') closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Tab' && $('#overlay').classList.contains('open')) {
    const modalEl = $('#modal');
    const focusable = [...modalEl.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )].filter(el => !el.disabled && el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});

/* ═══ API ═══ */
async function fetchWithTimeout(url, options = {}, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function appCheckHeader() {
  if (!appCheckInstance) return {};
  try { const t = await getAppCheckToken(appCheckInstance); return { 'x-firebase-appcheck': t.token }; }
  catch { return {}; }
}

async function api(path, body) {
  if (!navigator.onLine) throw new Error('لا يوجد اتصال بالإنترنت');
  const token = await auth.currentUser.getIdToken();
  const res = await fetchWithTimeout(API_BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, ...(await appCheckHeader()) },
    body: JSON.stringify(body || {}),
  }, 20000);
  const d = await res.json().catch(() => ({ success: false, error: 'رد غير مفهوم' }));
  if (!d.success) throw new Error(d.error || 'فشلت العملية');
  return d;
}
async function apiGet(path) {
  const res = await fetchWithTimeout(API_BASE + path, {}, 10000);
  const d = await res.json();
  if (!d.success) throw new Error(d.error || 'خطأ');
  return d;
}

/* ═══ Auth Flow ═══ */
onAuthStateChanged(auth, async user => {
  S.unsub.forEach(u => { try { u(); } catch {} });
  S.unsub = [];
  dropLazy(null);

  if (!user) {
    $('#public').style.display = 'block';
    $('#app').style.display = 'none';
    return;
  }

  S.user = user;
  $('#public').style.display = 'none';
  $('#app').style.display = 'block';

  await ensureProfile(user);
  if (pushOn()) setTimeout(() => registerPushToken(true), 4000);
  { const nm = /[#&]n=([^&]+)/.exec(location.hash); if (nm) { history.replaceState(null, '', location.pathname); setTimeout(() => followLink(decodeURIComponent(nm[1])), 1200); } }
  setTimeout(() => { if (!document.getElementById('overlay')?.classList.contains('open')) maybeTour(); }, 1500);
  subscribe(user.uid);

  try {
    const c = JSON.parse(localStorage.getItem('kardo_cfg') || 'null');
    if (c && c.methods) S.config = { ...S.config, ...c };
  } catch {}

  apiGet('/api/status').then(d => {
    S.config = { ...S.config, ...d };
    try { localStorage.setItem('kardo_cfg', JSON.stringify(d)); } catch {}
    render();
  }).catch(e => console.warn('status:', e.message));

  loadServices();

  api('/api/activity/ping', {}).catch(() => {});
  loadCatalog();
  go('dashboard');
});

async function ensureProfile(user) {
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        name: user.displayName || 'مستخدم',
        email: user.email || '',
        phone: '',
        phone_key: '',
        wallet_balance: 0,
        total_spent: 0,
        cards_count: 0,
        banned: false,
        created_at: new Date().toISOString(),
      }, { merge: true });
    }
  } catch (e) { console.warn('ensureProfile:', e.code); }
}

/* ═══ Services Loader ═══ */
async function loadServices() {
  try {
    const d = await apiGet('/api/services/list');
    S.services = Array.isArray(d.services) ? d.services : [];
    render();
  } catch (e) {
    console.warn('services:', e.message);
    S.services = [];
    render();
  }
}
window.loadServices = loadServices;

/* ═══ Realtime Subscriptions ═══ */
function subscribe(uid) {
  subscribeNotifications(uid);
  S.unsub.push(onSnapshot(doc(db, 'users', uid), s => {
    if (s.exists()) S.profile = { ...S.profile, ...s.data() };
    if (!S._evPrompted && needsEmailVerify() && Date.now() - Date.parse(S.profile.created_at || 0) < 15 * 60000) {
      S._evPrompted = true; setTimeout(openEmailVerify, 800);          // حساب جديد → اطلب التأكيد مباشرة
    }
    render();
  }, e => console.warn('user:', e.code)));

  S.unsub.push(onSnapshot(query(collection(db, 'manual_cards'),
    where('uid', '==', uid), limit(50)),
    s => {
      S.manualCards = sortByDate(s.docs.map(d => ({ id: d.id, ...d.data() })));
      render();
    },
    e => { S.dataErr.cards = e.code; render(); }));

  S.unsub.push(onSnapshot(query(collection(db, 'service_orders'),
    where('uid', '==', uid), limit(60)),
    s => {
      S.svcOrders = sortByDate(s.docs.map(d => ({ id: d.id, ...d.data() })));
      render();
    },
    e => { S.dataErr.svcOrders = e.code; render(); }));
}

const _lazy = {};
function lazySub(key, build) {
  if (_lazy[key]) return;
  _lazy[key] = onSnapshot(build(), snap => {
    const rows = sortByDate(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    if (key === 'orders') S.orders = rows;
    if (key === 'deposits') S.deposits = rows;
    if (key === 'tickets') S.tickets = rows;
    if (key === 'mc2') S.manualOrders = rows;
    if (key === 'withdrawals') S.withdrawals = rows;
    if (key === 'morders') S.mOrders = rows;
    if (key === 'mstore') S.mstoreOrders = rows;
    if (key === 'mcases') S.mCases = rows;
    if (key === 'mscases') S.mstoreCases = rows;
    render();
  }, e => { S.dataErr[key] = e.code; render(); });
}

function dropLazy(except) {
  const keep = [].concat(except || []);
  Object.keys(_lazy).forEach(k => {
    if (!keep.includes(k) && _lazy[k]) { try { _lazy[k](); } catch {} delete _lazy[k]; }
  });
}

function ensurePageData() {
  const uid = S.user?.uid;
  if (!uid) return;
  if (S.page === 'orders') {
    lazySub('orders', () => query(collection(db, 'orders'),
      where('uid', '==', uid), limit(50)));
    lazySub('morders', () => query(collection(db, 'merchant_orders'),
      where('uid', '==', uid), limit(60)));
    lazySub('mcases', () => query(collection(db, 'merchant_reports'),
      where('uid', '==', uid), limit(30)));
    dropLazy(['orders', 'morders', 'mcases']);
  } else if (S.page === 'mystore') {
    lazySub('mstore', () => query(collection(db, 'merchant_orders'),
      where('merchant_owner', '==', uid), limit(200)));
    lazySub('mscases', () => query(collection(db, 'merchant_reports'),
      where('merchant_owner', '==', uid), limit(60)));
    dropLazy(['mstore', 'mscases']);
  } else if (S.page === 'wallet') {
    lazySub('deposits', () => query(collection(db, 'wallet_deposits'),
      where('uid', '==', uid), limit(40)));
    lazySub('withdrawals', () => query(collection(db, 'withdrawals'),
      where('uid', '==', uid), limit(20)));
  } else if (S.page === 'cards') {
    lazySub('mc2', () => query(collection(db, 'manual_card_orders'),
      where('uid', '==', uid), limit(50)));
    dropLazy('mc2');
  } else if (S.page === 'support') {
    lazySub('tickets', () => query(collection(db, 'tickets'),
      where('uid', '==', uid), limit(30)));
    dropLazy('tickets');
  } else if (S.page === 'transactions') {
    lazySub('orders', () => query(collection(db, 'orders'),
      where('uid', '==', uid), limit(60)));
    lazySub('deposits', () => query(collection(db, 'wallet_deposits'),
      where('uid', '==', uid), limit(40)));
    dropLazy('orders');
  } else {
    dropLazy(null);
  }
}

/* ═══ Navigation ═══ */
window.go = (page, keepCat) => {
  S.page = page;
  if (!keepCat) S.cat = null;
  S.q = '';
  ensurePageData();
  window.scrollTo({ top: 0, behavior: 'instant' });
  render();
  $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === page));

  if (page === 'services' || page === 'orders') loadServices();
  if (page === 'shop' || page === 'plans' || page === 'dashboard') loadCatalog();
  if (page === 'stores' || page === 'store' || page === 'dashboard') loadMerchants();
  if (page === 'mystore') loadMine();
  if (page === 'transactions' || page === 'wallet') subscribeLedger();
};

$$('[data-nav]').forEach(b => b.onclick = () => go(b.dataset.nav));

/* ═══ Render ═══ */
let _raf = null;
function render() {
  if (_raf) return;
  _raf = requestAnimationFrame(() => { _raf = null; paint(); });
}

function paint() {
  if (!S.user) return;

  const av = $('#avatarInitial');
  if (av) av.textContent = (S.profile.name || '؟').trim().charAt(0).toUpperCase();

  paintDock();
  paintBell();

  $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === S.page));

  const view = $('#view');
  if (!view) return;

  const pages = {
    dashboard: vDashboard,
    services: vServices,
    shop: vShop,
    cards: vCards,
    wallet: vWallet,
    transactions: vTransactions,
    orders: vOrders,
    referral: vReferral,
    support: vSupport,
    settings: vSettings,
    plans: vPlans,
    stores: vStores,
    store: vStore,
    mystore: vMyStore,
  };
  if (S.page === 'shop' && !S.config.store_on) S.page = 'stores';

  const html = (pages[S.page] || vDashboard)();
  const samePage = _lastPage === S.page;
  if (samePage && html === _lastHtml) return;                 // لا تغيير → لا إعادة رسم (سبب الرمشة)
  const ae = document.activeElement;
  const focusId = ae && ae.id && view.contains(ae) ? ae.id : null;
  const caret = focusId && typeof ae.selectionStart === 'number' ? ae.selectionStart : null;
  const scrollY = window.scrollY;
  view.innerHTML = samePage ? html.replace('class="page-enter"', 'class=""') : html;   // لا حركة دخول عند التحديث
  _lastPage = S.page; _lastHtml = html;
  bind();
  if (S.page === 'dashboard') bindBanners();
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) { el.focus(); if (caret !== null) { try { el.setSelectionRange(caret, caret); } catch {} } }
  }
  if (samePage) window.scrollTo(0, scrollY);
}
let _lastPage = null, _lastHtml = '';

/* ═══════════════════════════════════════════════════════════
   Dashboard
   ═══════════════════════════════════════════════════════════ */

function vDashboard() {
  const name = S.profile.name || S.user?.displayName || 'صديقي';
  const cards = visibleCards((S.manualCards || []).filter(c => c.status !== 'deleted'));
  const card = cards[0];
  return `
  <div class="page-enter">
    <div class="home-head">
      <div>
        <div class="eyebrow" style="margin-bottom:4px">${esc(greeting())} 👋</div>
        <h1 class="h2 greet" style="margin:0">${esc(name.split(' ')[0])}</h1>
      </div>
      ${S.config.store_on ? `<button class="icon-pill" id="openCart" aria-label="السلة">${svg(I.cart, 2)}${cartCount() ? `<span class="pill-count">${cartCount()}</span>` : ''}</button>` : ''}
    </div>

    ${verifyBannerHtml()}
    ${bannersHtml() || `
      <div class="hero-bn mb-5">
        <span class="hero-orb"></span>
        <h3>${S.config.store_on ? 'اكتشف عالم الخدمات الرقمية' : 'بطاقتك للدفع أونلاين 💳'}</h3>
        <p>${S.config.store_on ? 'اشتراكات وألعاب وبطاقات — بتسليم فوري وبالدينار الليبي' : 'بطاقات فيزا افتراضية بالدينار الليبي — ومتاجر موثوقة في مكان واحد'}</p>
        ${S.config.store_on ? '<button class="btn btn-primary btn-sm" data-scroll="storeSec" style="padding:0 20px">تسوّق الآن</button>' : '<button class="btn btn-primary btn-sm" data-nav="stores" style="padding:0 20px">تصفّح المتاجر</button>'}
      </div>`}

    <div class="flex-between mb-3">
      <div class="h4">بطاقتي</div>
      ${cards.length > 1 ? `<button class="btn btn-ghost btn-sm" data-nav="cards">كل البطاقات (${cards.length}) ${svg(I.back, 2)}</button>` : ''}
    </div>
    ${card ? `<div class="home-card mb-6">${cardMiniHtml(card)}</div>` : `
      <button class="card home-card-cta mb-6" data-action="new-card">
        ${fennec('card', 64)}
        <span style="flex:1;text-align:right"><b style="display:block;margin-bottom:4px">أصدر بطاقتك الأولى</b>
          <span class="caption">بطاقة دولار افتراضية للاشتراكات والشراء أونلاين</span></span>
        <span class="prow-add">+</span>
      </button>`}

    ${S.config.store_on ? `<div id="storeSec">${storeSection(true)}</div>` : merchantsSection()}
  </div>`;
}

function cardMiniHtml(c) {
  const st = { active: 'نشطة', frozen: 'مجمدة', deleted: 'مغلقة' }[c.status] || '—';
  return `
    <button class="service-card" data-card="${esc(c.id)}" style="padding:0;overflow:hidden;border:none;background:transparent">
      <div class="vcard" style="border-radius:0;aspect-ratio:1.586">
        <div class="vcard-top">
          <span class="vcard-brand">KARDO</span>
          <span class="vcard-tier">${esc(st)}</span>
        </div>
        <div class="vcard-chip" style="margin-bottom:12px"></div>
        <div class="vcard-number" style="font-size:14px">•••• •••• •••• ${esc(c.last4 || '0000')}</div>
        <div class="vcard-foot">
          <div class="vcard-field">
            <div class="vcard-label">CARDHOLDER</div>
            <div class="vcard-value" style="font-size:10px">${esc((c.name_on_card || '').slice(0, 16))}</div>
          </div>
          <div class="vcard-field" style="text-align:left">
            <div class="vcard-label">BALANCE</div>
            <div class="vcard-value">${esc(usd(c.balance))}</div>
          </div>
        </div>
      </div>
      <div style="padding:12px;text-align:right">
        <div class="body-sm" style="font-weight:600">${esc(c.card_name || 'بطاقة')}</div>
        <div class="caption">${esc(dt(c.created_at))}</div>
      </div>
    </button>
  `;
}

function txRow(t) {
  const kind = t.kind || (t.service_id ? 'service' : 'order');
  const isSvc = kind === 'service';
  const isIn = kind === 'deposit';

  const labels = {
    order: (t.items && t.items[0] && t.items[0].name) || 'طلب',
    service: t.service_name || 'خدمة رقمية',
    deposit: 'إيداع رصيد',
    card_create: 'إصدار بطاقة',
    card_topup: 'شحن بطاقة',
  };

  const amount = isSvc ? n(t.price_usd) : (t.total_lyd || t.amount_lyd || t.total_usd || 0);
  const sign = isIn ? '+' : '−';
  const displayAmount = isSvc ? usd(amount) : lyd(amount);

  return `
    <div class="list-row" style="cursor:default">
      <div class="list-icon ${isIn ? 'success' : isSvc ? 'brand' : ''}">
        ${svg(isIn ? I.up : isSvc ? I.box : I.bag, 2)}
      </div>
      <div class="list-content">
        <div class="list-title">${esc(labels[kind] || 'عملية')}</div>
        <div class="list-meta">${esc(dt(t.created_at))}</div>
      </div>
      <div class="list-end">
        <div class="list-amount ${isIn ? 'credit' : ''}">${sign}${esc(displayAmount)}</div>
      </div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   Digital Services
   ═══════════════════════════════════════════════════════════ */

function vServices() {
  const services = S.services || [];
  const myOrders = S.svcOrders || [];
  const pending = myOrders.filter(o => o.status === 'pending');
  const delivered = myOrders.filter(o => o.status === 'delivered');
  const rejected = myOrders.filter(o => o.status === 'rejected');

  return `
  <div class="page-enter">
    <div class="mb-6">
      <h1 class="h2" style="margin-bottom:6px">الخدمات الرقمية</h1>
      <p class="body-sm text-2">اشترِ الأكواد والحسابات فوراً</p>
    </div>

    ${pending.length ? `
      <div class="mb-6">
        <div class="h4" style="margin-bottom:12px">⏳ قيد التنفيذ (${pending.length})</div>
        <div class="list">
          ${pending.map(o => svcOrderRow(o, false)).join('')}
        </div>
      </div>
    ` : ''}

    ${delivered.length ? `
      <div class="mb-6">
        <div class="flex-between mb-3">
          <div class="h4">✅ طلباتك المُسلَّمة (${delivered.length})</div>
        </div>
        <div class="list">
          ${delivered.slice(0, 3).map(o => svcOrderRow(o, true)).join('')}
        </div>
      </div>
    ` : ''}

    ${rejected.length ? `
      <div class="mb-6">
        <div class="h4" style="margin-bottom:12px;color:var(--text-3)">مرفوضة (${rejected.length})</div>
        <div class="list">
          ${rejected.slice(0, 2).map(o => svcOrderRow(o, false)).join('')}
        </div>
      </div>
    ` : ''}

    <div class="flex-between mb-4">
      <div class="h4">${(pending.length || delivered.length) ? 'اطلب المزيد' : 'الخدمات المتاحة'}</div>
      <button class="btn btn-ghost btn-sm" id="reloadSvcs" title="تحديث">
        ${svg(I.list, 2)} تحديث
      </button>
    </div>

    ${services.length ? `
      <div class="grid-2">
        ${services.map(s => svcCard(s)).join('')}
      </div>
    ` : `
      <div class="card" style="text-align:center;padding:48px 24px">
        <div class="empty-icon" style="margin:0 auto 16px">${svg(I.box, 2)}</div>
        <div class="h4" style="margin-bottom:8px">لا خدمات متاحة حالياً</div>
        <p class="body-sm text-2" style="margin-bottom:20px">سيتم عرض الخدمات هنا فور إضافتها.</p>
        <button class="btn btn-secondary" id="reloadSvcs2">تحديث</button>
      </div>
    `}
  </div>
  `;
}

function svcCard(s) {
  const isAuto = s.delivery_type === 'auto';
  const badge = isAuto ? 'فوري' : 'يدوي';
  const badgeCls = isAuto ? 'badge-success' : 'badge-info';
  const stock = s.in_stock;
  const outOfStock = isAuto && stock === false;
  const iconUrl = safeIconUrl(s.icon_url);

  return `
    <button class="service-card" data-buy-svc="${esc(s.id)}" style="position:relative">
      <div style="display:flex;gap:12px;align-items:center;width:100%">
        <div class="svc-icon">
          ${iconUrl
            ? `<img src="${esc(iconUrl)}" alt="">`
            : `<span>${esc(s.icon_emoji || '📦')}</span>`}
        </div>
        <div style="flex:1;min-width:0;text-align:right">
          <div class="service-name">${esc(s.name)}</div>
          <div class="service-desc">${esc((s.desc || '').slice(0, 50))}</div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;width:100%;margin-top:8px">
        <div class="service-price">${usd(s.price_usd)}</div>
        <span class="badge ${badgeCls}" style="font-size:10px">${badge}</span>
      </div>
      ${outOfStock ? `
        <span class="badge badge-error" style="position:absolute;top:10px;left:10px;font-size:10px">نفد</span>
      ` : ''}
    </button>
  `;
}

function svcOrderRow(o, delivered) {
  const st = o.status;
  const label = { pending: 'قيد التنفيذ', delivered: 'تم التسليم', rejected: 'مرفوض' }[st] || st;
  const cls = { pending: 'badge-warning', delivered: 'badge-success', rejected: 'badge-error' }[st];

  return `
    <div class="list-row" data-svc-order="${esc(o.id)}">
      <div class="list-icon ${delivered ? 'success' : ''}">
        ${svg(delivered ? I.check : I.clock, 2)}
      </div>
      <div class="list-content">
        <div class="list-title">${esc(o.service_name || 'خدمة')}</div>
        <div class="list-meta">${esc(dt(o.created_at))}</div>
      </div>
      <div class="list-end">
        <div class="list-amount">${esc(usd(o.price_usd))}</div>
        <span class="badge ${cls}" style="margin-top:4px;font-size:10px">${esc(label)}</span>
      </div>
    </div>
  `;
                }

/* ═══════════════════════════════════════════════════════════
   Service Order Detail
   ═══════════════════════════════════════════════════════════ */

function openServiceOrderDetail(orderId) {
  const o = (S.svcOrders || []).find(x => x.id === orderId);
  if (!o) return;

  const isDelivered = o.status === 'delivered';
  const isRejected = o.status === 'rejected';
  const isExpired = o.delivered_expires_at && new Date(o.delivered_expires_at) < new Date();

  modal(`
    <div class="modal-head">
      <div class="modal-title">${esc(o.service_name || 'خدمة')}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>

    <div class="card card-sm mb-4" style="background:var(--surface-2);border:none">
      <div class="flex-between" style="padding:4px 0">
        <span class="caption">رقم الطلب</span>
        <span class="mono" style="font-size:11px">${esc(o.id)}</span>
      </div>
      <div class="flex-between" style="padding:4px 0">
        <span class="caption">التاريخ</span>
        <span class="body-sm">${esc(dt(o.created_at))}</span>
      </div>
      <div class="flex-between" style="padding:4px 0">
        <span class="caption">السعر</span>
        <span class="tabular" style="font-weight:700">${esc(usd(o.price_usd))}</span>
      </div>
      <div class="flex-between" style="padding:4px 0">
        <span class="caption">الحالة</span>
        <span class="badge ${isDelivered ? 'badge-success' : isRejected ? 'badge-error' : 'badge-warning'}">
          ${isDelivered ? 'تم التسليم' : isRejected ? 'مرفوض' : 'قيد التنفيذ'}
        </span>
      </div>
    </div>

    ${o.inputs && Object.keys(o.inputs).length ? `
      <div class="field-label mb-2">بيانات الطلب</div>
      <div class="card card-sm mb-4" style="background:var(--surface-2);border:none">
        ${Object.entries(o.inputs).map(([k, v]) => `
          <div class="flex-between" style="padding:4px 0">
            <span class="caption">${esc(k)}</span>
            <span class="mono body-sm" dir="ltr">${esc(v)}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${isDelivered && !isExpired ? `
      <div class="field-label mb-2">البيانات المُسلَّمة</div>
      <div class="copy-box mb-4" style="text-align:center;padding:20px">
        <div class="mono" style="font-size:13px;word-break:break-all;line-height:1.7;white-space:pre-wrap;color:var(--sand)">${esc(o.delivered_data || '')}</div>
      </div>
    ` : ''}

    ${isDelivered && isExpired ? `
      <div class="alert alert-warning mb-4">
        ${svg(I.clock, 2)}
        <div><strong>انتهت صلاحية العرض</strong><br>البيانات محذوفة للأمان — تواصل مع الدعم</div>
      </div>
    ` : ''}

    ${isRejected ? `
      <div class="alert alert-error mb-4">
        ${svg(I.x, 2)}
        <div><strong>تم رفض الطلب</strong><br>${esc(o.rejected_reason || 'بدون سبب')}</div>
      </div>
    ` : ''}

    ${!isDelivered && !isRejected ? `
      <div class="alert alert-info mb-4">
        ${svg(I.clock, 2)}
        <div>طلبك قيد التنفيذ — سيتم تسليمه قريباً</div>
      </div>
    ` : ''}

    <button class="btn btn-secondary btn-block" data-act="close-modal">إغلاق</button>
  `);

  if (isDelivered && !isExpired) {
    onTap('#copyDelivered', async () => {
      try {
        await navigator.clipboard.writeText(o.delivered_data || '');
        toast('نُسخ', 'ok');
      } catch { toast('تعذّر النسخ', 'bad'); }
    });
  }
}
window.openServiceOrderDetail = openServiceOrderDetail;

/* ═══════════════════════════════════════════════════════════
   Service Buy
   ═══════════════════════════════════════════════════════════ */

async function openServiceBuy(svcId) {
  const svc = (S.services || []).find(x => x.id === svcId);
  if (!svc) return;

  const price = n(svc.price_usd);
  const balance = n(S.profile.wallet_balance);
  const canBuy = balance >= price;
  const fields = Array.isArray(svc.fields) ? svc.fields : [];
  const iconUrl = safeIconUrl(svc.icon_url);

  modal(`
    <div class="modal-head">
      <div class="modal-title">${esc(svc.name)}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>

    <div class="card card-sm mb-4" style="background:var(--surface-2);border:none;text-align:center;padding:24px">
      <div class="svc-icon-lg">
        ${iconUrl
          ? `<img src="${esc(iconUrl)}" alt="">`
          : `<span>${esc(svc.icon_emoji || '📦')}</span>`}
      </div>
      <div class="h4" style="margin:12px 0 4px">${esc(svc.name)}</div>
      ${svc.desc ? `<div class="body-sm text-2">${esc(svc.desc)}</div>` : ''}
      <div class="editorial-number" style="font-size:32px;color:var(--sand);margin-top:16px">${esc(usd(svc.price_usd))}</div>
    </div>

    ${fields.length ? `
      <div class="field-label mb-3">أدخل البيانات المطلوبة</div>
      ${fields.map((f, i) => renderField(f, i)).join('')}
    ` : ''}

    <div class="card card-sm mb-4" style="background:${canBuy ? 'rgba(95,184,138,0.08)' : 'rgba(200,75,49,0.08)'};border:1px solid ${canBuy ? 'rgba(95,184,138,0.2)' : 'rgba(200,75,49,0.2)'}">
      <div class="flex-between">
        <span class="body-sm" style="color:var(--text-2)">رصيدك:</span>
        <span class="tabular" style="font-weight:700;color:${canBuy ? 'var(--sand)' : 'var(--error)'}">${esc(usd(balance))}</span>
      </div>
      ${!canBuy ? `
        <div class="caption" style="color:var(--error);margin-top:6px">
          رصيدك غير كافٍ — ينقصك ${esc(usd(price - balance))}
        </div>
      ` : ''}
    </div>

    <button class="btn btn-primary btn-block" id="svcBuyBtn" ${!canBuy ? 'disabled' : ''}>
      ${canBuy ? `${svg(I.check, 2)} تأكيد الشراء — ${esc(usd(price))}` : 'رصيد غير كافٍ'}
    </button>
  `);

  const svcIdemKey = newIdemKey();
  onTap('#svcBuyBtn', async () => {
    const inputs = {};
    for (let i = 0; i < fields.length; i++) {
      const el = $('#svcField' + i);
      if (!el) continue;
      const v = String(el.value || '').trim();
      const f = fields[i];
      if (f.required && !v) return toast(`${f.label} مطلوب`, 'bad');
      inputs[f.key] = v;
    }

    const btn = $('#svcBuyBtn');
    btn.disabled = true;
    btn.classList.add('loading');

    try {
      const r = await api('/api/service/create-order', {
        service_id: svcId,
        inputs,
        idempotency_key: svcIdemKey,
      });

      const ord = r.order || {};

      if (ord.delivery_type === 'auto' && ord.delivered_data) {
        modal(`
          <div class="modal-head">
            <div class="modal-title">✅ تم الشراء</div>
            <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
          </div>

          <div class="alert alert-success mb-4">
            ${svg(I.check, 2)}
            <div><strong>تم التسليم الفوري!</strong></div>
          </div>

          <div class="field-label mb-2">بيانات الخدمة</div>
          <div class="copy-box mb-4" style="text-align:center;padding:20px">
            <div class="mono" style="font-size:13px;word-break:break-all;line-height:1.7;white-space:pre-wrap;color:var(--sand)">${esc(ord.delivered_data)}</div>
          </div>

          <button class="btn btn-secondary btn-block" id="copySvcCode">${svg(I.copy, 2)} نسخ</button>
          <button class="btn btn-ghost btn-block" style="margin-top:8px" data-act="close-modal">إغلاق</button>
        `);

        try {
          await navigator.clipboard.writeText(ord.delivered_data);
          toast('نُسخ تلقائياً', 'ok');
        } catch {}

        onTap('#copySvcCode', async () => {
          try {
            await navigator.clipboard.writeText(ord.delivered_data);
            toast('نُسخ', 'ok');
          } catch { toast('تعذّر النسخ', 'bad'); }
        });
      } else {
        closeModal();
        toast('طلبك قيد التنفيذ — سيصلك قريباً', 'ok');
      }
    } catch (e) {
      toast(e.message, 'bad');
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });
}
window.openServiceBuy = openServiceBuy;

function renderField(f, i) {
  const id = 'svcField' + i;
  const label = `${esc(f.label)}${f.required ? ' *' : ''}`;

  if (f.type === 'select') {
    return `
      <div class="field mb-3">
        <label class="field-label">${label}</label>
        <select class="input" id="${id}">
          <option value="">— اختر —</option>
          ${(f.options || []).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
        </select>
      </div>
    `;
  }
  if (f.type === 'textarea') {
    return `
      <div class="field mb-3">
        <label class="field-label">${label}</label>
        <textarea class="input" id="${id}" rows="3" placeholder="${esc(f.placeholder || '')}"></textarea>
      </div>
    `;
  }
  return `
    <div class="field mb-3">
      <label class="field-label">${label}</label>
      <input class="input" id="${id}" type="${esc(f.type || 'text')}" placeholder="${esc(f.placeholder || '')}" dir="${['password', 'tel'].includes(f.type) ? 'ltr' : 'auto'}" ${f.type === 'password' ? 'autocomplete="new-password"' : ''}>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   Shop
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   Cards
   ═══════════════════════════════════════════════════════════ */

function vCards() {
  const allC = (S.manualCards || []).filter(c => c.status !== 'deleted');
  const openIds = new Set(visibleCards(allC).map(c => c.id));
  const shown = allC;
  const hidden = hiddenCardsCount();
  const active = shown.filter(c => c.status === 'active');

  return `
  <div class="page-enter">
    <div class="flex-between mb-6">
      <div>
        <h1 class="h2" style="margin-bottom:6px">بطاقاتي</h1>
        <p class="body-sm text-2">${active.length} بطاقة نشطة · باقة ${esc(PLAN_AR[myPlan()])}: ${isUnlimited() ? 'بلا حدود' : `${cardsUsed()} من ${cardLimit()}${myPlan() === 'free' ? '' : ' هذا الشهر'}`}
          <button class="btn btn-ghost btn-sm" data-nav="plans" style="padding:0 6px">${myPlan() === 'free' ? 'اشترك' : 'الباقات'}</button></p>
      </div>
      <button class="btn btn-primary btn-sm" data-action="newCard">
        ${svg(I.plus, 2)} إصدار بطاقة
      </button>
    </div>

    ${cardWarningHtml()}
    ${hidden ? `
      <button class="hidden-cards mb-4" data-nav="plans">
        <span>🔒</span><span style="flex:1;text-align:right"><b>${hidden} ${hidden === 1 ? 'بطاقة مقفلة' : 'بطاقات مقفلة'}</b>
        <span class="caption" style="display:block">انتهت باقتك — جدّدها لفتح بطاقاتك الإضافية. بطاقتك الأولى تبقى شغّالة دائمًا.</span></span><span class="prow-add">↻</span>
      </button>` : ''}
    ${shown.length ? `
      <div class="grid-2">
        ${shown.map(c => `
          ${openIds.has(c.id) ? `
          <button class="service-card" data-card="${esc(c.id)}" style="padding:0;overflow:hidden">
            ${renderCard(c)}
            <div style="padding:14px;text-align:right;width:100%">
              <div class="body" style="font-weight:600;margin-bottom:4px">${esc(c.card_name || 'بطاقة')}</div>
              <div class="caption">الرصيد ${esc(usd(c.balance))}${c.balance_updated_at ? ' · حُدّث ' + esc(dt(c.balance_updated_at)) : ''}</div>
            </div>
          </button>` : `
          <button class="service-card" data-nav="plans" style="padding:0;overflow:hidden;position:relative">
            <div class="card-locked">${renderCard(c)}</div>
            <div class="card-lock-badge">🔒 مقفلة — جدّد باقتك</div>
            <div style="padding:14px;text-align:right;width:100%">
              <div class="body" style="font-weight:600;margin-bottom:4px">${esc(c.card_name || 'بطاقة')}</div>
              <div class="caption">اضغط لتجديد الباقة</div>
            </div>
          </button>`}
        `).join('')}
      </div>
    ` : `
      <div class="card" style="text-align:center;padding:48px 24px">
        ${fennec('card', 130)}
        <div class="h4" style="margin-bottom:8px">لا بطاقات بعد</div>
        <p class="body-sm text-2" style="margin-bottom:24px;max-width:320px;margin-inline:auto">
          أصدر بطاقتك الافتراضية الأولى واستخدمها للدفع في أي موقع.
        </p>
        <button class="btn btn-primary" data-action="newCard">
          ${svg(I.plus, 2)} إصدار بطاقة
        </button>
      </div>
    `}
  </div>
  `;
}

function renderCard(c) {
  const st = { active: 'نشطة', frozen: 'مجمدة', deleted: 'مغلقة' }[c.status] || '—';
  const cls = c.status === 'frozen' ? 'frozen' : c.status === 'deleted' ? 'blocked' : '';
  return `
    <div class="vcard ${cls}" style="border-radius:0;aspect-ratio:1.586">
      <div class="vcard-top">
        <span class="vcard-brand">KARDO</span>
        <span class="vcard-tier">${esc(st)}</span>
      </div>
      <div class="vcard-chip"></div>
      <div class="vcard-number">•••• •••• •••• ${esc(c.last4 || '0000')}</div>
      <div class="vcard-foot">
        <div class="vcard-field">
          <div class="vcard-label">VALID THRU</div>
          <div class="vcard-value">${esc(c.expiry || '••/••')}</div>
        </div>
        <div class="vcard-field">
          <div class="vcard-label">CARDHOLDER</div>
          <div class="vcard-value">${esc((c.name_on_card || '').slice(0, 18))}</div>
        </div>
        <svg class="vcard-brand-logo" viewBox="0 0 48 32" fill="currentColor" opacity=".85">
          <circle cx="16" cy="16" r="10" opacity=".9"/>
          <circle cx="32" cy="16" r="10" opacity=".6"/>
        </svg>
      </div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   Wallet
   ═══════════════════════════════════════════════════════════ */

function vWallet() {
  return `
  <div class="page-enter">
    <div class="mb-6">
      <h1 class="h2" style="margin-bottom:6px">المحفظة</h1>
    </div>

    <div class="balance-card" style="margin-bottom:24px">
      <div class="balance-label">الرصيد المتاح</div>
      <div class="balance-value">${lyd(S.profile.wallet_balance * rate())}</div>
      <div class="balance-secondary">${usd(S.profile.wallet_balance)}</div>

      <div class="balance-actions">
        <button class="balance-action" data-action="deposit">
          <span class="icon">${svg(I.up, 2)}</span>
          <span>إيداع</span>
        </button>
        <button class="balance-action" data-action="transfer">
          <span class="icon">${svg(I.swap, 2)}</span>
          <span>تحويل</span>
        </button>
        <button class="balance-action" data-action="withdraw">
          <span class="icon">${svg(I.down, 2)}</span>
          <span>سحب</span>
        </button>
      </div>
    </div>

    <div class="mb-4">
      <div class="h4">طرق الإيداع</div>
    </div>

    <div class="list mb-6">
      <div class="list-row" data-method="libyana">
        <div class="list-icon brand">${svg(I.up, 2)}</div>
        <div class="list-content">
          <div class="list-title">ليبيانا</div>
          <div class="list-meta">تحويل فوري عبر رسائل SMS</div>
        </div>
        <div class="list-end">${svg(I.back, 2)}</div>
      </div>
      <div class="list-row" data-method="almadar">
        <div class="list-icon brand">${svg(I.up, 2)}</div>
        <div class="list-content">
          <div class="list-title">المدار</div>
          <div class="list-meta">تحويل فوري عبر رسائل SMS</div>
        </div>
        <div class="list-end">${svg(I.back, 2)}</div>
      </div>
    </div>

    <div class="mb-4">
      <div class="h4">آخر الإيداعات</div>
    </div>

    ${S.deposits.length ? `
      <div class="list">
        ${S.deposits.slice(0, 10).map(d => `
          <div class="list-row" style="cursor:default">
            <div class="list-icon ${d.status === 'approved' ? 'success' : ''}">${svg(I.up, 2)}</div>
            <div class="list-content">
              <div class="list-title">${esc(usd(d.amount_usd))}</div>
              <div class="list-meta">${esc(d.method || '—')} · ${esc(dt(d.created_at))}</div>
            </div>
            <div class="list-end">
              <span class="badge ${d.status === 'approved' ? 'badge-success' : d.status === 'pending' ? 'badge-warning' : 'badge-error'}">
                ${d.status === 'approved' ? 'مقبول' : d.status === 'pending' ? 'قيد المراجعة' : 'مرفوض'}
              </span>
            </div>
          </div>
        `).join('')}
      </div>
    ` : `
      <div class="card" style="text-align:center;padding:32px 20px">
        <div class="empty-icon" style="margin:0 auto 16px">${svg(I.wallet, 2)}</div>
        <div class="h4" style="margin-bottom:8px">لا إيداعات بعد</div>
        <p class="body-sm text-2">أضف رصيدًا لتبدأ استخدام الخدمات.</p>
      </div>
    `}
  </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   Transactions
   ═══════════════════════════════════════════════════════════ */

const REASON_AR = { deposit_approved: 'إيداع معتمد', deposit_claim: 'إيداع', sms_deposit: 'إيداع', sms_manual: 'إيداع',
  usdt_deposit: 'إيداع USDT', phone_verification_deposit: 'حوالة توثيق الرقم', admin_adjust: 'تعديل من الإدارة', opening_balance_migration: 'الرصيد الافتتاحي',
  service_order: 'شراء خدمة', service_order_rejected: 'استرداد خدمة', store_order: 'شراء من المتجر', order_rejected: 'استرداد طلب',
  card_create: 'إصدار بطاقة', card_topup: 'شحن بطاقة', card_rejected_refund: 'استرداد طلب بطاقة', withdraw_request: 'سحب',
  withdraw_rejected: 'استرداد سحب', transfer_out: 'تحويل صادر', transfer_in: 'تحويل وارد', points_redeem: 'استبدال نقاط',
  referral_bonus_invitee: 'مكافأة دعوة', referral_bonus_inviter: 'مكافأة دعوة', plan_basic: 'باقة الأساسي', plan_vip: 'باقة VIP' };
function subscribeLedger() {
  if (S._ledgerSub || !S.user) return;
  S._ledgerSub = true;
  S.unsub.push(onSnapshot(query(collection(db, 'wallet_transactions'), where('uid', '==', S.user.uid), limit(80)), s => {
    S.ledger = s.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.seq || 0) - (a.seq || 0) || String(b.created_at).localeCompare(String(a.created_at)));
    render();
  }, e => { S._ledgerSub = false; console.warn('ledger:', e.code); }));
}
function ledgerRow(t) {
  const inc = t.type === 'credit';
  return `
    <div class="list-row" style="cursor:default">
      <div class="list-icon ${inc ? 'success' : 'error'}">${svg(inc ? I.down : I.up, 2)}</div>
      <div class="list-content">
        <div class="list-title">${esc(REASON_AR[t.reason] || 'عملية')}</div>
        <div class="list-meta">${esc(dt(t.created_at))}${t.note ? ' · ' + esc(t.note) : ''}</div>
      </div>
      <div class="list-end">
        <div class="list-amount ${inc ? 'success' : 'error'}" dir="ltr">${inc ? '+' : '−'}${esc(usd(t.amount))}</div>
        <div class="caption tabular" style="margin-top:2px">الرصيد ${esc(usd(t.balance_after))}</div>
      </div>
    </div>`;
}
function vTransactions() {
  const rows = S.ledger || [];
  return `
  <div class="page-enter">
    <div class="mb-5"><h1 class="h2" style="margin-bottom:6px">المعاملات</h1>
      <p class="body-sm text-2">كل حركة على رصيدك، بدقة</p></div>
    ${!S.ledger ? `<div class="list">${'<div class="skeleton" style="height:66px;border-radius:16px"></div>'.repeat(4)}</div>`
      : rows.length ? `<div class="list">${rows.map(ledgerRow).join('')}</div>` : `
      <div class="card" style="text-align:center;padding:44px 20px">
        <div class="empty-icon" style="margin:0 auto 14px">${svg(I.list, 2)}</div>
        <div class="h4" style="margin-bottom:6px">لا حركات بعد</div>
        <p class="body-sm text-2">ستظهر هنا كل عملية إيداع وشراء.</p></div>`}
  </div>`;
}

function vOrders() {
  const ST = { pending: ['badge-warning', 'قيد التنفيذ'], processing: ['badge-warning', 'قيد التنفيذ'], completed: ['badge-success', 'مكتمل'], delivered: ['badge-success', 'تم التسليم'], rejected: ['badge-error', 'مرفوض'] };
  const toT = v => (v && v.toDate ? v.toDate() : new Date(v || 0)).getTime();
  const rows = [
    ...(S.orders || []).map(o => ({ t: toT(o.created_at), html: `
      <div class="list-row" data-order="${esc(o.id)}">
        <div class="list-icon brand">${(o.items && o.items[0] && o.items[0].image) ? `<img src="${esc(o.items[0].image)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px">` : svg(I.bag, 2)}</div>
        <div class="list-content">
          <div class="list-title">${esc((o.items || []).map(i => i.name).join('، ') || 'طلب')}</div>
          <div class="list-meta">${esc(dt(o.created_at))}</div>
        </div>
        <div class="list-end"><div class="list-amount">${esc(lyd(o.total_lyd))}</div>
          <span class="badge ${(ST[o.status] || ['badge', o.status])[0]}" style="margin-top:4px;font-size:10px">${esc((ST[o.status] || ['', o.status])[1])}</span></div>
      </div>` })),
    ...(S.svcOrders || []).map(o => ({ t: toT(o.created_at), html: svcOrderRow(o, o.status === 'delivered') })),
    ...(S.mOrders || []).map(o => ({ t: toT(o.created_at), html: mOrderRow(o, false) })),
  ].sort((a, b) => b.t - a.t);
  return `
  <div class="page-enter">
    <div class="mb-5"><h1 class="h2" style="margin-bottom:6px">طلباتي</h1>
      <p class="body-sm text-2">كل طلباتك من المتاجر في مكان واحد</p></div>
    ${(S.mCases || []).length ? `<div class="h4 mb-2">⚑ بلاغاتي</div><div class="list mb-4">${(S.mCases || []).map(r => `
      <div class="list-row" data-mcase="${esc(r.id)}" role="button" tabindex="0"><div class="list-icon brand">⚑</div>
        <div class="list-content"><div class="list-title">${esc(r.merchant_name)} — ${esc(r.reason)}</div><div class="list-meta">${esc(dt(r.updated_at || r.created_at))}</div></div>
        <div class="list-end"><span class="badge ${r.status === 'open' ? 'badge-warning' : 'badge-success'}">${r.status === 'open' ? 'مفتوح' : 'محلول'}</span></div></div>`).join('')}</div>` : ''}
    ${rows.length ? `<div class="list">${rows.map(r => r.html).join('')}</div>` : `
      <div class="card" style="text-align:center;padding:44px 20px">
        ${fennec('empty', 130)}
        <div class="h4" style="margin-bottom:6px">لا طلبات بعد</div>
        <p class="body-sm text-2 mb-4">اطلب أول خدمة من المتاجر الموثوقة وستظهر هنا</p>
        <button class="btn btn-primary btn-sm" data-nav="stores" style="padding:0 20px">تصفّح المتاجر</button>
      </div>`}
  </div>`;
}

function vReferral() {
  const r = S.config.referral || {};
  if (!r.on) {
    return `
    <div class="page-enter">
      <div class="mb-6">
        <h1 class="h2">ادعُ صديقًا</h1>
      </div>
      <div class="card" style="text-align:center;padding:48px 24px">
        <div class="empty-icon" style="margin:0 auto 16px">${svg(I.gift, 2)}</div>
        <div class="h4" style="margin-bottom:8px">غير متاح حاليًا</div>
        <p class="body-sm text-2">سنفعّل نظام الدعوات قريبًا.</p>
      </div>
    </div>`;
  }

  return `
  <div class="page-enter">
    <div class="mb-6">
      <h1 class="h2" style="margin-bottom:6px">ادعُ صديقًا</h1>
      <p class="body-sm text-2">شارك رمزك — تحصلان معًا على مكافأة.</p>
    </div>

    <div class="card" style="margin-bottom:20px">
      <div class="field-label">رمز الدعوة</div>
      <div class="copy-box" style="margin-bottom:16px">
        <div class="copy-value" id="refCode">— • — • — • —</div>
        <button class="copy-btn" id="refCopy" aria-label="نسخ">${svg(I.copy, 2)}</button>
      </div>
      <div class="body-sm text-2">
        احصل على ${usd(r.inviter || 1)} لكل صديق ينضم برمزك.
      </div>
    </div>

    <div class="card">
      <div class="h4" style="margin-bottom:16px">كيف تعمل؟</div>
      <div class="stack">
        <div style="display:flex;gap:12px;align-items:flex-start">
          <span class="badge badge-neutral" style="flex-shrink:0">01</span>
          <div class="body-sm text-2">شارك رمزك مع أصدقائك</div>
        </div>
        <div style="display:flex;gap:12px;align-items:flex-start">
          <span class="badge badge-neutral" style="flex-shrink:0">02</span>
          <div class="body-sm text-2">يسجّل صديقك ويستخدم رمزك</div>
        </div>
        <div style="display:flex;gap:12px;align-items:flex-start">
          <span class="badge badge-neutral" style="flex-shrink:0">03</span>
          <div class="body-sm text-2">ينفّذ أول عملية</div>
        </div>
        <div style="display:flex;gap:12px;align-items:flex-start">
          <span class="badge badge-neutral" style="flex-shrink:0">04</span>
          <div class="body-sm text-2">تحصلان على المكافأة</div>
        </div>
      </div>
    </div>
  </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   Support
   ═══════════════════════════════════════════════════════════ */

function vSupport() {
  return `
  <div class="page-enter">
    <div class="flex-between mb-6">
      <div>
        <h1 class="h2" style="margin-bottom:6px">الدعم</h1>
        <p class="body-sm text-2">كيف يمكننا مساعدتك؟</p>
      </div>
      <button class="btn btn-primary btn-sm" id="newTicket">
        ${svg(I.plus, 2)} تذكرة
      </button>
    </div>

    <div class="grid-2 mb-6">
      <button class="service-card" style="padding:16px">
        <div class="svc-icon" style="width:40px;height:40px">${svg(I.card, 2)}</div>
        <div class="service-name" style="font-size:13px">البطاقات</div>
        <div class="service-desc" style="font-size:11px">مشاكل الإصدار</div>
      </button>
      <button class="service-card" style="padding:16px">
        <div class="svc-icon" style="width:40px;height:40px">${svg(I.wallet, 2)}</div>
        <div class="service-name" style="font-size:13px">المحفظة</div>
        <div class="service-desc" style="font-size:11px">الإيداع والسحب</div>
      </button>
      <button class="service-card" style="padding:16px">
        <div class="svc-icon" style="width:40px;height:40px">${svg(I.shield, 2)}</div>
        <div class="service-name" style="font-size:13px">الأمان</div>
        <div class="service-desc" style="font-size:11px">حماية الحساب</div>
      </button>
      <button class="service-card" style="padding:16px">
        <div class="svc-icon" style="width:40px;height:40px">${svg(I.help, 2)}</div>
        <div class="service-name" style="font-size:13px">أخرى</div>
        <div class="service-desc" style="font-size:11px">استفسارات</div>
      </button>
    </div>

    <div class="mb-4">
      <div class="h4">تذاكري</div>
    </div>

    ${S.tickets.length ? `
      <div class="list">
        ${S.tickets.map(t => `
          <div class="list-row" data-ticket="${esc(t.id)}" role="button" tabindex="0">
            <div class="list-icon">${svg(I.help, 2)}</div>
            <div class="list-content">
              <div class="list-title">${esc(t.subject)}</div>
              <div class="list-meta">${esc(dt(t.updated_at))}</div>
            </div>
            <div class="list-end">
              <span class="badge ${t.status === 'open' ? 'badge-warning' : t.status === 'answered' ? 'badge-success' : 'badge-neutral'}">
                ${t.status === 'open' ? 'مفتوحة' : t.status === 'answered' ? 'تم الرد' : 'مغلقة'}
              </span>
            </div>
          </div>
        `).join('')}
      </div>
    ` : `
      <div class="card" style="text-align:center;padding:32px 20px">
        <div class="empty-icon" style="margin:0 auto 16px">${svg(I.help, 2)}</div>
        <p class="body-sm text-2">لا تذاكر بعد</p>
      </div>
    `}
  </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   Settings
   ═══════════════════════════════════════════════════════════ */

function vSettings() {
  const nm = S.profile.name || 'مستخدم';

  return `
  <div class="page-enter">
    <div class="mb-6">
      <h1 class="h2" style="margin-bottom:6px">الإعدادات</h1>
    </div>

    <div class="card card-lg mb-5">
      <div style="display:flex;gap:16px;align-items:center">
        <div style="width:56px;height:56px;border-radius:14px;background:var(--brand-light);color:var(--brand);display:grid;place-items:center;font-size:22px;font-weight:700">
          ${esc(nm.charAt(0).toUpperCase())}
        </div>
        <div style="flex:1;min-width:0">
          <div class="h4" style="margin-bottom:4px">${esc(nm)}</div>
          <div class="caption" dir="ltr">${esc(S.profile.email || S.user?.email || '')}</div>
        </div>
      </div>
    </div>

    <div class="quick-links mb-5">
      ${[['wallet', I.wallet || I.up, 'المحفظة'], ['transactions', I.list, 'المعاملات'], ['plans', I.box, 'الباقات'], ['support', I.help, 'الدعم'], ['referral', I.swap, 'ادعُ صديقًا']]
        .map(([pg, ic, t]) => `<button class="ql" data-nav="${pg}"><span class="ql-ic">${svg(ic, 2)}</span><span>${t}</span></button>`).join('')}
    </div>
    ${pushOn() ? '' : `<button class="btn btn-secondary btn-block mb-3" id="pushOn" type="button">🔔 تفعيل إشعارات الهاتف</button>`}
    ${S.profile.merchant_id ? `<button class="btn btn-primary btn-block mb-4" data-nav="mystore">🏪 لوحة متجري</button>` : `<button class="btn btn-secondary btn-block mb-4" id="joinMerchant" type="button">🏪 افتح متجرك في كاردو</button>`}
    <div class="legal-links mb-5"><a href="./terms.html" target="_blank" rel="noopener">الشروط والأحكام</a> · <a href="./terms.html#privacy" target="_blank" rel="noopener">سياسة الخصوصية</a></div>

    <div class="card mb-5">
      <div class="h4" style="margin-bottom:16px">المعلومات الشخصية</div>
      <div class="field mb-3">
        <label class="field-label">الاسم</label>
        <input class="input" id="pName" value="${esc(S.profile.name || '')}">
      </div>
      <div class="field mb-3">
        <label class="field-label">البريد الإلكتروني</label>
        <input class="input" value="${esc(S.profile.email || S.user?.email || '')}" disabled>
      </div>
      <div class="field mb-4">
        <label class="field-label">رقم الهاتف</label>
        ${S.profile.phone_verified
          ? `<div class="input" dir="ltr" aria-readonly="true">0${esc(S.profile.phone_verified)} ✓</div>`
          : `<button class="btn btn-secondary btn-block" id="verifyPhoneBtn" type="button">توثيق رقم الهاتف</button>
             <div class="caption" style="margin-top:6px">مطلوب للإيداع عبر ليبيانا والمدار</div>`}
      </div>
      <button class="btn btn-primary" id="saveProfile">حفظ التغييرات</button>
    </div>

    <div class="card mb-5">
      <div class="h4" style="margin-bottom:8px">الإشعارات</div>
      <label style="display:flex;justify-content:space-between;align-items:center;gap:12px;cursor:pointer">
        <span class="body-sm">إشعارات البريد (إصدار البطاقة، الإيداع، الطلبات، السحب)</span>
        <input type="checkbox" id="notifyEmail" ${S.profile.notify_email === false ? '' : 'checked'} style="width:20px;height:20px">
      </label>
      <p class="caption" style="margin-top:6px">تصل إلى ${esc(S.profile.email || S.user?.email || '')}${S.profile.email_verified ? ' ✓ مؤكَّد' : ''}. البريد لا يحتوي أبدًا على بيانات بطاقة أو أكواد.</p>
      ${needsEmailVerify() ? '<button class="btn btn-primary btn-sm" id="evOpen2" type="button" style="margin-top:8px">تأكيد البريد الآن</button>' : ''}
    </div>

    <div class="card mb-5">
      <div class="h4" style="margin-bottom:16px">الأمان</div>
      <button class="btn btn-secondary btn-block" id="changePass">
        تغيير كلمة المرور
      </button>
    </div>

    <div class="card">
      <button class="btn btn-outline-danger btn-block" id="doLogout">
        ${svg(I.out, 2)} تسجيل الخروج
      </button>
    </div>
  </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   Plans
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   Bind Events
   ═══════════════════════════════════════════════════════════ */

function bind() {
  bindMarket();
  $$('[data-nav]').forEach(b => b.onclick = () => go(b.dataset.nav));

  $$('[data-action]').forEach(b => {
    b.onclick = () => {
      const a = b.dataset.action;
      if (a === 'deposit') return openDeposit();
      if (a === 'new-card') return openNewCard();
      if (a === 'newCard') return openNewCard();
      if (a === 'transfer') return openTransfer();
      if (a === 'withdraw') return openWithdraw();
    };
  });

  $$('[data-card]').forEach(b => b.onclick = () => openCardDetails(b.dataset.card));

  // المتجر والباقات
  $$('[data-cat]').forEach(b => b.onclick = () => {
    const c = b.dataset.cat || null;
    S.q = '';
    if (!c) { S.cat = null; return go('dashboard'); }
    S.cat = c;
    if (S.page !== 'shop') return go('shop', true);
    window.scrollTo(0, 0); render();
  });
  $$('[data-prod]').forEach(b => b.onclick = () => {
    const id = b.dataset.prod;
    if (id.startsWith('svc:')) return openServiceBuy(id.slice(4));
    openProduct(id);
  });
  onTap('#catRetry', () => { S.catalog = { ...S.catalog, error: false }; render(); loadCatalog(); });
  $$('[data-scroll]').forEach(b => b.onclick = () => document.getElementById(b.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' }));
  onTap('#openCart', () => openCart());
  const sq = $('#shopQ');
  if (sq) sq.oninput = e => { clearTimeout(sq._t); const v = e.target.value; sq._t = setTimeout(() => { S.q = v; render(); }, 250); };
  $$('[data-plan]').forEach(b => b.onclick = () => openPlanBuy(b.dataset.plan));

  $$('[data-buy-svc]').forEach(b => b.onclick = () => openServiceBuy(b.dataset.buySvc));
  $$('[data-svc-order]').forEach(b => b.onclick = () => openServiceOrderDetail(b.dataset.svcOrder));
  $$('[data-ticket]').forEach(b => b.onclick = () => openTicket(b.dataset.ticket));

  onTap('#reloadSvcs', () => { loadServices(); toast('جاري التحديث...', 'ok'); });
  onTap('#reloadSvcs2', () => { loadServices(); toast('جاري التحديث...', 'ok'); });

  $$('[data-method]').forEach(b => b.onclick = () => openDepositMethod(b.dataset.method));
  $$('[data-order]').forEach(b => b.onclick = () => openOrderDetails(b.dataset.order));

  onTap('#saveProfile', async () => {
    const name = $('#pName').value.trim();
    if (name.length < 2) return toast('الاسم قصير جدًا', 'bad');
    try {
      await setDoc(doc(db, 'users', S.user.uid), { name }, { merge: true });
      toast('حُفظت التغييرات', 'ok');
    } catch { toast('تعذّر الحفظ', 'bad'); }
  });

  onTap('#verifyPhoneBtn', () => openPhoneVerify());
  onTap('#evOpen', () => openEmailVerify());
  onTap('#evOpen2', () => openEmailVerify());
  const ne = $('#notifyEmail');
  if (ne) ne.onchange = async () => {
    try { await api('/api/notify/prefs', { email: ne.checked }); toast(ne.checked ? 'فُعّلت إشعارات البريد' : 'أُوقفت إشعارات البريد', 'ok'); }
    catch (e) { ne.checked = !ne.checked; toast(e.message, 'bad'); }
  };

  onTap('#changePass', async () => {
    const em = S.profile.email || S.user?.email;
    if (!em) return toast('لا يوجد بريد مسجل', 'bad');
    try {
      await sendPasswordResetEmail(auth, em);
      toast('أُرسل رابط التغيير إلى ' + em, 'ok');
    } catch { toast('تعذّر الإرسال', 'bad'); }
  });

  onTap('#doLogout', () => {
    modal(`
      <div class="modal-head">
        <div class="modal-title">تسجيل الخروج</div>
        <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
      </div>
      <p class="body-sm text-2" style="margin-bottom:20px">ستحتاج للدخول مرة أخرى للوصول إلى حسابك.</p>
      <button class="btn btn-primary btn-block" id="confirmLogout">تأكيد الخروج</button>
      <button class="btn btn-secondary btn-block" style="margin-top:8px" data-act="close-modal">إلغاء</button>
    `);
    onTap('#confirmLogout', () => { closeModal(); signOut(auth); });
  });

  onTap('#refCopy', async () => {
    const code = $('#refCode').textContent;
    try { await navigator.clipboard.writeText(code); toast('نُسخ الرمز', 'ok'); }
    catch { toast('تعذّر النسخ', 'bad'); }
  });

  onTap('#newTicket', () => {
    modal(`
      <div class="modal-head">
        <div class="modal-title">تذكرة جديدة</div>
        <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
      </div>
      <div class="field mb-3">
        <label class="field-label">الموضوع</label>
        <input class="input" id="tSubject" placeholder="مشكلة في طلب" maxlength="120">
      </div>
      <div class="field mb-4">
        <label class="field-label">الرسالة</label>
        <textarea class="input" id="tMessage" placeholder="اشرح المشكلة بالتفصيل" rows="5"></textarea>
      </div>
      <button class="btn btn-primary btn-block" id="tSubmit">إرسال</button>
    `);
    onTap('#tSubmit', async () => {
      const subject = $('#tSubject').value.trim();
      const message = $('#tMessage').value.trim();
      if (!subject || !message) return toast('أكمل البيانات', 'bad');
      try {
        await api('/api/ticket/create', { subject, message });
        closeModal();
        toast('أُرسلت التذكرة', 'ok');
      } catch (e) { toast(e.message, 'bad'); }
    });
  });
}

/* ═══════════════════════════════════════════════════════════
   Actions
   ═══════════════════════════════════════════════════════════ */

async function openNewCard() {
  if (!canIssueCard()) return openPlanLimit();
  const mc = S.config.manual_cards || {};
  const mn = mc.create_min || 10;
  const mx = mc.create_max || 500;
  const ff = mc.create_fee_fixed || 8;
  const fp = mc.create_fee_pct || 2.5;

  modal(`
    <div class="modal-head">
      <div class="modal-title">إصدار بطاقة جديدة</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>

    <div class="field mb-3">
      <label class="field-label">اسم البطاقة (اختياري)</label>
      <input class="input" id="ncLabel" placeholder="بطاقة الاشتراكات" maxlength="40">
    </div>

    <div class="field mb-3">
      <label class="field-label">الاسم على البطاقة — بالإنجليزية</label>
      <input class="input" id="ncName" placeholder="MANSOUR ALI" dir="ltr"
             style="text-transform:uppercase" maxlength="24" autocomplete="off">
      <span class="field-hint">حروف لاتينية فقط</span>
    </div>

    <div class="field mb-4">
      <label class="field-label">المبلغ (من ${mn} إلى ${mx} دولار)</label>
      <input class="input" id="ncAmount" type="number" step="0.5" min="${mn}" max="${mx}" placeholder="${mn}">
    </div>

    <div id="ncQuote"></div>

    ${cardWarningHtml()}
    <div class="card-warn">
      <div class="card-warn-title">${svg(I.help, 2)} قبل الإصدار، انتبه:</div>
      <ul>
        <li>للدفع <b>أونلاين فقط</b>، لا تعمل في الصراف أو نقاط البيع.</li>
        <li>رمز CVV يظهر <b>مرة واحدة فقط</b> خلال ${n(mc.cvv_minutes) || 5} دقائق من الإصدار، ورقم البطاقة لمدة ${n(mc.reveal_hours) || 24} ساعة. <b>احفظهما فورًا.</b></li>
        <li>رسوم الإصدار <b>لا تُسترد</b> بعد إصدار البطاقة.</li>
        <li>بعض المواقع قد ترفض البطاقات الافتراضية.</li>
        <li>بعض المواقع تطلب <b>رمز تحقق 3D Secure</b> — تجده في صفحة بطاقتك، وتُخصم رسوم <b>${esc('$' + Number(mc.otp_fee ?? 0.03).toFixed(2))}</b> عن كل عملية تحقق حتى لو لم تنجح.</li>
        <li>يُمنع استخدامها في القمار أو أي نشاط غير قانوني، والمخالفة توقف البطاقة والحساب.</li>
        <li>الاسم على البطاقة لا يمكن تعديله بعد الإصدار.</li>
      </ul>
      <label class="card-warn-ok"><input type="checkbox" id="ncAccept">
        <span>قرأت التحذيرات وأوافق على <a href="./terms.html#cards" target="_blank" rel="noopener">شروط البطاقات</a></span></label>
    </div>

    <button class="btn btn-primary btn-block" id="ncSubmit" style="margin-top:16px" disabled>
      إصدار البطاقة
    </button>
  `);

  const calc = () => {
    const a = n($('#ncAmount').value);
    const box = $('#ncQuote');
    const btn = $('#ncSubmit');
    if (!(a >= mn && a <= mx)) { box.innerHTML = ''; btn.disabled = true; return; }
    const fee = Math.round((ff + a * fp / 100) * 100) / 100;
    const total = Math.round((a + fee) * 100) / 100;
    box.innerHTML = `
      <div class="card card-sm" style="background:var(--surface-2);border:none">
        <div class="flex-between" style="padding:6px 0"><span class="body-sm text-2">المبلغ</span><span class="tabular" style="font-weight:600">${usd(a)}</span></div>
        <div class="flex-between" style="padding:6px 0"><span class="body-sm text-2">رسوم الإصدار</span><span class="tabular" style="font-weight:600">${usd(fee)}</span></div>
        <div class="divider" style="margin:8px 0"></div>
        <div class="flex-between"><span style="font-weight:600">الإجمالي</span><span class="tabular" style="font-weight:700;color:var(--brand)">${usd(total)}</span></div>
      </div>
    `;
    const short = (S.profile.wallet_balance || 0) < total;
    btn.disabled = short || !$('#ncAccept').checked;
    if (short) box.innerHTML += `<div class="alert alert-warning" style="margin-top:12px">${svg(I.help, 2)}<div>رصيدك غير كافٍ — المتاح ${usd(S.profile.wallet_balance)}</div></div>`;
  };

  $('#ncAmount').oninput = calc;
  $('#ncAccept').onchange = calc;

  const ncIdemKey = newIdemKey();
  $('#ncSubmit').onclick = async () => {
    const btn = $('#ncSubmit');
    const name = $('#ncName').value.trim().toUpperCase();
    const amount = n($('#ncAmount').value);

    if (!/^[A-Z][A-Z .'-]{1,23}$/.test(name)) return toast('اكتب الاسم بحروف لاتينية', 'bad');
    if (!$('#ncAccept').checked) return toast('وافق على التحذيرات أولًا', 'bad');

    btn.disabled = true;
    btn.classList.add('loading');
    try {
      await api('/api/mcard/request', {
        amount,
        name_on_card: name,
        card_name: $('#ncLabel').value.trim() || 'بطاقتي',
        accept_terms: true,
        terms_version: TERMS_VERSION,
        idempotency_key: ncIdemKey,
      });
      stickerModal('card', 'card', 'وصل طلب بطاقتك 💳', 'سنصدر بطاقتك خلال دقائق، ويصلك إشعار فور جاهزيتها.');
    } catch (e) {
      if (/باقت|الباقة/.test(e.message)) { toast(e.message, 'bad'); btn.disabled = false; btn.classList.remove('loading'); return; }
      stickerModal('failed', 'error', 'لم يكتمل الطلب', e.message, false);
    }
  };
}

function openPhoneVerify(network = 'libyana') {
  modal(`
    <div class="modal-head">
      <div class="modal-title">توثيق رقم الهاتف</div>
      <button class="modal-close" id="pvClose" type="button" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>
    <div class="field mb-3">
      <label class="field-label" for="pvNet">الشبكة</label>
      <select class="input" id="pvNet">
        <option value="libyana"${network === 'libyana' ? ' selected' : ''}>ليبيانا</option>
        <option value="almadar"${network === 'almadar' ? ' selected' : ''}>المدار</option>
      </select>
    </div>
    <div class="field mb-4">
      <label class="field-label" for="pvPhone">رقمك</label>
      <input class="input" id="pvPhone" dir="ltr" inputmode="numeric" maxlength="14" placeholder="0912345678">
    </div>
    <div id="pvResult" aria-live="polite"></div>
    <button class="btn btn-primary btn-block" id="pvStart" type="button">متابعة</button>
  `);
  onTap('#pvClose', () => window.closeModal());
  onTap('#pvStart', async () => {
    const btn = $('#pvStart');
    btn.disabled = true; btn.classList.add('loading');
    try {
      const r = await api('/api/phone/verify/start', {
        phone: $('#pvPhone').value.trim(), network: $('#pvNet').value,
      });
      const mins = Math.max(1, Math.round((r.expires_ms - Date.now()) / 60000));
      $('#pvResult').innerHTML = `
        <div class="card card-sm mb-4">
          <div class="body-sm mb-2">حوّل <b class="tabular">${esc(Number(r.amount_lyd).toFixed(3))}</b> دينار بالضبط</div>
          <div class="body-sm mb-2">من رقمك <b dir="ltr">0${esc(r.phone)}</b></div>
          <div class="body-sm mb-2">إلى الرقم <b dir="ltr">${esc(r.to_phone)}</b></div>
          <div class="caption">خلال ${mins} دقيقة. سيُوثَّق رقمك ويُضاف المبلغ لمحفظتك تلقائيًا.</div>
        </div>`;
      btn.remove();
    } catch (e) {
      toast(e.message, 'bad');
      btn.disabled = false; btn.classList.remove('loading');
    }
  });
}

async function openDepositMethod(method) {
  const manualMode = (((S.config.methods || {})[method] || {}).mode || S.config.deposit_mode) === 'manual';
  if (!manualMode && !S.profile.phone_verified) {
    toast('وثّق رقم هاتفك أولاً', 'bad');
    return openPhoneVerify(method === 'almadar' ? 'almadar' : 'libyana');
  }
  const m = S.config.methods?.[method] || {};
  const phone = m.phone || S.config.deposit_phone || '';
  const rateVal = m.rate || rate();

  modal(`
    <div class="modal-head">
      <div class="modal-title">إيداع عبر ${method === 'almadar' ? 'المدار' : 'ليبيانا'}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>

    ${phone ? `
      <div class="card card-sm mb-4">
        <div class="field-label">حوّل إلى الرقم</div>
        <div class="copy-box">
          <div class="copy-value" style="font-size:16px;font-weight:600">${esc(phone)}</div>
          <button class="copy-btn" data-act="copy" data-copy-text="${esc(phone)}" aria-label="نسخ">${svg(I.copy, 2)}</button>
        </div>
      </div>
    ` : ''}

    <div class="field mb-3">
      <label class="field-label" for="dpPhone">رقمك الذي حوّلت منه</label>
      ${S.profile.phone_verified
        ? `<div class="input" dir="ltr" aria-readonly="true">0${esc(S.profile.phone_verified)} ✓</div>`
        : `<input class="input" id="dpPhone" dir="ltr" inputmode="numeric" maxlength="14" placeholder="0912345678">`}
      ${manualMode ? '<span class="field-hint">يُراجع الإيداع يدويًا ويُضاف خلال وقت قصير</span>' : ''}
    </div>

    <div class="field mb-4">
      <label class="field-label">المبلغ (بالدينار)</label>
      <input class="input" id="dpAmount" type="number" inputmode="decimal" step="0.5" placeholder="100">
    </div>

    <div id="dpQuote"></div>

    <button class="btn btn-primary btn-block" id="dpSubmit" style="margin-top:16px">
      تأكيد التحويل
    </button>
  `);

  $('#dpAmount').oninput = () => {
    const a = n($('#dpAmount').value);
    if (!(a > 0)) return $('#dpQuote').innerHTML = '';
    $('#dpQuote').innerHTML = `
      <div class="card card-sm" style="background:var(--surface-2);border:none">
        <div class="flex-between" style="padding:6px 0">
          <span class="body-sm text-2">سيُضاف</span>
          <span class="tabular" style="font-weight:700;color:var(--brand)">${usd(a / rateVal)}</span>
        </div>
      </div>
    `;
  };

  $('#dpSubmit').onclick = async () => {
    const btn = $('#dpSubmit');
    const amount = n($('#dpAmount').value);

    if (!(amount > 0)) return toast('أدخل المبلغ', 'bad');
    const phoneIn = $('#dpPhone') ? $('#dpPhone').value.trim() : '';
    if ($('#dpPhone') && phoneIn.replace(/\D/g, '').length < 10) return toast('اكتب رقمك كاملًا (10 أرقام)', 'bad');

    btn.disabled = true;
    btn.classList.add('loading');
    try {
      const r = await api('/api/wallet/claim', { amount_lyd: amount, method, phone: phoneIn });
      if (r.matched) stickerModal('deposit', 'success', 'تم الإيداع ✓', 'أُضيف ' + usd(r.credited_usd) + ' إلى محفظتك.');
      else if (r.manual) stickerModal('wait', 'wait', 'وصل طلب الإيداع', 'يُضاف الرصيد بعد المراجعة خلال وقت قصير.');
      else stickerModal('wait', 'wait', 'في انتظار الحوالة', 'سيُضاف الرصيد تلقائيًا فور وصول الحوالة.');
    } catch (e) {
      toast(e.message, 'bad');
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  };
}

async function openCardDetails(cardId) {
  const c = S.manualCards.find(x => x.id === cardId);
  if (!c) return;

  let orders = S.manualOrders || [];
  if (!orders.some(o => o.card_id === cardId && o.kind === 'create')) {
    try { const r = await api('/api/mcard/list', {}); orders = r.orders || []; } catch {}
  }
  const lastOrder = orders.find(o => o.card_id === cardId && o.kind === 'create' && o.status === 'completed');

  modal(`
    <div class="modal-head">
      <div class="modal-title">${esc(c.card_name || 'بطاقة')}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>

    <div style="max-width:320px;margin:0 auto 20px">
      ${renderCard(c)}
    </div>

    <div class="card card-sm mb-4" style="background:var(--surface-2);border:none">
      <div class="flex-between" style="padding:6px 0">
        <span class="body-sm text-2">الرصيد المتبقي</span>
        <span class="tabular" style="font-weight:700">${usd(c.balance)}</span>
      </div>
      <div class="flex-between" style="padding:2px 0 6px">
        <span class="caption">آخر تحديث</span>
        <span class="caption">${c.balance_updated_at ? esc(dt(c.balance_updated_at)) : 'عند الإصدار'}</span>
      </div>
      <div class="flex-between" style="padding:6px 0">
        <span class="body-sm text-2">الحالة</span>
        <span class="badge ${c.status === 'active' ? 'badge-success' : 'badge-neutral'}">${c.status === 'active' ? 'نشطة' : 'مجمدة'}</span>
      </div>
    </div>

    ${lastOrder ? `
      <button class="btn btn-primary btn-block mb-2" id="revealBtn">
        ${svg(I.eye, 2)} عرض بيانات البطاقة
      </button>
    ` : `
      <div class="alert alert-warning mb-3">${svg(I.help, 2)}<div>لم تُسلَّم بيانات البطاقة بعد.</div></div>
    `}

    ${c.status === 'active' ? `<button class="btn btn-secondary btn-block mb-2" id="otpBtn" type="button">🔐 رمز التحقق عند الدفع (3D Secure)</button>` : ''}
    <button class="btn btn-secondary btn-block" data-act="close-modal">إغلاق</button>
  `);

  onTap('#otpBtn', () => openOtp());
  onTap('#revealBtn', async () => {
    const btn = $('#revealBtn');
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      const d = await api('/api/mcard/reveal', { order_id: lastOrder.id });
      const grp = v => String(v).replace(/(.{4})/g, '$1 ').trim();
      const hrs = Math.floor((new Date(d.expires_at) - Date.now()) / 3600000);

      modal(`
        <div class="modal-head">
          <div class="modal-title">بيانات البطاقة</div>
          <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
        </div>

        <div class="alert alert-warning mb-4">${svg(I.help, 2)}<div>${d.cvv ? 'رمز CVV يُعرض <b>مرة واحدة فقط</b> — احفظه الآن. ' : ''}يختفي رقم البطاقة خلال ${hrs} ساعة.</div></div>

        <div class="field mb-3">
          <div class="field-label">رقم البطاقة</div>
          <div class="copy-box">
            <div class="copy-value" style="font-size:15px">${esc(grp(d.card_number))}</div>
            <button class="copy-btn" data-copy="${esc(d.card_number)}" aria-label="نسخ">${svg(I.copy, 2)}</button>
          </div>
        </div>
        <div class="grid-2 mb-4">
          <div>
            <div class="field-label">الانتهاء</div>
            <div class="copy-box">
              <div class="copy-value">${esc(d.expiry)}</div>
              <button class="copy-btn" data-copy="${esc(d.expiry)}" aria-label="نسخ">${svg(I.copy, 2)}</button>
            </div>
          </div>
          <div>
            <div class="field-label">CVV</div>
            ${d.cvv ? `<div class="copy-box">
              <div class="copy-value">${esc(d.cvv)}</div>
              <button class="copy-btn" data-copy="${esc(d.cvv)}" aria-label="نسخ CVV">${svg(I.copy, 2)}</button>
            </div>` : `<div class="copy-box"><div class="copy-value caption">لم يعد متاحًا</div></div>`}
          </div>
        </div>

        <button class="btn btn-secondary btn-block" data-act="close-modal">إغلاق</button>
      `);

      $$('[data-copy]').forEach(b => b.onclick = async () => {
        try { await navigator.clipboard.writeText(b.dataset.copy); toast('نُسخ', 'ok'); }
        catch { toast('تعذّر النسخ', 'bad'); }
      });
    } catch (e) {
      toast(e.message, 'bad');
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });
}

async function openOrderDetails(orderId) {
  let o = S.orders.find(x => x.id === orderId);
  if (!o) return;
  try {                                                  // الأكواد مشفّرة في القاعدة — تُجلب مفكوكة من الخادم
    const r = await api('/api/store/my-orders', {});
    const full = (r.orders || []).find(x => x.id === orderId);
    if (full) o = { ...o, items: full.items };
  } catch {}

  modal(`
    <div class="modal-head">
      <div class="modal-title">تفاصيل الطلب</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>

    <div class="card card-sm mb-4" style="background:var(--surface-2);border:none">
      <div class="flex-between" style="padding:6px 0"><span class="body-sm text-2">رقم الطلب</span><span class="mono" style="font-size:12px">${esc(o.id)}</span></div>
      <div class="flex-between" style="padding:6px 0"><span class="body-sm text-2">التاريخ</span><span class="body-sm">${esc(dt(o.created_at))}</span></div>
      <div class="flex-between" style="padding:6px 0"><span class="body-sm text-2">الحالة</span>
        <span class="badge ${o.status === 'completed' ? 'badge-success' : o.status === 'pending' ? 'badge-warning' : 'badge-error'}">
          ${o.status === 'completed' ? 'مكتمل' : o.status === 'pending' ? 'قيد التنفيذ' : 'ملغى'}
        </span>
      </div>
    </div>

    <div class="field-label mb-2">المنتجات</div>
    <div class="list mb-4">
      ${(o.items || []).map(i => `
        <div class="list-row" style="cursor:default">
          <div class="list-content">
            <div class="list-title">${esc(i.name)}</div>
            <div class="list-meta">${i.qty} × ${esc(lyd(i.price_lyd))}</div>
            ${i.codes_purged ? '<div class="caption" style="margin-top:4px">انتهت مدة الاحتفاظ بالأكواد (30 يومًا)</div>' : ''}
            ${(i.codes || []).map(c => `<div class="copy-box" style="margin-top:6px">
              <div class="copy-value mono" dir="ltr" style="font-size:12px;word-break:break-all">${esc(c)}</div>
              <button class="copy-btn" data-act="copy" data-copy-text="${esc(c)}" aria-label="نسخ">${svg(I.copy, 2)}</button></div>`).join('')}
          </div>
          <div class="list-end">
            <div class="list-amount">${esc(lyd(i.line_lyd))}</div>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="card card-sm mb-4" style="background:var(--surface-2);border:none">
      <div class="flex-between"><span style="font-weight:600">الإجمالي</span><span class="tabular" style="font-weight:700">${esc(lyd(o.total_lyd))}</span></div>
    </div>
    ${o.delivery ? `<div class="field-label mb-2">بيانات التسليم</div><div class="copy-box mb-4"><div class="copy-value" dir="auto" style="white-space:pre-line">${esc(o.delivery)}</div><button class="copy-btn" data-act="copy" data-copy-text="${esc(o.delivery)}" aria-label="نسخ">${svg(I.copy, 2)}</button></div>` : ''}
    ${o.reject_reason ? `<div class="alert alert-error mb-4">${svg(I.x, 2)}<div>${esc(o.reject_reason)} — أُعيد المبلغ لمحفظتك</div></div>` : ''}

    <button class="btn btn-secondary btn-block" data-act="close-modal">إغلاق</button>
  `);
}

async function loadCatalog() {
  try {
    const d = await apiGet('/api/catalog');
    S.catalog = {
      categories: d.categories || [],
      products: d.products || [],
      loaded: true,
    };
    S.config = { ...S.config, categories: S.catalog.categories };
    render();
    openPendingProduct();
  } catch (e) {
    console.warn('catalog:', e.message);
    S.catalog = { ...S.catalog, error: true };
    render();
  }
}


/* ═══════════════════════════════════════════════════════════
   v6 — Store, cart, plans, deposits, withdraw & transfer
   ═══════════════════════════════════════════════════════════ */

const PLAN_KEYS = ['free', 'basic', 'premium', 'vip'];
const PLAN_AR = { free: 'العادي', basic: 'الأساسي', premium: 'بريميوم', vip: 'VIP' };
const PLAN_SUB = { free: 'للبداية', basic: 'للاستخدام الشخصي', premium: 'للاستخدام المتكرر', vip: 'بلا حدود' };
const msOf = v => !v ? 0 : v.toDate ? v.toDate().getTime() : typeof v === 'number' ? v : Date.parse(v) || 0;
function myPlan() {
  const p = S.profile || {};
  return ['basic', 'premium', 'vip'].includes(p.plan) && Number(p.plan_expires_ms || 0) > Date.now() ? p.plan : 'free';
}
function planInfo() {
  return S.config.plans || { on: true, free: { cards: 1 }, basic: { cards: 3, price: 5, days: 30 }, premium: { cards: 6, price: 10, days: 30 }, vip: { cards: 0, price: 15, days: 30 } };
}
function cardLimit() { return (planInfo()[myPlan()] || {}).cards ?? 1; }
function isUnlimited() { return myPlan() !== 'free' && cardLimit() === 0; }
function freeCardsN() { return (planInfo().free || {}).cards ?? 1; }
function quotaSince() {
  const p = S.profile || {}, days = (planInfo()[myPlan()] || {}).days || 30;
  const started = Number(p.plan_started_ms || (Number(p.plan_expires_ms || 0) - days * 864e5));
  return Math.max(started, Date.now() - 30 * 864e5);
}
function createOrders() {
  return (S.manualOrders || []).filter(o => o.kind === 'create' && o.status !== 'rejected').sort((a, b) => msOf(a.created_at) - msOf(b.created_at));
}
function cardsUsed() {                         // المستخدم من الحصة الحالية (المجانية أو الإضافية الشهرية)
  const all = createOrders(), freeN = freeCardsN();
  if (all.length < freeN || myPlan() === 'free') return Math.min(all.length, freeN);
  const since = quotaSince();
  return all.slice(freeN).filter(o => msOf(o.created_at) >= since).length;
}
function canIssueCard() {
  const all = createOrders(), freeN = freeCardsN();
  if (all.length < freeN) return true;
  if (myPlan() === 'free') return false;
  return isUnlimited() || cardsUsed() < cardLimit();
}
function planCardsText(k) {
  const c = (planInfo()[k] || {}).cards, f = freeCardsN();
  if (k === 'free') return `${f === 1 ? 'بطاقة واحدة' : f + ' بطاقات'} مجانًا`;
  if (c === 0) return 'بطاقات بلا حدود';
  return `+${c} بطاقات إضافية شهريًا (المجموع ${f + c})`;
}
// في الباقة العادية تظهر أقدم بطاقة فقط؛ الباقي يختفي حتى يجدد الباقة
function visibleCards(list) {
  if (myPlan() !== 'free') return list;
  const lim = (planInfo().free || {}).cards ?? 1;
  const keep = new Set([...list].filter(c => c.status !== 'deleted')
    .sort((a, b) => msOf(a.created_at) - msOf(b.created_at)).slice(0, lim).map(c => c.id));
  return list.filter(c => keep.has(c.id));
}
function hiddenCardsCount() {
  const all = (S.manualCards || []).filter(c => c.status !== 'deleted');
  return all.length - visibleCards(all).length;
}

/* ─── Cart (localStorage: بيانات غير حساسة فقط) ─── */
function loadCart() {
  try { const c = JSON.parse(localStorage.getItem('kardo_cart') || '[]'); S.cart = Array.isArray(c) ? c.slice(0, 20) : []; }
  catch { S.cart = []; }
}
function saveCart() { try { localStorage.setItem('kardo_cart', JSON.stringify(S.cart)); } catch {} }
function prodById(id) { return (S.catalog.products || []).find(p => p.id === id); }
function cartCount() { return S.cart.reduce((a, l) => a + l.qty, 0); }
function cartTotal() {
  return S.cart.reduce((a, l) => { const p = prodById(l.id); return a + (p ? p.price * l.qty : 0); }, 0);
}
loadCart();

function prodCard(p) {
  const off = p.old_price > p.price ? Math.round((1 - p.price / p.old_price) * 100) : 0;
  return `
    <button class="prod-card" data-prod="${esc(p.id)}" ${!p.available ? 'data-na="1"' : ''}>
      <div class="prod-img">
        ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async">` : `<span class="prod-ph">${svg(I.box, 1.5)}</span>`}
        ${off ? `<span class="prod-tag">-${off}%</span>` : ''}
        ${!p.available ? '<span class="prod-na">غير متوفر</span>' : p.kind === 'stock' ? '<span class="prod-fast">⚡ فوري</span>' : ''}
      </div>
      <div class="prod-body">
        <div class="prod-name">${esc(p.name)}</div>
        <div class="prod-price"><b class="tabular">${esc(lyd(p.price))}</b>${off ? `<s class="tabular">${esc(lyd(p.old_price))}</s>` : ''}</div>
      </div>
    </button>`;
}

function prodRow(p) {
  const off = p.old_price > p.price ? Math.round((1 - p.price / p.old_price) * 100) : 0;
  return `
    <button class="prow" data-prod="${esc(p.id)}" ${!p.available ? 'style="opacity:.55"' : ''}>
      <span class="prow-img">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" decoding="async">` : p.emoji ? `<span style="font-size:28px">${esc(p.emoji)}</span>` : `<span class="prod-ph">${svg(I.box, 1.5)}</span>`}</span>
      <span class="prow-body">
        <span class="prow-name" style="display:block">${esc(p.name)}</span>
        <span class="prow-price" style="display:block">${esc(lyd(p.price))}${off ? `<s>${esc(lyd(p.old_price))}</s>` : ''}</span>
        <span class="prow-fast" style="display:block">${!p.available ? 'غير متوفر' : p.kind === 'stock' ? '⚡ فوري' : 'تسليم يدوي'}${off ? ` · <b style="color:var(--error)">خصم ${off}%</b>` : ''}</span>
      </span>
      <span class="prow-add" aria-hidden="true">+</span>
    </button>`;
}
function featTile(p) {
  return `<button class="feat-tile" data-prod="${esc(p.id)}">
      <span class="ft-tag">مميّز</span>
      <span class="ft-img">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" decoding="async">` : `<span class="prod-ph">${svg(I.box, 1.5)}</span>`}</span>
      <span class="ft-name" style="display:block">${esc(p.name)}</span>
      <span class="caption tabular">${esc(lyd(p.price))}</span></button>`;
}

const FENNEC_SLOT = { welcome: 'welcome', success: 'purchase', card: 'no_cards', wait: 'wait', mail: 'mail', offline: 'offline', error: 'error', empty: 'empty' };
const stickerUrl = (slot, fallback) => ((S.config && S.config.stickers) || {})[slot] || `./fennec-${fallback}.webp`;
const fennec = (n, size = 120, slot) => `<img class="fennec" src="${esc(stickerUrl(slot || FENNEC_SLOT[n], n))}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">`;
// نافذة ملصق للمواقف المهمة (نجاح/فشل)
function stickerModal(slot, fallback, title, text, ok = true) {
  modal(`
    <div class="modal-head"><div class="modal-title">${esc(title)}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    <div style="text-align:center">${fennec(fallback, 150, slot)}
      <p class="body-sm ${ok ? 'text-2' : ''}" style="${ok ? '' : 'color:var(--error)'};line-height:1.9">${esc(text)}</p></div>
    <button class="btn ${ok ? 'btn-primary' : 'btn-secondary'} btn-block" data-act="close-modal" style="margin-top:10px">حسنًا</button>`);
  if (ok) haptic.ok(); else haptic.bad();
}
const SVC_CAT = '__svc';
const TERMS_VERSION = '1.0';
function cardWarningHtml() {
  const w = String(((S.config.manual_cards || {}).warning) || '').trim();
  if (!w) return '';
  return `<div class="neon-warn mb-4" role="alert"><div class="neon-warn-title">⚠️ تحذير مهم</div>${w.split(/\n+/).map(l => `<p>${esc(l)}</p>`).join('')}</div>`;
}
function svcAsProducts() {
  return (S.services || []).map(sv => ({
    id: 'svc:' + sv.id, _svc: sv.id, cat: SVC_CAT, name: sv.name, desc: sv.desc || '',
    image: sv.icon_url || '', price: n(sv.price_usd) * rate(), old_price: 0,
    kind: sv.delivery_type === 'manual' ? 'manual' : 'stock', available: sv.delivery_type === 'manual' || sv.in_stock !== false,
    featured: false, emoji: sv.icon_emoji || '📦',
  }));
}

function storeSection(isHome) {
  const cats = (S.catalog.categories || []).slice();
  const prods = (S.catalog.products || []).slice();
  const q = (S.q || '').trim().toLowerCase();
  const cur = !isHome && S.cat ? cats.find(c => c.id === S.cat) : null;
  const parentId = isHome ? '' : (S.cat || '');
  const subs = cats.filter(c => (c.parent || '') === parentId);
  const list = q ? prods.filter(p => (p.name + ' ' + (p.desc || '')).toLowerCase().includes(q))
    : cur ? prods.filter(p => p.cat === cur.id) : prods.filter(p => p.featured);
  const loading = !S.catalog.loaded;

  return `
    <div class="flex-between mb-3">
      <div class="h4">${cur ? esc(cur.name) : 'المتجر'}</div>
      ${cur ? `<button class="btn btn-ghost btn-sm" data-cat="${esc(cur.parent || '')}">${svg(I.next, 2)} رجوع</button>` : ''}
    </div>
    ${!cur ? `<div class="trust-row mb-4"><span>⚡ تسليم فوري</span><span>🔒 دفع آمن</span><span>🇱🇾 بالدينار</span></div>` : ''}
    <div class="input-wrap mb-4">
      <span class="input-icon">${svg(I.search, 2)}</span>
      <input class="input" id="shopQ" placeholder="ابحث عن اشتراك أو لعبة…" value="${esc(S.q)}" autocomplete="off">
    </div>

    ${S.catalog.error && !S.catalog.loaded ? `
      <div class="card mb-5" style="text-align:center;padding:24px 20px">${fennec('error', 110)}
        <div class="h4" style="margin-bottom:6px">تعذّر تحميل المتجر</div>
        <button class="btn btn-secondary btn-sm" id="catRetry" style="padding:0 18px">إعادة المحاولة</button></div>` : ''}
    ${loading && !S.catalog.error ? `<div class="prod-grid mb-5">${'<div class="skeleton" style="aspect-ratio:16/10;border-radius:16px"></div>'.repeat(4)}</div>` : ''}

    ${!q && subs.length ? `
      <div class="prod-grid mb-5 stagger">
        ${subs.map(c => `
          <button class="cat-tile" data-cat="${esc(c.id)}" ${c.soon ? 'disabled' : ''}>
            ${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy" decoding="async">` : `<span class="cat-ico">${esc(c.icon || '📦')}</span>`}
            <span class="cat-name">${esc(c.name)}${c.soon ? ' · قريبًا' : ''}</span>
          </button>`).join('')}
      </div>` : ''}

    ${list.length ? `
      ${!cur && !q ? '<div class="h4 mb-3">الأكثر طلبًا 🔥</div>' : ''}
      <div class="stagger mb-5" style="display:flex;flex-direction:column;gap:10px">${list.map(prodRow).join('')}</div>
    ` : (cur || q) && !loading ? `
      <div class="card" style="text-align:center;padding:28px 20px">
        ${fennec('empty', 110)}
        <div class="h4" style="margin-bottom:6px">${q ? 'لا نتائج' : 'لا منتجات هنا بعد'}</div>
        <p class="body-sm text-2">${q ? 'جرّب كلمة أخرى' : 'نضيف منتجات جديدة باستمرار'}</p>
      </div>` : ''}`;
}

function vShop() {
  return `<div class="page-enter">${storeSection(false)}</div>`;
}

function openProduct(id) {
  const p = prodById(id);
  if (!p) return;
  const maxQ = p.kind === 'stock' ? Math.min(20, p.stock || 0) : 20;
  modal(`
    <div class="modal-head">
      <div class="modal-title">${esc(p.name)}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>
    ${p.image ? `<div class="prod-hero" id="pHero" role="button" tabindex="0" aria-label="تكبير الصورة"><img src="${esc(p.image)}" alt="${esc(p.name)}"></div>` : ''}
    ${p.desc ? `<p class="body-sm text-2 mb-3" style="white-space:pre-line">${esc(p.desc)}</p>` : ''}
    <button class="btn btn-ghost btn-sm mb-2" id="pShare" type="button" style="padding:0">🔗 مشاركة رابط المنتج</button>
    <div class="flex-between mb-3">
      <span class="tabular h3" style="color:var(--brand)">${esc(lyd(p.price))}</span>
      ${p.countdown && p.countdown.state === 'active' ? `<span class="caption">متبقٍ ${p.countdown.days_left} يومًا</span>` : ''}
    </div>
    ${p.note ? `<div class="alert alert-warning mb-3">${svg(I.help, 2)}<div>${esc(p.note)}</div></div>` : ''}
    ${(p.fields || []).map((f, i) => `
      <div class="field mb-3">
        <label class="field-label" for="pf${i}">${esc(f.label)}${f.required ? ' *' : ''}</label>
        <input class="input" id="pf${i}" type="${esc(f.type)}" dir="auto" maxlength="120" placeholder="${esc(f.hint || '')}">
      </div>`).join('')}
    ${p.available ? `
      <div class="field mb-4">
        <label class="field-label" for="pQty">الكمية</label>
        <input class="input" id="pQty" type="number" inputmode="numeric" min="1" max="${maxQ}" value="1">
        ${p.kind === 'stock' ? `<span class="field-hint">المتوفر: ${esc(String(p.stock))}</span>` : ''}
      </div>
      <div class="grid-2">
        <button class="btn btn-secondary" id="pAdd" type="button">${svg(I.cart, 2)} أضف للسلة</button>
        <button class="btn btn-primary" id="pBuy" type="button">اشترِ الآن</button>
      </div>` : `<div class="alert alert-error">${svg(I.x, 2)}<div>المنتج غير متوفر حاليًا</div></div>`}
  `);

  const collect = () => {
    const values = {};
    for (let i = 0; i < (p.fields || []).length; i++) {
      const f = p.fields[i], v = ($('#pf' + i).value || '').trim();
      if (f.required && !v) { toast(`${f.label} مطلوب`, 'bad'); $('#pf' + i).focus(); return null; }
      if (v) values[f.key] = v;
    }
    const qty = Math.floor(n($('#pQty').value));
    if (!(qty >= 1 && qty <= maxQ)) { toast(`الكمية من 1 إلى ${maxQ}`, 'bad'); return null; }
    return { id: p.id, qty, values };
  };
  const add = (line) => {
    const hasFields = Object.keys(line.values).length > 0;
    const ex = !hasFields && S.cart.find(l => l.id === line.id && !Object.keys(l.values || {}).length);
    if (ex) ex.qty = Math.min(maxQ, ex.qty + line.qty);
    else {
      if (S.cart.some(l => l.id === line.id)) { toast('المنتج في السلة بالفعل — عدّله من السلة', 'bad'); return false; }
      if (S.cart.length >= 20) { toast('السلة ممتلئة', 'bad'); return false; }
      S.cart.push(line);
    }
    saveCart();
    return true;
  };
  onTap('#pShare', async () => {
    const url = productUrl(p);
    try { if (navigator.share) await navigator.share({ title: p.name, url }); else { await navigator.clipboard.writeText(url); toast('نُسخ الرابط ✓', 'ok'); } } catch {}
  });
  onTap('#pHero', () => {
    const ov = document.createElement('div');
    ov.className = 'img-zoom';
    ov.innerHTML = `<img src="${esc(p.image)}" alt="">`;
    ov.onclick = () => ov.remove();
    document.body.appendChild(ov);
  });
  onTap('#pAdd', () => { const l = collect(); if (l && add(l)) { closeModal(); toast('أُضيف للسلة', 'ok'); render(); } });
  onTap('#pBuy', () => { const l = collect(); if (l && add(l)) { render(); openCart(); } });
}

function openCart() {
  S.cart = S.cart.filter(l => prodById(l.id));
  saveCart();
  const key = newIdemKey();
  let coupon = null;

  const draw = () => {
    const sub = Math.round(cartTotal() * 100) / 100;
    const off = coupon ? coupon.off_lyd : 0;
    const total = Math.max(0, Math.round((sub - off) * 100) / 100);
    const balLyd = n(S.profile.wallet_balance) * rate();
    modal(`
      <div class="modal-head">
        <div class="modal-title">السلة</div>
        <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
      </div>
      ${S.cart.length ? `
        <div class="list mb-4">
          ${S.cart.map((l, i) => { const p = prodById(l.id); return `
            <div class="list-row" style="cursor:default">
              <div class="list-content">
                <div class="list-title">${esc(p.name)}</div>
                <div class="list-meta">${esc(lyd(p.price))} × ${l.qty}</div>
              </div>
              <div class="list-end" style="display:flex;gap:6px;align-items:center">
                <button class="btn btn-ghost btn-sm" data-cq="${i}" data-d="-1" aria-label="إنقاص">−</button>
                <button class="btn btn-ghost btn-sm" data-cq="${i}" data-d="1" aria-label="زيادة">+</button>
                <button class="btn btn-ghost btn-sm" data-crm="${i}" aria-label="حذف">${svg(I.x, 2)}</button>
              </div>
            </div>`; }).join('')}
        </div>
        ${S.config.coupons_on !== false ? `
          <div class="field mb-3" style="display:flex;gap:8px">
            <input class="input" id="cpCode" placeholder="كود الخصم" dir="ltr" style="text-transform:uppercase" value="${esc(coupon ? coupon.code : '')}">
            <button class="btn btn-secondary" id="cpApply" type="button">تطبيق</button>
          </div>` : ''}
        <div class="card card-sm mb-4" style="background:var(--surface-2);border:none">
          <div class="flex-between" style="padding:4px 0"><span class="body-sm text-2">المجموع</span><span class="tabular">${esc(lyd(sub))}</span></div>
          ${off ? `<div class="flex-between" style="padding:4px 0"><span class="body-sm text-2">الخصم</span><span class="tabular" style="color:var(--brand)">− ${esc(lyd(off))}</span></div>` : ''}
          <div class="flex-between" style="padding:4px 0"><span style="font-weight:600">الإجمالي</span><span class="tabular" style="font-weight:700">${esc(lyd(total))}</span></div>
          <div class="flex-between" style="padding:4px 0"><span class="caption">رصيدك</span><span class="caption tabular">${esc(lyd(balLyd))}</span></div>
        </div>
        ${balLyd + 0.01 < total ? `
          <div class="alert alert-warning mb-3">${svg(I.help, 2)}<div>رصيدك لا يكفي — أضف ${esc(lyd(total - balLyd))}</div></div>
          <button class="btn btn-primary btn-block" id="cGoDep" type="button">إضافة رصيد</button>` : `
          <button class="btn btn-primary btn-block" id="cPay" type="button">تأكيد الشراء — ${esc(lyd(total))}</button>`}
      ` : `
        <div style="text-align:center;padding:24px 0">
          <div class="empty-icon" style="margin:0 auto 12px">${svg(I.cart, 2)}</div>
          <div class="h4 mb-2">السلة فارغة</div>
          <button class="btn btn-primary" data-act="close-modal">تصفح المتجر</button>
        </div>`}
    `);

    $$('[data-cq]').forEach(b => b.onclick = () => {
      const l = S.cart[+b.dataset.cq], p = prodById(l.id);
      const mx = p.kind === 'stock' ? Math.min(20, p.stock || 0) : 20;
      l.qty = Math.max(1, Math.min(mx, l.qty + (+b.dataset.d)));
      saveCart(); coupon = null; draw(); render();
    });
    $$('[data-crm]').forEach(b => b.onclick = () => { S.cart.splice(+b.dataset.crm, 1); saveCart(); coupon = null; draw(); render(); });
    onTap('#cGoDep', () => { closeModal(); openDeposit(); });
    onTap('#cpApply', async () => {
      const code = ($('#cpCode').value || '').trim().toUpperCase();
      if (!code) return;
      try { const r = await api('/api/coupon/check', { code, subtotal_lyd: sub }); coupon = r.coupon; toast('طُبّق الخصم', 'ok'); draw(); }
      catch (e) { coupon = null; toast(e.message, 'bad'); }
    });
    onTap('#cPay', async () => {
      const btn = $('#cPay');
      btn.disabled = true; btn.classList.add('loading');
      try {
        const r = await api('/api/store/order', {
          items: S.cart.map(l => ({ id: l.id, qty: l.qty, values: l.values || {} })),
          coupon: coupon ? coupon.code : '', idempotency_key: key,
        });
        S.cart = []; saveCart(); render();
        showOrderResult(r.order);
        loadCatalog();
      } catch (e) {
        stickerModal('failed', 'error', 'لم تكتمل عملية الشراء', e.message, false);
      }
    });
  };
  draw();
}

function showOrderResult(o) {
  const withCodes = (o.items || []).filter(i => i.codes && i.codes.length);
  modal(`
    <div class="modal-head">
      <div class="modal-title">${o.status === 'completed' ? 'تم الشراء ✓' : 'وصل طلبك'}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>
    <div style="text-align:center;margin-bottom:8px">${fennec(o.status === 'completed' ? 'success' : 'wait', 120)}
      ${o.status !== 'completed' ? '<p class="body-sm text-2">سيُنفَّذ طلبك يدويًا ونُعلمك فور اكتماله.</p>' : ''}</div>
    ${withCodes.length ? withCodes.map(i => `
      <div class="field-label mb-2">${esc(i.name)}</div>
      ${i.codes.map(c => `
        <div class="copy-box mb-2">
          <div class="copy-value mono" dir="ltr" style="font-size:13px;word-break:break-all">${esc(c)}</div>
          <button class="copy-btn" data-act="copy" data-copy-text="${esc(c)}" aria-label="نسخ">${svg(I.copy, 2)}</button>
        </div>`).join('')}
    `).join('') : `<p class="body-sm text-2 mb-3">سيُنفَّذ طلبك يدويًا وستجده في «طلباتي» فور إتمامه.</p>`}
    <div class="grid-2" style="margin-top:12px">
      <button class="btn btn-secondary" data-act="close-modal">إغلاق</button>
      <button class="btn btn-primary" id="goOrders" type="button">طلباتي</button>
    </div>
  `);
  onTap('#goOrders', () => { closeModal(); go('orders'); });
}

/* ─── Plans ─── */
function planTiles(cur, forLanding) {
  const pi = planInfo(), r = rate();
  return PLAN_KEYS.filter(k => pi[k]).map(k => {
    const info = pi[k] || {};
    const isCur = cur === k, top = k === 'vip';
    const price = k === 'free' ? 0 : n(info.price);
    return `
      <div class="plan-tile ${top ? 'plan-top' : ''} ${isCur ? 'plan-cur' : ''}">
        ${top ? '<span class="plan-crown">👑</span>' : ''}
        <div class="eyebrow" style="color:${top ? 'var(--brand)' : 'var(--text-3)'}">${esc(PLAN_AR[k])}</div>
        <div class="caption mb-2">${esc(PLAN_SUB[k])}</div>
        <div class="plan-price"><b class="tabular">${k === 'free' ? '0' : esc('$' + price)}</b>
          <span class="caption">${k === 'free' ? 'مجانًا' : `≈ ${esc(lyd(price * r))} / ${esc(String(info.days || 30))} يومًا`}</span></div>
        <ul class="plan-feat">
          <li>✓ ${esc(planCardsText(k))}</li>
          <li>✓ المحفظة والمتجر كاملين</li>
          ${k !== 'free' ? '<li>✓ البطاقات تظهر ما دامت الباقة سارية</li><li>✓ التجديد يُضاف للمدة المتبقية</li>' : '<li>✓ بطاقة أولى تبقى معك دائمًا</li>'}
        </ul>
        ${forLanding ? `<button class="btn ${top ? 'btn-primary' : 'btn-secondary'} btn-block" data-act="href" data-href="login.html?mode=signup">ابدأ الآن</button>`
          : k === 'free' ? `<button class="btn btn-secondary btn-block" disabled>${isCur ? 'باقتك الحالية' : 'الباقة المجانية'}</button>`
          : `<button class="btn ${isCur || top ? 'btn-primary' : 'btn-secondary'} btn-block" data-plan="${k}">${isCur ? 'جدّد الباقة' : 'اشترك'}</button>`}
      </div>`;
  }).join('');
}

function vPlans() {
  const cur = myPlan();
  const exp = Number(S.profile.plan_expires_ms || 0);
  return `
  <div class="page-enter">
    <div class="mb-5"><h1 class="h2" style="margin-bottom:6px">الباقات</h1>
      <p class="body-sm text-2">باقتك الحالية: <b>${esc(PLAN_AR[cur])}</b>${cur !== 'free' ? ` · سارية حتى ${esc(new Date(exp).toLocaleDateString('ar-LY'))}` : ''}</p></div>
    ${hiddenCardsCount() ? `<div class="alert alert-warning mb-4">🔒<div>عندك ${hiddenCardsCount()} بطاقات مخفية — تظهر فور اشتراكك.</div></div>` : ''}
    <div class="plans-grid stagger">${planTiles(cur, false)}</div>
  </div>`;
}

function renderLandingPlans() {
  const box = document.getElementById('landingPlans');
  if (box) box.innerHTML = planTiles('', true);
}

function openPlanBuy(plan) {
  const info = planInfo()[plan] || {};
  const cur = myPlan();
  const r = rate();
  const key = newIdemKey();
  modal(`
    <div class="modal-head">
      <div class="modal-title">باقة ${esc(PLAN_AR[plan])}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>
    <div class="card card-sm mb-4" style="background:var(--surface-2);border:none">
      <div class="flex-between" style="padding:4px 0"><span class="body-sm text-2">المدة</span><span>${esc(String(info.days))} يومًا</span></div>
      <div class="flex-between" style="padding:4px 0"><span class="body-sm text-2">البطاقات</span><span>${esc(planCardsText(plan))}</span></div>
      <div class="flex-between" style="padding:4px 0"><span style="font-weight:600">السعر</span><span class="tabular" style="font-weight:700">${esc(lyd(n(info.price) * r))}</span></div>
    </div>
    ${cur !== 'free' && cur !== plan ? `<p class="caption mb-3">يُخصم من السعر قيمة الأيام المتبقية من باقتك الحالية.</p>` : ''}
    ${cur === plan ? `<p class="caption mb-3">تُضاف المدة الجديدة إلى المتبقي من باقتك.</p>` : ''}
    <button class="btn btn-primary btn-block" id="plBuy" type="button">تأكيد الدفع من المحفظة</button>
  `);
  onTap('#plBuy', async () => {
    const btn = $('#plBuy'); btn.disabled = true; btn.classList.add('loading');
    try {
      const res = await api('/api/plan/subscribe', { plan, idempotency_key: key });
      stickerModal('plan', 'success', `تم تفعيل باقة ${PLAN_AR[plan]} 🎉`, res.credit ? `خُصم ${usd(res.credit)} من قيمة باقتك السابقة.` : 'استمتع ببطاقاتك الإضافية.');
    } catch (e) { toast(e.message, 'bad'); btn.disabled = false; btn.classList.remove('loading'); }
  });
}

function openPlanLimit() {
  const cur = myPlan();
  modal(`
    <div class="modal-head">
      <div class="modal-title">وصلت لحد باقتك</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>
    <div style="text-align:center">${fennec('card', 110)}</div>
    <p class="body-sm text-2 mb-4" style="text-align:center">باقتك (${esc(PLAN_AR[cur])}) تسمح بـ ${esc(planCardsText(cur))}.
      ${cur === 'free' ? 'اشترك في باقة لإصدار المزيد.' : 'رقِّ باقتك أو انتظر تجدد حصتك الشهرية.'}</p>
    <button class="btn btn-primary btn-block" id="goPlans" type="button">عرض الباقات</button>
  `);
  onTap('#goPlans', () => { closeModal(); go('plans'); });
}

function depositMethods() {
  const m = S.config.methods || {};
  const order = String(S.config.method_order || 'libyana,almadar,usdt,bank,binance').split(',').map(x => x.trim());
  const keys = [...new Set([...order, ...Object.keys(m)])].filter(k => m[k] && m[k].on !== false);
  return keys.map(k => ({ key: k, ...m[k] }));
}

async function openDeposit() {
  const list = depositMethods();
  modal(`
    <div class="modal-head">
      <div class="modal-title">إضافة رصيد</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>
    ${list.length ? `<div class="list">
      ${list.map(m => `
        <div class="list-row" data-method="${esc(m.key)}" role="button" tabindex="0">
          <div class="list-icon brand">${m.logo ? `<img src="${esc(m.logo)}" alt="" style="width:100%;height:100%;object-fit:contain">` : svg(I.up, 2)}</div>
          <div class="list-content">
            <div class="list-title">${esc(m.label || m.key)}</div>
            <div class="list-meta">${m.key === 'usdt' ? '⚡ تلقائي عبر شبكة TRC20' : (m.key === 'libyana' || m.key === 'almadar') ? ((m.mode || S.config.deposit_mode) === 'manual' ? 'يُراجع يدويًا خلال وقت قصير' : '⚡ تلقائي فور وصول الحوالة') : m.receipt === false ? 'برقم العملية — يُراجع يدويًا' : 'بإرفاق إيصال — يُراجع يدويًا'}</div>
          </div>
          <div class="list-end">${(m.key === 'usdt' || ((m.key === 'libyana' || m.key === 'almadar') && (m.mode || S.config.deposit_mode) !== 'manual'))
            ? '<span class="chip-auto">⚡ تلقائي</span>' : '<span class="chip-auto chip-manual">يدوي</span>'}</div>
        </div>`).join('')}
    </div>` : '<p class="body-sm text-2">لا توجد طرق إيداع مفعّلة حاليًا.</p>'}
    <button class="btn btn-secondary btn-block" style="margin-top:16px" data-act="close-modal">إلغاء</button>
  `);
  $$('[data-method]').forEach(b => b.onclick = () => {
    const k = b.dataset.method;
    if (k === 'libyana' || k === 'almadar') return openDepositMethod(k);
    if (k === 'usdt') return openUsdt();
    return openManualDeposit(k);
  });
}

function compressImage(file, maxW = 1200, q = 0.7) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('اختر صورة'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let out = c.toDataURL('image/jpeg', q);
      if (out.length > 390000) out = c.toDataURL('image/jpeg', 0.45);
      if (out.length > 390000) return reject(new Error('الصورة كبيرة جدًا'));
      resolve(out);
    };
    img.onerror = () => reject(new Error('تعذّر قراءة الصورة'));
    img.src = url;
  });
}

function openManualDeposit(key) {
  const m = (S.config.methods || {})[key] || {};
  const cur = key === 'binance' ? 'USDT' : 'د.ل';
  let proof = '';
  modal(`
    <div class="modal-head">
      <div class="modal-title">إيداع عبر ${esc(m.label || key)}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>
    ${(m.fields || []).map(f => `
      <div class="field mb-2">
        <div class="field-label">${esc(f.label)}</div>
        <div class="copy-box">
          <div class="copy-value" dir="auto">${esc(f.value)}</div>
          ${f.copy ? `<button class="copy-btn" data-act="copy" data-copy-text="${esc(f.value)}" aria-label="نسخ">${svg(I.copy, 2)}</button>` : ''}
        </div>
      </div>`).join('')}
    <div class="field mb-3" style="margin-top:12px">
      <label class="field-label" for="mdAmount">المبلغ المحوَّل (${cur})</label>
      <input class="input" id="mdAmount" type="number" inputmode="decimal" step="0.01" min="1">
      <span class="field-hint" id="mdQuote"></span>
    </div>
    ${m.receipt === false ? `
    <div class="field mb-3">
      <label class="field-label" for="mdRef">رقم العملية / المرجع</label>
      <input class="input" id="mdRef" dir="ltr" maxlength="100">
    </div>` : `
    <div class="field mb-3">
      <label class="field-label" for="mdProof">صورة الإيصال</label>
      <input class="input" id="mdProof" type="file" accept="image/*">
    </div>`}
    <div class="field mb-4">
      <label class="field-label" for="mdNote">ملاحظة (اختياري)</label>
      <input class="input" id="mdNote" maxlength="200">
    </div>
    <button class="btn btn-primary btn-block" id="mdSend" type="button">إرسال للمراجعة</button>
  `);
  $('#mdAmount').oninput = () => {
    const a = n($('#mdAmount').value);
    $('#mdQuote').textContent = a > 0 ? `سيُضاف ${usd(a / (n(m.rate) || 1))} بعد المراجعة` : '';
  };
  if ($('#mdProof')) $('#mdProof').onchange = async e => {
    try { proof = await compressImage(e.target.files[0]); toast('أُرفقت الصورة', 'ok'); }
    catch (err) { proof = ''; toast(err.message, 'bad'); }
  };
  onTap('#mdSend', async () => {
    const amount = n($('#mdAmount').value);
    if (!(amount > 0)) return toast('أدخل المبلغ', 'bad');
    const reference = $('#mdRef') ? $('#mdRef').value.trim() : '';
    if (m.receipt !== false && !proof) return toast('أرفق صورة الإيصال', 'bad');
    if (m.receipt === false && reference.length < 3) return toast('أدخل رقم العملية', 'bad');
    const btn = $('#mdSend'); btn.disabled = true; btn.classList.add('loading');
    try {
      await api('/api/wallet/manual-deposit', { method: key, amount, proof, reference, note: $('#mdNote').value.trim() });
      stickerModal('deposit', 'wait', 'وصل طلب الإيداع', 'يُضاف الرصيد بعد مراجعة الإيصال خلال وقت قصير.');
    } catch (e) { toast(e.message, 'bad'); btn.disabled = false; btn.classList.remove('loading'); }
  });
}

function openUsdt() {
  const m = (S.config.methods || {}).usdt || {};
  modal(`
    <div class="modal-head">
      <div class="modal-title">إيداع USDT (TRC20)</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>
    <div id="usdtBody">
      <div class="field mb-4">
        <label class="field-label" for="uAmt">المبلغ (من ${esc(String(m.min || 5))} إلى ${esc(String(m.max || 1000))} USDT)</label>
        <input class="input" id="uAmt" type="number" inputmode="decimal" step="0.01">
      </div>
      <button class="btn btn-primary btn-block" id="uInv" type="button">إنشاء فاتورة</button>
    </div>
  `);
  onTap('#uInv', async () => {
    const amount = n($('#uAmt').value);
    if (!(amount > 0)) return toast('أدخل المبلغ', 'bad');
    const btn = $('#uInv'); btn.disabled = true; btn.classList.add('loading');
    try {
      const { invoice: inv } = await api('/api/wallet/usdt/invoice', { amount_usd: amount });
      $('#usdtBody').innerHTML = `
        <div class="alert alert-warning mb-3">${svg(I.help, 2)}<div>حوّل المبلغ <b>بالضبط</b> بما فيه الكسور، عبر شبكة <b>TRC20</b> فقط.</div></div>
        <div class="field mb-2"><div class="field-label">المبلغ المطلوب</div>
          <div class="copy-box"><div class="copy-value mono" dir="ltr" style="font-size:16px;font-weight:700">${esc(inv.pay_amount.toFixed(4))}</div>
          <button class="copy-btn" data-act="copy" data-copy-text="${esc(inv.pay_amount.toFixed(4))}" aria-label="نسخ">${svg(I.copy, 2)}</button></div></div>
        <div class="field mb-3"><div class="field-label">العنوان</div>
          <div class="copy-box"><div class="copy-value mono" dir="ltr" style="font-size:11px;word-break:break-all">${esc(inv.address)}</div>
          <button class="copy-btn" data-act="copy" data-copy-text="${esc(inv.address)}" aria-label="نسخ">${svg(I.copy, 2)}</button></div></div>
        <p class="caption mb-3">صالحة حتى ${esc(new Date(inv.expires_ms).toLocaleTimeString('ar-LY', { hour: '2-digit', minute: '2-digit' }))}</p>
        <button class="btn btn-primary btn-block" id="uChk" type="button">حوّلت — تحقّق الآن</button>`;
      onTap('#uChk', async () => {
        const b = $('#uChk'); b.disabled = true; b.classList.add('loading');
        try {
          const r = await api('/api/wallet/usdt/verify', { invoice_id: inv.id });
          if (r.paid) { closeModal(); toast('أُضيف ' + usd(r.credited) + ' إلى محفظتك', 'ok'); }
          else toast('لم يصل التحويل بعد — انتظر دقيقة وأعد المحاولة', 'bad');
        } catch (e) { toast(e.message, 'bad'); }
        b.disabled = false; b.classList.remove('loading');
      });
    } catch (e) { toast(e.message, 'bad'); btn.disabled = false; btn.classList.remove('loading'); }
  });
}

/* ─── Withdraw & transfer ─── */
function openWithdraw() {
  const w = S.config.withdraw || {};
  if (!w.on) return toast('السحب غير متاح حاليًا', 'bad');
  const key = newIdemKey();
  modal(`
    <div class="modal-head">
      <div class="modal-title">سحب الرصيد</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>
    <div class="field mb-3">
      <label class="field-label" for="wdM">الطريقة</label>
      <select class="input" id="wdM">${(w.methods || []).map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select>
    </div>
    <div class="field mb-3">
      <label class="field-label" for="wdDest">الوجهة (رقم الهاتف / الحساب / عنوان USDT)</label>
      <input class="input" id="wdDest" dir="ltr" maxlength="120">
    </div>
    <div class="field mb-3">
      <label class="field-label" for="wdAmt">المبلغ بالدولار (${esc(String(w.min))}–${esc(String(w.max))})</label>
      <input class="input" id="wdAmt" type="number" inputmode="decimal" step="0.01">
      <span class="field-hint" id="wdQ"></span>
    </div>
    <button class="btn btn-primary btn-block" id="wdGo" type="button">طلب السحب</button>
  `);
  $('#wdAmt').oninput = () => {
    const a = n($('#wdAmt').value);
    const fee = Math.round(((w.fee_fixed || 0) + a * (w.fee_pct || 0) / 100) * 100) / 100;
    $('#wdQ').textContent = a > 0 ? `الرسوم ${usd(fee)} — تستلم ${usd(Math.max(0, a - fee))}` : '';
  };
  onTap('#wdGo', async () => {
    const btn = $('#wdGo'); btn.disabled = true; btn.classList.add('loading');
    try {
      await api('/api/wallet/withdraw', { method: $('#wdM').value, destination: $('#wdDest').value.trim(), amount_usd: n($('#wdAmt').value), idempotency_key: key });
      closeModal(); toast('وصل طلب السحب — يُنفَّذ بعد المراجعة', 'ok');
    } catch (e) { toast(e.message, 'bad'); btn.disabled = false; btn.classList.remove('loading'); }
  });
}

function openTransfer() {
  const t = S.config.transfer || {};
  if (!t.on) return toast('التحويل غير متاح حاليًا', 'bad');
  if (!S.profile.phone_verified) { toast('وثّق رقمك أولًا لتتمكن من التحويل', 'bad'); return openPhoneVerify(); }
  const key = newIdemKey();
  modal(`
    <div class="modal-head">
      <div class="modal-title">تحويل لمستخدم</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>
    <div class="field mb-3">
      <label class="field-label" for="trTo">رقم هاتف المستلم (الموثّق في كاردو)</label>
      <input class="input" id="trTo" dir="ltr" inputmode="numeric" maxlength="14" placeholder="0912345678">
    </div>
    <div class="field mb-4">
      <label class="field-label" for="trAmt">المبلغ بالدولار</label>
      <input class="input" id="trAmt" type="number" inputmode="decimal" step="0.01">
      ${t.fee_pct ? `<span class="field-hint">رسوم ${esc(String(t.fee_pct))}%</span>` : ''}
    </div>
    <button class="btn btn-primary btn-block" id="trGo" type="button">تحويل</button>
  `);
  onTap('#trGo', async () => {
    const to = $('#trTo').value.trim(), amt = n($('#trAmt').value);
    if (to.replace(/\D/g, '').length < 9) return toast('اكتب رقم المستلم كاملًا', 'bad');
    if (!(amt > 0)) return toast('أدخل المبلغ', 'bad');
    const btn = $('#trGo'); btn.disabled = true; btn.classList.add('loading');
    try {
      await api('/api/wallet/transfer', { to, amount_usd: amt, idempotency_key: key });
      closeModal(); toast('تم التحويل', 'ok');
    } catch (e) { toast(e.message, 'bad'); btn.disabled = false; btn.classList.remove('loading'); }
  });
}


/* ═══════════════════════════════════════════════════════════
   v8 — Dock, banners, notifications, email verify, polish
   ═══════════════════════════════════════════════════════════ */

const haptic = { tap: () => navigator.vibrate?.(8), ok: () => navigator.vibrate?.([10, 40, 18]), bad: () => navigator.vibrate?.([25, 30, 25]) };

function greeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'صباح الخير';
  if (h >= 12 && h < 17) return 'نهارك سعيد';
  if (h >= 17 && h < 23) return 'مساء الخير';
  return 'سهرة سعيدة';
}

/* ─── Count-up للأرقام ─── */
function countUp(el, to, fmt) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = to;
  if (Math.abs(to - from) < 0.005 || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), d = 700;
  const step = now => {
    const p = Math.min(1, (now - t0) / d), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function paintDock() {
  const dock = $('#balDock');
  if (!dock) return;
  dock.hidden = !S.user;
  const v = n(S.profile.wallet_balance);
  countUp($('#dockVal'), v * rate(), x => lyd(x));
  $('#dockUsd').textContent = usd(v);
}

/* ─── Banners ─── */
let _bnTimer = null;
function bannersHtml() {
  const b = (S.config.banners || []).filter(x => x.img);
  if (!b.length) return '';
  return `
    <div class="bn-wrap mb-5" id="bnWrap">
      <div class="bn-track" id="bnTrack">
        ${b.map((x, i) => `<a class="bn-slide" ${x.link && /^https:\/\//.test(x.link) ? `href="${esc(x.link)}" target="_blank" rel="noopener"` : ''} data-i="${i}">
          <img src="${esc(x.img)}" alt="${esc(x.title || '')}" ${i ? 'loading="lazy"' : ''} decoding="async">
          ${x.title ? `<span class="bn-title">${esc(x.title)}</span>` : ''}</a>`).join('')}
      </div>
      ${b.length > 1 ? `<div class="bn-dots">${b.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
    </div>`;
}
function bindBanners() {
  clearInterval(_bnTimer);
  const tr = $('#bnTrack'); if (!tr) return;
  const dots = $$('.bn-dots i');
  const count = tr.children.length;
  const sync = () => { const i = Math.round(Math.abs(tr.scrollLeft) / tr.clientWidth); dots.forEach((d, k) => d.classList.toggle('on', k === i)); };
  tr.addEventListener('scroll', () => { clearTimeout(tr._s); tr._s = setTimeout(sync, 60); }, { passive: true });
  if (count > 1) {
    const sec = Math.max(3, Number(S.config.banner_rotate_sec) || 6);
    _bnTimer = setInterval(() => {
      if (!document.body.contains(tr)) return clearInterval(_bnTimer);
      const i = (Math.round(Math.abs(tr.scrollLeft) / tr.clientWidth) + 1) % count;
      tr.scrollTo({ left: (document.dir === 'rtl' || document.documentElement.dir === 'rtl' ? -1 : 1) * i * tr.clientWidth, behavior: 'smooth' });
    }, sec * 1000);
  }
}

/* ─── Email verification ─── */
function needsEmailVerify() { return S.config.mail_on === true && S.profile && S.profile.email_verified !== true; }

function verifyBannerHtml() {
  if (!needsEmailVerify()) return '';
  return `<div class="alert alert-warning mb-4" style="align-items:center">${svg(I.help, 2)}
    <div style="flex:1">أكّد بريدك الإلكتروني لتتمكن من إصدار البطاقات والسحب وتصلك الإشعارات.</div>
    <button class="btn btn-primary btn-sm" id="evOpen" type="button">تأكيد</button></div>`;
}

function openEmailVerify() {
  modal(`
    <div class="modal-head"><div class="modal-title">تأكيد البريد الإلكتروني</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    <div style="text-align:center">${fennec(Date.now() - Date.parse(S.profile.created_at || 0) < 15 * 60000 ? 'welcome' : 'mail', 120)}</div>
    ${Date.now() - Date.parse(S.profile.created_at || 0) < 15 * 60000 ? '<div class="h4" style="text-align:center;margin-bottom:6px">مرحبتين في كاردو 👋</div>' : ''}
    <p class="body-sm text-2 mb-4" style="text-align:center">سنرسل رمزًا من 6 أرقام إلى <b dir="ltr">${esc(S.profile.email || S.user?.email || '')}</b></p>
    <button class="btn btn-secondary btn-block mb-4" id="evSend" type="button">إرسال الرمز</button>
    <div class="field mb-4"><label class="field-label" for="evCode">الرمز</label>
      <input class="input otp-input" id="evCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" dir="ltr" placeholder="••••••"></div>
    <button class="btn btn-primary btn-block" id="evGo" type="button">تأكيد</button>`);
  onTap('#evSend', async () => {
    const b = $('#evSend'); b.disabled = true; b.classList.add('loading');
    try {
      const r = await api('/api/email/send-code', {});
      if (r.already) { closeModal(); return toast('بريدك مؤكَّد بالفعل', 'ok'); }
      toast('أُرسل الرمز إلى ' + r.sent_to, 'ok'); $('#evCode').focus();
      let t = 60; b.classList.remove('loading');
      const it = setInterval(() => { t--; b.textContent = t > 0 ? `إعادة الإرسال بعد ${t}ث` : 'إعادة الإرسال'; if (t <= 0) { clearInterval(it); b.disabled = false; } }, 1000);
    } catch (e) { toast(e.message, 'bad'); b.disabled = false; b.classList.remove('loading'); }
  });
  onTap('#evGo', async () => {
    const code = ($('#evCode').value || '').trim();
    if (code.replace(/\D/g, '').length !== 6) return toast('أدخل الرمز كاملًا (6 أرقام)', 'bad');
    const b = $('#evGo'); b.disabled = true; b.classList.add('loading');
    try { await api('/api/email/verify-code', { code }); haptic.ok(); closeModal(); toast('تم تأكيد بريدك ✓', 'ok'); }
    catch (e) { haptic.bad(); toast(e.message, 'bad'); b.disabled = false; b.classList.remove('loading'); }
  });
}

/* ─── In-app notifications ─── */
function subscribeNotifications(uid) {
  S.unsub.push(onSnapshot(query(collection(db, 'notifications'), where('uid', '==', uid), limit(40)), s => {
    const prev = new Set((S.notifs || []).map(x => x.id));
    S.notifs = sortByDate(s.docs.map(d => ({ id: d.id, ...d.data() })));
    const fresh = S.notifs.filter(x => !x.read && !prev.has(x.id));
    if (S._notifsLoaded && fresh.length) {
      haptic.ok(); toast(fresh[0].title, 'ok');
      if (fresh[0].kind === 'ticket_reply' && S.page === 'support') setTimeout(() => followLink(fresh[0].link), 400);
    }
    S._notifsLoaded = true;
    paintBell();
  }, e => console.warn('notifs:', e.code)));
}

function paintBell() {
  const btn = $('#bellBtn'); if (!btn) return;
  const unread = (S.notifs || []).filter(x => !x.read).length;
  let dot = btn.querySelector('.bell-dot');
  if (unread && !dot) { dot = document.createElement('span'); dot.className = 'bell-dot'; btn.appendChild(dot); }
  if (dot) { if (unread) dot.textContent = unread > 9 ? '9+' : String(unread); else dot.remove(); }
  btn.setAttribute('aria-label', unread ? `الإشعارات (${unread} غير مقروءة)` : 'الإشعارات');
}

function openNotifications() {
  const list = S.notifs || [];
  modal(`
    <div class="modal-head"><div class="modal-title">الإشعارات</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    ${list.length ? `<div class="notif-list">${list.map(x => `
      <div class="notif ${x.read ? '' : 'unread'} ${x.link ? 'has-link' : ''}" ${x.link ? `data-nlink="${esc(x.link)}" role="button" tabindex="0"` : ''}>
        <div class="notif-title">${esc(x.title)}</div>
        <div class="notif-body">${esc(x.body)}</div>
        <div class="caption">${esc(dt(x.created_at))}</div>
      </div>`).join('')}</div>`
      : `<div style="text-align:center;padding:28px 0"><div class="empty-icon" style="margin:0 auto 12px">${svg(I.bell, 2)}</div><div class="h4">لا إشعارات بعد</div></div>`}
  `);
  if (list.some(x => !x.read)) api('/api/notify/read', {}).catch(() => {});
  document.querySelectorAll('[data-nlink]').forEach(el => el.onclick = () => { closeModal(); followLink(el.dataset.nlink); });
}

/* ─── PWA ─── */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

/* ═══ v10 — محادثة التذكرة، روابط الإشعارات، صفحات المنتجات ═══ */
async function openTicket(id) {
  let t = (S.tickets || []).find(x => x.id === id);
  if (!t) { try { const d = await getDoc(doc(db, 'tickets', id)); if (d.exists()) t = { id, ...d.data() }; } catch {} }
  if (!t) return toast('تعذّر فتح التذكرة', 'bad');
  const msgs = Array.isArray(t.messages) ? t.messages : [];
  modal(`
    <div class="modal-head"><div class="modal-title">${esc(t.subject || 'تذكرة')}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    ${msgs.length && msgs[msgs.length - 1].by === 'admin' ? `<div style="text-align:center">${fennec('mail', 90, 'ticket')}</div>` : ''}
    <div class="chat">${msgs.map(m => `
      <div class="bubble ${m.by === 'admin' ? 'from-staff' : 'from-me'}">
        <div class="bubble-who">${m.by === 'admin' ? 'فريق كاردو' : 'أنت'}</div>
        <div class="bubble-text">${esc(m.text)}</div>
        <div class="bubble-at">${esc(dt(m.at))}</div>
      </div>`).join('')}</div>
    ${t.status === 'closed' ? '<p class="caption" style="text-align:center;margin-top:10px">التذكرة مغلقة — افتح تذكرة جديدة إن احتجت</p>' : `
      <div class="field" style="margin-top:12px"><textarea class="input" id="tkReply" rows="3" maxlength="1500" placeholder="اكتب ردك…"></textarea></div>
      <button class="btn btn-primary btn-block" id="tkSend" type="button" style="margin-top:8px">إرسال</button>`}
  `);
  const chat = document.querySelector('.chat'); if (chat) chat.scrollTop = chat.scrollHeight;
  onTap('#tkSend', async () => {
    const m = ($('#tkReply').value || '').trim();
    if (!m) return toast('اكتب ردك', 'bad');
    const b = $('#tkSend'); b.disabled = true; b.classList.add('loading');
    try { await api('/api/ticket/reply', { id, message: m }); toast('أُرسل ردك ✓', 'ok'); closeModal(); }
    catch (e) { toast(e.message, 'bad'); b.disabled = false; b.classList.remove('loading'); }
  });
}

function followLink(link) {
  const [kind, id] = String(link || '').split(':');
  if (kind === 'ticket' && id) { go('support'); setTimeout(() => openTicket(id), 300); return true; }
  if (kind === 'order' || kind === 'morders') { go('orders'); return true; }
  if (kind === 'mcase' && id) { go('orders'); setTimeout(() => openCase(id, 'customer'), 700); return true; }
  if (kind === 'mstore') { S.mstoreTab = id || 'home'; S.mine = null; go('mystore'); return true; }
  if (kind === 'card') { go('cards'); return true; }
  return false;
}

function productUrl(p) { return `${location.origin}${location.pathname.replace(/[^/]*$/, '')}product.html?id=${encodeURIComponent(p.id)}`; }

// روابط خارجية: index.html#p=ID (من صفحة المنتج) — تُفتح بعد تحميل المتجر، وتُحفظ لما بعد تسجيل الدخول
function pendingProductFromHash() {
  if (/[#&]join\b/.test(location.hash)) { try { sessionStorage.setItem('kardo_next_join', '1'); } catch {} }
  const ms = /[#&]m=([A-Za-z0-9_-]{1,60})/.exec(location.hash);
  if (ms) { try { sessionStorage.setItem('kardo_next_m', ms[1]); } catch {} history.replaceState(null, '', location.pathname + location.search); }
  const m = /[#&]p=([A-Za-z0-9_-]{1,60})/.exec(location.hash);
  if (m) { try { sessionStorage.setItem('kardo_next_p', m[1]); } catch {} history.replaceState(null, '', location.pathname + location.search); }
}
pendingProductFromHash();
function openPendingJoin() {
  let j = null; try { j = sessionStorage.getItem('kardo_next_join'); } catch {}
  if (!j || !S.user) return;
  try { sessionStorage.removeItem('kardo_next_join'); } catch {}
  setTimeout(() => openJoinMerchant(), 400);
}
function openPendingStore() {
  openPendingJoin();
  let id = null; try { id = sessionStorage.getItem('kardo_next_m'); } catch {}
  if (!id || !S.user || !S.mk.loaded) return;
  try { sessionStorage.removeItem('kardo_next_m'); } catch {}
  if (mById(id)) { S.curStore = id; go('store'); }
}
function openPendingProduct() {
  let id = null; try { id = sessionStorage.getItem('kardo_next_p'); } catch {}
  if (!id || !S.user || !S.catalog.loaded) return;
  try { sessionStorage.removeItem('kardo_next_p'); } catch {}
  if (prodById(id)) openProduct(id);
}

/* ═══ v11 — رمز التحقق 3D Secure ═══ */
let _otpTimer = null;
function openOtp() {
  clearInterval(_otpTimer);
  modal(`
    <div class="modal-head"><div class="modal-title">رمز التحقق (3D Secure)</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    <div id="otpBody">
      <p class="body-sm text-2 mb-3">عند الدفع ببطاقتك قد يطلب الموقع <b>رمز تحقق</b>. اكتب <b>مبلغ العملية بالدولار</b> كما يظهر في صفحة الدفع، وسيظهر الرمز هنا تلقائيًا خلال دقيقة تقريبًا.</p>
      <div class="field mb-3"><label class="field-label" for="otpAmt">مبلغ العملية ($)</label>
        <input class="input" id="otpAmt" type="number" inputmode="decimal" step="0.01" min="0.01" dir="ltr" placeholder="مثال: 9.99"></div>
      <button class="btn btn-primary btn-block" id="otpGo" type="button">انتظار الرمز</button>
      <p class="otp-fee">⚠️ يُخصم من البطاقة ${esc('$' + Number(((S.config.manual_cards || {}).otp_fee) ?? 0.03).toFixed(2))} رسوم تحقق عن كل عملية 3D Secure، حتى لو لم تنجح العملية.</p>
    </div>`);
  onTap('#otpGo', () => {
    const amount = Number($('#otpAmt').value);
    if (!(amount > 0)) return toast('اكتب مبلغ العملية', 'bad');
    const box = $('#otpBody');
    box.innerHTML = `<div style="text-align:center;padding:10px 0">${fennec('wait', 110)}
      <div class="h4" style="margin-bottom:6px">في انتظار الرمز…</div>
      <p class="caption">أكمل الدفع في الموقع، وسيظهر الرمز هنا فور وصوله. لا تغلق هذه النافذة.</p></div>`;
    const t0 = Date.now();
    const poll = async () => {
      if (!document.getElementById('otpBody')) return clearInterval(_otpTimer);
      try {
        const r = await api('/api/otp/claim', { amount });
        if (r.code) {
          clearInterval(_otpTimer); haptic.ok();
          box.innerHTML = `
            <div style="text-align:center">
              <div class="caption mb-2">${esc(r.merchant || 'عملية')} · $${esc(Number(r.amount).toFixed(2))}</div>
              <div class="otp-code" dir="ltr">${esc(r.code)}</div>
              <button class="btn btn-primary btn-block" id="otpCopy" type="button" style="margin-top:12px">${svg(I.copy, 2)} نسخ الرمز</button>
              <p class="caption" id="otpLeft" style="margin-top:10px"></p>
              <p class="caption" style="color:var(--error);margin-top:6px">لا تشارك هذا الرمز مع أي شخص.</p>
            </div>`;
          onTap('#otpCopy', async () => { try { await navigator.clipboard.writeText(r.code); toast('نُسخ الرمز ✓', 'ok'); } catch {} });
          const tick = () => {
            const left = Math.max(0, Math.round((r.valid_until - Date.now()) / 1000));
            const el = $('#otpLeft'); if (!el) return clearInterval(_otpTimer);
            el.textContent = left ? `صالح لمدة ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'انتهت صلاحية الرمز';
          };
          tick(); _otpTimer = setInterval(tick, 1000);
          return;
        }
      } catch (e) { clearInterval(_otpTimer); box.innerHTML = `<p class="body-sm" style="color:var(--error)">${esc(e.message)}</p>`; return; }
      if (Date.now() - t0 > 4 * 60000) {
        clearInterval(_otpTimer);
        box.innerHTML = `<div style="text-align:center">${fennec('error', 100)}<p class="body-sm">لم يصل رمز بهذا المبلغ. تأكد من المبلغ وحاول مرة أخرى، أو تواصل مع الدعم.</p>
          <button class="btn btn-secondary btn-block" id="otpRetry" type="button">حاول مجددًا</button></div>`;
        onTap('#otpRetry', () => openOtp());
      }
    };
    poll(); _otpTimer = setInterval(poll, 6000);
  });
}


/* ═══════════════════════════════════════════════════════════
   v12 — المتاجر الموثوقة
   ═══════════════════════════════════════════════════════════ */
S.mk = { loaded: false, merchants: [], services: [], categories: [] };
S.mkCat = ''; S.mkQ = ''; S.curStore = null; S.mine = null; S.mstoreTab = 'home';
let _mkLoading = false;
async function loadMerchants(force) {
  if (_mkLoading || (S.mk.loaded && !force)) return;
  _mkLoading = true;
  try { const d = await apiGet('/api/merchants/list'); S.mk = { ...d, loaded: true }; setTimeout(openPendingStore, 50); }
  catch { S.mk = { ...S.mk, loaded: true, error: true }; }
  _mkLoading = false; render();
}
async function loadMine() {
  try { const d = await api('/api/m/me', {}); S.mine = d.merchant ? d : { merchant: null }; } catch { S.mine = { merchant: null }; }
  render();
}
const mById = id => (S.mk.merchants || []).find(m => m.id === id);
const mServices = mid => (S.mk.services || []).filter(s => s.mid === mid);
const stars = r => r ? `<span class="m-rate">★ ${esc(Number(r).toFixed(1))}</span>` : '';
const mLogo = (m, cls = 'm-logo') => `<span class="${cls}">${m.logo ? `<img src="${esc(m.logo)}" alt="" loading="lazy">` : `<b>${esc((m.name || '؟').trim().charAt(0))}</b>`}</span>`;

function openMReport(mid, oid = '') {
  const m = mById(mid) || { name: 'المتجر' };
  modal(`
    <div class="modal-head"><div class="modal-title">إبلاغ عن ${esc(m.name)}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    <p class="caption mb-3">يصل بلاغك للتاجر ولإدارة كاردو معًا، ونتابعه بجدية.</p>
    <div class="field mb-3"><label class="field-label" for="rpR">السبب</label>
      <select class="input" id="rpR"><option>لم يصل الطلب</option><option>الكود لا يعمل</option><option>التاجر لا يرد</option><option>احتيال أو نصب</option><option>سعر مخالف</option><option>سبب آخر</option></select></div>
    <div class="field mb-3"><label class="field-label" for="rpT">التفاصيل</label><textarea class="input" id="rpT" rows="4" maxlength="1000" placeholder="اشرح ما حدث…"></textarea></div>
    <button class="btn btn-primary btn-block" id="rpGo" type="button">إرسال البلاغ</button>`);
  onTap('#rpGo', async () => {
    const text = ($('#rpT').value || '').trim();
    if (text.length < 5) return toast('اكتب التفاصيل', 'bad');
    try { await api('/api/m/report', { mid, oid, reason: $('#rpR').value, text }); stickerModal('ticket', 'mail', 'وصل بلاغك ✓', 'أُبلغ التاجر وإدارة كاردو، وسنتابع معك.'); }
    catch (e) { toast(e.message, 'bad'); }
  });
}

const MO_ST = { pending: ['badge-warning', 'بانتظار تأكيد الدفع'], processing: ['badge-warning', 'قيد التنفيذ'], completed: ['badge-success', 'مكتمل'], rejected: ['badge-error', 'مرفوض'] };
function mOrderRow(o, forMerchant) {
  const st = MO_ST[o.status] || ['badge', o.status];
  return `<div class="list-row" data-${forMerchant ? 'mso' : 'mo'}="${esc(o.id)}" role="button" tabindex="0">
    <div class="list-icon brand">🛍️</div>
    <div class="list-content"><div class="list-title">${esc(o.service_name)}</div>
      <div class="list-meta">${esc(forMerchant ? (o.customer_name || 'زبون') : o.merchant_name)} · ${esc(dt(o.created_at))}</div></div>
    <div class="list-end"><div class="list-amount">${esc(lyd(o.price))}</div>
      <span class="badge ${st[0]}" style="margin-top:4px;font-size:10px">${esc(st[1])}</span></div>
  </div>`;
}

function openMsStock(sid) {
  const s = (S.mine.services || []).find(x => x.id === sid); if (!s) return;
  modal(`
    <div class="modal-head"><div class="modal-title">أكواد: ${esc(s.name)}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    <p class="caption mb-2">المخزون الحالي: <b>${s.stock}</b>. الأكواد تُحفظ مشفّرة، وتُسلَّم تلقائيًا عند تأكيدك للدفع.</p>
    <textarea class="input mb-3" id="skC" rows="8" dir="ltr" placeholder="كل كود في سطر"></textarea>
    <button class="btn btn-primary btn-block" id="skGo" type="button">إضافة</button>`);
  onTap('#skGo', async () => {
    try { const r = await api('/api/m/stock/add', { sid, codes: $('#skC').value }); closeModal(); toast(`أُضيف ${r.added} كود ✓`, 'ok'); loadMine(); loadMerchants(true); }
    catch (e) { toast(e.message, 'bad'); }
  });
}

const TIER = { gold: '🥇 ذهبي', silver: '🥈 فضي' };
const openBadge = m => m.open === false ? '<span class="m-closed">🔴 مغلق</span>' : '<span class="m-open">🟢 مفتوح</span>';
const tierBadge = m => m.tier ? `<span class="m-tier m-tier-${m.tier}">${TIER[m.tier]}</span>` : '';
const favs = () => (S.profile && Array.isArray(S.profile.fav_merchants)) ? S.profile.fav_merchants : [];

function merchantTile(m) {
  return `<button class="m-tile ${m.promo ? 'm-promo' : ''}" data-store="${esc(m.id)}">
    ${m.promo ? '<span class="m-ad">مميّز</span>' : ''}
    ${mLogo(m)}
    <span class="m-tile-name">${esc(m.name)} <span class="m-ok" title="موثّق">✓</span></span>
    <span class="caption">${esc(m.category)}${m.open === false ? ' · 🔴 مغلق' : ''}</span>
    ${tierBadge(m)}
  </button>`;
}
function merchantRow(m) {
  return `<button class="prow" data-store="${esc(m.id)}">
    ${mLogo(m, 'prow-img')}
    <span class="prow-body"><span class="prow-name">${esc(m.name)} <span class="m-ok">✓ موثّق</span> ${tierBadge(m)}</span>
      <span class="caption" style="display:block">${esc(m.category)} · ${mServices(m.id).length} خدمة${m.orders_done ? ` · ${m.orders_done} طلب مكتمل` : ''}</span>
      <span class="caption" style="display:block">${openBadge(m)} ${stars(m.rating)}${m.avg_confirm_min !== null && m.avg_confirm_min !== undefined ? ` · ⏱️ يؤكد خلال ~${m.avg_confirm_min || 1} د` : ''}</span></span>
    <span class="prow-add" aria-hidden="true">←</span>
  </button>`;
}
function svcPriceHtml(s) {
  return `${esc(lyd(s.price))}${s.old_price ? ` <s class="caption">${esc(lyd(s.old_price))}</s> <span class="m-off">-${Math.round((1 - s.price / s.old_price) * 100)}%</span>` : ''}`;
}

function merchantsSection() {
  if (!S.mk.loaded) { loadMerchants(); return `<div class="h4 mb-3">المتاجر الموثوقة</div><div class="m-grid mb-5">${'<div class="skeleton" style="height:118px;border-radius:18px"></div>'.repeat(3)}</div>`; }
  const list = S.mk.merchants || [];
  if (!list.length) return '';
  const promos = list.filter(m => m.promo);
  const fav = list.filter(m => favs().includes(m.id));
  return `
    ${promos.length ? `<div class="m-promo-strip mb-4">${promos.slice(0, 5).map(m => `
      <button class="m-promo-card" data-store="${esc(m.id)}">${m.cover ? `<img src="${esc(m.cover)}" alt="">` : ''}
        <span class="m-promo-info">${mLogo(m)}<span><b>${esc(m.name)}</b><span class="caption" style="display:block">${esc(m.category)} · متجر مميّز</span></span></span></button>`).join('')}</div>` : ''}
    ${fav.length ? `<div class="h4 mb-3">⭐ متاجري المفضلة</div><div class="m-grid mb-4">${fav.slice(0, 6).map(merchantTile).join('')}</div>` : ''}
    <div class="flex-between mb-3"><div class="h4">المتاجر الموثوقة</div>
      <button class="btn btn-ghost btn-sm" data-nav="stores">عرض الكل ${svg(I.back, 2)}</button></div>
    <div class="m-grid mb-5">${list.slice(0, 6).map(merchantTile).join('')}</div>`;
}

function vStores() {
  if (!S.mk.loaded) loadMerchants();
  const q = (S.mkQ || '').trim().toLowerCase();
  const all = S.mk.merchants || [];
  const list = all.filter(m => (!S.mkCat || m.category === S.mkCat)
    && (!q || (m.name + ' ' + m.bio + ' ' + mServices(m.id).map(s => s.name).join(' ')).toLowerCase().includes(q)));
  const svcHits = q.length >= 2 ? (S.mk.services || []).filter(s => (s.name + ' ' + (s.section || '')).toLowerCase().includes(q) && mById(s.mid))
    .sort((a, b) => a.price - b.price).slice(0, 20) : [];
  const cats = (S.mk.categories || []).filter(c => all.some(m => m.category === c));
  const fav = all.filter(m => favs().includes(m.id));
  return `
  <div class="page-enter">
    <div class="mb-4"><h1 class="h2" style="margin-bottom:6px">المتاجر الموثوقة</h1>
      <p class="body-sm text-2">تجار مختارون من كاردو — الدفع يتم مباشرة للتاجر</p></div>
    ${!S.profile.merchant_id ? `<button class="card m-join mb-4" id="joinMerchant" type="button"><span style="font-size:26px">🏪</span>
      <span style="flex:1;text-align:right"><b style="display:block">تبي تدير مشروعك؟ افتح متجرك في كاردو 🚀</b><span class="caption">قدّم طلب انضمام — للتجار الموثوقين فقط</span></span><span class="prow-add">←</span></button>` : ''}
    <div class="input-wrap mb-3"><span class="input-icon">${svg(I.search, 2)}</span><input class="input" id="mkQ" placeholder="ابحث عن متجر أو خدمة (مثال: شدات)…" value="${esc(S.mkQ || '')}" autocomplete="off"></div>
    ${cats.length > 1 ? `<div class="pills mb-4"><button class="pill ${!S.mkCat ? 'active' : ''}" data-mkcat="">الكل</button>${cats.map(c => `<button class="pill ${S.mkCat === c ? 'active' : ''}" data-mkcat="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
    ${svcHits.length ? `<div class="h4 mb-2">🔎 عروض «${esc(S.mkQ)}» من كل المتاجر (الأرخص أولًا)</div>
      <div style="display:flex;flex-direction:column;gap:8px" class="mb-4">${svcHits.map(s => { const m = mById(s.mid); return `
        <button class="prow" data-msvc="${esc(s.id)}" ${(s.delivery === 'stock' && s.stock < 1) || m.open === false ? 'disabled' : ''}>
          ${mLogo(m, 'prow-img')}
          <span class="prow-body"><span class="prow-name">${esc(s.name)}</span>
            <span class="prow-price" style="display:block">${svcPriceHtml(s)}</span>
            <span class="caption" style="display:block">${esc(m.name)} ${tierBadge(m)} · ${s.eta ? '⏱️ ' + esc(s.eta) : (s.delivery === 'stock' ? '⚡ فوري' : 'يدوي')}</span></span>
          <span class="prow-add" aria-hidden="true">+</span></button>`; }).join('')}</div>` : ''}
    ${!q && fav.length ? `<div class="h4 mb-2">⭐ المفضلة</div><div style="display:flex;flex-direction:column;gap:10px" class="mb-4">${fav.map(merchantRow).join('')}</div><div class="h4 mb-2">كل المتاجر</div>` : ''}
    ${!S.mk.loaded ? '<div class="skeleton" style="height:80px;border-radius:16px"></div>'
      : list.length ? `<div style="display:flex;flex-direction:column;gap:10px">${list.map(merchantRow).join('')}</div>`
      : svcHits.length ? '' : `<div class="card" style="text-align:center;padding:28px">${fennec('empty', 110)}<div class="h4">${q ? 'لا نتائج' : 'لا متاجر بعد'}</div></div>`}
  </div>`;
}

function vStore() {
  const m = mById(S.curStore);
  if (!m) { if (!S.mk.loaded) loadMerchants(); return `<div class="page-enter"><div class="card" style="text-align:center;padding:30px">${S.mk.loaded ? 'المتجر غير متاح' : 'جارٍ التحميل…'}</div></div>`; }
  const svcs = mServices(m.id);
  const c = m.contacts || {};
  const isFav = favs().includes(m.id);
  const sections = [...new Set(svcs.map(s => s.section || ''))];
  if (!S.reviews || S.reviews.mid !== m.id) { S.reviews = { mid: m.id, list: null }; api('/api/m/reviews', { mid: m.id }).then(r => { S.reviews = { mid: m.id, list: r.reviews }; render(); }).catch(() => {}); }
  const svcBtn = s => `
      <button class="prow" data-msvc="${esc(s.id)}" ${(s.delivery === 'stock' && s.stock < 1) || m.open === false ? 'disabled' : ''}>
        <span class="prow-img">${s.image ? `<img src="${esc(s.image)}" alt="" loading="lazy">` : '🛍️'}</span>
        <span class="prow-body"><span class="prow-name">${esc(s.name)}</span>
          <span class="prow-price" style="display:block">${svcPriceHtml(s)}</span>
          <span class="caption" style="display:block">${s.delivery === 'stock' ? (s.stock > 0 ? '⚡ تسليم فوري بعد تأكيد الدفع' : '⛔ نفذت الكمية') : '🕐 تنفيذ يدوي'}${s.eta ? ` · ⏱️ ${esc(s.eta)}` : ''}</span></span>
        <span class="prow-add" aria-hidden="true">+</span>
      </button>`;
  const rv = S.reviews && S.reviews.list;
  return `
  <div class="page-enter">
    <button class="btn btn-ghost btn-sm mb-2" data-nav="stores" style="padding:0">→ كل المتاجر</button>
    <div class="m-hero">${m.cover ? `<img src="${esc(m.cover)}" alt="">` : ''}</div>
    <div class="m-head">
      ${mLogo(m, 'm-logo m-logo-lg')}
      <div style="flex:1;min-width:0">
        <h1 class="h3" style="margin:0">${esc(m.name)} <span class="m-ok">✓ موثّق</span> ${tierBadge(m)}</h1>
        <div class="caption">${esc(m.category)}${m.orders_done ? ` · ${m.orders_done} طلب مكتمل` : ''} ${stars(m.rating)}${m.rating_count ? ` <span class="caption">(${m.rating_count})</span>` : ''}</div>
        <div class="caption">${openBadge(m)}${m.hours ? ` · 🕒 ${esc(m.hours)}` : ''}${m.avg_confirm_min !== null && m.avg_confirm_min !== undefined ? ` · ⏱️ يؤكد خلال ~${m.avg_confirm_min || 1} د` : ''}</div>
      </div>
      <button class="icon-pill" data-mfav="${esc(m.id)}" aria-label="المفضلة" title="المفضلة">${isFav ? '⭐' : '☆'}</button>
    </div>
    ${m.bio ? `<p class="body-sm text-2 mb-3" style="white-space:pre-line">${esc(m.bio)}</p>` : ''}
    <div class="m-contacts mb-3">
      ${c.whatsapp ? `<a class="btn btn-secondary btn-sm" href="https://wa.me/${esc(c.whatsapp.replace(/\D/g, ''))}" target="_blank" rel="noopener">واتساب</a>` : ''}
      ${c.telegram ? `<a class="btn btn-secondary btn-sm" href="https://t.me/${esc(c.telegram)}" target="_blank" rel="noopener">تيليجرام</a>` : ''}
      ${c.facebook ? `<a class="btn btn-secondary btn-sm" href="${esc(/^https?:\/\//.test(c.facebook) ? c.facebook : 'https://facebook.com/' + c.facebook)}" target="_blank" rel="noopener">فيسبوك</a>` : ''}
      <button class="btn btn-ghost btn-sm" data-mshare="${esc(m.slug || '')}">🔗 مشاركة</button>
      <button class="btn btn-ghost btn-sm" data-mreport="${esc(m.id)}" style="color:var(--error)">⚑ إبلاغ</button>
    </div>
    ${m.open === false ? `<div class="neon-warn mb-3"><div class="neon-warn-title">🔴 المتجر مغلق حاليًا</div><p>لا يستقبل طلبات الآن${m.hours ? ` — أوقات العمل: ${esc(m.hours)}` : ''}.</p></div>` : ''}
    <div class="alert alert-warning mb-4">💳<div>الدفع يتم <b>مباشرة لأرقام التاجر</b>، وكاردو تعرض المتجر وتسجّل طلبك وإيصالك.</div></div>
    <div class="h4 mb-3">الخدمات</div>
    ${svcs.length ? sections.map(sec => `${sec ? `<div class="m-sec-title">${esc(sec)}</div>` : ''}<div style="display:flex;flex-direction:column;gap:10px" class="mb-3">${svcs.filter(s => (s.section || '') === sec).map(svcBtn).join('')}</div>`).join('')
      : '<div class="card" style="text-align:center;padding:24px">لا خدمات بعد</div>'}
    <div class="h4 mb-3" style="margin-top:18px">آراء الزبائن ${m.rating ? `<span class="m-rate">★ ${esc(Number(m.rating).toFixed(1))}</span>` : ''}</div>
    ${rv === null ? '<div class="skeleton" style="height:60px;border-radius:14px"></div>'
      : rv.length ? `<div style="display:flex;flex-direction:column;gap:8px">${rv.slice(0, 10).map(r => `
        <div class="card m-review"><div class="flex-between"><b>${esc(r.name)}</b><span class="m-rate">${'★'.repeat(r.stars)}</span></div>
          ${r.text ? `<p class="body-sm" style="margin:4px 0">${esc(r.text)}</p>` : ''}<div class="caption">${esc(r.service || '')} · ${esc(dt(r.at))}</div></div>`).join('')}</div>`
      : '<p class="caption">لا تقييمات بعد — كن أول من يقيّم بعد طلبك.</p>'}
  </div>`;
}

function openMService(sid) {
  const s = (S.mk.services || []).find(x => x.id === sid); if (!s) return;
  const m = mById(s.mid); if (!m) return;
  if (m.open === false) return toast('المتجر مغلق حاليًا', 'bad');
  let proof = '';
  modal(`
    <div class="modal-head"><div class="modal-title">${esc(s.name)}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    ${s.image ? `<img src="${esc(s.image)}" alt="" class="m-svc-img">` : ''}
    ${s.desc ? `<p class="body-sm text-2 mb-3" style="white-space:pre-line">${esc(s.desc)}</p>` : ''}
    ${s.eta ? `<p class="caption mb-2">⏱️ مدة التنفيذ: <b>${esc(s.eta)}</b></p>` : ''}

    <div class="m-step">1</div>
    <div class="m-pay-box mb-3">
      <div class="flex-between mb-2"><span class="body-sm">حوّل المبلغ</span><b class="tabular" style="font-size:22px;color:var(--brand)">${esc(lyd(s.price))}</b></div>
      ${(m.pay_methods || []).map((p, i) => `
        <label class="copy-box mb-2" style="cursor:pointer"><input type="radio" name="mpay" value="${esc(p.label)}" ${i === 0 ? 'checked' : ''} style="accent-color:var(--brand)">
          <div style="flex:1"><div class="caption">${esc(p.label)}</div><div class="copy-value" dir="ltr">${esc(p.value)}</div></div>
          <button class="copy-btn" type="button" data-act="copy" data-copy-text="${esc(p.value)}" aria-label="نسخ">${svg(I.copy, 2)}</button></label>`).join('') || '<p class="caption">تواصل مع التاجر لمعرفة طريقة الدفع.</p>'}
    </div>

    ${(s.fields || []).length ? `<div class="m-step">2</div>
      ${(s.fields || []).map((f, i) => `<div class="field mb-3"><label class="field-label" for="mf${i}">${esc(f)}</label><input class="input" id="mf${i}" dir="auto"></div>`).join('')}` : ''}

    <div class="m-step">${(s.fields || []).length ? 3 : 2}</div>
    <label class="m-proof" id="mProofBox"><span id="mProofTxt">📷 اضغط لإرفاق صورة إيصال التحويل</span><input type="file" accept="image/*" id="mProof" hidden></label>

    <button class="btn btn-primary btn-block" id="mBuy" type="button" style="margin-top:6px">تم</button>
    <p class="caption" style="text-align:center;margin-top:8px">يؤكد التاجر استلام دفعتك ثم ينفّذ طلبك${s.delivery === 'stock' ? ' — والكود يصلك فورًا عند التأكيد' : ''}.</p>`);
  $('#mProof').onchange = async () => {
    try { proof = await compressImage($('#mProof').files[0]); $('#mProofTxt').textContent = '✓ أُرفق الإيصال'; $('#mProofBox').classList.add('ok'); }
    catch (e) { toast(e.message, 'bad'); }
  };
  onTap('#mBuy', async () => {
    const inputs = {};
    for (let i = 0; i < (s.fields || []).length; i++) { const v = ($('#mf' + i).value || '').trim(); if (!v) return toast('أدخل ' + s.fields[i], 'bad'); inputs[i] = v; }
    if (!proof) return toast('أرفق صورة إيصال التحويل', 'bad');
    const pm = document.querySelector('input[name="mpay"]:checked');
    const b = $('#mBuy'); b.disabled = true; b.classList.add('loading');
    try {
      await api('/api/m/order', { sid, proof, inputs, pay_method: pm ? pm.value : '' });
      stickerModal('wait', 'wait', 'وصل طلبك للتاجر ✓', `${m.name} سيؤكد دفعتك وينفّذ طلبك${s.eta ? ` (عادة خلال ${s.eta})` : ''} — تابع الحالة وتحدّث معه من «طلباتي».`);
    } catch (e) { stickerModal('failed', 'error', 'لم يُرسل الطلب', e.message, false); }
  });
}

function timelineHtml(o) {
  const steps = [['أُرسل الطلب', o.created_at], ['أُكّد الدفع', o.paid_at], [o.status === 'rejected' ? 'رُفض' : 'اكتمل', o.completed_at || o.rejected_at]];
  return `<div class="m-timeline mb-3">${steps.map(([t, at]) => `<div class="m-tl ${at ? 'done' : ''}"><span></span><div><b>${esc(t)}</b><div class="caption">${at ? esc(dt(at)) : '—'}</div></div></div>`).join('')}</div>`;
}
function chatHtml(msgs, me) {
  const WHO = { customer: 'الزبون', merchant: 'التاجر', admin: 'إدارة كاردو' };
  return `<div class="chat mb-2">${(msgs || []).map(m => `<div class="bubble ${m.by === me ? 'from-me' : 'from-staff'}"><div class="bubble-who">${m.by === me ? 'أنت' : WHO[m.by] || ''}</div>
    <div class="bubble-text">${esc(m.text)}</div><div class="bubble-at">${esc(dt(m.at))}</div></div>`).join('') || '<p class="caption" style="text-align:center">لا رسائل بعد</p>'}</div>`;
}

async function openMOrder(id) {
  const o = (S.mOrders || []).find(x => x.id === id); if (!o) return;
  const st = MO_ST[o.status] || ['badge', o.status];
  modal(`
    <div class="modal-head"><div class="modal-title">${esc(o.service_name)}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    <div class="flex-between mb-2"><span class="body-sm text-2">المتجر</span><b>${esc(o.merchant_name)}</b></div>
    <div class="flex-between mb-2"><span class="body-sm text-2">السعر</span><b class="tabular">${esc(lyd(o.price))}</b></div>
    <div class="flex-between mb-3"><span class="body-sm text-2">الحالة</span><span class="badge ${st[0]}">${esc(st[1])}</span></div>
    ${timelineHtml(o)}
    ${o.status === 'rejected' && o.reject_reason ? `<div class="alert alert-error mb-3">${esc(o.reject_reason)}</div>` : ''}
    <div id="moCode"></div>
    ${o.status === 'completed' && !o.rated ? `<div class="field-label mb-2">قيّم تجربتك</div><div class="m-stars mb-2">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-star="${n}">☆</button>`).join('')}</div>
      <div class="field mb-2"><input class="input" id="rvT" maxlength="300" placeholder="اكتب رأيك (اختياري)"></div>
      <button class="btn btn-secondary btn-block mb-3" id="rvGo" type="button">إرسال التقييم</button>` : ''}
    <div class="field-label mb-2">💬 المحادثة مع التاجر</div>
    ${chatHtml(o.messages, 'customer')}
    <div class="m-chat-in mb-3"><input class="input" id="moMsg" maxlength="1000" placeholder="اكتب رسالة…"><button class="btn btn-primary btn-sm" id="moSend" type="button">إرسال</button></div>
    <button class="btn btn-ghost btn-block" id="moRep" type="button" style="color:var(--error)">⚑ إبلاغ عن مشكلة في هذا الطلب</button>`);
  const ch = document.querySelector('.chat'); if (ch) ch.scrollTop = ch.scrollHeight;
  if (o.status === 'completed') {
    try {
      const r = await api('/api/m/order/code', { id });
      const box = $('#moCode');
      if (box) box.innerHTML = `<div class="field-label mb-2">الكود / تفاصيل التسليم</div><div class="copy-box mb-3"><div class="copy-value" dir="auto" style="white-space:pre-line">${esc(r.delivered)}</div>
        <button class="copy-btn" data-act="copy" data-copy-text="${esc(r.delivered)}" aria-label="نسخ">${svg(I.copy, 2)}</button></div>`;
    } catch (e) { toast(e.message, 'bad'); }
  }
  let starsN = 0;
  $$('[data-star]').forEach(b => b.onclick = () => { starsN = +b.dataset.star; $$('[data-star]').forEach(x => x.textContent = +x.dataset.star <= starsN ? '★' : '☆'); });
  onTap('#rvGo', async () => {
    if (!starsN) return toast('اختر عدد النجوم', 'bad');
    try { await api('/api/m/rate', { id, stars: starsN, text: ($('#rvT').value || '').trim() }); toast('شكرًا لتقييمك ✓', 'ok'); closeModal(); loadMerchants(true); }
    catch (e) { toast(e.message, 'bad'); }
  });
  onTap('#moSend', async () => {
    const text = ($('#moMsg').value || '').trim(); if (!text) return;
    try { await api('/api/m/order/msg', { id, text }); toast('أُرسلت ✓', 'ok'); closeModal(); } catch (e) { toast(e.message, 'bad'); }
  });
  onTap('#moRep', () => openMReport(o.mid, o.id));
}

function openCase(id, me) {
  const list = me === 'merchant' ? (S.mstoreCases || []) : (S.mCases || []);
  const r = list.find(x => x.id === id); if (!r) return;
  modal(`
    <div class="modal-head"><div class="modal-title">⚑ ${esc(r.reason)}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    <div class="caption mb-2">${esc(r.merchant_name)} · ${esc(dt(r.created_at))} · <span class="badge ${r.status === 'open' ? 'badge-warning' : 'badge-success'}">${r.status === 'open' ? 'مفتوح' : 'محلول'}</span></div>
    ${chatHtml(r.messages, me)}
    ${r.status === 'open' ? `<div class="m-chat-in"><input class="input" id="csMsg" maxlength="1000" placeholder="اكتب ردك…"><button class="btn btn-primary btn-sm" id="csSend" type="button">إرسال</button></div>` : ''}`);
  onTap('#csSend', async () => {
    const text = ($('#csMsg').value || '').trim(); if (!text) return;
    try { await api('/api/m/report/msg', { id, text }); toast('أُرسل ✓', 'ok'); closeModal(); } catch (e) { toast(e.message, 'bad'); }
  });
}

/* ─── لوحة التاجر ─── */
const MS_TERMS = `• أبيع خدمات مشروعة فقط وأسلّمها كما هو موصوف وبالسعر المعلن.
• أؤكد الطلب فقط بعد وصول المبلغ فعلًا إلى حسابي، وأسلّم خلال المدة المعلنة.
• أتحمّل مسؤولية خدماتي والتعامل المالي مع زبائني بالكامل، وكاردو منصة عرض ووسيط تسجيل فقط.
• أردّ على رسائل الزبائن والبلاغات بسرعة، وأقبل قرار إدارة كاردو في النزاعات.
• يحق لكاردو إيقاف متجري فورًا عند النصب أو كثرة البلاغات أو مخالفة هذه الاتفاقية، دون استرداد الاشتراك.
• لا أستخدم شعارات أو علامات تجارية لا أملك حق استخدامها.`;
function msReports(orders) {
  const now = Date.now(), day = 864e5;
  const done = orders.filter(o => o.status === 'completed');
  const sumSince = t => done.filter(o => msOf(o.completed_at || o.updated_at) >= t).reduce((a, o) => a + Number(o.price || 0), 0);
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const top = {};
  done.filter(o => msOf(o.completed_at || o.updated_at) >= now - 30 * day).forEach(o => { top[o.service_name] = (top[o.service_name] || 0) + Number(o.price || 0); });
  const topList = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { today: sumSince(d0.getTime()), week: sumSince(now - 7 * day), month: sumSince(now - 30 * day), topList };
}
function vMyStore() {
  if (!S.mine) { loadMine(); return '<div class="page-enter"><div class="skeleton" style="height:120px;border-radius:18px"></div></div>'; }
  const m = S.mine.merchant;
  if (!m) return '<div class="page-enter"><div class="card" style="text-align:center;padding:30px">حسابك ليس حساب تاجر.</div></div>';
  if (!m.terms_accepted) return `
    <div class="page-enter"><h1 class="h2 mb-3">اتفاقية التاجر</h1>
      <div class="card mb-3"><p class="body-sm" style="white-space:pre-line;line-height:2">${esc(MS_TERMS)}</p>
        <p class="caption">وتسري عليك أيضًا <a href="./terms.html" target="_blank" rel="noopener" style="color:var(--brand)">شروط كاردو العامة</a>.</p></div>
      <label class="card-warn-ok mb-3"><input type="checkbox" id="msAgree"><span>قرأت الاتفاقية وأوافق عليها</span></label>
      <button class="btn btn-primary btn-block" id="msAgreeGo">موافقة وبدء استخدام لوحة متجري</button></div>`;
  const orders = S.mstoreOrders || [];
  const pend = orders.filter(o => o.status === 'pending'), proc = orders.filter(o => o.status === 'processing');
  const cases = (S.mstoreCases || []).filter(c => c.status === 'open');
  const daysLeft = Math.ceil((m.sub_expires_ms - Date.now()) / 864e5);
  const rep = msReports(orders);
  const low = (S.mine.services || []).filter(s => s.delivery === 'stock' && s.stock <= 3 && s.active);
  const tab = S.mstoreTab;
  const T = [['home', 'الرئيسية'], ['orders', `الطلبات${pend.length + proc.length ? ` (${pend.length + proc.length})` : ''}`], ['services', `الخدمات${low.length ? ' ⚠️' : ''}`],
    ['reports', 'التقارير'], ['cases', `البلاغات${cases.length ? ` (${cases.length})` : ''}`], ['settings', 'الإعدادات']];
  let body = '';
  if (tab === 'home') body = `
    ${!m.active ? `<div class="neon-warn mb-4"><div class="neon-warn-title">⚠️ متجرك غير ظاهر للزبائن</div><p>${m.status === 'suspended' ? 'المتجر موقوف من الإدارة.' : 'انتهى اشتراكك — تواصل مع إدارة كاردو للتجديد.'}</p></div>` : ''}
    ${pushOn() ? '' : `<button class="card m-join mb-3" id="pushOn" type="button"><span style="font-size:24px">🔔</span><span style="flex:1;text-align:right"><b style="display:block">فعّل إشعارات الهاتف</b><span class="caption">يصلك كل طلب جديد فورًا حتى لو الموقع مغلق</span></span><span class="prow-add">←</span></button>`}
    <div class="card mb-4 flex-between"><div><b>${m.open ? '🟢 المتجر مفتوح' : '🔴 المتجر مغلق (وضع الإجازة)'}</b><div class="caption">${m.open ? 'يستقبل الطلبات الآن' : 'لا تصلك طلبات جديدة'}</div></div>
      <button class="btn ${m.open ? 'btn-secondary' : 'btn-primary'} btn-sm" id="msToggleOpen">${m.open ? 'إغلاق مؤقت' : 'فتح المتجر'}</button></div>
    <div class="m-stats mb-4">
      <div class="card"><div class="caption">مبيعات اليوم</div><b class="tabular">${esc(lyd(rep.today))}</b></div>
      <div class="card"><div class="caption">بانتظار تأكيد الدفع</div><b class="tabular">${pend.length}</b></div>
      <div class="card"><div class="caption">قيد التنفيذ</div><b class="tabular">${proc.length}</b></div>
      <div class="card"><div class="caption">متوسط وقت التأكيد</div><b class="tabular">${m.avg_confirm_min !== null ? `${m.avg_confirm_min || 1} د` : '—'}</b></div>
    </div>
    ${low.length ? `<div class="alert alert-warning mb-3">📦<div>مخزون منخفض: ${low.map(s => `${esc(s.name)} (${s.stock})`).join('، ')}</div></div>` : ''}
    ${cases.length ? `<div class="alert alert-error mb-3">⚑<div>لديك ${cases.length} بلاغ مفتوح — ردّ عليه من تبويب «البلاغات».</div></div>` : ''}
    <div class="card mb-4"><div class="flex-between"><div><div class="caption">اشتراك المتجر</div>
      <b>${m.active ? `ينتهي بعد ${daysLeft} يوم` : 'منتهٍ'}</b></div><span class="caption">${esc(new Date(m.sub_expires_ms).toLocaleDateString('ar-LY'))}</span></div>
      <p class="caption" style="margin-top:6px">${m.tier ? `مستوى متجرك: ${TIER[m.tier]} · ` : ''}للتجديد تواصل مع إدارة كاردو.</p></div>
    ${m.slug ? `<div class="copy-box mb-3"><div style="flex:1"><div class="caption">رابط متجرك — شاركه مع زبائنك</div><div class="copy-value" dir="ltr">kardo.ly/store.html?s=${esc(m.slug)}</div></div>
      <button class="copy-btn" data-act="copy" data-copy-text="https://kardo.ly/store.html?s=${esc(m.slug)}" aria-label="نسخ">${svg(I.copy, 2)}</button></div>` : ''}
    ${(() => { const steps = [['أضف شعار متجرك', !!m.logo], ['أضف أرقام الدفع', (m.pay_methods || []).length > 0], ['أضف أول خدمة', (S.mine.services || []).length > 0], ['شارك رابط متجرك مع زبائنك', m.orders_done > 0]];
      const left = steps.filter(x => !x[1]).length;
      return left ? `<div class="card mb-3"><div class="h4 mb-2" style="font-size:14px">🚀 جهّز متجرك (${steps.length - left}/${steps.length})</div>
        ${steps.map(([t, ok]) => `<div class="m-check ${ok ? 'ok' : ''}"><span>${ok ? '✓' : '○'}</span>${esc(t)}</div>`).join('')}
        <button class="btn btn-primary btn-sm" data-mstab="settings" style="margin-top:8px;padding:0 16px">إكمال الإعداد</button></div>` : ''; })()}`;
  if (tab === 'orders') body = orders.length ? `
    ${pend.length ? `<div class="h4 mb-2">بانتظار تأكيد الدفع</div><div class="list mb-4">${pend.map(o => mOrderRow(o, true)).join('')}</div>` : ''}
    ${proc.length ? `<div class="h4 mb-2">قيد التنفيذ</div><div class="list mb-4">${proc.map(o => mOrderRow(o, true)).join('')}</div>` : ''}
    <div class="h4 mb-2">السابقة</div><div class="list">${orders.filter(o => ['completed', 'rejected'].includes(o.status)).slice(0, 60).map(o => mOrderRow(o, true)).join('') || '<p class="caption">لا شيء بعد</p>'}</div>`
    : `<div class="card" style="text-align:center;padding:30px">${fennec('empty', 110)}<div class="h4">لا طلبات بعد</div><p class="caption">شارك رابط متجرك مع زبائنك</p></div>`;
  if (tab === 'services') body = `
    <button class="btn btn-primary btn-sm mb-3" id="msAdd" style="padding:0 18px">+ خدمة جديدة</button>
    <div style="display:flex;flex-direction:column;gap:10px">${(S.mine.services || []).map(s => `
      <div class="card m-svc-row">
        <div style="flex:1;min-width:0"><b>${esc(s.name)}</b> ${s.active ? '' : '<span class="badge badge-neutral">متوقفة</span>'} ${s.section ? `<span class="caption">· ${esc(s.section)}</span>` : ''}
          <div class="caption">${esc(lyd(s.price))}${s.old_price ? ` (قبل ${esc(lyd(s.old_price))})` : ''} · ${s.delivery === 'stock' ? `⚡ مخزون: <b style="color:${s.stock <= 3 ? 'var(--error)' : 'inherit'}">${s.stock}</b>` : 'تنفيذ يدوي'}${s.eta ? ` · ⏱️ ${esc(s.eta)}` : ''}</div></div>
        ${s.delivery === 'stock' ? `<button class="btn btn-secondary btn-sm" data-msstock="${esc(s.id)}">+ أكواد</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-msedit="${esc(s.id)}">تعديل</button>
      </div>`).join('') || '<p class="caption">أضف أول خدمة لمتجرك.</p>'}</div>`;
  if (tab === 'reports') body = `
    <div class="m-stats mb-4">
      <div class="card"><div class="caption">اليوم</div><b class="tabular">${esc(lyd(rep.today))}</b></div>
      <div class="card"><div class="caption">آخر 7 أيام</div><b class="tabular">${esc(lyd(rep.week))}</b></div>
      <div class="card"><div class="caption">آخر 30 يومًا</div><b class="tabular">${esc(lyd(rep.month))}</b></div>
      <div class="card"><div class="caption">طلبات مكتملة</div><b class="tabular">${m.orders_done}</b></div>
    </div>
    <div class="h4 mb-2">الأكثر مبيعًا (30 يومًا)</div>
    <div class="card">${rep.topList.map(([n, v], i) => `<div class="flex-between" style="padding:6px 0"><span>${i + 1}. ${esc(n)}</span><b class="tabular">${esc(lyd(v))}</b></div>`).join('') || '<p class="caption">لا مبيعات بعد</p>'}</div>`;
  if (tab === 'cases') body = (S.mstoreCases || []).length ? `<div class="list">${(S.mstoreCases || []).map(r => `
    <div class="list-row" data-mscase="${esc(r.id)}" role="button" tabindex="0"><div class="list-icon brand">⚑</div>
      <div class="list-content"><div class="list-title">${esc(r.reason)}</div><div class="list-meta">${esc(r.customer_name || 'زبون')} · ${esc(dt(r.created_at))}</div></div>
      <div class="list-end"><span class="badge ${r.status === 'open' ? 'badge-warning' : 'badge-success'}">${r.status === 'open' ? 'مفتوح' : 'محلول'}</span></div></div>`).join('')}</div>`
    : '<div class="card" style="text-align:center;padding:26px">لا بلاغات — ممتاز 👏</div>';
  if (tab === 'settings') body = `<button class="btn btn-primary btn-block" id="mSetOpen">تعديل بيانات المتجر</button>
    <div class="card" style="margin-top:12px">${mLogo(m, 'm-logo m-logo-lg')}<b style="display:block;margin-top:8px">${esc(m.name)}</b>
      <div class="caption">${esc(m.category)}${m.hours ? ` · 🕒 ${esc(m.hours)}` : ''}</div><p class="body-sm text-2" style="white-space:pre-line">${esc(m.bio || '—')}</p>
      <div class="caption">أرقام الدفع: ${(m.pay_methods || []).map(p => esc(p.label + ': ' + p.value)).join(' · ') || '—'}</div>
      <div class="caption">ردود جاهزة: ${(m.quick_replies || []).length} · زبائن محظورون: ${m.blocked || 0}</div></div>`;
  return `
  <div class="page-enter">
    <div class="mb-3"><h1 class="h2" style="margin-bottom:4px">لوحة متجري</h1><p class="body-sm text-2">${esc(m.name)} ${tierBadge(m)}</p></div>
    <div class="pills mb-4">${T.map(([k, t]) => `<button class="pill ${tab === k ? 'active' : ''}" data-mstab="${k}">${esc(t)}</button>`).join('')}</div>
    ${body}
  </div>`;
}

function openMsOrder(id) {
  const o = (S.mstoreOrders || []).find(x => x.id === id); if (!o) return;
  const st = MO_ST[o.status] || ['badge', o.status];
  const inputs = Object.entries(o.inputs || {});
  const qr = (S.mine && S.mine.merchant && S.mine.merchant.quick_replies) || [];
  modal(`
    <div class="modal-head"><div class="modal-title">${esc(o.service_name)}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    ${o.dup_proof ? `<div class="neon-warn mb-3"><div class="neon-warn-title">⚠️ إيصال مكرر</div><p>صورة هذا الإيصال استُخدمت في طلب سابق — تأكد جيدًا من وصول المبلغ قبل التأكيد.</p></div>` : ''}
    <div class="flex-between mb-2"><span class="body-sm text-2">الزبون</span><b>${esc(o.customer_name || '—')}</b></div>
    <div class="flex-between mb-2"><span class="body-sm text-2">المبلغ</span><b class="tabular">${esc(lyd(o.price))}</b></div>
    <div class="flex-between mb-2"><span class="body-sm text-2">طريقة الدفع</span><b>${esc(o.pay_method || '—')}</b></div>
    ${inputs.map(([k, v]) => `<div class="flex-between mb-2"><span class="body-sm text-2">${esc(k)}</span><b dir="auto">${esc(v)}</b></div>`).join('')}
    <div class="flex-between mb-3"><span class="body-sm text-2">الحالة</span><span class="badge ${st[0]}">${esc(st[1])}</span></div>
    ${timelineHtml(o)}
    ${o.proof ? `<img src="${esc(o.proof)}" alt="الإيصال" class="m-proof-img mb-3">` : ''}
    ${o.status === 'pending' ? `
      <p class="caption mb-2">تأكد أن المبلغ وصل فعلًا إلى رقمك قبل التأكيد.</p>
      <button class="btn btn-primary btn-block mb-2" id="moOk" type="button">✓ استلمت الدفع — ${o.delivery === 'stock' ? 'سلّم الكود تلقائيًا' : 'ابدأ التنفيذ'}</button>` : ''}
    ${['pending', 'processing'].includes(o.status) ? `
      <div class="field mb-2"><label class="field-label" for="moTxt">الكود أو تفاصيل التسليم</label><textarea class="input" id="moTxt" rows="3" dir="auto"></textarea></div>
      ${qr.length ? `<div class="m-qr mb-2">${qr.map((q, i) => `<button type="button" class="pill" data-qr="${i}">${esc(q.slice(0, 28))}${q.length > 28 ? '…' : ''}</button>`).join('')}</div>` : ''}
      <button class="btn btn-secondary btn-block mb-2" id="moDel" type="button">تسليم الطلب</button>
      <div class="field mb-2"><input class="input" id="moWhy" placeholder="سبب الرفض (يظهر للزبون)"></div>
      <button class="btn btn-ghost btn-block" id="moNo" type="button" style="color:var(--error)">رفض الطلب</button>` : ''}
    <div class="field-label mb-2" style="margin-top:10px">💬 المحادثة مع الزبون</div>
    ${chatHtml(o.messages, 'merchant')}
    <div class="m-chat-in mb-3"><input class="input" id="msMsg" maxlength="1000" placeholder="اكتب رسالة…"><button class="btn btn-primary btn-sm" id="msSend" type="button">إرسال</button></div>
    <button class="btn btn-ghost btn-block" id="msBlock" type="button" style="color:var(--error)">🚫 حظر هذا الزبون من متجري</button>`);
  $$('[data-qr]').forEach(b => b.onclick = () => { $('#moTxt').value = qr[+b.dataset.qr]; });
  const act = async (action, extra, btn) => {
    const b = $(btn); if (b) { b.disabled = true; b.classList.add('loading'); }
    try { const r = await api('/api/m/order/action', { id, action, ...extra }); closeModal(); toast(r.status === 'completed' ? 'اكتمل الطلب ✓' : r.status === 'processing' ? 'أُكّد الدفع — نفّذ الطلب' : 'رُفض الطلب', 'ok'); loadMine(); }
    catch (e) { toast(e.message, 'bad'); if (b) { b.disabled = false; b.classList.remove('loading'); } }
  };
  onTap('#moOk', () => { if (o.dup_proof && !confirm('الإيصال مكرر! هل تأكدت فعلًا من وصول المبلغ؟')) return; act('confirm', {}, '#moOk'); });
  onTap('#moDel', () => { const code = ($('#moTxt').value || '').trim(); if (!code) return toast('اكتب الكود أو التفاصيل', 'bad'); act('deliver', { code }, '#moDel'); });
  onTap('#moNo', () => { if (!confirm('رفض الطلب؟ سيُبلَّغ الزبون.')) return; act('reject', { reason: ($('#moWhy').value || '').trim() }, '#moNo'); });
  onTap('#msSend', async () => { const text = ($('#msMsg').value || '').trim(); if (!text) return; try { await api('/api/m/order/msg', { id, text }); toast('أُرسلت ✓', 'ok'); closeModal(); } catch (e) { toast(e.message, 'bad'); } });
  onTap('#msBlock', async () => { if (!confirm('حظر هذا الزبون؟ لن يستطيع الطلب من متجرك.')) return; try { await api('/api/m/block', { uid: o.uid }); toast('حُظر الزبون', 'ok'); loadMine(); } catch (e) { toast(e.message, 'bad'); } });
}

function openMsService(id) {
  const s = id ? (S.mine.services || []).find(x => x.id === id) : { name: '', price: '', desc: '', delivery: 'manual', active: true, fields: [], image: '', eta: '', section: '', old_price: 0 };
  let image = null;
  modal(`
    <div class="modal-head"><div class="modal-title">${id ? 'تعديل الخدمة' : 'خدمة جديدة'}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    <div class="field mb-3"><label class="field-label" for="svN">اسم الخدمة</label><input class="input" id="svN" maxlength="60" value="${esc(s.name)}" placeholder="مثال: 60 شدة ببجي"></div>
    <div class="field mb-3"><label class="field-label" for="svS">القسم داخل المتجر (اختياري)</label><input class="input" id="svS" maxlength="30" value="${esc(s.section || '')}" placeholder="مثال: ببجي"></div>
    <div class="field mb-3"><label class="field-label" for="svP">السعر (د.ل)</label><input class="input" id="svP" type="number" step="0.5" min="0" dir="ltr" value="${esc(String(s.price))}"></div>
    <div class="field mb-3"><label class="field-label" for="svO">السعر قبل الخصم (اختياري)</label><input class="input" id="svO" type="number" step="0.5" min="0" dir="ltr" value="${s.old_price ? esc(String(s.old_price)) : ''}"></div>
    <div class="field mb-3"><label class="field-label" for="svE">مدة التنفيذ</label><input class="input" id="svE" maxlength="40" value="${esc(s.eta || '')}" placeholder="مثال: 5–15 دقيقة"></div>
    <div class="field mb-3"><label class="field-label" for="svD">الوصف</label><textarea class="input" id="svD" rows="3" maxlength="400">${esc(s.desc)}</textarea></div>
    <div class="field mb-3"><label class="field-label" for="svF">بيانات يطلبها من الزبون (اختياري، حتى 3 مفصولة بفاصلة)</label>
      <input class="input" id="svF" value="${esc((s.fields || []).join('، '))}" placeholder="مثال: ID اللاعب، اسم الحساب"></div>
    <div class="field mb-3"><label class="field-label" for="svT">طريقة التسليم</label>
      <select class="input" id="svT"><option value="manual" ${s.delivery !== 'stock' ? 'selected' : ''}>تنفيذ يدوي</option><option value="stock" ${s.delivery === 'stock' ? 'selected' : ''}>⚡ تلقائي من مخزون أكواد</option></select></div>
    <label class="perm-chk mb-3"><input type="checkbox" id="svA" ${s.active !== false ? 'checked' : ''}> الخدمة ظاهرة للزبائن</label>
    <label class="m-proof mb-3"><span id="svImgTxt">${s.image ? '✓ صورة الخدمة — اضغط للتغيير' : '📷 صورة الخدمة (اختياري)'}</span><input type="file" accept="image/*" id="svI" hidden></label>
    <button class="btn btn-primary btn-block" id="svSave" type="button">حفظ</button>
    ${id ? '<button class="btn btn-ghost btn-block" id="svDel" type="button" style="color:var(--error);margin-top:6px">حذف الخدمة</button>' : ''}`);
  $('#svI').onchange = async () => { try { image = await compressImage($('#svI').files[0], 600, 0.75); $('#svImgTxt').textContent = '✓ أُرفقت الصورة'; } catch (e) { toast(e.message, 'bad'); } };
  onTap('#svSave', async () => {
    const body = { id: id || '', name: $('#svN').value.trim(), section: $('#svS').value.trim(), price: Number($('#svP').value), old_price: Number($('#svO').value || 0),
      eta: $('#svE').value.trim(), desc: $('#svD').value.trim(), fields: $('#svF').value.split(/[،,]/).map(x => x.trim()).filter(Boolean), delivery: $('#svT').value, active: $('#svA').checked };
    if (image !== null) body.image = image;
    try { await api('/api/m/service/save', body); closeModal(); toast('حُفظت الخدمة ✓', 'ok'); loadMine(); loadMerchants(true); }
    catch (e) { toast(e.message, 'bad'); }
  });
  onTap('#svDel', async () => {
    if (!confirm('حذف الخدمة نهائيًا؟')) return;
    try { await api('/api/m/service/delete', { id }); closeModal(); toast('حُذفت', 'ok'); loadMine(); loadMerchants(true); } catch (e) { toast(e.message, 'bad'); }
  });
}

function openMsSettings() {
  const m = S.mine.merchant;
  const pays = (m.pay_methods || []).map(p => ({ ...p }));
  if (!pays.length) pays.push({ label: 'ليبيانا', value: '' });
  let logo = null, cover = null;
  const payRows = () => pays.map((p, i) => `<div class="pm-field"><input class="input" data-pl="${i}" placeholder="الطريقة (ليبيانا/المدار/مصرف)" value="${esc(p.label)}"><input class="input" data-pv="${i}" dir="ltr" placeholder="الرقم أو الحساب" value="${esc(p.value)}"><button class="btn btn-ghost btn-sm" data-pd="${i}" type="button" style="color:var(--error)">حذف</button></div>`).join('');
  modal(`
    <div class="modal-head"><div class="modal-title">إعدادات المتجر</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    <div class="field mb-3"><label class="field-label" for="stN">اسم المتجر</label><input class="input" id="stN" maxlength="40" value="${esc(m.name)}"></div>
    <div class="field mb-3"><label class="field-label" for="stC">التصنيف</label><select class="input" id="stC">${(S.mine.categories || []).map(c => `<option ${c === m.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
    <div class="field mb-3"><label class="field-label" for="stB">نبذة</label><textarea class="input" id="stB" rows="3" maxlength="500">${esc(m.bio)}</textarea></div>
    <div class="field mb-3"><label class="field-label" for="stH">أوقات العمل</label><input class="input" id="stH" maxlength="80" value="${esc(m.hours || '')}" placeholder="مثال: يوميًا 10 صباحًا – 12 ليلًا"></div>
    <label class="m-proof mb-2"><span id="stLt">${m.logo ? '✓ الشعار — اضغط للتغيير' : '📷 شعار المتجر'}</span><input type="file" accept="image/*" id="stL" hidden></label>
    <label class="m-proof mb-3"><span id="stVt">${m.cover ? '✓ الغلاف — اضغط للتغيير' : '🖼️ صورة الغلاف'}</span><input type="file" accept="image/*" id="stV" hidden></label>
    <div class="field-label mb-2">أرقام وحسابات الدفع (يراها الزبون مع زر نسخ)</div>
    <div id="stPays">${payRows()}</div>
    <button class="btn btn-ghost btn-sm mb-3" id="stPAdd" type="button">+ طريقة دفع</button>
    <div class="field mb-3"><label class="field-label" for="stQ">ردود جاهزة للتسليم (كل رد في سطر، حتى 10)</label><textarea class="input" id="stQ" rows="4" maxlength="3000" placeholder="تم الشحن بنجاح ✅ شكرًا لثقتك">${esc((m.quick_replies || []).join('\n'))}</textarea></div>
    <div class="field mb-2"><label class="field-label" for="stW">واتساب (مع رمز الدولة)</label><input class="input" id="stW" dir="ltr" placeholder="+2189…" value="${esc((m.contacts || {}).whatsapp || '')}"></div>
    <div class="field mb-2"><label class="field-label" for="stT">تيليجرام (اسم المستخدم)</label><input class="input" id="stT" dir="ltr" value="${esc((m.contacts || {}).telegram || '')}"></div>
    <div class="field mb-3"><label class="field-label" for="stF">فيسبوك (رابط الصفحة)</label><input class="input" id="stF" dir="ltr" value="${esc((m.contacts || {}).facebook || '')}"></div>
    <button class="btn btn-primary btn-block" id="stSave" type="button">حفظ</button>`);
  const sync = () => $$('#stPays [data-pl]').forEach(el => { const i = +el.dataset.pl; pays[i] = { label: el.value.trim(), value: $(`[data-pv="${i}"]`).value.trim() }; });
  const bindP = () => $$('[data-pd]').forEach(b => b.onclick = () => { sync(); pays.splice(+b.dataset.pd, 1); $('#stPays').innerHTML = payRows(); bindP(); });
  bindP();
  onTap('#stPAdd', () => { sync(); if (pays.length >= 6) return; pays.push({ label: '', value: '' }); $('#stPays').innerHTML = payRows(); bindP(); });
  $('#stL').onchange = async () => { try { logo = await compressImage($('#stL').files[0], 300, 0.8); $('#stLt').textContent = '✓ أُرفق الشعار'; } catch (e) { toast(e.message, 'bad'); } };
  $('#stV').onchange = async () => { try { cover = await compressImage($('#stV').files[0], 1000, 0.7); $('#stVt').textContent = '✓ أُرفق الغلاف'; } catch (e) { toast(e.message, 'bad'); } };
  onTap('#stSave', async () => {
    sync();
    const body = { name: $('#stN').value.trim(), category: $('#stC').value, bio: $('#stB').value.trim(), hours: $('#stH').value.trim(), open: m.open,
      pay_methods: pays.filter(p => p.label && p.value), quick_replies: $('#stQ').value.split('\n').map(x => x.trim()).filter(Boolean),
      contacts: { whatsapp: $('#stW').value.trim(), telegram: $('#stT').value.trim(), facebook: $('#stF').value.trim() } };
    if (logo !== null) body.logo = logo;
    if (cover !== null) body.cover = cover;
    try { await api('/api/m/profile', body); closeModal(); toast('حُفظت بيانات المتجر ✓', 'ok'); loadMine(); loadMerchants(true); }
    catch (e) { toast(e.message, 'bad'); }
  });
}

async function msToggleOpen() {
  const m = S.mine.merchant;
  try {
    await api('/api/m/profile', { name: m.name, category: m.category, bio: m.bio, hours: m.hours, pay_methods: m.pay_methods, contacts: m.contacts, quick_replies: m.quick_replies, open: !m.open });
    toast(m.open ? 'أُغلق المتجر مؤقتًا' : 'المتجر مفتوح الآن ✓', 'ok'); loadMine(); loadMerchants(true);
  } catch (e) { toast(e.message, 'bad'); }
}

async function openJoinMerchant() {
  if (S.profile.merchant_id) { go('mystore'); return; }
  let st = null; try { st = (await api('/api/m/apply/status', {})).application; } catch {}
  if (st && st.status === 'pending') return stickerModal('wait', 'wait', 'طلبك قيد المراجعة ⏳', `طلب متجر «${st.store_name}» وصل لإدارة كاردو، وسنتواصل معك قريبًا.`);
  modal(`
    <div class="modal-head"><div class="modal-title">افتح متجرك في كاردو 🏪</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    <p class="body-sm text-2 mb-3">متجر برابط خاص باسمك، والدفع يصلك مباشرة على أرقامك، وتسليم تلقائي للأكواد، وشارة «موثّق من كاردو». الانضمام للتجار الموثوقين فقط باشتراك شهري.</p>
    ${st && st.status === 'rejected' ? `<div class="alert alert-error mb-3">لم يُقبل طلبك السابق${st.reason ? ': ' + esc(st.reason) : ''} — يمكنك التقديم مجددًا.</div>` : ''}
    <div class="field mb-3"><label class="field-label" for="jnS">اسم المتجر</label><input class="input" id="jnS" maxlength="40"></div>
    <div class="field mb-3"><label class="field-label" for="jnC">التصنيف</label><select class="input" id="jnC">${['ألعاب', 'اشتراكات', 'بطاقات رقمية', 'برامج', 'إلكترونيات', 'خدمات', 'أخرى'].map(c => `<option>${c}</option>`).join('')}</select></div>
    <div class="field mb-3"><label class="field-label" for="jnV">ماذا تبيع؟</label><textarea class="input" id="jnV" rows="3" maxlength="600" placeholder="مثال: شحن ببجي وفري فاير، اشتراكات شاهد…"></textarea></div>
    <div class="field mb-3"><label class="field-label" for="jnP">رقم التواصل (واتساب)</label><input class="input" id="jnP" dir="ltr" placeholder="09xxxxxxxx"></div>
    <div class="field mb-3"><label class="field-label" for="jnN">ملاحظة (اختياري) — مثل رابط صفحتك أو خبرتك</label><input class="input" id="jnN" maxlength="400"></div>
    <button class="btn btn-primary btn-block" id="jnGo" type="button">إرسال طلب الانضمام</button>`);
  onTap('#jnGo', async () => {
    const b = $('#jnGo'); b.disabled = true; b.classList.add('loading');
    try {
      await api('/api/m/apply', { store_name: $('#jnS').value.trim(), category: $('#jnC').value, services: $('#jnV').value.trim(), phone: $('#jnP').value.trim(), note: $('#jnN').value.trim() });
      stickerModal('wait', 'wait', 'وصل طلبك ✓', 'ستراجع إدارة كاردو طلبك وتتواصل معك على رقمك لتفعيل متجرك.');
    } catch (e) { toast(e.message, 'bad'); b.disabled = false; b.classList.remove('loading'); }
  });
}

const TOUR = [
  ['card', 'بطاقتك للدفع أونلاين 💳', 'اشحن محفظتك بالدينار عبر ليبيانا أو المدار، واطلب بطاقة فيزا افتراضية تدفع بها نتفلكس وChatGPT والشراء أونلاين.'],
  ['welcome', 'متاجر موثوقة 🏪', 'تجار مختارون من كاردو لشحن الألعاب والاشتراكات. اختر الخدمة، حوّل للتاجر، وأرفق الإيصال — وطلبك مسجّل ومحمي.'],
  ['success', 'تابع كل شيء من «طلباتي» 📦', 'حالة كل طلب، والكود، ومحادثة مع التاجر، وزر إبلاغ إذا واجهت أي مشكلة.'],
];
function maybeTour() {
  try { if (localStorage.getItem('kardo_tour') === '1') return; } catch { return; }
  let i = 0;
  const show = () => {
    const [st, t, d] = TOUR[i];
    modal(`<div style="text-align:center;padding-top:6px">${fennec(st, 140)}<div class="h3" style="margin:6px 0">${esc(t)}</div>
      <p class="body-sm text-2" style="line-height:1.9">${esc(d)}</p>
      <div class="tour-dots">${TOUR.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</div>
      <button class="btn btn-primary btn-block" id="tourNext" type="button">${i < TOUR.length - 1 ? 'التالي' : 'ابدأ الآن 🚀'}</button>
      ${i < TOUR.length - 1 ? '<button class="btn btn-ghost btn-block" id="tourSkip" type="button">تخطّي</button>' : ''}</div>`);
    const done = () => { try { localStorage.setItem('kardo_tour', '1'); } catch {} closeModal(); };
    onTap('#tourNext', () => { if (++i < TOUR.length) show(); else done(); });
    onTap('#tourSkip', done);
  };
  setTimeout(() => { if (!document.getElementById('overlay')?.classList.contains('open')) show(); }, 900);
}

function bindMarket() {
  onTap('#pushOn', async () => { if (await registerPushToken(false)) render(); });
  onTap('#joinMerchant', () => openJoinMerchant());
  $$('[data-store]').forEach(b => b.onclick = () => { S.curStore = b.dataset.store; go('store'); });
  $$('[data-msvc]').forEach(b => b.onclick = () => openMService(b.dataset.msvc));
  $$('[data-mreport]').forEach(b => b.onclick = () => openMReport(b.dataset.mreport));
  $$('[data-mkcat]').forEach(b => b.onclick = () => { S.mkCat = b.dataset.mkcat; render(); });
  const q = $('#mkQ'); if (q) q.oninput = () => { S.mkQ = q.value; clearTimeout(q._t); q._t = setTimeout(render, 250); };
  $$('[data-mo]').forEach(b => b.onclick = () => openMOrder(b.dataset.mo));
  $$('[data-mso]').forEach(b => b.onclick = () => openMsOrder(b.dataset.mso));
  $$('[data-mcase]').forEach(b => b.onclick = () => openCase(b.dataset.mcase, 'customer'));
  $$('[data-mscase]').forEach(b => b.onclick = () => openCase(b.dataset.mscase, 'merchant'));
  $$('[data-mstab]').forEach(b => b.onclick = () => { S.mstoreTab = b.dataset.mstab; render(); });
  $$('[data-mfav]').forEach(b => b.onclick = async () => {
    const mid = b.dataset.mfav, on = !favs().includes(mid);
    try { const r = await api('/api/m/fav', { mid, on }); S.profile = { ...S.profile, fav_merchants: r.favs }; toast(on ? 'أُضيف للمفضلة ⭐' : 'أُزيل من المفضلة', 'ok'); render(); } catch (e) { toast(e.message, 'bad'); }
  });
  $$('[data-mshare]').forEach(b => b.onclick = async () => {
    const url = `https://kardo.ly/store.html?s=${b.dataset.mshare}`;
    try { if (navigator.share) await navigator.share({ url }); else { await navigator.clipboard.writeText(url); toast('نُسخ الرابط ✓', 'ok'); } } catch {}
  });
  onTap('#msAdd', () => openMsService(''));
  onTap('#msToggleOpen', () => msToggleOpen());
  onTap('#msAgreeGo', async () => {
    if (!$('#msAgree').checked) return toast('وافق على الاتفاقية أولًا', 'bad');
    try { await api('/api/m/accept-terms', { version: '1.0' }); toast('مرحبًا بك تاجرًا في كاردو 🎉', 'ok'); S.mine = null; loadMine(); } catch (e) { toast(e.message, 'bad'); }
  });
  $$('[data-msedit]').forEach(b => b.onclick = () => openMsService(b.dataset.msedit));
  $$('[data-msstock]').forEach(b => b.onclick = () => openMsStock(b.dataset.msstock));
  onTap('#mSetOpen', () => openMsSettings());
}


/* ═══ v16 — إشعارات الهاتف ═══ */
const VAPID_KEY = 'BLAD-NG9N9VBNEg_dk8xxhvF7gBk4wcQtRWdLiFsQ6RM81zBzpptxGRtc4QvOr5_Wg5trZV0BhgSnYOGbAEFhKI';
const pushOn = () => { try { return localStorage.getItem('kardo_push') === '1' && Notification.permission === 'granted'; } catch { return false; } };
async function registerPushToken(silent) {
  try {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !(await isMsgSupported())) { if (!silent) toast('المتصفح لا يدعم إشعارات الهاتف — جرّب Chrome', 'bad'); return false; }
    if (Notification.permission !== 'granted') {
      if (silent) return false;
      const p = await Notification.requestPermission();
      if (p !== 'granted') { toast('لم تسمح بالإشعارات — فعّلها من إعدادات المتصفح', 'bad'); return false; }
    }
    const reg = await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    const token = await getMsgToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) throw new Error('no token');
    await api('/api/push/register', { token });
    try { localStorage.setItem('kardo_push', '1'); } catch {}
    if (!silent) toast('فُعّلت إشعارات الهاتف ✓', 'ok');
    return true;
  } catch (e) { if (!silent) toast('تعذّر تفعيل الإشعارات', 'bad'); console.warn('push', e && e.message); return false; }
}

/* ═══ Expose helpers to inline handlers ═══ */
window.__toast = toast;

/* ═══ Delegated actions (بديل onclick المضمّن — متوافق مع CSP) ═══ */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'close-modal') { e.preventDefault(); window.closeModal(); }
  else if (act === 'dock-deposit') { haptic.tap(); openDeposit(); }
  else if (act === 'go') { e.preventDefault(); window.go(el.dataset.page); }
  else if (act === 'href') {
    const h = el.dataset.href || '';
    if (/^[a-z0-9_-]+\.html(\?[a-z=&]*)?$/i.test(h)) location.href = h;
  }
  else if (act === 'copy') {
    try { await navigator.clipboard.writeText(el.dataset.copyText || ''); toast('نُسخ', 'ok'); }
    catch { toast('تعذّر النسخ', 'bad'); }
  }
});
function offlineBanner(on) {
  let el = document.getElementById('offlineBn');
  if (on && !el) {
    el = document.createElement('div'); el.id = 'offlineBn'; el.className = 'offline-bn';
    el.innerHTML = `<img src="${esc(stickerUrl('offline', 'offline'))}" alt="" width="54" height="54"><div><b>انقطع الإنترنت</b><div class="caption">سنكمل تلقائيًا فور عودة الاتصال</div></div>`;
    document.body.appendChild(el);
  } else if (!on && el) el.remove();
}
window.addEventListener('offline', () => offlineBanner(true));
window.addEventListener('online', () => { offlineBanner(false); toast('عاد الاتصال ✓', 'ok'); });
document.addEventListener('click', e => { if (e.target.closest('#bellBtn')) { haptic.tap(); openNotifications(); } if (e.target.closest('#dockMain')) go('wallet'); });
document.addEventListener('pointerdown', e => { if (e.target.closest('.btn-primary, .nav-item')) haptic.tap(); }, { passive: true });


/* ═══ Public page interactions ═══ */
try { const c = JSON.parse(localStorage.getItem('kardo_cfg') || 'null'); if (c && c.plans) { S.config = { ...S.config, ...c }; renderLandingPlans(); } } catch {}
apiGet('/api/status').then(d => { S.config = { ...S.config, ...d }; renderLandingPlans(); }).catch(() => {});
function bindPublic() {
  $$('#public nav a').forEach(a => {
    a.onclick = (e) => {
      const href = a.getAttribute('href');
      if (href && href.startsWith('#')) {
        e.preventDefault();
        const el = document.querySelector(href);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
  });
}

/* ═══ Init ═══ */
bindPublic();

if (!auth.currentUser) {
  $('#public').style.display = 'block';
  $('#app').style.display = 'none';
          }
