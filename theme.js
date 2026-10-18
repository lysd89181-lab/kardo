/* theme.js — المظهر نهاري/ليلي (تلقائي حسب الجهاز أو اختيار المستخدم). يُحمَّل قبل كل شيء. */
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
