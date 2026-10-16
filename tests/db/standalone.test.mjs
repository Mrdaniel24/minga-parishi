// The system stands on its own (no Kanisa Hub) and accounts cannot see more than their role allows.
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
  U.leader = await db.user('leader@t.local', { parishRole: 'jumuiya_leader', org: I['org:jumuiya:Clara'] });
  U.plain = await db.user('plain@t.local');
  db.asAdmin();
  U.famClara = await db.val(`insert into public.families (parish_id, family_name, jumuiya_id) values (public.default_parish_id(), 'Familia Clara', $1) returning id`, [I['org:jumuiya:Clara']]);
  U.pClara = await db.val(`insert into public.parishioners (parish_id, full_name, family_id, jumuiya_id) values (public.default_parish_id(), 'Mlipaji Siri', $1, $2) returning id`, [U.famClara, I['org:jumuiya:Clara']]);
  U.famOther = await db.val(`insert into public.families (parish_id, family_name, jumuiya_id) values (public.default_parish_id(), 'Familia Dominico', $1) returning id`, [I['org:jumuiya:Dominico']]);
  const today = new Date().toISOString().slice(0, 10);
  await db.as(U.clerk).rpc('post_payment', { idempotency_key: db.key(), payment_method: 'cash', category_id: I['cat:SHUKRANI'], parishioner_id: U.pClara, amount: 150000, txn_date: today });
  await db.as(U.clerk).rpc('post_payment', { idempotency_key: db.key(), payment_method: 'cash', category_id: I['cat:SHUKRANI'], family_id: U.famOther, amount: 70000, txn_date: today });
});

test('no Kanisa Hub objects exist in the database', async () => {
  db.asAdmin();
  const left = await db.q(`select table_name from information_schema.tables where table_schema = 'public'
    and table_name in ('departments','admin_permissions','announcements','sermons','messages','media_items','contributions','events','church_contacts','visitors')`);
  assert.deepEqual(left, []);
  const fns = await db.q(`select proname from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('church_overview','kh_role','kh_is_admin','promote_to_admin','my_member_summary','request_parish_link')`);
  assert.deepEqual(fns, []);
});

test('a new login account gets a profile automatically, as an ordinary user', async () => {
  db.asAdmin();
  const p = await db.one(`select email, role, status from public.profiles where id = $1`, [U.plain]);
  assert.deepEqual(p, { email: 'plain@t.local', role: 'user', status: 'active' });
});

test('a user cannot make themselves super admin or re-activate themselves', async () => {
  await assert.rejects(db.as(U.plain).q(`update public.profiles set role = 'super_admin' where id = $1`, [U.plain]), /Huwezi kubadilisha/);
  // a parish admin is not the system administrator: the update reaches no row (RLS)
  await db.as(U.admin).q(`update public.profiles set status = 'inactive' where id = $1`, [U.plain]);
  db.asAdmin();
  assert.equal(await db.val(`select role from public.profiles where id = $1`, [U.plain]), 'user');
  assert.equal(await db.val(`select status from public.profiles where id = $1`, [U.plain]), 'active');
  // but a user may fix their own name
  await db.as(U.plain).q(`update public.profiles set full_name = 'Jina Jipya' where id = $1`, [U.plain]);
  assert.equal(await db.asAdmin().val(`select full_name from public.profiles where id = $1`, [U.plain]), 'Jina Jipya');
});

test('an account without a parish role sees no money, people or other accounts', async () => {
  db.as(U.plain);
  assert.equal(N(await db.val(`select count(*) from public.finance_transactions`)), 0);
  assert.equal(N(await db.val(`select count(*) from public.receipts`)), 0);
  assert.equal(N(await db.val(`select count(*) from public.parishioners`)), 0);
  assert.equal(N(await db.val(`select count(*) from public.families`)), 0);
  assert.equal(N(await db.val(`select count(*) from public.profiles`)), 1);      // only their own
  const d = await db.val(`select public.parish_dashboard()`);
  assert.equal(N(d.totals.income_month), 0);
  assert.ok(!JSON.stringify(d).includes('Mlipaji Siri'));
  await assert.rejects(db.as(U.plain).rpc('post_payment', { idempotency_key: db.key(), payment_method: 'cash', category_id: I['cat:SHUKRANI'], payer_name: 'X', amount: 1000 }), /ruhusa/);
});

test('a jumuiya leader sees only their own jumuiya', async () => {
  db.as(U.leader);
  const fams = await db.q(`select family_name from public.families order by 1`);
  assert.deepEqual(fams.map(f => f.family_name), ['Familia Clara']);
  const total = N(await db.val(`select coalesce(sum(amount),0) from public.finance_transactions`));
  assert.equal(total, 150000);
  assert.equal(N(await db.val(`select count(*) from public.profiles`)), 1);
});

test('people who manage users can look accounts up by e-mail', async () => {
  db.as(U.admin);
  assert.ok(N(await db.val(`select count(*) from public.profiles`)) >= 4);
  assert.equal(await db.val(`select id from public.profiles where email = 'plain@t.local'`), U.plain);
});
