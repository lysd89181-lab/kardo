import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, updateProfile, sendPasswordResetEmail,
  setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

setPersistence(auth, browserLocalPersistence).catch(() => {});

/* ═══ Helpers ═══ */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function phoneKey(raw) {
  let p = String(raw || '').replace(/\D/g, '');
  if (p.startsWith('00218')) p = p.slice(5);
  else if (p.startsWith('218')) p = p.slice(3);
  if (p.startsWith('0')) p = p.slice(1);
  return p.slice(-9);
}

function showMsg(text, kind = 'error') {
  const m = $('#msg');
  m.textContent = text;
  m.className = 'auth-msg show ' + kind;
}

function clearMsg() {
  $('#msg').className = 'auth-msg';
}

function setLoading(btn, on, label) {
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle('loading', on);
  if (label) btn.textContent = label;
}

/* ═══ Particles ═══ */
function createParticles() {
  const container = $('#particles');
  if (!container) return;
  const count = window.innerWidth < 640 ? 25 : 50;

  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left = Math.random() * 100 + '%';
    p.style.top = (100 + Math.random() * 20) + '%';
    p.style.animationDuration = (10 + Math.random() * 15) + 's';
    p.style.animationDelay = (Math.random() * 10) + 's';
    p.style.opacity = 0;
    const size = 1 + Math.random() * 2.5;
    p.style.width = size + 'px';
    p.style.height = size + 'px';
    container.appendChild(p);
  }
}
createParticles();

/* ═══ Card 3D Tilt (follows mouse) ═══ */
const cardTilt = $('#cardTilt');
const loginCard = document.querySelector('.login-card');

if (cardTilt && loginCard && window.matchMedia('(min-width: 1024px)').matches) {
  let raf = null;
  let targetX = 0, targetY = 0;
  let currentX = 0, currentY = 0;

  const onMove = (e) => {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const dx = (e.clientX - cx) / cx;
    const dy = (e.clientY - cy) / cy;
    targetX = dy * -3;   // rotateX
    targetY = dx * 3;    // rotateY

    if (!raf) raf = requestAnimationFrame(tick);
  };

  const tick = () => {
    currentX += (targetX - currentX) * 0.08;
    currentY += (targetY - currentY) * 0.08;
    loginCard.style.transform =
      `perspective(1000px) rotateX(${currentX}deg) rotateY(${currentY}deg)`;

    if (Math.abs(targetX - currentX) > 0.01 ||
        Math.abs(targetY - currentY) > 0.01) {
      raf = requestAnimationFrame(tick);
    } else {
      raf = null;
    }
  };

  window.addEventListener('mousemove', onMove, { passive: true });

  // Reset when leaving window
  window.addEventListener('mouseleave', () => {
    targetX = 0;
    targetY = 0;
    if (!raf) raf = requestAnimationFrame(tick);
  });
}

/* ═══ View Switch ═══ */
function showView(name) {
  $('#formLogin').style.display = name === 'login' ? 'block' : 'none';
  $('#formRegister').style.display = name === 'register' ? 'block' : 'none';
  $('#formReset').style.display = name === 'reset' ? 'block' : 'none';

  $('#tabLogin').classList.toggle('active', name === 'login');
  $('#tabRegister').classList.toggle('active', name === 'register');

  const sw = $('#switchText');
  if (name === 'login') {
    sw.innerHTML = 'ليس لديك حساب؟ <button type="button" id="switchBtn">أنشئ حساباً</button>';
  } else if (name === 'register') {
    sw.innerHTML = 'لديك حساب بالفعل؟ <button type="button" id="switchBtn">تسجيل الدخول</button>';
  } else {
    sw.innerHTML = '';
  }

  const sb = $('#switchBtn');
  if (sb) sb.onclick = () => showView(name === 'login' ? 'register' : 'login');

  clearMsg();
}

/* ═══ Password Toggle ═══ */
const eyeOpen = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7"/><circle cx="12" cy="12" r="3"/>';
const eyeOff = '<path d="M17.9 17.9A10.6 10.6 0 0 1 12 19c-6.4 0-10-7-10-7a18 18 0 0 1 4.1-5M9.9 4.2A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a18 18 0 0 1-2.2 3.2M3 3l18 18"/>';

$$('[data-eye]').forEach(btn => {
  btn.onclick = () => {
    const input = document.getElementById(btn.dataset.eye);
    if (!input) return;
    const isPass = input.type === 'password';
    input.type = isPass ? 'text' : 'password';
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${isPass ? eyeOff : eyeOpen}</svg>`;
  };
});

/* ═══ Tabs ═══ */
$('#tabLogin').onclick = () => showView('login');
$('#tabRegister').onclick = () => showView('register');

/* ═══ Forgot ═══ */
$('#forgotBtn').onclick = () => {
  const email = $('#liEmail').value.trim();
  if (email) $('#rsEmail').value = email;
  showView('reset');
};

$('#rsBack').onclick = () => showView('login');

/* ═══ Firebase Errors ═══ */
function fbMsg(code) {
  const map = {
    'auth/invalid-email': 'البريد الإلكتروني غير صحيح',
    'auth/user-disabled': 'هذا الحساب معطّل',
    'auth/user-not-found': 'البريد أو كلمة المرور غير صحيحة',
    'auth/wrong-password': 'البريد أو كلمة المرور غير صحيحة',
    'auth/invalid-credential': 'البريد أو كلمة المرور غير صحيحة',
    'auth/email-already-in-use': 'هذا البريد مُسجّل مسبقًا',
    'auth/weak-password': 'كلمة المرور ضعيفة — 8 أحرف على الأقل',
    'auth/too-many-requests': 'محاولات كثيرة — حاول بعد قليل',
    'auth/network-request-failed': 'تعذّر الاتصال — تحقق من الإنترنت',
    'auth/operation-not-allowed': 'هذه العملية غير مسموح بها',
    'auth/unauthorized-domain': 'هذا النطاق غير مُصرّح به',
  };
  return map[code] || 'تعذّر إتمام العملية، حاول مرة أخرى';
}

/* ═══ LOGIN ═══ */
$('#formLogin').onsubmit = async (e) => {
  e.preventDefault();
  clearMsg();

  const email = $('#liEmail').value.trim();
  const pass = $('#liPass').value;
  const btn = $('#liSubmit');

  if (!email || !pass) return showMsg('أكمل جميع الحقول');

  setLoading(btn, true);
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    // onAuthStateChanged سيتولى التوجيه
  } catch (err) {
    showMsg(fbMsg(err.code));
    setLoading(btn, false, 'تسجيل الدخول');
  }
};

/* ═══ REGISTER ═══ */
$('#formRegister').onsubmit = async (e) => {
  e.preventDefault();
  clearMsg();

  const name = $('#rgName').value.trim();
  const email = $('#rgEmail').value.trim();
  const phone = $('#rgPhone').value.trim();
  const pass = $('#rgPass').value;
  const btn = $('#rgSubmit');

  if (!name || name.length < 2) return showMsg('الاسم قصير جدًا');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showMsg('البريد الإلكتروني غير صحيح');
  if (phoneKey(phone).length !== 9) return showMsg('رقم الهاتف يجب أن يكون 9 أرقام');
  if (pass.length < 8) return showMsg('كلمة المرور 8 أحرف على الأقل');

  setLoading(btn, true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });

    try {
      await setDoc(doc(db, 'users', cred.user.uid), {
        name,
        email,
        phone,
        phone_key: phoneKey(phone),
        wallet_balance: 0,
        total_spent: 0,
        cards_count: 0,
        banned: false,
        created_at: new Date().toISOString(),
      }, { merge: true });
    } catch (docErr) {
      console.warn('user doc creation failed:', docErr.code);
    }

    showMsg('تم إنشاء حسابك — جاري التحويل...', 'success');
    // onAuthStateChanged سيتولى التوجيه
  } catch (err) {
    showMsg(fbMsg(err.code));
    setLoading(btn, false, 'إنشاء الحساب');
  }
};

/* ═══ RESET ═══ */
$('#formReset').onsubmit = async (e) => {
  e.preventDefault();
  clearMsg();

  const email = $('#rsEmail').value.trim();
  const btn = $('#rsSubmit');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return showMsg('أدخل بريدًا صحيحًا');
  }

  setLoading(btn, true);
  try {
    await sendPasswordResetEmail(auth, email);
    showMsg('أرسلنا رابط الاستعادة إلى ' + email, 'success');
    setLoading(btn, false, 'إرسال رابط الاستعادة');
  } catch (err) {
    showMsg(fbMsg(err.code));
    setLoading(btn, false, 'إرسال رابط الاستعادة');
  }
};

/* ═══ Smart Redirect ═══ */
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  try {
    const adminSnap = await getDoc(doc(db, 'admins', user.uid));
    if (adminSnap.exists()) {
      location.replace('admin.html');
      return;
    }
  } catch (e) {
    console.warn('admin check failed:', e.code);
  }

  location.replace('index.html');
});

/* ═══ URL params ═══ */
const params = new URLSearchParams(location.search);
if (params.get('mode') === 'signup') {
  showView('register');
} else {
  showView('login');
}

document.addEventListener('click', e => {
  if (e.target.closest('[data-act="noop"]')) e.preventDefault();
});
