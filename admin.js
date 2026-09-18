/* ═══════════════════════════════════════════════════════════
   KARDO — Admin Dashboard
   Firebase + Cloudflare Worker
   ═══════════════════════════════════════════════════════════ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, addDoc, updateDoc,
  onSnapshot, collection, query, orderBy, limit, where
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

/* ═══ State ═══ */
const S = {
  admin: null,
  page: 'home',
  unsub: [],
  users: [], orders: [], deposits: [], logs: [], sms: [],
  cats: [], prods: [], withdrawals: [], tickets: [], coupons: [],
  providers: [], pricing: {}, ops: {},
  q: '', filter: 'all', setTab: 'ops',
  loading: false
};

/* ═══ Icons ═══ */
const I = {
  home:'<path d="M3 10.4 12 3.2l9 7.2V20a1 1 0 0 1-1 1h-5v-6.5H9V21H4a1 1 0 0 1-1-1z"/>',
  grid:'<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
  bag:'<path d="M4.5 8h15l-1.2 12.2a1.8 1.8 0 0 1-1.8 1.6H7.5a1.8 1.8 0 0 1-1.8-1.6z"/><path d="M8.5 8V6a3.5 3.5 0 0 1 7 0v2"/>',
  users:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9"/>',
  cash:'<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M19.9 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H4a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 5.2 7.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1 .9z"/>',
  chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  warn:'<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
  trash:'<path d="M3.5 6h17M8 6V4h8v2M6.5 6l1 15h9l1-15"/>',
  edit:'<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  plus:'<path d="M12 5.5v13M5.5 12h13"/>',
  tag:'<path d="M20.5 13.5 13 21a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 2.4 12V4.4A2 2 0 0 1 4.4 2.4H12a2 2 0 0 1 1.4.6l7.1 7.1a2 2 0 0 1 0 2.8z"/><path d="M7.5 7.5h.01"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.3"/><path d="M12 17h.01"/>',
  out:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  swap:'<path d="M7 4v13M7 4 3.5 7.5M7 4l3.5 3.5M17 20V7M17 20l3.5-3.5M17 20l-3.5-3.5"/>',
  up:'<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>',
  down:'<path d="M12 5v14M18.5 12.5 12 19l-6.5-6.5"/>',
  copy:'<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  refresh:'<path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/>',
  cloud:'<path d="M17.5 19a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6 1.5A3.8 3.8 0 0 0 7 19z"/>',
  bell:'<path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>'
};
const svg = (d, w = 1.8) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

function mark(size = 32) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" style="flex:none">
    <defs><linearGradient id="akg${size}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#10B981"/>
      <stop offset="1" stop-color="#34D399"/>
    </linearGradient></defs>
    <rect width="40" height="40" rx="11" fill="#131C2C"/>
    <rect x="0.5" y="0.5" width="39" height="39" rx="10.5"
          fill="none" stroke="rgba(16,185,129,.25)"/>
    <path d="M11 9h4.4v22H11z" fill="url(#akg${size})"/>
    <path d="M17 20.2 27.5 9H33L22.4 20.2 33 31h-5.6z" fill="url(#akg${size})"/>
    <rect x="19" y="15.6" width="12.4" height="8.8" rx="2.2" fill="#EEF2F8" opacity=".95"/>
    <rect x="21" y="18.4" width="3.4" height="2.6" rx=".7" fill="#131C2C" opacity=".6"/>
  </svg>`;
}

/* ═══ Utils ═══ */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const n  = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
const usd = v => '$' + Number(v || 0).toFixed(2);
const lyd = v => Number(v || 0).toLocaleString('en-US',
  { minimumFractionDigits:2, maximumFractionDigits:2 }) + ' د.ل';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const dt = v => {
  if(!v) return '—';
  const d = v.toDate ? v.toDate() : new Date(v);
  return isNaN(d) ? '—' :
    d.toLocaleDateString('ar-LY', { day:'2-digit', month:'short' }) +
    ' · ' + d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
};

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  const ic = kind === 'ok'
    ? svg(I.check, 2.4)
    : kind === 'bad'
    ? svg(I.warn, 2)
    : '';
  el.innerHTML = ic + `<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    el.style.transition = '.26s';
    setTimeout(() => el.remove(), 270);
  }, 3600);
}

function sheet(html) {
  $('#sheet').innerHTML = html;
  $('#ov').classList.add('show');
}
window.closeSheet = () => {
  const ov = $('#ov');
  if(!ov.classList.contains('show')) return;
  ov.classList.add('closing');
  setTimeout(() => ov.classList.remove('show', 'closing'), 220);
};
$('#ov').addEventListener('click', e => {
  if(e.target.id === 'ov') closeSheet();
});
document.addEventListener('keydown', e => {
  if(e.key === 'Escape') closeSheet();
});

async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); toast(label + ' نُسخ', 'ok'); }
  catch { toast('تعذّر النسخ', 'bad'); }
}

/* ═══ API ═══ */
async function api(path, body) {
  const token = await auth.currentUser.getIdToken();
  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'content-type':'application/json', authorization:'Bearer ' + token },
    body: JSON.stringify(body || {})
  });
  const d = await res.json().catch(() => ({ success:false, error:'رد غير مفهوم' }));
  if(!d.success) throw new Error(d.error || 'فشلت العملية');
  return d;
}

/* ═══ Auth ═══ */
$('#gateMark').innerHTML = mark(42);
$('#railMark').innerHTML = mark(30);

$('#gGo').onclick = async () => {
  const e = $('#gEmail').value.trim();
  const p = $('#gPass').value;
  if(!e || !p) return showGateErr('أكمل البيانات');
  $('#gGo').disabled = true;
  $('#gGo').classList.add('loading');
  try {
    await signInWithEmailAndPassword(auth, e, p);
  } catch(err) {
    showGateErr('البريد أو كلمة المرور غير صحيحة');
    $('#gGo').disabled = false;
    $('#gGo').classList.remove('loading');
  }
};
$('#gPass').addEventListener('keydown', e => {
  if(e.key === 'Enter') $('#gGo').click();
});
function showGateErr(m) {
  const el = $('#gErr');
  el.textContent = m;
  el.classList.remove('hidden');
}

onAuthStateChanged(auth, async user => {
  S.unsub.forEach(u => { try { u(); } catch {} });
  S.unsub = [];
  if(!user) {
    $('#gate').classList.add('show');
    $('#app').style.display = 'none';
    return;
  }
  const snap = await getDoc(doc(db, 'admins', user.uid)).catch(() => null);
  if(!snap || !snap.exists()) {
    await signOut(auth);
    $('#gate').classList.add('show');
    showGateErr('هذا الحساب ليس لديه صلاحية إدارة');
    return;
  }
  S.admin = { uid: user.uid, email: user.email };
  $('#gate').classList.remove('show');
  $('#app').style.display = 'block';
  $('#railName').textContent = user.email.split('@')[0];
  $('#railAv').textContent = user.email.charAt(0).toUpperCase();
  subscribe();
  buildNav();
  render();
});

$('#railOut').addEventListener('click', () => {
  sheet(`
    <div class="h2" style="margin-bottom:8px">تسجيل الخروج</div>
    <p class="sub" style="margin-bottom:18px">ستحتاج للدخول مرة أخرى.</p>
    <button class="btn wide" onclick="doOut()">تأكيد</button>
    <button class="btn line wide" style="margin-top:8px"
            onclick="closeSheet()">إلغاء</button>`);
});
window.doOut = async () => { closeSheet(); await signOut(auth); };

/* ═══ Subscribe ═══ */
function sub(q, key) {
  S.unsub.push(onSnapshot(q, s => {
    S[key] = s.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, err => {
    console.warn(key, err.code);
  }));
}
function subscribe() {
  sub(query(collection(db,'users'), orderBy('created_at','desc'), limit(200)),'users');
  sub(query(collection(db,'orders'), orderBy('created_at','desc'), limit(300)),'orders');
  sub(query(collection(db,'wallet_deposits'), orderBy('created_at','desc'), limit(200)),'deposits');
  sub(query(collection(db,'categories')),'cats');
  sub(query(collection(db,'products')),'prods');
  sub(query(collection(db,'withdrawals'), orderBy('created_at','desc'), limit(100)),'withdrawals');
  sub(query(collection(db,'tickets'), orderBy('updated_at','desc'), limit(80)),'tickets');
  sub(query(collection(db,'coupons')),'coupons');
  sub(query(collection(db,'sms_transactions'), orderBy('created_at','desc'), limit(100)),'sms');

  S.unsub.push(onSnapshot(doc(db,'card_settings','pricing'), s => {
    if(s.exists()) S.pricing = s.data();
    render();
  }, () => {}));
  S.unsub.push(onSnapshot(doc(db,'card_settings','ops'), s => {
    if(s.exists()) S.ops = s.data();
    render();
  }, () => {}));
}

/* ═══ Navigation ═══ */
const PAGES = [
  { k:'home',      t:'نظرة عامة',    i:I.home,   g:'الرئيسية' },
  { k:'orders',    t:'الطلبات',      i:I.bag,    g:'الطلبات', badge:'pendingOrders' },
  { k:'deposits',  t:'الإيداعات',    i:I.cash,   g:'الطلبات', badge:'pendingDeposits' },
  { k:'withdrawals',t:'السحوبات',    i:I.down,   g:'الطلبات', badge:'pendingWd' },
  { k:'products',  t:'المنتجات',     i:I.grid,   g:'المتجر' },
  { k:'categories',t:'الأقسام',      i:I.tag,    g:'المتجر' },
  { k:'coupons',   t:'الكوبونات',    i:I.tag,    g:'المتجر' },
  { k:'users',     t:'المستخدمون',   i:I.users,  g:'العملاء' },
  { k:'tickets',   t:'التذاكر',      i:I.help,   g:'الدعم', badge:'openTickets' },
  { k:'providers', t:'المزودون',     i:I.cloud,  g:'النظام' },
  { k:'settings',  t:'الإعدادات',    i:I.gear,   g:'النظام' },
  { k:'sms',       t:'الرسائل',      i:I.bell,   g:'النظام' }
];
const DOCK = ['home','orders','products','users','settings'];

const badges = {
  pendingOrders:   () => S.orders.filter(o => o.status === 'processing' || o.status === 'pending').length,
  pendingDeposits: () => S.deposits.filter(d => d.status === 'pending').length,
  pendingWd:       () => S.withdrawals.filter(w => w.status === 'pending').length,
  openTickets:     () => S.tickets.filter(t => t.status === 'open').length
};

function buildNav() {
  const groups = {};
  PAGES.forEach(p => {
    if(!groups[p.g]) groups[p.g] = [];
    groups[p.g].push(p);
  });

  let html = '';
  for(const [g, items] of Object.entries(groups)) {
    html += `<div class="nav-group">${g}</div>`;
    items.forEach(p => {
      const c = p.badge ? badges[p.badge]() : 0;
      html += `<button class="nav" data-nav="${p.k}">
        ${svg(p.i)}<span>${p.t}</span>
        ${c ? `<span class="cnt">${c}</span>` : ''}
      </button>`;
    });
  }
  $('#navRail').innerHTML = html;

  const dk = DOCK.map(k => PAGES.find(p => p.k === k)).filter(Boolean);
  $('#navDock').style.gridTemplateColumns = `repeat(${dk.length},1fr)`;
  $('#navDock').innerHTML = dk.map(p => {
    const c = p.badge ? badges[p.badge]() : 0;
    return `<button class="dk ${S.page === p.k ? 'on' : ''}" data-nav="${p.k}">
      ${c ? `<span class="cnt">${c}</span>` : ''}
      ${svg(p.i)}<span>${p.t}</span>
    </button>`;
  }).join('');

  $$('[data-nav]').forEach(b => b.onclick = () => go(b.dataset.nav));
}

window.go = k => {
  S.page = k;
  S.q = ''; S.filter = 'all';
  window.scrollTo({ top: 0, behavior:'instant' });
  render();
};

/* ═══ Render ═══ */
let _raf = null;
function render() {
  if(_raf) return;
  _raf = requestAnimationFrame(() => { _raf = null; paint(); });
}

function paint() {
  buildNav();
  $$('[data-nav]').forEach(b =>
    b.classList.toggle('on', b.dataset.nav === S.page));

  const page = PAGES.find(p => p.k === S.page);
  $('#barTitle').textContent = page ? page.t : 'لوحة التحكم';

  const view = $('#view');
  const V = {
    home: vHome, orders: vOrders, deposits: vDeposits,
    withdrawals: vWithdrawals, products: vProducts,
    categories: vCategories, coupons: vCoupons,
    users: vUsers, tickets: vTickets, providers: vProviders,
    settings: vSettings, sms: vSms
  };
  view.classList.remove('anim');
  void view.offsetWidth;
  view.classList.add('anim');
  view.innerHTML = (V[S.page] || vHome)();
  bind();
}

/* ═══ Home / Dashboard ═══ */
function vHome() {
  const done = S.orders.filter(o => o.status === 'completed');
  const revenue = done.reduce((s, o) => s + n(o.total_lyd ?? o.customer_price), 0);
  const profit = done.reduce((s, o) => s + n(o.profit ?? o.profit_expected), 0);
  const pending = S.orders.filter(o => o.status === 'pending').length;
  const failed = S.orders.filter(o => o.status === 'rejected' || o.status === 'refunded').length;
  const float = n(S.ops.provider_float, 0);
  const thresh = n(S.ops.low_balance_threshold, 30);

  // 14-day profit chart
  const days = [...Array(14)].map((_, i) => {
    const d = new Date(); d.setHours(0,0,0,0);
    d.setDate(d.getDate() - (13 - i));
    const nx = new Date(d); nx.setDate(nx.getDate() + 1);
    const p = done
      .filter(o => {
        const t = o.created_at?.toDate?.() || new Date(o.created_at || 0);
        return t >= d && t < nx;
      })
      .reduce((s, o) => s + n(o.profit ?? o.profit_expected), 0);
    return { d, p };
  });
  const peak = Math.max(...days.map(x => x.p), 1);
  const weekProfit = days.reduce((s, x) => s + x.p, 0);

  // Recent orders
  const recent = S.orders.slice(0, 6);

  return `
  ${float < thresh ? `<div class="note bad">
    ${svg(I.warn)}<strong>رصيد المزود منخفض — ${usd(float)}</strong>
    <div style="margin-top:4px;font-size:12px">
      عبّئ رصيد USDT عند المزود، وإلا ستفشل عمليات الطلب.
      <button style="color:inherit;font-weight:800;text-decoration:underline"
              data-nav="settings">تحديث الرصيد</button>
    </div>
  </div>` : ''}

  <div class="h1" style="margin-bottom:4px">مرحبًا</div>
  <p class="sub" style="margin-bottom:16px">ملخص أداء المتجر اليوم</p>

  <div class="kpis">
    ${kpi(I.cash, lyd(revenue), 'إجمالي المبيعات', '#ECFDF5', '#059669',
      profit > 0 ? 'up' : '', profit > 0 ? '+' + usd(profit) : '')}
    ${kpi(I.chart, usd(profit), 'صافي الأرباح', '#EFF6FF', '#2563EB',
      profit > 0 ? 'up' : '', '')}
    ${kpi(I.bag, S.orders.length, 'إجمالي الطلبات', '#FEF3C7', '#B45309',
      '', pending ? pending + ' قيد التنفيذ' : '')}
    ${kpi(I.users, S.users.length, 'المستخدمون', '#F1F5F9', '#475569',
      '', '')}
    ${kpi(I.cloud, usd(float), 'رصيد المزود', '#ECFDF5', '#059669',
      float < thresh ? 'down' : '', float < thresh ? 'منخفض' : 'جيد')}
    ${kpi(I.warn, failed, 'عمليات فاشلة', '#FEE2E2', '#B91C1C', '', '')}
  </div>

  <div class="grid2" style="margin-bottom:14px">
    <div class="box">
      <div style="display:flex;justify-content:space-between;align-items:baseline;
           margin-bottom:14px">
        <div>
          <div class="h2">الأرباح — 14 يومًا</div>
          <div class="sub" style="font-size:12px;margin-top:2px">
            المجموع ${usd(weekProfit)}
          </div>
        </div>
      </div>
      <div class="spark">
        ${days.map(x => `<i style="height:${Math.max(3, (x.p/peak)*100)}%"
            title="${usd(x.p)}"></i>`).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:8px;
           font-size:10.5px;color:var(--tx-3)">
        <span>${days[0].d.toLocaleDateString('ar-LY',
          { day:'numeric', month:'short' })}</span>
        <span>اليوم</span>
      </div>
    </div>

    <div class="box">
      <div class="h2" style="margin-bottom:12px">إجراءات سريعة</div>
      <div style="display:grid;gap:8px">
        ${[
          ['products', I.plus, 'إضافة منتج جديد'],
          ['categories', I.tag, 'إدارة الأقسام'],
          ['users', I.users, 'مراجعة العملاء'],
          ['settings', I.gear, 'إعدادات المتجر']
        ].map(([k, ic, t]) => `
          <button class="btn dark" data-nav="${k}"
                  style="justify-content:flex-start;padding:11px 14px">
            ${svg(ic, 2)} ${t}
          </button>`).join('')}
      </div>
    </div>
  </div>

  <div class="sec-head" style="margin-top:14px">
    <div class="h2">أحدث الطلبات</div>
    <button class="btn ghost sm" data-nav="orders">عرض الكل</button>
  </div>
  ${recent.length ? `
    <div class="scrollx">
      <table class="tbl">
        <thead><tr>
          <th>رقم الطلب</th><th>العميل</th><th>المنتج</th>
          <th>المبلغ</th><th>الحالة</th><th>التاريخ</th>
        </tr></thead>
        <tbody>${recent.map(o => {
          const st = ostatus(o.status);
          const u = S.users.find(x => x.id === o.uid);
          return `<tr>
            <td class="mono" style="font-size:11.5px">${esc(String(o.id).slice(-10))}</td>
            <td>${esc(u ? (u.name || u.email) : '—')}</td>
            <td class="tight">${esc((o.items && o.items[0] && o.items[0].name) || '—')}</td>
            <td class="num">${lyd(o.total_lyd)}</td>
            <td><span class="chip ${st[0]}">${st[1]}</span></td>
            <td class="sub" style="font-size:11.5px">${dt(o.created_at)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : `<div class="box"><div class="empty">
      <div class="ei">${svg(I.bag,1.6)}</div>
      <div class="et">لا طلبات بعد</div>
    </div></div>`}
  `;
}

function kpi(icon, val, label, bg, fg, dir, sub) {
  return `<div class="kpi">
    <div class="kpi-i" style="background:${bg};color:${fg}">
      ${svg(icon, 1.9)}
    </div>
    <div class="kpi-v num">${val}</div>
    <div class="kpi-k">${label}</div>
    ${sub ? `<div class="kpi-t ${dir}">${sub}</div>` : ''}
  </div>`;
}

const ostatus = s => ({
  completed: ['ok','مكتمل'], pending: ['wait','قيد التنفيذ'],
  processing: ['wait','قيد المعالجة'],
  rejected: ['bad','مرفوض'], refunded: ['bad','مسترد']
}[s] || ['off','—']);

/* ═══ Orders ═══ */
function vOrders() {
  const F = [['all','الكل'],['pending','قيد التنفيذ'],
             ['completed','مكتمل'],['rejected','مرفوض']];
  let rows = S.orders;
  if(S.filter !== 'all') rows = rows.filter(o => o.status === S.filter);
  if(S.q) rows = rows.filter(o =>
    (String(o.id) + ' ' + (o.uid||'')).toLowerCase().includes(S.q.toLowerCase()));

  return `
  <div class="flex-b" style="margin-bottom:16px;flex-wrap:wrap">
    <div>
      <div class="h1">الطلبات</div>
      <p class="sub">${rows.length} من ${S.orders.length}</p>
    </div>
  </div>

  <input class="inp" id="qBox" placeholder="ابحث برقم الطلب أو العميل"
         value="${esc(S.q)}" style="margin-bottom:12px">

  <div class="tabs" style="margin-bottom:14px">
    ${F.map(([k, t]) => `<button class="tab ${S.filter === k ? 'on' : ''}"
      data-filter="${k}">${t}</button>`).join('')}
  </div>

  ${rows.length ? `
    <div class="scrollx">
      <table class="tbl">
        <thead><tr>
          <th>الطلب</th><th>العميل</th><th>المنتجات</th>
          <th>الإجمالي</th><th>الحالة</th><th>التاريخ</th><th></th>
        </tr></thead>
        <tbody>${rows.map(o => {
          const st = ostatus(o.status);
          const u = S.users.find(x => x.id === o.uid);
          const pend = o.status === 'pending' || o.status === 'processing';
          return `<tr>
            <td class="mono" style="font-size:11.5px">${esc(String(o.id).slice(-10))}</td>
            <td>${esc(u ? (u.name || u.email) : '—')}</td>
            <td class="tight">${esc((o.items && o.items[0] && o.items[0].name) || '—')}${
              (o.items && o.items.length > 1) ? ` +${o.items.length - 1}` : ''
            }</td>
            <td class="num">${lyd(o.total_lyd)}</td>
            <td><span class="chip ${st[  /* continuation of Orders Table & Pages */
            <td><span class="chip ${st[0]}">${st[1]}</span></td>
            <td class="sub" style="font-size:11.5px">${dt(o.created_at)}</td>
            <td>
              <button class="btn line sm" onclick="viewOrder('${o.id}')">التفاصيل</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : `<div class="box"><div class="empty"><div class="ei">${svg(I.bag, 1.6)}</div><div class="et">لا توجد طلبات تطابق البحث</div></div></div>`}
  `;
}

window.viewOrder = (id) => {
  const o = S.orders.find(x => x.id === id);
  if(!o) return;
  const u = S.users.find(x => x.id === o.uid);
  sheet(`
    <div class="h2" style="margin-bottom:4px">تفاصيل الطلب #${esc(String(o.id).slice(-8))}</div>
    <div class="sub" style="margin-bottom:16px">${dt(o.created_at)}</div>
    <div class="box" style="margin-bottom:12px;background:var(--bg-2)">
      <div style="font-size:12px;color:var(--tx-3)">العميل</div>
      <div style="font-weight:700">${esc(u ? (u.name || u.email) : o.uid)}</div>
    </div>
    <div class="box" style="margin-bottom:12px">
      <div style="font-weight:700;margin-bottom:8px">المنتجات:</div>
      ${(o.items || []).map(i => `
        <div class="flex-b" style="padding:6px 0;border-bottom:1px solid var(--brd)">
          <span>${esc(i.name)} ×${i.qty || 1}</span>
          <span class="num">${lyd(i.price_lyd || i.price)}</span>
        </div>
      `).join('')}
      <div class="flex-b" style="margin-top:8px;font-weight:800">
        <span>الإجمالي</span>
        <span class="num">${lyd(o.total_lyd)}</span>
      </div>
    </div>
    ${o.codes ? `
      <div class="box" style="margin-bottom:12px">
        <div style="font-weight:700;margin-bottom:6px">الأكواد/الكرروت:</div>
        <textarea class="inp mono" readonly style="width:100%;height:70px">${esc(Array.isArray(o.codes) ? o.codes.join('\n') : o.codes)}</textarea>
      </div>` : ''}
    <div style="display:flex;gap:8px;margin-top:16px">
      ${(o.status === 'pending' || o.status === 'processing') ? `
        <button class="btn ok wide" onclick="updateOrderStatus('${o.id}', 'completed')">إكمال الطلب</button>
        <button class="btn bad wide" onclick="updateOrderStatus('${o.id}', 'rejected')">رفض واسترجاع</button>
      ` : ''}
      <button class="btn line wide" onclick="closeSheet()">إغلاق</button>
    </div>
  `);
};

window.updateOrderStatus = async (id, status) => {
  try {
    await api('/admin/update-order', { orderId: id, status });
    toast('تم تحديث حالة الطلب بنجاح', 'ok');
    closeSheet();
  } catch(e) {
    toast(e.message, 'bad');
  }
};

/* ═══ Deposits ═══ */
function vDeposits() {
  const F = [['all','الكل'],['pending','قيد الانتظار'],['approved','مقابلة/مقبول'],['rejected','مرفوض']];
  let rows = S.deposits;
  if(S.filter !== 'all') rows = rows.filter(d => d.status === S.filter);

  return `
  <div class="flex-b" style="margin-bottom:16px">
    <div><div class="h1">طلبات الإيداع</div><p class="sub">${rows.length} عملية</p></div>
  </div>
  <div class="tabs" style="margin-bottom:14px">
    ${F.map(([k, t]) => `<button class="tab ${S.filter === k ? 'on' : ''}" data-filter="${k}">${t}</button>`).join('')}
  </div>
  ${rows.length ? `
    <div class="scrollx">
      <table class="tbl">
        <thead><tr><th>المستخدم</th><th>المبلغ</th><th>الطريقة</th><th>الحالة</th><th>التاريخ</th><th>جراء</th></tr></thead>
        <tbody>${rows.map(d => {
          const u = S.users.find(x => x.id === d.uid);
          return `<tr>
            <td>${esc(u ? u.email : d.uid)}</td>
            <td class="num">${lyd(d.amount)}</td>
            <td>${esc(d.method || 'سداد/تداول')}</td>
            <td><span class="chip ${d.status === 'approved' ? 'ok' : d.status === 'pending' ? 'wait' : 'bad'}">${d.status}</span></td>
            <td class="sub">${dt(d.created_at)}</td>
            <td>
              ${d.status === 'pending' ? `
                <button class="btn ok sm" onclick="processDeposit('${d.id}', true)">قبول</button>
                <button class="btn bad sm" onclick="processDeposit('${d.id}', false)">رفض</button>
              ` : '—'}
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : `<div class="box"><div class="empty"><div class="et">لا توجد إيداعات</div></div></div>`}
  `;
}

window.processDeposit = async (id, approve) => {
  try {
    await api('/admin/process-deposit', { depositId: id, approve });
    toast(approve ? 'تم قبول الإيداع وإضافة الرصيد' : 'تم رفض الإيداع', 'ok');
  } catch(e) { toast(e.message, 'bad'); }
};

/* ═══ Withdrawals ═══ */
function vWithdrawals() {
  return `
  <div class="h1" style="margin-bottom:4px">طلبات السحب</div>
  <p class="sub" style="margin-bottom:16px">إدارة عمليات سحب الأموال للعملاء/المسوقين</p>
  <div class="box"><div class="empty"><div class="ei">${svg(I.down, 1.6)}</div><div class="et">لا توجد طلبات سحب حالياً</div></div></div>
  `;
}

/* ═══ Products ═══ */
function vProducts() {
  let rows = S.prods;
  if(S.q) rows = rows.filter(p => p.name?.toLowerCase().includes(S.q.toLowerCase()));

  return `
  <div class="flex-b" style="margin-bottom:16px">
    <div><div class="h1">المنتجات والبطاقات</div><p class="sub">${rows.length} منتج</p></div>
    <button class="btn ok" onclick="editProduct()">${svg(I.plus)} إضافة منتج</button>
  </div>
  <input class="inp" id="qBox" placeholder="بحث عن منتج..." value="${esc(S.q)}" style="margin-bottom:12px">
  <div class="grid2">
    ${rows.map(p => `
      <div class="box flex-b">
        <div>
          <div style="font-weight:700;font-size:15px">${esc(p.name)}</div>
          <div class="sub" style="font-size:12px">${esc(p.category \vert{}\vert{} 'بدون قسم')} · <span class="num">${lyd(p.price)}</span></div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn line sm" onclick="editProduct('${p.id}')">${svg(I.edit, 1.6)}</button>
          <button class="btn bad sm" onclick="delProduct('${p.id}')">${svg(I.trash, 1.6)}</button>
        </div>
      </div>
    `).join('')}
  </div>
  `;
}

window.editProduct = (id) => {
  const p = S.prods.find(x => x.id === id) || { name: '', price: 0, category: '', provider_id: '' };
  sheet(`
    <div class="h2" style="margin-bottom:14px">${id ? 'تعديل منتج' : 'إضافة منتج جديد'}</div>
    <div style="display:grid;gap:10px">
      <div>
        <label class="sub" style="display:block;margin-bottom:4px">اسم المنتج</label>
        <input class="inp" id="pName" value="${esc(p.name)}" placeholder="مثال: ببجي 660 شدة">
      </div>
      <div>
        <label class="sub" style="display:block;margin-bottom:4px">السعر (د.ل)</label>
        <input class="inp num" id="pPrice" type="number" value="${p.price || 0}">
      </div>
      <div>
        <label class="sub" style="display:block;margin-bottom:4px">القسم</label>
        <select class="inp" id="pCat">
          ${S.cats.map(c => `<option value="${esc(c.id)}" ${p.category === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </div>
      <button class="btn wide" style="margin-top:10px" onclick="saveProduct('${id || ''}')">حفظ البيانات</button>
    </div>
  `);
};

window.saveProduct = async (id) => {
  const name = $('#pName').value.trim();
  const price = n($('#pPrice').value);
  const category = $('#pCat').value;
  if(!name) return toast('يرجى كتابة الاسم', 'bad');
  try {
    if(id) await updateDoc(doc(db, 'products', id), { name, price, category, updated_at: new Date() });
    else await addDoc(collection(db, 'products'), { name, price, category, created_at: new Date() });
    toast('تم الحفظ بنجاح', 'ok');
    closeSheet();
  } catch(e) { toast(e.message, 'bad'); }
};

window.delProduct = async (id) => {
  if(!confirm('هل أنت تأكد من مسح المنتج؟')) return;
  try {
    await deleteDoc(doc(db, 'products', id));
    toast('تم الحذف', 'ok');
  } catch(e) { toast(e.message, 'bad'); }
};

/* ═══ Categories ═══ */
function vCategories() {
  return `
  <div class="flex-b" style="margin-bottom:16px">
    <div><div class="h1">الأقسام</div><p class="sub">${S.cats.length} قسم</p></div>
    <button class="btn ok" onclick="editCat()">${svg(I.plus)} قسم جديد</button>
  </div>
  <div class="grid2">
    ${S.cats.map(c => `
      <div class="box flex-b">
        <div style="font-weight:700">${esc(c.name)}</div>
        <button class="btn bad sm" onclick="delCat('${c.id}')">${svg(I.trash, 1.6)}</button>
      </div>
    `).join('')}
  </div>
  `;
}

window.editCat = () => {
  sheet(`
    <div class="h2" style="margin-bottom:12px">إضافة قسم جديد</div>
    <input class="inp" id="cName" placeholder="اسم القسم" style="margin-bottom:12px">
    <button class="btn wide" onclick="saveCat()">إضافة</button>
  `);
};

window.saveCat = async () => {
  const name = $('#cName').value.trim();
  if(!name) return;
  try {
    await addDoc(collection(db, 'categories'), { name, created_at: new Date() });
    toast('تمت الإضافة', 'ok');
    closeSheet();
  } catch(e) { toast(e.message, 'bad'); }
};

window.delCat = async (id) => {
  if(confirm('حذف القسم؟')) await deleteDoc(doc(db, 'categories', id));
};

/* ═══ Coupons ═══ */
function vCoupons() {
  return `
  <div class="flex-b" style="margin-bottom:16px">
    <div><div class="h1">كوبونات الخصم</div><p class="sub">${S.coupons.length} كوبون</p></div>
    <button class="btn ok" onclick="editCoupon()">${svg(I.plus)} إنشاء كوبون</button>
  </div>
  <div class="box"><div class="empty"><div class="ei">${svg(I.tag, 1.6)}</div><div class="et">لا توجد كوبونات فعالة حالياً</div></div></div>
  `;
}
window.editCoupon = () => toast('قريباً', 'ok');

/* ═══ Users ═══ */
function vUsers() {
  let rows = S.users;
  if(S.q) rows = rows.filter(u => (u.email || u.name || '').toLowerCase().includes(S.q.toLowerCase()));

  return `
  <div class="flex-b" style="margin-bottom:16px">
    <div><div class="h1">المستخدمون</div><p class="sub">إجمالي ${S.users.length} مستخدم</p></div>
  </div>
  <input class="inp" id="qBox" placeholder="بحث باسم أو بريد العميل..." value="${esc(S.q)}" style="margin-bottom:12px">
  <div class="scrollx">
    <table class="tbl">
      <thead><tr><th>المستخدم</th><th>الرصيد (د.ل)</th><th>تاريخ التسجيل</th><th>إجراءات</th></tr></thead>
      <tbody>${rows.map(u => `
        <tr>
          <td>
            <div style="font-weight:700">${esc(u.name || 'بدون اسم')}</div>
            <div class="sub" style="font-size:11.5px">${esc(u.email)}</div>
          </td>
          <td class="num" style="font-weight:700">${lyd(u.balance)}</td>
          <td class="sub">${dt(u.created_at)}</td>
          <td>
            <button class="btn line sm" onclick="adjustBalance('${u.id}', '${esc(u.email)}')">تعديل الرصيد</button>
          </td>
        </tr>
      `).join('')}</tbody>
    </table>
  </div>
  `;
}

window.adjustBalance = (uid, email) => {
  sheet(`
    <div class="h2" style="margin-bottom:4px">تعديل رصيد العميل</div>
    <div class="sub" style="margin-bottom:14px">${esc(email)}</div>
    <input class="inp num" id="bAmt" type="number" step="any" placeholder="المبلغ (+ للإضافة، - للخصم)" style="margin-bottom:10px">
    <input class="inp" id="bNote" placeholder="سبب التعديل (اختياري)" style="margin-bottom:14px">
    <button class="btn wide" onclick="saveBalance('${uid}')">تحديث الرصيد</button>
  `);
};

window.saveBalance = async (uid) => {
  const amt = n($('#bAmt').value);
  const note = $('#bNote').value.trim();
  if(!amt) return toast('أدخل مبلغاً صحيحاً', 'bad');
  try {
    await api('/admin/adjust-balance', { uid, amount: amt, note });
    toast('تم تعديل الرصيد بنجاح', 'ok');
    closeSheet();
  } catch(e) { toast(e.message, 'bad'); }
};

/* ═══ Tickets ═══ */
function vTickets() {
  return `
  <div class="h1" style="margin-bottom:4px">تذاكر الدعم الفني</div>
  <p class="sub" style="margin-bottom:16px">متابعة رسائل واستفسارات العملاء</p>
  <div class="box"><div class="empty"><div class="ei">${svg(I.help, 1.6)}</div><div class="et">لا توجد تذاكر مفتوحة</div></div></div>
  `;
}

/* ═══ Providers ═══ */
function vProviders() {
  return `
  <div class="h1" style="margin-bottom:4px">مزودو الخدمات API</div>
  <p class="sub" style="margin-bottom:16px">متابعة الربط التلقائي والأسعار مع الموردين</p>
  <div class="box flex-b" style="margin-bottom:10px">
    <div>
      <div style="font-weight:700">المزود الرئيسي (LikeCard / Worker)</div>
      <div class="sub" style="font-size:12px">حالة الاتصال: نشط</div>
    </div>
    <span class="chip ok">متصل</span>
  </div>
  `;
}

/* ═══ Settings ═══ */
function vSettings() {
  const float = n(S.ops.provider_float, 0);
  const rate = n(S.pricing.usd_lyd_rate, 6.5);

  return `
  <div class="h1" style="margin-bottom:4px">إعدادات النظام</div>
  <p class="sub" style="margin-bottom:16px">التحكم بأسعار الصرف ورصيد المزود</p>

  <div class="box" style="margin-bottom:14px">
    <div class="h2" style="margin-bottom:12px">سعر صرف الدولار (USDT -> LYD)</div>
    <div style="display:flex;gap:8px">
      <input class="inp num" id="usdRate" type="number" step="0.01" value="${rate}">
      <button class="btn ok" onclick="saveRate()">حفظ</button>
    </div>
  </div>

  <div class="box">
    <div class="h2" style="margin-bottom:12px">تحديث رصيد المزود (Provider Float)</div>
    <div style="display:flex;gap:8px">
      <input class="inp num" id="provFloat" type="number" step="any" value="${float}">
      <button class="btn ok" onclick="saveFloat()">حفظ الرصيد</button>
    </div>
  </div>
  `;
}

window.saveRate = async () => {
  const rate = n($('#usdRate').value);
  if(rate <= 0) return toast('سعر غير صحيح', 'bad');
  try {
    await setDoc(doc(db, 'card_settings', 'pricing'), { usd_lyd_rate: rate }, { merge: true });
    toast('تم تحديث سعر الصرف', 'ok');
  } catch(e) { toast(e.message, 'bad'); }
};

window.saveFloat = async () => {
  const provider_float = n($('#provFloat').value);
  try {
    await setDoc(doc(db, 'card_settings', 'ops'), { provider_float }, { merge: true });
    toast('تم تحديث رصيد المزود', 'ok');
  } catch(e) { toast(e.message, 'bad'); }
};

/* ═══ SMS Logs ═══ */
function vSms() {
  return `
  <div class="h1" style="margin-bottom:4px">سجل الرسائل SMS</div>
  <p class="sub" style="margin-bottom:16px">سجل الرموز والتنبيهات المرسلة للعملاء</p>
  <div class="scrollx">
    <table class="tbl">
      <thead><tr><th>المستلم</th><th>الرسالة</th><th>الحالة</th><th>التاريخ</th></tr></thead>
      <tbody>${S.sms.map(s => `
        <tr>
          <td class="mono">${esc(s.phone || s.to)}</td>
          <td class="tight">${esc(s.message || s.body)}</td>
          <td><span class="chip ${s.status === 'sent' ? 'ok' : 'bad'}">${s.status || 'sent'}</span></td>
          <td class="sub">${dt(s.created_at)}</td>
        </tr>
      `).join('')}</tbody>
    </table>
  </div>
  `;
}

/* ═══ Event Binding ═══ */
function bind() {
  const qBox = $('#qBox');   if(qBox) {     qBox.oninput = e => { S.q = e.target.value; render(); };     qBox.focus();     qBox.selectionStart = qBox.selectionEnd = S.q.length;   }   $$('[data-filter]').forEach(b => {
    b.onclick = () => { S.filter = b.dataset.filter; render(); };
  });
}

