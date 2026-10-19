import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getMessaging, getToken as getMsgToken, isSupported as isMsgSupported } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc as _fsDoc, getDoc as _fsGetDoc, getDocs as _fsGetDocs, onSnapshot as _fsOnSnapshot, collection as _fsCollection, query as _fsQuery,
  orderBy as _fsOrderBy, limit as _fsLimit, where as _fsWhere }
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
try { if ((navigator.hardwareConcurrency || 4) >= 6 && (navigator.deviceMemory || 4) >= 4) document.documentElement.classList.add('fx-blur'); } catch {}

/* ═══ v35 — بعد التحويل الكامل إلى D1: نفس دوال Firestore بأسمائها، لكن عبر الخادم ═══
   • الوضع يُحدَّد عند فتح الصفحة (kardo_d1p)، وإن تغيّر في الخادم تُعاد الصفحة مرة واحدة.
   • كل «onSnapshot» تُجمع في طلب واحد للخادم كل دقيقة والصفحة ظاهرة،
     ويُحدَّث فورًا بعد أي عملية يقوم بها المستخدم.                                                */
const KDB_KEY = 'kardo_admin_d1p';
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
async function getDocs(q) {
  if (!KDB) return _fsGetDocs(q);
  const r = await api('/api/db/q', { q: q.q });
  return kdbQuerySnap(r.docs);
}
async function getDoc(ref) {
  if (!KDB) return _fsGetDoc(ref);
  const r = await api('/api/db/doc', { c: ref.c, id: ref.id });
  return kdbDocSnap(ref, r);
}
const _kdbSubs = new Map();
let _kdbSeq = 0, _kdbBusy = false, _kdbSoon = null, _kdbAgain = false;
function onSnapshot(ref, next, errCb) {
  if (!KDB) return _fsOnSnapshot(ref, next, errCb);
  const id = 's' + (++_kdbSeq);
  _kdbSubs.set(id, { id, ref, next, err: errCb, h: null, due: 0, every: 60000 });
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

const ADM_QUIET = /^\/api\/(admin\/(overview|users\/find|user\/file|names|invoices|crypto\/unmatched|usdt\/find|d1\/(status|rows)|usage|funnel)|db\/)/;
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
  if (KDB && !/^\/api\/(db|sync|admin\/d1)\//.test(path) && !ADM_QUIET.test(path)) kdbSoon(600);   // v35: تحديث فوري بعد أي إجراء
  if (!ADM_QUIET.test(path) && typeof ovSoon === 'function' && S.ov) ovSoon();
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
    try { localStorage.removeItem('kardo_staff'); } catch {}
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
    if (!['super_admin', 'staff', 'finance', 'support', 'ops'].includes(adm.role) || adm.disabled === true) {
      await signOut(auth);
      $('#gate').style.display = 'grid';
      showGateErr('الحساب الإداري بلا دور صالح — راجع المسؤول الرئيسي.');
      return;
    }
    S.admin = { uid: user.uid, email: user.email, ...adm };
    try { localStorage.setItem('kardo_staff', '1'); } catch {}
    $('#gate').style.display = 'none';
    $('#app').style.display = 'block';
    const ROLE_AR = { super_admin: 'مسؤول رئيسي', staff: 'موظف', finance: 'مالية', support: 'دعم', ops: 'عمليات' };
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
  users:         l => query(collection(db, 'users'), limit(l)),       // بدون orderBy: الحسابات بلا created_at كانت تختفي
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
  merchants:     l => query(collection(db, 'merchants'), limit(l)),
  mreports:      l => query(collection(db, 'merchant_reports'), orderBy('created_at', 'desc'), limit(l)),
  mapps:         l => query(collection(db, 'merchant_applications'), where('status', '==', 'pending'), limit(l)),
  mstatements:   l => query(collection(db, 'merchant_statements'), where('status', '==', 'due'), limit(l)),
};
S.lim = { platforms: 80, mstatements: 50, mapps: 30, merchants: 200, mreports: 30, users: 150, manualCards: 100, manualOrders: 100, orders: 60, deposits: 60, withdrawals: 50, tickets: 50, coupons: 100, sms: 50, services: 150, serviceOrders: 60 };
S.subByKey = {};
/* v34 — مفاتيح D1 (من /api/status): قائمة المتاجر عبر الخادم كل دقيقة بدل الاتصال المباشر */
S.d1 = {};
const d1On = c => !!(S.d1 && S.d1[c]);
async function loadD1Flags() {
  try { const r = await fetch(API_BASE + '/api/status'); const d = await r.json(); kdbCheckMode(d.d1p); const was = JSON.stringify(S.d1); S.d1 = d.d1 || {}; if (was !== JSON.stringify(S.d1)) { if (S.subByKey.merchants) subKeyLim('merchants', S._subLim?.merchants || S.lim.merchants); } } catch {}
}
function d1PollKey(key, l) {
  let stopped = false, last = 0;
  const run = async () => {
    if (stopped || document.visibilityState !== 'visible' || Date.now() - last < 55000) return;
    last = Date.now();
    try { const r = await api('/api/admin/d1/rows', { coll: 'merchants', limit: l }); if (!stopped) { S[key] = r.list || []; render(); } } catch (e) { console.warn(key, e.message); }
  };
  const iv = setInterval(run, 60000);
  const vis = () => { if (document.visibilityState === 'visible') run(); };
  document.addEventListener('visibilitychange', vis);
  setTimeout(run, 0);
  return () => { stopped = true; clearInterval(iv); document.removeEventListener('visibilitychange', vis); };
}
function subKey(key) {
  if (key === 'merchants' && d1On('merchants')) { subKeyLim(key, S.lim[key]); return; }
  if (S.subByKey[key]) { try { S.subByKey[key](); } catch {} }
  S.subByKey[key] = onSnapshot(QUERIES[key](S.lim[key]), s => {
    S[key] = s.docs.map(d => ({ id: d.id, ...d.data() }));
    if (key === 'users') S.users.sort((a, b) => toMs(b.created_at) - toMs(a.created_at));
    render();
  }, err => console.warn(key, err.code));
  S.unsub.push(() => { try { S.subByKey[key](); } catch {} });
}

const QUERY_SEC = { users: ['users'], manualCards: ['cards', 'mcards', 'users'], manualOrders: ['mcards', 'users'], orders: ['orders', 'users'],
  deposits: ['deposits', 'users'], withdrawals: ['withdraw', 'users'], tickets: ['tickets', 'users'], coupons: ['coupons'],
  sms: ['sms'], services: ['services', 'store'], serviceOrders: ['services', 'users'], merchants: ['merchants'], mreports: ['merchants'], mapps: ['merchants'], mstatements: ['merchants'], platforms: ['stickers'] };
// v14 — اشتراكات حسب الصفحة المفتوحة فقط (توفير قراءات Firestore)
const PAGE_KEYS = {
  home: [],   // v51: الرئيسية من ملخص الخادم — بلا اشتراكات
  deposits: ['deposits'], withdraw: ['withdrawals'], sms: ['sms'], mcards: ['manualOrders', 'manualCards'], cards: [],
  orders: ['orders'], services: ['services', 'serviceOrders'], tickets: ['tickets'], coupons: ['coupons'],
  users: [], merchants: [], system: [],   // v51: العملاء بحث من الخادم
};
const HOME_LIM = 12;
function allowedKey(k) { return !QUERY_SEC[k] || QUERY_SEC[k].some(sec => can(sec, 'view')); }
function syncSubs(page) {
  const keys = page === 'money' ? ({ review: ['deposits'], invoices: [], withdraw: ['withdrawals'], sms: ['sms'] }[S.monTab || 'review'] || []) : (PAGE_KEYS[page] || []);
  const want = new Set(keys.filter(allowedKey));
  Object.keys(S.subByKey).forEach(k => { if (!want.has(k) && S.subByKey[k]) { try { S.subByKey[k](); } catch {} delete S.subByKey[k]; } });
  const lim = page === 'home' ? HOME_LIM : null;
  want.forEach(k => { if (!S.subByKey[k] || S._subLim?.[k] !== (lim || S.lim[k])) subKeyLim(k, lim || S.lim[k]); });
}
function subKeyLim(key, l) {
  if (S.subByKey[key]) { try { S.subByKey[key](); } catch {} }
  S._subLim = S._subLim || {}; S._subLim[key] = l;
  if (key === 'merchants' && d1On('merchants')) { S.subByKey[key] = d1PollKey(key, l); return; }
  S.subByKey[key] = onSnapshot(QUERIES[key](l), snap => {
    S[key] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (key === 'users') { S.users.sort((a, b) => toMs(b.created_at) - toMs(a.created_at)); S.users.forEach(u => { S.names[u.id] = u.name || u.email || u.id; }); }
    render();
  }, err => console.warn(key, err.code));
}
// أسماء المستخدمين عند الطلب بدل تحميل كل المستخدمين
S.names = {}; const _nameQ = new Set(); let _nameT = null;
function queueName(uid) {
  if (!uid || S.names[uid] !== undefined || _nameQ.has(uid)) return;
  _nameQ.add(uid);
  clearTimeout(_nameT);
  _nameT = setTimeout(async () => {
    const ids = [..._nameQ]; _nameQ.clear();
    try { const r = await api('/api/admin/names', { uids: ids.slice(0, 40) }); Object.entries(r.names || {}).forEach(([k, v]) => { S.names[k] = v || k; }); }
    catch { ids.forEach(id => { S.names[id] = id; }); }
    render();
  }, 120);
}
function subscribe() {
  loadD1Flags().finally(() => syncSubs(S.page || 'home'));
  if (!S._d1FlagTimer) S._d1FlagTimer = setInterval(() => { if (document.visibilityState === 'visible') loadD1Flags(); }, 300000);
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
  { k: 'home',      t: 'الرئيسية',   i: I.home,   g: 'main' },
  { k: 'money',     t: 'المال',      i: I.cash,   g: 'main', badge: 'money' },
  { k: 'rsc',       t: 'المتجر',     i: I.bag,    g: 'main', badge: 'rscAttn' },
  { k: 'users',     t: 'العملاء',    i: I.users,  g: 'main' },
  { k: 'more',      t: 'المزيد',     i: I.grid,   g: 'main' },
  { k: 'tickets',   t: 'الدعم',      i: I.ticket, g: 'المتجر والعملاء', badge: 'openTic' },
  { k: 'coupons',   t: 'الكوبونات',  i: I.coupon, g: 'المتجر والعملاء' },
  { k: 'mcards',    t: 'طلبات البطاقات', i: I.card, g: 'البطاقات', badge: 'pendMc' },
  { k: 'cards',     t: 'البطاقات المُصدرة', i: I.card, g: 'البطاقات' },
  { k: 'analytics', t: 'تحليل الزوار', i: I.chart, g: 'المتجر والعملاء' },
  { k: 'methods',   t: 'طرق الدفع',  i: I.cash,   g: 'الإعدادات' },
  { k: 'howto',     t: 'كيف أدفع؟',  i: I.help,   g: 'الإعدادات' },
  { k: 'reviews',   t: 'آراء العملاء', i: I.chart, g: 'المتجر والعملاء' },
  { k: 'contact',   t: 'التواصل والأسئلة', i: I.help, g: 'الإعدادات' },
  { k: 'sections',  t: 'أقسام الموقع', i: I.grid, g: 'الإعدادات' },
  { k: 'settings',  t: 'الإعدادات',  i: I.gear,   g: 'الإعدادات' },
  { k: 'system',    t: 'الموظفين والنظام', i: I.users, g: 'الإعدادات' },
  { k: 'orders',    t: 'طلبات المتجر القديم', i: I.orders, g: 'أرشيف', hide: true },
  { k: 'services',  t: 'الخدمات القديمة', i: I.grid, g: 'أرشيف', hide: true },
  { k: 'store',     t: 'المتجر القديم', i: I.box, g: 'أرشيف', hide: true },
  { k: 'deposits',  t: 'الإيداعات',  i: I.cash,   g: 'hidden', hide: true },
  { k: 'withdraw',  t: 'السحوبات',   i: I.withdraw, g: 'hidden', hide: true },
  { k: 'sms',       t: 'الرسائل',    i: I.sms,    g: 'hidden', hide: true },
  { k: 'platforms', t: 'منصات الاستخدام', i: I.grid, g: 'hidden', hide: true },
  { k: 'stickers',  t: 'الملصقات',   i: I.box,    g: 'hidden', hide: true },
];

const DOCK_ALL = ['home', 'money', 'rsc', 'users', 'more'];

/* ─── الصلاحيات المفصّلة (قسم × إجراء) ─── */
const PERM_SECTIONS = {
  deposits: { t: 'الإيداعات', a: ['view', 'approve'] },
  withdraw: { t: 'السحوبات', a: ['view', 'approve'] },
  sms:      { t: 'رسائل التحويل', a: ['view', 'approve'] },
  mcards:   { t: 'طلبات البطاقات', a: ['view', 'approve'] },
  cards:    { t: 'البطاقات المُصدرة', a: ['view', 'edit'] },
  orders:   { t: 'طلبات المتجر', a: ['view', 'approve'] },
  store:    { t: 'إدارة المتجر', a: ['view', 'add', 'edit', 'delete'] },
  services: { t: 'الخدمات (القديمة)', a: ['view', 'add', 'edit', 'delete', 'approve'] },
  users:    { t: 'المستخدمون', a: ['view', 'wallet', 'plan', 'ban'] },
  tickets:  { t: 'التذاكر', a: ['view', 'reply', 'close'] },
  coupons:  { t: 'الكوبونات', a: ['view', 'add', 'edit', 'delete'] },
  stickers: { t: 'الملصقات', a: ['view', 'edit'] },
  merchants: { t: 'المتاجر الموثوقة', a: ['view', 'add', 'edit'] },
};
const ACTION_AR = { view: 'عرض', add: 'إضافة', edit: 'تعديل', delete: 'حذف', approve: 'اعتماد وتنفيذ',
  wallet: 'تعديل الرصيد', plan: 'تغيير الباقة', ban: 'إيقاف الحساب', reply: 'الرد', close: 'إغلاق' };
const ROLE_DEFAULT_PERMS = {
  finance: { deposits: ['view', 'approve'], withdraw: ['view', 'approve'], sms: ['view', 'approve'], users: ['view', 'wallet', 'plan'], coupons: ['view', 'add', 'edit', 'delete'] },
  support: { tickets: ['view', 'reply', 'close'], users: ['view', 'ban'] },
  ops: { mcards: ['view', 'approve'], cards: ['view', 'edit'], orders: ['view', 'approve'], store: ['view', 'add', 'edit', 'delete'], services: ['view', 'add', 'edit', 'delete', 'approve'], users: ['view'] },
};
const PAGE_SEC = { rsc: 'store', platforms: 'stickers', mview: 'merchants', mcards: 'mcards', cards: 'cards', orders: 'orders', services: 'services', store: 'store', deposits: 'deposits',
  withdraw: 'withdraw', sms: 'sms', tickets: 'tickets', coupons: 'coupons', users: 'users', stickers: 'stickers', merchants: 'merchants', settings: '__super', system: '__super', methods: '__super', analytics: 'users', howto: '__super', reviews: 'users', contact: '__super', sections: '__super' };
function isSuperAdmin() { return S.admin && S.admin.role === 'super_admin'; }
function myPerms() { const a = S.admin || {}; return (a.perms && typeof a.perms === 'object') ? a.perms : (ROLE_DEFAULT_PERMS[a.role] || {}); }
function can(sec, act) { if (isSuperAdmin()) return true; if (sec === '__super') return false; return (myPerms()[sec] || []).includes(act); }
function pageAllowed(k) { if (k === 'money') return ['deposits', 'withdraw', 'sms'].some(x => can(x, 'view')); const sec = PAGE_SEC[k]; return !sec || can(sec, 'view'); }
const visiblePages = () => PAGES.filter(p => pageAllowed(p.k) && !p.hide);
let DOCK = DOCK_ALL;

// إخفاء أزرار الإجراءات غير المسموحة (الخادم يرفضها أصلًا)
const PERM_UI = {
  'deposits.approve': ['#dOk', '#dNo', '[data-pvok]'],
  'withdraw.approve': ['[data-wd-ok]', '[data-wd-no]'],
  'sms.approve': ['[data-sasg]'],
  'mcards.approve': ['#fGo', '#fRej', '#rjGo'],
  'orders.approve': ['[data-ord-ok]', '[data-ord-no]'],
  'services.approve': ['[data-svc-deliver]', '[data-svc-reject]', '#svcDeliverGo', '#svcRejectGo'],
  'services.add': ['#addSvc', '#addStockBtn'],
  'services.edit': ['[data-edit-svc]'],
  'services.delete': ['[data-del-svc]', '[data-del-stock]', '#sDel'],
  'store.add': ['#addCat', '#addProd', '#stAdd'],
  'store.edit': ['[data-ecat]', '[data-eprod]'],
  'store.delete': ['[data-dcat]', '[data-dprod]', '[data-dstk]'],
  'coupons.add': ['#addCoup'], 'coupons.edit': ['[data-ecoup]'], 'coupons.delete': ['#cDel'],
  'users.wallet': ['#uAdj'], 'users.ban': ['#uBan'], 'users.plan': ['#upGo'],
  'tickets.reply': ['#tSend', '#tRep'], 'tickets.close': ['#tClose'],
  'cards.edit': ['[data-cbal]'], 'stickers.edit': ['#plAdd', '[data-pledit]', '[data-pldel]', '[data-stk-up]', '[data-stk-clear]'],
  'merchants.add': ['#mcAdd'], 'merchants.edit': ['#mcBillAll', '[data-mcedit]', '[data-mcsub]', '[data-mcstat]', '[data-rpok]', '[data-mcpromo]', '[data-stpay]'],
};
function applyPermUI(root = document) {
  if (isSuperAdmin()) return;
  for (const [perm, sels] of Object.entries(PERM_UI)) {
    const [sec, act] = perm.split('.');
    if (can(sec, act)) continue;
    sels.forEach(sel => root.querySelectorAll(sel).forEach(el => { el.style.display = 'none'; el.disabled = true; }));
  }
}
new MutationObserver(() => { clearTimeout(applyPermUI._t); applyPermUI._t = setTimeout(() => applyPermUI(), 30); })
  .observe(document.documentElement, { childList: true, subtree: true });

const pendMc = () => S.manualOrders.filter(o => o.status === 'pending').length;
const pendOrd = () => S.orders.filter(o => o.status === 'pending').length;
const pendSvc = () => S.serviceOrders.filter(o => o.status === 'pending').length;
const pendDep = () => S.deposits.filter(d => d.status === 'pending').length;
const pendWd = () => S.withdrawals.filter(w => w.status === 'pending').length;
const openTic = () => S.tickets.filter(t => t.status === 'open').length;

const openReports = () => (S.mreports || []).filter(r => r.status === 'open').length + (S.mapps || []).length;
const BADGES = { pendMc: () => S.ov ? ovA('mcards') : pendMc(), pendOrd, pendSvc, pendDep, pendWd, openTic: () => S.ov ? ovA('tickets') : openTic(), openReports, money: () => moneyBadge(), rscAttn: () => ovA('rsc') };

function buildNav() {
  DOCK = DOCK_ALL.filter(k => k === 'more' || pageAllowed(k));
  const vis = visiblePages();
  const item = p => { const c = p.badge && BADGES[p.badge] ? BADGES[p.badge]() : 0;
    return `<button class="admin-nav-item" data-nav="${esc(p.k)}">${svg(p.i)}<span>${esc(p.t)}</span>${c ? `<span class="admin-badge">${c}</span>` : ''}</button>`; };
  const groups = {};
  vis.filter(p => p.g !== 'main').forEach(p => { (groups[p.g] = groups[p.g] || []).push(p); });
  let rail = `<div class="admin-group">${vis.filter(p => p.g === 'main' && p.k !== 'more').map(item).join('')}</div>`;
  for (const [g, items] of Object.entries(groups)) rail += `<span class="admin-group-label">${esc(g)}</span><div class="admin-group">${items.map(item).join('')}</div>`;
  setHTML('#navDesk', rail);
  const dk = DOCK.map(k => PAGES.find(p => p.k === k)).filter(Boolean);
  const dockEl = $('#navDock');
  if (dockEl) {
    dockEl.style.gridTemplateColumns = `repeat(${dk.length}, 1fr)`;
    dockEl.innerHTML = dk.map(p => { const c = p.badge && BADGES[p.badge] ? BADGES[p.badge]() : 0;
      return `<button class="admin-dock-item" data-nav="${esc(p.k)}">${c ? `<span class="dot">${c > 99 ? '99+' : c}</span>` : ''}${svg(p.i)}<span>${esc(p.t)}</span></button>`; }).join('');
  }
  const cur = S.page;
  document.querySelectorAll('#navDesk [data-nav], #navDock [data-nav]').forEach(b => {
    b.onclick = () => go(b.dataset.nav);
    b.classList.toggle('active', b.dataset.nav === cur || (b.dataset.nav === 'more' && !DOCK.includes(cur) && cur !== 'home'));
  });
}

function openMoreMenu() {
  const groups = {};
  visiblePages().forEach(p => { (groups[p.g] = groups[p.g] || []).push(p); });
  modal(`
    <div class="modal-head"><div class="modal-title">كل الأقسام</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    ${Object.entries(groups).map(([g, items]) => `
      <div class="more-group">${esc(g)}</div>
      <div class="more-grid">${items.map(p => {
        const c = p.badge ? BADGES[p.badge]() : 0;
        return `<button class="ql" data-go="${esc(p.k)}" style="position:relative"><span class="ql-ic">${svg(p.i)}</span><span>${esc(p.t)}</span>
          ${c ? `<span class="admin-badge" style="position:absolute;top:6px;left:6px">${c}</span>` : ''}</button>`;
      }).join('')}</div>`).join('')}
  `);
  document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { closeModal(); go(b.dataset.go); });
}

window.go = k => {
  if (k === 'merchants' || k === 'mview') k = 'home';
  if (k === 'deposits' || k === 'withdraw' || k === 'sms') { S.monTab = k === 'deposits' ? 'review' : k; k = 'money'; }
  if (k === 'users' && S.page !== 'users') S.uFile = null;
  if (k === 'home' || k === 'money') loadOverview();
  if (!pageAllowed(k)) { toast('لا تملك صلاحية هذا القسم', 'bad'); k = 'home'; }
  if (S.unsub && S.admin) syncSubs(k);
  S._dirty = false;
  if (k === 'stickers') loadStickers();
  if (k === 'platforms') loadPlatforms();
  if (k === 'store') loadStore();
  if (k === 'rsc') loadRscA();
  if (k === 'system') { loadStaff(); loadD1Status(); }
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
    home: vHome2,
    money: vMoney,
    more: vMore,
    methods: vMethods,
    analytics: vAnalytics,
    howto: vHowtoA,
    reviews: vReviewsA,
    contact: vContactA,
    sections: vSections,
    rsc: vRsc,
    mcards: vMcardOrders,
    cards: vCards2,
    orders: vShopOrders,
    services: vServices,
    store: vStore,
    stickers: vStickers,
    merchants: vMerchants,
    platforms: vPlatforms,
    mview: vMview,
    system: vSystem,
    deposits: vDeposits,
    withdraw: vWithdraw,
    tickets: vTickets,
    coupons: vCoupons,
    users: vUsers2,
    sms: vSms,
    settings: vSettings,
  };
  const html = (views[S.page] || vHome)() + moreBtn();
  const same = _lastPage === S.page;
  if (same && !force && html === _lastHtml) return;                     // لا تغيير → لا رمشة
  const view = $('#view'), ae = document.activeElement;
  if (same && !force && view && ae && view.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) {
    if (!_deferred) { _deferred = true; ae.addEventListener('blur', () => { _deferred = false; setTimeout(() => render(), 0); }, { once: true }); }
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
  if (!uid) return '—';
  const u = (S.users || []).find(x => x.id === uid);
  if (u) return u.name || u.email || uid;
  if (S.names[uid] !== undefined) return S.names[uid];
  queueName(uid);
  return '…';
};

/* ═══ Home ═══ */
function vHome() {
  const DAY = 86400000, now = Date.now();
  const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const today0 = dayStart(now);
  const sales = [
    ...S.orders.filter(o => o.status === 'completed').map(o => [toMs(o.created_at), n(o.total_usd)]),
    ...S.manualOrders.filter(o => o.status === 'completed').map(o => [toMs(o.created_at), n(o.total)]),
    ...S.serviceOrders.filter(o => o.status === 'delivered').map(o => [toMs(o.created_at), n(o.price_usd)]),
  ];
  const days = [...Array(7)].map((_, k) => today0 - (6 - k) * DAY);
  const perDay = days.map(d0 => sales.filter(([t]) => t >= d0 && t < d0 + DAY).reduce((a, [, v]) => a + v, 0));
  const todayRev = perDay[6], yRev = perDay[5];
  const trend = yRev ? Math.round((todayRev - yRev) / yRev * 100) : 0;
  const pendDepList = S.deposits.filter(d => d.status === 'pending');
  const newUsers = (S.users || []).length ? S.users.filter(u => toMs(u.created_at) >= today0).length : '—';
  const custBal = (S.users || []).reduce((a, u) => a + n(u.wallet_balance), 0);

  const max = Math.max(1, ...perDay), W = 600, H = 160, P = 10;
  const pts = perDay.map((v, k) => [P + k * (W - 2 * P) / 6, H - P - (v / max) * (H - 3 * P)]);
  const path = pts.map((p, k) => (k ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = path + ` L ${pts[6][0]} ${H} L ${pts[0][0]} ${H} Z`;

  const K = (ico, label, val, sub, nav) => `
    <div class="kpi2" ${nav ? `data-nav="${nav}" style="cursor:pointer"` : ''}>
      <div class="kpi2-top"><span>${label}</span>${svg(ico)}</div>
      <div class="kpi2-val">${val}</div>${sub ? `<span class="kpi2-sub">${sub}</span>` : ''}
    </div>`;
  const oldest = arr => arr.length ? Math.round((now - Math.min(...arr.map(x => toMs(x.created_at) || now))) / 60000) : 0;
  const ago = m => m < 60 ? `أقدمها منذ ${m} د` : m < 1440 ? `أقدمها منذ ${Math.round(m / 60)} س` : `أقدمها منذ ${Math.round(m / 1440)} يوم`;
  const needs = [
    [I.cash, 'إيداعات بانتظار المراجعة', pendDepList, 'deposits'],
    [I.card, 'طلبات بطاقات معلّقة', S.manualOrders.filter(o => o.status === 'pending'), 'mcards'],
    [I.bag, 'طلبات متجر معلّقة', S.orders.filter(o => o.status === 'pending' || o.status === 'processing'), 'orders'],
    [I.grid, 'طلبات خدمات معلّقة', S.serviceOrders.filter(o => o.status === 'pending'), 'services'],
    [I.sms, 'رسائل تحتاج ربطًا', S.sms.filter(x => x.status !== 'claimed' && x.amount_lyd), 'sms'],
    [I.clock, 'سحوبات معلّقة', S.withdrawals.filter(w => w.status === 'pending'), 'withdraw'],
  ].filter(x => x[2].length);

  return `
  <div class="page-enter">
    <div class="flex-between mb-4">
      <h1 class="h2" style="margin:0;font-family:var(--font-display)">الرئيسية</h1>
      ${pushOn() ? '' : '<button class="btn btn-secondary btn-sm" id="pushOnA" type="button">🔔 تفعيل إشعارات الهاتف</button>'}
      <span class="caption">${esc(new Date().toLocaleDateString('ar-LY', { weekday: 'long', day: 'numeric', month: 'long' }))}</span>
    </div>

    ${maintCard()}
    ${S.settings.kill_switch === true ? `
      <div class="alert alert-error mb-4">${svg(I.warn, 2)}
        <div><strong>المنصة متوقفة الآن</strong> — العملاء لا يستطيعون الشراء.
        <button style="color:inherit;font-weight:700;text-decoration:underline;background:none;border:none;cursor:pointer" data-act="go" data-page="settings">إلغاء الإيقاف</button></div>
      </div>` : ''}

    ${can('users', 'view') ? `<div class="card mb-4"><div class="flex-between"><div class="h4" style="font-size:13px;margin:0">📊 قراءات Firebase اليوم (تقديري)</div>
      <button class="btn btn-ghost btn-sm" id="usageGo" type="button">${S.usage ? 'تحديث' : 'عرض'}</button></div>
      ${S.usage ? `<div style="margin-top:8px"><div class="flex-between caption"><span>قراءات الخادم: <b class="tabular" style="color:var(--text)">${Number(S.usage.reads).toLocaleString('en')}</b> من حد التوفير ${Number(S.usage.save_at).toLocaleString('en')}</span>
        <span style="color:${S.usage.saving ? 'var(--warning)' : 'var(--success)'}">${S.usage.quota_hit ? '🔴 الحصة نفدت' : S.usage.saving ? '🟡 وضع التوفير' : '🟢 طبيعي'}</span></div>
        <div style="height:6px;border-radius:4px;background:var(--surface-3);overflow:hidden;margin-top:6px"><div style="height:100%;width:${Math.min(100, Math.round(100 * S.usage.reads / Math.max(1, S.usage.save_at)))}%;background:${S.usage.saving ? 'var(--warning)' : 'var(--sand)'}"></div></div>
        <div class="caption" style="margin-top:6px">الرقم الحقيقي في Firebase ← Usage أعلى قليلًا (شاشات المتصفح لا تُحسب هنا). الحد المجاني 50,000.</div></div>` : ''}</div>` : ''}

    ${can('users', 'view') ? `<div class="card mb-4" id="funnelCard"><div class="flex-between"><div class="h4" style="font-size:13px;margin:0">📈 قمع التحويل</div>
      <button class="btn btn-ghost btn-sm" id="funnelGo" type="button">${S.funnel ? 'تحديث' : 'عرض'}</button></div>
      ${S.funnel ? (() => { const f = S.funnel; const rows = [['سجّلوا', f.users, `آخر 30 يومًا: ${f.users30}`], ['أكّدوا البريد', f.emailOk], ['وثّقوا الرقم', f.phoneOk], ['عمليات إيداع', f.deposited], ['طلبوا بطاقة', f.cardOrders], ['بطاقات صدرت', f.cardsDone]];
        const top = Math.max(1, f.users || 1);
        return `<div style="margin-top:10px">${rows.map(([t, v, sub]) => `<div style="margin-bottom:8px"><div class="flex-between caption"><span>${t}${sub ? ` · ${sub}` : ''}</span><b class="tabular" style="color:var(--text)">${Number(v || 0)}</b></div>
          <div style="height:6px;border-radius:4px;background:var(--surface-3);overflow:hidden"><div style="height:100%;width:${Math.min(100, Math.round(100 * Number(v || 0) / top))}%;background:var(--sand)"></div></div></div>`).join('')}</div>
          <div class="caption">أكبر فجوة بين خطوتين = أين يضيع زبائنك.</div>`; })() : '<div class="caption" style="margin-top:6px">زوار ← تسجيل ← توثيق ← إيداع ← بطاقة</div>'}</div>` : ''}

    <div class="kpi2-grid">
      ${K(I.cash, 'مبيعات اليوم', usd(todayRev), trend ? (trend > 0 ? '↑ ' : '↓ ') + Math.abs(trend) + '%' : '', '')}
      ${K(I.cash, 'إيداعات معلّقة', pendDepList.length, pendDepList.length ? usd(pendDepList.reduce((a, d) => a + n(d.amount_usd), 0)) : '', 'deposits')}
      ${K(I.card, 'طلبات بطاقات', S.manualOrders.filter(o => o.status === 'pending').length, 'معلّقة', 'mcards')}
      ${K(I.bag, 'طلبات المتجر', S.orders.filter(o => o.status === 'pending').length, 'معلّقة', 'orders')}
      ${K(I.users, 'عملاء جدد', newUsers, (S.users || []).length ? 'اليوم' : 'افتح المستخدمين', 'users')}
      ${K(I.cash, 'أرصدة العملاء', usd(custBal), 'إجمالي', '')}
    </div>

    <div class="admin-home-grid mb-5">
      <div class="card chart-card">
        <div class="flex-between mb-2"><div class="h4" style="font-size:13px">المبيعات — آخر 7 أيام</div>
          <span class="tabular" style="font-weight:800;color:var(--brand)">${esc(usd(perDay.reduce((a, b) => a + b, 0)))}</span></div>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d4a574" stop-opacity=".35"/><stop offset="1" stop-color="#d4a574" stop-opacity="0"/></linearGradient></defs>
          <path d="${area}" fill="url(#gA)"/><path d="${path}" fill="none" stroke="#d4a574" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
          ${pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="#0b0d0d" stroke="#d4a574" stroke-width="2"/>`).join('')}
        </svg>
        <div class="flex-between caption" style="margin-top:4px">${days.map(d => `<span>${new Date(d).getDate()}/${new Date(d).getMonth() + 1}</span>`).join('')}</div>
      </div>

      <div class="card">
        <div class="h4 mb-2" style="font-size:13px">يحتاج إجراء الآن</div>
        ${needs.length ? needs.map(([ico, t, arr, nav]) => `
          <div class="need-row" data-nav="${nav}">
            <span class="need-ico">${svg(ico)}</span>
            <div><div class="body-sm" style="font-weight:700">${t}</div><div class="caption">${ago(oldest(arr))}</div></div>
            <span class="need-n">${arr.length}</span>
          </div>`).join('') : '<p class="caption" style="padding:18px 0;text-align:center">كل شيء منجز ✓</p>'}
      </div>

      <div class="card">
        <div class="h4 mb-2" style="font-size:13px">إجراءات سريعة</div>
        <div style="display:grid;gap:8px">
          <button class="btn btn-secondary" style="justify-content:flex-start" data-nav="mcards">${svg(I.card)} إصدار بطاقة</button>
          <button class="btn btn-secondary" style="justify-content:flex-start" data-nav="store">${svg(I.box)} إضافة منتج</button>
          <button class="btn btn-secondary" style="justify-content:flex-start" data-nav="deposits">${svg(I.cash)} مراجعة الإيداعات</button>
          <button class="btn btn-secondary" style="justify-content:flex-start" data-nav="users">${svg(I.users)} العملاء</button>
        </div>
      </div>
    </div>
  </div>`;
}

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

    <div class="card card-sm mb-3">
      <div class="body-sm" style="font-weight:700;margin-bottom:8px">⚙️ تحكم سريع (يُطبَّق فورًا)</div>
      ${[['mc_maint_on', '🛠️ قسم البطاقات قيد الصيانة', 'يوقف الإصدار والتعبئة ويظهر للعملاء تنبيه الصيانة'],
         ['mc_topup_on', '↻ إعادة التعبئة متاحة', 'عند الإيقاف يظهر للعميل «غير متاحة حاليًا»']].map(([k, t, d]) => {
        const on = (S.settings || {})[k] === true;
        return `<div class="flex-between" style="padding:8px 0;gap:10px">
          <div><div class="body-sm" style="font-weight:600">${t}</div><div class="caption">${d}</div></div>
          <button class="btn btn-sm ${on ? 'btn-primary' : 'btn-secondary'}" data-mcq="${k}" style="min-width:74px">${on ? 'مفعّل' : 'متوقف'}</button>
        </div>`;
      }).join('')}
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
        <label class="field-label">📍 عنوان البطاقة — Billing Address (اختياري)</label>
        <textarea class="input" id="fAddr" dir="ltr" rows="3" maxlength="300" placeholder="Street, City, State ZIP, Country" style="height:auto;padding-top:10px"></textarea>
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
      payload.billing_address = $('#fAddr').value;
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
              <th>الرصيد المتبقي</th>
              <th>الحالة</th>
              <th>التاريخ</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(c => `
              <tr>
                <td>${esc(userName(c.uid))}</td>
                <td>${esc(c.card_name || '—')}</td>
                <td class="mono" style="color:var(--sand)">••${esc(c.last4 || '')}</td>
                <td class="tabular" style="font-weight:700;color:var(--sand)">${esc(usd(c.balance))}
                  <div class="caption" style="font-weight:400">${c.balance_updated_at ? 'حُدّث ' + esc(dt(c.balance_updated_at)) : 'لم يُحدَّث'}</div></td>
                <td><span class="badge ${c.status === 'active' ? 'badge-success' : 'badge-neutral'}">${c.status === 'active' ? 'نشطة' : 'مجمدة'}</span></td>
                <td class="caption">${esc(dt(c.created_at))}</td>
                <td style="white-space:nowrap"><button class="btn btn-secondary btn-sm" data-cbal="${esc(c.id)}">الرصيد والعنوان</button>
                  <button class="btn btn-secondary btn-sm" data-crep="${esc(c.id)}">تغيير البطاقة</button></td>
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

function ufCard() {
  return `    <div class="card mb-3">
      <div class="h4" style="margin-bottom:4px">لمن هذا التحويل؟ (USDT)</div>
      <p class="caption" style="margin-bottom:10px">اكتب المبلغ اللي وصلك بالضبط (مثل 35.0769) أو رقم المعاملة TxID</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input class="input" id="ufAmt" inputmode="decimal" dir="ltr" placeholder="35.0769" style="flex:1;min-width:120px" value="${esc(S.uf ? S.uf.amount : '')}">
        <input class="input" id="ufTx" dir="ltr" placeholder="TxID (اختياري)" style="flex:2;min-width:160px" value="${esc(S.uf ? S.uf.txid : '')}">
        <button class="btn btn-primary btn-sm" id="ufGo" type="button">بحث</button>
      </div>
      ${S.uf && S.uf.res ? ufResults(S.uf.res) : ''}
    </div>

`;
}
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
      ${d.reference ? `<div class="flex-between" style="padding:3px 0"><span class="caption">رقم العملية</span><span class="mono body-sm" dir="ltr" style="font-size:11px">${esc(d.reference)}</span></div>` : ''}
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

    ${d.status === 'pending' ? `<div class="field mb-2"><label class="field-label" for="dAmt">المبلغ المعتمد ($) — كما يظهر في الإيصال</label>
      <input class="input" id="dAmt" type="number" step="0.01" min="0.01" dir="ltr" value="${esc(String(d.amount_usd || ''))}">
      <div class="caption">طلب الزبون ${esc(usd(d.amount_usd))} — عدّله إذا كان الإيصال بمبلغ أقل</div></div>` : ''}
    <button class="btn btn-primary btn-block" id="dOk">قبول وإضافة الرصيد</button>
    <button class="btn btn-outline-danger btn-block" style="margin-top:6px" id="dNo">رفض</button>
  `);

  onTap('#dOk', async () => {
    const btn = $('#dOk');
    btn.disabled = true;
    btn.classList.add('loading');
    try {
      const ap = Number(($('#dAmt') || {}).value || 0);
      if (!(ap > 0)) { toast('أدخل المبلغ المعتمد', 'bad'); return; }
      if (ap < Number(d.amount_usd) - 0.001 && !confirm(`ستعتمد ${usd(ap)} بدل ${usd(d.amount_usd)} — متأكد؟`)) return;
      await api('/api/admin/deposit', { deposit_id: id, action: 'approve', approved_usd: ap });
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
    ((u.name || '') + ' ' + (u.email || '') + ' ' + (u.phone || '') + ' 0' + (u.phone_verified || '') + ' ' + u.id).toLowerCase().includes(S.q.toLowerCase()));

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
                <td class="mono caption" dir="ltr" style="font-size:10px">${u.phone_verified ? '0' + esc(u.phone_verified) + ' ✓' : esc(u.phone || '—')}</td>
                <td class="tabular" style="font-weight:600;color:var(--sand)">${esc(usd(u.wallet_balance))}</td>
                <td>${['basic', 'premium', 'vip'].includes(u.plan) && Number(u.plan_expires_ms || 0) > Date.now() ? `<span class="badge">${esc(PLAN_AR[u.plan])}</span>` : '<span class="caption">عادي</span>'}</td>
                <td>${u.banned ? '<span class="badge badge-error">موقوف</span>' : '<span class="badge badge-success">نشط</span>'}</td>
                <td class="caption">${esc(dt(u.created_at))}</td>
                <td style="white-space:nowrap"><button class="btn btn-primary btn-sm" data-ufile="${esc(u.id)}">الملف</button>
                  <button class="btn btn-secondary btn-sm" data-user="${esc(u.id)}">إدارة</button></td>
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

const PLAN_AR = { free: 'العادي', basic: 'الأساسي', premium: 'بريميوم', vip: 'VIP' };

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
  $('#pImg').onchange = async e => { try { image = await compressImg(e.target.files[0], 900, 0.8, 145000); toast('أُرفقت الصورة', 'ok'); } catch (err) { toast(err.message, 'bad'); } };
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
  const modeSel = (k, lbl) => `
    <div class="field" style="grid-template-columns:1fr 150px;align-items:center">
      <div><div class="sw-lbl">${lbl}</div><div class="sw-desc">تلقائي = يُضاف فور وصول الرسالة · يدوي = تعتمده بنفسك</div></div>
      <select class="input" data-op="m_${k}_mode">
        <option value="" ${!s['m_' + k + '_mode'] ? 'selected' : ''}>حسب الوضع العام</option>
        <option value="auto" ${s['m_' + k + '_mode'] === 'auto' ? 'selected' : ''}>تلقائي</option>
        <option value="manual" ${s['m_' + k + '_mode'] === 'manual' ? 'selected' : ''}>يدوي</option>
      </select></div>`;
  const rcpt = (k, lbl) => `
    <div class="sw-row"><div><div class="sw-lbl">${lbl}: يتطلب صورة إيصال</div>
      <div class="sw-desc">عند الإيقاف يكفي أن يكتب العميل رقم العملية</div></div>
      <div class="sw ${s['m_' + k + '_receipt'] !== false ? 'on' : ''}" data-op="m_${k}_receipt"></div></div>`;
  return `
  <div class="card mb-4">
    <div class="h4" style="margin-bottom:10px;font-size:13px">طريقة عمل كل وسيلة دفع</div>
    <div class="field" style="grid-template-columns:1fr 150px;align-items:center">
      <div><div class="sw-lbl">الوضع العام (ليبيانا والمدار)</div><div class="sw-desc">يُطبَّق على أي وسيلة مضبوطة على «حسب الوضع العام»</div></div>
      <select class="input" data-op="deposit_mode">
        <option value="auto" ${s.deposit_mode !== 'manual' ? 'selected' : ''}>تلقائي</option>
        <option value="manual" ${s.deposit_mode === 'manual' ? 'selected' : ''}>يدوي</option></select></div>
    ${modeSel('libyana', 'ليبيانا')}
    ${modeSel('almadar', 'المدار')}
    ${rcpt('bank', 'التحويل المصرفي')}
    ${rcpt('binance', 'Binance Pay')}
    <div class="sw-row"><div><div class="sw-lbl">إلزام تأكيد البريد</div>
      <div class="sw-desc">للبطاقات والسحب والتحويل (يعمل فقط إذا كان البريد مُعدًّا)</div></div>
      <div class="sw ${s.require_email_verify !== false ? 'on' : ''}" data-op="require_email_verify"></div></div>
    <p class="caption" style="margin-top:8px">USDT تلقائي دائمًا. الطرق المخصصة تتطلب إيصالًا افتراضيًا.</p>
  </div>`;
}

function settingsPlans(s) {
  const row = (k, lbl, hint) => `<div class="field" style="grid-template-columns:1fr 100px"><div><div class="sw-lbl">${lbl}</div>${hint ? `<div class="sw-desc">${hint}</div>` : ''}</div>
    <input class="input" data-op="${k}" type="number" min="0" value="${esc(String(s[k] ?? ''))}"></div>`;
  const tier = (k, title) => `
    <div class="card mb-3" style="background:var(--surface-2)">
      <div class="h4 mb-2" style="font-size:13px">${title}</div>
      ${row(`plan_${k}_cards`, 'بطاقات إضافية في الشهر', 'فوق البطاقة المجانية — 0 = بلا حدود')}
      ${row(`plan_${k}_price`, 'السعر ($)')}
      ${row(`plan_${k}_days`, 'المدة (يوم)')}
    </div>`;
  return `
  <div class="card mb-4">
    <div class="h4" style="margin-bottom:12px;font-size:13px">الباقات</div>
    <div class="sw-row"><div><div class="sw-lbl">تفعيل الباقات</div><div class="sw-desc">السماح بالاشتراك من التطبيق</div></div>
      <div class="sw ${s.plans_enabled !== false ? 'on' : ''}" data-op="plans_enabled"></div></div>
    ${row('plan_free_cards', 'البطاقات المجانية للجميع', 'لا تُقفل أبدًا — والبطاقات الإضافية تُقفل عند انتهاء الباقة')}
    ${tier('basic', 'الأساسي')}
    ${tier('premium', 'بريميوم')}
    ${tier('vip', 'VIP')}
  </div>
  <button class="btn btn-primary" data-save="ops">حفظ</button>`;
}

function userPlanBlock(u) {
  const cur = ['basic', 'premium', 'vip'].includes(u.plan) && Number(u.plan_expires_ms || 0) > Date.now() ? u.plan : 'free';
  return `
    <div class="card mb-3" style="background:var(--surface-2)">
      <div class="flex-between mb-2"><span class="sw-lbl">الباقة</span><span class="badge">${esc(PLAN_AR[cur])}${cur !== 'free' ? ' · حتى ' + esc(dt(new Date(u.plan_expires_ms).toISOString())) : ''}</span></div>
      <div class="grid-3" style="gap:6px">
        <select class="input" id="upPlan"><option value="free">العادي</option><option value="basic">الأساسي</option><option value="premium">بريميوم</option><option value="vip">VIP</option></select>
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

const ROLE_AR2 = { super_admin: 'مسؤول رئيسي', staff: 'موظف', finance: 'مالية', support: 'دعم', ops: 'عمليات' };

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
        <div class="caption">${a.role === 'staff' ? 'موظف · ' + Object.keys(a.perms || {}).map(k => (PERM_SECTIONS[k] || {}).t || k).join('، ') : esc(ROLE_AR2[a.role] || 'بلا دور')}${a.id === S.admin.uid ? ' · أنت' : ''}</div></div>
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

    <div class="card mb-4" id="d1Card">
      <div class="flex-between mb-2"><div class="h4" style="font-size:13px;margin:0">قاعدة D1 — النقل إلى Cloudflare</div>
        <button class="btn btn-ghost btn-sm" id="d1Load" type="button">${S.d1s ? 'تحديث' : 'عرض'}</button></div>
      ${vD1Body()}
    </div>

    <div class="card mb-4">
      <div class="h4 mb-2" style="font-size:13px">النسخ الاحتياطي</div>
      <p class="caption mb-2">ينزّل كل بيانات المنصة في ملف واحد على جهازك. احفظه في Google Drive أسبوعيًا. البيانات الحساسة تبقى مشفّرة داخله.</p>
      <button class="btn btn-primary btn-sm" id="bkGo">${svg(I.down || I.box)} تنزيل نسخة احتياطية</button>
    </div>

    <div class="card mb-4">
      <div class="h4 mb-2" style="font-size:13px">البريد الإلكتروني</div>
      <p class="caption mb-2">يتطلب RESEND_API_KEY و MAIL_FROM في متغيرات الـ Worker.</p>
      <button class="btn btn-secondary btn-sm" id="mailTest">إرسال بريد تجريبي لي</button>
    </div>
  </div>`;
}

/* v34 — اختبار اتصال طرق الإيداع الرقمي (لا يعرض أي مفتاح) */
const ctestBtn = n => `<div style="display:flex;gap:8px;align-items:flex-start;margin-top:6px"><button class="btn btn-ghost btn-sm" data-ctest="${n}" type="button">اختبار الاتصال</button><div id="ctOut_${n}" class="caption" style="flex:1"></div></div>`;
async function runCryptoTest(b) {
  const n = b.dataset.ctest, out = document.getElementById('ctOut_' + n);
  if (S._dirty) { toast('احفظ التعديلات أولًا — الاختبار يفحص المحفوظ', 'bad'); return; }
  b.disabled = true; b.classList.add('loading'); if (out) out.textContent = 'جارٍ الاختبار…';
  try {
    const r = await api('/api/admin/crypto/test', { network: n });
    if (out) out.innerHTML = `<div style="font-weight:700;color:${r.ok ? 'var(--success)' : 'var(--danger, #e5484d)'}">${r.ok ? 'يعمل ✓' : 'يحتاج إصلاح ✗'}</div>` +
      r.lines.map(l => `<div>${l.ok === true ? '✅' : l.ok === false ? '❌' : 'ℹ️'} ${esc(l.text)}</div>`).join('');
  } catch (e) { if (out) out.innerHTML = `<div style="color:var(--danger, #e5484d)">✗ ${esc(e.message)}</div>`; }
  b.disabled = false; b.classList.remove('loading');
}

const D1_STATE_AR = { pending: 'لم يبدأ', copying: 'جارٍ النسخ', verify: 'جارٍ المطابقة', repair: 'جارٍ الإصلاح', done: 'مكتمل ومطابق', mismatch: 'فرق في الأعداد' };
function vD1Body() {
  const d = S.d1s;
  if (!d) return '<p class="caption">نقل البيانات من Firestore إلى D1: التقدم، التحويل الكامل، وعدّاد الطلبات اليومي.</p>';
  if (!d.bound) return '<div class="alert alert-error">D1 غير مربوط بالخادم — أضف قسم d1_databases في wrangler.toml</div>';
  if (!d.ready) return '<div class="alert alert-error">تعذّر تجهيز جداول D1 — راجع سجل Cloudflare</div>';
  const n = v => Number(v || 0).toLocaleString('en');
  const t = d.stats.today || {}, req = Number(t.req || 0) + Number(t.cron || 0);
  const bar = (v, max, warn) => `<div style="height:6px;border-radius:4px;background:var(--surface-3);overflow:hidden;margin:4px 0 8px"><div style="height:100%;width:${Math.min(100, Math.round(100 * v / Math.max(1, max)))}%;background:${v / max > warn ? 'var(--warning)' : 'var(--sand)'}"></div></div>`;
  const P = d.primary || {}, onD1 = P.now === 'd1';
  const sched = P.sched && Number(P.sched.at) > Number(P.server_now || 0) ? P.sched : null;
  const secs = sched ? Math.max(0, Math.round((Number(sched.at) - Number(P.server_now)) / 1000)) : 0;
  const colls = d.colls || [], done = colls.filter(c => c.state === 'done' && c.match).length;
  const order = { mismatch: 0, repair: 1, verify: 2, copying: 3, pending: 4, done: 5 };
  const sorted = colls.slice().sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9));
  const armed = d.armed, cl = d.cron_last;
  const ago = cl ? Math.max(0, Math.round((Date.now() - Number(cl.at)) / 60000)) : 0;
  const RES = { ok: 'نسخ', idle: 'لا عمل', cap: 'وصل حد اليوم', quota: 'متوقف (حصة Firestore)', budget: 'متوقف قبل حد التوفير' };
  return `
    ${cl ? `<div class="caption mb-2" style="color:${cl.ok ? 'var(--text-2)' : 'var(--danger, #e5484d)'}">آخر دورة قبل ${ago} د: ${cl.ok ? `✅ ${esc(RES[cl.result] || cl.result || 'تمت')}${cl.pages ? ` · ${cl.pages} دفعة` : ''}${cl.verifies ? ` · ${cl.verifies} مطابقة` : ''}${cl.retry ? ` · أُصلح ${cl.retry}` : ''}` : `❌ ${esc(cl.err || 'خطأ')}`}</div>`
      : armed && armed.selftest ? '<div class="caption mb-2">بانتظار أول دورة نسخ (كل 5 دقائق)…</div>' : ''}
    ${!armed ? '<div class="alert alert-info mb-2">الدورة الأولى لم تمر بعد — النسخ يبدأ بعد حوالي 10 دقائق من النشر.</div>'
      : armed.selftest ? '' : '<div class="alert alert-error mb-2">فحص الكتابة المزدوجة فشل — النسخ متوقف. راجع سجل Cloudflare.</div>'}

    <div style="padding:10px;border-radius:12px;background:var(--surface-2);margin-bottom:10px">
      <div class="flex-between"><div class="body" style="font-weight:700">${onD1 ? '🟢 كل البيانات تعمل من D1' : '⚪ Firestore هو الأساسي الآن'}</div>
        <span class="caption">${n(done)} / ${n(colls.length)} مجموعة جاهزة</span></div>
      ${bar(done, colls.length || 1, 2)}
      ${sched ? `<div class="alert alert-info" style="margin:6px 0">⏳ ${sched.mode === 'd1' ? 'التحويل إلى D1' : 'الرجوع إلى Firestore'} خلال ${secs} ثانية — لا تغلق شيئًا، الكتابات تنتظر ثوانيَ ثم تكمل.</div>`
        : onD1 ? `
          <div class="caption mb-2">النسخة الاحتياطية في Firestore: ${P.backup ? `مفعّلة · متبقٍ للنسخ ${n(P.outbox)} مستند` : '<span style="color:var(--warning)">متوقفة (الرجوع غير ممكن)</span>'}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-secondary btn-sm" id="d1Rollback" type="button" ${P.backup && !P.outbox ? '' : 'disabled'}>الرجوع إلى Firestore</button>
            ${P.outbox ? '<button class="btn btn-ghost btn-sm" id="d1Drain" type="button">نسخ الاحتياطي الآن</button>' : ''}
            <button class="btn btn-ghost btn-sm" id="d1Backup" type="button">${P.backup ? 'إيقاف النسخ الاحتياطي' : 'تفعيل النسخ الاحتياطي'}</button>
          </div>`
        : `<button class="btn btn-primary btn-sm" id="d1Cutover" type="button" ${P.can_cutover ? '' : 'disabled'} style="margin-top:4px">التحويل الكامل إلى D1</button>
           <div class="caption" style="margin-top:6px">${P.can_cutover ? 'كل المجموعات منسوخة ومطابقة. التحويل يتم بعد 90 ثانية من الضغط، ويمكن الرجوع لاحقًا.' : 'يُفعَّل تلقائيًا عند اكتمال نسخ ومطابقة كل المجموعات.'}</div>`}
    </div>

    <div class="caption">طلبات الخادم اليوم (تقريبي): <b class="tabular" style="color:var(--text)">${n(req)}</b> من ${n(d.limits.requests)} · منها تحديث تلقائي ${n(t.poll)}</div>
    ${bar(req, d.limits.requests, 0.7)}
    <div class="caption">صفوف D1 اليوم: قراءة <b class="tabular">${n(t.rr)}</b> من ${n(d.limits.rows_read)} · كتابة <b class="tabular">${n(t.rw)}</b> من ${n(d.limits.rows_written)}</div>
    ${bar(Number(t.rw || 0), d.limits.rows_written, 0.7)}
    ${!onD1 ? `<div class="flex-between caption mb-2"><span>قراءات Firestore للنسخ اليوم: ${n(d.mig_reads)} من ${n(d.mig_cap)}</span>
      <span style="display:flex;gap:4px">${(d.caps || []).map(c => `<button class="btn btn-ghost btn-sm" data-d1cap="${c}" type="button" style="${c === d.mig_cap ? 'font-weight:800;text-decoration:underline' : ''}">${c / 1000}k</button>`).join('')}</span></div>` : ''}
    ${d.stats.yesterday && d.stats.yesterday.req ? `<div class="caption mb-2">طلبات أمس: ${n(Number(d.stats.yesterday.req) + Number(d.stats.yesterday.cron || 0))}</div>` : ''}
    ${d.retry.n ? `<div class="alert ${d.retry.stuck ? 'alert-error' : 'alert-info'} mb-2">قائمة الإعادة: ${n(d.retry.n)} مستند${d.retry.stuck ? ` (${n(d.retry.stuck)} عالقة — يُعاد تلقائيًا كل ساعة)` : ''} — تُصلح تلقائيًا كل 5 دقائق.
      ${d.retry.stuck && d.retry.err ? `<div class="caption" style="margin-top:4px;direction:ltr;text-align:left">آخر سبب: ${esc(String(d.retry.err).slice(0, 120))}</div>` : ''}
      ${!onD1 ? `<button class="btn btn-ghost btn-sm" id="d1RetryAll" type="button" style="margin-top:6px">إعادة محاولة الكل الآن</button>` : ''}</div>` : ''}
    ${t.mfail ? `<div class="caption mb-2" style="color:var(--warning)">فشل كتابة D1 اليوم: ${n(t.mfail)} (حُفظت في قائمة الإعادة)</div>` : ''}
    ${t.bkfail ? `<div class="caption mb-2" style="color:var(--warning)">تعذّر النسخ الاحتياطي لـ Firestore ${n(t.bkfail)} مرة اليوم (يُعاد تلقائيًا)</div>` : ''}

    ${!onD1 ? `<div class="h4" style="font-size:12.5px;margin:10px 0 4px">القراءة المبكرة من D1 (اختياري قبل التحويل الكامل)</div>
    ${colls.filter(c => c.phase1).map(c => { const ready = c.state === 'done' && c.match; return `
      <div class="flex-between" style="padding:6px 0;border-top:1px solid var(--border)"><div><div class="body-sm" style="font-weight:600">${esc(c.label)}</div>
        <div class="caption">${c.read_d1 ? '🟢 يقرأ من D1' : '⚪ يقرأ من Firestore'} · ${esc(D1_STATE_AR[c.state] || c.state)}</div></div>
        <div class="sw ${c.read_d1 ? 'on' : ''}" data-d1flag="${esc(c.id)}" style="${ready || c.read_d1 ? '' : 'opacity:.4'}"></div></div>`; }).join('')}` : ''}

    <details style="margin-top:10px"><summary class="caption" style="cursor:pointer">تفاصيل كل المجموعات (${n(colls.length)})</summary>
      ${sorted.map(c => {
        const pct = c.state === 'done' ? 100 : c.fs_count ? Math.min(99, Math.round(100 * (c.copied || 0) / c.fs_count)) : 0;
        return `<div style="padding:7px 0;border-top:1px solid var(--border)">
          <div class="flex-between"><span class="body-sm" style="font-weight:600">${esc(c.label)}</span><span class="caption">${esc(D1_STATE_AR[c.state] || c.state)}</span></div>
          <div class="caption">في D1: ${n(c.rows)}${c.fs_count != null ? ` · Firestore: ${n(c.fs_count)}` : ''}${c.state === 'copying' || c.state === 'repair' ? ` · منسوخ ${n(c.copied)}` : ''}</div>
          ${c.state === 'copying' || c.state === 'repair' ? bar(pct, 100, 2) : ''}
          ${!onD1 && (c.state === 'mismatch' || c.state === 'done') ? `<div style="display:flex;gap:6px;margin-top:4px">
            <button class="btn btn-ghost btn-sm" data-d1act="verify" data-d1c="${esc(c.id)}" type="button">مطابقة الآن</button>
            <button class="btn btn-ghost btn-sm" data-d1act="repair" data-d1c="${esc(c.id)}" type="button">إصلاح الفروق</button></div>` : ''}
        </div>`; }).join('')}
      ${!onD1 ? '<button class="btn btn-ghost btn-sm" data-d1act="rescan" type="button" style="margin-top:6px">إعادة فحص قائمة المجموعات</button>' : ''}
    </details>`;
}
async function loadD1Status() {
  try { S.d1s = await api('/api/admin/d1/status', {}); } catch (e) { toast(e.message, 'bad'); }
  if (S.page === 'system') render(true);
  clearTimeout(S._d1sT);
  const P = S.d1s && S.d1s.primary;
  if (P && P.sched && Number(P.sched.at) > Number(P.server_now)) S._d1sT = setTimeout(loadD1Status, 10000);   // عدّاد التحويل
}
function bindD1() {
  onTap('#d1Load', () => loadD1Status());
  const act = async (body, msg) => { try { const r = await api('/api/admin/d1/action', body); if (msg) toast(msg, 'ok'); await loadD1Status(); return r; } catch (e) { toast(e.message, 'bad'); } };
  document.querySelectorAll('[data-d1flag]').forEach(el => el.onclick = async () => {
    const c = (S.d1s && S.d1s.colls || []).find(x => x.id === el.dataset.d1flag); if (!c) return;
    const on = !c.read_d1;
    if (on && !(c.state === 'done' && c.match)) return toast('انتظر اكتمال النسخ والمطابقة', 'bad');
    if (!confirm(on ? `تفعيل القراءة من D1 لـ «${c.label}»؟` : `إرجاع «${c.label}» للقراءة من Firestore؟`)) return;
    try { await api('/api/admin/d1/flag', { coll: c.id, on }); toast(on ? 'فُعّلت القراءة من D1 ✓ (تصل للجميع خلال دقيقة)' : 'رجعت القراءة إلى Firestore ✓', 'ok'); await loadD1Flags(); loadD1Status(); }
    catch (e) { toast(e.message, 'bad'); }
  });
  document.querySelectorAll('[data-d1act]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    const a = b.dataset.d1act;
    await act({ coll: b.dataset.d1c, action: a }, a === 'verify' ? 'تمت المطابقة' : a === 'rescan' ? 'تم تحديث القائمة' : 'بدأ الإصلاح — يكتمل خلال الدورات القادمة');
  });
  document.querySelectorAll('[data-d1cap]').forEach(b => b.onclick = () => act({ action: 'cap', cap: Number(b.dataset.d1cap) }, 'حُفظت سرعة النسخ'));
  onTap('#d1Cutover', async () => {
    if (!confirm('التحويل الكامل: بعد 90 ثانية تصبح كل القراءة والكتابة (ومنها الأرصدة) من D1، وFirestore يبقى نسخة احتياطية.\n\nأفضل وقت: ساعة هادئة. متابعة؟')) return;
    await act({ action: 'cutover' }, 'تمت جدولة التحويل خلال 90 ثانية ✓');
  });
  onTap('#d1Rollback', async () => {
    if (!confirm('الرجوع: بعد 90 ثانية يعود Firestore أساسيًا (يحتوي كل التغييرات). متابعة؟')) return;
    await act({ action: 'rollback' }, 'تمت جدولة الرجوع خلال 90 ثانية');
  });
  onTap('#d1Drain', () => act({ action: 'drain' }, 'تم نسخ دفعة احتياطية'));
  onTap('#d1RetryAll', async () => {
    try { const r = await api('/api/admin/d1/action', { action: 'retry_all' }); toast(`أُصلح ${r.fixed} الآن · المتبقي ${r.left} (يكمل تلقائيًا)`, 'ok'); await loadD1Status(); }
    catch (e) { toast(e.message, 'bad'); }
  });
  onTap('#d1Backup', async () => {
    const on = !(S.d1s && S.d1s.primary && S.d1s.primary.backup);
    if (!on && !confirm('إيقاف النسخ الاحتياطي يوفّر كتابات Firestore لكن يمنع الرجوع الآمن لاحقًا. متابعة؟')) return;
    await act({ action: 'backup', on }, on ? 'فُعّل النسخ الاحتياطي' : 'أُوقف النسخ الاحتياطي');
  });
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
  const cur = a ? ((a.perms && typeof a.perms === 'object') ? a.perms : (ROLE_DEFAULT_PERMS[a.role] || {})) : {};
  const isSup = a && a.role === 'super_admin';
  modal(`
    <div class="modal-head"><div class="modal-title">${a ? 'صلاحيات ' + esc(userName(uid)) : 'إضافة موظف'}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    ${a ? '' : `<div class="field mb-3"><label class="field-label" for="stQ">بريد المستخدم (يجب أن يكون مسجّلًا)</label><input class="input" id="stQ" dir="ltr"></div>`}
    <div class="field mb-3"><label class="field-label" for="stRole">النوع</label>
      <select class="input" id="stRole">
        <option value="staff" ${!isSup ? 'selected' : ''}>موظف — صلاحيات محددة</option>
        <option value="super_admin" ${isSup ? 'selected' : ''}>مسؤول رئيسي — كل شيء</option>
        ${a ? '<option value="">— إزالة من الموظفين —</option>' : ''}
      </select></div>
    <div id="permBox" ${isSup ? 'style="display:none"' : ''}>
      <p class="caption mb-2">الأقسام غير المحددة لا تظهر للموظف أبدًا. «عرض» يُضاف تلقائيًا لأي إجراء.</p>
      ${Object.entries(PERM_SECTIONS).map(([sec, d]) => `
        <div class="perm-sec">
          <div class="perm-title">${esc(d.t)}</div>
          <div class="perm-acts">${d.a.map(act => `
            <label class="perm-chk"><input type="checkbox" data-sec="${sec}" data-act="${act}" ${(cur[sec] || []).includes(act) ? 'checked' : ''}> ${esc(ACTION_AR[act])}</label>`).join('')}</div>
        </div>`).join('')}
    </div>
    <button class="btn btn-primary btn-block" id="stSave" style="margin-top:12px">حفظ</button>`);
  $('#stRole').onchange = () => { $('#permBox').style.display = $('#stRole').value === 'staff' ? '' : 'none'; };
  document.querySelectorAll('#permBox input[data-act]').forEach(ch => ch.onchange = () => {
    const sec = ch.dataset.sec;
    const view = document.querySelector(`#permBox input[data-sec="${sec}"][data-act="view"]`);
    if (ch.dataset.act !== 'view' && ch.checked) view.checked = true;
    if (ch.dataset.act === 'view' && !ch.checked) document.querySelectorAll(`#permBox input[data-sec="${sec}"]`).forEach(x => x.checked = false);
  });
  onTap('#stSave', async () => {
    let target = uid;
    if (!target) { const u = findUserByQ($('#stQ').value || ''); if (!u) return toast('لم نجد المستخدم', 'bad'); target = u.id; }
    const role = $('#stRole').value;
    const perms = {};
    document.querySelectorAll('#permBox input[data-act]:checked').forEach(ch => { (perms[ch.dataset.sec] = perms[ch.dataset.sec] || []).push(ch.dataset.act); });
    if (role === 'super_admin' && !confirm('منح صلاحيات كاملة لهذا الحساب؟')) return;
    if (role === 'staff' && !Object.keys(perms).length) return toast('اختر قسمًا واحدًا على الأقل', 'bad');
    try { await api('/api/admin/staff/set', { uid: target, role, perms }); closeModal(); toast('حُفظت الصلاحيات', 'ok'); loadStaff(); }
    catch (e) { toast(e.message, 'bad'); }
  });
}

function bindSystem() {
  bindD1();
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
  onTap('#bkGo', async () => {
    const b = $('#bkGo'); b.disabled = true; b.classList.add('loading');
    try {
      const r = await api('/api/admin/backup', {});
      const blob = new Blob([JSON.stringify(r, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `kardo-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      const total = Object.values(r.counts || {}).reduce((x, y) => x + y, 0);
      toast(`تم تنزيل النسخة (${total} سجل)`, 'ok');
    } catch (e) { toast(e.message, 'bad'); }
    b.disabled = false; b.classList.remove('loading');
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


/* ═══ v7.1 — ملف العميل الكامل ═══ */
const REASON_AR = { deposit_approved: 'إيداع معتمد', deposit_claim: 'إيداع تلقائي', sms_deposit: 'إيداع SMS', sms_manual: 'ربط حوالة يدوي',
  usdt_deposit: 'إيداع USDT', phone_verification_deposit: 'حوالة توثيق', admin_adjust: 'تعديل إداري', opening_balance_migration: 'رصيد افتتاحي',
  service_order: 'شراء خدمة', service_order_rejected: 'استرداد خدمة', store_order: 'شراء من المتجر', order_rejected: 'استرداد طلب',
  card_create: 'إصدار بطاقة', card_topup: 'شحن بطاقة', card_rejected_refund: 'استرداد بطاقة', withdraw_request: 'طلب سحب',
  withdraw_rejected: 'استرداد سحب', transfer_out: 'تحويل صادر', transfer_in: 'تحويل وارد', points_redeem: 'استبدال نقاط',
  referral_bonus_invitee: 'مكافأة دعوة', referral_bonus_inviter: 'مكافأة دعوة', plan_basic: 'باقة أساسية', plan_vip: 'باقة VIP' };
const toMs = v => !v ? 0 : v.toDate ? v.toDate().getTime() : typeof v === 'number' ? v : Date.parse(v) || 0;

async function openUserFile(uid) {
  const u = (S.users || []).find(x => x.id === uid) || { id: uid };
  modal(`<div class="modal-head"><div class="modal-title">ملف ${esc(u.name || u.email || 'العميل')}</div>
    <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    <p class="caption">جاري التحميل…</p>`);
  const q = c => getDocs(query(collection(db, c), where('uid', '==', uid), limit(60)))
    .then(r => r.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => toMs(b.created_at) - toMs(a.created_at)))
    .catch(() => null);
  const [led, deps, ords, svc, mco, cards, wds, tks] = await Promise.all(
    ['wallet_transactions', 'wallet_deposits', 'orders', 'service_orders', 'manual_card_orders', 'manual_cards', 'withdrawals', 'tickets'].map(q));
  const plan = ['basic', 'premium', 'vip'].includes(u.plan) && Number(u.plan_expires_ms || 0) > Date.now() ? u.plan : 'free';
  const ST = { pending: ['badge-warning', 'معلّق'], approved: ['badge-success', 'مقبول'], completed: ['badge-success', 'مكتمل'], delivered: ['badge-success', 'مُسلَّم'], rejected: ['badge-error', 'مرفوض'], active: ['badge-success', 'نشطة'], open: ['badge-warning', 'مفتوحة'], answered: ['badge', 'مُجاب'], closed: ['badge', 'مغلقة'] };
  const badge = s => { const b = ST[s] || ['badge', s || '—']; return `<span class="badge ${b[0]}">${esc(b[1])}</span>`; };
  const row = (title, sub, end) => `<div class="flex-between" style="padding:7px 0;border-bottom:1px solid var(--border)">
      <div style="min-width:0"><div class="body-sm" style="font-weight:600">${title}</div><div class="caption">${sub}</div></div><div style="text-align:left">${end}</div></div>`;
  const sec = (t, arr, fn) => `<div class="h4 mb-2" style="font-size:13px;margin-top:14px">${t} ${arr ? `<span class="caption">(${arr.length})</span>` : ''}</div>
      ${arr === null ? '<p class="caption">لا صلاحية لعرضها</p>' : arr.length ? arr.slice(0, 15).map(fn).join('') : '<p class="caption">لا شيء</p>'}`;

  modal(`
    <div class="modal-head"><div class="modal-title">ملف ${esc(u.name || 'العميل')}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    <div class="card card-sm mb-3" style="background:var(--surface-2);border:none">
      ${[['البريد', `<span class="mono" dir="ltr" style="font-size:10.5px">${esc(u.email || '—')}</span>`],
         ['الهاتف', u.phone_verified ? `<span dir="ltr">0${esc(u.phone_verified)}</span> ✓` : '<span class="caption">غير موثّق</span>'],
         ['الرصيد', `<b class="tabular" style="color:var(--sand)">${esc(usd(u.wallet_balance))}</b>`],
         ['الإنفاق', esc(usd(u.total_spent))],
         ['الباقة', esc(PLAN_AR[plan])],
         ['الحالة', u.banned ? '<span class="badge badge-error">موقوف</span>' : '<span class="badge badge-success">نشط</span>'],
         ['التسجيل', esc(dt(u.created_at))],
         ['المعرّف', `<span class="mono" dir="ltr" style="font-size:9.5px">${esc(uid)}</span>`]]
        .map(([k, v]) => `<div class="flex-between" style="padding:3px 0"><span class="caption">${k}</span><span>${v}</span></div>`).join('')}
    </div>
    <div style="display:flex;gap:6px" class="mb-2">
      <button class="btn btn-primary btn-sm" id="ufManage">إدارة الرصيد والحالة</button>
    </div>
    ${sec('حركة المحفظة', led, t => row(esc(REASON_AR[t.reason] || t.reason || t.type), esc(dt(t.created_at)) + (t.note ? ' · ' + esc(t.note) : ''),
        `<b class="tabular" style="color:${t.type === 'credit' ? 'var(--success)' : 'var(--error)'}">${t.type === 'credit' ? '+' : '−'}${esc(usd(t.amount))}</b><div class="caption tabular">${esc(usd(t.balance_after))}</div>`))}
    ${sec('الإيداعات', deps, d => row(esc(d.method || '—'), esc(dt(d.created_at)) + (d.claim_phone ? ' · 0' + esc(d.claim_phone) : ''), `<b class="tabular">${esc(usd(d.amount_usd))}</b><div>${badge(d.status)}</div>`))}
    ${sec('البطاقات', cards, c => row(esc(c.card_name || 'بطاقة') + ' •••• ' + esc(c.last4 || ''), esc(dt(c.created_at)), `<b class="tabular">${esc(usd(c.balance))}</b><div>${badge(c.status)}</div>`))}
    ${sec('طلبات البطاقات', mco, o => row(o.kind === 'topup' ? 'شحن بطاقة' : 'إصدار بطاقة', esc(dt(o.created_at)), `<b class="tabular">${esc(usd(o.total))}</b><div>${badge(o.status)}</div>`))}
    ${sec('طلبات المتجر', ords, o => row((o.items || []).map(i => esc(i.name) + ' ×' + i.qty).join('، ') || '—', esc(dt(o.created_at)), `<b class="tabular">${esc(lyd(o.total_lyd))}</b><div>${badge(o.status)}</div>`))}
    ${sec('الخدمات الرقمية', svc, o => row(esc(o.service_name || '—'), esc(dt(o.created_at)), `<b class="tabular">${esc(usd(o.price_usd))}</b><div>${badge(o.status)}</div>`))}
    ${sec('السحوبات', wds, w => row(esc(w.method || '—') + ' → ' + esc(w.destination || ''), esc(dt(w.created_at)), `<b class="tabular">${esc(usd(w.amount_usd))}</b><div>${badge(w.status)}</div>`))}
    ${sec('التذاكر', tks, t => row(esc(t.subject || '—'), esc(dt(t.created_at)), badge(t.status)))}
  `);
  onTap('#ufManage', () => openUserManage(uid));
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

/* ═══ v24 — أنواع البطاقات والبنرات ═══ */
async function saveSettingsPatch(patch, msg) {
  try { await api('/api/admin/settings', patch); S.settings = { ...S.settings, ...patch }; toast(msg || 'حُفظ ✓', 'ok'); closeModal(); render(true); }
  catch (e) { toast(e.message, 'bad'); }
}
function openCardType(idx) {
  const list = (Array.isArray(S.settings.card_types) ? S.settings.card_types : []).map(x => ({ ...x }));
  const t = idx >= 0 ? list[idx] : { id: 't' + Date.now().toString(36), name: '', desc: '', provider: '', badge: '', active: true, fee_fixed: 8, fee_pct: 2.5, topup_fixed: 2.5, topup_pct: 2.5, min: 10, max: 500,
    supports_3d: true, rules: 'البطاقة تُصدر عبر مزوّد خارجي، وكاردو وسيط لإصدارها وشحنها فقط.\nكاردو غير مسؤولة عن رفض أي موقع أو تاجر للبطاقة، أو رفض أي عملية دفع لأي سبب.\nرسوم الإصدار والتعبئة لا تُسترد بعد تنفيذ العملية.\nمحاولة الدفع بدون رصيد كافٍ ممنوعة: يُسمح بمحاولتين مرفوضتين، وفي المحاولة الثالثة تُحظر البطاقة وتُخصم رسوم المخالفة من رصيدها.\nالبطاقة المحظورة من المزوّد قد لا يمكن إعادة تفعيلها، وقد يتعذّر استرداد رصيدها المتبقي.\nتأكد دائمًا أن رصيد البطاقة يغطي قيمة العملية كاملة قبل الدفع.', blocked: 'القمار والمراهنات، المحتوى الإباحي، منصات التداول والعملات الرقمية، خدمات تحويل الأموال (PayPal وWise)، أي نشاط مخالف للقانون' };
  const F = (k, l, step = '0.5') => `<div class="field mb-2"><label class="field-label" for="ct_${k}">${l}</label><input class="input" id="ct_${k}" type="number" step="${step}" min="0" dir="ltr" value="${esc(String(t[k] ?? ''))}"></div>`;
  modal(`
    <div class="modal-head"><div class="modal-title">${idx >= 0 ? 'تعديل نوع البطاقة' : 'نوع بطاقة جديد'}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    <div class="field mb-2"><label class="field-label" for="ct_name">الاسم الظاهر للزبون</label><input class="input" id="ct_name" maxlength="30" value="${esc(t.name)}" placeholder="مثال: كلاسيك"></div>
    <div class="field mb-2"><label class="field-label" for="ct_desc">وصف قصير</label><input class="input" id="ct_desc" maxlength="160" value="${esc(t.desc || '')}" placeholder="مثال: مناسبة للاشتراكات الشهرية"></div>
    <div class="field mb-2"><label class="field-label" for="ct_badge">شارة (اختياري)</label><input class="input" id="ct_badge" maxlength="20" value="${esc(t.badge || '')}" placeholder="مثال: الأوفر"></div>
    <div class="field mb-2"><label class="field-label" for="ct_provider">المزوّد (لك فقط)</label><input class="input" id="ct_provider" maxlength="30" value="${esc(t.provider || '')}" placeholder="مثال: Zid Cash"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${F('fee_fixed', 'رسوم الإصدار ($)')}${F('fee_pct', 'نسبة الإصدار (%)', '0.1')}${F('topup_fixed', 'رسوم التعبئة ($)')}${F('topup_pct', 'نسبة التعبئة (%)', '0.1')}${F('min', 'أقل مبلغ ($)', '1')}${F('max', 'أقصى مبلغ ($)', '1')}</div>
    <label class="perm-chk mb-2"><input type="checkbox" id="ct_3d" ${t.supports_3d !== false ? 'checked' : ''}> يدعم رمز التحقق 3D Secure</label>
    <div class="caption mb-2">إذا أطفأته: يختفي زر «رمز التحقق» من بطاقات هذا النوع، ويُنبَّه الزبون أن المواقع التي تطلبه قد ترفضها.</div>
    <div class="field mb-2"><label class="field-label" for="ct_rules">قوانين هذا النوع (كل بند في سطر) — يوافق عليها الزبون عند الإصدار</label>
      <textarea class="input" id="ct_rules" rows="7" maxlength="2000">${esc(t.rules || '')}</textarea></div>
    <div class="field mb-2"><label class="field-label" for="ct_blocked">المواقع/الاستخدامات المحظورة (مفصولة بفاصلة)</label>
      <textarea class="input" id="ct_blocked" rows="3" maxlength="600">${esc(t.blocked || '')}</textarea></div>
    <label class="perm-chk mb-3"><input type="checkbox" id="ct_active" ${t.active !== false ? 'checked' : ''}> متاح للزبائن</label>
    <button class="btn btn-primary btn-block" id="ctSave" type="button">حفظ</button>
    ${idx >= 0 ? '<button class="btn btn-ghost btn-block" id="ctDel" type="button" style="color:var(--error);margin-top:6px">حذف النوع</button>' : ''}`);
  onTap('#ctSave', () => {
    const v = k => Number(($('#ct_' + k) || {}).value || 0);
    const item = { ...t, name: $('#ct_name').value.trim(), desc: $('#ct_desc').value.trim(), badge: $('#ct_badge').value.trim(), provider: $('#ct_provider').value.trim(), active: $('#ct_active').checked,
      supports_3d: $('#ct_3d').checked, rules: $('#ct_rules').value.trim(), blocked: $('#ct_blocked').value.trim(),
      fee_fixed: v('fee_fixed'), fee_pct: v('fee_pct'), topup_fixed: v('topup_fixed'), topup_pct: v('topup_pct'), min: v('min') || 10, max: v('max') || 500 };
    if (!item.name) return toast('اكتب اسم النوع', 'bad');
    if (idx >= 0) list[idx] = item; else { if (list.length >= 6) return toast('الحد 6 أنواع', 'bad'); list.push(item); }
    saveSettingsPatch({ card_types: list }, 'حُفظ نوع البطاقة ✓');
  });
  onTap('#ctDel', () => { if (!confirm('حذف هذا النوع؟ البطاقات الصادرة منه تبقى كما هي.')) return; list.splice(idx, 1); saveSettingsPatch({ card_types: list }, 'حُذف'); });
}
function openBannerAdd() {
  let img = '';
  modal(`
    <div class="modal-head"><div class="modal-title">بنر جديد</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    <label class="m-proof mb-2" style="display:block"><span id="bnIt">📷 اختر صورة البنر (عرضي، مثل 1200×600)</span><input type="file" accept="image/*" id="bnI" hidden></label>
    <img id="bnPrev" alt="" style="width:100%;border-radius:12px;display:none;margin-bottom:8px">
    <div class="field mb-2"><label class="field-label" for="bnT">عنوان (اختياري)</label><input class="input" id="bnT" maxlength="80"></div>
    <div class="field mb-3"><label class="field-label" for="bnL">الرابط عند الضغط (اختياري)</label><input class="input" id="bnL" dir="ltr" placeholder="#stores أو https://..."></div>
    <button class="btn btn-primary btn-block" id="bnSave" type="button">حفظ</button>`);
  $('#bnI').onchange = async () => { try { img = await compressImg($('#bnI').files[0], 1100, 0.68, 100000); $('#bnPrev').src = img; $('#bnPrev').style.display = 'block'; $('#bnIt').textContent = '✓ أُرفقت الصورة'; } catch (e) { toast(e.message, 'bad'); } };
  onTap('#bnSave', () => {
    if (!img) return toast('اختر صورة', 'bad');
    const link = $('#bnL').value.trim();
    if (link && !/^#[a-z]+$/.test(link) && !/^https:\/\//.test(link)) return toast('الرابط يجب أن يبدأ بـ # أو https://', 'bad');
    const list = (Array.isArray(S.settings.banners) ? S.settings.banners : []).slice(0, 4);
    if (list.length >= 4) return toast('الحد 4 بنرات (حجم قاعدة البيانات)', 'bad');
    list.push({ img, title: $('#bnT').value.trim(), link });
    saveSettingsPatch({ banners: list }, 'أُضيف البنر ✓');
  });
}
function bindSettingsExtras() {
  onTap('#ctAdd', () => openCardType(-1));
  document.querySelectorAll('[data-ctedit]').forEach(b => b.onclick = () => openCardType(Number(b.dataset.ctedit)));
  onTap('#bnAdd', () => openBannerAdd());
  document.querySelectorAll('[data-bndel]').forEach(b => b.onclick = () => {
    if (!confirm('حذف البنر؟')) return;
    const list = (S.settings.banners || []).slice(); list.splice(Number(b.dataset.bndel), 1); saveSettingsPatch({ banners: list }, 'حُذف البنر');
  });
  document.querySelectorAll('[data-bnup]').forEach(b => b.onclick = () => {
    const i = Number(b.dataset.bnup); if (!i) return;
    const list = (S.settings.banners || []).slice(); [list[i - 1], list[i]] = [list[i], list[i - 1]]; saveSettingsPatch({ banners: list }, 'تم الترتيب');
  });
}

/* ═══ v22 — منصات الاستخدام ═══ */
function vPlatforms() {
  const list = (S.platforms || []).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  return `
  <div class="page-enter">
    <div class="flex-between mb-3"><div><h1 class="h2" style="margin-bottom:4px;font-family:var(--font-display)">منصات الاستخدام</h1>
      <p class="body-sm text-2" style="font-size:11.5px">تظهر في الرئيسية تحت «أين تستخدم بطاقتك؟». إن لم تضف أي منصة تظهر الأيقونات الافتراضية.</p></div>
      <button class="btn btn-primary btn-sm" id="plAdd">+ منصة</button></div>
    <div class="alert alert-warning mb-3">⚠️<div>الشعارات علامات تجارية لأصحابها. أضف فقط المنصات التي جرّبتها فعلًا، ولا تلمّح لشراكة معها. سيظهر تحتها «الشعارات للتوضيح فقط».</div></div>
    <div class="pl-grid">${list.map(p => `
      <div class="card pl-card ${p.active === false ? 'off' : ''}">
        <img src="${esc(p.image || '')}" alt="" class="pl-img">
        <b>${esc(p.name)}</b><span class="caption">الترتيب ${Number(p.order || 0)}${p.active === false ? ' · مخفية' : ''}</span>
        <div style="display:flex;gap:6px"><button class="btn btn-secondary btn-sm" data-pledit="${esc(p.id)}">تعديل</button>
          <button class="btn btn-ghost btn-sm" data-pldel="${esc(p.id)}" style="color:var(--error)">حذف</button></div>
      </div>`).join('') || '<div class="card" style="text-align:center;padding:26px;grid-column:1/-1">لا منصات بعد</div>'}</div>
  </div>`;
}
function openPlatformEdit(id) {
  const p = id ? (S.platforms || []).find(x => x.id === id) : { name: '', order: (S.platforms || []).length + 1, active: true, image: '' };
  if (!p) return;
  let image = null;
  modal(`
    <div class="modal-head"><div class="modal-title">${id ? 'تعديل المنصة' : 'منصة جديدة'}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    <div class="field mb-3"><label class="field-label" for="plN">اسم المنصة</label><input class="input" id="plN" maxlength="30" value="${esc(p.name)}" placeholder="مثال: نتفلكس"></div>
    <div class="field mb-3"><label class="field-label" for="plO">الترتيب (الأصغر أولًا)</label><input class="input" id="plO" type="number" min="0" dir="ltr" value="${esc(String(p.order || 0))}"></div>
    <label class="perm-chk mb-3"><input type="checkbox" id="plA" ${p.active !== false ? 'checked' : ''}> ظاهرة للزبائن</label>
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px"><img id="plPrev" src="${esc(p.image || '')}" alt="" class="pl-img" style="${p.image ? '' : 'visibility:hidden'}">
      <label class="m-proof" style="flex:1;margin:0"><span id="plIt">${p.image ? 'اضغط لتغيير الصورة' : '📷 ارفع صورة المنصة (مربعة، PNG أو JPG)'}</span><input type="file" accept="image/png,image/jpeg,image/webp" id="plI" hidden></label></div>
    <button class="btn btn-primary btn-block" id="plSave">حفظ</button>`);
  $('#plI').onchange = async () => {
    try { image = await compressImg($('#plI').files[0], 256, 0.85, 100000); $('#plIt').textContent = '✓ أُرفقت الصورة'; const pv = $('#plPrev'); pv.src = image; pv.style.visibility = 'visible'; }
    catch (e) { toast(e.message, 'bad'); }
  };
  onTap('#plSave', async () => {
    const body = { id: id || '', name: $('#plN').value.trim(), order: Number($('#plO').value || 0), active: $('#plA').checked };
    if (image !== null) body.image = image;
    try { await api('/api/admin/platform/save', body); closeModal(); toast('حُفظت المنصة ✓', 'ok'); loadPlatforms(); } catch (e) { toast(e.message, 'bad'); }
  });
}
async function loadPlatforms() {
  try { const r = await getDocs(query(collection(db, 'platforms'), limit(80))); S.platforms = r.docs.map(d => ({ id: d.id, ...d.data() })); } catch { S.platforms = S.platforms || []; }
  render(true);
}
function bindPlatforms() {
  onTap('#plAdd', () => openPlatformEdit(''));
  document.querySelectorAll('[data-pledit]').forEach(b => b.onclick = () => openPlatformEdit(b.dataset.pledit));
  document.querySelectorAll('[data-pldel]').forEach(b => b.onclick = async () => {
    if (!confirm('حذف المنصة؟')) return;
    try { await api('/api/admin/platform/delete', { id: b.dataset.pldel }); toast('حُذفت', 'ok'); loadPlatforms(); } catch (e) { toast(e.message, 'bad'); }
  });
}

/* ═══ v12 — إدارة المتاجر الموثوقة ═══ */
const M_CATS = ['ألعاب', 'اشتراكات', 'بطاقات رقمية', 'برامج', 'إلكترونيات', 'خدمات', 'أخرى'];
function mStatus(m) {
  if (m.status === 'suspended') return ['badge-error', 'موقوف'];
  if (Number(m.sub_expires_ms || 0) < Date.now()) return ['badge-warning', 'منتهي'];
  return ['badge-success', 'نشط'];
}
function vMerchants() {
  const list = (S.merchants || []).slice().sort((a, b) => Number(a.sub_expires_ms || 0) - Number(b.sub_expires_ms || 0));
  const reps = (S.mreports || []).filter(r => r.status === 'open');
  return `
  <div class="page-enter">
    <div class="flex-between mb-3"><div><h1 class="h2" style="margin-bottom:4px;font-family:var(--font-display)">المتاجر الموثوقة</h1>
      <p class="body-sm text-2" style="font-size:11.5px">${list.length} متجر · ${list.filter(m => mStatus(m)[1] === 'نشط').length} نشط</p></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-secondary btn-sm" id="mcBillAll" type="button">شهر مجاني ثم 5% للكل</button>
      <button class="btn btn-primary btn-sm" id="mcAdd">+ متجر جديد</button></div></div>
    ${(S.mstatements || []).length ? `<div class="card mb-4" style="border-color:var(--warning-border)"><div class="h4 mb-2" style="font-size:13px;color:var(--warning)">🧾 عمولات مستحقة (${S.mstatements.length})</div>
      ${S.mstatements.map(st => `<div class="sw-row"><div style="flex:1"><div class="sw-lbl">${esc(st.merchant_name)} — ${esc(st.month)}</div>
        <div class="sw-desc">مبيعات ${esc(String(st.sales))} د.ل × ${esc(String(st.pct))}% = <b>${esc(String(st.commission))} د.ل</b>${Number(st.due_ms || 0) < Date.now() ? ' · <b style="color:var(--error)">متأخر</b>' : ''}</div></div>
        <button class="btn btn-primary btn-sm" data-stpay="${esc(st.id)}">تم الدفع</button></div>`).join('')}</div>` : ''}
    ${(S.mapps || []).length ? `<div class="card mb-4" style="border-color:var(--brand)"><div class="h4 mb-2" style="font-size:13px;color:var(--brand)">🏪 طلبات انضمام (${S.mapps.length})</div>
      ${S.mapps.map(a => `<div class="sw-row" style="align-items:flex-start"><div style="flex:1"><div class="sw-lbl">${esc(a.store_name)} · ${esc(a.category)}</div>
        <div class="sw-desc" style="white-space:pre-line">${esc(a.services)}</div>
        <div class="caption">${esc(a.name)} · <span dir="ltr">${esc(a.email)}</span> · 📞 <span dir="ltr">${esc(a.phone)}</span>${a.note ? ' · ' + esc(a.note) : ''}</div></div>
        <div style="display:flex;flex-direction:column;gap:4px"><button class="btn btn-primary btn-sm" data-apok="${esc(a.id)}">قبول وإنشاء</button>
        <button class="btn btn-ghost btn-sm" data-apno="${esc(a.id)}" style="color:var(--error)">رفض</button></div></div>`).join('')}</div>` : ''}
    ${reps.length ? `<div class="card mb-4" style="border-color:var(--error-border)"><div class="h4 mb-2" style="font-size:13px;color:var(--error)">⚑ بلاغات مفتوحة (${reps.length})</div>
      ${reps.map(r => `<div class="sw-row" style="align-items:flex-start"><div style="flex:1"><div class="sw-lbl">${esc(r.merchant_name)} — ${esc(r.reason)}</div>
        <div class="sw-desc" style="white-space:pre-line">${esc(r.text)}</div><div class="caption">${esc(r.customer_name || userName(r.uid))} · ${esc(dt(r.created_at))}</div></div>
        <div style="display:flex;flex-direction:column;gap:4px"><button class="btn btn-secondary btn-sm" data-rpview="${esc(r.id)}">المحادثة (${(r.messages || []).length})</button>
        <button class="btn btn-ghost btn-sm" data-rpok="${esc(r.id)}">إغلاق كمحلول</button></div></div>`).join('')}</div>` : ''}
    <div class="card" style="padding:0 !important;overflow:hidden"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>المتجر</th><th>التاجر</th><th>الحالة</th><th>ينتهي</th><th>الأداء</th><th></th></tr></thead>
      <tbody>${list.map(m => { const st = mStatus(m); return `<tr>
        <td><b>${esc(m.name)}</b> ${m.verified ? '<span title="موثّق" style="color:#20A0F0">✔️</span>' : '<span class="badge badge-neutral" style="font-size:10px">غير موثّق</span>'}
          <div class="caption" dir="ltr">/${esc(m.slug || '')}</div>
          ${!m.logo || !(m.pay_methods || []).length ? '<div class="caption" style="color:var(--warning)">⚠️ غير مكتمل — مخفي عن الزبائن</div>' : ''}
          ${m.pay_changed_at && Date.now() - new Date(m.pay_changed_at).getTime() < 172800000 ? '<div class="caption" style="color:var(--warning)">⚠️ غيّر أرقام الدفع خلال 48 ساعة</div>' : ''}
          ${m.contact_phone ? `<div class="caption"><a href="tel:${esc(m.contact_phone)}" style="color:var(--sand)">📞 ${esc(m.contact_phone)}</a> · <a href="https://wa.me/218${esc(String(m.contact_phone).replace(/^0/, ''))}" target="_blank" rel="noopener" style="color:var(--success)">واتساب</a></div>` : '<div class="caption" style="color:var(--error)">لا رقم تواصل</div>'}
          <div class="caption">${Number(m.commission_from_ms || 0) > Date.now() ? `🎁 مجاني حتى ${esc(new Date(Number(m.commission_from_ms)).toLocaleDateString('ar-LY'))} ثم ` : ''}${m.billing_mode === 'percent' ? `نسبة ${m.commission_pct}%` : m.billing_mode === 'hybrid' ? `${m.sub_price || 0} د.ل + ${m.commission_pct}%` : `${m.sub_price || 0} د.ل/شهر`}${m.billing_hold ? ' · <b style="color:var(--error)">موقوف لعدم الدفع</b>' : ''}</div></td>
        <td class="caption">${esc(userName(m.owner_uid))}</td>
        <td><span class="badge ${st[0]}">${st[1]}</span></td>
        <td class="caption">${esc(new Date(Number(m.sub_expires_ms || 0)).toLocaleDateString('ar-LY'))}</td>
        <td class="caption">✓ ${Number(m.orders_done || 0)} · ✗ ${Number(m.rejected_count || 0)} · ⚑ ${Number(m.reports_count || 0)}
          <div>⏱️ ${m.confirm_count ? Math.round(m.confirm_ms_sum / m.confirm_count / 60000) + ' د' : '—'} · ★ ${m.rating_count ? (m.rating_sum / m.rating_count).toFixed(1) : '—'}${Number(m.featured_until || 0) > Date.now() ? ' · 📣 إعلان' : ''}</div></td>
        <td style="white-space:nowrap"><button class="btn btn-secondary btn-sm" data-mcsub="${esc(m.id)}">تجديد</button>
          <button class="btn btn-ghost btn-sm" data-mcpromo="${esc(m.id)}">توثيق/إعلان</button>
          <button class="btn btn-primary btn-sm" data-mview="${esc(m.id)}">لوحة المتجر</button>
          <button class="btn btn-ghost btn-sm" data-mcedit="${esc(m.id)}">تعديل</button>
          <button class="btn btn-ghost btn-sm" data-mcstat="${esc(m.id)}" style="color:${m.status === 'suspended' ? 'var(--success)' : 'var(--error)'}">${m.status === 'suspended' ? 'تفعيل' : 'إيقاف'}</button></td>
      </tr>`; }).join('') || '<tr><td colspan="6" class="caption" style="text-align:center;padding:20px">لا متاجر بعد</td></tr>'}</tbody></table></div></div>
  </div>`;
}
function openMerchantEdit(id, pre) {
  const m = id ? (S.merchants || []).find(x => x.id === id) : null;
  pre = pre || {};
  modal(`
    <div class="modal-head"><div class="modal-title">${m ? 'تعديل المتجر' : 'متجر جديد'}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    ${m ? '' : `<div class="field mb-3"><label class="field-label" for="mcE">بريد حساب التاجر (مسجّل في كاردو)</label><input class="input" id="mcE" dir="ltr" type="email" value="${esc(pre.email || '')}"></div>`}
    <div class="field mb-3"><label class="field-label" for="mcN">اسم المتجر</label><input class="input" id="mcN" maxlength="40" value="${esc(m ? m.name : (pre.store_name || ''))}"></div>
    <div class="field mb-3"><label class="field-label" for="mcS">الرابط المختصر (إنجليزي)</label><input class="input" id="mcS" dir="ltr" placeholder="gamers-ly" value="${esc(m ? m.slug || '' : '')}">
      <div class="caption">يصير الرابط: kardo.ly/store.html?s=…</div></div>
    <div class="field mb-3"><label class="field-label" for="mcC">التصنيف</label><select class="input" id="mcC">${M_CATS.map(c => `<option ${(m ? m.category : pre.category) === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div class="field mb-3"><label class="field-label" for="mcB">نظام المحاسبة</label>
      <select class="input" id="mcB"><option value="fixed" ${(m && m.billing_mode || 'fixed') === 'fixed' ? 'selected' : ''}>اشتراك شهري فقط</option>
        <option value="percent" ${m && m.billing_mode === 'percent' ? 'selected' : ''}>نسبة من المبيعات فقط</option>
        <option value="hybrid" ${m && m.billing_mode === 'hybrid' ? 'selected' : ''}>اشتراك + نسبة</option></select>
      <div class="caption">مقترح: أساسي 50 د.ل · احترافي 100 د.ل · نسبة 3–5% · مختلط 25 د.ل + 2%</div></div>
    <div class="field mb-3"><label class="field-label" for="mcP">الاشتراك الشهري (د.ل)</label><input class="input" id="mcP" type="number" step="0.5" dir="ltr" value="${esc(String(m ? m.sub_price || 0 : 50))}"></div>
    <div class="field mb-3"><label class="field-label" for="mcR">نسبة العمولة من المبيعات (%)</label><input class="input" id="mcR" type="number" step="0.5" min="0" max="50" dir="ltr" value="${esc(String(m ? m.commission_pct || 0 : 0))}">
      <div class="caption">تُحسب تلقائيًا من الطلبات المكتملة، وكشف شهري أول كل شهر، والمتجر يتوقف إذا تأخر الدفع 5 أيام.</div></div>
    ${m ? '' : `<div class="field mb-3"><label class="field-label" for="mcD">مدة الاشتراك الأولى (يوم)</label><input class="input" id="mcD" type="number" value="30" dir="ltr"></div>`}
    <label class="perm-chk mb-3"><input type="checkbox" id="mcF" ${m && m.featured ? 'checked' : ''}> متجر مميّز (يظهر أولًا)</label>
    <button class="btn btn-primary btn-block" id="mcGo">حفظ</button>`);
  onTap('#mcGo', async () => {
    const body = { id: id || '', name: $('#mcN').value.trim(), slug: $('#mcS').value.trim(), category: $('#mcC').value, sub_price: Number($('#mcP').value || 0), featured: $('#mcF').checked,
      billing_mode: $('#mcB').value, commission_pct: Number($('#mcR').value || 0) };
    if (!m) { body.email = $('#mcE').value.trim(); body.days = Number($('#mcD').value || 30); }
    try { await api('/api/admin/merchant/save', body); closeModal(); toast(m ? 'حُفظ المتجر' : 'أُنشئ المتجر وأُبلغ التاجر ✓', 'ok'); }
    catch (e) { toast(e.message, 'bad'); }
  });
}
function openMerchantSub(id) {
  const m = (S.merchants || []).find(x => x.id === id); if (!m) return;
  modal(`
    <div class="modal-head"><div class="modal-title">تجديد اشتراك ${esc(m.name)}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    <p class="caption mb-3">ينتهي حاليًا: ${esc(new Date(Number(m.sub_expires_ms || 0)).toLocaleDateString('ar-LY'))}. التجديد يُضاف للمدة المتبقية.</p>
    <div class="field mb-3"><label class="field-label" for="msD">عدد الأيام</label><input class="input" id="msD" type="number" value="30" dir="ltr"></div>
    <button class="btn btn-primary btn-block" id="msGo">تجديد</button>`);
  onTap('#msGo', async () => {
    try { await api('/api/admin/merchant/sub', { id, days: Number($('#msD').value) }); closeModal(); toast('تم التجديد وأُبلغ التاجر ✓', 'ok'); }
    catch (e) { toast(e.message, 'bad'); }
  });
}
function openCaseAdmin(id) {
  const r = (S.mreports || []).find(x => x.id === id); if (!r) return;
  const WHO = { customer: 'الزبون', merchant: 'التاجر', admin: 'الإدارة' };
  modal(`
    <div class="modal-head"><div class="modal-title">⚑ ${esc(r.merchant_name)} — ${esc(r.reason)}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    <div class="caption mb-2">${esc(r.customer_name || userName(r.uid))}${r.oid ? ' · طلب ' + esc(r.oid) : ''}</div>
    <div style="display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow:auto" class="mb-3">${(r.messages || []).map(m => `
      <div class="card" style="padding:8px 12px !important;${m.by === 'admin' ? 'border-color:var(--brand)' : ''}"><b style="font-size:11px;color:var(--brand)">${WHO[m.by] || ''}</b>
        <div class="body-sm" style="white-space:pre-line">${esc(m.text)}</div><div class="caption">${esc(dt(m.at))}</div></div>`).join('')}</div>
    <div class="field mb-2"><textarea class="input" id="caMsg" rows="3" placeholder="رد الإدارة (يصل للزبون والتاجر)"></textarea></div>
    <button class="btn btn-primary btn-block" id="caSend">إرسال</button>`);
  onTap('#caSend', async () => {
    const text = ($('#caMsg').value || '').trim(); if (!text) return;
    try { await api('/api/m/report/msg', { id, text }); closeModal(); toast('أُرسل الرد ✓', 'ok'); } catch (e) { toast(e.message, 'bad'); }
  });
}
function openMerchantPromo(id) {
  const m = (S.merchants || []).find(x => x.id === id); if (!m) return;
  const until = Number(m.featured_until || 0);
  modal(`
    <div class="modal-head"><div class="modal-title">إعلان ومستوى ${esc(m.name)}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    <p class="caption mb-3">${until > Date.now() ? `إعلان مميّز فعّال حتى ${esc(new Date(until).toLocaleDateString('ar-LY'))}` : 'لا إعلان فعّال'} — الإعلان يظهر في شريط أعلى الرئيسية ويُرتَّب المتجر أولًا.</p>
    <div class="field mb-2"><label class="field-label" for="prD">أيام الإعلان (0 = إلغاء)</label><input class="input" id="prD" type="number" value="7" dir="ltr"></div>
    <div class="field mb-3"><label class="field-label" for="prP">سعر الإعلان (للسجل)</label><input class="input" id="prP" type="number" step="0.5" dir="ltr" value="0"></div>
    <button class="btn btn-primary btn-block mb-4" id="prGo">حفظ الإعلان</button>
    <div class="card mb-4" style="padding:12px !important">
      <label class="perm-chk"><input type="checkbox" id="prV" ${m.verified ? 'checked' : ''}> <b>متجر موثّق</b> — تظهر العلامة الزرقاء ✔️ للزبائن</label>
      <div class="caption" style="margin-top:4px">فعّلها فقط بعد أن تتأكد من هوية التاجر وتتواصل معه.${m.verified_at ? ` موثّق منذ ${esc(String(m.verified_at).slice(0, 10))}` : ''}</div>
      <button class="btn btn-secondary btn-block" id="prVGo" style="margin-top:8px">حفظ التوثيق</button>
    </div>
    <div class="field mb-2"><label class="field-label" for="prT">مستوى التوثيق</label>
      <select class="input" id="prT"><option value="auto">تلقائي حسب الأداء</option><option value="gold" ${m.tier === 'gold' ? 'selected' : ''}>🥇 ذهبي</option><option value="silver" ${m.tier === 'silver' ? 'selected' : ''}>🥈 فضي</option><option value="none" ${m.tier === 'none' ? 'selected' : ''}>بدون</option></select>
      <div class="caption">تلقائي: ذهبي عند 100+ طلب وتقييم 4.5+، فضي عند 20+ طلب وتقييم 4+.</div></div>
    <button class="btn btn-secondary btn-block" id="prTGo">حفظ المستوى</button>`);
  onTap('#prGo', async () => { try { await api('/api/admin/merchant/promo', { id, days: Number($('#prD').value || 0), price: Number($('#prP').value || 0) }); closeModal(); toast('حُفظ الإعلان ✓', 'ok'); } catch (e) { toast(e.message, 'bad'); } });
  onTap('#prVGo', async () => { try { await api('/api/admin/merchant/promo', { id, verified: $('#prV').checked }); closeModal(); toast($('#prV') && $('#prV').checked ? 'وُثّق المتجر ✔️' : 'أُزيل التوثيق', 'ok'); } catch (e) { toast(e.message, 'bad'); } });
  onTap('#prTGo', async () => { try { await api('/api/admin/merchant/promo', { id, tier: $('#prT').value }); closeModal(); toast('حُفظ المستوى ✓', 'ok'); } catch (e) { toast(e.message, 'bad'); } });
}
async function openMerchantView(id) {
  S.mv = { id, loading: true }; S.page = 'mview'; render(true);
  try {
    const viaFs = (coll, n) => getDocs(query(collection(db, coll), where('mid', '==', id), limit(n))).then(r => r.docs.map(d => ({ id: d.id, ...d.data() })));
    const viaD1 = (coll, n) => api('/api/admin/d1/rows', { coll, field: 'mid', value: id, limit: n }).then(r => r.list || []);
    const [o, sv, ch] = await Promise.all([
      viaFs('merchant_orders', 150),
      d1On('merchant_services') ? viaD1('merchant_services', 200) : viaFs('merchant_services', 200),
      d1On('merchant_chats') ? viaD1('merchant_chats', 60) : viaFs('merchant_chats', 60),
    ]);
    S.mv = { id, orders: o.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
      services: sv, chats: ch, tab: 'orders' };
  } catch (e) { S.mv = { id, error: e.message }; }
  render(true);
}
function vMview() {
  const v = S.mv || {}; const m = (S.merchants || []).find(x => x.id === v.id) || {};
  if (v.loading) return '<div class="page-enter"><div class="skeleton" style="height:140px;border-radius:18px"></div></div>';
  if (v.error) return `<div class="page-enter"><div class="card">تعذّر التحميل: ${esc(v.error)}</div></div>`;
  const orders = v.orders || [], now = Date.now(), day = 864e5;
  const done = orders.filter(o => o.status === 'completed');
  const sum = t => done.filter(o => toMs(o.completed_at || o.updated_at) >= t).reduce((a, o) => a + Number(o.price || 0), 0);
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const ST = { pending: 'بانتظار الدفع', processing: 'قيد التنفيذ', completed: 'مكتمل', rejected: 'مرفوض' };
  const tab = v.tab || 'orders';
  return `
  <div class="page-enter">
    <button class="btn btn-ghost btn-sm mb-2" data-go="merchants" style="padding:0">→ المتاجر</button>
    <h1 class="h2" style="margin-bottom:4px;font-family:var(--font-display)">${esc(m.name || 'متجر')}</h1>
    <p class="body-sm text-2 mb-3">${esc(userName(m.owner_uid))} · ${esc(m.category || '')} · ${m.billing_mode === 'percent' ? `نسبة ${m.commission_pct}%` : `${m.sub_price || 0} د.ل/شهر`}</p>
    <div class="kpi-grid mb-4" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
      ${[['اليوم', sum(d0.getTime())], ['7 أيام', sum(now - 7 * day)], ['30 يومًا', sum(now - 30 * day)]].map(([t, x]) => `<div class="card"><div class="caption">مبيعات ${t}</div><b class="tabular" style="font-size:18px;color:var(--sand)">${x.toFixed(2)} د.ل</b></div>`).join('')}
      <div class="card"><div class="caption">معلّق / قيد التنفيذ</div><b class="tabular" style="font-size:18px">${orders.filter(o => o.status === 'pending').length} / ${orders.filter(o => o.status === 'processing').length}</b></div>
    </div>
    <div class="pills mb-3">${[['orders', `الطلبات (${orders.length})`], ['services', `الخدمات (${(v.services || []).length})`], ['chats', `المحادثات (${(v.chats || []).length})`]].map(([k, t]) => `<button class="pill ${tab === k ? 'active' : ''}" data-mvtab="${k}">${t}</button>`).join('')}</div>
    ${tab === 'orders' ? `<div class="card" style="padding:0 !important;overflow:hidden"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>الخدمة</th><th>الزبون</th><th>المبلغ</th><th>الحالة</th><th>التاريخ</th></tr></thead>
      <tbody>${orders.map(o => `<tr data-mvo="${esc(o.id)}" style="cursor:pointer"><td>${esc(o.service_name)}${o.dup_proof ? ' ⚠️' : ''}</td><td class="caption">${esc(o.customer_name || '')}</td><td class="tabular">${Number(o.price || 0).toFixed(2)}</td><td><span class="badge ${o.status === 'completed' ? 'badge-success' : o.status === 'rejected' ? 'badge-error' : 'badge-warning'}">${ST[o.status] || o.status}</span></td><td class="caption">${esc(dt(o.created_at))}</td></tr>`).join('') || '<tr><td colspan="5" class="caption" style="text-align:center">لا طلبات</td></tr>'}</tbody></table></div></div>` : ''}
    ${tab === 'services' ? `<div class="card">${(v.services || []).map(x => `<div class="sw-row"><div><div class="sw-lbl">${esc(x.name)} ${x.active === false ? '<span class="badge badge-neutral">متوقفة</span>' : ''}</div><div class="sw-desc">${Number(x.price || 0).toFixed(2)} د.ل · ${x.delivery === 'stock' ? 'مخزون ' + (x.stock_count || 0) : 'يدوي'}</div></div></div>`).join('') || '<p class="caption">لا خدمات</p>'}</div>` : ''}
    ${tab === 'chats' ? `<div class="card">${(v.chats || []).map(c => `<div class="sw-row" data-mvc="${esc(c.id)}" style="cursor:pointer"><div><div class="sw-lbl">${esc(c.customer_name)}</div><div class="sw-desc">${esc(c.last_text || '')}</div></div><span class="caption">${esc(dt(c.updated_at))}</span></div>`).join('') || '<p class="caption">لا محادثات</p>'}</div>` : ''}
  </div>`;
}
function bindMview() {
  document.querySelectorAll('[data-mvtab]').forEach(b => b.onclick = () => { S.mv.tab = b.dataset.mvtab; render(true); });
  document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  document.querySelectorAll('[data-mvo]').forEach(r => r.onclick = () => {
    const o = (S.mv.orders || []).find(x => x.id === r.dataset.mvo); if (!o) return;
    modal(`<div class="modal-head"><div class="modal-title">${esc(o.service_name)}</div><button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
      <div class="caption mb-2">${esc(o.customer_name || '')} · ${Number(o.price || 0).toFixed(2)} د.ل · ${esc(o.pay_method || '')}</div>
      ${Object.entries(o.inputs || {}).map(([k, x]) => `<div class="caption">${esc(k)}: <b>${esc(x)}</b></div>`).join('')}
      ${o.proof ? `<img src="${esc(o.proof)}" alt="" style="width:100%;max-height:340px;object-fit:contain;border-radius:12px;margin:8px 0;background:#000">` : '<p class="caption">الإيصال يُحذف بعد معالجة الطلب</p>'}
      ${(o.messages || []).map(x => `<div class="card" style="padding:8px 12px !important;margin-bottom:6px"><b style="font-size:11px;color:var(--sand)">${x.by === 'merchant' ? 'التاجر' : x.by === 'admin' ? 'الإدارة' : 'الزبون'}</b><div class="body-sm">${esc(x.text)}</div></div>`).join('')}`);
  });
  document.querySelectorAll('[data-mvc]').forEach(r => r.onclick = () => {
    const c = (S.mv.chats || []).find(x => x.id === r.dataset.mvc); if (!c) return;
    modal(`<div class="modal-head"><div class="modal-title">${esc(c.customer_name)} ↔ ${esc(c.merchant_name)}</div><button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
      <div style="max-height:55vh;overflow:auto">${(c.messages || []).map(x => `<div class="card" style="padding:8px 12px !important;margin-bottom:6px"><b style="font-size:11px;color:var(--sand)">${x.by === 'merchant' ? 'التاجر' : x.by === 'admin' ? 'الإدارة' : 'الزبون'}</b><div class="body-sm">${esc(x.text)}</div><div class="caption">${esc(dt(x.at))}</div></div>`).join('')}</div>`);
  });
}
function bindMerchants() {
  onTap('#mcBillAll', async () => {
    if (!confirm('تطبيق على كل التجار: الشهر الأول مجاني من تاريخ انضمامه، ثم عمولة 5% على الطلبات المكتملة. متأكد؟')) return;
    try { const r = await api('/api/admin/merchants/billing-default', {}); toast(`طُبّق على ${r.updated} متجرًا ✓`, 'ok'); } catch (e) { toast(e.message, 'bad'); }
  });
  document.querySelectorAll('[data-mview]').forEach(b => b.onclick = () => openMerchantView(b.dataset.mview));
  document.querySelectorAll('[data-stpay]').forEach(b => b.onclick = async () => {
    if (!confirm('تأكيد استلام مبلغ العمولة من التاجر؟')) return;
    try { await api('/api/admin/merchant/statement/pay', { id: b.dataset.stpay }); toast('سُجّل الدفع ✓', 'ok'); } catch (e) { toast(e.message, 'bad'); }
  });
  document.querySelectorAll('[data-apok]').forEach(b => b.onclick = () => { const a = (S.mapps || []).find(x => x.id === b.dataset.apok); if (a) openMerchantEdit('', a); });
  document.querySelectorAll('[data-apno]').forEach(b => b.onclick = async () => {
    const reason = prompt('سبب الرفض (يصل للمتقدّم):', '') ; if (reason === null) return;
    try { await api('/api/admin/merchant/apply', { uid: b.dataset.apno, action: 'reject', reason }); toast('رُفض الطلب', 'ok'); } catch (e) { toast(e.message, 'bad'); }
  });
  document.querySelectorAll('[data-rpview]').forEach(b => b.onclick = () => openCaseAdmin(b.dataset.rpview));
  document.querySelectorAll('[data-mcpromo]').forEach(b => b.onclick = () => openMerchantPromo(b.dataset.mcpromo));
  onTap('#mcAdd', () => openMerchantEdit(''));
  document.querySelectorAll('[data-mcedit]').forEach(b => b.onclick = () => openMerchantEdit(b.dataset.mcedit));
  document.querySelectorAll('[data-mcsub]').forEach(b => b.onclick = () => openMerchantSub(b.dataset.mcsub));
  document.querySelectorAll('[data-mcstat]').forEach(b => b.onclick = async () => {
    const m = (S.merchants || []).find(x => x.id === b.dataset.mcstat); if (!m) return;
    const to = m.status === 'suspended' ? 'active' : 'suspended';
    if (to === 'suspended' && !confirm(`إيقاف ${m.name}؟ سيختفي فورًا من الموقع.`)) return;
    try { await api('/api/admin/merchant/sub', { id: m.id, status: to }); toast(to === 'active' ? 'تم التفعيل' : 'تم الإيقاف', 'ok'); } catch (e) { toast(e.message, 'bad'); }
  });
  document.querySelectorAll('[data-rpok]').forEach(b => b.onclick = async () => {
    try { await api('/api/admin/report/resolve', { id: b.dataset.rpok }); toast('أُغلق البلاغ', 'ok'); } catch (e) { toast(e.message, 'bad'); }
  });
}

/* ═══ v11 — محرر طرق الدفع (المدمجة + المخصّصة) ═══ */
function openMethodEditor(kind, ref) {
  const st = S.settings || {};
  const customs = Array.isArray(st.custom_methods) ? st.custom_methods.map(x => ({ ...x })) : [];
  let m;
  if (kind === 'builtin') m = { label: st['m_' + ref + '_label'] || '', rate: ref === 'bank' ? st.rate_bank : null, receipt: st['m_' + ref + '_receipt'] !== false, on: st['m_' + ref + '_on'] === true, fields: st['m_' + ref + '_fields'] || [] };
  else m = ref >= 0 ? customs[ref] : { label: '', rate: st.usd_to_lyd || 1, receipt: true, on: true, fields: [{ label: 'رقم الحساب', value: '', copy: true }], logo: '' };
  const fields = (m.fields || []).map(f => ({ ...f }));
  const fieldRows = () => fields.map((f, i) => `
    <div class="pm-field">
      <input class="input" data-fl="${i}" placeholder="اسم الحقل (مثال: رقم الحساب)" value="${esc(f.label || '')}">
      <input class="input" data-fv="${i}" placeholder="القيمة" dir="auto" value="${esc(f.value || '')}">
      <label class="perm-chk"><input type="checkbox" data-fc="${i}" ${f.copy ? 'checked' : ''}> زر نسخ</label>
      <button class="btn btn-ghost btn-sm" data-fdel="${i}" type="button" style="color:var(--error)">حذف</button>
    </div>`).join('');
  modal(`
    <div class="modal-head"><div class="modal-title">${kind === 'builtin' ? 'تفاصيل ' + esc(m.label || ref) : ref >= 0 ? 'تعديل طريقة الدفع' : 'طريقة دفع جديدة'}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    <div class="field mb-3"><label class="field-label" for="pmLbl">الاسم الظاهر للعميل</label><input class="input" id="pmLbl" maxlength="40" value="${esc(m.label || '')}" placeholder="مثال: مصرف الجمهورية"></div>
    ${kind === 'builtin' && ref !== 'bank' ? '' : `<div class="field mb-3"><label class="field-label" for="pmRate">سعر الصرف (كم وحدة = 1$)</label>
      <input class="input" id="pmRate" type="number" step="0.01" min="0.01" dir="ltr" value="${esc(String(m.rate ?? 1))}">
      <div class="caption">بالدينار مثلًا 9.5 — أو 1 إذا كانت الطريقة بالدولار</div></div>`}
    <div class="sw-row"><div><div class="sw-lbl">مفعّلة للعملاء</div></div><div class="sw ${m.on !== false ? 'on' : ''}" id="pmOn"></div></div>
    <div class="sw-row"><div><div class="sw-lbl">إرفاق إيصال إلزامي</div><div class="sw-desc">عند الإيقاف يكفي رقم العملية</div></div><div class="sw ${m.receipt !== false ? 'on' : ''}" id="pmRcpt"></div></div>
    ${kind === 'custom' ? `<div class="sw-row"><div><div class="sw-lbl">الشعار</div></div>
      <label class="pm-logo">${m.logo ? `<img src="${esc(m.logo)}" alt="" id="pmLogoPrev">` : '<span id="pmLogoPrev">📷</span>'}<input type="file" accept="image/*" id="pmLogoIn" hidden></label></div>` : ''}
    <div class="h4" style="font-size:13px;margin:12px 0 6px">بيانات الدفع</div>
    <div id="pmFields">${fieldRows()}</div>
    <button class="btn btn-ghost btn-sm" id="pmFAdd" type="button">+ إضافة حقل</button>
    <button class="btn btn-primary btn-block" id="pmSave" type="button" style="margin-top:14px">حفظ</button>
    ${kind === 'custom' && ref >= 0 ? '<button class="btn btn-ghost btn-block" id="pmDelM" type="button" style="color:var(--error);margin-top:6px">حذف طريقة الدفع</button>' : ''}`);
  const sync = () => document.querySelectorAll('#pmFields [data-fl]').forEach(el => {
    const i = +el.dataset.fl;
    fields[i] = { label: el.value.trim(), value: document.querySelector(`[data-fv="${i}"]`).value.trim(), copy: document.querySelector(`[data-fc="${i}"]`).checked };
  });
  const bindF = () => document.querySelectorAll('[data-fdel]').forEach(b => b.onclick = () => { sync(); fields.splice(+b.dataset.fdel, 1); $('#pmFields').innerHTML = fieldRows(); bindF(); });
  bindF();
  ['#pmOn', '#pmRcpt'].forEach(id => { const el = $(id); if (el) el.onclick = () => el.classList.toggle('on'); });
  onTap('#pmFAdd', () => { sync(); if (fields.length >= 8) return toast('الحد 8 حقول', 'bad'); fields.push({ label: '', value: '', copy: true }); $('#pmFields').innerHTML = fieldRows(); bindF(); });
  let logo = m.logo || '';
  const li = $('#pmLogoIn');
  if (li) li.onchange = async () => { try { logo = await compressImg(li.files[0], 160, 0.85, 60000); $('#pmLogoPrev').outerHTML = `<img src="${logo}" alt="" id="pmLogoPrev">`; } catch (e) { toast(e.message, 'bad'); } };
  onTap('#pmSave', async () => {
    sync();
    const label = $('#pmLbl').value.trim();
    if (!label) return toast('اكتب اسم الطريقة', 'bad');
    const cleanF = fields.filter(f => f.value);
    const on = $('#pmOn').classList.contains('on'), receipt = $('#pmRcpt').classList.contains('on');
    const rateEl = $('#pmRate'); const rate = rateEl ? Number(rateEl.value) : null;
    if (rateEl && !(rate > 0)) return toast('سعر صرف غير صالح', 'bad');
    let payload;
    if (kind === 'builtin') {
      payload = { ['m_' + ref + '_label']: label, ['m_' + ref + '_on']: on, ['m_' + ref + '_receipt']: receipt, ['m_' + ref + '_fields']: cleanF };
      if (ref === 'bank') payload.rate_bank = rate;
    } else {
      const item = { key: ref >= 0 ? (customs[ref].key || 'c' + Date.now().toString(36)) : 'c' + Date.now().toString(36), label, rate, on, receipt, fields: cleanF, logo };
      if (ref >= 0) customs[ref] = item; else { if (customs.length >= 10) return toast('الحد 10 طرق مخصّصة', 'bad'); customs.push(item); }
      payload = { custom_methods: customs };
    }
    try { await api('/api/admin/settings', payload); closeModal(); toast('حُفظت طريقة الدفع ✓', 'ok'); }
    catch (e) { toast(e.message, 'bad'); }
  });
  onTap('#pmDelM', async () => {
    if (!confirm('حذف طريقة الدفع نهائيًا؟ الإيداعات السابقة بها تبقى في السجل.')) return;
    customs.splice(ref, 1);
    try { await api('/api/admin/settings', { custom_methods: customs }); closeModal(); toast('حُذفت', 'ok'); } catch (e) { toast(e.message, 'bad'); }
  });
}

/* ═══ v11 — رصيد البطاقة + الملصقات ═══ */
function openCardBalance(cardId) {
  const c = (S.manualCards || []).find(x => x.id === cardId); if (!c) return;
  modal(`
    <div class="modal-head"><div class="modal-title">رصيد وعنوان البطاقة ••${esc(c.last4 || '')}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    <p class="caption mb-3">${esc(userName(c.uid))} — انسخ الرصيد الحالي من لوحة المزوّد (Zid Cash). العميل يرى الرصيد وتاريخ التحديث.</p>
    <div class="field mb-4"><label class="field-label" for="cbVal">الرصيد المتبقي ($)</label>
      <input class="input" id="cbVal" type="number" step="0.01" min="0" dir="ltr" value="${esc(String(c.balance ?? ''))}"></div>
    <div class="field mb-4"><label class="field-label" for="cbAddr">📍 عنوان البطاقة — Billing Address</label>
      <textarea class="input" id="cbAddr" dir="ltr" rows="3" maxlength="300" placeholder="Street, City, State ZIP, Country" style="height:auto;padding-top:10px">${esc(c.billing_address || '')}</textarea>
      <div class="caption" style="margin-top:4px">يظهر للعميل في تفاصيل بطاقته مع زر نسخ.</div></div>
    <button class="btn btn-primary btn-block" id="cbGo">حفظ</button>`);
  onTap('#cbGo', async () => {
    const v = Number($('#cbVal').value);
    if (!(v >= 0)) return toast('أدخل رصيدًا صحيحًا', 'bad');
    try { await api('/api/admin/card/balance', { card_id: cardId, balance: v, billing_address: $('#cbAddr').value }); closeModal(); toast('حُدّث الرصيد', 'ok'); }
    catch (e) { toast(e.message, 'bad'); }
  });
}

/* ═══ v42 — تغيير بطاقة الزبون ═══ */
function openCardReplace(cardId) {
  const c = (S.manualCards || []).find(x => x.id === cardId); if (!c) return;
  modal(`
    <div class="modal-head"><div class="modal-title">تغيير البطاقة ••${esc(c.last4 || '')}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    <p class="caption mb-3">${esc(userName(c.uid))} — ${esc(c.card_name || 'بطاقة')}. البيانات القديمة تتوقف عند الزبون، ويصله إشعار ليعرض الجديدة.</p>
    <div class="field mb-3"><label class="field-label">رقم البطاقة الجديدة</label>
      <input class="input mono" id="rpPan" dir="ltr" placeholder="5395 0212 3456 7890" maxlength="23" inputmode="numeric" autocomplete="off"></div>
    <div class="grid-2 mb-3">
      <div><label class="field-label">الانتهاء</label><input class="input mono" id="rpExp" dir="ltr" placeholder="12/28" maxlength="5" autocomplete="off"></div>
      <div><label class="field-label">CVV</label><input class="input mono" id="rpCvv" dir="ltr" placeholder="123" maxlength="4" inputmode="numeric" autocomplete="off"></div>
    </div>
    <div class="field mb-3"><label class="field-label">📍 عنوان البطاقة — Billing Address</label>
      <textarea class="input" id="rpAddr" dir="ltr" rows="3" maxlength="300" placeholder="Street, City, State ZIP, Country" style="height:auto;padding-top:10px">${esc(c.billing_address || '')}</textarea></div>
    <div class="field mb-4"><label class="field-label">الرصيد ($) — اتركه فارغًا لإبقاء ${esc(usd(c.balance))}</label>
      <input class="input" id="rpBal" type="number" step="0.01" min="0" dir="ltr" placeholder="${esc(String(c.balance ?? ''))}"></div>
    <div class="alert alert-info mb-3" style="font-size:11px">${svg(I.help)}<div>🔒 تُشفَّر البيانات قبل الحفظ. CVV يظهر للزبون مرة واحدة فقط.</div></div>
    <button class="btn btn-primary btn-block" id="rpGo">حفظ البطاقة الجديدة</button>`);
  const pan = $('#rpPan'), exp = $('#rpExp'), cvv = $('#rpCvv');
  pan.oninput = e => { const v = e.target.value.replace(/\D/g, '').slice(0, 19); e.target.value = v.replace(/(.{4})/g, '$1 ').trim(); };
  exp.oninput = e => { let v = e.target.value.replace(/\D/g, '').slice(0, 4); if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2); e.target.value = v; };
  cvv.oninput = e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); };
  onTap('#rpGo', async () => {
    const p = pan.value.replace(/\s+/g, '');
    if (!/^\d{13,19}$/.test(p)) return toast('رقم البطاقة غير صالح', 'bad');
    if (!/^\d{2}\/\d{2}$/.test(exp.value)) return toast('صيغة التاريخ MM/YY', 'bad');
    if (!/^\d{3,4}$/.test(cvv.value)) return toast('CVV غير صالح', 'bad');
    if (!confirm(`تأكيد تغيير بطاقة ${userName(c.uid)} إلى ••${p.slice(-4)}؟`)) return;
    const btn = $('#rpGo'); btn.disabled = true; btn.classList.add('loading');
    try {
      await api('/api/admin/card/replace', { card_id: cardId, card_number: p, expiry: exp.value, cvv: cvv.value,
        billing_address: $('#rpAddr').value, balance: $('#rpBal').value });
      pan.value = ''; cvv.value = ''; closeModal(); toast('تم تغيير البطاقة وإشعار الزبون', 'ok');
    } catch (e) { toast(e.message, 'bad'); btn.disabled = false; btn.classList.remove('loading'); }
  });
}

const STICKER_SLOTS = [
  ['welcome', 'الترحيب بالعميل الجديد', 'fennec-welcome'], ['purchase', 'نجاح شراء منتج', 'fennec-success'],
  ['card', 'إرسال طلب بطاقة', 'fennec-card'], ['deposit', 'إرسال/نجاح إيداع', 'fennec-success'],
  ['failed', 'عملية غير ناجحة', 'fennec-error'], ['wait', 'قيد المراجعة/الانتظار', 'fennec-wait'],
  ['empty', 'لا طلبات بعد', 'fennec-empty'], ['no_cards', 'لا بطاقات بعد', 'fennec-card'],
  ['mail', 'تأكيد البريد', 'fennec-mail'], ['offline', 'انقطاع الإنترنت', 'fennec-offline'],
  ['error', 'خطأ في التحميل', 'fennec-error'], ['plan', 'الاشتراك في باقة', 'fennec-success'],
  ['ticket', 'رد الدعم', 'fennec-mail'],
];
async function loadStickers() {
  try { const r = await getDocs(query(collection(db, 'stickers'), limit(50))); S.stickers = Object.fromEntries(r.docs.map(d => [d.id, d.data().image])); }
  catch { S.stickers = {}; }
  render(true);
}
function vStickers() {
  const st = S.stickers || {};
  return `
  <div class="page-enter">
    <div class="mb-3"><h1 class="h2" style="margin-bottom:4px;font-family:var(--font-display)">الملصقات</h1>
      <p class="body-sm text-2" style="font-size:11.5px">ارفع ملصقًا لكل موقف ليظهر للعميل. الموقف بدون ملصق يعرض الفنك الافتراضي.</p></div>
    <div class="stk-grid">${STICKER_SLOTS.map(([k, t, def]) => `
      <div class="card stk-card">
        <img src="${esc(st[k] || './' + def + '.webp')}" alt="" class="stk-img">
        <div class="body-sm" style="font-weight:700;margin:6px 0 2px">${esc(t)}</div>
        <div class="caption mb-2">${st[k] ? 'ملصق مخصّص ✓' : 'الافتراضي'}</div>
        <label class="btn btn-secondary btn-sm" data-stk-up="${k}" style="cursor:pointer">رفع<input type="file" accept="image/png,image/webp,image/gif" hidden data-stk-file="${k}"></label>
        ${st[k] ? `<button class="btn btn-ghost btn-sm" data-stk-clear="${k}">إرجاع الافتراضي</button>` : ''}
      </div>`).join('')}</div>
  </div>`;
}
function bindStickers() {
  document.querySelectorAll('[data-stk-file]').forEach(inp => inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try {
      const data = await compressImg(f, 512, 0.85, 240000);
      await api('/api/admin/sticker/save', { slot: inp.dataset.stkFile, image: data });
      toast('حُفظ الملصق ✓', 'ok'); loadStickers();
    } catch (e) { toast(e.message, 'bad'); }
  });
  document.querySelectorAll('[data-stk-clear]').forEach(b => b.onclick = async () => {
    try { await api('/api/admin/sticker/save', { slot: b.dataset.stkClear, image: '' }); toast('أُرجع الافتراضي', 'ok'); loadStickers(); }
    catch (e) { toast(e.message, 'bad'); }
  });
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
    <div class="sw-row">
      <div>
        <div class="sw-lbl">المتاجر الموثوقة (ظاهرة للزبائن)</div>
        <div class="sw-desc">مطفأة = يختفي تبويب المتاجر وتتوقف الطلبات والانضمام، والبيانات تبقى كاملة</div>
      </div>
      <div class="sw ${s.merchants_on === true ? 'on' : ''}" data-op="merchants_on"></div>
    </div>
    <div class="sw-row">
      <div>
        <div class="sw-lbl">متجر كاردو (الاشتراكات القديمة)</div>
        <div class="sw-desc">موقوف افتراضيًا — الخدمات تُعرض عبر «المتاجر الموثوقة»</div>
      </div>
      <div class="sw ${s.kardo_store_on === true ? 'on' : ''}" data-op="kardo_store_on"></div>
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

    <div class="sw-row">
      <div>
        <div class="sw-lbl">إعادة التعبئة متاحة</div>
        <div class="sw-desc">عند الإيقاف يظهر للعميل «إعادة التعبئة غير متاحة حاليًا»</div>
      </div>
      <div class="sw ${s.mc_topup_on === true ? 'on' : ''}" data-op="mc_topup_on"></div>
    </div>
    <div class="sw-row">
      <div>
        <div class="sw-lbl">قسم البطاقات قيد الصيانة</div>
        <div class="sw-desc">يوقف الإصدار والتعبئة ويُظهر للعملاء تنبيه الصيانة</div>
      </div>
      <div class="sw ${s.mc_maint_on === true ? 'on' : ''}" data-op="mc_maint_on"></div>
    </div>

    <div class="set-sub">🆕 إصدار بطاقة جديدة</div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">أقل مبلغ شحن أول ($)</div></div>
      <input class="input" data-op="mc_create_min" type="number" value="${n(s.mc_create_min, 10)}">
    </div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">أقصى مبلغ ($)</div></div>
      <input class="input" data-op="mc_create_max" type="number" value="${n(s.mc_create_max, 500)}">
    </div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">رسوم الإصدار الثابتة ($)</div></div>
      <input class="input" data-op="mc_create_fee_fixed" type="number" step="0.5" value="${n(s.mc_create_fee_fixed, 8)}">
    </div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">رسوم الإصدار النسبية (%)</div></div>
      <input class="input" data-op="mc_create_fee_pct" type="number" step="0.1" value="${n(s.mc_create_fee_pct, 2.5)}">
    </div>

    <div class="set-sub">🔄 إعادة تعبئة البطاقة</div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">أقل مبلغ تعبئة ($)</div></div>
      <input class="input" data-op="mc_topup_min" type="number" value="${n(s.mc_topup_min, 10)}">
    </div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">أقصى مبلغ تعبئة ($)</div></div>
      <input class="input" data-op="mc_topup_max" type="number" value="${n(s.mc_topup_max, 500)}">
    </div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">رسوم التعبئة الثابتة ($)</div></div>
      <input class="input" data-op="mc_topup_fee_fixed" type="number" step="0.5" value="${n(s.mc_topup_fee_fixed, 8)}">
    </div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">رسوم التعبئة النسبية (%)</div></div>
      <input class="input" data-op="mc_topup_fee_pct" type="number" step="0.1" value="${n(s.mc_topup_fee_pct, 2.5)}">
    </div>

    <div class="set-sub">💳 أنواع البطاقات (مزوّدون وأسعار)</div>
    <div class="caption mb-2">إن أضفت أنواعًا، يختار الزبون بينها عند الإصدار، وتُستخدم رسوم كل نوع بدل الرسوم العامة أعلاه. اسم المزوّد لا يظهر للزبون.</div>
    <div id="ctList">${(Array.isArray(s.card_types) ? s.card_types : []).map((t, i) => `<div class="sw-row"><div><div class="sw-lbl">${esc(t.name)} ${t.active === false ? '<span class="badge badge-neutral">موقوف</span>' : ''}</div>
      <div class="sw-desc">${t.supports_3d === false ? '⚠️ بدون 3D · ' : '✅ 3D · '}${esc(t.provider || '—')} · إصدار $${esc(String(t.fee_fixed))} + ${esc(String(t.fee_pct))}% · تعبئة $${esc(String(t.topup_fixed))} + ${esc(String(t.topup_pct))}%</div></div>
      <button class="btn btn-secondary btn-sm" data-ctedit="${i}" type="button">تعديل</button></div>`).join('') || '<div class="caption">لا أنواع — تُستخدم الرسوم العامة.</div>'}</div>
    <button class="btn btn-ghost btn-sm mb-3" id="ctAdd" type="button">+ نوع بطاقة</button>

    <div class="set-sub">🎁 الدعوات (رمز الدعوة)</div>
    <div class="sw-row"><div><div class="sw-lbl">تفعيل نظام الدعوات</div><div class="sw-desc">مكافأة تُضاف عند اكتمال إصدار كل بطاقة للمدعو</div></div>
      <div class="sw ${s.referral_cards_enabled !== false ? 'on' : ''}" data-op="referral_cards_enabled"></div></div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">مكافأة صاحب الرمز ($) عن كل بطاقة</div></div>
      <input class="input" data-op="referral_card_inviter" type="number" step="0.1" min="0" value="${n(s.referral_card_inviter, 1)}">
    </div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">هدية المدعو ($) عند أول بطاقة</div></div>
      <input class="input" data-op="referral_card_invitee" type="number" step="0.1" min="0" value="${n(s.referral_card_invitee, 0.2)}">
    </div>

    <div class="set-sub">🛡️ شروط الإيداع والسحب</div>
    <div class="sw-row"><div><div class="sw-lbl">الإيداع والسحب للموثّقين فقط</div><div class="sw-desc">بريد مؤكَّد + رقم ليبيانا أو المدار موثّق</div></div>
      <div class="sw ${s.require_verified_money !== false ? 'on' : ''}" data-op="require_verified_money"></div></div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">مبلغ توثيق الرقم (دينار كامل)</div><div class="sw-desc">يُضاف لمحفظة الزبون بعد التوثيق</div></div>
      <input class="input" data-op="pv_amount_lyd" type="number" step="1" min="1" max="10" value="${n(s.pv_amount_lyd, 1)}">
    </div>
    <div class="sw-row"><div><div class="sw-lbl">سحب الرصيد (للزبائن)</div><div class="sw-desc">الزبون يطلب إخراج رصيده، وأنت تحوّل يدويًا. يُنصح بإبقائه مطفأً حتى استشارة قانونية.</div></div>
      <div class="sw ${s.withdraw_enabled === true ? 'on' : ''}" data-op="withdraw_enabled"></div></div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">عمولة السحب (%)</div></div>
      <input class="input" data-op="withdraw_fee_pct" type="number" step="0.5" min="0" max="50" value="${n(s.withdraw_fee_pct, 0)}">
    </div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">عمولة سحب ثابتة ($)</div></div>
      <input class="input" data-op="withdraw_fee_fixed" type="number" step="0.5" min="0" value="${n(s.withdraw_fee_fixed, 0)}">
    </div>

    <div class="set-sub">🛡️ حماية الإيداع التلقائي (رسائل المشغّل)</div>
    <div class="sw-row"><div><div class="sw-lbl">مطابقة اسم المُرسِل حرفيًا</div><div class="sw-desc">يمنع رسائل مزيّفة باسم يشبه ليبيانا/المدار</div></div>
      <div class="sw ${s.sms_sender_exact !== false ? 'on' : ''}" data-op="sms_sender_exact"></div></div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">أقصى إيداع تلقائي (د.ل)</div><div class="sw-desc">الأكبر منه يدخل «مراجعة» وتعتمده أنت. 0 = بلا حد</div></div>
      <input class="input" data-op="sms_auto_max_lyd" type="number" step="10" min="0" value="${n(s.sms_auto_max_lyd, 100)}">
    </div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">إعادة دخول الإدارة كل (ساعة)</div><div class="sw-desc">للعمليات المالية والإعدادات. 0 = إيقاف</div></div>
      <input class="input" data-op="admin_reauth_hours" type="number" step="1" min="0" max="168" value="${n(s.admin_reauth_hours, 12)}">
    </div>

    <div class="set-sub">🖼️ البنرات الإعلانية (أعلى الرئيسية)</div>
    <div class="caption mb-2">حتى 4 صور. الرابط: صفحة داخلية مثل <span dir="ltr">#stores</span> أو <span dir="ltr">#cards</span> أو <span dir="ltr">#plans</span>، أو رابط https كامل.</div>
    <div id="bnList">${(Array.isArray(s.banners) ? s.banners : []).map((b, i) => `<div class="sw-row"><div style="display:flex;gap:10px;align-items:center"><img src="${esc(b.img)}" alt="" style="width:84px;height:42px;object-fit:cover;border-radius:8px">
      <div><div class="sw-lbl">${esc(b.title || 'بدون عنوان')}</div><div class="sw-desc" dir="ltr">${esc(b.link || '—')}</div></div></div>
      <div style="display:flex;gap:4px"><button class="btn btn-ghost btn-sm" data-bnup="${i}" type="button">↑</button><button class="btn btn-ghost btn-sm" data-bndel="${i}" type="button" style="color:var(--error)">حذف</button></div></div>`).join('') || '<div class="caption">لا بنرات — يظهر البنر الافتراضي.</div>'}</div>
    <button class="btn btn-ghost btn-sm mb-3" id="bnAdd" type="button">+ بنر</button>

    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">حد «وضع التوفير» (قراءات الخادم يوميًا)</div><div class="sw-desc">عند الوصول له تتوقف تعديلات التجار مؤقتًا، والمدفوعات تعمل</div></div>
      <input class="input" data-op="quota_save_at" type="number" step="1000" min="1000" value="${n(s.quota_save_at, 25000)}">
    </div>

    <div class="set-sub">🔐 البيانات والتحقق</div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">مدة عرض بيانات البطاقة (ساعة)</div></div>
      <input class="input" data-op="mc_reveal_hours" type="number" value="${n(s.mc_reveal_hours, 24)}">
    </div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">نافذة CVV (دقائق)</div><div class="sw-desc">يُعرض مرة واحدة خلالها بعد الإصدار (1–60)</div></div>
      <input class="input" data-op="mc_cvv_minutes" type="number" min="1" max="60" value="${n(s.mc_cvv_minutes, 5)}">
    </div>
    <div class="field" style="grid-template-columns:1fr 100px">
      <div><div class="sw-lbl">رسوم التحقق 3D ($)</div><div class="sw-desc">تظهر للعميل في نافذة رمز التحقق</div></div>
      <input class="input" data-op="otp_fee_usd" type="number" step="0.01" value="${n(s.otp_fee_usd, 0.03)}">
    </div>

    <div class="set-sub">✅ النقاط المختصرة عند الإصدار</div>
    <div class="field" style="grid-template-columns:1fr">
      <div><div class="sw-desc">3 نقاط تظهر للعميل قبل الإصدار. سطر لكل نقطة بهذا الشكل: العنوان | شرح قصير. اتركه فارغًا لاستخدام النقاط الافتراضية.</div></div>
      <textarea class="input" data-op="card_points" rows="4" maxlength="600" placeholder="للدفع أونلاين فقط | لا تعمل في الصراف أو نقاط البيع">${esc(s.card_points || '')}</textarea>
    </div>
    <div class="set-sub">⚠️ الشروط الكاملة للبطاقات</div>
    <div class="field" style="grid-template-columns:1fr">
      <div><div class="sw-desc">تظهر عند ضغط العميل على «الشروط كاملة» في نافذة الإصدار. كل سطر فقرة.</div></div>
      <textarea class="input" data-op="card_warning" rows="8" maxlength="2000" placeholder="مثال: البطاقة ليست للتخزين…">${esc(s.card_warning || '')}</textarea>
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
      const logo = s['m_' + k + '_logo'] || '';
      return `
        <div class="sw-row" style="gap:10px">
          <label class="pm-logo" title="صورة ${esc(label)}">
            ${logo ? `<img src="${esc(logo)}" alt="" id="pmPrev_${k}">` : `<span id="pmPrev_${k}">📷</span>`}
            <input type="file" accept="image/*" data-pmlogo="${k}" hidden>
          </label>
          <div style="flex:1">
            <div class="sw-lbl">${esc(label)}</div>
            <div class="sw-desc">${logo ? '<button type="button" class="btn btn-ghost btn-sm" style="padding:0;min-height:0" data-pmclear="' + k + '">حذف الصورة</button>' : 'اضغط الصورة لرفع شعار'}</div>
            <input type="hidden" data-op="m_${k}_logo" value="${esc(logo)}">
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
        ${ctestBtn('trc20')}
      </div>
    </div>
    <div class="sw-row"><div><div class="sw-lbl">USDT BEP20 (BSC)</div><div class="sw-desc">عنوان يبدأ بـ 0x — من بايننس: إيداع ← USDT ← شبكة BSC</div></div>
      <div class="sw ${s.usdt_bep20_on === true ? 'on' : ''}" data-op="usdt_bep20_on"></div></div>
    <div class="field" style="grid-template-columns:1fr"><div><input class="input mono" data-op="usdt_bep20_address" dir="ltr" placeholder="0x…" value="${esc(s.usdt_bep20_address || '')}">${ctestBtn('bep20')}</div></div>
    <div class="sw-row"><div><div class="sw-lbl">USDT Polygon</div><div class="sw-desc">عنوان يبدأ بـ 0x — من بايننس: إيداع ← USDT ← شبكة Polygon</div></div>
      <div class="sw ${s.usdt_polygon_on === true ? 'on' : ''}" data-op="usdt_polygon_on"></div></div>
    <div class="field" style="grid-template-columns:1fr"><div><input class="input mono" data-op="usdt_polygon_address" dir="ltr" placeholder="0x…" value="${esc(s.usdt_polygon_address || '')}">${ctestBtn('polygon')}</div></div>
    <div class="sw-row"><div><div class="sw-lbl">Binance Pay</div><div class="sw-desc">Pay ID الخاص بك (أرقام) — يحتاج مفتاح API للقراءة فقط في Cloudflare</div></div>
      <div class="sw ${s.binance_pay_on === true ? 'on' : ''}" data-op="binance_pay_on"></div></div>
    <div class="field" style="grid-template-columns:1fr"><div><input class="input mono" data-op="binance_pay_id" dir="ltr" inputmode="numeric" placeholder="123456789" value="${esc(s.binance_pay_id || '')}">${ctestBtn('binance_pay')}</div></div>
    <p class="caption" style="margin-top:6px">«اختبار الاتصال» يفحص المحفوظ فعلًا — احفظ أولًا ثم اختبر.</p>
  </div>

  <button class="btn btn-primary" data-save="ops">حفظ</button>
  
  <div class="card mb-4">
    <div class="h4" style="margin-bottom:6px;font-size:13px">تفاصيل طرق الدفع اليدوية</div>
    <p class="caption mb-3">البيانات التي يراها العميل عند الإيداع (رقم الحساب، اسم المستفيد، المحفظة…)، مع زر نسخ.</p>
    ${[['bank', s.m_bank_label || 'تحويل مصرفي'], ['binance', s.m_binance_label || 'Binance Pay']].map(([k, t]) => `
      <div class="sw-row"><div><div class="sw-lbl">${esc(t)}</div><div class="sw-desc">${(s['m_' + k + '_fields'] || []).length} حقول</div></div>
        <button class="btn btn-secondary btn-sm" data-pm-edit="${k}" type="button">تعديل</button></div>`).join('')}
    ${(Array.isArray(s.custom_methods) ? s.custom_methods : []).map((m, i) => `
      <div class="sw-row"><div><div class="sw-lbl">${esc(m.label || 'طريقة')} ${m.on === false ? '<span class="badge badge-neutral">متوقفة</span>' : '<span class="badge badge-success">مفعّلة</span>'}</div>
        <div class="sw-desc">طريقة مخصّصة · سعر ${esc(String(m.rate || 1))} · ${(m.fields || []).length} حقول</div></div>
        <button class="btn btn-secondary btn-sm" data-pm-custom="${i}" type="button">تعديل</button></div>`).join('')}
    <button class="btn btn-primary btn-sm" id="pmAdd" type="button" style="margin-top:10px">+ إضافة طريقة دفع جديدة</button>
  </div>
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

    <p class="caption" style="margin:4px 0 10px">عدد البطاقات يُحدَّد من تبويب «الباقات».</p>
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
  bindRscA();
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

  document.querySelectorAll('[data-ufile]').forEach(b => b.onclick = () => openUserFile(b.dataset.ufile));
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
  document.querySelectorAll('[data-pmlogo]').forEach(inp => inp.onchange = async () => {
    const k = inp.dataset.pmlogo;
    try {
      const data = await compressImg(inp.files[0], 160, 0.85, 60000);
      document.querySelector(`input[data-op="m_${k}_logo"]`).value = data;
      const prev = document.getElementById('pmPrev_' + k);
      if (prev) prev.outerHTML = `<img src="${data}" alt="" id="pmPrev_${k}">`;
      S._dirty = true; toast('أُرفقت الصورة — اضغط حفظ', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  });
  document.querySelectorAll('[data-pm-edit]').forEach(b => b.onclick = () => openMethodEditor('builtin', b.dataset.pmEdit));
  document.querySelectorAll('[data-ctest]').forEach(b => b.onclick = () => runCryptoTest(b));
  document.querySelectorAll('[data-pm-custom]').forEach(b => b.onclick = () => openMethodEditor('custom', Number(b.dataset.pmCustom)));
  onTap('#pmAdd', () => openMethodEditor('custom', -1));
  document.querySelectorAll('[data-pmclear]').forEach(b => b.onclick = () => {
    const k = b.dataset.pmclear;
    document.querySelector(`input[data-op="m_${k}_logo"]`).value = '';
    const prev = document.getElementById('pmPrev_' + k); if (prev) prev.outerHTML = `<span id="pmPrev_${k}">📷</span>`;
    S._dirty = true; toast('ستُحذف الصورة عند الحفظ', 'ok');
  });
  document.querySelectorAll('#view input[data-op], #view textarea[data-op], #view select[data-op]').forEach(el =>
    el.addEventListener('input', () => { S._dirty = true; }));

  if (S.page === 'store') bindStore();
  if (S.page === 'stickers') bindStickers();
  if (S.page === 'merchants') bindMerchants();
  if (S.page === 'settings') bindSettingsExtras();
  if (S.page === 'platforms') bindPlatforms();
  if (S.page === 'mview') bindMview();
  onTap('#usageGo', async () => { try { const r = await api('/api/admin/usage', {}); S.usage = r; render(true); } catch (e) { toast(e.message, 'bad'); } });
  onTap('#funnelGo', async () => { try { const r = await api('/api/admin/funnel', {}); S.funnel = r.funnel; render(true); } catch (e) { toast(e.message, 'bad'); } });
  onTap('#pushOnA', async () => { if (await registerPushToken(false)) render(true); });
  if (pushOn() && !S._pushRef) { S._pushRef = 1; setTimeout(() => registerPushToken(true), 4000); }
  document.querySelectorAll('[data-cbal]').forEach(b => b.onclick = () => openCardBalance(b.dataset.cbal));
  document.querySelectorAll('[data-mcq]').forEach(b => b.onclick = async () => {
    const k = b.dataset.mcq, v = !((S.settings || {})[k] === true);
    b.disabled = true;
    try { await api('/api/admin/settings', { [k]: v }); S.settings = { ...(S.settings || {}), [k]: v }; toast(v ? 'تم التفعيل' : 'تم الإيقاف', 'ok'); render(true); }
    catch (e) { toast(e.message, 'bad'); b.disabled = false; }
  });
  document.querySelectorAll('[data-crep]').forEach(b => b.onclick = () => openCardReplace(b.dataset.crep));
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

/* ═══════════════════════════════════════════════════════════
   v44 — متجر كاردو (Resell Codes) + وضع الصيانة
   ═══════════════════════════════════════════════════════════ */
S.rscA = { loaded: false, tab: 'cats', q: '', onlyOn: false, orders: null };
async function loadRscA(withOrders) {
  try { const r = await api('/api/admin/rsc', { action: 'state' }); S.rscA = { ...S.rscA, ...r, loaded: true, err: '' }; }
  catch (e) { S.rscA = { ...S.rscA, loaded: true, err: e.message }; }
  if (withOrders || S.rscA.tab === 'orders') await loadRscOrdersA(true);
  if (S.page === 'rsc') render(true);
}
async function loadRscOrdersA(silent) {
  try { const r = await api('/api/admin/rsc', { action: 'orders' }); S.rscA.orders = r.orders || []; }
  catch (e) { if (!silent) toast(e.message, 'bad'); }
  if (S.page === 'rsc') render(true);
}
const RSC_ST_A = { submitting: ['badge-warning', 'قيد الإرسال'], created: ['badge-warning', 'قيد التنفيذ'], processing: ['badge-warning', 'قيد التنفيذ'],
  unknown: ['badge-error', 'تحتاج مراجعة'], completed: ['badge-success', 'مكتمل'], refunded: ['badge-neutral', 'مُسترد'] };
function maintCard() {
  const on = S.settings && S.settings.site_maint_on !== false;
  return `<div class="card mb-4" style="border:1px solid ${on ? 'var(--warning)' : 'var(--border)'}">
    <div class="flex-between" style="gap:10px;flex-wrap:wrap">
      <div><div class="h4" style="margin-bottom:4px">🛠️ وضع الصيانة: ${on ? '<span style="color:var(--warning)">مفعّل</span>' : '<span style="color:var(--success)">متوقف — الموقع مفتوح للجميع</span>'}</div>
        <div class="caption">${on ? 'الزوار يرون شاشة الصيانة. أنت (الإدارة) ترى الموقع كاملًا للمعاينة.' : 'كل العملاء يستخدمون الموقع الآن.'}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn btn-secondary btn-sm" href="./index.html" target="_blank" rel="noopener">معاينة الموقع</a>
        <button class="btn btn-sm ${on ? 'btn-primary' : 'btn-secondary'}" id="maintTgl" type="button">${on ? 'افتح الموقع للجميع' : 'فعّل الصيانة'}</button>
      </div>
    </div></div>`;
}
function vRsc() {
  const R = S.rscA;
  if (!R.loaded) { loadRscA(); return `<div class="page-enter"><div class="skeleton" style="height:140px;border-radius:16px"></div></div>`; }
  const low = R.balance != null && R.balance < n(R.low);
  const q = (R.q || '').trim().toLowerCase();
  const stOf = c => !c.on ? 'off' : c.maint ? 'maint' : 'on';
  const flt = R.flt || 'all';
  const tf = R.tf || 'all';
  const cats = (R.cats || []).filter(c => (flt === 'all' || stOf(c) === flt || (flt === 'pick' && c.pick)) && (tf === 'all' || rscGA(c) === tf) && (!q || srchMatch(c.name + ' ' + c.alias + ' ' + c.key, q)))
    .sort((a, b) => (b.on ? 1 : 0) - (a.on ? 1 : 0) || (a.type === 'topup' ? 0 : 1) - (b.type === 'topup' ? 0 : 1) || String(a.alias || a.name).localeCompare(String(b.alias || b.name)));
  const lim = R.lim || 60;
  const sel = S.rscSel || (S.rscSel = new Set());
  const vis = cats.slice(0, lim), allSel = vis.length && vis.every(c => sel.has(c.key));
  const cnt = k => (R.cats || []).filter(c => stOf(c) === k).length;
  const onCount = (R.cats || []).filter(c => c.on).length;
  const imgU = u => !u ? '' : /^\//.test(u) ? API_BASE + u : u;
  return `<div class="page-enter">
    <div class="mb-4"><h1 class="h2" style="margin:0 0 4px;font-family:var(--font-display)">متجر كاردو</h1>
      <p class="caption">الربط مع Resell Codes — الأقسام والأسعار والطلبات</p></div>
    ${!R.key_set ? `<div class="alert alert-error mb-3">${svg(I.warn, 2)}<div><b>المفتاح غير مضاف.</b> أضف السر <code>RSC_API_KEY</code> في Cloudflare ثم حدّث الصفحة.</div></div>` : ''}
    ${R.err || R.error ? `<div class="alert alert-error mb-3">${svg(I.warn, 2)}<div>${esc(R.err || R.error)}</div></div>` : ''}
    <div class="grid-2 mb-3">
      <div class="card card-sm" ${low ? 'style="border:1px solid var(--error)"' : ''}><div class="caption">رصيدك عند المزود</div>
        <div class="h3 tabular" style="margin:4px 0;color:${low ? 'var(--error)' : 'var(--brand)'}">${R.balance == null ? '—' : '$' + n(R.balance).toFixed(2)}</div>
        ${low ? '<div class="caption" style="color:var(--error)">الرصيد منخفض — اشحنه بـ USDT</div>' : '<div class="caption">يُخصم منه عند كل طلب</div>'}</div>
      <div class="card card-sm"><div class="caption">الأقسام المفعّلة</div><div class="h3 tabular" style="margin:4px 0">${onCount}</div>
        <div class="caption">من ${(R.cats || []).length} قسم لدى المزود</div></div>
    </div>
    <div class="card mb-3">
      <div class="flex-between mb-2" style="gap:8px;flex-wrap:wrap">
        <div><div class="h4" style="margin:0">المتجر ظاهر للعملاء</div><div class="caption">إيقافه يخفي المتجر ويمنع الشراء</div></div>
        <button class="btn btn-sm ${R.on ? 'btn-primary' : 'btn-secondary'}" id="rscOn" type="button" style="min-width:80px">${R.on ? 'ظاهر' : 'مخفي'}</button>
      </div>
      <div class="grid-2" style="gap:8px;align-items:end">
        <div class="field"><label class="field-label" for="rscMg">نسبة الربح العامة (%)</label><input class="input tabular" id="rscMg" type="number" min="0" max="300" step="0.5" value="${esc(String(R.margin))}"></div>
        <div class="field"><label class="field-label" for="rscLow">تنبيه إذا قلّ الرصيد عن ($)</label><input class="input tabular" id="rscLow" type="number" min="0" step="1" value="${esc(String(R.low))}"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" id="rscSaveMg" type="button">حفظ</button>
        <button class="btn btn-secondary btn-sm" data-rscauto type="button">✨ تصنيف تلقائي</button>
        <button class="btn btn-secondary btn-sm" id="rscSync" type="button">↻ تحديث الكتالوج من المزود</button>
      </div>
    </div>
    <div class="pills mb-3">
      <button class="pill ${R.tab === 'cats' ? 'active' : ''}" data-rsctab="cats" type="button">الأقسام</button>
      <button class="pill ${R.tab === 'orders' ? 'active' : ''}" data-rsctab="orders" type="button">الطلبات${(R.orders || []).filter(o => o.status === 'unknown').length ? ` <span class="admin-badge">${(R.orders || []).filter(o => o.status === 'unknown').length}</span>` : ''}</button>
    </div>
    ${R.tab === 'cats' ? `
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <input class="input" id="rscQ" placeholder="ابحث في أقسام المزود…" value="${esc(R.q || '')}" style="flex:1">
      </div>
      <div class="pills mb-2" style="flex-wrap:wrap">${[['all', 'الكل', (R.cats || []).length], ['on', 'مفعّل', cnt('on')], ['maint', 'صيانة', cnt('maint')], ['off', 'مخفي', cnt('off')], ['pick', 'مختارات', (R.cats || []).filter(c => c.pick).length]].map(([k, t, nn]) => `<button class="pill ${flt === k ? 'active' : ''}" data-rscflt="${k}" type="button">${t} (${nn})</button>`).join('')}</div>
      <div class="pills mb-2" style="flex-wrap:wrap">${[['all', 'كل الأنواع'], ...RSC_GA.map(([k, t]) => [k, t])].map(([k, t]) => { const nn = k === 'all' ? (R.cats || []).length : (R.cats || []).filter(c => rscGA(c) === k).length; return nn || k === 'all' ? `<button class="pill ${tf === k ? 'active' : ''}" data-rsctf="${k}" type="button">${t} (${nn})</button>` : ''; }).join('')}</div>
      ${q ? `<div class="caption" style="margin:0 2px 6px">${cats.length} نتيجة لـ «${esc(R.q)}»</div>` : ''}
      <label class="rsc-all"><input type="checkbox" data-rscall ${allSel ? 'checked' : ''}><span>تحديد الكل${sel.size ? ` — ${sel.size} محدد` : ''}</span>${sel.size ? '<button type="button" data-rscclr>إلغاء التحديد</button>' : ''}</label>
      <div class="list">${vis.map(c => `
        <div class="list-row" style="cursor:default">
          <input type="checkbox" class="rsc-cb" data-rscsel="${esc(c.key)}" ${sel.has(c.key) ? 'checked' : ''} aria-label="تحديد">
          <div class="list-icon" style="overflow:hidden;padding:0">${c.image ? `<img src="${esc(imgU(c.image))}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover">` : (c.type === 'topup' ? '🎮' : '🎁')}</div>
          <div class="list-content"><div class="list-title">${esc(c.alias || c.name)}${c.alias ? ` <span class="caption">(${esc(c.name)})</span>` : ''}</div>
            <div class="list-meta">${esc(RSC_GT[rscGA(c)])}${c.margin !== '' ? ` · ربح ${esc(String(c.margin))}%` : ''}${c.custom_img ? ' · صورة مخصّصة' : ''}</div>
            ${c.on ? (c.offers > 0 ? `<div class="rsc-vis ${c.maint ? 'w' : 'ok'}">${c.maint ? 'قيد الصيانة' : 'ظاهر للعملاء'} · ${c.offers} باقة</div>`
              : `<div class="rsc-vis bad">${c.offers == null && !c.err ? '⏳ مفعّل لكن أسعاره ما انجابت بعد — ما يبانش للعملاء' : `⚠ ما يبانش للعملاء: ${esc(c.err || 'ما فيه باقات')}`}
                <button type="button" data-rscfetch="${esc(c.key)}">جلب الأسعار الآن</button></div>`) : ''}</div>
          <div class="list-end" style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" data-rscedit="${esc(c.key)}" type="button">تعديل</button>
            <button class="btn btn-sm ${c.on ? (c.maint ? 'btn-secondary' : 'btn-primary') : 'btn-secondary'}" data-rsctgl="${esc(c.key)}" type="button" style="min-width:68px${c.maint ? ';color:var(--warning,#A8650C)' : ''}">${!c.on ? 'مخفي' : c.maint ? 'صيانة' : 'مفعّل'}${c.pick ? ' ✦' : ''}</button>
          </div>
        </div>`).join('') || '<div class="caption" style="padding:16px;text-align:center">لا أقسام — اضغط «تحديث الكتالوج»</div>'}</div>
      ${cats.length > lim ? `<button class="btn btn-secondary btn-block" data-rscmore type="button" style="margin-top:10px">عرض المزيد (${cats.length - lim})</button>` : ''}
      ${sel.size ? `<div class="rsc-bulk"><b>${sel.size} ${sel.size > 10 ? 'قسم' : 'أقسام'} محددة</b>
        <div class="rsc-bb"><button type="button" class="p" data-rscbulk="on">تفعيل</button><button type="button" data-rscbulk="maint">صيانة</button><button type="button" data-rscbulk="off">إخفاء</button></div>
        <div class="rsc-bb2"><button type="button" data-rscmove>↪ نقل إلى…</button><button type="button" data-rscbulk="pick">✦ للمختارات</button><button type="button" data-rscbulk="unpick">شيل من المختارات</button></div>
        ${S.rscProg ? `<div class="rsc-prog">${esc(S.rscProg)}</div>` : ''}</div><div style="height:150px"></div>` : S.rscProg ? `<div class="caption" style="text-align:center;margin-top:10px">${esc(S.rscProg)}</div>` : ''}` : `
      ${R.orders == null ? '<div class="skeleton" style="height:120px;border-radius:14px"></div>' : (R.orders.length ? `<div class="list">${R.orders.map(o => `
        <div class="list-row" style="cursor:default;align-items:flex-start">
          <div class="list-content">
            <div class="list-title">${esc(o.cat_name)} — ${esc(o.offer_name)}${o.qty > 1 ? ' × ' + o.qty : ''}</div>
            <div class="list-meta">${esc(userName(o.uid))} · ${esc(dt(o.created_at))}${o.number ? ' · #' + esc(o.number) : ''}</div>
            ${Object.keys(o.fields || {}).length ? `<div class="caption mono" dir="ltr">${esc(Object.entries(o.fields).map(([k, v]) => k + ': ' + v).join(' · '))}</div>` : ''}
            ${o.fail_reason || o.provider_error ? `<div class="caption" style="color:var(--error)">${esc(o.fail_reason || o.provider_error)}</div>` : ''}
            ${['unknown', 'submitting', 'created', 'processing'].includes(o.status) ? `<div style="display:flex;gap:6px;margin-top:6px">
              <button class="btn btn-secondary btn-sm" data-rscchk="${esc(o.id)}" type="button">إعادة الفحص</button>
              <button class="btn btn-outline-danger btn-sm" data-rscref="${esc(o.id)}" type="button">استرداد للعميل</button></div>` : ''}
          </div>
          <div class="list-end"><div class="list-amount tabular">$${n(o.total_usd).toFixed(2)}</div>
            <div class="caption tabular">ربح $${(n(o.total_usd) - n(o.cost_usd)).toFixed(2)}</div>
            <span class="badge ${(RSC_ST_A[o.status] || ['badge'])[0]}" style="margin-top:4px">${esc((RSC_ST_A[o.status] || ['', o.status])[1])}</span></div>
        </div>`).join('')}</div>` : emptyState(I.box, 'لا طلبات بعد')) }`}
  </div>`;
}
function openRscCatEdit(key) {
  const c = (S.rscA.cats || []).find(x => x.key === key); if (!c) return;
  let img = null;
  modal(`
    <div class="modal-head"><div class="modal-title">${esc(c.name)}</div>
      <button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
    <div class="field mb-3"><label class="field-label" for="rcN">الاسم الظاهر للعملاء (اختياري)</label><input class="input" id="rcN" maxlength="60" value="${esc(c.alias || '')}" placeholder="${esc(c.name)}"></div>
    <div class="grid-2 mb-3">
      <div class="field"><label class="field-label" for="rcM">ربح خاص (%)</label><input class="input tabular" id="rcM" type="number" min="0" max="300" step="0.5" value="${esc(String(c.margin))}" placeholder="العام ${esc(String(S.rscA.margin))}%"></div>
      <div class="field"><label class="field-label" for="rcS">الترتيب</label><input class="input tabular" id="rcS" type="number" value="${esc(String(c.sort))}" placeholder="99"></div>
    </div>
    <div class="arow static" style="padding:4px 0 12px"><span class="art"><b>يظهر في «عروض اليوم»</b><span>بطاقة كبيرة في أعلى المتجر</span></span><button class="asw ${c.featured ? 'on' : ''}" id="rcFeat" type="button"></button></div>
    <div class="arow static" style="padding:4px 0 12px"><span class="art"><b>من «مختارات كاردو»</b><span>تظهر في الرئيسية لين تتجمع طلبات حقيقية</span></span><button class="asw ${c.pick ? 'on' : ''}" id="rcPick" type="button"></button></div>
    <div class="arow static" style="padding:4px 0 12px"><span class="art"><b>قيد الصيانة</b><span>يبان للعميل باهت وما يقدرش يشتري</span></span><button class="asw ${c.maint ? 'on' : ''}" id="rcMaint" type="button"></button></div>
    <div class="field mb-3"><label class="field-label" for="rcP">نص العرض (اختياري)</label><input class="input" id="rcP" maxlength="70" value="${esc(c.promo || '')}" placeholder="مثال: 660 UC بـ 118 د.ل بدل 125"></div>
    <div class="field mb-3"><label class="field-label" for="rcG">التصنيف</label><select class="input" id="rcG">
      ${RSC_GA.map(([k, t]) => `<option value="${k}" ${rscGA(c) === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="field mb-3"><label class="field-label">صورة القسم</label>
      <div style="display:flex;gap:10px;align-items:center">
        <span id="rcPrev" style="width:64px;height:64px;border-radius:14px;overflow:hidden;background:var(--surface-2);display:grid;place-items:center">${c.image ? `<img src="${esc(/^\//.test(c.image) ? API_BASE + c.image : c.image)}" style="width:100%;height:100%;object-fit:cover">` : '📷'}</span>
        <input type="file" id="rcF" accept="image/*" style="flex:1">
      </div>
      ${c.custom_img ? '<button class="btn btn-ghost btn-sm" id="rcClr" type="button" style="padding:0;margin-top:6px">إرجاع صورة المزود</button>' : '<div class="caption" style="margin-top:4px">الصورة الحالية من المزود — ارفع صورة لتغييرها</div>'}
    </div>
    <button class="btn btn-primary btn-block" id="rcGo" type="button">حفظ</button>`);
  $('#rcF').onchange = async () => {
    try { img = await compressImg($('#rcF').files[0], 480, 0.82, 120000); $('#rcPrev').innerHTML = `<img src="${img}" style="width:100%;height:100%;object-fit:cover">`; } catch (e) { toast(e.message, 'bad'); }
  };
  onTap('#rcFeat', () => $('#rcFeat').classList.toggle('on'));
  onTap('#rcPick', () => $('#rcPick').classList.toggle('on'));
  onTap('#rcMaint', () => $('#rcMaint').classList.toggle('on'));
  onTap('#rcClr', () => { img = ''; $('#rcPrev').innerHTML = '📷'; toast('ستُستخدم صورة المزود عند الحفظ', 'ok'); });
  onTap('#rcGo', async () => {
    const body = { action: 'cat', key, name: $('#rcN').value.trim(), margin: $('#rcM').value.trim(), sort: $('#rcS').value.trim(), featured: $('#rcFeat').classList.contains('on'), pick: $('#rcPick').classList.contains('on'), maint: $('#rcMaint').classList.contains('on'), promo: $('#rcP').value.trim(), group: $('#rcG').value };
    if (img !== null) body.image = img;
    const b = $('#rcGo'); b.disabled = true;
    try { await api('/api/admin/rsc', body); closeModal(); toast('حُفظ ✓', 'ok'); loadRscA(); }
    catch (e) { toast(e.message, 'bad'); b.disabled = false; }
  });
}
function bindRscA() {
  onTap('#maintTgl', async () => {
    const on = S.settings && S.settings.site_maint_on !== false;
    if (!confirm(on ? 'فتح الموقع لكل العملاء الآن؟' : 'تفعيل الصيانة؟ العملاء سيرون شاشة الصيانة.')) return;
    try { await api('/api/admin/settings', { site_maint_on: !on }); S.settings = { ...S.settings, site_maint_on: !on }; toast(on ? 'الموقع مفتوح للجميع ✓' : 'الصيانة مفعّلة', 'ok'); render(true); }
    catch (e) { toast(e.message, 'bad'); }
  });
  if (S.page !== 'rsc') return;
  document.querySelectorAll('[data-rsctab]').forEach(b => b.onclick = () => { S.rscA.tab = b.dataset.rsctab; if (S.rscA.tab === 'orders') loadRscOrdersA(); render(true); });
  document.querySelectorAll('[data-rscedit]').forEach(b => b.onclick = () => openRscCatEdit(b.dataset.rscedit));
  document.querySelectorAll('[data-rsctgl]').forEach(b => b.onclick = async () => {
    const c = (S.rscA.cats || []).find(x => x.key === b.dataset.rsctgl); if (!c) return;
    b.disabled = true; b.textContent = '…';
    try { await rscBulk([c.key], c.on ? 'off' : 'on'); }
    catch (e) { toast(e.message, 'bad'); b.disabled = false; }
  });
  document.querySelectorAll('[data-rscchk]').forEach(b => b.onclick = async () => {
    const o = (S.rscA.orders || []).find(x => x.id === b.dataset.rscchk); if (!o) return;
    let number = o.number;
    if (!number) { number = prompt('رقم الطلب لدى المزود (من لوحة Resell Codes):', ''); if (!number) return; }
    try { await api('/api/admin/rsc', { action: 'order', id: o.id, op: 'recheck', number: o.number ? undefined : number }); toast('حُدّثت حالة الطلب', 'ok'); loadRscOrdersA(); }
    catch (e) { toast(e.message, 'bad'); }
  });
  document.querySelectorAll('[data-rscref]').forEach(b => b.onclick = async () => {
    if (!confirm('إرجاع المبلغ لمحفظة العميل وإغلاق الطلب؟ تأكد أن الطلب لم يُنفَّذ لدى المزود.')) return;
    try { await api('/api/admin/rsc', { action: 'order', id: b.dataset.rscref, op: 'refund' }); toast('أُعيد المبلغ للعميل ✓', 'ok'); loadRscOrdersA(); }
    catch (e) { toast(e.message, 'bad'); }
  });
  const q = $('#rscQ'); if (q) q.oninput = () => {                // v57: البحث يشتغل وأنت تكتب (كان يستنى لين تطلع من الخانة)
    S.rscA.q = q.value; S.rscA.lim = 60; clearTimeout(window._rscQT);
    window._rscQT = setTimeout(() => { const pos = q.selectionStart; render(true); const n2 = $('#rscQ'); if (n2) { n2.focus(); try { n2.setSelectionRange(pos, pos); } catch {} } }, 180);
  };
  onTap('#rscOn', async () => {
    try { await api('/api/admin/settings', { rsc_on: !S.rscA.on }); S.rscA.on = !S.rscA.on; toast('حُفظ ✓', 'ok'); render(true); } catch (e) { toast(e.message, 'bad'); }
  });
  onTap('#rscSaveMg', async () => {
    try { await api('/api/admin/settings', { rsc_margin_pct: n($('#rscMg').value), rsc_low_usd: n($('#rscLow').value) }); toast('حُفظ ✓ — الأسعار تتحدث خلال دقيقتين', 'ok'); loadRscA(); } catch (e) { toast(e.message, 'bad'); }
  });
  onTap('#rscSync', async () => {
    const b = $('#rscSync'); b.disabled = true; b.textContent = 'جارٍ التحديث…';
    try { const r = await api('/api/admin/rsc', { action: 'sync' }, 60000); toast(`تم: ${r.cats} قسم، وحُدّثت عروض ${r.refreshed} قسم مفعّل`, 'ok'); await loadRscA(); }
    catch (e) { toast(e.message, 'bad'); b.disabled = false; b.textContent = '↻ تحديث الكتالوج من المزود'; }
  });
}

/* ═══ v48 — البحث عن صاحب إيداع USDT ═══ */
const UF_ST = { awaiting: ['badge-warning', 'بانتظار الدفع'], expired: ['badge-neutral', 'انتهت مهلتها'], paid: ['badge-success', 'أُضيف الرصيد'] };
function ufResults(r) {
  return `<div style="margin-top:12px">
    ${r.txid_used ? `<div class="alert alert-success mb-2">${svg(I.check)}<div>هذه المعاملة <b>انحسبت قبل</b> لـ ${esc(r.txid_used.name || r.txid_used.email || r.txid_used.uid)} (${esc(String(r.txid_used.amount))}$)</div></div>` : ''}
    ${r.near && r.invoices.length ? '<div class="caption mb-2">ما لقيت المبلغ بالضبط — هذي فواتير بمبالغ قريبة:</div>' : ''}
    ${r.invoices.length ? `<div class="list">${r.invoices.map(v => `
      <div class="list-row" style="cursor:default;align-items:flex-start">
        <div class="list-content">
          <div class="list-title">${esc(v.name || '—')} <span class="caption" dir="ltr">${esc(v.email)}</span></div>
          <div class="list-meta" dir="ltr" style="text-align:right">${esc(String(v.pay_amount))} USDT · ${esc(v.network.toUpperCase())} · ${esc(dt(v.created_at))}${v.phone ? ' · 0' + esc(v.phone) : ''}</div>
          ${v.status !== 'paid' ? `<button class="btn btn-primary btn-sm" data-ufcredit="${esc(v.id)}" type="button" style="margin-top:8px">تحقق من البلوكشين وأضف الرصيد</button>` : ''}
        </div>
        <div class="list-end"><span class="badge ${(UF_ST[v.status] || ['badge'])[0]}">${esc((UF_ST[v.status] || ['', v.status])[1])}</span></div>
      </div>`).join('')}</div>` : (!r.txid_used ? '<div class="caption" style="color:var(--error)">ما فيش فاتورة بهذا المبلغ — المرسل غالبًا حوّل بدون ما يفتح طلب إيداع في الموقع.</div>' : '')}
  </div>`;
}
document.addEventListener('click', async e => {
  const go = e.target.closest && e.target.closest('#ufGo');
  const cr = e.target.closest && e.target.closest('[data-ufcredit]');
  if (go) {
    const amount = ($('#ufAmt').value || '').trim(), txid = ($('#ufTx').value || '').trim();
    go.disabled = true;
    try { const r = await api('/api/admin/usdt/find', { amount, txid }); S.uf = { amount, txid, res: r }; render(true); }
    catch (err) { toast(err.message, 'bad'); go.disabled = false; }
  }
  if (cr) {
    if (!confirm('نفحص البلوكشين، ولو لقينا التحويل نضيف الرصيد لصاحب الفاتورة. نكمل؟')) return;
    cr.disabled = true; cr.textContent = 'جارٍ الفحص…';
    try {
      const r = await api('/api/admin/usdt/credit', { invoice_id: cr.dataset.ufcredit });
      if (r.paid) { toast(r.already ? 'الرصيد مضاف من قبل ✓' : `أُضيف ${r.credited}$ لصاحب الفاتورة ✓`, 'ok'); S.uf = null; render(true); }
      else { toast(r.duplicate ? 'هذا التحويل محسوب لفاتورة ثانية' : 'ما لقينا التحويل على البلوكشين لهذه الفاتورة', 'bad'); cr.disabled = false; cr.textContent = 'تحقق من البلوكشين وأضف الرصيد'; }
    } catch (err) { toast(err.message, 'bad'); cr.disabled = false; cr.textContent = 'تحقق من البلوكشين وأضف الرصيد'; }
  }
});

/* ═══ v49 — الفواتير والتحويلات غير المطابقة وتحكم طرق الدفع ═══ */
const INVA_ST = { awaiting: ['badge-warning', 'بانتظار'], cancelled: ['badge-neutral', 'ملغاة'], paid: ['badge-success', 'مدفوعة'], expired: ['badge-neutral', 'منتهية'], cancelled_closed: ['badge-neutral', 'ملغاة'] };
function pmKeys() {
  const st = S.settings || {};
  const list = [['trc20', 'USDT TRC20'], ['bep20', 'USDT BEP20'], ['polygon', 'USDT Polygon'], ['binance_pay', 'Binance Pay'], ['libyana', 'ليبيانا'], ['almadar', 'المدار'], ['bank', st.m_bank_label || 'تحويل مصرفي'], ['binance', st.m_binance_label || 'Binance (يدوي)']];
  (Array.isArray(st.custom_methods) ? st.custom_methods : []).forEach((m, i) => {
    if (!m || !m.label) return;
    list.push([String(m.key || `custom${i}`).replace(/[^a-z0-9_]/gi, '').slice(0, 20) || `custom${i}`, m.label]);
  });
  return list;
}
function pausedSet() { return new Set(String((S.settings || {}).paused_methods || '').split(',').map(x => x.trim()).filter(Boolean)); }
async function loadInvA() {
  if (S.invA && S.invA.loading) return;
  S.invA = { ...(S.invA || {}), loading: true };
  try {
    const [a, b] = await Promise.all([api('/api/admin/invoices', { days: S.invA.days || 1, q: S.invA.q || '' }), api('/api/admin/crypto/unmatched', { action: 'list' }).catch(() => ({ items: [] }))]);
    S.invA = { ...S.invA, loading: false, stats: a.stats, list: a.invoices || [], unm: b.items || [] };
  } catch (e) { S.invA = { ...S.invA, loading: false, err: e.message }; }
  render(true);
}
function invAdminHtml(part) {
  if (!S.invA) { S.invA = { days: 1 }; setTimeout(loadInvA, 0); }
  const A = S.invA, st = A.stats || {}, ps = pausedSet(), set = S.settings || {};
  const parts = [`
  <div class="card mb-3">
    <div class="flex-between" style="margin-bottom:10px"><div class="h4" style="margin:0">فواتير الشحن</div>
      <div class="pills" style="margin:0">${[[1, 'اليوم'], [7, '7 أيام'], [30, '30 يوم']].map(([d, t]) => `<button class="pill ${(A.days || 1) === d ? 'active' : ''}" data-invdays="${d}" type="button">${t}</button>`).join('')}</div></div>
    ${A.err ? `<div class="caption" style="color:var(--error)">${esc(A.err)}</div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">
      ${[['فُتحت', st.opened], ['دُفعت', st.paid], ['مفتوحة', st.open], ['المحصّل', st.sum_paid != null ? usd(st.sum_paid) : '—']].map(([t, v]) => `<div style="background:var(--surface-2);border-radius:12px;padding:10px;text-align:center"><div class="caption">${t}</div><div class="tabular" style="font-weight:700;font-size:16px">${A.loading && v == null ? '…' : esc(String(v ?? 0))}</div></div>`).join('')}
    </div>
    ${st.by_net && Object.keys(st.by_net).length ? `<div class="caption mb-2">${Object.entries(st.by_net).map(([k, v]) => `${esc(k.toUpperCase())}: ${esc(usd(v))}`).join(' · ')}</div>` : ''}
    <div style="display:flex;gap:8px;margin-bottom:10px"><input class="input" id="invQ" placeholder="رقم الفاتورة / الاسم / البريد / المبلغ" value="${esc(A.q || '')}" style="flex:1"><button class="btn btn-secondary btn-sm" id="invQGo" type="button">بحث</button></div>
    ${(A.list || []).length ? `<div class="table-wrap"><table class="table"><thead><tr><th>الفاتورة</th><th>العميل</th><th>المبلغ</th><th>الطريقة</th><th>الحالة</th><th>الوقت</th></tr></thead><tbody>
      ${A.list.map(v => `<tr><td class="tabular" dir="ltr">${esc(v.no)}</td><td>${esc(v.name || '—')}<div class="caption" dir="ltr">${esc(v.email)}</div></td>
        <td class="tabular" dir="ltr">${esc(Number(v.pay_amount).toFixed(4))}${v.status === 'paid' ? `<div class="caption">+${esc(usd(v.received))}</div>` : ''}</td><td>${esc(v.network_label)}</td>
        <td><span class="badge ${(INVA_ST[v.status] || ['badge'])[0]}">${esc((INVA_ST[v.status] || ['', v.status])[1])}</span>${v.late ? ' <span class="badge badge-warning">متأخرة</span>' : ''}${v.paid_by && v.paid_by !== 'user' && v.paid_by !== 'cron' ? ' <span class="badge">يدوي</span>' : ''}</td>
        <td class="caption">${esc(dt(new Date(v.created_ms).toISOString()))}</td></tr>`).join('')}</tbody></table></div>` : `<div class="caption">${A.loading ? 'جارٍ التحميل…' : 'لا فواتير في هذه الفترة'}</div>`}
  </div>`, `
  <div class="card mb-3">
    <div class="h4" style="margin-bottom:4px">تحويلات تحتاج مراجعة ${(A.unm || []).length ? `<span class="badge badge-warning">${A.unm.length}</span>` : ''}</div>
    <p class="caption" style="margin-bottom:10px">تحويلات وصلت لحساب Binance بمبلغ ما يطابق أي فاتورة (حوّل مبلغ غلط، أو بدون فاتورة).</p>
    ${(A.unm || []).length ? `<div class="list">${A.unm.map(u => `
      <div class="list-row" style="cursor:default;align-items:flex-start"><div class="list-content">
        <div class="list-title tabular" dir="ltr" style="text-align:right">${esc(String(u.amount))} USDT · ${esc(String(u.network || '').toUpperCase())}</div>
        <div class="list-meta">${u.kind === 'mismatch' ? 'مبلغ قريب من فاتورة' : 'بدون فاتورة'} · ${esc(dt(u.at_ms ? new Date(u.at_ms).toISOString() : u.created_at))}${u.txid ? ` · <span dir="ltr">${esc(String(u.txid).slice(0, 10))}…</span>` : ''}</div>
        ${u.candidate && u.candidate_user ? `<div class="caption" style="margin-top:4px">مرشّح: <b>${esc(u.candidate_user.name || '—')}</b> <span dir="ltr">${esc(u.candidate_user.email)}</span> — فاتورة ${esc(String(u.candidate.pay_amount))}${u.candidate.status === 'paid' ? ' (مدفوعة سابقًا)' : ''}</div>` : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
          ${u.candidate && u.candidate.invoice_id && u.candidate.status !== 'paid' ? `<button class="btn btn-primary btn-sm" data-unm-inv="${esc(u.id)}" data-inv="${esc(u.candidate.invoice_id)}" type="button">أضِف للمرشّح</button>` : ''}
          <button class="btn btn-secondary btn-sm" data-unm-email="${esc(u.id)}" type="button">أضِف ببريد مستخدم</button>
          <button class="btn btn-ghost btn-sm" data-unm-ign="${esc(u.id)}" type="button">تجاهل</button>
        </div></div></div>`).join('')}</div>` : `<div class="caption">${A.loading ? 'جارٍ التحميل…' : 'لا شيء يحتاج مراجعة ✓'}</div>`}
  </div>`, `
  <div class="card mb-3">
    <div class="h4" style="margin-bottom:4px">حالة طرق الدفع</div>
    <p class="caption" style="margin-bottom:8px">أوقف طريقة مؤقتًا (تظهر للعميل «متوقفة مؤقتًا») بدون ما تلغي إعداداتها.</p>
    ${pmKeys().map(([k, t]) => `<div class="sw-row"><div><div class="sw-lbl">${esc(t)}</div><div class="sw-desc" dir="ltr" style="text-align:right">${esc(k)}</div></div>
      <button class="btn btn-sm ${ps.has(k) ? 'btn-primary' : 'btn-secondary'}" data-pmpause="${esc(k)}" type="button">${ps.has(k) ? 'متوقفة — شغّل' : 'تعمل — أوقف'}</button></div>`).join('')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">
      <label class="field"><span class="field-label">سقف الحساب الجديد يوميًا ($)</span><input class="input" id="naMax" type="number" min="0" value="${esc(String(set.new_acct_crypto_max ?? 50))}"></label>
      <label class="field"><span class="field-label">لأول كم يوم</span><input class="input" id="naDays" type="number" min="0" value="${esc(String(set.new_acct_days ?? 7))}"></label>
    </div>
    <button class="btn btn-secondary btn-sm" id="naSave" type="button" style="margin-top:8px">حفظ السقف</button>
    <div class="sw-row" style="margin-top:14px"><div><div class="sw-lbl">QR حساب Binance Pay</div><div class="sw-desc">${set.binance_pay_qr_v ? 'مرفوع ✓' : 'غير مرفوع — يظهر Pay ID فقط'}</div></div>
      <div style="display:flex;gap:6px">${set.binance_pay_qr_v ? `<img src="${esc(API_BASE)}/bpq?v=${esc(String(set.binance_pay_qr_v))}" alt="" style="width:44px;height:44px;border-radius:8px;background:#fff;object-fit:contain">` : ''}
        <label class="btn btn-secondary btn-sm" style="cursor:pointer">رفع<input type="file" id="bpqFile" accept="image/png,image/jpeg,image/webp" hidden></label>
        ${set.binance_pay_qr_v ? '<button class="btn btn-ghost btn-sm" id="bpqDel" type="button">حذف</button>' : ''}</div></div>
  </div>`];
  return part == null ? parts.join('') : parts[part];
}
document.addEventListener('click', async e => {
  const t = e.target.closest ? e.target : null; if (!t) return;
  const dd = t.closest('[data-invdays]');
  if (dd) { S.invA = { ...(S.invA || {}), days: Number(dd.dataset.invdays) }; loadInvA(); return; }
  if (t.closest('#invQGo')) { S.invA = { ...(S.invA || {}), q: ($('#invQ').value || '').trim() }; loadInvA(); return; }
  const pz = t.closest('[data-pmpause]');
  if (pz) {
    const ps = pausedSet(), k = pz.dataset.pmpause;
    if (ps.has(k)) ps.delete(k); else { if (!confirm('إيقاف هذه الطريقة مؤقتًا؟')) return; ps.add(k); }
    const v = [...ps].join(',');
    pz.disabled = true;
    try { await api('/api/admin/settings', { paused_methods: v }); S.settings = { ...(S.settings || {}), paused_methods: v }; toast('حُفظ ✓', 'ok'); render(true); }
    catch (err) { toast(err.message, 'bad'); pz.disabled = false; }
    return;
  }
  if (t.closest('#naSave')) {
    const patch = { new_acct_crypto_max: Math.max(0, Number($('#naMax').value) || 0), new_acct_days: Math.max(0, Math.floor(Number($('#naDays').value) || 0)) };
    try { await api('/api/admin/settings', patch); S.settings = { ...(S.settings || {}), ...patch }; toast('حُفظ ✓', 'ok'); } catch (err) { toast(err.message, 'bad'); }
    return;
  }
  if (t.closest('#bpqDel')) {
    if (!confirm('حذف صورة QR؟')) return;
    try { await api('/api/admin/binance-qr', { image: '' }); S.settings = { ...(S.settings || {}), binance_pay_qr_v: 0 }; toast('حُذفت', 'ok'); render(true); } catch (err) { toast(err.message, 'bad'); }
    return;
  }
  const ui = t.closest('[data-unm-inv]'), ue = t.closest('[data-unm-email]'), ug = t.closest('[data-unm-ign]');
  if (ui || ue || ug) {
    const id = (ui || ue || ug).dataset.unmInv || (ui || ue || ug).dataset.unmEmail || (ui || ue || ug).dataset.unmIgn;
    let body;
    if (ug) { if (!confirm('تجاهل هذا التحويل؟')) return; body = { action: 'ignore', id }; }
    else if (ui) { if (!confirm('نضيف المبلغ لصاحب الفاتورة المرشّحة؟')) return; body = { action: 'assign', id, invoice_id: ui.dataset.inv }; }
    else { const email = (prompt('بريد المستخدم اللي نضيفله المبلغ:') || '').trim(); if (!email) return; if (!confirm(`نضيف المبلغ لـ ${email}؟`)) return; body = { action: 'assign', id, email }; }
    (ui || ue || ug).disabled = true;
    try { const r = await api('/api/admin/crypto/unmatched', body); toast(r.credited ? `أُضيف ${r.credited}$ ✓` : 'تم ✓', 'ok'); loadInvA(); }
    catch (err) { toast(err.message, 'bad'); (ui || ue || ug).disabled = false; }
  }
});
document.addEventListener('change', async e => {
  if (!e.target || e.target.id !== 'bpqFile') return;
  try {
    const img = await compressImg(e.target.files[0], 700, 0.9, 280000);
    await api('/api/admin/binance-qr', { image: img });
    S.settings = { ...(S.settings || {}), binance_pay_qr_v: Date.now() }; toast('رُفعت صورة QR ✓', 'ok'); render(true);
  } catch (err) { toast(err.message, 'bad'); }
});

/* ═══════════════════════════════════════════════════════════
   v51 — لوحة الإدارة الجديدة: الرئيسية، المال، العملاء، المزيد، طرق الدفع
   البيانات من ملخص واحد بالخادم (/api/admin/overview) بدل الاشتراك في المجموعات
   ═══════════════════════════════════════════════════════════ */
Object.assign(I, {
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z"/>',
  tool: '<path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.5-2.5z"/>',
  db: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
  log: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  tag: '<path d="M3.5 12.5V4.5h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.5"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  down: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 20h14"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  chev: '<path d="m14 6-6 6 6 6"/>',
  back: '<path d="m10 6 6 6-6 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  img2: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10 18.5h4"/>',
});

/* ─── الملخص ─── */
S.ov = null;
let _ovT = null, _ovBusy = false;
async function loadOverview(fresh) {
  if (_ovBusy || !S.admin) return;
  _ovBusy = true;
  try { S.ov = await api('/api/admin/overview', fresh ? { fresh: true } : {}); render(); }
  catch (e) { console.warn('overview', e.message); }
  finally { _ovBusy = false; }
}
function ovSoon(ms = 1200) { clearTimeout(_ovT); _ovT = setTimeout(() => loadOverview(true), ms); }
setInterval(() => { if (document.visibilityState === 'visible' && !kIdle()) loadOverview(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.admin) loadOverview(); });
const ovA = k => n(S.ov && S.ov.attn && S.ov.attn[k]);

/* ─── التبويبات ─── */
const MON_TABS = [['review', 'مراجعة', 'deposits'], ['invoices', 'الفواتير', 'deposits'], ['withdraw', 'سحوبات', 'withdraw'], ['sms', 'SMS', 'sms']];
const monTabs = () => MON_TABS.filter(([, , sec]) => can(sec, 'view'));
const moneyBadge = () => ovA('deposits') + ovA('unmatched') + ovA('withdrawals') + ovA('sms');

/* ─── الشريط العلوي: تبديل المظهر ─── */
function themeNow() { return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
document.addEventListener('click', e => {
  const t = e.target.closest && e.target.closest('[data-theme-toggle]');
  if (!t) return;
  try { localStorage.setItem('kardo_theme', themeNow() === 'dark' ? 'light' : 'dark'); } catch {}
  if (window.kardoTheme) window.kardoTheme();
  t.innerHTML = svg(themeNow() === 'dark' ? I.sun : I.moon);
});

/* ─── عناصر مشتركة ─── */
const aHead = (t, sub, end = '') => `<div class="ah"><div><h1>${esc(t)}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${end}</div>`;
const aRow = (o) => `<button class="arow" type="button" ${o.attrs || ''}><span class="aric ${o.c || ''}">${svg(o.i)}</span>
  <span class="art"><b>${o.t}</b>${o.s ? `<span>${o.s}</span>` : ''}</span>${o.cnt ? `<span class="acnt ${o.cc || ''}">${o.cnt}</span>` : ''}${o.end || ''}<span class="achev">${svg(I.chev)}</span></button>`;
const aSw = (key, on, extra = '') => `<button class="asw ${on ? 'on' : ''}" data-aswitch="${esc(key)}" ${extra} type="button" aria-pressed="${on ? 'true' : 'false'}"></button>`;

/* ═══ الرئيسية ═══ */
function vHome2() {
  if (!S.ov) setTimeout(() => loadOverview(), 0);
  const o = S.ov || { attn: {}, today: {}, yesterday: {} }, A = o.attn || {}, T = o.today || {};
  const name = String((S.admin && (S.admin.name || '')) || (auth.currentUser && auth.currentUser.displayName) || '').split(' ')[0];
  const hr = new Date().getHours(), greet = hr < 12 ? 'صباح الخير' : 'مساء الخير';
  const sk = v => S.ov ? esc(String(v)) : '<i class="ask"></i>';
  const items = [
    can('deposits', 'view') && A.deposits ? { i: I.receipt, c: 'g', t: 'إيداعات للمراجعة', s: `بقيمة ${usd(A.deposits_usd)}`, cnt: A.deposits, attrs: 'data-mgo="review"' } : null,
    can('deposits', 'view') && A.unmatched ? { i: I.warn, c: 'r', cc: 'r', t: 'تحويل ما يطابق فاتورة', s: 'وصل لحساب Binance — حدّد صاحبه', cnt: A.unmatched, attrs: 'data-mgo="review"' } : null,
    can('orders', 'view') && A.rsc ? { i: I.box, c: 'w', t: 'طلب متجر يحتاج متابعة', s: 'المزود ما أكّدش التنفيذ', cnt: A.rsc, attrs: 'data-nav="rsc"' } : null,
    can('withdraw', 'view') && A.withdrawals ? { i: I.withdraw, c: 'g', t: 'سحوبات معلّقة', cnt: A.withdrawals, attrs: 'data-mgo="withdraw"' } : null,
    can('sms', 'view') && A.sms ? { i: I.sms, c: 'w', t: 'رسائل تحويل للمراجعة', s: 'فوق حد التلقائي أو مرسل غير معروف', cnt: A.sms, attrs: 'data-mgo="sms"' } : null,
    can('tickets', 'view') && A.tickets ? { i: I.chat, t: 'تذاكر مفتوحة', cnt: A.tickets, attrs: 'data-nav="tickets"' } : null,
    can('mcards', 'view') && A.mcards ? { i: I.card, c: 'g', t: 'طلبات بطاقات', cnt: A.mcards, attrs: 'data-nav="mcards"' } : null,
  ].filter(Boolean);
  const trend = T.sales != null && o.yesterday && o.yesterday.sales ? Math.round((T.sales - o.yesterday.sales) / o.yesterday.sales * 100) : null;
  const st = S.settings || {};
  return `<div class="page-enter astag">
    <div class="ah"><div><h1>${greet}${name ? '، ' + esc(name) : ''}</h1><p>${esc(new Date().toLocaleDateString('ar-LY', { weekday: 'long', day: 'numeric', month: 'long' }))}</p></div>
      ${pushOn() ? '' : `<button class="abtn sm" id="pushOnA" type="button">${svg(I.bell)}الإشعارات</button>`}</div>
    ${st.site_maint_on === true && isSuperAdmin() ? `<div class="aalert w">${svg(I.tool)}<div><b>وضع الصيانة مفعّل</b> — الزوار يشوفوا شاشة الصيانة. <button class="alink" data-aswitch="site_maint_on" type="button">افتح الموقع للجميع</button></div></div>` : ''}
    ${st.kill_switch === true ? `<div class="aalert r">${svg(I.warn)}<div><b>المنصة متوقفة</b> — العملاء ما يقدروش يشتروا. <button class="alink" data-nav="settings" type="button">الإعدادات</button></div></div>` : ''}
    <div class="alabel"><span>يحتاج انتباهك</span>${S.ov ? `<span class="caption">آخر تحديث ${esc(new Date(o.at).toLocaleTimeString('ar-LY', { hour: '2-digit', minute: '2-digit' }))}</span>` : ''}</div>
    <div class="acard">${!S.ov ? '<div class="arow"><i class="ask" style="width:60%"></i></div>'.repeat(3) : items.length ? items.map(aRow).join('') : `<div class="aempty">${svg(I.check)}<b>كل شي تمام</b><span>ما فيش حاجة تنتظرك توا</span></div>`}</div>
    <div class="alabel"><span>اليوم</span></div>
    <div class="akpis">
      ${can('orders', 'view') ? `<div class="acard akpi"><span>${svg(I.bag)}مبيعات المتجر</span><b>${S.ov ? esc(usd(T.sales)) : sk()}</b><em class="${trend != null && trend < 0 ? 'neg' : ''}">${trend != null ? (trend >= 0 ? '↑ ' : '↓ ') + Math.abs(trend) + '% عن أمس' : esc(String(n(T.orders))) + ' طلب'}</em></div>
      <div class="acard akpi"><span>${svg(I.trend)}الربح</span><b>${S.ov ? esc(usd(T.profit)) : sk()}</b><em>${o.rsc_balance != null ? 'رصيد المزود ' + esc(usd(o.rsc_balance)) : 'من طلبات اليوم'}</em></div>` : ''}
      ${can('deposits', 'view') ? `<div class="acard akpi"><span>${svg(I.down)}الشحن</span><b>${S.ov ? esc(usd(T.deposits)) : sk()}</b><em>${esc(String(n(T.invoices_paid)))} فاتورة مدفوعة</em></div>` : ''}
      ${can('users', 'view') ? `<div class="acard akpi"><span>${svg(I.user)}عملاء جدد</span><b>${S.ov ? esc(String(n(T.users))) : sk()}</b><em>${esc(String(n(T.users_verified)))} وثّقوا رقمهم</em></div>` : ''}
    </div>
    ${isSuperAdmin() ? `<div class="alabel"><span>تحكم سريع</span></div>
    <div class="acard">
      <div class="arow static"><span class="art"><b>المتجر ظاهر للعملاء</b><span>${o.rsc_balance != null ? 'رصيد المزود ' + esc(usd(o.rsc_balance)) : 'متجر كاردو'}</span></span>${aSw('rsc_on', st.rsc_on !== false)}</div>
      <div class="arow static"><span class="art"><b>الشحن بالعملات الرقمية</b><span>Binance Pay · TRC20 · BEP20</span></span>${aSw('m_usdt_on', st.m_usdt_on === true)}</div>
      <div class="arow static"><span class="art"><b>وضع الصيانة</b><span>الزوار يشوفوا شاشة الصيانة</span></span>${aSw('site_maint_on', st.site_maint_on === true, 'data-warn="1"')}</div>
    </div>` : ''}
  </div>`;
}

/* ═══ المال ═══ */
function vMoney() {
  const tabs = monTabs();
  if (!tabs.find(t => t[0] === S.monTab)) S.monTab = tabs[0] ? tabs[0][0] : 'review';
  const cnt = { review: ovA('deposits') + ovA('unmatched'), withdraw: ovA('withdrawals'), sms: ovA('sms') };
  let body = '';
  if (S.monTab === 'review') {
    const pend = (S.deposits || []).filter(d => d.status === 'pending');
    if (!S.invA) { S.invA = { days: 1 }; setTimeout(loadInvA, 0); }
    const unm = (S.invA && S.invA.unm) || [];
    body = `${unm.length ? `<div class="alabel"><span>تحويلات ما تطابق فاتورة</span><span class="caption">${unm.length}</span></div>` + unm.map(u => `<div class="acard arv" style="border-color:var(--u-err)">
        <div class="arv-h"><span class="aric r">${svg(I.warn)}</span><span class="art"><b>${u.kind === 'mismatch' ? 'مبلغ قريب من فاتورة' : 'تحويل بدون فاتورة'}</b>
          <span>${esc(String(u.network || '').toUpperCase())} · ${esc(dt(u.at_ms ? new Date(u.at_ms).toISOString() : u.created_at))}${u.txid ? ` · <span dir="ltr">${esc(String(u.txid).slice(0, 10))}…</span>` : ''}</span></span>
          <span class="aamt"><b>${esc(String(u.amount))}</b><small>USDT</small></span></div>
        <div class="achips">${u.candidate && u.candidate_user ? `<span class="achip g">أقرب فاتورة: ${esc(u.candidate_user.name || u.candidate_user.email || '—')} · ${esc(String(u.candidate.pay_amount))}</span>${u.candidate.diff != null ? `<span class="achip">فرق ${esc(String(Math.abs(u.candidate.diff)))}</span>` : ''}${u.candidate.status === 'paid' ? '<span class="achip w">الفاتورة مدفوعة سابقًا</span>' : ''}` : '<span class="achip">ما فيش فاتورة قريبة</span>'}${u.from ? `<span class="achip">من ${esc(u.from)}</span>` : ''}</div>
        <div style="display:grid;grid-template-columns:${u.candidate && u.candidate.invoice_id && u.candidate.status !== 'paid' ? '1fr 1fr auto' : '1fr auto'};gap:8px">
          ${u.candidate && u.candidate.invoice_id && u.candidate.status !== 'paid' ? `<button class="abtn p" data-unm-inv="${esc(u.id)}" data-inv="${esc(u.candidate.invoice_id)}" type="button">${svg(I.check)}أضف لـ${esc((u.candidate_user && u.candidate_user.name || 'المرشّح').split(' ')[0])}</button>` : ''}
          <button class="abtn" data-unm-email="${esc(u.id)}" type="button">ببريد مستخدم</button>
          <button class="abtn" data-unm-ign="${esc(u.id)}" type="button" style="color:var(--u-ink-3)">تجاهل</button></div></div>`).join('') : ''}
      <div class="alabel"><span>إيداعات تنتظر الاعتماد</span><span class="caption">${pend.length}</span></div>
      ${pend.length ? pend.map(d => `<div class="acard arv">
        <div class="arv-h"><span class="athumb">${d.proof_url ? svg(I.img2) : svg(/ليبيانا|المدار|libyana|almadar/i.test(d.method || '') ? I.phone : I.cash)}</span>
          <span class="art"><b>${esc(userName(d.uid))}</b><span>${esc(d.method || '—')} · ${esc(dt(d.created_at))}</span></span>
          <span class="aamt"><b>${esc(usd(d.amount_usd))}</b>${n(d.amount_lyd) ? `<small>${esc(lyd(d.amount_lyd))}</small>` : ''}</span></div>
        <div class="achips">${d.claim_phone ? `<span class="achip" dir="ltr">0${esc(String(d.claim_phone).replace(/^0/, ''))}</span>` : ''}${d.reference ? `<span class="achip" dir="ltr">${esc(String(d.reference).slice(0, 24))}</span>` : ''}${d.proof_url ? '<span class="achip ok">إيصال مرفق</span>' : ''}${d.note ? `<span class="achip">${esc(String(d.note).slice(0, 40))}</span>` : ''}</div>
        <button class="abtn p block" data-dep="${esc(d.id)}" type="button">${svg(I.eye)}مراجعة واعتماد</button></div>`).join('') : `<div class="acard"><div class="aempty">${svg(I.check)}<b>ما فيش إيداعات تنتظر</b></div></div>`}
      <details class="ahist"><summary>سجل كل الإيداعات</summary><div class="mtab">${vDeposits()}</div></details>`;
  } else if (S.monTab === 'invoices') body = invAdminHtml(0) + ufCard() + exportCard();
  else if (S.monTab === 'withdraw') body = `<div class="mtab">${vWithdraw()}</div>`;
  else if (S.monTab === 'sms') body = `<div class="mtab">${vSms()}</div>`;
  return `<div class="page-enter astag">
    ${aHead('المال', 'الإيداعات والفواتير والسحوبات في مكان واحد')}
    <div class="aseg">${tabs.map(([k, t]) => `<button class="${S.monTab === k ? 'on' : ''}" data-mtab="${k}" type="button">${t}${cnt[k] ? `<i>${cnt[k]}</i>` : ''}</button>`).join('')}</div>
    ${body}
  </div>`;
}

/* ═══ العملاء ═══ */
S.uList = null; S.uQ = ''; S.uFile = null;
let _uFindT = null;
async function findUsers(q) {
  try { const r = await api('/api/admin/users/find', { q: q || '' }); S.uList = r.users || []; r.users.forEach(u => { S.names[u.id] = u.name || u.email || u.id; }); render(true); const el = $('#uFind'); if (el && document.activeElement !== el && q) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }
  catch (e) { toast(e.message, 'bad'); S.uList = S.uList || []; render(true); }
}
function vUsers2() {
  if (S.uFile) return vUserFile();
  if (S.uList === null) { S.uList = undefined; setTimeout(() => findUsers(''), 0); }
  const list = S.uList || [];
  return `<div class="page-enter astag">
    ${aHead('العملاء', S.uQ ? `نتائج «${esc(S.uQ)}»` : 'آخر المسجّلين — ابحث بالاسم أو البريد أو الرقم')}
    <label class="asearch">${svg(I.search)}<input id="uFind" placeholder="الاسم، البريد، رقم الهاتف…" value="${esc(S.uQ)}" autocomplete="off"></label>
    <div class="acard">${S.uList === undefined ? '<div class="arow"><i class="ask" style="width:70%"></i></div>'.repeat(5) : list.length ? list.map(u => aRow({
      i: I.user, c: u.banned ? 'r' : u.phone_verified ? 'o' : '', t: esc(u.name || '—') + (u.banned ? ' <span class="achip r">موقوف</span>' : ''),
      s: `<span dir="ltr">${esc(u.email || '')}</span>${u.phone_verified ? ' · 0' + esc(String(u.phone_verified)) : ''}`,
      end: `<span class="aamt sm"><b>${esc(usd(u.wallet_balance))}</b></span>`, attrs: `data-ufile2="${esc(u.id)}"` })).join('') : `<div class="aempty">${svg(I.users)}<b>ما لقينا حد</b><span>جرّب جزء من البريد أو آخر أرقام الهاتف</span></div>`}</div>
  </div>`;
}
const REASON_AR2 = { promo_first: 'هدية أول شحنة', usdt_deposit: 'شحن USDT', deposit: 'شحن', sms_deposit: 'شحن رصيد هاتف', manual_deposit: 'إيداع معتمد', rsc_order: 'شراء من المتجر', rsc_refund: 'استرجاع طلب', admin_adjust: 'تعديل إداري', transfer_in: 'تحويل وارد', transfer_out: 'تحويل صادر', withdraw: 'سحب', card_create: 'إصدار بطاقة', card_topup: 'شحن بطاقة', referral: 'مكافأة دعوة' };
function vUserFile() {
  const F = S.uFile;
  if (F.loading) return `<div class="page-enter">${aHead('ملف العميل', '')}<div class="acard"><div class="arow"><i class="ask" style="width:60%"></i></div></div></div>`;
  const u = F.user, plan = ['basic', 'premium', 'vip'].includes(u.plan) && n(u.plan_expires_ms) > Date.now() ? (PLAN_AR[u.plan] || u.plan) : '';
  const tab = S.uTab || 'ledger';
  const since = u.created_at ? Math.max(0, Math.round((Date.now() - toMs(u.created_at)) / 86400000)) : null;
  const row = (c, i, t, s, a, col) => `<div class="arow static"><span class="aric ${c}">${svg(i)}</span><span class="art"><b>${t}</b><span>${s}</span></span><b class="anum" style="color:${col || 'var(--u-ink)'}">${a}</b></div>`;
  const ST = { pending: 'معلّق', approved: 'مقبول', rejected: 'مرفوض', completed: 'مكتمل', refunded: 'مُسترد', unknown: 'مراجعة', open: 'مفتوحة', closed: 'مغلقة', answered: 'مُجاب', paid: 'مدفوعة', expired: 'منتهية', awaiting: 'بانتظار', cancelled: 'ملغاة' };
  let list = '';
  if (tab === 'ledger') list = (F.ledger || []).map(t => row(t.type === 'credit' ? 'o' : '', t.type === 'credit' ? I.down : I.bag, esc(REASON_AR2[t.reason] || t.reason || t.type), esc(dt(t.created_at)) + (t.reference ? ' · <span dir="ltr">' + esc(String(t.reference).slice(0, 18)) + '</span>' : ''), (t.type === 'credit' ? '+' : '−') + esc(usd(t.amount)), t.type === 'credit' ? 'var(--u-ok)' : '')).join('');
  else if (tab === 'orders') list = (F.orders || []).map(o => row('', I.bag, esc(o.cat_name || '') + ' — ' + esc(o.offer_name || ''), esc(dt(o.created_at)) + ' · ' + esc(ST[o.status] || o.status), esc(usd(o.total_usd)))).join('');
  else if (tab === 'deposits') list = [...(F.invoices || []).map(v => row(v.status === 'paid' ? 'o' : '', I.receipt, esc(v.no) + ' · ' + esc(v.network_label), esc(dt(new Date(v.created_ms).toISOString())) + ' · ' + esc(ST[v.status] || v.status), esc(usd(v.amount_usd)))),
    ...(F.deposits || []).map(d => row(d.status === 'approved' ? 'o' : '', I.cash, esc(d.method || '—'), esc(dt(d.created_at)) + ' · ' + esc(ST[d.status] || d.status), esc(usd(d.amount_usd))))].join('');
  else if (tab === 'cards') list = F.cards === undefined ? '<div class="arow"><i class="ask" style="width:60%"></i></div>' : '';
  else if (tab === 'tickets') list = (F.tickets || []).map(t => row('', I.chat, esc(t.subject || '—'), esc(dt(t.updated_at || t.created_at)) + ' · ' + esc(ST[t.status] || t.status), '')).join('');
  const tabs = [['ledger', 'الحركات'], F.orders ? ['orders', 'الطلبات'] : null, can('cards', 'view') ? ['cards', 'البطاقات'] : null, F.deposits ? ['deposits', 'الشحن'] : null, F.tickets ? ['tickets', 'التذاكر'] : null].filter(Boolean);
  return `<div class="page-enter astag">
    <div class="ah"><button class="aib" data-ufback type="button" aria-label="رجوع">${svg(I.back)}</button><div style="flex:1;text-align:center"><h1 style="font-size:18px">ملف العميل</h1></div><span style="width:40px"></span></div>
    <div class="acard aprof"><div class="aav">${esc((u.name || u.email || '?').trim().charAt(0))}</div>
      <b class="aname">${esc(u.name || '—')}</b><div class="caption" dir="auto">${esc(u.email || '')}${u.phone_verified ? ' · <span dir="ltr">0' + esc(String(u.phone_verified)) + '</span>' : ''}</div>
      <div class="abal">${esc(usd(u.wallet_balance))}</div>
      <div class="caption">إنفاق ${esc(usd(u.total_spent))}${since != null ? ' · عضو من ' + (since < 1 ? 'اليوم' : since + ' يوم') : ''}</div>
      <div class="achips center">${u.email_verified ? '<span class="achip ok">بريد موثّق</span>' : '<span class="achip">بريد غير موثّق</span>'}${u.phone_verified ? '<span class="achip ok">رقم موثّق</span>' : ''}${plan ? `<span class="achip g">${esc(plan)}</span>` : ''}${u.banned ? '<span class="achip r">موقوف</span>' : ''}</div>
      <div class="aqa">
        ${can('users', 'wallet') || can('users', 'ban') || can('users', 'plan') ? `<button data-umanage="${esc(u.id)}" type="button"><span>${svg(I.up)}</span>الرصيد والباقة</button>` : ''}
        <button data-uledger="${esc(u.id)}" type="button"><span>${svg(I.shield)}</span>فحص السجل</button>
        <button data-copy="${esc(u.email || '')}" type="button"><span>${svg(I.copy)}</span>نسخ البريد</button>
        ${can('users', 'ban') ? `<button class="d" data-umanage="${esc(u.id)}" type="button"><span>${svg(I.ban)}</span>${u.banned ? 'رفع الإيقاف' : 'إيقاف'}</button>` : ''}
      </div></div>
    <div class="aseg">${tabs.map(([k, t]) => `<button class="${tab === k ? 'on' : ''}" data-utab="${k}" type="button">${t}</button>`).join('')}</div>
    ${tab === 'cards' && F.cards ? (F.cards.length ? F.cards.map(c => cardRowHtml(c, true)).join('') : `<div class="acard"><div class="aempty"><b>ما عندهش بطاقات</b></div></div>`) : `<div class="acard">${list || `<div class="aempty"><b>لا شيء هنا</b></div>`}</div>`}
  </div>`;
}
async function openUserFile2(uid) {
  S.uFile = { loading: true }; S.uTab = 'ledger'; render(true); window.scrollTo({ top: 0, behavior: 'instant' });
  try { const r = await api('/api/admin/user/file', { uid }); S.uFile = r; S.names[uid] = r.user.name || r.user.email || uid;
    const i = (S.users || []).findIndex(x => x.id === uid); const ux = { id: uid, ...r.user }; if (i >= 0) S.users[i] = { ...S.users[i], ...ux }; else S.users.push(ux);
  } catch (e) { toast(e.message, 'bad'); S.uFile = null; }
  render(true);
}

/* ═══ المزيد ═══ */
function vMore() {
  const tile = (k, i, t, b) => pageAllowed(k) ? `<button class="atile" data-nav="${k}" type="button"><span>${svg(i)}${b ? `<i>${b}</i>` : ''}</span>${t}</button>` : '';
  const st = S.settings || {};
  const set = [
    isSuperAdmin() ? { i: I.cash, c: 'g', t: 'طرق الدفع', s: 'التشغيل، الإيقاف المؤقت، الأسعار، QR', attrs: 'data-nav="methods"' } : null,
    isSuperAdmin() ? { i: I.help, c: 'g', t: 'كيف أدفع؟', s: 'شرح الدفع بالصور لكل طريقة', attrs: 'data-nav="howto"' } : null,
    isSuperAdmin() ? { i: I.grid, c: 'g', t: 'أقسام الموقع', s: 'تفعيل، صيانة، إخفاء — البطاقات، المتجر، الشحن، الدعم…', attrs: 'data-nav="sections"' } : null,
    isSuperAdmin() ? { i: I.help, c: 'g', t: 'التواصل والأسئلة', s: 'واتساب، البريد، السوشيال، الأسئلة الشائعة', attrs: 'data-nav="contact"' } : null,
    isSuperAdmin() ? { i: I.shield, c: 'g', t: 'الحماية والحدود', s: 'السقف اليومي، الحسابات الجديدة', attrs: 'data-setgo="limits"' } : null,
    isSuperAdmin() ? { i: I.tool, c: 'g', t: 'تشغيل الموقع', s: 'الصيانة، الإيقاف، الرسائل', attrs: 'data-setgo="ops"' } : null,
    isSuperAdmin() ? { i: I.users, c: 'g', t: 'الموظفين والنظام', s: 'الصلاحيات، سجل العمليات، النسخ الاحتياطي', attrs: 'data-nav="system"' } : null,
  ].filter(Boolean);
  const cardsOn = (st.mc_maint_on !== true) && (pageAllowed('mcards') || pageAllowed('cards'));
  return `<div class="page-enter astag">
    ${aHead('المزيد', 'كل أقسام الإدارة')}
    <div class="alabel"><span>المتجر والعملاء</span></div>
    <div class="atiles">${tile('rsc', I.bag, 'الأقسام والأسعار')}${tile('tickets', I.chat, 'الدعم', ovA('tickets'))}${tile('coupons', I.tag, 'الكوبونات')}${tile('analytics', I.chart, 'تحليل الزوار')}${tile('reviews', I.chat, 'آراء العملاء')}${tile('cards', I.card, 'البطاقات')}</div>
    ${cardsOn ? `<div class="alabel"><span>البطاقات</span></div><div class="atiles">${tile('mcards', I.card, 'طلبات البطاقات', ovA('mcards'))}</div>` : ''}
    ${set.length ? `<div class="alabel"><span>الإعدادات</span></div><div class="acard">${set.map(aRow).join('')}</div>` : ''}
    ${isSuperAdmin() ? `<div class="alabel"><span>أرشيف</span></div><div class="acard">${[
      { i: I.box, t: 'طلبات المتجر القديم', attrs: 'data-nav="orders"' }, { i: I.grid, t: 'الخدمات القديمة', attrs: 'data-nav="services"' }, { i: I.box, t: 'منتجات المتجر القديم', attrs: 'data-nav="store"' }].map(aRow).join('')}</div>` : ''}
    <div class="alabel"><span>الحساب</span></div>
    <div class="acard"><div class="arow static"><span class="aric">${svg(I.moon)}</span><span class="art"><b>المظهر</b><span>نهاري / ليلي</span></span><button class="aib" data-theme-toggle type="button">${svg(themeNow() === 'dark' ? I.sun : I.moon)}</button></div>
      <button class="arow danger" id="logoutBtn2" type="button"><span class="aric r">${svg(I.out)}</span><span class="art"><b>تسجيل الخروج</b></span></button></div>
  </div>`;
}

/* ═══ طرق الدفع ═══ */
function vMethods() {
  const s = S.settings || {}, ps = pausedSet();
  const M = (k, bg, l, t, sub, onKey, chips) => `<div class="apm"><div class="apm-h"><span class="alg" style="background:${bg}">${l}</span>
      <span class="art"><b>${t}</b><span>${sub}</span></span>${onKey ? aSw(onKey, s[onKey] === true || (s[onKey] !== false && /libyana|almadar/.test(onKey))) : ''}</div>
    <div class="achips ind">${ps.has(k) ? '<span class="achip w">متوقفة مؤقتًا</span>' : ''}${chips.join('')}
      <button class="achip btnc ${ps.has(k) ? 'g' : ''}" data-pmpause="${esc(k)}" type="button">${ps.has(k) ? '▶ تشغيل' : '⏸ إيقاف مؤقت'}</button></div></div>`;
  const usdtOn = s.m_usdt_on === true;
  return `<div class="page-enter astag">
    <div class="ah"><button class="aib" data-nav="more" type="button" aria-label="رجوع">${svg(I.back)}</button><div style="flex:1"><h1>طرق الدفع</h1><p>التشغيل والإيقاف المؤقت والأسعار</p></div></div>
    <div class="alabel"><span>عملات رقمية · تلقائي</span></div>
    <div class="acard">
      <div class="apm"><div class="apm-h"><span class="alg" style="background:#26A17B">₮</span><span class="art"><b>العملات الرقمية</b><span>المفتاح الرئيسي لكل الشبكات</span></span>${aSw('m_usdt_on', usdtOn)}</div>
        <div class="achips ind"><span class="achip">$${esc(String(s.usdt_min ?? 5))} – $${esc(String(s.usdt_max ?? 1000))}</span><span class="achip">مهلة ${esc(String(s.usdt_window_min ?? 30))} د</span></div></div>
      ${M('binance_pay', '#F0B90B', 'B', 'Binance Pay', 'بدون رسوم · Pay ID + QR', 'binance_pay_on', [s.binance_pay_qr_v ? '<span class="achip ok">QR مرفوع</span>' : '<span class="achip w">بدون QR</span>'])}
      ${M('trc20', '#26A17B', '₮', 'USDT TRC20', 'شبكة TRON', '', [])}
      ${M('bep20', '#F3BA2F', '₮', 'USDT BEP20', 'شبكة BSC', 'bep20_on', [])}
      ${M('polygon', '#8247E5', '₮', 'USDT Polygon', 'شبكة Polygon', 'polygon_on', [])}
    </div>
    <div class="alabel"><span>رصيد هاتف · SMS</span></div>
    <div class="acard">
      ${M('libyana', '#00A6E1', 'LY', esc(s.m_libyana_label || 'ليبيانا'), esc(s.m_libyana_phone || s.deposit_phone || '—'), 'm_libyana_on', [`<span class="achip g">1$ = ${esc(String(s.rate_libyana ?? 11.8))} د.ل</span>`, `<span class="achip">${(s.m_libyana_mode || s.deposit_mode) === 'manual' ? 'مراجعة يدوية' : 'تلقائي حتى ' + esc(String(s.sms_auto_max_lyd ?? 100)) + ' د.ل'}</span>`])}
      ${M('almadar', '#E2231A', 'MD', esc(s.m_almadar_label || 'المدار'), esc(s.m_almadar_phone || s.deposit_phone || '—'), 'm_almadar_on', [`<span class="achip g">1$ = ${esc(String(s.rate_almadar ?? 12.5))} د.ل</span>`, `<span class="achip">${(s.m_almadar_mode || s.deposit_mode) === 'manual' ? 'مراجعة يدوية' : 'تلقائي حتى ' + esc(String(s.sms_auto_max_lyd ?? 100)) + ' د.ل'}</span>`])}
    </div>
    <div class="alabel"><span>بإيصال · مراجعة</span></div>
    <div class="acard">
      ${M('bank', '#566064', '🏦', esc(s.m_bank_label || 'تحويل مصرفي'), (s.m_bank_fields || []).length + ' حقول', 'm_bank_on', [`<span class="achip g">1$ = ${esc(String(s.rate_bank ?? 9.5))} د.ل</span>`])}
      ${(Array.isArray(s.custom_methods) ? s.custom_methods : []).map((m, i) => m && m.label ? M(String(m.key || `custom${i}`).replace(/[^a-z0-9_]/gi, '').slice(0, 20) || `custom${i}`, '#566064', '＋', esc(m.label), 'طريقة مخصّصة', '', [`<span class="achip">${m.on === false ? 'مطفأة' : 'مفعّلة'}</span>`]) : '').join('')}
    </div>
    <button class="abtn block" data-setgo="pay" type="button" style="margin-top:12px">${svg(I.edit)}تعديل الأسعار والأرقام وبيانات التحويل</button>
    <div class="alabel"><span>عرض أول شحنة 🎁</span></div>
    <div class="acard" style="padding:14px">
      <div class="arow static" style="padding:0 0 10px"><span class="art"><b>هدية أول شحنة</b><span>مرة وحدة لكل رقم هاتف موثّق — تنضاف تلقائيًا</span></span>${aSw('promo_first_on', s.promo_first_on !== false)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
        <label class="field"><span class="field-label">أقل شحنة $</span><input class="input" id="pfMin" type="number" min="1" step="1" value="${esc(String(s.promo_first_min ?? 20))}"></label>
        <label class="field"><span class="field-label">الهدية $</span><input class="input" id="pfBonus" type="number" min="0" step="0.1" value="${esc(String(s.promo_first_bonus ?? 0.5))}"></label>
        <label class="field"><span class="field-label">ينتهي في</span><input class="input" id="pfUntil" type="date" value="${esc(s.promo_first_until || '')}"></label>
      </div>
      <button class="abtn block" id="pfSave" type="button" style="margin-top:8px">حفظ العرض</button></div>
    ${invAdminHtml(2)}
  </div>`;
}

/* ─── الأحداث ─── */
document.addEventListener('click', async e => {
  const t = e.target.closest ? e.target : null; if (!t) return;
  const mg = t.closest('[data-mgo]'); if (mg) { S.monTab = mg.dataset.mgo; go('money'); return; }
  const mt = t.closest('[data-mtab]'); if (mt) { S.monTab = mt.dataset.mtab; S.filter = 'all'; syncSubs('money'); render(true); return; }
  const sg = t.closest('[data-setgo]'); if (sg) { S.setTab = sg.dataset.setgo; go('settings'); return; }
  const uf = t.closest('[data-ufile2]'); if (uf) { openUserFile2(uf.dataset.ufile2); return; }
  if (t.closest('[data-ufback]')) { S.uFile = null; render(true); return; }
  const ut = t.closest('[data-utab]'); if (ut) { S.uTab = ut.dataset.utab; render(true);
    if (S.uTab === 'cards' && S.uFile && S.uFile.cards === undefined) { const uid = S.uFile.user.id; api('/api/admin/cards', { uid }).then(r => { if (S.uFile && S.uFile.user.id === uid) { S.uFile.cards = r.cards || []; mergeCards(S.uFile.cards); render(true); } }).catch(er => toast(er.message, 'bad')); }
    return; }
  const um = t.closest('[data-umanage]'); if (um) { openUserManage(um.dataset.umanage); return; }
  const ul = t.closest('[data-uledger]'); if (ul) {
    ul.disabled = true;
    try { const r = await api('/api/admin/ledger/verify', { uid: ul.dataset.uledger }); toast(r.ok === false || r.mismatch ? 'فيه فرق في السجل — راجع التفاصيل في النظام' : 'السجل سليم ✓', r.ok === false || r.mismatch ? 'bad' : 'ok'); }
    catch (err) { toast(err.message, 'bad'); } ul.disabled = false; return;
  }
  const cp = t.closest('[data-copy]'); if (cp && cp.dataset.copy) { try { await navigator.clipboard.writeText(cp.dataset.copy); toast('نُسخ ✓', 'ok'); } catch {} return; }
  if (t.closest('#logoutBtn2')) { $('#logoutBtn') && $('#logoutBtn').click(); return; }
  const sw = t.closest('[data-aswitch]');
  if (sw) {
    if (!isSuperAdmin()) return toast('للمسؤول الرئيسي فقط', 'bad');
    const k = sw.dataset.aswitch, cur = S.settings[k] === true || (S.settings[k] !== false && /^m_(libyana|almadar)_on$|^rsc_on$/.test(k));
    if (sw.dataset.warn && !cur && !confirm('تفعيل وضع الصيانة؟ الزوار ما يقدروش يدخلوا الموقع.')) return;
    if (k === 'site_maint_on' && cur && !confirm('فتح الموقع للجميع؟')) return;
    sw.disabled = true;
    try { await api('/api/admin/settings', { [k]: !cur }); S.settings = { ...S.settings, [k]: !cur }; toast(!cur ? 'تم التشغيل ✓' : 'تم الإيقاف', 'ok'); render(true); }
    catch (err) { toast(err.message, 'bad'); sw.disabled = false; }
  }
});
document.addEventListener('input', e => {
  if (!e.target || e.target.id !== 'uFind') return;
  S.uQ = e.target.value.trim();
  clearTimeout(_uFindT);
  _uFindT = setTimeout(() => findUsers(S.uQ), 400);
});

/* ═══ v52 — البطاقات: بحث من الخادم، بدون أي بيانات حساسة، مع التجميد ═══ */
S.cList = null; S.cQ = ''; S.cTab = 'all';
let _cFindT = null;
const CST = { active: ['ok', 'نشطة'], frozen: ['fz', '❄ مجمّدة'], terminated: ['r', 'موقوفة'], deleted: ['r', 'محذوفة'] };
const maskPan = c => (c.first6 ? `${c.first6.slice(0, 4)} ${c.first6.slice(4)}•• •••• ${c.last4 || '••••'}` : `•••• •••• •••• ${c.last4 || '••••'}`);
function mergeCards(list) {
  S.manualCards = S.manualCards || [];
  for (const c of list) { const i = S.manualCards.findIndex(x => x.id === c.id); if (i >= 0) S.manualCards[i] = { ...S.manualCards[i], ...c }; else S.manualCards.push(c); S.names[c.uid] = c.user || c.email || S.names[c.uid]; }
}
async function findCards(q) {
  try { const r = await api('/api/admin/cards', { q: q || '' }); S.cList = r.cards || []; mergeCards(S.cList); render(true); }
  catch (e) { toast(e.message, 'bad'); S.cList = S.cList || []; render(true); }
}
function cardRowHtml(c, big) {
  const st = CST[c.status] || ['', c.status || '—'];
  return `<div class="acard acrd ${c.status === 'frozen' ? 'fz' : ''}" style="margin-bottom:10px">
    <div class="arv-h"><span class="amini ${c.status === 'frozen' ? 'fz' : c.status !== 'active' ? 'off' : ''}"></span>
      <span class="art"><b dir="ltr" style="text-align:right">${esc(maskPan(c))}</b><span>${esc(c.card_name || 'بطاقة')} · ${esc(c.id.slice(-6))}${c.provider_ref ? ' · ' + esc(c.provider_ref) : ''}${!big && c.user ? ' · ' + esc(c.user) : ''}</span></span>
      <span class="aamt"><b>${esc(usd(c.balance))}</b></span></div>
    <div class="achips"><span class="achip ${st[0] === 'ok' ? 'ok' : st[0] === 'r' ? 'r' : st[0] === 'fz' ? 'fz' : ''}">${st[1]}</span>${c.provider ? `<span class="achip">${esc(c.provider)}</span>` : ''}
      ${c.status === 'frozen' && c.frozen_at ? `<span class="achip">جُمّدت ${esc(dt(c.frozen_at))}</span>` : ''}${c.last_view_at ? `<span class="achip">آخر عرض للبيانات: ${esc(dt(c.last_view_at))}</span>` : ''}
      ${c.vault === false ? '<span class="achip w">بيانات قديمة — حدّثها بـ«استبدال»</span>' : ''}${c.state_reason ? `<span class="achip">${esc(c.state_reason)}</span>` : ''}</div>
    ${can('cards', 'edit') ? `<div class="acts3">
      ${c.status === 'active' ? `<button class="abtn fz" data-cstate="freeze" data-cid="${esc(c.id)}" type="button">❄ تجميد</button>` : c.status === 'frozen' ? `<button class="abtn okb" data-cstate="unfreeze" data-cid="${esc(c.id)}" type="button">فك التجميد</button>` : '<span></span>'}
      <button class="abtn" data-cbal2="${esc(c.id)}" type="button">الرصيد والعنوان</button>
      ${c.status !== 'terminated' ? `<button class="abtn" data-cmore="${esc(c.id)}" type="button">${svg(I.grid)}</button>` : ''}
    </div>` : ''}
  </div>`;
}
function vCards2() {
  if (S.cList === null) { S.cList = undefined; setTimeout(() => findCards(''), 0); }
  const list = (S.cList || []).filter(c => S.cTab === 'all' || c.status === S.cTab);
  return `<div class="page-enter astag">
    ${aHead('البطاقات', 'ابحث بآخر 4 أرقام، أو اسم العميل، أو مرجع المزوّد')}
    <label class="asearch">${svg(I.search)}<input id="cFind" placeholder="4821 أو اسم العميل أو المرجع…" value="${esc(S.cQ)}" autocomplete="off" inputmode="search"></label>
    <div class="aseg">${[['all', 'الكل'], ['active', 'نشطة'], ['frozen', 'مجمّدة'], ['terminated', 'موقوفة']].map(([k, t]) => `<button class="${S.cTab === k ? 'on' : ''}" data-ctab="${k}" type="button">${t}</button>`).join('')}</div>
    ${S.cList === undefined ? '<div class="acard"><div class="arow"><i class="ask" style="width:70%"></i></div></div>' : list.length ? list.map(c => cardRowHtml(c)).join('') : `<div class="acard"><div class="aempty">${svg(I.card)}<b>ما فيش بطاقات</b></div></div>`}
    <p class="caption" style="text-align:center;margin-top:10px">${svg(I.shield)} لوحة الإدارة ما تعرضش رقم البطاقة كامل ولا CVV — البيانات تُفتح للعميل فقط برمزه السري.</p>
  </div>`;
}
async function cardStateAct(cid, action) {
  const c = (S.manualCards || []).find(x => x.id === cid) || {};
  let reason = '';
  if (action === 'freeze') { reason = (prompt(`تجميد البطاقة ••${c.last4 || ''}؟ اكتب السبب (اختياري):`) ?? null); if (reason === null) return; }
  if (action === 'unfreeze' && !confirm(`فك تجميد البطاقة ••${c.last4 || ''}؟`)) return;
  if (action === 'terminate') { reason = prompt('إيقاف نهائي — البيانات تنمسح ولا ترجع. اكتب السبب:') || ''; if (reason.trim().length < 3) return toast('السبب مطلوب', 'bad'); if (!confirm('متأكد؟ الإيقاف النهائي ما يرجعش.')) return; }
  try {
    const r = await api('/api/admin/card/state', { card_id: cid, action, reason });
    const upd = x => x.id === cid ? { ...x, status: r.status, frozen_at: r.status === 'frozen' ? new Date().toISOString() : x.frozen_at, state_reason: reason } : x;
    S.cList = (S.cList || []).map(upd); S.manualCards = (S.manualCards || []).map(upd);
    if (S.uFile && S.uFile.cards) S.uFile.cards = S.uFile.cards.map(upd);
    toast(r.status === 'frozen' ? 'جُمّدت البطاقة ❄ — وصل العميل إشعار' : r.status === 'active' ? 'فُك التجميد ✓' : 'أُوقفت البطاقة', 'ok'); render(true);
  } catch (e) { toast(e.message, 'bad'); }
}
document.addEventListener('click', e => {
  const t = e.target.closest ? e.target : null; if (!t) return;
  const cs = t.closest('[data-cstate]'); if (cs) { cardStateAct(cs.dataset.cid, cs.dataset.cstate); return; }
  const cb = t.closest('[data-cbal2]'); if (cb) { openCardBalance(cb.dataset.cbal2); return; }
  const ct = t.closest('[data-ctab]'); if (ct) { S.cTab = ct.dataset.ctab; render(true); return; }
  const cm = t.closest('[data-cmore]');
  if (cm) {
    const c = (S.manualCards || []).find(x => x.id === cm.dataset.cmore) || {};
    modal(`<div class="modal-head"><div class="modal-title">البطاقة ••${esc(c.last4 || '')}</div><button class="modal-close" data-act="close-modal" aria-label="إغلاق">${svg(I.x)}</button></div>
      <div class="acard">
        ${can('mcards', 'approve') ? aRow({ i: I.card, c: 'g', t: 'استبدال بيانات البطاقة', s: 'لما المزوّد يصدرلها بطاقة جديدة', attrs: `data-crep2="${esc(c.id)}"` }) : ''}
        ${c.uid ? aRow({ i: I.user, t: 'ملف العميل', s: esc(c.user || ''), attrs: `data-ufile3="${esc(c.uid)}"` }) : ''}
        ${aRow({ i: I.ban, c: 'r', t: 'إيقاف نهائي', s: 'تنمسح البيانات ولا ترجع', attrs: `data-cstate="terminate" data-cid="${esc(c.id)}"` })}
      </div>`);
    return;
  }
  const cr = t.closest('[data-crep2]'); if (cr) { closeModal(); openCardReplace(cr.dataset.crep2); return; }
  const uf = t.closest('[data-ufile3]'); if (uf) { closeModal(); S.page = 'users'; go('users'); openUserFile2(uf.dataset.ufile3); return; }
});
document.addEventListener('input', e => {
  if (!e.target || e.target.id !== 'cFind') return;
  S.cQ = e.target.value.trim();
  clearTimeout(_cFindT);
  _cFindT = setTimeout(() => findCards(S.cQ), 400);
});

/* ═══ v52 — تحليل الزوار ═══ */
S.an = null; S.anDays = 7;
const AN_AR = { dashboard: 'الرئيسية', kstore: 'المتجر', cards: 'بطاقاتي', orders: 'طلباتي', settings: 'حسابي', wallet: 'المحفظة', transactions: 'المعاملات', plans: 'الباقات', referral: 'ادعُ صديقًا', support: 'الدعم', trust: 'كيف نحمي أموالك', invoices: 'فواتيري', landing: 'صفحة التعريف', howto: 'كيف أدفع', deposit: 'شحن المحفظة' };
async function loadAn() {
  try { S.an = await api('/api/admin/analytics', { days: S.anDays }); } catch (e) { toast(e.message, 'bad'); S.an = { totals: {}, per_day: [], live: 0, err: 1 }; }
  render(true);
}
function vAnalytics() {
  if (!S.an) { S.an = { loading: 1 }; setTimeout(loadAn, 0); }
  const A = S.an, T = A.totals || {}, ld = A.loading;
  const fmtN = v => Number(v || 0).toLocaleString('en-US');
  const pages = Object.keys(T).filter(k => k.startsWith('dur:')).map(k => [k.slice(4), T[k]]);
  const pvs = Object.keys(T).filter(k => k.startsWith('pv:')).map(k => [k.slice(3), T[k]]);
  const src = pages.length ? pages : pvs, tot = src.reduce((a, [, v]) => a + v, 0) || 1;
  const top = src.sort((a, b) => b[1] - a[1]).slice(0, 8), mx = top.length ? top[0][1] : 1;
  const fun = [['دخلوا الموقع', T.vis], ['سجّلوا حساب', T['ev:signup']], ['فتحوا الشحن', T['ev:dep_open']], ['دفعوا', T['ev:paid']], ['اشتروا', T['ev:buy']]].map(([t, v]) => [t, n(v)]);
  const f0 = Math.max(1, fun[0][1]);
  const hm = Array.from({ length: 7 }, (_, d) => Array.from({ length: 12 }, (_, h2) => n(T[`hr:${d}:${h2 * 2}`]) + n(T[`hr:${d}:${h2 * 2 + 1}`])));
  const hmx = Math.max(1, ...hm.flat());
  const DAYS = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];
  const devT = n(T['dev:m']) + n(T['dev:d']) || 1;
  return `<div class="page-enter astag">
    <div class="ah"><div><h1>تحليل الزوار</h1><p>أعداد مجمّعة بدون أي بيانات شخصية</p></div><span class="alive"><i></i>${ld ? '…' : fmtN(A.live)} متصل الآن</span></div>
    <div class="aseg">${[[1, 'اليوم'], [7, '7 أيام'], [30, '30 يوم'], [90, '3 شهور']].map(([d, t]) => `<button class="${S.anDays === d ? 'on' : ''}" data-andays="${d}" type="button">${t}</button>`).join('')}</div>
    <div class="astrip">${[['زوار', T.vis], ['سجّلوا', T['ev:signup']], ['دفعوا', T['ev:paid']], ['اشتروا', T['ev:buy']]].map(([t, v]) => `<div><span>${t}</span><b>${ld ? '…' : fmtN(v)}</b></div>`).join('')}</div>
    <div class="alabel"><span>${pages.length ? 'وين يقضّوا وقتهم' : 'أكثر الصفحات زيارة'}</span></div>
    <div class="acard abars">${top.length ? top.map(([k, v]) => `<div class="abr"><span>${esc(AN_AR[k] || k)}</span><div class="t"><i style="width:${Math.max(3, Math.round(v / mx * 100))}%"></i></div><b>${Math.round(v / tot * 100)}%</b></div>`).join('') : `<div class="aempty"><b>${ld ? 'جارٍ التحميل…' : 'ما فيش بيانات بعد'}</b><span>تبدأ الأرقام تظهر بعد ما الزوار يدخلوا</span></div>`}</div>
    <div class="alabel"><span>رحلة العميل — وين يوقفوا</span></div>
    <div class="acard afun">${fun.map(([t, v], i) => { const prev = i ? fun[i - 1][1] : 0, drop = i && prev ? Math.round((1 - v / prev) * 100) : null;
      return `<div class="afr"><div class="h"><span>${t}${drop != null && drop > 0 ? ` <em>−${drop}%</em>` : ''}</span><b>${fmtN(v)}</b></div><div class="t"><i style="width:${Math.max(2, Math.round(v / f0 * 100))}%"></i></div></div>`; }).join('')}
      <p class="caption" style="margin:4px 0 0">أكبر نسبة نزول بين خطوتين = وين يضيعوا زبائنك.</p></div>
    <div class="alabel"><span>أوقات الذروة (بتوقيت ليبيا)</span><span class="caption">الأغمق = أكثر زوار</span></div>
    <div class="acard ahm" dir="ltr">${hm.map((row, d) => `<span>${DAYS[d]}</span>${row.map(v => `<i style="opacity:${v ? Math.max(.12, v / hmx).toFixed(2) : .06}"></i>`).join('')}`).join('')}<span></span>${Array.from({ length: 12 }, (_, i) => `<span>${i % 2 ? '' : i * 2}</span>`).join('')}</div>
    <div class="alabel"><span>الأجهزة</span></div>
    <div class="acard abars">${[['هاتف', n(T['dev:m'])], ['كمبيوتر', n(T['dev:d'])], ['التطبيق المثبّت', n(T['dev:pwa'])]].map(([t, v]) => `<div class="abr"><span>${t}</span><div class="t"><i style="width:${Math.round(v / devT * 100)}%"></i></div><b>${Math.round(v / devT * 100)}%</b></div>`).join('')}</div>
  </div>`;
}
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-andays]'); if (b) { S.anDays = Number(b.dataset.andays); S.an = null; render(true); } });

/* ═══ v52 — محرّر «كيف أدفع؟» ═══ */
const HT_ADEF = {"binance_pay": {"title": "Binance Pay", "steps": ["افتح تطبيق Binance، ومن الرئيسية اضغط «Pay» (الدفع).", "اختر «إرسال» (Send).", "اختر «Pay ID» والصق الرقم اللي في فاتورتك.", "اختر العملة USDT واكتب المبلغ بالضبط زي الفاتورة (بالكسور).", "راجع البيانات واضغط «تأكيد» — الرصيد ينضاف لمحفظتك تلقائيًا خلال دقائق."]}, "binance_withdraw": {"title": "سحب من Binance", "steps": ["من Binance افتح «المحفظة» واضغط «سحب» (Withdraw).", "اختر عملة USDT.", "الصق العنوان من الفاتورة، واختر نفس الشبكة المكتوبة فيها (TRC20 أو BEP20).", "اكتب المبلغ بحيث «المبلغ المستلَم» يساوي مبلغ الفاتورة بالضبط — الرسوم تنزاد عليك.", "اضغط «سحب» وأكّد — ينضاف تلقائيًا بعد ما توصل المعاملة."]}, "mexc": {"title": "سحب من MEXC", "steps": ["من MEXC افتح «الأصول» (Assets) واضغط «سحب».", "اختر USDT ثم «سحب على الشبكة» (On-chain).", "الصق العنوان واختر نفس شبكة الفاتورة (TRC20 أو BEP20).", "انتبه للرسوم: لازم «المبلغ اللي يوصل» يساوي مبلغ الفاتورة بالضبط.", "أكّد السحب بالكود — ينضاف تلقائيًا بعد وصول المعاملة."]}, "libyana": {"title": "ليبيانا", "steps": ["في كاردو اختر ليبيانا والمبلغ، وانسخ الرقم اللي نعطيهولك.", "من خدمة «تحويل الرصيد» في ليبيانا حوّل نفس المبلغ بالضبط لهذا الرقم.", "ارجع لكاردو، اكتب رقمك اللي حوّلت منه واضغط «حوّلت الرصيد» — ينضاف تلقائيًا أول ما توصل رسالة التحويل."]}, "almadar": {"title": "المدار", "steps": ["في كاردو اختر المدار والمبلغ، وانسخ الرقم اللي نعطيهولك.", "من خدمة «تحويل الرصيد» في المدار حوّل نفس المبلغ بالضبط لهذا الرقم.", "ارجع لكاردو، اكتب رقمك اللي حوّلت منه واضغط «حوّلت الرصيد» — ينضاف تلقائيًا أول ما توصل رسالة التحويل."]}, "bank": {"title": "تحويل مصرفي", "steps": ["في كاردو اختر التحويل المصرفي، وانسخ رقم الحساب واسم المستفيد.", "حوّل المبلغ من تطبيق مصرفك أو من الفرع، واحتفظ بالإيصال.", "ارجع لكاردو، اكتب المبلغ وارفع صورة الإيصال — ينضاف بعد المراجعة."]}};
S.ht = null; S.htTab = 'binance_pay';
async function loadHt() {
  try { const r = await fetch(API_BASE + '/api/howto', { cache: 'no-store' }).then(x => x.json()); S.ht = r.guides || {}; } catch { S.ht = {}; }
  render(true);
}
function htCur() {
  const g = S.ht[S.htTab];
  if (g && g.steps && g.steps.length) return g;
  return { steps: HT_ADEF[S.htTab].steps.map(t => ({ t, img: '' })), _def: true };
}
function vHowtoA() {
  if (!S.ht) { S.ht = undefined; setTimeout(loadHt, 0); return `<div class="page-enter">${aHead('كيف أدفع؟', '')}<div class="acard"><div class="arow"><i class="ask"></i></div></div></div>`; }
  if (S.ht === undefined) return `<div class="page-enter">${aHead('كيف أدفع؟', '')}<div class="acard"><div class="arow"><i class="ask"></i></div></div></div>`;
  const g = S.htEdit && S.htEdit.k === S.htTab ? S.htEdit.g : htCur();
  return `<div class="page-enter astag">
    <div class="ah"><button class="aib" data-nav="more" type="button" aria-label="رجوع">${svg(I.back)}</button><div style="flex:1"><h1>كيف أدفع؟</h1><p>الشرح اللي يشوفه العميل جنب كل طريقة دفع</p></div></div>
    <div class="aseg">${Object.keys(HT_ADEF).map(k => `<button class="${S.htTab === k ? 'on' : ''}" data-httab="${k}" type="button">${esc(HT_ADEF[k].title)}</button>`).join('')}</div>
    ${g._def ? `<div class="aalert w">${svg(I.help)}<div>هذا الشرح الافتراضي بالرسومات. عدّل النص أو ارفع صورة حقيقية لأي خطوة، وبعدها اضغط «حفظ».</div></div>` : ''}
    ${g.steps.map((st, i) => `<div class="acard" style="padding:12px;margin-bottom:10px">
      <div style="display:grid;grid-template-columns:84px 1fr;gap:12px;align-items:start">
        <div class="htthumb">${st.img ? `<img src="${esc(API_BASE + st.img)}" alt="">` : `<span>رسم<br>افتراضي</span>`}</div>
        <div><div class="caption" style="margin-bottom:4px">الخطوة ${i + 1}</div>
          <textarea class="input" data-htt="${i}" rows="3" maxlength="240" style="height:auto;padding-top:10px;font-size:14px">${esc(st.t)}</textarea></div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <label class="abtn sm" style="cursor:pointer">${svg(I.upload)}${st.img ? 'تبديل الصورة' : 'رفع صورة'}<input type="file" accept="image/png,image/jpeg,image/webp" data-htimg="${i}" hidden></label>
        ${st.img ? `<button class="abtn sm" data-htnoimg="${i}" type="button">رجوع للرسم</button>` : ''}
        ${i > 0 ? `<button class="abtn sm" data-htup="${i}" type="button">↑</button>` : ''}
        <button class="abtn sm" data-htdel="${i}" type="button" style="color:var(--u-err)">حذف</button>
      </div></div>`).join('')}
    ${g.steps.length < 8 ? `<button class="abtn block" data-htadd type="button">+ إضافة خطوة</button>` : ''}
    <div class="field" style="margin-top:12px"><label class="field-label" for="htNote">ملاحظة أسفل الشرح (اختياري)</label><input class="input" id="htNote" maxlength="300" value="${esc(g.note || '')}"></div>
    <div style="display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:12px">
      <button class="abtn p" data-htsave type="button">حفظ الشرح</button>
      ${!g._def ? `<button class="abtn" data-htreset type="button">رجوع للافتراضي</button>` : ''}
    </div>
  </div>`;
}
function htEditState() {
  if (!S.htEdit || S.htEdit.k !== S.htTab) { const c = htCur(); S.htEdit = { k: S.htTab, g: { steps: c.steps.map(x => ({ ...x })), note: c.note || '', _def: c._def } }; }
  $$('[data-htt]').forEach(t => { const i = Number(t.dataset.htt); if (S.htEdit.g.steps[i]) S.htEdit.g.steps[i].t = t.value; });
  if ($('#htNote')) S.htEdit.g.note = $('#htNote').value;
  return S.htEdit.g;
}
async function htSave(guides) {
  const r = await api('/api/admin/howto', { guides });
  S.ht = r.guides || {}; S.htEdit = null; toast('حُفظ الشرح ✓ — يظهر للعملاء خلال دقائق', 'ok'); render(true);
}
document.addEventListener('click', async e => {
  const t = e.target.closest ? e.target : null; if (!t) return;
  const tb = t.closest('[data-httab]'); if (tb) { htEditState(); S.htTab = tb.dataset.httab; render(true); return; }
  if (t.closest('[data-htadd]')) { const g = htEditState(); g.steps.push({ t: '', img: '' }); render(true); return; }
  const d = t.closest('[data-htdel]'); if (d) { const g = htEditState(); g.steps.splice(Number(d.dataset.htdel), 1); render(true); return; }
  const u = t.closest('[data-htup]'); if (u) { const g = htEditState(), i = Number(u.dataset.htup); [g.steps[i - 1], g.steps[i]] = [g.steps[i], g.steps[i - 1]]; render(true); return; }
  const ni = t.closest('[data-htnoimg]'); if (ni) { const g = htEditState(); g.steps[Number(ni.dataset.htnoimg)].img = ''; render(true); return; }
  if (t.closest('[data-htsave]')) {
    const g = htEditState(); const steps = g.steps.map(x => ({ t: x.t.trim(), img: x.img || '' })).filter(x => x.t);
    if (!steps.length) return toast('اكتب خطوة واحدة على الأقل', 'bad');
    const all = { ...(S.ht || {}) }; all[S.htTab] = { steps, note: g.note || '' };
    try { await htSave(all); } catch (er) { toast(er.message, 'bad'); }
    return;
  }
  if (t.closest('[data-htreset]')) {
    if (!confirm('ترجع للشرح الافتراضي بالرسومات؟')) return;
    const all = { ...(S.ht || {}) }; delete all[S.htTab];
    try { await htSave(all); } catch (er) { toast(er.message, 'bad'); }
  }
});
document.addEventListener('change', async e => {
  const inp = e.target; if (!inp || !inp.dataset || inp.dataset.htimg == null) return;
  const i = Number(inp.dataset.htimg);
  try {
    const img = await compressImg(inp.files[0], 720, 0.82, 360000);
    const r = await api('/api/admin/howto', { action: 'img', guide: S.htTab, image: img });
    const g = htEditState(); g.steps[i].img = r.url; render(true); toast('رُفعت الصورة — لا تنسَ «حفظ الشرح»', 'ok');
  } catch (er) { toast(er.message, 'bad'); }
});

/* ═══ v52 — تصدير Excel للمحاسبة ═══ */
const INV_ST_AR = { awaiting: 'بانتظار', cancelled: 'ملغاة', paid: 'مدفوعة', expired: 'منتهية', cancelled_closed: 'ملغاة' };
const DEP_ST_AR = { pending: 'معلّق', approved: 'مقبول', rejected: 'مرفوض' };
const lyT = v => { if (!v) return ''; const d = new Date(Date.parse(v) + 2 * 3600000); return isNaN(d) ? '' : d.toISOString().slice(0, 16).replace('T', ' '); };
function exportCard() {
  const today = new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10);
  return `<div class="acard" style="padding:14px;margin-top:12px"><div class="art"><b>تصدير Excel للمحاسبة</b><span>الفواتير + كل الإيداعات + ملخص لكل طريقة ولكل يوم</span></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
      <label class="field"><span class="field-label">من</span><input class="input" id="exFrom" type="date" value="${today.slice(0, 8)}01" max="${today}"></label>
      <label class="field"><span class="field-label">إلى</span><input class="input" id="exTo" type="date" value="${today}" max="${today}"></label></div>
    <button class="abtn p block" id="exGo" type="button" style="margin-top:8px">${svg(I.upload)} تنزيل ملف Excel</button></div>`;
}
let _xlsxLib = null;
function loadXlsx() { if (window.kardoXlsx) return Promise.resolve(); if (_xlsxLib) return _xlsxLib; _xlsxLib = new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = './kardo-xlsx.js?v=52'; sc.onload = res; sc.onerror = () => { _xlsxLib = null; rej(new Error('تعذّر تحميل أداة Excel')); }; document.head.appendChild(sc); }); return _xlsxLib; }
document.addEventListener('click', async e => {
  const b = e.target.closest && e.target.closest('#exGo'); if (!b) return;
  const from = $('#exFrom').value, to = $('#exTo').value;
  if (!from || !to || from > to) return toast('اختر تاريخ صحيح', 'bad');
  b.disabled = true; const old = b.innerHTML; b.textContent = 'جارٍ التجهيز…';
  try {
    const [r] = await Promise.all([api('/api/admin/export', { from, to }), loadXlsx()]);
    const inv = r.invoices || [], dep = r.deposits || [];
    const s1 = [['رقم الفاتورة', 'التاريخ', 'العميل', 'البريد', 'الطريقة', 'المبلغ $', 'المطلوب USDT', 'المستلم USDT', 'الحالة', 'وقت الدفع', 'رقم المعاملة', 'متأخرة', 'أُضيفت بواسطة'],
      ...inv.map(v => [v.no, lyT(v.created_at), v.name, v.email, v.network, v.amount_usd, v.pay_amount, v.received || '', INV_ST_AR[v.status] || v.status, lyT(v.paid_at), v.txid, v.late ? 'نعم' : '', v.by === 'cron' || v.by === 'user' || v.by === 'link' ? 'تلقائي' : v.by ? 'يدوي' : ''])];
    const s2 = [['التاريخ', 'العميل', 'البريد', 'الطريقة', 'المبلغ $', 'المبلغ د.ل', 'الحالة', 'تلقائي', 'هاتف المرسل', 'مرجع / ملاحظة'],
      ...dep.map(d => [lyT(d.created_at), d.name, d.email, d.method, d.amount_usd, d.amount_lyd || '', DEP_ST_AR[d.status] || d.status, d.auto ? 'نعم' : 'لا', d.phone, d.reference])];
    const ok = dep.filter(d => d.status === 'approved');
    const byM = {}, byD = {};
    ok.forEach(d => { const m = String(d.method || '—').split(' — ')[0]; const x = byM[m] = byM[m] || [0, 0, 0]; x[0]++; x[1] += d.amount_usd; x[2] += d.amount_lyd || 0;
      const day = lyT(d.created_at).slice(0, 10); const y = byD[day] = byD[day] || [0, 0]; y[0]++; y[1] += d.amount_usd; });
    const r2 = v => Math.round(v * 100) / 100;
    const s3 = [['الطريقة', 'عدد الإيداعات المقبولة', 'المجموع $', 'المجموع د.ل'], ...Object.entries(byM).sort((a, b) => b[1][1] - a[1][1]).map(([m, x]) => [m, x[0], r2(x[1]), r2(x[2]) || '']),
      ['الإجمالي', ok.length, r2(ok.reduce((a, d) => a + d.amount_usd, 0)), r2(ok.reduce((a, d) => a + (d.amount_lyd || 0), 0))], [], ['اليوم', 'عدد', 'المجموع $'],
      ...Object.keys(byD).sort().map(k => [k, byD[k][0], r2(byD[k][1])]), [],
      ['الفواتير', 'العدد'], ['أُنشئت', inv.length], ['مدفوعة', inv.filter(v => v.status === 'paid').length], ['متأخرة وأُضيفت', inv.filter(v => v.late).length]];
    const blob = window.kardoXlsx([{ name: 'الملخص', rows: s3, widths: [26, 20, 16, 16] }, { name: 'الإيداعات', rows: s2, widths: [17, 20, 26, 26, 11, 11, 10, 8, 14, 26] }, { name: 'الفواتير', rows: s1, widths: [14, 17, 20, 26, 14, 10, 13, 13, 10, 17, 30, 8, 12] }]);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `kardo-${from}_${to}.xlsx`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`تم ✓ — ${dep.length} إيداع و${inv.length} فاتورة`, 'ok');
  } catch (er) { toast(er.message, 'bad'); }
  b.disabled = false; b.innerHTML = old;
});

document.addEventListener('click', async e => {
  if (!(e.target.closest && e.target.closest('#pfSave'))) return;
  const patch = { promo_first_min: Math.max(1, Number($('#pfMin').value) || 20), promo_first_bonus: Math.min(50, Math.max(0, Number($('#pfBonus').value) || 0)), promo_first_until: $('#pfUntil').value || '' };
  try { await api('/api/admin/settings', patch); S.settings = { ...S.settings, ...patch }; toast('حُفظ العرض ✓', 'ok'); } catch (er) { toast(er.message, 'bad'); }
});

// v52: كل أزرار [data-nav] داخل الصفحات والنوافذ (الشريطين مربوطين في buildNav)
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-nav]');
  if (!b || b.closest('#navDesk') || b.closest('#navDock')) return;
  e.preventDefault();
  if (b.closest('#modal')) closeModal();
  go(b.dataset.nav);
});


/* ═══ v54 — آراء العملاء ═══ */
async function loadRevA() {
  const tab = S.revTab || 'pending';
  try { const r = await api('/api/admin/reviews', { action: 'list', status: tab }); S.revA = { tab, items: r.items || [], counts: r.counts || {} }; }
  catch (e) { S.revA = { tab, items: [], counts: {}, err: e.message }; toast(e.message, 'bad'); }
  render(true);
}
function vReviewsA() {
  const tab = S.revTab || 'pending';
  if (!S.revA || S.revA.tab !== tab) { S.revA = { loading: true, tab, counts: (S.revA || {}).counts }; setTimeout(loadRevA, 0); }
  const R = S.revA || {}, c = R.counts || {};
  const minN = n((S.settings || {}).reviews_min) || 5;
  const st = k => '★'.repeat(k) + '☆'.repeat(5 - k);
  const head = `<div class="ah"><button class="aib" data-nav="more" type="button" aria-label="رجوع">${svg(I.back)}</button><div style="flex:1"><h1>آراء العملاء</h1><p>تقييمات حقيقية بعد الشراء — تظهر في الرئيسية بعد الموافقة</p></div></div>
    <div class="aseg">${[['pending', 'بانتظار المراجعة'], ['approved', 'منشورة'], ['hidden', 'مخفية']].map(([k, t]) => `<button class="${tab === k ? 'on' : ''}" data-revtab="${k}" type="button">${t}${c[k] ? ` (${c[k]})` : ''}</button>`).join('')}</div>
    ${n(c.approved) < minN ? `<div class="aalert w">${svg(I.help)}<div>القسم ما يظهرش للعملاء لين يوصل عدد المنشورة ${minN} (الحالي ${n(c.approved)}). التقييم بالنجوم فقط يُنشر تلقائيًا، واللي فيه نص يحتاج موافقتك.</div></div>` : ''}`;
  if (R.loading) return `<div class="page-enter astag">${head}<div class="acard"><div class="arow"><i class="ask"></i></div></div></div>`;
  const items = R.items || [];
  return `<div class="page-enter astag">${head}
    ${!items.length ? `<div class="acard"><div class="arow static"><span class="art"><b>لا يوجد شيء هنا</b></span></div></div>` : items.map(r => `<div class="acard" style="padding:12px 14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b style="font-size:14px">${esc(r.name || 'عميل')}</b><span style="color:#F5B400;letter-spacing:1px">${st(Math.max(1, Math.min(5, n(r.stars))))}</span></div>
      <div class="caption" style="margin-top:2px">${esc(r.item || '')} · ${esc(String(r.created_at || '').slice(0, 10))} · ${esc(r.id)}</div>
      ${r.text ? `<p style="margin:8px 0 0;font-size:14px;line-height:1.7;white-space:pre-wrap">${esc(r.text)}</p>` : `<p class="caption" style="margin:8px 0 0">نجوم فقط بدون تعليق</p>`}
      <div style="display:flex;gap:6px;margin-top:10px">
        ${tab !== 'approved' ? `<button class="abtn sm p" data-revact="approve" data-id="${esc(r.id)}" type="button">نشر</button>` : ''}
        ${tab !== 'hidden' ? `<button class="abtn sm" data-revact="hide" data-id="${esc(r.id)}" type="button" style="color:var(--u-err)">إخفاء</button>` : ''}
        ${r.uid ? `<button class="abtn sm" data-ufile2="${esc(r.uid)}" type="button">ملف العميل</button>` : ''}
      </div></div>`).join('')}
  </div>`;
}
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-revtab],[data-revact]'); if (!t) return;
  if (t.dataset.revtab) { S.revTab = t.dataset.revtab; S.revA = null; render(true); return; }
  t.disabled = true;
  try { await api('/api/admin/reviews', { action: t.dataset.revact, id: t.dataset.id }); toast(t.dataset.revact === 'approve' ? 'نُشر ✓' : 'أُخفي', 'ok'); S.revA = null; render(true); }
  catch (er) { toast(er.message, 'bad'); t.disabled = false; }
});

/* ═══ v54 — التواصل والأسئلة الشائعة ═══ */
function vContactA() {
  const s = S.settings || {};
  const F = (id, k, label, ph, type = 'text') => `<div class="field"><label class="field-label" for="${id}">${label}</label><input class="input" id="${id}" data-ck="${k}" type="${type}" dir="ltr" maxlength="200" placeholder="${ph}" value="${esc(s[k] || '')}"></div>`;
  return `<div class="page-enter astag">
    <div class="ah"><button class="aib" data-nav="more" type="button" aria-label="رجوع">${svg(I.back)}</button><div style="flex:1"><h1>التواصل والأسئلة</h1><p>يظهر في خاتمة كل صفحة عند العميل. الحقل الفاضي ما يظهرش.</p></div></div>
    <div class="alabel"><span>تواصل معنا</span></div>
    <div class="acard" style="padding:12px 14px">
      ${F('ckWa', 'contact_whatsapp', 'رقم واتساب (بالمفتاح الدولي)', '2189XXXXXXXX', 'tel')}
      ${F('ckMail', 'contact_email', 'بريد الدعم', 'support@kardo.ly', 'email')}
    </div>
    <div class="alabel"><span>حسابات التواصل الاجتماعي (روابط كاملة https)</span></div>
    <div class="acard" style="padding:12px 14px">
      ${F('ckFb', 'social_fb', 'فيسبوك', 'https://facebook.com/...', 'url')}
      ${F('ckIg', 'social_ig', 'إنستغرام', 'https://instagram.com/...', 'url')}
      ${F('ckTt', 'social_tt', 'تيك توك', 'https://tiktok.com/@...', 'url')}
      ${F('ckTg', 'social_tg', 'تيليجرام', 'https://t.me/...', 'url')}
    </div>
    <div class="alabel"><span>الأسئلة الشائعة</span></div>
    <div class="acard" style="padding:12px 14px">
      <p class="caption" style="margin:0 0 8px">كل سطر سؤال وجوابه بينهم علامة | — مثال:<br><span dir="rtl">كم ياخد وقت الشحن؟|أغلب الطلبات تكتمل فورًا.</span><br>لو خليتها فاضية تظهر الأسئلة الافتراضية.</p>
      <textarea class="input" id="ckFaq" rows="8" maxlength="2000" style="height:auto;padding-top:10px;font-size:14px;line-height:1.8">${esc(s.faq_text || '')}</textarea>
    </div>
    <div class="alabel"><span>آراء العملاء</span></div>
    <div class="acard" style="padding:12px 14px">
      <div class="field"><label class="field-label" for="ckMin">أقل عدد آراء منشورة قبل ما يظهر القسم</label><input class="input" id="ckMin" type="number" min="1" max="100" value="${n(s.reviews_min) || 5}"></div>
    </div>
    <button class="abtn p block" data-cksave type="button" style="margin-top:12px">حفظ</button>
  </div>`;
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-cksave]'); if (!b) return;
  const patch = {}; let bad = '';
  $$('[data-ck]').forEach(i => {
    let v = i.value.trim(); const k = i.dataset.ck;
    if (k === 'contact_whatsapp') { v = v.replace(/[^\d]/g, ''); if (v && !/^\d{9,15}$/.test(v)) bad = 'رقم واتساب غير صحيح'; }
    if (k === 'contact_email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) bad = 'البريد غير صحيح';
    if (/^social_/.test(k) && v && !/^https:\/\/[^\s"'<>]+$/.test(v)) bad = 'الرابط لازم يبدا بـ https://';
    patch[k] = v;
  });
  patch.faq_text = ($('#ckFaq') || {}).value || '';
  const mn = Math.round(n(($('#ckMin') || {}).value)); patch.reviews_min = mn >= 1 && mn <= 100 ? mn : 5;
  if (bad) return toast(bad, 'bad');
  b.disabled = true;
  try { await api('/api/admin/settings', patch); S.settings = { ...S.settings, ...patch }; toast('حُفظ ✓ — يظهر للعملاء خلال دقائق', 'ok'); }
  catch (er) { toast(er.message, 'bad'); } finally { b.disabled = false; }
});


/* ═══ v55 — تحديد جماعي لأقسام المتجر ═══ */
let _rscFetching = false;
async function rscBulk(keys, set) {
  const r = await api('/api/admin/rsc', { action: 'bulk', keys, set });
  const lbl = { on: 'تفعّلت', maint: 'تحولت للصيانة', off: 'تخفّت', pick: 'تضافت للمختارات', unpick: 'تشالت من المختارات' }[set];
  toast(`${keys.length} ${keys.length > 10 ? 'قسم' : 'أقسام'} ${lbl} ✓`, 'ok');
  (S.rscSel || new Set()).clear();
  await loadRscA();
  if (r.need && r.need.length) rscFetchQueue(r.need);
}
async function rscFetchQueue(keys) {
  if (_rscFetching) return; _rscFetching = true;
  let ok = 0, left = [];
  for (let i = 0; i < keys.length; i++) {
    S.rscProg = `جاري جلب الأسعار… ${i + 1} من ${keys.length}`; if (S.page === 'rsc') render(true);
    try { const r = await api('/api/admin/rsc', { action: 'fetch', key: keys[i] }); if (r.success) ok++; else left.push(keys[i]); }
    catch { left.push(keys[i]); }
    await new Promise(res => setTimeout(res, 1500));
  }
  S.rscProg = left.length ? `جُلبت أسعار ${ok} — والباقي (${left.length}) يجيبهم النظام وحده خلال دقائق` : `جُلبت أسعار ${ok} ${ok > 10 ? 'قسم' : 'أقسام'} ✓`;
  _rscFetching = false; await loadRscA();
  setTimeout(() => { S.rscProg = ''; if (S.page === 'rsc') render(true); }, 8000);
}
document.addEventListener('click', async e => {
  const t = e.target;
  const f = t.closest('[data-rscflt]'); if (f) { S.rscA.flt = f.dataset.rscflt; render(true); return; }
  if (t.closest('[data-rscclr]')) { e.preventDefault(); (S.rscSel || new Set()).clear(); render(true); return; }
  const cb = t.closest('[data-rscsel]');
  if (cb) { const s0 = S.rscSel || (S.rscSel = new Set()); cb.checked ? s0.add(cb.dataset.rscsel) : s0.delete(cb.dataset.rscsel); render(true); return; }
  const all = t.closest('[data-rscall]');
  if (all) {
    const s0 = S.rscSel || (S.rscSel = new Set());
    $$('[data-rscsel]').forEach(x => all.checked ? s0.add(x.dataset.rscsel) : s0.delete(x.dataset.rscsel));
    render(true); return;
  }
  const b = t.closest('[data-rscbulk]');
  if (b) {
    const keys = [...(S.rscSel || [])]; if (!keys.length) return;
    $$('[data-rscbulk]').forEach(x => x.disabled = true);
    try { await rscBulk(keys, b.dataset.rscbulk); } catch (er) { toast(er.message, 'bad'); $$('[data-rscbulk]').forEach(x => x.disabled = false); }
  }
});

/* ═══ v55 — أقسام الموقع (مفعّل / صيانة / مخفي) ═══ */
const SEC_A = [['cards', 'البطاقات', 'إصدار وتعبئة البطاقات — البطاقات الموجودة تبقى ظاهرة لأصحابها', I.card], ['store', 'المتجر', 'شحن الألعاب والبطاقات', I.bag], ['deposit', 'شحن المحفظة', 'كل طرق الشحن', I.cash], ['transfer', 'التحويل بين الحسابات', '', I.cash], ['withdraw', 'السحب', '', I.withdraw], ['support', 'الدعم والتذاكر', 'فتح تذاكر جديدة', I.chat]];
function vSections() {
  const s = S.settings || {};
  const st = k => ['on', 'maint', 'off'].includes(s['sec_' + k]) ? s['sec_' + k] : 'on';
  return `<div class="page-enter astag">
    <div class="ah"><button class="aib" data-nav="more" type="button" aria-label="رجوع">${svg(I.back)}</button><div style="flex:1"><h1>أقسام الموقع</h1><p>شغّل أو اقفل أي قسم، أو حطه «قيد الصيانة» مع رسالة للعملاء</p></div></div>
    <div class="aalert w">${svg(I.help)}<div>في الصيانة القسم يبان للعميل مقفول وفيه رسالتك، والطلبات الجديدة تنرفض من الخادم. أنت والموظفين تقدروا تجربوا عادي.</div></div>
    ${SEC_A.map(([k, t, sub, ic]) => `<div class="acard" style="padding:12px 14px;margin-bottom:10px">
      <div style="display:flex;gap:10px;align-items:center"><span class="aric g">${svg(ic)}</span><div style="flex:1;min-width:0"><b style="font-size:15px">${t}</b>${sub ? `<div class="caption">${sub}</div>` : ''}</div></div>
      <div class="aseg" style="margin:10px 0 0">${[['on', 'مفعّل'], ['maint', 'صيانة'], ['off', 'مخفي']].map(([v, l]) => `<button class="${st(k) === v ? 'on' : ''}" data-secset="${k}" data-v="${v}" type="button">${l}</button>`).join('')}</div>
      ${st(k) !== 'on' ? `<div class="field" style="margin:10px 0 0"><label class="field-label" for="secm_${k}">رسالة للعملاء (اختياري)</label><textarea class="input" id="secm_${k}" rows="2" maxlength="300" style="height:auto;padding-top:10px">${esc(s['sec_msg_' + k] || '')}</textarea>
        <button class="abtn sm p" data-secmsg="${k}" type="button" style="margin-top:6px">حفظ الرسالة</button></div>` : ''}
    </div>`).join('')}
  </div>`;
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-secset],[data-secmsg]'); if (!b) return;
  const patch = b.dataset.secset ? { ['sec_' + b.dataset.secset]: b.dataset.v } : { ['sec_msg_' + b.dataset.secmsg]: ($('#secm_' + b.dataset.secmsg) || {}).value || '' };
  if (b.dataset.secset === 'cards' && b.dataset.v === 'on') patch.mc_maint_on = false;
  b.disabled = true;
  try { await api('/api/admin/settings', patch); S.settings = { ...S.settings, ...patch }; toast('حُفظ ✓ — يوصل للعملاء خلال دقيقة', 'ok'); render(true); }
  catch (er) { toast(er.message, 'bad'); b.disabled = false; }
});


/* ═══ v56 — الأنواع الخمسة: نقل ونصنيف تلقائي ═══ */
const RSC_GA = [['topup', 'ألعاب', 'شحن مباشر وأكواد ألعاب'], ['gift', 'بطاقات هدايا', 'Steam، PlayStation، iTunes…'], ['subs', 'اشتراكات وترفيه', 'Netflix، شاهد، Spotify…'], ['apps', 'تطبيقات وبرامج', 'Adobe، Canva، Microsoft…'], ['pay', 'بطاقات دفع ومحافظ', 'إيه-كاش، Razer…']];
const RSC_GT = Object.fromEntries(RSC_GA.map(([k, t]) => [k, t]));
const rscGA = c => RSC_GT[c.group] ? c.group : (c.type === 'topup' ? 'topup' : 'gift');
document.addEventListener('click', async e => {
  const mv = e.target.closest('[data-rscmove]');
  if (mv) {
    const keys = [...(S.rscSel || [])]; if (!keys.length) return;
    const names = keys.map(k => { const c = (S.rscA.cats || []).find(x => x.key === k); return c ? (c.alias || c.name) : k; });
    modal(`<div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px"><h3 class="h3" style="margin:0">نقل ${keys.length} ${keys.length > 10 ? 'قسم' : 'أقسام'} إلى…</h3><button class="modal-close" onclick="closeModal()" type="button" aria-label="إغلاق">✕</button></div>
      <p class="caption" style="margin:0 0 12px">${esc(names.slice(0, 4).join('، '))}${names.length > 4 ? ` و${names.length - 4} آخرين` : ''}</p>
      ${RSC_GA.map(([k, t, d]) => `<button class="rsc-opt" data-rscgo="${k}" type="button"><b>${t}</b><span>${esc(d)}</span></button>`).join('')}`);
    return;
  }
  const go = e.target.closest('[data-rscgo]');
  if (go) {
    const keys = [...(S.rscSel || [])]; if (!keys.length) return;
    $$('[data-rscgo]').forEach(x => x.disabled = true);
    try { await api('/api/admin/rsc', { action: 'bulk', keys, set: 'group', group: go.dataset.rscgo }); closeModal(); toast(`انتقلت إلى «${RSC_GT[go.dataset.rscgo]}» ✓`, 'ok'); S.rscSel.clear(); await loadRscA(); }
    catch (er) { toast(er.message, 'bad'); $$('[data-rscgo]').forEach(x => x.disabled = false); }
    return;
  }
  const au = e.target.closest('[data-rscauto]');
  if (au) {
    modal(`<div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px"><h3 class="h3" style="margin:0">تصنيف تلقائي</h3><button class="modal-close" onclick="closeModal()" type="button" aria-label="إغلاق">✕</button></div>
      <p style="margin:0 0 14px;line-height:1.8">يوزّع كل الأقسام على الأنواع الخمسة حسب أسمائها (مثلاً Netflix ← اشتراكات، Adobe ← تطبيقات، إيه-كاش ← بطاقات دفع). الأقسام اللي نقلتها بيدك ما تتغيرش.</p>
      <button class="btn btn-primary btn-block mb-2" data-rscautogo="0" type="button">صنّف</button>
      <button class="btn btn-secondary btn-block" data-rscautogo="1" type="button">صنّف الكل حتى اللي نقلته بيدي</button>`);
    return;
  }
  const ag = e.target.closest('[data-rscautogo]');
  if (ag) {
    $$('[data-rscautogo]').forEach(x => x.disabled = true);
    try { const r = await api('/api/admin/rsc', { action: 'autogroup', force: ag.dataset.rscautogo === '1' }, 60000); closeModal();
      const t = r.tally || {}; toast(`تم ✓ ألعاب ${t.topup || 0} · هدايا ${t.gift || 0} · اشتراكات ${t.subs || 0} · تطبيقات ${t.apps || 0} · دفع ${t.pay || 0}`, 'ok'); await loadRscA(); }
    catch (er) { toast(er.message, 'bad'); $$('[data-rscautogo]').forEach(x => x.disabled = false); }
  }
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

document.addEventListener('click', e => {
  const t = e.target.closest('[data-rsctf]'); if (t) { S.rscA.tf = t.dataset.rsctf; S.rscA.lim = 60; render(true); return; }
  if (e.target.closest('[data-rscmore]')) { S.rscA.lim = (S.rscA.lim || 60) + 60; render(true); }
});

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-rscfetch]'); if (!b) return;
  b.disabled = true; b.textContent = 'جاري الجلب…';
  try {
    const r = await api('/api/admin/rsc', { action: 'fetch', key: b.dataset.rscfetch });
    if (r.success) toast(r.offers ? `انجابت ${r.offers} باقة ✓ — يظهر للعملاء خلال دقيقتين` : 'المزود ما عنده باقات لهذا القسم حاليًا', r.offers ? 'ok' : 'bad');
    else toast('المزود رد بخطأ: ' + (r.error || 'غير معروف'), 'bad');
  } catch (er) { toast(er.message, 'bad'); }
  await loadRscA();
});
