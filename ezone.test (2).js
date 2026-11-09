// اختبارات Ezone Pay — تشغّل الكود الحقيقي من worker.js مع محاكي للبوابة وقاعدة بيانات/دفتر أستاذ في الذاكرة
const fs = require('fs'), vm = require('vm'), assert = require('assert'), nodeCrypto = require('crypto');
const src = fs.readFileSync(__dirname + '/../worker.js', 'utf8');
const fn = (name) => {
  const one = src.match(new RegExp('^(?:async\\s+)?function\\s+' + name + '\\b[^\\n]*\\}[^\\n]*$', 'm'));
  if (one && !/\{\s*$/.test(one[0].replace(/\/\/.*$/, '').trimEnd())) return one[0];
  const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\b[\\s\\S]*?\\n\\}\\n')); if (!m) throw new Error('missing ' + name); return m[0]; };
const cst = (name) => { const m = src.match(new RegExp('const ' + name + ' = [^\\n]+')); if (!m) throw new Error('missing const ' + name); return m[0]; };
const code = ['masterKeyBytes', 'deriveRecordKey', 'encryptV2', 'decryptAny', 'decryptCard', 'getEncryptionKey', 'bytesToB64', 'b64ToBytes', 'b64urlToBytes', 'httpError', 'num', 'round2', 'nowIso', 'randomSuffix',
  'sha256Hex', 'safeEqual', 'money', 'wRate', 'wFmt', 'wBalOf', 'methodWallet', 'depWallet', 'ledgerOpen', 'pushEntry', 'ledgerHash', 'ledgerPost', 'ledgerClose'].map(fn).join('\n')
  + '\n' + src.match(/let _WU = false, _WR = 11\.8;/)[0] + '\n' + cst('uAmt') + '\n' + cst('uBack') + '\n' + cst('WALLETS') + '\n' + cst('W_AR') + '\n' + cst('wOk') + '\n' + src.slice(src.indexOf('const KYC_FILES'));

const db = new Map(), kv = new Map(), calls = [], notes = [];
const clone = o => o == null ? null : JSON.parse(JSON.stringify(o));
const SECRET = 'whsec-test-0123456789abcdef0123456789';
const env = { CARD_MASTER_KEY: 'cd'.repeat(32), EZONE_API_KEY: 'epk_Hk3xQ9aT.bWFnaWNyYW5kb21zZWNyZXR2YWx1ZWdvZXNoZXJl0123', EZONE_WEBHOOK_SECRET: SECRET,
  KV: { async put(k, v) { kv.set(k, v); }, async get(k) { return kv.has(k) ? kv.get(k) : null; }, async delete(k) { kv.delete(k); } } };
let settings = {}; const resetSettings = () => { settings = { ezone_on: true, ezone_env: 'sandbox', ezone_libyana_ids: '1', ezone_bank_ids: '2,3', ezone_min: 5, ezone_max: 5000, ezone_expire_min: 30, rate_libyana: 11.8, rate_bank: 9.5, wallets_on: true }; }; resetSettings();

// ── محاكي Ezone ──
const ez = { links: new Map(), nextId: 100, down: false, methods: [{ Id: 1, Name: 'Libyana' }, { Id: 2, Name: 'Sadad' }, { Id: 3, Name: 'MasrifiPay' }, { Id: 4, Name: 'Edfali' }] };
const fakeFetch = async (url, init = {}) => {
  const u = new URL(url), path = u.pathname, method = init.method || 'GET'; calls.push({ method, path, host: u.hostname, key: init.headers && init.headers['X-API-Key'], body: init.body ? JSON.parse(init.body) : null });
  if (ez.down) return { ok: false, status: 503, text: async () => '' };
  const ok = d => ({ ok: true, status: 200, text: async () => JSON.stringify(d) });
  if (!['test.ezonepay.ly', 'api.ezonepay.ly'].includes(u.hostname)) return { ok: false, status: 404, text: async () => '' };
  if (path === '/LookUp/paymentMethods') return ok(ez.methods);
  if (path === '/payment-link/new') { const id = ez.nextId++, b = JSON.parse(init.body); ez.links.set(id, { req: b, paid: 0, uses: 0 }); return ok({ Id: id, Link: 'https://pay.ezonepay.ly/l/' + id, OrderReference: b.OrderReference }); }
  const m = path.match(/^\/payment-link\/(\d+)$/); if (m) { const l = ez.links.get(Number(m[1])); if (!l) return { ok: false, status: 404, text: async () => '' }; return ok({ Id: Number(m[1]), OrderReference: l.orderRef || l.req.OrderReference, TotalAmountPaid: l.paid, CurrentUsageCount: l.uses, Amount: l.req.Amount }); }
  if (path === '/Webhook/subscribe') return ok({ Id: 1, Event: 2, Url: JSON.parse(init.body).Url, SecretKey: 'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA==' });
  return { ok: false, status: 404, text: async () => '' };
};

const applyTx = (staged) => { for (const w of staged) { if (w.op === 'create') db.set(w.path, clone(w.data)); else db.set(w.path, { ...(db.get(w.path) || {}), ...clone(w.data) }); } };
const ctx = { Response, Request, crypto: globalThis.crypto, TextEncoder, TextDecoder, atob, btoa, URL, AbortController, setTimeout, clearTimeout, console, Date, Math, JSON, Uint8Array, Promise, Object, Array, String, Number, Set, Map, RegExp, Error, encodeURIComponent, parseInt, isFinite: Number.isFinite,
  fetch: fakeFetch, API_ORIGIN_DEFAULT: 'https://kardo.example.workers.dev',
  docPath: (e, p) => p, toFsFields: o => o,
  fsGet: async (e, p) => clone(db.get(p)), fsSet: async (e, p, d) => { db.set(p, clone(d)); }, fsPatch: async (e, p, d) => { db.set(p, { ...(db.get(p) || {}), ...clone(d) }); }, fsDelete: async (e, p) => { db.delete(p); },
  fsCommit: async (e, writes) => { for (const w of writes) { const p = w.update.name; if (w.currentDocument && w.currentDocument.exists === false && db.has(p)) { const er = new Error('ALREADY_EXISTS'); er.status = 409; throw er; } db.set(p, clone(w.update.fields)); } },
  fsQueryRaw: async (e, q) => { const coll = q.from[0].collectionId; const fl = !q.where ? [] : q.where.fieldFilter ? [q.where.fieldFilter] : q.where.compositeFilter.filters.map(f => f.fieldFilter);
    return [...db.entries()].filter(([k]) => k.startsWith(coll + '/')).filter(([k, v]) => fl.every(f => v[f.field.fieldPath] === f.value.stringValue)).slice(0, q.limit || 100).map(([k, v]) => ({ _row: [k, v] })); },
  fsRunTransaction: async (e, f) => { const staged = []; const tx = { get: async p => clone(db.get(p)), create: (c, id, d) => { if (db.has(c + '/' + id) || staged.some(s => s.path === c + '/' + id)) { const er = new Error('ALREADY_EXISTS'); er.status = 409; throw er; } staged.push({ op: 'create', path: c + '/' + id, data: d }); }, update: (p, d) => staged.push({ op: 'update', path: p, data: d }) }; const r = await f(tx); applyTx(staged); return r; },
  getSettings: async () => ({ ...settings }), secGuard: async () => {}, assertMoneyVerified: () => {}, assertLive: () => {}, depLimitCheck: () => {}, checkRateLimit: async () => true, memAllowWin: () => true, ipAllow: () => true,
  logOp: async () => {}, requirePermission: async () => ({ uid: 'adminUser0001' }), requireFreshAuth: () => {}, background: () => {}, staffAlert: () => {}, notify: (e, uid, kind) => notes.push({ uid, kind }), promoFirstDeposit: async () => {},
  withId: (r) => ({ ...r._row[1], _id: r._row[0].split('/')[1] }), getStaff: async () => null, staffCan: () => false, handleKycSubmit: undefined,
};
vm.createContext(ctx); vm.runInContext(code + '\nthis.api={handleEzoneMethods,handleEzoneStart,handleEzoneStatus,handleEzoneWebhook,ezoneVerifyAndCredit,ezoneCron,handleAdminEzone,ezSign,ezExcluded,kycStatusOf};', ctx);
const A = ctx.api;

const U = 'userEZ00000001', U2 = 'userEZ00000002';
const resetAll = () => { db.clear(); kv.clear(); calls.length = 0; notes.length = 0; ez.links.clear(); ez.down = false; ez.methods = [{ Id: 1, Name: 'Libyana' }, { Id: 2, Name: 'Sadad' }, { Id: 3, Name: 'MasrifiPay' }, { Id: 4, Name: 'Edfali' }]; resetSettings();
  db.set('users/' + U, { name: 'منصور أحمد', wallet_balance: 0, wallets: {} }); db.set('users/' + U2, { name: 'خالد علي', wallet_balance: 0, wallets: {} }); ctx.api && (ctx.api._reset = 1); };
const rejects = async (p, status, code) => { try { await p; } catch (e) { assert.strictEqual(e.status, status, `status ${e.status} ${e.message}`); if (code) assert.strictEqual(e.code, code); return e; } assert.fail('should reject ' + status); };
const sigOf = (raw) => nodeCrypto.createHmac('sha256', SECRET).update(raw).digest('base64');      // تنفيذ مستقل مطابق لمثال Node في الوثيقة
const hook = (obj, sig) => { const raw = typeof obj === 'string' ? obj : JSON.stringify(obj); return new Request('https://w.example/api/ezone/webhook', { method: 'POST', headers: { 'x-signature': sig === undefined ? sigOf(raw) : sig, 'content-type': 'application/json' }, body: raw }); };
const start = async (uid = U, o = {}) => A.handleEzoneStart({ uid }, { method: 'libyana', amount: 50, phone: '0912345678', ...o }, env);
const linkOf = ref => ez.links.get(Number(db.get('ezone_payments/' + ref).link_id));
const approveKyc = uid => db.set('kyc/' + uid, { status: 'approved' });

const tests = []; const t = (n, f) => tests.push([n, f]);
t('توقيع الـ webhook: تنفيذنا = مثال Node في الوثيقة (Base64 HMAC-SHA256 على النص الخام)', async () => { resetAll(); const raw = '{"event":2,"transactionId":12345,"transactionType":"online","orderReference":"ORDER-2025-001","updatedUtc":"2025-01-15T10:30:00Z"}'; assert.strictEqual(await A.ezSign(SECRET, raw), sigOf(raw)); });
t('بدء دفع ليبيانا: رابط لمرة واحدة، بدون استبعاد ليبيانا، واستبعاد كل البنوك، ومبلغ ومرجع صحيحان، وحقل المفتاح مُرسَل', async () => {
  resetAll(); const r = await start(); const l = linkOf(r.ref), b = l.req;
  assert.ok(/^EZ\d{13}[A-Z0-9]{6}$/.test(r.ref)); assert.strictEqual(b.OrderReference, r.ref); assert.strictEqual(b.IsUniqueOrderReference, true); assert.strictEqual(b.MaxUsageCount, 1); assert.strictEqual(b.Amount, 50); assert.strictEqual(b.Currency, 1);
  assert.strictEqual(JSON.stringify(b.ExcludedPaymentMethods.slice().sort()), JSON.stringify([2, 3, 4])); assert.ok(!b.ExcludedPaymentMethods.includes(1));
  assert.strictEqual(b.Customer.PhoneNumber, '0912345678'); assert.ok(calls.every(c => c.key === env.EZONE_API_KEY)); assert.ok(r.url.startsWith('https://pay.ezonepay.ly/'));
  assert.strictEqual(db.get('ezone_payments/' + r.ref).status, 'pending');
});
t('البنك لغير الموثّق: يُرفض في السيرفر بـ KYC_REQUIRED ولا يُنشأ رابط ولا سجل', async () => {
  resetAll(); const e = await rejects(start(U, { method: 'bank' }), 403, 'KYC_REQUIRED'); assert.ok(!calls.some(c => c.path === '/payment-link/new')); assert.strictEqual([...db.keys()].filter(k => k.startsWith('ezone_payments/')).length, 0);
  db.set('kyc/' + U, { status: 'pending' }); await rejects(start(U, { method: 'bank' }), 403, 'KYC_REQUIRED');
  db.set('kyc/' + U, { status: 'rejected' }); await rejects(start(U, { method: 'bank' }), 403, 'KYC_REQUIRED');
});
t('البنك للموثّق: يُنشأ الرابط ويُستبعد منه ليبيانا (Libyana id=1) لا العكس', async () => {
  resetAll(); approveKyc(U); const r = await start(U, { method: 'bank', amount: 100 }); const b = linkOf(r.ref).req;
  assert.strictEqual(JSON.stringify(b.ExcludedPaymentMethods.slice().sort()), JSON.stringify([1, 4])); assert.ok(!b.ExcludedPaymentMethods.includes(2) && !b.ExcludedPaymentMethods.includes(3));
});
t('اختيار وسيلة بعينها (method_id): الرابط يسمح بها وحدها، وليبيانا بدون توثيق، والبنك يحتاج توثيق، ورقم غير مصرّح مرفوض', async () => {
  resetAll(); let r = await start(U, { method: undefined, method_id: 1 }); assert.strictEqual(db.get('ezone_payments/' + r.ref).kind, 'libyana'); assert.strictEqual(JSON.stringify(linkOf(r.ref).req.ExcludedPaymentMethods.slice().sort()), JSON.stringify([2, 3, 4]));
  await rejects(start(U, { method: undefined, method_id: 3 }), 403); approveKyc(U);
  r = await start(U, { method: undefined, method_id: 3 }); assert.strictEqual(db.get('ezone_payments/' + r.ref).kind, 'bank'); assert.strictEqual(JSON.stringify(linkOf(r.ref).req.ExcludedPaymentMethods.slice().sort()), JSON.stringify([1, 2, 4]));
  await rejects(start(U, { method: undefined, method_id: 4 }), 400); await rejects(start(U, { method: undefined, method_id: 999 }), 400);
});
t('قائمة الوسائل للواجهة: فقط المفعّل من الأدمن، بأسماء وشعارات، وفاضية لو الدفع مغلق', async () => {
  resetAll(); ez.methods = ez.methods.map(m => ({ ...m, LogoUrl: 'https://cdn.ezonepay.ly/l/' + m.Id + '.png' })); const m = await A.handleEzoneMethods({ uid: U }, {}, env);
  assert.strictEqual(m.libyana.length, 1); assert.strictEqual(m.bank.length, 2); assert.ok(m.bank.every(x => x.logo.startsWith('https://')) && !JSON.stringify(m).includes('Edfali'));
  settings.ezone_on = false; const off = await A.handleEzoneMethods({ uid: U }, {}, env); assert.strictEqual(off.bank.length + off.libyana.length, 0);
});
t('فشل جلب قائمة الطرق أو إعداد خاطئ = لا رابط (لا يُفتح شي بالغلط)', async () => {
  resetAll(); ez.down = true; await rejects(start(), 502); assert.ok(!calls.some(c => c.path === '/payment-link/new'));
  resetAll(); settings.ezone_libyana_ids = ''; await rejects(start(), 503);
  resetAll(); settings.ezone_libyana_ids = '99'; await rejects(start(), 503);
  resetAll(); settings.ezone_libyana_ids = '1,2'; await rejects(start(), 503);          // تداخل مع البنوك
  resetAll(); settings.ezone_on = false; await rejects(start(), 403);
});
t('مدخلات الإيداع: مبلغ/هاتف/طريقة غير صالحة تُرفض', async () => {
  resetAll(); await rejects(start(U, { amount: 1 }), 400); await rejects(start(U, { amount: 999999 }), 400); await rejects(start(U, { amount: 'abc' }), 400); await rejects(start(U, { phone: '123' }), 400); await rejects(start(U, { method: 'crypto' }), 400);
  assert.strictEqual(calls.filter(c => c.path === '/payment-link/new').length, 0);
});
t('webhook: توقيع خاطئ/مفقود/معدّل → 401 ولا إضافة رصيد', async () => {
  resetAll(); const r = await start(); const l = linkOf(r.ref); l.paid = 50; l.uses = 1; const p = { event: 2, transactionId: 777, transactionType: 'online', orderReference: r.ref, updatedUtc: new Date().toISOString() };
  await rejects(A.handleEzoneWebhook(hook(p, 'AAAA'), env), 401); await rejects(A.handleEzoneWebhook(hook(p, ''), env), 401);
  const raw = JSON.stringify(p), sig = sigOf(raw); await rejects(A.handleEzoneWebhook(hook(raw.replace('777', '778'), sig), env), 401);
  assert.strictEqual(db.get('users/' + U).wallets.ly || 0, 0); assert.strictEqual(db.get('ezone_payments/' + r.ref).status, 'pending');
});
t('بدون سر توقيع مهيّأ: لا معالجة (503)', async () => { resetAll(); const old = env.EZONE_WEBHOOK_SECRET; delete env.EZONE_WEBHOOK_SECRET; await rejects(A.handleEzoneWebhook(hook({ event: 2, transactionId: 1, orderReference: 'x' }), env), 503); env.EZONE_WEBHOOK_SECRET = old; });
t('webhook موقّع لكن الدفع غير مؤكَّد من البوابة → لا يُضاف رصيد (لا نثق بالإشعار وحده)', async () => {
  resetAll(); const r = await start(); const res = await A.handleEzoneWebhook(hook({ event: 2, transactionId: 801, transactionType: 'online', orderReference: r.ref, updatedUtc: 'x' }), env);
  assert.strictEqual(res.status, 'pending'); assert.strictEqual(db.get('ezone_payments/' + r.ref).status, 'pending'); assert.strictEqual(db.get('users/' + U).wallets.ly || 0, 0);
});
t('دفع حقيقي مؤكَّد: يُضاف المبلغ المطلوب بالضبط لمحفظة ليبيانا، قيد مرجعه الطلب، وإيداع approved، وإشعار', async () => {
  resetAll(); const r = await start(U, { amount: 50 }); const l = linkOf(r.ref); l.paid = 50; l.uses = 1;
  const res = await A.handleEzoneWebhook(hook({ event: 2, transactionId: 900, transactionType: 'online', orderReference: r.ref, updatedUtc: 'x' }), env); assert.strictEqual(res.status, 'paid');
  assert.strictEqual(db.get('users/' + U).wallets.ly, 50); assert.strictEqual(db.get('ezone_payments/' + r.ref).status, 'paid');
  const dep = db.get('wallet_deposits/EZP_' + r.ref); assert.strictEqual(dep.status, 'approved'); assert.strictEqual(dep.amount_lyd, 50); assert.strictEqual(dep.uid, U);
  const e = db.get('wallet_transactions/txn_ez_' + r.ref); assert.strictEqual(e.type, 'credit'); assert.strictEqual(e.amount, 50); assert.strictEqual(e.reference, r.ref); assert.ok(notes.some(n => n.uid === U && n.kind === 'deposit_ok'));
});
t('تكرار الإشعار (نفس transactionId) وإشعار بمعرّف مختلف لنفس الطلب: لا يضاعف الرصيد', async () => {
  resetAll(); const r = await start(U, { amount: 50 }); const l = linkOf(r.ref); l.paid = 50; l.uses = 1;
  const p = { event: 2, transactionId: 901, transactionType: 'online', orderReference: r.ref, updatedUtc: 'x' };
  await A.handleEzoneWebhook(hook(p), env); const d = await A.handleEzoneWebhook(hook(p), env); assert.strictEqual(d.duplicate, true);
  await A.handleEzoneWebhook(hook({ ...p, transactionId: 902 }), env); await A.ezoneVerifyAndCredit(env, r.ref, 'cron'); await A.ezoneVerifyAndCredit(env, r.ref, 'poll');
  assert.strictEqual(db.get('users/' + U).wallets.ly, 50); assert.strictEqual([...db.keys()].filter(k => k.startsWith('wallet_transactions/')).length, 1);
});
t('تزامن: عدة تحققات متوازية لنفس الطلب تضيف الرصيد مرة واحدة فقط', async () => {
  resetAll(); const r = await start(U, { amount: 80 }); const l = linkOf(r.ref); l.paid = 80; l.uses = 1;
  await Promise.all([1, 2, 3, 4].map(i => A.ezoneVerifyAndCredit(env, r.ref, 'race' + i).catch(() => null))); assert.strictEqual(db.get('users/' + U).wallets.ly, 80);
});
t('مبلغ مدفوع أقل من المطلوب → لا اعتماد، وأكثر من المطلوب → مراجعة يدوية بدون إضافة', async () => {
  resetAll(); let r = await start(U, { amount: 50 }); linkOf(r.ref).paid = 20; linkOf(r.ref).uses = 1; assert.strictEqual((await A.ezoneVerifyAndCredit(env, r.ref, 'cron')).status, 'pending'); assert.strictEqual(db.get('users/' + U).wallets.ly || 0, 0);
  linkOf(r.ref).paid = 75; assert.strictEqual((await A.ezoneVerifyAndCredit(env, r.ref, 'cron')).status, 'review'); assert.strictEqual(db.get('users/' + U).wallets.ly || 0, 0); assert.strictEqual(db.get('ezone_payments/' + r.ref).review, 'overpaid');
});
t('مرجع طلب الرابط عند البوابة لا يطابق سجلّنا → مراجعة بدون إضافة', async () => { resetAll(); const r = await start(); const l = linkOf(r.ref); l.paid = 50; l.uses = 1; l.orderRef = 'EZ0000000000000AAAAAA'; assert.strictEqual((await A.ezoneVerifyAndCredit(env, r.ref, 'cron')).status, 'review'); assert.strictEqual(db.get('users/' + U).wallets.ly || 0, 0); });
t('بنك: إذا سُحب التوثيق قبل التأكيد → مراجعة بدون إضافة', async () => { resetAll(); approveKyc(U); const r = await start(U, { method: 'bank', amount: 95 }); linkOf(r.ref).paid = 95; linkOf(r.ref).uses = 1; db.set('kyc/' + U, { status: 'resubmit' });
  assert.strictEqual((await A.ezoneVerifyAndCredit(env, r.ref, 'webhook')).status, 'review'); assert.strictEqual(db.get('users/' + U).wallets.bk || 0, 0); });
t('بنك مدفوع لموثّق: يُضاف لمحفظة المصرف المبلغ بالدينار', async () => { resetAll(); approveKyc(U); const r = await start(U, { method: 'bank', amount: 95 }); linkOf(r.ref).paid = 95; linkOf(r.ref).uses = 1; assert.strictEqual((await A.ezoneVerifyAndCredit(env, r.ref, 'webhook')).status, 'paid'); assert.strictEqual(db.get('users/' + U).wallets.bk, 95); });
t('انتهاء المهلة بدون دفع → expired، وبعدها لا يُعتمد أي دفع متأخر تلقائيًا', async () => { resetAll(); const r = await start(); db.set('ezone_payments/' + r.ref, { ...db.get('ezone_payments/' + r.ref), expires_at: new Date(Date.now() - 3600000).toISOString() });
  assert.strictEqual((await A.ezoneVerifyAndCredit(env, r.ref, 'cron')).status, 'expired'); linkOf(r.ref).paid = 50; linkOf(r.ref).uses = 1; assert.strictEqual((await A.ezoneVerifyAndCredit(env, r.ref, 'cron')).status, 'expired'); assert.strictEqual(db.get('users/' + U).wallets.ly || 0, 0); });
t('انقطاع البوابة أثناء معالجة webhook → 503 (لإعادة الإرسال) ويُحذف سجل الحدث ثم ينجح عند الإعادة', async () => {
  resetAll(); const r = await start(); const l = linkOf(r.ref); l.paid = 50; l.uses = 1; const p = { event: 2, transactionId: 950, transactionType: 'online', orderReference: r.ref, updatedUtc: 'x' };
  ez.down = true; await rejects(A.handleEzoneWebhook(hook(p), env), 503); assert.ok(!db.has('ezone_events/950_2')); ez.down = false; assert.strictEqual((await A.handleEzoneWebhook(hook(p), env)).status, 'paid'); assert.strictEqual(db.get('users/' + U).wallets.ly, 50);
});
t('حالة الدفع: المالك فقط يراها، مرجع غير صالح يُرفض، والاستعلام يؤكّد الدفع من البوابة', async () => {
  resetAll(); const r = await start(); await rejects(A.handleEzoneStatus({ uid: U2 }, { ref: r.ref }, env), 404); await rejects(A.handleEzoneStatus({ uid: U }, { ref: '../users/x' }, env), 400);
  assert.strictEqual((await A.handleEzoneStatus({ uid: U }, { ref: r.ref }, env)).status, 'pending'); linkOf(r.ref).paid = 50; linkOf(r.ref).uses = 1; assert.strictEqual((await A.handleEzoneStatus({ uid: U }, { ref: r.ref }, env)).status, 'paid');
});
t('webhook لمرجع مجهول أو حدث غير الدفع: يُتجاهل بأمان بدون أثر مالي', async () => { resetAll(); assert.strictEqual((await A.handleEzoneWebhook(hook({ event: 2, transactionId: 5, orderReference: 'EZ0000000000000ZZZZZZ' }), env)).status, 'missing'); assert.strictEqual((await A.handleEzoneWebhook(hook({ event: 1, transactionId: 6, orderReference: 'x' }), env)).ignored, true); assert.strictEqual([...db.keys()].filter(k => k.startsWith('wallet_')).length, 0); });
t('الكرون يعتمد الدفعات المعلّقة المؤكَّدة ويتجاهل الحديثة جدًا', async () => { resetAll(); const r = await start(); linkOf(r.ref).paid = 50; linkOf(r.ref).uses = 1; await A.ezoneCron(env); assert.strictEqual(db.get('ezone_payments/' + r.ref).status, 'pending');
  db.set('ezone_payments/' + r.ref, { ...db.get('ezone_payments/' + r.ref), created_at: new Date(Date.now() - 600000).toISOString() }); await A.ezoneCron(env); assert.strictEqual(db.get('ezone_payments/' + r.ref).status, 'paid'); });
t('العنوان: الإنتاج الافتراضي api.ezonepay.ly، ويُرفض أي نطاق غير ezonepay.ly أو غير https (حماية SSRF)', async () => {
  resetAll(); env.EZONE_BASE_URL = 'https://evil.example.com'; await rejects(start(), 503); env.EZONE_BASE_URL = 'http://test.ezonepay.ly'; await rejects(start(), 503); env.EZONE_BASE_URL = 'https://ezonepay.ly.evil.com'; await rejects(start(), 503); delete env.EZONE_BASE_URL;
  settings.ezone_env = 'live'; calls.length = 0; await start(); assert.ok(calls.length > 0 && calls.every(c => c.host === 'api.ezonepay.ly'));
  resetAll(); calls.length = 0; await start(); assert.ok(calls.every(c => c.host === 'test.ezonepay.ly'));
});
t('مفتاح Ezone من لوحة الأدمن: يُرفض الشكل الخاطئ، يُخزَّن مشفّرًا، ويستعمله الكود بدون متغير بيئة', async () => {
  resetAll(); const saved = env.EZONE_API_KEY; delete env.EZONE_API_KEY; await rejects(start(), 503);
  await rejects(A.handleAdminEzone({ uid: 'adminUser0001' }, { action: 'set_key', key: 'bad' }, env), 400);
  await A.handleAdminEzone({ uid: 'adminUser0001' }, { action: 'set_key', key: saved }, env);
  const blob = kv.get('ezone:apikey'); assert.ok(blob.startsWith('v2:') && !blob.includes(saved));
  calls.length = 0; await start(); assert.ok(calls.every(c => c.key === saved)); env.EZONE_API_KEY = saved; kv.delete('ezone:apikey');
});
t('اشتراك الـ webhook: يحفظ سر التوقيع مشفّرًا في KV (لا يظهر نصًا)', async () => { resetAll(); const r = await A.handleAdminEzone({ uid: 'adminUser0001' }, { action: 'subscribe' }, env); assert.ok(r.url.endsWith('/api/ezone/webhook')); const blob = kv.get('ezone:whsec'); assert.ok(blob.startsWith('v2:')); assert.ok(!blob.includes('Zm9vYmFy')); });
t('حالة الإعداد للأدمن لا تكشف المفتاح ولا السر', async () => { resetAll(); const r = await A.handleAdminEzone({ uid: 'adminUser0001' }, { action: 'status' }, env); const j = JSON.stringify(r); assert.ok(!j.includes('epk_')); assert.ok(!j.includes(SECRET)); assert.strictEqual(r.has_key, true); assert.strictEqual(r.methods.length, 4); });
(async () => { let ok = 0; for (const [n, f] of tests) { try { await f(); ok++; console.log('ok -', n); } catch (e) { console.log('FAIL -', n, '\n   ', (e.stack || e.message).split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; } } console.log(`\n${ok}/${tests.length} passed`); })();
