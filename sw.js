/* KARDO service worker — ملفات الموقع فقط، لا يلمس الـ API ولا البيانات */
const V = 'kardo-v18';
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

// ─── إشعارات الهاتف (FCM data messages) ───
self.addEventListener('push', e => {
  let d = {};
  try { const j = e.data ? e.data.json() : {}; d = j.data || j.notification || j; } catch {}
  const title = d.title || 'كاردو';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '', icon: './icon-192.png', badge: './icon-192.png', dir: 'rtl', lang: 'ar',
    data: { link: d.link || './index.html' }, tag: (d.link || 'kardo').slice(-60), renotify: true, vibrate: [120, 60, 120],
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.link) || './index.html';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) { if ('focus' in w) { w.navigate(url).catch(() => {}); return w.focus(); } }
    return clients.openWindow(url);
  }));
});
