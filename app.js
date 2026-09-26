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
  S.unsub.push(onSnapshot(doc(db, 'users', uid), s => {
    if (s.exists()) S.profile = { ...S.profile, ...s.data() };
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
    render();
  }, e => { S.dataErr[key] = e.code; render(); });
}

function dropLazy(except) {
  Object.keys(_lazy).forEach(k => {
    if (k !== except && _lazy[k]) { try { _lazy[k](); } catch {} delete _lazy[k]; }
  });
}

function ensurePageData() {
  const uid = S.user?.uid;
  if (!uid) return;
  if (S.page === 'orders') {
    lazySub('orders', () => query(collection(db, 'orders'),
      where('uid', '==', uid), limit(50)));
    dropLazy('orders');
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
window.go = (page) => {
  S.page = page;
  S.cat = null;
  S.q = '';
  ensurePageData();
  window.scrollTo({ top: 0, behavior: 'instant' });
  render();
  $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === page));

  if (page === 'services') loadServices();
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

  const barBal = $('#barBalance');
  const barVal = $('#barBalanceVal');
  if (barBal && barVal) {
    barBal.style.display = 'flex';
    barVal.textContent = lyd(S.profile.wallet_balance * rate());
  }

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
  };

  view.innerHTML = (pages[S.page] || vDashboard)();
  bind();
}

/* ═══════════════════════════════════════════════════════════
   Dashboard
   ═══════════════════════════════════════════════════════════ */

function vDashboard() {
  const name = S.profile.name || 'مرحبًا';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'صباح الخير' : hour < 17 ? 'مساء الخير' : 'مساء الخير';

  const recentTx = [
    ...S.manualOrders.slice(0, 3),
    ...S.svcOrders.slice(0, 3),
  ]
    .sort((a, b) => {
      const av = a.created_at?.toDate?.() || new Date(a.created_at || 0);
      const bv = b.created_at?.toDate?.() || new Date(b.created_at || 0);
      return bv - av;
    })
    .slice(0, 5);

  return `
  <div class="page-enter">
    <div style="margin-bottom:32px">
      <h1 class="h2" style="margin-bottom:6px">${greeting}، ${esc(name.split(' ')[0])}</h1>
      <p class="body-sm text-2">إليك ملخص حسابك اليوم</p>
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

    <div class="flex-between mb-4">
      <div>
        <div class="h4">بطاقاتي</div>
        <div class="caption">${S.manualCards.length} بطاقة</div>
      </div>
      <button class="btn btn-ghost btn-sm" data-nav="cards">
        عرض الكل
        ${svg(I.back, 2)}
      </button>
    </div>

    ${S.manualCards.length ? `
      <div class="grid-2" style="margin-bottom:24px">
        ${S.manualCards.slice(0, 2).map(cardMiniHtml).join('')}
      </div>
    ` : `
      <div class="card" style="margin-bottom:24px;text-align:center;padding:32px 20px">
        <div class="empty-icon" style="margin:0 auto 16px">${svg(I.card, 2)}</div>
        <div class="h4" style="margin-bottom:8px">لا بطاقات بعد</div>
        <p class="body-sm text-2" style="margin-bottom:20px">أصدر بطاقتك الأولى واستخدمها في أي موقع.</p>
        <button class="btn btn-primary" data-action="newCard">
          إصدار بطاقة
          ${svg(I.plus, 2)}
        </button>
      </div>
    `}

    <div class="flex-between mb-4">
      <div class="h4">آخر العمليات</div>
      <button class="btn btn-ghost btn-sm" data-nav="transactions">
        عرض الكل
        ${svg(I.back, 2)}
      </button>
    </div>

    ${recentTx.length ? `
      <div class="list" style="margin-bottom:24px">
        ${recentTx.map(txRow).join('')}
      </div>
    ` : `
      <div class="card" style="margin-bottom:24px;text-align:center;padding:32px 20px">
        <div class="empty-icon" style="margin:0 auto 16px">${svg(I.list, 2)}</div>
        <div class="h4" style="margin-bottom:8px">لا توجد معاملات بعد</div>
        <p class="body-sm text-2">ستظهر معاملاتك هنا بعد أول عملية.</p>
      </div>
    `}

    <div class="flex-between mb-4">
      <div class="h4">خدمات سريعة</div>
    </div>

    <div class="grid-4">
      <button class="quick-tile" data-nav="services">
        <span class="quick-icon">${svg(I.box, 2)}</span>
        <span class="quick-label">الخدمات</span>
      </button>
      <button class="quick-tile" data-nav="shop">
        <span class="quick-icon">${svg(I.grid, 2)}</span>
        <span class="quick-label">المتجر</span>
      </button>
      <button class="quick-tile" data-nav="referral">
        <span class="quick-icon">${svg(I.gift, 2)}</span>
        <span class="quick-label">ادعُ صديقًا</span>
      </button>
      <button class="quick-tile" data-nav="support">
        <span class="quick-icon">${svg(I.help, 2)}</span>
        <span class="quick-label">الدعم</span>
      </button>
    </div>
  </div>
  `;
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

function vShop() {
  const cats = S.config.categories || [];

  return `
  <div class="page-enter">
    <div class="mb-6">
      <h1 class="h2" style="margin-bottom:6px">المتجر</h1>
      <p class="body-sm text-2">تصفح خدماتنا واختر ما يناسبك.</p>
    </div>

    <div class="input-wrap mb-5">
      <span class="input-icon">${svg(I.search, 2)}</span>
      <input class="input" id="shopQ" placeholder="ابحث عن خدمة..." value="${esc(S.q)}">
    </div>

    ${cats.length ? `
      <div class="grid-2">
        ${cats.map(c => `
          <button class="service-card" data-cat="${esc(c.id)}" style="align-items:center;text-align:center;padding:20px">
            <div class="svc-icon" style="width:44px;height:44px;font-size:22px">${esc(c.icon || '📦')}</div>
            <div class="service-name">${esc(c.name)}</div>
          </button>
        `).join('')}
      </div>
    ` : `
      <div class="card" style="text-align:center;padding:48px 24px">
        <div class="empty-icon" style="margin:0 auto 16px">${svg(I.grid, 2)}</div>
        <div class="h4" style="margin-bottom:8px">المتجر قريباً</div>
        <p class="body-sm text-2">جاري تجهيز المنتجات.</p>
      </div>
    `}
  </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   Cards
   ═══════════════════════════════════════════════════════════ */

function vCards() {
  const active = S.manualCards.filter(c => c.status === 'active');

  return `
  <div class="page-enter">
    <div class="flex-between mb-6">
      <div>
        <h1 class="h2" style="margin-bottom:6px">بطاقاتي</h1>
        <p class="body-sm text-2">${active.length} بطاقة نشطة</p>
      </div>
      <button class="btn btn-primary btn-sm" data-action="newCard">
        ${svg(I.plus, 2)} إصدار بطاقة
      </button>
    </div>

    ${S.manualCards.length ? `
      <div class="grid-2">
        ${S.manualCards.map(c => `
          <button class="service-card" data-card="${esc(c.id)}" style="padding:0;overflow:hidden">
            ${renderCard(c)}
            <div style="padding:14px;text-align:right;width:100%">
              <div class="body" style="font-weight:600;margin-bottom:4px">${esc(c.card_name || 'بطاقة')}</div>
              <div class="caption">${esc(dt(c.created_at))}</div>
            </div>
          </button>
        `).join('')}
      </div>
    ` : `
      <div class="card" style="text-align:center;padding:48px 24px">
        <div class="empty-icon" style="margin:0 auto 16px">${svg(I.card, 2)}</div>
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

function vTransactions() {
  const rows = [
    ...S.manualOrders,
    ...S.deposits,
    ...S.svcOrders.map(o => ({
      ...o,
      kind: 'service',
      total_lyd: 0,
      total_usd: n(o.price_usd),
    })),
  ]
    .sort((a, b) => {
      const av = a.created_at?.toDate?.() || new Date(a.created_at || 0);
      const bv = b.created_at?.toDate?.() || new Date(b.created_at || 0);
      return bv - av;
    })
    .slice(0, 80);

  return `
  <div class="page-enter">
    <div class="mb-6">
      <h1 class="h2" style="margin-bottom:6px">المعاملات</h1>
      <p class="body-sm text-2">كل عملياتك في مكان واحد</p>
    </div>

    ${rows.length ? `
      <div class="list">
        ${rows.map(t => txRow(t)).join('')}
      </div>
    ` : `
      <div class="card" style="text-align:center;padding:48px 24px">
        <div class="empty-icon" style="margin:0 auto 16px">${svg(I.list, 2)}</div>
        <div class="h4" style="margin-bottom:8px">لا توجد معاملات بعد</div>
        <p class="body-sm text-2">ستظهر معاملاتك هنا بعد أول عملية.</p>
      </div>
    `}
  </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   Orders
   ═══════════════════════════════════════════════════════════ */

function vOrders() {
  return `
  <div class="page-enter">
    <div class="mb-6">
      <h1 class="h2" style="margin-bottom:6px">طلباتي</h1>
    </div>

    ${S.orders.length ? `
      <div class="list">
        ${S.orders.map(o => `
          <div class="list-row" data-order="${esc(o.id)}">
            <div class="list-icon">${svg(I.bag, 2)}</div>
            <div class="list-content">
              <div class="list-title">${esc((o.items && o.items[0] && o.items[0].name) || 'طلب')}</div>
              <div class="list-meta">${esc(dt(o.created_at))}</div>
            </div>
            <div class="list-end">
              <div class="list-amount">${esc(lyd(o.total_lyd))}</div>
              <span class="badge ${o.status === 'completed' ? 'badge-success' : o.status === 'pending' ? 'badge-warning' : 'badge-error'}" style="margin-top:4px">
                ${o.status === 'completed' ? 'مكتمل' : o.status === 'pending' ? 'قيد التنفيذ' : 'ملغى'}
              </span>
            </div>
          </div>
        `).join('')}
      </div>
    ` : `
      <div class="card" style="text-align:center;padding:48px 24px">
        <div class="empty-icon" style="margin:0 auto 16px">${svg(I.bag, 2)}</div>
        <div class="h4" style="margin-bottom:8px">لا طلبات بعد</div>
        <p class="body-sm text-2" style="margin-bottom:20px">تصفح المتجر وابدأ أول طلب.</p>
        <button class="btn btn-primary" data-nav="shop">تصفح المتجر</button>
      </div>
    `}
  </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   Referral
   ═══════════════════════════════════════════════════════════ */

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
          <div class="list-row">
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

function vPlans() {
  return `
  <div class="page-enter">
    <div class="mb-6">
      <h1 class="h2" style="margin-bottom:6px">الباقات</h1>
      <p class="body-sm text-2">اختر الباقة المناسبة لاستخدامك.</p>
    </div>

    <div class="grid-3">
      <div class="card card-lg">
        <div class="eyebrow mb-2">Basic</div>
        <div class="h4 mb-3">للبدء</div>
        <div style="display:flex;align-items:baseline;gap:6px;margin:20px 0">
          <span class="tabular" style="font-size:28px;font-weight:700">0</span>
          <span class="body-sm text-3">د.ل / شهر</span>
        </div>
        <ul style="display:flex;flex-direction:column;gap:10px;margin:20px 0;font-size:13px">
          <li>✓ بطاقة واحدة</li>
          <li>✓ محفظة كاملة</li>
          <li>✓ دعم عادي</li>
        </ul>
        <button class="btn btn-secondary btn-block">الحالية</button>
      </div>

      <div class="card card-lg" style="border-color:var(--brand)">
        <div class="eyebrow mb-2" style="color:var(--brand)">Pro</div>
        <div class="h4 mb-3">للاستخدام اليومي</div>
        <div style="display:flex;align-items:baseline;gap:6px;margin:20px 0">
          <span class="tabular" style="font-size:28px;font-weight:700">20</span>
          <span class="body-sm text-3">د.ل / شهر</span>
        </div>
        <ul style="display:flex;flex-direction:column;gap:10px;margin:20px 0;font-size:13px">
          <li>✓ 5 بطاقات</li>
          <li>✓ رسوم أقل</li>
          <li>✓ دعم أولوية</li>
        </ul>
        <button class="btn btn-primary btn-block">ترقية</button>
      </div>

      <div class="card card-lg">
        <div class="eyebrow mb-2">Business</div>
        <div class="h4 mb-3">للشركات</div>
        <div style="display:flex;align-items:baseline;gap:6px;margin:20px 0">
          <span class="tabular" style="font-size:28px;font-weight:700">50</span>
          <span class="body-sm text-3">د.ل / شهر</span>
        </div>
        <ul style="display:flex;flex-direction:column;gap:10px;margin:20px 0;font-size:13px">
          <li>✓ بطاقات غير محدودة</li>
          <li>✓ رسوم تنافسية</li>
          <li>✓ مدير مخصص</li>
        </ul>
        <button class="btn btn-secondary btn-block">تواصل</button>
      </div>
    </div>
  </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   Bind Events
   ═══════════════════════════════════════════════════════════ */

function bind() {
  $$('[data-nav]').forEach(b => b.onclick = () => go(b.dataset.nav));

  $$('[data-action]').forEach(b => {
    b.onclick = () => {
      const a = b.dataset.action;
      if (a === 'deposit') return openDeposit();
      if (a === 'newCard') return openNewCard();
      if (a === 'transfer') return toast('التحويل قريبًا', 'ok');
      if (a === 'withdraw') return toast('السحب قريبًا', 'ok');
    };
  });

  $$('[data-card]').forEach(b => b.onclick = () => openCardDetails(b.dataset.card));

  $$('[data-buy-svc]').forEach(b => b.onclick = () => openServiceBuy(b.dataset.buySvc));
  $$('[data-svc-order]').forEach(b => b.onclick = () => openServiceOrderDetail(b.dataset.svcOrder));

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
    btn.disabled = (S.profile.wallet_balance || 0) < total;
    if (btn.disabled) box.innerHTML += `<div class="alert alert-warning" style="margin-top:12px">${svg(I.help, 2)}<div>رصيدك غير كافٍ — المتاح ${usd(S.profile.wallet_balance)}</div></div>`;
  };

  $('#ncAmount').oninput = calc;

  const ncIdemKey = newIdemKey();
  $('#ncSubmit').onclick = async () => {
    const btn = $('#ncSubmit');
    const name = $('#ncName').value.trim().toUpperCase();
    const amount = n($('#ncAmount').value);

    if (!/^[A-Z][A-Z .'-]{1,23}$/.test(name)) return toast('اكتب الاسم بحروف لاتينية', 'bad');

    btn.disabled = true;
    btn.classList.add('loading');
    try {
      await api('/api/mcard/request', {
        amount,
        name_on_card: name,
        card_name: $('#ncLabel').value.trim() || 'بطاقتي',
        idempotency_key: ncIdemKey,
      });
      closeModal();
      toast('وصل طلبك — سيُصدر خلال دقائق', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  };
}

async function openDeposit() {
  modal(`
    <div class="modal-head">
      <div class="modal-title">إضافة رصيد</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>
    <div class="list">
      <div class="list-row" data-method="libyana">
        <div class="list-icon brand">${svg(I.up, 2)}</div>
        <div class="list-content">
          <div class="list-title">ليبيانا</div>
          <div class="list-meta">تحويل فوري عبر SMS</div>
        </div>
        <div class="list-end">${svg(I.back, 2)}</div>
      </div>
      <div class="list-row" data-method="almadar">
        <div class="list-icon brand">${svg(I.up, 2)}</div>
        <div class="list-content">
          <div class="list-title">المدار</div>
          <div class="list-meta">تحويل فوري عبر SMS</div>
        </div>
        <div class="list-end">${svg(I.back, 2)}</div>
      </div>
    </div>
    <button class="btn btn-secondary btn-block" style="margin-top:16px" data-act="close-modal">إلغاء</button>
  `);
  $$('[data-method]').forEach(b => b.onclick = () => openDepositMethod(b.dataset.method));
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
  if (!S.profile.phone_verified) {
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
      <label class="field-label">رقمك الذي حوّلت منه</label>
      <div class="input" dir="ltr" aria-readonly="true">0${esc(S.profile.phone_verified)} ✓</div>
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

    btn.disabled = true;
    btn.classList.add('loading');
    try {
      const r = await api('/api/wallet/claim', { amount_lyd: amount, method });
      closeModal();
      if (r.matched) toast('أُضيف ' + usd(r.credited_usd) + ' إلى محفظتك', 'ok');
      else toast('طلبك قيد المعالجة — سيُضاف تلقائيًا', 'ok');
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

  const orders = S.manualOrders.filter(o => o.card_id === cardId && o.status === 'completed');
  const lastOrder = orders[0];

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
        <span class="body-sm text-2">الرصيد</span>
        <span class="tabular" style="font-weight:700">${usd(c.balance)}</span>
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

    <button class="btn btn-secondary btn-block" data-act="close-modal">إغلاق</button>
  `);

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
  const o = S.orders.find(x => x.id === orderId);
  if (!o) return;

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

    <button class="btn btn-secondary btn-block" data-act="close-modal">إغلاق</button>
  `);
}

async function loadCatalog() {
  try {
    const d = await apiGet('/api/catalog');
    S.catalog = {
      categories: d.categories || [],
      products: d.products || [],
    };
    S.config = { ...S.config, categories: S.catalog.categories };
    render();
  } catch (e) {
    console.warn('catalog:', e.message);
  }
}

/* ═══ Expose helpers to inline handlers ═══ */
window.__toast = toast;

/* ═══ Delegated actions (بديل onclick المضمّن — متوافق مع CSP) ═══ */
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'close-modal') { e.preventDefault(); window.closeModal(); }
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
window.addEventListener('offline', () => toast('انقطع الاتصال بالإنترنت', 'bad'));
window.addEventListener('online', () => toast('عاد الاتصال', 'ok'));


/* ═══ Public page interactions ═══ */
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
