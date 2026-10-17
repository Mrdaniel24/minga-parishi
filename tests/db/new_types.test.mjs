// A new contribution type can be added where the contribution is chosen — not only in Settings.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, ids } from './harness.mjs';

let db, I, U = {};
before(async () => {
  db = await createDb();
  I = await ids(db);
  U.clerk = await db.user('clerk@t.local', { parishRole: 'data_entry' });
  U.leader = await db.user('leader@t.local', { parishRole: 'jumuiya_leader', org: I['org:jumuiya:Clara'] });
  U.none = await db.user('nobody@t.local');
});

test('the clerk adds a new type while recording a payment, and the payment goes through', async () => {
  const t = await db.as(U.clerk).val(`select public.create_contribution_type($1)`, [{ name: 'Harambee ya Kengele ya Kanisa' }]);
  assert.equal(t.created, true); assert.equal(t.code, 'HARAMBEE_YA_KENGELE_YA_KANISA');
  const r = await db.as(U.clerk).rpc('post_payment', { idempotency_key: db.key(), payment_method: 'cash', category_id: t.id, payer_name: 'Mzee Juma', amount: 15000, txn_date: '2026-10-17' });
  assert.equal(r.status, 'posted');
});

test('the same name again uses the existing type (no duplicates, case does not matter)', async () => {
  const a = await db.as(U.leader).val(`select public.create_contribution_type($1)`, [{ name: '  harambee ya kengele ya   KANISA ' }]);
  assert.equal(a.created, false);
  const b = await db.as(U.leader).val(`select public.create_contribution_type($1)`, [{ name: 'Radio Maria' }]);
  assert.equal(b.created, false); assert.equal(b.id, I['cat:RADIO_MARIA']);
});

test('a jumuiya leader adds a type and assigns it to their jumuiya in one go', async () => {
  const t = await db.as(U.leader).val(`select public.create_contribution_type($1)`, [{ name: 'Ujenzi wa Kanisa Dogo la Jumuiya' }]);
  const r = await db.as(U.leader).val(`select public.set_unit_target($1)`, [{ org_unit_id: I['org:jumuiya:Clara'], category_id: t.id, year: 2026, amount: 200000 }]);
  assert.equal(r.status, 'saved');
});

test('someone without a finance role cannot add types', async () => {
  await assert.rejects(db.as(U.none).val(`select public.create_contribution_type($1)`, [{ name: 'Mchango wa Ajabu' }]), /ruhusa/);
});
