// صفحات عامة للمتاجر الموثوقة (لمحركات البحث والمشاركة): القائمة، وصفحة كل متجر بـ ?s=slug
const API = 'https://kardo.sdkhyrallh08.workers.dev';
const SITE = 'https://kardo.ly';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lyd = v => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' د.ل';
const box = document.getElementById('cp');
const slug = (new URLSearchParams(location.search).get('s') || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
const setMeta = (sel, attr, val) => { const el = document.querySelector(sel); if (el) el.setAttribute(attr, val); };
const TIER = { gold: '🥇 ذهبي', silver: '🥈 فضي' };
const price = s => `${esc(lyd(s.price))}${s.old_price ? ` <s style="opacity:.6">${esc(lyd(s.old_price))}</s>` : ''}`;
const logo = m => `<span class="m-logo">${m.logo ? `<img src="${esc(m.logo)}" alt="${esc(m.name)}" loading="lazy">` : `<b>${esc((m.name || '؟').charAt(0))}</b>`}</span>`;

async function load() {
  let d;
  try { d = await (await fetch(`${API}/api/merchants/list`)).json(); } catch { d = null; }
  if (!d || !d.success) { box.innerHTML = '<div class="card" style="text-align:center;padding:30px">تعذّر التحميل — <a href="" style="color:var(--brand)">أعد المحاولة</a></div>'; return; }
  const svc = mid => d.services.filter(s => s.mid === mid);

  if (!slug) {
    box.innerHTML = `
      <h1>المتاجر الموثوقة</h1>
      <p class="lead">تجار ليبيون مختارون من <b>كاردو</b> — اشتراكات، شحن ألعاب، بطاقات رقمية وخدمات. تتواصل وتدفع للتاجر مباشرة، وطلبك مسجّل في كاردو.</p>
      <div style="display:flex;flex-direction:column;gap:10px">${d.merchants.filter(m => m.slug).map(m => `
        <a class="prow" href="./store.html?s=${encodeURIComponent(m.slug)}" style="text-decoration:none">
          <span class="prow-img">${m.logo ? `<img src="${esc(m.logo)}" alt="" loading="lazy">` : '🏪'}</span>
          <span class="prow-body"><span class="prow-name" style="display:block">${esc(m.name)} <span class="m-ok">✓ موثّق</span></span>
            <span class="caption" style="display:block">${esc(m.category)} · ${svc(m.id).length} خدمة${m.orders_done ? ` · ${m.orders_done} طلب مكتمل` : ''}</span></span>
          <span class="prow-add" aria-hidden="true">←</span></a>`).join('') || '<div class="card" style="text-align:center;padding:24px">لا متاجر بعد</div>'}</div>
      <p style="margin-top:18px"><a href="./visa-libya.html" style="color:var(--brand);font-weight:700">بطاقة فيزا افتراضية في ليبيا ←</a></p>`;
    return;
  }

  const m = d.merchants.find(x => x.slug === slug);
  if (!m) { box.innerHTML = '<div class="card" style="text-align:center;padding:30px">المتجر غير متاح — <a href="./stores.html" style="color:var(--brand)">كل المتاجر</a></div>'; return; }
  const list = svc(m.id);
  const title = `${m.name} — ${m.category} | متجر موثوق على كاردو`;
  const desc = `${m.name}: ${list.slice(0, 4).map(s => s.name).join('، ')}${list.length > 4 ? '…' : ''}. ${m.bio || ''}`.replace(/\s+/g, ' ').slice(0, 155);
  document.title = title;
  setMeta('meta[name="description"]', 'content', desc);
  setMeta('#canon', 'href', `${SITE}/store.html?s=${encodeURIComponent(m.slug)}`);
  setMeta('#ogTitle', 'content', title); setMeta('#ogDesc', 'content', desc);
  if (m.logo) setMeta('#ogImg', 'content', m.logo);
  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Store', name: m.name, description: m.bio || desc, image: m.logo || undefined,
    url: `${SITE}/store.html?s=${encodeURIComponent(m.slug)}`,
    aggregateRating: m.rating_count ? { '@type': 'AggregateRating', ratingValue: m.rating, reviewCount: m.rating_count } : undefined,
    makesOffer: list.map(s => ({ '@type': 'Offer', name: s.name, priceCurrency: 'LYD', price: Number(s.price).toFixed(2),
      availability: s.delivery === 'stock' && !s.stock ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock' })),
  });
  document.head.appendChild(ld);
  const c = m.contacts || {};
  box.innerHTML = `
    <div class="cp-crumb"><a href="./stores.html">المتاجر الموثوقة</a> › ${esc(m.name)}</div>
    <div class="m-hero" style="margin-top:8px">${m.cover ? `<img src="${esc(m.cover)}" alt="">` : ''}</div>
    <div class="m-head">${logo(m).replace('m-logo', 'm-logo m-logo-lg')}<div><h1 style="margin:0">${esc(m.name)}</h1>
      <div class="caption">${esc(m.category)} · <span class="m-ok">✓ موثّق من كاردو</span>${m.tier ? ` · ${TIER[m.tier]}` : ''}${m.rating ? ` · <span class="m-rate">★ ${m.rating}</span>` : ''}</div>
      <div class="caption">${m.open === false ? '🔴 مغلق حاليًا' : '🟢 مفتوح'}${m.hours ? ` · 🕒 ${esc(m.hours)}` : ''}</div></div></div>
    ${m.bio ? `<p class="lead" style="white-space:pre-line">${esc(m.bio)}</p>` : ''}
    <div class="m-contacts" style="margin-bottom:14px">
      ${c.whatsapp ? `<a class="btn btn-secondary btn-sm" href="https://wa.me/${esc(c.whatsapp.replace(/\D/g, ''))}" target="_blank" rel="noopener">واتساب</a>` : ''}
      ${c.telegram ? `<a class="btn btn-secondary btn-sm" href="https://t.me/${esc(c.telegram)}" target="_blank" rel="noopener">تيليجرام</a>` : ''}
    </div>
    <h2>الخدمات</h2>
    <div style="display:flex;flex-direction:column;gap:10px">${list.map(s => `
      <div class="prow">
        <span class="prow-img">${s.image ? `<img src="${esc(s.image)}" alt="${esc(s.name)}" loading="lazy">` : '🛍️'}</span>
        <span class="prow-body"><span class="prow-name" style="display:block">${esc(s.name)}</span>
          <span class="prow-price" style="display:block">${price(s)}</span>
          <span class="caption" style="display:block">${s.section ? esc(s.section) + ' · ' : ''}${s.delivery === 'stock' ? (s.stock ? '⚡ تسليم فوري' : '⛔ نفذت الكمية') : '🕐 تنفيذ يدوي'}${s.eta ? ' · ⏱️ ' + esc(s.eta) : ''}</span></span>
      </div>`).join('') || '<p>لا خدمات بعد</p>'}</div>
    <p style="margin-top:16px"><a class="btn btn-primary" href="./index.html#m=${encodeURIComponent(m.id)}" style="padding:0 24px">اطلب الآن من كاردو</a></p>
    <p class="caption" style="margin-top:10px">الدفع يتم مباشرة للتاجر، وطلبك وإيصالك مسجّلان في كاردو.</p>`;
}
load();
