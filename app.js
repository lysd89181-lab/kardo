/**
 * ═══════════════════════════════════════════════════════════
 *  KARDO — App Logic
 *  كاردو — منطق الواجهة الرئيسي
 * ═══════════════════════════════════════════════════════════
 *  يعمل مع:
 *   - config.js  (الإعدادات)
 *   - styles.css (التصميم)
 *   - index.html (الواجهة)
 *   - worker.js  (Backend)
 * ═══════════════════════════════════════════════════════════
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut, sendPasswordResetEmail }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { API_BASE, firebaseConfig } from './config.js';
import { getFirestore, doc, setDoc, getDoc, onSnapshot, collection,
  query, where, orderBy, limit, addDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* ═══ State ═══ */
const S = {
  user: null,
  profile: { wallet_balance: 0, cards_count: 0, total_spent: 0,
             name: '', email: '', phone: '', points: 0 },
  cards: [], orders: [], deposits: [], shopOrders: [],
  catalog: { categories: [], products: [] },
  cart: [], cat: null, q: '', filter: 'all',
  config: {
    usd_to_lyd: 11.8, min_amount: 10, max_amount: 500,
    manual_cards: { on: true, create_min: 10, create_max: 500,
                    create_fee_fixed: 8, create_fee_pct: 2.5,
                    topup_min: 10, topup_max: 500,
                    topup_fee_fixed: 8, topup_fee_pct: 2.5,
                    reveal_hours: 24 },
    banners: [], methods: {}, nav: {}, theme: null, texts: {}, referral: {},
  },
  withdrawals: [], transfers: [], tickets: [], coupon: null, dataErr: {},
  manualCards: [], manualOrders: [],
  page: 'home', dir: null, unsub: [],
  wiz: { step: 1, amount: null, name: '', label: '', idem: null },
};

/* ═══ Icons ═══ */
const I = {
  home: '<path d="M3 10.4 12 3.2l9 7.2V20a1 1 0 0 1-1 1h-5v-6.5H9V21H4a1 1 0 0 1-1-1z"/>',
  grid: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
  bag: '<path d="M4.5 8h15l-1.2 12.2a1.8 1.8 0 0 1-1.8 1.6H7.5a1.8 1.8 0 0 1-1.8-1.6z"/><path d="M8.5 8V6a3.5 3.5 0 0 1 7 0v2"/>',
  wallet: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5z"/><path d="M16.5 12h1.5"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/>',
  plus: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M12 10.5v4M10 12.5h4"/>',
  plus2: '<path d="M12 5.5v13M5.5 12h13"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.9 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H4a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 5.2 7.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1 .9z"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3h2.3l2.5 12.2a1.6 1.6 0 0 0 1.6 1.3h8.6a1.6 1.6 0 0 0 1.6-1.3L21 7H6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5 16.5 16.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M17.9 17.9A10.6 10.6 0 0 1 12 19c-6.4 0-10-7-10-7a18 18 0 0 1 4.1-5M9.9 4.2A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-2.2 3.2M3 3l18 18"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  trash: '<path d="M3.5 6h17M8 6V4h8v2M6.5 6l1 15h9l1-15"/>',
  up: '<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>',
  down: '<path d="M12 5v14M18.5 12.5 12 19l-6.5-6.5"/>',
  swap: '<path d="M7 4v13M7 4 3.5 7.5M7 4l3.5 3.5M17 20V7M17 20l3.5-3.5M17 20l-3.5-3.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  gift: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18"/><path d="M12 8S9.5 3 7.5 4.5 9 8 12 8zM12 8s2.5-5 4.5-3.5S15 8 12 8z"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22z"/><path d="M8 7h8M8 11h6"/>',
  shield: '<path d="M12 2.5 4 6v6c0 5 3.4 8.6 8 9.5 4.6-.9 8-4.5 8-9.5V6z"/><path d="M9 12l2 2 4-4"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.3"/><path d="M12 17h.01"/>',
  star: '<path d="m12 3 2.7 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17.2 6.4 20.3l1.2-6.3L3 9.6l6.3-.8z"/>',
  tag: '<path d="M20.5 13.5 13 21a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 2.4 12V4.4A2 2 0 0 1 4.4 2.4H12a2 2 0 0 1 1.4.6l7.1 7.1a2 2 0 0 1 0 2.8z"/><path d="M7.5 7.5h.01"/>',
  snow: '<path d="M12 2.5v19M20.2 7.2 3.8 16.8M3.8 7.2l16.4 9.6"/>',
};
const svg = (d, w = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

function mark(size = 34) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" style="flex:none">
    <rect width="40" height="40" rx="11" fill="#131C2C"/>
    <path d="M11 9h4.4v22H11z" fill="#10B981"/>
    <path d="M17 20.2 27.5 9H33L22.4 20.2 33 31h-5.6z" fill="#10B981"/>
    <rect x="19" y="15.6" width="12.4" height="8.8" rx="2.2" fill="#EEF2F8" opacity=".95"/>
    <rect x="21" y="18.4" width="3.4" height="2.6" rx=".7" fill="#131C2C" opacity=".6"/>
  </svg>`;
}

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
const shortDate = v => {
  const d = new Date(v);
  return isNaN(d) ? '—' : d.toLocaleDateString('ar-LY', { day: 'numeric', month: 'long' });
};
const dt = v => {
  if (!v) return '—';
  const d = v.toDate ? v.toDate() : new Date(v);
  return isNaN(d) ? '—' : d.toLocaleDateString('ar-LY', { day: '2-digit', month: 'short' })
    + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

function sortByDate(rows, key = 'created_at') {
  return rows.sort((a, b) => {
    const av = a[key]?.toDate?.() || new Date(a[key] || 0);
    const bv = b[key]?.toDate?.() || new Date(b[key] || 0);
    return bv - av;
  });
}

const setHTML = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; };
const onTap = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };

let _invTimer = null, _invPoll = null;

function countTo(el, target, fmt = usd, ms = 700) {
  if (!el) return;
  const from = parseFloat(el.dataset.v || 0);
  el.dataset.v = target;
  if (Math.abs(target - from) < 0.005) { el.textContent = fmt(target); return; }
  const t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (target - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = (kind === 'ok' ? svg(I.check, 2.4) : kind === 'bad' ? svg(I.clock, 2.2) : '')
    + `<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    el.style.transition = '.26s';
    setTimeout(() => el.remove(), 270);
  }, 3600);
}

function sheet(h) {
  $('#sheet').innerHTML = h;
  $('#ov').classList.add('show');
}
window.closeSheet = () => {
  if (_invTimer) { clearInterval(_invTimer); _invTimer = null; }
  if (_invPoll) { clearInterval(_invPoll); _invPoll = null; }
  const ov = $('#ov');
  if (!ov.classList.contains('show')) return;
  ov.classList.add('closing');
  setTimeout(() => { ov.classList.remove('show', 'closing'); }, 240);
};
$('#ov').addEventListener('click', e => { if (e.target.id === 'ov') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); toast(label + ' نُسخ', 'ok'); }
  catch { toast('تعذّر النسخ', 'bad'); }
}

/* ═══ API ═══ */
async function api(path, body) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify(body || {}),
  });
  const d = await res.json().catch(() => ({ success: false, error: 'رد غير مفهوم' }));
  if (!d.success) throw new Error(d.error || 'فشلت العملية');
  return d;
}
async function apiGet(path) {
  const res = await fetch(API_BASE + path);
  const d = await res.json();
  if (!d.success) throw new Error(d.error || 'خطأ');
  return d;
}

/* ═══ Firebase ═══ */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ═══ Theme ═══ */
function applyTheme() {
  const t = S.config.theme;
  if (!t) return;
  const r = document.documentElement.style;
  const dark = c => {
    const m = /^#([\da-f]{6})$/i.exec(c || '');
    if (!m) return null;
    const v = parseInt(m[1], 16), d = x => Math.max(0, Math.round(x * .85));
    return '#' + [d(v >> 16 & 255), d(v >> 8 & 255), d(v & 255)]
      .map(x => x.toString(16).padStart(2, '0')).join('');
  };
  if (t.emerald) {
    r.setProperty('--g', t.emerald);
    const d = dark(t.emerald);
    if (d) r.setProperty('--g-d', d);
  }
}

/* ═══ Boot ═══ */
setHTML('#railMark', mark(34));
setHTML('#barMark', mark(30));
setHTML('#cartIco', svg(I.cart, 1.9));
setHTML('#railOut', svg(I.out) + '<span>تسجيل الخروج</span>');
onTap('#cartBtn', () => cartSheet());
onTap('#homeBtn', () => go('home'));
onTap('#railOut', () => askOut());

window.askOut = () => sheet(`
  <div class="h2" style="margin-bottom:8px">تسجيل الخروج</div>
  <p class="sub" style="margin-bottom:20px">ستحتاج للدخول مرة أخرى للوصول إلى حسابك.</p>
  <button class="btn ghost wide" onclick="doOut()">تسجيل الخروج</button>
  <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">إلغاء</button>`);
window.doOut = async () => { closeSheet(); await signOut(auth); location.replace('login.html'); };

window.addEventListener('error', e => {
  const v = document.getElementById('view');
  if (!v) return;
  document.getElementById('app').style.display = 'block';
  v.innerHTML = `<div class="note bad" style="margin-top:18px">
    <strong>حدث خطأ في الصفحة</strong><br>
    <span style="word-break:break-all">${String(e.message || '')}</span></div>`;
});

onAuthStateChanged(auth, async user => {
  S.unsub.forEach(u => { try { u(); } catch {} });
  S.unsub = [];
  dropLazy(null);
  if (!user) { location.replace('login.html'); return; }
  S.user = user;
  await ensureProfile(user);
  subscribe(user.uid);

  try {
    const c = JSON.parse(localStorage.getItem('kardo_cfg') || 'null');
    if (c && c.methods) S.config = { ...S.config, ...c };
  } catch {}

  apiGet('/api/status').then(d => {
    S.config = { ...S.config, ...d };
    try { localStorage.setItem('kardo_cfg', JSON.stringify(d)); } catch {}
    applyTheme();
    buildNav();
    render();
  }).catch(() => {});

  api('/api/activity/ping', {}).catch(() => {});
  loadCatalog();
  boot();
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
        wallet_balance: 0,
        total_spent: 0,
        cards_count: 0,
        banned: false,
        created_at: new Date().toISOString(),
      }, { merge: true });
    }
  } catch {}
}

function subscribe(uid) {
  S.unsub.push(onSnapshot(doc(db, 'users', uid), s => {
    if (s.exists()) S.profile = { ...S.profile, ...s.data() };
    render();
  }, () => {}));

  // البطاقات اليدوية
  S.unsub.push(onSnapshot(query(collection(db, 'manual_cards'),
    where('uid', '==', uid), limit(50)),
    s => {
      S.manualCards = sortByDate(s.docs.map(d => ({ id: d.id, ...d.data() })));
      render();
    },
    e => { S.dataErr.cards = e.code; render(); }));

  // الطلبات
  S.unsub.push(onSnapshot(query(collection(db, 'orders'),
    where('uid', '==', uid), limit(50)),
    s => {
      S.shopOrders = sortByDate(s.docs.map(d => ({ id: d.id, ...d.data() })));
      render();
    },
    e => { S.dataErr.orders = e.code; render(); }));
}

/* Lazy listeners */
const _lazy = {};
function lazySub(key, build) {
  if (_lazy[key]) return;
  _lazy[key] = onSnapshot(build(), snap => {
    const rows = sortByDate(snap.docs.map(d => ({ id: d.id, ...d.data() })),
      key === 'tickets' ? 'updated_at' : 'created_at');
    if (key === 'orders') S.orders = rows;
    if (key === 'deposits') S.deposits = rows;
    if (key === 'shop') S.shopOrders = rows;
    if (key === 'tickets') S.tickets = rows;
    if (key === 'mc1') S.manualCards = rows;
    if (key === 'mc2') S.manualOrders = sortByDate(rows);
    if (key === 'withdrawals') S.withdrawals = rows;
    S.dataErr[key] = null;
    render();
  }, e => { S.dataErr[key] = e.code; render(); });
}
function dropLazy(except) {
  Object.keys(_lazy).forEach(k => {
    if (k !== except && _lazy[k]) { try { _lazy[k](); } catch {} delete _lazy[k]; }
  });
}
function ensurePageData() {
  const uid = S.user && S.user.uid;
  if (!uid) return;
  if (S.page === 'orders') {
    lazySub('shop', () => query(collection(db, 'orders'),
      where('uid', '==', uid), limit(50)));
    dropLazy('shop');
  } else if (S.page === 'wallet') {
    lazySub('deposits', () => query(collection(db, 'wallet_deposits'),
      where('uid', '==', uid), limit(40)));
    lazySub('withdrawals', () => query(collection(db, 'withdrawals'),
      where('uid', '==', uid), limit(20)));
  } else if (S.page === 'mcards') {
    lazySub('mc1', () => query(collection(db, 'manual_cards'),
      where('uid', '==', uid), limit(30)));
    lazySub('mc2', () => query(collection(db, 'manual_card_orders'),
      where('uid', '==', uid), limit(50)));
  } else if (S.page === 'tickets') {
    lazySub('tickets', () => query(collection(db, 'tickets'),
      where('uid', '==', uid), limit(30)));
    dropLazy('tickets');
  } else if (S.page === 'tx') {
    lazySub('orders', () => query(collection(db, 'orders'),
      where('uid', '==', uid), limit(60)));
    lazySub('deposits', () => query(collection(db, 'wallet_deposits'),
      where('uid', '==', uid), limit(40)));
  } else dropLazy(null);
}

function boot() {
  $('#app').style.display = 'block';
  applyTheme();
  buildNav();
  render();
  setTimeout(resumeInvoice, 600);
}

/* ═══ Navigation ═══ */
const PAGES = [
  { k: 'home',    t: 'الرئيسية',      i: I.home },
  { k: 'shop',    t: 'الأقسام',       i: I.grid },
  { k: 'orders',  t: 'طلباتي',        i: I.bag },
  { k: 'wallet',  t: 'المحفظة',       i: I.wallet },
  { k: 'mcards',  t: 'بطاقاتي',       i: I.card },
  { k: 'tx',      t: 'المعاملات',     i: I.list },
  { k: 'invite',  t: 'ادعُ صديقًا',   i: I.gift },
  { k: 'guide',   t: 'كيف أستخدمها',  i: I.book },
  { k: 'tickets', t: 'الدعم',         i: I.help },
  { k: 'account', t: 'حسابي',         i: I.user },
];
const DOCK = ['home', 'shop', 'orders', 'wallet', 'account'];
const visible = () => PAGES.filter(p => (S.config.nav || {})[p.k] !== false);

function buildNav() {
  const vis = visible(), keys = vis.map(p => p.k);
  setHTML('#navRail', vis.map(p =>
    `<button class="nav" data-nav="${p.k}">${svg(p.i)}<span>${p.t}</span>
     ${p.k === 'orders' && pendCount() ? `<span class="cnt">${pendCount()}</span>` : ''}
     </button>`).join(''));

  const dk = DOCK.filter(k => keys.includes(k));
  const nd = $('#navDock');
  if (nd) {
    nd.style.gridTemplateColumns = `repeat(${dk.length},1fr)`;
    nd.innerHTML = dk.map(k => {
      const p = PAGES.find(x => x.k === k);
      return `<button class="dk" data-nav="${p.k}">
        <span class="dkico">${svg(p.i)}</span><span>${p.t}</span></button>`;
    }).join('');
  }
  if (keys.length && !keys.includes(S.page)) S.page = keys[0];
  $$('[data-nav]').forEach(b =>
    b.onclick = () => b.dataset.nav === 'more' ? moreSheet() : go(b.dataset.nav));
}

const pendCount = () => S.shopOrders.filter(o => o.status === 'pending').length;

function moreSheet() {
  const keys = visible().map(p => p.k);
  const inDock = ['home', 'shop', 'orders', 'wallet'];
  const rest = PAGES.filter(p => keys.includes(p.k) && !inDock.includes(p.k));
  sheet(`
    <div class="h2" style="margin-bottom:16px">المزيد</div>
    <nav class="menu">
      ${rest.map((p, i) => `
        <button class="mrow" style="animation-delay:${i * .04}s" data-more="${p.k}">
          <span class="mrow-i">${svg(p.i)}</span>
          <span class="mrow-t">${p.t}</span>
          <span class="mrow-x">${svg(I.back, 2)}</span>
        </button>`).join('')}
      <button class="mrow danger" style="animation-delay:${rest.length * .04}s" id="mOut">
        <span class="mrow-i">${svg(I.out)}</span>
        <span class="mrow-t">تسجيل الخروج</span>
      </button>
    </nav>`);
  $$('[data-more]').forEach(b => b.onclick = () => { closeSheet(); go(b.dataset.more); });
  onTap('#mOut', () => { closeSheet(); askOut(); });
}

window.go = k => {
  S.page = k;
  S.cat = null;
  S.q = '';
  ensurePageData();
  window.scrollTo({ top: 0, behavior: 'instant' });
  render();
};

/* ═══ Render ═══ */
let _raf = null, _last = null;
function render() {
  if (_raf) return;
  _raf = requestAnimationFrame(() => { _raf = null; paint(); });
}

function paint() {
  const el = $('#av');
  if (el) el.textContent = (S.profile.name || '؟').trim().charAt(0);
  const rn = $('#railName');
  if (rn) rn.textContent = S.profile.name || '—';
  countTo($('#railBal'), S.profile.wallet_balance);

  const cb = $('#cartBadge');
  if (cb) { const c = cartCount(); cb.textContent = c; cb.hidden = c === 0; }

  $$('[data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === S.page));

  const view = $('#view');
  if (!view) return;

  if (S.config.kill_switch === true) {
    view.classList.remove('anim');
    view.innerHTML = killScreen();
    _last = null;
    return;
  }

  const errs = Object.values(S.dataErr || {}).filter(Boolean);
  const errBar = errs.length ? `<div class="note bad" style="margin-bottom:14px">
    <strong>تعذّر تحميل بعض البيانات</strong><br>
    ${errs[0] === 'permission-denied'
      ? 'صلاحيات ناقصة — تواصل مع الدعم.'
      : 'أعد تحميل الصفحة، وإن تكرّر تواصل مع الدعم.'}
  </div>` : '';

  const V = {
    home: vHome, shop: (S.cat ? vCat : vShop),
    orders: vOrders, wallet: vWallet,
    mcards: vMcards, tx: vTx,
    invite: vInvite, guide: vGuide,
    account: vAccount, tickets: vTickets,
  };
  const moved = _last !== S.page + (S.cat || '');
  view.classList.toggle('anim', moved);
  view.innerHTML = errBar + (V[S.page] || vHome)();
  _last = S.page + (S.cat || '');
  bind();
  bindTilt();
}

function killScreen() {
  return `<div class="card" style="margin-top:20px"><div class="empty">
    <div class="ei" style="background:var(--bad-soft);color:var(--bad)">
      ${svg(I.clock, 1.6)}</div>
    <div class="et">الخدمة متوقفة مؤقتًا</div>
    <p style="font-size:13.5px;max-width:320px;margin:0 auto">
      ${esc(S.config.kill_message || 'نعمل على صيانة سريعة. عد بعد قليل.')}</p>
  </div></div>`;
}

/* ═══ Home ═══ */
function vHome() {
  const b = (S.config.banners || []).filter(x => x && x.img);
  const T = S.config.texts || {};
  const roots = kidsOf('').filter(c => !hideSubs(c));
  const top = S.catalog.products.filter(p => p.featured).slice(0, 5);
  const deals = S.catalog.products.filter(p => offPct(p) > 0);
  const recent = S.shopOrders.slice(0, 3);
  const mcOn = (S.config.manual_cards || {}).on;

  return `
  ${b.length ? `
    <section class="bnr">
      <div class="bnr-track" id="bTrack">
        ${b.map(x => `
          <div class="bnr-slide"${x.link ? ` data-blink="${esc(x.link)}"` : ''}>
            <img src="${esc(x.img)}" alt="${esc(x.title || '')}" loading="lazy" decoding="async">
            ${x.title ? `<div class="bnr-body">
              <div class="bnr-t">${esc(x.title)}</div>
              ${x.sub ? `<div class="bnr-s">${esc(x.sub)}</div>` : ''}
              <span class="bnr-cta">تسوّق الآن</span>
            </div>` : ''}
          </div>`).join('')}
      </div>
      ${b.length > 1 ? `<div class="bnr-dots" id="bDots">
        ${b.map((_, i) => `<span class="${i ? '' : 'on'}"></span>`).join('')}</div>` : ''}
    </section>` : ''}

  <div class="wallet">
    <div class="wallet-top">
      <div>
        <div class="eyebrow">رصيد المحفظة</div>
        <div class="wallet-bal num" id="hBal">${lyd(S.profile.wallet_balance * rate())}</div>
        <div class="wallet-sub">${usd(S.profile.wallet_balance)}</div>
      </div>
      <div class="wallet-ico">${svg(I.wallet, 1.9)}</div>
    </div>
    <div class="wacts">
      ${[['deposit', I.up, 'إضافة رصيد', true],
         ['withdraw', I.down, 'سحب', (S.config.withdraw || {}).on],
         ['transfer', I.swap, 'تحويل', (S.config.transfer || {}).on],
         ['points', I.star, 'نقاطي', (S.config.points || {}).on]]
        .map(([k, ic, t, on]) => `
          <button class="wact ${k === 'deposit' ? 'pri' : ''} ${on ? '' : 'off'}"
                  data-wact="${k}">
            <span class="wact-i">${svg(ic, 2)}</span>
            <span>${t}</span></button>`).join('')}
    </div>
  </div>

  <div class="quick">
    <button class="qbtn pri" data-act="shop">
      <span class="qi">${svg(I.grid, 1.9)}</span>
      <span><span class="qt">تسوّق</span><br><span class="qs">كل الخدمات</span></span>
    </button>
    <button class="qbtn" data-act="orders">
      <span class="qi">${svg(I.bag, 1.9)}</span>
      <span><span class="qt">طلباتي</span><br><span class="qs">${
        pendCount() ? pendCount() + ' قيد التنفيذ' : 'السجل'}</span></span>
    </button>
  </div>

  ${mcOn ? `
    <div class="sec-head">
      <div class="h2">البطاقات الافتراضية</div>
      <button class="more-link" data-act="mcards">عرض الكل</button>
    </div>
    ${S.manualCards.length
      ? `<div class="crail">${S.manualCards.slice(0, 4).map(cardHtml).join('')}</div>`
      : `<div class="card" style="margin-bottom:22px">
          <div class="empty" style="padding:26px 16px">
            <div class="ei">${svg(I.card, 1.6)}</div>
            <div class="et" style="font-size:14px">${esc(T.hero_title || 'أصدر بطاقتك الأولى')}</div>
            <p style="font-size:12.5px;margin-bottom:16px">
              ${esc(T.hero_sub || 'بطاقة تعمل في كل مكان يقبل الدفع الإلكتروني.')}</p>
            <button class="btn" data-act="mcards">إصدار بطاقة</button>
          </div>
        </div>`}
  ` : ''}

  ${roots.length ? `
    <div class="sec-head">
      <div class="h2">الأقسام</div>
      ${roots.length > 10 ? `<button class="more-link" data-act="shop">عرض المزيد</button>` : ''}
    </div>
    <div class="catrail">
      ${roots.slice(0, 10).map(c => catTile(c)).join('')}
      ${roots.length > 10 ? `
        <button class="cat more" data-act="shop">
          <span class="cat-i">${svg(I.more, 2)}</span>
          <span class="cat-n">عرض المزيد</span>
          <span class="cat-s">${roots.length - 10} قسم</span>
        </button>` : ''}
    </div>` : ''}

  ${deals.length ? `
    <div class="sec-head">
      <div class="h2">${libIcon('fire', 2)} العروض</div>
    </div>
    <div class="plist">${deals.slice(0, 4).map(prodRow).join('')}</div>` : ''}

  ${top.length ? `
    <div class="sec-head">
      <div class="h2">الأكثر طلبًا</div>
      <button class="more-link" data-act="shop">عرض الكل</button>
    </div>
    <div class="plist">${top.map(prodRow).join('')}</div>` : ''}

  ${recent.length ? `
    <div class="sec-head">
      <div class="h2">آخر الطلبات</div>
      <button class="more-link" data-act="orders">عرض الكل</button>
    </div>
    <div class="list">${recent.map(orderRow).join('')}</div>` : ''}

  ${!roots.length && !top.length && !mcOn ? `
    <div class="card" style="margin-top:16px"><div class="empty">
      <div class="ei">${svg(I.grid, 1.6)}</div>
      <div class="et">${esc(T.hero_title || 'المتجر قيد التجهيز')}</div>
      <p style="font-size:13px">${esc(T.hero_sub || 'سنضيف الخدمات قريبًا.')}</p>
    </div></div>` : ''}`;
}

/* ═══ البطاقات اليدوية ═══ */
function cardHtml(c) {
  const cls = c.status === 'frozen' ? 'frozen' : c.status === 'deleted' ? 'dead' : '';
  const bal = c.balance || 0;
  const st = { active: ['ok', 'نشطة'], frozen: ['off', 'مجمدة'], deleted: ['bad', 'مغلقة'] }[c.status] || ['off', '—'];
  return `<div>
    <div class="vcard ${cls}" data-card="${esc(c.id)}">
      <div class="vc-top">
        <span class="vc-wm">Kardo</span>
        <span class="chip ${st[0]}">${st[1]}</span>
      </div>
      <div class="vc-chip"></div>
      <div class="vc-pan mono">•••• •••• •••• ${esc(c.last4 || '0000')}</div>
      <div class="vc-foot">
        <div>
          <div class="vc-thru">HOLDER</div>
          <div class="mono" style="font-size:11px">${esc((c.name_on_card || '').slice(0, 16))}</div>
        </div>
        <div class="vc-amt num">${usd(bal)}</div>
      </div>
    </div>
    <div style="padding:10px 3px 0">
      <div style="font-weight:700;font-size:14px">${esc(c.card_name || 'بطاقة')}</div>
      <div class="row-s">${dt(c.created_at)}</div>
    </div></div>`;
}

function vMcards() {
  const mc = S.config.manual_cards || {};
  if (mc.on === false) {
    return `<div class="h1" style="margin-bottom:18px">البطاقات</div>
      <div class="card"><div class="empty">
        <div class="ei">${svg(I.card, 1.6)}</div>
        <div class="et">الخدمة متوقفة مؤقتًا</div>
        <p style="font-size:13px">${esc(S.config.maintenance_message || 'سنعيد التشغيل قريبًا.')}</p>
      </div></div>`;
  }

  const active = S.manualCards.filter(c => c.status === 'active');
  const pend = S.manualOrders.filter(o => o.status === 'pending');
  const recent = S.manualOrders.filter(o => o.status !== 'pending').slice(0, 20);
  const mcst = { pending: ['wait', 'قيد التنفيذ'], completed: ['ok', 'مكتملة'], rejected: ['bad', 'مرفوضة'] };

  return `
  <div class="h1" style="margin-bottom:5px">البطاقات</div>
  <p class="sub" style="margin-bottom:18px">بطاقات افتراضية بالدولار — تُصدر خلال دقائق.</p>

  <button class="btn wide" id="newMc" style="margin-bottom:16px">
    ${svg(I.plus2, 2.1)} إصدار بطاقة جديدة
  </button>

  ${pend.length ? `
    <div class="sec-head"><div class="h2">قيد التنفيذ</div></div>
    <div class="list" style="margin-bottom:16px">
      ${pend.map(o => `
        <div class="row">
          <div class="row-i">${svg(I.clock)}</div>
          <div class="row-b">
            <div class="row-t">${o.kind === 'topup' ? 'شحن بطاقة' : 'بطاقة جديدة'}</div>
            <div class="row-s">${dt(o.created_at)}</div>
          </div>
          <div class="num" style="font-size:14px">${usd(o.total)}</div>
        </div>`).join('')}
    </div>` : ''}

  ${active.length ? `
    <div class="sec-head"><div class="h2">بطاقاتي (${active.length})</div></div>
    <div class="mclist">
      ${active.map(c => `
        <button class="mccard" data-mc="${esc(c.id)}">
          <div class="mctop">
            <span class="mcwm">Kardo</span>
            <span class="chip ok">نشطة</span>
          </div>
          <div class="mcname">${esc(c.card_name || 'بطاقتي')}</div>
          <div class="mcpan mono">•••• •••• •••• ${esc(c.last4 || '0000')}</div>
          <div class="mcbal num">${usd(c.balance)}</div>
        </button>`).join('')}
    </div>`
    : !pend.length ? `
      <div class="card"><div class="empty">
        <div class="ei">${svg(I.card, 1.6)}</div>
        <div class="et">لا بطاقات بعد</div>
        <p style="font-size:13px">أصدر بطاقتك الافتراضية الأولى — تُسلَّم خلال دقائق.</p>
      </div></div>` : ''}

  ${recent.length ? `
    <div class="sec-head"><div class="h2">سجل الطلبات</div></div>
    <div class="list">
      ${recent.map(o => {
        const st = mcst[o.status] || ['off', '—'];
        return `<div class="row">
          <div class="row-i">${svg(o.kind === 'topup' ? I.plus : I.card)}</div>
          <div class="row-b">
            <div class="row-t">${o.kind === 'topup' ? 'شحن ' + esc(o.card_name || '') : esc(o.card_name || 'بطاقة جديدة')}</div>
            <div class="row-s">${dt(o.created_at)}
              ${o.reject_reason ? ` · <span style="color:var(--bad)">${esc(o.reject_reason)}</span>` : ''}</div>
          </div>
          <div class="row-v">
            <div class="row-a num">${usd(o.total)}</div>
            <span class="chip ${st[0]}" style="margin-top:3px">${st[1]}</span>
          </div>
        </div>`;
      }).join('')}
    </div>` : ''}`;
}

/* ═══ الشيتات — البطاقات اليدوية ═══ */
function mcRequestSheet(topupCard) {
  const mc = S.config.manual_cards || {};
  const isTopup = !!topupCard;
  const mn = isTopup ? (mc.topup_min || 10) : (mc.create_min || 10);
  const mx = isTopup ? (mc.topup_max || 500) : (mc.create_max || 500);
  const ff = isTopup ? (mc.topup_fee_fixed || 8) : (mc.create_fee_fixed || 8);
  const fp = isTopup ? (mc.topup_fee_pct || 2.5) : (mc.create_fee_pct || 2.5);

  sheet(`
    <div class="h2" style="margin-bottom:4px">${isTopup ? 'شحن البطاقة' : 'بطاقة جديدة'}</div>
    <p class="sub" style="margin-bottom:16px">
      ${isTopup ? `${esc(topupCard.card_name || 'بطاقة')} · ••${esc(topupCard.last4)}`
                : 'بطاقة افتراضية بالدولار — تُصدر خلال دقائق'}</p>

    ${!isTopup ? `
      <label class="lbl">اسم البطاقة (اختياري)</label>
      <input class="inp" id="mcLabel" placeholder="بطاقة الاشتراكات" maxlength="40">

      <label class="lbl" style="margin-top:13px">الاسم على البطاقة — بالإنجليزية</label>
      <input class="inp mono" id="mcName" placeholder="MANSOUR ALI" dir="ltr"
             style="text-transform:uppercase" maxlength="24">
      <p class="sub" style="font-size:11.5px;margin-top:6px">
        حروف لاتينية فقط. يظهر على البطاقة ولا يمكن تغييره.</p>
    ` : ''}

    <label class="lbl" style="margin-top:13px">المبلغ بالدولار — من ${mn} إلى ${mx}</label>
    <input class="inp num" id="mcAmt" type="number" step="0.5" min="${mn}" max="${mx}"
           placeholder="${mn}">

    <div class="amts" style="margin-top:10px">
      ${[10, 20, 50, 100].filter(v => v >= mn && v <= mx).map(v =>
        `<button class="amt" data-mcamt="${v}">$${v}</button>`).join('')}
    </div>

    <div id="mcQ"></div>

    <button class="btn lg wide" id="mcGo" style="margin-top:16px" disabled>
      ${isTopup ? 'شحن البطاقة' : 'إصدار البطاقة'}</button>
    <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">إلغاء</button>`);

  const round2 = v => Math.round(v * 100) / 100;

  const calc = () => {
    const a = n($('#mcAmt').value);
    const box = $('#mcQ'), btn = $('#mcGo');
    if (!(a >= mn && a <= mx)) { box.innerHTML = ''; btn.disabled = true; return; }
    const fee = round2(ff + a * fp / 100);
    const total = round2(a + fee);
    box.innerHTML = `<div class="quote">
      <div class="qrow"><span class="k">المبلغ</span><span class="num">${usd(a)}</span></div>
      <div class="qrow"><span class="k">رسوم الإصدار</span><span class="num">${usd(fee)}</span></div>
      <div class="qrow tot"><span>الإجمالي</span><span class="num">${usd(total)}</span></div>
    </div>`;
    btn.disabled = (S.profile.wallet_balance || 0) < total;
    if (btn.disabled) box.innerHTML += `<div class="note" style="margin-top:10px">
      رصيدك غير كافٍ — المتاح ${usd(S.profile.wallet_balance)}.</div>`;
  };
  $('#mcAmt').oninput = () => {
    $$('[data-mcamt]').forEach(x => x.classList.remove('on'));
    calc();
  };
  $$('[data-mcamt]').forEach(b => b.onclick = () => {
    $('#mcAmt').value = b.dataset.mcamt;
    $$('[data-mcamt]').forEach(x => x.classList.toggle('on', x === b));
    calc();
  });

  onTap('#mcGo', async () => {
    const btn = $('#mcGo');
    const amount = n($('#mcAmt').value);
    const payload = { amount };

    if (isTopup) {
      payload.card_id = topupCard.id;
    } else {
      const name = ($('#mcName').value || '').trim().toUpperCase();
      if (!/^[A-Z][A-Z .'-]{1,23}$/.test(name)) {
        return toast('اكتب الاسم بحروف لاتينية (حرفان على الأقل)', 'bad');
      }
      payload.name_on_card = name;
      payload.card_name = ($('#mcLabel').value || '').trim() || 'بطاقتي';
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="sk" style="width:80px;height:14px;display:inline-block"></span>';
    try {
      await api(isTopup ? '/api/mcard/topup-request' : '/api/mcard/request', payload);
      closeSheet();
      toast('وصل طلبك — سيُصدر خلال دقائق وتتابعه من هذه الصفحة', 'ok');
      render();
    } catch (e) {
      toast(e.message, 'bad');
      btn.disabled = false;
      btn.textContent = isTopup ? 'شحن البطاقة' : 'إصدار البطاقة';
    }
  });
}

function mcCardSheet(id) {
  const c = S.manualCards.find(x => x.id === id);
  if (!c) return;
  const orders = S.manualOrders.filter(o => o.card_id === id && o.status === 'completed');
  const lastOrder = orders[0];

  sheet(`
    <div style="max-width:280px;margin:0 auto 18px">
      ${cardHtml(c)}
    </div>

    <div id="mcSec">
      ${lastOrder
        ? `<button class="btn line wide" id="mcRev">
            ${svg(I.eye)} عرض بيانات البطاقة</button>`
        : `<div class="note">لم تُسلَّم بيانات هذه البطاقة بعد.</div>`}
    </div>

    <button class="btn wide" style="margin-top:9px" id="mcTop">
      ${svg(I.plus2, 2.1)} شحن البطاقة</button>
    <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">إغلاق</button>`);

  onTap('#mcTop', () => mcRequestSheet(c));

  onTap('#mcRev', async () => {
    if (!lastOrder) return;
    const box = $('#mcSec');
    box.innerHTML = '<div class="sk" style="height:120px"></div>';
    try {
      const d = await api('/api/mcard/reveal', { order_id: lastOrder.id });
      const grp = v => String(v).replace(/(.{4})/g, '$1 ').trim();
      const left = Math.max(0, new Date(d.expires_at) - Date.now());
      const hrs = Math.floor(left / 3600000);

      box.innerHTML = `<div class="card-q">
        <div class="cprow" style="margin-bottom:8px" data-cp="${esc(d.card_number)}" data-lb="رقم البطاقة">
          <div style="min-width:0">
            <div class="cpk">رقم البطاقة</div>
            <div class="cpv mono" dir="ltr">${grp(d.card_number)}</div>
          </div>
          <span class="cpi">${svg(I.copy, 2)}</span>
        </div>
        <div class="cprow" style="margin-bottom:8px" data-cp="${esc(d.expiry)}" data-lb="تاريخ الانتهاء">
          <div style="min-width:0">
            <div class="cpk">تاريخ الانتهاء</div>
            <div class="cpv mono" dir="ltr">${esc(d.expiry)}</div>
          </div>
          <span class="cpi">${svg(I.copy, 2)}</span>
        </div>
        <div class="cprow" data-cp="${esc(d.cvv)}" data-lb="CVV">
          <div style="min-width:0">
            <div class="cpk">CVV</div>
            <div class="cpv mono" dir="ltr">${esc(d.cvv)}</div>
          </div>
          <span class="cpi">${svg(I.copy, 2)}</span>
        </div>
      </div>
      <div class="note" style="margin-top:10px">
        احفظ هذه البيانات الآن — تختفي خلال ${hrs} ساعة ولن تظهر مجددًا هنا.</div>`;

      box.querySelectorAll('[data-cp]').forEach(b =>
        b.onclick = () => copy(b.dataset.cp, b.dataset.lb));
    } catch (e) {
      box.innerHTML = `<div class="note bad">${esc(e.message)}</div>`;
    }
  });
}
window.mcCardSheet = mcCardSheet;

/* ═══ Shop ═══ */
const kidsOf = id => S.catalog.categories.filter(c => (c.parent || '') === (id || ''));
const prodsOf = id => S.catalog.products.filter(p => p.cat === id);
function trailOf(id) {
  const out = []; let cur = S.catalog.categories.find(c => c.id === id);
  while (cur) { out.unshift(cur); cur = S.catalog.categories.find(c => c.id === cur.parent); }
  return out;
}
function deepCount(id) {
  let t = prodsOf(id).length;
  for (const k of kidsOf(id)) t += deepCount(k.id);
  return t;
}
const cartCount = () => S.cart.reduce((t, i) => t + i.qty, 0);
const cartTotal = () => S.cart.reduce((t, i) => t + i.price_lyd * i.qty, 0);
const offPct = p => p.old_price > p.price ? Math.round((1 - p.price / p.old_price) * 100) : 0;
const hideSubs = c => S.config.subscriptions_visible === false && /اشتراك/.test(c.name || '');

function loadCatalog() {
  apiGet('/api/catalog').then(d => {
    S.catalog = { categories: d.categories || [], products: d.products || [] };
    render();
  }).catch(() => {});
}

function catTile(c, big) {
  const cnt = deepCount(c.id);
  const subs = kidsOf(c.id).length;
  return `<button class="cat ${c.soon ? 'soon' : ''} ${big ? 'big' : ''}" data-cat="${esc(c.id)}">
    ${c.soon ? '<span class="soonbadge">قريبًا</span>' : ''}
    <span class="cat-i">${c.image
      ? `<img src="${esc(c.image)}" alt="" loading="lazy">`
      : libIcon(c.icon, 1.7)}</span>
    <span class="cat-n">${esc(c.name)}</span>
    <span class="cat-s">${c.soon ? 'قيد التجهيز'
      : subs ? subs + ' قسم · ' + cnt + ' منتج' : cnt + ' منتج'}</span>
  </button>`;
}

const CD = { upcoming: ['wait', 'لم يبدأ'], active: ['ok', 'متاح'], expired: ['bad', 'منتهي'] };

function prodRow(p) {
  const off = offPct(p);
  const c = p.countdown;
  return `<button class="prod ${p.available ? '' : 'out'}" data-prod="${esc(p.id)}">
    <span class="prod-i">${p.image
      ? `<img src="${esc(p.image)}" alt="" loading="lazy">`
      : svg(I.bag, 1.6)}</span>
    <span class="prod-b">
      <span class="prod-n">${esc(p.name)}</span>
      <span class="prod-s">${c
        ? (c.state === 'active'
            ? `<span class="cdchip">${svg(I.clock, 2.2)} ${c.days_left} يوم متبقٍ</span>`
            : c.state === 'upcoming' ? 'يبدأ ' + shortDate(c.starts_at) : 'انتهت المدة')
        : (p.kind === 'stock' ? 'تسليم فوري' : 'تنفيذ يدوي')}</span>
      <span class="prod-prow">
        <span class="prod-p num">${c && c.state === 'expired' ? '—' : lyd(p.price)}</span>
        ${off ? `<span class="prod-old num">${lyd(p.old_price)}</span>` : ''}
        ${c && c.state === 'active' ? `<span class="perday num">${lyd(c.per_day)}/يوم</span>` : ''}
      </span>
    </span>
    ${off && !c ? `<span class="offbadge">−${off}٪</span>` : ''}
    ${p.available
      ? `<span class="prod-a">${svg(I.plus2, 2.2)}</span>`
      : `<span class="chip bad">نفد</span>`}
  </button>`;
}

const LIB = {
  fire: { n: 'نار', d: '<path d="M12 22c4.4 0 7-2.9 7-6.6 0-3.6-2.4-5.6-3.6-8.6-.5-1.2-2.1-1.3-2.7-.2-.8 1.5-.5 3.2-1.5 4.3-.7.8-1.6.2-1.6-.8 0-1.2.4-2-.3-3.1-.5-.8-1.7-.7-2.2.1C5.9 9.2 5 11.6 5 14.6 5 19 8 22 12 22z"/>' },
  gift: { n: 'هدية', d: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18"/><path d="M12 8S9.5 3 7.5 4.5 9 8 12 8zM12 8s2.5-5 4.5-3.5S15 8 12 8z"/>' },
  play: { n: 'ألعاب', d: '<rect x="2" y="6" width="20" height="12" rx="4"/><path d="M7 12h3M8.5 10.5v3M15 11h.01M17.5 13h.01"/>' },
  tv: { n: 'اشتراكات', d: '<rect x="2.5" y="4" width="19" height="13" rx="2.5"/><path d="M8 21h8M12 17v4"/>' },
  music: { n: 'موسيقى', d: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>' },
  card: { n: 'بطاقات', d: '<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/>' },
  phone: { n: 'شحن رصيد', d: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>' },
  cloud: { n: 'خدمات', d: '<path d="M17.5 19a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6 1.5A3.8 3.8 0 0 0 7 19z"/>' },
  bolt: { n: 'سريع', d: '<path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z"/>' },
  shop: { n: 'متجر', d: '<path d="M3.5 8h17l-1 12.5a1.5 1.5 0 0 1-1.5 1.4H6a1.5 1.5 0 0 1-1.5-1.4z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/>' },
  crown: { n: 'مميّز', d: '<path d="M3 8l3.5 3L12 4l5.5 7L21 8l-2 11H5z"/>' },
  globe: { n: 'عالمي', d: '<circle cx="12" cy="12" r="9"/><path d="M3.5 9h17M3.5 15h17M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>' },
  book: { n: 'تعليم', d: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22z"/><path d="M8 7h8M8 11h6"/>' },
  shield: { n: 'حماية', d: '<path d="M12 2.5 4 6v6c0 5 3.4 8.6 8 9.5 4.6-.9 8-4.5 8-9.5V6z"/><path d="M9 12l2 2 4-4"/>' },
  wallet: { n: 'محفظة', d: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5z"/><path d="M16.5 12h1.5"/>' },
  grid: { n: 'عام', d: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>' },
};
const libIcon = (k, w = 1.8) => svg((LIB[k] || LIB.grid).d, w);

function vShop() {
  const roots = kidsOf('').filter(c => !hideSubs(c));
  const q = S.q.trim().toLowerCase();
  const hits = q ? S.catalog.products.filter(p => p.name.toLowerCase().includes(q)) : [];

  return `
  <div class="h1" style="margin-bottom:5px">الأقسام</div>
  <p class="sub" style="margin-bottom:16px">اختر القسم أو ابحث عن منتج.</p>

  <div class="search">
    ${svg(I.search, 2)}
    <input class="inp" id="shopQ" placeholder="ابحث عن منتج…" value="${esc(S.q)}">
  </div>

  ${q ? (hits.length
      ? `<div class="plist">${hits.map(prodRow).join('')}</div>`
      : `<div class="card"><div class="empty">
          <div class="ei">${svg(I.search, 1.6)}</div>
          <p style="font-size:13.5px">لا نتائج لـ«${esc(S.q)}»</p></div></div>`)
    : (roots.length
      ? `<div class="catgrid2">${roots.map(c => catTile(c, true)).join('')}</div>`
      : `<div class="card"><div class="empty">
          <div class="ei">${svg(I.grid, 1.6)}</div>
          <p style="font-size:13.5px">لا أقسام بعد.</p></div></div>`)}`;
}

function vCat() {
  const c = S.catalog.categories.find(x => x.id === S.cat);
  if (!c) return vShop();

  const trail = trailOf(c.id);
  const subs = kidsOf(c.id);
  let items = prodsOf(c.id);

  const q = S.q.trim().toLowerCase();
  if (q) items = items.filter(p => p.name.toLowerCase().includes(q));
  if (S.filter === 'stock') items = items.filter(p => p.kind === 'stock');
  if (S.filter === 'manual') items = items.filter(p => p.kind !== 'stock');
  if (S.filter === 'off') items = items.filter(p => offPct(p) > 0);

  return `
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
    <button class="iconbtn" data-back="1">${svg(I.next, 2.2)}</button>
    <div class="h1" style="margin:0">${esc(c.name)}</div>
  </div>

  <div class="crumbs">
    <button data-cat="">الأقسام</button>
    ${trail.map((t, i) => `<span>${svg(I.back, 2.4)}</span>
      ${i === trail.length - 1
        ? `<b>${esc(t.name)}</b>`
        : `<button data-cat="${esc(t.id)}">${esc(t.name)}</button>`}`).join('')}
  </div>

  ${subs.length ? `<div class="catgrid2" style="margin-bottom:18px">
    ${subs.map(x => catTile(x, true)).join('')}
  </div>` : ''}

  ${prodsOf(c.id).length ? `
    ${subs.length ? `<div class="sec-head"><div class="h2">منتجات ${esc(c.name)}</div></div>` : ''}
    <div class="search">
      ${svg(I.search, 2)}
      <input class="inp" id="shopQ" placeholder="ابحث في القسم…" value="${esc(S.q)}">
    </div>
    <div class="pills">
      ${[['all', 'الكل'], ['off', 'عروض'], ['stock', 'تسليم فوري'], ['manual', 'تنفيذ يدوي']]
        .map(([k, t]) => `<button class="pill ${S.filter === k ? 'on' : ''}" data-filter="${k}">${t}</button>`).join('')}
    </div>
    ${items.length
      ? `<div class="plist">${items.map(prodRow).join('')}</div>`
      : `<div class="card"><div class="empty">
          <div class="ei">${svg(I.bag, 1.6)}</div>
          <p style="font-size:13.5px">لا منتجات مطابقة.</p></div></div>`}`
    : (subs.length ? '' : `<div class="card"><div class="empty">
        <div class="ei">${svg(I.bag, 1.6)}</div>
        <p style="font-size:13.5px">هذا القسم فارغ حاليًا.</p></div></div>`)}`;
}

function soonSheet(c) {
  sheet(`
    <div style="text-align:center;margin-bottom:20px">
      <div style="width:64px;height:64px;border-radius:20px;margin:0 auto 15px;
           display:grid;place-items:center;background:var(--g-soft);color:var(--g)">
        ${svg(I.clock, 2.1).replace('<svg', '<svg data-lg')}</div>
      <div class="h2">${esc(c.name)}</div>
      <p class="sub" style="margin-top:6px;max-width:300px;margin-inline:auto">
        نجهّز هذا القسم الآن. سيفتح قريبًا وستكون من أوائل من يستخدمه.</p>
    </div>
    <button class="btn line wide" onclick="closeSheet()">حسنًا</button>`);
}

function cdBox(c) {
  if (c.state === 'upcoming') return `<div class="note" style="margin-bottom:14px">
    هذا الاشتراك يبدأ ${shortDate(c.starts_at)} — يمكنك شراؤه الآن بالسعر الكامل.</div>`;
  if (c.state === 'expired') return `<div class="note bad" style="margin-bottom:14px">
    انتهت مدة هذا الاشتراك في ${shortDate(c.ends_at)}.</div>`;

  const pct = Math.round(c.days_left / c.total_days * 100);
  return `
  <div class="cdcard">
    <div class="cdtop">
      <div>
        <div class="eyebrow">المتبقي من المدة</div>
        <div class="cddays num">${c.days_left}<span> يوم</span></div>
      </div>
      <div class="cdicon">${svg(I.clock, 1.9)}</div>
    </div>
    <div class="cdbar"><i style="width:${pct}%"></i></div>
    <div class="cdrow">
      <span>ينتهي ${shortDate(c.ends_at)}</span>
      <span>${c.days_left} من ${c.total_days} يوم</span>
    </div>
    <div class="cdcalc">
      <span class="num">${lyd(c.per_day)}</span> لليوم
      <span style="color:var(--tx-3)">×</span>
      <span class="num">${c.days_left}</span> يوم
      <span style="color:var(--tx-3)">=</span>
      <span class="num" style="color:var(--g)">${lyd(c.price)}</span>
    </div>
  </div>`;
}

function productSheet(id) {
  const p = S.catalog.products.find(x => x.id === id);
  if (!p) return;
  let qty = 1;
  const bal = S.profile.wallet_balance * rate();

  sheet(`
    <div class="sheet-head">
      <div class="prod-i" style="width:72px;height:72px;border-radius:15px">
        ${p.image ? `<img src="${esc(p.image)}" alt="">` : svg(I.bag, 1.5)}</div>
      <div style="min-width:0;flex:1">
        <div class="h2">${esc(p.name)}</div>
        <div class="num" style="color:var(--g);font-size:19px;margin-top:2px">${lyd(p.price)}</div>
        <span class="chip ${p.kind === 'stock' ? 'ok' : 'wait'}" style="margin-top:6px">
          ${p.kind === 'stock' ? 'تسليم فوري' : 'تنفيذ خلال ساعات'}</span>
      </div>
    </div>

    ${p.countdown ? cdBox(p.countdown) : ''}

    ${p.desc ? `<div class="card-q" style="margin-bottom:14px">
      <div class="eyebrow" style="margin-bottom:7px">معلومات المنتج</div>
      <p class="sub" style="font-size:13px;line-height:1.75;white-space:pre-line">${esc(p.desc)}</p>
    </div>` : ''}

    ${p.fields.map(f => `
      <label class="lbl" style="margin-top:12px">${esc(f.label)}${
        f.required ? '' : ' <span style="color:var(--tx-3);font-weight:400">(اختياري)</span>'}</label>
      <input class="inp ${f.type === 'number' || f.type === 'tel' ? 'num' : ''}"
             data-pf="${esc(f.key)}" type="${f.type}"
             ${f.type === 'number' || f.type === 'tel' ? 'inputmode="numeric"' : ''}
             placeholder="${esc(f.hint || '')}">`).join('')}

    <div style="display:flex;align-items:center;gap:12px;margin-top:18px">
      <div class="qty">
        <button data-q="-">−</button>
        <span class="num" id="pQty">1</span>
        <button data-q="+">+</button>
      </div>
      <div style="flex:1">
        <div class="cpk">الإجمالي</div>
        <div class="num" id="pTot" style="font-size:18px">${lyd(p.price)}</div>
      </div>
    </div>

    <div class="quote">
      <div class="qrow"><span class="k">رصيد محفظتك</span>
        <span class="num">${lyd(bal)}</span></div>
      <div class="qrow"><span class="k">بعد الشراء</span>
        <span class="num" id="pAfter">${lyd(bal - p.price)}</span></div>
    </div>

    ${p.note ? `<div class="note" style="margin-top:12px">${esc(p.note)}</div>` : ''}

    <button class="btn lg wide" id="pAdd" style="margin-top:16px" ${p.available ? '' : 'disabled'}>
      ${p.available ? 'إضافة إلى السلة'
        : p.countdown && p.countdown.state === 'expired' ? 'انتهت المدة'
        : p.countdown && p.countdown.state === 'upcoming' ? 'لم يبدأ بعد' : 'غير متوفر'}</button>
    <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">إلغاء</button>`);

  const paint = () => {
    $('#pQty').textContent = qty;
    $('#pTot').textContent = lyd(p.price * qty);
    const after = bal - p.price * qty;
    const el = $('#pAfter');
    el.textContent = lyd(after);
    el.style.color = after < 0 ? 'var(--bad)' : '';
  };
  $$('[data-q]').forEach(b => b.onclick = () => {
    qty = Math.max(1, Math.min(20, qty + (b.dataset.q === '+' ? 1 : -1)));
    paint();
  });

  onTap('#pAdd', () => {
    const vals = {};
    for (const f of p.fields) {
      const el = document.querySelector(`[data-pf="${f.key}"]`);
      const v = (el && el.value || '').trim();
      if (f.required && !v) { el.classList.add('bad'); return toast(f.label + ' مطلوب', 'bad'); }
      if (v) vals[f.key] = v;
    }
    S.cart.push({ id: p.id, name: p.name, image: p.image, price_lyd: p.price,
      qty, values: vals, kind: p.kind });
    closeSheet();
    toast('أُضيف إلى السلة', 'ok');
    render();
  });
}

function cartSheet() {
  if (!S.cart.length) return sheet(`
    <div class="h2" style="margin-bottom:8px">السلة</div>
    <div class="empty"><div class="ei">${svg(I.cart, 1.6)}</div>
      <p style="font-size:13.5px">سلتك فارغة.</p></div>
    <button class="btn line wide" onclick="closeSheet()">حسنًا</button>`);

  const tot = cartTotal();
  const off = S.coupon ? S.coupon.off_lyd : 0;
  const totUsd = (tot - off) / rate();
  const ok = (S.profile.wallet_balance || 0) >= totUsd;

  sheet(`
    <div class="sheet-head" style="margin-bottom:14px;padding-bottom:12px">
      <div class="row-i" style="background:var(--g-soft);color:var(--g)">
        ${svg(I.cart, 2)}</div>
      <div style="flex:1"><div class="h2">السلة</div>
        <div class="row-s">${cartCount()} منتج</div></div>
    </div>

    <div style="display:flex;flex-direction:column;gap:9px;margin-bottom:14px">
      ${S.cart.map((it, i) => `
        <div class="citem">
          <div class="citem-i">${it.image
            ? `<img src="${esc(it.image)}" alt="">` : svg(I.bag, 1.6)}</div>
          <div style="flex:1;min-width:0">
            <div class="citem-n">${esc(it.name)}</div>
            <div class="row-s">${lyd(it.price_lyd)} للوحدة</div>
            <div class="citem-q">
              <button data-cq="${i}:-">−</button>
              <span class="num">${it.qty}</span>
              <button data-cq="${i}:+">+</button>
            </div>
          </div>
          <div style="text-align:start;flex:none">
            <div class="num" style="font-size:15px;color:var(--g)">${lyd(it.price_lyd * it.qty)}</div>
            <button class="citem-x" data-rm="${i}" aria-label="حذف">${svg(I.trash, 2)}</button>
          </div>
        </div>`).join('')}
    </div>

    ${S.config.coupons_on !== false ? `
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <input class="inp mono" id="cpIn" placeholder="كود الخصم" dir="ltr"
               style="text-transform:uppercase;flex:1"
               value="${esc(S.coupon ? S.coupon.code : '')}">
        <button class="btn ghost" id="cpGo" style="flex:none">تطبيق</button>
      </div>` : ''}

    <div class="quote" style="margin-top:0">
      <div class="qrow"><span class="k">عدد المنتجات</span>
        <span class="num">${cartCount()}</span></div>
      ${S.coupon ? `<div class="qrow"><span class="k">خصم ${esc(S.coupon.code)}</span>
        <span class="num" style="color:var(--g)">−${lyd(S.coupon.off_lyd)}</span></div>` : ''}
      <div class="qrow"><span class="k">رصيدك</span>
        <span class="num">${lyd(S.profile.wallet_balance * rate())}</span></div>
      <div class="qrow tot"><span>الإجمالي</span>
        <span class="num">${lyd(tot - (S.coupon ? S.coupon.off_lyd : 0))}</span></div>
    </div>

    ${ok ? '' : `<div class="note" style="margin-top:12px">
      رصيدك غير كافٍ — تحتاج ${lyd((totUsd - S.profile.wallet_balance) * rate())} إضافية.
      <button style="color:var(--g);font-weight:800"
        onclick="closeSheet();depositSheet()">إضافة رصيد</button></div>`}

    <button class="btn lg wide" id="cPay" style="margin-top:16px" ${ok ? '' : 'disabled'}>
      تأكيد الشراء</button>
    <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">متابعة التسوق</button>`);

  $$('[data-rm]').forEach(b => b.onclick = () => {
    S.cart.splice(+b.dataset.rm, 1); S.coupon = null; cartSheet(); render();
  });
  $$('[data-cq]').forEach(b => b.onclick = () => {
    const [i, op] = b.dataset.cq.split(':');
    const it = S.cart[+i]; if (!it) return;
    it.qty = Math.max(1, Math.min(20, it.qty + (op === '+' ? 1 : -1)));
    S.coupon = null; cartSheet(); render();
  });

  onTap('#cpGo', async () => {
    const code = $('#cpIn').value.trim().toUpperCase();
    if (!code) { S.coupon = null; return cartSheet(); }
    const b = $('#cpGo'); b.disabled = true;
    try {
      const r = await api('/api/coupon/check', { code, subtotal_lyd: cartTotal() });
      S.coupon = r.coupon;
      toast('طُبّق الخصم ' + lyd(r.coupon.off_lyd), 'ok');
      cartSheet();
    } catch (e) { S.coupon = null; toast(e.message, 'bad'); b.disabled = false; }
  });

  onTap('#cPay', async () => {
    const b = $('#cPay');
    b.disabled = true;
    b.innerHTML = '<span class="sk" style="width:80px;height:14px;display:inline-block"></span>';
    try {
      const r = await api('/api/store/order', {
        items: S.cart.map(i => ({ id: i.id, qty: i.qty, values: i.values })),
        coupon: S.coupon ? S.coupon.code : '',
        idempotency_key: crypto.randomUUID ? crypto.randomUUID() : 'o' + Date.now() + Math.random(),
      });
      S.cart = []; S.coupon = null;
      closeSheet();
      orderDone(r.order);
      render();
    } catch (e) {
      toast(e.message, 'bad');
      b.disabled = false;
      b.textContent = 'تأكيد الشراء';
    }
  });
}

function orderDone(o) {
  const codes = (o.items || []).filter(i => i.codes && i.codes.length);
  sheet(`
    <div style="text-align:center;margin-bottom:20px">
      <div style="width:62px;height:62px;border-radius:19px;margin:0 auto 15px;
           display:grid;place-items:center;
           background:${o.status === 'completed' ? 'var(--g-soft)' : 'var(--warn-soft)'};
           color:${o.status === 'completed' ? 'var(--g)' : 'var(--warn)'}">
        ${svg(o.status === 'completed' ? I.check : I.clock, 2.3).replace('<svg', '<svg data-lg')}</div>
      <div class="h2">${o.status === 'completed' ? 'تم الطلب' : 'طلبك قيد التنفيذ'}</div>
      <p class="sub" style="margin-top:5px">
        ${o.status === 'completed' ? 'استلم منتجاتك أدناه.'
          : 'ننفّذه خلال وقت قصير، وتتابع حالته من طلباتي.'}</p>
    </div>
    ${codes.length ? `<div class="card-q" style="margin-bottom:14px">
      ${codes.map(i => i.codes.map(c => `
        <div class="cprow" style="margin-bottom:8px">
          <div style="min-width:0"><div class="cpk">${esc(i.name)}</div>
            <div class="cpv mono" dir="ltr">${esc(c)}</div></div>
          <button class="cpi" data-cpc="${esc(c)}">${svg(I.copy, 2)}</button>
        </div>`).join('')).join('')}
    </div>` : ''}
    <button class="btn wide" onclick="closeSheet();go('orders')">عرض طلباتي</button>
    <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">حسنًا</button>`);
  $$('[data-cpc]').forEach(b => b.onclick = () => copy(b.dataset.cpc, 'الكود'));
}

/* ═══ Orders ═══ */
const OST = {
  completed: ['ok', 'مكتملة'], pending: ['wait', 'قيد التنفيذ'],
  processing: ['wait', 'قيد المعالجة'], rejected: ['bad', 'ملغية'],
};

function orderRow(o) {
  const st = OST[o.status] || ['off', '—'];
  const c = (o.items || []).length;
  return `<div class="row" data-order="${esc(o.id)}">
    <div class="row-i">${(o.items && o.items[0] && o.items[0].image)
      ? `<img src="${esc(o.items[0].image)}" alt="">` : svg(I.bag)}</div>
    <div class="row-b">
      <div class="row-t">${esc((o.items && o.items[0] && o.items[0].name) || 'طلب')}${
        c > 1 ? ` +${c - 1}` : ''}</div>
      <div class="row-s">${dt(o.created_at)}</div>
    </div>
    <div class="row-v">
      <div class="row-a num">${lyd(o.total_lyd)}</div>
      <span class="chip ${st[0]}" style="margin-top:3px">${st[1]}</span>
    </div></div>`;
}

function vOrders() {
  const F = [['all', 'الكل'], ['pending', 'قيد التنفيذ'],
             ['completed', 'مكتملة'], ['rejected', 'ملغية']];
  let rows = S.shopOrders;
  if (S.filter !== 'all') rows = rows.filter(o => o.status === S.filter);

  return `
  <div class="h1" style="margin-bottom:5px">طلباتي</div>
  <p class="sub" style="margin-bottom:14px">حالة كل طلب ومنتجاته.</p>

  <div class="pills">
    ${F.map(([k, t]) => `<button class="pill ${S.filter === k ? 'on' : ''}"
      data-filter="${k}">${t}</button>`).join('')}
  </div>

  ${rows.length
    ? `<div class="list">${rows.map(orderRow).join('')}</div>`
    : `<div class="card"><div class="empty">
        <div class="ei">${svg(I.bag, 1.6)}</div>
        <div class="et">لا طلبات بهذا التصنيف</div>
        <p style="font-size:13px;margin-bottom:16px">تصفّح الأقسام وابدأ أول طلب.</p>
        <button class="btn" data-act="shop">تصفّح المتجر</button></div></div>`}`;
}

function orderSheet(id) {
  const o = S.shopOrders.find(x => x.id === id);
  if (!o) return;
  const st = OST[o.status] || ['off', '—'];
  sheet(`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;
         gap:11px;margin-bottom:16px">
      <div><div class="h2">طلب ${esc(String(id).slice(-8))}</div>
        <div class="row-s">${dt(o.created_at)}</div></div>
      <span class="chip ${st[0]}">${st[1]}</span>
    </div>

    <div class="list" style="margin-bottom:14px">
      ${(o.items || []).map(i => `
        <div class="row">
          <div class="row-i">${i.image
            ? `<img src="${esc(i.image)}" alt="">` : svg(I.bag)}</div>
          <div class="row-b">
            <div class="row-t">${esc(i.name)}</div>
            <div class="row-s">${i.qty} × ${lyd(i.price_lyd)}</div>
            ${i.values && Object.keys(i.values).length
              ? `<div class="row-s mono" dir="ltr" style="opacity:.85">
                 ${Object.values(i.values).map(esc).join(' · ')}</div>` : ''}
          </div>
          <div class="num" style="font-size:13.5px">${lyd(i.line_lyd)}</div>
        </div>`).join('')}
    </div>

    ${(o.items || []).some(i => i.codes && i.codes.length) ? `
      <div class="lbl">الأكواد المسلّمة</div>
      ${(o.items || []).flatMap(i => (i.codes || []).map(c => `
        <div class="cprow" style="margin-bottom:8px">
          <div style="min-width:0"><div class="cpk">${esc(i.name)}</div>
            <div class="cpv mono" dir="ltr">${esc(c)}</div></div>
          <button class="cpi" data-cpc="${esc(c)}">${svg(I.copy, 2)}</button>
        </div>`)).join('')}` : ''}

    ${o.delivery ? `<div class="lbl" style="margin-top:8px">ملاحظة التنفيذ</div>
      <div class="card-q"><p class="sub" style="font-size:13px;white-space:pre-line">${esc(o.delivery)}</p></div>` : ''}

    ${o.reject_reason ? `<div class="note bad" style="margin-top:12px">
      ${esc(o.reject_reason)} — أُعيد المبلغ إلى محفظتك.</div>` : ''}

    <div class="quote">
      <div class="qrow tot"><span>الإجمالي</span>
        <span class="num">${lyd(o.total_lyd)}</span></div>
    </div>

    <button class="btn line wide" style="margin-top:14px" onclick="closeSheet()">إغلاق</button>`);
  $$('[data-cpc]').forEach(b => b.onclick = () => copy(b.dataset.cpc, 'الكود'));
}
window.orderSheet = orderSheet;

/* ═══ Wallet ═══ */
const DST = {
  approved: ['ok', 'مقبول'], pending: ['wait', 'قيد المراجعة'],
  rejected: ['bad', 'مرفوض'],
};

function vWallet() {
  const inSum = S.deposits.filter(d => d.status === 'approved')
    .reduce((t, d) => t + n(d.amount_usd), 0);
  const outSum = n(S.profile.total_spent);

  return `
  <div class="wallet">
    <div class="wallet-top">
      <div>
        <div class="eyebrow">الرصيد المتاح</div>
        <div class="wallet-bal num">${lyd(S.profile.wallet_balance * rate())}</div>
        <div class="wallet-sub">${usd(S.profile.wallet_balance)}</div>
      </div>
      <div class="wallet-ico">${svg(I.wallet, 1.9)}</div>
    </div>
    <div class="wacts">
      ${[['deposit', I.up, 'إضافة رصيد', true],
         ['withdraw', I.down, 'سحب', (S.config.withdraw || {}).on],
         ['transfer', I.swap, 'تحويل', (S.config.transfer || {}).on],
         ['points', I.star, 'نقاطي', (S.config.points || {}).on]]
        .map(([k, ic, t, on]) => `
          <button class="wact ${k === 'deposit' ? 'pri' : ''} ${on ? '' : 'off'}"
                  data-wact="${k}">
            <span class="wact-i">${svg(ic, 2)}</span>
            <span>${t}</span></button>`).join('')}
    </div>
  </div>

  <div class="stats">
    <div class="stat"><div class="v num">${lyd(inSum * rate())}</div>
      <div class="k">إجمالي الإيداعات</div></div>
    <div class="stat"><div class="v num">${lyd(outSum * rate())}</div>
      <div class="k">إجمالي المصروفات</div></div>
    <div class="stat"><div class="v num">${S.deposits.length}</div>
      <div class="k">عملية</div></div>
  </div>

  ${S.withdrawals.length ? `
    <div class="sec-head"><div class="h2">طلبات السحب</div></div>
    <div class="list" style="margin-bottom:6px">
      ${S.withdrawals.map(w => {
        const st = { completed: ['ok', 'نُفّذ'], pending: ['wait', 'قيد التنفيذ'],
          rejected: ['bad', 'مرفوض'] }[w.status] || ['off', '—'];
        return `<div class="row">
          <div class="row-i">${svg(I.down)}</div>
          <div class="row-b">
            <div class="row-t num">${usd(w.amount_usd)}
              <span style="font-weight:400;color:var(--tx-3);font-size:12px"> · ${esc(w.method || '')}</span></div>
            <div class="row-s">${dt(w.created_at)}${
              w.reject_reason ? ` · <span style="color:var(--bad)">${esc(w.reject_reason)}</span>` : ''}</div>
          </div>
          <span class="chip ${st[0]}">${st[1]}</span></div>`;
      }).join('')}
    </div>` : ''}

  <div class="sec-head"><div class="h2">سجل الإيداعات</div></div>
  ${S.deposits.length ? `<div class="list">${S.deposits.map(d => {
    const st = DST[d.status] || ['off', '—'];
    return `<div class="row">
      <div class="row-i" ${d.status === 'approved'
        ? 'style="color:var(--g);background:var(--g-soft)"' : ''}>${svg(I.up)}</div>
      <div class="row-b">
        <div class="row-t num">${lyd(n(d.amount_usd) * rate())}
          <span style="font-weight:400;color:var(--tx-3);font-size:12px"> · ${esc(d.method || '—')}</span></div>
        <div class="row-s">${dt(d.created_at)}${
          d.reject_reason ? ` · <span style="color:var(--bad)">${esc(d.reject_reason)}</span>` : ''}</div>
      </div>
      <span class="chip ${st[0]}">${st[1]}</span></div>`;
  }).join('')}</div>`
   : `<div class="card"><div class="empty">
      <div class="ei">${svg(I.wallet, 1.6)}</div>
      <div class="et">لا إيداعات بعد</div>
      <p style="font-size:13px;margin-bottom:16px">أضف رصيدًا لتبدأ الشراء.</p>
      <button class="btn" data-act="deposit">إضافة رصيد</button></div></div>`}`;
}

/* ═══ Deposit ═══ */
function depositSheet() {
  const M = S.config.methods || {};
  const order = String(S.config.method_order || 'libyana,almadar,usdt,bank,binance')
    .split(',').map(x => x.trim()).filter(Boolean);
  const all = Object.keys(M);
  const seq = [...order.filter(k => all.includes(k)), ...all.filter(k => !order.includes(k))];
  const list = seq.map(k => ({ k, ...(M[k] || {}) })).filter(m => m.on);

  if (!list.length) return sheet(`
    <div class="h2" style="margin-bottom:10px">إضافة رصيد</div>
    <div class="note">طرق الدفع متوقفة مؤقتًا — تواصل مع الدعم.</div>
    <button class="btn line wide" onclick="closeSheet()">حسنًا</button>`);

  if (list.length === 1) return methodSheet(list[0].k);

  sheet(`
    <div class="h2" style="margin-bottom:4px">إضافة رصيد</div>
    <p class="sub" style="margin-bottom:16px">اختر طريقة التحويل.</p>
    <div class="menu">
      ${list.map((m, i) => `
        <button class="mrow" style="animation-delay:${i * .04}s" data-pick="${m.k}">
          <span class="mrow-i" style="overflow:hidden">${m.logo
            ? `<img src="${esc(m.logo)}" alt="" style="width:100%;height:100%;object-fit:cover">`
            : svg(I.wallet)}</span>
          <span style="flex:1;min-width:0;text-align:start">
            <span class="mrow-t" style="display:block">${esc(m.label || m.k)}</span>
            <span style="font-size:11px;color:var(--tx-3)">${m.auto ? 'يُضاف فورًا' : 'مراجعة يدوية'}</span>
          </span>
          <span class="chip ${m.auto ? 'ok' : 'off'}">${m.auto ? 'تلقائي' : 'يدوي'}</span>
        </button>`).join('')}
    </div>
    <button class="btn line wide" style="margin-top:14px" onclick="closeSheet()">إلغاء</button>`);

  $$('[data-pick]').forEach(b => b.onclick = () => methodSheet(b.dataset.pick));
}

function methodSheet(k) {
  const M = S.config.methods || {};
  const m = M[k] || {};
  if (m.invoice) return usdtSheet(k);

  const auto = !!m.auto;
  const r = m.rate || rate();
  const dp = m.phone || S.config.deposit_phone || '';
  const note = S.config.deposit_note || '';
  const fields = (m.fields || []).filter(f => f && f.value);
  const many = Object.keys(M).filter(x => M[x] && M[x].on).length > 1;
  let proof = null;

  sheet(`
    <div class="sheet-head">
      ${many ? `<button class="iconbtn" id="mBack">${svg(I.next, 2.2)}</button>` : '<span></span>'}
      <div class="row-i" style="width:40px;height:40px;overflow:hidden">
        ${m.logo ? `<img src="${esc(m.logo)}" alt="">` : svg(I.wallet)}</div>
      <div style="min-width:0;flex:1">
        <div class="h2" style="font-size:15.5px">${esc(m.label || k)}</div>
        <div style="font-size:11.5px;color:${auto ? 'var(--g)' : 'var(--tx-3)'}">
          ${auto ? 'يُضاف الرصيد خلال ثوانٍ' : 'نراجع الإيصال ثم نضيف الرصيد'}</div>
      </div>
    </div>

    ${auto && dp ? `
      <div class="cprow" id="cpP" style="margin-bottom:14px">
        <div style="min-width:0">
          <div class="cpk">رقم التحويل — ممنوع الاتصال</div>
          <div class="cpv mono" dir="ltr" style="font-size:19px">${esc(dp)}</div>
        </div>
        <span class="cpi">${svg(I.copy, 2)}</span>
      </div>` : ''}

    ${!auto && fields.length ? `
      <div class="card-q" style="margin-bottom:14px">
        ${fields.map((f, i) => `
          <div class="cprow" style="margin-bottom:${i < fields.length - 1 ? '8px' : '0'};
               ${f.copy ? '' : 'pointer-events:none'}"
               ${f.copy ? `data-cpf="${i}"` : ''}>
            <div style="min-width:0">
              <div class="cpk">${esc(f.label)}</div>
              <div class="cpv ${f.copy ? 'mono' : ''}" ${f.copy ? 'dir="ltr"' : ''}>${esc(f.value)}</div>
            </div>
            ${f.copy ? `<span class="cpi">${svg(I.copy, 2)}</span>` : ''}
          </div>`).join('')}
      </div>` : ''}

    ${note ? `<div class="note">${esc(note)}</div>` : ''}

    ${auto ? `
      <label class="lbl">رقمك الذي حوّلت منه</label>
      <input class="inp num" id="cP" type="tel" inputmode="numeric"
             placeholder="912345678" dir="ltr" maxlength="13"
             value="${esc(S.profile.phone || '')}">
      <p class="sub" style="font-size:12px;margin-top:6px">اكتب رقمك بدون الصفر</p>` : ''}

    <label class="lbl" style="margin-top:${auto ? '16px' : '0'}">
      المبلغ الذي أرسلته (بالدينار)</label>
    <input class="inp num" id="cA" type="number" inputmode="decimal"
           step="0.001" min="1" placeholder="118">

    <div class="amts" style="margin-top:10px">
      ${[50, 100, 200, 500].map(v => `<button class="amt" data-qa="${v}">${v}</button>`).join('')}
    </div>

    ${!auto ? `
      <label class="lbl" style="margin-top:16px">صورة إثبات التحويل</label>
      <label class="cprow" id="dropZone" style="cursor:pointer">
        <input type="file" id="proofFile" accept="image/*" hidden>
        <div id="dropIn" style="flex:1;text-align:center;padding:12px 0">
          ${svg(I.up, 1.7)}
          <div style="font-size:13px;font-weight:700;margin-top:7px">اختر صورة الإيصال</div>
          <div style="font-size:11.5px;color:var(--tx-3);margin-top:2px">
            تُضغط تلقائيًا قبل الإرسال</div>
        </div>
      </label>` : ''}

    <div id="cQ"></div>
    <button class="btn lg wide" id="cG" style="margin-top:16px">تأكيد التحويل</button>
    <p class="sub" style="font-size:11.5px;text-align:center;margin-top:11px">
      ${auto ? 'إن لم تصل رسالة التحويل بعد، يبقى طلبك معلّقًا ويُضاف الرصيد فور وصولها.'
             : 'يظهر الرصيد في محفظتك بعد مراجعة الإيصال.'}</p>
    <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">إلغاء</button>`);

  onTap('#mBack', () => depositSheet());
  onTap('#cpP', () => copy(dp, 'رقم التحويل'));
  $$('[data-cpf]').forEach(b => {
    const f = fields[+b.dataset.cpf];
    if (f) b.onclick = () => copy(f.value, f.label);
  });
  $$('[data-qa]').forEach(b => b.onclick = () => {
    $('#cA').value = b.dataset.qa;
    $$('[data-qa]').forEach(x => x.classList.toggle('on', x === b));
    calc();
  });

  const fileEl = $('#proofFile'), zone = $('#dropZone');
  if (fileEl) fileEl.onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('اختر ملف صورة', 'bad');
    if (f.size > 12 * 1024 * 1024) return toast('الصورة أكبر من 12 ميجابايت', 'bad');
    proof = f;
    zone.style.borderColor = 'var(--g)';
    $('#dropIn').innerHTML = `<img src="${URL.createObjectURL(f)}" alt=""
      style="max-height:130px;border-radius:10px;margin:0 auto">
      <div style="font-size:11.5px;color:var(--g);margin-top:8px;font-weight:700">
        ${esc(f.name.slice(0, 30))} — اضغط للتغيير</div>`;
  };

  function calc() {
    const a = parseFloat($('#cA').value), box = $('#cQ');
    if (!box) return;
    if (!(a > 0)) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="quote">
      <div class="qrow"><span class="k">المبلغ المحوّل</span>
        <span class="num">${lyd(a)}</span></div>
      <div class="qrow"><span class="k">سعر الصرف</span>
        <span class="num">${r} د.ل</span></div>
      <div class="qrow tot"><span>سيُضاف لمحفظتك</span>
        <span class="num">${usd(a / r)}</span></div></div>`;
  }
  $('#cA').oninput = () => { $$('[data-qa]').forEach(x => x.classList.remove('on')); calc(); };

  onTap('#cG', async () => {
    const amt = parseFloat($('#cA').value);
    if (!(amt > 0)) return toast('اكتب المبلغ الذي حوّلته', 'bad');
    const phone = auto ? $('#cP').value.trim() : '';
    if (auto && phone.replace(/\D/g, '').length < 9) return toast('اكتب رقمك كاملاً', 'bad');
    if (!auto && !proof) return toast('أرفق صورة إثبات التحويل', 'bad');

    const btn = $('#cG');
    btn.disabled = true;
    btn.innerHTML = '<span class="sk" style="width:84px;height:14px;display:inline-block"></span>';
    try {
      let proofUrl = '';
      if (!auto && proof) proofUrl = await compressProof(proof);
      const res = auto
        ? await api('/api/wallet/claim', { phone, amount_lyd: amt, method: k })
        : await manualDeposit(k, amt, proofUrl);
      closeSheet();
      depositResult(auto && !!res.matched, amt / r, auto);
      render();
    } catch (e) {
      toast(e.message, 'bad');
      btn.disabled = false;
      btn.textContent = 'تأكيد التحويل';
    }
  });
}

function compressProof(file, maxW = 900, quality = .55) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('تعذّرت قراءة الصورة'));
    r.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('الملف ليس صورة صالحة'));
      img.onload = () => {
        const s = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * s), h = Math.round(img.height * s);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const cx = cv.getContext('2d');
        cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
        cx.drawImage(img, 0, 0, w, h);
        let q = quality, out = cv.toDataURL('image/jpeg', q);
        while (out.length > 700000 && q > .2) { q -= .1; out = cv.toDataURL('image/jpeg', q); }
        if (out.length > 900000) return reject(new Error('الصورة كبيرة جدًا'));
        resolve(out);
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

async function manualDeposit(method, amountLyd, proofUrl) {
  const M = S.config.methods || {};
  const r = (M[method] && M[method].rate) || 1;
  await addDoc(collection(db, 'wallet_deposits'), {
    uid: S.user.uid,
    amount_usd: Math.round((amountLyd / r) * 100) / 100,
    amount_lyd: amountLyd,
    method: (M[method] && M[method].label) || method,
    proof_url: proofUrl || '',
    note: '',
    status: 'pending',
    created_at: new Date().toISOString(),
  });
  return { matched: false };
}

function depositResult(matched, amount, auto = true) {
  const wait = !matched;
  sheet(`
    <div style="text-align:center;margin-bottom:22px">
      <div style="width:62px;height:62px;border-radius:19px;margin:0 auto 15px;
           display:grid;place-items:center;
           background:${wait ? 'var(--warn-soft)' : 'var(--g-soft)'};
           color:${wait ? 'var(--warn)' : 'var(--g)'}">
        ${svg(wait ? I.clock : I.check, 2.3).replace('<svg', '<svg data-lg')}</div>
      <div class="h2">${matched ? 'أُضيف الرصيد' : auto ? 'طلبك قيد الانتظار' : 'وصل إيصالك'}</div>
      <p class="sub" style="margin-top:5px">
        ${matched ? 'أُضيف ' + usd(amount) + ' إلى محفظتك.'
          : auto ? 'لم تصل رسالة التحويل بعد. سيُضاف ' + usd(amount) + ' فور وصولها.'
                 : 'سنراجعه ونضيف ' + usd(amount) + ' إلى محفظتك.'}</p>
    </div>
    ${matched ? `<button class="btn wide" onclick="closeSheet();go('shop')">تسوّق الآن</button>`
     : `<button class="btn wide" onclick="closeSheet();go('wallet')">متابعة الطلب</button>`}
    <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">حسنًا</button>`);
}

/* ═══ USDT Invoice ═══ */
function usdtSheet(k) {
  const m = (S.config.methods || {})[k] || {};
  const mn = m.min || 5, mx = m.max || 1000;
  sheet(`
    <div class="sheet-head">
      <button class="iconbtn" id="mBack">${svg(I.next, 2.2)}</button>
      <div class="row-i" style="width:40px;height:40px;overflow:hidden">
        ${m.logo ? `<img src="${esc(m.logo)}" alt="">` : svg(I.wallet)}</div>
      <div><div class="h2" style="font-size:15.5px">${esc(m.label || 'USDT')}</div>
        <div style="font-size:11.5px;color:var(--g)">يُضاف فور تأكيد الشبكة</div></div>
    </div>
    <div class="note">حوّل على شبكة <strong>TRC20</strong> فقط.
      أي شبكة أخرى تعني ضياع المبلغ.</div>
    <label class="lbl">المبلغ بالدولار — من ${mn} إلى ${mx}</label>
    <input class="inp num" id="uA" type="number" inputmode="decimal"
           step="0.01" min="${mn}" max="${mx}" placeholder="10">
    <p class="sub" style="font-size:12px;margin-top:7px">
      سنعطيك مبلغًا بكسور مميّزة لتمييز تحويلك — حوّله كما هو بالضبط.</p>
    <button class="btn lg wide" id="uGo" style="margin-top:18px">إنشاء فاتورة</button>
    <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">إلغاء</button>`);

  onTap('#mBack', () => depositSheet());
  onTap('#uGo', async () => {
    const a = parseFloat($('#uA').value);
    if (!(a >= mn && a <= mx)) return toast(`المبلغ بين ${mn} و ${mx}`, 'bad');
    const b = $('#uGo');
    b.disabled = true;
    b.innerHTML = '<span class="sk" style="width:80px;height:14px;display:inline-block"></span>';
    try {
      const r = await api('/api/wallet/usdt/invoice', { amount_usd: a });
      invoiceSheet(r.invoice);
    } catch (e) { toast(e.message, 'bad'); b.disabled = false; b.textContent = 'إنشاء فاتورة'; }
  });
}

function invoiceSheet(inv) {
  clearInterval(_invTimer); clearInterval(_invPoll);
  try { localStorage.setItem('kardo_inv', JSON.stringify(inv)); } catch {}

  sheet(`
    <div style="text-align:center;margin-bottom:16px">
      <div class="eyebrow">فاتورة ${esc(String(inv.id).slice(-8))}</div>
      <div id="invClock" class="num"
        style="font-size:13px;color:var(--warn);margin-top:7px"></div>
    </div>

    <div class="cprow" id="cpAmt" style="padding:17px 15px">
      <div style="min-width:0">
        <div class="cpk">المبلغ — انسخه ولا تكتبه</div>
        <div class="num" dir="ltr" style="font-size:30px;line-height:1.15;margin-top:2px">${inv.pay_amount}</div>
        <div class="sub" style="font-size:11.5px;margin-top:3px">USDT</div>
      </div>
      <span class="cpi">${svg(I.copy, 2)}</span>
    </div>

    <div class="cprow" id="cpAdr" style="margin-top:9px">
      <div style="min-width:0">
        <div class="cpk">عنوان الاستقبال</div>
        <div class="cpv mono" dir="ltr" style="font-size:12px">${esc(inv.address)}</div>
      </div>
      <span class="cpi">${svg(I.copy, 2)}</span>
    </div>

    <div class="card-q" style="margin-top:9px;display:flex;justify-content:space-between;align-items:center">
      <div><div class="cpk">الشبكة</div><div class="cpv">TRC20 (Tron)</div></div>
      <span class="chip ok">مطلوبة</span>
    </div>

    <div class="note" style="margin-top:12px">
      انسخ المبلغ كما هو — الكسور تميّز تحويلك وتُضاف لرصيدك كاملة.</div>

    <div id="invMsg"></div>
    <div class="autochk"><i></i> نتابع الشبكة تلقائيًا…</div>
    <button class="btn wide" id="uChk" style="margin-top:10px">تحققت من التحويل</button>
    <button class="btn line wide" style="margin-top:9px" onclick="closeInvoice()">إغلاق</button>`);

  const done = r => {
    clearInterval(_invTimer); clearInterval(_invPoll);
    try { localStorage.removeItem('kardo_inv'); } catch {}
    closeSheet();
    depositResult(true, r.credited || inv.amount_usd);
    render();
  };

  onTap('#cpAmt', () => copy(String(inv.pay_amount), 'المبلغ'));
  onTap('#cpAdr', () => copy(inv.address, 'العنوان'));

  const tick = () => {
    const left = inv.expires_ms - Date.now();
    const el = $('#invClock');
    if (!el) { clearInterval(_invTimer); return; }
    if (left <= 0) {
      el.textContent = 'انتهت المهلة';
      el.style.color = 'var(--bad)';
      const b = $('#uChk'); if (b) { b.disabled = true; b.textContent = 'انتهت المهلة'; }
      clearInterval(_invTimer); clearInterval(_invPoll);
      try { localStorage.removeItem('kardo_inv'); } catch {}
      return;
    }
    const mm = String(Math.floor(left / 60000)).padStart(2, '0');
    const ss = String(Math.floor(left % 60000 / 1000)).padStart(2, '0');
    el.textContent = `تنتهي خلال ${mm}:${ss}`;
  };
  tick();
  _invTimer = setInterval(tick, 1000);

  let busy = false;
  _invPoll = setInterval(async () => {
    if (busy || !$('#uChk')) return;
    busy = true;
    try {
      const r = await api('/api/wallet/usdt/verify', { invoice_id: inv.id });
      if (r.paid) return done(r);
    } catch {}
    busy = false;
  }, 15000);

  onTap('#uChk', async () => {
    const b = $('#uChk'), msg = $('#invMsg');
    b.disabled = true;
    b.innerHTML = '<span class="sk" style="width:90px;height:14px;display:inline-block"></span>';
    msg.innerHTML = '';
    try {
      const r = await api('/api/wallet/usdt/verify', { invoice_id: inv.id });
      if (r.paid) return done(r);
      msg.innerHTML = `<div class="note" style="margin-top:14px">${
        r.duplicate ? 'هذا التحويل مُستخدم بالفعل.'
        : 'لم يصل التحويل بعد. الشبكة تحتاج دقيقة — سنتابع تلقائيًا.'}</div>`;
    } catch (e) {
      msg.innerHTML = `<div class="note bad" style="margin-top:14px">${esc(e.message)}</div>`;
    }
    b.disabled = false;
    b.textContent = 'تحققت من التحويل';
  });
}
window.closeInvoice = () => { clearInterval(_invTimer); clearInterval(_invPoll); closeSheet(); };

function resumeInvoice() {
  let inv = null;
  try { inv = JSON.parse(localStorage.getItem('kardo_inv') || 'null'); } catch {}
  if (!inv || !inv.id) return;
  if (Date.now() >= inv.expires_ms) {
    try { localStorage.removeItem('kardo_inv'); } catch {}
    return;
  }
  invoiceSheet(inv);
}

/* ═══ Withdraw · Transfer · Points ═══ */
function withdrawSheet() {
  const w = S.config.withdraw || {};
  if (!w.on) return sheet(`
    <div class="h2" style="margin-bottom:10px">سحب رصيد</div>
    <div class="note">السحب غير متاح حاليًا.</div>
    <button class="btn line wide" onclick="closeSheet()">حسنًا</button>`);

  const methods = w.methods || ['ليبيانا'];
  sheet(`
    <div class="h2" style="margin-bottom:4px">سحب رصيد</div>
    <p class="sub" style="margin-bottom:16px">
      رصيدك ${lyd(S.profile.wallet_balance * rate())} · الحد ${w.min}$–${w.max}$</p>

    <label class="lbl">طريقة السحب</label>
    <select class="inp" id="wdM">
      ${methods.map(m => `<option>${esc(m)}</option>`).join('')}
    </select>

    <label class="lbl" style="margin-top:14px">الوجهة</label>
    <input class="inp" id="wdD" placeholder="رقم الهاتف أو الحساب أو العنوان" dir="ltr">

    <label class="lbl" style="margin-top:14px">المبلغ بالدولار</label>
    <input class="inp num" id="wdA" type="number" inputmode="decimal"
           step="0.5" min="${w.min}" max="${w.max}" placeholder="${w.min}">

    <div id="wdQ"></div>
    <button class="btn lg wide" id="wdGo" style="margin-top:16px">طلب السحب</button>
    <p class="sub" style="font-size:11.5px;text-align:center;margin-top:11px">
      يُخصم المبلغ فورًا ويُحجز حتى التنفيذ. وإن رُفض الطلب يعود كاملًا.</p>
    <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">إلغاء</button>`);

  const calc = () => {
    const a = parseFloat($('#wdA').value), box = $('#wdQ');
    if (!(a > 0)) { box.innerHTML = ''; return; }
    const fee = n(w.fee_fixed) + a * n(w.fee_pct) / 100;
    const net = a - fee;
    box.innerHTML = `<div class="quote">
      <div class="qrow"><span class="k">المبلغ</span><span class="num">${usd(a)}</span></div>
      <div class="qrow"><span class="k">الرسوم</span><span class="num">${usd(fee)}</span></div>
      <div class="qrow tot"><span>ستستلم</span>
        <span class="num" style="color:${net > 0 ? 'var(--g)' : 'var(--bad)'}">${usd(net)}</span></div>
    </div>`;
  };
  $('#wdA').oninput = calc;

  onTap('#wdGo', async () => {
    const b = $('#wdGo');
    const a = parseFloat($('#wdA').value);
    const d = $('#wdD').value.trim();
    if (!(a > 0)) return toast('أدخل المبلغ', 'bad');
    if (!d) return toast('أدخل وجهة السحب', 'bad');
    b.disabled = true;
    b.innerHTML = '<span class="sk" style="width:70px;height:14px;display:inline-block"></span>';
    try {
      const r = await api('/api/wallet/withdraw',
        { amount_usd: a, method: $('#wdM').value, destination: d });
      closeSheet();
      sheet(`<div style="text-align:center;margin-bottom:20px">
        <div style="width:62px;height:62px;border-radius:19px;margin:0 auto 15px;
             display:grid;place-items:center;background:var(--warn-soft);color:var(--warn)">
          ${svg(I.clock, 2.3).replace('<svg', '<svg data-lg')}</div>
        <div class="h2">وصل طلب السحب</div>
        <p class="sub" style="margin-top:5px">سننفّذه قريبًا وستستلم ${usd(r.net)}.</p></div>
        <button class="btn wide" onclick="closeSheet();go('wallet')">متابعة الطلب</button>`);
      render();
    } catch (e) { toast(e.message, 'bad'); b.disabled = false; b.textContent = 'طلب السحب'; }
  });
}

function transferSheet() {
  const t = S.config.transfer || {};
  if (!t.on) return sheet(`
    <div class="h2" style="margin-bottom:10px">تحويل رصيد</div>
    <div class="note">التحويل غير متاح حاليًا.</div>
    <button class="btn line wide" onclick="closeSheet()">حسنًا</button>`);

  sheet(`
    <div class="h2" style="margin-bottom:4px">تحويل رصيد</div>
    <p class="sub" style="margin-bottom:16px">أرسل رصيدًا لمستخدم آخر في كاردو فورًا.</p>

    <label class="lbl">المستلم</label>
    <input class="inp" id="trTo" placeholder="بريده أو رقم هاتفه" dir="ltr">

    <label class="lbl" style="margin-top:14px">المبلغ بالدولار</label>
    <input class="inp num" id="trA" type="number" inputmode="decimal"
           step="0.5" min="${t.min}" placeholder="${t.min}">

    <div id="trQ"></div>
    <button class="btn lg wide" id="trGo" style="margin-top:16px">تحويل</button>
    <p class="sub" style="font-size:11.5px;text-align:center;margin-top:11px">
      تأكد من بيانات المستلم — التحويل فوري ولا يمكن التراجع عنه.</p>
    <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">إلغاء</button>`);

  const calc = () => {
    const a = parseFloat($('#trA').value), box = $('#trQ');
    if (!(a > 0)) { box.innerHTML = ''; return; }
    const fee = a * n(t.fee_pct) / 100;
    box.innerHTML = `<div class="quote">
      <div class="qrow"><span class="k">يصل المستلم</span><span class="num">${usd(a)}</span></div>
      ${fee > 0 ? `<div class="qrow"><span class="k">الرسوم</span><span class="num">${usd(fee)}</span></div>` : ''}
      <div class="qrow tot"><span>يُخصم منك</span><span class="num">${usd(a + fee)}</span></div>
    </div>`;
  };
  $('#trA').oninput = calc;

  onTap('#trGo', async () => {
    const b = $('#trGo');
    const a = parseFloat($('#trA').value), to = $('#trTo').value.trim();
    if (!to) return toast('أدخل بيانات المستلم', 'bad');
    if (!(a > 0)) return toast('أدخل المبلغ', 'bad');
    b.disabled = true;
    b.innerHTML = '<span class="sk" style="width:60px;height:14px;display:inline-block"></span>';
    try {
      const r = await api('/api/wallet/transfer', { to, amount_usd: a });
      closeSheet();
      toast('حُوّل ' + usd(r.amount) + ' بنجاح', 'ok');
      render();
    } catch (e) { toast(e.message, 'bad'); b.disabled = false; b.textContent = 'تحويل'; }
  });
}

function pointsSheet() {
  const p = S.config.points || {};
  const have = n(S.profile.points);
  if (!p.on) return sheet(`
    <div class="h2" style="margin-bottom:10px">النقاط</div>
    <div class="note">نظام النقاط غير مفعّل حاليًا.</div>
    <button class="btn line wide" onclick="closeSheet()">حسنًا</button>`);

  sheet(`
    <div style="text-align:center;margin-bottom:18px">
      <div style="width:60px;height:60px;border-radius:19px;margin:0 auto 13px;
           display:grid;place-items:center;background:var(--g-soft);color:var(--g)">
        ${svg(I.star, 2).replace('<svg', '<svg data-lg')}</div>
      <div class="num" style="font-size:34px">${have.toLocaleString('en-US')}</div>
      <div class="sub">نقطة · تساوي ${lyd(have * n(p.value_lyd))}</div>
    </div>

    <div class="card-q" style="margin-bottom:14px">
      <p class="sub" style="font-size:12.5px;line-height:1.7">
        تكسب ${p.per_lyd} نقطة عن كل دينار تنفقه.
        الحد الأدنى للاستبدال ${p.min_redeem} نقطة.</p>
    </div>

    <label class="lbl">عدد النقاط للاستبدال</label>
    <input class="inp num" id="ptA" type="number" min="${p.min_redeem}"
           max="${have}" placeholder="${p.min_redeem}">
    <div id="ptQ"></div>

    <button class="btn lg wide" id="ptGo" style="margin-top:16px"
      ${have >= n(p.min_redeem) ? '' : 'disabled'}>
      ${have >= n(p.min_redeem) ? 'استبدال' : 'نقاطك غير كافية'}</button>
    <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">إغلاق</button>`);

  $('#ptA').oninput = e => {
    const v = Math.floor(n(e.target.value)), box = $('#ptQ');
    if (!(v > 0)) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="quote">
      <div class="qrow tot"><span>سيُضاف لمحفظتك</span>
        <span class="num">${lyd(v * n(p.value_lyd))}</span></div></div>`;
  };

  onTap('#ptGo', async () => {
    const b = $('#ptGo');
    const v = Math.floor(n($('#ptA').value));
    if (v < n(p.min_redeem)) return toast(`الحد الأدنى ${p.min_redeem} نقطة`, 'bad');
    b.disabled = true;
    try {
      const r = await api('/api/points/redeem', { points: v });
      closeSheet();
      toast('أُضيف ' + usd(r.credited) + ' إلى محفظتك', 'ok');
      render();
    } catch (e) { toast(e.message, 'bad'); b.disabled = false; }
  });
}

/* ═══ Support tickets ═══ */
const TST = {
  open: ['wait', 'مفتوحة'], answered: ['ok', 'تم الرد'],
  closed: ['off', 'مغلقة'],
};

function vTickets() {
  if (!S.config.tickets_on) return `
    <div class="h1" style="margin-bottom:18px">الدعم</div>
    <div class="card"><div class="empty">
      <div class="ei">${svg(I.help, 1.6)}</div>
      <div class="et">غير متاح حاليًا</div></div></div>`;

  const sup = (S.config.texts || {}).support_url || '';
  return `
  <div class="h1" style="margin-bottom:5px">الدعم</div>
  <p class="sub" style="margin-bottom:16px">افتح تذكرة وسنرد عليك هنا.</p>

  <button class="btn wide" id="newTic" style="margin-bottom:16px">
    ${svg(I.plus2, 2.1)} تذكرة جديدة</button>

  ${S.tickets.length ? `<div class="list">${S.tickets.map(t => {
    const st = TST[t.status] || ['off', '—'];
    const last = (t.messages || []).slice(-1)[0];
    return `<div class="row" data-tic="${esc(t.id)}">
      <div class="row-i">${svg(I.help)}</div>
      <div class="row-b">
        <div class="row-t">${esc(t.subject)}</div>
        <div class="row-s">${last ? esc(String(last.text).slice(0, 44)) : ''}</div>
      </div>
      <div class="row-v">
        <span class="chip ${st[0]}">${st[1]}</span>
        <div class="row-s" style="margin-top:3px">${dt(t.updated_at)}</div>
      </div></div>`;
  }).join('')}</div>`
   : `<div class="card"><div class="empty">
      <div class="ei">${svg(I.help, 1.6)}</div>
      <div class="et">لا تذاكر</div>
      <p style="font-size:13px">افتح تذكرة إن واجهت أي مشكلة.</p></div></div>`}

  ${sup ? `<button class="btn line wide" style="margin-top:16px"
    onclick="window.open('${esc(sup.startsWith('http') ? sup : 'https://wa.me/' + sup)}','_blank')">
    أو تواصل عبر واتساب</button>` : ''}`;
}

function newTicketSheet() {
  sheet(`
    <div class="h2" style="margin-bottom:16px">تذكرة جديدة</div>
    <label class="lbl">الموضوع</label>
    <input class="inp" id="tcS" placeholder="مشكلة في طلب" maxlength="120">
    <label class="lbl" style="margin-top:14px">رقم الطلب (اختياري)</label>
    <input class="inp mono" id="tcO" placeholder="ORD…" dir="ltr">
    <label class="lbl" style="margin-top:14px">رسالتك</label>
    <textarea class="inp" id="tcM" rows="5" placeholder="اشرح المشكلة بالتفصيل"></textarea>
    <button class="btn lg wide" id="tcGo" style="margin-top:16px">إرسال</button>
    <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">إلغاء</button>`);

  onTap('#tcGo', async () => {
    const b = $('#tcGo');
    const s = $('#tcS').value.trim(), m = $('#tcM').value.trim();
    if (!s) return toast('اكتب الموضوع', 'bad');
    if (!m) return toast('اكتب رسالتك', 'bad');
    b.disabled = true;
    b.innerHTML = '<span class="sk" style="width:60px;height:14px;display:inline-block"></span>';
    try {
      await api('/api/ticket/create', { subject: s, message: m, order_id: $('#tcO').value.trim() });
      closeSheet();
      toast('أُرسلت التذكرة', 'ok');
      render();
    } catch (e) { toast(e.message, 'bad'); b.disabled = false; b.textContent = 'إرسال'; }
  });
}

function ticketSheet(id) {
  const t = S.tickets.find(x => x.id === id);
  if (!t) return;
  const st = TST[t.status] || ['off', '—'];
  const msgs = t.messages || [];

  sheet(`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;
         gap:11px;margin-bottom:16px">
      <div style="min-width:0"><div class="h2">${esc(t.subject)}</div>
        <div class="row-s">${dt(t.created_at)}</div></div>
      <span class="chip ${st[0]}">${st[1]}</span>
    </div>

    <div style="display:flex;flex-direction:column;gap:9px;margin-bottom:14px">
      ${msgs.map(m => `
        <div style="align-self:${m.by === 'admin' ? 'flex-start' : 'flex-end'};
             max-width:86%;padding:11px 13px;border-radius:14px;
             background:${m.by === 'admin' ? 'var(--s3)' : 'var(--g-soft)'};
             border:1px solid ${m.by === 'admin' ? 'var(--line)' : 'var(--g-line)'}">
          <div style="font-size:10.5px;color:var(--tx-3);margin-bottom:3px">
            ${m.by === 'admin' ? 'الدعم' : 'أنت'} · ${dt(m.at)}</div>
          <div style="font-size:13.5px;line-height:1.65;white-space:pre-line">${esc(m.text)}</div>
        </div>`).join('')}
    </div>

    ${t.status !== 'closed' ? `
      <textarea class="inp" id="tcR" rows="3" placeholder="اكتب ردك…"></textarea>
      <button class="btn wide" id="tcRGo" style="margin-top:10px">إرسال الرد</button>`
     : `<div class="note">هذه التذكرة مغلقة.</div>`}
    <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">إغلاق</button>`);

  onTap('#tcRGo', async () => {
    const b = $('#tcRGo');
    const m = $('#tcR').value.trim();
    if (!m) return toast('اكتب ردك', 'bad');
    b.disabled = true;
    try {
      await api('/api/ticket/reply', { id, message: m });
      closeSheet();
      toast('أُرسل ردك', 'ok');
      render();
    } catch (e) { toast(e.message, 'bad'); b.disabled = false; }
  });
}
window.ticketSheet = ticketSheet;

/* ═══ Transactions ═══ */
const TYPE = { create: 'إصدار بطاقة', fund: 'شحن بطاقة', deposit: 'إيداع رصيد' };
const STAT = {
  completed: ['ok', 'مكتملة'], processing: ['wait', 'قيد المعالجة'],
  refunded: ['bad', 'مستردة'], failed: ['bad', 'فاشلة'],
  pending: ['wait', 'قيد المراجعة'], approved: ['ok', 'مقبول'],
  rejected: ['bad', 'مرفوض'],
};

function vTx() {
  const F = [['all', 'الكل'], ['create', 'إصدار'], ['fund', 'شحن'], ['deposit', 'إيداع']];
  let rows = [...S.orders.map(o => ({ ...o, kind: o.type })),
    ...S.deposits.map(d => ({
      id: d.id, kind: 'deposit', status: d.status,
      amount: d.amount_usd, customer_price: d.amount_usd, created_at: d.created_at,
    }))].sort((a, b) => {
    const av = a.created_at?.toDate?.() || new Date(a.created_at || 0);
    const bv = b.created_at?.toDate?.() || new Date(b.created_at || 0);
    return bv - av;
  });
  if (S.filter !== 'all') rows = rows.filter(r => r.kind === S.filter);

  return `
  <div class="h1" style="margin-bottom:5px">المعاملات</div>
  <p class="sub" style="margin-bottom:14px">كل عمليات بطاقاتك ومحفظتك.</p>
  <div class="pills">
    ${F.map(([k, t]) => `<button class="pill ${S.filter === k ? 'on' : ''}"
      data-filter="${k}">${t}</button>`).join('')}
  </div>
  ${rows.length ? `<div class="list">${rows.map(r => {
    const st = STAT[r.status] || ['off', '—'];
    const isIn = r.kind === 'deposit';
    const val = r.customer_price ?? r.amount ?? 0;
    return `<div class="row">
      <div class="row-i" ${isIn ? 'style="color:var(--g);background:var(--g-soft)"' : ''}>
        ${svg(isIn ? I.up : r.kind === 'fund' ? I.plus : I.card)}</div>
      <div class="row-b">
        <div class="row-t">${TYPE[r.kind] || 'عملية'}</div>
        <div class="row-s">${dt(r.created_at)}</div></div>
      <div class="row-v">
        <div class="row-a num ${isIn && r.status === 'approved' ? 'in' : ''}">
          ${isIn ? '+' : '−'}${usd(val)}</div>
        <span class="chip ${st[0]}" style="margin-top:3px">${st[1]}</span>
      </div></div>`;
  }).join('')}</div>`
   : `<div class="card"><div class="empty">
      <div class="ei">${svg(I.list, 1.6)}</div>
      <p style="font-size:13.5px">لا معاملات بهذا التصنيف.</p></div></div>`}`;
}

/* ═══ Account ═══ */
function vAccount() {
  const nm = S.profile.name || 'مستخدم';
  return `
  <div class="card" style="text-align:center;padding:24px 18px;margin-bottom:14px">
    <div style="width:70px;height:70px;border-radius:22px;margin:0 auto 12px;
         display:grid;place-items:center;background:var(--g-soft);color:var(--g);
         font-size:26px;font-weight:800">${esc(nm.trim().charAt(0))}</div>
    <div class="h2">${esc(nm)}</div>
    <div class="sub" style="font-size:13px;margin-top:2px" dir="ltr">
      ${esc(S.profile.phone || S.profile.email || '')}</div>
    <div class="num" style="color:var(--g);font-size:20px;margin-top:10px">
      ${lyd(S.profile.wallet_balance * rate())}</div>
    ${(S.config.points || {}).on ? `
      <button class="chip ok" style="margin-top:9px" data-wact="points">
        ${svg(I.star, 2)} ${n(S.profile.points).toLocaleString('en-US')} نقطة</button>` : ''}
  </div>

  <nav class="menu">
    ${[['wallet', 'المحفظة', I.wallet], ['orders', 'طلباتي', I.bag],
       ['mcards', 'بطاقاتي', I.card], ['tx', 'المعاملات', I.list],
       ['tickets', 'الدعم', I.help],
       ['invite', 'ادعُ صديقًا', I.gift], ['guide', 'كيف أستخدمها', I.book]]
      .map(([k, t, ic], i) => `
        <button class="mrow" style="animation-delay:${i * .03}s" data-act="${k}">
          <span class="mrow-i">${svg(ic)}</span>
          <span class="mrow-t">${t}</span>
          <span class="mrow-x">${svg(I.back, 2)}</span></button>`).join('')}
  </nav>

  <div class="sec-head"><div class="h2">المعلومات الشخصية</div></div>
  <div class="card" style="max-width:520px;margin-bottom:14px">
    <label class="lbl">الاسم</label>
    <input class="inp" id="pN" value="${esc(S.profile.name || '')}">
    <label class="lbl" style="margin-top:14px">البريد الإلكتروني</label>
    <input class="inp" value="${esc(S.profile.email || S.user?.email || '')}" disabled
           style="opacity:.55" dir="ltr">
    <label class="lbl" style="margin-top:14px">رقم الهاتف</label>
    <input class="inp num" id="pP" value="${esc(S.profile.phone || '')}"
           placeholder="0912345678" dir="ltr" inputmode="tel">
    <button class="btn" id="pS" style="margin-top:18px">حفظ التغييرات</button>
  </div>

  <div class="card" style="max-width:520px;margin-bottom:14px">
    <div class="h3" style="margin-bottom:6px">كلمة المرور</div>
    <p class="sub" style="margin-bottom:14px">سنرسل رابط التغيير إلى بريدك.</p>
    <button class="btn line" id="pR">إرسال رابط التغيير</button>
  </div>

  <button class="btn risk wide" style="margin-top:16px" onclick="askOut()">
    ${svg(I.out)} تسجيل الخروج</button>`;
}

/* ═══ Invite ═══ */
function vInvite() {
  const r = S.config.referral || {};
  if (!r.on) return `
    <div class="h1" style="margin-bottom:18px">ادعُ صديقًا</div>
    <div class="card"><div class="empty">
      <div class="ei">${svg(I.gift, 1.6)}</div>
      <div class="et">غير متاح حاليًا</div>
      <p style="font-size:13px">سنفعّل نظام الدعوات قريبًا.</p></div></div>`;

  return `
  <div class="h1" style="margin-bottom:5px">ادعُ صديقًا</div>
  <p class="sub" style="margin-bottom:18px">
    شارك رمزك — تحصل على ${usd(r.inviter)} ويحصل صديقك على ${usd(r.invitee)}.</p>

  <div class="wallet" style="text-align:center">
    <div class="eyebrow">رمز الدعوة</div>
    <div id="refBox" style="margin-top:12px">
      <div class="sk" style="height:44px;width:180px;margin:0 auto"></div></div>
    <p class="sub" style="font-size:12px;margin-top:14px">
      تُصرف المكافأة بعد أن ينفق صديقك ${usd(r.min_spend)}.</p>
  </div>

  <div class="card" style="margin-top:14px">
    <div class="h3" style="margin-bottom:12px">هل لديك رمز؟</div>
    <input class="inp mono" id="refIn" placeholder="ABC123" maxlength="6" dir="ltr"
           style="text-transform:uppercase;text-align:center;font-size:18px;letter-spacing:.2em">
    <button class="btn wide" id="refGo" style="margin-top:12px">تفعيل الرمز</button>
  </div>

  <div class="stats" style="margin-top:14px">
    <div class="stat" style="grid-column:1/-1;text-align:center">
      <div class="v num">${n(S.profile.referrals_count)}</div>
      <div class="k">صديق انضم برمزك</div></div>
  </div>`;
}

/* ═══ Guide ═══ */
function vGuide() {
  const steps = [
    ['أضف رصيدًا', 'حوّل عبر ليبيانا أو المدار أو USDT، وأكّد التحويل من صفحة المحفظة.'],
    ['أصدر بطاقة', 'اختر المبلغ واسم حامل البطاقة — تُصدر خلال دقائق.'],
    ['اعرض بياناتها', 'من «بطاقاتي» اضغط البطاقة ثم «عرض بيانات البطاقة».'],
    ['ادفع بها', 'في أي موقع، الصق رقم البطاقة وتاريخ الانتهاء وCVV كأي بطاقة عادية.'],
  ];
  const faq = [
    ['كم تستغرق إضافة الرصيد؟',
     'ليبيانا والمدار وUSDT فورية. التحويل المصرفي يحتاج مراجعة.'],
    ['متى أستلم بطاقتي؟',
     'تُصدر خلال دقائق وتصلك إشعار عند الجاهزية.'],
    ['لماذا تختفي بيانات البطاقة؟',
     'لأمانك — تظهر 24 ساعة ثم تُمسح تلقائيًا. احفظها عند أول عرض.'],
    ['ماذا لو رُفض طلبي؟',
     'يُعاد المبلغ كاملًا إلى محفظتك تلقائيًا.'],
  ];
  const sup = (S.config.texts || {}).support_url || '';

  return `
  <div class="h1" style="margin-bottom:5px">كيف أستخدم كاردو</div>
  <p class="sub" style="margin-bottom:20px">أربع خطوات من الصفر إلى أول دفع.</p>

  <div class="list" style="margin-bottom:24px">
    ${steps.map(([t, d], i) => `<div class="row">
      <div class="row-i" style="background:var(--g-soft);color:var(--g);font-weight:800">${i + 1}</div>
      <div class="row-b"><div class="row-t">${t}</div>
        <div class="row-s" style="white-space:normal;line-height:1.6">${d}</div></div>
    </div>`).join('')}
  </div>

  <div class="sec-head"><div class="h2">أسئلة شائعة</div></div>
  <div class="list">
    ${faq.map(([q, a]) => `<div class="row" style="align-items:flex-start">
      <div class="row-b"><div class="row-t" style="white-space:normal">${q}</div>
        <div class="row-s" style="white-space:normal;line-height:1.65;margin-top:3px">${a}</div></div>
    </div>`).join('')}
  </div>

  ${sup ? `<button class="btn line wide" style="margin-top:20px"
    onclick="window.open('${esc(sup.startsWith('http') ? sup : 'https://wa.me/' + sup)}','_blank')">
    تواصل مع الدعم</button>` : ''}`;
}

/* ═══ Bind ═══ */
function bind() {
  $$('[data-act]').forEach(b => b.onclick = () => {
    const a = b.dataset.act;
    if (a === 'deposit') return depositSheet();
    go(a);
  });
  $$('[data-cat]').forEach(b => b.onclick = () => {
    const id = b.dataset.cat;
    if (!id) { S.cat = null; S.q = ''; S.page = 'shop'; return render(); }
    const c = S.catalog.categories.find(x => x.id === id);
    if (c && c.soon) return soonSheet(c);
    S.cat = id; S.q = ''; S.filter = 'all'; S.page = 'shop'; render();
  });
  $$('[data-prod]').forEach(b => b.onclick = () => productSheet(b.dataset.prod));
  $$('[data-back]').forEach(b => b.onclick = () => {
    const cur = S.catalog.categories.find(x => x.id === S.cat);
    S.cat = (cur && cur.parent) || null;
    S.q = ''; render();
  });
  $$('[data-order]').forEach(b => b.onclick = () => orderSheet(b.dataset.order));
  $$('[data-mc]').forEach(b => b.onclick = () => mcCardSheet(b.dataset.mc));
  $$('[data-filter]').forEach(b => b.onclick = () => { S.filter = b.dataset.filter; render(); });
  $$('[data-step]').forEach(b => b.onclick = () => { S.wiz.step = +b.dataset.step; render(); });
  $$('[data-blink]').forEach(b => b.onclick = () => window.open(b.dataset.blink, '_blank'));
  $$('[data-wact]').forEach(b => b.onclick = () => {
    const a = b.dataset.wact;
    if (a === 'deposit') return depositSheet();
    if (a === 'withdraw') return withdrawSheet();
    if (a === 'transfer') return transferSheet();
    if (a === 'points') return pointsSheet();
  });
  $$('[data-tic]').forEach(b => b.onclick = () => ticketSheet(b.dataset.tic));
  onTap('#newTic', () => newTicketSheet());
  onTap('#newMc', () => mcRequestSheet(null));

  const sq = $('#shopQ');
  if (sq) {
    sq.oninput = e => {
      S.q = e.target.value;
      clearTimeout(sq._t);
      sq._t = setTimeout(() => {
        const p = sq.selectionStart;
        render();
        const el = $('#shopQ');
        if (el) { el.focus(); el.setSelectionRange(p, p); }
      }, 260);
    };
  }

  const hb = $('#hBal');
  if (hb) { hb.dataset.v = 0; countTo(hb, S.profile.wallet_balance * rate(), lyd); }

  bannerSlider();

  // ربط اسم الدعوة
  const rb = $('#refBox');
  if (rb) {
    api('/api/ref/code').then(r => {
      rb.innerHTML = `<button id="cpRef" class="mono"
        style="display:inline-flex;align-items:center;gap:11px;background:var(--g);
               color:#04121B;padding:13px 24px;border-radius:13px;font-weight:800;
               font-size:26px;letter-spacing:.14em">
        ${svg(I.copy, 2)} ${esc(r.code)}</button>`;
      onTap('#cpRef', () => copy(r.code, 'رمز الدعوة'));
    }).catch(e => {
      rb.innerHTML = `<div class="sub" style="font-size:13px">${esc(e.message)}</div>`;
    });
  }
  onTap('#refGo', async () => {
    const rg = $('#refGo');
    const c = $('#refIn').value.trim().toUpperCase();
    if (c.length !== 6) return toast('الرمز 6 أحرف', 'bad');
    rg.disabled = true;
    try {
      const r = await api('/api/ref/claim', { code: c });
      toast(`فُعّل الرمز — ستحصل على ${usd(r.bonus)} بعد إنفاق ${usd(r.min_spend)}`, 'ok');
      render();
    } catch (e) { toast(e.message, 'bad'); rg.disabled = false; }
  });

  onTap('#pS', async () => {
    const ps = $('#pS');
    const name = $('#pN').value.trim(), phone = $('#pP').value.trim();
    if (name.length < 2) return toast('الاسم قصير جدًا', 'bad');
    ps.disabled = true;
    try {
      await setDoc(doc(db, 'users', S.user.uid),
        { name, phone, phone_key: phoneKey(phone) }, { merge: true });
      toast('حُفظت التغييرات', 'ok');
      render();
    } catch { toast('تعذّر الحفظ', 'bad'); ps.disabled = false; }
  });
  onTap('#pR', async () => {
    const pr = $('#pR');
    const em = S.profile.email || S.user?.email;
    if (!em) return toast('لا يوجد بريد مسجّل', 'bad');
    pr.disabled = true;
    try { await sendPasswordResetEmail(auth, em); toast('أُرسل رابط التغيير إلى ' + em, 'ok'); }
    catch { toast('تعذّر الإرسال', 'bad'); pr.disabled = false; }
  });
}

/* Banner auto-advance */
let _bnrTimer = null;
function bannerSlider() {
  clearInterval(_bnrTimer);
  const track = $('#bTrack'), dots = $('#bDots');
  if (!track) return;
  const slides = track.children.length;
  if (slides < 2) return;

  const sync = () => {
    const i = Math.round(track.scrollLeft / track.clientWidth);
    if (dots) [...dots.children].forEach((d, x) => d.classList.toggle('on', x === Math.abs(i)));
  };
  track.onscroll = () => {
    clearTimeout(track._t);
    track._t = setTimeout(sync, 90);
  };

  _bnrTimer = setInterval(() => {
    if (!document.body.contains(track)) { clearInterval(_bnrTimer); return; }
    const i = Math.round(Math.abs(track.scrollLeft) / track.clientWidth);
    const next = (i + 1) % slides;
    track.scrollTo({
      left: next * track.clientWidth * (document.dir === 'rtl' ? -1 : 1),
      behavior: 'smooth',
    });
  }, 6000);
}

/* 3D tilt effect */
function bindTilt() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const MAX = 7;
  $$('.vcard, .mccard').forEach(el => {
    if (el._t) return;
    el._t = true;
    const move = (x, y) => {
      const r = el.getBoundingClientRect();
      const px = (x - r.left) / r.width - .5, py = (y - r.top) / r.height - .5;
      el.style.setProperty('--ry', (px * MAX * 2).toFixed(2) + 'deg');
      el.style.setProperty('--rx', (-py * MAX * 2).toFixed(2) + 'deg');
      el.classList.add('tilt');
    };
    const reset = () => {
      el.classList.remove('tilt');
      el.style.removeProperty('--rx');
      el.style.removeProperty('--ry');
    };
    el.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return;
      move(e.clientX, e.clientY);
    });
    el.addEventListener('pointerleave', reset);
    let raf = null;
    el.addEventListener('touchmove', e => {
      const t = e.touches[0];
      if (!t || raf) return;
      raf = requestAnimationFrame(() => { raf = null; move(t.clientX, t.clientY); });
    }, { passive: true });
    el.addEventListener('touchend', reset, { passive: true });
    el.addEventListener('touchcancel', reset, { passive: true });
  });
    }
