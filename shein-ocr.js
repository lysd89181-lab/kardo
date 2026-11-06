/* ═══════════════════════════════════════════════════════════════════
   shein-ocr.js — قراءة لقطة سلة SHEIN داخل المتصفح بـ Tesseract.js
   • الصورة ما تخرج من جهاز الزبون: ما فيش رفع لأي سيرفر أو خدمة خارجية.
   • الملفات (tesseract / wasm / اللغات) تُخدَّم من نفس الدومين: /vendor/tesseract/
   • النتيجة «اقتراح» فقط — الزبون يراجعها ويصححها، والإدارة تراجع الأسعار قبل أي دفع.
   ═══════════════════════════════════════════════════════════════════ */

const VENDOR = 'vendor/tesseract/';
export const OCR_MAX_BYTES = 15 * 1024 * 1024;

/* ─── 1) تنظيف النص (أرقام عربية، رموز تشويش) ─── */
const AR_D = '٠١٢٣٤٥٦٧٨٩', FA_D = '۰۱۲۳۴۵۶۷۸۹';
export function normText(s) {
  return String(s || '')
    .replace(/[٠-٩]/g, c => AR_D.indexOf(c))
    .replace(/[۰-۹]/g, c => FA_D.indexOf(c))
    .replace(/٫/g, '.').replace(/[٬،]/g, ',')
    .replace(/ـ/g, '')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[|_~`^{}<>\[\]]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/* ─── 2) العملة والأسعار ─── */
const SYM = '(?:US\\s?\\$|USD|SAR|SR|AED|EUR|GBP|\\$|€|£|ر\\s?\\.\\s?س\\.?|د\\s?\\.\\s?إ\\.?|ريال|درهم|دولار|يورو)';
const NUMS = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?';
const ADJ_SRC = `${SYM}\\s*(${NUMS})|(${NUMS})\\s*${SYM}`;
const CUR = [
  ['USD', /US\s?\$|\bUSD\b|\$|دولار/i],
  ['EUR', /€|\bEUR\b|يورو/i],
  ['GBP', /£|\bGBP\b/i],
  ['SAR', /\bSAR\b|\bSR\b|ر\s?\.\s?س|ريال/i],
  ['AED', /\bAED\b|د\s?\.\s?إ|درهم/i],
];
export function curOf(t) { for (const [c, re] of CUR) if (re.test(t)) return c; return ''; }
function toNum(tok) {
  let t = String(tok);
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, ''); else t = t.replace(',', '.');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}
const letters = s => (String(s).match(/[A-Za-z\u0600-\u06FF]/g) || []).length;

// يرجّع الأسعار الموجودة في السطر + ما تبقّى من النص بعد شيلها
function priceInfo(t) {
  if (/%/.test(t)) return { amounts: [], cur: '', rest: t };
  const amounts = [];
  for (const m of t.matchAll(new RegExp(ADJ_SRC, 'gi'))) { const v = toNum(m[1] || m[2]); if (v > 0) amounts.push(v); }
  if (amounts.length) return { amounts, cur: curOf(t), rest: t.replace(new RegExp(ADJ_SRC, 'gi'), ' ').replace(/\s+/g, ' ').trim() };
  // رقم عشري لحاله (45.00) في سطر قصير بدون كلام
  const toks = t.match(new RegExp(NUMS, 'g')) || [];
  const dec = toks.filter(x => /[.,]\d{2}$/.test(x));
  const rest = t.replace(new RegExp(NUMS, 'g'), ' ').replace(/\s+/g, ' ').trim();
  if (dec.length && letters(rest) <= 2 && rest.length <= 6) return { amounts: dec.map(toNum).filter(v => v > 0), cur: '', rest: '' };
  return { amounts: [], cur: '', rest: t };
}

/* ─── 3) كلمات لا تمثل منتجات ─── */
const NOISE = /(shopping cart|my cart|your cart|سلة التسوق|سلتي|total|sub\s?total|shipping|delivery|discount|coupon|you save|saved|tax\b|vat\b|points|checkout|select all|sold out|add to wishlist|free ship|المجموع|الاجمالي|الإجمالي|إجمالي|اجمالي|الفرعي|الشحن|التوصيل|التوفير|وفرت|خصم|كوبون|ضريبة|نقاط|إتمام|اتمام|الدفع|تحديد الكل|نفد|مجاني|مجانا)/i;
const TOTAL = /(total|grand|المجموع|الاجمالي|الإجمالي|إجمالي|اجمالي)/i;
const SUBTOT = /(sub\s?total|الفرعي)/i;
const STOP = /(you may also like|recommended|قد يعجبك|مقترح|منتجات مشابهة)/i;
const SIZE_RE = /(?:size|المقاس|مقاس)\s*[:：]?\s*([A-Za-z0-9\-\/ ]{1,12})/i;
const COLOR_RE = /(?:colou?r|اللون|لون)\s*[:：]?\s*([A-Za-z\u0600-\u06FF ]{2,16})/i;
const COMBO_RE = /^([A-Za-z\u0600-\u06FF]{3,14})\s*\/\s*([A-Za-z0-9]{1,6})$/;
const QTY2 = /(?:qty|quantity|الكمية|كمية)\s*[:：]?\s*(\d{1,2})/i;
const QTY1 = /^[x×X]\s?(\d{1,2})$|^(\d{1,2})\s?[x×X]$/;
const STEP_OK = /^[-–−—]\s*(\d)\s*[+＋]$/;          // «- 2 +» واضحة
const STEP_2D = /^[-–−—]\s*(\d)\s*\d$/;               // «-14» = «- 1 +» والـ + اتقرت رقم — غالبًا
const STEP_1D = /^[-–−—]\s*(\d)$/;

function nameOk(t) {
  const L = letters(t);
  return t.length >= 8 && L >= 6 && L / t.length >= 0.5 && !(t.length <= 40 && NOISE.test(t));
}
const clean = s => s.replace(/\s+/g, ' ').replace(/^[\s\-–•·:,.]+|[\s\-–•·:,]+$/g, '').slice(0, 160);

/* ─── 4) من أسطر OCR إلى منتجات ───
   rawLines: [{ text, conf }] مرتبة من فوق لتحت.
   opt.cur: العملات المسموحة (من إعدادات الخادم).  */
export function parseCartLines(rawLines, opt = {}) {
  const allowed = new Set((opt.cur && opt.cur.length ? opt.cur : ['USD', 'SAR', 'AED', 'EUR', 'GBP']).map(String));
  const lines = (rawLines || []).map(l => ({ t: normText(l.text), conf: Number.isFinite(l.conf) ? l.conf : 80 })).filter(l => l.t.length >= 1);
  const items = [], votes = {};
  let total = null, buf = [], attrs = {}, last = null, lastWasPrice = false, skipNext = false, stopped = false;
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

  for (let i = 0; i < lines.length && !stopped; i++) {
    const { t, conf } = lines[i];
    if (STOP.test(t) && items.length) break;

    // سطر الإجمالي الظاهر في الصورة
    if (TOTAL.test(t) && !SUBTOT.test(t) && t.length <= 60) {
      let info = priceInfo(t);
      if (!info.amounts.length && lines[i + 1]) { const n = priceInfo(lines[i + 1].t); if (n.amounts.length) { info = n; i++; } }
      if (info.amounts.length) total = { amount: Math.max(...info.amounts), cur: info.cur || '' };
      buf = []; last = null; lastWasPrice = false;
      if (items.length) stopped = true;       // اللي بعد الإجمالي (توصيات…) ما يدخلش
      continue;
    }
    // سطور ملصقات (الشحن، الخصم…) — السعر اللي معاها ما هو منتج
    if (t.length <= 40 && NOISE.test(t)) {
      if (!priceInfo(t).amounts.length) skipNext = true;
      continue;
    }
    // كمية
    let qm = null, q = 0, shaky = false;
    if (last && ((qm = STEP_OK.exec(t)) || (qm = STEP_1D.exec(t)))) q = parseInt(qm[1], 10);
    else if (last && (qm = STEP_2D.exec(t))) { q = parseInt(qm[1], 10); shaky = true; }
    else if (last && ((qm = QTY2.exec(t)) || (t.length <= 8 && (qm = QTY1.exec(t))))) q = parseInt(qm[1] || qm[2], 10);
    if (qm) {
      if (q >= 1 && q <= 50 && !last._q) { last.qty = q; last._q = true; if (shaky) last.flags.add('qty'); }
      continue;
    }
    // مقاس / لون
    let am;
    if ((am = SIZE_RE.exec(t)) && t.length <= 30) { attrs.size = clean(am[1]); continue; }
    if ((am = COLOR_RE.exec(t)) && t.length <= 30) { attrs.color = clean(am[1]); continue; }
    if ((am = COMBO_RE.exec(t))) { attrs.color = am[1]; attrs.size = am[2]; continue; }

    const info = priceInfo(t);
    if (info.amounts.length) {
      if (skipNext && letters(info.rest) <= 3) { skipNext = false; continue; }
      skipNext = false;
      if (nameOk(info.rest)) { buf.push({ t: clean(info.rest), conf }); lastWasPrice = false; }
      const price = Math.min(...info.amounts);
      if (last && lastWasPrice && !buf.length) {            // سعرين متتاليين (قبل/بعد الخصم) — ناخذوا الأقل وننبّهوا
        last.alts.push(price);
        if (price < last.amount) last.amount = price;
        last.flags.add('alt');
        continue;
      }
      const used = buf.length > 1 && buf[buf.length - 2].t.length >= 28 ? buf.slice(-2) : buf.slice(-1);   // اسم طويل ملفوف على سطرين
      const it = {
        name: clean(used.map(x => x.t).join(' ')), amount: price, qty: 1, cur: info.cur || '', size: attrs.size || '', color: attrs.color || '',
        alts: info.amounts.length > 1 ? info.amounts.filter(v => v !== price) : [], flags: new Set(),
        _conf: avg([...used.map(x => x.conf), conf]), _q: false,
      };
      if (it.alts.length) it.flags.add('alt');
      items.push(it); last = it; lastWasPrice = true; buf = []; attrs = {};
      votes[it.cur || ''] = (votes[it.cur || ''] || 0) + 1;
      continue;
    }
    skipNext = false;
    if (nameOk(t)) { buf.push({ t: clean(t), conf }); if (buf.length > 4) buf.shift(); lastWasPrice = false; }
  }

  // أكثر عملة ظهرت (من المسموح)
  const best = Object.entries(votes).filter(([c]) => allowed.has(c)).sort((a, b) => b[1] - a[1])[0];
  const currency = best ? best[0] : '';
  const out = items.map(it => {
    const f = new Set(it.flags);
    if (!it.name) f.add('noname');
    if (it._conf < 60) f.add('low');
    if (it.amount < 0.5 || it.amount > 3000) f.add('range');
    if (it.cur && currency && it.cur !== currency) f.add('cur');
    return { name: it.name, amount: it.amount, qty: it.qty, size: it.size, color: it.color, flags: [...f] };
  });
  return { items: out, total: total && (!total.cur || allowed.has(total.cur)) ? total : (total ? { amount: total.amount, cur: '' } : null), currency, lineCount: lines.length };
}

/* ─── 5) تجهيز الصورة: تكبير/تصغير + تقطيع الطويلة ─── */
async function toBitmap(file) {
  try { if (self.createImageBitmap) return await createImageBitmap(file); } catch {}
  return await new Promise((res, rej) => {
    const u = URL.createObjectURL(file), im = new Image();
    im.onload = () => { URL.revokeObjectURL(u); res(im); };
    im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('ما قدرناش نفتحوا الصورة (جرّب لقطة شاشة PNG أو JPG)')); };
    im.src = u;
  });
}
export async function prepareSlices(file) {
  const bmp = await toBitmap(file);
  const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight;
  if (!w0 || !h0) throw new Error('الصورة غير صالحة');
  let scale = 1;
  if (w0 < 1000) scale = Math.min(2, 1100 / w0); else if (w0 > 1500) scale = 1400 / w0;
  const W = Math.round(w0 * scale), H = Math.round(h0 * scale);
  const SLICE = 2000, OVER = 140;
  if (H > 6 * (SLICE - OVER)) throw new Error('الصورة طويلة بزيادة — قسّمها لصورتين وارفع كل وحدة لحالها');
  const out = [];
  for (let y = 0; y < H; y += SLICE - OVER) {
    const sh = Math.min(SLICE, H - y), c = document.createElement('canvas');
    c.width = W; c.height = sh;
    const ctx = c.getContext('2d');
    try { ctx.filter = 'grayscale(1) contrast(1.15)'; } catch {}
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, sh);
    ctx.drawImage(bmp, 0, y / scale, w0, sh / scale, 0, 0, W, sh);
    out.push({ canvas: c, y });
    if (y + sh >= H) break;
  }
  if (bmp.close) bmp.close();
  return out;
}

/* ─── 6) تحميل Tesseract (من نفس الدومين) وتشغيله ─── */
const base = () => new URL(VENDOR, document.baseURI).href;
let _tp = null;
function loadTess() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (_tp) return _tp;
  _tp = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = base() + 'tesseract.min.js';
    s.onload = () => (window.Tesseract ? res(window.Tesseract) : rej(new Error('محرك القراءة ما اشتغلش')));
    s.onerror = () => rej(new Error('تعذّر تحميل محرك القراءة — تأكد إن ملفات vendor/tesseract مرفوعة'));
    document.head.appendChild(s);
  });
  _tp.catch(() => { _tp = null; });
  return _tp;
}

// دمج الأجزاء اللي على نفس السطر البصري (اسم + سعر جنب بعض) وحذف تكرار منطقة التداخل
function mergeLines(parts) {
  parts.sort((a, b) => (a.y0 - b.y0) || (a.x - b.x));
  const rows = [];
  for (const p of parts) {
    const r = rows[rows.length - 1];
    const h = Math.max(1, Math.min(p.y1 - p.y0, r ? r.y1 - r.y0 : 1));
    if (r && Math.min(r.y1, p.y1) - Math.max(r.y0, p.y0) > 0.55 * h) {
      r.parts.push(p); r.y1 = Math.max(r.y1, p.y1); r.y0 = Math.min(r.y0, p.y0);
    } else rows.push({ y0: p.y0, y1: p.y1, parts: [p] });
  }
  const out = [], seen = [];
  for (const r of rows) {
    r.parts.sort((a, b) => a.x - b.x);
    const text = r.parts.map(p => p.text.trim()).filter(Boolean).join(' ');
    const key = text.replace(/[^A-Za-z0-9\u0600-\u06FF]/g, '').toLowerCase();
    if (!key) continue;
    if (seen.some(s => s.key === key && Math.abs(s.y - r.y0) < 90)) continue;
    seen.push({ key, y: r.y0 });
    out.push({ text, conf: r.parts.reduce((a, p) => a + p.conf, 0) / r.parts.length });
  }
  return out;
}

/* opts: { lang:'ara+eng'|'eng'|'ara', onProgress({label,pct}), handle:{cancel} } → { lines } */
export async function ocrImage(file, opts = {}) {
  if (!file || !/^image\//.test(file.type || '')) throw new Error('ارفع صورة فقط (PNG أو JPG)');
  if (file.size > OCR_MAX_BYTES) throw new Error('الصورة كبيرة (الحد 15 ميجا)');
  const lang = ['eng', 'ara', 'ara+eng'].includes(opts.lang) ? opts.lang : 'ara+eng';
  const prog = (label, pct) => { try { opts.onProgress && opts.onProgress({ label, pct: Math.max(0, Math.min(100, Math.round(pct))) }); } catch {} };
  let worker = null, cancelled = false, stage = 0, nStages = 1;
  const handle = opts.handle || {};
  handle.cancel = () => { cancelled = true; try { worker && worker.terminate(); } catch {} };
  const guard = () => { if (cancelled) throw new Error('CANCELLED'); };

  prog('نجهّزوا الصورة…', 3);
  const slices = await prepareSlices(file); guard();
  nStages = slices.length;
  prog('نحمّلوا محرك القراءة…', 8);
  const T = await loadTess(); guard();
  const root = base().replace(/\/$/, '');
  const timer = setTimeout(() => handle.cancel(), 150000);
  try {
    worker = await T.createWorker(lang, 1, {
      workerPath: root + '/worker.min.js',
      corePath: root,
      langPath: root + '/lang',
      workerBlobURL: false,                 // CSP: ما نسمحوش بـ blob: للسكريبتات
      logger: m => {
        if (!m) return;
        if (m.status === 'recognizing text') prog(nStages > 1 ? `نقروا الصورة (${stage + 1}/${nStages})…` : 'نقروا الصورة…', 30 + 65 * ((stage + (m.progress || 0)) / nStages));
        else if (/language/i.test(m.status || '')) prog('نحمّلوا اللغة (أول مرة بس)…', 12 + 12 * (m.progress || 0));
        else if (/core/i.test(m.status || '')) prog('نحمّلوا محرك القراءة…', 8 + 4 * (m.progress || 0));
        else if (/initializ/i.test(m.status || '')) prog('نجهّزوا المحرك…', 26);
      },
    });
    guard();
    try { await worker.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1', user_defined_dpi: '300' }); } catch {}
    const parts = [];
    for (let i = 0; i < slices.length; i++) {
      stage = i; guard();
      const { data } = await worker.recognize(slices[i].canvas); guard();
      const off = slices[i].y;
      if (data && Array.isArray(data.lines) && data.lines.length) {
        for (const l of data.lines) {
          const b = l.bbox || { x0: 0, y0: 0, y1: 20 };
          parts.push({ text: l.text || '', conf: Number.isFinite(l.confidence) ? l.confidence : 70, x: b.x0 || 0, y0: (b.y0 || 0) + off, y1: (b.y1 || 20) + off });
        }
      } else if (data && data.text) {
        String(data.text).split('\n').forEach((tx, k) => parts.push({ text: tx, conf: data.confidence || 70, x: 0, y0: off + k * 40, y1: off + k * 40 + 30 }));
      }
      slices[i].canvas.width = 1; slices[i].canvas.height = 1;      // نحرروا الذاكرة
    }
    prog('نرتّبوا النتيجة…', 97);
    return { lines: mergeLines(parts) };
  } finally {
    clearTimeout(timer);
    try { worker && (await worker.terminate()); } catch {}
  }
}
