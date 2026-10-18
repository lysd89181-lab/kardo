/* pay.js — صفحة دفع فاتورة مشتركة (بدون تسجيل دخول). الرمز في الرابط بعد # فقط. */
(function () {
  'use strict';
  var API = 'https://kardo.sdkhyrallh08.workers.dev';
  var token = (/[#&]t=([A-Za-z0-9_-]{30,40})/.exec(location.hash) || [])[1] || '';
  var box = document.getElementById('pv');
  var timer = null, poll = null, last = null;
  var COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var USER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/></svg>';
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(m) { var t = document.getElementById('toast'); t.textContent = m; t.classList.add('on'); setTimeout(function () { t.classList.remove('on'); }, 1800); }
  function left(ms) { var s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function msg(t) { box.innerHTML = '<div class="pcard"><div class="pmsg">' + t + '</div></div>'; }
  function load(check) {
    return fetch(API + '/api/pay/view', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ t: token, check: !!check }) })
      .then(function (r) { return r.json(); });
  }
  function draw(d) {
    var v = d.invoice, isPay = v.network === 'binance_pay', amt = Number(v.pay_amount).toFixed(4);
    var open = v.status === 'awaiting' || v.status === 'cancelled';
    var up = Date.now() > v.expires_ms;
    if (v.status === 'paid') {
      box.innerHTML = '<div class="pcard" style="text-align:center"><div class="kstate ok" style="margin:6px auto 12px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>' +
        '<div class="h3" style="margin:0 0 6px">تم الدفع بنجاح ✓</div><p class="body-sm text-2">وصل الدفع وأُضيف لمحفظة ' + esc(d.owner) + '. شكرًا لك!</p>' +
        '<div class="kreceipt" style="text-align:right;margin-top:14px"><div><span>رقم الفاتورة</span><b>' + esc(v.no) + '</b></div><div><span>المدفوع</span><b dir="ltr">' + esc(amt) + ' USDT</b></div></div></div>';
      return stop();
    }
    if (!open) { msg('انتهت هذه الفاتورة.<br>اطلب من ' + esc(d.owner) + ' يبعتلك رابط جديد.'); return stop(); }
    box.innerHTML = '<div class="pfor">' + USER + '<div>أنت تدفع عن <b>' + esc(d.owner) + '</b> — المبلغ ينضاف لمحفظته في كاردو تلقائيًا.</div></div>' +
      '<div class="pcard"><div class="kinv-top"><span class="kinv-no">#' + esc(v.no) + '</span><span class="kinv-st st-w">' + (up ? 'بانتظار الدفع' : 'بانتظار الدفع · <span id="pl">' + left(v.expires_ms - Date.now()) + '</span>') + '</span></div>' +
      '<div style="text-align:center;margin:6px 0 14px"><div class="caption">' + (isPay ? 'أرسل هذا المبلغ بالضبط عبر Binance Pay' : 'حوّل هذا المبلغ بالضبط') + '</div>' +
      '<div class="kinv-big tabular">' + esc(amt) + ' <small>USDT</small></div><div class="caption">' + (isPay ? 'العملة USDT' : 'شبكة ' + esc(String(v.network_label).replace('USDT ', '')) + ' فقط') + '</div></div>' +
      (isPay ? (d.binance_pay_qr ? '<div class="kqr"><img src="' + esc(API + d.binance_pay_qr) + '" alt="QR"></div>' : '') : '<div class="kqr" id="pq"></div>') +
      '<div class="copy-box"><div class="copy-value">' + (isPay ? 'Pay ID: ' : '') + esc(v.address) + '</div><button class="copy-btn" data-c="' + esc(v.address) + '" aria-label="نسخ">' + COPY + '</button></div>' +
      '<div class="copy-box"><div class="copy-value">' + esc(amt) + '</div><button class="copy-btn" data-c="' + esc(amt) + '" aria-label="نسخ المبلغ">' + COPY + '</button></div>' +
      (isPay ? '<a class="btn btn-block kbnb" style="margin:6px 0 12px;display:flex;align-items:center;justify-content:center;text-decoration:none" href="https://app.binance.com/" target="_blank" rel="noopener">افتح تطبيق Binance</a>' :
        '<div class="alert alert-warning" style="display:flex;margin:6px 0 12px">لا تقرّب المبلغ. لو تحوّل من منصة، تأكد إن المبلغ اللي يوصل هو نفسه بعد الرسوم.</div>') +
      '<div class="klive"><span class="kpulse"></span><div><b>ننتظر وصول التحويل…</b><span>الصفحة تتحدّث وحدها</span></div></div></div>';
    if (!isPay && window.kardoQR) { var q = document.getElementById('pq'); if (q) q.innerHTML = window.kardoQR(v.address); }
    Array.prototype.forEach.call(document.querySelectorAll('[data-c]'), function (b) {
      b.onclick = function () { (navigator.clipboard ? navigator.clipboard.writeText(b.getAttribute('data-c')) : Promise.reject()).then(function () { toast('نُسخ ✓'); }, function () { toast('انسخ يدويًا'); }); };
    });
    clearInterval(timer);
    timer = setInterval(function () { var el = document.getElementById('pl'); if (el) el.textContent = left(v.expires_ms - Date.now()); }, 1000);
  }
  function stop() { clearInterval(timer); clearTimeout(poll); }
  function tick() {
    if (document.visibilityState !== 'visible') { poll = setTimeout(tick, 20000); return; }
    load(true).then(function (d) {
      if (!d.success) return msg(esc(d.error || 'الرابط غير صالح'));
      var st = d.invoice.status; if (st !== last) { last = st; draw(d); }
      if (st === 'awaiting' || st === 'cancelled') poll = setTimeout(tick, 20000);
    }).catch(function () { poll = setTimeout(tick, 30000); });
  }
  if (!token) return msg('الرابط ناقص — تأكد إنك نسخته كامل.');
  load(false).then(function (d) {
    if (!d.success) return msg(esc(d.error || 'الرابط غير صالح أو انتهى'));
    last = d.invoice.status; draw(d);
    if (last === 'awaiting' || last === 'cancelled') poll = setTimeout(tick, 15000);
  }).catch(function () { msg('تعذّر الاتصال — تأكد من الإنترنت وأعد تحميل الصفحة.'); });
})();
