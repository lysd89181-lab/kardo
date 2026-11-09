// اختبارات دوال الواجهة (تنظيف رابط SHEIN وأسماء الدول) — من app.js الحقيقي
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../app.js', 'utf8');
const grab = (re) => { const m = src.match(re); if (!m) throw new Error('missing ' + re); return m[0]; };
const code = [grab(/const shOkHost = [^\n]+/), grab(/function shClean\(text\) \{[\s\S]*?\n\}\n/), grab(/function rscNameParts\(name\) \{[\s\S]*?\n\}\n/)].join('\n');
const ctx = { URL, String, Set, Intl, Array, RegExp }; vm.createContext(ctx); vm.runInContext(code + '\nthis.api={shClean,rscNameParts};', ctx);
const { shClean, rscNameParts } = ctx.api; let n = 0; const t = (name, f) => { f(); n++; console.log('ok -', name); };
t('رسالة مشاركة SHEIN الطويلة تتحول لرابط نظيف فقط', () => {
  const msg = 'لقد وجدت بعض المنتجات الرائعة في شي إن! يمكنك الحصول عليها بخصم 🎁 https://onelink.shein.com/53/62iq4f9ff9cz?shc=2_RcGyFlOGYsS. اضغط للشراء!';
  assert.strictEqual(shClean(msg), 'https://onelink.shein.com/53/62iq4f9ff9cz?shc=2_RcGyFlOGYsS');
});
t('روابط shein.top مقبولة، ورابط غير SHEIN أو مزيّف يُحذف، والتكرار يُدمج', () => {
  assert.strictEqual(shClean('https://shein.top/abc123'), 'https://shein.top/abc123');
  assert.strictEqual(shClean('https://evil.com/shein.com https://shein.com.evil.io/x'), ''); assert.strictEqual(shClean('hello'), '');
  assert.strictEqual(shClean('https://us.shein.com/a-p-123456.html\nhttps://us.shein.com/a-p-123456.html'), 'https://us.shein.com/a-p-123456.html');
  assert.strictEqual(shClean('https://us.shein.com/a-p-1.html،'), 'https://us.shein.com/a-p-1.html');
});
t('اسم القسم مع الدولة: علم واسم عربي كامل بدل النص المقطوع', () => {
  const a = rscNameParts('App Store & iTunes (AE)'); assert.strictEqual(a.title, 'App Store & iTunes'); assert.strictEqual(a.cc, 'AE'); assert.strictEqual(a.flag, '🇦🇪');
  const b = rscNameParts('iTunes - US'); assert.strictEqual(b.cc, ''); assert.strictEqual(b.title, 'iTunes - US');
  const c = rscNameParts('PlayStation [US]'); assert.strictEqual(c.title, 'PlayStation'); assert.strictEqual(c.flag, '🇺🇸'); assert.strictEqual(rscNameParts('ببجي').title, 'ببجي');
});
console.log(`\n${n} passed`);
