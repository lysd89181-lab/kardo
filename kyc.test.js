// اختبارات KYC — تشغّل الكود الحقيقي من worker.js (وحدة KYC + التشفير) مع قاعدة بيانات/KV وهمية في الذاكرة
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../worker.js', 'utf8');
const fn = (name) => { const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\b[\\s\\S]*?\\n\\}\\n')); if (!m) throw new Error('missing ' + name); return m[0]; };
const kycCode = src.slice(src.indexOf('const KYC_FILES'), src.indexOf('const EZ_SANDBOX'));
const helpers = ['masterKeyBytes', 'deriveRecordKey', 'encryptV2', 'decryptAny', 'decryptCard', 'getEncryptionKey', 'bytesToB64', 'b64ToBytes', 'b64urlToBytes', 'httpError', 'num', 'nowIso', 'randomSuffix', 'withId', 'safeEqual', 'sha256Hex'].map(fn).join('\n');

const db = new Map(), kv = new Map(), audits = [], notes = [];
const env = { CARD_MASTER_KEY: 'ab'.repeat(32), KV: {
  async put(k, v, o) { kv.set(k, { v: v instanceof Uint8Array ? v.slice().buffer : v, ttl: o && o.expirationTtl }); },
  async get(k, t) { const e = kv.get(k); return e ? e.v : null; }, async delete(k) { kv.delete(k); } } };
const staffDb = { s1: { uid: 's1', role: 'staff', perms: ['kyc.view', 'kyc.review', 'settings.manage'] }, v1: { uid: 'v1', role: 'staff', perms: ['kyc.view'] }, staffAdmin09: { uid: 'staffAdmin09', role: 'staff', perms: ['kyc.view', 'kyc.review'] } };
const ctx = { Response, crypto: globalThis.crypto, TextEncoder, TextDecoder, atob, btoa, URL, console, Date, Math, JSON, Uint8Array, Promise, Object, Array, String, Number, Set, Map, RegExp, Error,
  fsGet: async (e, p) => db.has(p) ? JSON.parse(JSON.stringify(db.get(p))) : null,
  fsSet: async (e, p, d) => { db.set(p, JSON.parse(JSON.stringify(d))); },
  fsPatch: async (e, p, d) => { db.set(p, { ...(db.get(p) || {}), ...JSON.parse(JSON.stringify(d)) }); },
  fsQueryRaw: async () => [...db.entries()].filter(([k]) => k.startsWith('kyc/')).map(([k, v]) => ({ _row: [k, v] })),
  getSettings: async () => ({}), clearSettingsCache: () => {}, kvStore: kv, logOp: async (e, uid, action, req) => { audits.push({ uid, action, req }); },
  requirePermission: async (user, e, perm) => { const st = staffDb[user.uid]; if (!st || !st.perms.includes(perm)) { const er = new Error('forbidden'); er.status = 403; throw er; } return st; },
  requireFreshAuth: () => {}, memAllowWin: () => true, background: () => {}, staffAlert: () => {}, notify: (e, uid, kind, v) => notes.push({ uid, kind, v }),
  getStaff: async (e, uid) => staffDb[uid] || null, staffCan: (st, p) => !!st && st.perms.includes(p), decryptAny: undefined,
};
ctx.withId = undefined;
vm.createContext(ctx);
// withId الحقيقية تعتمد على بنية Firestore — نستبدلها لأن الاختبار يحاكي القراءة مباشرة
vm.runInContext(helpers.replace(/function withId[\s\S]*?\n\}\n/, '') + '\nthis.withId=(r,c)=>({...r._row[1],_id:r._row[0].split("/")[1]});\n' + kycCode + '\nthis.api={kycSniff,kycEncBytes,kycDecBytes,kycMakeToken,kycReadToken,kycRequireApproved,kycStatusOf,handleKycSubmit,handleKycStatus,handleAdminKyc,serveKycFile,kycCheckViewKey,encryptV2,decryptAny};', ctx);
const A = ctx.api;
const tests = []; const t = (n, f) => tests.push([n, f]);
const rejects = async (p, status) => { try { await p; } catch (e) { assert.strictEqual(e.status, status, 'status ' + e.status + ' ' + e.message); return e; } assert.fail('should reject ' + status); };

const JPG = (n = 3000) => { const b = new Uint8Array(n); b.set([0xFF, 0xD8, 0xFF, 0xE0], 0); for (let i = 4; i < n; i++) b[i] = (i * 7) & 255; return Buffer.from(b).toString('base64'); };
const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 1, 2, 3, 4]).toString('base64');
const good = (o = {}) => ({ full_name: 'منصور أحمد علي', doc_type: 'national_id', doc_number: '119900123456', front: JPG(), back: JPG(), selfie: JPG(), ...o });
const U = 'userAAAAAAAA01', U2 = 'userBBBBBBBB02', VK = 'Mansour-View-Key-2026';

t('كشف نوع الصورة من البايتات (لا يثق باسم الملف/النوع)', async () => {
  assert.strictEqual(A.kycSniff(Buffer.from(JPG(), 'base64')), 'image/jpeg'); assert.strictEqual(A.kycSniff(Buffer.from(PNG, 'base64')), 'image/png');
  assert.strictEqual(A.kycSniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.strictEqual(A.kycSniff(Buffer.from('GIF89a......'.padEnd(20, 'x'))), null);
});
t('تشفير الملف ذهابًا وإيابًا + فشل بمفتاح/سياق مختلف + كشف التلاعب', async () => {
  const data = new Uint8Array([1, 2, 3, 4, 5, 250, 251]); const enc = await A.kycEncBytes(env, 'kyc:file:a:b', data);
  assert.notDeepStrictEqual([...enc.slice(12, 19)], [...data]);
  assert.deepStrictEqual([...(await A.kycDecBytes(env, 'kyc:file:a:b', enc.buffer))], [...data]);
  await assert.rejects(A.kycDecBytes(env, 'kyc:file:a:OTHER', enc.buffer));
  const bad = enc.slice(); bad[15] ^= 1; await assert.rejects(A.kycDecBytes(env, 'kyc:file:a:b', bad.buffer));
});
t('رابط العرض الموقّع: صالح، ثم يُرفض إذا عُدّل أو انتهى', async () => {
  const tok = await A.kycMakeToken(env, { u: U, k: 'front', f: 'x', s: 's1', e: Date.now() + 5000 });
  assert.strictEqual((await A.kycReadToken(env, tok)).u, U);
  const [b, s] = tok.split('.'); const forged = Buffer.from(JSON.stringify({ u: U2, k: 'front', f: 'x', s: 's1', e: Date.now() + 5000 })).toString('base64url') + '.' + s;
  await rejects(A.kycReadToken(env, forged), 403);
  await rejects(A.kycReadToken(env, tok.slice(0, -3) + 'AAA'), 403);
  await rejects(A.kycReadToken(env, await A.kycMakeToken(env, { u: U, k: 'front', f: 'x', s: 's1', e: Date.now() - 1 })), 403);
  await rejects(A.kycReadToken(env, 'garbage'), 403);
});
t('الإرسال: تحقق المدخلات (اسم، نوع، رقم، صور ناقصة، نوع ملف خاطئ، حجم كبير)', async () => {
  await rejects(A.handleKycSubmit({ uid: U }, good({ full_name: 'منصور' }), env), 400);
  await rejects(A.handleKycSubmit({ uid: U }, good({ doc_type: 'license' }), env), 400);
  await rejects(A.handleKycSubmit({ uid: U }, good({ doc_number: '12' }), env), 400);
  await rejects(A.handleKycSubmit({ uid: U }, good({ back: '' }), env), 400);
  await rejects(A.handleKycSubmit({ uid: U }, good({ front: Buffer.from('<svg/>'.padEnd(40)).toString('base64') }), env), 400);
  await rejects(A.handleKycSubmit({ uid: U }, good({ selfie: JPG(1_000_000) }), env), 400);
  assert.strictEqual(db.has('kyc/' + U), false);
});
t('إرسال سليم: الحالة pending، الصور مشفّرة في KV، رقم الوثيقة مشفّر، آخر 4 فقط ظاهرة', async () => {
  const r = await A.handleKycSubmit({ uid: U }, good(), env); assert.strictEqual(r.status, 'pending');
  const d = db.get('kyc/' + U); assert.strictEqual(d.status, 'pending'); assert.strictEqual(d.num_last4, '3456');
  assert.ok(!JSON.stringify(d).includes('119900123456')); assert.ok(d.num_enc.startsWith('v2:'));
  assert.strictEqual([...kv.keys()].filter(k => k.startsWith('kycf:' + U)).length, 3);
  const raw = Buffer.from(kv.get(`kycf:${U}:${d.files.front.id}`).v); assert.ok(!raw.includes(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])), 'الملف يجب أن يكون مشفّرًا');
  assert.ok(kv.get(`kycf:${U}:${d.files.front.id}`).ttl > 0, 'يجب أن يكون للملف مدة حذف تلقائي');
});
t('لا إرسال مزدوج أثناء المراجعة', async () => { await rejects(A.handleKycSubmit({ uid: U }, good(), env), 409); });
t('المستخدم غير الموثّق لا يمر من بوابة البنوك (pending/none)', async () => {
  const e = await rejects(A.kycRequireApproved(env, U), 403); assert.strictEqual(e.code, 'KYC_REQUIRED');
  await rejects(A.kycRequireApproved(env, 'nobody0000000'), 403);
});
t('الأدمن: بدون صلاحية kyc.view/review يُرفض', async () => {
  await rejects(A.handleAdminKyc({ uid: 'randomUser01' }, { action: 'list' }, env), 403);
  await rejects(A.handleAdminKyc({ uid: 'v1' }, { action: 'decide', uid: U, decision: 'approve' }, env), 403);
});
t('الأدمن: القائمة والتفاصيل لا تكشف ملفات ولا رقم كامل', async () => {
  const l = await A.handleAdminKyc({ uid: 's1' }, { action: 'list', status: 'pending' }, env); assert.strictEqual(l.list.length, 1);
  const v = await A.handleAdminKyc({ uid: 's1' }, { action: 'view', uid: U }, env);
  assert.ok(!JSON.stringify(v).includes('119900123456')); assert.ok(!JSON.stringify(v).includes('"id"')); assert.strictEqual(JSON.stringify(v.files), JSON.stringify(['front', 'back', 'selfie']));
});
t('مفتاح العرض: بدون ضبطه يُمنع عرض الصور؛ والضبط يحتاج settings.manage وطول كافٍ', async () => {
  await rejects(A.handleAdminKyc({ uid: 's1' }, { action: 'sign', uid: U, kind: 'front', vkey: VK }, env), 403);
  await rejects(A.handleAdminKyc({ uid: 'v1' }, { action: 'set_view_key', key: VK }, env), 403);
  await rejects(A.handleAdminKyc({ uid: 's1' }, { action: 'set_view_key', key: 'short' }, env), 400);
  await A.handleAdminKyc({ uid: 's1' }, { action: 'set_view_key', key: VK }, env);
  assert.ok(!JSON.stringify([...kv.values()].map(v => typeof v === 'string' ? v : '')).includes(VK), 'المفتاح لا يُخزَّن نصًا');
});
t('مفتاح العرض: غلط يُرفض، وبعد 5 محاولات غلط يُقفل حتى مع المفتاح الصحيح، وتغييره يحتاج القديم', async () => {
  for (let i = 0; i < 5; i++) await rejects(A.handleAdminKyc({ uid: 's1' }, { action: 'sign', uid: U, kind: 'front', vkey: 'wrong-key-' + i }, env), 403);
  await rejects(A.handleAdminKyc({ uid: 's1' }, { action: 'sign', uid: U, kind: 'front', vkey: VK }, env), 429);
  kv.delete('kyc:vf:s1');
  await rejects(A.handleAdminKyc({ uid: 's1' }, { action: 'set_view_key', key: 'another-long-key-1' }, env), 403);
  await rejects(A.handleAdminKyc({ uid: 's1' }, { action: 'set_view_key', key: 'another-long-key-1', old: 'nope-nope-nope' }, env), 403); kv.delete('kyc:vf:s1');
  await A.handleAdminKyc({ uid: 's1' }, { action: 'set_view_key', key: VK, old: VK }, env);
});
t('إعدادات مدة الحذف والتمديد: قيم صالحة فقط، والتمديد على الموافَق عليها', async () => {
  await rejects(A.handleAdminKyc({ uid: 's1' }, { action: 'cfg_set', approved_days: 0 }, env), 400); await rejects(A.handleAdminKyc({ uid: 's1' }, { action: 'cfg_set', approved_days: 99999 }, env), 400);
  await rejects(A.handleAdminKyc({ uid: 'v1' }, { action: 'cfg_set', approved_days: 400 }, env), 403);
  assert.strictEqual((await A.handleAdminKyc({ uid: 's1' }, { action: 'cfg' }, env)).has_key, true);
});
t('رابط الصورة: يعمل لموظف مصرّح، يُسجَّل، ويرجع الصورة الأصلية بعد فك التشفير', async () => {
  const sg = await A.handleAdminKyc({ uid: 's1' }, { action: 'sign', uid: U, kind: 'front', vkey: VK }, env);
  const res = await A.serveKycFile(null, env, new URL('https://x.test' + sg.path));
  assert.strictEqual(res.headers.get('content-type'), 'image/jpeg'); assert.strictEqual(res.headers.get('cache-control'), 'no-store, private'); assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(Buffer.from(await res.arrayBuffer()).toString('base64'), JPG());
  assert.ok(audits.some(a => a.action === 'kyc.file.sign') && audits.some(a => a.action === 'kyc.file.view'));
});
t('الرابط يسقط إذا فقد الموظف الصلاحية (إلغاء فوري)', async () => {
  const sg = await A.handleAdminKyc({ uid: 's1' }, { action: 'sign', uid: U, kind: 'back', vkey: VK }, env);
  const saved = staffDb.s1.perms; staffDb.s1.perms = [];
  await rejects(A.serveKycFile(null, env, new URL('https://x.test' + sg.path)), 403); staffDb.s1.perms = saved;
});
t('منع الموافقة الذاتية: موظف لا يراجع طلب حسابه', async () => {
  db.set('kyc/staffAdmin09', { status: 'pending', full_name: 'x y z', files: {}, history: [] });
  await rejects(A.handleAdminKyc({ uid: 'staffAdmin09' }, { action: 'decide', uid: 'staffAdmin09', decision: 'approve' }, env), 403);
  assert.strictEqual(db.get('kyc/staffAdmin09').status, 'pending');
});
t('الرفض/إعادة الإرسال يتطلب سببًا؛ ولا يمكن فبركة قرار', async () => {
  await rejects(A.handleAdminKyc({ uid: 's1' }, { action: 'decide', uid: U, decision: 'reject', reason: '' }, env), 400);
  await rejects(A.handleAdminKyc({ uid: 's1' }, { action: 'decide', uid: U, decision: 'maybe', reason: 'xxxxxx' }, env), 400);
});
t('رفض مع سبب → الحالة rejected، الإشعار يصل، والسجل يحفظ المراجع', async () => {
  const r = await A.handleAdminKyc({ uid: 's1' }, { action: 'decide', uid: U, decision: 'reject', reason: 'صورة الوثيقة غير واضحة' }, env); assert.strictEqual(r.status, 'rejected');
  const st = await A.handleKycStatus({ uid: U }, {}, env); assert.strictEqual(st.status, 'rejected'); assert.strictEqual(st.reason, 'صورة الوثيقة غير واضحة'); assert.strictEqual(st.can_submit, true);
  assert.ok(notes.some(n => n.uid === U && n.kind === 'kyc_rejected')); assert.strictEqual(db.get('kyc/' + U).history.at(-1).by, 's1');
  await rejects(A.kycRequireApproved(env, U), 403);
});
t('إعادة الإرسال بعد الرفض → pending وتُحذف الملفات القديمة', async () => {
  const old = Object.values(db.get('kyc/' + U).files).map(f => f.id); await A.handleKycSubmit({ uid: U }, good({ doc_type: 'passport', doc_number: 'A1234567', back: undefined }), env);
  assert.strictEqual(db.get('kyc/' + U).status, 'pending'); for (const id of old) assert.ok(!kv.has(`kycf:${U}:${id}`), 'الملف القديم لازم يُحذف');
  assert.strictEqual(Object.keys(db.get('kyc/' + U).files).length, 2);
});
t('موافقة حقيقية → approved، تفتح بوابة البنوك، ومدة الاحتفاظ تتحدّث', async () => {
  await A.handleAdminKyc({ uid: 's1' }, { action: 'decide', uid: U, decision: 'approve' }, env);
  await A.kycRequireApproved(env, U);
  const f = db.get('kyc/' + U).files.front.id; assert.strictEqual(kv.get(`kycf:${U}:${f}`).ttl, 365 * 86400);
  assert.strictEqual(db.get('users/' + U).kyc_status, 'approved');
});
t('تمديد مدة الاحتفاظ للموافَق عليها', async () => {
  const r = await A.handleAdminKyc({ uid: 's1' }, { action: 'extend', days: 730 }, env); assert.strictEqual(r.n, 1);
  const f = db.get('kyc/' + U).files.front.id; assert.strictEqual(kv.get(`kycf:${U}:${f}`).ttl, 730 * 86400);
});
t('لا موافقة مكررة، وسحب التوثيق (reject بعد approved) يقفل البنوك فورًا', async () => {
  await rejects(A.handleAdminKyc({ uid: 's1' }, { action: 'decide', uid: U, decision: 'approve' }, env), 409);
  await A.handleAdminKyc({ uid: 's1' }, { action: 'decide', uid: U, decision: 'resubmit', reason: 'انتهت صلاحية الوثيقة' }, env);
  await rejects(A.kycRequireApproved(env, U), 403);
});
t('كشف رقم الوثيقة الكامل يحتاج kyc.review ويُسجَّل؛ والحذف النهائي يمسح الملفات', async () => {
  await rejects(A.handleAdminKyc({ uid: 'v1' }, { action: 'reveal_number', uid: U, vkey: VK }, env), 403);
  assert.strictEqual((await A.handleAdminKyc({ uid: 's1' }, { action: 'reveal_number', uid: U, vkey: VK }, env)).number, 'A1234567'); assert.ok(audits.some(a => a.action === 'kyc.number.reveal'));
  await A.handleAdminKyc({ uid: 's1' }, { action: 'purge', uid: U }, env); assert.strictEqual([...kv.keys()].filter(k => k.startsWith('kycf:' + U)).length, 0); assert.ok(db.get('kyc/' + U).purged_at);
});
(async () => { let ok = 0; for (const [n, f] of tests) { try { await f(); ok++; console.log('ok -', n); } catch (e) { console.log('FAIL -', n, '\n   ', e.message); process.exitCode = 1; } } console.log(`\n${ok}/${tests.length} passed`); })();
