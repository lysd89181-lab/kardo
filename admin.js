import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, getDocs, onSnapshot, collection, query,
  orderBy, limit }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initializeAppCheck, ReCaptchaV3Provider, getToken as getAppCheckToken }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js';

/* ═══ Config ═══ */
const API_BASE = 'https://kardo.sdkhyrallh08.workers.dev';

const firebaseConfig = {
  apiKey: "AIzaSyC-GntWur6r_Ow_v0wTNymQqQa6brzgvW8",
  authDomain: "kardo-1c657.firebaseapp.com",
  projectId: "kardo-1c657",
  storageBucket: "kardo-1c657.firebasestorage.app",
  messagingSenderId: "593934928630",
  appId: "1:593934928630:web:d36ea455a284e974043ad7"
};

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
  admin: null,
  page: 'home',
  unsub: [],
  users: [],
  cards: [],
  manualCards: [],
  manualOrders: [],
  orders: [],
  deposits: [],
  withdrawals: [],
  tickets: [],
  coupons: [],
  sms: [],
  logs: [],
  services: [],
  serviceOrders: [],
  settings: {},
  q: '',
  filter: 'all',
  setTab: 'ops',
  svcTab: 'list',
  svcSelected: '',
  svcStock: { items: [], stats: { unused: 0, used: 0, total: 0 } },
  revealMode: false,
};

/* ═══ Helpers ═══ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const usd = v => '$' + Number(v || 0).toFixed(2);
const lyd = v => Number(v || 0).toLocaleString('en-US',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' د.ل';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v, f = 0) => { const x = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(x) ? x : f; };
const dt = v => {
  if (!v) return '—';
  const d = v.toDate ? v.toDate() : new Date(v);
  return isNaN(d) ? '—' : d.toLocaleDateString('ar-LY', { day: '2-digit', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};
const shortDate = v => {
  const d = v?.toDate ? v.toDate() : new Date(v);
  return isNaN(d) ? '—' : d.toLocaleDateString('ar-LY', { day: 'numeric', month: 'short' });
};

/* ═══ Icons ═══ */
const I = {
  home: '<path d="M3 10.4 12 3l9 7.4V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  bag: '<path d="M4.5 8h15l-1.2 12.2a1.8 1.8 0 0 1-1.8 1.6H7.5a1.8 1.8 0 0 1-1.8-1.6z"/><path d="M8.5 8V6a3.5 3.5 0 0 1 7 0v2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  warn: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.3"/><path d="M12 17h.01"/>',
  sms: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  ticket: '<path d="M2 9V7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M13 5v14"/>',
  coupon: '<path d="M20.5 13.5 13 21a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 2.4 12V4.4A2 2 0 0 1 4.4 2.4H12a2 2 0 0 1 1.4.6l7.1 7.1a2 2 0 0 1 0 2.8z"/><path d="M7.5 7.5h.01"/>',
  withdraw: '<path d="M12 5v14M18.5 12.5 12 19l-6.5-6.5"/>',
  orders: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.9 17.9A10.6 10.6 0 0 1 12 19c-6.4 0-10-7-10-7a18 18 0 0 1 4.1-5M9.9 4.2A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-2.2 3.2M3 3l18 18"/>',
};
const svg = (d, w = 1.75) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

/* ═══ UI Helpers ═══ */
const setHTML = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; };
const onTap = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind === 'ok' ? 'success' : kind === 'bad' ? 'error' : '');
  el.innerHTML = `<span style="color:${kind === 'ok' ? 'var(--success)' : kind === 'bad' ? 'var(--error)' : 'var(--text-2)'}">${svg(kind === 'ok' ? I.check : kind === 'bad' ? I.x : I.help, 2.2)}</span><span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = '.2s';
    setTimeout(() => el.remove(), 200);
  }, 3200);
}

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

function newIdemKey() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return 'k' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

async function api(path, body) {
  const token = await auth.currentUser.getIdToken();
  let ac = {};
  if (appCheckInstance) { try { ac = { 'x-firebase-appcheck': (await getAppCheckToken(appCheckInstance)).token }; } catch {} }
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, ...ac },
    body: JSON.stringify(body || {}),
  });
  const d = await res.json().catch(() => ({ success: false, error: 'رد غير مفهوم' }));
  if (!d.success) throw new Error(d.error || 'فشلت العملية');
  return d;
}

/* ═══ Auth Gate ═══ */
onTap('#gGo', async () => {
  const email = $('#gEmail').value.trim();
  const pass = $('#gPass').value;
  if (!email || !pass) return showGateErr('أكمل البيانات');
  $('#gGo').disabled = true;
  $('#gGo').classList.add('loading');
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch {
    showGateErr('البريد أو كلمة المرور غير صحيحة');
    $('#gGo').disabled = false;
    $('#gGo').classList.remove('loading');
  }
});

$('#gPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#gGo').click(); });

function showGateErr(m) {
  const el = $('#gErr');
  el.textContent = m;
  el.style.display = 'block';
}

onAuthStateChanged(auth, async user => {
  S.unsub.forEach(u => { try { u(); } catch {} });
  S.unsub = [];
  if (!user) {
    $('#gate').style.display = 'grid';
    $('#app').style.display = 'none';
    return;
  }

  try {
    const adminSnap = await getDoc(doc(db, 'admins', user.uid));
    if (!adminSnap.exists()) {
      await signOut(auth);
      $('#gate').style.display = 'grid';
      showGateErr('هذا الحساب ليس لديه صلاحية إدارة.');
      return;
    }
    const adm = adminSnap.data() || {};
    if (!['super_admin', 'finance', 'support', 'ops'].includes(adm.role) || adm.disabled === true) {
      await signOut(auth);
      $('#gate').style.display = 'grid';
      showGateErr('الحساب الإداري بلا دور صالح — راجع المسؤول الرئيسي.');
      return;
    }
    S.admin = { uid: user.uid, email: user.email, ...adm };
    $('#gate').style.display = 'none';
    $('#app').style.display = 'block';
    const ROLE_AR = { super_admin: 'مسؤول رئيسي', finance: 'مالية', support: 'دعم', ops: 'عمليات' };
    $('#admName').textContent = (S.admin.email || 'مدير') + ' · ' + (ROLE_AR[S.admin.role] || '');
    $('#admInitial').textContent = (S.admin.email || 'A').charAt(0).toUpperCase();
    subscribe();
    boot();
  } catch (e) {
    await signOut(auth);
    $('#gate').style.display = 'grid';
    showGateErr('تعذّر التحقق من الصلاحيات.');
  }
});

/* ═══ Subscriptions ═══ */
function sub(q, key) {
  S.unsub.push(onSnapshot(q, s => {
    S[key] = s.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, err => {
    console.warn(key, err.code);
  }));
}

const QUERIES = {
  users:         l => query(collection(db, 'users'), orderBy('created_at', 'desc'), limit(l)),
  manualCards:   l => query(collection(db, 'manual_cards'), orderBy('created_at', 'desc'), limit(l)),
  manualOrders:  l => query(collection(db, 'manual_card_orders'), orderBy('created_at', 'desc'), limit(l)),
  orders:        l => query(collection(db, 'orders'), orderBy('created_at', 'desc'), limit(l)),
  deposits:      l => query(collection(db, 'wallet_deposits'), orderBy('created_at', 'desc'), limit(l)),
  withdrawals:   l => query(collection(db, 'withdrawals'), orderBy('created_at', 'desc'), limit(l)),
  tickets:       l => query(collection(db, 'tickets'), orderBy('updated_at', 'desc'), limit(l)),
  coupons:       l => query(collection(db, 'coupons'), limit(l)),
  sms:           l => query(collection(db, 'sms_transactions'), orderBy('created_at', 'desc'), limit(l)),
  services:      l => query(collection(db, 'services'), limit(l)),
  serviceOrders: l => query(collection(db, 'service_orders'), orderBy('created_at', 'desc'), limit(l)),
};
S.lim = { users: 100, manualCards: 100, manualOrders: 100, orders: 60, deposits: 60, withdrawals: 50, tickets: 50, coupons: 100, sms: 50, services: 150, serviceOrders: 60 };
S.subByKey = {};
function subKey(key) {
  if (S.subByKey[key]) { try { S.subByKey[key](); } catch {} }
  S.subByKey[key] = onSnapshot(QUERIES[key](S.lim[key]), s => {
    S[key] = s.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, err => console.warn(key, err.code));
  S.unsub.push(() => { try { S.subByKey[key](); } catch {} });
}

function subscribe() {
  Object.keys(QUERIES).forEach(subKey);
  S.unsub.push(onSnapshot(doc(db, 'settings', 'main'), s => {
    if (s.exists()) S.settings = s.data();
    render();
  }, () => {}));
}

/* ═══ Boot ═══ */
function boot() {
  buildNav();
  render();
}

window.refreshAll = () => render();

/* ═══ Nav ═══ */
const PAGES = [
  { k: 'home',       t: 'الرئيسية',       i: I.home,     g: 'الرئيسية' },
  { k: 'mcards',     t: 'طلبات البطاقات', i: I.card,     g: 'العمليات', badge: 'pendMc' },
  { k: 'cards',      t: 'البطاقات',       i: I.card,     g: 'العمليات' },
  { k: 'orders',     t: 'طلبات المتجر',   i: I.orders,   g: 'العمليات', badge: 'pendOrd' },
  { k: 'services',   t: 'الخدمات الرقمية', i: I.grid,     g: 'العمليات', badge: 'pendSvc' },
  { k: 'store',      t: 'إدارة المتجر',    i: I.box,      g: 'العمليات' },
  { k: 'deposits',   t: 'الإيداعات',      i: I.cash,     g: 'المالية', badge: 'pendDep' },
  { k: 'withdraw',   t: 'السحوبات',       i: I.withdraw, g: 'المالية', badge: 'pendWd' },
  { k: 'tickets',    t: 'التذاكر',        i: I.ticket,   g: 'الدعم', badge: 'openTic' },
  { k: 'coupons',    t: 'الكوبونات',      i: I.coupon,   g: 'المزيد' },
  { k: 'users',      t: 'المستخدمون',     i: I.users,    g: 'المزيد' },
  { k: 'sms',        t: 'الرسائل',        i: I.sms,      g: 'المزيد' },
  { k: 'settings',   t: 'الإعدادات',      i: I.gear,     g: 'النظام' },
  { k: 'system',     t: 'النظام والموظفون', i: I.users,    g: 'النظام' },
];

const DOCK = ['home', 'mcards', 'services', 'deposits', 'settings'];

const pendMc = () => S.manualOrders.filter(o => o.status === 'pending').length;
const pendOrd = () => S.orders.filter(o => o.status === 'pending').length;
const pendSvc = () => S.serviceOrders.filter(o => o.status === 'pending').length;
const pendDep = () => S.deposits.filter(d => d.status === 'pending').length;
const pendWd = () => S.withdrawals.filter(w => w.status === 'pending').length;
const openTic = () => S.tickets.filter(t => t.status === 'open').length;

const BADGES = { pendMc, pendOrd, pendSvc, pendDep, pendWd, openTic };

function buildNav() {
  const groups = {};
  PAGES.forEach(p => {
    if (!groups[p.g]) groups[p.g] = [];
    groups[p.g].push(p);
  });

  let rail = '';
  for (const [g, items] of Object.entries(groups)) {
    rail += `<span class="admin-group-label">${esc(g)}</span><div class="admin-group">`;
    items.forEach(p => {
      const c = p.badge ? BADGES[p.badge]() : 0;
      rail += `<button class="admin-nav-item" data-nav="${esc(p.k)}">
        ${svg(p.i)}
        <span>${esc(p.t)}</span>
        ${c ? `<span class="admin-badge">${c}</span>` : ''}
      </button>`;
    });
    rail += `</div>`;
  }
  setHTML('#navDesk', rail);

  const dk = DOCK.map(k => PAGES.find(p => p.k === k)).filter(Boolean);
  const dockEl = $('#navDock');
  if (dockEl) {
    dockEl.style.gridTemplateColumns = `repeat(${dk.length}, 1fr)`;
    dockEl.innerHTML = dk.map(p => {
      const c = p.badge ? BADGES[p.badge]() : 0;
      return `<button class="admin-dock-item" data-nav="${esc(p.k)}">
        ${c ? '<span class="dot"></span>' : ''}
        ${svg(p.i)}
        <span>${esc(p.t.split(' ')[0])}</span>
      </button>`;
    }).join('');
  }

  document.querySelectorAll('[data-nav]').forEach(b => {
    b.onclick = () => go(b.dataset.nav);
    b.classList.toggle('active', b.dataset.nav === S.page);
  });
}

window.go = k => {
  S._dirty = false;
  if (k === 'store') loadStore();
  if (k === 'system') loadStaff();
  S.page = k;
  S.q = '';
  S.filter = 'all';
  window.scrollTo({ top: 0, behavior: 'instant' });
  render();
};

/* ═══ Render ═══ */
let _lastPage = null, _lastHtml = '', _deferred = false;
function render(force = false) {
  buildNav();

  const killChip = $('#killChip');
  if (killChip) killChip.style.display = S.settings.kill_switch === true ? 'inline-flex' : 'none';

  const views = {
    home: vHome,
    mcards: vMcardOrders,
    cards: vCards,
    orders: vShopOrders,
    services: vServices,
    store: vStore,
    system: vSystem,
    deposits: vDeposits,
    withdraw: vWithdraw,
    tickets: vTickets,
    coupons: vCoupons,
    users: vUsers,
    sms: vSms,
    settings: vSettings,
  };
  const html = (views[S.page] || vHome)() + moreBtn();
  const same = _lastPage === S.page;
  if (same && !force && html === _lastHtml) return;                     // لا تغيير → لا رمشة
  const view = $('#view'), ae = document.activeElement;
  if (same && !force && view && ae && view.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) {
    if (!_deferred) { _deferred = true; ae.addEventListener('blur', () => { _deferred = false; render(); }, { once: true }); }
    return;                                                             // لا نمسح ما يكتبه الأدمن
  }
  if (same && !force && S.page === 'settings' && S._dirty) return;     // تعديلات إعدادات غير محفوظة
  const y = window.scrollY;
  setHTML('#view', same ? html.replace('class="page-enter"', 'class=""') : html);
  _lastPage = S.page; _lastHtml = html;
  bind();
  if (same) window.scrollTo(0, y);
  if (S.page === 'sms' && !same) loadPhonePending();
}

/* ═══ Helpers ═══ */
function kpi(icon, val, label) {
  return `<div class="admin-kpi">
    <div class="admin-kpi-icon">${svg(icon)}</div>
    <div class="admin-kpi-value">${esc(String(val))}</div>
    <div class="admin-kpi-label">${esc(label)}</div>
  </div>`;
}

function emptyState(icon, title, desc = '', action = '') {
  return `<div class="card" style="text-align:center;padding:36px 20px">
    <div class="empty-icon" style="margin:0 auto 12px">${svg(icon, 2)}</div>
    <div class="h4" style="margin-bottom:6px">${esc(title)}</div>
    ${desc ? `<p class="body-sm text-2" style="margin-bottom:16px">${esc(desc)}</p>` : ''}
    ${action}
  </div>`;
}

const userName = uid => {
  const u = S.users.find(x => x.id === uid);
  return u ? (u.name || u.email || uid) : (uid || '—');
};

/* ═══ Home ═══ */
function vHome() {
  const mcPend = pendMc();
  const mcDone = S.manualOrders.filter(o => o.status === 'completed').length;
  const ordRev = S.orders.filter(o => o.status === 'completed').reduce((s, o) => s + n(o.total_usd), 0);
  const subRev = S.manualOrders.filter(o => o.status === 'completed').reduce((s, o) => s + n(o.total), 0);
  const svcRev = S.serviceOrders.filter(o => o.status === 'delivered').reduce((s, o) => s + n(o.price_usd), 0);

  return `
  <div class="page-enter">
    <div style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.15em;color:var(--sand);text-transform:uppercase;margin-bottom:6px">
      OVERVIEW
    </div>
    <h1 class="h2" style="margin-bottom:4px;font-family:var(--font-display)">نظرة عامة</h1>
    <p class="body-sm text-2" style="margin-bottom:20px">ملخص أداء المنصة</p>

    ${S.settings.kill_switch === true ? `
      <div class="alert alert-error mb-4">
        ${svg(I.warn, 2)}
        <div><strong>المنصة متوقفة الآن</strong><br>
        العملاء لا يستطيعون الشراء.
        <button style="color:inherit;font-weight:700;text-decoration:underline;background:none;border:none;cursor:pointer;font-size:11.5px" data-act="go" data-page="settings">إلغاء الإيقاف</button></div>
      </div>
    ` : ''}

    <div class="admin-kpis">
      ${kpi(I.card, mcPend, 'PENDING CARDS')}
      ${kpi(I.check, mcDone, 'COMPLETED')}
      ${kpi(I.cash, lyd(subRev), 'CARD REVENUE')}
      ${kpi(I.bag, lyd(ordRev * 11.8), 'STORE SALES')}
      ${kpi(I.grid, usd(svcRev), 'SERVICES REV')}
      ${kpi(I.clock, pendDep() + pendOrd() + pendWd() + pendSvc(), 'IN PROGRESS')}
    </div>

    <div class="grid-2 mb-5">
      <div class="card">
        <div class="h4" style="margin-bottom:12px">إجراءات سريعة</div>
        <div style="display:grid;gap:6px">
          <button class="btn btn-secondary" style="justify-content:flex-start" data-nav="mcards">
            ${svg(I.card)} طلبات البطاقات (${mcPend})
          </button>
          <button class="btn btn-secondary" style="justify-content:flex-start" data-nav="services">
            ${svg(I.grid)} طلبات الخدمات (${pendSvc()})
          </button>
          <button class="btn btn-secondary" style="justify-content:flex-start" data-nav="deposits">
            ${svg(I.cash)} الإيداعات (${pendDep()})
          </button>
          <button class="btn btn-secondary" style="justify-content:flex-start" data-nav="settings">
            ${svg(I.gear)} الإعدادات
          </button>
        </div>
      </div>

      <div class="card">
        <div class="h4" style="margin-bottom:12px">آخر طلبات البطاقات</div>
        ${S.manualOrders.length ? `
          <div style="display:flex;flex-direction:column;gap:8px">
            ${S.manualOrders.slice(0, 5).map(o => `
              <div style="display:flex;gap:8px;align-items:center;padding-bottom:8px;border-bottom:1px solid var(--border)">
                <span class="mono caption" style="font-size:10px;color:var(--sand)">${esc(o.id.slice(-10))}</span>
                <span class="body-sm" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px">${esc(userName(o.uid))}</span>
                <span class="tabular body-sm" style="font-weight:700;color:var(--sand);font-size:11.5px">${esc(usd(o.total))}</span>
              </div>
            `).join('')}
          </div>
        ` : `<p class="body-sm text-3">لا طلبات بعد</p>`}
      </div>
    </div>
  </div>
  `;
}
  
/* ═══════════════════════════════════════════════════════════
   Manual Card Orders
   ═══════════════════════════════════════════════════════════ */

function vMcardOrders() {
  const F = [['all', 'الكل'], ['pending', 'قيد التنفيذ'],
             ['completed', 'مكتملة'], ['rejected', 'مرفوضة']];
  let rows = S.manualOrders;
  if (S.filter !== 'all') rows = rows.filter(o => o.status === S.filter);
  if (S.q) rows = rows.filter(o =>
    (o.id + ' ' + userName(o.uid)).toLowerCase().includes(S.q.toLowerCase()));

  const pend = S.manualOrders.filter(o => o.status === 'pending').length;

  return `
  <div class="page-enter">
    <div class="mb-4">
      <div style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.15em;color:var(--sand);text-transform:uppercase;margin-bottom:6px">
        CARD REQUESTS
      </div>
      <h1 class="h2" style="margin-bottom:4px;font-family:var(--font-display)">طلبات البطاقات</h1>
      <p class="body-sm text-2" style="font-size:11.5px">${pend ? pend + ' طلب ينتظر التنفيذ' : 'لا طلبات معلّقة'}</p>
    </div>

    <div class="input-wrap mb-3">
      <span class="input-icon">${svg(I.list)}</span>
      <input class="input" id="qBox" placeholder="ابحث برقم الطلب أو اسم العميل" value="${esc(S.q)}">
    </div>

    <div class="pills mb-3">
      ${F.map(([k, t]) => {
        const c = k === 'all' ? S.manualOrders.length : S.manualOrders.filter(o => o.status === k).length;
        return `<button class="pill ${S.filter === k ? 'active' : ''}" data-filter="${esc(k)}">${esc(t)} (${c})</button>`;
      }).join('')}
    </div>

    ${rows.length ? `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>رقم الطلب</th>
              <th>العميل</th>
              <th>النوع</th>
              <th>المبلغ</th>
              <th>الإجمالي</th>
              <th>الحالة</th>
              <th>التاريخ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(o => {
              const st = { pending: 'badge-warning', completed: 'badge-success', rejected: 'badge-error' }[o.status];
              const lbl = { pending: 'قيد التنفيذ', completed: 'مكتملة', rejected: 'مرفوضة' }[o.status];
              return `
                <tr>
                  <td class="mono" style="font-size:10.5px;color:var(--sand)">${esc(o.id.slice(-12))}</td>
                  <td>${esc(userName(o.uid))}</td>
                  <td>${o.kind === 'topup' ? 'شحن' : 'جديدة'}</td>
                  <td class="tabular">${esc(usd(o.amount))}</td>
                  <td class="tabular" style="font-weight:700;color:var(--sand)">${esc(usd(o.total))}</td>
                  <td><span class="badge ${st}">${esc(lbl)}</span></td>
                  <td class="caption">${esc(dt(o.created_at))}</td>
                  <td>
                    ${o.status === 'pending'
                      ? `<button class="btn btn-primary btn-sm" data-mc="${esc(o.id)}">تنفيذ</button>`
                      : ''}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    ` : emptyState(I.card, 'لا نتائج', 'جرّب تصفية أخرى.')}
  </div>
  `;
}

function openMcardFulfil(id) {
  const o = S.manualOrders.find(x => x.id === id);
  if (!o) return;
  const isTopup = o.kind === 'topup';

  modal(`
    <div class="modal-head">
      <div class="modal-title">${isTopup ? 'شحن بطاقة' : 'إصدار بطاقة جديدة'}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>

    <div class="card card-sm mb-3" style="background:var(--surface-2);border:none">
      <div class="flex-between" style="padding:3px 0"><span class="caption">العميل</span><span class="body-sm">${esc(userName(o.uid))}</span></div>
      <div class="flex-between" style="padding:3px 0"><span class="caption">المبلغ</span><span class="tabular" style="font-weight:700;color:var(--sand)">${esc(usd(o.amount))}</span></div>
      ${o.name_on_card ? `<div class="flex-between" style="padding:3px 0"><span class="caption">الاسم</span><span class="mono" style="font-size:11px">${esc(o.name_on_card)}</span></div>` : ''}
    </div>

    ${!isTopup ? `
      <div class="field mb-3">
        <label class="field-label">رقم البطاقة</label>
        <input class="input mono" id="fPan" dir="ltr" placeholder="5395 0212 3456 7890" maxlength="19" inputmode="numeric" autocomplete="off">
      </div>
      <div class="grid-2 mb-3">
        <div>
          <label class="field-label">الانتهاء</label>
          <input class="input mono" id="fExp" dir="ltr" placeholder="12/28" maxlength="5" autocomplete="off">
        </div>
        <div>
          <label class="field-label">CVV</label>
          <input class="input mono" id="fCvv" dir="ltr" placeholder="123" maxlength="4" inputmode="numeric" autocomplete="off">
        </div>
      </div>
      <div class="field mb-3">
        <label class="field-label">رقم مرجعي (اختياري)</label>
        <input class="input mono" id="fRef" dir="ltr" placeholder="ORDER-123456" autocomplete="off">
      </div>
      <div class="alert alert-info mb-3" style="font-size:11px">
        ${svg(I.help, 2)}
        <div>🔒 سيتم تشفير بيانات البطاقة (AES-256-GCM) قبل الحفظ</div>
      </div>
    ` : `<div class="alert alert-info mb-3" style="font-size:11.5px">${svg(I.help)}<div>أضف ${esc(usd(o.amount))} على البطاقة عند مزودك، ثم أكّد هنا.</div></div>`}

    <button class="btn btn-primary btn-block" id="fGo">
      ${isTopup ? 'تأكيد الشحن' : 'تسليم البيانات للعميل'}
    </button>
    <button class="btn btn-outline-danger btn-block" style="margin-top:6px" id="fRej">
      رفض الطلب وإرجاع المبلغ
    </button>
  `);

  const fPan = $('#fPan');
  if (fPan) fPan.oninput = e => {
    const v = e.target.value.replace(/\D/g, '').slice(0, 19);
    e.target.value = v.replace(/(.{4})/g, '$1 ').trim();
  };
  const fExp = $('#fExp');
  if (fExp) fExp.oninput = e => {
    let v = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
    e.target.value = v;
  };
  const fCvv = $('#fCvv');
  if (fCvv) fCvv.oninput = e => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
  };

  onTap('#fGo', async () => {
    const btn = $('#fGo');
    const payload = { id };
    if (!isTopup) {
      const pan = ($('#fPan').value || '').replace(/\s+/g, '');
      const exp = $('#fExp').value;
      const cvv = $('#fCvv').value;
      if (!/^\d{13,19}$/.test(pan)) return toast('رقم البطاقة غير صالح', 'bad');
      if (!/^\d{2}\/\d{2}$/.test(exp)) return toast('صيغة التاريخ MM/YY', 'bad');
      if (!/^\d{3,4}$/.test(cvv)) return toast('CVV غير صالح', 'bad');
      payload.card_number = pan;
      payload.expiry = exp;
      payload.cvv = cvv;
      payload.provider_ref = $('#fRef').value;
    }
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      await api('/api/admin/mcard/fulfil', payload);
      if (fPan) fPan.value = '';
      if (fExp) fExp.value = '';
      if (fCvv) fCvv.value = '';
      closeModal();
      toast('تم التنفيذ', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });

  onTap('#fRej', () => {
    modal(`
      <div class="modal-head">
        <div class="modal-title">رفض الطلب</div>
        <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
      </div>
      <div class="alert alert-warning mb-3" style="font-size:11.5px">${svg(I.warn)}<div>سيُعاد ${esc(usd(o.total))} إلى محفظة العميل.</div></div>
      <div class="field mb-3">
        <label class="field-label">سبب الرفض (اختياري)</label>
        <input class="input" id="rjWhy" placeholder="تعذّر التنفيذ">
      </div>
      <button class="btn btn-danger btn-block" id="rjGo">تأكيد الرفض</button>
      <button class="btn btn-secondary btn-block" style="margin-top:6px" data-act="mcard-fulfil" data-id="${esc(id)}">رجوع</button>
    `);
    onTap('#rjGo', async () => {
      const btn = $('#rjGo');
      btn.disabled = true;
      btn.classList.add('loading');
      try {
        await api('/api/admin/mcard/reject', { id, reason: $('#rjWhy').value || 'بدون سبب' });
        closeModal();
        toast('تم الرفض', 'ok');
      } catch (e) {
        toast(e.message, 'bad');
        btn.disabled = false;
        btn.classList.remove('loading');
      }
    });
  });
}
window.openMcardFulfil = openMcardFulfil;

/* ═══════════════════════════════════════════════════════════
   Cards
   ═══════════════════════════════════════════════════════════ */

function vCards() {
  let rows = S.manualCards;
  if (S.q) rows = rows.filter(c =>
    (c.last4 + ' ' + userName(c.uid)).toLowerCase().includes(S.q.toLowerCase()));

  return `
  <div class="page-enter">
    <div class="flex-between mb-3">
      <div>
        <div style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.15em;color:var(--sand);text-transform:uppercase;margin-bottom:6px">
          CARDS
        </div>
        <h1 class="h2" style="margin-bottom:4px;font-family:var(--font-display)">البطاقات المُصدرة</h1>
        <p class="body-sm text-2" style="font-size:11.5px">${rows.length} بطاقة</p>
      </div>
    </div>

    <div class="input-wrap mb-3">
      <span class="input-icon">${svg(I.list)}</span>
      <input class="input" id="qBox" placeholder="ابحث برقم البطاقة أو اسم العميل" value="${esc(S.q)}">
    </div>

    ${rows.length ? `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>العميل</th>
              <th>البطاقة</th>
              <th>آخر 4</th>
              <th>الرصيد</th>
              <th>الحالة</th>
              <th>التاريخ</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(c => `
              <tr>
                <td>${esc(userName(c.uid))}</td>
                <td>${esc(c.card_name || '—')}</td>
                <td class="mono" style="color:var(--sand)">••${esc(c.last4 || '')}</td>
                <td class="tabular" style="font-weight:700;color:var(--sand)">${esc(usd(c.balance))}</td>
                <td><span class="badge ${c.status === 'active' ? 'badge-success' : 'badge-neutral'}">${c.status === 'active' ? 'نشطة' : 'مجمدة'}</span></td>
                <td class="caption">${esc(dt(c.created_at))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : emptyState(I.card, 'لا بطاقات بعد', 'ستظهر هنا بعد أول تنفيذ.')}
  </div>
  `;
}

/* ═══════════════════════════════════════════════════════════
   Shop Orders
   ═══════════════════════════════════════════════════════════ */

function vShopOrders() {
  const F = [['all', 'الكل'], ['pending', 'قيد التنفيذ'],
             ['completed', 'مكتملة'], ['rejected', 'ملغية']];
  let rows = S.orders;
  if (S.filter !== 'all') rows = rows.filter(o => o.status === S.filter);
  if (S.q) rows = rows.filter(o =>
    (o.id + ' ' + userName(o.uid)).toLowerCase().includes(S.q.toLowerCase()));

  return `
  <div class="page-enter">
    <div class="mb-3">
      <div style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.15em;color:var(--sand);text-transform:uppercase;margin-bottom:6px">
        STORE ORDERS
      </div>
      <h1 class="h2" style="margin-bottom:4px;font-family:var(--font-display)">طلبات المتجر</h1>
      <p class="body-sm text-2" style="font-size:11.5px">${pendOrd() ? pendOrd() + ' طلب ينتظر' : 'لا طلبات معلّقة'}</p>
    </div>

    <div class="input-wrap mb-3">
      <span class="input-icon">${svg(I.list)}</span>
      <input class="input" id="qBox" placeholder="ابحث برقم الطلب أو اسم العميل" value="${esc(S.q)}">
    </div>

    <div class="pills mb-3">
      ${F.map(([k, t]) => {
        const c = k === 'all' ? S.orders.length : S.orders.filter(o => o.status === k).length;
        return `<button class="pill ${S.filter === k ? 'active' : ''}" data-filter="${esc(k)}">${esc(t)} (${c})</button>`;
      }).join('')}
    </div>

    ${rows.length ? `
      <div style="display:flex;flex-direction:column;gap:8px">
        ${rows.map(o => {
          const items = o.items || [];
          return `
            <div class="card">
              <div class="flex-between mb-2">
                <div>
                  <div class="tabular h4" style="font-size:14px;color:var(--sand)">${esc(lyd(o.total_lyd))}</div>
                  <div class="mono caption" style="font-size:10px">${esc(o.id)}</div>
                </div>
                <span class="badge ${o.status === 'completed' ? 'badge-success' : o.status === 'pending' ? 'badge-warning' : 'badge-error'}">
                  ${o.status === 'completed' ? 'مكتمل' : o.status === 'pending' ? 'قيد التنفيذ' : 'ملغى'}
                </span>
              </div>
              <div class="caption mb-2" style="font-size:10.5px">${esc(userName(o.uid))} · ${esc(dt(o.created_at))}</div>
              <div style="padding-top:8px;border-top:1px solid var(--border);margin-bottom:8px">
                ${items.map(i => `<div class="body-sm" style="padding:2px 0;font-size:11.5px">${esc(i.name)} × ${i.qty}</div>`).join('')}
              </div>
              ${o.status === 'pending' ? `
                <div style="display:flex;gap:6px">
                  <button class="btn btn-primary btn-sm" data-ord-ok="${esc(o.id)}">تنفيذ</button>
                  <button class="btn btn-outline-danger btn-sm" data-ord-no="${esc(o.id)}">رفض</button>
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>
    ` : emptyState(I.bag, 'لا نتائج', 'جرّب تصفية أخرى.')}
  </div>
  `;
}

function openOrderAction(id, action) {
  const o = S.orders.find(x => x.id === id);
  if (!o) return;
  const rej = action === 'reject';

  modal(`
    <div class="modal-head">
      <div class="modal-title">${rej ? 'رفض الطلب' : 'تنفيذ الطلب'}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>

    ${rej
      ? `<div class="alert alert-warning mb-3" style="font-size:11.5px">${svg(I.warn)}<div>سيُعاد ${esc(usd(o.total_usd))} إلى محفظة العميل.</div></div>
        <div class="field mb-3">
          <label class="field-label">سبب الرفض</label>
          <input class="input" id="fReason" placeholder="نفد المخزون">
        </div>`
      : `<div class="field mb-3">
          <label class="field-label">ما تسلّمه للعميل</label>
          <textarea class="input" id="fText" rows="3" placeholder="الكود أو رسالة التأكيد"></textarea>
        </div>`}

    <button class="btn ${rej ? 'btn-danger' : 'btn-primary'} btn-block" id="fGo">
      ${rej ? 'تأكيد الرفض' : 'تأكيد التنفيذ'}
    </button>
  `);

  onTap('#fGo', async () => {
    $('#fGo').disabled = true;
    $('#fGo').classList.add('loading');
    try {
      await api('/api/admin/order', {
        order_id: id,
        action: rej ? 'reject' : 'complete',
        reason: rej ? ($('#fReason').value || '') : '',
        delivery: rej ? '' : ($('#fText').value || ''),
      });
      closeModal();
      toast(rej ? 'رُفض الطلب' : 'نُفّذ الطلب', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
      $('#fGo').disabled = false;
      $('#fGo').classList.remove('loading');
    }
  });
}
window.openOrderAction = openOrderAction;

/* ═══════════════════════════════════════════════════════════
   Digital Services
   ═══════════════════════════════════════════════════════════ */

function vServices() {
  const TABS = [
    ['list', '📋 الخدمات'],
    ['stock', '📦 المخزون'],
    ['orders', '📝 الطلبات'],
  ];

  return `
  <div class="page-enter">
    <div class="flex-between mb-3">
      <div>
        <div style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.15em;color:var(--sand);text-transform:uppercase;margin-bottom:6px">
          DIGITAL SERVICES
        </div>
        <h1 class="h2" style="margin-bottom:4px;font-family:var(--font-display)">الخدمات الرقمية</h1>
        <p class="body-sm text-2" style="font-size:11.5px">إدارة الخدمات والأكواد والطلبات</p>
      </div>
      ${S.svcTab === 'list' ? `<button class="btn btn-primary btn-sm" id="addSvc">${svg(I.plus, 2)} خدمة</button>` : ''}
    </div>

    <div class="svc-tabs">
      ${TABS.map(([k, t]) => `
        <button class="svc-tab ${S.svcTab === k ? 'active' : ''}" data-svc-tab="${esc(k)}">${esc(t)}</button>
      `).join('')}
    </div>

    ${S.svcTab === 'list' ? vSvcList() : ''}
    ${S.svcTab === 'stock' ? vSvcStock() : ''}
    ${S.svcTab === 'orders' ? vSvcOrders() : ''}
  </div>
  `;
}

function vSvcList() {
  const services = S.services || [];

  if (!services.length) {
    return emptyState(I.grid, 'لا خدمات بعد',
      'أضف أول خدمة رقمية لعرضها للعملاء',
      `<button class="btn btn-primary" id="addSvc2">${svg(I.plus, 2)} إضافة خدمة</button>`);
  }

  return `
    <div class="grid-2">
      ${services.map(s => {
        const isAuto = s.delivery_type === 'auto';
        const stock = n(s.stock_count, 0);
        return `
          <div class="card">
            <div class="flex-between mb-2">
              <div style="width:36px;height:36px;border-radius:9px;background:linear-gradient(135deg, rgba(212,165,116,0.1) 0%, rgba(10,92,63,0.1) 100%);border:1px solid rgba(212,165,116,0.2);display:grid;place-items:center;font-size:18px;overflow:hidden">
                ${s.icon_url
                  ? `<img src="${esc(s.icon_url)}" alt="" style="width:100%;height:100%;object-fit:cover">`
                  : esc(s.icon_emoji || '📦')}
              </div>
              <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
                <span class="badge ${s.is_active ? 'badge-success' : 'badge-neutral'}">${s.is_active ? 'نشط' : 'معطّل'}</span>
                <span class="badge ${isAuto ? 'badge-info' : 'badge-warning'}">${isAuto ? 'فوري' : 'يدوي'}</span>
              </div>
            </div>
            <div class="h4" style="margin-bottom:3px;font-size:13px">${esc(s.name || '')}</div>
            <div class="body-sm text-2 mb-2" style="min-height:26px;font-size:11px">${esc((s.desc || '').slice(0, 80))}</div>
            <div class="flex-between mb-2">
              <div class="tabular h4" style="font-size:15px;color:var(--sand)">${esc(usd(s.price_usd))}</div>
              <div class="caption" style="font-family:var(--font-mono);font-size:9.5px">${n(s.sold_count)} SOLD · ${isAuto ? stock + ' STOCK' : 'MANUAL'}</div>
            </div>
            <div style="display:flex;gap:4px">
              <button class="btn btn-secondary btn-sm" style="flex:1" data-edit-svc="${esc(s.id)}">${svg(I.edit, 2)} تعديل</button>
              <button class="btn btn-outline-danger btn-sm" data-del-svc="${esc(s.id)}">${svg(I.trash, 2)}</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function vSvcStock() {
  const services = (S.services || []).filter(s => s.delivery_type === 'auto');

  if (!services.length) {
    return emptyState(I.box, 'لا خدمات تلقائية',
      'أضف خدمة بنوع تسليم "تلقائي" أولاً لإدارة مخزونها.');
  }

  const sel = S.svcSelected;
  const svc = services.find(s => s.id === sel);

  return `
    <div class="card mb-4">
      <div class="h4" style="margin-bottom:10px;font-size:13px">اختر الخدمة</div>
      <select class="input" id="svcSelect">
        <option value="">— اختر خدمة —</option>
        ${services.map(s => `
          <option value="${esc(s.id)}" ${s.id === sel ? 'selected' : ''}>
            ${esc(s.name)} — ${usd(s.price_usd)} (${n(s.stock_count)} متوفر)
          </option>
        `).join('')}
      </select>
    </div>

    ${!sel ? `<div class="card" style="text-align:center;padding:32px 20px">
      <div class="empty-icon" style="margin:0 auto 12px">${svg(I.box, 2)}</div>
      <p class="body-sm text-2" style="font-size:11.5px">اختر خدمة لعرض مخزونها</p>
    </div>` : `

    <div class="card mb-4">
      <div class="h4" style="margin-bottom:10px;font-size:13px">إضافة أكواد جديدة</div>

      <div class="field mb-3">
        <textarea class="input" id="bulkCodes" rows="5" placeholder="CODE1&#10;CODE2&#10;CODE3&#10;..." style="font-family:var(--font-mono);font-size:11.5px;color:var(--sand);min-height:88px"></textarea>
        <span class="field-hint">حتى 500 كود في المرة — سطر واحد لكل كود</span>
      </div>

      <button class="btn btn-primary btn-block" id="addStockBtn">
        ${svg(I.plus, 2)} إضافة الأكواد
      </button>
    </div>

    <div class="card">
      <div class="flex-between mb-3">
        <div class="h4" style="font-size:13px">المخزون الحالي</div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="badge badge-success">${S.svcStock.stats.unused} متاح</span>
          <span class="badge badge-neutral">${S.svcStock.stats.used} مستخدم</span>
          <button class="btn btn-secondary btn-sm" id="toggleReveal" title="${S.revealMode ? 'إخفاء' : 'إظهار'} الأكواد" style="padding:0 6px;height:26px">
            ${svg(S.revealMode ? I.eyeOff : I.eye, 2)}
          </button>
        </div>
      </div>

      ${S.revealMode ? `
        <div class="alert alert-warning mb-2" style="font-size:10.5px">
          ${svg(I.warn, 2)}
          <div>⚠️ وضع الكشف مُفعّل — تُسجَّل عمليات المشاهدة</div>
        </div>
      ` : ''}

      ${!S.svcStock.items.length ? `<div style="text-align:center;padding:24px 12px">
        <p class="body-sm text-3" style="font-size:11.5px">لا أكواد بعد — أضف بعضها في الأعلى</p>
      </div>` : `
      <div style="max-height:420px;overflow-y:auto;border:1px solid var(--border);border-radius:6px">
        ${S.svcStock.items.map(it => `
          <div class="stock-row">
            <div class="stock-code" title="${S.revealMode ? esc(it.code) : 'اضغط كشف لعرض الكود'}">${esc(it.code)}</div>
            <span class="badge ${it.is_used ? 'badge-neutral' : 'badge-success'}" style="font-size:9px;padding:1px 5px">
              ${it.is_used ? 'مستخدم' : 'متاح'}
            </span>
            ${!it.is_used
              ? `<button class="btn btn-sm" style="background:none;padding:2px 4px;color:var(--error);height:auto" data-del-stock="${esc(it.id)}" title="حذف">${svg(I.trash, 2)}</button>`
              : `<span class="caption" style="font-size:9px">${esc(it.used_at ? dt(it.used_at) : '')}</span>`}
          </div>
        `).join('')}
      </div>
      `}
    </div>
    `}
  `;
}

function vSvcOrders() {
  const F = [['pending', 'قيد التنفيذ'], ['delivered', 'تم التسليم'], ['rejected', 'مرفوضة'], ['all', 'الكل']];
  let rows = S.serviceOrders;
  if (S.filter !== 'all' && S.filter !== 'pending') rows = rows.filter(o => o.status === S.filter);
  else if (S.filter === 'pending' || !S.filter) rows = rows.filter(o => o.status === 'pending');

  return `
    <div class="pills mb-3">
      ${F.map(([k, t]) => {
        const c = k === 'all' ? S.serviceOrders.length : S.serviceOrders.filter(o => o.status === k).length;
        return `<button class="pill ${(S.filter === k || (k === 'pending' && (!S.filter || S.filter === 'all'))) ? 'active' : ''}" data-filter="${esc(k)}">${esc(t)} (${c})</button>`;
      }).join('')}
    </div>

    ${rows.length ? `
      <div style="display:flex;flex-direction:column;gap:8px">
        ${rows.map(o => {
          const st = o.status;
          const stCls = { pending: 'badge-warning', delivered: 'badge-success', rejected: 'badge-error' }[st];
          const stLbl = { pending: 'قيد التنفيذ', delivered: 'تم التسليم', rejected: 'مرفوضة' }[st];
          const expired = o.delivered_expires_at && new Date(o.delivered_expires_at) < new Date();
          return `
            <div class="card">
              <div class="flex-between mb-2">
                <div style="display:flex;gap:8px;align-items:center">
                  <div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg, rgba(212,165,116,0.1) 0%, rgba(10,92,63,0.1) 100%);border:1px solid rgba(212,165,116,0.2);display:grid;place-items:center;font-size:16px;overflow:hidden">
                    ${o.service_icon_url
                      ? `<img src="${esc(o.service_icon_url)}" alt="" style="width:100%;height:100%;object-fit:cover">`
                      : esc(o.service_icon || '📦')}
                  </div>
                  <div>
                    <div class="h4" style="margin-bottom:1px;font-size:12.5px">${esc(o.service_name || '')}</div>
                    <div class="mono caption" style="font-size:10px">${esc(o.id)}</div>
                  </div>
                </div>
                <div style="text-align:left">
                  <div class="tabular" style="font-weight:700;font-size:14px;color:var(--sand)">${esc(usd(o.price_usd))}</div>
                  <span class="badge ${stCls}" style="margin-top:3px">${esc(stLbl)}</span>
                </div>
              </div>

              <div class="caption mb-2" style="font-size:10.5px">
                ${esc(userName(o.uid))} · ${esc(dt(o.created_at))}
              </div>

              ${o.inputs && Object.keys(o.inputs).length ? `
                <div style="background:var(--ink-2);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:11px">
                  ${Object.entries(o.inputs).map(([k, v]) =>
                    `<div style="padding:1px 0"><span class="caption">${esc(k)}:</span> <span class="mono" dir="ltr" style="color:var(--sand);font-size:11px">${esc(v)}</span></div>`
                  ).join('')}
                </div>
              ` : ''}

              ${st === 'pending' ? `
                <div style="display:flex;gap:6px">
                  <button class="btn btn-primary btn-sm" style="flex:1" data-svc-deliver="${esc(o.id)}">
                    ${svg(I.check, 2)} تسليم
                  </button>
                  <button class="btn btn-outline-danger btn-sm" data-svc-reject="${esc(o.id)}">رفض</button>
                </div>
              ` : st === 'delivered' ? `
                <div style="background:rgba(95,184,138,0.08);border:1px solid rgba(95,184,138,0.2);color:#7DD6A5;padding:8px 10px;border-radius:6px;font-size:11px;direction:ltr;text-align:center;word-break:break-all;font-family:var(--font-mono)">
                  ${expired ? '🔒 انتهت صلاحية العرض — تواصل مع العميل' : esc(o.delivered_data || '')}
                </div>
              ` : `
                <div class="caption" style="color:var(--error);font-size:11px">السبب: ${esc(o.rejected_reason || '—')}</div>
              `}
            </div>
          `;
        }).join('')}
      </div>
    ` : emptyState(I.check, 'لا طلبات', 'لا توجد طلبات بهذه الحالة.')}
  `;
}

/* ── Image compressor ── */
function compressImage(file, maxDim = 256, maxBytes = 50000) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('لا يوجد ملف'));
    if (!/^image\//.test(file.type)) return reject(new Error('الملف ليس صورة'));

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        let quality = 0.9;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);

        let attempts = 0;
        while (dataUrl.length > maxBytes * 1.35 && attempts < 12) {
          quality -= 0.08;
          if (quality < 0.2) quality = 0.2;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
          attempts++;
        }

        let dimAttempts = 0;
        while (dataUrl.length > maxBytes * 1.35 && dimAttempts < 5) {
          width = Math.round(width * 0.8);
          height = Math.round(height * 0.8);
          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);
          dataUrl = canvas.toDataURL('image/jpeg', quality);
          dimAttempts++;
        }

        if (dataUrl.length > 58000) {
          return reject(new Error('الصورة كبيرة جداً — جرّب صورة أبسط'));
        }

        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('تعذّر قراءة الصورة'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('تعذّر قراءة الملف'));
    reader.readAsDataURL(file);
  });
}

/* ── Service Edit Modal ── */
function openServiceEdit(id) {
  const s = id ? (S.services || []).find(x => x.id === id) : {
    id: '', name: '', desc: '', icon_emoji: '📦', icon_url: '',
    price_usd: 1, delivery_type: 'auto', fields: [],
    is_active: true, sort: 100,
  };
  if (!s) return;

  const existingFields = Array.isArray(s.fields) ? s.fields : [];

  modal(`
    <div class="modal-head">
      <div class="modal-title">${id ? 'تعديل الخدمة' : 'خدمة جديدة'}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>

    <div class="field mb-2">
      <label class="field-label">اسم الخدمة *</label>
      <input class="input" id="sName" value="${esc(s.name || '')}" placeholder="Netflix Premium" maxlength="80">
    </div>

    <div class="field mb-2">
      <label class="field-label">الوصف</label>
      <textarea class="input" id="sDesc" rows="2" placeholder="مشاهدة بلا حدود" maxlength="200" style="min-height:52px">${esc(s.desc || '')}</textarea>
    </div>

    <div class="field mb-2">
      <label class="field-label">الأيقونة</label>
      <div class="icon-picker">
        <div class="icon-preview" id="iconPreview">
          ${s.icon_url ? `<img src="${esc(s.icon_url)}" alt="">` : esc(s.icon_emoji || '📦')}
        </div>
        <div style="flex:1;min-width:0">
          <input class="input mb-1" id="sEmoji" value="${esc(s.icon_emoji || '')}" maxlength="4" placeholder="📦 (إيموجي)" style="height:34px;font-size:13px">
          <input type="file" id="sImageFile" accept="image/jpeg,image/png,image/webp" style="display:none">
          <button class="btn btn-secondary btn-sm btn-block" id="uploadImgBtn" type="button" style="height:30px;font-size:11px">
            ${svg(I.upload, 2)} رفع صورة (تُضغط إلى ~50KB)
          </button>
          <input type="hidden" id="sIconUrl" value="${esc(s.icon_url || '')}">
          <div class="upload-progress" id="uploadProgress">
            <div class="upload-progress-bar" id="uploadProgressBar"></div>
          </div>
          <div id="imgStatus" class="caption" style="margin-top:4px;display:none;font-size:10px"></div>
        </div>
      </div>
    </div>

    <div class="grid-2 mb-2">
      <div>
        <label class="field-label">السعر (USD) *</label>
        <input class="input" id="sPrice" type="number" step="0.01" min="0.01" value="${n(s.price_usd)}">
      </div>
      <div>
        <label class="field-label">ترتيب العرض</label>
        <input class="input" id="sSort" type="number" value="${n(s.sort, 100)}">
      </div>
    </div>

    <div class="field mb-2">
      <label class="field-label">نوع التسليم</label>
      <select class="input" id="sDeliv">
        <option value="auto" ${s.delivery_type === 'auto' ? 'selected' : ''}>🤖 تلقائي — من المخزون</option>
        <option value="manual" ${s.delivery_type === 'manual' ? 'selected' : ''}>👤 يدوي — من الأدمن</option>
      </select>
    </div>

    <div class="field mb-2">
      <label class="field-label" style="display:flex;align-items:center;gap:6px;cursor:pointer">
        <input type="checkbox" id="sActive" ${s.is_active ? 'checked' : ''}>
        <span>الخدمة نشطة ومتاحة للعملاء</span>
      </label>
    </div>

    <div class="divider" style="margin:14px 0"></div>

    <div class="flex-between mb-2">
      <div class="h4" style="font-size:12.5px">الحقول المطلوبة من العميل</div>
      <button type="button" class="btn btn-secondary btn-sm" id="addFieldBtn" style="height:26px;font-size:10.5px">${svg(I.plus, 2)} حقل</button>
    </div>

    <p class="caption mb-2" style="font-size:10px">حتى 5 حقول — تُطلب من العميل عند الشراء</p>

    <div id="fieldsList"></div>

    <button class="btn btn-primary btn-block" style="margin-top:14px" id="sSave">
      ${id ? 'حفظ التعديلات' : 'إنشاء الخدمة'}
    </button>
    ${id ? `<button class="btn btn-outline-danger btn-block" style="margin-top:6px" id="sDel">${svg(I.trash, 2)} حذف الخدمة</button>` : ''}
  `);

  let fields = existingFields.map(f => ({ ...f }));

  const renderFields = () => {
    const list = $('#fieldsList');
    if (!fields.length) {
      list.innerHTML = `<p class="caption" style="text-align:center;padding:12px;color:var(--text-3);font-size:10.5px">لا حقول — العميل يشتري مباشرة</p>`;
      return;
    }
    list.innerHTML = fields.map((f, i) => `
      <div class="field-row" data-fi="${i}">
        <div class="field-row-inputs">
          <input class="input" data-fk="label" data-fi="${i}" value="${esc(f.label || '')}" placeholder="التسمية (البريد)" style="height:32px;font-size:12px">
          <select class="input" data-fk="type" data-fi="${i}" style="height:32px;font-size:12px">
            ${['text', 'number', 'email', 'tel', 'password', 'select', 'textarea'].map(t =>
              `<option value="${t}" ${f.type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <button type="button" class="btn btn-sm" style="background:none;color:var(--error);padding:4px;height:auto" data-del-field="${i}" aria-label="حذف">
          ${svg(I.trash, 2)}
        </button>
      </div>
    `).join('');

    list.querySelectorAll('input[data-fk], select[data-fk]').forEach(el => {
      el.oninput = el.onchange = e => {
        const i = +e.target.dataset.fi;
        const k = e.target.dataset.fk;
        fields[i][k] = e.target.value;
      };
    });

    list.querySelectorAll('[data-del-field]').forEach(b => {
      b.onclick = () => {
        fields.splice(+b.dataset.delField, 1);
        renderFields();
      };
    });
  };

  renderFields();

  onTap('#addFieldBtn', () => {
    if (fields.length >= 5) return toast('الحد الأقصى 5 حقول', 'bad');
    fields.push({ key: 'f' + (fields.length + 1), label: '', type: 'text', placeholder: '', required: true });
    renderFields();
  });

  onTap('#uploadImgBtn', () => $('#sImageFile').click());

  $('#sImageFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const statusEl = $('#imgStatus');
    const progressEl = $('#uploadProgress');
    const barEl = $('#uploadProgressBar');

    progressEl.classList.add('active');
    barEl.style.width = '20%';
    statusEl.style.display = 'block';
    statusEl.textContent = '⏳ جاري ضغط الصورة...';
    statusEl.style.color = 'var(--sand)';

    try {
      barEl.style.width = '50%';
      const dataUrl = await compressImage(file, 256, 50000);
      barEl.style.width = '100%';

      $('#sIconUrl').value = dataUrl;
      $('#iconPreview').innerHTML = `<img src="${dataUrl}" alt="">`;
      $('#sEmoji').value = '';

      const kb = Math.round(dataUrl.length * 0.75 / 1024);
      statusEl.textContent = `✅ تم الضغط — ${kb}KB`;
      statusEl.style.color = '#7DD6A5';

      setTimeout(() => {
        progressEl.classList.remove('active');
        barEl.style.width = '0%';
      }, 1500);
    } catch (err) {
      barEl.style.width = '0%';
      progressEl.classList.remove('active');
      statusEl.textContent = '❌ ' + err.message;
      statusEl.style.color = '#F0947E';
      toast(err.message, 'bad');
    }
  };

  $('#sEmoji').oninput = (e) => {
    $('#sIconUrl').value = '';
    $('#iconPreview').innerHTML = e.target.value || '📦';
    $('#imgStatus').style.display = 'none';
  };

  onTap('#sSave', async () => {
    const name = $('#sName').value.trim();
    if (name.length < 2) return toast('اسم الخدمة مطلوب', 'bad');
    const price = n($('#sPrice').value, 0);
    if (price <= 0) return toast('السعر يجب أن يكون > 0', 'bad');

    const cleanFields = fields
      .filter(f => f.label && f.label.trim())
      .map((f, i) => ({
        key: (f.key || 'f' + (i + 1)).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24) || 'f' + (i + 1),
        label: f.label.trim().slice(0, 60),
        type: f.type || 'text',
        placeholder: (f.placeholder || '').slice(0, 80),
        required: f.required !== false,
      }));

    const iconUrl = $('#sIconUrl').value.trim();
    const emoji = $('#sEmoji').value.trim() || '📦';

    const payload = {
      id: id || undefined,
      name,
      desc: $('#sDesc').value.trim(),
      icon_emoji: iconUrl ? '' : emoji,
      icon_url: iconUrl,
      price_usd: price,
      delivery_type: $('#sDeliv').value,
      fields: cleanFields,
      is_active: $('#sActive').checked,
      sort: n($('#sSort').value, 100),
    };

    const btn = $('#sSave');
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      await api('/api/admin/service/save', payload);
      closeModal();
      toast(id ? 'تم تحديث الخدمة' : 'تم إنشاء الخدمة', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });

  if (id) {
    onTap('#sDel', () => {
      modal(`
        <div class="modal-head">
          <div class="modal-title">حذف الخدمة</div>
          <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
        </div>
        <div class="alert alert-warning mb-3" style="font-size:11.5px">${svg(I.warn)}<div>سيتم حذف "<strong>${esc(s.name)}</strong>" نهائياً.</div></div>
        <button class="btn btn-danger btn-block" id="delConfirm">تأكيد الحذف</button>
        <button class="btn btn-secondary btn-block" style="margin-top:6px" data-act="close-modal">إلغاء</button>
      `);
      onTap('#delConfirm', async () => {
        try {
          await api('/api/admin/service/delete', { id });
          closeModal();
          toast('تم حذف الخدمة', 'ok');
        } catch (e) { toast(e.message, 'bad'); }
      });
    });
  }
}
window.openServiceEdit = openServiceEdit;

function openSvcDeliver(orderId) {
  const o = S.serviceOrders.find(x => x.id === orderId);
  if (!o) return;

  modal(`
    <div class="modal-head">
      <div class="modal-title">تسليم الطلب</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>

    <div class="card card-sm mb-3" style="background:var(--surface-2);border:none">
      <div class="flex-between" style="padding:3px 0"><span class="caption">الخدمة</span><span class="body-sm">${esc(o.service_name)}</span></div>
      <div class="flex-between" style="padding:3px 0"><span class="caption">العميل</span><span class="body-sm">${esc(userName(o.uid))}</span></div>
      <div class="flex-between" style="padding:3px 0"><span class="caption">المبلغ</span><span class="tabular" style="font-weight:700;color:var(--sand)">${esc(usd(o.price_usd))}</span></div>
    </div>

    <div class="field mb-3">
      <label class="field-label">البيانات/الكود المُسلَّم *</label>
      <textarea class="input" id="svcDeliverData" rows="5" placeholder="USER: xxx&#10;PASS: yyy&#10;أو أي بيانات يراها العميل" style="font-family:var(--font-mono);font-size:12px;color:var(--sand)"></textarea>
      <span class="field-hint">ستظهر للعميل في "طلباتي" لمدة 7 أيام</span>
    </div>

    <button class="btn btn-primary btn-block" id="svcDeliverGo">
      ${svg(I.check, 2)} تسليم للعميل
    </button>
  `);

  onTap('#svcDeliverGo', async () => {
    const data = $('#svcDeliverData').value.trim();
    if (!data) return toast('أدخل البيانات', 'bad');
    const btn = $('#svcDeliverGo');
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      await api('/api/admin/service-order', {
        id: orderId,
        action: 'deliver',
        delivered_data: data,
      });
      closeModal();
      toast('تم التسليم', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });
}
window.openSvcDeliver = openSvcDeliver;

function openSvcReject(orderId) {
  const o = S.serviceOrders.find(x => x.id === orderId);
  if (!o) return;

  modal(`
    <div class="modal-head">
      <div class="modal-title">رفض الطلب</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>

    <div class="alert alert-warning mb-3" style="font-size:11.5px">${svg(I.warn)}<div>سيُعاد ${esc(usd(o.price_usd))} إلى محفظة العميل تلقائياً.</div></div>

    <div class="field mb-3">
      <label class="field-label">سبب الرفض</label>
      <input class="input" id="svcRejectReason" placeholder="نفد المخزون / بيانات غير صحيحة" maxlength="200">
    </div>

    <button class="btn btn-danger btn-block" id="svcRejectGo">
      تأكيد الرفض وإرجاع المبلغ
    </button>
  `);

  onTap('#svcRejectGo', async () => {
    const reason = $('#svcRejectReason').value.trim() || 'بدون سبب';
    const btn = $('#svcRejectGo');
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      await api('/api/admin/service-order', {
        id: orderId,
        action: 'reject',
        reason,
      });
      closeModal();
      toast('تم الرفض', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });
}
window.openSvcReject = openSvcReject;
  
/* ═══════════════════════════════════════════════════════════
   Deposits
   ═══════════════════════════════════════════════════════════ */

function vDeposits() {
  const F = [['pending', 'معلّقة'], ['approved', 'مقبولة'],
             ['rejected', 'مرفوضة'], ['all', 'الكل']];
  let rows = S.deposits;
  if (S.filter !== 'all') rows = rows.filter(d => d.status === S.filter);

  return `
  <div class="page-enter">
    <div class="mb-3">
      <div style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.15em;color:var(--sand);text-transform:uppercase;margin-bottom:6px">
        DEPOSITS
      </div>
      <h1 class="h2" style="margin-bottom:4px;font-family:var(--font-display)">الإيداعات</h1>
      <p class="body-sm text-2" style="font-size:11.5px">${pendDep() ? pendDep() + ' طلب ينتظر' : 'لا طلبات معلّقة'}</p>
    </div>

    <div class="pills mb-3">
      ${F.map(([k, t]) => {
        const c = k === 'all' ? S.deposits.length : S.deposits.filter(d => d.status === k).length;
        return `<button class="pill ${S.filter === k ? 'active' : ''}" data-filter="${esc(k)}">${esc(t)} (${c})</button>`;
      }).join('')}
    </div>

    ${rows.length ? `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>العميل</th>
              <th>المبلغ</th>
              <th>بالدينار</th>
              <th>الطريقة</th>
              <th>الحالة</th>
              <th>التاريخ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(d => `
              <tr>
                <td>${esc(userName(d.uid))}</td>
                <td class="tabular" style="font-weight:700;color:var(--sand)">${esc(usd(d.amount_usd))}</td>
                <td class="tabular">${esc(lyd(d.amount_lyd))}</td>
                <td>${esc(d.method || '—')}</td>
                <td><span class="badge ${d.status === 'approved' ? 'badge-success' : d.status === 'pending' ? 'badge-warning' : 'badge-error'}">
                  ${d.status === 'approved' ? 'مقبول' : d.status === 'pending' ? 'معلّق' : 'مرفوض'}
                </span></td>
                <td class="caption">${esc(dt(d.created_at))}</td>
                <td>${d.status === 'pending' ? `<button class="btn btn-primary btn-sm" data-dep="${esc(d.id)}">مراجعة</button>` : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : emptyState(I.cash, 'لا إيداعات')}
  </div>
  `;
}

function openDepositReview(id) {
  const d = S.deposits.find(x => x.id === id);
  if (!d) return;

  modal(`
    <div class="modal-head">
      <div class="modal-title">مراجعة إيداع</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>

    <div class="card card-sm mb-3" style="background:var(--surface-2);border:none">
      <div class="flex-between" style="padding:3px 0"><span class="caption">العميل</span><span class="body-sm">${esc(userName(d.uid))}</span></div>
      <div class="flex-between" style="padding:3px 0"><span class="caption">المبلغ</span><span class="tabular" style="font-weight:700;color:var(--sand)">${esc(usd(d.amount_usd))}</span></div>
      <div class="flex-between" style="padding:3px 0"><span class="caption">بالدينار</span><span class="tabular">${esc(lyd(d.amount_lyd))}</span></div>
      <div class="flex-between" style="padding:3px 0"><span class="caption">الطريقة</span><span class="body-sm">${esc(d.method || '—')}</span></div>
      <div class="flex-between" style="padding:3px 0"><span class="caption">الهاتف</span><span class="mono body-sm" dir="ltr" style="font-size:11px">${esc(d.claim_phone || '—')}</span></div>
    </div>

    ${d.proof_url ? `
      <div class="mb-3">
        <div class="field-label">إثبات التحويل</div>
        <a href="${esc(d.proof_url)}" target="_blank" rel="noopener noreferrer">
          <img src="${esc(d.proof_url)}" alt="" style="width:100%;border-radius:6px;border:1px solid var(--border)">
        </a>
      </div>
    ` : ''}

    <div class="alert alert-warning mb-3" style="font-size:11.5px">${svg(I.warn)}<div>تأكد من وصول التحويل قبل الموافقة.</div></div>

    <button class="btn btn-primary btn-block" id="dOk">قبول وإضافة الرصيد</button>
    <button class="btn btn-outline-danger btn-block" style="margin-top:6px" id="dNo">رفض</button>
  `);

  onTap('#dOk', async () => {
    const btn = $('#dOk');
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      await api('/api/admin/deposit', { deposit_id: id, action: 'approve' });
      closeModal();
      toast('تم القبول', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });

  onTap('#dNo', async () => {
    const btn = $('#dNo');
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      await api('/api/admin/deposit', { deposit_id: id, action: 'reject', reason: 'لم يُستلم التحويل' });
      closeModal();
      toast('تم الرفض', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  });
}
window.openDepositReview = openDepositReview;

/* ═══════════════════════════════════════════════════════════
   Withdrawals
   ═══════════════════════════════════════════════════════════ */

function vWithdraw() {
  const F = [['all', 'الكل'], ['pending', 'قيد التنفيذ'], ['completed', 'نُفّذت'], ['rejected', 'مرفوضة']];
  let rows = S.withdrawals;
  if (S.filter !== 'all') rows = rows.filter(w => w.status === S.filter);

  return `
  <div class="page-enter">
    <div class="mb-3">
      <div style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.15em;color:var(--sand);text-transform:uppercase;margin-bottom:6px">
        WITHDRAWALS
      </div>
      <h1 class="h2" style="margin-bottom:4px;font-family:var(--font-display)">السحوبات</h1>
      <p class="body-sm text-2" style="font-size:11.5px">${pendWd() ? pendWd() + ' طلب ينتظر' : 'لا طلبات معلّقة'}</p>
    </div>

    <div class="pills mb-3">
      ${F.map(([k, t]) => {
        const c = k === 'all' ? S.withdrawals.length : S.withdrawals.filter(w => w.status === k).length;
        return `<button class="pill ${S.filter === k ? 'active' : ''}" data-filter="${esc(k)}">${esc(t)} (${c})</button>`;
      }).join('')}
    </div>

    ${rows.length ? `
      <div style="display:flex;flex-direction:column;gap:8px">
        ${rows.map(w => `
          <div class="card">
            <div class="flex-between mb-2">
              <div>
                <div class="tabular h4" style="font-size:14px;color:var(--sand)">${esc(usd(w.amount_usd))}</div>
                <div class="mono caption" style="font-size:10px">${esc(w.id)}</div>
              </div>
              <span class="badge ${w.status === 'completed' ? 'badge-success' : w.status === 'pending' ? 'badge-warning' : 'badge-error'}">
                ${w.status === 'completed' ? 'نُفّذ' : w.status === 'pending' ? 'قيد التنفيذ' : 'مرفوض'}
              </span>
            </div>
            <div class="caption mb-2" style="font-size:10.5px">${esc(userName(w.uid))} · ${esc(dt(w.created_at))}</div>
            <div class="copy-box mb-2">
              <div class="copy-value" dir="ltr">${esc(w.destination || '—')}</div>
            </div>
            ${w.status === 'pending' ? `
              <div style="display:flex;gap:6px">
                <button class="btn btn-primary btn-sm" data-wd-ok="${esc(w.id)}">تنفيذ</button>
                <button class="btn btn-outline-danger btn-sm" data-wd-no="${esc(w.id)}">رفض</button>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    ` : emptyState(I.withdraw, 'لا سحوبات')}
  </div>
  `;
}

function openWithdrawAction(id, action) {
  const w = S.withdrawals.find(x => x.id === id);
  if (!w) return;
  const rej = action === 'reject';

  modal(`
    <div class="modal-head">
      <div class="modal-title">${rej ? 'رفض السحب' : 'تنفيذ السحب'}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>

    ${rej
      ? `<div class="alert alert-warning mb-3" style="font-size:11.5px">${svg(I.warn)}<div>سيُعاد ${esc(usd(w.amount_usd))} إلى محفظة العميل.</div></div>
        <div class="field mb-3">
          <label class="field-label">سبب الرفض</label>
          <input class="input" id="wReason" placeholder="بيانات غير صحيحة">
        </div>`
      : `<div class="alert alert-info mb-3" style="font-size:11.5px">${svg(I.help)}<div>حوّل ${esc(usd(w.net))} إلى الوجهة أدناه، ثم أكّد.</div></div>
        <div class="copy-box mb-3">
          <div class="copy-value" dir="ltr">${esc(w.destination)}</div>
        </div>
        <div class="field mb-3">
          <label class="field-label">ملاحظة (اختياري)</label>
          <input class="input" id="wNote" placeholder="رقم التحويل">
        </div>`}

    <button class="btn ${rej ? 'btn-danger' : 'btn-primary'} btn-block" id="wGo">
      ${rej ? 'تأكيد الرفض' : 'تأكيد التنفيذ'}
    </button>
  `);

  onTap('#wGo', async () => {
    $('#wGo').disabled = true;
    $('#wGo').classList.add('loading');
    try {
      await api('/api/admin/withdraw', {
        id, action: rej ? 'reject' : 'complete',
        reason: rej ? ($('#wReason').value || '') : '',
        note: rej ? '' : ($('#wNote').value || ''),
      });
      closeModal();
      toast(rej ? 'رُفض الطلب' : 'نُفّذ السحب', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
      $('#wGo').disabled = false;
      $('#wGo').classList.remove('loading');
    }
  });
}
window.openWithdrawAction = openWithdrawAction;

/* ═══════════════════════════════════════════════════════════
   Tickets
   ═══════════════════════════════════════════════════════════ */

function vTickets() {
  const F = [['open', 'مفتوحة'], ['answered', 'تم الرد'], ['closed', 'مغلقة'], ['all', 'الكل']];
  let rows = S.tickets;
  if (S.filter !== 'all') rows = rows.filter(t => t.status === S.filter);

  return `
  <div class="page-enter">
    <div class="mb-3">
      <div style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.15em;color:var(--sand);text-transform:uppercase;margin-bottom:6px">
        SUPPORT TICKETS
      </div>
      <h1 class="h2" style="margin-bottom:4px;font-family:var(--font-display)">التذاكر</h1>
      <p class="body-sm text-2" style="font-size:11.5px">${openTic() ? openTic() + ' تذكرة مفتوحة' : 'لا تذاكر مفتوحة'}</p>
    </div>

    <div class="pills mb-3">
      ${F.map(([k, t]) => {
        const c = k === 'all' ? S.tickets.length : S.tickets.filter(x => x.status === k).length;
        return `<button class="pill ${S.filter === k ? 'active' : ''}" data-filter="${esc(k)}">${esc(t)} (${c})</button>`;
      }).join('')}
    </div>

    ${rows.length ? `
      <div class="list">
        ${rows.map(t => `
          <div class="list-row" data-tic="${esc(t.id)}">
            <div class="list-icon">${svg(I.help, 2)}</div>
            <div class="list-content">
              <div class="list-title">${esc(t.subject)}</div>
              <div class="list-meta">${esc(userName(t.uid))} · ${esc(dt(t.updated_at))}</div>
            </div>
            <div class="list-end">
              <span class="badge ${t.status === 'open' ? 'badge-warning' : t.status === 'answered' ? 'badge-success' : 'badge-neutral'}">
                ${t.status === 'open' ? 'مفتوحة' : t.status === 'answered' ? 'تم الرد' : 'مغلقة'}
              </span>
            </div>
          </div>
        `).join('')}
      </div>
    ` : emptyState(I.ticket, 'لا تذاكر')}
  </div>
  `;
}

function openTicketDetail(id) {
  const t = S.tickets.find(x => x.id === id);
  if (!t) return;
  const msgs = t.messages || [];

  modal(`
    <div class="modal-head">
      <div class="modal-title">${esc(t.subject)}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>

    <p class="caption mb-3" style="font-size:10.5px">${esc(userName(t.uid))} · ${esc(dt(t.created_at))}</p>

    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;max-height:44vh;overflow-y:auto">
      ${msgs.map(m => `
        <div style="align-self:${m.by === 'admin' ? 'flex-end' : 'flex-start'};max-width:85%;padding:8px 12px;border-radius:10px;background:${m.by === 'admin' ? 'rgba(212,165,116,0.12)' : 'var(--surface-2)'};border:1px solid ${m.by === 'admin' ? 'rgba(212,165,116,0.2)' : 'var(--border)'}">
          <div class="caption" style="font-size:9.5px;margin-bottom:2px;font-family:var(--font-mono);letter-spacing:0.08em">${m.by === 'admin' ? 'ADMIN' : 'CLIENT'} · ${esc(dt(m.at))}</div>
          <div class="body-sm" style="line-height:1.6;white-space:pre-line;font-size:11.5px">${esc(m.text)}</div>
        </div>
      `).join('')}
    </div>

    ${t.status !== 'closed' ? `
      <div class="field mb-2">
        <textarea class="input" id="tRep" rows="3" placeholder="اكتب ردك..." style="min-height:70px;font-size:12px"></textarea>
      </div>
      <button class="btn btn-primary btn-block" id="tSend">إرسال الرد</button>
      <button class="btn btn-outline-danger btn-block" style="margin-top:6px" id="tClose">إغلاق التذكرة</button>
    ` : `<div class="alert alert-info" style="font-size:11.5px">${svg(I.help)}<div>هذه التذكرة مغلقة.</div></div>`}
  `);

  onTap('#tSend', async () => {
    const m = $('#tRep').value.trim();
    if (!m) return toast('اكتب ردك', 'bad');
    $('#tSend').disabled = true;
    $('#tSend').classList.add('loading');
    try {
      await api('/api/ticket/reply', { id, message: m });
      closeModal();
      toast('أُرسل الرد', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
      $('#tSend').disabled = false;
      $('#tSend').classList.remove('loading');
    }
  });

  onTap('#tClose', async () => {
    $('#tClose').disabled = true;
    $('#tClose').classList.add('loading');
    try {
      await api('/api/admin/ticket/close', { id });
      closeModal();
      toast('أُغلقت التذكرة', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
      $('#tClose').disabled = false;
      $('#tClose').classList.remove('loading');
    }
  });
}
window.openTicketDetail = openTicketDetail;

/* ═══════════════════════════════════════════════════════════
   Coupons
   ═══════════════════════════════════════════════════════════ */

function vCoupons() {
  return `
  <div class="page-enter">
    <div class="flex-between mb-3">
      <div>
        <div style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.15em;color:var(--sand);text-transform:uppercase;margin-bottom:6px">
          COUPONS
        </div>
        <h1 class="h2" style="margin-bottom:4px;font-family:var(--font-display)">الكوبونات</h1>
        <p class="body-sm text-2" style="font-size:11.5px">${S.coupons.length} كوبون</p>
      </div>
      <button class="btn btn-primary btn-sm" id="addCoup">${svg(I.plus, 2)} كوبون</button>
    </div>

    ${S.coupons.length ? `
      <div class="grid-2">
        ${S.coupons.map(c => `
          <div class="card">
            <div class="flex-between mb-2">
              <div class="mono" style="font-size:14px;font-weight:700;letter-spacing:.06em;color:var(--sand)">${esc(c.id)}</div>
              <span class="badge ${c.active !== false ? 'badge-success' : 'badge-neutral'}">${c.active !== false ? 'نشط' : 'معطّل'}</span>
            </div>
            <div class="body-sm text-2 mb-2" style="font-size:11.5px">
              ${n(c.percent) > 0 ? n(c.percent) + '٪ خصم' : lyd(c.amount_lyd)}
            </div>
            <div class="caption mb-2" style="font-size:10.5px">استُخدم ${n(c.used_count)}${n(c.max_uses) > 0 ? ' من ' + n(c.max_uses) : ''}</div>
            <button class="btn btn-secondary btn-sm btn-block" data-ecoup="${esc(c.id)}">تعديل</button>
          </div>
        `).join('')}
      </div>
    ` : emptyState(I.coupon, 'لا كوبونات')}
  </div>
  `;
}

function openCouponEdit(id) {
  const c = id ? S.coupons.find(x => x.id === id) : {
    id: '', percent: 0, amount_lyd: 0, max_off_lyd: 0,
    min_order_lyd: 0, max_uses: 0, used_count: 0,
    once_per_user: true, active: true, expires_at: ''
  };
  if (!c) return;

  modal(`
    <div class="modal-head">
      <div class="modal-title">${id ? 'تعديل الكوبون' : 'كوبون جديد'}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>

    <div class="field mb-2">
      <label class="field-label">الكود</label>
      <input class="input mono" id="cCode" value="${esc(c.id || '')}" ${id ? 'disabled' : ''} dir="ltr" placeholder="WELCOME10" style="text-transform:uppercase;letter-spacing:.06em;color:var(--sand)">
    </div>

    <div class="grid-2 mb-2">
      <div>
        <label class="field-label">النسبة ٪</label>
        <input class="input" id="cPct" type="number" min="0" max="100" value="${n(c.percent)}">
      </div>
      <div>
        <label class="field-label">أو مبلغ ثابت</label>
        <input class="input" id="cAmt" type="number" min="0" value="${n(c.amount_lyd)}">
      </div>
    </div>

    <div class="grid-2 mb-2">
      <div>
        <label class="field-label">حد أقصى للخصم</label>
        <input class="input" id="cCap" type="number" min="0" value="${n(c.max_off_lyd)}">
      </div>
      <div>
        <label class="field-label">أقل قيمة طلب</label>
        <input class="input" id="cMin" type="number" min="0" value="${n(c.min_order_lyd)}">
      </div>
    </div>

    <div class="field mb-2">
      <label class="field-label">عدد الاستخدامات (0 = بلا حد)</label>
      <input class="input" id="cMax" type="number" min="0" value="${n(c.max_uses)}">
    </div>

    <div class="field mb-3">
      <label class="field-label">ينتهي في</label>
      <input class="input" id="cExp" type="date" value="${esc(c.expires_at ? String(c.expires_at).slice(0, 10) : '')}">
    </div>

    <button class="btn btn-primary btn-block" id="cSave">حفظ</button>
    ${id ? `<button class="btn btn-outline-danger btn-block" style="margin-top:6px" id="cDel">حذف</button>` : ''}
  `);

  onTap('#cSave', async () => {
    const code = (id || $('#cCode').value).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (code.length < 3) return toast('الكود 3 أحرف على الأقل', 'bad');
    const pct = n($('#cPct').value), amt = n($('#cAmt').value);
    if (pct <= 0 && amt <= 0) return toast('حدّد نسبة أو مبلغًا', 'bad');

    const data = {
      percent: pct,
      amount_lyd: amt,
      max_off_lyd: n($('#cCap').value),
      min_order_lyd: n($('#cMin').value),
      max_uses: n($('#cMax').value),
      expires_at: $('#cExp').value ? new Date($('#cExp').value).toISOString() : '',
      once_per_user: true,
      active: true,
    };

    $('#cSave').disabled = true;
    $('#cSave').classList.add('loading');
    try {
      await api('/api/admin/coupon/save', { code, ...data });
      closeModal();
      toast('حُفظ الكوبون', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
      $('#cSave').disabled = false;
      $('#cSave').classList.remove('loading');
    }
  });

  onTap('#cDel', async () => {
    try {
      await api('/api/admin/coupon/delete', { code: id });
      closeModal();
      toast('حُذف الكوبون', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
    }
  });
}
window.openCouponEdit = openCouponEdit;

/* ═══════════════════════════════════════════════════════════
   Users
   ═══════════════════════════════════════════════════════════ */

function vUsers() {
  let rows = S.users;
  if (S.q) rows = rows.filter(u =>
    ((u.name || '') + ' ' + (u.email || '') + ' ' + (u.phone || '')).toLowerCase().includes(S.q.toLowerCase()));

  return `
  <div class="page-enter">
    <div class="mb-3">
      <div style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.15em;color:var(--sand);text-transform:uppercase;margin-bottom:6px">
        USERS
      </div>
      <h1 class="h2" style="margin-bottom:4px;font-family:var(--font-display)">المستخدمون</h1>
      <p class="body-sm text-2" style="font-size:11.5px">${rows.length} مستخدم</p>
    </div>

    <div class="input-wrap mb-3">
      <span class="input-icon">${svg(I.list)}</span>
      <input class="input" id="qBox" placeholder="ابحث بالاسم أو البريد أو الهاتف" value="${esc(S.q)}">
    </div>

    ${rows.length ? `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>البريد</th>
              <th>الرصيد</th>
              <th>الحالة</th>
              <th>التسجيل</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(u => `
              <tr>
                <td>${esc(u.name || '—')}</td>
                <td class="mono caption" dir="ltr" style="font-size:10px">${esc(u.email || '—')}</td>
                <td class="tabular" style="font-weight:600;color:var(--sand)">${esc(usd(u.wallet_balance))}</td>
                <td>${u.banned ? '<span class="badge badge-error">موقوف</span>' : '<span class="badge badge-success">نشط</span>'}</td>
                <td class="caption">${esc(dt(u.created_at))}</td>
                <td><button class="btn btn-secondary btn-sm" data-user="${esc(u.id)}">إدارة</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : emptyState(I.users, 'لا مستخدمين')}
  </div>
  `;
}

function openUserManage(uid) {
  const u = S.users.find(x => x.id === uid);
  if (!u) return;

  modal(`
    <div class="modal-head">
      <div class="modal-title">${esc(u.name || 'مستخدم')}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>

    <div class="card card-sm mb-3" style="background:var(--surface-2);border:none">
      <div class="flex-between" style="padding:3px 0"><span class="caption">الرصيد</span><span class="tabular" style="font-weight:700;color:var(--sand)">${esc(usd(u.wallet_balance))}</span></div>
      <div class="flex-between" style="padding:3px 0"><span class="caption">الإنفاق</span><span class="tabular">${esc(usd(u.total_spent))}</span></div>
      <div class="flex-between" style="padding:3px 0"><span class="caption">البريد</span><span class="caption mono" dir="ltr" style="font-size:10px">${esc(u.email || '—')}</span></div>
    </div>

    <div class="field mb-2">
      <label class="field-label">تعديل الرصيد (± دولار)</label>
      <input class="input" id="uAmt" type="number" step="0.5" placeholder="10">
    </div>
    <div class="field mb-3">
      <label class="field-label">السبب</label>
      <input class="input" id="uWhy" placeholder="تصحيح يدوي">
    </div>

    <button class="btn btn-primary btn-block" id="uAdj">تنفيذ التعديل</button>
    <div style="margin-top:12px">${userPlanBlock(u)}</div>
    <button class="btn ${u.banned ? 'btn-secondary' : 'btn-outline-danger'} btn-block" style="margin-top:6px" id="uBan">
      ${u.banned ? 'إلغاء الإيقاف' : 'إيقاف الحساب'}
    </button>
  `);

  bindUserPlan(uid);
  const adjIdemKey = newIdemKey();
  onTap('#uAdj', async () => {
    const amt = parseFloat($('#uAmt').value);
    const why = $('#uWhy').value.trim();
    if (!amt) return toast('أدخل مبلغ', 'bad');
    if (why.length < 5) return toast('اكتب سببًا واضحًا', 'bad');
    $('#uAdj').disabled = true;
    $('#uAdj').classList.add('loading');
    try {
      await api('/api/admin/wallet-adjust', { uid, delta: amt, reason: why, idempotency_key: adjIdemKey });
      closeModal();
      toast('تم التعديل', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
      $('#uAdj').disabled = false;
      $('#uAdj').classList.remove('loading');
    }
  });

  onTap('#uBan', async () => {
    $('#uBan').disabled = true;
    try {
      let reason = '';
      if (!u.banned) {
        reason = (prompt('سبب الإيقاف (إلزامي):') || '').trim();
        if (reason.length < 3) { $('#uBan').disabled = false; return toast('السبب مطلوب', 'bad'); }
      }
      await api('/api/admin/user/ban', { uid, banned: !u.banned, reason });
      closeModal();
      toast(u.banned ? 'أُلغي الإيقاف' : 'أُوقف الحساب', 'ok');
    } catch (e) {
      toast(e.message, 'bad');
      $('#uBan').disabled = false;
    }
  });
}
window.openUserManage = openUserManage;


/* ═══════════════════════════════════════════════════════════
   v6 — Store management, SMS linking, phone approvals, plans
   ═══════════════════════════════════════════════════════════ */

const PLAN_AR = { free: 'العادي', basic: 'الأساسي', vip: 'VIP' };

function compressImg(file, maxW = 600, q = 0.72, limit = 110000) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('اختر صورة'));
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let out = c.toDataURL('image/webp', q);
      if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/jpeg', q);
      if (out.length > limit) out = c.toDataURL('image/jpeg', 0.5);
      if (out.length > limit) return reject(new Error('الصورة كبيرة — اختر صورة أصغر'));
      resolve(out);
    };
    img.onerror = () => reject(new Error('تعذّر قراءة الصورة'));
    img.src = url;
  });
}

function catPath(id) {
  const out = []; let c = (S.categories || []).find(x => x.id === id), guard = 0;
  while (c && guard++ < 10) { out.unshift(c.name); c = (S.categories || []).find(x => x.id === c.parent); }
  return out.join(' › ');
}

function vStore() {
  const tab = S.storeTab || 'prods';
  const cats = S.categories || [], prods = S.products || [];
  const q = (S.q || '').toLowerCase();
  const tabs = [['prods', `المنتجات (${prods.length})`], ['cats', `الأقسام (${cats.length})`], ['stock', 'المخزون']];
  let body = '';
  if (tab === 'cats') {
    body = `
      <button class="btn btn-primary btn-sm mb-3" id="addCat">${svg(I.plus)} قسم جديد</button>
      ${cats.length ? `<div style="display:flex;flex-direction:column;gap:6px">
        ${[...cats].sort((a, b) => catPath(a.id).localeCompare(catPath(b.id))).map(c => `
          <div class="card flex-between">
            <div><div class="body" style="font-weight:600">${esc(c.icon || '')} ${esc(catPath(c.id))}</div>
              <div class="caption">${c.active === false ? 'مخفي' : 'ظاهر'}${c.soon ? ' · قريبًا' : ''} · ترتيب ${esc(String(c.sort ?? 99))}</div></div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-secondary btn-sm" data-ecat="${esc(c.id)}">تعديل</button>
              <button class="btn btn-ghost btn-sm" data-dcat="${esc(c.id)}" aria-label="حذف">${svg(I.trash)}</button>
            </div>
          </div>`).join('')}</div>` : emptyState(I.grid, 'لا أقسام', 'ابدأ بإنشاء قسم ثم أضف منتجاته')}`;
  } else if (tab === 'prods') {
    const list = prods.filter(p => !q || (p.name || '').toLowerCase().includes(q));
    body = `
      <div class="flex-between mb-3" style="gap:8px">
        <input class="input" id="qBox" placeholder="بحث..." value="${esc(S.q)}" style="max-width:260px">
        <button class="btn btn-primary btn-sm" id="addProd" ${cats.length ? '' : 'disabled'}>${svg(I.plus)} منتج جديد</button>
      </div>
      ${!cats.length ? '<p class="caption mb-3">أنشئ قسمًا أولًا.</p>' : ''}
      ${list.length ? `<div style="display:flex;flex-direction:column;gap:6px">
        ${list.map(p => `
          <div class="card flex-between">
            <div style="display:flex;gap:10px;align-items:center;min-width:0">
              ${p.image ? `<img src="${esc(p.image)}" alt="" style="width:40px;height:40px;border-radius:8px;object-fit:cover">` : ''}
              <div style="min-width:0"><div class="body" style="font-weight:600">${esc(p.name)}</div>
                <div class="caption">${esc(catPath(p.cat))} · ${esc(lyd(p.price))} · ${p.kind === 'stock' ? `أكواد: ${esc(String(p.stock_count || 0))}` : 'يدوي'}${p.active === false ? ' · مخفي' : ''}</div></div>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-secondary btn-sm" data-eprod="${esc(p.id)}">تعديل</button>
              <button class="btn btn-ghost btn-sm" data-dprod="${esc(p.id)}" aria-label="حذف">${svg(I.trash)}</button>
            </div>
          </div>`).join('')}</div>` : emptyState(I.box, 'لا منتجات')}`;
  } else {
    const sp = prods.filter(p => p.kind === 'stock');
    const sel = S.stockPid && sp.find(p => p.id === S.stockPid) ? S.stockPid : (sp[0] && sp[0].id);
    S.stockPid = sel;
    body = sp.length ? `
      <div class="field mb-3"><label class="field-label" for="stPid">المنتج</label>
        <select class="input" id="stPid">${sp.map(p => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)} (${esc(String(p.stock_count || 0))})</option>`).join('')}</select></div>
      <div class="field mb-3"><label class="field-label" for="stCodes">أكواد جديدة (كود في كل سطر)</label>
        <textarea class="input" id="stCodes" rows="5" dir="ltr" style="font-family:var(--font-mono)"></textarea></div>
      <div style="display:flex;gap:6px" class="mb-4">
        <button class="btn btn-primary btn-sm" id="stAdd">إضافة</button>
        <button class="btn btn-secondary btn-sm" id="stLoad">عرض الأكواد</button>
        ${S.admin.role === 'super_admin' ? '<button class="btn btn-ghost btn-sm" id="stReveal">كشف كامل</button>' : ''}
      </div>
      <div id="stList"></div>` : emptyState(I.box, 'لا منتجات بنوع «أكواد»', 'اجعل نوع المنتج «أكواد» لإضافة مخزون له');
  }
  return `
  <div class="page-enter">
    <div class="mb-3"><h1 class="h2" style="margin-bottom:4px;font-family:var(--font-display)">المتجر</h1>
      <p class="body-sm text-2" style="font-size:11.5px">الأقسام والمنتجات ومخزون الأكواد</p></div>
    <div class="pills mb-4">${tabs.map(([k, t]) => `<button class="pill ${tab === k ? 'active' : ''}" data-stab="${k}">${esc(t)}</button>`).join('')}</div>
    ${body}
  </div>`;
}

function openCatEdit(id) {
  const c = id ? (S.categories || []).find(x => x.id === id) || {} : {};
  let image = c.image || '';
  const opts = (S.categories || []).filter(x => x.id !== id);
  modal(`
    <div class="modal-head"><div class="modal-title">${id ? 'تعديل قسم' : 'قسم جديد'}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    <div class="field mb-3"><label class="field-label" for="cName">الاسم</label><input class="input" id="cName" value="${esc(c.name || '')}" maxlength="60"></div>
    <div class="field mb-3"><label class="field-label" for="cParent">القسم الأب</label>
      <select class="input" id="cParent"><option value="">— رئيسي —</option>
        ${opts.map(o => `<option value="${esc(o.id)}" ${o.id === c.parent ? 'selected' : ''}>${esc(catPath(o.id))}</option>`).join('')}</select></div>
    <div class="grid-2 mb-3">
      <div class="field"><label class="field-label" for="cIcon">أيقونة (إيموجي)</label><input class="input" id="cIcon" value="${esc(c.icon || '')}" maxlength="4"></div>
      <div class="field"><label class="field-label" for="cSort">الترتيب</label><input class="input" id="cSort" type="number" value="${esc(String(c.sort ?? 99))}"></div>
    </div>
    <div class="field mb-3"><label class="field-label" for="cImg">صورة (اختياري)</label><input class="input" id="cImg" type="file" accept="image/*"></div>
    <label class="mb-2" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="cAct" ${c.active === false ? '' : 'checked'}> ظاهر للعملاء</label>
    <label class="mb-4" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="cSoon" ${c.soon ? 'checked' : ''}> «قريبًا» (غير قابل للفتح)</label>
    <button class="btn btn-primary btn-block" id="cSave">حفظ</button>`);
  $('#cImg').onchange = async e => { try { image = await compressImg(e.target.files[0], 300, 0.75, 100000); toast('أُرفقت الصورة', 'ok'); } catch (err) { toast(err.message, 'bad'); } };
  onTap('#cSave', async () => {
    const b = $('#cSave'); b.disabled = true; b.classList.add('loading');
    try {
      await api('/api/admin/category/save', { id: id || '', name: $('#cName').value.trim(), parent: $('#cParent').value,
        icon: $('#cIcon').value.trim(), sort: n($('#cSort').value), image, active: $('#cAct').checked, soon: $('#cSoon').checked });
      closeModal(); toast('حُفظ القسم', 'ok'); loadStore();
    } catch (e) { toast(e.message, 'bad'); b.disabled = false; b.classList.remove('loading'); }
  });
}

function openProdEdit(id) {
  const p = id ? (S.products || []).find(x => x.id === id) || {} : {};
  let image = p.image || '';
  const f = Array.isArray(p.fields) ? p.fields : [];
  const fRow = (x, i) => `
    <div class="grid-3 mb-2" style="gap:6px">
      <input class="input" id="fl${i}" placeholder="اسم الحقل (مثل: ID اللاعب)" value="${esc(x.label || '')}">
      <select class="input" id="ft${i}">${['text', 'number', 'email', 'tel'].map(t => `<option ${x.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="fr${i}" ${x.required === false ? '' : 'checked'}> إلزامي</label>
    </div>`;
  modal(`
    <div class="modal-head"><div class="modal-title">${id ? 'تعديل منتج' : 'منتج جديد'}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    <div class="field mb-3"><label class="field-label" for="pName">الاسم</label><input class="input" id="pName" value="${esc(p.name || '')}" maxlength="100"></div>
    <div class="field mb-3"><label class="field-label" for="pCat">القسم</label>
      <select class="input" id="pCat">${(S.categories || []).map(c => `<option value="${esc(c.id)}" ${c.id === p.cat ? 'selected' : ''}>${esc(catPath(c.id))}</option>`).join('')}</select></div>
    <div class="grid-2 mb-3">
      <div class="field"><label class="field-label" for="pPrice">السعر (د.ل)</label><input class="input" id="pPrice" type="number" step="0.01" min="0.01" value="${esc(String(p.price ?? ''))}"></div>
      <div class="field"><label class="field-label" for="pOld">السعر قبل الخصم</label><input class="input" id="pOld" type="number" step="0.01" value="${esc(String(p.old_price || ''))}"></div>
    </div>
    <div class="grid-2 mb-3">
      <div class="field"><label class="field-label" for="pKind">نوع التسليم</label>
        <select class="input" id="pKind"><option value="stock" ${p.kind === 'stock' ? 'selected' : ''}>أكواد (فوري)</option><option value="manual" ${p.kind !== 'stock' ? 'selected' : ''}>يدوي</option></select></div>
      <div class="field"><label class="field-label" for="pSort">الترتيب</label><input class="input" id="pSort" type="number" value="${esc(String(p.sort ?? 99))}"></div>
    </div>
    <div class="field mb-3"><label class="field-label" for="pDesc">الوصف</label><textarea class="input" id="pDesc" rows="3" maxlength="600">${esc(p.desc || '')}</textarea></div>
    <div class="field mb-3"><label class="field-label" for="pNote">تنبيه للعميل (اختياري)</label><input class="input" id="pNote" value="${esc(p.note || '')}" maxlength="300"></div>
    <div class="field mb-3"><label class="field-label" for="pImg">الصورة</label><input class="input" id="pImg" type="file" accept="image/*"></div>
    <div class="field-label mb-2">حقول يملؤها العميل (للمنتجات اليدوية)</div>
    ${[0, 1, 2, 3].map(i => fRow(f[i] || {}, i)).join('')}
    <label class="mb-2" style="display:flex;gap:8px;align-items:center;margin-top:8px"><input type="checkbox" id="pFeat" ${p.featured ? 'checked' : ''}> مميّز في واجهة المتجر</label>
    <label class="mb-4" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="pAct" ${p.active === false ? '' : 'checked'}> ظاهر للعملاء</label>
    <button class="btn btn-primary btn-block" id="pSave">حفظ</button>`);
  $('#pImg').onchange = async e => { try { image = await compressImg(e.target.files[0], 600, 0.72, 140000); toast('أُرفقت الصورة', 'ok'); } catch (err) { toast(err.message, 'bad'); } };
  onTap('#pSave', async () => {
    const fields = [0, 1, 2, 3].map(i => ({ key: 'f' + (i + 1), label: $('#fl' + i).value.trim(), type: $('#ft' + i).value, required: $('#fr' + i).checked })).filter(x => x.label);
    const b = $('#pSave'); b.disabled = true; b.classList.add('loading');
    try {
      await api('/api/admin/product/save', { id: id || '', name: $('#pName').value.trim(), cat: $('#pCat').value,
        price: n($('#pPrice').value), old_price: n($('#pOld').value) || 0, kind: $('#pKind').value, sort: n($('#pSort').value),
        desc: $('#pDesc').value, note: $('#pNote').value, image, fields, featured: $('#pFeat').checked, active: $('#pAct').checked });
      closeModal(); toast('حُفظ المنتج', 'ok'); loadStore();
    } catch (e) { toast(e.message, 'bad'); b.disabled = false; b.classList.remove('loading'); }
  });
}

async function loadStore() {
  try {
    const [c, p] = await Promise.all([
      getDocs(query(collection(db, 'categories'), limit(300))),
      getDocs(query(collection(db, 'products'), limit(500))),
    ]);
    S.categories = c.docs.map(d => ({ id: d.id, ...d.data() }));
    S.products = p.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.sort ?? 99) - (b.sort ?? 99));
    render(true);
  } catch (e) { toast('تعذّر تحميل المتجر: ' + (e.code || e.message), 'bad'); }
}

async function loadStockList(reveal = false) {
  const box = $('#stList'); if (!box) return;
  box.innerHTML = '<p class="caption">جاري التحميل…</p>';
  try {
    const r = await api('/api/admin/store-stock/list', { pid: S.stockPid, reveal });
    box.innerHTML = `<p class="caption mb-2">متاح ${r.stats.unused} · مستخدم ${r.stats.used}</p>
      ${r.items.map(x => `<div class="card flex-between mb-2" style="padding:8px 10px">
        <span class="mono" dir="ltr" style="font-size:11px;${x.used ? 'opacity:.5;text-decoration:line-through' : ''}">${esc(x.code)}</span>
        ${x.used ? '<span class="caption">مستخدم</span>' : `<button class="btn btn-ghost btn-sm" data-dstk="${esc(x.id)}" aria-label="حذف">${svg(I.trash)}</button>`}
      </div>`).join('')}`;
    box.querySelectorAll('[data-dstk]').forEach(b => b.onclick = async () => {
      if (!confirm('حذف هذا الكود؟')) return;
      try { await api('/api/admin/store-stock/delete', { id: b.dataset.dstk }); toast('حُذف', 'ok'); loadStockList(reveal); loadStore(); }
      catch (e) { toast(e.message, 'bad'); }
    });
  } catch (e) { box.innerHTML = ''; toast(e.message, 'bad'); }
}

function bindStore() {
  document.querySelectorAll('[data-stab]').forEach(b => b.onclick = () => { S.storeTab = b.dataset.stab; S.q = ''; render(true); });
  onTap('#addCat', () => openCatEdit(null));
  onTap('#addProd', () => openProdEdit(null));
  document.querySelectorAll('[data-ecat]').forEach(b => b.onclick = () => openCatEdit(b.dataset.ecat));
  document.querySelectorAll('[data-eprod]').forEach(b => b.onclick = () => openProdEdit(b.dataset.eprod));
  document.querySelectorAll('[data-dcat]').forEach(b => b.onclick = async () => {
    if (!confirm('حذف القسم؟')) return;
    try { await api('/api/admin/category/delete', { id: b.dataset.dcat }); toast('حُذف', 'ok'); loadStore(); } catch (e) { toast(e.message, 'bad'); }
  });
  document.querySelectorAll('[data-dprod]').forEach(b => b.onclick = async () => {
    if (!confirm('حذف المنتج نهائيًا؟ (الأفضل إخفاؤه)')) return;
    try { await api('/api/admin/product/delete', { id: b.dataset.dprod }); toast('حُذف', 'ok'); loadStore(); } catch (e) { toast(e.message, 'bad'); }
  });
  const sp = $('#stPid'); if (sp) sp.onchange = () => { S.stockPid = sp.value; $('#stList').innerHTML = ''; };
  onTap('#stLoad', () => loadStockList(false));
  onTap('#stReveal', () => { if (confirm('كشف الأكواد كاملة؟ (يُسجَّل في سجل التدقيق)')) loadStockList(true); });
  onTap('#stAdd', async () => {
    const t = ($('#stCodes').value || '').trim(); if (!t) return toast('الصق الأكواد', 'bad');
    const b = $('#stAdd'); b.disabled = true; b.classList.add('loading');
    try { const r = await api('/api/admin/store-stock/add', { pid: S.stockPid, bulk_text: t }); toast(`أُضيف ${r.added} كود`, 'ok'); $('#stCodes').value = ''; loadStore(); loadStockList(false); }
    catch (e) { toast(e.message, 'bad'); }
    b.disabled = false; b.classList.remove('loading');
  });
}

/* ─── SMS linking + manual phone verification ─── */
function openSmsAssign(smsId) {
  const s = (S.sms || []).find(x => x.id === smsId) || {};
  modal(`
    <div class="modal-head"><div class="modal-title">ربط حوالة بمستخدم</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    <div class="card mb-3" style="background:var(--surface-2)"><div class="tabular h4">${esc(lyd(s.amount_lyd || 0))}</div>
      <div class="caption mono" dir="ltr">${esc(s.sender ? '0' + s.sender : s.from || '—')}</div></div>
    <div class="field mb-3"><label class="field-label" for="saQ">ابحث عن المستخدم (بريد، اسم، رقم)</label>
      <input class="input" id="saQ" autocomplete="off"><div id="saRes" style="margin-top:6px"></div></div>
    <div class="field mb-4"><label class="field-label" for="saWhy">السبب</label><input class="input" id="saWhy" value="ربط يدوي بعد التحقق"></div>
    <button class="btn btn-primary btn-block" id="saGo" disabled>ربط وإضافة الرصيد</button>`);
  let uid = '';
  $('#saQ').oninput = () => {
    const q = $('#saQ').value.trim().toLowerCase();
    const hits = q.length < 2 ? [] : (S.users || []).filter(u => [u.email, u.name, u.phone, u.phone_verified].some(v => String(v || '').toLowerCase().includes(q))).slice(0, 6);
    $('#saRes').innerHTML = hits.map(u => `<button class="btn btn-ghost btn-sm btn-block" data-pick="${esc(u.id)}" style="justify-content:flex-start">${esc(u.name || '')} · ${esc(u.email || '')} ${u.phone_verified ? '· 0' + esc(u.phone_verified) + ' ✓' : ''}</button>`).join('');
    $('#saRes').querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { uid = b.dataset.pick; $('#saQ').value = b.textContent.trim(); $('#saRes').innerHTML = ''; $('#saGo').disabled = false; });
  };
  onTap('#saGo', async () => {
    if (!uid) return;
    const b = $('#saGo'); b.disabled = true; b.classList.add('loading');
    try { const r = await api('/api/admin/sms/assign', { sms_id: smsId, uid, reason: $('#saWhy').value.trim() }); closeModal(); toast('أُضيف ' + usd(r.credited), 'ok'); }
    catch (e) { toast(e.message, 'bad'); b.disabled = false; b.classList.remove('loading'); }
  });
}

async function loadPhonePending() {
  const box = $('#pvList'); if (!box) return;
  try {
    const r = await api('/api/admin/phone/pending', {});
    const items = (r.items || []).filter(x => !x.expired);
    box.innerHTML = items.length ? items.map(x => `
      <div class="card flex-between mb-2">
        <div><div class="body" style="font-weight:600">${esc(userName(x.uid))}</div>
          <div class="caption mono" dir="ltr">0${esc(x.phone)} · ${esc(String(x.amount_lyd))} د.ل · ${x.network === 'almadar' ? 'المدار' : 'ليبيانا'}</div></div>
        <button class="btn btn-primary btn-sm" data-pvok="${esc(x.phone)}">وصلت ✓</button>
      </div>`).join('') : '<p class="caption">لا طلبات توثيق معلّقة.</p>';
    box.querySelectorAll('[data-pvok]').forEach(b => b.onclick = async () => {
      if (!confirm('تأكدت من وصول الحوالة بهذا المبلغ من هذا الرقم على هاتفك؟')) return;
      try { const res = await api('/api/admin/phone/approve', { phone: b.dataset.pvok }); toast('وُثّق الرقم' + (res.credited ? ' وأُضيف ' + usd(res.credited) : ''), 'ok'); loadPhonePending(); }
      catch (e) { toast(e.message, 'bad'); }
    });
  } catch (e) { box.innerHTML = `<p class="caption">${esc(e.message)}</p>`; }
}

function vSms() {
  const f = S.smsFilter || 'open';
  const list = (S.sms || []).filter(s => f === 'all' ? true : f === 'open' ? s.status !== 'claimed' : s.status === 'claimed');
  const ST = { claimed: ['badge-success', 'مربوطة'], untrusted: ['badge-error', 'مرسل غير موثوق'], review: ['badge-warning', 'تحتاج مراجعة'], unparsed: ['badge-error', 'غير مفهومة'], unclaimed: ['badge-warning', 'غير مربوطة'] };
  return `
  <div class="page-enter">
    <div class="mb-3"><h1 class="h2" style="margin-bottom:4px;font-family:var(--font-display)">رسائل التحويل</h1>
      <p class="body-sm text-2" style="font-size:11.5px">وضع الإيداع: <b>${S.settings.deposit_mode === 'manual' ? 'يدوي' : 'تلقائي'}</b> — يُغيَّر من الإعدادات › الدفع</p></div>

    <div class="card mb-4"><div class="h4 mb-2" style="font-size:13px">طلبات توثيق الأرقام</div>
      <p class="caption mb-2">في الوضع اليدوي: تأكد من وصول الحوالة على هاتفك ثم اضغط «وصلت».</p>
      <div id="pvList"><p class="caption">جاري التحميل…</p></div></div>

    <div class="pills mb-3">${[['open', 'تحتاج إجراء'], ['claimed', 'مربوطة'], ['all', 'الكل']].map(([k, t]) => `<button class="pill ${f === k ? 'active' : ''}" data-smsf="${k}">${t}</button>`).join('')}</div>
    ${list.length ? `<div style="display:flex;flex-direction:column;gap:8px">
      ${list.map(s => { const st = ST[s.status] || ST.unclaimed; return `
        <div class="card">
          <div class="flex-between mb-2">
            <div><div class="tabular h4" style="font-size:14px;color:var(--sand)">${s.amount_lyd ? esc(lyd(s.amount_lyd)) : '—'}</div>
              <div class="caption mono" dir="ltr" style="font-size:10.5px">${esc(s.sender ? '0' + s.sender : s.from || '—')}</div></div>
            <span class="badge ${st[0]}">${st[1]}</span>
          </div>
          <div class="caption mb-2" style="font-size:10.5px">${esc(dt(s.created_at))}${s.uid ? ' · ' + esc(userName(s.uid)) : ''}${s.error ? ' · ' + esc(s.error) : ''}</div>
          <div class="copy-box mb-2"><div class="copy-value" style="font-size:10.5px">${esc((s.raw_text || '').slice(0, 160))}</div></div>
          ${s.status !== 'claimed' && s.amount_lyd ? `<button class="btn btn-secondary btn-sm" data-sasg="${esc(s.id)}">ربط بمستخدم</button>` : ''}
        </div>`; }).join('')}</div>` : emptyState(I.sms, 'لا رسائل هنا')}
  </div>`;
}

/* ─── Settings tabs: payment mode + plans ─── */
function settingsPayMode(s) {
  return `
  <div class="card mb-4">
    <div class="h4" style="margin-bottom:10px;font-size:13px">وضع إيداع ليبيانا والمدار</div>
    <div class="field" style="grid-template-columns:1fr"><select class="input" data-op="deposit_mode">
      <option value="auto" ${s.deposit_mode !== 'manual' ? 'selected' : ''}>تلقائي — تطبيق إعادة توجيه الرسائل يعمل</option>
      <option value="manual" ${s.deposit_mode === 'manual' ? 'selected' : ''}>يدوي — أراجع الحوالات بنفسي</option></select></div>
    <p class="caption" style="margin-top:8px">التلقائي: الرصيد يُضاف فور وصول الرسالة لمن وثّق رقمه. اليدوي: كل مطالبة تظهر في «الإيداعات» لتعتمدها بعد التأكد من هاتفك.</p>
  </div>`;
}

function settingsPlans(s) {
  const row = (k, lbl) => `<div class="field" style="grid-template-columns:1fr 100px"><div><div class="sw-lbl">${lbl}</div></div>
    <input class="input" data-op="${k}" type="number" value="${esc(String(s[k] ?? ''))}"></div>`;
  return `
  <div class="card mb-4">
    <div class="h4" style="margin-bottom:12px;font-size:13px">الباقات</div>
    <div class="sw-row"><div><div class="sw-lbl">تفعيل الباقات</div><div class="sw-desc">السماح بالاشتراك من التطبيق</div></div>
      <div class="sw ${s.plans_enabled !== false ? 'on' : ''}" data-op="plans_enabled"></div></div>
    ${row('plan_free_cards', 'بطاقات العادي')}
    ${row('plan_basic_cards', 'بطاقات الأساسي')}${row('plan_basic_price', 'سعر الأساسي ($)')}${row('plan_basic_days', 'مدة الأساسي (يوم)')}
    ${row('plan_vip_cards', 'بطاقات VIP')}${row('plan_vip_price', 'سعر VIP ($)')}${row('plan_vip_days', 'مدة VIP (يوم)')}
  </div>
  <button class="btn btn-primary" data-save="ops">حفظ</button>`;
}

/* ─── User plan (in user modal) ─── */
function userPlanBlock(u) {
  const cur = (u.plan === 'basic' || u.plan === 'vip') && Number(u.plan_expires_ms || 0) > Date.now() ? u.plan : 'free';
  return `
    <div class="card mb-3" style="background:var(--surface-2)">
      <div class="flex-between mb-2"><span class="sw-lbl">الباقة</span><span class="badge">${esc(PLAN_AR[cur])}${cur !== 'free' ? ' · حتى ' + esc(dt(new Date(u.plan_expires_ms).toISOString())) : ''}</span></div>
      <div class="grid-3" style="gap:6px">
        <select class="input" id="upPlan"><option value="free">العادي</option><option value="basic">الأساسي</option><option value="vip">VIP</option></select>
        <input class="input" id="upDays" type="number" value="30" aria-label="المدة بالأيام">
        <button class="btn btn-secondary" id="upGo">تطبيق</button>
      </div>
    </div>`;
}
function bindUserPlan(uid) {
  onTap('#upGo', async () => {
    const reason = (prompt('سبب تغيير الباقة:') || '').trim();
    if (reason.length < 3) return toast('السبب مطلوب', 'bad');
    try { await api('/api/admin/user/plan', { uid, plan: $('#upPlan').value, days: n($('#upDays').value), reason }); toast('حُدّثت الباقة', 'ok'); closeModal(); }
    catch (e) { toast(e.message, 'bad'); }
  });
}


/* ═══════════════════════════════════════════════════════════
   v7 — System page (staff, ledger, audit, mail) + load more
   ═══════════════════════════════════════════════════════════ */

const ROLE_AR2 = { super_admin: 'مسؤول رئيسي', finance: 'مالية', support: 'دعم', ops: 'عمليات' };

function vSystem() {
  if (S.admin.role !== 'super_admin') return emptyState(I.gear, 'للمسؤول الرئيسي فقط');
  const staff = S.staff || [];
  return `
  <div class="page-enter">
    <div class="mb-3"><h1 class="h2" style="margin-bottom:4px;font-family:var(--font-display)">النظام</h1>
      <p class="body-sm text-2" style="font-size:11.5px">الموظفون، سلامة السجل المالي، سجل التدقيق، البريد</p></div>

    <div class="card mb-4">
      <div class="h4 mb-2" style="font-size:13px">الموظفون والأدوار</div>
      ${staff.map(a => `<div class="flex-between mb-2"><div><div class="body" style="font-weight:600">${esc(userName(a.id))}</div>
        <div class="caption">${esc(ROLE_AR2[a.role] || 'بلا دور')}${a.id === S.admin.uid ? ' · أنت' : ''}</div></div>
        ${a.id !== S.admin.uid ? `<button class="btn btn-secondary btn-sm" data-staff="${esc(a.id)}">تعديل</button>` : ''}</div>`).join('') || '<p class="caption">جاري التحميل…</p>'}
      <button class="btn btn-ghost btn-sm" id="addStaff" style="margin-top:6px">${svg(I.plus)} إضافة موظف</button>
    </div>

    <div class="card mb-4">
      <div class="h4 mb-2" style="font-size:13px">فحص سلامة السجل المالي</div>
      <div style="display:flex;gap:6px"><input class="input" id="lvQ" placeholder="بريد أو اسم أو رقم المستخدم" autocomplete="off">
        <button class="btn btn-primary btn-sm" id="lvGo">فحص</button></div>
      <div id="lvOut" style="margin-top:8px"></div>
    </div>

    <div class="card mb-4">
      <div class="flex-between mb-2"><div class="h4" style="font-size:13px">سجل التدقيق (آخر 60)</div>
        <button class="btn btn-ghost btn-sm" id="auLoad">تحديث</button></div>
      <div id="auOut"><p class="caption">اضغط «تحديث»</p></div>
    </div>

    <div class="card mb-4">
      <div class="h4 mb-2" style="font-size:13px">البريد الإلكتروني</div>
      <p class="caption mb-2">يتطلب RESEND_API_KEY و MAIL_FROM في متغيرات الـ Worker.</p>
      <button class="btn btn-secondary btn-sm" id="mailTest">إرسال بريد تجريبي لي</button>
    </div>
  </div>`;
}

function findUserByQ(q) {
  q = q.trim().toLowerCase().replace(/^0/, '');
  return (S.users || []).find(u => [u.email, u.name, u.phone_verified, u.id].some(v => String(v || '').toLowerCase() === q))
      || (S.users || []).find(u => [u.email, u.name].some(v => String(v || '').toLowerCase().includes(q)));
}

async function loadStaff() {
  try {
    const r = await getDocs(query(collection(db, 'admins'), limit(50)));
    S.staff = r.docs.map(d => ({ id: d.id, ...d.data() }));
    render(true);
  } catch (e) { toast('تعذّر تحميل الموظفين', 'bad'); }
}

function openStaffEdit(uid) {
  const a = uid ? (S.staff || []).find(x => x.id === uid) : null;
  modal(`
    <div class="modal-head"><div class="modal-title">${a ? 'تعديل موظف' : 'إضافة موظف'}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    ${a ? `<p class="body mb-3">${esc(userName(uid))}</p>` : `
      <div class="field mb-3"><label class="field-label" for="stQ">بريد المستخدم (يجب أن يكون مسجّلًا)</label><input class="input" id="stQ" dir="ltr"></div>`}
    <div class="field mb-4"><label class="field-label" for="stRole">الدور</label>
      <select class="input" id="stRole">
        ${Object.entries(ROLE_AR2).map(([k, t]) => `<option value="${k}" ${a && a.role === k ? 'selected' : ''}>${t}</option>`).join('')}
        ${a ? '<option value="">— إزالة الصلاحيات —</option>' : ''}
      </select></div>
    <button class="btn btn-primary btn-block" id="stSave">حفظ</button>`);
  onTap('#stSave', async () => {
    let target = uid;
    if (!target) { const u = findUserByQ($('#stQ').value || ''); if (!u) return toast('لم نجد المستخدم', 'bad'); target = u.id; }
    const role = $('#stRole').value;
    if (role === 'super_admin' && !confirm('منح صلاحيات كاملة؟')) return;
    try { await api('/api/admin/staff/set', { uid: target, role }); closeModal(); toast('حُفظ', 'ok'); loadStaff(); }
    catch (e) { toast(e.message, 'bad'); }
  });
}

function bindSystem() {
  document.querySelectorAll('[data-staff]').forEach(b => b.onclick = () => openStaffEdit(b.dataset.staff));
  onTap('#addStaff', () => openStaffEdit(null));
  onTap('#lvGo', async () => {
    const u = findUserByQ($('#lvQ').value || '');
    if (!u) return toast('لم نجد المستخدم', 'bad');
    $('#lvOut').innerHTML = '<p class="caption">جاري الفحص…</p>';
    try {
      const r = await api('/api/admin/ledger/verify', { uid: u.id });
      $('#lvOut').innerHTML = `<div class="alert ${r.ok ? 'alert-success' : 'alert-error'}">${svg(r.ok ? I.check : I.warn)}<div>
        <b>${esc(u.name || u.email || u.id)}</b> — ${r.ok ? 'السجل سليم' : 'مشكلة في السجل'}<br>
        ${r.migrated ? `قيود: ${r.entries} · مجموع السجل ${esc(usd(r.ledger_sum))} · الرصيد ${esc(usd(r.balance))}` : 'لم يُرحَّل بعد (لا عمليات مالية منذ التحديث)'}
        ${r.problems.length ? '<br>' + r.problems.map(esc).join('<br>') : ''}</div></div>`;
    } catch (e) { $('#lvOut').innerHTML = ''; toast(e.message, 'bad'); }
  });
  onTap('#auLoad', async () => {
    try {
      const r = await getDocs(query(collection(db, 'audit_log'), orderBy('created_at', 'desc'), limit(60)));
      $('#auOut').innerHTML = r.docs.map(d => { const a = d.data(); return `
        <div style="padding:6px 0;border-bottom:1px solid var(--border)">
          <div class="flex-between"><span class="mono" style="font-size:11px">${esc(a.action)}</span><span class="caption">${esc(dt(a.created_at))}</span></div>
          <div class="caption">${esc(userName(a.actor))} · <span dir="ltr" class="mono" style="font-size:10px">${esc(String(a.details || '').slice(0, 140))}</span></div>
        </div>`; }).join('') || '<p class="caption">لا سجلات</p>';
    } catch (e) { toast('تعذّر التحميل: ' + (e.code || ''), 'bad'); }
  });
  onTap('#mailTest', async () => {
    try { await api('/api/admin/mail/test', {}); toast('أُرسل — تحقق من بريدك', 'ok'); } catch (e) { toast(e.message, 'bad'); }
  });
}

/* ─── Load more (pagination) ─── */
const MORE_KEYS = { users: 'users', deposits: 'deposits', orders: 'orders', sms: 'sms', withdraw: 'withdrawals', services: 'serviceOrders', mcards: 'manualOrders', cards: 'manualCards', tickets: 'tickets' };
function moreBtn() {
  const key = MORE_KEYS[S.page];
  if (!key || !S.lim || !S.lim[key]) return '';
  return (S[key] || []).length >= S.lim[key]
    ? `<div style="text-align:center;margin:16px 0 90px"><button class="btn btn-secondary btn-sm" id="loadMore" data-key="${key}">عرض المزيد</button></div>` : '';
}

/* ═══ Delegated actions (بديل onclick المضمّن — متوافق مع CSP) ═══ */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'close-modal') { e.preventDefault(); window.closeModal(); }
  else if (act === 'go') { e.preventDefault(); window.go(el.dataset.page); }
  else if (act === 'refresh') { window.refreshAll(); }
  else if (act === 'mcard-fulfil') { window.openMcardFulfil(el.dataset.id); }
});


/* ═══════════════════════════════════════════════════════════
   SMS
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   Settings
   ═══════════════════════════════════════════════════════════ */

function vSettings() {
  const s = S.settings || {};
  const TABS = [
    ['ops', 'التشغيل'],
    ['mcard', 'البطاقات'],
    ['pay', 'الدفع'],
    ['limits', 'الحدود'],
    ['plans', 'الباقات'],
  ];

  return `
  <div class="page-enter">
    <div class="mb-4">
      <div style="font-family:var(--font-mono);font-size:10px;letter-spacing:0.15em;color:var(--sand);text-transform:uppercase;margin-bottom:6px">
        SETTINGS
      </div>
      <h1 class="h2" style="margin-bottom:4px;font-family:var(--font-display)">الإعدادات</h1>
      <p class="body-sm text-2" style="font-size:11.5px">تحكم كامل في المنصة</p>
    </div>

    <div class="pills mb-4">
      ${TABS.map(([k, t]) => `<button class="pill ${S.setTab === k ? 'active' : ''}" data-settab="${esc(k)}">${esc(t)}</button>`).join('')}
    </div>

    ${S.setTab === 'ops' ? settingsOps(s) : ''}
    ${S.setTab === 'mcard' ? settingsMcard(s) : ''}
    ${S.setTab === 'pay' ? settingsPayMode(s) + settingsPay(s) : ''}
    ${S.setTab === 'plans' ? settingsPlans(s) : ''}
    ${S.setTab === 'limits' ? settingsLimits(s) : ''}
  </div>
  `;
}

function settingsOps(s) {
  return `
  <div class="card mb-4">
    <div class="h4" style="margin-bottom:12px;font-size:13px">حالة المنصة</div>

    <div class="sw-row">
      <div>
        <div class="sw-lbl">المنصة تعمل</div>
        <div class="sw-desc">إيقافه يمنع كل العمليات</div>
      </div>
      <div class="sw ${s.kill_switch !== true ? 'on' : ''}" data-op="kill_switch" data-inverse="1"></div>
    </div>

    <div class="field" style="grid-template-columns:1fr;padding-top:10px">
      <div>
        <div class="sw-lbl" style="margin-bottom:6px">رسالة التوقف</div>
        <input class="input" data-op="kill_message" value="${esc(s.kill_message || 'الخدمة متوقفة مؤقتًا للصيانة.')}">
      </div>
    </div>
  </div>

  <button class="btn btn-primary" data-save="ops">حفظ الإعدادات</button>
  `;
}

function settingsMcard(s) {
  return `
  <div class="card mb-4">
    <div class="h4" style="margin-bottom:12px;font-size:13px">البطاقات اليدوية</div>

    <div class="sw-row">
      <div>
        <div class="sw-lbl">تفعيل الخدمة</div>
        <div class="sw-desc">السماح للعملاء بطلب بطاقات</div>
      </div>
      <div class="sw ${s.manual_cards_enabled !== false ? 'on' : ''}" data-op="manual_cards_enabled"></div>
    </div>

    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">أقل مبلغ ($)</div></div>
      <input class="input" data-op="mc_create_min" type="number" value="${n(s.mc_create_min, 10)}">
    </div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">نافذة CVV (دقائق)</div><div class="sw-desc">يُعرض مرة واحدة خلالها بعد الإصدار (1–60)</div></div>
      <input class="input" data-op="mc_cvv_minutes" type="number" min="1" max="60" value="${n(s.mc_cvv_minutes, 5)}">
    </div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">أقصى مبلغ ($)</div></div>
      <input class="input" data-op="mc_create_max" type="number" value="${n(s.mc_create_max, 500)}">
    </div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">رسوم ثابتة ($)</div></div>
      <input class="input" data-op="mc_create_fee_fixed" type="number" step="0.5" value="${n(s.mc_create_fee_fixed, 8)}">
    </div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">رسوم نسبية (%)</div></div>
      <input class="input" data-op="mc_create_fee_pct" type="number" step="0.1" value="${n(s.mc_create_fee_pct, 2.5)}">
    </div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">مدة العرض (ساعة)</div></div>
      <input class="input" data-op="mc_reveal_hours" type="number" value="${n(s.mc_reveal_hours, 24)}">
    </div>
  </div>

  <button class="btn btn-primary" data-save="ops">حفظ</button>
  `;
}

function settingsPay(s) {
  const methods = [
    ['libyana', 'ليبيانا'],
    ['almadar', 'المدار'],
    ['bank', 'تحويل مصرفي'],
    ['usdt', 'USDT'],
    ['binance', 'Binance'],
  ];

  return `
  <div class="card mb-4">
    <div class="h4" style="margin-bottom:12px;font-size:13px">طرق الدفع</div>

    ${methods.map(([k, label]) => {
      const on = ['bank', 'usdt', 'binance'].includes(k)
        ? s['m_' + k + '_on'] === true
        : s['m_' + k + '_on'] !== false;
      return `
        <div class="sw-row">
          <div>
            <div class="sw-lbl">${esc(label)}</div>
          </div>
          <div class="sw ${on ? 'on' : ''}" data-op="m_${k}_on"></div>
        </div>
      `;
    }).join('')}
  </div>

  <div class="card mb-4">
    <div class="h4" style="margin-bottom:12px;font-size:13px">أرقام التحويل</div>
    <div class="field" style="grid-template-columns:1fr">
      <div>
        <div class="sw-lbl" style="margin-bottom:6px">رقم ليبيانا</div>
        <input class="input mono" data-op="m_libyana_phone" dir="ltr" value="${esc(s.m_libyana_phone || s.deposit_phone || '')}">
      </div>
    </div>
    <div class="field" style="grid-template-columns:1fr">
      <div>
        <div class="sw-lbl" style="margin-bottom:6px">رقم المدار</div>
        <input class="input mono" data-op="m_almadar_phone" dir="ltr" value="${esc(s.m_almadar_phone || s.deposit_phone || '')}">
      </div>
    </div>
    <div class="field" style="grid-template-columns:1fr">
      <div>
        <div class="sw-lbl" style="margin-bottom:6px">عنوان USDT TRC20</div>
        <input class="input mono" data-op="usdt_address" dir="ltr" value="${esc(s.usdt_address || '')}">
      </div>
    </div>
  </div>

  <button class="btn btn-primary" data-save="ops">حفظ</button>
  `;
}

function settingsLimits(s) {
  return `
  <div class="card mb-4">
    <div class="h4" style="margin-bottom:12px;font-size:13px">الحدود اليومية</div>

    <div class="sw-row">
      <div>
        <div class="sw-lbl">تفعيل الحدود</div>
      </div>
      <div class="sw ${s.limits_enabled !== false ? 'on' : ''}" data-op="limits_enabled"></div>
    </div>

    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">بطاقات لكل عميل</div></div>
      <input class="input" data-op="daily_cards_max" type="number" value="${n(s.daily_cards_max, 3)}">
    </div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">قيمة يومية ($)</div></div>
      <input class="input" data-op="daily_amount_max" type="number" value="${n(s.daily_amount_max, 200)}">
    </div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">إيداع يومي ($)</div></div>
      <input class="input" data-op="daily_deposit_max" type="number" value="${n(s.daily_deposit_max, 500)}">
    </div>
  </div>

  <button class="btn btn-primary" data-save="ops">حفظ</button>
  `;
}

async function saveSettings(btn) {
  const payload = {};
  document.querySelectorAll('.sw[data-op]').forEach(el => {
    let v = el.classList.contains('on');
    if (el.dataset.inverse) v = !v;
    payload[el.dataset.op] = v;
  });
  document.querySelectorAll('input[data-op], textarea[data-op], select[data-op]').forEach(el => {
    const k = el.dataset.op;
    payload[k] = el.type === 'number' ? n(el.value) : el.value;
  });

  if (!Object.keys(payload).length) return;

  btn.disabled = true;
  btn.classList.add('loading');
  try {
    await api('/api/admin/settings', payload);
    S._dirty = false;
    toast('حُفظت الإعدادات', 'ok');
  } catch (e) {
    toast(e.message, 'bad');
  }
  btn.disabled = false;
  btn.classList.remove('loading');
}

/* ═══════════════════════════════════════════════════════════
   Bind
   ═══════════════════════════════════════════════════════════ */

function bind() {
  const q = $('#qBox');
  if (q) {
    q.oninput = e => {
      S.q = e.target.value;
      clearTimeout(q._t);
      q._t = setTimeout(() => {
        render(true);
        const el = $('#qBox');
        if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
      }, 250);
    };
  }

  document.querySelectorAll('[data-filter]').forEach(b =>
    b.onclick = () => { S.filter = b.dataset.filter; render(); });

  document.querySelectorAll('[data-mc]').forEach(b =>
    b.onclick = () => openMcardFulfil(b.dataset.mc));

  document.querySelectorAll('[data-ord-ok]').forEach(b =>
    b.onclick = () => openOrderAction(b.dataset.ordOk, 'complete'));
  document.querySelectorAll('[data-ord-no]').forEach(b =>
    b.onclick = () => openOrderAction(b.dataset.ordNo, 'reject'));

  document.querySelectorAll('[data-svc-tab]').forEach(b =>
    b.onclick = () => {
      S.svcTab = b.dataset.svcTab;
      S.revealMode = false;
      if (S.svcTab === 'stock' && S.svcSelected) loadSvcStock(S.svcSelected);
      render();
    });

  onTap('#addSvc', () => openServiceEdit(null));
  onTap('#addSvc2', () => openServiceEdit(null));

  document.querySelectorAll('[data-edit-svc]').forEach(b =>
    b.onclick = () => openServiceEdit(b.dataset.editSvc));

  document.querySelectorAll('[data-del-svc]').forEach(b =>
    b.onclick = () => {
      const svc = S.services.find(x => x.id === b.dataset.delSvc);
      if (!svc) return;
      modal(`
        <div class="modal-head">
          <div class="modal-title">حذف الخدمة</div>
          <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
        </div>
        <div class="alert alert-warning mb-3" style="font-size:11.5px">${svg(I.warn)}<div>سيتم حذف "<strong>${esc(svc.name)}</strong>" نهائياً.</div></div>
        <button class="btn btn-danger btn-block" id="delConfirm2">تأكيد الحذف</button>
        <button class="btn btn-secondary btn-block" style="margin-top:6px" data-act="close-modal">إلغاء</button>
      `);
      onTap('#delConfirm2', async () => {
        try {
          await api('/api/admin/service/delete', { id: b.dataset.delSvc });
          closeModal();
          toast('تم الحذف', 'ok');
        } catch (e) { toast(e.message, 'bad'); }
      });
    });

  const svcSel = $('#svcSelect');
  if (svcSel) {
    svcSel.onchange = () => {
      S.svcSelected = svcSel.value;
      S.revealMode = false;
      if (S.svcSelected) {
        loadSvcStock(S.svcSelected);
      } else {
        S.svcStock = { items: [], stats: { unused: 0, used: 0, total: 0 } };
        render();
      }
    };
  }

  onTap('#addStockBtn', addStockCodes);

  onTap('#toggleReveal', () => {
    S.revealMode = !S.revealMode;
    if (S.svcSelected) loadSvcStock(S.svcSelected);
  });

  document.querySelectorAll('[data-del-stock]').forEach(b =>
    b.onclick = () => delStockCode(b.dataset.delStock));

  document.querySelectorAll('[data-svc-deliver]').forEach(b =>
    b.onclick = () => openSvcDeliver(b.dataset.svcDeliver));
  document.querySelectorAll('[data-svc-reject]').forEach(b =>
    b.onclick = () => openSvcReject(b.dataset.svcReject));

  document.querySelectorAll('[data-dep]').forEach(b =>
    b.onclick = () => openDepositReview(b.dataset.dep));

  document.querySelectorAll('[data-wd-ok]').forEach(b =>
    b.onclick = () => openWithdrawAction(b.dataset.wdOk, 'complete'));
  document.querySelectorAll('[data-wd-no]').forEach(b =>
    b.onclick = () => openWithdrawAction(b.dataset.wdNo, 'reject'));

  document.querySelectorAll('[data-tic]').forEach(b =>
    b.onclick = () => openTicketDetail(b.dataset.tic));

  document.querySelectorAll('[data-user]').forEach(b =>
    b.onclick = () => openUserManage(b.dataset.user));

  document.querySelectorAll('[data-ecoup]').forEach(b =>
    b.onclick = () => openCouponEdit(b.dataset.ecoup));
  onTap('#addCoup', () => openCouponEdit(null));

  document.querySelectorAll('[data-settab]').forEach(b =>
    b.onclick = () => {
      if (S._dirty && !confirm('لديك تعديلات غير محفوظة — تجاهلها؟')) return;
      S._dirty = false; S.setTab = b.dataset.settab; render(true);
    });

  document.querySelectorAll('.sw[data-op]').forEach(el =>
    el.onclick = () => { el.classList.toggle('on'); S._dirty = true; });
  document.querySelectorAll('#view input[data-op], #view textarea[data-op], #view select[data-op]').forEach(el =>
    el.addEventListener('input', () => { S._dirty = true; }));

  if (S.page === 'store') bindStore();
  if (S.page === 'system') bindSystem();
  onTap('#loadMore', () => { const k = $('#loadMore').dataset.key; S.lim[k] += 100; subKey(k); toast('جاري التحميل…', 'ok'); });
  document.querySelectorAll('[data-sasg]').forEach(b => b.onclick = () => openSmsAssign(b.dataset.sasg));
  document.querySelectorAll('[data-smsf]').forEach(b => b.onclick = () => { S.smsFilter = b.dataset.smsf; render(true); loadPhonePending(); });

  document.querySelectorAll('[data-save="ops"]').forEach(b =>
    b.onclick = () => saveSettings(b));
}

/* ═══ Stock helpers ═══ */

async function addStockCodes() {
  const svcId = S.svcSelected;
  const codesText = ($('#bulkCodes').value || '').trim();

  if (!svcId) { toast('اختر خدمة أولاً', 'bad'); return; }
  if (!codesText) { toast('أضف أكواداً', 'bad'); return; }

  const codes = codesText.split(/\r?\n/).map(c => c.trim()).filter(Boolean);
  if (!codes.length) { toast('لا أكواد صالحة', 'bad'); return; }
  if (codes.length > 500) { toast('حد أقصى 500 كود', 'bad'); return; }

  const btn = $('#addStockBtn');
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    const r = await api('/api/admin/stock/add', { service_id: svcId, codes });
    toast(`تم إضافة ${r.added} كود`, 'ok');
    $('#bulkCodes').value = '';
    loadSvcStock(svcId);
  } catch (e) { toast(e.message, 'bad'); }
  btn.disabled = false;
  btn.classList.remove('loading');
}

async function loadSvcStock(svcId) {
  if (!svcId) return;
  try {
    const r = await api('/api/admin/stock/list', {
      service_id: svcId,
      reveal: S.revealMode === true,
    });
    S.svcStock = {
      items: r.items || [],
      stats: r.stats || { unused: 0, used: 0, total: 0 },
    };
    render();
  } catch (e) {
    console.warn('stock load failed');
    toast(e.message, 'bad');
  }
}

async function delStockCode(itemId) {
  if (!S.svcSelected) return;
  try {
    await api('/api/admin/stock/delete', { id: itemId });
    toast('تم الحذف', 'ok');
    loadSvcStock(S.svcSelected);
  } catch (e) { toast(e.message, 'bad'); }
}

/* ═══ Logout ═══ */
onTap('#logoutBtn', () => {
  modal(`
    <div class="modal-head">
      <div class="modal-title">تسجيل الخروج</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>
    <p class="body-sm text-2 mb-4" style="font-size:12px">هل أنت متأكد؟</p>
    <button class="btn btn-primary btn-block" id="doOut">تأكيد الخروج</button>
    <button class="btn btn-secondary btn-block" style="margin-top:6px" data-act="close-modal">إلغاء</button>
  `);
  onTap('#doOut', () => { closeModal(); signOut(auth); });
});
