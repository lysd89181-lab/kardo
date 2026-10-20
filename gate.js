/* gate.js — وضع الصيانة: يُحمَّل قبل كل شيء.
   الزوار يرون شاشة الصيانة، والإدارة (بعد دخولها لوحة admin.html) ترى الموقع كاملًا للمعاينة.
   الحماية الحقيقية في الخادم: كل عمليات غير الإدارة مرفوضة أثناء الصيانة. */
/* تثبيت التطبيق: نلتقط طلب التثبيت مبكرًا (قبل تحميل app.js) */
(function () {
  window.__bip = null;
  addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); window.__bip = e; try { document.dispatchEvent(new Event('kardo-bip')); } catch (x) {} });
  addEventListener('appinstalled', function () { window.__bip = null; try { localStorage.setItem('kardo_installed', '1'); } catch (x) {} });
})();
/* v60 — معرّف الجهاز + شاشة الحظر */
(function () {
  var API = 'https://kardo.sdkhyrallh08.workers.dev';
  var ok = function (v) { return /^[A-Za-z0-9_-]{16,64}$/.test(String(v || '')); };
  var did = '';
  try { did = localStorage.getItem('kardo_did') || ''; } catch (e) {}
  if (!ok(did)) { var m = /(?:^|;\s*)kd=([A-Za-z0-9_-]{16,64})/.exec(document.cookie || ''); if (m) did = m[1]; }
  if (!ok(did)) {
    var a = new Uint8Array(18); try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 18; i++) a[i] = Math.random() * 256 | 0; }
    did = btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  try { localStorage.setItem('kardo_did', did); } catch (e) {}
  try { document.cookie = 'kd=' + did + ';max-age=315360000;path=/;SameSite=Lax;Secure'; } catch (e) {}
  // بصمة المتصفح (إشارة ضعيفة — للعرض في الإدارة بس)
  function h(str) { var h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995; for (var i = 0; i < str.length; i++) { var c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822507); } return ((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16) + (Math.imul(h1, h2) >>> 0).toString(16)).padEnd(24, '0'); }
  var fp = '';
  try {
    var cv = ''; try { var c = document.createElement('canvas'); c.width = 200; c.height = 40; var x = c.getContext('2d'); x.textBaseline = 'top'; x.font = '16px Arial'; x.fillStyle = '#f60'; x.fillRect(0, 0, 90, 20); x.fillStyle = '#069'; x.fillText('كاردو Kardo ✓ 123', 2, 4); cv = c.toDataURL(); } catch (e) {}
    var n = navigator, sc = screen;
    fp = h([n.userAgent, n.language, (n.languages || []).join(','), n.platform, n.hardwareConcurrency, n.deviceMemory, sc.width + 'x' + sc.height + 'x' + sc.colorDepth, window.devicePixelRatio,
      (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone, n.maxTouchPoints, cv].join('|'));
  } catch (e) {}
  window.kardoDev = { did: did, fp: fp, headers: function () { return { 'x-kd': did, 'x-kf': fp }; } };

  function esc(t) { return String(t || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function wa(p) { p = String(p || '').replace(/[^\d]/g, ''); if (!p) return ''; if (p.charAt(0) === '0') p = '218' + p.slice(1); return 'https://wa.me/' + p; }
  function paint(info) {
    info = info || {};
    var go = function () {
      if (document.getElementById('kban')) document.getElementById('kban').remove();
      var link = wa(info.whatsapp);
      var d = document.createElement('div'); d.id = 'kban'; d.setAttribute('dir', 'rtl');
      d.innerHTML = '<div class="kb-box"><div class="kb-ic">⛔</div><h1>حسابك محظور من المطور</h1>' +
        '<p>تم إيقاف الوصول لهذا الحساب على كاردو.' + (info.reason ? '<br><span class="kb-r">السبب: ' + esc(info.reason) + '</span>' : '') + '</p>' +
        '<p class="kb-s">لو تعتقد إن فيه غلط، تواصل مع الدعم:</p>' +
        (link ? '<a class="kb-btn" href="' + link + '" target="_blank" rel="noopener">تواصل مع الدعم عبر واتساب</a>' : '') +
        (info.email ? '<a class="kb-btn2" href="mailto:' + esc(info.email) + '">' + esc(info.email) + '</a>' : '') + '</div>';
      var st = document.createElement('style');
      st.textContent = '#kban{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px;background:#0E0B08;color:#F3E7D3;font-family:"IBM Plex Sans Arabic",Tajawal,system-ui,sans-serif;text-align:center;visibility:visible!important}' +
        '#kban .kb-box{max-width:420px}#kban .kb-ic{font-size:54px;margin-bottom:10px}#kban h1{font-size:23px;color:#FF8A7A;margin:0 0 12px}' +
        '#kban p{font-size:15px;line-height:1.9;color:#CDBFA8;margin:0 0 14px}#kban .kb-r{color:#F6C26B}#kban .kb-s{font-size:13px;color:#8F7F68}' +
        '#kban .kb-btn{display:block;background:#25D366;color:#06260F;font-weight:700;padding:14px;border-radius:14px;text-decoration:none;margin-bottom:10px}' +
        '#kban .kb-btn2{display:block;color:#CDBFA8;font-size:13px;text-decoration:none;direction:ltr}html.kbanned,html.kbanned body{overflow:hidden!important;visibility:visible!important}';
      document.head.appendChild(st);
      document.documentElement.classList.add('kbanned');
      (document.body || document.documentElement).appendChild(d);
    };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
    if (!info.whatsapp && !info._f) {
      try { fetch(API + '/api/status', { credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (s) { var c = (s && s.contact) || {}; if (c.whatsapp || c.email) { info.whatsapp = c.whatsapp; info.email = info.email || c.email; info._f = 1; try { localStorage.setItem('kardo_ban', JSON.stringify(info)); } catch (e) {} go(); } }).catch(function () {}); } catch (e) {}
    }
  }
  window.kardoBanned = function (info) { try { localStorage.setItem('kardo_ban', JSON.stringify(info || {})); } catch (e) {} paint(info); };
  var saved = null; try { saved = JSON.parse(localStorage.getItem('kardo_ban') || 'null'); } catch (e) {}
  if (saved) {
    paint(saved);
    // لو انفك الحظر، نشيل الشاشة
    try { fetch(API + '/api/ban/check?d=' + encodeURIComponent(did) + (saved.uid ? '&u=' + encodeURIComponent(saved.uid) : ''), { credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (r) { if (r && r.success && r.banned === false) { try { localStorage.removeItem('kardo_ban'); } catch (e) {} var last = 0; try { last = +sessionStorage.getItem('kban_rl') || 0; sessionStorage.setItem('kban_rl', Date.now()); } catch (e) {} if (Date.now() - last > 60000) location.reload(); else { var k = document.getElementById('kban'); if (k) k.remove(); document.documentElement.classList.remove('kbanned'); } } }).catch(function () {}); } catch (e) {}
  }
})();
/* المظهر: نهاري/ليلي (تلقائي حسب الهاتف أو اختيار المستخدم) */
(function () {
  function apply() {
    var t = 'auto'; try { t = localStorage.getItem('kardo_theme') || 'auto'; } catch (e) {}
    var dark = t === 'dark' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', dark ? '#101314' : '#EDEFEE');
  }
  window.kardoTheme = apply; apply();
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply); } catch (e) {}
  document.addEventListener('DOMContentLoaded', apply);
})();
(function () {
  var API = 'https://kardo.sdkhyrallh08.workers.dev';
  var staff = false;
  try { staff = localStorage.getItem('kardo_staff') === '1'; } catch (e) {}
  if (staff) return;
  var de = document.documentElement;
  de.classList.add('mchk');
  var st = document.createElement('style');
  st.textContent = 'html.mchk body{visibility:hidden}';
  (document.head || de).appendChild(st);
  var settled = false;
  function reveal() { if (settled) return; settled = true; de.classList.remove('mchk'); }
  setTimeout(reveal, 3500);
  function esc(t) { return String(t || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function show(msg) {
    settled = true;
    var paint = function () {
      document.title = 'كاردو — قيد الصيانة';
      document.body.innerHTML =
        '<main class="kmaint" dir="rtl">' +
        '<div class="kmaint-band" aria-hidden="true"></div>' +
        '<div class="kmaint-box">' +
        '<img class="kmaint-logo" src="./kardo-logo.png" alt="كاردو KARDO">' +
        '<h1>نجهّز لكم كاردو بحلّة جديدة</h1>' +
        '<p>' + esc(msg || 'الموقع قيد الصيانة حاليًا. أرصدتكم وطلباتكم محفوظة بالكامل — نعود قريبًا إن شاء الله.') + '</p>' +
        '<div class="kmaint-dots" aria-hidden="true"><i></i><i></i><i></i></div>' +
        '<a class="kmaint-link" href="https://kardo.ly">kardo.ly</a>' +
        '</div>' +
        '<div class="kmaint-band" aria-hidden="true"></div>' +
        '</main>';
      var css = document.createElement('style');
      css.textContent =
        'html,body{margin:0;min-height:100%;background:#0E0B08!important;visibility:visible!important}' +
        '.kmaint{min-height:100vh;display:flex;flex-direction:column;justify-content:space-between;color:#F3E7D3;font-family:"IBM Plex Sans Arabic",Tajawal,system-ui,sans-serif;text-align:center;' +
        'background:radial-gradient(120% 70% at 50% 0%,rgba(232,150,46,.16),transparent 60%),radial-gradient(90% 50% at 50% 115%,rgba(166,92,30,.28),transparent 70%),#0E0B08}' +
        '.kmaint-band{height:14px;opacity:.55;background:linear-gradient(135deg,#E8962E 25%,transparent 25%) -7px 0/14px 14px,linear-gradient(225deg,#E8962E 25%,transparent 25%) -7px 0/14px 14px,linear-gradient(315deg,#E8962E 25%,transparent 25%) 0 0/14px 14px,linear-gradient(45deg,#E8962E 25%,transparent 25%) 0 0/14px 14px}' +
        '.kmaint-box{padding:34px 22px;max-width:440px;margin:0 auto}' +
        '.kmaint-logo{display:block;margin:0 auto 22px;width:150px;height:auto;filter:drop-shadow(0 10px 30px rgba(232,150,46,.25))}' +
        '.kmaint h1{font-family:"Reem Kufi",Tajawal,sans-serif;font-size:24px;margin:0 0 12px;color:#F6C26B}' +
        '.kmaint p{font-size:15px;line-height:1.95;color:#CDBFA8;margin:0 0 22px}' +
        '.kmaint-dots{display:flex;gap:8px;justify-content:center;margin-bottom:22px}' +
        '.kmaint-dots i{width:8px;height:8px;border-radius:50%;background:#E8962E;animation:kmd 1.2s ease-in-out infinite}' +
        '.kmaint-dots i:nth-child(2){animation-delay:.15s}.kmaint-dots i:nth-child(3){animation-delay:.3s}' +
        '@keyframes kmd{0%,100%{opacity:.25;transform:translateY(0)}50%{opacity:1;transform:translateY(-5px)}}' +
        '.kmaint-link{color:#8F7F68;font-size:12px;letter-spacing:.12em;text-decoration:none;font-family:ui-monospace,monospace}';
      document.head.appendChild(css);
      de.classList.remove('mchk');
    };
    if (document.body) paint(); else document.addEventListener('DOMContentLoaded', paint);
  }
  try {
    fetch(API + '/api/status', { credentials: 'omit' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.site_maint === true) show(d.site_maint_msg); else reveal(); })
      .catch(reveal);
  } catch (e) { reveal(); }
})();
