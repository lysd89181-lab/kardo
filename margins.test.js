// اختبار تسلسل هامش الربح — يستخرج الدوال الحقيقية من worker.js ويشغّلها (بدون نسخ)
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../worker.js', 'utf8');
const grab = (re) => { const m = src.match(re); if (!m) throw new Error('not found: ' + re); return m[0]; };
const code = [
  grab(/const RSC_GRP = [^\n]+/),
  grab(/function num\(v, fallback\) \{[\s\S]*?\n\}\n/),
  grab(/const rscSell = [^\n]+/), grab(/const rscMNum = [^\n]+/), grab(/const rscBrandKey = [^\n]+/),
  grab(/function rscMarginInfo[\s\S]*?\n\}\n/), grab(/const rscMargin = [^\n]+/), grab(/const rscOfferOp = [^\n]+/),
].join('\n');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(code + '\nthis.api={rscSell,rscMarginInfo,rscOfferOp,rscMNum};', ctx);
const { rscSell, rscMarginInfo, rscOfferOp } = ctx.api;
const eq = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('الصيغة: 10$ × 3% = 10.30$', () => assert.strictEqual(rscSell(10, 3), 10.3));
t('بدون خطأ فاصلة عائمة: 100$ @10% = 110.00 (القديم كان 110.01)', () => assert.strictEqual(rscSell(100, 10), 110));
t('25$ @10% = 27.50 و 50$ @12% = 56.00', () => { assert.strictEqual(rscSell(25, 10), 27.5); assert.strictEqual(rscSell(50, 12), 56); });
t('التقريب لأعلى لأقرب سنت: 1.99 @3% = 2.05', () => assert.strictEqual(rscSell(1.99, 3), 2.05));
t('هامش 0 = التكلفة، وسالب يُعامل 0', () => { assert.strictEqual(rscSell(7.77, 0), 7.77); assert.strictEqual(rscSell(7.77, -5), 7.77); });

const s = { rsc_margin_pct: 10 };
const cfg = {
  groups: { gift: { margin: 8 } },
  brands: { apple: { margin: 6 } },
  cats: {
    'g~itunes-us': { group: 'gift', margin: 3, offers: { p1: { m: 1.5 }, p2: { d: 5 }, p3: { p: { usd: 9 } } } },
    'g~apple-other': { group: 'gift', offers: {} },
    'g~steam': { group: 'topup', offers: {} },
    'g~misc': { offers: {} },
  },
};
t('منتج خاص يغلب كل شي', () => eq(rscMarginInfo(s, cfg, 'g~itunes-us', 'Apple', 'p1'), { pct: 1.5, src: 'product' }));
t('قسم فرعي (iTunes US = 3%) يغلب البراند والمجموعة', () => eq(rscMarginInfo(s, cfg, 'g~itunes-us', 'Apple', 'zzz'), { pct: 3, src: 'category' }));
t('بقية منتجات Apple ما تتأثر: ترث البراند 6%', () => eq(rscMarginInfo(s, cfg, 'g~apple-other', ' APPLE ', 'x'), { pct: 6, src: 'brand' }));
t('بدون براند: ترث المجموعة (gift=8%)', () => eq(rscMarginInfo(s, cfg, 'g~apple-other', '', 'x'), { pct: 8, src: 'group' }));
t('مجموعة بلا هامش: ترث العام 10%', () => eq(rscMarginInfo(s, cfg, 'g~steam', 'Valve', null), { pct: 10, src: 'global' }));
t('قسم غير معرّف في الإعدادات: العام', () => eq(rscMarginInfo(s, cfg, 'g~nope', '', null), { pct: 10, src: 'global' }));
t('الهامش 0 هامش حقيقي (مو «فاضي»)', () => { const c2 = { cats: { 'g~a': { margin: 0, offers: {} } } }; eq(rscMarginInfo(s, c2, 'g~a', '', null), { pct: 0, src: 'category' }); });
t('قيم غير صالحة (سالب/نص/>300) تُتجاهل وترث', () => { const c2 = { cats: { 'g~a': { margin: -4, offers: { x: { m: 'abc' } } } } }; eq(rscMarginInfo(s, c2, 'g~a', '', 'x'), { pct: 10, src: 'global' }); assert.strictEqual(ctx.api.rscMNum(301), null); });
t('هامش المنتج وحده ما يعتبر «تسعير يدوي»', () => { assert.strictEqual(rscOfferOp(cfg.cats['g~itunes-us'], 'p1'), null); assert.ok(rscOfferOp(cfg.cats['g~itunes-us'], 'p2')); assert.ok(rscOfferOp(cfg.cats['g~itunes-us'], 'p3')); });
t('مثال الوثيقة: 10$ في iTunes US (3%) = 10.30$ والربح 0.30$', () => { const m = rscMarginInfo(s, cfg, 'g~itunes-us', 'Apple', 'any'); const price = rscSell(10, m.pct); assert.strictEqual(price, 10.3); assert.strictEqual(Math.round((price - 10) * 100) / 100, 0.3); });
console.log(`\n${n} tests passed`);
