// اختبارات المحفظة الموحدة بالدينار — الكود الحقيقي من worker.js مع دفتر أستاذ وD1 وهميين
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../worker.js', 'utf8');
const fn = (name) => {
  const one = src.match(new RegExp('^(?:async\\s+)?function\\s+' + name + '\\b[^\\n]*\\}[^\\n]*$', 'm'));
  if (one && !/\{\s*$/.test(one[0].replace(/\/\/.*$/, '').trimEnd())) return one[0];
  const m = src.match(new RegExp('(?:async\\s+)?function\\s+' + name + '\\b[\\s\\S]*?\\n\\}\\n')); if (!m) throw new Error('missing ' + name); return m[0]; };
const cst = (name) => { const m = src.match(new RegExp('const ' + name + ' = [^\\n]+')); if (!m) throw new Error('missing const ' + name); return m[0]; };
const code = ['num', 'round2', 'nowIso', 'httpError', 'sha256Hex', 'wRate', 'wMargin', 'wPrice', 'wFromUsd', 'wFmt', 'wBalOf', 'methodWallet', 'depWallet', 'userWallet', 'spendPlan', 'spendPost', 'ledgerOpen', 'pushEntry', 'ledgerHash', 'ledgerPost', 'ledgerClose', 'applyWU', 'unifyPlan', 'handleAdminWalletUnify'].map(fn).join('\n')
  + '\n' + src.match(/let _WU = false, _WR = 11\.8;/)[0] + '\n' + cst('uAmt') + '\n' + cst('uBack') + '\n' + cst('WALLETS') + '\n' + cst('W_AR') + '\n' + cst('wOk') + '\n' + cst('wCur') + '\n' + cst('_jp') + '\n' + cst('UNIFY_Q');
const db = new Map(), audits = [];
const clone = o => o == null ? null : JSON.parse(JSON.stringify(o));
let settings = { wallet_unified: false, wallets_on: true, rate_libyana: 11.8, rate_almadar: 12.5, rate_bank: 9.5, usd_to_lyd: 11.8 };
const applyTx = (staged) => { for (const w of staged) { if (w.op === 'create') db.set(w.path, clone(w.data)); else db.set(w.path, { ...(db.get(w.path) || {}), ...clone(w.data) }); } };
const ctx = { Math, Number, String, Object, Array, JSON, Date, Error, Promise, crypto: globalThis.crypto, TextEncoder,
  fsGet: async (e, p) => clone(db.get(p)), fsSet: async (e, p, d) => { db.set(p, clone(d)); }, fsPatch: async (e, p, d) => { db.set(p, { ...(db.get(p) || {}), ...clone(d) }); },
  fsRunTransaction: async (e, f) => { const staged = []; const tx = { get: async p => { const pend = [...staged].reverse().find(x => x.path === p); return clone(pend ? { ...(db.get(p) || {}), ...pend.data } : db.get(p)); }, create: (c, id, d) => { if (db.has(c + '/' + id)) { const er = new Error('EXISTS'); er.status = 409; throw er; } staged.push({ op: 'create', path: c + '/' + id, data: d }); }, update: (p, d) => staged.push({ op: 'update', path: p, data: d }) }; const r = await f(tx); applyTx(staged); return r; },
  getSettings: async () => ({ ...settings }), clearSettingsCache: () => { ctx.applyWU(settings); }, d1Table: () => true,
  d1All: async (e, sql, args) => { const all = [...db.entries()].filter(([k]) => k.startsWith('users/')).map(([k, v]) => ({ id: k.slice(6), data: JSON.stringify(v), v }));
    const pending = all.filter(r => !r.v.wallets_unified && (num(r.v.wallet_balance) !== 0 || num(r.v.wallets && r.v.wallets.md) !== 0 || num(r.v.wallets && r.v.wallets.bk) !== 0));
    if (/COUNT/.test(sql)) return [{ n: pending.length }]; return pending.slice(0, (args || [100])[0]); },
  requirePermission: async (u, e, p) => { if (u.uid !== 'admin01') { const er = new Error('forbidden'); er.status = 403; throw er; } return { uid: u.uid }; }, requireFreshAuth: () => {},
  logOp: async (e, uid, a) => { audits.push(a); }, escHtml: s => s,
};
const num = (v, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
vm.createContext(ctx); vm.runInContext(code + '\nthis.applyWU=applyWU; this.api={uAmt,uBack,userWallet,depWallet,spendPlan,wPrice,ledgerOpen,ledgerPost,ledgerClose,handleAdminWalletUnify,unifyPlan,getWU:()=>_WU};', ctx);
const A = ctx.api, env = { DB: {} };
const U = 'userUN00000001', adm = { uid: 'admin01' };
const reset = () => { db.clear(); audits.length = 0; settings = { wallet_unified: false, wallets_on: true, rate_libyana: 11.8, rate_almadar: 12.5, rate_bank: 9.5, usd_to_lyd: 11.8 }; ctx.applyWU(settings);
  db.set('users/' + U, { name: 'منصور', wallet_balance: 10, wallets: { ly: 50, md: 44.7, bk: 100 }, default_wallet: 'usd' }); db.set('users/userUN00000002', { name: 'خالد', wallet_balance: 0, wallets: { ly: 5 } }); db.set('users/userUN00000003', { name: 'سالب', wallet_balance: -3, wallets: {} }); };
const rejects = async (p, status) => { try { await p; } catch (e) { assert.strictEqual(e.status, status, `status ${e.status} ${e.message}`); return e; } assert.fail('should reject ' + status); };
const tests = []; const t = (n, f) => tests.push([n, f]);

t('بدون تفعيل: السلوك القديم كما هو (محفظة افتراضية، ودولار للقيود القديمة)', async () => { reset(); assert.strictEqual(A.getWU(), false); assert.strictEqual(A.userWallet({ default_wallet: 'bk' }), 'bk'); assert.strictEqual(A.depWallet(settings, 'trc20'), 'usd'); assert.strictEqual(A.uAmt(5), 5); assert.strictEqual(JSON.stringify(A.uBack('usd', 3)), JSON.stringify({ w: 'usd', amt: 3 })); });
t('بعد التفعيل: كل شي على محفظة ly، والدولار القديم يتحول بسعر الصرف، والمدار/المصرف 1:1', async () => {
  reset(); settings.wallet_unified = true; ctx.applyWU(settings); assert.strictEqual(A.getWU(), true);
  assert.strictEqual(A.userWallet({ default_wallet: 'usd' }), 'ly'); for (const k of ['trc20', 'libyana', 'bank', 'ezone_bank']) assert.strictEqual(A.depWallet(settings, k), 'ly');
  assert.strictEqual(A.uAmt(10), 118); assert.strictEqual(JSON.stringify(A.uBack('usd', 2)), JSON.stringify({ w: 'ly', amt: 23.6 })); assert.strictEqual(JSON.stringify(A.uBack('md', 44.7)), JSON.stringify({ w: 'ly', amt: 44.7 })); assert.strictEqual(JSON.stringify(A.uBack('ly', 9)), JSON.stringify({ w: 'ly', amt: 9 }));
});
t('الشراء بعد التفعيل يخصم من ly بسعر الدينار (سعر ليبيانا هو السعر الموحد)', async () => {
  reset(); settings.wallet_unified = true; ctx.applyWU(settings); const p = await A.spendPlan({ get: async p => clone(db.get(p)) }, settings, U, 10); assert.strictEqual(p.w, 'ly'); assert.strictEqual(p.amt, 118);
});
t('معاينة التحويل: مثال 10$ بسعر 9 = 90 د.ل، والمدار والمصرف تنضاف 1:1، ولا يتغير شي', async () => {
  reset(); const r = await A.handleAdminWalletUnify(adm, { action: 'preview', rate: 9 }, env); const p = r.plans.find(x => x.uid === U);
  assert.strictEqual(p.after, 50 + 90 + 44.7 + 100); assert.strictEqual(p.moves.length, 3); assert.ok(r.plans.find(x => x.uid === 'userUN00000003').neg); assert.strictEqual(db.get('users/' + U).wallet_balance, 10); assert.strictEqual(r.left, 2);
});
t('التنفيذ: الأرصدة تنتقل لـ ly بقيود مرجعها، المحافظ القديمة تصفّر، ويُحفظ نسخة قبل التحويل', async () => {
  reset(); const r = await A.handleAdminWalletUnify(adm, { action: 'apply', rate: 9 }, env); assert.strictEqual(r.done, 1); assert.strictEqual(r.failed.length, 1);
  const u = db.get('users/' + U); assert.strictEqual(u.wallets.ly, 284.7); assert.strictEqual(u.wallet_balance, 0); assert.strictEqual(u.wallets.md, 0); assert.strictEqual(u.wallets.bk, 0); assert.ok(u.wallets_unified && u.default_wallet === 'ly');
  const m = db.get('wallet_migration/' + U); assert.strictEqual(m.rate, 9); assert.strictEqual(m.before.usd, 10); assert.strictEqual(db.get('wallet_transactions/txn_unify_' + U + '_usd_i').amount, 90); assert.strictEqual(db.get('wallet_transactions/txn_unify_' + U + '_usd_o').amount, 10);
  assert.strictEqual(db.get('users/userUN00000003').wallets_unified.startsWith('failed'), true); assert.strictEqual(db.get('users/userUN00000003').wallet_balance, -3);
});
t('التكرار آمن: إعادة التنفيذ لا تضاعف الرصيد', async () => { reset(); await A.handleAdminWalletUnify(adm, { action: 'apply', rate: 9 }, env); const r2 = await A.handleAdminWalletUnify(adm, { action: 'apply', rate: 9 }, env); assert.strictEqual(r2.done, 0); assert.strictEqual(db.get('users/' + U).wallets.ly, 284.7); });
t('التفعيل لا يُسمح قبل اكتمال التحويل إلا بالإجبار؛ والتحويل يحتاج سعرًا صالحًا وصلاحية', async () => {
  reset(); await rejects(A.handleAdminWalletUnify(adm, { action: 'activate' }, env), 409); await rejects(A.handleAdminWalletUnify(adm, { action: 'apply', rate: 0 }, env), 400); await rejects(A.handleAdminWalletUnify(adm, { action: 'apply', rate: 900 }, env), 400); await rejects(A.handleAdminWalletUnify({ uid: 'someone' }, { action: 'preview', rate: 9 }, env), 403);
  await A.handleAdminWalletUnify(adm, { action: 'apply', rate: 9 }, env); await A.handleAdminWalletUnify(adm, { action: 'apply', rate: 9 }, env);
  db.set('users/userUN00000003', { name: 'تم', wallet_balance: 0, wallets: {} }); const a = await A.handleAdminWalletUnify(adm, { action: 'activate' }, env); assert.strictEqual(a.unified, true); assert.strictEqual(db.get('settings/main').wallet_unified, true);
});
t('مجموع القيمة محفوظ: مجموع الدينار بعد التحويل = المجموع المتوقع بدون فقد', async () => { reset(); const pre = A.unifyPlan(db.get('users/' + U), 9); await A.handleAdminWalletUnify(adm, { action: 'apply', rate: 9 }, env); assert.strictEqual(db.get('users/' + U).wallets.ly, pre.after); });
(async () => { let ok = 0; for (const [n, f] of tests) { try { await f(); ok++; console.log('ok -', n); } catch (e) { console.log('FAIL -', n, '\n   ', (e.stack || e.message).split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; } } console.log(`\n${ok}/${tests.length} passed`); })();
