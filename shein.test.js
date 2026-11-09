// اختبارات قسم SHEIN — الكود الحقيقي من worker.js مع محاكي لمزود الجلب ودفتر الأستاذ
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../worker.js', 'utf8');
const fn = (name) => {
  const one = src.match(new RegExp('^(?:async\\s+)?function\\s+' + name + '\\b[^\\n]*\\}[^\\n]*$', 'm'));
  if (one && !/\{\s*$/.test(one[0].replace(/\/\/.*$/, '').trimEnd())) return one[0];
  const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\b[\\s\\S]*?\\n\\}\\n')); if (!m) throw new Error('missing ' + name); return m[0]; };
const cst = (name) => { const m = src.match(new RegExp('const ' + name + ' = [^\\n]+')); if (!m) throw new Error('missing const ' + name); return m[0]; };
const code = ['masterKeyBytes', 'deriveRecordKey', 'encryptV2', 'decryptAny', 'decryptCard', 'getEncryptionKey', 'bytesToB64', 'b64ToBytes', 'httpError', 'num', 'round2', 'nowIso', 'randomSuffix',
  'sha256Hex', 'safeEqual', 'wRate', 'wFmt', 'wBalOf', 'userWallet', 'ledgerOpen', 'pushEntry', 'ledgerHash', 'ledgerPost', 'ledgerClose', 'spendPost', 'idemKeyOf', 'idemRead', 'idemWrite'].map(fn).join('\n')
  + '\n' + src.match(/let _WU = false, _WR = 11\.8;/)[0] + '\n' + cst('uAmt') + '\n' + cst('uBack') + '\n' + cst('WALLETS') + '\n' + cst('W_AR') + '\n' + cst('wOk') + '\n' + cst('IDEM_RE') + '\n' + src.slice(src.indexOf('const SH_ST'));

const db = new Map(), kv = new Map(), calls = [], notes = [], audits = [];
const clone = o => o == null ? null : JSON.parse(JSON.stringify(o));
const env = { CARD_MASTER_KEY: 'ef'.repeat(32), SHEIN_API_KEY: 'test-omkar-key-1234567890',
  KV: { async put(k, v) { kv.set(k, v); }, async get(k, t) { const v = kv.has(k) ? kv.get(k) : null; return v != null && t === 'json' ? JSON.parse(v) : v; }, async delete(k) { kv.delete(k); } } };
let settings; const resetSettings = () => { settings = { shein_on: true, shein_provider: 'auto', shein_host: 'https://shein-scraper.omkar.cloud', shein_rate: 10, shein_commission_pct: 10, shein_kg_lyd: 60, shein_deposit_pct: 50, shein_quote_min: 30, shein_month_cap: 180, wallets_on: true, usd_to_lyd: 10 }; }; resetSettings();
const cart = { items: [
  { goods_id: '1', name: 'فستان صيفي', image: 'https://img.ltwebstatic.com/a.jpg', selected_options: 'أزرق', options: ['أزرق', 'M'], availability: 'available', in_stock: true, stock: 50, link: 'https://ar.shein.com/product-p-1.html', pricing: { sale_price: { amount: 92, currency: 'USD', amount_usd: 92 }, retail_price: { amount: 100, currency: 'USD', amount_usd: 100 } } },
  { goods_id: '2', name: 'حقيبة', image: 'https://img.ltwebstatic.com/b.jpg', selected_options: 'أسود', availability: 'available', in_stock: true, stock: 5, pricing: { sale_price: { amount: 40, currency: 'SAR', amount_usd: 10.67 }, retail_price: { amount: 40, currency: 'SAR', amount_usd: 10.67 } } },
  { goods_id: '3', name: 'حذاء نافد', availability: 'out_of_stock', in_stock: false, stock: 0, pricing: { sale_price: { amount: 30, currency: 'USD' }, retail_price: { amount: 30, currency: 'USD' } } },
] };
let provider = { status: 200, body: cart };
const apifyItem = { goods_id: '515174062', name: 'فستان مخطط', link: 'https://us.shein.com/product-p-515174062.html', images: ['https://img.ltwebstatic.com/v4/j/spmp/a.jpg'], in_stock: true, stock: 20,
  pricing: { sale_price: { amount: 13.25, currency: 'USD' }, retail_price: { amount: 16.39, currency: 'USD' } }, colors: [{ name: 'أزرق وأبيض', goods_id: '515174062' }],
  sizes: [{ size: 'XS', stock: 20, in_stock: true, price: { amount: 13.25 } }, { size: 'L', stock: 5, in_stock: true, price: { amount: 14.5 } }, { size: 'XL', stock: 0, in_stock: false, price: { amount: 14.5 } }] };
let apify = { status: 201, body: [apifyItem] };
const PLINK = 'https://us.shein.com/product-p-515174062.html';
const fakeFetch = async (url, init = {}) => { const u = new URL(url); calls.push({ host: u.hostname, path: u.pathname, method: init.method || 'GET', link: u.searchParams.get('link'), currency: u.searchParams.get('currency'), key: init.headers && init.headers['API-Key'], auth: init.headers && init.headers.authorization, body: init.body ? JSON.parse(init.body) : null });
  if (u.hostname === 'api.apify.com') return { ok: apify.status < 400, status: apify.status, text: async () => JSON.stringify(apify.body) };
  return { ok: provider.status < 400, status: provider.status, text: async () => JSON.stringify(provider.body) }; };
const applyTx = (staged) => { for (const w of staged) { if (w.op === 'create') db.set(w.path, clone(w.data)); else db.set(w.path, { ...(db.get(w.path) || {}), ...clone(w.data) }); } };
const ctx = { Response, crypto: globalThis.crypto, TextEncoder, TextDecoder, atob, btoa, URL, AbortController, setTimeout, clearTimeout, console, Date, Math, JSON, Uint8Array, Promise, Object, Array, String, Number, Set, Map, RegExp, Error, encodeURIComponent, parseInt, isFinite: Number.isFinite, fetch: fakeFetch,
  fsGet: async (e, p) => clone(db.get(p)), fsPatch: async (e, p, d) => { db.set(p, { ...(db.get(p) || {}), ...clone(d) }); },
  fsQueryRaw: async (e, q) => { const coll = q.from[0].collectionId; const f = q.where && q.where.fieldFilter; return [...db.entries()].filter(([k]) => k.startsWith(coll + '/')).filter(([k, v]) => !f || v[f.field.fieldPath] === f.value.stringValue).map(([k, v]) => ({ _row: [k, v] })); },
  fsRunTransaction: async (e, f) => { const staged = []; const tx = { get: async p => clone(db.get(p)), create: (c, id, d) => { if (db.has(c + '/' + id) || staged.some(s => s.path === c + '/' + id)) { const er = new Error('ALREADY_EXISTS'); er.status = 409; throw er; } staged.push({ op: 'create', path: c + '/' + id, data: d }); }, update: (p, d) => staged.push({ op: 'update', path: p, data: d }) }; const r = await f(tx); applyTx(staged); return r; },
  getSettings: async () => ({ ...settings }), secGuard: async () => {}, assertLive: () => {}, assertEmailVerified: () => {}, memAllowWin: () => true, logOp: async (e, uid, a) => { audits.push(a); },
  requirePermission: async (user, e, perm) => { const st = { admin01: ['orders.view', 'orders.approve', 'settings.manage'], viewer1: ['orders.view'] }[user.uid]; if (!st || !st.includes(perm)) { const er = new Error('forbidden'); er.status = 403; throw er; } return { uid: user.uid }; },
  requireFreshAuth: () => {}, staffAlert: () => {}, notify: (e, uid, kind, v) => notes.push({ uid, kind, v }), background: () => {}, withId: (r) => ({ ...r._row[1], _id: r._row[0].split('/')[1] }), escHtml: s => s };
vm.createContext(ctx); vm.runInContext(code + '\nthis.api={shLinkOk,shCalc,handleSheinQuote,handleSheinOrder,handleSheinList,handleSheinGet,handleSheinCancel,handleSheinPay,handleAdminShein,shRefund,shHost,shParseInput};', ctx);
const A = ctx.api;
const U = 'userSH00000001', U2 = 'userSH00000002', LINK = 'https://onelink.shein.com/53/62iq4f9ff9cz?shc=2_RcGyFlOGYsS';
const reset = () => { apify = { status: 201, body: [apifyItem] }; db.clear(); kv.clear(); calls.length = 0; notes.length = 0; audits.length = 0; provider = { status: 200, body: cart }; resetSettings(); db.set('users/' + U, { name: 'منصور', default_wallet: 'ly', wallets: { ly: 2000 }, wallet_balance: 0 }); db.set('users/' + U2, { name: 'خالد', default_wallet: 'ly', wallets: { ly: 5 }, wallet_balance: 0 }); };
const rejects = async (p, status) => { try { await p; } catch (e) { assert.strictEqual(e.status, status, `status ${e.status} ${e.message}`); return e; } assert.fail('should reject ' + status); };
const idem = () => 'k' + Math.random().toString(36).slice(2).padEnd(20, 'x');
const quote = async (uid = U) => (await A.handleSheinQuote({ uid }, { link: LINK }, env));
// يحاكي حساب الواجهة (مستقل عن كود السيرفر)
const expectOf = (q, qty) => { let g = 0; q.items.forEach((it, i) => { const n = Math.max(0, Math.floor(Number(qty[i]) || 0)); if (n && it.avail) g = Math.round((g + it.sale * n * q.rate) * 100) / 100; }); return Math.round((g + Math.round(g * q.commission_pct) / 100) * 100) / 100; };
const order = async (q, qty, o = {}, uid = U) => A.handleSheinOrder({ uid }, { qid: q.qid, qty, expect_total: o.expect !== undefined ? o.expect : expectOf(q, qty), idempotency_key: o.key || idem() }, env);
const tests = []; const t = (n, f) => tests.push([n, f]);

t('الروابط: روابط shein.com الرسمية فقط، ويُرفض http والنطاقات المزيفة والمنافذ والبيانات داخل الرابط', async () => {
  for (const ok of ['https://onelink.shein.com/53/abc?shc=1', 'https://m.shein.com/ar/cart/share/landing?shc=1', 'https://shein.com/x']) assert.ok(A.shLinkOk(ok), ok);
  for (const bad of ['http://onelink.shein.com/a', 'https://shein.com.evil.com/a', 'https://evilshein.com/a', 'https://user:pw@onelink.shein.com/a', 'https://onelink.shein.com:8443/a', 'javascript:alert(1)', 'https://169.254.169.254/', 'ftp://shein.com', '', 'https://shein.com/' + 'a'.repeat(400)]) assert.strictEqual(A.shLinkOk(bad), '', bad);
});
t('عرض السعر: يُطلب من مزود Omkar بالمفتاح والعملة USD، وتظهر النافدة معطّلة، والسعر بعد العرض هو المعتمد', async () => {
  reset(); const q = await quote(); assert.strictEqual(calls[0].host, 'shein-scraper.omkar.cloud'); assert.strictEqual(calls[0].path, '/cart/products'); assert.strictEqual(calls[0].key, env.SHEIN_API_KEY); assert.strictEqual(calls[0].currency, 'USD'); assert.strictEqual(calls[0].link, LINK);
  assert.strictEqual(q.items.length, 3); assert.strictEqual(q.items[2].avail, false); assert.strictEqual(q.items[0].sale, 92); assert.strictEqual(q.items[0].retail, 100); assert.strictEqual(q.items[1].sale, 10.67); assert.ok(q.items[0].avail && q.items[1].avail);
});
t('الحساب مثل مثالك: سلة 92$ × سعر صرف 10 = 920 د.ل، + عمولة، والوزن غير داخل', async () => {
  reset(); settings.shein_commission_pct = 0; const q = await quote(); const r = await order(q, { 0: 1 }); assert.strictEqual(r.order.goods_lyd, 920); assert.strictEqual(r.order.total_lyd, 920); assert.strictEqual(r.order.shipping_lyd, 0);
  reset(); const q2 = await quote(); const r2 = await order(q2, { 0: 1 }); assert.strictEqual(r2.order.commission_lyd, 92); assert.strictEqual(r2.order.total_lyd, 1012); assert.strictEqual(r2.order.deposit_lyd, 506);
});
t('العربون يُخصم من محفظة الزبون مرة واحدة بقيد مرجعه الطلب', async () => {
  reset(); const q = await quote(); const r = await order(q, { 0: 1 }); assert.strictEqual(db.get('users/' + U).wallets.ly, 2000 - 506);
  const e = db.get('wallet_transactions/txn_sh_dep_' + r.order.id); assert.strictEqual(e.type, 'debit'); assert.strictEqual(e.amount, 506); assert.strictEqual(r.order.status, 'new');
});
t('تكرار نفس الطلب (نفس مفتاح العملية أو نفس عرض السعر) لا يخصم مرتين', async () => {
  reset(); const q = await quote(); const key = idem(); await order(q, { 0: 1 }, { key }); const rep = await order(q, { 0: 1 }, { key }); assert.strictEqual(rep.replayed, true);
  const again = await order(q, { 0: 1 }, { key: idem() }); assert.strictEqual(again.replayed, true); assert.strictEqual(again.order.id, rep.order.id); assert.strictEqual(db.get('users/' + U).wallets.ly, 2000 - 506); assert.strictEqual([...db.keys()].filter(k => k.startsWith('shein_orders/')).length, 1);
});
t('تلاعب بالسعر/الكمية: الحساب من السيرفر، والسعر المتوقع المختلف يُرفض، وكمية غير صالحة أو منتج نافد لا تُحتسب', async () => {
  reset(); const q = await quote(); await rejects(order(q, { 0: 1 }, { expect: 100 }), 409);
  await rejects(order(q, { 0: 0 }), 400); await rejects(order(q, { 5: 3 }), 400); await rejects(order(q, { 0: 'x' }), 400); await rejects(order(q, { 0: 99 }, { expect: 1 }), 400);
  const r = await order(q, { 0: 1, 1: -4, 2: 3 }); assert.strictEqual(r.order.items.length, 1); assert.strictEqual(r.order.items[0].qty, 1);
});
t('عرض سعر منتهي أو لزبون آخر أو غير موجود = رفض', async () => {
  reset(); const q = await quote(); await rejects(order(q, { 0: 1 }, {}, U2), 409); await rejects(A.handleSheinOrder({ uid: U }, { qid: 'ZZZZZZZZZZZZ', qty: { 0: 1 }, idempotency_key: idem() }, env), 409);
  const k = JSON.parse(kv.get('shq:' + q.qid)); k.exp = Date.now() - 1; kv.set('shq:' + q.qid, JSON.stringify(k)); await rejects(order(q, { 0: 1 }), 409);
});
t('رصيد غير كافٍ: لا طلب ولا قيد', async () => { reset(); const q = await quote(U2); await rejects(order(q, { 0: 1 }, {}, U2), 402); assert.strictEqual([...db.keys()].filter(k => k.startsWith('shein_orders/')).length, 0); assert.strictEqual(db.get('users/' + U2).wallets.ly, 5); });
t('الاعتماد على سعر الصرف المثبّت وقت العرض: لو تغيّر الإعداد بعد العرض ما يتأثر', async () => { reset(); const q = await quote(); settings.shein_rate = 20; const r = await order(q, { 0: 1 }); assert.strictEqual(r.order.goods_lyd, 920); });
t('مزود الجلب: أخطاء الحصة/المفتاح تعطي 503، وسلة فاضية أو رابط غير صالح 400، وخطأ 5xx يعطي 502', async () => {
  reset(); provider = { status: 429, body: { code: 'quota_exceeded' } }; await rejects(quote(), 503);
  provider = { status: 401, body: { code: 'invalid_api_key' } }; await rejects(quote(), 503);
  provider = { status: 502, body: { code: 'upstream_unavailable' } }; await rejects(quote(), 502);
  provider = { status: 400, body: {} }; await rejects(quote(), 400); provider = { status: 200, body: { items: [] } }; await rejects(quote(), 400);
  await rejects(A.handleSheinQuote({ uid: U }, { link: 'https://evil.com/x' }, env), 400);
});
t('حماية الاستخدام: نفس الرابط خلال 10 دقايق لا يستهلك طلب جديد من المزود، وسقف شهري يوقف الطلبات', async () => {
  reset(); await quote(); await quote(); assert.strictEqual(calls.length, 1);
  reset(); settings.shein_month_cap = 1; await quote(); db.set('x', {}); kv.forEach((v, k) => { if (k.startsWith('shu:')) kv.delete(k); }); await rejects(quote(), 503);
});
const apifyOn = async () => A.handleAdminShein({ uid: 'admin01' }, { action: 'set_key', which: 'apify', key: 'apify_api_testtoken1234567' }, env);
t('تحليل المدخلات: رابط سلة، أو روابط منتجات متعددة (تُدمج المكرر)، وروابط غير مسموحة تُهمل', async () => {
  assert.strictEqual(A.shParseInput(LINK).kind, 'cart'); const p = A.shParseInput(PLINK + '\n' + PLINK + '\nhttps://evil.com/x-p-999999.html\nhttps://us.shein.com/x-p-532398496.html');
  assert.strictEqual(p.kind, 'products'); assert.strictEqual(JSON.stringify(p.ids), JSON.stringify(['515174062', '532398496'])); assert.strictEqual(A.shParseInput('hello'), null); assert.strictEqual(A.shParseInput('https://evil.com/a-p-123456.html'), null);
});
t('رسالة مشاركة SHEIN الكاملة (عربي + رابط) وروابط shein.top: يُستخرج الرابط فقط', async () => {
  const msg = 'لقد وجدت بعض المنتجات الرائعة في شي إن! 🎁 ' + LINK + '. اضغط للشراء!'; const p = A.shParseInput(msg); assert.strictEqual(p.kind, 'cart'); assert.strictEqual(p.link, LINK);
  assert.strictEqual(A.shParseInput('https://shein.top/abc1234').kind, 'cart'); assert.strictEqual(A.shLinkOk('https://shein.top.evil.com/x'), '');
});
t('روابط المنتجات عبر Apify: الطلب الصحيح (Bearer + products)، والمقاسات النافدة تُستبعد، وسعر كل مقاس يُحسب', async () => {
  reset(); await apifyOn(); const q = await A.handleSheinQuote({ uid: U }, { link: PLINK }, env), c = calls.find(x => x.host === 'api.apify.com');
  assert.strictEqual(c.method, 'POST'); assert.strictEqual(c.path, '/v2/acts/omkar-cloud~shein-product-scraper/run-sync-get-dataset-items'); assert.strictEqual(c.auth, 'Bearer apify_api_testtoken1234567'); assert.strictEqual(JSON.stringify(c.body), JSON.stringify({ products: ['515174062'] }));
  assert.strictEqual(q.items.length, 1); assert.strictEqual(JSON.stringify(q.items[0].variants.map(v => v.n)), JSON.stringify(['XS', 'L'])); assert.strictEqual(q.items[0].options, 'أزرق وأبيض');
  const r = await A.handleSheinOrder({ uid: U }, { qid: q.qid, qty: { 0: 2 }, pick: { 0: 1 }, expect_total: Math.round((14.5 * 2 * 10 + Math.round(14.5 * 2 * 10 * 10) / 100) * 100) / 100, idempotency_key: idem() }, env);
  assert.strictEqual(r.order.goods_lyd, 290); assert.strictEqual(r.order.items[0].sale, 14.5); assert.ok(r.order.items[0].options.includes('L'));
});
t('مقاس غير صالح أو تلاعب بالمقاس يُرفض، والافتراضي أول مقاس', async () => {
  reset(); await apifyOn(); const q = await A.handleSheinQuote({ uid: U }, { link: PLINK }, env);
  await rejects(A.handleSheinOrder({ uid: U }, { qid: q.qid, qty: { 0: 1 }, pick: { 0: 7 }, expect_total: 1, idempotency_key: idem() }, env), 400);
  const r = await A.handleSheinOrder({ uid: U }, { qid: q.qid, qty: { 0: 1 }, expect_total: 145.75, idempotency_key: idem() }, env); assert.strictEqual(r.order.goods_lyd, 132.5);
});
t('المزودات: Apify بدون مفتاح = 503، فرض مزود لا يقبل نوع الرابط = 400، وعند تعطّل Omkar تظهر نصيحة لصق روابط المنتجات', async () => {
  reset(); await rejects(A.handleSheinQuote({ uid: U }, { link: PLINK }, env), 503);
  await apifyOn(); settings.shein_provider = 'apify'; await rejects(A.handleSheinQuote({ uid: U }, { link: LINK }, env), 400); settings.shein_provider = 'omkar'; await rejects(A.handleSheinQuote({ uid: U }, { link: PLINK }, env), 400);
  settings.shein_provider = 'auto'; provider = { status: 502, body: {} }; const e = await rejects(A.handleSheinQuote({ uid: U }, { link: LINK }, env), 502); assert.ok(e.publicMessage.includes('روابط المنتجات'));
  apify = { status: 429, body: {} }; await rejects(A.handleSheinQuote({ uid: U }, { link: PLINK }, env), 503); apify = { status: 201, body: [] }; await rejects(A.handleSheinQuote({ uid: U }, { link: PLINK }, env), 400);
});
t('قسم مغلق أو بدون سعر صرف: يُرفض', async () => { reset(); settings.shein_on = false; await rejects(quote(), 403); reset(); settings.shein_rate = 0; await rejects(quote(), 503); });
t('عنوان المزود: لا يقبل غير https على omkar.cloud (حماية SSRF)', async () => { reset(); for (const h of ['https://evil.com', 'http://x.omkar.cloud', 'https://omkar.cloud.evil.com']) { settings.shein_host = h; await rejects(quote(), 503); } });
t('إلغاء الزبون قبل الشراء يرجّع العربون مرة واحدة فقط؛ وبعد بدء الشراء ممنوع', async () => {
  reset(); const q = await quote(); const r = await order(q, { 0: 1 }); await A.handleSheinCancel({ uid: U }, { id: r.order.id }, env); assert.strictEqual(db.get('users/' + U).wallets.ly, 2000);
  await rejects(A.handleSheinCancel({ uid: U }, { id: r.order.id }, env), 409); assert.strictEqual(db.get('users/' + U).wallets.ly, 2000); assert.ok(notes.some(n => n.kind === 'sh_refund'));
  reset(); const q2 = await quote(); const r2 = await order(q2, { 0: 1 }); await A.handleAdminShein({ uid: 'admin01' }, { action: 'status', id: r2.order.id, to: 'purchasing' }, env); await rejects(A.handleSheinCancel({ uid: U }, { id: r2.order.id }, env), 409);
});
t('زبون آخر لا يرى ولا يلغي ولا يدفع طلبك', async () => { reset(); const q = await quote(); const r = await order(q, { 0: 1 }); await rejects(A.handleSheinGet({ uid: U2 }, { id: r.order.id }, env), 404); await rejects(A.handleSheinCancel({ uid: U2 }, { id: r.order.id }, env), 404); await rejects(A.handleSheinGet({ uid: U }, { id: '../users/x' }, env), 400); assert.strictEqual((await A.handleSheinList({ uid: U2 }, {}, env)).list.length, 0); });
t('مسار الحالات: لا يُقفز بين الحالات، والوزن بعد وصول السلة يضيف 60 د.ل لكل كيلو ويطلب الدفع النهائي', async () => {
  reset(); const q = await quote(); const r = await order(q, { 0: 1 }), id = r.order.id, adm = { uid: 'admin01' };
  await rejects(A.handleAdminShein(adm, { action: 'status', id, to: 'arrived' }, env), 409); await rejects(A.handleAdminShein(adm, { action: 'weight', id, kg: 2 }, env), 409);
  for (const to of ['purchasing', 'purchased']) await A.handleAdminShein(adm, { action: 'status', id, to }, env);
  const w = await A.handleAdminShein(adm, { action: 'weight', id, kg: 2.5 }, env); assert.strictEqual(w.shipping_lyd, 150);
  const g = (await A.handleSheinGet({ uid: U }, { id }, env)).order; assert.strictEqual(g.status, 'awaiting_final'); assert.strictEqual(g.remaining_lyd, 1012 + 150 - 506); assert.ok(notes.some(n => n.kind === 'sh_final'));
  await rejects(A.handleAdminShein(adm, { action: 'weight', id, kg: 0 }, env), 400); await rejects(A.handleAdminShein(adm, { action: 'weight', id, kg: 500 }, env), 400);
});
t('الدفع النهائي: يخصم المتبقي مرة واحدة (حتى مع تكرار) ويكمل الطلب، ومبلغ قديم يُرفض', async () => {
  reset(); const q = await quote(); const r = await order(q, { 0: 1 }), id = r.order.id, adm = { uid: 'admin01' };
  for (const to of ['purchasing', 'purchased']) await A.handleAdminShein(adm, { action: 'status', id, to }, env); await A.handleAdminShein(adm, { action: 'weight', id, kg: 1 }, env);
  const rem = 1012 + 60 - 506; await rejects(A.handleSheinPay({ uid: U }, { id, expect: rem + 40, idempotency_key: idem() }, env), 409);
  const key = idem(); const p = await A.handleSheinPay({ uid: U }, { id, expect: rem, idempotency_key: key }, env); assert.strictEqual(p.order.status, 'ready'); assert.strictEqual(db.get('users/' + U).wallets.ly, 2000 - 506 - rem);
  const again = await A.handleSheinPay({ uid: U }, { id, expect: rem, idempotency_key: key }, env); assert.strictEqual(again.replayed, true); await rejects(A.handleSheinPay({ uid: U }, { id, expect: rem, idempotency_key: idem() }, env), 409);
  assert.strictEqual(db.get('users/' + U).wallets.ly, 2000 - 506 - rem);
});
t('إلغاء الإدارة بعد دفع نهائي يرجّع العربون والدفعة النهائية معًا ولا يتكرر', async () => {
  reset(); const q = await quote(); const r = await order(q, { 0: 1 }), id = r.order.id, adm = { uid: 'admin01' };
  for (const to of ['purchasing', 'purchased']) await A.handleAdminShein(adm, { action: 'status', id, to }, env); await A.handleAdminShein(adm, { action: 'weight', id, kg: 1 }, env); await A.handleSheinPay({ uid: U }, { id, expect: 566, idempotency_key: idem() }, env);
  await rejects(A.handleAdminShein(adm, { action: 'cancel', id, reason: 'x' }, env), 400);
  assert.strictEqual(db.get('users/' + U).wallets.ly, 2000 - 1072);
  await A.handleAdminShein(adm, { action: 'cancel', id, reason: 'المنتج غير متوفر' }, env); assert.strictEqual(db.get('users/' + U).wallets.ly, 2000);
  await rejects(A.handleAdminShein(adm, { action: 'cancel', id, reason: 'مرة ثانية' }, env), 409); assert.strictEqual(db.get('users/' + U).wallets.ly, 2000);
  assert.strictEqual([...db.keys()].filter(k => k.startsWith('wallet_transactions/txn_sh_ref')).length, 2);
});
t('تعديل سعر المنتج من الإدارة (قبل الشراء فقط) يعيد حساب الإجمالي ويُسجَّل', async () => {
  reset(); const q = await quote(); const r = await order(q, { 0: 1 }), id = r.order.id, adm = { uid: 'admin01' };
  const rp = await A.handleAdminShein(adm, { action: 'reprice', id, i: 0, sale: 95 }, env); assert.strictEqual(rp.total_lyd, 1045); assert.ok(audits.includes('shein.reprice'));
  await rejects(A.handleAdminShein(adm, { action: 'reprice', id, i: 0, sale: -1 }, env), 400); await rejects(A.handleAdminShein(adm, { action: 'reprice', id, i: 9, sale: 5 }, env), 400);
  for (const to of ['purchasing', 'purchased']) await A.handleAdminShein(adm, { action: 'status', id, to }, env); await rejects(A.handleAdminShein(adm, { action: 'reprice', id, i: 0, sale: 90 }, env), 409);
});
t('صلاحيات الأدمن: المشاهد لا يعدّل، وضبط المفتاح لـ settings.manage فقط ولا يظهر في الحالة', async () => {
  reset(); const q = await quote(); const r = await order(q, { 0: 1 }); await rejects(A.handleAdminShein({ uid: 'viewer1' }, { action: 'status', id: r.order.id, to: 'purchasing' }, env), 403); await rejects(A.handleAdminShein({ uid: U }, { action: 'list' }, env), 403);
  await rejects(A.handleAdminShein({ uid: 'viewer1' }, { action: 'set_key', key: 'abcdefghijklmnop' }, env), 403); await A.handleAdminShein({ uid: 'admin01' }, { action: 'set_key', key: 'new-key-abcdefghijk' }, env);
  assert.ok(kv.get('shein:apikey').startsWith('v2:') && !kv.get('shein:apikey').includes('new-key')); const cfg = await A.handleAdminShein({ uid: 'admin01' }, { action: 'cfg' }, env); assert.ok(!JSON.stringify(cfg).includes('new-key')); assert.strictEqual(cfg.has_key, true);
});
(async () => { let ok = 0; for (const [n, f] of tests) { try { await f(); ok++; console.log('ok -', n); } catch (e) { console.log('FAIL -', n, '\n   ', (e.stack || e.message).split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; } } console.log(`\n${ok}/${tests.length} passed`); })();
