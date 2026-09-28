// صفحة منتج مستقلة: خفيفة (بدون Firebase)، قابلة للأرشفة، مع بيانات منظمة للسعر والتوفر
const API = 'https://kardo.sdkhyrallh08.workers.dev';
const SITE = 'https://kardo.ly';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lyd = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' د.ل';
const box = document.getElementById('pp');
const id = (new URLSearchParams(location.search).get('id') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);

function setMeta(sel, attr, val) { const el = document.querySelector(sel); if (el) el.setAttribute(attr, val); }

function notFound() {
  document.title = 'المنتج غير متوفر — كاردو';
  setMeta('meta[name="robots"]', 'content', 'noindex');
  box.innerHTML = `<div class="card" style="text-align:center;padding:36px 20px">
    <img src="./fennec-empty.webp" alt="" width="120" height="120" style="margin:0 auto 10px;display:block">
    <h1 style="font-size:20px">المنتج غير متوفر</h1><p class="text-2">ربما حُذف أو تغيّر رابطه.</p>
    <a class="btn btn-primary" href="./index.html" style="margin-top:12px;padding:0 22px">تصفّح المتجر</a></div>`;
}

async function load() {
  if (!id) return notFound();
  let d;
  try { d = await (await fetch(`${API}/api/catalog`)).json(); } catch { d = null; }
  if (!d || !d.success) {
    box.innerHTML = '<div class="card" style="text-align:center;padding:30px">تعذّر التحميل — <a href="" style="color:var(--brand)">أعد المحاولة</a></div>';
    return;
  }
  const p = (d.products || []).find(x => x.id === id);
  if (!p) return notFound();
  const cat = (d.categories || []).find(c => c.id === p.cat);
  const url = `${SITE}/product.html?id=${encodeURIComponent(p.id)}`;
  const off = p.old_price > p.price ? Math.round((1 - p.price / p.old_price) * 100) : 0;
  const desc = (p.desc || `اشترِ ${p.name} بالدينار الليبي من كاردو`).replace(/\s+/g, ' ').slice(0, 155);

  document.title = `${p.name} — ${lyd(p.price)} | كاردو`;
  setMeta('meta[name="description"]', 'content', desc);
  setMeta('#canon', 'href', url);
  setMeta('#ogTitle', 'content', `${p.name} — ${lyd(p.price)}`);
  setMeta('#ogDesc', 'content', desc);
  if (p.image) setMeta('#ogImg', 'content', p.image);

  // بيانات منظمة: السعر والتوفر يظهران في نتائج البحث
  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Product',
    name: p.name, description: desc, image: p.image ? [p.image] : undefined, sku: p.id,
    brand: { '@type': 'Brand', name: 'كاردو' },
    category: cat ? cat.name : undefined,
    offers: {
      '@type': 'Offer', url, priceCurrency: 'LYD', price: Number(p.price).toFixed(2),
      availability: p.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@type': 'Organization', name: 'كاردو' },
    },
  });
  document.head.appendChild(ld);

  const related = (d.products || []).filter(x => x.cat === p.cat && x.id !== p.id).slice(0, 6);
  box.innerHTML = `
    <div class="pp-crumb"><a href="./index.html">المتجر</a>${cat ? ` › ${esc(cat.name)}` : ''}</div>
    ${p.image ? `<div class="pp-hero"><img src="${esc(p.image)}" alt="${esc(p.name)}" fetchpriority="high"></div>` : ''}
    <h1>${esc(p.name)}</h1>
    <div class="pp-price"><b>${esc(lyd(p.price))}</b>${off ? `<s>${esc(lyd(p.old_price))}</s><span class="badge" style="background:var(--error-bg);color:var(--error)">خصم ${off}%</span>` : ''}</div>
    <div class="pp-badges">
      ${p.available ? '<span class="ok">✓ متوفر</span>' : '<span class="no">✕ غير متوفر حاليًا</span>'}
      <span>${p.kind === 'stock' ? '⚡ تسليم فوري' : '🕐 تسليم يدوي'}</span>
      <span>🇱🇾 الدفع بالدينار</span>
    </div>
    ${p.desc ? `<div class="pp-desc">${esc(p.desc)}</div>` : ''}
    ${p.note ? `<div class="alert alert-warning" style="margin-top:14px">${esc(p.note)}</div>` : ''}
    ${related.length ? `<h2>منتجات مشابهة</h2><div style="display:flex;flex-direction:column;gap:10px">${related.map(r => `
      <a class="prow" href="./product.html?id=${encodeURIComponent(r.id)}" style="text-decoration:none">
        <span class="prow-img">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : '📦'}</span>
        <span class="prow-body"><span class="prow-name" style="display:block">${esc(r.name)}</span>
        <span class="prow-price" style="display:block">${esc(lyd(r.price))}</span></span></a>`).join('')}</div>` : ''}
    <a class="btn btn-primary btn-block pp-buy" href="./index.html#p=${encodeURIComponent(p.id)}" ${p.available ? '' : 'aria-disabled="true" style="opacity:.6;pointer-events:none"'}>
      ${p.available ? 'اشترِ الآن' : 'غير متوفر حاليًا'}</a>`;
}
load();
