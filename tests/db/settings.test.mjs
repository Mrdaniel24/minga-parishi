// Settings: contribution types and funds can be added, edited, switched off,
// and deleted only while nothing uses them.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, ids } from './harness.mjs';

let db, I, U = {};
before(async () => {
  db = await createDb();
  I = await ids(db);
  U.admin = await db.user('admin@t.local', { parishRole: 'parish_admin' });
  U.clerk = await db.user('clerk@t.local', { parishRole: 'data_entry' });
});
const parish = () => db.asAdmin().val(`select public.default_parish_id()`);

test('a new fund and a new contribution type can be created and deleted while unused', async () => {
  const p = await parish();
  db.as(U.admin);
  const fund = await db.val(`insert into public.funds (parish_id, code, name) values ($1, 'ELIMU', 'Mfuko wa Elimu') returning id`, [p]);
  const cat = await db.val(`insert into public.contribution_categories (parish_id, code, name_sw, kind, fund_id) values ($1, 'KWAYA', 'Mchango wa Kwaya', 'special', $2) returning id`, [p, fund]);
  await assert.rejects(db.as(U.admin).val(`select public.delete_fund($1)`, [fund]), /aina 1 za michango/);
  assert.equal((await db.as(U.admin).val(`select public.delete_contribution_category($1)`, [cat])).status, 'deleted');
  assert.equal((await db.as(U.admin).val(`select public.delete_fund($1)`, [fund])).status, 'deleted');
  assert.equal(Number(await db.asAdmin().val(`select count(*) from public.audit_log where action in ('delete_fund','delete_contribution_category')`)), 2);
});

test('a type with payments cannot be deleted, only switched off — and then takes no new payments', async () => {
  const p = await parish();
  const cat = await db.as(U.admin).val(`insert into public.contribution_categories (parish_id, code, name_sw, kind) values ($1, 'HARAMBEE_X', 'Harambee X', 'special') returning id`, [p]);
  await db.as(U.clerk).rpc('post_payment', { idempotency_key: db.key(), payment_method: 'cash', category_id: cat, payer_name: 'Mtu', amount: 5000 });
  await assert.rejects(db.as(U.admin).val(`select public.delete_contribution_category($1)`, [cat]), /ina miamala 1/);
  await db.as(U.admin).q(`update public.contribution_categories set is_active = false where id = $1`, [cat]);
  await assert.rejects(db.as(U.clerk).rpc('post_payment', { idempotency_key: db.key(), payment_method: 'cash', category_id: cat, payer_name: 'Mtu', amount: 5000 }), /haijulikani/);
});

test('only people allowed to configure finance may delete', async () => {
  const p = await parish();
  const fund = await db.asAdmin().val(`insert into public.funds (parish_id, code, name) values ($1, 'TEMP', 'Temp') returning id`, [p]);
  await assert.rejects(db.as(U.clerk).val(`select public.delete_fund($1)`, [fund]), /ruhusa/);
  await assert.rejects(db.as(U.clerk).q(`insert into public.funds (parish_id, code, name) values ($1, 'X2', 'X2')`, [p]), /row-level security|permission/);
});
