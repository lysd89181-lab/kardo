import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut, sendPasswordResetEmail }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { API_BASE, firebaseConfig } from './config.js';
import { getFirestore, doc, setDoc, getDoc, onSnapshot, collection,
  query, where, orderBy, limit, addDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';



const DEMO = !API_BASE;
window.addEventListener('error', e=>{
  const v = document.getElementById('view');
  if(!v) return;
  document.getElementById('app').style.display='block';
  v.innerHTML = `<div class="note" style="margin-top:20px">
    <strong>حدث خطأ في الصفحة</strong><br><span style="word-break:break-all">${
      String(e.message||'')}</span><br>
    <span style="font-size:12px;opacity:.8">سطر ${e.lineno||'?'}</span></div>`;
});

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ─── الحالة ─── */
const S = {
  user:null,
  profile:{wallet_balance:0,cards_count:0,total_spent:0,name:'',email:'',phone:''},
  cards:[], orders:[], deposits:[],
  config:{
    min_amount:10, max_amount:200, usd_to_lyd:11.8,
    issuing_enabled:true, funding_enabled:true, maintenance_message:'',
    deposit_phone:'', deposit_note:'',
    rates:{libyana:11.8,bank:9.5,usdt:1},
    methods:{
      libyana:{on:true,label:'ليبيانا',rate:11.8,auto:true},
      almadar:{on:true,label:'المدار',rate:11.8,auto:true},
      bank:{on:false,label:'تحويل مصرفي',rate:9.5,auto:false,fields:[]},
      usdt:{on:false,label:'USDT',rate:1,auto:false,fields:[]},
      binance:{on:false,label:'Binance Pay',rate:1,auto:false,fields:[]}
    },
    nav:{}, theme:null, texts:{}
  },
  page:'home', dir:null, wiz:{step:1,amount:null,name:'',label:'',idem:null,quote:null},
  txFilter:'all', unsub:[]
};

/* ─── الأيقونات ─── */
const I = {
  home:'<path d="M3 10.4 12 3.2l9 7.2V20a1 1 0 0 1-1 1h-5v-6.5H9V21H4a1 1 0 0 1-1-1z"/>',
  card:'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/>',
  plus:'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M12 10.5v4M10 12.5h4"/>',
  wallet:'<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5z"/><path d="M16.5 12h1.5"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M19.9 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H4a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 5.2 7.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1 .9z"/>',
  more:'<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  eye:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7"/><circle cx="12" cy="12" r="3"/>',
  eyeoff:'<path d="M17.9 17.9A10.6 10.6 0 0 1 12 19c-6.4 0-10-7-10-7a18 18 0 0 1 4.1-5M9.9 4.2A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-2.2 3.2M3 3l18 18"/>',
  copy:'<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  snow:'<path d="M12 2.5v19M20.2 7.2 3.8 16.8M3.8 7.2l16.4 9.6"/>',
  trash:'<path d="M3.5 6h17M8 6V4h8v2M6.5 6l1 15h9l1-15"/>',
  up:'<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>',
  down:'<path d="M12 5v14M18.5 12.5 12 19l-6.5-6.5"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
  chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  book:'<path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h7M8 11h7"/>'
};
const svg=(d,w=1.8)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

/* علامات الشبكات — مرسومة كأشكال لا كصور، فتبقى حادة بأي حجم */
const LOGO={
  libyana:`<svg viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="24" r="22" fill="#0B3D24"/>
    <path d="M11 30c7-13 19-17 27-15-6 1-13 6-17 12-2 3-4 5-6 6-2 1-3 0-4-3z" fill="#4CAF50"/>
    <path d="M13 34c8-11 18-14 25-13-6 2-12 6-16 11-3 4-6 5-9 2z" fill="#8BC34A" opacity=".82"/>
  </svg>`,
  almadar:`<svg viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="24" r="22" fill="#2A0B26"/>
    <circle cx="24" cy="24" r="13" stroke="#A32D8C" stroke-width="3.4"/>
    <circle cx="24" cy="17" r="2.6" fill="#A32D8C"/>
    <path d="M19 21v8a5 5 0 0 0 10 0v-8" stroke="#A32D8C" stroke-width="3.4"
          stroke-linecap="round"/>
  </svg>`,
  usdt:`<svg viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="24" r="22" fill="#0B3D33"/>
    <path d="M15 15h18v4.6h-6.7v2.2c4.6.2 8 1.1 8 2.2s-3.4 2-8 2.2v6.6h-4.6v-6.6
             c-4.6-.2-8-1.1-8-2.2s3.4-2 8-2.2v-2.2H15z" fill="#26A17B"/>
  </svg>`,
  bank:`<svg viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="24" r="22" fill="#0E2038"/>
    <path d="M24 12l12 6.5H12L24 12z" fill="#5B8DEF"/>
    <path d="M15.5 22v10M21 22v10M27 22v10M32.5 22v10" stroke="#5B8DEF"
          stroke-width="3" stroke-linecap="round"/>
    <path d="M12 35h24" stroke="#5B8DEF" stroke-width="3.2" stroke-linecap="round"/>
  </svg>`,
  binance:`<svg viewBox="0 0 48 48" fill="none">
    <circle cx="24" cy="24" r="22" fill="#33290A"/>
    <path d="M24 13l4.2 4.2L24 21.4l-4.2-4.2L24 13zm-7.6 7.6L20.6 24l-4.2 4.2L12.2 24l4.2-3.4z
             M31.6 20.6L35.8 24l-4.2 4.2L27.4 24l4.2-3.4zM24 26.6l4.2 4.2L24 35l-4.2-4.2 4.2-4.2z
             M24 19.8L28.2 24 24 28.2 19.8 24 24 19.8z" fill="#F0B90B"/>
  </svg>`
};
function methodLogo(k,url){
  if(url)return `<img src="${url}" alt="" loading="lazy" decoding="async" class="mlogo-img">`;
  return `<span class="mlogo-svg">${LOGO[k]||LOGO.bank}</span>`;
}

function mark(size=34){
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" style="flex:none">
    <rect width="40" height="40" rx="11" fill="#101B2E"/>
    <path d="M11 9h4.4v22H11z" fill="#12C98A"/>
    <path d="M17 20.2 27.5 9H33L22.4 20.2 33 31h-5.6z" fill="#12C98A"/>
    <rect x="19" y="15.6" width="12.4" height="8.8" rx="2.2" fill="#EAF0F8" opacity=".95"/>
    <rect x="21" y="18.4" width="3.4" height="2.6" rx=".7" fill="#101B2E" opacity=".6"/>
  </svg>`;
}

/* ─── أدوات ─── */
let _invTimer=null, _invPoll=null;
const $=s=>document.querySelector(s);
const usd=n=>'$'+Number(n||0).toFixed(2);
const rate=()=>Number(S.config.usd_to_lyd)||11.8;
const lyd=n=>Math.ceil(Number(n||0)*rate()).toLocaleString('en-US')+' د.ل';
const n=v=>{const x=parseFloat(v);return Number.isFinite(x)?x:0;};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const phoneKey=r=>{let p=String(r||'').replace(/\D/g,'');
  if(p.startsWith('00218'))p=p.slice(5);else if(p.startsWith('218'))p=p.slice(3);
  if(p.startsWith('0'))p=p.slice(1);return p.slice(-9);};
const dt=v=>{if(!v)return '—';const d=v.toDate?v.toDate():new Date(v);
  return isNaN(d)?'—':d.toLocaleDateString('ar-LY',{day:'2-digit',month:'short'})+' · '+
  d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});};

function countTo(el,target,fmt=usd,ms=760){
  if(!el)return;
  const from=parseFloat(el.dataset.v||0);
  if(Math.abs(target-from)<.005){el.textContent=fmt(target);el.dataset.v=target;return;}
  el.dataset.v=target;
  const t0=performance.now();
  const step=now=>{const p=Math.min(1,(now-t0)/ms);const e=1-Math.pow(1-p,3);
    el.textContent=fmt(from+(target-from)*e);if(p<1)requestAnimationFrame(step);};
  requestAnimationFrame(step);
}

function toast(msg,kind=''){
  const el=document.createElement('div');
  el.className='toast '+kind;
  el.innerHTML=(kind==='ok'?svg(I.check,2.4):'')+`<span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el);
  setTimeout(()=>{el.style.opacity='0';el.style.transform='translateY(-10px)';
    el.style.transition='.26s';setTimeout(()=>el.remove(),270);},3600);
}
function sheet(h){$('#sheet').innerHTML=h;$('#ov').classList.add('show');}
window.closeSheet=()=>{
  if(typeof _invTimer!=='undefined'&&_invTimer){clearInterval(_invTimer);_invTimer=null;}
  if(typeof _invPoll!=='undefined'&&_invPoll){clearInterval(_invPoll);_invPoll=null;}
  $('#ov').classList.remove('show');
};
$('#ov').addEventListener('click',e=>{if(e.target.id==='ov')closeSheet();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSheet();});

async function copy(text,label){
  try{await navigator.clipboard.writeText(text);toast(label+' نُسخ','ok');}
  catch{toast('تعذّر النسخ','bad');}
}

/* ─── API ─── */
async function api(path,body){
  const token=await auth.currentUser.getIdToken();
  const res=await fetch(API_BASE+path,{method:'POST',
    headers:{'content-type':'application/json',authorization:'Bearer '+token},
    body:JSON.stringify(body||{})});
  const d=await res.json().catch(()=>({success:false,error:'رد غير مفهوم'}));
  if(!d.success)throw new Error(d.error||'فشلت العملية');
  return d;
}
async function apiGet(path){
  const res=await fetch(API_BASE+path);
  const d=await res.json();
  if(!d.success)throw new Error(d.error||'خطأ');
  return d;
}

/* ─── الثيم ─── */
function applyTheme(){
  const t=S.config.theme;if(!t)return;
  const r=document.documentElement.style;
  const dark=c=>{const m=/^#([\da-f]{6})$/i.exec(c||'');if(!m)return null;
    const n=parseInt(m[1],16),d=v=>Math.max(0,Math.round(v*.84));
    return '#'+[d(n>>16&255),d(n>>8&255),d(n&255)].map(v=>v.toString(16).padStart(2,'0')).join('');};
  if(t.emerald){r.setProperty('--accent',t.emerald);
    const d=dark(t.emerald);if(d)r.setProperty('--accent-d',d);}
  if(t.radius)r.setProperty('--r',t.radius+'px');
}

/* ─── الدخول ─── */
$('#railMark').innerHTML=mark(34);
$('#barMark').innerHTML=mark(30);

window.askOut=()=>sheet(`
  <div class="h2" style="margin-bottom:8px">تسجيل الخروج</div>
  <p class="sub" style="margin-bottom:20px">ستحتاج إلى الدخول مرة أخرى للوصول إلى بطاقاتك.</p>
  <button class="btn wide ghost" onclick="doOut()">تسجيل الخروج</button>
  <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">إلغاء</button>`);
window.doOut=async()=>{closeSheet();await signOut(auth);location.replace('login.html');};

onAuthStateChanged(auth,async user=>{
  S.unsub.forEach(u=>{try{u()}catch{}});S.unsub=[];
  dropLazy(null);
  if(!user){location.replace('login.html');return;}
  S.user=user;
  await ensureProfile(user);
  subscribe(user.uid);
  // نعرض آخر إعدادات معروفة فورًا — الشبكة قد تتأخر
  try{
    const c=JSON.parse(localStorage.getItem('kardo_cfg')||'null');
    if(c&&c.methods)S.config={...S.config,...c};
  }catch{}

  apiGet('/api/status').then(d=>{
    S.config={...S.config,...d};
    try{ localStorage.setItem('kardo_cfg',JSON.stringify(d)); }catch{}
    applyTheme();buildNav();render();
  }).catch(()=>{});
  api('/api/activity/ping',{}).catch(()=>{});
  boot();
});

async function ensureProfile(user){
  const ref=doc(db,'users',user.uid);
  try{
    const snap=await getDoc(ref);
    if(!snap.exists())await setDoc(ref,{
      name:user.displayName||'مستخدم',email:user.email||'',phone:'',
      wallet_balance:0,total_spent:0,cards_count:0,banned:false,
      created_at:new Date().toISOString()},{merge:true});
  }catch{}
}

function subscribe(uid){
  S.unsub.push(onSnapshot(doc(db,'users',uid),s=>{
    if(s.exists())S.profile={...S.profile,...s.data()};render();},()=>{}));
  S.unsub.push(onSnapshot(query(collection(db,'cards'),
    where('uid','==',uid),orderBy('created_at','desc')),
    s=>{S.cards=s.docs.map(d=>({id:d.id,...d.data()}));render();},()=>{}));
  // آخر خمس عمليات فقط للرئيسية — القائمة الكاملة عند فتح صفحتها
  S.unsub.push(onSnapshot(query(collection(db,'card_orders'),
    where('uid','==',uid),orderBy('created_at','desc'),limit(5)),
    s=>{S.orders=s.docs.map(d=>({id:d.id,...d.data()}));render();},()=>{}));
}

/* اشتراكات تُفتح عند الحاجة وتُغلق عند مغادرة الصفحة */
const _lazy={};
function lazySub(key, build){
  if(_lazy[key])return;
  _lazy[key]=onSnapshot(build(), snap=>{
    if(key==='orders')S.orders=snap.docs.map(d=>({id:d.id,...d.data()}));
    if(key==='deposits')S.deposits=snap.docs.map(d=>({id:d.id,...d.data()}));
    render();
  },()=>{});
}
function dropLazy(except){
  Object.keys(_lazy).forEach(k=>{
    if(k!==except&&_lazy[k]){ try{_lazy[k]()}catch{} delete _lazy[k]; }
  });
}

function ensurePageData(){
  const uid=S.user&&S.user.uid;
  if(!uid)return;
  if(S.page==='tx'){
    lazySub('orders',()=>query(collection(db,'card_orders'),
      where('uid','==',uid),orderBy('created_at','desc'),limit(60)));
    lazySub('deposits',()=>query(collection(db,'wallet_deposits'),
      where('uid','==',uid),orderBy('created_at','desc'),limit(40)));
  } else if(S.page==='wallet'){
    lazySub('deposits',()=>query(collection(db,'wallet_deposits'),
      where('uid','==',uid),orderBy('created_at','desc'),limit(40)));
    dropLazy('deposits');
  } else {
    dropLazy(null);
  }
}

/**
 * ميلان البطاقة تبعًا لموضع الإصبع أو المؤشر.
 * يُحسب عند التفاعل فقط — لا مستشعرات ولا حلقات دائمة،
 * حفاظًا على بطارية الأجهزة الضعيفة.
 */
function bindTilt(){
  // Skip entirely when the user asked for reduced motion
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const MAX = 7;                       // درجات — أكثر من ذلك يبدو لعبة
  document.querySelectorAll('.card').forEach(el=>{
    if(el._tilt)return; el._tilt=true;

    const move=(x,y)=>{
      const r=el.getBoundingClientRect();
      const px=(x-r.left)/r.width-.5;
      const py=(y-r.top)/r.height-.5;
      el.style.setProperty('--ry',( px*MAX*2).toFixed(2)+'deg');
      el.style.setProperty('--rx',(-py*MAX*2).toFixed(2)+'deg');
      el.style.setProperty('--hue',(px*90).toFixed(0)+'deg');
      el.classList.add('tilt');
    };
    const reset=()=>{
      el.classList.remove('tilt');
      el.style.removeProperty('--rx');
      el.style.removeProperty('--ry');
      el.style.removeProperty('--hue');
    };

    el.addEventListener('pointermove',e=>{
      if(e.pointerType==='touch')return;   // اللمس له مساره أدناه
      move(e.clientX,e.clientY);
    });
    el.addEventListener('pointerleave',reset);

    let raf=null;
    el.addEventListener('touchmove',e=>{
      const t=e.touches[0]; if(!t)return;
      if(raf)return;
      raf=requestAnimationFrame(()=>{ raf=null; move(t.clientX,t.clientY); });
    },{passive:true});
    el.addEventListener('touchend',reset,{passive:true});
    el.addEventListener('touchcancel',reset,{passive:true});
  });
}

function boot(){
  $('#app').style.display='block';
  applyTheme();buildNav();render();
  setTimeout(resumeInvoice,600);
}

/* ─── التنقّل ─── */
const PAGES=[
  {k:'home',t:'الرئيسية',i:I.home},
  {k:'guide',t:'كيف أستخدمها',i:I.book},
  {k:'invite',t:'ادعُ صديقًا',i:I.gift},
  {k:'issue',t:'إصدار بطاقة',i:I.plus},
  {k:'cards',t:'بطاقاتي',i:I.card},
  {k:'wallet',t:'المحفظة',i:I.wallet},
  {k:'tx',t:'المعاملات',i:I.list},
  {k:'help',t:'كيف أستخدمها',i:I.book},
  {k:'settings',t:'الإعدادات',i:I.gear},
];
const DOCK=['home','cards','issue','wallet','more'];
const visible=()=>PAGES.filter(p=>(S.config.nav||{})[p.k]!==false);

function buildNav(){
  const vis=visible(),keys=vis.map(p=>p.k);
  $('#navRail').innerHTML=vis.map(p=>
    `<button class="nav" data-nav="${p.k}">${svg(p.i)}<span>${p.t}</span></button>`).join('');
  const dk=DOCK.filter(k=>k==='more'||keys.includes(k));
  $('#navDock').style.gridTemplateColumns=`repeat(${dk.length},1fr)`;
  $('#navDock').innerHTML=dk.map(k=>{
    if(k==='more')return `<button class="dk" data-nav="more">
      <span class="dkico">${svg(I.more)}</span><span>المزيد</span></button>`;
    const p=PAGES.find(x=>x.k===k);
    return `<button class="dk" data-nav="${p.k}">
      <span class="dkico">${svg(p.i)}</span><span>${p.t}</span></button>`;
  }).join('');
  if(keys.length&&!keys.includes(S.page))S.page=keys[0];
  document.querySelectorAll('[data-nav]').forEach(b=>
    b.onclick=()=>b.dataset.nav==='more'?moreSheet():go(b.dataset.nav));
}

function moreSheet(){
  const keys=visible().map(p=>p.k);
  const dock=['home','cards','issue','wallet'];
  const rest=PAGES.filter(p=>keys.includes(p.k)&&!dock.includes(p.k));

  sheet(`
    <div class="h2" style="margin-bottom:16px">المزيد</div>
    <nav class="menu">
      ${rest.map((p,i)=>`
        <button class="mitem" style="animation-delay:${i*.045}s" data-more="${p.k}">
          <span class="mitem-ico">${svg(p.i)}</span>
          <span class="mitem-txt">${p.t}</span>
          <span class="mitem-arrow">${svg('<path d="M15 6l-6 6 6 6"/>',2)}</span>
        </button>`).join('')}
      <button class="mitem danger" style="animation-delay:${rest.length*.045}s" id="mOut">
        <span class="mitem-ico">${svg('<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>')}</span>
        <span class="mitem-txt">تسجيل الخروج</span>
        <span class="mitem-arrow">${svg('<path d="M15 6l-6 6 6 6"/>',2)}</span>
      </button>
    </nav>`);

  document.querySelectorAll('[data-more]').forEach(b=>
    b.onclick=()=>{closeSheet();go(b.dataset.more);});
  $('#mOut').onclick=()=>{closeSheet();askOut();};
}

window.go=k=>{
  // اتجاه الدخول يتبع موضع الصفحة في القائمة
  const seq=PAGES.map(p=>p.k);
  const from=seq.indexOf(S.page), to=seq.indexOf(k);
  S.dir = (from<0||to<0||from===to) ? 'anim' : (to>from ? 'fwd' : 'back');
  S.page=k;
  ensurePageData();
  if(k==='issue')S.wiz={step:1,amount:null,name:S.wiz.name,label:'',idem:null,quote:null};
  window.scrollTo({top:0,behavior:'instant'});
  render();
};

/* ─── العرض ─── */
let _rafId=null, _lastPage=null;
/** يجمع كل التحديثات المتتالية في رسمة واحدة */
function render(){
  if(_rafId)return;
  _rafId=requestAnimationFrame(()=>{ _rafId=null; paint(); });
}

function paint(){
  $('#av').textContent=(S.profile.name||'؟').trim().charAt(0);
  $('#railName').textContent=S.profile.name||'—';
  countTo($('#railBal'),S.profile.wallet_balance);
  countTo($('#barBal'),S.profile.wallet_balance);
  const tag=document.querySelector('.rail .tag');
  if(tag&&S.config.texts&&S.config.texts.tagline)tag.textContent=S.config.texts.tagline;
  document.querySelectorAll('[data-nav]').forEach(b=>
    b.classList.toggle('on',b.dataset.nav===S.page));
  const V={home:vHome,issue:vIssue,cards:vCards,wallet:vWallet,
           tx:vTx,help:vHelp,settings:vSettings};
  const view=$('#view');
  if(S.config.kill_switch===true){
    view.classList.remove('anim');
    view.innerHTML=killScreen();
    _lastPage=null;
    return;
  }
  const moved=_lastPage!==S.page;
  view.classList.remove('anim','fwd','back');
  if(moved)view.classList.add(S.dir||'anim');
  view.innerHTML=(V[S.page]||vHome)();
  _lastPage=S.page;
  S.dir=null;
  bind();
  bindTilt();
  bindBanner();
}

function killScreen(){
  return `<div class="panel" style="margin-top:20px"><div class="empty">
    <div class="ico" style="background:rgba(242,104,95,.14);color:var(--danger)">
      ${svg(I.clock,1.6)}</div>
    <div style="font-weight:600;color:var(--text);font-size:16px;margin-bottom:6px">
      الخدمة متوقفة مؤقتًا</div>
    <p style="font-size:13.5px;max-width:320px;margin:0 auto">
      ${esc(S.config.kill_message||'نعمل على صيانة سريعة. عد بعد قليل.')}</p>
  </div></div>`;
}

const offline=()=>S.config.issuing_enabled?'':
  `<div class="note">${esc(S.config.maintenance_message||'إصدار البطاقات متوقف مؤقتًا.')}</div>`;

/* ─── الرئيسية ─── */
function vHome(){
  const active=S.cards.filter(c=>c.status==='active').length;
  const recent=[...S.orders].slice(0,4);
  const T=S.config.texts||{};
  const banners=(S.config.banners||[]).filter(b=>b&&b.img);

  return offline()+`
  ${banners.length?`
    <section class="bnr" id="bnr">
      <div class="bnr-track" id="bnrTrack">
        ${banners.map(b=>`
          <div class="bnr-slide"${b.link?` data-blink="${esc(b.link)}"`:''}>
            <img src="${esc(b.img)}" alt="${esc(b.title||'')}" loading="lazy" decoding="async">
            ${b.title?`<span class="bnr-cap">${esc(b.title)}</span>`:''}
          </div>`).join('')}
      </div>
      ${banners.length>1?`<div class="bnr-dots" id="bnrDots">
        ${banners.map((_,i)=>`<span class="${i===0?'on':''}"></span>`).join('')}
      </div>`:''}
    </section>`:''}

  <div class="metrics">
    <div class="metric"><div class="v num">${active}</div><div class="k">بطاقات نشطة</div></div>
    <div class="metric"><div class="v num">${usd(S.profile.total_spent)}</div><div class="k">إجمالي الإنفاق</div></div>
    <div class="metric"><div class="v num">${S.orders.length}</div><div class="k">عملية</div></div>
  </div>

  <div class="quick">
    <button class="qbtn primary" data-act="issue">
      <span class="qico">${svg(I.plus)}</span>
      <span>إصدار بطاقة</span></button>
    <button class="qbtn" data-act="deposit">
      <span class="qico">${svg(I.up,2)}</span>
      <span>إضافة رصيد</span></button>
  </div>

  ${S.cards.length?`
    <div class="sechead">
      <div class="h2">بطاقاتي</div>
      <button data-act="cards" class="seclink">عرض الكل</button>
    </div>
    <div class="rail-cards" style="margin-bottom:26px">
      ${S.cards.slice(0,4).map(cardHtml).join('')}</div>`
  :`<div class="panel" style="margin-bottom:26px">
      <div class="empty">
        <div class="ico">${svg(I.card,1.6)}</div>
        <div style="font-weight:700;color:var(--text);font-size:15px;margin-bottom:5px">
          ${esc(T.hero_title||'أنشئ بطاقتك الأولى')}</div>
        <p style="font-size:13px;margin-bottom:18px">
          ${esc(T.hero_sub||'بطاقة تعمل في كل مكان يقبل الدفع الإلكتروني — تُصدر في دقائق.')}</p>
        <button class="btn" data-act="issue">إصدار بطاقة</button>
      </div></div>`}

  <div class="h2" style="margin-bottom:13px">آخر النشاط</div>
  ${recent.length?`<div class="feed">${recent.map(feedRow).join('')}</div>`
    :`<div class="panel"><div class="empty">
        <div class="ico">${svg(I.list,1.6)}</div>
        <p style="font-size:13.5px">ستظهر عملياتك هنا بعد أول بطاقة.</p></div></div>`}`;
}

/* Auto-rotating banner with swipe support */
let _bnrTimer=null;
function bindBanner(){
  clearInterval(_bnrTimer);
  const track=$('#bnrTrack');
  if(!track)return;
  const slides=[...track.children];
  if(!slides.length)return;

  const dots=$('#bnrDots');
  let i=0;
  const paint=()=>{
    track.style.transform=`translateX(${i*100}%)`;
    if(dots)[...dots.children].forEach((d,n)=>d.classList.toggle('on',n===i));
  };
  const next=()=>{ i=(i+1)%slides.length; paint(); };

  slides.forEach(sl=>{
    if(sl.dataset.blink)
      sl.onclick=()=>window.open(sl.dataset.blink,'_blank','noopener');
  });

  if(slides.length>1){
    const secs=Math.max(3,S.config.banner_rotate_sec||6);
    _bnrTimer=setInterval(next,secs*1000);

    // Swipe
    let x0=null;
    track.addEventListener('touchstart',e=>{x0=e.touches[0].clientX;},{passive:true});
    track.addEventListener('touchend',e=>{
      if(x0===null)return;
      const dx=e.changedTouches[0].clientX-x0;
      if(Math.abs(dx)>44){
        i=dx<0 ? (i+1)%slides.length : (i-1+slides.length)%slides.length;
        paint();
        clearInterval(_bnrTimer);
        _bnrTimer=setInterval(next,Math.max(3,S.config.banner_rotate_sec||6)*1000);
      }
      x0=null;
    },{passive:true});
  }
  paint();
}

const TYPE={create:'إصدار بطاقة',fund:'شحن بطاقة',deposit:'إيداع رصيد'};
const STAT={completed:['ok','مكتملة'],processing:['wait','قيد المعالجة'],
  refunded:['bad','مستردة'],failed:['bad','فاشلة'],
  pending:['wait','قيد المراجعة'],approved:['ok','مقبول'],rejected:['bad','مرفوض']};

function feedRow(r){
  const kind=r.kind||r.type;
  const st=STAT[r.status]||['off','—'];
  const isIn=kind==='deposit';
  const val=r.customer_price??r.amount??0;
  const ico=kind==='deposit'?I.up:kind==='fund'?I.plus:I.card;
  return `<div class="fitem">
    <div class="fico" ${isIn?'style="color:var(--accent);background:var(--accent-soft)"':''}>
      ${svg(ico)}</div>
    <div class="fmain">
      <div class="ftitle">${TYPE[kind]||'عملية'}</div>
      <div class="fmeta">${dt(r.created_at)}</div>
    </div>
    <div class="fval">
      <div class="famt num ${isIn&&r.status==='approved'?'in':''}">
        ${isIn?'+':'−'}${usd(val)}</div>
      <span class="chip ${st[0]}" style="margin-top:3px">${st[1]}</span>
    </div></div>`;
}

/* ─── البطاقة ─── */
function cardHtml(c){
  const cls=c.status==='frozen'?'frozen':c.status==='deleted'?'dead':'';
  const bal=c.live_balance??c.amount_loaded??0;
  const st={active:['ok','نشطة'],frozen:['off','مجمدة'],deleted:['bad','مغلقة']}[c.status]||['off','—'];
  return `<div>
    <div class="card ${cls}" data-card="${esc(c.id)}">
      <span class="holo"></span>
      <div class="top">
        <span class="wm">Kardo</span>
        <span class="chip ${st[0]}">${st[1]}</span>
      </div>
      <div class="chipx"></div>
      <div class="pan mono">•••• •••• •••• ${esc(c.last4||'0000')}</div>
      <div class="foot">
        <div><div class="thru">VALID THRU</div>
          <div class="mono" style="font-size:12px">${esc(c.expiry||'••/••')}</div></div>
        <div class="amt num">${usd(bal)}</div>
      </div>
    </div>
    <div style="padding:11px 3px 0">
      <div style="font-weight:600;font-size:14px">${esc(c.card_name||'بطاقة')}</div>
      <div class="fmeta">${dt(c.created_at)}</div>
    </div></div>`;
}

/* ─── إصدار ─── */
function vIssue(){
  if(!S.config.issuing_enabled)
    return `<div class="h1" style="margin-bottom:18px">إصدار بطاقة</div>
      <div class="panel"><div class="empty"><div class="ico">${svg(I.clock,1.6)}</div>
      <div style="font-weight:600;color:var(--text);margin-bottom:5px">الخدمة متوقفة مؤقتًا</div>
      <p style="font-size:13px">${esc(S.config.maintenance_message||'سنعيد التشغيل قريبًا.')}</p>
      </div></div>`;

  const w=S.wiz;
  const dot=n=>`<div class="sdot ${w.step===n?'on':w.step>n?'done':''}">${w.step>n?'✓':n}</div>`;
  const line=n=>`<div class="sline ${w.step>n?'on':''}"></div>`;
  let body='';

  if(w.step===1){
    body=`
    <label class="lbl">اسم البطاقة — لك وحدك، لتمييزها</label>
    <input class="inp" id="wLabel" placeholder="بطاقة الاشتراكات"
           value="${esc(w.label)}" maxlength="40">
    <label class="lbl" style="margin-top:16px">اسم حامل البطاقة — بالإنجليزية</label>
    <input class="inp mono" id="wName" placeholder="MANSOUR ALI" value="${esc(w.name)}"
           maxlength="24" style="text-transform:uppercase" dir="ltr">
    <p class="sub" style="font-size:12px;margin-top:8px">
      حروف لاتينية فقط. يظهر على البطاقة ولا يمكن تغييره بعد الإصدار.</p>
    <button class="btn wide" id="wN1" style="margin-top:20px">التالي</button>`;
  } else if(w.step===2){
    const mn=S.config.min_amount||10,mx=S.config.max_amount||200;
    body=`
    <label class="lbl">قيمة البطاقة</label>
    <div class="amts">${[10,20,50,100].map(a=>
      `<button class="amt-b ${w.amount===a?'on':''}" data-amt="${a}">$${a}</button>`).join('')}</div>
    <label class="lbl" style="margin-top:16px">أو مبلغ آخر — من $${mn} إلى $${mx}</label>
    <input class="inp num" id="wCustom" type="number" inputmode="decimal"
           min="${mn}" max="${mx}" placeholder="${mn}"
           value="${w.amount&&![10,20,50,100].includes(w.amount)?w.amount:''}">
    <div id="qbox">${w.quote?quoteHtml(w.quote):''}</div>
    <button class="btn wide" id="wN2" style="margin-top:18px" ${w.quote?'':'disabled'}>التالي</button>
    <button class="btn line wide" style="margin-top:9px" data-step="1">رجوع</button>`;
  } else {
    const q=w.quote,ok=(S.profile.wallet_balance||0)>=q.total;
    body=`
    <div class="quote" style="margin-top:0">
      <div class="qrow"><span class="k">اسم البطاقة</span><span>${esc(w.label||'بطاقة')}</span></div>
      <div class="qrow"><span class="k">حامل البطاقة</span>
        <span class="mono" dir="ltr">${esc(w.name)}</span></div>
      <div class="qrow"><span class="k">قيمة البطاقة</span><span class="num">${usd(q.amount)}</span></div>
      <div class="qrow"><span class="k">رسوم الخدمة</span><span class="num">${usd(q.service_fee)}</span></div>
      <div class="qrow tot"><span>الإجمالي</span><span class="num">${usd(q.total)}
        <span style="font-size:12px;color:var(--text-3);font-weight:400">
          · ${q.total_lyd.toLocaleString('en-US')} د.ل</span></span></div>
    </div>
    ${!ok?`<div class="note" style="margin:14px 0 0">
      رصيدك ${usd(S.profile.wallet_balance)} — تحتاج ${usd(q.total-S.profile.wallet_balance)} إضافية.
      <button style="color:var(--accent);font-weight:700" data-act="deposit">إضافة رصيد</button>
      </div>`:''}
    <label style="display:flex;gap:10px;align-items:flex-start;margin:16px 0;
           font-size:13px;cursor:pointer;color:var(--text-2)">
      <input type="checkbox" id="wAgree" style="width:17px;height:17px;margin-top:2px;
             flex:none;accent-color:var(--accent)">
      <span>أوافق على الشروط: البطاقة تُصدر عبر جهة إصدار خارجية، ورسوم الإصدار
        غير قابلة للاسترداد بعد نجاح العملية.</span></label>
    <button class="btn wide" id="wGo" ${ok?'':'disabled'}>إصدار البطاقة</button>
    <button class="btn line wide" style="margin-top:9px" data-step="2">رجوع</button>`;
  }

  return `
  <div class="eyebrow" style="margin-bottom:5px">خطوة ${w.step} من 3</div>
  <div class="h1" style="margin-bottom:20px">إصدار بطاقة</div>
  <div class="panel" style="max-width:520px">
    <div class="steps">${dot(1)}${line(1)}${dot(2)}${line(2)}${dot(3)}</div>
    ${body}
  </div>`;
}

function quoteHtml(q){
  return `<div class="quote">
    <div class="qrow"><span class="k">قيمة البطاقة</span><span class="num">${usd(q.amount)}</span></div>
    <div class="qrow"><span class="k">رسوم الخدمة</span><span class="num">${usd(q.service_fee)}</span></div>
    <div class="qrow tot"><span>الإجمالي</span><span class="num">${usd(q.total)}
      <span style="font-size:12px;color:var(--text-3);font-weight:400">
        · ${q.total_lyd.toLocaleString('en-US')} د.ل</span></span></div>
  </div>`;
}

let qTimer=null;
async function fetchQuote(amount){
  const box=$('#qbox'),btn=$('#wN2');
  if(!box)return;
  const mn=S.config.min_amount||10,mx=S.config.max_amount||200;
  if(!(amount>=mn&&amount<=mx)){
    S.wiz.quote=null;
    box.innerHTML=amount?`<div class="note" style="margin-top:14px">
      المبلغ يجب أن يكون بين $${mn} و $${mx}.</div>`:'';
    if(btn)btn.disabled=true;return;
  }
  box.innerHTML=`<div class="quote">
    <div class="sk" style="height:15px;margin-bottom:10px"></div>
    <div class="sk" style="height:15px;width:68%;margin-bottom:10px"></div>
    <div class="sk" style="height:20px;width:46%"></div></div>`;
  try{
    const d=await apiGet(`/api/quote?amount=${amount}&kind=create`);
    S.wiz.quote=d.quote;S.wiz.amount=amount;
    box.innerHTML=quoteHtml(d.quote);
    if(btn)btn.disabled=false;
  }catch(e){
    S.wiz.quote=null;
    box.innerHTML=`<div class="note" style="margin-top:14px">${esc(e.message)}</div>`;
    if(btn)btn.disabled=true;
  }
}

/* ─── بطاقاتي ─── */
function vCards(){
  return `
  <div class="h1" style="margin-bottom:5px">بطاقاتي</div>
  <p class="sub" style="margin-bottom:22px">اضغط أي بطاقة لعرض بياناتها وإدارتها.</p>
  ${S.cards.length?`<div class="rail-cards">${S.cards.map(cardHtml).join('')}</div>`
   :`<div class="panel"><div class="empty">
      <div class="ico">${svg(I.card,1.6)}</div>
      <div style="font-weight:600;color:var(--text);font-size:15px;margin-bottom:5px">
        لم تصدر أي بطاقة بعد</div>
      <p style="font-size:13px;margin-bottom:18px">أنشئ بطاقتك الافتراضية الأولى وابدأ الدفع.</p>
      <button class="btn" data-act="issue">إصدار بطاقة</button></div></div>`}`;
}

async function openCard(id){
  const c=S.cards.find(x=>x.id===id);if(!c)return;
  const bal=c.live_balance??c.amount_loaded??0;
  const act=c.status==='active';

  sheet(`
    <div class="flipwrap" id="flip" style="max-width:280px;margin:0 auto 20px">
      <div class="flipper">
        <div class="face">${cardHtml(c)}</div>
        <div class="back"><div class="cardback">
          <div class="magstripe"></div>
          <div class="sigrow">
            <div class="sigbar"></div>
            <div class="cvvbox" id="bkCvv">•••</div>
          </div>
          <div style="margin-top:auto;padding:0 16px 14px">
            <div class="mono" id="bkPan" dir="ltr"
                 style="font-size:12.5px;color:#DCE5F2;letter-spacing:.1em">
              •••• •••• •••• ${esc(c.last4||'0000')}</div>
            <div class="mono" id="bkExp" dir="ltr"
                 style="font-size:10.5px;color:var(--text-3);margin-top:3px">••/••</div>
          </div>
        </div></div>
      </div>
    </div>
    <div class="h2">${esc(c.card_name||'بطاقة')}</div>
    <p class="fmeta" style="margin-bottom:16px">${dt(c.created_at)}</p>
    <div id="sec"><button class="btn line wide" id="rev">${svg(I.eye)} عرض بيانات البطاقة</button></div>
    <div style="display:grid;gap:8px;grid-template-columns:repeat(2,1fr);margin-top:14px">
      <button class="btn line sm" id="txB">${svg(I.list)} المعاملات</button>
      ${c.status!=='deleted'?`<button class="btn line sm" id="frB">${svg(I.snow)}
        ${act?'تجميد':'إلغاء التجميد'}</button>`:''}
      ${act&&S.config.funding_enabled?`<button class="btn line sm" id="fdB">${svg(I.plus)} شحن</button>`:''}
      ${c.status!=='deleted'?`<button class="btn risk sm" id="dlB">${svg(I.trash)} إغلاق</button>`:''}
    </div>
    <div id="extra"></div>
    <button class="btn line wide" style="margin-top:14px" onclick="closeSheet()">إغلاق</button>`);

  $('#rev').onclick=async()=>{
    const box=$('#sec');
    box.innerHTML=`<div class="sk" style="height:52px;margin-bottom:8px"></div>
                   <div class="sk" style="height:52px"></div>`;
    try{
      const d=(await api('/api/cards/details',{card_id:id})).details;

      // املأ الوجه الخلفي واقلب البطاقة
      const grp4=v=>String(v).replace(/(.{4})/g,'$1 ').trim();
      const bp=$('#bkPan'),be=$('#bkExp'),bc=$('#bkCvv'),fw=$('#flip');
      if(bp)bp.textContent=grp4(d.card_number);
      if(be)be.textContent=d.expiry;
      if(bc)bc.textContent=d.cvv;
      if(fw)fw.classList.add('flipped');

      let shown=false;
      const paint=()=>{
        const grp=n=>shown?String(n).replace(/(.{4})/g,'$1 ').trim():'•••• •••• •••• '+String(n).slice(-4);
        box.innerHTML=`<div class="panel-q">
          <div class="secret"><div><div class="payk">رقم البطاقة</div>
            <div class="v mono ${shown?'':'hid'}" dir="ltr">${grp(d.card_number)}</div></div>
            <button class="ibtn" data-cp="${esc(d.card_number)}" data-lb="رقم البطاقة">${svg(I.copy)}</button></div>
          <div class="secret"><div><div class="payk">تاريخ الانتهاء</div>
            <div class="v mono" dir="ltr">${esc(d.expiry)}</div></div>
            <button class="ibtn" data-cp="${esc(d.expiry)}" data-lb="تاريخ الانتهاء">${svg(I.copy)}</button></div>
          <div class="secret"><div><div class="payk">CVV</div>
            <div class="v mono ${shown?'':'hid'}" dir="ltr">${shown?esc(d.cvv):'•••'}</div></div>
            <button class="ibtn" data-cp="${esc(d.cvv)}" data-lb="CVV">${svg(I.copy)}</button></div>
        </div>
        <button class="btn line wide sm" id="tg" style="margin-top:10px">
          ${svg(shown?I.eyeoff:I.eye)} ${shown?'إخفاء':'إظهار'} البيانات</button>
        <p class="sub" style="font-size:11.5px;margin-top:10px;text-align:center">
          لا تشارك هذه البيانات — من يحصل عليها يستطيع الصرف من بطاقتك.</p>`;
        $('#tg').onclick=()=>{
          shown=!shown;
          const fw=$('#flip');
          if(fw)fw.classList.toggle('flipped',shown);
          paint();
        };
        box.querySelectorAll('[data-cp]').forEach(b=>b.onclick=()=>copy(b.dataset.cp,b.dataset.lb));
      };
      paint();
    }catch(e){
      box.innerHTML=`<div class="note">${esc(e.message)}</div>
        <button class="btn line wide sm" onclick="openCard('${esc(id)}')">إعادة المحاولة</button>`;
    }
  };

  $('#txB').onclick=async()=>{
    const x=$('#extra');
    x.innerHTML=`<div class="sk" style="height:64px;margin-top:14px"></div>`;
    try{
      const d=await api('/api/cards/transactions',{card_id:id});
      x.innerHTML=`<div class="panel-q" style="margin-top:14px">
        <div style="display:flex;justify-content:space-between;margin-bottom:12px">
          <span class="h2" style="font-size:14px">معاملات البطاقة</span>
          <span class="num" style="font-weight:600">${usd(d.balance)}</span></div>
        ${d.transactions.length?d.transactions.map(t=>`
          <div style="display:flex;justify-content:space-between;gap:10px;padding:10px 0;
               border-bottom:1px solid var(--line)">
            <div style="min-width:0">
              <div style="font-size:13.5px;font-weight:600;overflow:hidden;
                   text-overflow:ellipsis;white-space:nowrap">${esc(t.merchant||t.type)}</div>
              <div class="fmeta">${esc(t.date)} · ${esc(t.reason||'')}</div></div>
            <div style="text-align:start;flex:none">
              <div class="num" style="font-size:13.5px;font-weight:600">${usd(t.amount)}</div>
              <span class="chip ${t.status==='success'?'ok':'bad'}">
                ${t.status==='success'?'ناجحة':'مرفوضة'}</span></div>
          </div>`).join('')
          :`<p class="sub" style="text-align:center;padding:14px 0">لا معاملات على هذه البطاقة بعد.</p>`}
      </div>`;
    }catch(e){x.innerHTML=`<div class="note" style="margin-top:14px">${esc(e.message)}</div>`;}
  };

  const fr=$('#frB');
  if(fr)fr.onclick=async()=>{
    fr.disabled=true;
    try{
      await api('/api/cards/freeze',{card_id:id,action:act?'freeze':'unfreeze'});
      toast(act?'جُمّدت البطاقة':'أُلغي التجميد','ok');closeSheet();render();
    }catch(e){toast(e.message,'bad');fr.disabled=false;}
  };

  const fd=$('#fdB');if(fd)fd.onclick=()=>fundSheet(c);

  const dl=$('#dlB');
  if(dl)dl.onclick=()=>{
    sheet(`<div class="h2" style="margin-bottom:8px">إغلاق البطاقة نهائيًا</div>
      <p class="sub" style="margin-bottom:10px">
        سيُغلق ${esc(c.card_name||'البطاقة')} ولا يمكن استخدامها بعد ذلك.</p>
      <div class="note">الرصيد المتبقي ${usd(bal)} يُعاد إلى محفظتك بعد خصم رسوم الإغلاق.
        العملية غير قابلة للتراجع.</div>
      <button class="btn wide" style="background:var(--danger);color:#fff" id="dlGo">
        تأكيد الإغلاق</button>
      <button class="btn line wide" style="margin-top:9px"
        onclick="openCard('${esc(id)}')">رجوع</button>`);
    $('#dlGo').onclick=async()=>{
      $('#dlGo').disabled=true;
      try{
        const r=await api('/api/cards/delete',{card_id:id});
        toast('أُغلقت البطاقة · أُعيد '+usd(r.refunded_to_wallet??bal)+' إلى محفظتك','ok');
        closeSheet();render();
      }catch(e){toast(e.message,'bad');$('#dlGo').disabled=false;}
    };
  };
}
window.openCard=openCard;

function fundSheet(c){
  sheet(`
    <div class="h2" style="margin-bottom:4px">شحن البطاقة</div>
    <p class="fmeta" style="margin-bottom:16px">${esc(c.card_name||'بطاقة')} · ••${esc(c.last4)}</p>
    <label class="lbl">المبلغ — الحد الأدنى $${S.config.min_amount||10}</label>
    <input class="inp num" id="fA" type="number" inputmode="decimal"
           min="${S.config.min_amount||10}" placeholder="${S.config.min_amount||10}">
    <div id="fQ"></div>
    <button class="btn wide" id="fG" style="margin-top:16px" disabled>شحن البطاقة</button>
    <button class="btn line wide" style="margin-top:9px"
      onclick="openCard('${esc(c.id)}')">رجوع</button>`);

  let q=null,t=null;
  $('#fA').oninput=e=>{
    clearTimeout(t);
    const a=parseFloat(e.target.value);
    t=setTimeout(async()=>{
      const box=$('#fQ'),btn=$('#fG');
      if(!(a>=(S.config.min_amount||10))){q=null;box.innerHTML='';btn.disabled=true;return;}
      box.innerHTML=`<div class="quote"><div class="sk" style="height:46px"></div></div>`;
      try{
        const d=await apiGet(`/api/quote?amount=${a}&kind=fund`);
        q=d.quote;box.innerHTML=quoteHtml(q);
        btn.disabled=(S.profile.wallet_balance||0)<q.total;
        if(btn.disabled)box.innerHTML+=`<div class="note" style="margin-top:11px">
          رصيدك غير كافٍ — المتاح ${usd(S.profile.wallet_balance)}.</div>`;
      }catch(err){q=null;box.innerHTML=`<div class="note">${esc(err.message)}</div>`;btn.disabled=true;}
    },420);
  };

  $('#fG').onclick=async()=>{
    if(!q)return;
    $('#fG').disabled=true;
    try{
      await api('/api/cards/fund',{card_id:c.id,amount:q.amount,
        idempotency_key:crypto.randomUUID?crypto.randomUUID():'k'+Date.now()+Math.random()});
      toast('شُحنت البطاقة بمبلغ '+usd(q.amount),'ok');closeSheet();render();
    }catch(e){toast(e.message,'bad');$('#fG').disabled=false;}
  };
}

/* ─── المحفظة ─── */
function vWallet(){
  return `
  <div class="hero">
    <div class="eyebrow">الرصيد المتاح</div>
    <div class="bal num">${usd(S.profile.wallet_balance)}</div>
    <div class="bal-lyd">≈ ${lyd(S.profile.wallet_balance)}</div>
    <div class="hero-acts">
      <button class="btn" data-act="deposit">${svg(I.up,2)} إضافة رصيد</button>
    </div>
  </div>

  <div class="h2" style="margin:24px 0 13px">سجل الإيداعات</div>
  ${S.deposits.length?`<div class="feed">${S.deposits.map(d=>{
    const st=STAT[d.status]||['off','—'];
    return `<div class="fitem">
      <div class="fico" ${d.status==='approved'?'style="color:var(--accent);background:var(--accent-soft)"':''}>
        ${svg(I.up)}</div>
      <div class="fmain">
        <div class="ftitle num">${usd(d.amount_usd)}
          <span style="font-weight:400;color:var(--text-3);font-size:12px"> · ${esc(d.method||'—')}</span></div>
        <div class="fmeta">${dt(d.created_at)}${
          d.reject_reason?' · <span style="color:var(--danger)">'+esc(d.reject_reason)+'</span>':''}</div>
      </div>
      <span class="chip ${st[0]}">${st[1]}</span></div>`;}).join('')}</div>`
   :`<div class="panel"><div class="empty">
      <div class="ico">${svg(I.wallet,1.6)}</div>
      <div style="font-weight:600;color:var(--text);margin-bottom:5px">لا إيداعات بعد</div>
      <p style="font-size:13px;margin-bottom:18px">أضف رصيدًا لتبدأ إصدار البطاقات.</p>
      <button class="btn" data-act="deposit">إضافة رصيد</button></div></div>`}`;
}

function depositSheet(){
  const M=S.config.methods||{};
  const order=String(S.config.method_order||'libyana,almadar,usdt,bank,binance')
    .split(',').map(x=>x.trim()).filter(Boolean);
  const builtin=['libyana','almadar','usdt','bank','binance'];
  const custom=Object.keys(M).filter(k=>M[k]&&M[k].custom);
  const all=[...builtin,...custom];
  const seq=[...order.filter(k=>all.includes(k)),
             ...all.filter(k=>!order.includes(k))];
  const list=seq.map(k=>({k,...(M[k]||{})})).filter(m=>m.on);

  if(!list.length)return sheet(`<div class="h2" style="margin-bottom:10px">إضافة رصيد</div>
    <div class="note">طرق الدفع متوقفة مؤقتًا — تواصل مع الدعم.</div>
    <button class="btn line wide" onclick="closeSheet()">حسنًا</button>`);

  // خطوة واحدة فقط؟ ادخلها مباشرة
  if(list.length===1)return methodSheet(list[0].k);

  sheet(`
    <div class="balcard">
      <span class="holo"></span>
      <div class="balcard-top">
        <span class="eyebrow" style="color:rgba(255,255,255,.5)">رصيد المحفظة</span>
        <span class="balcard-mark">Kardo</span>
      </div>
      <div class="bal num" id="depBal" style="font-size:36px">${usd(S.profile.wallet_balance)}</div>
      <div class="balcard-lyd">≈ ${lyd(S.profile.wallet_balance)}</div>
    </div>

    <div class="h2" style="margin:20px 0 4px">إضافة رصيد</div>
    <p class="sub" style="margin-bottom:16px">اختر طريقة التحويل التي تناسبك.</p>
    <div class="mgrid">
      ${list.map((m,i)=>`
        <button class="mcard ${m.auto?'fast':''}" data-pick="${m.k}"
                style="animation-delay:${i*.05}s">
          <span class="mtag ${m.auto?'auto':'man'}">${m.auto?'تلقائي':'يدوي'}</span>
          ${m.auto&&i===0?'<span class="mbest">الأسرع</span>':''}
          <span class="mlogo">${methodLogo(m.k,m.logo)}</span>
          <span class="mname">${esc(m.label||m.k)}</span>
          <span class="mrate">${m.k==='usdt'||m.k==='binance'
            ? 'بالدولار مباشرة' : (m.rate||11.8)+' د.ل للدولار'}</span>
        </button>`).join('')}
    </div>
    <button class="btn line wide" style="margin-top:16px" onclick="closeSheet()">إلغاء</button>`);

  const db=$('#depBal');
  if(db){db.dataset.v=0;countTo(db,S.profile.wallet_balance);}

  document.querySelectorAll('[data-pick]').forEach(b=>
    b.onclick=()=>methodSheet(b.dataset.pick));
}

/* شاشة الطريقة الواحدة — بياناتها ونموذجها */
function methodSheet(k){
  const cfg=(S.config.methods||{})[k]||{};
  if(cfg.invoice) return usdtSheet(k);
  const M=S.config.methods||{};
  const m=M[k]||{};
  const auto=!!m.auto;
  const r=m.rate||11.8;
  const crypto_=k==='usdt'||k==='binance';
  const unit=crypto_?'USDT':'د.ل';
  const dp=m.phone||S.config.deposit_phone||'';
  const note=S.config.deposit_note||'';
  const fields=(m.fields||[]).filter(f=>f&&f.value);
  const many=Object.keys(M).filter(x=>M[x]&&M[x].on).length>1;

  sheet(`
    <div class="mhead">
      ${many?`<button class="ibtn" id="mBack" aria-label="رجوع">
        ${svg('<path d="M9 6l6 6-6 6"/>',2.2)}</button>`:'<span></span>'}
      <div style="display:flex;align-items:center;gap:11px;min-width:0">
        <span class="mlogo sm">${methodLogo(k,m.logo)}</span>
        <div style="min-width:0">
          <div class="h2" style="font-size:15px">${esc(m.label||k)}</div>
          <div class="mfoot ${auto?'auto':'man'}">
            ${auto?'يُضاف الرصيد خلال ثوانٍ':'نراجع الإيصال ثم نضيف الرصيد'}</div>
        </div>
      </div>
    </div>

    ${auto&&dp?`
      <div class="panel-q" style="text-align:center;margin-bottom:16px">
        <div class="payk" style="margin-bottom:9px">رقم التحويل — ممنوع الاتصال</div>
        <button id="cpP" class="mono" dir="ltr"
          style="display:inline-flex;align-items:center;gap:9px;background:var(--accent);
                 color:#04121B;padding:10px 18px;border-radius:10px;font-weight:700;font-size:18px">
          ${svg(I.copy,2)} ${esc(dp)}</button>
      </div>`:''}

    ${!auto&&fields.length?`
      <div class="paybox">
        ${fields.map((f,i)=>`<div class="payrow">
          <div style="min-width:0"><div class="payk">${esc(f.label)}</div>
            <div class="payv ${f.copy?'mono':''}" ${f.copy?'dir="ltr"':''}>${esc(f.value)}</div></div>
          ${f.copy?`<button class="ibtn" data-cpf="${i}" aria-label="نسخ ${esc(f.label)}">
            ${svg(I.copy)}</button>`:''}
        </div>`).join('')}
      </div>`:''}

    ${note?`<div class="note">${esc(note)}</div>`:''}

    ${auto?`
      <label class="lbl">رقمك الذي حوّلت منه</label>
      <input class="inp num" id="cP" type="tel" inputmode="numeric" placeholder="912345678"
             dir="ltr" maxlength="13" value="${esc(S.profile.phone||'')}">
      <p class="sub" style="font-size:12px;margin-top:7px">اكتب رقمك بدون الصفر</p>`:''}

    <label class="lbl" style="margin-top:${auto?'16px':'0'}">
      المبلغ الذي أرسلته${crypto_?' (USDT)':' (بالدينار)'}</label>
    <input class="inp num" id="cA" type="number" inputmode="decimal"
           step="0.001" min="1" placeholder="${crypto_?'10':'118'}">

    ${!auto?`
      <label class="lbl" style="margin-top:16px">صورة إثبات التحويل</label>
      <label class="drop" id="dropZone">
        <input type="file" id="proofFile" accept="image/*" hidden>
        <div id="dropIn">${svg(I.up,1.7)}
          <div style="font-size:13px;font-weight:600;margin-top:8px">اختر صورة الإيصال</div>
          <div style="font-size:11.5px;color:var(--text-3);margin-top:2px">
            تُضغط تلقائيًا قبل الإرسال</div>
        </div>
      </label>`:''}

    <div id="cQ"></div>
    <button class="btn wide" id="cG" style="margin-top:18px">تأكيد التحويل</button>
    <p class="sub" style="font-size:11.5px;text-align:center;margin-top:12px">
      ${auto?'إن لم تصل رسالة التحويل بعد، يبقى طلبك معلّقًا ويُضاف الرصيد فور وصولها.'
             :'يظهر الرصيد في محفظتك بعد مراجعة الإيصال.'}</p>
    <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">إلغاء</button>`);

  const back=$('#mBack');
  if(back)back.onclick=()=>depositSheet();

  const cp=$('#cpP');
  if(cp)cp.onclick=()=>copy(dp,'رقم التحويل');

  document.querySelectorAll('[data-cpf]').forEach(b=>{
    const f=fields[+b.dataset.cpf];
    if(f)b.onclick=()=>copy(f.value,f.label);
  });

  let proof=null;
  const fileEl=$('#proofFile'),zone=$('#dropZone');
  if(fileEl)fileEl.onchange=e=>{
    const f=e.target.files[0];
    if(!f)return;
    if(!f.type.startsWith('image/'))return toast('اختر ملف صورة','bad');
    if(f.size>12*1024*1024)return toast('الصورة أكبر من 12 ميجابايت','bad');
    proof=f;
    zone.classList.add('has');
    $('#dropIn').innerHTML=`<img src="${URL.createObjectURL(f)}" alt="إثبات التحويل">
      <div style="font-size:11.5px;color:var(--accent);margin-top:8px;font-weight:600">
        ${esc(f.name.slice(0,30))} — اضغط للتغيير</div>`;
  };

  const calc=()=>{
    const a=parseFloat($('#cA').value),box=$('#cQ');
    if(!box)return;
    if(!(a>0)){box.innerHTML='';return;}
    box.innerHTML=`<div class="quote">
      <div class="qrow"><span class="k">المبلغ المحوّل</span>
        <span class="num">${a.toLocaleString('en-US')} ${unit}</span></div>
      ${crypto_?'':`<div class="qrow"><span class="k">سعر الصرف</span>
        <span class="num">${r} د.ل</span></div>`}
      <div class="qrow tot"><span>سيُضاف لمحفظتك</span>
        <span class="num">${usd(a/(crypto_?1:r))}</span></div></div>`;
  };
  $('#cA').oninput=calc;

  $('#cG').onclick=async()=>{
    const amt=parseFloat($('#cA').value);
    if(!(amt>0))return toast('اكتب المبلغ الذي حوّلته','bad');
    const phone=auto?$('#cP').value.trim():'';
    if(auto&&phone.replace(/\D/g,'').length<9)return toast('اكتب رقمك كاملاً','bad');
    if(!auto&&!proof)return toast('أرفق صورة إثبات التحويل','bad');

    const btn=$('#cG');
    btn.disabled=true;
    btn.innerHTML='<span class="sk" style="width:84px;height:14px;display:inline-block"></span>';
    try{
      let proofUrl='';
      if(!auto&&proof)proofUrl=await compressProof(proof);
      const res=auto
        ? await api('/api/wallet/claim',{phone,amount_lyd:amt,method:k})
        : await manualDeposit(k,amt,proofUrl);
      closeSheet();
      resultSheet(auto&&!!res.matched,amt/(crypto_?1:r),auto);
      render();
    }catch(e){
      toast(e.message,'bad');
      btn.disabled=false;btn.textContent='تأكيد التحويل';
    }
  };
}

/* ── USDT: فاتورة بمبلغ فريد وتحقق فوري من الشبكة ── */
function usdtSheet(k){
  const m=(S.config.methods||{})[k]||{};
  const mn=m.min||5, mx=m.max||1000;

  sheet(`
    <div class="mhead">
      <button class="ibtn" id="mBack" aria-label="رجوع">
        ${svg('<path d="M9 6l6 6-6 6"/>',2.2)}</button>
      <div style="display:flex;align-items:center;gap:11px;min-width:0">
        <span class="mlogo sm">${methodLogo('usdt',m.logo)}</span>
        <div><div class="h2" style="font-size:15px">${esc(m.label||'USDT')}</div>
          <div class="mfoot auto">يُضاف الرصيد فور تأكيد الشبكة</div></div>
      </div>
    </div>

    <div class="note">
      حوّل على شبكة <strong>TRC20</strong> فقط. أي شبكة أخرى تعني ضياع المبلغ.
    </div>

    <label class="lbl">المبلغ بالدولار — من ${mn} إلى ${mx}</label>
    <input class="inp num" id="uA" type="number" inputmode="decimal"
           step="0.01" min="${mn}" max="${mx}" placeholder="10">
    <p class="sub" style="font-size:12px;margin-top:7px">
      سنضيف كسورًا بسيطة لتمييز تحويلك — وتُحتسب كاملة في محفظتك.</p>

    <button class="btn wide" id="uGo" style="margin-top:18px">إنشاء فاتورة</button>
    <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">إلغاء</button>`);

  $('#mBack').onclick=()=>depositSheet();

  $('#uGo').onclick=async()=>{
    const a=parseFloat($('#uA').value);
    if(!(a>=mn&&a<=mx))return toast(`المبلغ بين ${mn} و ${mx}`,'bad');
    const b=$('#uGo');
    b.disabled=true;
    b.innerHTML='<span class="sk" style="width:80px;height:14px;display:inline-block"></span>';
    try{
      const r=await api('/api/wallet/usdt/invoice',{amount_usd:a});
      invoiceSheet(r.invoice);
    }catch(e){
      toast(e.message,'bad');
      b.disabled=false;b.textContent='إنشاء فاتورة';
    }
  };
}

function invoiceSheet(inv){
  clearInterval(_invTimer);
  clearInterval(_invPoll);
  try{ localStorage.setItem('kardo_inv', JSON.stringify(inv)); }catch{}

  sheet(`
    <div style="text-align:center;margin-bottom:16px">
      <div class="eyebrow">فاتورة ${esc(inv.id.slice(-8))}</div>
      <div id="invClock" class="num"
           style="font-size:13px;color:var(--warn);margin-top:7px"></div>
    </div>

    <button class="cprow big" id="cpAmt">
      <div style="min-width:0;text-align:start">
        <div class="payk">المبلغ — انسخه ولا تكتبه</div>
        <div class="num" dir="ltr"
             style="font-size:30px;font-weight:600;letter-spacing:-.03em;
                    line-height:1.15;margin-top:2px">${inv.pay_amount}</div>
        <div class="sub" style="font-size:11.5px;margin-top:3px">USDT</div>
      </div>
      <span class="cpico">${svg(I.copy,2)}</span>
    </button>

    <button class="cprow" id="cpAdr" style="margin-top:9px">
      <div style="min-width:0;text-align:start">
        <div class="payk">عنوان الاستقبال</div>
        <div class="payv mono" dir="ltr" style="font-size:12px">${esc(inv.address)}</div>
      </div>
      <span class="cpico">${svg(I.copy,2)}</span>
    </button>

    <div class="paybox" style="margin-top:9px">
      <div class="payrow">
        <div><div class="payk">الشبكة</div>
          <div class="payv">TRC20 (Tron)</div></div>
        <span class="chip ok">مطلوبة</span>
      </div>
    </div>

    <div class="note" style="font-size:12.5px">
      انسخ المبلغ كما هو — الكسور تميّز تحويلك وتُضاف لرصيدك كاملة.
    </div>

    <div id="invMsg"></div>
    <div id="invAuto" class="autochk">
      <span class="dot"></span> نتابع الشبكة تلقائيًا…
    </div>
    <button class="btn wide" id="uChk" style="margin-top:10px">تحققت من التحويل</button>
    <button class="btn line wide" style="margin-top:9px" onclick="closeInvoice()">إغلاق</button>`);

  const done = r=>{
    clearInterval(_invTimer); clearInterval(_invPoll);
    try{ localStorage.removeItem('kardo_inv'); }catch{}
    closeSheet();
    resultSheet(true, r.credited||inv.amount_usd);
    render();
  };

  $('#cpAmt').onclick=()=>copy(String(inv.pay_amount),'المبلغ');
  $('#cpAdr').onclick=()=>copy(inv.address,'العنوان');

  const tick=()=>{
    const left=inv.expires_ms-Date.now();
    const el=$('#invClock');
    if(!el){clearInterval(_invTimer);return;}
    if(left<=0){
      el.textContent='انتهت المهلة';
      el.style.color='var(--danger)';
      const b=$('#uChk'); if(b){b.disabled=true;b.textContent='انتهت المهلة';}
      const au=$('#invAuto'); if(au)au.style.display='none';
      clearInterval(_invTimer); clearInterval(_invPoll);
      try{ localStorage.removeItem('kardo_inv'); }catch{}
      return;
    }
    const mm=String(Math.floor(left/60000)).padStart(2,'0');
    const ss=String(Math.floor(left%60000/1000)).padStart(2,'0');
    el.textContent=`تنتهي خلال ${mm}:${ss}`;
  };
  tick();
  _invTimer=setInterval(tick,1000);

  // ── متابعة تلقائية: العميل لا يضغط شيئًا ──
  let polling=false;
  const poll=async()=>{
    if(polling||!$('#uChk'))return;
    polling=true;
    try{
      const r=await api('/api/wallet/usdt/verify',{invoice_id:inv.id});
      if(r.paid)return done(r);
    }catch{ /* تجاهل — المحاولة القادمة */ }
    polling=false;
  };
  _invPoll=setInterval(poll,15000);

  $('#uChk').onclick=async()=>{
    const b=$('#uChk'),msg=$('#invMsg');
    b.disabled=true;
    b.innerHTML='<span class="sk" style="width:90px;height:14px;display:inline-block"></span>';
    msg.innerHTML='';
    try{
      const r=await api('/api/wallet/usdt/verify',{invoice_id:inv.id});
      if(r.paid)return done(r);
      msg.innerHTML=`<div class="note" style="margin-top:14px">
        ${r.duplicate
          ? 'هذا التحويل مُستخدم بالفعل.'
          : 'لم يصل التحويل بعد. الشبكة تحتاج دقيقة تقريبًا — سنتابع تلقائيًا.'}</div>`;
    }catch(e){
      msg.innerHTML=`<div class="note" style="margin-top:14px">${esc(e.message)}</div>`;
    }
    b.disabled=false;b.textContent='تحققت من التحويل';
  };
}

/* يستعيد فاتورة لم تكتمل عند فتح الموقع */
function resumeInvoice(){
  let inv=null;
  try{ inv=JSON.parse(localStorage.getItem('kardo_inv')||'null'); }catch{}
  if(!inv||!inv.id)return;
  if(Date.now()>=inv.expires_ms){
    try{ localStorage.removeItem('kardo_inv'); }catch{}
    return;
  }
  invoiceSheet(inv);
}

window.closeInvoice=()=>{clearInterval(_invTimer);clearInterval(_invPoll);closeSheet();};

/**
 * يضغط الإيصال في المتصفح ويُعيده نصًا مضمّنًا.
 * السبب: تخزين Firebase يتطلب خطة مدفوعة، وصورة الإيصال
 * بعد الضغط تبقى تحت 100 كيلوبايت فتُحفظ داخل المستند نفسه.
 */
function compressProof(file, maxW = 900, quality = 0.55){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onerror = ()=> reject(new Error('تعذّرت قراءة الصورة'));
    reader.onload = ()=>{
      const img = new Image();
      img.onerror = ()=> reject(new Error('الملف ليس صورة صالحة'));
      img.onload = ()=>{
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const cx = cv.getContext('2d');
        cx.fillStyle = '#fff';
        cx.fillRect(0, 0, w, h);
        cx.drawImage(img, 0, 0, w, h);

        // ننزل بالجودة تدريجيًا حتى يصبح الحجم آمنًا
        let q = quality, out = cv.toDataURL('image/jpeg', q);
        while(out.length > 700000 && q > 0.2){
          q -= 0.1;
          out = cv.toDataURL('image/jpeg', q);
        }
        if(out.length > 900000)
          return reject(new Error('الصورة كبيرة جدًا — جرّب لقطة أصغر'));
        resolve(out);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function manualDeposit(method,amountLyd,proofUrl){
  const M=S.config.methods||{};
  const r=(M[method]&&M[method].rate)||1;
  await addDoc(collection(db,'wallet_deposits'),{
    uid:S.user.uid,
    amount_usd:Math.round((amountLyd/r)*100)/100,
    amount_lyd:amountLyd,
    method:(M[method]&&M[method].label)||method,
    proof_url:proofUrl||'',note:'',status:'pending',
    created_at:new Date().toISOString()});
  return {matched:false};
}

function resultSheet(matched,amount,auto=true){
  if(!auto)return sheet(`
    <div style="text-align:center;margin-bottom:22px">
      <div style="width:62px;height:62px;border-radius:19px;margin:0 auto 15px;
           display:grid;place-items:center;background:rgba(224,160,48,.14);color:var(--warn)">
        ${svg(I.clock,2.2).replace('<svg','<svg data-lg')}</div>
      <div class="h2">وصل إيصالك</div>
      <p class="sub" style="margin-top:5px">
        سنراجعه ونضيف ${usd(amount)} إلى محفظتك. تتابع الحالة من صفحة المحفظة.</p>
    </div>
    <button class="btn wide" onclick="closeSheet();go('wallet')">متابعة الطلب</button>
    <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">حسنًا</button>`);
  return _resultAuto(matched,amount);
}

function _resultAuto(matched,amount){
  sheet(`
    <div style="text-align:center;margin-bottom:22px">
      <div style="width:62px;height:62px;border-radius:19px;margin:0 auto 15px;
           display:grid;place-items:center;
           background:${matched?'var(--accent-soft)':'rgba(224,160,48,.14)'};
           color:${matched?'var(--accent)':'var(--warn)'}">
        ${svg(matched?I.check:I.clock,2.2).replace('<svg','<svg data-lg')}</div>
      <div class="h2">${matched?'أُضيف الرصيد':'طلبك قيد الانتظار'}</div>
      <p class="sub" style="margin-top:5px">
        ${matched?'أُضيف '+usd(amount)+' إلى محفظتك.'
                 :'لم تصل رسالة التحويل بعد. سيُضاف '+usd(amount)+' تلقائيًا فور وصولها.'}</p>
    </div>
    ${matched?`<button class="btn wide" onclick="closeSheet();go('issue')">إصدار بطاقة الآن</button>`:''}
    <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">حسنًا</button>`);
}

/* ─── المعاملات ─── */
function vTx(){
  const F=[['all','الكل'],['create','إصدار'],['fund','شحن'],['deposit','إيداع']];
  let rows=[...S.orders.map(o=>({...o,kind:o.type})),
    ...S.deposits.map(d=>({id:d.id,kind:'deposit',status:d.status,
      amount:d.amount_usd,customer_price:d.amount_usd,created_at:d.created_at}))]
    .sort((a,b)=>{
      const av=a.created_at?.toDate?.()||new Date(a.created_at||0);
      const bv=b.created_at?.toDate?.()||new Date(b.created_at||0);
      return bv-av;});
  if(S.txFilter!=='all')rows=rows.filter(r=>r.kind===S.txFilter);

  return `
  <div class="h1" style="margin-bottom:5px">المعاملات</div>
  <p class="sub" style="margin-bottom:18px">كل عملياتك في مكان واحد.</p>
  <div style="display:flex;gap:7px;overflow-x:auto;padding-bottom:4px;margin-bottom:16px">
    ${F.map(([k,t])=>`<button class="btn ${S.txFilter===k?'ghost':'line'} sm"
      data-filter="${k}" style="flex:none">${t}</button>`).join('')}
  </div>
  ${rows.length?`<div class="feed">${rows.map(feedRow).join('')}</div>`
   :`<div class="panel"><div class="empty">
      <div class="ico">${svg(I.list,1.6)}</div>
      <p style="font-size:13.5px">لا معاملات بهذا التصنيف.</p></div></div>`}`;
}

/* ─── كيف أستخدمها ─── */
const STEPS=[
  ['اشحن محفظتك',
   'من «المحفظة» اختر طريقة التحويل. ليبيانا والمدار وUSDT تصل خلال ثوانٍ، '
   +'والتحويل المصرفي يحتاج مراجعة.'],
  ['أصدر بطاقتك',
   'من «إصدار بطاقة» اكتب اسمًا لها واسم حاملها بالإنجليزية، ثم اختر المبلغ. '
   +'تصدر البطاقة فورًا.'],
  ['انسخ بياناتها',
   'افتح البطاقة واضغط «عرض بيانات البطاقة». انسخ الرقم وتاريخ الانتهاء وCVV.'],
  ['ادفع في أي موقع',
   'الصق البيانات في صفحة الدفع كأي بطاقة. اسم الحامل والعنوان يمكن أن يكونا أي بيانات.'],
];
const FAQ=[
  ['البطاقة مرفوضة، ماذا أفعل؟',
   'تأكد أن رصيدها يغطي المبلغ كاملًا، وأن البطاقة غير مجمّدة. '
   +'بعض المواقع تحجز مبلغًا أكبر مؤقتًا.'],
  ['هل يمكن شحن البطاقة بعد الإصدار؟',
   'نعم، من صفحة البطاقة اضغط «شحن» وأضف ما تريد.'],
  ['ماذا لو انتهى رصيد البطاقة؟',
   'اشحنها من جديد أو أغلقها ليعود المتبقي إلى محفظتك.'],
  ['لماذا يُطلب مني مبلغ بكسور في USDT؟',
   'الكسور تميّز تحويلك عن غيره ليصلك رصيدك تلقائيًا — وتُحتسب لك كاملة.'],
];

function vHelp(){
  const sup=(S.config.texts||{}).support_url||'';
  return `
  <div class="h1" style="margin-bottom:5px">كيف أستخدم كاردو</div>
  <p class="sub" style="margin-bottom:22px">أربع خطوات من الشحن إلى الدفع.</p>

  <div style="display:grid;gap:12px;margin-bottom:26px">
    ${STEPS.map((x,i)=>`
      <div class="panel" style="display:flex;gap:14px;align-items:flex-start">
        <div style="width:30px;height:30px;border-radius:10px;flex:none;
             background:var(--accent-soft);color:var(--accent);display:grid;
             place-items:center;font-weight:700;font-size:14px"
             class="num">${i+1}</div>
        <div>
          <div style="font-weight:600;font-size:14.5px;margin-bottom:4px">${esc(x[0])}</div>
          <p class="sub" style="font-size:13px">${esc(x[1])}</p>
        </div>
      </div>`).join('')}
  </div>

  <div class="h2" style="margin-bottom:13px">أسئلة شائعة</div>
  <div class="feed">
    ${FAQ.map(f=>`
      <div class="fitem" style="align-items:flex-start;flex-direction:column;gap:5px">
        <div class="ftitle" style="white-space:normal">${esc(f[0])}</div>
        <div class="sub" style="font-size:12.5px">${esc(f[1])}</div>
      </div>`).join('')}
  </div>

  ${sup?`<a class="btn wide" style="margin-top:20px"
     href="${sup.startsWith('http')?esc(sup):'https://wa.me/'+esc(sup)}"
     target="_blank" rel="noopener">تواصل مع الدعم</a>`:''}`;
}

/* ─── كيف أستخدمها ─── */
function vGuide(){
  const steps=[
    ['أضف رصيدًا','حوّل عبر ليبيانا أو المدار أو USDT، وأكّد التحويل من صفحة المحفظة.'],
    ['أصدر بطاقة','اختر المبلغ واسم حامل البطاقة — تُصدر خلال ثوانٍ.'],
    ['اعرض بياناتها','من "بطاقاتي" اضغط البطاقة ثم "عرض بيانات البطاقة".'],
    ['ادفع بها','في أي موقع، الصق رقم البطاقة وتاريخ الانتهاء وCVV كأي بطاقة عادية.'],
  ];
  const faq=[
    ['هل تعمل في نتفليكس وسبوتيفاي؟',
     'نعم — تعمل في أي موقع يقبل الدفع الإلكتروني بالدولار.'],
    ['كم تستغرق إضافة الرصيد؟',
     'ليبيانا والمدار وUSDT فورية. التحويل المصرفي يحتاج مراجعة.'],
    ['هل يمكنني شحن بطاقة موجودة؟',
     'نعم، من صفحة البطاقة اضغط "شحن".'],
    ['ماذا لو رُفضت البطاقة في موقع ما؟',
     'تأكد من كفاية الرصيد أولًا. بعض المواقع تقيّد البطاقات الافتراضية.'],
    ['هل أستطيع إغلاق البطاقة؟',
     'نعم، ويُعاد رصيدها المتبقي إلى محفظتك بعد خصم رسوم الإغلاق.'],
  ];
  const sup=(S.config.texts||{}).support_url||'';

  return `
  <div class="h1" style="margin-bottom:5px">كيف أستخدم كاردو</div>
  <p class="sub" style="margin-bottom:22px">أربع خطوات من الصفر إلى أول عملية دفع.</p>

  <div class="feed" style="margin-bottom:26px">
    ${steps.map(([t,d],i)=>`<div class="fitem">
      <div class="fico" style="background:var(--accent-soft);color:var(--accent);
           font-weight:800">${i+1}</div>
      <div class="fmain"><div class="ftitle">${t}</div>
        <div class="fmeta" style="white-space:normal;line-height:1.6">${d}</div></div>
    </div>`).join('')}
  </div>

  <div class="h2" style="margin-bottom:13px">أسئلة شائعة</div>
  <div class="feed">
    ${faq.map(([q,a])=>`<div class="fitem" style="align-items:flex-start">
      <div class="fmain"><div class="ftitle" style="white-space:normal">${q}</div>
        <div class="fmeta" style="white-space:normal;line-height:1.65;margin-top:3px">${a}</div></div>
    </div>`).join('')}
  </div>

  ${sup?`<button class="btn line wide" style="margin-top:20px"
    onclick="window.open('${esc(sup.startsWith('http')?sup:'https://wa.me/'+sup)}','_blank')">
    تواصل مع الدعم</button>`:''}`;
}

/* ─── ادعُ صديقًا ─── */
function vInvite(){
  const r=S.config.referral||{};
  if(!r.on) return `
    <div class="h1" style="margin-bottom:18px">ادعُ صديقًا</div>
    <div class="panel"><div class="empty">
      <div class="ico">${svg(I.gift,1.6)}</div>
      <div style="font-weight:600;color:var(--text);margin-bottom:5px">غير متاح حاليًا</div>
      <p style="font-size:13px">سنفعّل نظام الدعوات قريبًا.</p></div></div>`;

  return `
  <div class="h1" style="margin-bottom:5px">ادعُ صديقًا</div>
  <p class="sub" style="margin-bottom:20px">
    شارك رمزك — تحصل على ${usd(r.inviter)} ويحصل صديقك على ${usd(r.invitee)}.</p>

  <div class="hero" style="text-align:center">
    <div class="eyebrow">رمز الدعوة</div>
    <div id="refBox" style="margin-top:10px">
      <div class="sk" style="height:40px;width:180px;margin:0 auto"></div></div>
    <p class="sub" style="font-size:12px;margin-top:14px">
      تُصرف المكافأة بعد أن ينفق صديقك ${usd(r.min_spend)}.</p>
  </div>

  <div class="panel" style="margin-top:16px">
    <div class="h2" style="font-size:14px;margin-bottom:12px">هل لديك رمز؟</div>
    <input class="inp mono" id="refIn" placeholder="ABC123" maxlength="6"
           dir="ltr" style="text-transform:uppercase;text-align:center;font-size:18px;
           letter-spacing:.2em">
    <button class="btn wide" id="refGo" style="margin-top:12px">تفعيل الرمز</button>
  </div>

  <div class="panel" style="margin-top:14px">
    <div class="metric" style="border:none;padding:0">
      <div class="v num">${n(S.profile.referrals_count)}</div>
      <div class="k">صديق انضم برمزك</div></div>
  </div>`;
}

/* ─── الإعدادات ─── */
function vSettings(){
  return `
  <div class="h1" style="margin-bottom:22px">الإعدادات</div>
  <div class="panel" style="max-width:520px;margin-bottom:14px">
    <div class="h2" style="margin-bottom:18px">الحساب</div>
    <label class="lbl">الاسم</label>
    <input class="inp" id="pN" value="${esc(S.profile.name||'')}">
    <label class="lbl" style="margin-top:14px">البريد الإلكتروني</label>
    <input class="inp" value="${esc(S.profile.email||S.user?.email||'')}" disabled
           style="opacity:.55" dir="ltr">
    <label class="lbl" style="margin-top:14px">رقم الهاتف</label>
    <input class="inp num" id="pP" value="${esc(S.profile.phone||'')}"
           placeholder="0912345678" dir="ltr" inputmode="tel">
    <p class="sub" style="font-size:12px;margin-top:7px">
      سجّل الرقم الذي تحوّل منه — يساعد على مطابقة إيداعاتك تلقائيًا.</p>
    <button class="btn" id="pS" style="margin-top:18px">حفظ التغييرات</button>
  </div>

  <div class="panel" style="max-width:520px;margin-bottom:14px">
    <div class="h2" style="margin-bottom:6px">الإشعارات</div>
    <p class="sub" style="margin-bottom:16px">
      اربط تليجرام ليصلك إشعار فور وصول رصيدك أو إصدار بطاقتك.</p>
    <div id="tgBox">
      ${S.profile.telegram_chat_id
        ? `<div class="chip ok" style="padding:7px 13px">تليجرام مربوط ✓</div>`
        : `<button class="btn line" id="tgGo">ربط تليجرام</button>`}
    </div>
  </div>

  <div class="panel" style="max-width:520px;margin-bottom:14px">
    <div class="h2" style="margin-bottom:6px">ادعُ صديقًا</div>
    <p class="sub" style="margin-bottom:16px">
      شارك رمزك — تربحان معًا عند أول عملية له.</p>
    <div id="refBox"><div class="sk" style="height:44px"></div></div>
  </div>

  <div class="panel" style="max-width:520px;margin-bottom:14px">
    <div class="h2" style="margin-bottom:6px">نشاط الحساب</div>
    <p class="sub" style="margin-bottom:14px">آخر ما جرى على حسابك.</p>
    ${S.orders.length||S.deposits.length
      ? `<div style="display:grid;gap:9px">${
          [...S.orders.slice(0,3).map(o=>({t:TYPE[o.type]||'عملية',d:o.created_at})),
           ...S.deposits.slice(0,2).map(d=>({t:'إيداع رصيد',d:d.created_at}))]
          .sort((a,b)=>{
            const av=a.d?.toDate?.()||new Date(a.d||0);
            const bv=b.d?.toDate?.()||new Date(b.d||0);
            return bv-av;})
          .slice(0,5)
          .map(x=>`<div style="display:flex;justify-content:space-between;
                gap:10px;font-size:13px;padding-bottom:8px;
                border-bottom:1px solid var(--line)">
                <span>${esc(x.t)}</span>
                <span class="fmeta">${dt(x.d)}</span></div>`).join('')}</div>`
      : `<p class="sub" style="font-size:13px">لا نشاط بعد.</p>`}
  </div>

  <div class="panel" style="max-width:520px;margin-bottom:14px">
    <div class="h2" style="margin-bottom:6px">كلمة المرور</div>
    <p class="sub" style="margin-bottom:16px">سنرسل رابط التغيير إلى بريدك.</p>
    <button class="btn line" id="pR">إرسال رابط التغيير</button>
  </div>

  <div class="panel" style="max-width:520px">
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:6px">
      ${svg(I.shield)}<div class="h2">آخر عمليات الدخول</div></div>
    <p class="sub" style="margin-bottom:14px">
      إن رأيت دخولًا لا تعرفه، غيّر كلمة مرورك فورًا.</p>
    <div id="actList">
      <div class="sk" style="height:52px;margin-bottom:8px"></div>
      <div class="sk" style="height:52px"></div></div>
  </div>`;
}

/* ─── الربط ─── */
function bind(){
  document.querySelectorAll('[data-act]').forEach(b=>
    b.onclick=()=>b.dataset.act==='deposit'?depositSheet():go(b.dataset.act));
  document.querySelectorAll('[data-card]').forEach(el=>
    el.onclick=()=>openCard(el.dataset.card));
  document.querySelectorAll('[data-filter]').forEach(b=>
    b.onclick=()=>{S.txFilter=b.dataset.filter;render();});
  document.querySelectorAll('[data-step]').forEach(b=>
    b.onclick=()=>{S.wiz.step=+b.dataset.step;render();});

  const hb=$('#heroBal');
  if(hb){hb.dataset.v=0;countTo(hb,S.profile.wallet_balance);}

  const n1=$('#wN1');
  if(n1)n1.onclick=()=>{
    const name=$('#wName').value.trim().toUpperCase();
    if(!/^[A-Z][A-Z .'-]{1,23}$/.test(name)){
      $('#wName').classList.add('bad');
      return toast('اكتب الاسم بحروف لاتينية — حرفان على الأقل','bad');
    }
    S.wiz.label=$('#wLabel').value.trim()||'بطاقتي';
    S.wiz.name=name;S.wiz.step=2;render();
  };

  document.querySelectorAll('[data-amt]').forEach(b=>
    b.onclick=()=>{
      document.querySelectorAll('[data-amt]').forEach(x=>x.classList.toggle('on',x===b));
      const cu=$('#wCustom');if(cu)cu.value='';
      fetchQuote(+b.dataset.amt);
    });
  const cu=$('#wCustom');
  if(cu)cu.oninput=e=>{
    document.querySelectorAll('[data-amt]').forEach(x=>x.classList.remove('on'));
    clearTimeout(qTimer);
    qTimer=setTimeout(()=>fetchQuote(parseFloat(e.target.value)),420);
  };
  const n2=$('#wN2');
  if(n2)n2.onclick=()=>{
    if(!S.wiz.quote)return;
    S.wiz.idem=crypto.randomUUID?crypto.randomUUID():'k'+Date.now()+Math.random();
    S.wiz.step=3;render();
  };

  const go3=$('#wGo');
  if(go3)go3.onclick=async()=>{
    if(!$('#wAgree').checked)return toast('يجب الموافقة على الشروط','bad');
    go3.disabled=true;
    go3.innerHTML='<span class="sk" style="width:84px;height:14px;display:inline-block"></span>';
    try{
      const r=await api('/api/cards/create',{
        amount:S.wiz.quote.amount,name_on_card:S.wiz.name,
        card_name:S.wiz.label,idempotency_key:S.wiz.idem});
      successSheet(r.card);
      S.wiz={step:1,amount:null,name:S.wiz.name,label:'',idem:null,quote:null};
      S.page='cards';render();
    }catch(e){
      toast(e.message,'bad');
      go3.disabled=false;go3.textContent='إصدار البطاقة';
    }
  };

  // ── الدعوة ──
  const rb=$('#refBox');
  if(rb){
    api('/api/ref/code').then(r=>{
      rb.innerHTML=`<button id="cpRef" class="mono"
        style="display:inline-flex;align-items:center;gap:11px;background:var(--accent);
               color:#04121B;padding:12px 22px;border-radius:12px;font-weight:700;
               font-size:26px;letter-spacing:.14em">
        ${svg(I.copy,2)} ${esc(r.code)}</button>`;
      $('#cpRef').onclick=()=>copy(r.code,'رمز الدعوة');
    }).catch(e=>{
      rb.innerHTML=`<div class="sub" style="font-size:13px">${esc(e.message)}</div>`;
    });
  }
  const rg=$('#refGo');
  if(rg)rg.onclick=async()=>{
    const c=$('#refIn').value.trim().toUpperCase();
    if(c.length!==6)return toast('الرمز 6 أحرف','bad');
    rg.disabled=true;
    try{
      const r=await api('/api/ref/claim',{code:c});
      toast(`فُعّل الرمز — ستحصل على ${usd(r.bonus)} بعد إنفاق ${usd(r.min_spend)}`,'ok');
      render();
    }catch(e){toast(e.message,'bad');rg.disabled=false;}
  };

  const ps=$('#pS');
  if(ps)ps.onclick=async()=>{
    const name=$('#pN').value.trim(),phone=$('#pP').value.trim();
    if(name.length<2)return toast('الاسم قصير جدًا','bad');
    ps.disabled=true;
    try{
      await setDoc(doc(db,'users',S.user.uid),
        {name,phone,phone_key:phoneKey(phone)},{merge:true});
      toast('حُفظت التغييرات','ok');render();
    }catch(e){toast('تعذّر الحفظ','bad');ps.disabled=false;}
  };
  // ── ربط تليجرام ──
  const tg=$('#tgGo');
  if(tg)tg.onclick=async()=>{
    tg.disabled=true;
    try{
      const r=await api('/api/telegram/code');
      const link=r.bot?`https://t.me/${r.bot}?start=${r.code}`:'';
      sheet(`
        <div class="h2" style="margin-bottom:6px">ربط تليجرام</div>
        <p class="sub" style="margin-bottom:16px">
          افتح البوت وأرسل الرمز — أو اضغط الزر ليُرسل تلقائيًا.</p>
        <div class="paybox">
          <div class="payrow">
            <div><div class="payk">رمز الربط</div>
              <div class="payv mono" dir="ltr">${esc(r.code)}</div></div>
            <button class="ibtn" id="cpTg">${svg(I.copy)}</button>
          </div>
        </div>
        <p class="sub" style="font-size:12px">الرمز صالح 15 دقيقة.</p>
        ${link?`<a class="btn wide" style="margin-top:16px" href="${esc(link)}"
           target="_blank" rel="noopener">فتح البوت</a>`:''}
        <button class="btn line wide" style="margin-top:9px"
          onclick="closeSheet();render()">تم</button>`);
      $('#cpTg').onclick=()=>copy(r.code,'رمز الربط');
    }catch(e){toast(e.message,'bad');}
    tg.disabled=false;
  };

  const al=$('#actList');
  if(al){
    const q=query(collection(db,'activity'),
      where('uid','==',S.user.uid),orderBy('created_at','desc'),limit(6));
    onSnapshot(q,snap=>{
      const rows=snap.docs.map(d=>d.data());
      al.innerHTML=rows.length?rows.map((a,i)=>`
        <div style="display:flex;justify-content:space-between;gap:11px;padding:11px 0;
             ${i<rows.length-1?'border-bottom:1px solid var(--line)':''}">
          <div style="min-width:0">
            <div style="font-size:13.5px;font-weight:600">
              ${i===0?'الجلسة الحالية':'تسجيل دخول'}</div>
            <div class="fmeta">${dt(a.created_at)}${
              a.city||a.country?' · '+esc([a.city,a.country].filter(Boolean).join(', ')):''}</div>
          </div>
          ${i===0?'<span class="chip ok">نشطة</span>':''}
        </div>`).join('')
        :`<p class="sub" style="font-size:13px">لا سجلات بعد.</p>`;
    },()=>{al.innerHTML='<p class="sub" style="font-size:13px">تعذّر تحميل السجل.</p>';});
  }

  const pr=$('#pR');
  if(pr)pr.onclick=async()=>{
    const em=S.profile.email||S.user?.email;
    if(!em)return toast('لا يوجد بريد مسجّل','bad');
    pr.disabled=true;
    try{await sendPasswordResetEmail(auth,em);toast('أُرسل رابط التغيير إلى '+em,'ok');}
    catch{toast('تعذّر الإرسال','bad');pr.disabled=false;}
  };
}

function successSheet(card){
  sheet(`
    <div style="text-align:center;margin-bottom:22px">
      <div style="width:62px;height:62px;border-radius:19px;margin:0 auto 15px;
           display:grid;place-items:center;background:var(--accent-soft);color:var(--accent)">
        ${svg(I.check,2.4).replace('<svg','<svg data-lg')}</div>
      <div class="h2">صدرت البطاقة</div>
      <p class="sub" style="margin-top:5px">بطاقة تنتهي بـ ${esc(card.last4)} جاهزة للاستخدام.</p>
    </div>
    <button class="btn wide" onclick="closeSheet();openCard('${esc(card.card_id)}')">
      عرض بيانات البطاقة</button>
    <button class="btn line wide" style="margin-top:9px" onclick="closeSheet()">لاحقًا</button>`);
}
