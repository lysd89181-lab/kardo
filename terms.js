// يفتح القسم المطلوب من الرابط (#cards …) ويعرض قوانين كل نوع بطاقة من الإعدادات
(function () {
  function openHash() {
    var id = (location.hash || '').slice(1); if (!id) return;
    var el = document.getElementById(id);
    if (el && el.tagName === 'DETAILS') { el.open = true; setTimeout(function () { el.scrollIntoView({ block: 'start' }); }, 60); }
  }
  window.addEventListener('hashchange', openHash); openHash();
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  fetch('https://kardo.sdkhyrallh08.workers.dev/api/status').then(function (r) { return r.json(); }).then(function (d) {
    var types = (d && d.card_types) || []; var box = document.getElementById('cardTypesRules');
    if (!box || !types.length) return;
    box.innerHTML = '<h3>قوانين كل نوع بطاقة</h3>' + types.map(function (t) {
      var lines = String(t.rules || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
      var banned = String(t.blocked || '').split(/[\n،,]/).map(function (x) { return x.trim(); }).filter(Boolean);
      return '<div class="ctype-rules"><b class="t">' + esc(t.name) + '</b> — إصدار $' + esc(t.fee_fixed) + (t.fee_pct ? ' + ' + esc(t.fee_pct) + '%' : '') +
        ' · تعبئة $' + esc(t.topup_fixed) + (t.topup_pct ? ' + ' + esc(t.topup_pct) + '%' : '') +
        '<div>' + (t.supports_3d ? '✅ يدعم رمز التحقق 3D Secure' : '⚠️ لا يدعم رمز التحقق 3D Secure — المواقع التي تطلبه قد ترفضه') + '</div>' +
        (lines.length ? '<ul>' + lines.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') +
        (banned.length ? '<div><b>محظور على هذا النوع:</b> ' + banned.map(esc).join('، ') + '</div>' : '') + '</div>';
    }).join('');
  }).catch(function () {});
})();
