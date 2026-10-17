/* gate.js — وضع الصيانة: يُحمَّل قبل كل شيء.
   الزوار يرون شاشة الصيانة، والإدارة (بعد دخولها لوحة admin.html) ترى الموقع كاملًا للمعاينة.
   الحماية الحقيقية في الخادم: كل عمليات غير الإدارة مرفوضة أثناء الصيانة. */
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
