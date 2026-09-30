/* KARDO service worker — ملفات الموقع فقط، لا يلمس الـ API ولا البيانات */
const V = 'kardo-v15';
const CORE = ['./', './index.html', './app.js', './config.js', './styles.css', './theme-desert.css', './kardo-v8.css', './kardo-v9.css', './icon-192.png',
  './fennec-welcome.webp', './fennec-success.webp', './fennec-empty.webp', './fennec-card.webp', './fennec-wait.webp', './fennec-error.webp'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const put = (r, res) => { if (res && res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; };
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const isFont = u.hostname === 'fonts.gstatic.com' || u.hostname === 'fonts.googleapis.com';
  const isSdk = u.hostname === 'www.gstatic.com' && u.pathname.startsWith('/firebasejs/');
  if (isFont || isSdk) {                                    // ثابتة بإصدارها → الكاش أولًا
    e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => put(r, res))));
    return;
  }
  if (u.origin !== location.origin || /admin\.(html|js)$/.test(u.pathname)) return;
  const isPage = r.mode === 'navigate' || u.pathname.endsWith('.html') || u.pathname.endsWith('/');
  if (isPage) {                                             // الصفحات: الشبكة أولًا (3 ثوانٍ) ثم الكاش
    e.respondWith(Promise.race([
      fetch(r).then(res => put(r, res)),
      new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 3000)),
    ]).catch(() => caches.match(r).then(hit => hit || caches.match('./index.html'))));
    return;
  }
  // الملفات الثابتة: من الكاش فورًا وتحديثها في الخلفية (فتح فوري)
  e.respondWith(caches.match(r).then(hit => {
    const net = fetch(r).then(res => put(r, res)).catch(() => hit);
    return hit || net;
  }));
});
