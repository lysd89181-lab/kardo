/* boot.js — يُحمَّل قبل أي شيء: من سجّل دخوله سابقًا لا يرى صفحة الدخول ولا «رمشة» */
(function () {
  try {
    var authed = localStorage.getItem('kardo_authed') === '1';
    var isLogin = /login\.html$/.test(location.pathname);
    if (isLogin) {
      if (authed && !/[?&](mode=signup|ref=)/.test(location.search)) { location.replace('./index.html' + location.hash); return; }
      if (authed) document.documentElement.classList.add('auth-checking');
    } else if (authed) {
      document.documentElement.classList.add('boot-app');
    }
  } catch (e) {}
})();
