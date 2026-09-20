/* ═══════════════════════════════════════════════════════════
   KARDO — Storefront
   Firestore مباشر (بدون Worker)
   ═══════════════════════════════════════════════════════════ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, setDoc, getDoc, getDocs, collection,
  query, where, limit
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* ═══ Config ═══ */
const firebaseConfig = {
  apiKey: "AIzaSyC-GntWur6r_Ow_v0wTNymQqQa6brzgvW8",
  authDomain: "kardo-1c657.firebaseapp.com",
  projectId: "kardo-1c657",
  storageBucket: "kardo-1c657.firebasestorage.app",
  messagingSenderId: "593934928630",
  appId: "1:593934928630:web:d36ea455a284e974043ad7"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

/* ═══ State ═══ */
const S = {
  user: null,
  profile: { wallet_balance:0, total_spent:0,
    name:'', email:'', phone:'', points:0, referrals_count:0 },
  categories: [], products: [],
  cart: [], cat: null, q: '', filter: 'all',
  config: {
    usd_to_lyd: 11.8,
    banners: [], coupons_on: true
  },
  page: 'home'
};

/* ═══ Icons ═══ */
const I = {
  home:'<path d="M3 10.4 12 3.2l9 7.2V20a1 1 0 0 1-1 1h-5v-6.5H9V21H4a1 1 0 0 1-1-1z"/>',
  grid:'<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
  bag:'<path d="M4.5 8h15l-1.2 12.2a1.8 1.8 0 0 1-1.8 1.6H7.5a1.8 1.8 0 0 1-1.8-1.6z"/><path d="M8.5 8V6a3.5 3.5 0 0 1 7 0v2"/>',
  wallet:'<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5z"/><path d="M16.5 12h1.5"/>',
  user:'<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  card:'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/>',
  plus2:'<path d="M12 5.5v13M5.5 12h13"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  more:'<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  cart:'<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3h2.3l2.5 12.2a1.6 1.6 0 0 0 1.6 1.3h8.6a1.6 1.6 0 0 0 1.6-1.3L21 7H6"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5 16.5 16.5"/>',
  copy:'<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  trash:'<path d="M3.5 6h17M8 6V4h8v2M6.5 6l1 15h9l1-15"/>',
  up:'<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>',
  down:'<path d="M12 5v14M18.5 12.5 12 19l-6.5-6.5"/>',
  swap:'<path d="M7 4v13M7 4 3.5 7.5M7 4l3.5 3.5M17 20V7M17 20l3.5-3.5M17 20l-3.5-3.5"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
  back:'<path d="M15 6l-6 6 6 6"/>',
  next:'<path d="M9 6l6 6-6 6"/>',
  gift:'<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18"/><path d="M12 8S9.5 3 7.5 4.5 9 8 12 8zM12 8s2.5-5 4.5-3.5S15 8 12 8z"/>',
  book:'<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22z"/><path d="M8 7h8M8 11h6"/>',
  out:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.3"/><path d="M12 17h.01"/>',
  star:'<path d="m12 3 2.7 5.8 6.3.8-4.6 4.4 1.2 6.3L12 17.2 6.4 20.3l1.2-6.3L3 9.6l6.3-.8z"/>',
  fire:'<path d="M12 22c4.4 0 7-2.9 7-6.6 0-3.6-2.4-5.6-3.6-8.6-.5-1.2-2.1-1.3-2.7-.2-.8 1.5-.5 3.2-1.5 4.3-.7.8-1.6.2-1.6-.8 0-1.2.4-2-.3-3.1-.5-.8-1.7-.7-2.2.1C5.9 9.2 5 11.6 5 14.6 5 19 8 22 12 22z"/>',
  bell:'<path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>'
};
const svg = (d, w = 1.8) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

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
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const n  = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
const usd = v => '$' + Number(v || 0).toFixed(2);
const rate = () => n(S.config.usd_to_lyd) || 11.8;
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
  el.innerHTML = `<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0'; el.style.transition = '.26s';
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

/* ═══ Header Init ═══ */
$('#railMark').innerHTML = mark(34);
$('#barMark').innerHTML  = mark(30);
$('#cartIco').innerHTML  = svg(I.cart, 1.9);
$('#railOut').innerHTML  = svg(I.out) + '<span>تسجيل الخروج</span>';

$('#cartBtn').addEventListener('click', () => cartSheet());
$('#homeBtn').addEventListener('click', () => go('home'));
$('#railOut').addEventListener('click', () => askOut());
$('#notifBtn').addEventListener('click', () => notifSheet());
$('#topSearch').addEventListener('input', e => {
  const v = e.target.value.trim();
  S.q = v;
  if(S.page !== 'shop') { S.page = 'shop'; S.cat = null; }
  render();
});

window.askOut = () => sheet(`
  <div class="h2" style="margin-bottom:8px">تسجيل الخروج</div>
  <p class="sub" style="margin-bottom:20px">ستحتاج للدخول مرة أخرى.</p>
  <button class="btn ghost wide" onclick="doOut()">تأكيد</button>
  <button class="btn line wide" style="margin-top:9px"
          onclick="closeSheet()">إلغاء</button>`);
window.doOut = async () => {
  closeSheet();
  await signOut(auth);
  location.replace('login.html');
};

/* ═══ Auth ═══ */
onAuthStateChanged(auth, async user => {
  if(!user) { location.replace('login.html'); return; }
  S.user = user;

  // تحميل Profile
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if(snap.exists()) S.profile = { ...S.profile, ...snap.data() };
    else await setDoc(doc(db, 'users', user.uid), {
      name: user.displayName || 'مستخدم',
      email: user.email || '',
      wallet_balance: 0, total_spent: 0,
      created_at: new Date().toISOString()
    }, { merge: true });
  } catch(e) { console.warn('profile err', e); }

  await loadCatalog();
  $('#app').style.display = 'block';
  buildNav();
  render();
});

/* ═══ تحميل الكتالوج من Firestore مباشرة ═══ */
async function loadCatalog() {
  try {
    // تحميل الأقسام
    const catSnap = await getDocs(collection(db, 'categories'));
    S.categories = catSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.active !== false);

    // تحميل المنتجات
    const prodSnap = await getDocs(collection(db, 'products'));
    S.products = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.active !== false);

    console.log('✅ Loaded:', S.categories.length, 'categories,',
      S.products.length, 'products');
    console.log('Categories:', S.categories);
    console.log('Products:', S.products);
  } catch(e) {
    console.error('❌ Load failed:', e);
    toast('تعذّر تحميل المنتجات: ' + e.message, 'bad');
  }
}

/* ═══ Navigation ═══ */
const PAGES = [
  { k:'home',     t:'الرئيسية',     i:I.home },
  { k:'shop',     t:'الأقسام',      i:I.grid },
  { k:'cart',     t:'السلة',        i:I.bag },
  { k:'wallet',   t:'المحفظة',      i:I.wallet },
  { k:'account',  t:'حسابي',        i:I.user }
];
const DOCK = ['home', 'shop', 'wallet', 'account'];

function buildNav() {
  $('#navRail').innerHTML = PAGES.map(p => `
    <button class="nav" data-nav="${p.k}">
      ${svg(p.i)}<span>${p.t}</span>
    </button>`).join('');

  const dk = DOCK.map(k => PAGES.find(p => p.k === k)).filter(Boolean);
  $('#navDock').style.gridTemplateColumns = `repeat(${dk.length}, 1fr)`;
  $('#navDock').innerHTML = dk.map(p => `
    <button class="dk" data-nav="${p.k}">
      <span class="dkico">${svg(p.i)}</span><span>${p.t}</span>
    </button>`).join('');

  $$('[data-nav]').forEach(b => b.onclick = () => go(b.dataset.nav));
}

window.go = k => {
  S.page = k; S.cat = null;
  window.scrollTo({ top:0, behavior:'instant' });
  render();
};

/* ═══ Render ═══ */
function render() {
  const el = $('#av'); if(el) el.textContent = (S.profile.name || '؟').charAt(0);
  const rn = $('#railName'); if(rn) rn.textContent = S.profile.name || '—';
  const rb = $('#railBal'); if(rb) rb.textContent = lyd(S.profile.wallet_balance * rate());

  $$('[data-nav]').forEach(b =>
    b.classList.toggle('on', b.dataset.nav === S.page));

  const view = $('#view');
  if(!view) return;

  const V = { home: vHome, shop: S.cat ? vCat : vShop, cart: cartSheetView,
              wallet: vWallet, account: vAccount };
  view.classList.remove('anim');
  void view.offsetWidth;
  view.classList.add('anim');
  view.innerHTML = (V[S.page] || vHome)();
  bind();
}

/* ═══ Home ═══ */
function vHome() {
  const roots = S.categories.filter(c => !c.parent);
  const featured = S.products.filter(p => p.featured).slice(0, 5);
  const deals = S.products.filter(p => n(p.old_price) > n(p.price));

  return `
  <div class="wallet-card">
    <div class="wallet-top">
      <div>
        <div class="eyebrow">رصيد المحفظة</div>
        <div class="wallet-bal num">${lyd(S.profile.wallet_balance * rate())}</div>
        <div class="wallet-sub">${usd(S.profile.wallet_balance)}</div>
      </div>
      <div class="wallet-ico">${svg(I.wallet, 1.9)}</div>
    </div>
    <div class="wacts">
      <button class="wact pri" data-wact="deposit">
        <span class="wact-i">${svg(I.up, 2)}</span><span>إضافة رصيد</span>
      </button>
      <button class="wact" data-wact="withdraw">
        <span class="wact-i">${svg(I.down, 2)}</span><span>سحب</span>
      </button>
      <button class="wact" data-wact="transfer">
        <span class="wact-i">${svg(I.swap, 2)}</span><span>تحويل</span>
      </button>
      <button class="wact" data-wact="points">
        <span class="wact-i">${svg(I.star, 2)}</span><span>نقاطي</span>
      </button>
    </div>
  </div>

  <div class="quick">
    <button class="qbtn pri" data-act="shop">
      <span class="qi">${svg(I.grid, 1.9)}</span>
      <span><span class="qt">تسوّق</span><span class="qs">كل الخدمات</span></span>
    </button>
    <button class="qbtn" data-act="cart">
      <span class="qi">${svg(I.bag, 1.9)}</span>
      <span><span class="qt">السلة</span>
        <span class="qs">${S.cart.length} منتج</span></span>
    </button>
  </div>

  ${roots.length ? `
    <div class="sec-head"><div class="h2">الأقسام</div></div>
    <div class="cats-rail">
      ${roots.map(c => catTile(c)).join('')}
    </div>` : `
    <div class="card"><div class="empty">
      <div class="ei">${svg(I.grid, 1.6)}</div>
      <div class="et">لا أقسام بعد</div>
      <p>أضف أقسامًا من لوحة التحكم.</p>
    </div></div>`}

  ${featured.length ? `
    <div class="sec-head"><div class="h2">الأكثر طلبًا</div></div>
    <div class="plist">${featured.map(prodRow).join('')}</div>` : ''}

  ${deals.length ? `
    <div class="sec-head"><div class="h2">${svg(I.fire, 2)} العروض</div></div>
    <div class="plist">${deals.slice(0, 4).map(prodRow).join('')}</div>` : ''}

  ${S.products.length && !featured.length && !deals.length ? `
    <div class="sec-head"><div class="h2">كل المنتجات</div></div>
    <div class="plist">${S.products.slice(0, 10).map(prodRow).join('')}</div>` : ''}

  ${!S.products.length ? `
    <div class="card" style="margin-top:16px"><div class="empty">
      <div class="ei">${svg(I.bag, 1.6)}</div>
      <div class="et">لا منتجات بعد</div>
      <p>أضف منتجات من لوحة التحكم لتظهر هنا.</p>
    </div></div>` : ''}`;
}

function catTile(c) {
  const cnt = S.products.filter(p => p.cat === c.id).length;
  return `<button class="cat" data-cat="${esc(c.id)}">
    <span class="cat-i">${svg(I.grid, 1.7)}</span>
    <span class="cat-n">${esc(c.name)}</span>
    <span class="cat-s">${cnt} منتج</span>
  </button>`;
}

function prodRow(p) {
  const off = n(p.old_price) > n(p.price)
    ? Math.round((1 - p.price / p.old_price) * 100) : 0;
  return `<button class="prod" data-prod="${esc(p.id)}">
    <span class="prod-i">
      ${p.image
        ? `<img src="${esc(p.image)}" alt="" loading="lazy">`
        : svg(I.bag, 1.6)}
    </span>
    <span class="prod-b">
      <span class="prod-n">${esc(p.name)}</span>
      <span class="prod-s">${p.kind === 'stock' ? 'تسليم فوري' : 'تنفيذ يدوي'}</span>
      <span class="prod-prow">
        <span class="prod-p num">${lyd(p.price)}</span>
        ${off ? `<span class="prod-old num">${lyd(p.old_price)}</span>` : ''}
      </span>
    </span>
    ${off ? `<span class="off-badge">−${off}٪</span>` : ''}
    <span class="prod-a">${svg(I.plus2, 2.2)}</span>
  </button>`;
}

/* ═══ Shop ═══ */
function vShop() {
  const roots = S.categories.filter(c => !c.parent);
  const q = S.q.trim().toLowerCase();
  const hits = q
    ? S.products.filter(p => (p.name||'').toLowerCase().includes(q))
    : [];

  return `
  <div class="h1" style="margin-bottom:5px">الأقسام</div>
  <p class="sub" style="margin-bottom:16px">اختر القسم أو ابحث</p>

  <div class="search">
    ${svg(I.search, 2)}
    <input id="shopQ" placeholder="ابحث عن منتج…" value="${esc(S.q)}">
  </div>

  ${q
    ? (hits.length
        ? `<div class="plist grid">${hits.map(prodRow).join('')}</div>`
        : `<div class="card"><div class="empty">
            <div class="ei">${svg(I.search, 1.6)}</div>
            <div class="et">لا نتائج</div>
          </div></div>`)
    : (roots.length
        ? `<div class="cats-big">${roots.map(c => catTile(c)).join('')}</div>`
        : `<div class="card"><div class="empty">
            <div class="ei">${svg(I.grid, 1.6)}</div>
            <div class="et">لا أقسام</div>
          </div></div>`)}`;
}

function vCat() {
  const c = S.categories.find(x => x.id === S.cat);
  if(!c) return vShop();
  let items = S.products.filter(p => p.cat === c.id);

  return `
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
    <button class="iconbtn" data-back="1">${svg(I.next, 2.2)}</button>
    <div class="h1" style="margin:0">${esc(c.name)}</div>
  </div>

  ${items.length
    ? `<div class="plist grid">${items.map(prodRow).join('')}</div>`
    : `<div class="card"><div class="empty">
        <div class="ei">${svg(I.bag, 1.6)}</div>
        <div class="et">لا منتجات في هذا القسم</div>
        <p>المنتجات الموجودة: ${S.products.length}</p>
        <p style="font-size:11px;margin-top:8px;color:var(--tx-3)">
          معرّف القسم: ${esc(c.id)}<br>
          ${S.products.map(p => 'cat: ' + esc(p.cat)).join('<br>')}
        </p>
      </div></div>`}`;
}

/* ═══ Product Sheet ═══ */
function productSheet(id) {
  const p = S.products.find(x => x.id === id);
  if(!p) return;

  sheet(`
    <div class="sheet-head">
      <div class="prod-i" style="width:76px;height:76px;border-radius:16px">
        ${p.image ? `<img src="${esc(p.image)}" alt="">` : svg(I.bag, 1.5)}
      </div>
      <div style="flex:1;min-width:0">
        <div class="h2">${esc(p.name)}</div>
        <div class="num" style="color:var(--g);font-size:20px;margin-top:3px">
          ${lyd(p.price)}
        </div>
        <span class="chip ${p.kind === 'stock' ? 'ok' : 'wait'}"
              style="margin-top:6px">
          ${p.kind === 'stock' ? 'تسليم فوري' : 'تنفيذ يدوي'}
        </span>
      </div>
    </div>

    ${p.desc ? `<div class="card-q" style="margin-bottom:14px">
      <div class="eyebrow" style="margin-bottom:8px">معلومات المنتج</div>
      <p class="sub" style="font-size:13px;line-height:1.75;white-space:pre-line">
        ${esc(p.desc)}</p>
    </div>` : ''}

    ${(p.fields || []).map(f => `
      <label class="lbl" style="margin-top:12px">${esc(f.label || f.key)}${
        f.required ? '' : ' (اختياري)'}</label>
      <input class="inp" data-pf="${esc(f.key)}"
             type="${f.type || 'text'}"
             placeholder="${esc(f.hint || '')}">`).join('')}

    <button class="btn lg wide" id="pAdd" style="margin-top:16px">
      إضافة إلى السلة</button>
    <button class="btn line wide" style="margin-top:9px"
            onclick="closeSheet()">إلغاء</button>`);

  $('#pAdd').onclick = () => {
    const vals = {};
    for(const f of (p.fields || [])) {
      const el = document.querySelector(`[data-pf="${f.key}"]`);
      const v = (el && el.value || '').trim();
      if(f.required && !v) return toast((f.label||f.key) + ' مطلوب', 'bad');
      if(v) vals[f.key] = v;
    }
    S.cart.push({
      id: p.id, name: p.name, image: p.image,
      price_lyd: p.price, qty: 1, values: vals, kind: p.kind
    });
    closeSheet();
    toast('أُضيف إلى السلة', 'ok');
    render();
  };
}

/* ═══ Cart ═══ */
function cartSheetView() {
  return `
  <div class="h1" style="margin-bottom:16px">السلة</div>
  ${S.cart.length
    ? S.cart.map((it, i) => `
        <div class="citem" style="margin-bottom:8px">
          <div class="citem-i">
            ${it.image ? `<img src="${esc(it.image)}" alt="">` : svg(I.bag, 1.6)}
          </div>
          <div style="flex:1">
            <div class="citem-n">${esc(it.name)}</div>
            <div class="row-s">${lyd(it.price_lyd)}</div>
          </div>
          <button class="btn bad sm" data-rm="${i}">حذف</button>
        </div>`).join('')
    : `<div class="card"><div class="empty">
        <div class="ei">${svg(I.cart, 1.6)}</div>
        <div class="et">سلتك فارغة</div>
        <button class="btn" data-act="shop" style="margin-top:14px">
          تصفّح المتجر</button>
      </div></div>`}
  ${S.cart.length ? `
    <div class="quote" style="margin-top:14px">
      <div class="qrow tot">
        <span>الإجمالي</span>
        <span class="num">${lyd(S.cart.reduce((s,i)=>s+i.price_lyd,0))}</span>
      </div>
    </div>
    <button class="btn lg wide" style="margin-top:16px" disabled>
      الشراء غير متاح — الـWorker معطّل</button>
    <div class="note" style="margin-top:12px">
      الشراء يحتاج تشغيل الـWorker أولًا.
    </div>` : ''}`;
}

function cartSheet() {
  sheet(`
    <div class="h2" style="margin-bottom:12px">السلة (${S.cart.length})</div>
    ${S.cart.length
      ? S.cart.map(it => `
          <div style="padding:10px 0;border-bottom:1px solid var(--line)">
            ${esc(it.name)} · ${lyd(it.price_lyd)}
          </div>`).join('')
      : '<p class="sub">السلة فارغة</p>'}
    <button class="btn line wide" style="margin-top:14px"
            onclick="closeSheet()">إغلاق</button>`);
}

/* ═══ Wallet ═══ */
function vWallet() {
  return `
  <div class="h1" style="margin-bottom:16px">المحفظة</div>
  <div class="wallet-card">
    <div class="wallet-top">
      <div>
        <div class="eyebrow">الرصيد المتاح</div>
        <div class="wallet-bal num">${lyd(S.profile.wallet_balance * rate())}</div>
        <div class="wallet-sub">${usd(S.profile.wallet_balance)}</div>
      </div>
      <div class="wallet-ico">${svg(I.wallet, 1.9)}</div>
    </div>
  </div>
  <div class="card">
    <div class="empty">
      <div class="ei">${svg(I.wallet, 1.6)}</div>
      <div class="et">إضافة الرصيد غير متاحة</div>
      <p>تحتاج تشغيل الـWorker أولًا.</p>
    </div>
  </div>`;
}

/* ═══ Account ═══ */
function vAccount() {
  const nm = S.profile.name || 'مستخدم';
  return `
  <div class="card" style="text-align:center;padding:26px 18px">
    <div style="width:76px;height:76px;border-radius:24px;margin:0 auto 14px;
         display:grid;place-items:center;background:var(--g-soft);color:var(--g);
         font-size:28px;font-weight:800">${esc(nm.trim().charAt(0))}</div>
    <div class="h2">${esc(nm)}</div>
    <div class="sub" dir="ltr">${esc(S.profile.email || S.user?.email || '')}</div>
    <div class="num" style="color:var(--g);font-size:22px;margin-top:12px">
      ${lyd(S.profile.wallet_balance * rate())}</div>
  </div>
  <button class="btn risk wide" style="margin-top:16px" onclick="askOut()">
    ${svg(I.out)} تسجيل الخروج</button>`;
}

function notifSheet() {
  sheet(`
    <div class="h2" style="margin-bottom:16px">الإشعارات</div>
    <div class="empty">
      <div class="ei">${svg(I.bell, 1.6)}</div>
      <div class="et">لا إشعارات</div>
    </div>
    <button class="btn line wide" style="margin-top:14px"
            onclick="closeSheet()">إغلاق</button>`);
}

/* ═══ Bind ═══ */
function bind() {
  $$('[data-act]').forEach(b => b.onclick = () => go(b.dataset.act));

  $$('[data-cat]').forEach(b => b.onclick = () => {
    S.cat = b.dataset.cat; S.q = ''; S.page = 'shop'; render();
  });

  $$('[data-prod]').forEach(b =>
    b.onclick = () => productSheet(b.dataset.prod));

  $$('[data-back]').forEach(b => b.onclick = () => {
    S.cat = null; render();
  });

  $$('[data-rm]').forEach(b => b.onclick = () => {
    S.cart.splice(+b.dataset.rm, 1); render();
  });

  $$('[data-wact]').forEach(b => b.onclick = () => {
    toast('يتطلب تشغيل الـWorker أولًا', 'bad');
  });

  const sq = $('#shopQ');
  if(sq) sq.oninput = e => {
    S.q = e.target.value;
    clearTimeout(sq._t);
    sq._t = setTimeout(() => {
      const p = sq.selectionStart;
      render();
      const el = $('#shopQ');
      if(el) { el.focus(); el.setSelectionRange(p, p); }
    }, 250);
  };
}

console.log('%cKARDO Store', 'background:#10B981;color:#04121B;padding:4px 10px;border-radius:6px;font-weight:800');
