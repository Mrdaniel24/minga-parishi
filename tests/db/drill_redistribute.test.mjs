// Totals → their payments, correcting a distribution, proof attachments, titles — run with: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, ids } from './harness.mjs';

let db, I, U = {};
const N = v => Number(v);
const sum = rows => rows.reduce((s, r) => s + N(r.net_amount), 0);

before(async () => {
  db = await createDb();
  I = await ids(db);
  U.clerk = await db.user('clerk@test.local', { parishRole: 'data_entry' });
  U.clerk2 = await db.user('clerk2@test.local', { parishRole: 'data_entry' });
  U.acc = await db.user('acc@test.local', { parishRole: 'accountant' });
  U.clara = await db.user('clara@test.local', { parishRole: 'jumuiya_leader', org: I['org:jumuiya:Clara'] });
  U.aug = await db.user('aug@test.local', { parishRole: 'jumuiya_leader', org: I['org:jumuiya:Augustino'] });
  db.asAdmin();
  const fam = (name, jum) => db.val(
    `insert into public.families (parish_id, family_name, jumuiya_id) values (public.default_parish_id(), $1, $2) returning id`, [name, jum]);
  const person = (name, family, jum) => db.val(
    `insert into public.parishioners (parish_id, full_name, family_id, jumuiya_id) values (public.default_parish_id(), $1, $2, $3) returning id`, [name, family, jum]);
  U.famA = await fam('Familia A', I['org:jumuiya:Clara']);
  U.famB = await fam('Familia B', I['org:jumuiya:Clara']);
  U.pA1 = await person('Mtu A1', U.famA, I['org:jumuiya:Clara']);
  U.pB1 = await person('Mtu B1', U.famB, I['org:jumuiya:Clara']);
  U.pB2 = await person('Mtu B2', U.famB, I['org:jumuiya:Clara']);
});

const split = (who, p) => db.as(who).rpc('post_zaka_split', {
  idempotency_key: db.key(), jumuiya_id: I['org:jumuiya:Clara'], txn_date: '2026-05-10', payment_method: 'cash', period_month: '2026-05-01', ...p });
const pay = (who, p) => db.as(who).rpc('post_payment', {
  idempotency_key: db.key(), txn_date: '2026-05-12', payment_method: 'cash', confirm_duplicate: true, ...p });
const drill = (who, p) => db.as(who).rpc('ledger_drill', p);
const redistribute = (who, p) => db.as(who).rpc('redistribute_payments', { idempotency_key: db.key(), reason: 'Imegawanywa vibaya', ...p });

test('a total opens the payments behind it, as each screen totals them, and only what the user may see', async () => {
  await pay(U.clerk, { amount: 7000, category_id: I['cat:ZAKA'], period_month: '2026-04-01', parishioner_id: U.pA1 });
  await pay(U.clerk, { amount: 3000, category_id: I['cat:ZAKA'], period_month: '2026-04-01', family_id: U.famA });
  await pay(U.clerk, { amount: 5000, category_id: I['cat:SADAKA_JUMAPILI'], family_id: U.famA });

  const famZaka = await drill(U.clerk, { family: U.famA, kinds: ['zaka'], zaka_year: 2026 });
  assert.equal(famZaka.length, 2);                       // the member's zaka counts for the family too
  assert.equal(sum(famZaka), 10000);
  const person = await drill(U.clerk, { parishioner: U.pA1, kinds: ['zaka'], period_month: '2026-04-01' });
  assert.equal(sum(person), 7000);
  const jum = await drill(U.clerk, { unit: I['org:jumuiya:Clara'], kinds: ['zaka'], zaka_year: 2026 });
  const grid = await db.asAdmin().q(`select total from public.zaka_grid(2026, 'jumuiya', $1) where group_id = $1`, [I['org:jumuiya:Clara']]);
  assert.equal(sum(jum), N(grid[0].total));             // the same figure as the Zaka grid
  // a kigango contains its jumuiya
  const kig = await drill(U.clerk, { unit: await db.asAdmin().val(`select parent_id from public.org_units where id = $1`, [I['org:jumuiya:Clara']]), kinds: ['zaka'], year: 2026 });
  assert.ok(sum(kig) >= 10000);
  // the leader of another jumuiya sees none of it
  assert.equal((await drill(U.aug, { family: U.famA })).length, 0);
  assert.equal((await drill(U.clara, { family: U.famA })).length, 3);
});

test('a wrong distribution is corrected: old lines reversed, the same money posted again, totals right', async () => {
  const r = await split(U.clerk, { amount: 100000, payment_method: 'bank_transfer', reference_no: 'BNK-777',
    lines: [{ family_id: U.famA, amount: 60000 }, { family_id: U.famB, amount: 40000 }] });
  assert.equal(r.status, 'posted', JSON.stringify(r));    // one bank reference shared by the lines of one split
  const old = r.receipts.map(x => x.transaction_id);
  const batch = await db.asAdmin().q(`select batch_id from public.finance_transactions where id = any ($1)`, [old]);
  assert.ok(batch.every(b => b.batch_id === r.batch_id));

  // must add up to what was there, and nothing changes when it does not
  const before = N(await db.asAdmin().val('select count(*) from public.finance_transactions'));
  await assert.rejects(redistribute(U.clerk, { transaction_ids: old, lines: [{ family_id: U.famA, amount: 90000 }] }), /lingane/);
  await assert.rejects(redistribute(U.clerk, { transaction_ids: old, reason: '', lines: [{ family_id: U.famA, amount: 100000 }] }), /sababu/);
  // another clerk did not record it and may not reverse
  await assert.rejects(redistribute(U.clerk2, { transaction_ids: old, lines: [{ family_id: U.famA, amount: 100000 }] }), /ruhusa/);
  assert.equal(N(await db.asAdmin().val('select count(*) from public.finance_transactions')), before);

  const key = db.key();
  const lines = [{ family_id: U.famA, amount: 50000 }, { parishioner_id: U.pB1, amount: 30000, period_month: '2026-06-01' },
                 { parishioner_id: U.pB2, amount: 20000 }];
  const fix = await redistribute(U.clerk, { idempotency_key: key, transaction_ids: old, lines });
  assert.equal(fix.status, 'posted', JSON.stringify(fix));
  assert.equal(fix.count, 3);
  assert.ok(fix.receipts.every(x => x.receipt_no));
  const o = await db.asAdmin().q(`select t.reversed_by_id, r.status from public.finance_transactions t join public.receipts r on r.transaction_id = t.id where t.id = any ($1)`, [old]);
  assert.ok(o.every(x => x.reversed_by_id && x.status === 'void'));
  const fresh = await db.asAdmin().q(`select amount, period_month, reference_no, txn_date, batch_id from public.finance_transactions where id = any ($1)`,
    [fix.receipts.map(x => x.transaction_id)]);
  assert.ok(fresh.every(x => x.reference_no === 'BNK-777' && x.batch_id === key));
  assert.equal(N(await db.asAdmin().val(`select count(*) from public.finance_transactions where id = any ($1) and period_month = '2026-06-01'`, [fix.receipts.map(x => x.transaction_id)])), 1);

  // the family totals follow the correction
  assert.equal(sum(await drill(U.clerk, { family: U.famA, kinds: ['zaka'], period_month: '2026-05-01' })), 50000);
  assert.equal(sum(await drill(U.clerk, { family: U.famB, kinds: ['zaka'], zaka_year: 2026 })), 50000);
  // the money in total did not change
  const net = await db.asAdmin().val(`select sum(net_amount) from public.finance_transactions where id = any ($1) or reverses_id = any ($1) or batch_id = $2`, [old, key]);
  assert.equal(N(net), 100000);

  // a retry posts nothing new; reversed lines cannot be corrected again
  const again = await redistribute(U.clerk, { idempotency_key: key, transaction_ids: old, lines });
  assert.equal(again.status, 'already_posted');
  await assert.rejects(redistribute(U.acc, { transaction_ids: old, lines: [{ family_id: U.famA, amount: 100000 }] }), /umesharudishwa/);
  // an accountant may correct what someone else recorded
  const fix2 = await redistribute(U.acc, { transaction_ids: fix.receipts.map(x => x.transaction_id), lines: [{ family_id: U.famA, amount: 100000 }] });
  assert.equal(fix2.status, 'posted');
});

test('lines of different kinds are not corrected together; one external reference is still one payment', async () => {
  const a = await pay(U.clerk, { amount: 1000, category_id: I['cat:ZAKA'], period_month: '2026-07-01', family_id: U.famA });
  const b = await pay(U.clerk, { amount: 1000, category_id: I['cat:MAVUNO'], family_id: U.famA });
  await assert.rejects(redistribute(U.acc, { transaction_ids: [a.transaction_id, b.transaction_id], lines: [{ family_id: U.famB, amount: 2000 }] }), /aina moja/);

  const m1 = await pay(U.clerk, { amount: 4000, category_id: I['cat:ZAKA'], period_month: '2026-07-01', family_id: U.famA, payment_method: 'mobile_money', reference_no: 'MP-1' });
  await assert.rejects(pay(U.clerk, { amount: 4000, category_id: I['cat:ZAKA'], period_month: '2026-08-01', family_id: U.famB, payment_method: 'mobile_money', reference_no: 'mp-1' }), /ft_unique_external_ref/);
  await assert.rejects(split(U.clerk, { amount: 2000, payment_method: 'mobile_money', reference_no: 'MP-1', lines: [{ family_id: U.famA, amount: 1000 }, { family_id: U.famB, amount: 1000 }] }), /ft_unique_external_ref/);
  // once that payment is corrected, its reference goes with the corrected entry
  const fix = await redistribute(U.clerk, { transaction_ids: [m1.transaction_id], lines: [{ family_id: U.famB, amount: 4000 }] });
  assert.equal(fix.status, 'posted');
});

test('a proof (photo / PDF) is attached to a payment, seen only by who sees the payment, and follows a correction', async () => {
  const p1 = await pay(U.clerk, { amount: 2500, category_id: I['cat:ZAKA'], period_month: '2026-09-01', family_id: U.famA });
  const add = (who, p) => db.as(who).rpc('add_payment_attachment', { transaction_ids: [p1.transaction_id], storage_path: `${p1.transaction_id}/x.pdf`,
    file_name: 'risiti ya benki.pdf', mime_type: 'application/pdf', size_bytes: 1000, ...p });
  await assert.rejects(add(U.clerk, { mime_type: 'application/zip' }), /picha au PDF/);
  await assert.rejects(add(U.clerk, { size_bytes: 20 * 1024 * 1024 }), /kubwa/);
  await assert.rejects(add(U.clara), /ruhusa/);           // a jumuiya leader does not record payments
  assert.equal((await add(U.clerk)).count, 1);
  assert.equal((await db.as(U.clara).q('select * from public.transaction_attachments where transaction_id = $1', [p1.transaction_id])).length, 1);
  assert.equal((await db.as(U.aug).q('select * from public.transaction_attachments where transaction_id = $1', [p1.transaction_id])).length, 0);
  const row = (await drill(U.clerk, { family: U.famA, period_month: '2026-09-01' }))[0];
  assert.equal(N(row.attachments), 1);
  const fix = await redistribute(U.clerk, { transaction_ids: [p1.transaction_id], lines: [{ family_id: U.famB, amount: 2500 }] });
  assert.equal(N(await db.asAdmin().val('select count(*) from public.transaction_attachments where transaction_id = $1', [fix.receipts[0].transaction_id])), 1);
});

test('a member can hold several titles; titles come from the administrator\'s list and are ended, not deleted', async () => {
  const pos = Object.fromEntries((await db.asAdmin().q('select code, id from public.leadership_positions')).map(r => [r.code, r.id]));
  const set = (who, list) => db.as(who).val('select public.set_person_titles($1, $2::uuid[])', [U.pB1, list]);
  await set(U.clara, [pos.KATIBU_JUMUIYA, pos.MWENYEKITI_JUMUIYA]);
  let held = await db.asAdmin().q(`select p.code, a.org_unit_id, a.status from public.leadership_assignments a join public.leadership_positions p on p.id = a.position_id where a.parishioner_id = $1`, [U.pB1]);
  assert.deepEqual(held.filter(h => h.status === 'active').map(h => h.code).sort(), ['KATIBU_JUMUIYA', 'MWENYEKITI_JUMUIYA']);
  assert.ok(held.every(h => h.org_unit_id === I['org:jumuiya:Clara']));
  // a jumuiya leader cannot make someone a parish officer, nor touch another jumuiya
  await assert.rejects(set(U.clara, [pos.KATIBU_JUMUIYA, pos.KATIBU_PAROKIA]), /ruhusa/);
  await assert.rejects(set(U.aug, [pos.KATIBU_JUMUIYA]), /ruhusa/);
  // the parish clerk can; a title taken away is ended
  await set(U.clerk, [pos.KATIBU_JUMUIYA, pos.KATIBU_PAROKIA]);
  held = await db.asAdmin().q(`select p.code, a.status from public.leadership_assignments a join public.leadership_positions p on p.id = a.position_id where a.parishioner_id = $1`, [U.pB1]);
  assert.deepEqual(held.filter(h => h.status === 'active').map(h => h.code).sort(), ['KATIBU_JUMUIYA', 'KATIBU_PAROKIA']);
  assert.equal(held.filter(h => h.status === 'ended').length, 1);
  // the administrator's list: a used title is switched off, an unused one deleted
  const admin = await db.user('admin@test.local', { parishRole: 'parish_admin' });
  const newId = await db.as(admin).val(`insert into public.leadership_positions (code, title_sw, level) values ('MTUNZA_KUMBUKUMBU', 'Mtunza Kumbukumbu', 'jumuiya') returning id`);
  await assert.rejects(db.as(U.clara).q(`insert into public.leadership_positions (code, title_sw, level) values ('X', 'X', 'jumuiya')`));
  assert.equal((await db.as(admin).val('select public.delete_leadership_position($1)', [pos.MWENYEKITI_JUMUIYA])).status, 'deactivated');
  assert.equal((await db.as(admin).val('select public.delete_leadership_position($1)', [newId])).status, 'deleted');
  await assert.rejects(set(U.clerk, [pos.KATIBU_JUMUIYA, pos.KATIBU_PAROKIA, pos.MWENYEKITI_JUMUIYA]), /hakitumiki/);
});
