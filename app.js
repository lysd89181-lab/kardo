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
import { getFirestore, doc as _fsDoc, setDoc as _fsSetDoc, getDoc as _fsGetDoc, onSnapshot as _fsOnSnapshot, collection as _fsCollection,
  query as _fsQuery, where as _fsWhere, orderBy as _fsOrderBy, limit as _fsLimit }
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
try { if ((navigator.hardwareConcurrency || 4) >= 6 && (navigator.deviceMemory || 4) >= 4) document.documentElement.classList.add('fx-blur'); } catch {}   // v37: ضبابية النوافذ للأجهزة القوية فقط

/* ═══ v35 — بعد التحويل الكامل إلى D1: نفس دوال Firestore بأسمائها، لكن عبر الخادم ═══
   • الوضع يُحدَّد عند فتح الصفحة (kardo_d1p)، وإن تغيّر في الخادم تُعاد الصفحة مرة واحدة.
   • كل «onSnapshot» تُجمع في طلب واحد للخادم كل دقيقة والصفحة ظاهرة،
     ويُحدَّث فورًا بعد أي عملية يقوم بها المستخدم.                                                */
const KDB_KEY = 'kardo_d1p';
const KDB = (() => { try { return localStorage.getItem(KDB_KEY) === '1'; } catch { return false; } })();
function kdbCheckMode(d1p) {
  const want = d1p === true;
  if (want === KDB) return;
  try {
    localStorage.setItem(KDB_KEY, want ? '1' : '0');
    if (Date.now() - Number(sessionStorage.getItem('kdb_reload') || 0) < 60000) return;
    sessionStorage.setItem('kdb_reload', String(Date.now()));
  } catch {}
  location.reload();
}
const collection = (d, c) => KDB ? { _k: 'c', c } : _fsCollection(d, c);
const doc = (d, c, id) => KDB ? { _k: 'd', c, id } : _fsDoc(d, c, id);
const where = (f, op, v) => KDB ? { _k: 'w', f, op, v } : _fsWhere(f, op, v);
const orderBy = (f, dir) => KDB ? { _k: 'o', f, d: dir || 'asc' } : _fsOrderBy(f, dir);
const limit = n => KDB ? { _k: 'l', n } : _fsLimit(n);
function query(base, ...parts) {
  if (!KDB) return _fsQuery(base, ...parts);
  const q = { c: base.c, w: [], o: [], l: 100 };
  parts.forEach(p => { if (p._k === 'w') q.w.push([p.f, p.op, p.v]); else if (p._k === 'o') q.o.push([p.f, p.d]); else if (p._k === 'l') q.l = p.n; });
  return { _k: 'q', q };
}
const kdbDocSnap = (ref, r) => ({ id: ref.id, ref, exists: () => !!(r && r.exists), data: () => (r && r.exists ? r.data : undefined) });
const kdbQuerySnap = docs => {
  const ds = (docs || []).map(x => { const { __id, ...rest } = x; return { id: __id, data: () => rest }; });
  return { docs: ds, size: ds.length, empty: !ds.length, forEach: f => ds.forEach(f) };
};
async function getDoc(ref) {
  if (!KDB) return _fsGetDoc(ref);
  const r = await api('/api/db/doc', { c: ref.c, id: ref.id });
  return kdbDocSnap(ref, r);
}
async function setDoc(ref, data, opts) {
  if (!KDB) return _fsSetDoc(ref, data, opts);
  await api('/api/db/set', { c: ref.c, id: ref.id, data });
}
const _kdbSubs = new Map();
let _kdbSeq = 0, _kdbBusy = false, _kdbSoon = null, _kdbAgain = false;
function onSnapshot(ref, next, errCb, every = 60000) {
  if (!KDB) return _fsOnSnapshot(ref, next, errCb);
  const id = 's' + (++_kdbSeq);
  _kdbSubs.set(id, { id, ref, next, err: errCb, h: null, due: 0, every });
  kdbSoon(40);
  return () => { _kdbSubs.delete(id); };
}
function kdbSoon(ms = 500) { if (!KDB) return; clearTimeout(_kdbSoon); _kdbSoon = setTimeout(() => kdbTick(true), ms); }
// v51: الصفحة المفتوحة بدون استعمال (5 دقائق) لا تسحب بيانات — تكمل أول ما يرجع المستخدم
const K_IDLE = 5 * 60000;
let _kLastAct = Date.now();
const kIdle = () => Date.now() - _kLastAct > K_IDLE;
['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(ev => addEventListener(ev, () => {
  const was = kIdle(); _kLastAct = Date.now(); if (was && typeof kdbSoon === 'function') kdbSoon(150);
}, { passive: true, capture: true }));
async function kdbTick(force) {
  if (!KDB || document.visibilityState !== 'visible' || !auth.currentUser) return;
  if (!force && kIdle()) return;
  if (_kdbBusy) { if (force) _kdbAgain = true; return; }
  const now = Date.now();
  const due = [..._kdbSubs.values()].filter(s => force || s.due <= now).slice(0, 25);
  if (!due.length) return;
  _kdbBusy = true;
  // الوثائق (مثل ملف المستخدم والرصيد) في طلب مستقل أولًا — لا تسقط أبدًا بسبب قائمة ثقيلة
  const groups = [due.filter(s => s.ref._k === 'd'), due.filter(s => s.ref._k !== 'd')].filter(g => g.length);
  try {
    for (const grp of groups) {
      try {
        const subs = grp.map(s => ({ k: s.id, ...(s.h ? { h: s.h } : {}), ...(s.ref._k === 'd' ? { d: { c: s.ref.c, id: s.ref.id } } : { q: s.ref.q }) }));
        const r = await api('/api/db/batch', { subs });
        for (const s of grp) {
          s.due = Date.now() + s.every;
          const x = r.res && r.res[s.id];
          if (!x || !_kdbSubs.has(s.id)) continue;
          if (x.error) { if (s.err) { try { s.err({ code: x.status === 403 ? 'permission-denied' : 'unavailable', message: x.error }); } catch {} } continue; }
          if (x.same) continue;
          s.h = x.h || null;
          try { s.next(s.ref._k === 'd' ? kdbDocSnap(s.ref, x) : kdbQuerySnap(x.docs)); } catch (e) { console.warn('snapshot handler:', e); }
        }
      } catch (e) { console.warn('kdb:', e.message); grp.forEach(s => { s.due = Date.now() + 15000; }); }
    }
  } finally { _kdbBusy = false; if (_kdbAgain) { _kdbAgain = false; kdbSoon(300); } }
}
if (KDB) {
  setInterval(() => kdbTick(false), 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kdbTick(true); });
}


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
  game: '<path d="M7 9h10a4 4 0 0 1 4 4.4l-.4 3.1a2.3 2.3 0 0 1-4 1.1L15 16H9l-1.6 1.6a2.3 2.3 0 0 1-4-1.1L3 13.4A4 4 0 0 1 7 9z"/><path d="M8 12v2.5M6.8 13.2h2.5M15.5 12.5h.01M17.5 14h.01"/>',
  withdraw: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 20h14"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  wallet2: '<path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4H5a2 2 0 0 0 0 4h14a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6"/><path d="M16.5 14h.01"/>',
  store: '<path d="M5 8h14l-1 12.2a1.5 1.5 0 0 1-1.5 1.3h-9a1.5 1.5 0 0 1-1.5-1.3z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  giftbox: '<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12"/><path d="M12 8C10 4 7 4.5 7 6.5S10 8 12 8zM12 8c2-4 5-3.5 5-1.5S14 8 12 8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  alert: '<path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4M12 17h.01"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
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
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 20h14"/>',
  zap: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  share: '<path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
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
  tv: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M8 21h8M10.5 10v4l3.5-2z"/>',
  apps: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><path d="M16.5 13v7M13 16.5h7"/>',
  paycard: '<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/>',
  fire: '<path d="M12 3c1 3.5 5 5.2 5 10a5 5 0 0 1-10 0c0-2.2 1-3.6 2.2-4.6.2 1.6.9 2.6 1.8 3.1C11 8.6 11.3 5.7 12 3z"/>',
};
const svg = (d, w = 1.75) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

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

// مسارات قراءة فقط: لا تستدعي تحديث كل الاشتراكات بعدها (كانت تضاعف القراءات أثناء انتظار الفاتورة)
const KDB_QUIET = new Set(['/api/activity/ping', '/api/wallet/usdt/verify', '/api/wallet/invoices', '/api/wallet/invoice', '/api/rsc/my-orders', '/api/mcard/list']);
async function api(path, body, ms = 20000) {
  if (!navigator.onLine) throw new Error('لا يوجد اتصال بالإنترنت');
  const token = await auth.currentUser.getIdToken();
  const res = await fetchWithTimeout(API_BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, ...(await appCheckHeader()) },
    body: JSON.stringify(body || {}),
  }, ms);
  const d = await res.json().catch(() => ({ success: false, error: 'رد غير مفهوم' }));
  if (!d.success) throw new Error(d.error || 'فشلت العملية');
  if (KDB && !/^\/api\/(db|sync)\//.test(path) && !KDB_QUIET.has(path)) kdbSoon(600);   // v35: تحديث فوري بعد أي عملية
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
    try { localStorage.removeItem('kardo_authed'); } catch {}
    document.documentElement.classList.remove('boot-app');
    $('#public').style.display = 'block';
    $('#app').style.display = 'none';
    return;
  }

  S.user = user;
  try { localStorage.setItem('kardo_authed', '1'); } catch {}
  $('#public').style.display = 'none';
  $('#app').style.display = 'block';
  setTimeout(() => anPage(S.page), 0);
  document.documentElement.classList.remove('boot-app');
  { const hm = /^#\/([a-z]+)(?:\/([A-Za-z0-9_-]{2,40}))?/.exec(location.hash);
    if (hm && hm[1] === 'store' && hm[2]) { S.curStore = hm[2]; S.page = 'store'; }
    else if (hm && ROUTABLE.has(hm[1]) && hm[1] !== 'store' && hm[1] !== 'mystore') S.page = hm[1]; }
  try { history.replaceState({ page: S.page }, '', location.pathname + location.search + (location.hash && !location.hash.startsWith('#/') ? location.hash : '#/' + S.page)); } catch {}

  await ensureProfile(user);
  claimStoredRef();
  if (pushOn()) setTimeout(() => registerPushToken(true), 4000);
  { const nm = /[#&]n=([^&]+)/.exec(location.hash); if (nm) { history.replaceState(null, '', location.pathname); setTimeout(() => followLink(decodeURIComponent(nm[1])), 1200); } }
  setTimeout(() => { if (!document.getElementById('overlay')?.classList.contains('open')) maybeTour(); }, 1500);
  try {
    const c = JSON.parse(localStorage.getItem('kardo_cfg') || 'null');
    if (c && c.methods) S.config = { ...S.config, ...c };
  } catch {}

  subscribe(user.uid);

  apiGet('/api/status').then(d => {
    S.config = { ...S.config, ...d };
    try { localStorage.setItem('kardo_cfg', JSON.stringify(d)); } catch {}
    kdbCheckMode(d.d1p);
    d1Resync();
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
      anEv('signup');
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
    e => { S.dataErr.cards = e.code; render(); }, 300000));   // v51: البطاقات تتغير نادرًا — كل 5 دقائق (وفورًا بعد أي عملية)

  S.unsub.push(onSnapshot(query(collection(db, 'service_orders'),
    where('uid', '==', uid), limit(60)),
    s => {
      S.svcOrders = sortByDate(s.docs.map(d => ({ id: d.id, ...d.data() })));
      render();
    },
    e => { S.dataErr.svcOrders = e.code; render(); }, 600000));   // v51: المتجر القديم — كل 10 دقائق
}

/* ═══ v34 — بديل الاتصال المباشر عند تفعيل D1: طلبات للخادم مع تحديث خفيف ═══
   الإشعارات: كل دقيقتين + عند الرجوع للتبويب · قوائم المحادثات: كل دقيقة (في صفحتها فقط)
   · المحادثة المفتوحة: كل 5 ثوانٍ وهي ظاهرة. عند إطفاء المفتاح يعود الاتصال المباشر كما كان. */
const d1On = c => !!(S.config && S.config.d1 && S.config.d1[c]);
function makePoll(fn, everyMs, opt = {}) {
  let stopped = false, busy = false, last = 0;
  const tick = async (minAge) => {
    if (stopped || busy || document.visibilityState !== 'visible') return;
    if (minAge == null && typeof kIdle === 'function' && kIdle()) return;   // v51: لا سحب والصفحة مهملة
    if (opt.when && !opt.when()) return;
    if (Date.now() - last < (minAge == null ? everyMs - 1000 : minAge)) return;
    busy = true; last = Date.now();
    try { await fn(); } catch (e) { console.warn('poll:', e.message); } finally { busy = false; }
  };
  const iv = setInterval(() => tick(), everyMs);
  const onVis = () => { if (document.visibilityState === 'visible') tick(opt.onVisible ? 0 : null); };
  document.addEventListener('visibilitychange', onVis);
  setTimeout(() => tick(0), 0);
  const stop = () => { stopped = true; clearInterval(iv); document.removeEventListener('visibilitychange', onVis); };
  stop.poke = (minAge = 20000) => tick(minAge);
  stop.now = () => tick(0);
  return stop;
}
const LAZY_D1 = {           // مفاتيح تُقرأ عبر الخادم عند تفعيل D1 لمجموعتها
  mchats:  { coll: 'merchant_chats', role: 'customer', pages: ['chats', 'store'] },
  mschats: { coll: 'merchant_chats', role: 'merchant', pages: ['mystore'] },
};
const _lazyMode = {};
function setLazyRows(key, rows) {
    if (key === 'orders') S.orders = rows;
    if (key === 'deposits') S.deposits = rows;
    if (key === 'tickets') S.tickets = rows;
    if (key === 'mc2') S.manualOrders = rows;
    if (key === 'withdrawals') S.withdrawals = rows;
    if (key === 'morders') S.mOrders = rows;
    if (key === 'mstore') S.mstoreOrders = rows;
    if (key === 'mcases') S.mCases = rows;
    if (key === 'mscases') S.mstoreCases = rows;
    if (key === 'mstatements') S.mStatements = rows;
    if (key === 'mchats') S.mChats = rows;
    if (key === 'mschats') S.mstoreChats = rows;
    render();
}
const _lazy = {};
function lazySub(key, build) {
  if (_lazy[key]) { if (_lazy[key].poke) _lazy[key].poke(); return; }
  const dk = LAZY_D1[key];
  if (dk && d1On(dk.coll)) {
    const st = { since: 0, n: -1 };
    _lazyMode[key] = 'd1';
    _lazy[key] = makePoll(async () => {
      const r = await api('/api/sync/chats', { role: dk.role, since: st.since, n: st.n });
      st.since = r.ts || st.since;
      if (r.changed && r.list) { st.n = r.list.length; setLazyRows(key, sortByDate(r.list)); }
    }, 60000, { when: () => dk.pages.includes(S.page) });
    return;
  }
  _lazyMode[key] = 'fs';
  _lazy[key] = onSnapshot(build(), snap => {
    setLazyRows(key, sortByDate(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, e => { S.dataErr[key] = e.code; render(); });
}
// عند تغيّر مفاتيح D1 (من /api/status) نعيد ربط ما تغيّر فقط
function d1Resync() {
  if (!S.user) return;
  if (_notifUid && _notifMode && _notifMode !== (d1On('notifications') ? 'd1' : 'fs')) { stopNotifs(); startNotifs(); }
  let changed = false;
  Object.keys(LAZY_D1).forEach(k => {
    if (_lazy[k] && _lazyMode[k] !== (d1On(LAZY_D1[k].coll) ? 'd1' : 'fs')) { try { _lazy[k](); } catch {} delete _lazy[k]; changed = true; }
  });
  if (changed) ensurePageData();
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
  } else if (S.page === 'mystore') {
    lazySub('mstore', () => query(collection(db, 'merchant_orders'),
      where('merchant_owner', '==', uid), limit(25)));
    lazySub('mscases', () => query(collection(db, 'merchant_reports'),
      where('merchant_owner', '==', uid), limit(25)));
    lazySub('mstatements', () => query(collection(db, 'merchant_statements'),
      where('merchant_owner', '==', uid), limit(12)));
    lazySub('mschats', () => query(collection(db, 'merchant_chats'),
      where('merchant_owner', '==', uid), limit(30)));
  } else if (S.page === 'chats' || S.page === 'store') {
    lazySub('mchats', () => query(collection(db, 'merchant_chats'),
      where('uid', '==', uid), limit(25)));
  } else if (S.page === 'wallet') {
    lazySub('deposits', () => query(collection(db, 'wallet_deposits'),
      where('uid', '==', uid), limit(40)));
    lazySub('withdrawals', () => query(collection(db, 'withdrawals'),
      where('uid', '==', uid), limit(20)));
  } else if (S.page === 'cards') {
    lazySub('mc2', () => query(collection(db, 'manual_card_orders'),
      where('uid', '==', uid), limit(50)));
  } else if (S.page === 'support') {
    lazySub('tickets', () => query(collection(db, 'tickets'),
      where('uid', '==', uid), limit(30)));
  } else if (S.page === 'transactions') {
    lazySub('orders', () => query(collection(db, 'orders'),
      where('uid', '==', uid), limit(60)));
    lazySub('deposits', () => query(collection(db, 'wallet_deposits'),
      where('uid', '==', uid), limit(40)));
  } else {
  }
}

/* ═══ Navigation ═══ */
const ROUTABLE = new Set(['dashboard', 'cards', 'orders', 'settings', 'wallet', 'transactions', 'plans', 'referral', 'support', 'kstore', 'trust', 'invoices']);
window.go = (page, keepCat, fromPop) => {
  if (!fromPop && ROUTABLE.has(page) && (S.page !== page || page === 'store')) {
    try { history.pushState({ page, store: S.curStore || null, sec: S.curSection || null }, '', '#/' + page + (page === 'store' && S.curStore ? '/' + encodeURIComponent(S.curStore) : '')); } catch {}
  }
  S.page = page;
  anPage(page);
  if (!keepCat) S.cat = null;
  S.q = '';
  ensurePageData();
  window.scrollTo({ top: 0, behavior: 'instant' });
  render();
  $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === page));

  if (page === 'services' || page === 'orders') loadServices();
  if (page === 'shop' || page === 'plans' || page === 'dashboard') loadCatalog();
  if (page === 'kstore' || page === 'dashboard') loadRsc();
  if (page === 'invoices') S.invoices = null; else if (page === 'dashboard' && !S.invoices && S.user) loadInvoices();
  if (page === 'orders') loadRscOrders();
  if (!keepCat) S.rscCat = null;
  if (page === 'transactions' || page === 'wallet') subscribeLedger();
};

$$('[data-nav]').forEach(b => b.onclick = () => go(b.dataset.nav));
window.addEventListener('popstate', e => {
  if (!S.user) return;
  if ($('#overlay') && $('#overlay').classList.contains('open')) closeModal();
  const st = e.state || {};
  if (st.store) S.curStore = st.store;
  S.curSection = st.sec || null;
  go(st.page || 'dashboard', false, true);
});

/* ═══ Render ═══ */
let _raf = null;
function render() {
  if (_raf) return;
  _raf = requestAnimationFrame(() => { _raf = null; paint(); });
}

const merchantsOn = () => false;   // v44: أُلغيت المتاجر الموثوقة
// رمز الدعوة: يُلتقط من الرابط أو من خانة التسجيل، ويُسجَّل بعد وجود الحساب
(function captureRef() {
  try {
    const m = /[?&#]ref=([A-Za-z0-9]{6})\b/.exec(location.search + location.hash);
    if (m) localStorage.setItem('kardo_ref', m[1].toUpperCase());
  } catch {}
})();
async function claimStoredRef() {
  let code = ''; try { code = localStorage.getItem('kardo_ref') || ''; } catch {}
  if (!/^[A-Z2-9]{6}$/.test(code)) { try { localStorage.removeItem('kardo_ref'); } catch {} return; }
  try {
    await api('/api/ref/claim', { code });
    toast('سُجّل رمز الدعوة ✓ — تحصل على هديتك عند إصدار أول بطاقة 🎁', 'ok');
  } catch (e) {
    if (/abort|network|failed to fetch/i.test(String(e && (e.name + ' ' + e.message)))) return;   // نعيد المحاولة لاحقًا
  }
  try { localStorage.removeItem('kardo_ref'); } catch {}
}
function paint() {
  if (!S.user) return;
  if (['stores', 'store', 'chats', 'mystore'].includes(S.page)) S.page = 'dashboard';
  if (S.page === 'kstore' && !rscOn()) S.page = 'dashboard';

  const av = $('#avatarInitial');
  { const ini = esc(((S.profile.name || S.user.email || 'ك').trim()[0] || 'ك').toUpperCase()); if (av && av.dataset.seed !== ini) { av.dataset.seed = ini; av.textContent = ini; av.className = 'kav-sm'; av.removeAttribute('style'); } }

  paintDock();
  paintBell();

  $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === S.page));
  $$('[data-nav="stores"]').forEach(b => { b.style.display = 'none'; });
  $$('[data-nav="kstore"]').forEach(b => { b.style.display = rscOn() ? '' : 'none'; });

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
    chats: vChats,
    trust: vTrust,
    kstore: vKStore,
    invoices: vInvoices,
  };
  if (S.page === 'shop' && !S.config.store_on) S.page = 'dashboard';

  const _sec = PAGE_SEC[S.page], _gate = _sec && secShut(_sec) && !(_sec === 'cards' && secOf('cards').s === 'maint' && (S.manualCards || []).some(c => c.status !== 'deleted'));
  const html = (_gate ? secClosedPage(_sec) : (pages[S.page] || vDashboard)()) + (S.page !== 'settings' && !(S.page === 'kstore' && S.rscCat) ? siteFooter() : '');
  const samePage = _lastPage === S.page;
  if (samePage && html === _lastHtml) return;                 // لا تغيير → لا إعادة رسم (سبب الرمشة)
  const ae = document.activeElement;
  const focusId = ae && ae.id && view.contains(ae) ? ae.id : null;
  const caret = focusId && typeof ae.selectionStart === 'number' ? ae.selectionStart : null;
  const scrollY = window.scrollY;
  view.innerHTML = samePage ? html.replace('class="page-enter"', 'class=""') : html;   // لا حركة دخول عند التحديث
  _lastPage = S.page; _lastHtml = html;
  bind();
  lazyBgs();
  runCountUps();
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
  const name = (S.profile.name || S.user?.displayName || '').split(' ')[0];
  const bal = n(S.profile.wallet_balance);
  return `
  <div class="page-enter">
    ${S.config.site_maint ? `<div class="alert alert-warning mb-4">${svg(I.help)}<div><b>معاينة الإدارة</b> — الموقع في وضع الصيانة والزوار يرون شاشة الصيانة.</div></div>` : ''}
    ${verifyBannerHtml()}
    ${(() => { const p = S.config.promo_first; if (!p || S.profile.promo_first_done) return '';
      return `<button class="kpromo" data-act="dock-deposit" type="button"><span class="kpromo-ic">🎁</span><div><b>اشحن أول مرة بـ ${esc(String(p.min))}$ وخذ ${esc(String(p.bonus))}$ هدية</b><span>${S.profile.phone_verified ? 'تنضاف لمحفظتك تلقائيًا مع الشحنة' : 'وثّق رقم هاتفك أولًا باش تاخذ الهدية'}</span></div></button>`; })()}
    ${(() => { const v = pendingInvoice(); return v ? `<button class="kpend" data-pendinv type="button"><span class="kpulse"></span><div><b>فاتورة شحن بانتظار الدفع</b><span class="tabular">${esc(v.no)} · ${esc(Number(v.pay_amount).toFixed(2))} USDT</span></div><span class="kpend-go">ادفع الآن</span></button>` : ''; })()}
    <section class="kw" aria-label="المحفظة">
      <img class="kw-fox" src="./kardo-mark.png" alt="" aria-hidden="true">
      <div class="kw-row"><span class="kw-label">رصيد محفظتك</span>${name ? `<span class="kw-chip">مرحبًا، ${esc(name)}</span>` : ''}</div>
      <div class="kw-amount tabular"><span data-cu="wal_lyd" data-to="${bal * rate()}" data-fmt="num">${esc(Number(bal * rate()).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}</span><small>د.ل</small></div>
      <div class="kw-sub">تقريبًا <bdi>${esc(usd(bal))}</bdi></div>
      <div class="kw-actions">
        <button class="kw-btn p" data-act="dock-deposit" type="button">${svg(I.plus)}شحن المحفظة</button>
        <button class="kw-btn s" data-nav="wallet" type="button">${S.config.withdraw && S.config.withdraw.on ? svg(I.withdraw) + 'سحب' : svg(I.wallet2) + 'المحفظة'}</button>
      </div>
    </section>
    <div class="kq">
      <button data-nav="kstore" type="button"><span class="kq-ic">${svg(I.store)}</span>المتجر</button>
      <button data-rscgo="topup" type="button"><span class="kq-ic">${svg(I.game)}</span>شحن ألعاب</button>
      <button data-nav="orders" type="button"><span class="kq-ic">${svg(I.receipt)}</span>طلباتي</button>
      <button data-nav="transactions" type="button"><span class="kq-ic">${svg(I.wallet2)}</span>المعاملات</button>
    </div>
    ${bannersHtml()}
    ${rateNudge()}
    ${rscHome()}
    ${S.config.store_on ? `<div id="storeSec">${storeSection(true)}</div>` : ''}
    ${homeReviews()}
    ${homeFaq()}
  </div>`;
}

/* ═══ v24 — «كيف نحمي أموالك؟» وحالة الخدمة ═══ */
function vTrust() {
  const c = S.config || {};
  const st = (ok, label) => `<div class="flex-between" style="padding:6px 0"><span>${label}</span><b style="color:${ok ? 'var(--success)' : 'var(--warning)'}">${ok ? '🟢 تعمل' : '🟡 متوقفة مؤقتًا'}</b></div>`;
  const mc = c.manual_cards || {};
  return `
  <div class="page-enter">
    <div class="mb-4"><h1 class="h2" style="margin-bottom:6px">كيف نحمي أموالك؟</h1><p class="body-sm text-2">بشفافية: هذا ما نفعله لحماية حسابك وأموالك.</p></div>
    <div class="card mb-4"><div class="h4 mb-2" style="font-size:14px">حالة الخدمة الآن</div>
      ${st(c.maintenance !== true && c.kill_switch !== true, 'المنصة')}${st(mc.enabled !== false, 'إصدار البطاقات')}${st(Object.values(c.methods || {}).some(m => m && m.on !== false), 'الإيداع')}${merchantsOn() ? st(true, 'المتاجر الموثوقة') : ''}</div>
    <div class="faq mb-4">${[
      ['سجل مالي لا يُعدَّل', 'كل حركة في محفظتك (إيداع، بطاقة، رسوم، مكافأة) تُسجَّل بقيد مستقل برقم مرجعي، ولا يمكن تعديلها أو حذفها من الواجهة.'],
      ['بيانات بطاقتك مشفّرة', 'رقم البطاقة وتاريخها مشفّران في الخادم، وCVV يظهر لك مرة واحدة فقط ثم يُحذف.'],
      ['التوثيق قبل المال', 'الإيداع والسحب لا يعملان إلا بعد تأكيد بريدك وتوثيق رقمك، حتى لا يستغل أحد حسابًا باسمك.'],
      ['حدود يومية للعمليات', 'سقف يومي للمبالغ يقلّل الضرر في حال حدوث أي محاولة احتيال على حسابك.'],
      ['مراجعة يدوية للمبالغ الحساسة', 'الإيصالات والتحويلات غير المعتادة يراجعها موظف قبل اعتمادها، ونكشف الإيصالات المكرّرة تلقائيًا.'],
      ['إذا فقدت هاتفك', 'غيّر كلمة المرور فورًا من جهاز آخر وتواصل مع الدعم، ونجمّد الحساب مؤقتًا حتى نتحقق منك.'],
      ['عند وجود مشكلة في طلب', 'افتح تذكرة دعم مع رقم العملية (يبدأ بـ KRD)، فكل عملية مسجّلة عندنا بالتفاصيل.'],
    ].map(([q, x], i) => `<details class="faq-item" ${i === 0 ? 'open' : ''}><summary>${esc(q)}</summary><p>${esc(x)}</p></details>`).join('')}</div>
    <p class="caption mb-4" style="text-align:center">كاردو منصة خدمات رقمية وليست مصرفًا. البطاقات تُصدر عبر مزوّدين خارجيين، وبعض المواقع قد ترفض البطاقات الافتراضية.</p>
    <button class="btn btn-secondary btn-block" data-nav="support" type="button">تواصل مع الدعم</button>
  </div>`;
}
const krdRef = id => id ? 'KRD-' + String(id).replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase() : '';

/* ═══ v21 — أقسام الرئيسية لمنصة البطاقات ═══ */
S.platforms = null; let _plLoading = false;
async function loadPlatforms() {
  if (_plLoading || S.platforms) return;
  _plLoading = true;
  try { S.platforms = (await apiGet('/api/platforms')).platforms || []; } catch { S.platforms = []; }
  _plLoading = false; render();
}
const USE_CASES = [['🎬', 'بث وأفلام'], ['🎵', 'موسيقى'], ['🤖', 'ذكاء اصطناعي'], ['🎮', 'ألعاب'], ['📢', 'إعلانات'], ['🛍️', 'تسوّق'], ['💻', 'برامج'], ['🔁', 'اشتراكات']];
const FAQ = [
  ['كيف أحصل على بطاقتي؟', 'سجّل، واشحن محفظتك بالدينار عبر ليبيانا أو المدار أو التحويل المصرفي، ثم اضغط «إصدار بطاقة». تُصدر خلال دقائق.'],
  ['أين أستطيع استخدامها؟', 'في أغلب المواقع التي تقبل الدفع الإلكتروني. بعض التجار يرفضون البطاقات الافتراضية، لذلك جرّب بمبلغ صغير أولًا.'],
  ['هل أستطيع شحنها لاحقًا؟', 'نعم، من صفحة البطاقة اختر «تعبئة»، وتُخصم من محفظتك بالدينار.'],
  ['ماذا يحدث إذا انتهت باقتي؟', 'بطاقتك الأولى تبقى شغّالة دائمًا. البطاقات الإضافية تُقفل حتى تجدد، وتفتح فور التجديد.'],
];
function cardsInfoSections(hasCard) {
  const mc = S.config.manual_cards || {};
  const fee = (f, p) => `${esc(usd(f ?? 0))} + ${esc(String(p ?? 0))}%`;
  return `
    <div class="h4 mb-3">أين تستخدم بطاقتك؟</div>
    ${(() => { if (S.platforms === null) loadPlatforms();
      const pl = S.platforms || [];
      return pl.length
        ? `<div class="use-grid mb-2 stagger">${pl.map(p => `<div class="use-item"><span class="use-ic use-img"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy"></span><span>${esc(p.name)}</span></div>`).join('')}</div>
           <p class="caption mb-5" style="text-align:center;opacity:.7">الشعارات للتوضيح فقط وهي ملك لأصحابها. قد ترفض بعض المنصات البطاقات الافتراضية.</p>`
        : `<div class="use-grid mb-5 stagger">${USE_CASES.map(([e, t]) => `<div class="use-item"><span class="use-ic">${e}</span><span>${esc(t)}</span></div>`).join('')}</div>`; })()}

    ${hasCard ? '' : `<div class="h4 mb-3">كيف تبدأ في 3 خطوات</div>
    <div class="steps-card mb-5">${[['سجّل حسابك', 'وأكّد بريدك وهاتفك'], ['اشحن محفظتك', 'بالدينار عبر ليبيانا أو المدار أو المصرف'], ['أصدر بطاقتك', 'وابدأ الدفع أونلاين خلال دقائق']].map(([t, d], i) => `
      <div class="step"><span class="step-n">${i + 1}</span><div><b>${t}</b><div class="caption">${d}</div></div></div>`).join('')}</div>`}

    <div class="flex-between mb-3"><div class="h4">الرسوم بشفافية</div><button class="btn btn-ghost btn-sm" data-nav="plans">الباقات ${svg(I.back, 2)}</button></div>
    ${(S.config.card_types || []).length ? `<div class="card fee-card mb-5">${S.config.card_types.map(t => `
      <div><div class="flex-between"><b>${esc(t.name)}${t.badge ? ` <span class="ctype-badge" style="position:static">${esc(t.badge)}</span>` : ''}</b><span class="caption" dir="ltr">$${esc(String(t.min))} – $${esc(String(t.max))}</span></div>
        <div class="flex-between"><span class="body-sm text-2">إصدار</span><b class="tabular" dir="ltr">${fee(t.fee_fixed, t.fee_pct)}</b></div>
        <div class="flex-between"><span class="body-sm text-2">تعبئة</span><b class="tabular" dir="ltr">${fee(t.topup_fixed, t.topup_pct)}</b></div></div>`).join('<div class="divider" style="margin:4px 0"></div>')}
      <div class="caption" style="margin-top:6px">بطاقتك الأولى مجانية دائمًا، والباقات تضيف بطاقات شهريًا.</div></div>` : `<div class="card fee-card mb-5">
      <div class="flex-between"><span class="body-sm text-2">إصدار بطاقة</span><b class="tabular" dir="ltr">${fee(mc.create_fee_fixed, mc.create_fee_pct)}</b></div>
      <div class="flex-between"><span class="body-sm text-2">إعادة التعبئة</span><b class="tabular" dir="ltr">${fee(mc.topup_fee_fixed, mc.topup_fee_pct)}</b></div>
      <div class="flex-between"><span class="body-sm text-2">الحد الأدنى / الأقصى للشحن</span><b class="tabular" dir="ltr">${esc(usd(mc.create_min ?? 10))} – ${esc(usd(mc.create_max ?? 500))}</b></div>
      <div class="caption" style="margin-top:6px">بطاقتك الأولى مجانية دائمًا، والباقات تضيف بطاقات شهريًا.</div>
    </div>`}

    <button class="card ref-strip mb-5" data-nav="referral" type="button">${fennec('success', 54)}
      <span style="flex:1;text-align:right"><b style="display:block">ادعُ صديقًا واربح 🎁</b><span class="caption">تكسب ${esc(usd((S.config.referral || {}).inviter || 1))} عن كل بطاقة يُصدرها صديقك</span></span><span class="prow-add">←</span></button>

    <div class="h4 mb-3">أسئلة شائعة</div>
    <div class="faq mb-5">${FAQ.map(([q, a], i) => `<details class="faq-item" ${i === 0 ? 'open' : ''}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</div>
    <button class="card ref-strip mb-3" data-nav="trust" type="button"><span style="font-size:28px">🛡️</span>
      <span style="flex:1;text-align:right"><b style="display:block">كيف نحمي أموالك؟</b><span class="caption">التشفير، التوثيق، وحالة الخدمة الآن</span></span><span class="prow-add">←</span></button>
    <button class="btn btn-secondary btn-block mb-4" data-nav="support" type="button">تحتاج مساعدة؟ تواصل مع الدعم</button>`;
}

function cardMiniHtml(c) {
  const st = { active: 'نشطة', frozen: 'مجمدة', deleted: 'مغلقة' }[c.status] || '—';
  return `
    <button class="service-card" data-card="${esc(c.id)}" style="padding:0;overflow:hidden;border:none;background:transparent">
      <div class="vcard" style="border-radius:0;aspect-ratio:1.586"><span class="vcard-deco" aria-hidden="true"></span>
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
        <div class="list-meta">${esc(dt(t.created_at))}${t.id ? ` · <span dir="ltr">${esc(krdRef(t.id))}</span>` : ''}</div>
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
      <div class="card k-empty">
        ${fennec('empty', 96)}
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
  const hidden = hiddenCardsCount();
  const cur = allC.find(c => c.id === S.cardSel) || allC.find(c => openIds.has(c.id)) || allC[0];
  const locked = cur && !openIds.has(cur.id);
  const mc = S.config.manual_cards || {};
  const canTop = cur && !locked && cur.status === 'active' && !cardsMaint() && mc.on !== false && mc.topup_on === true;
  return `
  <div class="page-enter">
    <h1 class="kpage-title">بطاقاتي</h1>
    <p class="kpage-sub">بطاقتك الافتراضية للدفع أونلاين · باقة ${esc(PLAN_AR[myPlan()])}</p>
    ${cardsMaintHtml()}
    ${allC.length > 1 ? `<div class="kcards-switch">${allC.map(c => `<button class="${cur && c.id === cur.id ? 'on' : ''}" data-cardsel="${esc(c.id)}" type="button">${openIds.has(c.id) ? '' : '🔒 '}${esc(c.card_name || 'بطاقة')} ••${esc(c.last4 || '')}</button>`).join('')}</div>` : ''}
    ${cur ? `
      ${locked ? `<button class="card mb-4" data-nav="plans" type="button" style="width:100%;text-align:right;padding:14px 16px"><b>البطاقة مقفلة</b><div class="caption">انتهت باقتك — جدّدها لفتح بطاقاتك الإضافية</div></button>` : ''}
      ${renderCard(cur)}
      <div class="kstat">
        <div><small>رصيد البطاقة</small><b class="tabular">${esc(usd(cur.balance))}</b><span class="caption">${cur.balance_updated_at ? 'حُدّث ' + esc(dt(cur.balance_updated_at)) : 'عند الإصدار'}</span></div>
        <div><small>الحالة</small><b style="color:${cur.status === 'active' ? 'var(--u-ok)' : cur.status === 'frozen' ? '#4A7CA6' : 'var(--u-ink-3)'}">${cur.status === 'active' ? 'نشطة' : cur.status === 'frozen' ? '❄ مجمّدة' : 'موقوفة'}</b></div>
      </div>
      ${cur.status === 'frozen' ? `<div class="alert alert-info mb-3">${svg(I.lock, 2)}<div><b>البطاقة مجمّدة مؤقتًا</b> — ما تقدرش تعرض بياناتها أو تشحنها حتى يُفك التجميد. تواصل مع الدعم.</div></div>` : ''}
      <div class="kacts">
        <button data-cardview="${esc(cur.id)}" type="button" ${locked || cur.status !== 'active' ? 'disabled' : ''}>${svg(I.lock)}عرض البيانات</button>
        <button data-cardtop="${esc(cur.id)}" type="button" ${canTop ? '' : 'disabled'}>${svg(I.plus)}${canTop ? 'تعبئة' : 'التعبئة متوقفة'}</button>
        <button data-cardotp type="button" ${locked || cur.status !== 'active' ? 'disabled' : ''}>${svg(I.shield)}رمز التحقق</button>
      </div>` : `
      <div class="card mb-5" style="text-align:center;padding:36px 20px">${fennec('card')}
        <div class="h4" style="margin-bottom:6px">لا بطاقات بعد</div>
        <p class="body-sm text-2">أصدر بطاقتك الافتراضية واستخدمها للدفع أونلاين</p></div>`}
    ${hidden ? `<button class="card mb-3" data-nav="plans" type="button" style="width:100%;text-align:right;padding:14px 16px"><b>${hidden} ${hidden === 1 ? 'بطاقة مقفلة' : 'بطاقات مقفلة'}</b><div class="caption">جدّد باقتك لفتحها</div></button>` : ''}
    <button class="knew" data-action="newCard" type="button"><span>${svg(I.plus)}</span>إصدار بطاقة جديدة</button>
  </div>`;
}

function renderCard(c) {
  const cls = c.status === 'frozen' || c.status === 'deleted' ? 'frozen' : '';
  return `<div class="kc ${cls}"><img class="kc-fox" src="./kardo-mark.png" alt="" aria-hidden="true">
    <div class="kc-top"><span>${esc(c.card_name || 'بطاقة كاردو')}</span><span class="kc-brand">KARDO</span></div>
    <div class="kc-chip"></div>
    <div class="kc-num">•••• •••• •••• ${esc(c.last4 || '0000')}</div>
    <div class="kc-bot"><div><small>CARD HOLDER</small><b>${esc((c.name_on_card || '—').slice(0, 20))}</b></div>
      <div><small>STATUS</small><b>${c.status === 'active' ? 'ACTIVE' : c.status === 'frozen' ? 'FROZEN' : 'CLOSED'}</b></div></div>
  </div>`;
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
      <div class="balance-value tabular" data-cu="wal_lyd" data-to="${n(S.profile.wallet_balance) * rate()}" data-fmt="lyd">${lyd(S.profile.wallet_balance * rate())}</div>
      <div class="balance-secondary tabular" data-cu="wal_usd" data-to="${n(S.profile.wallet_balance)}" data-fmt="usd">${usd(S.profile.wallet_balance)}</div>

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
      <div class="card k-empty">
        ${fennec('empty', 96)}
        <div class="h4" style="margin-bottom:8px">لا إيداعات بعد</div>
        <p class="body-sm text-2">أضف رصيدًا لتبدأ استخدام الخدمات.</p>
        <button class="btn btn-primary" data-action="deposit" type="button">إيداع رصيد</button>
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
  rsc_order: 'شراء من متجر كاردو', rsc_refund: 'استرداد طلب متجر', service_order: 'شراء خدمة', service_order_rejected: 'استرداد خدمة', store_order: 'شراء من المتجر', order_rejected: 'استرداد طلب',
  card_create: 'إصدار بطاقة', card_topup: 'شحن بطاقة', card_rejected_refund: 'استرداد طلب بطاقة', withdraw_request: 'سحب',
  withdraw_rejected: 'استرداد سحب', transfer_out: 'تحويل صادر', transfer_in: 'تحويل وارد', points_redeem: 'استبدال نقاط',
  promo_first: 'هدية أول شحنة 🎁',
  referral_bonus_invitee: 'مكافأة دعوة', referral_bonus_inviter: 'مكافأة دعوة', plan_basic: 'باقة الأساسي', plan_vip: 'باقة VIP' };
function subscribeLedger() {
  if (S._ledgerSub || !S.user) return;
  S._ledgerSub = true;
  S.unsub.push(onSnapshot(query(collection(db, 'wallet_transactions'), where('uid', '==', S.user.uid), limit(80)), s => {
    S.ledger = s.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.seq || 0) - (a.seq || 0) || String(b.created_at).localeCompare(String(a.created_at)));
    render();
  }, e => { S._ledgerSub = false; console.warn('ledger:', e.code); }, 120000));   // v51: كل دقيقتين (والتحديث الفوري بعد أي عملية باقٍ)
}
function ledgerRow(t) {
  const inc = t.type === 'credit';
  return `
    <div class="list-row" style="cursor:default">
      <div class="list-icon ${inc ? 'success' : 'error'}">${svg(inc ? I.down : I.up, 2)}</div>
      <div class="list-content">
        <div class="list-title">${esc(REASON_AR[t.reason] || 'عملية')}</div>
        <div class="list-meta">${esc(dt(t.created_at))} · <span dir="ltr">${esc(krdRef(t.reference || t.id))}</span>${t.note ? ' · ' + esc(t.note) : ''}</div>
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
      <div class="card k-empty">
        ${fennec('empty', 96)}
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
    ...rscOrderRows(),
  ].sort((a, b) => b.t - a.t);
  return `
  <div class="page-enter">
    <div class="mb-5"><h1 class="h2" style="margin-bottom:6px">طلباتي</h1>
      <p class="body-sm text-2">مشترياتك من المتجر وطلبات بطاقاتك في مكان واحد</p></div>
    ${(S.mCases || []).length ? `<div class="h4 mb-2">بلاغاتي</div><div class="list mb-4">${(S.mCases || []).map(r => `
      <div class="list-row" data-mcase="${esc(r.id)}" role="button" tabindex="0"><div class="list-icon brand">⚑</div>
        <div class="list-content"><div class="list-title">${esc(r.merchant_name)} — ${esc(r.reason)}</div><div class="list-meta">${esc(dt(r.updated_at || r.created_at))}</div></div>
        <div class="list-end"><span class="badge ${r.status === 'open' ? 'badge-warning' : 'badge-success'}">${r.status === 'open' ? 'مفتوح' : 'محلول'}</span></div></div>`).join('')}</div>` : ''}
    ${rows.length ? `<div class="list">${rows.map(r => r.html).join('')}</div>` : `
      <div class="card" style="text-align:center;padding:44px 20px">
        ${fennec('empty', 130)}
        <div class="h4" style="margin-bottom:6px">لا طلبات بعد</div>
        <p class="body-sm text-2 mb-4">مشترياتك من متجر كاردو تظهر هنا مع أكوادها</p>
        <button class="btn btn-primary btn-sm" data-nav="${rscOn() ? 'kstore' : 'cards'}" style="padding:0 20px">${rscOn() ? 'تسوّق الآن' : 'بطاقاتي'}</button>
      </div>`}
  </div>`;
}

S.ref = null; let _refLoading = false;
async function loadRef() {
  if (_refLoading || S.ref) return;
  _refLoading = true;
  try { S.ref = await api('/api/ref/code', {}); } catch (e) { S.ref = { error: e.message }; }
  _refLoading = false; render();
}
const refLink = code => `https://kardo.ly/login.html?mode=signup&ref=${encodeURIComponent(code)}`;
function vReferral() {
  const r = S.config.referral || {};
  if (!r.on) {
    return `
    <div class="page-enter">
      <div class="mb-6"><h1 class="h2">ادعُ صديقًا</h1></div>
      <div class="card k-empty">
        ${fennec('wait', 96)}
        <div class="h4" style="margin-bottom:8px">غير متاح حاليًا</div>
        <p class="body-sm text-2">سنفعّل نظام الدعوات قريبًا.</p>
      </div>
    </div>`;
  }
  if (!S.ref) loadRef();
  const code = (S.ref && S.ref.code) || S.profile.ref_code || '';
  const used = S.profile.referred_by || (S.ref && S.ref.used);
  const count = Math.floor(Number(S.profile.referrals_count || (S.ref && S.ref.referrals) || 0));
  const earned = Number(S.profile.referral_earned || (S.ref && S.ref.earned) || 0);
  return `
  <div class="page-enter">
    <div class="mb-5">
      <h1 class="h2" style="margin-bottom:6px">ادعُ صديقًا</h1>
      <p class="body-sm text-2">تكسب <b style="color:var(--brand)">${esc(usd(r.inviter))}</b> في محفظتك عن <b>كل بطاقة</b> يُصدرها صديق دخل برمزك${r.invitee > 0 ? `، وصديقك يأخذ ${esc(usd(r.invitee))} هدية` : ''}.</p>
    </div>

    <div class="card ref-hero mb-4">
      <div class="field-label">رمزك</div>
      <div class="copy-box" style="margin-bottom:12px">
        <div class="copy-value ref-code" id="refCode" dir="ltr">${code ? esc(code) : '• • • • • •'}</div>
        <button class="copy-btn" id="refCopy" aria-label="نسخ" ${code ? '' : 'disabled'}>${svg(I.copy, 2)}</button>
      </div>
      <button class="btn btn-primary btn-block" id="refShare" type="button" ${code ? '' : 'disabled'}>مشاركة رابط الدعوة</button>
    </div>

    <div class="m-stats mb-4">
      <div class="card"><div class="caption">أصدقاء دخلوا برمزك</div><b class="tabular">${count}</b></div>
      <div class="card"><div class="caption">أرباحك من الدعوات</div><b class="tabular">${esc(usd(earned))}</b></div>
    </div>

    ${used ? `<div class="alert alert-success mb-4">✅<div>سُجّل عندك رمز دعوة${S.profile.referred_code ? ` (<span dir="ltr">${esc(S.profile.referred_code)}</span>)` : ''} — تحصل على هديتك عند إصدار أول بطاقة.</div></div>`
      : `<div class="card mb-4"><div class="h4" style="font-size:14px;margin-bottom:8px">عندك رمز دعوة من صديق؟</div>
          <div class="m-chat-in"><input class="input" id="refIn" dir="ltr" maxlength="8" placeholder="أدخل الرمز" autocapitalize="characters" style="text-transform:uppercase;letter-spacing:.12em"><button class="btn btn-secondary btn-sm" id="refUse" type="button">تفعيل</button></div>
          <div class="caption" style="margin-top:6px">يُقبل فقط قبل إصدار أول بطاقة لك.</div></div>`}

    <div class="card">
      <div class="h4" style="margin-bottom:16px">كيف تعمل؟</div>
      <div class="stack">
        ${[['شارك رمزك أو رابطك مع أصدقائك', ''], ['يسجّل صديقك ويكتب رمزك عند إنشاء الحساب', ''], ['يُصدر بطاقته (وكل بطاقة بعدها)', ''], [`يُضاف ${usd(r.inviter)} لمحفظتك عن كل بطاقة، وتصرفه داخل كاردو`, '']].map(([t], i) => `
        <div style="display:flex;gap:12px;align-items:flex-start"><span class="badge badge-neutral" style="flex-shrink:0">0${i + 1}</span><div class="body-sm text-2">${esc(t)}</div></div>`).join('')}
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
      <div class="card k-empty">
        ${fennec('empty', 90)}
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
  const email = S.profile.email || S.user?.email || '';
  const ch = svg(I.next);
  const row = (attrs, ic, title, end = '', cls = '') => `<button class="kset-row ${cls}" ${attrs} type="button">
      <span class="kset-ic">${svg(ic)}</span><span class="kset-t">${title}</span>${end}<span class="kset-ch">${ch}</span></button>`;
  return `
  <div class="page-enter settings-page">
    <div class="kme">
      <div class="kme-av" aria-hidden="true">${esc((nm.trim()[0] || 'ك').toUpperCase())}</div>
      <div class="kme-main">
        <div class="kme-name">${esc(nm)}</div>
        <div class="kme-mail" dir="ltr">${esc(email)}</div>
        <div class="kme-tags">
          <span class="kme-tag gold">باقة ${esc(PLAN_AR[myPlan()])}</span>
          ${S.profile.email_verified ? '<span class="kme-tag ok">البريد مؤكَّد</span>' : ''}
          ${S.profile.phone_verified ? '<span class="kme-tag ok">الرقم موثّق</span>' : ''}
        </div>
      </div>
    </div>

    <div class="kset-label">حسابي</div>
    <div class="kset">
      ${row('data-nav="orders"', I.receipt, 'طلباتي')}
      ${row('data-nav="wallet"', I.wallet2, 'المحفظة', `<span class="kset-v tabular">${esc(lyd(n(S.profile.wallet_balance) * rate()))}</span>`)}
      ${row('data-nav="transactions"', I.list, 'المعاملات')}
      ${row('data-nav="invoices"', I.receipt, 'فواتيري')}
      ${(S.manualCards || []).length ? row('id="kPinReset"', I.lock, 'الرمز السري للبطاقات', '<span class="kset-v">تغيير</span>') : ''}
      ${row('data-howto="all"', I.help, 'كيف أدفع؟', '<span class="kset-v">شرح بالصور</span>')}
      ${row('id="kInstall"', I.download || I.out, 'تثبيت التطبيق', isStandalone() ? '<span class="kset-v" style="color:var(--u-ok)">مثبّت ✓</span>' : '<span class="kset-v">أسرع وأخف</span>')}
      ${row('data-nav="plans"', I.star, 'الباقات', `<span class="kset-v">${esc(PLAN_AR[myPlan()])}</span>`)}
      ${row('data-nav="referral"', I.giftbox, 'ادعُ صديقًا واربح')}
    </div>

    <div class="kset-label">التفضيلات</div>
    <div class="kset">
      <div class="kset-row static"><span class="kset-ic">${svg(I.sun)}</span><span class="kset-t">المظهر</span>
        <div class="kseg">${[['auto', 'تلقائي'], ['light', 'نهاري'], ['dark', 'ليلي']].map(([k, t]) => `<button class="${themePref() === k ? 'on' : ''}" data-theme-set="${k}" type="button">${t}</button>`).join('')}</div></div>
      <label class="kset-row static" for="notifyEmail"><span class="kset-ic">${svg(I.bell)}</span>
        <span class="kset-t">إشعارات البريد<small>${S.profile.email_verified ? 'تصل إلى بريدك المؤكَّد' : 'تصل إلى بريدك'}</small></span>
        <input type="checkbox" class="kswitch" id="notifyEmail" ${S.profile.notify_email === false ? '' : 'checked'}></label>
      ${pushOn() ? '' : row('id="pushOn"', I.bell, 'تفعيل إشعارات الهاتف')}
      ${needsEmailVerify() ? row('id="evOpen2"', I.check, 'تأكيد البريد الإلكتروني', '<span class="kset-dot"></span>') : ''}
    </div>

    <div class="kset-label">الأمان</div>
    <div class="kset">
      ${S.profile.phone_verified
        ? `<div class="kset-row static"><span class="kset-ic">${svg(I.shield)}</span><span class="kset-t">رقم الهاتف</span><span class="kset-v" dir="ltr">0${esc(S.profile.phone_verified)}</span></div>`
        : row('id="verifyPhoneBtn"', I.shield, 'توثيق رقم الهاتف<small>مطلوب للإيداع عبر ليبيانا والمدار</small>', '<span class="kset-dot"></span>')}
      ${row('id="changePass"', I.lock, 'تغيير كلمة المرور')}
      ${row('data-nav="trust"', I.shield, 'كيف نحمي أموالك؟')}
    </div>

    <div class="kset-label">المعلومات الشخصية</div>
    <div class="kset kset-form">
      <label class="field-label" for="pName">الاسم</label>
      <div class="kset-inline"><input class="input" id="pName" value="${esc(S.profile.name || '')}" autocomplete="name">
        <button class="btn btn-secondary" id="saveProfile" type="button">حفظ</button></div>
    </div>

    <div class="kset-label">المساعدة</div>
    <div class="kset">
      ${row('data-nav="support"', I.help, 'الدعم والتذاكر')}
      <a class="kset-row" href="./terms.html" target="_blank" rel="noopener"><span class="kset-ic">${svg(I.list)}</span><span class="kset-t">الشروط والأحكام</span><span class="kset-ch">${ch}</span></a>
      <a class="kset-row" href="./terms.html#privacy" target="_blank" rel="noopener"><span class="kset-ic">${svg(I.lock)}</span><span class="kset-t">سياسة الخصوصية</span><span class="kset-ch">${ch}</span></a>
    </div>

    <div class="kset">
      <button class="kset-row danger" id="doLogout" type="button"><span class="kset-ic">${svg(I.out)}</span><span class="kset-t">تسجيل الخروج</span></button>
    </div>
    <p class="kme-foot">كاردو · kardo.ly</p>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════
   Plans
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   Bind Events
   ═══════════════════════════════════════════════════════════ */

function bind() {
  bindMarket();
  bindRsc();
  bindInvoices();
  $$('[data-theme-set]').forEach(b => b.onclick = () => { try { localStorage.setItem('kardo_theme', b.dataset.themeSet); } catch {} if (window.kardoTheme) window.kardoTheme(); render(); });
  $$('[data-nav]').forEach(b => b.onclick = () => go(b.dataset.nav));

  $$('[data-action]').forEach(b => {
    b.onclick = () => {
      const a = b.dataset.action;
      if (a === 'deposit') return openDeposit();
      if (a === 'new-card') return openNewCard();
      if (a === 'newCard') return cardsMaint() ? toast('قسم البطاقات قيد الصيانة حاليًا', 'bad') : openNewCard();
      if (a === 'transfer') return openTransfer();
      if (a === 'withdraw') return openWithdraw();
    };
  });

  $$('[data-card]').forEach(b => b.onclick = () => openCardDetails(b.dataset.card));
  $$('[data-cardview]').forEach(b => b.onclick = () => { const c = (S.manualCards || []).find(x => x.id === b.dataset.cardview); if (c) openVault(c); });
  $$('[data-cardsel]').forEach(b => b.onclick = () => { S.cardSel = b.dataset.cardsel; render(); });
  $$('[data-cardtop]').forEach(b => b.onclick = () => { const c = (S.manualCards || []).find(x => x.id === b.dataset.cardtop); if (c) openCardTopup(c); });
  $$('[data-cardotp]').forEach(b => b.onclick = () => openOtp());

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
    const code = $('#refCode').textContent.trim();
    try { await navigator.clipboard.writeText(code); toast('نُسخ الرمز', 'ok'); }
    catch { toast('تعذّر النسخ', 'bad'); }
  });
  onTap('#refShare', async () => {
    const code = ($('#refCode').textContent || '').trim(); if (!/^[A-Z2-9]{6}$/.test(code)) return;
    const text = `انضم إلى كاردو — بطاقة فيزا افتراضية تُشحن بالدينار. استخدم رمزي ${code} عند التسجيل لتحصل على هدية 🎁`;
    try { if (navigator.share) await navigator.share({ title: 'كاردو', text, url: refLink(code) }); else { await navigator.clipboard.writeText(`${text}\n${refLink(code)}`); toast('نُسخ رابط الدعوة', 'ok'); } } catch {}
  });
  onTap('#refUse', async () => {
    const code = ($('#refIn').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z2-9]{6}$/.test(code)) return toast('رمز غير صحيح (6 أحرف وأرقام)', 'bad');
    const b = $('#refUse'); b.disabled = true; b.classList.add('loading');
    try { await api('/api/ref/claim', { code }); toast('سُجّل رمز الدعوة ✓', 'ok'); S.profile = { ...S.profile, referred_by: 'x', referred_code: code }; render(); }
    catch (e) { toast(e.message, 'bad'); b.disabled = false; b.classList.remove('loading'); }
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

function typeRulesHtml(t) {
  if (!t) return '';
  const lines = String(t.rules || '').split('\n').map(x => x.trim()).filter(Boolean);
  const banned = String(t.blocked || '').split(/[\n،,]/).map(x => x.trim()).filter(Boolean);
  return `<div style="padding-bottom:12px">
    <div class="caption" style="margin-bottom:6px;color:${t.supports_3d ? 'var(--success)' : 'var(--warning)'}">${t.supports_3d ? '✅ تدعم رمز التحقق 3D Secure' : '⚠️ لا تدعم رمز التحقق 3D Secure — المواقع التي تطلبه قد ترفضها'}</div>
    ${lines.length ? `<ul style="margin:0;padding-inline-start:18px">${lines.map(x => `<li class="body-sm text-2" style="margin-bottom:4px">${esc(x)}</li>`).join('')}</ul>` : ''}
    ${banned.length ? `<div class="caption" style="margin-top:6px"><b>🚫 محظور:</b> ${banned.map(esc).join('، ')}</div>` : ''}</div>`;
}
async function openNewCard() {
  if (!canIssueCard()) return openPlanLimit();
  const mc = S.config.manual_cards || {};
  const mn = mc.create_min || 10;
  const mx = mc.create_max || 500;
  let ff = mc.create_fee_fixed || 8;
  let fp = mc.create_fee_pct || 2.5;
  const types = (S.config.card_types || []);
  let selType = types[0] || null;
  if (selType) { ff = selType.fee_fixed; fp = selType.fee_pct; }

  modal(`
    <div class="modal-head">
      <div class="modal-title">إصدار بطاقة جديدة</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>

    ${types.length ? `<div class="field-label mb-2">نوع البطاقة</div>
      <div class="ctype-grid mb-3">${types.map((t, i) => `<button type="button" class="ctype ${i === 0 ? 'on' : ''}" data-ctype="${esc(t.id)}">
        ${t.badge ? `<span class="ctype-badge">${esc(t.badge)}</span>` : ''}<b>${esc(t.name)}</b>
        <span class="tabular ctype-fee" dir="ltr">$${esc(String(t.fee_fixed))}${t.fee_pct ? ` + ${esc(String(t.fee_pct))}%` : ''}</span>
        <span class="caption">${esc(t.desc || '')}</span><span class="caption" dir="ltr">$${esc(String(t.min))} – $${esc(String(t.max))}</span></button>`).join('')}</div>` : ''}

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
      <label class="field-label" id="ncRange">المبلغ (من ${selType ? selType.min : mn} إلى ${selType ? selType.max : mx} دولار)</label>
      <input class="input" id="ncAmount" type="number" step="0.5" min="${mn}" max="${mx}" placeholder="${mn}">
    </div>

    <div id="ncQuote"></div>
    ${types.length ? `<details class="faq-item mb-3" id="ncRulesBox" open><summary>📋 قوانين بطاقة <span id="ncRulesName">${esc(selType ? selType.name : '')}</span></summary><div id="ncRules">${typeRulesHtml(selType)}</div></details>` : ''}

    <div class="field-label">قبل الإصدار</div>
    <div class="list mb-3">${cardPoints().map(([t, d]) => `<div class="list-row" style="cursor:default"><span class="list-icon" style="width:34px !important;height:34px !important">${svg(I.check)}</span>
      <div class="list-content"><div class="list-title">${esc(t)}</div>${d ? `<div class="list-meta">${esc(d)}</div>` : ''}</div></div>`).join('')}</div>
    <label class="kagree"><input type="checkbox" class="kcheck" id="ncAccept">
      <span>قرأت وأوافق على <button type="button" class="klink" id="ncTermsT">الشروط كاملة</button></span></label>
    <div id="ncTerms" class="kterms" hidden>
      ${String(mc.warning || '').trim() ? String(mc.warning).split(/\n+/).map(l => `<p>${esc(l)}</p>`).join('') : ''}
      <ul>
        <li>للدفع أونلاين فقط، لا تعمل في الصراف أو نقاط البيع.</li>
        <li>رمز CVV يظهر مرة واحدة فقط خلال ${n(mc.cvv_minutes) || 5} دقائق من الإصدار، ورقم البطاقة لمدة ${n(mc.reveal_hours) || 24} ساعة. احفظهما فورًا.</li>
        <li>رسوم الإصدار لا تُسترد بعد إصدار البطاقة.</li>
        <li>بعض المواقع قد ترفض البطاقات الافتراضية.</li>
        <li>بعض المواقع تطلب رمز تحقق 3D Secure، وتُخصم ${esc('$' + Number(mc.otp_fee ?? 0.03).toFixed(2))} عن كل عملية تحقق.</li>
        <li>يُمنع استخدامها في القمار أو أي نشاط غير قانوني، والمخالفة توقف البطاقة والحساب.</li>
        <li>الاسم على البطاقة لا يمكن تعديله بعد الإصدار.</li>
      </ul>
      <a href="./terms.html#cards" target="_blank" rel="noopener" class="klink">صفحة الشروط والأحكام</a>
    </div>

    <button class="btn btn-primary btn-block" id="ncSubmit" style="margin-top:16px" disabled>
      إصدار البطاقة
    </button>
  `);

  onTap('#ncTermsT', () => { const t = $('#ncTerms'); if (t) t.hidden = !t.hidden; });
  const calc = () => {
    const a = n($('#ncAmount').value);
    const box = $('#ncQuote');
    const btn = $('#ncSubmit');
    const tmn = selType ? selType.min : mn, tmx = selType ? selType.max : mx;
    if (!(a >= tmn && a <= tmx)) { box.innerHTML = a ? `<div class="caption" style="color:var(--warning)">المبلغ من ${tmn} إلى ${tmx} دولار</div>` : ''; btn.disabled = true; return; }
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
  $$('[data-ctype]').forEach(b => b.onclick = () => {
    selType = types.find(t => t.id === b.dataset.ctype) || selType;
    $$('[data-ctype]').forEach(x => x.classList.toggle('on', x === b));
    ff = selType.fee_fixed; fp = selType.fee_pct;
    const r = $('#ncRange'); if (r) r.textContent = `المبلغ (من ${selType.min} إلى ${selType.max} دولار)`;
    const rb = $('#ncRules'); if (rb) rb.innerHTML = typeRulesHtml(selType);
    const rn = $('#ncRulesName'); if (rn) rn.textContent = selType.name;
    calc();
  });

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
        type_id: selType ? selType.id : '',
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

function savedPhones() { try { return JSON.parse(localStorage.getItem('kardo_phones') || '[]').filter(x => /^0\d{9}$/.test(x)).slice(0, 4); } catch { return []; } }
function rememberPhone(p) { try { const l = [p, ...savedPhones().filter(x => x !== p)].slice(0, 4); localStorage.setItem('kardo_phones', JSON.stringify(l)); } catch {} }
async function openDepositMethod(method, presetLyd) {
  if (secBlock('deposit')) return;
  const manualMode = (((S.config.methods || {})[method] || {}).mode || S.config.deposit_mode) === 'manual';
  const m = S.config.methods?.[method] || {};
  const phone = m.phone || S.config.deposit_phone || '';
  const rateVal = n(m.rate) || rate();
  const label = method === 'almadar' ? 'المدار' : 'ليبيانا';
  let amount = n(presetLyd) || 0;
  const saved = savedPhones();
  const verified = (v => /^0\d{9}$/.test(v) ? v : '')('0' + String(S.profile.phone_verified || '').replace(/\D/g, '').slice(-9));
  const def = saved[0] || verified;
  const all = [...new Set([...saved, verified].filter(Boolean))];
  modal(`
    <div class="modal-head"><div class="modal-title">شحن عبر ${label}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    <div class="kprog"><i class="d"></i><i class="a"></i><i></i></div>
    <div class="kprog-l"><span>المبلغ</span><span>حوّل الرصيد</span><span>أُضيف الرصيد</span></div>
    ${amount > 0 ? `<div style="text-align:center;margin:6px 0 14px"><div class="caption">حوّل رصيد ${label} بقيمة</div>
      <div class="kinv-big tabular">${esc(String(amount))} <small>د.ل</small></div><div class="caption">يُضاف لمحفظتك ${esc(usd(amount / rateVal))}</div></div>` : `
    <div class="field mb-3"><label class="field-label" for="dpAmount">المبلغ (بالدينار)</label>
      <input class="input" id="dpAmount" type="number" inputmode="decimal" step="1" placeholder="100"><span class="field-hint" id="dpQuote"></span></div>`}
    ${phone ? `<div class="field-label">حوّل إلى الرقم</div>
      <div class="copy-box mb-2"><div class="copy-value tabular" dir="ltr" style="font-size:17px;font-weight:600">${esc(phone)}</div>
        <button class="copy-btn" data-act="copy" data-copy-text="${esc(phone)}" aria-label="نسخ الرقم">${svg(I.copy, 2)}</button></div>` : ''}
    ${amount > 0 ? `<div class="copy-box mb-3"><div class="copy-value tabular" dir="ltr">${esc(String(amount))}</div>
        <button class="copy-btn" data-act="copy" data-copy-text="${esc(String(amount))}" aria-label="نسخ المبلغ">${svg(I.copy, 2)}</button></div>` : ''}
    <div class="field mb-3" style="margin-top:12px">
      <label class="field-label" for="dpPhone">رقمك اللي حوّلت منه</label>
      ${all.length ? `<div class="kchips" style="margin-bottom:8px">${all.map(x => `<button type="button" data-ph="${esc(x)}" class="${x === def ? 'on' : ''}" dir="ltr">${esc(x)}</button>`).join('')}</div>` : ''}
      <input class="input" id="dpPhone" dir="ltr" inputmode="numeric" maxlength="14" placeholder="0912345678" value="${esc(def)}">
      <span class="field-hint">${manualMode ? 'يُراجع الإيداع ويُضاف خلال وقت قصير' : 'حوّل أولًا، بعدين اضغط الزر — يُضاف تلقائيًا فور وصول الحوالة'}</span>
    </div>
    <button class="btn btn-primary btn-block" id="dpSubmit" type="button">حوّلت الرصيد</button>
    <button class="kinv-how" data-howto="${esc(method)}" type="button" style="margin-top:10px">${svg(I.help)} كيف أحوّل الرصيد؟</button>`);
  _htBack = () => openDepositMethod(method, presetLyd);
  $$('[data-ph]').forEach(b => b.onclick = () => { $('#dpPhone').value = b.dataset.ph; $$('[data-ph]').forEach(x => x.classList.toggle('on', x === b)); });
  if ($('#dpAmount')) $('#dpAmount').oninput = () => { const a = n($('#dpAmount').value); $('#dpQuote').textContent = a > 0 ? 'يُضاف ' + usd(a / rateVal) : ''; };
  onTap('#dpSubmit', async () => {
    const btn = $('#dpSubmit');
    const amt = amount > 0 ? amount : n($('#dpAmount').value);
    if (!(amt > 0)) return toast('أدخل المبلغ', 'bad');
    const phoneIn = $('#dpPhone').value.replace(/\D/g, '');
    if (phoneIn.length < 10) return toast('اكتب رقمك كاملًا (10 أرقام)', 'bad');
    btn.disabled = true; btn.classList.add('loading');
    try {
      const r = await api('/api/wallet/claim', { amount_lyd: amt, method, phone: phoneIn });
      if (/^0\d{9}$/.test(phoneIn)) rememberPhone(phoneIn);
      if (r.matched) anEv('paid');
      if (r.matched && CHECKOUT) { toast('أُضيف ' + usd(r.credited_usd) + ' — نكمل الشراء…', 'ok'); return completeCheckout(); }
      if (r.matched) stickerModal('deposit', 'success', 'تم الإيداع ✓', 'أُضيف ' + usd(r.credited_usd) + ' إلى محفظتك.');
      else if (r.manual) stickerModal('wait', 'wait', 'وصل طلب الإيداع', 'يُضاف الرصيد بعد المراجعة خلال وقت قصير.');
      else stickerModal('wait', 'wait', 'في انتظار الحوالة', CHECKOUT ? 'يُضاف الرصيد فور وصول الحوالة، وبعدها كمّل شراء «' + CHECKOUT.name + '» من المتجر.' : 'سيُضاف الرصيد تلقائيًا فور وصول الحوالة.');
      if (!r.matched) CHECKOUT = null;
    } catch (e) { toast(e.message, 'bad'); btn.disabled = false; btn.classList.remove('loading'); }
  });
}

async function openCardDetails(cardId) {
  const c = S.manualCards.find(x => x.id === cardId);
  if (!c) return;

  let orders = S.manualOrders || [];
  if (!orders.some(o => o.card_id === cardId && o.kind === 'create')) {
    try { const r = await api('/api/mcard/list', {}); orders = r.orders || []; } catch {}
  }
  const lastOrder0 = orders.find(o => o.card_id === cardId && o.kind === 'create' && o.status === 'completed');
  const lastOrder = c.reveal_order ? { id: c.reveal_order } : lastOrder0;   // بطاقة مُستبدلة → مفتاح العرض الجديد

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
        <span class="badge ${c.status === 'active' ? 'badge-success' : 'badge-neutral'}">${c.status === 'active' ? 'نشطة' : c.status === 'frozen' ? '❄ مجمّدة مؤقتًا' : 'موقوفة'}</span>
      </div>
    </div>

    ${c.billing_address ? `
      <div class="field mb-4">
        <div class="field-label">📍 عنوان البطاقة (Billing Address)</div>
        <div class="copy-box" style="align-items:flex-start">
          <div class="copy-value" dir="ltr" style="font-size:13px;white-space:pre-line;text-align:left;line-height:1.7">${esc(c.billing_address)}</div>
          <button class="copy-btn" id="addrCopy" aria-label="نسخ العنوان">${svg(I.copy, 2)}</button>
        </div>
        <div class="caption" style="margin-top:4px">استخدم هذا العنوان عند الدفع إذا طُلب منك عنوان الفوترة.</div>
      </div>` : ''}

    ${c.status === 'active' ? (!cardsMaint() && (S.config.manual_cards || {}).on !== false && (S.config.manual_cards || {}).topup_on === true ? `
      <button class="btn btn-primary btn-block mb-2" id="topupBtn" type="button">↻ إعادة تعبئة البطاقة</button>` : `
      <button class="btn btn-secondary btn-block mb-2" type="button" disabled style="opacity:.55;cursor:not-allowed">${cardsMaint() ? '🛠️ إعادة التعبئة متوقفة — قيد الصيانة' : '↻ إعادة التعبئة غير متاحة حاليًا'}</button>`) : ''}

    ${c.status === 'frozen' ? `<div class="alert alert-info mb-3">${svg(I.lock, 2)}<div><b>البطاقة مجمّدة مؤقتًا.</b> لا يمكن عرض بياناتها أو شحنها حتى يُفك التجميد — تواصل مع الدعم.</div></div>` : ''}
    ${(c.vault || lastOrder) && c.status === 'active' ? `
      <button class="btn btn-primary btn-block mb-2" id="revealBtn">
        ${svg(I.lock, 2)} عرض بيانات البطاقة
      </button>
      <div class="caption mb-3" style="text-align:center">تحتاج رمزك السري (PIN) — تظهر 60 ثانية</div>
    ` : c.status !== 'active' ? '' : `
      <div class="alert alert-warning mb-3">${svg(I.help, 2)}<div>لم تُسلَّم بيانات البطاقة بعد.</div></div>
    `}

    ${c.status === 'active' && (() => { const ct = (S.config.card_types || []).find(t => t.id === c.type_id); return !ct || ct.supports_3d !== false; })()
      ? `<button class="btn btn-secondary btn-block mb-2" id="otpBtn" type="button">رمز التحقق عند الدفع (3D Secure)</button>`
      : c.status === 'active' ? `<div class="caption mb-2" style="text-align:center;color:var(--warning)">⚠️ هذه البطاقة لا تدعم رمز التحقق 3D Secure</div>` : ''}
    <button class="btn btn-secondary btn-block" data-act="close-modal">إغلاق</button>
  `);

  onTap('#otpBtn', () => openOtp());
  onTap('#topupBtn', () => openCardTopup(c));
  onTap('#addrCopy', async () => {
    try { await navigator.clipboard.writeText(c.billing_address); toast('نُسخ العنوان', 'ok'); } catch { toast('تعذّر النسخ', 'bad'); }
  });
  onTap('#revealBtn', () => openVault(c));
}

/* ═══ v41 — إعادة تعبئة البطاقة ═══ */
function openCardTopup(c) {
  const mc = S.config.manual_cards || {};
  const ct = (S.config.card_types || []).find(t => t.id === c.type_id);
  const ff = n(ct ? ct.topup_fixed : mc.topup_fee_fixed), fp = n(ct ? ct.topup_pct : mc.topup_fee_pct);
  const mn = n(mc.topup_min) || 10, mx = n(mc.topup_max) || 500;
  modal(`
    <div class="modal-head">
      <div class="modal-title">إعادة تعبئة ${esc(c.card_name || 'البطاقة')} ••${esc(c.last4 || '')}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button>
    </div>
    <p class="caption mb-3">رصيد البطاقة الحالي ${esc(usd(c.balance))} · رصيد محفظتك ${esc(usd(S.profile.wallet_balance))}</p>
    <div class="field mb-3">
      <label class="field-label" for="tuAmount">المبلغ (من ${mn} إلى ${mx} دولار)</label>
      <input class="input tabular" id="tuAmount" type="number" inputmode="decimal" min="${mn}" max="${mx}" step="1" dir="ltr" placeholder="${mn}">
    </div>
    <div class="caption mb-3">رسوم التعبئة: ${esc(usd(ff))} + ${esc(String(fp))}%</div>
    <div id="tuQuote" class="mb-3"></div>
    <button class="btn btn-primary btn-block" id="tuGo" disabled>تأكيد التعبئة</button>
    <p class="caption" style="margin-top:8px;text-align:center">يُخصم الإجمالي من محفظتك الآن، ويُضاف المبلغ للبطاقة بعد التنفيذ. عند الرفض يرجع كاملًا.</p>
  `);
  let total = 0;
  const calc = () => {
    const a = n($('#tuAmount').value), box = $('#tuQuote'), btn = $('#tuGo');
    if (!(a >= mn && a <= mx)) { box.innerHTML = a ? `<div class="caption" style="color:var(--warning)">المبلغ من ${mn} إلى ${mx} دولار</div>` : ''; btn.disabled = true; return; }
    const fee = Math.round((ff + a * fp / 100) * 100) / 100;
    total = Math.round((a + fee) * 100) / 100;
    box.innerHTML = `
      <div class="card card-sm" style="background:var(--surface-2);border:none">
        <div class="flex-between" style="padding:6px 0"><span class="body-sm text-2">يُضاف للبطاقة</span><span class="tabular" style="font-weight:600">${usd(a)}</span></div>
        <div class="flex-between" style="padding:6px 0"><span class="body-sm text-2">رسوم التعبئة</span><span class="tabular" style="font-weight:600">${usd(fee)}</span></div>
        <div class="divider" style="margin:8px 0"></div>
        <div class="flex-between"><span style="font-weight:600">يُخصم من محفظتك</span><span class="tabular" style="font-weight:700;color:var(--brand)">${usd(total)}</span></div>
      </div>`;
    const short = n(S.profile.wallet_balance) < total;
    btn.disabled = short;
    if (short) box.innerHTML += `<div class="alert alert-warning" style="margin-top:12px">${svg(I.help, 2)}<div>رصيدك غير كافٍ — اشحن محفظتك أولًا</div></div>`;
  };
  $('#tuAmount').oninput = calc;
  const key = newIdemKey();
  onTap('#tuGo', async () => {
    const btn = $('#tuGo');
    btn.disabled = true; btn.classList.add('loading');
    try {
      await api('/api/mcard/topup-request', { card_id: c.id, amount: n($('#tuAmount').value), idempotency_key: key });
      stickerModal('card', 'card', 'وصل طلب التعبئة 💳', 'سنضيف المبلغ لبطاقتك قريبًا، ويصلك إشعار فور التنفيذ.');
    } catch (e) {
      stickerModal('failed', 'error', 'لم تكتمل التعبئة', e.message, false);
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
const FENNEC_ICON = { success: ['ok', 'check'], error: ['bad', 'x'], empty: ['', 'box'], wait: ['', 'clock'], card: ['', 'card'], mail: ['', 'bell'], offline: ['bad', 'alert'] };
const fennec = (n) => { const f = FENNEC_ICON[n]; return f ? `<div class="kstate ${f[0]}">${svg(I[f[1]] || I.box)}</div>` : `<div class="kstate"><img src="./kardo-mark.png" alt=""></div>`; };
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
const cardsMaint = () => (S.config.manual_cards || {}).maint === true || secShut('cards');
function cardsMaintHtml() {
  if (!cardsMaint()) return '';
  return `<div class="alert alert-warning mb-4" role="alert" style="align-items:flex-start">${svg(I.help, 2)}<div><b>🛠️ قسم البطاقات قيد الصيانة</b><div class="caption" style="margin-top:4px">إصدار البطاقات وإعادة التعبئة متوقفان مؤقتًا. بطاقاتك الحالية وبياناتها متاحة كالمعتاد.</div>${secOf('cards').msg ? `<div class="caption" style="margin-top:6px;color:var(--u-ink)"><b>رسالة من الإدارة:</b> ${esc(secOf('cards').msg)}</div>` : ''}</div></div>`;
}
function cardWarningHtml() {
  const w = String(((S.config.manual_cards || {}).warning) || '').trim();
  if (!w) return '';
  return `<div class="neon-warn mb-4" role="alert"><div class="neon-warn-title">${svg(I.alert || I.help, 2)}<span>تحذير مهم</span></div>${w.split(/\n+/).map(l => `<p>${esc(l)}</p>`).join('')}</div>`;
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
      ${!cur && !q ? '<div class="h4 mb-3">الأكثر طلبًا</div>' : ''}
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
    <button class="btn btn-ghost btn-sm mb-2" id="pShare" type="button" style="padding:0">مشاركة رابط المنتج</button>
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
          ${fennec('empty', 90)}
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
          <li>✓ المحفظة والدعم كاملين</li>
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

function moneyGateHtml() {
  if (S.config.require_verified_money === false) return '';
  const p = S.profile || {};
  const needEmail = needsEmailVerify(), needPhone = S.config.require_phone_verified === true && !p.phone_verified;   // البريد مطلوب فقط عند تفعيل نظام البريد (نفس شرط الخادم)
  if (!needEmail && !needPhone) return '';
  return `
    <div class="modal-head"><div class="modal-title">وثّق حسابك أولًا 🛡️</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    <p class="body-sm text-2 mb-3">لحماية أموالك، الإيداع والسحب متاحان بعد خطوتين بسيطتين:</p>
    <div class="steps-card mb-4">
      <div class="step"><span class="step-n">${needEmail ? 1 : '✓'}</span><div><b>تأكيد البريد الإلكتروني</b><div class="caption">${needEmail ? 'رمز يصلك على بريدك' : 'تم ✓'}</div></div></div>
      <div class="step"><span class="step-n">${needPhone ? 2 : '✓'}</span><div><b>توثيق رقم ليبيانا أو المدار</b><div class="caption">${needPhone ? `بتحويل ${esc(String(S.config.pv_amount_lyd || 1))} دينار من رقمك — يُضاف لمحفظتك` : 'تم ✓'}</div></div></div>
    </div>
    <button class="btn btn-primary btn-block" id="gateGo" type="button">الذهاب للتوثيق</button>`;
}
async function openDeposit(preset, checkout) {
  if (secBlock('deposit')) return;
  if (!checkout) CHECKOUT = null;
  anEv(checkout ? 'buy_short' : 'dep_open');
  { const g = moneyGateHtml(); if (g) { modal(g); onTap('#gateGo', () => { closeModal(); go('settings'); }); return; } }
  const opts = depositOptions();
  if (!opts.length) { modal(`<div class="h4 mb-3">شحن المحفظة</div><p class="body-sm text-2">لا توجد طرق شحن مفعّلة حاليًا.</p>`); return; }
  let cur = 'usd';
  let amt = n(preset) || 0;
  let sel = (() => { try { return localStorage.getItem('kardo_last_pm') || ''; } catch { return ''; } })();
  if (!opts.find(o => o.key === sel && !o.paused)) sel = (opts.find(o => !o.paused) || opts[0]).key;
  const draw = () => {
    const usdOf = o => cur === 'usd' ? amt : (o.unit === 'USDT' ? amt / (n(S.config.usd_to_lyd) || 11.8) : amt / (o.rate || 1));
    modal(`
      <div class="modal-head"><div class="modal-title">${CHECKOUT ? 'ادفع وأكمل الشراء' : 'شحن المحفظة'}</div>
        <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
      ${CHECKOUT ? `<div class="kco">${svg(I.store)}<div><b>${esc(CHECKOUT.name)}</b><span>ينقصك ${esc(usd(preset))} — بعد ما يوصل الدفع نكمل الشراء تلقائيًا</span></div></div>` : ''}
      ${!CHECKOUT && S.config.promo_first && !S.profile.promo_first_done ? `<div class="kco">🎁<div><b>${(cur === 'usd' ? amt : 0) >= S.config.promo_first.min ? `تاخذ ${esc(String(S.config.promo_first.bonus))}$ هدية مع هذي الشحنة` : `اشحن ${esc(String(S.config.promo_first.min))}$ أو أكثر وخذ ${esc(String(S.config.promo_first.bonus))}$ هدية`}</b><span>${S.profile.phone_verified ? 'أول شحنة فقط — تنضاف تلقائيًا' : 'لازم رقم هاتفك يكون موثّق'}</span></div></div>` : ''}
      <div class="kdep-amt">
        <div class="kdep-row"><label for="kdA">${cur === 'usd' ? 'المبلغ بالدولار' : 'المبلغ بالدينار'}</label>
          <div class="kseg"><button type="button" data-cur="usd" class="${cur === 'usd' ? 'on' : ''}">$</button><button type="button" data-cur="lyd" class="${cur === 'lyd' ? 'on' : ''}">د.ل</button></div></div>
        <div class="kdep-in"><input id="kdA" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0" value="${amt || ''}" class="tabular"><span>${cur === 'usd' ? '$' : 'د.ل'}</span></div>
      </div>
      <div class="kchips">${(cur === 'usd' ? [5, 10, 20, 50] : [50, 100, 200, 500]).map(v => `<button type="button" data-q="${v}" class="${amt === v ? 'on' : ''}">${cur === 'usd' ? '$' + v : v}</button>`).join('')}</div>
      ${['crypto', 'phone', 'bank'].map(g => { const list = opts.filter(o => o.group === g); if (!list.length) return '';
        return `<div class="kset-label" style="margin-top:4px">${{ crypto: 'عملات رقمية', phone: 'رصيد هاتف', bank: 'تحويل وإيصال' }[g]}</div>
        <div class="list mb-4">${list.map(o => { const u = usdOf(o), pay = cur === 'usd' ? (o.unit === 'USDT' ? amt : amt * o.rate) : amt, bad = !o.paused && amt > 0 && ((o.min && u < o.min) || (o.max && u > o.max));
          return `<div role="button" tabindex="0" class="list-row kpm ${sel === o.key ? 'sel' : ''} ${o.paused ? 'off' : ''}" data-pm="${esc(o.key)}" aria-disabled="${o.paused ? 'true' : 'false'}">
            <span class="list-icon kpm-logo">${o.logo ? `<img src="${esc(o.logo)}" alt="">` : esc(o.short)}</span>
            <div class="list-content"><div class="list-title">${esc(o.label)} <span class="kpm-tag ${o.paused ? 'off' : o.speed}">${o.paused ? 'متوقفة مؤقتًا' : { auto: 'تلقائي', fast: 'فوري', review: 'مراجعة' }[o.speed]}</span>${o.paused ? '' : `<button type="button" class="kpm-how" data-howto="${esc(o.key)}" aria-label="كيف أدفع؟">؟ كيف</button>`}</div>
              <div class="list-meta">${o.paused ? 'غير متاحة الآن' : bad ? `<span style="color:var(--u-err)">${o.min && u < o.min ? `الحد الأدنى $${o.min}` : `الحد الأقصى $${o.max}`}</span>` : esc(o.note)}</div></div>
            ${!o.paused && amt > 0 ? `<div class="list-end kpm-pay"><b class="tabular">${o.unit === 'USDT' ? pay.toFixed(2) + ' USDT' : (o.unit === 'LYD' ? Math.ceil(pay) + ' د.ل' : pay.toFixed(2))}</b><small>${cur === 'usd' ? 'تدفع' : 'يُضاف ' + usd(u)}</small></div>` : ''}
          </div>`; }).join('')}</div>`; }).join('')}
      <button class="btn btn-primary btn-block btn-lg" id="kdGo" type="button">متابعة</button>`);
    const inp = $('#kdA');
    inp.oninput = () => { amt = n(inp.value); const pos = inp.selectionStart; draw(); const i2 = $('#kdA'); i2.focus(); try { i2.setSelectionRange(pos, pos); } catch {} };
    $$('[data-q]').forEach(b => b.onclick = () => { amt = n(b.dataset.q); draw(); });
    $$('[data-cur]').forEach(b => b.onclick = () => { if (cur !== b.dataset.cur) { cur = b.dataset.cur; amt = 0; draw(); } });
    $$('[data-pm]').forEach(b => b.onclick = () => { const o = opts.find(x => x.key === b.dataset.pm); if (!o || o.paused) return; sel = b.dataset.pm; draw(); });
    _htBack = () => openDeposit(cur === 'usd' ? amt : 0, !!CHECKOUT);
    onTap('#kdGo', () => {
      const o = opts.find(x => x.key === sel);
      if (!o || o.paused) return toast('اختر طريقة دفع', 'bad');
      if (!(amt > 0)) { toast('اكتب المبلغ', 'bad'); $('#kdA').focus(); return; }
      const u = Math.round(usdOf(o) * 100) / 100;
      if (o.min && u < o.min) return toast(`الحد الأدنى لهذه الطريقة $${o.min}${CHECKOUT ? ' — اكتب $' + o.min + ' والباقي يتبقى في محفظتك' : ''}`, 'bad');
      if (o.max && u > o.max) return toast(`الحد الأقصى لهذه الطريقة $${o.max}`, 'bad');
      try { localStorage.setItem('kardo_last_pm', o.key); } catch {}
      if (o.kind === 'crypto') return createInvoice(o.net, u);
      if (o.kind === 'phone') return openDepositMethod(o.key, Math.ceil(cur === 'usd' ? amt * o.rate : amt));
      return openManualDeposit(o.key, o.unit === 'USDT' ? u : Math.ceil(cur === 'usd' ? amt * o.rate : amt));
    });
  };
  draw();
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

function openManualDeposit(key, preset) {
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
      <input class="input" id="mdAmount" type="number" inputmode="decimal" step="0.01" min="1" value="${n(preset) > 0 ? esc(String(n(preset))) : ''}">
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
  $('#mdAmount').oninput();
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



/* ─── Withdraw & transfer ─── */
function openWithdraw() {
  if (secBlock('withdraw')) return;
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
  if (secBlock('transfer')) return;
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

// v37: عدّاد الأرقام — من 0 أول مرة في الجلسة، وبعدها فقط عند تغيّر القيمة
const _cuMem = {};
function runCountUps() {
  $$('[data-cu]').forEach(el => {
    const k = el.dataset.cu, to = Number(el.dataset.to) || 0;
    const fmt = el.dataset.fmt === 'usd' ? usd : el.dataset.fmt === 'num' ? (x => Number(x || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) : lyd;
    const from = k in _cuMem ? _cuMem[k] : 0;
    _cuMem[k] = to;
    if (Math.abs(from - to) < 0.005) return;
    el.dataset.v = from; el.textContent = fmt(from);
    countUp(el, to, x => fmt(x));
  });
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
        ${b.map((x, i) => `<a class="bn-slide" ${x.link && /^https:\/\//.test(x.link) ? `href="${esc(x.link)}" target="_blank" rel="noopener"` : x.link && /^#[a-z]+$/.test(x.link) ? `data-nav="${esc(x.link.slice(1))}" role="button"` : ''} data-i="${i}">
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
    ${Date.now() - Date.parse(S.profile.created_at || 0) < 15 * 60000 ? '<div class="h4" style="text-align:center;margin-bottom:6px">مرحبتين في كاردو</div>' : ''}
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
let _notifUid = null, _notifMode = '', _notifStop = null;
function subscribeNotifications(uid) {
  _notifUid = uid;
  S.unsub.push(stopNotifs);
  startNotifs();
}
function stopNotifs() { if (_notifStop) { try { _notifStop(); } catch {} } _notifStop = null; _notifMode = ''; }
function startNotifs() {
  const uid = _notifUid; if (!uid) return;
  if (d1On('notifications')) {
    _notifMode = 'd1';
    const st = { since: 0, n: -1 };
    _notifStop = makePoll(async () => {
      const r = await api('/api/sync/notifs', { since: st.since, n: st.n });
      st.since = r.ts || st.since;
      if (r.changed && r.list) { st.n = r.list.length; applyNotifs(r.list); }
    }, 120000, { onVisible: true });
    return;
  }
  _notifMode = 'fs';
  _notifStop = onSnapshot(query(collection(db, 'notifications'), where('uid', '==', uid), limit(40)), s => {
    applyNotifs(s.docs.map(d => ({ id: d.id, ...d.data() })));
  }, e => console.warn('notifs:', e.code));
}
function applyNotifs(rows) {
    const prev = new Set((S.notifs || []).map(x => x.id));
    S.notifs = sortByDate(rows);
    const fresh = S.notifs.filter(x => !x.read && !prev.has(x.id));
    if (S._notifsLoaded && fresh.length) {
      haptic.ok(); toast(fresh[0].title, 'ok');
      if (fresh[0].kind === 'ticket_reply' && S.page === 'support') setTimeout(() => followLink(fresh[0].link), 400);
    }
    S._notifsLoaded = true;
    paintBell();
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
      : `<div class="k-empty">${fennec('mail', 90)}<div class="h4">لا إشعارات بعد</div></div>`}
  `);
  if (list.some(x => !x.read)) api('/api/notify/read', {}).then(() => { if (_notifMode === 'd1') { (S.notifs || []).forEach(x => { x.read = true; }); paintBell(); } }).catch(() => {});
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
  if (kind === 'mchat' && id) { go('chats'); setTimeout(() => openChat(id, '', 'customer'), 600); return true; }
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
  if (!merchantsOn()) { try { sessionStorage.removeItem('kardo_next_join'); } catch {} return; }
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
// v40: التسليم التلقائي من المخزون متوقف في المتاجر (يحتاج نظام محفظة) — كل الخدمات والأقسام يدوية
function noAutoDelivery(d) {
  (d && d.services || []).forEach(x => { x.delivery = 'manual'; });
  (d && d.sections || []).forEach(x => { x.delivery = 'manual'; });
}
S.mkCat = ''; S.mkQ = ''; S.curStore = null; S.mine = null; S.mstoreTab = 'home';
let _mkLoading = false;
async function loadMerchants(force) {
  if (_mkLoading || (S.mk.loaded && !force)) return;
  if (force && S.mk._at && Date.now() - S.mk._at < 20000) return;   // لا إعادة جلب متكررة
  _mkLoading = true;
  try { const d = await apiGet('/api/merchants/list'); noAutoDelivery(d); S.mk = { ...d, loaded: true, _at: Date.now() }; setTimeout(openPendingStore, 50); }
  catch { S.mk = { ...S.mk, loaded: true, error: true }; }
  _mkLoading = false; render();
}
async function loadMine(fresh = true) {
  try { const d = await api('/api/m/me', { fresh: !!fresh }); noAutoDelivery(d); S.mine = d.merchant ? d : { merchant: null }; }
  catch (e) { S.mine = { merchant: null, error: (e && e.message) || 'تعذّر التحميل' }; }
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
    <div class="list-end"><div class="list-amount" dir="ltr">${esc(o.pay_currency ? fmtPay(o.pay_amount, o.pay_currency) : lyd(o.price))}</div>
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
    <span class="m-tile-name">${esc(m.name)} ${vb(m)}</span>
    <span class="caption">${esc(m.category)}${m.open === false ? ' · 🔴 مغلق' : ''}</span>
    ${tierBadge(m)}
  </button>`;
}
function merchantCard(m) {
  return `<button class="m-card ${m.promo ? 'm-promo' : ''}" data-store="${esc(m.id)}">
    <span class="m-card-img">${m.cover ? `<img class="m-card-bg" src="${esc(m.cover)}" alt="" loading="lazy">` : ''}
      ${m.logo ? `<img class="m-card-logo" src="${esc(m.logo)}" alt="${esc(m.name)}" loading="lazy">` : `<b class="m-card-letter">${esc((m.name || '؟').trim().charAt(0))}</b>`}
      ${m.promo ? '<span class="m-ad">مميّز</span>' : ''}${m.open === false ? '<span class="m-card-closed">مغلق الآن</span>' : ''}</span>
    <span class="m-card-body">
      <span class="m-card-name">${esc(m.name)} ${vb(m)}</span>
      <span class="m-card-meta">${m.rating ? `<span class="m-rate">★ ${esc(Number(m.rating).toFixed(1))}</span>` : '<span class="caption">جديد</span>'}<span class="caption">· ${m.orders_done || 0} طلب</span></span>
      <span class="m-card-meta"><span class="caption">${esc(m.category)}</span>${tierBadge(m)}</span>
    </span>
  </button>`;
}
function merchantRow(m) {
  return `<button class="prow" data-store="${esc(m.id)}">
    ${mLogo(m, 'prow-img')}
    <span class="prow-body"><span class="prow-name">${esc(m.name)} ${vb(m)} ${tierBadge(m)}</span>
      <span class="caption" style="display:block">${esc(m.category)} · ${mServices(m.id).length} خدمة${m.orders_done ? ` · ${m.orders_done} طلب مكتمل` : ''}</span>
      <span class="caption" style="display:block">${openBadge(m)} ${stars(m.rating)}${m.avg_confirm_min !== null && m.avg_confirm_min !== undefined ? ` · ⏱️ يؤكد خلال ~${m.avg_confirm_min || 1} د` : ''}</span></span>
    <span class="prow-add" aria-hidden="true">←</span>
  </button>`;
}
const PAY_TYPE_AR = { libyana: 'ليبيانا', almadar: 'المدار', bank: 'مصرف', binance: 'بايننس', usdt: 'USDT', other: 'أخرى' };
S.payType = (() => { try { return localStorage.getItem('kardo_paytype') || ''; } catch { return ''; } })();
function setPayType(t) { S.payType = t; try { localStorage.setItem('kardo_paytype', t); } catch {} render(); }
function pickPm(m, id) {
  const list = (m && m.pay_methods) || [];
  return (id && list.find(p => p.id === id)) || list.find(p => p.type === S.payType) || list[0] || null;
}
const fmtPay = (amount, cur) => `${Number(amount || 0).toFixed(2)} ${cur || 'د.ل'}`;
const isManual = m => !!(m && m.pricing_mode === 'manual');
// v38: في الوضع اليدوي تظهر للخدمة فقط الطرق التي كتب لها التاجر سعرًا
function svcPms(m, s) {
  const list = ((m && m.pay_methods) || []).map((p, k) => ({ ...p, id: p.id || ('pm' + k) }));
  return isManual(m) ? list.filter(p => s && s.prices && Number(s.prices[p.id] || 0) > 0) : list;
}
function svcPrice(m, s, pm) {
  pm = pm || pickPm(m);
  if (isManual(m) && !(pm && s && s.prices && Number(s.prices[pm.id] || 0) > 0)) pm = svcPms(m, s)[0] || pm;
  const v = pm && s && s.prices ? Number(s.prices[pm.id] || 0) : 0;
  if (v > 0) return { amount: v, currency: pm.currency || 'د.ل', pm };
  return priceIn(m, s ? s.price : 0, pm);
}
function priceIn(m, base, pm) {
  pm = pm || pickPm(m);
  if (!pm) return { amount: Number(base || 0), currency: 'د.ل', pm: null };
  return { amount: Math.round(Number(base || 0) * Number(pm.rate || 1) * 100) / 100, currency: pm.currency || 'د.ل', pm };
}
function svcPriceHtml(s, m) {
  if (m && (m.pay_methods || []).length) {
    const p = svcPrice(m, s), o = s.old_price && !(s.prices && Object.keys(s.prices).length) ? priceIn(m, s.old_price, p.pm) : null;
    return `<span dir="ltr">${esc(fmtPay(p.amount, p.currency))}</span>${o ? ` <s class="caption" dir="ltr">${esc(fmtPay(o.amount, o.currency))}</s> <span class="m-off">-${Math.round((1 - s.price / s.old_price) * 100)}%</span>` : ''}`;
  }
  return svcPriceHtmlLegacy(s);
}
function svcPriceHtmlLegacy(s) {
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
    <div class="input-wrap mb-4"><span class="input-icon">${svg(I.search, 2)}</span><input class="input" id="homeQ" placeholder="ابحث عن متجر أو قسم أو منتج…" autocomplete="off"></div>
    ${fav.length ? `<div class="h4 mb-3">متاجري المفضلة</div><div class="m-cards mb-4">${fav.slice(0, 4).map(merchantCard).join('')}</div>` : ''}
    <div class="flex-between mb-3"><div class="h4">المتاجر الموثوقة</div>
      <button class="btn btn-ghost btn-sm" data-nav="stores">عرض الكل ${svg(I.back, 2)}</button></div>
    <div class="m-cards mb-5">${list.slice(0, 8).map(merchantCard).join('')}</div>`;
}

function vStores() {
  if (!S.mk.loaded) loadMerchants();
  const q = (S.mkQ || '').trim().toLowerCase();
  const all = S.mk.merchants || [];
  const list = all.filter(m => (!S.mkCat || m.category === S.mkCat)
    && (!q || (m.name + ' ' + m.category + ' ' + m.bio + ' ' + mServices(m.id).map(s => s.name + ' ' + (s.section || '')).join(' ')).toLowerCase().includes(q)));
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
    <div class="input-wrap mb-3"><span class="input-icon">${svg(I.search, 2)}</span><input class="input" id="mkQ" placeholder="ابحث عن متجر أو قسم أو منتج (مثال: شدات)…" value="${esc(S.mkQ || '')}" autocomplete="off"></div>
    ${cats.length > 1 ? `<div class="pills mb-4"><button class="pill ${!S.mkCat ? 'active' : ''}" data-mkcat="">الكل</button>${cats.map(c => `<button class="pill ${S.mkCat === c ? 'active' : ''}" data-mkcat="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
    ${svcHits.length ? `<div class="h4 mb-2">🔎 عروض «${esc(S.mkQ)}» من كل المتاجر (الأرخص أولًا)</div>
      <div style="display:flex;flex-direction:column;gap:8px" class="mb-4">${svcHits.map(s => { const m = mById(s.mid); return `
        <button class="prow" data-msvc="${esc(s.id)}" ${(s.delivery === 'stock' && s.stock < 1) || m.open === false ? 'disabled' : ''}>
          ${mLogo(m, 'prow-img')}
          <span class="prow-body"><span class="prow-name">${esc(s.name)}</span>
            <span class="prow-price" style="display:block">${svcPriceHtml(s, m)}</span>
            <span class="caption" style="display:block">${esc(m.name)} ${tierBadge(m)} · ${s.eta ? '⏱️ ' + esc(s.eta) : (s.delivery === 'stock' ? '⚡ فوري' : 'يدوي')}</span></span>
          <span class="prow-add" aria-hidden="true">+</span></button>`; }).join('')}</div>` : ''}
    ${!q && fav.length ? `<div class="h4 mb-2">المفضلة</div><div class="m-cards mb-4">${fav.map(merchantCard).join('')}</div><div class="h4 mb-2">كل المتاجر</div>` : ''}
    ${q && list.length ? `<div class="h4 mb-2">المتاجر</div>` : ''}
    ${!S.mk.loaded ? '<div class="skeleton" style="height:80px;border-radius:16px"></div>'
      : list.length ? `<div class="m-cards">${list.map(merchantCard).join('')}</div>`
      : svcHits.length ? '' : `<div class="card" style="text-align:center;padding:28px">${fennec('empty', 110)}<div class="h4">${q ? 'لا نتائج' : 'لا متاجر بعد'}</div></div>`}
  </div>`;
}

function payBoxHtml(m, s, pm) {
  if (!pm) return '<p class="caption">تواصل مع التاجر لمعرفة طريقة الدفع.</p>';
  const pr = svcPrice(m, s, pm);
  return `<div class="flex-between mb-2"><span class="body-sm" style="display:flex;gap:8px;align-items:center">${pm.logo ? `<img src="${esc(pm.logo)}" alt="" class="pm-logo">` : ''}حوّل عبر <b>${esc(pm.label)}</b></span>
      <b class="tabular" dir="ltr" style="font-size:22px;color:var(--brand)">${esc(fmtPay(pr.amount, pr.currency))}</b></div>
    <div class="copy-box"><div style="flex:1"><div class="caption">بيانات التحويل</div><div class="copy-value" dir="ltr">${esc(pm.value)}</div></div>
      <button class="copy-btn" type="button" data-act="copy" data-copy-text="${esc(pm.value)}" aria-label="نسخ">${svg(I.copy, 2)}</button></div>`;
}
function openMService(sid) {
  const s = (S.mk.services || []).find(x => x.id === sid); if (!s) return;
  const m = mById(s.mid); if (!m) return;
  if (m.open === false) return toast('المتجر مغلق حاليًا', 'bad');
  const avail = svcPms(m, s);
  if (!avail.length && (m.pay_methods || []).length) return toast('هذه الخدمة بلا سعر حاليًا — تواصل مع التاجر', 'bad');
  const pref = pickPm(m);
  const firstPm = (pref && avail.find(p => p.id === pref.id)) || avail[0] || null;
  let proof = '';
  const idemKey = 'mo' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  modal(`
    <div class="modal-head"><div class="modal-title">${esc(s.name)}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    ${s.image ? `<img src="${esc(s.image)}" alt="" class="m-svc-img">` : ''}
    ${s.desc ? `<p class="body-sm text-2 mb-3" style="white-space:pre-line">${esc(s.desc)}</p>` : ''}
    ${s.eta ? `<p class="caption mb-2">⏱️ مدة التنفيذ: <b>${esc(s.eta)}</b></p>` : ''}

    <div class="m-step">1</div>
    <div class="m-pay-box mb-3" id="mPayBox">${payBoxHtml(m, s, firstPm)}</div>
    ${avail.length > 1 ? `<div class="field mb-3"><label class="field-label" for="mPaySel">تغيير طريقة الدفع</label>
      <select class="input" id="mPaySel">${avail.map(p => { const pr = svcPrice(m, s, p); return `<option value="${esc(p.id)}" ${firstPm && firstPm.id === p.id ? 'selected' : ''}>${esc(p.label)} — ${esc(fmtPay(pr.amount, pr.currency))}</option>`; }).join('')}</select></div>` : ''}

    ${(s.fields || []).length ? `<div class="m-step">2</div>
      ${(s.fields || []).map((f, i) => `<div class="field mb-3"><label class="field-label" for="mf${i}">${esc(f)}</label><input class="input" id="mf${i}" dir="auto"></div>`).join('')}` : ''}

    <div class="m-step">${(s.fields || []).length ? 3 : 2}</div>
    <label class="m-proof" id="mProofBox"><span id="mProofTxt">اضغط لإرفاق صورة إيصال التحويل</span><input type="file" accept="image/*" id="mProof" hidden></label>

    <button class="btn btn-primary btn-block" id="mBuy" type="button" style="margin-top:6px">تم</button>
    <p class="caption" style="text-align:center;margin-top:8px">يؤكد التاجر استلام دفعتك ثم ينفّذ طلبك${s.delivery === 'stock' ? ' — والكود يصلك فورًا عند التأكيد' : ''}.</p>`);
  let selPm = firstPm;
  const ps = $('#mPaySel'); if (ps) ps.onchange = () => { selPm = avail.find(p => p.id === ps.value) || firstPm; $('#mPayBox').innerHTML = payBoxHtml(m, s, selPm); };
  $('#mProof').onchange = async () => {
    try { proof = await compressImage($('#mProof').files[0], 900, 0.6); $('#mProofTxt').textContent = '✓ أُرفق الإيصال'; $('#mProofBox').classList.add('ok'); }
    catch (e) { toast(e.message, 'bad'); }
  };
  onTap('#mBuy', async () => {
    const inputs = {};
    for (let i = 0; i < (s.fields || []).length; i++) { const v = ($('#mf' + i).value || '').trim(); if (!v) return toast('أدخل ' + s.fields[i], 'bad'); inputs[i] = v; }
    if (!proof) return toast('أرفق صورة إيصال التحويل', 'bad');
    const pm = selPm;
    const b = $('#mBuy'); b.disabled = true; b.classList.add('loading');
    try {
      await api('/api/m/order', { sid, proof, inputs, pay_method: pm ? pm.label : '', pay_method_id: pm ? pm.id : '', idempotency_key: idemKey }, 45000);
      stickerModal('wait', 'wait', 'وصل طلبك للتاجر ✓', `${m.name} سيؤكد دفعتك وينفّذ طلبك${s.eta ? ` (عادة خلال ${s.eta})` : ''} — تابع الحالة وتحدّث معه من «طلباتي».`);
    } catch (e) {
      if (/abort/i.test(String(e && (e.name + ' ' + e.message)))) {
        b.disabled = false; b.classList.remove('loading');
        return stickerModal('wait', 'wait', 'الشبكة بطيئة ⏳', 'قد يكون طلبك وصل فعلًا — افتح «طلباتي» للتأكد. إذا لم تجده، اضغط «تم» مرة أخرى (لن يتكرر الطلب).');
      }
      stickerModal('failed', 'error', 'لم يُرسل الطلب', e.message, false);
    }
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
    <div class="flex-between mb-2"><span class="body-sm text-2">المبلغ</span><b class="tabular" dir="ltr">${esc(o.pay_currency ? fmtPay(o.pay_amount, o.pay_currency) : lyd(o.price))}</b></div>
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
    <button class="btn btn-ghost btn-block" id="moRep" type="button" style="color:var(--error)">إبلاغ عن مشكلة في هذا الطلب</button>`);
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
  if (!S.mine) { loadMine(false); return '<div class="page-enter"><div class="skeleton" style="height:120px;border-radius:18px"></div></div>'; }
  const m = S.mine.merchant;
  if (!m && S.mine.error) return `<div class="page-enter"><div class="card" style="text-align:center;padding:28px">
      <div class="h4" style="margin-bottom:8px">تعذّر تحميل لوحة متجرك الآن</div>
      <p class="body-sm text-2 mb-4">${esc(S.mine.error)} — بيانات متجرك وطلباتك محفوظة بأمان.</p>
      <button class="btn btn-primary btn-block" id="msRetry" type="button">إعادة المحاولة</button></div></div>`;
  if (!m) { setTimeout(() => go('dashboard'), 0); return '<div class="page-enter"></div>'; }
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
    ['chats', `المحادثات${(S.mstoreChats || []).reduce((a, c) => a + (c.unread_m || 0), 0) ? ` (${(S.mstoreChats || []).reduce((a, c) => a + (c.unread_m || 0), 0)})` : ''}`],
    ['reports', 'التقارير'], ['cases', `البلاغات${cases.length ? ` (${cases.length})` : ''}`],
    ...(m.billing_mode && m.billing_mode !== 'fixed' ? [['billing', `الحساب${(S.mStatements || []).some(x => x.status === 'due') ? ' ⚠️' : ''}`]] : []), ['settings', 'الإعدادات']];
  let body = '';
  if (tab === 'home') body = `
    ${!m.active ? `<div class="neon-warn mb-4"><div class="neon-warn-title">⚠️ متجرك غير ظاهر للزبائن</div><p>${m.status === 'suspended' ? 'المتجر موقوف من الإدارة.' : 'انتهى اشتراكك — تواصل مع إدارة كاردو للتجديد.'}</p></div>` : ''}
    ${pushOn() ? '' : `<button class="card m-join mb-3" id="pushOn" type="button"><span style="font-size:24px">🔔</span><span style="flex:1;text-align:right"><b style="display:block">فعّل إشعارات الهاتف</b><span class="caption">يصلك كل طلب جديد فورًا حتى لو الموقع مغلق</span></span><span class="prow-add">←</span></button>`}
    <div class="card mb-4 flex-between"><div><b>${!m.open ? '🔴 المتجر مغلق (وضع الإجازة)' : m.open_now ? '🟢 المتجر مفتوح الآن' : '🌙 خارج أوقات العمل'}</b>
      <div class="caption">${!m.open ? 'لا تصلك طلبات جديدة' : m.schedule && m.schedule.enabled ? `جدول تلقائي: ${esc(m.schedule.from)}–${esc(m.schedule.to)}` : 'يستقبل الطلبات الآن'}</div></div>
      <button class="btn ${m.open ? 'btn-secondary' : 'btn-primary'} btn-sm" id="msToggleOpen">${m.open ? 'إغلاق مؤقت' : 'فتح المتجر'}</button></div>
    ${m.slug ? `<button class="btn btn-primary btn-block mb-4" data-mshare="${esc(m.slug)}" type="button">مشاركة رابط متجري مع الزبائن</button>` : ''}
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
  if (tab === 'chats') body = (S.mstoreChats || []).length ? `<div class="list">${(S.mstoreChats || []).slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).map(c => `
    <div class="list-row" data-mschat="${esc(c.id)}" role="button" tabindex="0">${avatarImg(c.uid, c.customer_name, 40)}
      <div class="list-content"><div class="list-title">${esc(c.customer_name)}</div><div class="list-meta">${esc(c.last_by === 'merchant' ? 'أنت: ' : '')}${esc(c.last_text || '')}</div></div>
      <div class="list-end">${c.unread_m ? `<span class="chat-unread">${c.unread_m}</span>` : `<span class="caption">${esc(dt(c.updated_at))}</span>`}</div></div>`).join('')}</div>`
    : `<div class="card k-empty">${fennec('mail', 90)}<div class="h4">لا محادثات بعد</div><p class="caption">ستظهر هنا رسائل زبائنك</p></div>`;
  const baseFmt = v => (S.mine.merchant || {}).base_currency === 'USD' && (S.mine.merchant || {}).pricing_mode !== 'manual' ? '$' + Number(v || 0).toFixed(2) : lyd(v);
  if (tab === 'services') body = `
    <div class="flex-between mb-2"><div class="h4" style="font-size:14px">الأقسام</div><button class="btn btn-secondary btn-sm" id="msSecAdd" style="padding:0 14px">+ قسم</button></div>
    <div class="sec-grid mb-4">${(S.mine.sections || []).map(x => `<button class="sec-tile" data-mssec="${esc(x.id)}"><span class="sec-img">${x.image ? `<img src="${esc(x.image)}" alt="">` : `<b>${esc(x.name.charAt(0))}</b>`}</span><span class="sec-name">${esc(x.name)}</span><span class="caption">${(S.mine.services || []).filter(v => v.section_id === x.id).length} خدمة</span></button>`).join('') || '<p class="caption">أنشئ قسمًا أولًا (مثل: ببجي، شاهد…) ثم أضف خدماته.</p>'}</div>
    <button class="btn btn-primary btn-sm mb-3" id="msAdd" style="padding:0 18px" ${(S.mine.sections || []).length ? '' : 'disabled'}>+ خدمة جديدة</button>
    <div style="display:flex;flex-direction:column;gap:10px">${(S.mine.services || []).map(s => `
      <div class="card m-svc-row">
        <div style="flex:1;min-width:0"><b>${esc(s.name)}</b> ${s.active ? '' : '<span class="badge badge-neutral">متوقفة</span>'} ${s.section ? `<span class="caption">· ${esc(s.section)}</span>` : ''}
          <div class="caption">${esc(baseFmt(s.price))}${s.old_price ? ` (قبل ${esc(baseFmt(s.old_price))})` : ''} · ${s.delivery === 'stock' ? `⚡ مخزون: <b style="color:${s.stock <= 3 ? 'var(--error)' : 'inherit'}">${s.stock}</b>` : 'تنفيذ يدوي'}${s.eta ? ` · ⏱️ ${esc(s.eta)}` : ''}</div></div>
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
  if (tab === 'billing') {
    const sts = (S.mStatements || []).slice().sort((x, y) => String(y.month).localeCompare(String(x.month)));
    const cur = sts.find(x => x.month === new Date().toISOString().slice(0, 7));
    body = `
    ${m.billing_hold ? `<div class="neon-warn mb-3"><div class="neon-warn-title">⚠️ متجرك موقوف لعدم سداد العمولة</div><p>يعود فور تسجيل الدفع — حوّل المستحق لإدارة كاردو وتواصل معهم.</p></div>` : ''}
    <div class="card mb-3"><div class="caption">نظام المحاسبة</div><b>${m.billing_mode === 'percent' ? `نسبة ${m.commission_pct}% من المبيعات` : `اشتراك شهري + ${m.commission_pct}% من المبيعات`}</b>
      ${Number(m.commission_from_ms || 0) > Date.now() ? `<div class="caption" style="color:var(--success);margin-top:4px">🎁 شهرك المجاني حتى ${esc(new Date(Number(m.commission_from_ms)).toLocaleDateString('ar-LY'))} — لا عمولة قبل هذا التاريخ</div>` : ''}</div>
    <div class="m-stats mb-4">
      <div class="card"><div class="caption">مبيعات هذا الشهر</div><b class="tabular">${esc(lyd(cur ? cur.sales : 0))}</b></div>
      <div class="card"><div class="caption">العمولة حتى الآن</div><b class="tabular">${esc(lyd(cur ? cur.commission : 0))}</b></div>
    </div>
    <div class="h4 mb-2">الكشوف</div>
    <div class="list">${sts.filter(x => x.status !== 'open').map(x => `<div class="list-row"><div class="list-icon brand">🧾</div>
      <div class="list-content"><div class="list-title">${esc(x.month)}</div><div class="list-meta">مبيعات ${esc(lyd(x.sales))} × ${esc(String(x.pct))}%</div></div>
      <div class="list-end"><div class="list-amount">${esc(lyd(x.commission))}</div><span class="badge ${x.status === 'paid' ? 'badge-success' : 'badge-warning'}" style="font-size:10px">${x.status === 'paid' ? 'مدفوع' : 'مستحق'}</span></div></div>`).join('') || '<p class="caption">لا كشوف سابقة — يصدر الكشف أول كل شهر.</p>'}</div>
    <p class="caption" style="margin-top:10px">يُسدَّد الكشف خلال 5 أيام من صدوره، وإلا يتوقف المتجر تلقائيًا حتى السداد.</p>`;
  }
  if (tab === 'settings') body = `
    <div class="card mb-3">
      <div class="flex-between"><div class="h4" style="font-size:14px;margin:0">💲 طريقة التسعير</div>
        <span class="badge">${m.pricing_mode === 'manual' ? 'يدوي' : 'تلقائي'}</span></div>
      <p class="caption" style="margin:6px 0 10px">${m.pricing_mode === 'manual'
        ? 'تكتب سعر كل منتج لكل طريقة دفع بنفسك.'
        : `تكتب سعر المنتج مرة واحدة بـ${m.base_currency === 'USD' ? 'الدولار' : 'الدينار'}، ويُحسب سعر كل طريقة دفع بسعر الصرف.`}</p>
      <button class="btn btn-secondary btn-block" id="mPriceOpen" type="button">تغيير طريقة التسعير وأسعار الصرف</button>
    </div>
    <button class="btn btn-primary btn-block" id="mSetOpen">تعديل بيانات المتجر</button>
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
    <div class="flex-between mb-2"><span class="body-sm text-2">المبلغ المطلوب وصوله</span><b class="tabular" dir="ltr">${esc(o.pay_currency ? fmtPay(o.pay_amount, o.pay_currency) : lyd(o.price))}</b></div>
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
    <button class="btn btn-ghost btn-block" id="msBlock" type="button" style="color:var(--error)">حظر هذا الزبون من متجري</button>`);
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
  const mm = S.mine.merchant || {};
  const PMCUR = { libyana: 'د.ل', almadar: 'د.ل', bank: 'د.ل', binance: 'USDT', usdt: 'USDT' };
  const pms = (mm.pay_methods || []).map((p0, k) => ({ ...p0, id: p0.id || ('pm' + k) }));
  const pmCur = p => p.currency || PMCUR[p.type] || 'د.ل';
  const bUsd = mm.base_currency === 'USD', bSym = bUsd ? '$ دولار' : 'د.ل دينار';
  const manualMode = mm.pricing_mode === 'manual' && pms.length > 0;
  modal(`
    <div class="modal-head"><div class="modal-title">${id ? 'تعديل الخدمة' : 'خدمة جديدة'}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    <div class="field mb-3"><label class="field-label" for="svN">اسم الخدمة</label><input class="input" id="svN" maxlength="60" value="${esc(s.name)}" placeholder="مثال: 60 شدة ببجي"></div>
    <div class="field mb-3"><label class="field-label" for="svS">القسم</label><select class="input" id="svS">${(S.mine.sections || []).map(x => `<option value="${esc(x.id)}" ${s.section_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
</div>
    ${pms.length ? `<div class="caption mb-2">طريقة التسعير: <b>${manualMode ? 'يدوي' : 'تلقائي'}</b> — تغييرها من «الإعدادات ← طريقة التسعير».</div>` : ''}
    ${manualMode ? `<div class="field-label mb-2">السعر لكل طريقة دفع</div>
      ${pms.map(p => `<div class="field mb-2" style="grid-template-columns:1fr 130px;display:grid;align-items:center;gap:8px">
        <label class="body-sm" for="mp_${esc(p.id)}">${esc(p.label)} <span class="caption">(${esc(pmCur(p))})</span></label>
        <input class="input" id="mp_${esc(p.id)}" data-mp="${esc(p.id)}" data-req="1" type="number" step="0.01" min="0" dir="ltr" value="${esc(String((s.prices || {})[p.id] || ''))}"></div>`).join('')}
      <input type="hidden" id="svP" value="">`
    : pms.length ? `<div class="field mb-2"><label class="field-label" for="svP">السعر (${esc(bSym)})</label>
        <input class="input" id="svP" type="number" step="0.01" min="0" dir="ltr" value="${s.price ? esc(String(s.price)) : ''}" placeholder="${bUsd ? 'مثال: 3' : 'مثال: 35'}"></div>
      <div class="card mb-3" style="padding:10px 12px !important" id="svCalc"></div>
      <details class="mb-3" ${Object.keys(s.prices || {}).length ? 'open' : ''}><summary class="caption" style="cursor:pointer">تعديل سعر طريقة معيّنة يدويًا (اختياري)</summary>
        <div class="caption mb-2" style="margin-top:6px">اتركه فارغًا ليُحسب تلقائيًا من سعر الصرف.</div>
        ${pms.map(p => `<div class="field mb-2" style="grid-template-columns:1fr 120px;display:grid;align-items:center;gap:8px">
          <label class="body-sm" for="mp_${esc(p.id)}">${esc(p.label)} <span class="caption">(${esc(pmCur(p))})</span></label>
          <input class="input" id="mp_${esc(p.id)}" data-mp="${esc(p.id)}" type="number" step="0.01" min="0" dir="ltr" placeholder="تلقائي" value="${esc(String((s.prices || {})[p.id] || ''))}"></div>`).join('')}
      </details>`
      : `<div class="field mb-3"><label class="field-label" for="svP">السعر (د.ل)</label><input class="input" id="svP" type="number" step="0.5" min="0" dir="ltr" value="${esc(String(s.price))}"></div>
         <div class="caption mb-3">أضف طرق الدفع وأسعار الصرف من «الإعدادات» ليُحسب السعر تلقائيًا لكل طريقة.</div>`}
    <div class="field mb-3" ${manualMode ? 'style="display:none"' : ''}><label class="field-label" for="svO">السعر قبل الخصم (اختياري${pms.length ? ' — بنفس عملة المتجر' : ''})</label><input class="input" id="svO" type="number" step="0.5" min="0" dir="ltr" value="${s.old_price ? esc(String(s.old_price)) : ''}"></div>
    <div class="field mb-3"><label class="field-label" for="svE">مدة التنفيذ</label><input class="input" id="svE" maxlength="40" value="${esc(s.eta || '')}" placeholder="مثال: 5–15 دقيقة"></div>
    <div class="field mb-3"><label class="field-label" for="svD">الوصف</label><textarea class="input" id="svD" rows="3" maxlength="400">${esc(s.desc)}</textarea></div>
    <div class="field mb-3"><label class="field-label" for="svF">بيانات يطلبها من الزبون (اختياري، حتى 3 مفصولة بفاصلة)</label>
      <input class="input" id="svF" value="${esc((s.fields || []).join('، '))}" placeholder="مثال: ID اللاعب، اسم الحساب"></div>

    <label class="perm-chk mb-3"><input type="checkbox" id="svA" ${s.active !== false ? 'checked' : ''}> الخدمة ظاهرة للزبائن</label>
    <label class="m-proof mb-3"><span id="svImgTxt">${s.image ? '✓ صورة الخدمة — اضغط للتغيير' : 'صورة الخدمة (اختياري)'}</span><input type="file" accept="image/*" id="svI" hidden></label>
    <button class="btn btn-primary btn-block" id="svSave" type="button">حفظ</button>
    ${id ? '<button class="btn btn-ghost btn-block" id="svDel" type="button" style="color:var(--error);margin-top:6px">حذف الخدمة</button>' : ''}`);
  const calc = () => {                                     // معاينة فورية لسعر كل طريقة دفع
    const box = $('#svCalc'); if (!box) return;
    const b = Number($('#svP').value || 0);
    box.innerHTML = `<div class="caption mb-1">السعر الذي يراه الزبون:</div>` + pms.map(p => {
      const man = Number(($(`#mp_${p.id}`) || {}).value || 0);
      const v = man > 0 ? man : Math.round(b * Number(p.rate || 1) * 100) / 100;
      return `<div class="flex-between body-sm" style="padding:3px 0"><span>${esc(p.label)}${man > 0 ? ' <span class="caption">(يدوي)</span>' : ''}</span><b class="tabular" dir="ltr">${b > 0 || man > 0 ? esc(fmtPay(v, pmCur(p))) : '—'}</b></div>`;
    }).join('');
  };
  if (pms.length && !manualMode) { calc(); $('#svP').oninput = calc; $$('[data-mp]').forEach(i => i.oninput = calc); }
  $('#svI').onchange = async () => { try { image = await compressImage($('#svI').files[0], 600, 0.75); $('#svImgTxt').textContent = '✓ أُرفقت الصورة'; } catch (e) { toast(e.message, 'bad'); } };
  onTap('#svSave', async () => {
    const prices = {}; let missing = '';
    $$('[data-mp]').forEach(i => { const v = Number(i.value || 0); if (v > 0) prices[i.dataset.mp] = v; else if (i.dataset.req) missing = missing || i.closest('.field').querySelector('label').textContent.trim(); });   // الفارغ = تلقائي (في الوضع التلقائي)
    if (manualMode) { if (missing) return toast('اكتب سعر: ' + missing, 'bad'); }
    else if (!(Number($('#svP').value || 0) > 0)) return toast('اكتب سعر الخدمة', 'bad');
    const body = { id: id || '', name: $('#svN').value.trim(), section_id: $('#svS').value, price: Number($('#svP').value || 0), prices, old_price: Number($('#svO').value || 0),
      eta: $('#svE').value.trim(), desc: $('#svD').value.trim(), fields: $('#svF').value.split(/[،,]/).map(x => x.trim()).filter(Boolean), active: $('#svA').checked };
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
  const pays = (m.pay_methods || []).map((p, k) => ({ id: p.id || ('pm' + k), type: p.type || 'other', label: p.label, value: p.value, currency: p.currency || '', rate: p.rate || 1, logo: p.logo || '', _new: null }));
  if (!pays.length) pays.push({ id: 'pm' + Date.now().toString(36), type: 'libyana', label: 'رصيد ليبيانا', value: '', currency: 'د.ل', rate: 1, logo: '', _new: null });
  let logo = null, cover = null;
  const CUR = { libyana: 'د.ل', almadar: 'د.ل', bank: 'د.ل', binance: 'USDT', usdt: 'USDT', other: '' };
  let base = m.base_currency === 'USD' ? 'USD' : 'LYD';
  let mode = m.pricing_mode === 'manual' ? 'manual' : 'auto';
  const baseCur = () => base, baseSym = () => (base === 'USD' ? '$' : 'د.ل');
  const payRows = () => pays.map((p, i) => `<div class="pm-field" style="grid-template-columns:1fr 1fr">
      <select class="input" data-pt="${i}">${Object.entries(PAY_TYPE_AR).map(([k, t]) => `<option value="${k}" ${p.type === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input class="input" data-pl="${i}" placeholder="الاسم الظاهر (مثل: رصيد ليبيانا)" value="${esc(p.label)}">
      <input class="input" data-pv="${i}" dir="ltr" placeholder="الرقم / الحساب / المعرّف" value="${esc(p.value)}">
      <div class="field" style="grid-column:1/-1;display:${mode === 'manual' ? 'none' : 'grid'};grid-template-columns:1fr 120px;align-items:center;gap:8px">
        <label class="body-sm" for="pr_${i}">سعر الصرف: 1 ${baseSym()} = ؟ ${esc(p.currency || CUR[p.type] || 'د.ل')}</label>
        <input class="input" id="pr_${i}" data-pr="${i}" type="number" step="0.01" min="0.0001" dir="ltr" placeholder="${baseCur() === 'USD' ? 'مثال: 11.8' : '1'}" value="${p.rate && !(baseCur() === 'USD' && p.rate === 1 && (p.currency || CUR[p.type] || 'د.ل') === 'د.ل') ? esc(String(p.rate)) : ''}"></div>
      <label class="m-proof" style="margin:0"><span>${p._new || p.logo ? '✓ الصورة' : 'صورة الطريقة'}</span><input type="file" accept="image/*" data-pi="${i}" hidden></label>
      <button class="btn btn-ghost btn-sm" data-pd="${i}" type="button" style="color:var(--error)">حذف</button>
      <div class="caption" style="grid-column:1/-1">يدفع الزبون بـ <b>${esc(p.currency || CUR[p.type] || 'د.ل')}</b> — ${mode === 'manual' ? 'تكتب سعر كل خدمة بهذه الطريقة بنفسك' : 'السعر يُحسب تلقائيًا من سعر الخدمة × سعر الصرف'}</div></div>`).join('');
  modal(`
    <div class="modal-head"><div class="modal-title">إعدادات المتجر</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    <div class="field mb-3"><label class="field-label" for="stN">اسم المتجر</label><input class="input" id="stN" maxlength="40" value="${esc(m.name)}"></div>
    <div class="field mb-3"><label class="field-label" for="stC">التصنيف</label><select class="input" id="stC">${(S.mine.categories || []).map(c => `<option ${c === m.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
    <div class="field mb-3"><label class="field-label" for="stP">رقم تواصل مع الإدارة (إجباري)</label><input class="input" id="stP" dir="ltr" inputmode="numeric" placeholder="09xxxxxxxx" value="${esc(m.contact_phone || '')}">
      <div class="caption">لا يظهر للزبائن — تستخدمه إدارة كاردو للتواصل معك عند أي مشكلة.</div></div>
    <div class="field mb-3"><label class="field-label" for="stB">نبذة</label><textarea class="input" id="stB" rows="3" maxlength="500">${esc(m.bio)}</textarea></div>
    <div class="card mb-3" style="padding:12px !important">
      <label class="perm-chk mb-2"><input type="checkbox" id="scOn" ${m.schedule && m.schedule.enabled ? 'checked' : ''}> <b>جدول عمل تلقائي</b> — يفتح ويُغلق المتجر وحده (بتوقيت ليبيا)</label>
      <div id="scBox" ${m.schedule && m.schedule.enabled ? '' : 'style="display:none"'}>
        <div class="sc-days mb-2">${['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'].map((d, i) => `<label class="sc-day"><input type="checkbox" data-scd="${i}" ${(m.schedule && m.schedule.enabled ? m.schedule.days : [0, 1, 2, 3, 4, 6]).includes(i) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div>
        <div class="flex-between" style="gap:8px"><div class="field" style="flex:1"><label class="field-label" for="scF">من</label><input class="input" id="scF" type="time" value="${esc((m.schedule && m.schedule.from) || '10:00')}"></div>
          <div class="field" style="flex:1"><label class="field-label" for="scT">إلى</label><input class="input" id="scT" type="time" value="${esc((m.schedule && m.schedule.to) || '00:00')}"></div></div>
        <div class="caption">إذا كان وقت النهاية بعد منتصف الليل (مثل 00:00 أو 02:00) يُحسب تلقائيًا.</div>
      </div>
      <div class="field" id="stHBox" ${m.schedule && m.schedule.enabled ? 'style="display:none"' : ''}><label class="field-label" for="stH">أوقات العمل (نص يظهر للزبون)</label><input class="input" id="stH" maxlength="80" value="${esc(m.hours || '')}" placeholder="مثال: يوميًا 10 صباحًا – 12 ليلًا"></div>
    </div>
    <label class="m-proof mb-2"><span id="stLt">${m.logo ? '✓ الشعار — اضغط للتغيير' : '📷 شعار المتجر'}</span><input type="file" accept="image/*" id="stL" hidden></label>
    <label class="m-proof mb-3"><span id="stVt">${m.cover ? '✓ الغلاف — اضغط للتغيير' : 'صورة الغلاف'}</span><input type="file" accept="image/*" id="stV" hidden></label>
    <div class="field mb-3"><label class="field-label" for="stMode">طريقة التسعير</label>
      <select class="input" id="stMode"><option value="auto" ${mode === 'auto' ? 'selected' : ''}>تلقائي — أكتب سعرًا واحدًا وتُحسب باقي الطرق بسعر الصرف</option><option value="manual" ${mode === 'manual' ? 'selected' : ''}>يدوي — أكتب سعر كل طريقة دفع بنفسي</option></select></div>
    <div class="field mb-3" id="stBaseBox" ${mode === 'manual' ? 'style="display:none"' : ''}><label class="field-label" for="stBase">عملة أسعار متجرك</label>
      <select class="input" id="stBase"><option value="USD" ${base === 'USD' ? 'selected' : ''}>دولار ($)</option><option value="LYD" ${base === 'LYD' ? 'selected' : ''}>دينار (د.ل)</option></select>
      <div class="caption">تكتب سعر كل خدمة بهذه العملة مرة واحدة، والمنصة تحسب سعرها في كل طريقة دفع حسب سعر الصرف.</div></div>
    <div class="field-label mb-2" id="stPaysLbl">${mode === 'manual' ? 'طرق الدفع' : 'طرق الدفع وأسعار الصرف'}</div>
    <div id="stPays">${payRows()}</div>
    <button class="btn btn-ghost btn-sm mb-3" id="stPAdd" type="button">+ طريقة دفع</button>
    <div class="field mb-3"><label class="field-label" for="stQ">ردود جاهزة للتسليم (كل رد في سطر، حتى 10)</label><textarea class="input" id="stQ" rows="4" maxlength="3000" placeholder="تم الشحن بنجاح ✅ شكرًا لثقتك">${esc((m.quick_replies || []).join('\n'))}</textarea></div>
    <div class="field mb-2"><label class="field-label" for="stW">واتساب (مع رمز الدولة)</label><input class="input" id="stW" dir="ltr" placeholder="+2189…" value="${esc((m.contacts || {}).whatsapp || '')}"></div>
    <div class="field mb-2"><label class="field-label" for="stT">تيليجرام (اسم المستخدم)</label><input class="input" id="stT" dir="ltr" value="${esc((m.contacts || {}).telegram || '')}"></div>
    <div class="field mb-3"><label class="field-label" for="stF">فيسبوك (رابط الصفحة)</label><input class="input" id="stF" dir="ltr" value="${esc((m.contacts || {}).facebook || '')}"></div>
    <button class="btn btn-primary btn-block" id="stSave" type="button">حفظ</button>`);
  $('#stMode').onchange = () => { sync(); mode = $('#stMode').value === 'manual' ? 'manual' : 'auto';
    $('#stBaseBox').style.display = mode === 'manual' ? 'none' : ''; $('#stPaysLbl').textContent = mode === 'manual' ? 'طرق الدفع' : 'طرق الدفع وأسعار الصرف';
    $('#stPays').innerHTML = payRows(); bindP();
    if (mode === 'manual' && (S.mine.services || []).length) toast('بعد الحفظ افتح كل خدمة واكتب سعرها لكل طريقة دفع', ''); };
  $('#stBase').onchange = () => { sync(); base = $('#stBase').value === 'USD' ? 'USD' : 'LYD'; $('#stPays').innerHTML = payRows(); bindP();
    if (base !== (m.base_currency === 'USD' ? 'USD' : 'LYD') && (S.mine.services || []).length) toast('بعد الحفظ راجع سعر كل خدمة ليكون بالعملة الجديدة', ''); };
  $('#scOn').onchange = () => { $('#scBox').style.display = $('#scOn').checked ? '' : 'none'; $('#stHBox').style.display = $('#scOn').checked ? 'none' : ''; };
  const sync = () => $$('#stPays [data-pl]').forEach(el => { const i = +el.dataset.pl;
    const type = $(`[data-pt="${i}"]`).value;
    pays[i] = { ...pays[i], type, label: el.value.trim(), value: $(`[data-pv="${i}"]`).value.trim(), rate: Number($(`[data-pr="${i}"]`).value || 0), currency: CUR[type] || pays[i].currency || '' }; });
  const sameCur = p => (base === 'USD' ? ['USDT', '$'] : ['د.ل']).includes(p.currency || CUR[p.type] || 'د.ل');
  const bindP = () => {
    $$('[data-pd]').forEach(b => b.onclick = () => { sync(); pays.splice(+b.dataset.pd, 1); $('#stPays').innerHTML = payRows(); bindP(); });
    $$('[data-pt]').forEach(sel => sel.onchange = () => { sync(); $('#stPays').innerHTML = payRows(); bindP(); });
    $$('[data-pi]').forEach(inp => inp.onchange = async () => { try { sync(); pays[+inp.dataset.pi]._new = await compressImage(inp.files[0], 160, 0.85); $('#stPays').innerHTML = payRows(); bindP(); toast('أُرفقت الصورة', 'ok'); } catch (e) { toast(e.message, 'bad'); } });
  };
  bindP();
  onTap('#stPAdd', () => { sync(); if (pays.length >= 6) return; pays.push({ id: 'pm' + Date.now().toString(36), type: 'binance', label: '', value: '', currency: 'USDT', rate: 1, logo: '', _new: null }); $('#stPays').innerHTML = payRows(); bindP(); });
  $('#stL').onchange = async () => { try { logo = await compressImage($('#stL').files[0], 300, 0.8); $('#stLt').textContent = '✓ أُرفق الشعار'; } catch (e) { toast(e.message, 'bad'); } };
  $('#stV').onchange = async () => { try { cover = await compressImage($('#stV').files[0], 1000, 0.7); $('#stVt').textContent = '✓ أُرفق الغلاف'; } catch (e) { toast(e.message, 'bad'); } };
  onTap('#stSave', async () => {
    sync();
    const schedule = $('#scOn').checked ? { enabled: true, days: $$('[data-scd]').filter(x => x.checked).map(x => +x.dataset.scd), from: $('#scF').value, to: $('#scT').value } : { enabled: false };
    if (!/^0?9[1-5]\d{7}$/.test(($('#stP').value || '').replace(/\D/g, ''))) return toast('أدخل رقم تواصل صحيح (09xxxxxxxx)', 'bad');
    for (const p of pays.filter(x => x.label && x.value)) {               // سعر الصرف إلزامي إلا إذا كانت عملة الطريقة نفس عملة المتجر
      if (!(p.rate > 0)) { if (mode === 'manual' || sameCur(p)) p.rate = 1; else return toast(`اكتب سعر الصرف لطريقة «${p.label}»`, 'bad'); }
    }
    const body = { contact_phone: $('#stP').value.trim(), name: $('#stN').value.trim(), category: $('#stC').value, bio: $('#stB').value.trim(), hours: $('#stH').value.trim(), open: m.open, schedule,
      base_currency: $('#stBase').value, pricing_mode: mode, pay_methods: pays.filter(p => p.label && p.value).map(p => { const o = { id: p.id, type: p.type, label: p.label, value: p.value, currency: p.currency, rate: p.rate }; if (p._new) o.logo = p._new; return o; }), quick_replies: $('#stQ').value.split('\n').map(x => x.trim()).filter(Boolean),
      contacts: { whatsapp: $('#stW').value.trim(), telegram: $('#stT').value.trim(), facebook: $('#stF').value.trim() } };
    if (logo !== null) body.logo = logo;
    if (cover !== null) body.cover = cover;
    try { await api('/api/m/profile', body); closeModal(); toast('حُفظت بيانات المتجر ✓', 'ok'); loadMine(); loadMerchants(true); }
    catch (e) { toast(e.message, 'bad'); }
  });
}

// v40: نافذة مستقلة وواضحة لطريقة التسعير (تلقائي بسعر الصرف / يدوي لكل طريقة)
function openMsPricing() {
  const m = S.mine.merchant;
  const CUR = { libyana: 'د.ل', almadar: 'د.ل', bank: 'د.ل', binance: 'USDT', usdt: 'USDT', other: '' };
  const pms = (m.pay_methods || []).map((p, k) => ({ ...p, id: p.id || ('pm' + k) }));
  if (!pms.length) return toast('أضف طرق الدفع أولًا من «تعديل بيانات المتجر»', 'bad');
  let mode = m.pricing_mode === 'manual' ? 'manual' : 'auto', base = m.base_currency === 'USD' ? 'USD' : 'LYD';
  const curOf = p => p.currency || CUR[p.type] || 'د.ل';
  const sameCur = p => (base === 'USD' ? ['USDT', '$'] : ['د.ل']).includes(curOf(p));
  const body = () => `
    <div class="pills mb-3"><button class="pill ${mode === 'auto' ? 'active' : ''}" data-pmode="auto" type="button">⚙️ تلقائي</button><button class="pill ${mode === 'manual' ? 'active' : ''}" data-pmode="manual" type="button">✍️ يدوي</button></div>
    ${mode === 'manual' ? `<div class="alert alert-info mb-3"><div>عند إضافة أو تعديل أي منتج تظهر لك خانة سعر لكل طريقة دفع، وكلها إلزامية.</div></div>` : `
      <p class="caption mb-3">تكتب سعر المنتج مرة واحدة، ويُحسب سعر كل طريقة: <b>السعر × سعر الصرف</b>.</p>
      <div class="field mb-3"><label class="field-label" for="prBase">عملة أسعار منتجاتك</label>
        <select class="input" id="prBase"><option value="USD" ${base === 'USD' ? 'selected' : ''}>دولار ($)</option><option value="LYD" ${base === 'LYD' ? 'selected' : ''}>دينار (د.ل)</option></select></div>
      <div class="field-label mb-2">سعر الصرف لكل طريقة دفع</div>
      ${pms.map(p => `<div class="field mb-2" style="display:grid;grid-template-columns:1fr 110px;align-items:center;gap:8px">
        <label class="body-sm" for="prR_${esc(p.id)}">${esc(p.label)}<span class="caption" style="display:block">1 ${base === 'USD' ? '$' : 'د.ل'} = ؟ ${esc(curOf(p))}</span></label>
        <input class="input" id="prR_${esc(p.id)}" data-prr="${esc(p.id)}" type="number" step="0.01" min="0" dir="ltr" placeholder="${sameCur(p) ? '1' : 'مثال: 11.8'}" value="${p.rate && !(p.rate === 1 && !sameCur(p)) ? esc(String(p.rate)) : ''}"></div>`).join('')}`}
    <button class="btn btn-primary btn-block" id="prSave" type="button" style="margin-top:8px">حفظ</button>`;
  modal(`<div class="modal-head"><div class="modal-title">طريقة التسعير</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div><div id="prBody">${body()}</div>`);
  const readRates = () => $$('[data-prr]').forEach(i => { const p = pms.find(x => x.id === i.dataset.prr); if (p) p.rate = Number(i.value || 0); });
  const bindPr = () => {
    $$('[data-pmode]').forEach(b => b.onclick = () => { readRates(); mode = b.dataset.pmode; $('#prBody').innerHTML = body(); bindPr(); });
    const bs = $('#prBase'); if (bs) bs.onchange = () => { readRates(); base = bs.value === 'USD' ? 'USD' : 'LYD'; $('#prBody').innerHTML = body(); bindPr(); };
    onTap('#prSave', async () => {
      readRates();
      if (mode === 'auto') for (const p of pms) { if (!(p.rate > 0)) { if (sameCur(p)) p.rate = 1; else return toast(`اكتب سعر الصرف لـ «${p.label}»`, 'bad'); } }
      const b = $('#prSave'); b.disabled = true; b.classList.add('loading');
      try {
        await api('/api/m/profile', { pricing_mode: mode, base_currency: base, contact_phone: m.contact_phone || '', name: m.name, category: m.category, bio: m.bio, hours: m.hours,
          pay_methods: pms.map(p => ({ id: p.id, type: p.type, label: p.label, value: p.value, currency: p.currency, rate: mode === 'auto' ? p.rate : (p.rate || 1) })),
          contacts: m.contacts, quick_replies: m.quick_replies, open: m.open, schedule: m.schedule || { enabled: false } });
        closeModal(); toast('حُفظت طريقة التسعير ✓', 'ok'); loadMine(true); loadMerchants(true);
        if (mode === 'manual' && m.pricing_mode !== 'manual' && (S.mine.services || []).length) setTimeout(() => toast('افتح كل منتج واكتب سعره لكل طريقة دفع', ''), 1200);
      } catch (e) { toast(e.message, 'bad'); b.disabled = false; b.classList.remove('loading'); }
    });
  };
  bindPr();
}

async function msToggleOpen() {
  const m = S.mine.merchant;
  try {
    await api('/api/m/profile', { base_currency: m.base_currency || 'LYD', pricing_mode: m.pricing_mode || 'auto', contact_phone: m.contact_phone || '', name: m.name, category: m.category, bio: m.bio, hours: m.hours, pay_methods: m.pay_methods, contacts: m.contacts, quick_replies: m.quick_replies, open: !m.open, schedule: m.schedule || { enabled: false } });
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
  ['welcome', 'أهلًا بك في كاردو', 'محفظتك الرقمية بالدينار الليبي: اشحنها مرة، واشترِ منها شحن الألعاب وبطاقات الهدايا وبطاقتك الافتراضية.'],
  ['card', 'اشحن محفظتك', 'عبر ليبيانا أو المدار أو التحويل المصرفي أو USDT، ويُضاف رصيدك بسرعة.'],
  ['success', 'كل طلباتك في مكان واحد', 'الأكواد تصلك فورًا في «طلباتي»، وإن تعذّر طلب يُعاد المبلغ لمحفظتك تلقائيًا.'],
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
  $$('[data-paytype]').forEach(b => b.onclick = () => setPayType(b.dataset.paytype));
  $$('[data-mchat]').forEach(b => b.onclick = () => openChat('', b.dataset.mchat, 'customer'));
  $$('[data-chat]').forEach(b => b.onclick = () => openChat(b.dataset.chat, '', 'customer'));
  $$('[data-mschat]').forEach(b => b.onclick = () => openChat(b.dataset.mschat, '', 'merchant'));
  $$('[data-sec]').forEach(b => b.onclick = () => { S.curSection = { mid: S.curStore, id: b.dataset.sec }; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  onTap('#secBack', () => { S.curSection = null; render(); });
  onTap('#msSecAdd', () => openMsSection(''));
  $$('[data-mssec]').forEach(b => b.onclick = () => openMsSection(b.dataset.mssec));
  onTap('#pushOn', async () => { if (await registerPushToken(false)) render(); });
  onTap('#joinMerchant', () => openJoinMerchant());
  $$('[data-store]').forEach(b => b.onclick = () => { S.curStore = b.dataset.store; S.curSection = null; go('store'); });
  $$('[data-msvc]').forEach(b => b.onclick = () => openMService(b.dataset.msvc));
  $$('[data-mreport]').forEach(b => b.onclick = () => openMReport(b.dataset.mreport));
  $$('[data-mkcat]').forEach(b => b.onclick = () => { S.mkCat = b.dataset.mkcat; render(); });
  const q = $('#mkQ');
  if (q) {
    q.oninput = () => { S.mkQ = q.value; clearTimeout(q._t); q._t = setTimeout(() => { render(); const n = $('#mkQ'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 300); };
    if (S._focusSearch) { S._focusSearch = false; setTimeout(() => { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 60); }
  }
  const hq = $('#homeQ');
  if (hq) hq.oninput = () => { if (hq.value.trim().length >= 1) { S.mkQ = hq.value; S.mkCat = ''; S._focusSearch = true; go('stores'); } };
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
  onTap('#mPriceOpen', () => openMsPricing());
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

/* ═══ v20 — شارة التوثيق، الصور الرمزية، المحادثات، الأقسام ═══ */
const vb = m => (m && m.verified) ? VBADGE : '';
const VBADGE = '<svg class="vbadge" viewBox="0 0 24 24" aria-label="موثّق" role="img"><circle cx="12" cy="12" r="12" fill="#20A0F0"/><path d="M6.8 12.4l3.4 3.4 7-7.2" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const AV_PAL = [['#f0d29c', '#a8793f'], ['#7dd3fc', '#1d4ed8'], ['#f9a8d4', '#be185d'], ['#86efac', '#15803d'], ['#fcd34d', '#b45309'], ['#c4b5fd', '#6d28d9'], ['#fca5a5', '#b91c1c'], ['#5eead4', '#0f766e']];
function avatarUrl(seed, name) {
  const h = hashStr(String(seed || 'x')), [a, b] = AV_PAL[h % AV_PAL.length];
  const shapes = [0, 1, 2].map(i => { const v = (h >> (i * 7)) & 127; return `<circle cx="${10 + (v % 44)}" cy="${8 + ((v * 7) % 48)}" r="${6 + (v % 12)}" fill="#fff" fill-opacity="${0.08 + (i * 0.05)}"/>`; }).join('');
  const ch = String(name || '؟').trim().charAt(0).toUpperCase().replace(/[<&>"]/g, '');
  const svgS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(#g)"/>${shapes}<text x="32" y="42" text-anchor="middle" font-family="Tahoma,Arial" font-size="28" font-weight="700" fill="#fff">${ch}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgS);
}
const avatarImg = (seed, name, size = 36) => `<img class="avatar" src="${avatarUrl(seed, name)}" alt="" width="${size}" height="${size}">`;

/* ─── المحادثات ─── */
let _chatUnsub = null;
function vChats() {
  const list = (S.mChats || []).slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  return `
  <div class="page-enter">
    <div class="mb-4"><h1 class="h2" style="margin-bottom:6px">المحادثات</h1><p class="body-sm text-2">محادثاتك مع التجار</p></div>
    ${list.length ? `<div class="list">${list.map(c => `
      <div class="list-row" data-chat="${esc(c.id)}" role="button" tabindex="0">${avatarImg(c.mid, c.merchant_name, 40)}
        <div class="list-content"><div class="list-title">${esc(c.merchant_name)} ${vb(mById(c.mid))}</div><div class="list-meta">${esc(c.last_by === 'customer' ? 'أنت: ' : '')}${esc(c.last_text || '')}</div></div>
        <div class="list-end">${c.unread_c ? `<span class="chat-unread">${c.unread_c}</span>` : `<span class="caption">${esc(dt(c.updated_at))}</span>`}</div></div>`).join('')}</div>`
      : `<div class="card" style="text-align:center;padding:30px">${fennec('mail', 110)}<div class="h4">لا محادثات بعد</div><p class="caption">ادخل أي متجر واضغط «محادثة مع التاجر»</p></div>`}
  </div>`;
}
function openChat(id, mid, meRole = 'customer') {
  const render1 = (c) => {
    const title = meRole === 'customer' ? (c ? c.merchant_name : (mById(mid) || {}).name || 'التاجر') : (c ? c.customer_name : 'الزبون');
    const seed = meRole === 'customer' ? (c ? c.mid : mid) : (c ? c.uid : '');
    modal(`
      <div class="modal-head"><div class="modal-title" style="display:flex;gap:8px;align-items:center">${avatarImg(seed, title, 30)} ${esc(title)} ${meRole === 'customer' ? vb(mById(c ? c.mid : mid)) : ''}</div>
        <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
      ${chatHtml(c ? c.messages : [], meRole)}
      <div class="m-chat-in"><input class="input" id="chMsg" maxlength="1000" placeholder="اكتب رسالتك…" autocomplete="off"><button class="btn btn-primary btn-sm" id="chSend" type="button">إرسال</button></div>`);
    const box = document.querySelector('.chat'); if (box) box.scrollTop = box.scrollHeight;
    const send = async () => {
      const text = ($('#chMsg').value || '').trim(); if (!text) return;
      $('#chMsg').value = '';
      try { const r = await api('/api/m/chat', id ? { id, text } : { mid, text }); if (!id) { id = r.id; listen(); } else if (_chatUnsub && _chatUnsub.now) _chatUnsub.now(); } catch (e) { toast(e.message, 'bad'); }
    };
    onTap('#chSend', send);
    const inp = $('#chMsg'); if (inp) { inp.onkeydown = e => { if (e.key === 'Enter') send(); }; }
  };
  const paint = c => {
    const typed = $('#chMsg').value;
    render1(c);
    $('#chMsg').value = typed; $('#chMsg').focus();
  };
  const listen = () => {
    if (_chatUnsub) { try { _chatUnsub(); } catch {} }
    if (d1On('merchant_chats')) {                       // v34: كل 5 ثوانٍ والمحادثة ظاهرة فقط
      let since = 0;
      const stop = makePoll(async () => {
        if (!document.getElementById('chMsg')) { stop(); if (_chatUnsub === stop) _chatUnsub = null; return; }
        const r = await api('/api/sync/chat', { id, since });
        since = r.ts || since;
        if (r.changed && document.getElementById('chMsg')) paint(r.chat || null);
      }, 5000);
      _chatUnsub = stop;
    } else {
      _chatUnsub = onSnapshot(doc(db, 'merchant_chats', id), s => {
        if (!document.getElementById('chMsg')) { try { _chatUnsub(); } catch {} _chatUnsub = null; return; }
        paint(s.exists() ? { id, ...s.data() } : null);
      }, () => {});
    }
    api('/api/m/chat/read', { id }).catch(() => {});
  };
  if (!id && mid && S.user) { const guess = `${mid}_${S.user.uid}`; id = (S.mChats || []).some(c => c.id === guess) ? guess : ''; }
  render1(id ? ((meRole === 'customer' ? S.mChats : S.mstoreChats) || []).find(c => c.id === id) || null : null);
  if (id) listen();
}

/* ─── صفحة المتجر (تصميم جديد) ─── */
function vStore() {
  const m = mById(S.curStore);
  if (!m) { if (!S.mk.loaded) loadMerchants(); return `<div class="page-enter"><div class="card" style="text-align:center;padding:30px">${S.mk.loaded ? 'المتجر غير متاح' : 'جارٍ التحميل…'}</div></div>`; }
  const svcs = mServices(m.id);
  const secs = (S.mk.sections || []).filter(x => x.mid === m.id);
  const isFav = favs().includes(m.id);
  if (!S.reviews || S.reviews.mid !== m.id) { S.reviews = { mid: m.id, list: null }; api('/api/m/reviews', { mid: m.id }).then(r => { S.reviews = { mid: m.id, list: r.reviews }; render(); }).catch(() => {}); }
  const svcBtn = s => `
      <button class="prow" data-msvc="${esc(s.id)}" ${(s.delivery === 'stock' && s.stock < 1) || m.open === false ? 'disabled' : ''}>
        <span class="prow-img">${s.image ? `<img src="${esc(s.image)}" alt="" loading="lazy">` : '🛍️'}</span>
        <span class="prow-body"><span class="prow-name">${esc(s.name)}</span>
          <span class="prow-price" style="display:block">${svcPriceHtml(s, m)}</span>
          <span class="caption" style="display:block">${s.delivery === 'stock' ? (s.stock > 0 ? '⚡ تسليم فوري' : '⛔ نفذت الكمية') : '🕐 تنفيذ يدوي'}${s.eta ? ` · ⏱️ ${esc(s.eta)}` : ''}</span></span>
        <span class="prow-add" aria-hidden="true">+</span>
      </button>`;
  const curSec = S.curSection && S.curSection.mid === m.id ? S.curSection.id : '';
  const inSec = id => svcs.filter(s => (s.section_id || '') === id);
  const orphan = svcs.filter(s => !s.section_id || !secs.some(x => x.id === s.section_id));
  let servicesHtml;
  if (!secs.length) servicesHtml = svcs.length ? `<div class="svc-list stagger">${svcs.map(svcBtn).join('')}</div>` : `<div class="card k-empty">${fennec('empty', 90)}<div class="h4">لا خدمات بعد</div></div>`;
  else if (curSec) {
    const sec = secs.find(x => x.id === curSec) || { name: 'أخرى', delivery: 'manual' };
    const list = curSec === '_other' ? orphan : inSec(curSec);
    servicesHtml = `<button class="btn btn-ghost btn-sm mb-2" id="secBack" style="padding:0">→ كل الأقسام</button>
      <div class="flex-between mb-3"><div class="h4">${esc(sec.name)}</div></div>
      <div class="svc-list stagger">${list.map(svcBtn).join('') || '<p class="caption">لا خدمات في هذا القسم</p>'}</div>`;
  } else servicesHtml = `<div class="sec-grid stagger">${secs.map(x => `
      <button class="sec-tile" data-sec="${esc(x.id)}">
        <span class="sec-img">${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy">` : `<b>${esc(x.name.charAt(0))}</b>`}
          </span>
        <span class="sec-name">${esc(x.name)}</span><span class="caption">${inSec(x.id).length} خدمة</span>
      </button>`).join('')}${orphan.length ? `<button class="sec-tile" data-sec="_other"><span class="sec-img"><b>…</b></span><span class="sec-name">أخرى</span><span class="caption">${orphan.length} خدمة</span></button>` : ''}</div>`;
  const rv = S.reviews && S.reviews.list;
  return `
  <div class="page-enter store-page">
    <button class="btn btn-ghost btn-sm mb-2" data-nav="stores" style="padding:0">→ كل المتاجر</button>
    <div class="m-hero">${m.cover ? `<img src="${esc(m.cover)}" alt="">` : ''}</div>
    <div class="st-head">
      ${mLogo(m, 'm-logo m-logo-lg st-logo')}
      <button class="icon-pill st-fav" data-mfav="${esc(m.id)}" aria-label="المفضلة">${isFav ? '⭐' : '☆'}</button>
    </div>
    <div class="st-info">
      <h1 class="st-name">${esc(m.name)} ${vb(m)} ${tierBadge(m)}</h1>
      ${m.verified ? `<div class="st-meta" style="color:#20A0F0">موثّق من كاردو${m.verified_since ? ` منذ ${esc(m.verified_since)}` : ''}</div>` : ''}
      <div class="st-meta"><span>${esc(m.category)}</span><span>·</span>${m.rating ? `<span class="m-rate">★ ${esc(Number(m.rating).toFixed(1))}</span><span class="caption">(${m.rating_count})</span><span>·</span>` : ''}<span>${m.orders_done || 0} طلب مكتمل</span></div>
      <div class="st-meta">${openBadge(m)}${m.hours ? `<span>·</span><span>🕒 ${esc(m.hours)}</span>` : ''}${m.avg_confirm_min !== null && m.avg_confirm_min !== undefined ? `<span>·</span><span>⏱️ يؤكد خلال ~${m.avg_confirm_min || 1} د</span>` : ''}</div>
      ${m.bio ? `<p class="st-bio">${esc(m.bio)}</p>` : ''}
    </div>
    <div class="st-actions">
      <button class="btn btn-primary" data-mchat="${esc(m.id)}">محادثة مع التاجر</button>
      <button class="btn btn-secondary" data-mshare="${esc(m.slug || '')}" aria-label="مشاركة">🔗</button>
      <button class="btn btn-secondary" data-mreport="${esc(m.id)}" aria-label="إبلاغ" style="color:var(--error)">⚑</button>
    </div>
    ${(m.pay_methods || []).length ? `<div class="field-label mb-2">طريقة دفعك (الأسعار تتغير حسبها)</div>
      <div class="pm-chips mb-3">${m.pay_methods.map(p => `<button type="button" class="pm-chip ${pickPm(m) && pickPm(m).id === p.id ? 'on' : ''}" data-paytype="${esc(p.type)}">
        ${p.logo ? `<img src="${esc(p.logo)}" alt="">` : ''}<span>${esc(p.label)}</span></button>`).join('')}</div>` : ''}
    ${m.open === false ? `<div class="neon-warn mb-3"><div class="neon-warn-title">🔴 المتجر مغلق حاليًا</div><p>لا يستقبل طلبات الآن${m.hours ? ` — أوقات العمل: ${esc(m.hours)}` : ''}.</p></div>` : ''}
    <div class="alert alert-warning mb-4">💳<div>الدفع يتم <b>مباشرة لأرقام التاجر</b>، وكاردو تعرض المتجر وتسجّل طلبك وإيصالك.</div></div>
    <div class="h4 mb-3">${secs.length && !curSec ? 'الأقسام' : 'الخدمات'}</div>
    ${servicesHtml}
    <div class="h4 mb-3" style="margin-top:22px">آراء الزبائن ${m.rating ? `<span class="m-rate">★ ${esc(Number(m.rating).toFixed(1))}</span>` : ''}</div>
    ${rv === null ? '<div class="skeleton" style="height:60px;border-radius:14px"></div>'
      : rv.length ? `<div style="display:flex;flex-direction:column;gap:8px">${rv.slice(0, 10).map(r => `
        <div class="card m-review"><div class="flex-between"><span style="display:flex;gap:8px;align-items:center">${avatarImg(r.name + r.at, r.name, 28)}<b>${esc(r.name)}</b></span><span class="m-rate">${'★'.repeat(r.stars)}</span></div>
          ${r.text ? `<p class="body-sm" style="margin:6px 0 2px">${esc(r.text)}</p>` : ''}<div class="caption">${esc(r.service || '')} · ${esc(dt(r.at))}</div></div>`).join('')}</div>`
      : '<p class="caption">لا تقييمات بعد — كن أول من يقيّم بعد طلبك.</p>'}
  </div>`;
}

/* ─── إدارة الأقسام (للتاجر) ─── */
function openMsSection(id) {
  const x = id ? (S.mine.sections || []).find(s => s.id === id) : { name: '', order: (S.mine.sections || []).length + 1, delivery: 'manual', image: '' };
  let image = null;
  modal(`
    <div class="modal-head"><div class="modal-title">${id ? 'تعديل القسم' : 'قسم جديد'}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    <div class="field mb-3"><label class="field-label" for="scN">اسم القسم</label><input class="input" id="scN" maxlength="30" value="${esc(x.name)}" placeholder="مثال: ببجي"></div>
    <input type="hidden" id="scD" value="manual">
    <div class="field mb-3"><label class="field-label" for="scO">الترتيب (الأصغر يظهر أولًا)</label><input class="input" id="scO" type="number" min="0" dir="ltr" value="${esc(String(x.order || 0))}"></div>
    <label class="m-proof mb-3"><span id="scIt">${x.image ? '✓ صورة القسم — اضغط للتغيير' : 'صورة القسم'}</span><input type="file" accept="image/*" id="scI" hidden></label>
    <button class="btn btn-primary btn-block" id="scSave" type="button">حفظ</button>
    ${id ? '<button class="btn btn-ghost btn-block" id="scDel" type="button" style="color:var(--error);margin-top:6px">حذف القسم</button>' : ''}`);
  $('#scI').onchange = async () => { try { image = await compressImage($('#scI').files[0], 500, 0.75); $('#scIt').textContent = '✓ أُرفقت الصورة'; } catch (e) { toast(e.message, 'bad'); } };
  onTap('#scSave', async () => {
    const body = { id: id || '', name: $('#scN').value.trim(), delivery: $('#scD').value, order: Number($('#scO').value || 0) };
    if (image !== null) body.image = image;
    try { await api('/api/m/section/save', body); closeModal(); toast('حُفظ القسم ✓', 'ok'); loadMine(); loadMerchants(true); } catch (e) { toast(e.message, 'bad'); }
  });
  onTap('#scDel', async () => { if (!confirm('حذف القسم؟')) return; try { await api('/api/m/section/delete', { id }); closeModal(); toast('حُذف', 'ok'); loadMine(); loadMerchants(true); } catch (e) { toast(e.message, 'bad'); } });
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
apiGet('/api/status').then(d => { kdbCheckMode(d.d1p); S.config = { ...S.config, ...d }; renderLandingPlans(); }).catch(() => {});
// v35: فحص خفيف كل 5 دقائق لوضع قاعدة البيانات ومفاتيحها (الصفحة ظاهرة فقط)
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  apiGet('/api/status').then(d => { kdbCheckMode(d.d1p); S.config = { ...S.config, ...d }; try { d1Resync(); } catch {} }).catch(() => {});
}, 300000);
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

// إعادة محاولة تحميل لوحة المتجر بعد خطأ مؤقت
document.addEventListener('click', e => { if (e.target && e.target.closest && e.target.closest('#msRetry')) { S.mine = null; render(); } });

/* ═══════════════════════════════════════════════════════════
   v44 — متجر كاردو (Resell Codes): أقسام، عروض، شراء فوري، أكواد
   ═══════════════════════════════════════════════════════════ */
const rscOn = () => S.config && S.config.rsc_on !== false;
const rscImgUrl = u => !u ? '' : /^\//.test(u) ? API_BASE + u : u;
const RSC_ST = { submitting: ['badge-warning', 'قيد الإرسال'], created: ['badge-warning', 'قيد التنفيذ'], processing: ['badge-warning', 'قيد التنفيذ'],
  unknown: ['badge-warning', 'قيد المراجعة'], completed: ['badge-success', 'مكتمل'], refunded: ['badge-error', 'مُسترد'] };
S.rsc = { loaded: false, cats: [], error: false };
let _rscLoading = null;
async function loadRsc(force) {
  if (_rscLoading || (S.rsc.loaded && !force && Date.now() - (S.rsc.at || 0) < 120000)) return _rscLoading;
  _rscLoading = (async () => {
    try { const d = await apiGet('/api/rsc/catalog'); S.rsc = { loaded: true, cats: d.categories || [], on: d.on !== false, at: Date.now() }; }
    catch { S.rsc = { ...S.rsc, error: true }; }
    _rscLoading = null; render();
  })();
  return _rscLoading;
}
async function loadRscOrders() {
  try { const r = await api('/api/rsc/my-orders', {}); S.rscOrders = r.orders || []; render(); } catch {}
}
const rscCatBy = key => (S.rsc.cats || []).find(c => c.key === key);
const rscFrom = c => Math.min(...(c.offers || []).map(o => o.price));
const RSC_GROUPS = ['topup', 'gift', 'subs', 'apps', 'pay'];
const rscGroup = c => RSC_GROUPS.includes(c.group) ? c.group : (c.type === 'topup' ? 'topup' : 'gift');
// v56: 5 أنواع بأيقونات مرسومة بدل الإيموجي
const RSC_TABS = [['all', 'الكل', 'star'], ['topup', 'ألعاب', 'game'], ['gift', 'بطاقات هدايا', 'giftbox'], ['subs', 'اشتراكات وترفيه', 'tv'], ['apps', 'تطبيقات وبرامج', 'apps'], ['pay', 'بطاقات دفع', 'paycard']];
const RSC_TT = Object.fromEntries(RSC_TABS.map(([k, t, i]) => [k, { t, i }]));
const rscIc = g => svg(I[(RSC_TT[g] || RSC_TT.all).i] || I.star);
const rscImgTag = (c, cls = '') => c.image ? `<img class="${cls}" src="${esc(rscImgUrl(c.image))}" alt="" loading="lazy" decoding="async">` : `<span class="rsc-ph ${cls}">${svg(c.type === 'topup' ? I.game : I.giftbox)}</span>`;
const rscPop = c => c.pop >= 1000 ? (c.pop / 1000).toFixed(1).replace('.0', '') + ' ألف طلب' : c.pop >= 10 ? c.pop + ' طلب' : '';
// بطاقة طويلة (ألعاب) — الصورة واضحة فوق خلفية ضبابية منها
function rscTile(c) {
  return `<button class="ktall${c.maint ? ' kmaint' : ''}" data-rsccat="${esc(c.key)}" type="button">
    <span class="ktall-cv">${c.image ? `<span class="ktall-bg" data-bg="${esc(rscImgUrl(c.image))}"></span>` : ''}${rscImgTag(c, 'ktall-img')}
      ${c.maint ? '<i class="kmb">قيد الصيانة</i>' : ''}${c.promo ? `<i class="ktag hot">${esc(c.promo.slice(0, 18))}</i>` : c.type === 'topup' ? '<i class="ktag">⚡ فوري</i>' : ''}</span>
    <span class="ktall-nm">${esc(c.name)}</span>
  </button>`;
}
// بطاقة هدايا بشكل بطاقة حقيقية
function rscGiftTile(c) {
  return `<button class="kgift${c.maint ? ' kmaint' : ''}" data-rsccat="${esc(c.key)}" type="button">
    ${c.image ? `<span class="kgift-bg" data-bg="${esc(rscImgUrl(c.image))}"></span>` : '<span class="kgift-bg ph"></span>'}
    <span class="kgift-top"><b>${esc(c.name)}</b><span class="kgift-chip"></span></span>
    <span class="kgift-from">${c.maint ? 'قيد الصيانة' : c.type === 'topup' ? '⚡ فوري' : 'كود فوري'}</span>
  </button>`;
}
function rscHero(list) {
  if (!list.length) return '';
  return `<div class="kheros" id="kHeros">${list.map(c => `<button class="khero" data-rsccat="${esc(c.key)}" type="button">
      ${c.image ? `<span class="khero-bg" style="background-image:url('${esc(rscImgUrl(c.image))}')"></span>` : '<span class="khero-bg ph"></span>'}
      <span class="khero-img">${rscImgTag(c)}</span>
      <i class="khero-tag">${svg(I.bolt)}${c.type === 'topup' ? 'يوصل خلال دقيقة' : 'الكود يوصلك فورًا'}</i>
      <span class="khero-txt"><b>${esc(c.name)}</b>${c.promo ? `<span>${esc(c.promo)}</span>` : ''}</span>
    </button>`).join('')}</div>
    ${list.length > 1 ? `<div class="kdots" id="kDots">${list.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}`;
}
function rscAgain() {
  const seen = new Set(), out = [];
  for (const o of (S.rscOrders || [])) {
    if (o.status !== 'completed' || !o.cat || !o.offer_id) continue;
    const k = o.cat + '|' + o.offer_id; if (seen.has(k)) continue; seen.add(k);
    const c = rscCatBy(o.cat), off = c && c.offers.find(x => x.id === o.offer_id);
    if (c && off) out.push({ o, c, off });
    if (out.length >= 6) break;
  }
  if (!out.length) return '';
  const mask = v => { v = String(v || ''); return v.length > 6 ? v.slice(0, 4) + '…' + v.slice(-2) : v; };
  return `<div class="ksh"><h2>اشتري مرة ثانية</h2></div>
    <div class="krow">${out.map(({ o, c, off }) => { const f = Object.values(o.fields || {})[0];
      return `<button class="kagain" data-rscagain="${esc(o.id)}" type="button"><span class="kagain-ic">${rscImgTag(c)}</span>
        <span class="kagain-t"><b dir="auto">${esc(off.name)}</b><span>${f ? `<bdi dir="ltr">${esc(mask(f))}</bdi> · ` : ''}${esc(lyd(off.price * rate()))}</span></span><span class="kagain-go">↺</span></button>`; }).join('')}</div>`;
}
function rscChips(tab, cats) {
  const has = g => g === 'all' || cats.some(c => rscGroup(c) === g);
  return `<div class="kchipsx">${RSC_TABS.filter(([k]) => has(k)).map(([k, t, e]) => `<button class="${tab === k ? 'on' : ''}" data-rsctab="${k}" type="button"><em class="kci">${svg(I[e])}</em>${t}</button>`).join('')}</div>`;
}
function rscPopular(cats, n = 8) { return cats.filter(c => (c.pop || 0) > 0 && !c.maint).sort((a, b) => b.pop - a.pop || a.sort - b.sort).slice(0, n); }
function rscPicks(cats, n = 8) { return cats.filter(c => c.pick).sort((a, b) => a.sort - b.sort).slice(0, n); }
function rscHome() {
  if (!rscOn()) return '';
  const st = secOf('store');
  if (st.s === 'off') return '';
  if (st.s === 'maint') return `<div class="ksec-note">${svg(I.help)}<div><b>المتجر قيد الصيانة</b><span>${esc(st.msg || 'نرجعوا قريب إن شاء الله')}</span></div></div>`;
  if (!S.rsc.loaded) { loadRsc(); return `<div class="ksh"><h2>المتجر</h2></div><div class="krow mb-5">${'<div class="skeleton" style="flex:none;width:118px;height:190px;border-radius:18px"></div>'.repeat(3)}</div>`; }
  const cats = S.rsc.cats || [];
  if (!cats.length) return '';
  const feat = cats.filter(c => c.featured && !c.maint).slice(0, 5);
  if (S.user && !S.rscOrders) { S.rscOrders = []; loadRscOrders(); }
  const tile = c => rscGroup(c) === 'topup' ? rscTile(c) : rscGiftTile(c).replace(/class="kgift/, 'class="kgift inrow');
  const top = rscPopular(cats), picks = top.length >= 3 ? [] : rscPicks(cats);
  const row = (ic, t, list, tab, total) => list.length ? `<div class="ksh"><h2><i class="ksh-ic">${ic}</i>${t}</h2><button data-hometab="${tab}" type="button">عرض الكل${total > list.length ? ` (${total})` : ''}</button></div><div class="krow mb-5">${list.map(tile).join('')}</div>` : '';
  const ord = list => [...list].sort((a, b) => (a.maint ? 1 : 0) - (b.maint ? 1 : 0) || (b.pop || 0) - (a.pop || 0) || a.sort - b.sort).slice(0, 8);
  const cnt = g => cats.filter(c => rscGroup(c) === g).length;
  const by = g => ord(cats.filter(c => rscGroup(c) === g));
  return `${feat.length ? `<div class="ksh"><h2>عروض اليوم</h2></div>${rscHero(feat)}` : ''}
    ${rscAgain()}
    ${top.length >= 3 ? row(svg(I.fire), 'الأكثر شحنًا', top, 'all') : picks.length ? row(svg(I.star), 'مختارات كاردو', picks, 'all') : ''}
    ${RSC_GROUPS.map(g => row(rscIc(g), RSC_TT[g].t, by(g), g, cnt(g))).join('')}`;
}
function vKStore() {
  if (!S.rsc.loaded) loadRsc();
  const cur = S.rscCat ? rscCatBy(S.rscCat) : null;
  if (cur && cur.maint) { S.rscCat = null; }
  else if (cur) return vRscProduct(cur);
  const q = (S.rscQ || '').trim().toLowerCase();
  const tab = S.rscTab || 'all';
  const cats = S.rsc.cats || [];
  const shown = cats.filter(c => (!q || srchMatch(c.name, q)) && (q || tab === 'all' || rscGroup(c) === tab));
  const feat = cats.filter(c => c.featured).slice(0, 5);
  const home = tab === 'all' && !q;
  if (home && S.user && !S.rscOrders) { S.rscOrders = []; loadRscOrders(); }
  const lim = S.rscLim && S.rscLim.k === tab + '|' + q ? S.rscLim.n : 24;
  const tileG = (c, g) => g === 'topup' ? rscTile(c) : rscGiftTile(c);
  const gridOf = (list, g) => g === 'topup' || g === 'mix' ? `<div class="kgrid3">${list.map(rscTile).join('')}</div>` : `<div class="kgrid2">${list.map(rscGiftTile).join('')}</div>`;
  const ord = list => [...list].sort((a, b) => (a.maint ? 1 : 0) - (b.maint ? 1 : 0) || (b.pop || 0) - (a.pop || 0) || a.sort - b.sort);
  const rowOf = g => { const all = ord(cats.filter(c => rscGroup(c) === g)); if (!all.length) return '';
    return `<div class="ksh"><h2><i class="ksh-ic">${rscIc(g)}</i>${RSC_TT[g].t}</h2><button data-rsctab="${g}" type="button">عرض الكل (${all.length})</button></div>
      <div class="krow mb-5">${all.slice(0, 10).map(c => g === 'topup' ? rscTile(c) : rscGiftTile(c).replace(/class="kgift/, 'class="kgift inrow')).join('')}</div>`; };
  const top = rscPopular(cats);
  const list = ord(shown), page = list.slice(0, lim), rest = list.length - page.length;
  return `<div class="page-enter">
    <h1 class="kpage-title">المتجر</h1>
    <p class="kpage-sub">شحن ألعاب وبطاقات واشتراكات — يوصلك خلال ثوانٍ</p>
    <label class="ksearch">${svg(I.search)}<input id="rscQ" placeholder="ابحث عن لعبة أو بطاقة…" value="${esc(S.rscQ || '')}" autocomplete="off" inputmode="search"></label>
    <div id="kChips">${rscChips(tab, cats)}</div><div id="kRes">
    ${!S.rsc.loaded && !S.rsc.error ? `<div class="kgrid3">${'<div class="skeleton" style="height:190px;border-radius:18px"></div>'.repeat(6)}</div>` : ''}
    ${S.rsc.error && !S.rsc.loaded ? `<div class="card" style="text-align:center;padding:28px 20px">${fennec('error')}<div class="h4 mb-3">تعذّر تحميل المتجر</div><button class="btn btn-primary" data-rscretry type="button">إعادة المحاولة</button></div>` : ''}
    ${S.rsc.loaded && home ? `
      ${feat.length ? `<div class="ksh"><h2>عروض اليوم</h2></div>${rscHero(feat)}` : ''}
      ${rscAgain()}
      ${top.length >= 3 ? `<div class="ksh"><h2><i class="ksh-ic">${svg(I.fire)}</i>الأكثر شحنًا</h2></div><div class="krow mb-5">${top.map(c => rscGroup(c) === 'topup' ? rscTile(c) : rscGiftTile(c).replace(/class="kgift/, 'class="kgift inrow')).join('')}</div>` : ''}
      ${RSC_GROUPS.map(rowOf).join('')}` : ''}
    ${S.rsc.loaded && !home && page.length ? `
      ${!q ? `<div class="ksh"><h2><i class="ksh-ic">${rscIc(tab)}</i>${RSC_TT[tab].t}</h2><span class="ksh-n">${list.length} قسم</span></div>` : `<div class="caption" style="margin:4px 2px 10px">${list.length} نتيجة</div>`}
      ${gridOf(page, q ? 'mix' : tab)}
      ${rest > 0 ? `<button class="kmore" data-rscmore="${esc(tab + '|' + q)}" data-n="${lim + 24}" type="button">عرض المزيد (${rest})</button>` : ''}` : ''}
    ${S.rsc.loaded && !shown.length ? `<div class="card" style="text-align:center;padding:32px 20px">${fennec('empty')}<div class="h4" style="margin-bottom:6px">${q ? 'لا نتائج' : 'نجهّز الأقسام'}</div><div class="caption">${q ? 'جرّب اسم ثاني' : 'ترجع قريب'}</div></div>` : ''}
    </div>
  </div>`;
}
// صفحة المنتج: الباقات كبطاقات + البيانات + شريط دفع ثابت
function vRscProduct(cur) {
  const isTop = cur.type === 'topup';
  S.rscF = S.rscF || {};
  if (S.rscKeyCat !== cur.key) { S.rscKeyCat = cur.key; S.rscKey = newIdemKey(); S.rscSel = null; S.rscQty = null; }
  const sel = cur.offers.find(o => o.id === S.rscSel) || cur.offers[0];
  const qty = isTop ? 1 : Math.min(sel.max, Math.max(sel.min, Math.floor(n(S.rscQty) || sel.min)));
  const total = Math.round(sel.price * qty * 100) / 100;
  const bal = n(S.profile.wallet_balance), short = bal < total;
  const pop = rscPop(cur);
  return `<div class="page-enter kprod">
    <div class="kp-bk"><button class="kp-back" data-rscback type="button" aria-label="رجوع">${svg(I.next)}<span>رجوع</span></button></div>
    <div class="kp-hero">${cur.image ? `<span class="kp-bg" style="background-image:url('${esc(rscImgUrl(cur.image))}')"></span>` : '<span class="kp-bg ph"></span>'}<span class="kp-fade"></span>
</div>
    <div class="kp-info"><span class="kp-ic">${rscImgTag(cur)}</span><div><h1>${esc(cur.name)}</h1><span>${isTop ? 'شحن مباشر على حسابك في اللعبة' : 'الكود يوصلك فورًا في «طلباتي»'}</span></div></div>
    <div class="kp-badges"><span class="g">⚡ ${isTop ? 'يوصل خلال دقائق' : 'تسليم فوري'}</span><span>🔒 دفع من محفظتك</span>${pop ? `<span>🔥 ${esc(pop)} هذا الشهر</span>` : ''}</div>
    ${cur.note ? `<div class="alert alert-info mb-3">${svg(I.help)}<div style="white-space:pre-line">${esc(cur.note)}</div></div>` : ''}
    <div class="kp-lbl">اختر الباقة</div>
    <div class="kpk">${cur.offers.map(o => `<button class="kpkc ${o.id === sel.id ? 'on' : ''}" data-rscpick="${esc(o.id)}" type="button">
      <b dir="auto">${esc(o.name)}</b><span class="p">${esc(lyd(o.price * rate()))}</span><span class="u">≈ ${esc(usd(o.price))}</span></button>`).join('')}</div>
    ${isTop ? (cur.fields || []).map((f, i) => `<div class="kp-lbl">${esc(f.label)}</div>
      <input class="input kp-in" id="rpf${i}" data-rpf="${esc(f.key)}" ${f.type === 'number' ? 'inputmode="numeric"' : ''} dir="ltr" maxlength="120" autocomplete="off" value="${esc((S.rscF[cur.key] || {})[f.key] || '')}">`).join('') +
      `<div class="caption" style="margin-top:8px;display:flex;gap:6px;align-items:center">${svg(I.help)}تأكد من الرقم — الشحن يمشي مباشرة ولا يُسترجع</div>` : `
      <div class="kp-lbl">الكمية</div>
      <div class="kqty"><button type="button" data-rscqty="-1" ${qty <= sel.min ? 'disabled' : ''}>−</button><b class="tabular">${qty}</b><button type="button" data-rscqty="1" ${qty >= sel.max ? 'disabled' : ''}>+</button></div>`}
    <div class="kbuy"><div class="kbuy-t"><span>${short ? `رصيدك ${esc(lyd(bal * rate()))}` : 'الإجمالي'}</span><b class="tabular">${esc(lyd(total * rate()))}</b></div>
      <button class="kbuy-b" id="rpGo" type="button" data-total="${total}" data-short="${short ? 1 : ''}">${short ? `${svg(I.wallet2)} ادفع الفرق ${esc(lyd(Math.ceil((total - bal) * 100) / 100 * rate()))}` : `${svg(I.lock)} ادفع من محفظتي`}</button>
      ${short ? `<div class="kbuy-x"><i>؟</i>رصيدك ما يكفيش — تدفع الناقص بس، ويكتمل الشراء وحده أول ما توصل الشحنة</div>` : ''}</div>
  </div>`;
}
function openRscBuy(cat, off, pre) {
  const isTop = cat.type === 'topup';
  const key = newIdemKey();
  const chips = (cat.offers || []).length <= 9 ? cat.offers : null;
  let sel = off;
  modal(`
    <div class="rsc-buy-head mb-5">
      ${cat.image ? `<img src="${esc(rscImgUrl(cat.image))}" alt="">` : `<span class="kstate" style="margin:0;width:64px;height:64px">${svg(isTop ? I.game : I.giftbox)}</span>`}
      <div><div class="h4" style="margin:0">${esc(cat.name)}</div><div class="caption">${isTop ? 'شحن مباشر — يصل خلال دقائق' : 'كود رقمي — يصلك فورًا'}</div></div>
    </div>
    ${chips ? `<div class="field-label">اختر الباقة</div><div class="kopts">${chips.map(o => `<button class="kopt ${o.id === off.id ? 'on' : ''}" data-kopt="${esc(o.id)}" type="button"><b dir="auto">${esc(o.name)}</b><small>${esc(lyd(o.price * rate()))}</small></button>`).join('')}</div>`
      : `<div class="field-label">الباقة</div><div class="copy-box mb-4"><div class="copy-value" dir="auto">${esc(off.name)}</div></div>`}
    ${isTop ? (cat.fields || []).map((f, i) => `
      <div class="field mb-2"><label class="field-label" for="rf${i}">${esc(f.label)}</label>
        <input class="input" id="rf${i}" ${f.type === 'number' ? 'inputmode="numeric"' : ''} dir="ltr" maxlength="120" autocomplete="off" value="${esc((pre || {})[f.key] || '')}"></div>`).join('') + `
      <div class="caption mb-4" style="display:flex;gap:6px;align-items:center">${svg(I.help)}تأكد من البيانات — الشحن يُرسل مباشرة ولا يُسترجع</div>` : `
      <div class="field mb-4" id="rQtyW"><label class="field-label" for="rQty">الكمية</label>
        <input class="input tabular" id="rQty" type="number" inputmode="numeric" min="${off.min}" max="${off.max}" value="${off.min}"></div>`}
    <div class="ksum" id="rSum"></div>
    <button class="btn btn-primary btn-block btn-lg" id="rGo" type="button"></button>`);
  let total = off.price;
  const calc = () => {
    const q = isTop ? 1 : Math.floor(n(($('#rQty') || {}).value));
    const ok = isTop || (q >= sel.min && q <= sel.max);
    total = Math.round(sel.price * (ok ? q : sel.min) * 100) / 100;
    const bal = n(S.profile.wallet_balance), short = bal < total;
    $('#rSum').innerHTML = `
      <div><span>رصيد محفظتك</span><b class="tabular" style="${short ? 'color:var(--u-err)' : ''}">${esc(lyd(bal * rate()))}</b></div>
      <div class="tot"><span>الإجمالي</span><b class="tabular">${esc(lyd(total * rate()))}</b></div>
      ${!ok ? `<div style="color:var(--u-warn)">الكمية من ${sel.min} إلى ${sel.max}</div>` : ''}`;
    const b = $('#rGo');
    b.innerHTML = short ? `${svg(I.wallet2)} ادفع الفرق ${esc(lyd(Math.ceil((total - bal) * 100) / 100 * rate()))}` : `${svg(I.lock)} ادفع ${esc(lyd(total * rate()))} من محفظتي`;
    b.dataset.short = short ? '1' : '';
    b.disabled = !ok;
  };
  calc();
  if ($('#rQty')) $('#rQty').oninput = calc;
  $$('[data-kopt]').forEach(b => b.onclick = () => {
    const o = cat.offers.find(x => x.id === b.dataset.kopt); if (!o) return;
    sel = o; $$('[data-kopt]').forEach(x => x.classList.toggle('on', x === b));
    if ($('#rQty')) { $('#rQty').min = o.min; $('#rQty').max = o.max; }
    calc();
  });
  onTap('#rGo', async () => {
    const btn = $('#rGo');
    const fields = {};
    if (isTop) for (let i = 0; i < (cat.fields || []).length; i++) {
      const v = ($('#rf' + i).value || '').trim();
      if (!v) { toast(`${cat.fields[i].label} مطلوب`, 'bad'); $('#rf' + i).focus(); return; }
      fields[cat.fields[i].key] = v;
    }
    if (btn.dataset.short) {
      const short = Math.ceil((total - n(S.profile.wallet_balance)) * 100) / 100;
      CHECKOUT = { name: `${cat.name} — ${sel.name}`, total, body: { cat: cat.key, offer: sel.id, qty: isTop ? 1 : Math.floor(n($('#rQty').value)), fields, expect: total, idempotency_key: key } };
      closeModal(); openDeposit(short, true); return;
    }
    btn.disabled = true; btn.classList.add('loading');
    try {
      const r = await api('/api/rsc/order', { cat: cat.key, offer: sel.id, qty: isTop ? 1 : Math.floor(n($('#rQty').value)), fields, expect: total, idempotency_key: key }, 60000);
      anEv('buy');
      S.rscOrders = null; loadRscOrders();
      openRscResult(r.order);
    } catch (e) {
      btn.disabled = false; btn.classList.remove('loading');
      if (/السعر/.test(e.message)) loadRsc(true);
      toast(e.message, 'bad');
    }
  });
}
function openRscResult(o) {
  if (!o) return;
  const done = o.status === 'completed', bad = o.status === 'refunded';
  modal(`
    <div style="text-align:center" class="mb-4">${fennec(done ? 'success' : bad ? 'error' : 'wait')}
      <div class="h3" style="margin-bottom:4px">${done ? 'تم بنجاح' : bad ? 'لم يكتمل الطلب' : 'طلبك قيد التنفيذ'}</div>
      <div class="body-sm text-2"><bdi>${esc(o.cat_name)} — ${esc(o.offer_name)}</bdi>${o.qty > 1 ? ` × ${o.qty}` : ''}</div></div>
    ${rscOrderBody(o)}
    ${done && !o.reviewed ? rateBox(o) : ''}
    <button class="btn btn-primary btn-block" data-act="close-modal" type="button">تم</button>`);
  if (done) haptic.ok(); else if (bad) haptic.bad();
}
function rscOrderBody(o) {
  if (o.status === 'completed') return (o.codes || []).length ? `<div class="field-label mb-2">الأكواد — احفظها الآن</div>${o.codes.map(c => `
      <div class="copy-box mb-2"><div class="copy-value" dir="ltr" style="font-size:14px;word-break:break-all">${esc(c)}</div>
        <button class="copy-btn" data-act="copy" data-copy-text="${esc(c)}" aria-label="نسخ">${svg(I.copy, 2)}</button></div>`).join('')}` :
    `<div class="alert alert-success mb-3">${svg(I.check || I.help, 2)}<div>تم الشحن مباشرة إلى حسابك${Object.values(o.fields || {}).length ? ` (${esc(Object.values(o.fields).join(' · '))})` : ''}.</div></div>`;
  if (o.status === 'refunded') return `<div class="alert alert-error mb-3">${svg(I.x, 2)}<div>${esc(o.fail_reason || 'تعذّر التنفيذ')} — أُعيد ${esc(usd(o.total_usd))} إلى محفظتك.</div></div>`;
  if (o.status === 'unknown') return `<div class="alert alert-warning mb-3">${svg(I.help, 2)}<div>نراجع طلبك مع المزود الآن. إن لم يكتمل يُعاد المبلغ لمحفظتك كاملًا.</div></div>`;
  return `<div class="alert alert-info mb-3">${svg(I.help, 2)}<div>يُنفَّذ خلال دقائق عادةً، ويصلك إشعار فور الاكتمال. تجده في «طلباتي».</div></div>`;
}
function rscOrderRows() {
  if (!S.rscOrders && S.user) { S.rscOrders = []; loadRscOrders(); }
  return (S.rscOrders || []).map(o => ({ t: new Date(o.created_at || 0).getTime(), html: `
    <div class="list-row" data-rscorder="${esc(o.id)}" role="button" tabindex="0">
      <div class="list-icon brand">${o.kind === 'topup' ? '🎮' : '🎁'}</div>
      <div class="list-content"><div class="list-title">${esc(o.cat_name)} — ${esc(o.offer_name)}</div><div class="list-meta">${esc(dt(o.created_at))}</div></div>
      <div class="list-end"><div class="list-amount">${esc(usd(o.total_usd))}</div>
        <span class="badge ${(RSC_ST[o.status] || ['badge'])[0]}" style="margin-top:4px;font-size:10px">${esc((RSC_ST[o.status] || ['', o.status])[1])}</span></div>
    </div>` }));
}
function bindRsc() {
  $$('[data-rsccat]').forEach(b => b.onclick = () => { const _c = rscCatBy(b.dataset.rsccat); if (_c && _c.maint) return toast('هذا القسم قيد الصيانة حاليًا — جرّب بعد شوية', 'bad'); S.rscCat = b.dataset.rsccat; if (S.page !== 'kstore') go('kstore', true); else { render(); window.scrollTo({ top: 0, behavior: 'instant' }); } });
  $$('[data-rscback]').forEach(b => b.onclick = () => { S.rscCat = null; render(); window.scrollTo({ top: 0, behavior: 'instant' }); });
  $$('[data-rscpick]').forEach(b => b.onclick = () => { S.rscSel = b.dataset.rscpick; S.rscQty = null; haptic.tap(); render(); });
  $$('[data-rscqty]').forEach(b => b.onclick = () => { const c = rscCatBy(S.rscCat), o = c && (c.offers.find(x => x.id === S.rscSel) || c.offers[0]); if (!o) return; S.rscQty = Math.min(o.max, Math.max(o.min, (n(S.rscQty) || o.min) + Number(b.dataset.rscqty))); render(); });
  $$('[data-rpf]').forEach(inp => inp.oninput = () => { S.rscF[S.rscCat] = { ...(S.rscF[S.rscCat] || {}), [inp.dataset.rpf]: inp.value }; });
  $$('[data-rscagain]').forEach(b => b.onclick = () => { const o = (S.rscOrders || []).find(x => x.id === b.dataset.rscagain); const c = o && rscCatBy(o.cat), off = c && c.offers.find(x => x.id === o.offer_id); if (off) openRscBuy(c, off, o.fields); });
  onTap('#rpGo', () => rscProductPay());
  rscHeroAuto();
  $$('[data-rsctab]').forEach(b => b.onclick = () => { S.rscTab = b.dataset.rsctab; S.rscQ = ''; render(); });
  $$('[data-rscretry]').forEach(b => b.onclick = () => { S.rsc.error = false; loadRsc(true); render(); });
  $$('[data-rscoffer]').forEach(b => b.onclick = () => { const c = rscCatBy(S.rscCat); const o = c && c.offers.find(x => x.id === b.dataset.rscoffer); if (o) openRscBuy(c, o); });
  $$('[data-rscorder]').forEach(b => b.onclick = () => { const o = (S.rscOrders || []).find(x => x.id === b.dataset.rscorder); if (o) openRscResult(o); });
  $$('[data-rscgo]').forEach(b => b.onclick = () => { S.rscTab = b.dataset.rscgo; S.rscCat = null; go('kstore', true); });
  const q = $('#rscQ');
  if (q) q.oninput = () => {                                         // v58: نحدّث النتائج بس (بلا رمشة للصفحة كلها)
    S.rscQ = q.value; S.rscLim = null; clearTimeout(window._kqT);
    window._kqT = setTimeout(() => {
      if (S.page !== 'kstore' || S.rscCat || !$('#kRes')) return render();
      const full = vKStore(), tpl = document.createElement('template'); tpl.innerHTML = full;
      const r2 = tpl.content.querySelector('#kRes'), c2 = tpl.content.querySelector('#kChips');
      if (r2) $('#kRes').innerHTML = r2.innerHTML;
      if (c2 && $('#kChips').innerHTML !== c2.innerHTML) $('#kChips').innerHTML = c2.innerHTML;
      _lastHtml = full + siteFooter();
      $$('#kRes [data-rsccat], #kChips [data-rsctab]').length && bindStoreBits();
      lazyBgs();
    }, 160);
  };
}

function themePref() { try { return localStorage.getItem('kardo_theme') || 'auto'; } catch { return 'auto'; } }

const CARD_POINTS_DEF = [['للدفع أونلاين فقط', 'لا تعمل في الصراف أو نقاط البيع'], ['CVV يظهر مرة واحدة', 'احفظه فورًا مع رقم البطاقة'], ['رسوم الإصدار لا تُسترد', 'وبعض المواقع قد ترفض البطاقات الافتراضية']];
function cardPoints() {
  const raw = String(((S.config.manual_cards || {}).points) || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 5)
    .map(l => { const [t, ...d] = l.split('|'); return [t.trim(), d.join('|').trim()]; }).filter(x => x[0]);
  return raw.length ? raw : CARD_POINTS_DEF;
}

/* ═══ v49 — شحن المحفظة بالفواتير ═══ */
function depositOptions() {
  const m = S.config.methods || {};
  const paused = new Set(S.config.paused_methods || []);
  const out = [];
  const usdt = m.usdt || {};
  const nets = (S.config.crypto_nets && S.config.crypto_nets.length) ? S.config.crypto_nets : (usdt.on ? [{ id: 'trc20', label: 'USDT TRC20' }] : []);
  for (const nt of nets) {
    const isPay = nt.id === 'binance_pay';
    out.push({ key: nt.id, kind: 'crypto', net: nt.id, group: 'crypto', label: isPay ? 'Binance Pay' : nt.label, short: isPay ? 'B' : '₮', unit: 'USDT', rate: 1,
      logo: isPay ? ((m.binance || {}).logo || '') : (usdt.logo || ''), speed: 'auto', min: n(usdt.min) || 5, max: n(usdt.max) || 1000, paused: paused.has(nt.id),
      note: isPay ? 'من تطبيق Binance · بدون رسوم' : nt.id === 'bep20' ? 'شبكة BSC · رسوم أقل' : nt.id === 'trc20' ? 'شبكة TRON' : 'شبكة ' + nt.label.replace('USDT ', '') });
  }
  for (const k of ['libyana', 'almadar']) {
    const x = m[k]; if (!x || x.on === false) continue;
    const manual = (x.mode || S.config.deposit_mode) === 'manual';
    out.push({ key: k, kind: 'phone', group: 'phone', label: x.label || (k === 'libyana' ? 'ليبيانا' : 'المدار'), short: k === 'libyana' ? 'LY' : 'MD', unit: 'LYD', rate: n(x.rate) || 11.8,
      logo: x.logo || '', speed: manual ? 'review' : 'fast', min: 0, max: 0, paused: paused.has(k),
      note: `1$ = ${n(x.rate) || 11.8} د.ل` });
  }
  const hasPay = nets.some(nt => nt.id === 'binance_pay');
  for (const [k, x] of Object.entries(m)) {
    if (['libyana', 'almadar', 'usdt'].includes(k) || !x || x.on === false) continue;
    if (k === 'binance' && hasPay) continue;
    const isUsdt = k === 'binance';
    out.push({ key: k, kind: 'manual', group: 'bank', label: x.label || k, short: '🏦', unit: isUsdt ? 'USDT' : 'LYD', rate: n(x.rate) || 1, logo: x.logo || '', speed: 'review',
      min: 0, max: 0, paused: paused.has(k), note: isUsdt ? 'بإيصال · يُراجع يدويًا' : `1$ = ${n(x.rate) || 1} د.ل · بإيصال` });
  }
  return out;
}

let _qrLib = null;
function loadQrLib() {
  if (window.kardoQR) return Promise.resolve(window.kardoQR);
  if (_qrLib) return _qrLib;
  _qrLib = new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = './kardo-qr.js?v=49';
    sc.onload = () => window.kardoQR ? res(window.kardoQR) : rej(new Error('qr'));
    sc.onerror = () => { _qrLib = null; rej(new Error('qr')); };
    document.head.appendChild(sc);
  });
  return _qrLib;
}
async function qrInto(el, text) {
  try { const f = await loadQrLib(); if (el) el.innerHTML = f(text); }
  catch { if (el) el.remove(); }
}

async function createInvoice(net, usdAmount) {
  try {
    const { invoice } = await api('/api/wallet/usdt/invoice', { amount_usd: usdAmount, network: net });
    anEv('inv_create');
    S.invoices = null;
    openInvoice(invoice);
  } catch (e) { toast(e.message, 'bad'); }
}

let _invTimer = null, _invPoll = null;
function stopInvoiceTimers() { clearInterval(_invTimer); clearTimeout(_invPoll); _invTimer = null; _invPoll = null; }
const INV_ST = { awaiting: ['st-w', 'بانتظار الدفع'], cancelled: ['st-x', 'ملغاة'], paid: ['st-p', 'مدفوعة'], expired: ['st-x', 'منتهية'], cancelled_closed: ['st-x', 'ملغاة'] };
const fmtLeft = ms => { const t = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

function openInvoice(inv) {
  stopInvoiceTimers();
  if (!inv) return;
  const isPay = inv.network === 'binance_pay';
  const amtTxt = Number(inv.pay_amount).toFixed(4);
  const st = inv.status;
  const timeUp = Date.now() > inv.expires_ms;
  const steps = st === 'paid' ? 3 : 2;
  const head = `
    <div class="kinv-top"><span class="kinv-no">#${esc(inv.no)}</span>
      <span class="kinv-st ${(INV_ST[st] || ['st-x'])[0]}" id="kinvSt">${st === 'awaiting' && !timeUp ? `بانتظار الدفع · <span id="kinvLeft">${fmtLeft(inv.expires_ms - Date.now())}</span>` : esc((INV_ST[st] || ['', st])[1])}</span><button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    <div class="kprog"><i class="d"></i><i class="${steps >= 3 ? 'd' : 'a'}"></i><i class="${steps >= 3 ? 'd' : ''}"></i></div>
    <div class="kprog-l"><span>أُنشئت</span><span>الدفع</span><span>أُضيف الرصيد</span></div>`;
  if (st === 'paid') {
    modal(`${head}
      <div style="text-align:center;margin:8px 0 18px">${fennec('success')}<div class="h3" style="margin:0">أُضيف لمحفظتك</div>
        <div class="kinv-big" style="color:var(--u-ok)">+ ${esc(usd(inv.received || inv.amount_usd))}</div>${inv.late ? '<div class="caption">وصل بعد انتهاء المهلة وأُضيف تلقائيًا</div>' : ''}</div>
      <div class="kreceipt">
        <div><span>رقم الفاتورة</span><b>${esc(inv.no)}</b></div>
        <div><span>المدفوع</span><b class="tabular" dir="ltr">${esc(amtTxt)} USDT</b></div>
        <div><span>الطريقة</span><b>${esc(isPay ? 'Binance Pay' : inv.network_label)}</b></div>
        <div><span>الوقت</span><b>${esc(dt(inv.paid_at))}</b></div>
        ${inv.txid ? `<div><span>المعاملة</span><b dir="ltr">${esc(inv.txid.slice(0, 8))}…${esc(inv.txid.slice(-6))}</b></div>` : ''}
      </div>
      <div class="kinv-acts" style="margin-top:20px"><button class="btn btn-primary" data-act="close-modal" type="button">تم</button>
        <button class="btn btn-secondary" id="kShare" type="button">${svg(I.share || I.copy)} مشاركة الإيصال</button></div>`);
    onTap('#kShare', () => shareReceipt(inv));
    S.profile && haptic.ok();
    return;
  }
  const closed = st !== 'awaiting' && st !== 'cancelled';
  if (closed) {
    modal(`${head}
      <div style="text-align:center;margin:8px 0 16px">${fennec('wait')}<div class="h4" style="margin:0 0 4px">${st === 'expired' ? 'انتهت مدة الفاتورة' : 'الفاتورة ملغاة'}</div>
        <div class="caption">${esc(usd(inv.amount_usd))} · ${esc(isPay ? 'Binance Pay' : inv.network_label)} · <span dir="ltr">${esc(amtTxt)} USDT</span></div></div>
      <div class="alert alert-info mb-3">${svg(I.help)}<div>لا تحوّل على هذه الفاتورة. لو حوّلت وما انضاف الرصيد، تواصل مع الدعم برقم الفاتورة.</div></div>
      <div class="kinv-acts"><button class="btn btn-primary" id="kRenew" type="button">فاتورة جديدة بنفس المبلغ</button></div>`);
    onTap('#kRenew', () => { closeModal(); createInvoice(inv.network, inv.amount_usd); });
    return;
  }
  modal(`${head}
    <div style="text-align:center;margin:6px 0 14px">
      <div class="caption">${isPay ? 'أرسل هذا المبلغ بالضبط عبر Binance Pay' : 'حوّل هذا المبلغ بالضبط'}</div>
      <div class="kinv-big tabular">${esc(amtTxt)} <small>USDT</small></div>
      <div class="caption">${isPay ? 'العملة USDT' : 'شبكة ' + esc(inv.network_label.replace('USDT ', '')) + ' فقط'} · يُضاف لمحفظتك ${esc(usd(inv.amount_usd))}</div>
    </div>
    ${CHECKOUT ? `<div class="kco">${svg(I.store)}<div><b>${esc(CHECKOUT.name)}</b><span>بعد ما يوصل الدفع نكمل الشراء تلقائيًا — خلّي الصفحة مفتوحة</span></div></div>` : ''}
    ${isPay ? (S.config.binance_pay_qr ? `<div class="kqr"><img src="${esc(API_BASE + S.config.binance_pay_qr)}" alt="QR Binance Pay"></div>` : '') : `<div class="kqr" id="kQr"></div>`}
    <div class="copy-box mb-2"><div class="copy-value" dir="ltr" style="font-size:13px;word-break:break-all;white-space:normal;overflow:visible;text-overflow:clip">${isPay ? 'Pay ID: ' : ''}${esc(inv.address)}</div>
      <button class="copy-btn" data-act="copy" data-copy-text="${esc(inv.address)}" aria-label="نسخ">${svg(I.copy)}</button></div>
    <div class="copy-box mb-3"><div class="copy-value tabular" dir="ltr">${esc(amtTxt)}</div>
      <button class="copy-btn" data-act="copy" data-copy-text="${esc(amtTxt)}" aria-label="نسخ المبلغ">${svg(I.copy)}</button></div>
    <button class="kinv-how" data-howto="${esc(inv.network)}" type="button">${svg(I.help)} كيف أدفع؟ شرح بالصور</button>
    ${isPay ? `<a class="btn btn-block kbnb mb-3" href="https://app.binance.com/" target="_blank" rel="noopener">افتح تطبيق Binance</a>
      <p class="caption mb-3">في Binance: الدفع ← إرسال ← الصق الـ Pay ID والمبلغ ← تأكيد.</p>` : `
      <div class="alert alert-warning mb-3">${svg(I.help)}<div>لا تقرّب المبلغ. لو تحوّل من منصة (MEXC وغيرها) تأكد إن المبلغ اللي يوصل هو نفسه بعد الرسوم.</div></div>`}
    ${closed ? `<div class="alert alert-info mb-3">${svg(I.help)}<div>انتهت هذه الفاتورة. أنشئ فاتورة جديدة للشحن.</div></div>` : `
    <div class="klive" id="kLive"><span class="kpulse"></span><div><b>${st === 'cancelled' ? 'الفاتورة ملغاة' : 'ننتظر وصول التحويل…'}</b><span>${timeUp || st === 'cancelled' ? 'لو حوّلت، يُضاف تلقائيًا خلال 24 ساعة من إنشاء الفاتورة' : 'يُضاف تلقائيًا — تقدر تقفل الصفحة'}</span></div></div>`}
    <div class="kinv-acts">
      ${timeUp || closed || st === 'cancelled' ? `<button class="btn btn-secondary" id="kRenew" type="button">فاتورة جديدة بنفس المبلغ</button>` : ''}
      ${!timeUp ? `<button class="btn btn-secondary" id="kShareLink" type="button">${svg(I.share)} ${inv.shared ? 'رابط الدفع فعّال — مشاركة أو إيقاف' : 'خلّي حد يدفع عنك (رابط)'}</button>` : ''}
      ${st === 'awaiting' ? `<button class="btn btn-ghost" id="kCancel" type="button">إلغاء الفاتورة</button>` : ''}
    </div>`);
  onTap('#kShareLink', () => openPayLink(inv));
  if (!isPay) qrInto($('#kQr'), inv.address);
  _htBack = () => openInvoice(inv);
  onTap('#kRenew', () => { closeModal(); createInvoice(inv.network, inv.amount_usd); });
  onTap('#kCancel', async () => {
    if (!confirm('إلغاء الفاتورة؟ لو حوّلت بالخطأ سيُضاف المبلغ تلقائيًا رغم الإلغاء.')) return;
    try { const r = await api('/api/wallet/invoice/cancel', { id: inv.id }); S.invoices = null; openInvoice(r.invoice); } catch (e) { toast(e.message, 'bad'); }
  });
  if (closed) return;
  _invTimer = setInterval(() => {
    const el = $('#kinvLeft'); if (!el) { if (!$('#kLive')) stopInvoiceTimers(); return; }
    const left = inv.expires_ms - Date.now();
    if (left <= 0) { stopInvoiceTimers(); openInvoice({ ...inv }); return; }
    el.textContent = fmtLeft(left);
  }, 1000);
  const started = Date.now();
  const poll = async () => {
    if (!$('#kLive')) return;
    try {
      const r = await api('/api/wallet/usdt/verify', { invoice_id: inv.id });
      if (r.invoice && r.invoice.status === 'paid') { stopInvoiceTimers(); S.invoices = null; kdbSoon(200); anEv('paid');
        if (CHECKOUT) { toast('وصل الدفع ✓ — نكمل الشراء…', 'ok'); completeCheckout(); return; }
        openInvoice(r.invoice); toast('أُضيف ' + usd(r.invoice.received) + ' لمحفظتك ✓', 'ok'); return; }
      if (r.invoice && r.invoice.status !== inv.status) { openInvoice(r.invoice); return; }
    } catch {}
    _invPoll = setTimeout(poll, Date.now() - started < 15 * 60000 ? 15000 : 45000);
  };
  _invPoll = setTimeout(poll, 8000);
}

let _invLoad = null;
function loadInvoices() {
  if (_invLoad) return _invLoad;
  _invLoad = api('/api/wallet/invoices', {}).then(r => { S.invoices = r.invoices || []; }).catch(() => { if (!S.invoices) S.invoices = []; })
    .finally(() => { _invLoad = null; if (S.page === 'invoices' || S.page === 'dashboard') render(); });
  return _invLoad;
}
function pendingInvoice() {
  return (S.invoices || []).find(v => v.status === 'awaiting' && v.expires_ms > Date.now());
}
function vInvoices() {
  if (!S.invoices) { loadInvoices(); return `<div class="page-enter"><h1 class="kpage-title">فواتيري</h1><div class="skeleton" style="height:200px;border-radius:20px"></div></div>`; }
  const tab = S.invTab || 'all';
  const list = S.invoices.filter(v => tab === 'all' || (tab === 'open' ? v.status === 'awaiting' : v.status === 'paid'));
  return `<div class="page-enter">
    <h1 class="kpage-title">فواتيري</h1><p class="kpage-sub">كل فواتير الشحن وحالاتها</p>
    <div class="pills mb-4">${[['all', 'الكل'], ['open', 'بانتظار الدفع'], ['paid', 'مدفوعة']].map(([k, t]) => `<button class="pill ${tab === k ? 'active' : ''}" data-invtab="${k}" type="button">${t}</button>`).join('')}</div>
    ${list.length ? `<div class="list">${list.map(v => `
      <button class="list-row" data-inv="${esc(v.id)}" type="button" style="width:100%;text-align:right">
        <span class="list-icon">${svg(I.receipt)}</span>
        <div class="list-content"><div class="list-title tabular">${esc(v.no)}</div><div class="list-meta">شحن المحفظة · ${esc(v.network === 'binance_pay' ? 'Binance Pay' : v.network_label)} · ${esc(dt(new Date(v.created_ms).toISOString()))}</div></div>
        <div class="list-end"><div class="list-amount tabular">${esc(usd(v.amount_usd))}</div><span class="kinv-st ${(INV_ST[v.status] || ['st-x'])[0]}" style="margin-top:4px">${esc(v.status === 'awaiting' && v.expires_ms < Date.now() ? 'بانتظار الدفع' : (INV_ST[v.status] || ['', v.status])[1])}</span></div>
      </button>`).join('')}</div>` : `<div class="card" style="text-align:center;padding:32px 20px">${fennec('empty')}<div class="h4" style="margin-bottom:6px">لا فواتير بعد</div><p class="body-sm text-2 mb-4">أنشئ فاتورة شحن وتظهر هنا</p><button class="btn btn-primary btn-sm" data-act="dock-deposit" type="button">شحن المحفظة</button></div>`}
  </div>`;
}
function bindInvoices() {
  $$('[data-invtab]').forEach(b => b.onclick = () => { S.invTab = b.dataset.invtab; render(); });
  $$('[data-inv]').forEach(b => b.onclick = async () => {
    const v = (S.invoices || []).find(x => x.id === b.dataset.inv); if (!v) return;
    openInvoice(v);
    try { const r = await api('/api/wallet/invoice', { id: v.id }); if (r.invoice && r.invoice.status !== v.status) openInvoice(r.invoice); } catch {}
  });
  $$('[data-pendinv]').forEach(b => b.onclick = () => { const v = pendingInvoice(); if (v) openInvoice(v); });
}

/* ═══ v50 — الدفع المباشر عند الشراء + مشاركة الإيصال ═══ */
let CHECKOUT = null;     // شراء معلّق ينتظر وصول الدفع (في هذه الصفحة فقط — لو قفلها يبقى المبلغ في المحفظة)
async function completeCheckout() {
  const c = CHECKOUT; CHECKOUT = null;
  if (!c) return;
  modal(`<div style="text-align:center;padding:24px 0">${fennec('wait')}<div class="h4">نكمل شراء ${esc(c.name)}…</div><p class="caption">لحظات</p></div>`);
  for (let i = 0; i < 3; i++) {
    try {
      const r = await api('/api/rsc/order', c.body, 60000);
      anEv('buy');
      S.rscOrders = null; loadRscOrders(); openRscResult(r.order); return;
    } catch (e) {
      if (/رصيد|الرصيد/.test(e.message) && i < 2) { await new Promise(r => setTimeout(r, 2500)); continue; }   // الرصيد قد يتأخر لحظة
      modal(`<div style="text-align:center">${fennec('error')}<div class="h4">الدفع وصل لمحفظتك ✓</div>
        <p class="body-sm text-2 mb-4">لكن ما قدرنا نكمل الشراء: ${esc(e.message)}<br>رصيدك محفوظ — كمّل الشراء من المتجر.</p>
        <button class="btn btn-primary btn-block" id="coBack" type="button">رجوع للمتجر</button></div>`);
      onTap('#coBack', () => { closeModal(); go('kstore'); });
      return;
    }
  }
}

async function shareReceipt(inv) {
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#17120D'); bg.addColorStop(1, '#0F0C09');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = '#E8962E'; g.fillRect(0, 0, W, 14);
    const logo = await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = './kardo-mark.png'; });
    g.direction = 'rtl'; g.textAlign = 'center';
    if (logo) g.drawImage(logo, W / 2 - 70, 90, 140, 140 * (logo.height / logo.width || 1));
    const F = (w, sz) => `${w} ${sz}px "Readex Pro","IBM Plex Sans Arabic",sans-serif`;
    g.fillStyle = '#F6C26B'; g.font = F(600, 54); g.fillText('كاردو', W / 2, 300);
    g.fillStyle = '#4CC38A'; g.font = F(600, 44); g.fillText('✓ تم الشحن بنجاح', W / 2, 420);
    g.fillStyle = '#F6EBD9'; g.font = F(700, 120); g.direction = 'ltr'; g.fillText('+' + usd(inv.received || inv.amount_usd), W / 2, 570); g.direction = 'rtl';
    const rows = [['رقم الفاتورة', inv.no], ['المدفوع', Number(inv.pay_amount).toFixed(4) + ' USDT'], ['الطريقة', inv.network === 'binance_pay' ? 'Binance Pay' : inv.network_label],
      ['الوقت', dt(inv.paid_at)], ...(inv.txid ? [['المعاملة', inv.txid.slice(0, 10) + '…' + inv.txid.slice(-6)]] : [])];
    let y = 700;
    g.fillStyle = 'rgba(255,255,255,.05)'; g.beginPath(); (g.roundRect ? g.roundRect(90, y - 60, W - 180, rows.length * 92 + 40, 32) : g.rect(90, y - 60, W - 180, rows.length * 92 + 40)); g.fill();
    for (const [k, v] of rows) {
      g.textAlign = 'right'; g.fillStyle = '#8F7F68'; g.font = F(400, 34); g.fillText(k, W - 140, y);
      g.textAlign = 'left'; g.fillStyle = '#F3E7D3'; g.font = F(600, 36); g.direction = /[؀-ۿ]/.test(v) ? 'rtl' : 'ltr'; g.fillText(String(v), 140, y); g.direction = 'rtl';
      y += 92;
    }
    g.textAlign = 'center'; g.fillStyle = '#8F7F68'; g.font = F(400, 30); g.fillText('kardo.ly', W / 2, H - 70);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const file = new File([blob], `kardo-${inv.no}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'إيصال كاردو ' + inv.no }); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('حُفظت صورة الإيصال', 'ok');
  } catch (e) { if (e && e.name !== 'AbortError') toast('تعذّرت مشاركة الإيصال', 'bad'); }
}

/* ═══ v51 — تثبيت كاردو كتطبيق (PWA) ═══ */
function isStandalone() { try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; } }
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function openInstall(auto) {
  if (isStandalone()) { toast('كاردو مثبّت على جهازك ✓', 'ok'); return; }
  const ios = isIOS(), canPrompt = !!window.__bip;
  modal(`<div class="kinst">
      <img class="kinst-logo" src="./icon-192.png" alt="">
      <div class="h3" style="margin:0 0 6px">ثبّت كاردو على جهازك</div>
      <p class="body-sm text-2" style="margin:0 0 16px">تفتح بلمسة من الشاشة الرئيسية، بدون متصفح.</p>
      <div class="kinst-pts">
        <div>${svg(I.zap || I.check)}<span>فتح أسرع وتصفح أخف</span></div>
        <div>${svg(I.bell)}<span>إشعار فوري لما ينضاف رصيدك أو يكتمل طلبك</span></div>
        <div>${svg(I.lock)}<span>نفس حسابك ونفس الأمان</span></div>
      </div>
      ${canPrompt ? `<button class="btn btn-primary btn-block btn-lg" id="kInstGo" type="button">${svg(I.download || I.plus)} تثبيت التطبيق</button>` : ios ? `
      <div class="kinst-steps"><div><b>1</b><span>اضغط زر المشاركة ${svg(I.share || I.up)} أسفل Safari</span></div><div><b>2</b><span>اختر «إضافة إلى الشاشة الرئيسية»</span></div><div><b>3</b><span>اضغط «إضافة» — وخلاص</span></div></div>` : `
      <div class="kinst-steps"><div><b>1</b><span>افتح قائمة المتصفح ⋮ فوق</span></div><div><b>2</b><span>اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»</span></div></div>`}
      <button class="btn btn-ghost btn-block" data-act="close-modal" type="button" style="margin-top:6px">${auto ? 'لاحقًا' : 'إغلاق'}</button>
    </div>`);
  onTap('#kInstGo', async () => {
    const e = window.__bip; if (!e) return;
    try { e.prompt(); const c = await e.userChoice; window.__bip = null; closeModal();
      if (c && c.outcome === 'accepted') { anEv('install'); toast('تم التثبيت — تلقاه في الشاشة الرئيسية ✓', 'ok'); } } catch { closeModal(); }
  });
}
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#kInstall')) { e.preventDefault(); openInstall(false); } });
// أول زيارة: نعرض اقتراح التثبيت مرة واحدة على الجهاز
(function installNudge() {
  const seen = () => { try { return localStorage.getItem('kardo_inst_seen') === '1'; } catch { return true; } };
  if (isStandalone() || seen()) return;
  const show = () => {
    if (isStandalone() || seen()) return;
    if (document.documentElement.classList.contains('mchk') || $('#overlay.open') || !document.body || document.querySelector('.kmaint')) { setTimeout(show, 4000); return; }
    if (!window.__bip && !isIOS()) return;           // المتصفح ما يدعمش التثبيت أو مثبّت أصلًا — الزر في «حسابي» يكفي
    try { localStorage.setItem('kardo_inst_seen', '1'); } catch {}
    openInstall(true);
  };
  setTimeout(show, isIOS() ? 3500 : 2500);
  document.addEventListener('kardo-bip', () => setTimeout(show, 1200), { once: true });
})();

/* ═══ v52 — خزنة البطاقة: الرمز السري (PIN) + تأكيد الجهاز بالبريد + عرض 60 ثانية ═══ */
const CDEV_KEY = 'kardo_cdev';
const cdev = () => { try { return localStorage.getItem(CDEV_KEY) || ''; } catch { return ''; } };
let _vaultTimer = null;
function vaultClear() { clearInterval(_vaultTimer); _vaultTimer = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible' && $('#vShow')) { vaultClear(); closeModal(); } });
async function openVault(c) {
  let st;
  try { st = await api('/api/card/sec/status', { device: cdev() }); } catch (e) { return toast(e.message, 'bad'); }
  if (st.locked) return vaultCodeFlow(c, 'reset', st);
  if (!st.has_pin || !st.device_ok) return vaultCodeFlow(c, st.has_pin ? 'device' : 'setup', st);
  vaultPin(c);
}
// لوحة أرقام موحّدة: تُرجع الرمز عند اكتمال عدد الخانات
function pinPad(len, onDone, opts = {}) {
  let v = '';
  const draw = () => {
    const box = $('#pinDots'); if (!box) return;
    box.innerHTML = Array.from({ length: len }, (_, i) => `<i class="${i < v.length ? 'f' : ''} ${i === v.length ? 'cur' : ''}">${i < v.length ? (opts.show ? esc(v[i]) : '•') : ''}</i>`).join('');
  };
  const press = k => {
    if (k === 'del') v = v.slice(0, -1);
    else if (/^\d$/.test(k) && v.length < len) v += k;
    draw();
    if (v.length === len) { const out = v; setTimeout(() => { v = ''; draw(); onDone(out); }, 120); }
  };
  draw();
  $$('[data-pk]').forEach(b => b.onclick = () => { haptic.tap(); press(b.dataset.pk); });
  const onKey = e => { if (!$('#pinDots')) return document.removeEventListener('keydown', onKey); if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); };
  document.addEventListener('keydown', onKey);
}
const PAD_HTML = len => `<div class="kpin" id="pinDots" dir="ltr">${'<i></i>'.repeat(len)}</div>
  <div class="kpad" dir="ltr">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map(k => k === '' ? '<span></span>' : `<button type="button" data-pk="${k}" aria-label="${k === 'del' ? 'مسح' : k}">${k === 'del' ? '⌫' : k}</button>`).join('')}</div>`;
function vaultPin(c) {
  modal(`<div class="kvault">
      <div class="kv-ic">${svg(I.lock)}</div>
      <div class="h3" style="margin:0 0 4px">اكتب رمزك السري</div>
      <p class="body-sm text-2" style="margin:0">لعرض بيانات ${esc(c.card_name || 'البطاقة')} ••${esc(c.last4 || '')} لمدة 60 ثانية</p>
      <div id="pinErr" class="kv-err"></div>
      ${PAD_HTML(4)}
      <button class="btn btn-ghost btn-block" id="pinForgot" type="button" style="margin-top:10px">نسيت الرمز؟ نبعتلك كود على الإيميل</button>
    </div>`);
  onTap('#pinForgot', () => vaultCodeFlow(c, 'reset'));
  pinPad(4, async pin => {
    $('#pinErr').textContent = '';
    $$('[data-pk]').forEach(b => b.disabled = true);
    try {
      const d = await api('/api/card/vault/reveal', { card_id: c.id, pin, device: cdev() });
      anEv('card_view');
      vaultShow(c, d);
    } catch (e) {
      $$('[data-pk]').forEach(b => b.disabled = false);
      haptic.bad();
      if (/أكّد جهازك/.test(e.message)) { try { localStorage.removeItem(CDEV_KEY); } catch {} return vaultCodeFlow(c, 'device'); }
      if (/قُفل|مقفول/.test(e.message)) { toast(e.message, 'bad'); return vaultCodeFlow(c, 'reset'); }
      const el = $('#pinErr'); if (el) { el.textContent = e.message; el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
    }
  });
}
function vaultShow(c, d) {
  vaultClear();
  const grp = v => String(v || '').replace(/(\d{4})(?=\d)/g, '$1 ');
  const rows = [['رقم البطاقة', grp(d.card_number), d.card_number], ['تاريخ الانتهاء', d.expiry, d.expiry], ['CVV', d.cvv || '—', d.cvv],
    ...(d.name_on_card ? [['الاسم على البطاقة', d.name_on_card, d.name_on_card]] : []), ...(d.billing_address ? [['عنوان الفوترة', d.billing_address, d.billing_address]] : [])];
  let left = Math.max(10, n(d.ttl) || 60);
  modal(`<div id="vShow">
      <div class="modal-head"><div class="modal-title">بيانات البطاقة</div><button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
      <div class="kvc"><img src="./kardo-mark.png" alt="" class="kvc-fox"><div class="kvc-top"><span>${esc(c.card_name || 'بطاقتي')}</span><span>KARDO</span></div><div class="kvc-chip"></div>
        <div class="kvc-num" dir="ltr">${esc(grp(d.card_number))}</div>
        <div class="kvc-b" dir="ltr"><div><small>EXP</small><b>${esc(d.expiry)}</b></div><div><small>CVV</small><b>${esc(d.cvv || '—')}</b></div></div></div>
      <div class="kv-timer">${svg(I.clock || I.help)}<span>تختفي بعد <b id="vLeft">${left}</b> ثانية</span><div class="kv-bar"><i id="vBar"></i></div></div>
      <div class="list mb-3">${rows.map(([k, v, raw]) => `<div class="list-row"><div class="list-content"><div class="list-meta">${k}</div><div class="list-title tabular" dir="ltr" style="text-align:right;white-space:pre-line">${esc(v)}</div></div>
        ${raw ? `<button class="copy-btn" data-vcopy="${esc(raw)}" type="button" aria-label="نسخ">${svg(I.copy, 2)}</button>` : ''}</div>`).join('')}</div>
      <p class="caption" style="text-align:center">${svg(I.shield || I.lock)} يوصلك إيميل بكل عرض. لو مش أنت، تواصل معنا فورًا لتجميد البطاقة.</p>
    </div>`);
  $$('[data-vcopy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.vcopy); toast('نُسخ ✓', 'ok'); } catch { toast('تعذّر النسخ', 'bad'); } });
  const total = left;
  _vaultTimer = setInterval(() => {
    left--;
    const el = $('#vLeft'), bar = $('#vBar');
    if (!el) return vaultClear();
    el.textContent = left; if (bar) bar.style.width = Math.max(0, left / total * 100) + '%';
    if (left <= 0) { vaultClear(); closeModal(); toast('تغطّت بيانات البطاقة 🔒', 'ok'); }
  }, 1000);
}
// تأكيد الجهاز / إنشاء الرمز / نسيان الرمز — كلها بكود على البريد
async function vaultCodeFlow(c, mode, st) {
  const purpose = mode === 'reset' ? 'reset' : 'device';
  const needPin = mode !== 'device';
  const title = mode === 'setup' ? 'أنشئ رمزك السري' : mode === 'reset' ? 'تغيير الرمز السري' : 'تأكيد جهازك';
  const sub = mode === 'setup' ? 'أول مرة: نبعتلك كود على الإيميل، وبعدها تختار رمز من 4 أرقام تفتح بيه بطاقاتك.'
    : mode === 'reset' ? 'نبعتلك كود على الإيميل، وبعدها تختار رمز جديد.' : 'جهاز جديد: نبعتلك كود على الإيميل مرة وحدة لهذا الجهاز.';
  modal(`<div class="kvault">
      <div class="kv-ic">${svg(I.mail || I.bell)}</div>
      <div class="h3" style="margin:0 0 4px">${title}</div>
      <p class="body-sm text-2" style="margin:0 0 16px">${sub}</p>
      <div id="vcBody"><button class="btn btn-primary btn-block btn-lg" id="vcSend" type="button">أرسل الكود${st && st.email ? ` إلى <bdi dir="ltr">${esc(st.email)}</bdi>` : ''}</button></div>
    </div>`);
  onTap('#vcSend', async () => {
    const b = $('#vcSend'); b.disabled = true; b.classList.add('loading');
    try {
      const r = await api('/api/card/sec/code', { purpose });
      $('#vcBody').innerHTML = `
        <div class="field mb-3"><label class="field-label" for="vcCode">الكود اللي وصلك على <bdi dir="ltr">${esc(r.sent_to || '')}</bdi></label>
          <input class="input tabular" id="vcCode" inputmode="numeric" maxlength="6" dir="ltr" autocomplete="one-time-code" placeholder="••••••" style="text-align:center;letter-spacing:8px;font-size:22px"></div>
        ${needPin ? `<div class="field mb-2"><label class="field-label" for="vcPin">${mode === 'reset' ? 'الرمز الجديد' : 'اختر رمزك السري'} (4 أرقام)</label>
          <input class="input tabular" id="vcPin" type="password" inputmode="numeric" maxlength="4" dir="ltr" autocomplete="new-password" style="text-align:center;letter-spacing:10px;font-size:22px"></div>
          <div class="field mb-3"><label class="field-label" for="vcPin2">أعد كتابة الرمز</label>
          <input class="input tabular" id="vcPin2" type="password" inputmode="numeric" maxlength="4" dir="ltr" autocomplete="new-password" style="text-align:center;letter-spacing:10px;font-size:22px"></div>
          <p class="caption mb-3">لا تستعمل أرقام متكررة أو متتالية (مثل 1111 أو 1234)، ولا تشاركه مع أي أحد.</p>` : ''}
        <button class="btn btn-primary btn-block btn-lg" id="vcGo" type="button">تأكيد</button>`;
      $('#vcCode').focus();
      onTap('#vcGo', async () => {
        const code = $('#vcCode').value.replace(/\D/g, '');
        if (code.length !== 6) return toast('الكود 6 أرقام', 'bad');
        let pin = '';
        if (needPin) {
          pin = $('#vcPin').value.replace(/\D/g, '');
          if (pin.length !== 4) return toast('الرمز 4 أرقام', 'bad');
          if (pin !== $('#vcPin2').value.replace(/\D/g, '')) return toast('الرمزين مش متطابقين', 'bad');
        }
        const g = $('#vcGo'); g.disabled = true; g.classList.add('loading');
        try {
          const v = await api('/api/card/sec/verify', { code, pin });
          try { localStorage.setItem(CDEV_KEY, v.device); } catch {}
          haptic.ok();
          if (c) { toast(v.pin_set ? 'تم حفظ رمزك السري ✓' : 'تم تأكيد الجهاز ✓', 'ok'); vaultPin(c); }
          else { closeModal(); toast(v.pin_set ? 'تم حفظ رمزك السري ✓' : 'تم تأكيد الجهاز ✓', 'ok'); }
        } catch (e) { toast(e.message, 'bad'); g.disabled = false; g.classList.remove('loading'); }
      });
    } catch (e) { toast(e.message, 'bad'); b.disabled = false; b.classList.remove('loading'); }
  });
}
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#kPinReset')) { e.preventDefault(); vaultCodeFlow(null, 'reset'); } });

/* ═══ v52 — تحليل الزوار: يُجمع في المتصفح ويُرسل مرة كل دقيقة (بدون بيانات شخصية) ═══ */
var AN = { pv: {}, dur: {}, ev: {}, cur: '', since: Date.now(), dirty: false };
function anId() {
  try { let a = localStorage.getItem('kardo_aid'); if (!a) { a = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => (b % 36).toString(36)).join(''); localStorage.setItem('kardo_aid', a); } return a; } catch { return ''; }
}
function anTick() { if (!AN) return; if (AN.cur && document.visibilityState === 'visible') { const sec = Math.round((Date.now() - AN.since) / 1000); if (sec > 0 && sec < 1800) { AN.dur[AN.cur] = (AN.dur[AN.cur] || 0) + sec; AN.dirty = true; } } AN.since = Date.now(); }
function anPage(p) { if (!p || !AN) return; anTick(); AN.cur = p; AN.pv[p] = (AN.pv[p] || 0) + 1; AN.dirty = true; }
function anEv(e) { if (!AN) return; AN.ev[e] = (AN.ev[e] || 0) + 1; AN.dirty = true; }
function anFlush(beat) {
  anTick();
  let nv = 0;
  try { const d = new Date().toISOString().slice(0, 10); if (localStorage.getItem('kardo_an_day') !== d) { localStorage.setItem('kardo_an_day', d); nv = 1; } } catch {}
  if (!AN.dirty && !nv && !beat) return;
  const body = JSON.stringify({ a: anId(), pv: AN.pv, dur: AN.dur, ev: AN.ev, nv, dev: matchMedia('(max-width: 760px)').matches ? 'm' : 'd', pwa: isStandalone() ? 1 : 0 });
  AN.pv = {}; AN.dur = {}; AN.ev = {}; AN.dirty = false;
  try { if (!(navigator.sendBeacon && navigator.sendBeacon(API_BASE + '/api/t', new Blob([body], { type: 'text/plain' })))) fetch(API_BASE + '/api/t', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => {}); } catch {}
}
setInterval(() => { if (document.visibilityState === 'visible' && !kIdle()) anFlush(true); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') anFlush(); else AN.since = Date.now(); });
addEventListener('pagehide', () => anFlush());
addEventListener('appinstalled', () => anEv('install'));
setTimeout(() => { if (!AN.cur && document.getElementById('public') && getComputedStyle(document.getElementById('public')).display !== 'none') anPage('landing'); anFlush(true); }, 4000);

/* ═══ v52 — «كيف أدفع؟»: خطوات مصوّرة لكل طريقة (الأدمن يقدر يبدّل النص والصور) ═══ */
const HT_DEF = {
  binance_pay: { title: 'Binance Pay', color: '#F0B90B', steps: [
    ['افتح تطبيق Binance، ومن الرئيسية اضغط «Pay» (الدفع).', { k: 'tiles', hi: 'Pay', items: ['إيداع', 'Pay', 'سحب', 'تحويل'] }],
    ['اختر «إرسال» (Send).', { k: 'tiles', hi: 'إرسال', items: ['إرسال', 'استلام', 'سجل', 'المزيد'] }],
    ['اختر «Pay ID» والصق الرقم اللي في فاتورتك.', { k: 'field', hi: 'Pay ID', val: '123 456 789' }],
    ['اختر العملة USDT واكتب المبلغ بالضبط زي الفاتورة (بالكسور).', { k: 'amount', hi: 'USDT', val: '10.0347' }],
    ['راجع البيانات واضغط «تأكيد» — الرصيد ينضاف لمحفظتك تلقائيًا خلال دقائق.', { k: 'confirm', hi: 'تأكيد' }]] },
  binance_withdraw: { title: 'سحب من Binance', color: '#F0B90B', steps: [
    ['من Binance افتح «المحفظة» واضغط «سحب» (Withdraw).', { k: 'tiles', hi: 'سحب', items: ['إيداع', 'سحب', 'تحويل', 'سجل'] }],
    ['اختر عملة USDT.', { k: 'list', hi: 'USDT', items: ['BTC', 'USDT', 'BNB', 'ETH'] }],
    ['الصق العنوان من الفاتورة، واختر نفس الشبكة المكتوبة فيها (TRC20 أو BEP20).', { k: 'field', hi: 'الشبكة: TRC20', val: 'TQn9Y2…KcbLSE' }],
    ['اكتب المبلغ بحيث «المبلغ المستلَم» يساوي مبلغ الفاتورة بالضبط — الرسوم تنزاد عليك.', { k: 'amount', hi: 'المستلَم', val: '10.0347' }],
    ['اضغط «سحب» وأكّد — ينضاف تلقائيًا بعد ما توصل المعاملة.', { k: 'confirm', hi: 'سحب' }]] },
  mexc: { title: 'سحب من MEXC', color: '#2E6BE6', steps: [
    ['من MEXC افتح «الأصول» (Assets) واضغط «سحب».', { k: 'tiles', hi: 'سحب', items: ['إيداع', 'سحب', 'تحويل', 'سجل'] }],
    ['اختر USDT ثم «سحب على الشبكة» (On-chain).', { k: 'list', hi: 'USDT', items: ['USDT', 'BTC', 'MX', 'ETH'] }],
    ['الصق العنوان واختر نفس شبكة الفاتورة (TRC20 أو BEP20).', { k: 'field', hi: 'الشبكة: BEP20', val: '0x4f2a…9e0' }],
    ['انتبه للرسوم: لازم «المبلغ اللي يوصل» يساوي مبلغ الفاتورة بالضبط.', { k: 'amount', hi: 'يوصل', val: '10.0347' }],
    ['أكّد السحب بالكود — ينضاف تلقائيًا بعد وصول المعاملة.', { k: 'confirm', hi: 'تأكيد' }]] },
  libyana: { title: 'ليبيانا', color: '#00A6E1', steps: [
    ['في كاردو اختر ليبيانا والمبلغ، وانسخ الرقم اللي نعطيهولك.', { k: 'field', hi: 'حوّل إلى', val: '0925 551 234' }],
    ['من خدمة «تحويل الرصيد» في ليبيانا حوّل نفس المبلغ بالضبط لهذا الرقم.', { k: 'sms', hi: 'تم التحويل' }],
    ['ارجع لكاردو، اكتب رقمك اللي حوّلت منه واضغط «حوّلت الرصيد» — ينضاف تلقائيًا أول ما توصل رسالة التحويل.', { k: 'confirm', hi: 'حوّلت الرصيد' }]] },
  almadar: { title: 'المدار', color: '#E2231A', steps: [
    ['في كاردو اختر المدار والمبلغ، وانسخ الرقم اللي نعطيهولك.', { k: 'field', hi: 'حوّل إلى', val: '0915 551 234' }],
    ['من خدمة «تحويل الرصيد» في المدار حوّل نفس المبلغ بالضبط لهذا الرقم.', { k: 'sms', hi: 'تم التحويل' }],
    ['ارجع لكاردو، اكتب رقمك اللي حوّلت منه واضغط «حوّلت الرصيد» — ينضاف تلقائيًا أول ما توصل رسالة التحويل.', { k: 'confirm', hi: 'حوّلت الرصيد' }]] },
  bank: { title: 'تحويل مصرفي', color: '#566064', steps: [
    ['في كاردو اختر التحويل المصرفي، وانسخ رقم الحساب واسم المستفيد.', { k: 'field', hi: 'رقم الحساب', val: '•••• 1234' }],
    ['حوّل المبلغ من تطبيق مصرفك أو من الفرع، واحتفظ بالإيصال.', { k: 'confirm', hi: 'تحويل' }],
    ['ارجع لكاردو، اكتب المبلغ وارفع صورة الإيصال — ينضاف بعد المراجعة.', { k: 'upload', hi: 'إرفاق الإيصال' }]] },
};
const HT_FOR = { all: ['binance_pay', 'binance_withdraw', 'mexc', 'libyana', 'almadar', 'bank'], binance_pay: ['binance_pay'], trc20: ['binance_withdraw', 'mexc'], bep20: ['binance_withdraw', 'mexc'], polygon: ['binance_withdraw', 'mexc'], libyana: ['libyana'], almadar: ['almadar'] };
const htKeysFor = k => HT_FOR[k] || ['bank'];
// رسم شاشة هاتف مبسطة (بدون شعارات) — تظهر لين يرفع الأدمن صورة حقيقية
function htArt(a, color) {
  const W = 220, H = 300, x0 = 26, w = W - 52;
  const e = t => String(t).replace(/[&<>"]/g, '');
  let body = '';
  const tap = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="16" fill="${color}" opacity=".18"><animate attributeName="r" values="10;20;10" dur="1.6s" repeatCount="indefinite"/></circle><circle cx="${cx}" cy="${cy}" r="6" fill="${color}"/>`;
  if (a.k === 'tiles') {
    a.items.forEach((t, i) => { const cx = x0 + 22 + i * ((w - 44) / 3), on = t === a.hi;
      body += `<rect x="${cx - 18}" y="92" width="36" height="36" rx="11" fill="${on ? color : 'var(--u-s3)'}"/><text x="${cx}" y="146" font-size="10" text-anchor="middle" fill="var(--u-ink)" font-weight="${on ? 700 : 400}">${e(t)}</text>`;
      if (on) body += tap(cx + 10, 118); });
    body += `<rect x="${x0}" y="170" width="${w}" height="44" rx="10" fill="var(--u-s2)"/><rect x="${x0}" y="222" width="${w}" height="44" rx="10" fill="var(--u-s2)"/>`;
  } else if (a.k === 'list') {
    a.items.forEach((t, i) => { const y = 84 + i * 46, on = t === a.hi;
      body += `<rect x="${x0}" y="${y}" width="${w}" height="38" rx="10" fill="${on ? 'var(--u-gold-soft)' : 'var(--u-s2)'}" ${on ? `stroke="${color}" stroke-width="1.5"` : ''}/><circle cx="${x0 + w - 18}" cy="${y + 19}" r="9" fill="${on ? color : 'var(--u-s3)'}"/><text x="${x0 + w - 34}" y="${y + 23}" font-size="11" text-anchor="end" fill="var(--u-ink)" font-weight="${on ? 700 : 400}">${e(t)}</text>`;
      if (on) body += tap(x0 + 40, y + 19); });
  } else if (a.k === 'field' || a.k === 'amount') {
    body += `<text x="${x0 + w}" y="100" font-size="10.5" text-anchor="end" fill="var(--u-ink-3)">${e(a.hi)}</text>
      <rect x="${x0}" y="108" width="${w}" height="44" rx="11" fill="var(--u-s1)" stroke="${color}" stroke-width="1.8"/>
      <text x="${a.k === 'amount' ? x0 + w / 2 : x0 + 12}" y="136" font-size="${a.k === 'amount' ? 17 : 12}" text-anchor="${a.k === 'amount' ? 'middle' : 'start'}" fill="var(--u-ink)" font-weight="700" direction="ltr">${e(a.val)}</text>
      <rect x="${x0}" y="168" width="${w}" height="30" rx="9" fill="var(--u-s2)"/><rect x="${x0}" y="206" width="${w * .6}" height="12" rx="6" fill="var(--u-s2)"/>
      <rect x="${x0}" y="236" width="${w}" height="34" rx="10" fill="var(--u-s3)"/>` + tap(x0 + w - 24, 130);
  } else if (a.k === 'sms') {
    body += `<rect x="${x0}" y="96" width="${w}" height="74" rx="14" fill="var(--u-s2)"/><text x="${x0 + w - 12}" y="122" font-size="11" text-anchor="end" fill="var(--u-ink)" font-weight="700">${e(a.hi)} ✓</text>
      <rect x="${x0 + 14}" y="134" width="${w - 28}" height="8" rx="4" fill="var(--u-s3)"/><rect x="${x0 + 40}" y="150" width="${w - 54}" height="8" rx="4" fill="var(--u-s3)"/>
      <rect x="${x0}" y="186" width="${w}" height="34" rx="10" fill="var(--u-s2)"/><rect x="${x0}" y="228" width="${w}" height="34" rx="10" fill="${color}" opacity=".9"/>`;
  } else {
    body += `<rect x="${x0}" y="86" width="${w}" height="26" rx="8" fill="var(--u-s2)"/><rect x="${x0}" y="120" width="${w}" height="26" rx="8" fill="var(--u-s2)"/><rect x="${x0}" y="154" width="${w * .7}" height="26" rx="8" fill="var(--u-s2)"/>
      ${a.k === 'upload' ? `<rect x="${x0}" y="190" width="${w}" height="36" rx="10" fill="none" stroke="var(--u-line-2)" stroke-dasharray="4 4"/>` : ''}
      <rect x="${x0}" y="236" width="${w}" height="38" rx="12" fill="${color}"/><text x="${x0 + w / 2}" y="260" font-size="12.5" text-anchor="middle" fill="#fff" font-weight="700">${e(a.hi)}</text>` + tap(x0 + w / 2 + 34, 255);
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="ht-art" role="img" aria-hidden="true" font-family="IBM Plex Sans Arabic, sans-serif">
    <rect x="12" y="6" width="${W - 24}" height="${H - 12}" rx="26" fill="var(--u-s1)" stroke="var(--u-line)" stroke-width="2"/>
    <rect x="${W / 2 - 22}" y="14" width="44" height="6" rx="3" fill="var(--u-line)"/>
    <rect x="${x0}" y="34" width="${w}" height="34" rx="10" fill="${color}" opacity=".16"/><rect x="${x0 + w - 70}" y="46" width="58" height="10" rx="5" fill="${color}" opacity=".7"/>${body}</svg>`;
}
let _htSrv = null;
async function htGuides() {
  if (_htSrv) return _htSrv;
  try { const r = await apiGet('/api/howto'); _htSrv = r.guides || {}; } catch { _htSrv = {}; }
  return _htSrv;
}
let _htBack = null;
async function openHowto(methodKey, which, back) {
  const keys = htKeysFor(methodKey);
  let cur = which && keys.includes(which) ? which : keys[0];
  anPage('howto');
  const srv = await htGuides();
  const draw = () => {
    const d = HT_DEF[cur], o = srv[cur];
    const steps = o && o.steps && o.steps.length ? o.steps.map((s, i) => [s.t, s.img ? null : (d.steps[i] || d.steps[d.steps.length - 1])[1], s.img]) : d.steps.map(([t, a]) => [t, a, '']);
    modal(`<div class="modal-head"><div class="modal-title">كيف أدفع؟ — ${esc(d.title)}</div><button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
      ${keys.length > 1 ? `<div class="pills mb-4">${keys.map(k => `<button class="pill ${k === cur ? 'active' : ''}" data-htk="${k}" type="button">${esc(HT_DEF[k].title)}</button>`).join('')}</div>` : ''}
      <div class="ht-steps">${steps.map(([t, a, img], i) => `<div class="ht-step"><div class="ht-pic">${img ? `<img src="${esc(API_BASE + img)}" alt="" loading="lazy">` : htArt(a, d.color)}</div>
        <div class="ht-txt"><b>${i + 1}</b><span>${esc(t)}</span></div></div>`).join('')}</div>
      ${o && o.note ? `<div class="alert alert-info mb-3">${svg(I.help, 2)}<div>${esc(o.note)}</div></div>` : ''}
      <button class="btn btn-primary btn-block" id="htDone" type="button">${back ? 'فهمت — رجوع' : 'فهمت'}</button>`);
    $$('[data-htk]').forEach(b => b.onclick = () => { cur = b.dataset.htk; draw(); });
    onTap('#htDone', () => { if (back) back(); else closeModal(); });
  };
  draw();
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-howto]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const inModal = !!b.closest('#modal');
  openHowto(b.dataset.howto, null, inModal ? _htBack : null);
}, true);

/* ═══ v52 — رابط دفع الفاتورة: يبعته لحد يدفع عنه بدون ما يدخل حسابه ═══ */
async function openPayLink(inv) {
  stopInvoiceTimers();
  modal(`<div class="kvault"><div class="kv-ic">${svg(I.share)}</div><div class="h3" style="margin:0 0 4px">خلّي حد يدفع عنك</div>
    <p class="body-sm text-2" style="margin:0 0 14px">ابعت الرابط لصاحبك: يشوف المبلغ وطريقة الدفع بس، بدون ما يدخل حسابك ولا يشوف رصيدك. أول ما يدفع ينضاف لمحفظتك.</p>
    <div id="plBody"><div class="skeleton" style="height:52px;border-radius:14px"></div></div></div>`);
  try {
    const r = await api('/api/wallet/invoice/share', { id: inv.id });
    anEv('share_inv');
    inv.shared = true;
    $('#plBody').innerHTML = `<div class="copy-box mb-3"><div class="copy-value" dir="ltr" style="font-size:12px;word-break:break-all;white-space:normal">${esc(r.url)}</div>
        <button class="copy-btn" data-act="copy" data-copy-text="${esc(r.url)}" aria-label="نسخ الرابط">${svg(I.copy, 2)}</button></div>
      <button class="btn btn-primary btn-block mb-2" id="plShare" type="button">${svg(I.share)} مشاركة الرابط</button>
      <button class="btn btn-ghost btn-block" id="plOff" type="button" style="color:var(--u-err)">إيقاف الرابط</button>
      <button class="btn btn-secondary btn-block" id="plBack" type="button" style="margin-top:6px">رجوع للفاتورة</button>
      <p class="caption" style="margin-top:10px">كل مرة تضغط هنا يطلع رابط جديد ويتوقف القديم.</p>`;
    onTap('#plShare', async () => {
      const text = `ادفع فاتورتي في كاردو (${Number(inv.pay_amount).toFixed(4)} USDT):`;
      try { if (navigator.share) await navigator.share({ title: 'فاتورة كاردو ' + inv.no, text, url: r.url }); else { await navigator.clipboard.writeText(r.url); toast('نُسخ الرابط ✓', 'ok'); } } catch {}
    });
    onTap('#plOff', async () => { try { await api('/api/wallet/invoice/share', { id: inv.id, on: false }); inv.shared = false; toast('أُوقف الرابط', 'ok'); openInvoice(inv); } catch (e) { toast(e.message, 'bad'); } });
    onTap('#plBack', () => openInvoice(inv));
  } catch (e) { toast(e.message, 'bad'); openInvoice(inv); }
}

/* ═══ v53 — المتجر الجديد: دفع من صفحة المنتج + تقليب العروض ═══ */
async function rscProductPay() {
  const cat = rscCatBy(S.rscCat); if (!cat) return;
  const isTop = cat.type === 'topup';
  const sel = cat.offers.find(o => o.id === S.rscSel) || cat.offers[0];
  const qty = isTop ? 1 : Math.min(sel.max, Math.max(sel.min, Math.floor(n(S.rscQty) || sel.min)));
  const total = Math.round(sel.price * qty * 100) / 100;
  const fields = {};
  if (isTop) for (let i = 0; i < (cat.fields || []).length; i++) {
    const el = $('#rpf' + i), v = (el ? el.value : '').trim();
    if (!v) { toast(`${cat.fields[i].label} مطلوب`, 'bad'); el && el.focus(); return; }
    fields[cat.fields[i].key] = v;
  }
  const body = { cat: cat.key, offer: sel.id, qty, fields, expect: total, idempotency_key: S.rscKey };
  if (n(S.profile.wallet_balance) < total) {
    const short = Math.ceil((total - n(S.profile.wallet_balance)) * 100) / 100;
    CHECKOUT = { name: `${cat.name} — ${sel.name}`, total, body };
    return openDeposit(short, true);
  }
  if (!confirm(`تأكيد شراء ${sel.name}${qty > 1 ? ' × ' + qty : ''} بـ ${lyd(total * rate())}؟`)) return;
  const btn = $('#rpGo'); if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  try {
    const r = await api('/api/rsc/order', body, 60000);
    anEv('buy');
    S.rscKey = newIdemKey(); S.rscOrders = null; loadRscOrders();
    openRscResult(r.order);
  } catch (e) {
    if (/السعر/.test(e.message)) loadRsc(true);
    toast(e.message, 'bad');
  }
  if (btn && document.body.contains(btn)) { btn.disabled = false; btn.classList.remove('loading'); }
}
let _heroT = null;
function rscHeroAuto() {
  clearInterval(_heroT);
  const box = $('#kHeros'); if (!box) return;
  const dots = $$('#kDots i');
  const idx = () => Math.round(Math.abs(box.scrollLeft) / Math.max(1, box.firstElementChild ? box.firstElementChild.offsetWidth + 12 : 1));
  box.onscroll = () => { const i = idx(); dots.forEach((d, k) => d.classList.toggle('on', k === i)); };
  if (box.children.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let paused = false;
  box.ontouchstart = () => { paused = true; }; box.ontouchend = () => { setTimeout(() => { paused = false; }, 4000); };
  _heroT = setInterval(() => {
    if (paused || document.visibilityState !== 'visible' || !document.body.contains(box)) return;
    const next = (idx() + 1) % box.children.length, el = box.children[next];
    const r = box.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;    // خارج الشاشة: لا نحرّك
    const step = next * (el.offsetWidth + 12), rtl = getComputedStyle(box).direction === 'rtl';
    box.scrollTo({ left: rtl ? -step : step, behavior: 'smooth' });
  }, 4500);
}

/* ═══ v54 — خاتمة الصفحات + آراء العملاء + الأسئلة الشائعة + التقييم بعد الشراء ═══ */
const FAQ_DEF = [
  ['كم ياخذ الشحن؟', 'أغلب الطلبات توصل خلال دقيقة إلى دقائق. الأكواد تظهرلك فورًا في «طلباتي».'],
  ['كيف أشحن محفظتي؟', 'من زر «شحن» تحت: ليبيانا أو المدار أو العملات الرقمية أو تحويل مصرفي. وفي كل طريقة زر «كيف؟» يشرحها بالصور.'],
  ['لو الطلب ما وصلش؟', 'لو المزوّد ما نفّذش الطلب، المبلغ يرجع لمحفظتك كامل وتلقائيًا. ولو عندك أي مشكلة كلّمنا من الدعم.'],
  ['هل أقدر أسحب رصيدي؟', 'الرصيد مخصّص للشراء داخل كاردو. لو عندك حالة خاصة تواصل مع الدعم.'],
];
const SOC_IC = {
  fb: '<path d="M14 8h3V4h-3a4 4 0 0 0-4 4v2H7v4h3v6h4v-6h3l1-4h-4V8z"/>',
  ig: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',
  tt: '<path d="M14 3v11.5a3.5 3.5 0 1 1-3-3.46"/><path d="M14 3c.5 2.6 2.2 4.2 5 4.5"/>',
  tg: '<path d="m21 4-3 16-6-5-3 3-1-6-5-2z"/><path d="m8 12 9-6"/>',
};
function siteFooter() {
  const c = S.config.contact || {};
  const wa = c.whatsapp ? c.whatsapp.replace(/^\+?218/, '0').replace(/^00218/, '0') : '';
  const waLink = c.whatsapp ? 'https://wa.me/' + c.whatsapp.replace(/^\+/, '').replace(/^0/, '218') : '';
  const soc = ['fb', 'ig', 'tt', 'tg'].filter(k => c[k]);
  return `<footer class="kfoot">
    <div class="kfoot-cols">
      <div><h4>تواصل معنا</h4>
        ${wa ? `<a href="${esc(waLink)}" target="_blank" rel="noopener">${svg(I.phone || I.help)}<span dir="ltr">${esc(wa)}</span></a>` : ''}
        ${c.email ? `<a href="mailto:${esc(c.email)}">${svg(I.mail)}<span>${esc(c.email)}</span></a>` : ''}
        <button type="button" data-nav="support">${svg(I.chat || I.help)}<span>الدعم داخل التطبيق</span></button></div>
      <div><h4>روابط</h4>
        <button type="button" data-howto="all"><span>كيف أدفع؟</span></button>
        <button type="button" data-faq><span>الأسئلة الشائعة</span></button>
        <button type="button" data-nav="referral"><span>ادعُ صديقًا</span></button>
        <a href="./terms.html" target="_blank" rel="noopener"><span>الشروط والخصوصية</span></a></div>
    </div>
    ${soc.length ? `<div class="kfoot-soc">${soc.map(k => `<a href="${esc(c[k])}" target="_blank" rel="noopener" aria-label="${k}">${svg(SOC_IC[k])}</a>`).join('')}</div>` : ''}
    <div class="kfoot-cp"><img src="./kardo-mark.png" alt="">© ${new Date().getFullYear()} كاردو. جميع الحقوق محفوظة.</div>
  </footer>`;
}
function faqList() { const f = (S.config.contact || {}).faq; return f && f.length ? f : FAQ_DEF; }
function homeFaq() {
  return `<div class="ksh"><h2>أسئلة شائعة</h2></div>
    <div class="kfaq">${faqList().slice(0, 5).map(([q, a]) => `<details><summary>${esc(q)}<i>+</i></summary><p>${esc(a)}</p></details>`).join('')}</div>`;
}
document.addEventListener('click', e => {
  const f = e.target.closest && e.target.closest('[data-faq]');
  if (!f) return;
  e.preventDefault();
  modal(`<div class="modal-head"><div class="modal-title">الأسئلة الشائعة</div><button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x, 2)}</button></div>
    <div class="kfaq">${faqList().map(([q, a], i) => `<details ${i ? '' : 'open'}><summary>${esc(q)}<i>+</i></summary><p>${esc(a)}</p></details>`).join('')}</div>`);
});
// آراء العملاء — تقييمات حقيقية فقط (تظهر بعد ما يتجمّع عدد كافٍ)
S.reviews = null;
function loadReviews() { if (S._revLoading) return; S._revLoading = 1; apiGet('/api/reviews').then(r => { S.reviews = r; render(); }).catch(() => { S.reviews = { list: [] }; }); }
function homeReviews() {
  if (!S.reviews) { loadReviews(); return ''; }
  const R = S.reviews; if (!R.list || !R.list.length || R.hidden) return '';
  const stars = v => '★'.repeat(Math.round(v)) + '☆'.repeat(5 - Math.round(v));
  return `<div class="ksh"><h2>آراء العملاء</h2></div>
    <div class="krev-sum"><b class="tabular">${esc(String(R.avg))}</b><div><div class="kst">${stars(R.avg)}</div><span>من ${esc(String(R.count))} تقييم بعد شراء حقيقي</span></div></div>
    <div class="krow">${R.list.map(r => `<div class="krev"><div class="krev-h"><span class="krev-av">${esc(Array.from(r.name || '؟')[0])}</span><div><b dir="auto">${esc(r.name)}</b><div class="kst sm">${stars(r.stars)}</div></div><span class="krev-vf">✓ شراء مؤكد</span></div>
      <p>${esc(r.text)}</p><span class="krev-it" dir="auto">${esc(r.item || '')}</span></div>`).join('')}</div>`;
}
// التقييم بعد الشراء
function rateBox(o) {
  return `<div class="krate" data-rateo="${esc(o.id)}"><b>وصلك الطلب؟ قيّم تجربتك</b>
    <div class="krate-st" dir="ltr">${[1, 2, 3, 4, 5].map(i => `<button type="button" data-star="${i}" aria-label="${i} نجوم">★</button>`).join('')}</div>
    <textarea class="input" data-ratetxt rows="2" maxlength="300" placeholder="اكتب رأيك (اختياري)" style="height:auto;padding-top:10px;display:none"></textarea>
    <button class="btn btn-secondary btn-sm btn-block" data-ratego type="button" style="display:none">إرسال التقييم</button></div>`;
}
function rateNudge() {
  const o = (S.rscOrders || []).find(x => x.status === 'completed' && !x.reviewed && Date.now() - Date.parse(x.created_at || 0) < 3 * 86400000);
  if (!o) return '';
  try { if (localStorage.getItem('kardo_rate_skip_' + o.id)) return ''; } catch {}
  return `<div class="card mb-4 krate-card">${rateBox({ ...o, id: o.id }).replace('<b>وصلك الطلب؟ قيّم تجربتك</b>', `<b>وصلك ${esc(o.offer_name)}؟ قيّم تجربتك</b><button class="krate-x" data-rateskip="${esc(o.id)}" type="button" aria-label="لاحقًا">${svg(I.x, 2)}</button>`)}</div>`;
}
document.addEventListener('click', async e => {
  const t = e.target.closest ? e.target : null; if (!t) return;
  const sk = t.closest('[data-rateskip]'); if (sk) { try { localStorage.setItem('kardo_rate_skip_' + sk.dataset.rateskip, '1'); } catch {} render(); return; }
  const st = t.closest('[data-star]');
  if (st) {
    const box = st.closest('[data-rateo]'), v = Number(st.dataset.star);
    box.dataset.v = v;
    box.querySelectorAll('[data-star]').forEach(b => b.classList.toggle('on', Number(b.dataset.star) <= v));
    box.querySelector('[data-ratetxt]').style.display = ''; box.querySelector('[data-ratego]').style.display = '';
    haptic.tap(); return;
  }
  const go = t.closest('[data-ratego]');
  if (go) {
    const box = go.closest('[data-rateo]'), v = Number(box.dataset.v || 0);
    if (!v) return toast('اختر عدد النجوم', 'bad');
    go.disabled = true;
    try {
      await api('/api/review', { order_id: box.dataset.rateo, stars: v, text: box.querySelector('[data-ratetxt]').value.trim() });
      (S.rscOrders || []).forEach(x => { if (x.id === box.dataset.rateo) x.reviewed = true; });
      box.innerHTML = '<b style="color:var(--u-ok)">شكرًا على تقييمك 🌟</b>'; haptic.ok();
      setTimeout(() => render(), 1500);
    } catch (er) { toast(er.message, 'bad'); go.disabled = false; }
  }
});


/* ═══ v55 — حالة أقسام الموقع ═══ */
const PAGE_SEC = { kstore: 'store', cards: 'cards', support: 'support' };
const SEC_T = { cards: ['قسم البطاقات', '💳'], store: ['المتجر', '🛍️'], deposit: ['شحن المحفظة', '💰'], transfer: ['التحويل', '↔️'], withdraw: ['السحب', '🏦'], support: ['الدعم', '💬'] };
function secOf(k) { const x = ((S.config || {}).sections || {})[k]; return x && x.s ? x : { s: 'on', msg: '' }; }
function secShut(k) { return secOf(k).s !== 'on'; }
function secBody(k) {
  const x = secOf(k), t = SEC_T[k] || [k, '🛠️'], m = x.s === 'maint';
  return `<div class="ksec">
    <div class="ksec-ic">${m ? '🛠️' : t[1]}</div>
    <h1>${esc(t[0])} ${m ? 'مغلق مؤقتًا' : 'غير متاح حاليًا'}</h1>
    <p>${m ? 'نشتغلوا على تحسينات، ويرجع القسم قريب إن شاء الله.' : 'هذا القسم موقوف حاليًا.'}${k === 'cards' ? '<br>بطاقاتك ورصيدها بأمان.' : k === 'deposit' || k === 'withdraw' || k === 'transfer' ? '<br>رصيدك بأمان.' : ''}</p>
    ${x.msg ? `<div class="ksec-msg"><small>رسالة من الإدارة</small>${esc(x.msg)}</div>` : ''}
    ${k !== 'store' ? `<button class="btn btn-primary btn-block btn-lg mb-2" data-nav="kstore" type="button">تصفح المتجر</button>` : `<button class="btn btn-primary btn-block btn-lg mb-2" data-nav="dashboard" type="button">الرئيسية</button>`}
    ${k !== 'support' ? `<button class="btn btn-secondary btn-block" data-nav="support" type="button">تواصل مع الدعم</button>` : ''}
  </div>`;
}
function secClosedPage(k) { return `<div class="page-enter">${secBody(k)}</div>`; }
function secBlock(k) {
  if (!secShut(k)) return false;
  modal(`<div class="modal-body" style="padding-top:8px">${secBody(k).replace(/data-nav=/g, 'data-secgo=')}</div>`);
  return true;
}
document.addEventListener('click', e => {
  const g = e.target.closest('[data-secgo]'); if (g) { window.closeModal(); go(g.dataset.secgo); return; }
  const t = e.target.closest('[data-hometab]'); if (!t) return;
  S.rscTab = t.dataset.hometab === 'all' ? 'all' : t.dataset.hometab; S.rscCat = null; go('kstore', true);
});


/* ═══ v56 — تحميل خلفيات المربعات لما توصلها (الخلفية الضبابية باقية) ═══ */
let _bgIO = null; const _bgDone = new Set();
function lazyBgs() {
  const els = [...document.querySelectorAll('[data-bg]')].filter(el => {      // اللي تحمّل قبل يبان فورًا بلا رمشة
    if (!_bgDone.has(el.dataset.bg)) return true;
    el.style.backgroundImage = `url("${el.dataset.bg.replace(/"/g, '%22')}")`; el.classList.add('in', 'now'); el.removeAttribute('data-bg'); return false;
  });
  if (!els.length) return;
  if (!('IntersectionObserver' in window)) { els.forEach(el => { el.style.backgroundImage = `url("${el.dataset.bg}")`; el.removeAttribute('data-bg'); }); return; }
  if (!_bgIO) _bgIO = new IntersectionObserver(ents => {
    for (const en of ents) {
      if (!en.isIntersecting) continue;
      const el = en.target, u = el.dataset.bg; _bgIO.unobserve(el);
      if (!u) continue;
      const im = new Image(); im.decoding = 'async';
      im.onload = im.onerror = () => { _bgDone.add(u); el.style.backgroundImage = `url("${u.replace(/"/g, '%22')}")`; el.classList.add('in'); };
      im.src = u; el.removeAttribute('data-bg');
    }
  }, { rootMargin: '300px 300px' });
  els.forEach(el => _bgIO.observe(el));
}
document.addEventListener('click', e => {
  const m = e.target.closest('[data-rscmore]'); if (!m) return;
  S.rscLim = { k: m.dataset.rscmore, n: Number(m.dataset.n) || 48 }; render();
});

/* ═══ v57 — بحث ذكي: عربي/إنجليزي، بدون حساسية للهمزات والمسافات ═══ */
const SRCH_AL = [['ببجي', 'pubg'], ['بوبجي', 'pubg'], ['فري فاير', 'free fire'], ['فري فاير', 'freefire'], ['روبلوكس', 'roblox'], ['فورتنايت', 'fortnite'], ['فالورانت', 'valorant'], ['ستيم', 'steam'], ['بلايستيشن', 'playstation'], ['بلاستيشن', 'playstation'], ['سوني', 'psn'], ['ايتونز', 'itunes'], ['آيتونز', 'itunes'], ['ابل', 'apple'], ['جوجل', 'google'], ['قوقل', 'google'], ['اكس بوكس', 'xbox'], ['نتفليكس', 'netflix'], ['شاهد', 'shahid'], ['سبوتيفاي', 'spotify'], ['ادوبي', 'adobe'], ['كانفا', 'canva'], ['مايكروسوفت', 'microsoft'], ['رايزر', 'razer'], ['كاش', 'cash'], ['امازون', 'amazon'], ['نينتندو', 'nintendo'], ['ماين كرافت', 'minecraft'], ['كول اوف ديوتي', 'call of duty'], ['ليج', 'league'], ['موبايل ليجند', 'mobile legends'], ['جنشن', 'genshin'], ['فيفا', 'fifa'], ['يلا لودو', 'yalla ludo'], ['جواكر', 'jawaker'], ['تيك توك', 'tiktok'], ['ديسكورد', 'discord'], ['يوتيوب', 'youtube'], ['انغامي', 'anghami'], ['ديزني', 'disney']];
const srchNorm = s => String(s || '').toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[\s\-_.()·:]+/g, '');
function srchMatch(text, q) {
  const t = srchNorm(text), nq = srchNorm(q);
  if (!nq) return true;
  if (t.includes(nq)) return true;
  for (const [ar, en] of SRCH_AL) {
    const a = srchNorm(ar), e = srchNorm(en);
    if ((a.startsWith(nq) || nq.startsWith(a)) && nq.length >= 2 && t.includes(e)) return true;      // كتب بالعربي والاسم إنجليزي
    if ((e.startsWith(nq) || nq.startsWith(e)) && nq.length >= 2 && t.includes(a)) return true;      // كتب بالإنجليزي والاسم عربي
  }
  return false;
}

function bindStoreBits() {
  $$('#kRes [data-rsccat]').forEach(b => b.onclick = () => { const _c = rscCatBy(b.dataset.rsccat); if (_c && _c.maint) return toast('هذا القسم قيد الصيانة حاليًا — جرّب بعد شوية', 'bad'); S.rscCat = b.dataset.rsccat; render(); window.scrollTo({ top: 0, behavior: 'instant' }); });
  $$('#kChips [data-rsctab], #kRes [data-rsctab]').forEach(b => b.onclick = () => { S.rscTab = b.dataset.rsctab; S.rscQ = ''; render(); });
}
