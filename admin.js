/* ═══════════════════════════════════════════════════════════
   KARDO — Admin Dashboard v2
   يعمل مع worker.js الجديد
   ═══════════════════════════════════════════════════════════ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, addDoc,
  onSnapshot, collection, query, orderBy, limit
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
  users: [], orders: [], deposits: [], withdrawals: [],
  tickets: [], coupons: [], sms: [], providers: [],
  cats: [], prods: [],
  pricing: {}, ops: {},
  q: '', filter: 'all', setTab: 'ops'
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
  down:'<path d="M12 5v14M18.5 12.5 12 19l-6.5-6.5"/>',
  copy:'<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  refresh:'<path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/>',
  cloud:'<path d="M17.5 19a4.5 4.5 0 0 0 .5-9 6 6 0 0 0-11.6 1.5A3.8 3.8 0 0 0 7 19z"/>',
  bell:'<path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
  download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>'
};
const svg = (d, w = 1.8) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

function mark(size = 32) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" style="flex:none">
    <rect width="40" height="40" rx="11" fill="#131C2C"/>
    <path d="M11 9h4.4v22H11z" fill="#10B981"/>
    <path d="M17 20.2 27.5 9H33L22.4 20.2 33 31h-5.6z" fill="#10B981"/>
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
  const ic = kind === 'ok' ? svg(I.check, 2.4)
           : kind === 'bad' ? svg(I.warn, 2) : '';
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
  }, err => { console.warn(key, err.code); }));
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
  sub(query(collection(db,'providers')),'providers');
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
  { k:'home',       t:'نظرة عامة',  i:I.home,   g:'الرئيسية' },
  { k:'orders',     t:'الطلبات',    i:I.bag,    g:'الطلبات', badge:'pendingOrders' },
  { k:'deposits',   t:'الإيداعات',  i:I.cash,   g:'الطلبات', badge:'pendingDeposits' },
  { k:'withdrawals',t:'السحوبات',   i:I.down,   g:'الطلبات', badge:'pendingWd' },
  { k:'products',   t:'المنتجات',   i:I.grid,   g:'المتجر' },
  { k:'categories', t:'الأقسام',    i:I.tag,    g:'المتجر' },
  { k:'coupons',    t:'الكوبونات',  i:I.tag,    g:'المتجر' },
  { k:'users',      t:'المستخدمون', i:I.users,  g:'العملاء' },
  { k:'tickets',    t:'التذاكر',    i:I.help,   g:'الدعم', badge:'openTickets' },
  { k:'providers',  t:'المزودون',   i:I.cloud,  g:'النظام' },
  { k:'settings',   t:'الإعدادات',  i:I.gear,   g:'النظام' },
  { k:'sms',        t:'الرسائل',    i:I.bell,   g:'النظام' }
];
/* ⚠️ القائمة السفلية تحتوي الآن على المزودين */
const DOCK = ['home','orders','products','providers','settings'];

const badges = {
  pendingOrders:   () => S.orders.filter(o => o.status === 'pending').length,
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
      html += `<button class="nav ${S.page === p.k ? 'on' : ''}" data-nav="${p.k}">
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
  if(!view) return;

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

/* ═══ Home ═══ */
function vHome() {
  const done = S.orders.filter(o => o.status === 'completed');
  const revenue = done.reduce((s, o) => s + n(o.total_lyd), 0);
  const profit = done.reduce((s, o) => s + n(o.total_lyd) * .15, 0);
  const pending = S.orders.filter(o => o.status === 'pending').length;
  const failed = S.orders.filter(o => o.status === 'rejected').length;
  const float = n(S.ops.provider_float, 0);
  const thresh = n(S.ops.low_balance_threshold, 30);

  const days = [...Array(14)].map((_, i) => {
    const d = new Date(); d.setHours(0,0,0,0);
    d.setDate(d.getDate() - (13 - i));
    const nx = new Date(d); nx.setDate(nx.getDate() + 1);
    const p = done
      .filter(o => {
        const t = o.created_at?.toDate?.() || new Date(o.created_at || 0);
        return t >= d && t < nx;
      })
      .reduce((s, o) => s + n(o.total_lyd), 0);
    return { d, p };
  });
  const peak = Math.max(...days.map(x => x.p), 1);
  const weekRev = days.reduce((s, x) => s + x.p, 0);

  const recent = S.orders.slice(0, 6);

  return `
  ${float < thresh ? `<div class="note bad">
    ${svg(I.warn)}<strong>رصيد المزود منخفض — ${usd(float)}</strong>
  </div>` : ''}

  <div class="h1" style="margin-bottom:4px">مرحبًا</div>
  <p class="sub" style="margin-bottom:16px">ملخص أداء المتجر</p>

  <div class="kpis">
    ${kpi(I.cash, lyd(revenue), 'إجمالي المبيعات', '#ECFDF5', '#059669', '', '')}
    ${kpi(I.chart, lyd(profit), 'صافي الأرباح', '#EFF6FF', '#2563EB', '', '')}
    ${kpi(I.bag, S.orders.length, 'إجمالي الطلبات', '#FEF3C7', '#B45309',
      '', pending ? pending + ' قيد التنفيذ' : '')}
    ${kpi(I.users, S.users.length, 'المستخدمون', '#F1F5F9', '#475569', '', '')}
    ${kpi(I.cloud, S.providers.length, 'المزودون', '#ECFDF5', '#059669', '', '')}
    ${kpi(I.warn, failed, 'عمليات فاشلة', '#FEE2E2', '#B91C1C', '', '')}
  </div>

  <div class="grid2" style="margin-bottom:14px">
    <div class="box">
      <div style="margin-bottom:14px">
        <div class="h2">الإيرادات — 14 يومًا</div>
        <div class="sub" style="font-size:12px;margin-top:2px">
          المجموع ${lyd(weekRev)}
        </div>
      </div>
      <div class="spark">
        ${days.map(x => `<i style="height:${Math.max(3, (x.p/peak)*100)}%"
            title="${lyd(x.p)}"></i>`).join('')}
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
          ['providers', I.cloud, 'إدارة المزودين'],
          ['products', I.plus, 'إضافة منتج جديد'],
          ['categories', I.tag, 'إدارة الأقسام'],
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
    </div></div>`}`;
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
  completed: ['ok','مكتمل'],
  pending: ['wait','قيد التنفيذ'],
  processing: ['wait','قيد المعالجة'],
  rejected: ['bad','مرفوض'],
  refunded: ['bad','مسترد']
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
            <td><span class="chip ${st[0]}">${st[1]}</span></td>
            <td class="sub" style="font-size:11.5px">${dt(o.created_at)}</td>
            <td>${pend ? `<button class="btn sm"
              data-ord="${esc(o.id)}">إدارة</button>` : ''}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`
    : `<div class="box"><div class="empty">
        <div class="ei">${svg(I.bag,1.6)}</div>
        <div class="et">لا طلبات</div>
      </div></div>`}`;
}

window.openOrder = id => {
  const o = S.orders.find(x => x.id === id);
  if(!o) return;
  const u = S.users.find(x => x.id === o.uid);
  const st = ostatus(o.status);
  const pend = o.status === 'pending' || o.status === 'processing';

  sheet(`
    <div class="sheet-head">
      <div style="flex:1;min-width:0">
        <div class="h2">طلب ${esc(String(o.id).slice(-10))}</div>
        <div class="sub">${dt(o.created_at)}</div>
      </div>
      <span class="chip ${st[0]}">${st[1]}</span>
    </div>

    <div class="box" style="background:var(--s2);margin-bottom:12px">
      <div class="h3" style="margin-bottom:8px">العميل</div>
      <div class="prow"><span class="pk">الاسم</span>
        <span class="pv" style="font-family:inherit;color:var(--tx)">
          ${esc(u ? (u.name || u.email) : '—')}</span></div>
      <div class="prow"><span class="pk">البريد</span>
        <span class="pv" style="font-family:inherit;color:var(--tx)"
          dir="ltr">${esc(u ? u.email : '—')}</span></div>
    </div>

    <div class="box" style="background:var(--s2);margin-bottom:12px">
      <div class="h3" style="margin-bottom:8px">المنتجات</div>
      ${(o.items||[]).map(i => `
        <div style="padding:8px 0;border-bottom:1px solid var(--line)">
          <div style="display:flex;justify-content:space-between;gap:10px">
            <span style="font-size:13.5px;font-weight:700">${esc(i.name)}</span>
            <span class="num" style="font-size:13px">${lyd(i.line_lyd)}</span>
          </div>
          <div class="sub" style="font-size:11.5px">
            ${i.qty} × ${lyd(i.price_lyd)}
            ${i.values ? ' · ' + Object.values(i.values).map(esc).join(' · ') : ''}
          </div>
        </div>`).join('')}
      <div class="prow" style="margin-top:8px">
        <span class="pk">الإجمالي</span>
        <span class="pv">${lyd(o.total_lyd)}</span></div>
    </div>

    ${pend ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;
           margin-bottom:12px">
        <button class="btn" id="ordOk">إتمام الطلب</button>
        <button class="btn bad" id="ordNo">رفض واسترجاع</button>
      </div>` : ''}

    <button class="btn line wide" onclick="closeSheet()">إغلاق</button>`);

  const ok = $('#ordOk');
  const no = $('#ordNo');

  if(ok) ok.onclick = () => {
    sheet(`
      <div class="h2" style="margin-bottom:8px">إتمام الطلب</div>
      <p class="sub" style="margin-bottom:12px">أدخل ما تريد تسليمه للعميل</p>
      <textarea class="inp" id="dlvTxt" rows="3"
        placeholder="الأكواد أو ملاحظة التسليم"></textarea>
      <button class="btn wide" id="dlvGo" style="margin-top:12px">
        تأكيد الإتمام</button>
      <button class="btn line wide" style="margin-top:8px"
              onclick="openOrder('${esc(id)}')">رجوع</button>`);
    $('#dlvGo').onclick = async () => {
      const b = $('#dlvGo');
      b.disabled = true; b.classList.add('loading');
      try {
        await api('/api/admin/order', {
          order_id: id, action: 'complete',
          delivery: $('#dlvTxt').value.trim()
        });
        toast('تم إتمام الطلب', 'ok');
        closeSheet();
      } catch(e) {
        toast(e.message, 'bad');
        b.disabled = false; b.classList.remove('loading');
      }
    };
  };

  if(no) no.onclick = () => {
    sheet(`
      <div class="h2" style="margin-bottom:8px">رفض الطلب</div>
      <div class="note">سيُعاد ${lyd(o.total_lyd)} إلى محفظة العميل</div>
      <input class="inp" id="rjTxt" placeholder="سبب الرفض">
      <button class="btn wide" id="rjGo" style="margin-top:12px">
        تأكيد الرفض</button>
      <button class="btn line wide" style="margin-top:8px"
              onclick="openOrder('${esc(id)}')">رجوع</button>`);
    $('#rjGo').onclick = async () => {
      const b = $('#rjGo');
      b.disabled = true; b.classList.add('loading');
      try {
        await api('/api/admin/order', {
          order_id: id, action: 'reject',
          reason: $('#rjTxt').value.trim() || 'مرفوض'
        });
        toast('تم رفض الطلب', 'ok');
        closeSheet();
      } catch(e) {
        toast(e.message, 'bad');
        b.disabled = false; b.classList.remove('loading');
      }
    };
  };
};

/* ═══ Deposits ═══ */
function vDeposits() {
  const F = [['all','الكل'],['pending','قيد المراجعة'],
             ['approved','مقبول'],['rejected','مرفوض']];
  let rows = S.deposits;
  if(S.filter !== 'all') rows = rows.filter(d => d.status === S.filter);

  return `
  <div class="flex-b" style="margin-bottom:16px">
    <div>
      <div class="h1">الإيداعات</div>
      <p class="sub">${rows.length} من ${S.deposits.length}</p>
    </div>
  </div>

  <div class="tabs" style="margin-bottom:14px">
    ${F.map(([k, t]) => `<button class="tab ${S.filter === k ? 'on' : ''}"
      data-filter="${k}">${t}</button>`).join('')}
  </div>

  ${rows.length ? `
    <div class="scrollx">
      <table class="tbl">
        <thead><tr>
          <th>العميل</th><th>المبلغ</th><th>الطريقة</th>
          <th>الحالة</th><th>التاريخ</th><th></th>
        </tr></thead>
        <tbody>${rows.map(d => {
          const u = S.users.find(x => x.id === d.uid);
          const st = { approved:['ok','مقبول'], pending:['wait','قيد المراجعة'],
            rejected:['bad','مرفوض'] }[d.status] || ['off','—'];
          return `<tr>
            <td>${esc(u ? (u.name || u.email) : '—')}</td>
            <td class="num">${usd(d.amount_usd)}</td>
            <td>${esc(d.method || '—')}</td>
            <td><span class="chip ${st[0]}">${st[1]}</span></td>
            <td class="sub" style="font-size:11.5px">${dt(d.created_at)}</td>
            <td>${d.status === 'pending' ? `
              <button class="btn sm" data-dep="${esc(d.id)}">مراجعة</button>
            ` : ''}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`
    : `<div class="box"><div class="empty">
        <div class="ei">${svg(I.cash,1.6)}</div>
        <div class="et">لا إيداعات</div>
      </div></div>`}`;
}

window.openDeposit = id => {
  const d = S.deposits.find(x => x.id === id);
  if(!d) return;
  const u = S.users.find(x => x.id === d.uid);

  sheet(`
    <div class="sheet-head">
      <div style="flex:1">
        <div class="h2">إيداع جديد</div>
        <div class="sub">${dt(d.created_at)}</div>
      </div>
    </div>

    <div class="box" style="background:var(--s2);margin-bottom:12px">
      <div class="prow"><span class="pk">العميل</span>
        <span class="pv" style="font-family:inherit;color:var(--tx)">
          ${esc(u ? (u.name || u.email) : '—')}</span></div>
      <div class="prow"><span class="pk">المبلغ</span>
        <span class="pv">${usd(d.amount_usd)}</span></div>
      <div class="prow"><span class="pk">بالدينار</span>
        <span class="pv">${lyd(d.amount_lyd)}</span></div>
      <div class="prow"><span class="pk">الطريقة</span>
        <span class="pv" style="font-family:inherit;color:var(--tx)">
          ${esc(d.method || '—')}</span></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="btn" id="dOk">قبول وإضافة</button>
      <button class="btn bad" id="dNo">رفض</button>
    </div>
    <button class="btn line wide" style="margin-top:8px"
            onclick="closeSheet()">إغلاق</button>`);

  $('#dOk').onclick = async () => {
    const b = $('#dOk');
    b.disabled = true; b.classList.add('loading');
    try {
      await api('/api/admin/deposit', { deposit_id: id, action: 'approve' });
      toast('تم قبول الإيداع', 'ok');
      closeSheet();
    } catch(e) {
      toast(e.message, 'bad');
      b.disabled = false; b.classList.remove('loading');
    }
  };
  $('#dNo').onclick = async () => {
    const b = $('#dNo');
    b.disabled = true; b.classList.add('loading');
    try {
      await api('/api/admin/deposit', {
        deposit_id: id, action: 'reject', reason: 'مرفوض من الإدارة'
      });
      toast('تم رفض الإيداع', 'ok');
      closeSheet();
    } catch(e) {
      toast(e.message, 'bad');
      b.disabled = false; b.classList.remove('loading');
    }
  };
};

/* ═══ Withdrawals ═══ */
function vWithdrawals() {
  const F = [['all','الكل'],['pending','قيد التنفيذ'],
             ['completed','مكتمل'],['rejected','مرفوض']];
  let rows = S.withdrawals;
  if(S.filter !== 'all') rows = rows.filter(w => w.status === S.filter);

  return `
  <div class="flex-b" style="margin-bottom:16px">
    <div>
      <div class="h1">السحوبات</div>
      <p class="sub">${rows.length} من ${S.withdrawals.length}</p>
    </div>
  </div>

  <div class="tabs" style="margin-bottom:14px">
    ${F.map(([k, t]) => `<button class="tab ${S.filter === k ? 'on' : ''}"
      data-filter="${k}">${t}</button>`).join('')}
  </div>

  ${rows.length ? `
    <div class="scrollx">
      <table class="tbl">
        <thead><tr>
          <th>العميل</th><th>المبلغ</th><th>الصافي</th><th>الطريقة</th>
          <th>الحالة</th><th>التاريخ</th><th></th>
        </tr></thead>
        <tbody>${rows.map(w => {
          const u = S.users.find(x => x.id === w.uid);
          const st = { completed:['ok','مكتمل'], pending:['wait','قيد التنفيذ'],
            rejected:['bad','مرفوض'] }[w.status] || ['off','—'];
          return `<tr>
            <td>${esc(u ? (u.name || u.email) : '—')}</td>
            <td class="num">${usd(w.amount_usd)}</td>
            <td class="num">${usd(w.net)}</td>
            <td>${esc(w.method || '—')}</td>
            <td><span class="chip ${st[0]}">${st[1]}</span></td>
            <td class="sub" style="font-size:11.5px">${dt(w.created_at)}</td>
            <td>${w.status === 'pending' ? `
              <button class="btn sm" data-wd="${esc(w.id)}">مراجعة</button>
            ` : ''}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`
    : `<div class="box"><div class="empty">
        <div class="ei">${svg(I.down,1.6)}</div>
        <div class="et">لا سحوبات</div>
      </div></div>`}`;
}

window.openWithdrawal = id => {
  const w = S.withdrawals.find(x => x.id === id);
  if(!w) return;
  const u = S.users.find(x => x.id === w.uid);

  sheet(`
    <div class="sheet-head">
      <div style="flex:1">
        <div class="h2">طلب سحب</div>
        <div class="sub">${dt(w.created_at)}</div>
      </div>
    </div>

    <div class="box" style="background:var(--s2);margin-bottom:12px">
      <div class="prow"><span class="pk">العميل</span>
        <span class="pv" style="font-family:inherit;color:var(--tx)">
          ${esc(u ? (u.name || u.email) : '—')}</span></div>
      <div class="prow"><span class="pk">المبلغ</span>
        <span class="pv">${usd(w.amount_usd)}</span></div>
      <div class="prow"><span class="pk">الصافي</span>
        <span class="pv">${usd(w.net)}</span></div>
      <div class="prow"><span class="pk">الطريقة</span>
        <span class="pv" style="font-family:inherit;color:var(--tx)">
          ${esc(w.method || '—')}</span></div>
      <div class="prow"><span class="pk">الوجهة</span>
        <span class="pv mono" dir="ltr">${esc(w.destination || '—')}</span></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="btn" id="wdOk">تم التحويل</button>
      <button class="btn bad" id="wdNo">رفض</button>
    </div>
    <button class="btn line wide" style="margin-top:8px"
            onclick="closeSheet()">إغلاق</button>`);

  $('#wdOk').onclick = async () => {
    const b = $('#wdOk');
    b.disabled = true; b.classList.add('loading');
    try {
      await api('/api/admin/withdraw', { id, action: 'complete' });
      toast('تم تنفيذ السحب', 'ok');
      closeSheet();
    } catch(e) {
      toast(e.message, 'bad');
      b.disabled = false; b.classList.remove('loading');
    }
  };
  $('#wdNo').onclick = async () => {
    const b = $('#wdNo');
    b.disabled = true; b.classList.add('loading');
    try {
      await api('/api/admin/withdraw', {
        id, action: 'reject', reason: 'مرفوض من الإدارة'
      });
      toast('تم رفض السحب', 'ok');
      closeSheet();
    } catch(e) {
      toast(e.message, 'bad');
      b.disabled = false; b.classList.remove('loading');
    }
  };
};
/* ═══════════════════════════════════════════════════════════
   PART 2 — Products, Categories, Users, Tickets, Providers
   ═══════════════════════════════════════════════════════════ */

/* ═══ Products ═══ */
function vProducts() {
  let rows = S.prods;
  if(S.q) rows = rows.filter(p =>
    (p.name||'').toLowerCase().includes(S.q.toLowerCase()));

  return `
  <div class="flex-b" style="margin-bottom:16px;flex-wrap:wrap;gap:10px">
    <div>
      <div class="h1">المنتجات</div>
      <p class="sub">${rows.length} منتج</p>
    </div>
    <button class="btn" id="addProd">
      ${svg(I.plus, 2.1)} منتج جديد
    </button>
  </div>

  <input class="inp" id="qBox" placeholder="ابحث عن منتج…"
         value="${esc(S.q)}" style="margin-bottom:14px">

  ${rows.length ? `
    <div class="scrollx">
      <table class="tbl">
        <thead><tr>
          <th>المنتج</th><th>القسم</th><th>النوع</th>
          <th>السعر</th><th>المخزون</th><th>الحالة</th><th></th>
        </tr></thead>
        <tbody>${rows.map(p => {
          const c = S.cats.find(x => x.id === p.cat);
          return `<tr>
            <td class="tight" style="font-weight:700">${esc(p.name||'—')}</td>
            <td class="sub">${esc(c ? c.name : '—')}</td>
            <td><span class="chip ${p.kind === 'stock' ? 'ok' : 'info'}">
              ${p.kind === 'stock' ? 'كود فوري' : 'تنفيذ يدوي'}</span></td>
            <td class="num">${lyd(p.price)}</td>
            <td class="num">${p.kind === 'stock' ? n(p.stock_count) : '—'}</td>
            <td>${p.active === false
              ? '<span class="chip bad">مخفي</span>'
              : '<span class="chip ok">ظاهر</span>'}</td>
            <td>
              <button class="btn ghost sm" data-ep="${esc(p.id)}">
                ${svg(I.edit, 2)}</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`
    : `<div class="box"><div class="empty">
        <div class="ei">${svg(I.grid, 1.6)}</div>
        <div class="et">لا منتجات</div>
        <p>ابدأ بإضافة أول منتج.</p>
      </div></div>`}`;
}

window.openProduct = id => {
  const p = id ? S.prods.find(x => x.id === id)
    : { name:'', desc:'', image:'', price:0, old_price:0,
        kind:'manual', cat:'', fields:[], stock_count:0,
        active:true, featured:false, note:'' };

  sheet(`
    <div class="sheet-head">
      <div style="flex:1">
        <div class="h2">${id ? 'تعديل منتج' : 'منتج جديد'}</div>
      </div>
    </div>

    <label class="lbl">اسم المنتج</label>
    <input class="inp" id="pName" value="${esc(p.name)}"
           placeholder="مثال: 660 UC — PUBG">

    <label class="lbl" style="margin-top:12px">الوصف</label>
    <textarea class="inp" id="pDesc" rows="2"
      placeholder="شرح مختصر">${esc(p.desc)}</textarea>

    <label class="lbl" style="margin-top:12px">رابط الصورة</label>
    <input class="inp" id="pImg" value="${esc(p.image)}"
           placeholder="https://...">

    <label class="lbl" style="margin-top:12px">القسم</label>
    <select class="inp" id="pCat">
      <option value="">— اختر قسمًا —</option>
      ${S.cats.map(c => `<option value="${esc(c.id)}"
        ${c.id === p.cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
    </select>

    <div class="grid2" style="margin-top:12px">
      <div>
        <label class="lbl">السعر (د.ل)</label>
        <input class="inp num" id="pPrice" type="number" step="0.5"
               value="${n(p.price)}">
      </div>
      <div>
        <label class="lbl">السعر قبل الخصم</label>
        <input class="inp num" id="pOld" type="number" step="0.5"
               value="${n(p.old_price)}">
      </div>
    </div>

    <label class="lbl" style="margin-top:12px">نوع التسليم</label>
    <select class="inp" id="pKind">
      <option value="manual" ${p.kind !== 'stock' ? 'selected' : ''}>
        تنفيذ يدوي</option>
      <option value="stock" ${p.kind === 'stock' ? 'selected' : ''}>
        كود فوري من المخزون</option>
    </select>

    <div id="stockBox" style="display:${p.kind === 'stock' ? 'block' : 'none'};
         margin-top:12px">
      <label class="lbl">أكواد المخزون (كود في كل سطر)</label>
      <textarea class="inp mono" id="pStock" rows="4" dir="ltr"
        placeholder="CODE-001&#10;CODE-002"></textarea>
      ${id && p.stock_count
        ? `<p class="sub" style="font-size:11.5px;margin-top:4px">
            المخزون الحالي: ${n(p.stock_count)} كود</p>` : ''}
    </div>

    <label class="lbl" style="margin-top:12px">ملاحظة</label>
    <input class="inp" id="pNote" value="${esc(p.note)}"
           placeholder="ملاحظة تظهر للعميل">

    <div class="sw-row" style="margin-top:12px">
      <div><div class="sw-lbl">ظاهر للعملاء</div></div>
      <div class="sw ${p.active !== false ? 'on' : ''}" id="pActive"></div>
    </div>

    <div class="sw-row">
      <div><div class="sw-lbl">منتج مميز</div></div>
      <div class="sw ${p.featured ? 'on' : ''}" id="pFeat"></div>
    </div>

    <div style="margin-top:14px">
      <div class="flex-b" style="margin-bottom:8px">
        <span class="lbl" style="margin:0">الحقول المطلوبة من العميل</span>
        <button class="btn ghost sm" id="addField">+ حقل</button>
      </div>
      <div id="fieldsWrap">
        ${(p.fields||[]).map((f, i) => fieldRow(i, f)).join('')
          || '<p class="sub" style="font-size:12px">لا حقول.</p>'}
      </div>
    </div>

    <button class="btn wide" id="pSave" style="margin-top:16px">
      ${id ? 'حفظ التعديلات' : 'إضافة المنتج'}</button>

    ${id ? `<button class="btn bad wide" style="margin-top:8px" id="pDel">
      حذف المنتج</button>` : ''}

    <button class="btn line wide" style="margin-top:8px"
            onclick="closeSheet()">إلغاء</button>`);

  $('#pKind').onchange = e => {
    $('#stockBox').style.display = e.target.value === 'stock' ? 'block' : 'none';
  };
  $('#pActive').onclick = e => e.currentTarget.classList.toggle('on');
  $('#pFeat').onclick = e => e.currentTarget.classList.toggle('on');

  function fieldRow(i, f) {
    f = f || { key:'', label:'', type:'text', required:true, hint:'' };
    return `<div class="frow-item" data-fi="${i}"
      style="display:grid;grid-template-columns:1fr 1fr 100px auto auto;gap:6px;
             align-items:center;margin-bottom:6px;padding:8px;border-radius:10px;
             background:var(--s2);border:1px solid var(--line)">
      <input class="inp" data-f="label" value="${esc(f.label)}"
             placeholder="اسم الحقل" style="font-size:12px">
      <input class="inp mono" data-f="key" value="${esc(f.key)}"
             placeholder="key" dir="ltr" style="font-size:11.5px">
      <select class="inp" data-f="type" style="font-size:11.5px">
        ${['text','number','email','tel'].map(t =>
          `<option value="${t}" ${f.type===t?'selected':''}>${t}</option>`
        ).join('')}
      </select>
      <label style="display:flex;align-items:center;gap:4px;font-size:11px;
             color:var(--tx-3);cursor:pointer">
        <input type="checkbox" data-f="req" ${f.required?'checked':''}
               style="width:14px;height:14px;accent-color:var(--g)">
      </label>
      <button class="btn bad sm" data-rmf="1"
        style="padding:5px 8px;font-size:14px">×</button>
    </div>`;
  }

  $('#addField').onclick = () => {
    const w = $('#fieldsWrap');
    const empty = w.querySelector('p.sub');
    if(empty) empty.remove();
    const i = w.querySelectorAll('.frow-item').length;
    w.insertAdjacentHTML('beforeend', fieldRow(i, null));
    bindFieldRows();
  };

  function bindFieldRows() {
    $$('[data-rmf]').forEach(b => {
      b.onclick = () => {
        b.closest('.frow-item').remove();
        if(!$('#fieldsWrap').querySelector('.frow-item'))
          $('#fieldsWrap').innerHTML =
            '<p class="sub" style="font-size:12px">لا حقول.</p>';
      };
    });
  }
  bindFieldRows();

  $('#pSave').onclick = async () => {
    const btn = $('#pSave');
    const name = $('#pName').value.trim();
    const cat  = $('#pCat').value;
    if(!name) return toast('اكتب اسم المنتج', 'bad');
    if(!cat)  return toast('اختر القسم', 'bad');

    const fields = [...$('#fieldsWrap').querySelectorAll('.frow-item')]
      .map((r, i) => {
        const label = r.querySelector('[data-f=label]').value.trim();
        const key = r.querySelector('[data-f=key]').value.trim()
          .replace(/[^a-zA-Z0-9_]/g, '') || ('f' + i);
        return {
          key, label,
          type: r.querySelector('[data-f=type]').value,
          required: r.querySelector('[data-f=req]').checked,
          hint: ''
        };
      }).filter(f => f.label);

    const data = {
      name, cat,
      desc: $('#pDesc').value.trim(),
      image: $('#pImg').value.trim(),
      price: n($('#pPrice').value),
      old_price: n($('#pOld').value),
      kind: $('#pKind').value,
      note: $('#pNote').value.trim(),
      active: $('#pActive').classList.contains('on'),
      featured: $('#pFeat').classList.contains('on'),
      fields,
      updated_at: new Date().toISOString()
    };

    btn.disabled = true; btn.classList.add('loading');

    try {
      let pid = id;
      if(id) {
        await setDoc(doc(db, 'products', id), data, { merge: true });
      } else {
        const ref = await addDoc(collection(db, 'products'), {
          ...data,
          stock_count: 0,
          created_at: new Date().toISOString()
        });
        pid = ref.id;
      }

      const codes = ($('#pStock') ? $('#pStock').value : '')
        .split('\n').map(x => x.trim()).filter(Boolean);

      if(data.kind === 'stock' && codes.length) {
        for(const c of codes.slice(0, 200)) {
          await addDoc(collection(db, 'stock'), {
            pid, code: c, used: false,
            created_at: new Date().toISOString()
          });
        }
        const cur = id ? n(S.prods.find(x => x.id === id)?.stock_count) : 0;
        await setDoc(doc(db, 'products', pid),
          { stock_count: cur + codes.length }, { merge: true });
      }

      toast(id ? 'تم حفظ التعديلات' : 'تم إضافة المنتج', 'ok');
      closeSheet();
    } catch(e) {
      toast(e.message, 'bad');
      btn.disabled = false; btn.classList.remove('loading');
    }
  };

  if(id) {
    $('#pDel').onclick = async () => {
      sheet(`
        <div class="h2" style="margin-bottom:8px">حذف المنتج</div>
        <p class="sub" style="margin-bottom:16px">
          سيُحذف «${esc(p.name)}» نهائيًا.</p>
        <button class="btn bad wide" id="delOk">تأكيد الحذف</button>
        <button class="btn line wide" style="margin-top:8px"
                onclick="openProduct('${esc(id)}')">رجوع</button>`);
      $('#delOk').onclick = async () => {
        try {
          await deleteDoc(doc(db, 'products', id));
          toast('تم حذف المنتج', 'ok');
          closeSheet();
        } catch(e) { toast(e.message, 'bad'); }
      };
    };
  }
};

/* ═══ Categories ═══ */
function vCategories() {
  return `
  <div class="flex-b" style="margin-bottom:16px">
    <div>
      <div class="h1">الأقسام</div>
      <p class="sub">${S.cats.length} قسم</p>
    </div>
    <button class="btn" id="addCat">
      ${svg(I.plus, 2.1)} قسم جديد
    </button>
  </div>

  ${S.cats.length ? `
    <div class="scrollx">
      <table class="tbl">
        <thead><tr>
          <th>القسم</th><th>الأب</th><th>الأيقونة</th>
          <th>الترتيب</th><th>الحالة</th><th></th>
        </tr></thead>
        <tbody>${[...S.cats].sort((a,b) => n(a.sort,99) - n(b.sort,99))
          .map(c => {
            const parent = c.parent
              ? S.cats.find(x => x.id === c.parent) : null;
            return `<tr>
              <td style="font-weight:700">${esc(c.name||'—')}</td>
              <td class="sub">${parent ? esc(parent.name) : '—'}</td>
              <td>${esc(c.icon || '—')}</td>
              <td class="num">${n(c.sort, 99)}</td>
              <td>${c.soon
                ? '<span class="chip wait">قريبًا</span>'
                : c.active === false
                ? '<span class="chip bad">مخفي</span>'
                : '<span class="chip ok">ظاهر</span>'}</td>
              <td>
                <button class="btn ghost sm" data-ec="${esc(c.id)}">
                  ${svg(I.edit, 2)}</button>
              </td>
            </tr>`;
          }).join('')}</tbody>
      </table>
    </div>`
    : `<div class="box"><div class="empty">
        <div class="ei">${svg(I.tag, 1.6)}</div>
        <div class="et">لا أقسام</div>
        <p>ابدأ بإضافة أول قسم.</p>
      </div></div>`}`;
}

window.openCategory = id => {
  const c = id ? S.cats.find(x => x.id === id)
    : { name:'', icon:'grid', parent:'', sort:10,
        soon:false, active:true, image:'' };

  const ICONS = ['grid','play','tv','music','card','phone','cloud',
                 'bolt','shop','crown','globe','book','gift','fire'];

  sheet(`
    <div class="sheet-head">
      <div style="flex:1">
        <div class="h2">${id ? 'تعديل قسم' : 'قسم جديد'}</div>
      </div>
    </div>

    <label class="lbl">اسم القسم</label>
    <input class="inp" id="cName" value="${esc(c.name)}"
           placeholder="مثال: اشتراكات">

    <label class="lbl" style="margin-top:12px">القسم الأب (اختياري)</label>
    <select class="inp" id="cParent">
      <option value="">— قسم رئيسي —</option>
      ${S.cats.filter(x => x.id !== id)
        .map(x => `<option value="${esc(x.id)}"
          ${x.id === c.parent ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
    </select>

    <label class="lbl" style="margin-top:12px">الأيقونة</label>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">
      ${ICONS.map(k => `
        <button class="icon-pick" data-ic="${k}"
          style="aspect-ratio:1;border-radius:10px;display:grid;
                 place-items:center;border:1.5px solid ${
                   k === (c.icon||'grid') ? 'var(--g)' : 'var(--line-2)'
                 };background:${
                   k === (c.icon||'grid') ? 'var(--g-soft)' : 'var(--s2)'
                 };color:${
                   k === (c.icon||'grid') ? 'var(--g)' : 'var(--tx-2)'
                 };font-size:10px;font-weight:600">
          ${k}
        </button>`).join('')}
    </div>

    <label class="lbl" style="margin-top:12px">الترتيب</label>
    <input class="inp num" id="cSort" type="number"
           value="${n(c.sort, 10)}" min="0" max="99">

    <div class="sw-row" style="margin-top:12px">
      <div><div class="sw-lbl">ظاهر للعملاء</div></div>
      <div class="sw ${c.active !== false ? 'on' : ''}" id="cActive"></div>
    </div>

    <div class="sw-row">
      <div>
        <div class="sw-lbl">شارة «قريبًا»</div>
        <div class="sw-desc">يمنع الشراء</div>
      </div>
      <div class="sw ${c.soon ? 'on' : ''}" id="cSoon"></div>
    </div>

    <button class="btn wide" id="cSave" style="margin-top:16px">
      ${id ? 'حفظ التعديلات' : 'إضافة القسم'}</button>

    ${id ? `<button class="btn bad wide" style="margin-top:8px" id="cDel">
      حذف القسم</button>` : ''}

    <button class="btn line wide" style="margin-top:8px"
            onclick="closeSheet()">إلغاء</button>`);

  let picked = c.icon || 'grid';
  $$('.icon-pick').forEach(b => b.onclick = () => {
    $$('.icon-pick').forEach(x => {
      x.style.borderColor = 'var(--line-2)';
      x.style.background = 'var(--s2)';
      x.style.color = 'var(--tx-2)';
    });
    b.style.borderColor = 'var(--g)';
    b.style.background = 'var(--g-soft)';
    b.style.color = 'var(--g)';
    picked = b.dataset.ic;
  });

  $('#cActive').onclick = e => e.currentTarget.classList.toggle('on');
  $('#cSoon').onclick = e => e.currentTarget.classList.toggle('on');

  $('#cSave').onclick = async () => {
    const btn = $('#cSave');
    const name = $('#cName').value.trim();
    if(!name) return toast('اكتب اسم القسم', 'bad');

    const data = {
      name,
      parent: $('#cParent').value,
      icon: picked,
      sort: n($('#cSort').value, 10),
      active: $('#cActive').classList.contains('on'),
      soon: $('#cSoon').classList.contains('on'),
      updated_at: new Date().toISOString()
    };

    btn.disabled = true; btn.classList.add('loading');
    try {
      if(id) await setDoc(doc(db, 'categories', id), data, { merge: true });
      else await addDoc(collection(db, 'categories'), {
        ...data, created_at: new Date().toISOString()
      });
      toast(id ? 'تم حفظ التعديلات' : 'تم إضافة القسم', 'ok');
      closeSheet();
    } catch(e) {
      toast(e.message, 'bad');
      btn.disabled = false; btn.classList.remove('loading');
    }
  };

  if(id) {
    $('#cDel').onclick = async () => {
      if(S.prods.some(p => p.cat === id))
        return toast('احذف منتجات القسم أولًا', 'bad');
      if(S.cats.some(x => x.parent === id))
        return toast('احذف الأقسام الفرعية أولًا', 'bad');
      sheet(`
        <div class="h2" style="margin-bottom:8px">حذف القسم</div>
        <p class="sub" style="margin-bottom:16px">
          سيُحذف «${esc(c.name)}» نهائيًا.</p>
        <button class="btn bad wide" id="delOk">تأكيد الحذف</button>
        <button class="btn line wide" style="margin-top:8px"
                onclick="openCategory('${esc(id)}')">رجوع</button>`);
      $('#delOk').onclick = async () => {
        try {
          await deleteDoc(doc(db, 'categories', id));
          toast('تم حذف القسم', 'ok');
          closeSheet();
        } catch(e) { toast(e.message, 'bad'); }
      };
    };
  }
};

/* ═══ Users ═══ */
function vUsers() {
  let rows = S.users;
  if(S.q) rows = rows.filter(u =>
    ((u.name||'') + ' ' + (u.email||'') + ' ' + (u.phone||''))
      .toLowerCase().includes(S.q.toLowerCase()));

  return `
  <div class="flex-b" style="margin-bottom:16px">
    <div>
      <div class="h1">المستخدمون</div>
      <p class="sub">${rows.length} من ${S.users.length}</p>
    </div>
  </div>

  <input class="inp" id="qBox" placeholder="ابحث بالاسم أو البريد أو الهاتف"
         value="${esc(S.q)}" style="margin-bottom:14px">

  ${rows.length ? `
    <div class="scrollx">
      <table class="tbl">
        <thead><tr>
          <th>الاسم</th><th>البريد</th><th>الهاتف</th>
          <th>الرصيد</th><th>الإنفاق</th><th>التسجيل</th><th></th>
        </tr></thead>
        <tbody>${rows.map(u => `
          <tr>
            <td style="font-weight:${u.banned?'400':'700'};${
              u.banned?'color:var(--tx-3)':''}">
              ${esc(u.name||'—')}
              ${u.banned?'<span class="chip bad">موقوف</span>':''}</td>
            <td class="mono" style="font-size:11.5px" dir="ltr">
              ${esc(u.email||'—')}</td>
            <td class="mono" style="font-size:12px" dir="ltr">
              ${esc(u.phone||'—')}</td>
            <td class="num" style="font-weight:700">${usd(u.wallet_balance)}</td>
            <td class="num">${usd(u.total_spent)}</td>
            <td class="sub" style="font-size:11.5px">${dt(u.created_at)}</td>
            <td><button class="btn ghost sm" data-eu="${esc(u.id)}">إدارة</button></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`
    : `<div class="box"><div class="empty">
        <div class="ei">${svg(I.users, 1.6)}</div>
        <div class="et">لا مستخدمون</div>
      </div></div>`}`;
}

window.openUser = uid => {
  const u = S.users.find(x => x.id === uid);
  if(!u) return;

  sheet(`
    <div class="sheet-head">
      <div style="flex:1;min-width:0">
        <div class="h2">${esc(u.name||'مستخدم')}</div>
        <div class="sub" dir="ltr">${esc(u.email||'')}</div>
      </div>
    </div>

    <div class="box" style="background:var(--s2);margin-bottom:12px">
      <div class="prow"><span class="pk">الرصيد</span>
        <span class="pv">${usd(u.wallet_balance)}</span></div>
      <div class="prow"><span class="pk">إجمالي الإنفاق</span>
        <span class="pv">${usd(u.total_spent)}</span></div>
      <div class="prow"><span class="pk">الهاتف</span>
        <span class="pv" style="font-family:inherit;color:var(--tx)"
          dir="ltr">${esc(u.phone||'—')}</span></div>
      <div class="prow"><span class="pk">عدد الطلبات</span>
        <span class="pv">${S.orders.filter(o => o.uid === uid).length}</span></div>
    </div>

    <label class="lbl">تعديل الرصيد</label>
    <div class="grid2">
      <input class="inp num" id="uAmt" type="number" step="0.5"
             placeholder="±  مبلغ">
      <input class="inp" id="uReason" placeholder="السبب">
    </div>
    <button class="btn wide" id="uAdj" style="margin-top:8px">
      تطبيق التعديل</button>

    <div class="sw-row" style="margin-top:16px">
      <div>
        <div class="sw-lbl">${u.banned ? 'إلغاء الإيقاف' : 'إيقاف الحساب'}</div>
      </div>
      <div class="sw ${u.banned ? 'on' : ''}" id="uBan"></div>
    </div>

    <button class="btn line wide" style="margin-top:12px"
            onclick="closeSheet()">إغلاق</button>`);

  $('#uAdj').onclick = async () => {
    const amt = parseFloat($('#uAmt').value);
    const reason = $('#uReason').value.trim();
    if(!amt) return toast('أدخل مبلغًا', 'bad');
    if(reason.length < 3) return toast('اكتب السبب', 'bad');
    const btn = $('#uAdj');
    btn.disabled = true; btn.classList.add('loading');
    try {
      await api('/api/admin/wallet-adjust', {
        uid, delta: amt, reason
      });
      toast('تم تعديل الرصيد', 'ok');
      closeSheet();
    } catch(e) {
      toast(e.message, 'bad');
      btn.disabled = false; btn.classList.remove('loading');
    }
  };

  $('#uBan').onclick = async () => {
    try {
      await setDoc(doc(db, 'users', uid),
        { banned: !u.banned }, { merge: true });
      toast(u.banned ? 'أُلغي الإيقاف' : 'أُوقف الحساب', 'ok');
      closeSheet();
    } catch(e) { toast(e.message, 'bad'); }
  };
};

/* ═══ Tickets ═══ */
function vTickets() {
  const F = [['all','الكل'],['open','مفتوحة'],
             ['answered','تم الرد'],['closed','مغلقة']];
  let rows = S.tickets;
  if(S.filter !== 'all') rows = rows.filter(t => t.status === S.filter);

  const TST = { open:['wait','مفتوحة'], answered:['ok','تم الرد'],
    closed:['off','مغلقة'] };

  return `
  <div class="flex-b" style="margin-bottom:16px">
    <div>
      <div class="h1">التذاكر</div>
      <p class="sub">${rows.length} من ${S.tickets.length}</p>
    </div>
  </div>

  <div class="tabs" style="margin-bottom:14px">
    ${F.map(([k, t]) => `<button class="tab ${S.filter === k ? 'on' : ''}"
      data-filter="${k}">${t}</button>`).join('')}
  </div>

  ${rows.length ? `
    <div style="display:flex;flex-direction:column;gap:10px">
      ${rows.map(t => {
        const st = TST[t.status] || ['off','—'];
        const u = S.users.find(x => x.id === t.uid);
        const last = (t.messages||[]).slice(-1)[0];
        return `<button class="box" style="text-align:start;cursor:pointer;
             display:block;width:100%;padding:14px"
             data-tk="${esc(t.id)}">
          <div class="flex-b" style="margin-bottom:6px">
            <span style="font-weight:700;font-size:13.5px">
              ${esc(t.subject)}</span>
            <span class="chip ${st[0]}">${st[1]}</span>
          </div>
          <div class="sub" style="font-size:12px">
            ${esc(u ? (u.name || u.email) : '—')} · ${dt(t.updated_at)}</div>
          ${last ? `<div class="sub" style="font-size:12.5px;margin-top:5px">
            ${esc(String(last.text).slice(0, 100))}</div>` : ''}
        </button>`;
      }).join('')}
    </div>`
    : `<div class="box"><div class="empty">
        <div class="ei">${svg(I.help, 1.6)}</div>
        <div class="et">لا تذاكر</div>
      </div></div>`}`;
}

window.openTicket = id => {
  const t = S.tickets.find(x => x.id === id);
  if(!t) return;
  const u = S.users.find(x => x.id === t.uid);
  const msgs = t.messages || [];

  sheet(`
    <div class="sheet-head">
      <div style="flex:1;min-width:0">
        <div class="h2">${esc(t.subject)}</div>
        <div class="sub">${esc(u ? (u.name || u.email) : '—')}</div>
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;
         max-height:40vh;overflow-y:auto">
      ${msgs.map(m => `
        <div style="align-self:${m.by === 'admin' ? 'flex-end' : 'flex-start'};
             max-width:88%;padding:10px 12px;border-radius:13px;
             background:${m.by === 'admin' ? 'var(--g-soft)' : 'var(--s3)'};
             border:1px solid ${m.by === 'admin' ? 'var(--g-line)' : 'var(--line)'}">
          <div style="font-size:10.5px;color:var(--tx-3);margin-bottom:3px">
            ${m.by === 'admin' ? 'أنت' : 'العميل'} · ${dt(m.at)}</div>
          <div style="font-size:13px;line-height:1.6;white-space:pre-line">
            ${esc(m.text)}</div>
        </div>`).join('')}
    </div>

    ${t.status !== 'closed' ? `
      <textarea class="inp" id="tkReply" rows="3"
        placeholder="اكتب ردك…"></textarea>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;
           margin-top:8px">
        <button class="btn" id="tkSend">إرسال الرد</button>
        <button class="btn bad" id="tkClose">إغلاق التذكرة</button>
      </div>`
      : `<div class="note">هذه التذكرة مغلقة.</div>`}

    <button class="btn line wide" style="margin-top:8px"
            onclick="closeSheet()">رجوع</button>`);

  const send = $('#tkSend');
  if(send) send.onclick = async () => {
    const m = $('#tkReply').value.trim();
    if(!m) return toast('اكتب ردك', 'bad');
    send.disabled = true; send.classList.add('loading');
    try {
      await api('/api/ticket/reply', { id, message: m });
      toast('تم إرسال الرد', 'ok');
      closeSheet();
    } catch(e) {
      toast(e.message, 'bad');
      send.disabled = false; send.classList.remove('loading');
    }
  };

  const cl = $('#tkClose');
  if(cl) cl.onclick = async () => {
    cl.disabled = true; cl.classList.add('loading');
    try {
      await api('/api/admin/ticket/close', { id });
      toast('تم إغلاق التذكرة', 'ok');
      closeSheet();
    } catch(e) {
      toast(e.message, 'bad');
      cl.disabled = false; cl.classList.remove('loading');
    }
  };
};

/* ═══ Providers — نظام المزودين ═══ */
function vProviders() {
  return `
  <div class="flex-b" style="margin-bottom:16px">
    <div>
      <div class="h1">المزودون</div>
      <p class="sub">${S.providers.length} مزود</p>
    </div>
    <button class="btn" id="addProv">
      ${svg(I.plus, 2.1)} مزود جديد
    </button>
  </div>

  ${S.providers.length ? `
    <div class="grid3">
      ${S.providers.map(p => `
        <div class="pcard">
          <div class="phead">
            <div class="pname">${esc(p.name || 'مزود')}</div>
            <span class="chip ${p.active !== false ? 'ok' : 'off'}">
              ${p.active !== false ? 'نشط' : 'معطّل'}</span>
          </div>
          <div class="prow"><span class="pk">النوع</span>
            <span class="pv" style="font-family:inherit;color:var(--tx)">
              ${esc(p.type || 'manual')}</span></div>
          <div class="prow"><span class="pk">الرابط</span>
            <span class="pv mono" style="font-size:11px;color:var(--tx-2)">
              ${esc(String(p.api_url||'').slice(0, 30))}…</span></div>
          ${p.products_count ? `
            <div class="prow"><span class="pk">الخدمات</span>
              <span class="pv">${n(p.products_count)}</span></div>` : ''}
          ${p.last_test_ok ? `
            <div class="prow"><span class="pk">آخر اختبار</span>
              <span class="pv" style="color:var(--g)">✓ ناجح</span></div>` : ''}
          <div class="pacts">
            <button class="btn ghost sm" data-ep="${esc(p.id)}">تعديل</button>
            <button class="btn ghost sm" data-tp="${esc(p.id)}">اختبار</button>
            <button class="btn sm" data-fp="${esc(p.id)}">جلب الخدمات</button>
          </div>
        </div>`).join('')}
    </div>`
    : `<div class="box"><div class="empty">
        <div class="ei">${svg(I.cloud, 1.6)}</div>
        <div class="et">لا مزودون</div>
        <p>أضف مزودًا لجلب الخدمات تلقائيًا.</p>
      </div></div>`}`;
}

window.openProvider = id => {
  const p = id ? S.providers.find(x => x.id === id)
    : { name:'', type:'libyaplay', api_url:'', api_key:'', email:'',
        active:true };

  sheet(`
    <div class="sheet-head">
      <div style="flex:1">
        <div class="h2">${id ? 'تعديل مزود' : 'مزود جديد'}</div>
      </div>
    </div>

    <label class="lbl">اسم المزود</label>
    <input class="inp" id="pvName" value="${esc(p.name)}"
           placeholder="Libya Play">

    <label class="lbl" style="margin-top:12px">النوع</label>
    <select class="inp" id="pvType">
      ${[
        ['manual', 'تنفيذ يدوي'],
        ['libyaplay', 'Libya Play (API)'],
        ['wdgzone', 'WDGZone (API)'],
        ['custom', 'مخصص (API)']
      ].map(([k, t]) => `
        <option value="${k}" ${p.type===k?'selected':''}>${t}</option>`).join('')}
    </select>

    <label class="lbl" style="margin-top:12px">رابط الـAPI</label>
    <input class="inp mono" id="pvUrl" value="${esc(p.api_url)}"
           placeholder="https://api.libyaplay.com/portal" dir="ltr">

    <label class="lbl" style="margin-top:12px">API Key</label>
    <input class="inp mono" id="pvKey" value="${esc(p.api_key)}"
           placeholder="المفتاح من المزود" dir="ltr">

    <label class="lbl" style="margin-top:12px">البريد الإلكتروني (اختياري)</label>
    <input class="inp mono" id="pvEmail" value="${esc(p.email)}"
           placeholder="email@example.com" dir="ltr">

    <div class="sw-row" style="margin-top:12px">
      <div><div class="sw-lbl">نشط</div></div>
      <div class="sw ${p.active !== false ? 'on' : ''}" id="pvActive"></div>
    </div>

    <button class="btn wide" id="pvSave" style="margin-top:16px">
      ${id ? 'حفظ التعديلات' : 'إضافة المزود'}</button>

    ${id ? `
      <button class="btn dark wide" style="margin-top:8px" id="pvTest">
        اختبار الاتصال</button>
      <button class="btn wide" style="margin-top:8px" id="pvFetch">
        جلب الخدمات</button>
      <button class="btn bad wide" style="margin-top:8px" id="pvDel">
        حذف المزود</button>` : ''}

    <button class="btn line wide" style="margin-top:8px"
            onclick="closeSheet()">إلغاء</button>`);

  $('#pvActive').onclick = e => e.currentTarget.classList.toggle('on');

  $('#pvSave').onclick = async () => {
    const btn = $('#pvSave');
    const name = $('#pvName').value.trim();
    if(!name) return toast('اكتب اسم المزود', 'bad');

    const data = {
      name,
      type: $('#pvType').value,
      api_url: $('#pvUrl').value.trim(),
      api_key: $('#pvKey').value.trim(),
      email: $('#pvEmail').value.trim(),
      active: $('#pvActive').classList.contains('on'),
      updated_at: new Date().toISOString()
    };

    btn.disabled = true; btn.classList.add('loading');
    try {
      if(id) {
        await setDoc(doc(db, 'providers', id), data, { merge: true });
        toast('تم حفظ التعديلات', 'ok');
      } else {
        const ref = await addDoc(collection(db, 'providers'), {
          ...data,
          products_count: 0,
          created_at: new Date().toISOString()
        });
        toast('تم إضافة المزود', 'ok');
        // افتح لوحة المزود الجديد لاختباره
        setTimeout(() => openProvider(ref.id), 400);
      }
      closeSheet();
    } catch(e) {
      toast(e.message, 'bad');
      btn.disabled = false; btn.classList.remove('loading');
    }
  };

  const testBtn = $('#pvTest');
  if(testBtn) testBtn.onclick = async () => {
    testBtn.disabled = true; testBtn.classList.add('loading');
    try {
      const r = await api('/api/admin/provider/test', { provider_id: id });
      toast(r.message || 'الاتصال ناجح', 'ok');
      testBtn.disabled = false; testBtn.classList.remove('loading');
    } catch(e) {
      toast(e.message, 'bad');
      testBtn.disabled = false; testBtn.classList.remove('loading');
    }
  };

  const fetchBtn = $('#pvFetch');
  if(fetchBtn) fetchBtn.onclick = async () => {
    fetchBtn.disabled = true; fetchBtn.classList.add('loading');
    try {
      const r = await api('/api/admin/provider/fetch', { provider_id: id });
      toast(`تم جلب ${r.count} خدمة`, 'ok');
      setTimeout(() => openImportSheet(id, r.products), 300);
    } catch(e) {
      toast(e.message, 'bad');
      fetchBtn.disabled = false; fetchBtn.classList.remove('loading');
    }
  };

  if(id) {
    const del = $('#pvDel');
    if(del) del.onclick = async () => {
      sheet(`
        <div class="h2" style="margin-bottom:8px">حذف المزود</div>
        <p class="sub" style="margin-bottom:16px">
          سيُحذف «${esc(p.name)}» نهائيًا.</p>
        <button class="btn bad wide" id="delOk">تأكيد الحذف</button>
        <button class="btn line wide" style="margin-top:8px"
                onclick="openProvider('${esc(id)}')">رجوع</button>`);
      $('#delOk').onclick = async () => {
        try {
          await deleteDoc(doc(db, 'providers', id));
          toast('تم حذف المزود', 'ok');
          closeSheet();
        } catch(e) { toast(e.message, 'bad'); }
      };
    };
  }
};

window.testProvider = async id => {
  const btn = document.querySelector(`[data-tp="${id}"]`);
  if(!btn) return;
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '...';
  try {
    const r = await api('/api/admin/provider/test', { provider_id: id });
    toast(r.message || 'الاتصال ناجح', 'ok');
  } catch(e) {
    toast(e.message, 'bad');
  }
  btn.disabled = false;
  btn.textContent = orig;
};

window.fetchProviderProducts = async id => {
  const btn = document.querySelector(`[data-fp="${id}"]`);
  if(!btn) return;
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '...';
  try {
    const r = await api('/api/admin/provider/fetch', { provider_id: id });
    toast(`تم جلب ${r.count} خدمة`, 'ok');
    setTimeout(() => openImportSheet(id, r.products), 300);
  } catch(e) {
    toast(e.message, 'bad');
  }
  btn.disabled = false;
  btn.textContent = orig;
};

/* ═══ Import Sheet — قائمة الخدمات للاستيراد ═══ */
window.openImportSheet = (providerId, products) => {
  const cats = S.cats;

  const html = `
    <div class="sheet-head">
      <div style="flex:1">
        <div class="h2">استيراد الخدمات</div>
        <div class="sub">${products.length} خدمة من المزود</div>
      </div>
    </div>

    <div class="box" style="background:var(--s2);margin-bottom:12px">
      <label class="lbl">القسم للمنتجات المستوردة</label>
      <select class="inp" id="impCat">
        <option value="">— بدون قسم —</option>
        ${cats.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
      </select>

      <label class="lbl" style="margin-top:12px">معامل الربح</label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div>
          <input class="inp num" id="impProfit" type="number" step="0.5"
                 value="5" placeholder="ربح ثابت">
          <div style="font-size:11px;color:var(--tx-3);margin-top:4px">
            ربح ثابت (د.ل)</div>
        </div>
        <div>
          <input class="inp num" id="impPct" type="number" step="1"
                 value="20" placeholder="نسبة %">
          <div style="font-size:11px;color:var(--tx-3);margin-top:4px">
            نسبة ربح (%)</div>
        </div>
      </div>
    </div>

    <div style="max-height:50vh;overflow-y:auto;margin-bottom:12px">
      <div class="flex-b" style="margin-bottom:8px;position:sticky;top:0;
           background:var(--s1);padding:6px 0;z-index:2">
        <button class="btn ghost sm" id="impAll">تحديد الكل</button>
        <button class="btn ghost sm" id="impNone">إلغاء الكل</button>
      </div>
      ${products.map((p, i) => `
        <label style="display:flex;align-items:flex-start;gap:10px;
             padding:10px;border:1px solid var(--line);border-radius:10px;
             background:var(--s2);margin-bottom:6px;cursor:pointer">
          <input type="checkbox" class="imp-chk" data-i="${i}"
                 style="width:18px;height:18px;accent-color:var(--g);margin-top:2px">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:700">
              ${esc(p.name)}</div>
            <div style="font-size:11.5px;color:var(--tx-3);margin-top:2px">
              ${esc(p.delivery_type)} · تكلفة: ${usd(p.cost_usd)}
            </div>
            <div style="font-size:11px;color:var(--tx-3)">
              معرّف: ${esc(p.provider_product_id)}
            </div>
          </div>
        </label>`).join('')}
    </div>

    <button class="btn wide" id="impGo">استيراد المحدد</button>
    <button class="btn line wide" style="margin-top:8px"
            onclick="closeSheet()">إلغاء</button>`;

  sheet(html);

  $$('#impAll, #impNone').forEach(b => b.onclick = () => {
    const on = b.id === 'impAll';
    $$('.imp-chk').forEach(c => c.checked = on);
  });

  $('#impGo').onclick = async () => {
    const selected = [...document.querySelectorAll('.imp-chk:checked')]
      .map(c => +c.dataset.i);
    if(!selected.length) return toast('اختر خدمة واحدة على الأقل', 'bad');

    const catId = $('#impCat').value;
    const profit = n($('#impProfit').value);
    const pct = n($('#impPct').value);

    const items = selected.map(i => {
      const p = products[i];
      // حساب السعر: التكلفة بالدولار → نحولها لدينار → نضيف الربح
      const rateLyd = n(S.pricing.usd_to_lyd) || 11.8;
      const costLyd = p.cost_usd * rateLyd;
      const priceLyd = Math.round((costLyd + profit + costLyd * pct / 100) * 100) / 100;

      return {
        id: p.provider_product_id,
        name: p.name,
        cat: catId,
        price_lyd: priceLyd,
        cost_usd: p.cost_usd,
        delivery_type: p.delivery_type,
        image: p.image
      };
    });

    const btn = $('#impGo');
    btn.disabled = true; btn.classList.add('loading');

    try {
      const r = await api('/api/admin/provider/import', {
        provider_id: providerId,
        items
      });
      toast(r.message || 'تم الاستيراد', 'ok');
      closeSheet();
    } catch(e) {
      toast(e.message, 'bad');
      btn.disabled = false; btn.classList.remove('loading');
    }
  };
};
/* ═══════════════════════════════════════════════════════════
   PART 3 — Coupons, SMS, Settings, Bind, Boot
   ═══════════════════════════════════════════════════════════ */

/* ═══ Coupons ═══ */
function vCoupons() {
  return `
  <div class="flex-b" style="margin-bottom:16px">
    <div>
      <div class="h1">الكوبونات</div>
      <p class="sub">${S.coupons.length} كوبون</p>
    </div>
    <button class="btn" id="addCoupon">
      ${svg(I.plus, 2.1)} كوبون جديد
    </button>
  </div>

  ${S.coupons.length ? `
    <div class="scrollx">
      <table class="tbl">
        <thead><tr>
          <th>الكود</th><th>النوع</th><th>الاستخدام</th>
          <th>الانتهاء</th><th>الحالة</th><th></th>
        </tr></thead>
        <tbody>${S.coupons.map(c => `
          <tr>
            <td class="mono" style="font-weight:800;letter-spacing:.1em">
              ${esc(c.id)}</td>
            <td>${n(c.percent) > 0
              ? n(c.percent) + '٪'
              : lyd(c.amount_lyd)}</td>
            <td class="num">${n(c.used_count)}${
              n(c.max_uses) ? ' / ' + n(c.max_uses) : ''}</td>
            <td class="sub" style="font-size:11.5px">${
              c.expires_at ? dt(c.expires_at) : '—'}</td>
            <td>${c.active === false
              ? '<span class="chip bad">معطّل</span>'
              : '<span class="chip ok">فعّال</span>'}</td>
            <td><button class="btn ghost sm" data-ecp="${esc(c.id)}">
              ${svg(I.edit, 2)}</button></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`
    : `<div class="box"><div class="empty">
        <div class="ei">${svg(I.tag, 1.6)}</div>
        <div class="et">لا كوبونات</div>
        <p>أنشئ كوبون خصم لجذب العملاء.</p>
      </div></div>`}`;
}

window.openCoupon = id => {
  const c = id ? S.coupons.find(x => x.id === id)
    : { percent:0, amount_lyd:0, max_off_lyd:0, min_order_lyd:0,
        max_uses:0, used_count:0, once_per_user:true,
        active:true, expires_at:'' };

  sheet(`
    <div class="sheet-head">
      <div style="flex:1">
        <div class="h2">${id ? 'تعديل كوبون' : 'كوبون جديد'}</div>
      </div>
    </div>

    <label class="lbl">الكود</label>
    <input class="inp mono" id="cpCode" value="${esc(id || '')}"
           ${id ? 'disabled style="opacity:.6"' : ''}
           placeholder="WELCOME10" dir="ltr"
           style="text-transform:uppercase;letter-spacing:.15em;text-align:center">

    <div class="grid2" style="margin-top:12px">
      <div>
        <label class="lbl">نسبة الخصم (%)</label>
        <input class="inp num" id="cpPct" type="number" step="1" min="0" max="100"
               value="${n(c.percent)}">
      </div>
      <div>
        <label class="lbl">أو مبلغ ثابت (د.ل)</label>
        <input class="inp num" id="cpAmt" type="number" step="0.5" min="0"
               value="${n(c.amount_lyd)}">
      </div>
    </div>

    <div class="grid2" style="margin-top:12px">
      <div>
        <label class="lbl">حد أقصى للخصم</label>
        <input class="inp num" id="cpCap" type="number" step="0.5" min="0"
               value="${n(c.max_off_lyd)}">
      </div>
      <div>
        <label class="lbl">أقل قيمة طلب</label>
        <input class="inp num" id="cpMin" type="number" step="0.5" min="0"
               value="${n(c.min_order_lyd)}">
      </div>
    </div>

    <div class="grid2" style="margin-top:12px">
      <div>
        <label class="lbl">عدد الاستخدامات</label>
        <input class="inp num" id="cpMax" type="number" step="1" min="0"
               value="${n(c.max_uses)}">
      </div>
      <div>
        <label class="lbl">ينتهي في</label>
        <input class="inp" id="cpExp" type="date"
               value="${c.expires_at ? String(c.expires_at).slice(0,10) : ''}">
      </div>
    </div>

    <div class="sw-row" style="margin-top:12px">
      <div><div class="sw-lbl">مرة واحدة لكل عميل</div></div>
      <div class="sw ${c.once_per_user !== false ? 'on' : ''}" id="cpOnce"></div>
    </div>

    <div class="sw-row">
      <div><div class="sw-lbl">فعّال</div></div>
      <div class="sw ${c.active !== false ? 'on' : ''}" id="cpAct"></div>
    </div>

    <button class="btn wide" id="cpSave" style="margin-top:16px">
      ${id ? 'حفظ التعديلات' : 'إضافة الكوبون'}</button>

    ${id ? `<button class="btn bad wide" style="margin-top:8px" id="cpDel">
      حذف الكوبون</button>` : ''}

    <button class="btn line wide" style="margin-top:8px"
            onclick="closeSheet()">إلغاء</button>`);

  $('#cpOnce').onclick = e => e.currentTarget.classList.toggle('on');
  $('#cpAct').onclick  = e => e.currentTarget.classList.toggle('on');

  $('#cpSave').onclick = async () => {
    const btn = $('#cpSave');
    const code = String(id || $('#cpCode').value)
      .trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if(code.length < 3) return toast('الكود 3 أحرف على الأقل', 'bad');
    const pct = n($('#cpPct').value);
    const amt = n($('#cpAmt').value);
    if(pct <= 0 && amt <= 0)
      return toast('حدّد نسبة أو مبلغًا', 'bad');

    const data = {
      percent: pct,
      amount_lyd: amt,
      max_off_lyd: n($('#cpCap').value),
      min_order_lyd: n($('#cpMin').value),
      max_uses: n($('#cpMax').value),
      expires_at: $('#cpExp').value
        ? new Date($('#cpExp').value).toISOString() : '',
      once_per_user: $('#cpOnce').classList.contains('on'),
      active: $('#cpAct').classList.contains('on')
    };

    btn.disabled = true; btn.classList.add('loading');
    try {
      await setDoc(doc(db, 'coupons', code),
        id ? data : { ...data, used_count: 0,
          created_at: new Date().toISOString() },
        { merge: true });
      toast(id ? 'تم حفظ التعديلات' : 'تم إضافة الكوبون', 'ok');
      closeSheet();
    } catch(e) {
      toast(e.message, 'bad');
      btn.disabled = false; btn.classList.remove('loading');
    }
  };

  if(id) {
    $('#cpDel').onclick = async () => {
      try {
        await deleteDoc(doc(db, 'coupons', id));
        toast('تم حذف الكوبون', 'ok');
        closeSheet();
      } catch(e) { toast(e.message, 'bad'); }
    };
  }
};

/* ═══ SMS ═══ */
function vSms() {
  const F = [['all','الكل'],['unclaimed','غير مطابقة'],
             ['claimed','مطابقة'],['unparsed','غير مفهومة']];
  let rows = S.sms;
  if(S.filter !== 'all') rows = rows.filter(m => m.status === S.filter);

  const ST = { unclaimed:['wait','غير مطابقة'], claimed:['ok','مطابقة'],
    unparsed:['bad','غير مفهومة'], untrusted:['bad','مزيفة'] };

  return `
  <div class="flex-b" style="margin-bottom:16px">
    <div>
      <div class="h1">رسائل التحويل</div>
      <p class="sub">${rows.length} من ${S.sms.length}</p>
    </div>
  </div>

  <div class="tabs" style="margin-bottom:14px">
    ${F.map(([k, t]) => `<button class="tab ${S.filter === k ? 'on' : ''}"
      data-filter="${k}">${t}</button>`).join('')}
  </div>

  ${rows.length ? `
    <div style="display:flex;flex-direction:column;gap:8px">
      ${rows.map(m => {
        const st = ST[m.status] || ['off','—'];
        const u = m.uid ? S.users.find(x => x.id === m.uid) : null;
        return `<div class="box" style="padding:12px">
          <div class="flex-b" style="margin-bottom:6px">
            <span class="num" style="font-weight:700;font-size:14px">
              ${lyd(m.amount_lyd)}</span>
            <span class="chip ${st[0]}">${st[1]}</span>
          </div>
          <div class="sub" style="font-size:12px" dir="ltr">
            من: ${esc(m.sender || m.from || '—')}</div>
          <div class="sub" style="font-size:11.5px">${dt(m.created_at)}</div>
          ${u ? `<div class="sub" style="font-size:12px;margin-top:4px">
            <strong>العميل:</strong> ${esc(u.name || u.email)}</div>` : ''}
          ${m.raw_text ? `<div class="sub" style="font-size:11.5px;
            margin-top:6px;opacity:.75">${esc(String(m.raw_text).slice(0,140))}</div>` : ''}
          ${m.status === 'unclaimed' ? `
            <button class="btn sm" data-sm="${esc(m.id)}"
              style="margin-top:8px">ربط بعميل</button>` : ''}
        </div>`;
      }).join('')}
    </div>`
    : `<div class="box"><div class="empty">
        <div class="ei">${svg(I.bell, 1.6)}</div>
        <div class="et">لا رسائل</div>
      </div></div>`}`;
}

window.openSms = id => {
  const m = S.sms.find(x => x.id === id);
  if(!m) return;

  sheet(`
    <div class="sheet-head">
      <div style="flex:1">
        <div class="h2">ربط الرسالة بعميل</div>
        <div class="sub">${lyd(m.amount_lyd)} · من ${esc(m.sender||'—')}</div>
      </div>
    </div>

    ${m.raw_text ? `<div class="box" style="background:var(--s2);
      margin-bottom:12px;font-size:12px;line-height:1.6">
      ${esc(m.raw_text)}
    </div>` : ''}

    <label class="lbl">اختر العميل</label>
    <select class="inp" id="smUid">
      <option value="">— اختر —</option>
      ${S.users.map(u => `<option value="${esc(u.id)}">
        ${esc(u.name || u.email)}${u.phone ? ' · ' + esc(u.phone) : ''}
      </option>`).join('')}
    </select>

    <button class="btn wide" id="smGo" style="margin-top:16px">
      إضافة الرصيد للعميل</button>
    <button class="btn line wide" style="margin-top:8px"
            onclick="closeSheet()">إلغاء</button>`);

  $('#smGo').onclick = async () => {
    const uid = $('#smUid').value;
    if(!uid) return toast('اختر العميل', 'bad');
    const btn = $('#smGo');
    btn.disabled = true; btn.classList.add('loading');
    try {
      await api('/api/admin/sms/assign', { sms_id: id, uid });
      toast('تم ربط الرسالة', 'ok');
      closeSheet();
    } catch(e) {
      toast(e.message, 'bad');
      btn.disabled = false; btn.classList.remove('loading');
    }
  };
};

/* ═══ Settings ═══ */
function vSettings() {
  const TABS = [
    ['ops',    'التشغيل'],
    ['pay',    'طرق الدفع'],
    ['appear', 'المظهر'],
    ['limits', 'الحدود']
  ];

  if(!S.setTab) S.setTab = 'ops';

  return `
  <div class="flex-b" style="margin-bottom:16px">
    <div>
      <div class="h1">الإعدادات</div>
      <p class="sub">تحكم كامل في المنصة</p>
    </div>
  </div>

  <div class="tabs">
    ${TABS.map(([k, t]) => `
      <button class="tab ${S.setTab === k ? 'on' : ''}" data-st="${k}">
        ${t}</button>`).join('')}
  </div>

  ${S.setTab === 'ops' ? settingsOps() : ''}
  ${S.setTab === 'pay' ? settingsPay() : ''}
  ${S.setTab === 'appear' ? settingsAppear() : ''}
  ${S.setTab === 'limits' ? settingsLimits() : ''}
  `;
}

function settingsOps() {
  const o = S.ops;
  return `
  <div class="box">
    <div class="h2" style="margin-bottom:14px">حالة المتجر</div>

    <div class="sw-row">
      <div>
        <div class="sw-lbl">المتجر يعمل</div>
        <div class="sw-desc">إيقافه يمنع كل العمليات</div>
      </div>
      <div class="sw ${o.kill_switch === true ? 'off' : 'on'}"
           id="stKill" data-key="kill_switch" data-inverse="1"></div>
    </div>

    <div class="sw-row">
      <div>
        <div class="sw-lbl">الاشتراكات ظاهرة</div>
        <div class="sw-desc">إخفاء قسم الاشتراكات</div>
      </div>
      <div class="sw ${o.subscriptions_visible !== false ? 'on' : ''}"
           id="stSubs" data-key="subscriptions_visible"></div>
    </div>

    <div class="sw-row">
      <div><div class="sw-lbl">الكوبونات فعّالة</div></div>
      <div class="sw ${o.coupons_enabled !== false ? 'on' : ''}"
           id="stCoupons" data-key="coupons_enabled"></div>
    </div>

    <div class="sw-row">
      <div><div class="sw-lbl">تذاكر الدعم مفتوحة</div></div>
      <div class="sw ${o.tickets_enabled !== false ? 'on' : ''}"
           id="stTickets" data-key="tickets_enabled"></div>
    </div>

    <div class="sw-row">
      <div>
        <div class="sw-lbl">نظام النقاط</div>
        <div class="sw-desc">اكسب واستبدل النقاط</div>
      </div>
      <div class="sw ${o.points_enabled === true ? 'on' : ''}"
           id="stPoints" data-key="points_enabled"></div>
    </div>

    <div class="sw-row">
      <div>
        <div class="sw-lbl">نظام الدعوات</div>
        <div class="sw-desc">مكافآت للدعوات</div>
      </div>
      <div class="sw ${o.referral_enabled === true ? 'on' : ''}"
           id="stRef" data-key="referral_enabled"></div>
    </div>

    <label class="lbl" style="margin-top:14px">رسالة التوقف</label>
    <input class="inp" id="stKillMsg" data-key="kill_message"
           value="${esc(o.kill_message || '')}"
           placeholder="الخدمة متوقفة مؤقتًا للصيانة.">
  </div>

  <div class="box">
    <div class="h2" style="margin-bottom:14px">رسوم المنصة</div>

    <div class="field">
      <div>
        <div class="n">هامش الربح الافتراضي</div>
        <div class="d">النسبة على كل منتج (%)</div>
      </div>
      <input class="inp num" data-pricing="margin" type="number" step="0.1"
             value="${n(S.pricing.margin, 15)}">
    </div>

    <div class="field">
      <div>
        <div class="n">رسوم خدمة الإصدار</div>
        <div class="d">بالدينار</div>
      </div>
      <input class="inp num" data-pricing="deletion_fee" type="number" step="0.5"
             value="${n(S.pricing.deletion_fee, 2)}">
    </div>
  </div>

  <button class="btn wide" id="saveOps">حفظ إعدادات التشغيل</button>`;
}

function settingsPay() {
  const o = S.ops;
  const methods = [
    ['libyana', 'ليبيانا', 'تحويل عبر رسائل SMS'],
    ['almadar', 'المدار',   'تحويل عبر رسائل SMS'],
    ['bank',    'تحويل مصرفي', 'مراجعة يدوية'],
    ['usdt',    'USDT',     'TRC20 — تحقق تلقائي'],
    ['binance', 'Binance Pay', 'يدوي']
  ];

  return `
  <div class="box">
    <div class="h2" style="margin-bottom:14px">طرق الدفع</div>

    ${methods.map(([k, name, mode]) => {
      const on = ['bank','usdt','binance'].includes(k)
        ? o['m_'+k+'_on'] === true
        : o['m_'+k+'_on'] !== false;
      return `
      <div class="sw-row">
        <div>
          <div class="sw-lbl">${name}</div>
          <div class="sw-desc">${mode}</div>
        </div>
        <div class="sw ${on ? 'on' : ''}" data-method="${k}"></div>
      </div>`;
    }).join('')}
  </div>

  <div class="box">
    <div class="h2" style="margin-bottom:14px">أرقام التحويل</div>

    <label class="lbl">رقم ليبيانا</label>
    <input class="inp mono" data-ops="m_libyana_phone" dir="ltr"
           value="${esc(o.m_libyana_phone || '')}"
           placeholder="0912345678">

    <label class="lbl" style="margin-top:12px">رقم المدار</label>
    <input class="inp mono" data-ops="m_almadar_phone" dir="ltr"
           value="${esc(o.m_almadar_phone || '')}"
           placeholder="0912345678">

    <label class="lbl" style="margin-top:12px">عنوان USDT (TRC20)</label>
    <input class="inp mono" data-ops="usdt_address" dir="ltr"
           value="${esc(o.usdt_address || '')}"
           placeholder="T...">
  </div>

  <div class="box">
    <div class="h2" style="margin-bottom:14px">أسعار الصرف</div>

    ${[
      ['rate_libyana', 'ليبيانا',  11.8],
      ['rate_almadar', 'المدار',   12.5],
      ['rate_bank',    'المصارف',  9.5],
      ['rate_usdt',    'USDT',     1]
    ].map(([k, label, def]) => `
      <div class="field">
        <div>
          <div class="n">${label}</div>
          <div class="d">دينار لكل دولار</div>
        </div>
        <input class="inp num" data-pricing="${k}" type="number" step="0.1"
               value="${n(S.pricing[k], def)}">
      </div>`).join('')}
  </div>

  <button class="btn wide" id="savePay">حفظ إعدادات الدفع</button>`;
}

function settingsAppear() {
  const o = S.ops;
  return `
  <div class="box">
    <div class="h2" style="margin-bottom:14px">نصوص الواجهة</div>

    <label class="lbl">الشعار</label>
    <input class="inp" data-ops="brand_tagline"
           value="${esc(o.brand_tagline || 'بطاقات أكثر .. فرص أكبر')}">

    <label class="lbl" style="margin-top:12px">عنوان الصفحة الرئيسية</label>
    <input class="inp" data-ops="hero_title"
           value="${esc(o.hero_title || '')}"
           placeholder="بطاقة تعمل في كل مكان…">

    <label class="lbl" style="margin-top:12px">الوصف</label>
    <input class="inp" data-ops="hero_sub"
           value="${esc(o.hero_sub || '')}"
           placeholder="بالدولار · بدون رسوم شهرية…">

    <label class="lbl" style="margin-top:12px">رابط الدعم</label>
    <input class="inp" data-ops="support_url" dir="ltr"
           value="${esc(o.support_url || '')}"
           placeholder="https://wa.me/21891…">
  </div>

  <button class="btn wide" id="saveAppear">حفظ النصوص</button>`;
}

function settingsLimits() {
  const o = S.ops;
  return `
  <div class="box">
    <div class="h2" style="margin-bottom:14px">الحدود اليومية</div>
    <p class="sub" style="font-size:12.5px;margin-bottom:14px">
      تحمي المتجر من الاستنزاف. صفر = بلا حد.</p>

    ${[
      ['daily_orders_max', 'أقصى عدد طلبات يوميًا', 'لكل عميل', 20],
      ['daily_amount_max', 'أقصى مبلغ يوميًا', 'بالدينار', 2000],
      ['daily_deposit_max', 'أقصى إيداع يوميًا', 'بالدولار', 500]
    ].map(([k, label, desc, def]) => `
      <div class="field">
        <div>
          <div class="n">${label}</div>
          <div class="d">${desc}</div>
        </div>
        <input class="inp num" data-ops="${k}" type="number" min="0"
               value="${n(o[k], def)}">
      </div>`).join('')}
  </div>

  <button class="btn wide" id="saveLimits">حفظ الحدود</button>`;
}

/* ═══ Bind ═══ */
function bind() {
  // Nav buttons
  $$('[data-nav]').forEach(b =>
    b.onclick = () => go(b.dataset.nav));

  // Filters
  $$('[data-filter]').forEach(b =>
    b.onclick = () => { S.filter = b.dataset.filter; render(); });

  // Search box
  const q = $('#qBox');
  if(q) q.oninput = e => {
    S.q = e.target.value;
    clearTimeout(q._t);
    q._t = setTimeout(() => render(), 250);
  };

  // Orders
  $$('[data-ord]').forEach(b =>
    b.onclick = () => openOrder(b.dataset.ord));

  // Deposits
  $$('[data-dep]').forEach(b =>
    b.onclick = () => openDeposit(b.dataset.dep));

  // Withdrawals
  $$('[data-wd]').forEach(b =>
    b.onclick = () => openWithdrawal(b.dataset.wd));

  // Products
  const addProd = $('#addProd');
  if(addProd) addProd.onclick = () => openProduct(null);
  $$('[data-ep]').forEach(b => {
    // نتجنب الالتباس مع أزرار تعديل المزودين
    if(b.closest('.pcard')) return;
    if(b.dataset.ep) b.onclick = () => openProduct(b.dataset.ep);
  });

  // Categories
  const addCat = $('#addCat');
  if(addCat) addCat.onclick = () => openCategory(null);
  $$('[data-ec]').forEach(b =>
    b.onclick = () => openCategory(b.dataset.ec));

  // Users
  $$('[data-eu]').forEach(b =>
    b.onclick = () => openUser(b.dataset.eu));

  // Tickets
  $$('[data-tk]').forEach(b =>
    b.onclick = () => openTicket(b.dataset.tk));

  // Providers
  const addProv = $('#addProv');
  if(addProv) addProv.onclick = () => openProvider(null);
  $$('.pcard [data-ep]').forEach(b =>
    b.onclick = () => openProvider(b.dataset.ep));
  $$('[data-tp]').forEach(b =>
    b.onclick = () => testProvider(b.dataset.tp));
  $$('[data-fp]').forEach(b =>
    b.onclick = () => fetchProviderProducts(b.dataset.fp));

  // Coupons
  const addCoupon = $('#addCoupon');
  if(addCoupon) addCoupon.onclick = () => openCoupon(null);
  $$('[data-ecp]').forEach(b =>
    b.onclick = () => openCoupon(b.dataset.ecp));

  // SMS
  $$('[data-sm]').forEach(b =>
    b.onclick = () => openSms(b.dataset.sm));

  // Settings tabs
  $$('[data-st]').forEach(b => b.onclick = () => {
    S.setTab = b.dataset.st;
    render();
  });

  // Settings switches
  $$('[data-method]').forEach(sw => {
    sw.onclick = () => sw.classList.toggle('on');
  });

  // Save buttons
  const saveOps = $('#saveOps');
  if(saveOps) saveOps.onclick = () => saveSettings('ops');

  const savePay = $('#savePay');
  if(savePay) savePay.onclick = () => saveSettings('pay');

  const saveAppear = $('#saveAppear');
  if(saveAppear) saveAppear.onclick = () => saveSettings('appear');

  const saveLimits = $('#saveLimits');
  if(saveLimits) saveLimits.onclick = () => saveSettings('limits');

  // Menu button (للجوال)
  const menuBtn = $('#menuBtn');
  if(menuBtn) menuBtn.onclick = openMobileMenu;
}

/* ═══ Menu للجوال ═══ */
function openMobileMenu() {
  const groups = {};
  PAGES.forEach(p => {
    if(!groups[p.g]) groups[p.g] = [];
    groups[p.g].push(p);
  });

  let html = '<div class="h2" style="margin-bottom:16px">القائمة</div>';
  for(const [g, items] of Object.entries(groups)) {
    html += `<div class="nav-group" style="margin-top:14px">${g}</div>`;
    items.forEach(p => {
      const c = p.badge ? badges[p.badge]() : 0;
      html += `<button class="nav ${S.page === p.k ? 'on' : ''}"
        data-mob-nav="${p.k}" style="margin-bottom:4px">
        ${svg(p.i)}<span>${p.t}</span>
        ${c ? `<span class="cnt">${c}</span>` : ''}
      </button>`;
    });
  }
  html += `<button class="btn line wide" style="margin-top:16px"
    onclick="closeSheet()">إغلاق</button>`;

  sheet(html);
  $$('[data-mob-nav]').forEach(b => b.onclick = () => {
    closeSheet();
    go(b.dataset.mobNav);
  });
}

async function saveSettings(kind) {
  const btn = document.querySelector(
    kind === 'ops' ? '#saveOps' :
    kind === 'pay' ? '#savePay' :
    kind === 'appear' ? '#saveAppear' : '#saveLimits');
  if(btn) { btn.disabled = true; btn.classList.add('loading'); }

  const payloadOps = {};
  const payloadPricing = {};

  $$('[data-ops]').forEach(el => {
    const k = el.dataset.ops;
    if(!k) return;
    payloadOps[k] = el.type === 'number' ? n(el.value) : el.value;
  });

  $$('[data-pricing]').forEach(el => {
    const k = el.dataset.pricing;
    if(!k) return;
    payloadPricing[k] = n(el.value);
  });

  $$('[data-key]').forEach(el => {
    const k = el.dataset.key;
    if(!k) return;
    let v = el.classList.contains('on');
    if(el.dataset.inverse) v = !v;
    payloadOps[k] = v;
  });

  $$('[data-method]').forEach(el => {
    const k = el.dataset.method;
    if(!k) return;
    payloadOps['m_' + k + '_on'] = el.classList.contains('on');
  });

  const payload = { ...payloadOps, ...payloadPricing };

  try {
    await api('/api/admin/settings', payload);
    toast('تم حفظ الإعدادات', 'ok');
  } catch(e) {
    toast(e.message, 'bad');
  }

  if(btn) { btn.disabled = false; btn.classList.remove('loading'); }
}

/* ═══ Boot ═══ */
console.log('%cKARDO Admin v2',
  'background:#10B981;color:#04121B;padding:4px 10px;border-radius:6px;font-weight:800');
