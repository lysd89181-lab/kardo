// صفحة قسم مستقلة لمحركات البحث: «اشتراك نتفلكس في ليبيا» … إلخ، وبدون id = صفحة كل الاشتراكات
const API = 'https://kardo.sdkhyrallh08.workers.dev';
const SITE = 'https://kardo.ly';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lyd = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' د.ل';
const box = document.getElementById('cp');
const id = (new URLSearchParams(location.search).get('id') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
const setMeta = (sel, attr, val) => { const el = document.querySelector(sel); if (el) el.setAttribute(attr, val); };

const row = p => `
  <a class="prow" href="./product.html?id=${encodeURIComponent(p.id)}" style="text-decoration:none">
    <span class="prow-img">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">` : '📦'}</span>
    <span class="prow-body"><span class="prow-name" style="display:block">${esc(p.name)}</span>
      <span class="prow-price" style="display:block">${esc(lyd(p.price))}${p.old_price > p.price ? `<s>${esc(lyd(p.old_price))}</s>` : ''}</span>
      <span class="avail" style="display:block;color:${p.available ? 'var(--success)' : 'var(--error)'}">${p.available ? (p.kind === 'stock' ? '✓ متوفر · ⚡ تسليم فوري' : '✓ متوفر') : '✕ غير متوفر حاليًا'}</span></span>
    <span class="prow-add" aria-hidden="true">←</span></a>`;

const tile = c => `
  <a class="cat-tile" href="./category.html?id=${encodeURIComponent(c.id)}" style="text-decoration:none">
    ${c.image ? `<img src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy">` : `<span class="cat-ico">${esc(c.icon || '📦')}</span>`}
    <span class="cat-name">${esc(c.name)}</span></a>`;

async function load() {
  let d;
  try { d = await (await fetch(`${API}/api/catalog`)).json(); } catch { d = null; }
  if (!d || !d.success) { box.innerHTML = '<div class="card" style="text-align:center;padding:30px">تعذّر التحميل — <a href="" style="color:var(--brand)">أعد المحاولة</a></div>'; return; }
  const cats = d.categories || [], prods = d.products || [];

  if (!id) {                                   // صفحة كل الاشتراكات
    const top = cats.filter(c => !c.parent);
    const names = top.map(c => c.name).slice(0, 8).join('، ');
    box.innerHTML = `
      <h1>موقع اشتراكات رقمية</h1>
      <p class="lead">اشترِ اشتراكاتك وشحن ألعابك من <b>كاردو</b> وادفع بالدينار الليبي عبر ليبيانا والمدار والتحويل المصرفي، بتسليم فوري لأغلب المنتجات.${names ? ` الأقسام المتوفرة: ${esc(names)}.` : ''}</p>
      <div class="prod-grid mb-5">${top.map(tile).join('')}</div>
      ${prods.filter(p => p.featured).length ? `<h2>الأكثر طلبًا</h2><div style="display:flex;flex-direction:column;gap:10px">${prods.filter(p => p.featured).map(row).join('')}</div>` : ''}
      <h2>لماذا تشتري اشتراكاتك من كاردو؟</h2>
      <p class="seo-text">كاردو متجر ليبي للاشتراكات الرقمية: نتفلكس، شاهد، سبوتيفاي، ChatGPT، سناب شات بلس، وشحن الألعاب. تدفع بالدينار من رصيد هاتفك أو حسابك المصرفي، وتستلم الكود أو التفعيل مباشرة في «طلباتي». وتقدر كمان تصدر بطاقة فيزا افتراضية تدفع بيها أي اشتراك بنفسك.</p>
      <p style="margin-top:14px"><a href="./visa-libya.html" style="color:var(--brand);font-weight:700">بطاقة فيزا افتراضية في ليبيا ←</a></p>`;
    return;
  }

  const c = cats.find(x => x.id === id);
  if (!c) { box.innerHTML = '<div class="card" style="text-align:center;padding:30px">القسم غير موجود — <a href="./category.html" style="color:var(--brand)">كل الاشتراكات</a></div>'; return; }
  const subs = cats.filter(x => x.parent === c.id);
  const subIds = new Set([c.id, ...subs.map(s => s.id)]);
  const list = prods.filter(p => subIds.has(p.cat));
  const url = `${SITE}/category.html?id=${encodeURIComponent(c.id)}`;
  const min = list.length ? Math.min(...list.map(p => p.price)) : 0;
  const title = `${c.name} — اشتراك ${c.name}${min ? ` يبدأ من ${lyd(min)}` : ''} | كاردو`;
  const desc = `اشتراك ${c.name} من كاردو، موقع اشتراكات رقمية في ليبيا. ادفع بالدينار عبر ليبيانا والمدار.${min ? ` الأسعار تبدأ من ${lyd(min)}.` : ''}`;
  document.title = title;
  setMeta('meta[name="description"]', 'content', desc);
  setMeta('#canon', 'href', url);
  setMeta('#ogTitle', 'content', title);
  setMeta('#ogDesc', 'content', desc);
  if (c.image) setMeta('#ogImg', 'content', c.image);

  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'ItemList', name: `${c.name} — كاردو`,
    itemListElement: list.map((p, i) => ({
      '@type': 'ListItem', position: i + 1,
      item: { '@type': 'Product', name: p.name, url: `${SITE}/product.html?id=${encodeURIComponent(p.id)}`, image: p.image || undefined,
        offers: { '@type': 'Offer', priceCurrency: 'LYD', price: Number(p.price).toFixed(2),
          availability: p.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' } },
    })),
  });
  document.head.appendChild(ld);

  box.innerHTML = `
    <div class="cp-crumb"><a href="./category.html">كل الاشتراكات</a> › ${esc(c.name)}</div>
    <h1>${esc(c.name)}</h1>
    <p class="lead">اشترِ <b>${esc(c.name)}</b> من كاردو وادفع بالدينار الليبي عبر ليبيانا أو المدار أو التحويل المصرفي.${min ? ` الأسعار تبدأ من <b>${esc(lyd(min))}</b>.` : ''}</p>
    ${subs.length ? `<div class="prod-grid mb-5">${subs.map(tile).join('')}</div>` : ''}
    ${list.length ? `<div style="display:flex;flex-direction:column;gap:10px">${list.map(row).join('')}</div>`
      : '<div class="card" style="text-align:center;padding:28px"><img src="./fennec-empty.webp" alt="" width="110" height="110" style="display:block;margin:0 auto 8px">لا منتجات في هذا القسم حاليًا</div>'}
    <h2>كيف تشتري ${esc(c.name)} من كاردو؟</h2>
    <p class="seo-text">1) أنشئ حسابك في كاردو. 2) اشحن محفظتك بالدينار عبر ليبيانا أو المدار. 3) اختر الباقة المناسبة من ${esc(c.name)} واضغط «اشترِ الآن». 4) تستلم الكود أو التفعيل في «طلباتي»، ويصلك إشعار على بريدك.</p>
    <p style="margin-top:14px"><a class="btn btn-primary" href="./login.html?mode=signup" style="padding:0 24px">ابدأ الآن</a></p>`;
}
load();
