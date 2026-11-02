// Zaka brought by a jumuiya, divided among families and members â€” run with: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, ids } from './harness.mjs';

let db, I, U = {};
const N = v => Number(v);

before(async () => {
  db = await createDb();
  I = await ids(db);
  U.clerk = await db.user('clerk@test.local', { parishRole: 'data_entry' });
  U.clara = await db.user('clara@test.local', { parishRole: 'jumuiya_leader', org: I['org:jumuiya:Clara'] });
  db.asAdmin();
  const fam = (name, jum) => db.val(
    `insert into public.families (parish_id, family_name, jumuiya_id) values (public.default_parish_id(), $1, $2) returning id`, [name, jum]);
  const person = (name, family, jum) => db.val(
    `insert into public.parishioners (parish_id, full_name, family_id, jumuiya_id) values (public.default_parish_id(), $1, $2, $3) returning id`, [name, family, jum]);
  U.famA = await fam('Familia A', I['org:jumuiya:Clara']);
  U.famB = await fam('Familia B', I['org:jumuiya:Clara']);
  U.famC = await fam('Familia C', I['org:jumuiya:Augustino']);
  U.pB1 = await person('Mtu B1', U.famB, I['org:jumuiya:Clara']);
  U.pB2 = await person('Mtu B2', U.famB, I['org:jumuiya:Clara']);
  U.pC1 = await person('Mtu C1', U.famC, I['org:jumuiya:Augustino']);
});

const split = (who, p) => db.as(who).rpc('post_zaka_split', {
  idempotency_key: db.key(), jumuiya_id: I['org:jumuiya:Clara'], txn_date: '2026-05-10', payment_method: 'cash', period_month: '2026-05-01', ...p });

test('200,000 split to one family and two members of another: one receipt each, all zaka of the right month', async () => {
  const key = db.key();
  const lines = [{ family_id: U.famA, amount: 120000 }, { parishioner_id: U.pB1, amount: 50000 }, { parishioner_id: U.pB2, amount: 30000 }];
  const r = await split(U.clerk, { idempotency_key: key, amount: 200000, brought_by: 'Katibu wa Clara', lines });
  assert.equal(r.status, 'posted', JSON.stringify(r));
  assert.equal(r.count, 3);
  assert.ok(r.receipts.every(x => x.receipt_no));
  const rows = await db.asAdmin().q(`select t.family_id, t.parishioner_id, t.amount, t.period_month, t.jumuiya_id, c.code, t.description
    from public.finance_transactions t join public.contribution_categories c on c.id = t.category_id
    where t.description like 'Zaka ya Jumuiya ya Clara%' order by t.amount desc`);
  assert.equal(rows.length, 3);
  assert.equal(rows.reduce((s, x) => s + N(x.amount), 0), 200000);
  assert.ok(rows.every(x => x.code === 'ZAKA' && x.jumuiya_id === I['org:jumuiya:Clara'] && String(x.period_month).includes('2026')));
  assert.equal(rows[1].parishioner_id, U.pB1);
  assert.equal(rows[1].family_id, U.famB);            // the member's family is recorded too
  assert.match(rows[0].description, /imeletwa na Katibu wa Clara/);
  // the same submission again (double click) posts nothing new
  const again = await split(U.clerk, { idempotency_key: key, amount: 200000, lines });
  assert.equal(again.status, 'already_posted');
  assert.equal(again.receipts.length, 3);
  assert.equal(N(await db.asAdmin().val(`select count(*) from public.finance_transactions where description like 'Zaka ya Jumuiya ya Clara%'`)), 3);
});

test('the split must add up to what was brought, and nothing is saved when it does not', async () => {
  const before = N(await db.asAdmin().val('select count(*) from public.finance_transactions'));
  await assert.rejects(split(U.clerk, { amount: 200000, lines: [{ family_id: U.famA, amount: 150000 }] }), /haulingani/);
  await assert.rejects(split(U.clerk, { amount: 100000, lines: [{ family_id: U.famA, amount: 60000 }, { family_id: U.famA, amount: 40000 }] }), /mara mbili/);
  await assert.rejects(split(U.clerk, { amount: 50000, lines: [{ family_id: U.famC, amount: 50000 }] }), /si ya Jumuiya/);
  await assert.rejects(split(U.clerk, { amount: 50000, lines: [{ parishioner_id: U.pC1, amount: 50000 }] }), /si wa Jumuiya/);
  await assert.rejects(split(U.clerk, { amount: 50000, lines: [] }), /angalau familia moja/);
  // a failing line rolls back the lines before it
  await assert.rejects(split(U.clerk, { amount: 90000, lines: [{ family_id: U.famA, amount: 50000 }, { parishioner_id: U.pC1, amount: 40000 }] }));
  assert.equal(N(await db.asAdmin().val('select count(*) from public.finance_transactions')), before);
});

test('someone without finance.record (a jumuiya leader) cannot record it', async () => {
  await assert.rejects(split(U.clara, { amount: 10000, lines: [{ family_id: U.famA, amount: 10000 }] }), /ruhusa/);
});
