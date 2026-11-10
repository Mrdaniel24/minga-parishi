// Fixes from the system audit (2026-11-10): a suspended account loses its rights in the
// database itself (not only in the browser), and removing a member needs a reason.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, ids } from './harness.mjs';

let db, I, U = {};
const N = Number;
before(async () => {
  db = await createDb();
  I = await ids(db);
  U.admin = await db.user('admin@t.local', { parishRole: 'parish_admin' });
  U.clerk = await db.user('clerk@t.local', { parishRole: 'data_entry' });
  db.asAdmin();
  U.fam = await db.val(`insert into public.families (parish_id, family_name, jumuiya_id) values (public.default_parish_id(), 'Familia Clara', $1) returning id`, [I['org:jumuiya:Clara']]);
  U.person = await db.val(`insert into public.parishioners (parish_id, full_name, family_id, jumuiya_id) values (public.default_parish_id(), 'Mtu wa Jaribio', $1, $2) returning id`, [U.fam, I['org:jumuiya:Clara']]);
  const today = new Date().toISOString().slice(0, 10);
  await db.as(U.clerk).rpc('post_payment', { idempotency_key: db.key(), payment_method: 'cash', category_id: I['cat:SHUKRANI'], family_id: U.fam, amount: 5000, txn_date: today });
});

test('a suspended account keeps its token but loses every right in the database', async () => {
  assert.equal(await db.as(U.clerk).val(`select public.has_perm('finance.record')`), true);
  assert.ok(N(await db.as(U.clerk).val(`select count(*) from public.finance_transactions`)) > 0);

  await db.as(U.admin).q(`select public.admin_set_user_status($1, false)`, [U.clerk]);

  db.as(U.clerk);
  assert.equal(await db.val(`select public.has_perm('finance.record')`), false);
  assert.equal(await db.val(`select public.has_perm_anywhere('finance.read')`), false);
  assert.equal(N(await db.val(`select count(*) from public.finance_transactions`)), 0);
  assert.equal(N(await db.val(`select count(*) from public.parishioners`)), 0);
  await assert.rejects(db.as(U.clerk).rpc('post_payment', { idempotency_key: db.key(), payment_method: 'cash', category_id: I['cat:SHUKRANI'], payer_name: 'X', amount: 1000 }), /ruhusa/);

  // re-activated: the rights come back
  await db.as(U.admin).q(`select public.admin_set_user_status($1, true)`, [U.clerk]);
  assert.equal(await db.as(U.clerk).val(`select public.has_perm('finance.record')`), true);
});

test('removing a member from the register needs a reason', async () => {
  await assert.rejects(db.as(U.admin).q(`select public.delete_parishioner($1, '  ')`, [U.person]), /Sababu/);
  await assert.rejects(db.as(U.admin).q(`select public.delete_parishioner($1)`, [U.person]), /Sababu/);
  assert.equal(N(await db.asAdmin().val(`select count(*) from public.parishioners where id = $1`, [U.person])), 1);
  const r = await db.as(U.admin).val(`select public.delete_parishioner($1, 'Ameandikishwa mara mbili')`, [U.person]);
  assert.ok(r);
  const log = await db.asAdmin().one(`select actor_id, note from public.audit_log where action = 'delete_parishioner' order by id desc limit 1`);
  assert.deepEqual(log, { actor_id: U.admin, note: 'Ameandikishwa mara mbili' });
});
