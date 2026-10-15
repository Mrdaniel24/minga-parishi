// One system: Kanisa Hub accounts/departments/chat ↔ parish register and ledger.
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
  U.member = await db.user('member@t.local');
  U.other = await db.user('other@t.local');
  db.asAdmin();
  U.fam = await db.val(`insert into public.families (parish_id, family_name, jumuiya_id) values (public.default_parish_id(), 'Familia X', $1) returning id`, [I['org:jumuiya:Clara']]);
  U.p = await db.val(`insert into public.parishioners (parish_id, full_name, family_id, jumuiya_id) values (public.default_parish_id(), 'Mtu X', $1, $2) returning id`, [U.fam, I['org:jumuiya:Clara']]);
});

test('every jumuiya and parish group is a Kanisa Hub department', async () => {
  db.asAdmin();
  const n = N(await db.val(`select count(*) from public.departments where org_unit_id is not null`));
  const units = N(await db.val(`select count(*) from public.org_units where unit_type in ('jumuiya','group')`));
  assert.equal(n, units);
  assert.equal(await db.val(`select name from public.departments where org_unit_id = $1`, [I['org:jumuiya:Clara']]), 'Jumuiya ya Clara');
});

test('a parish role makes the user a Kanisa Hub admin scoped to their jumuiya', async () => {
  db.asAdmin();
  assert.equal(await db.val(`select role from public.profiles where id = $1`, [U.leader]), 'admin');
  const perm = await db.one(`select ap.*, d.org_unit_id from public.admin_permissions ap join public.departments d on d.id = ap.department_id where admin_id = $1`, [U.leader]);
  assert.equal(perm.org_unit_id, I['org:jumuiya:Clara']);
  const adm = await db.one(`select * from public.admin_permissions where admin_id = $1`, [U.admin]);
  assert.equal(adm.department_id, null);
  assert.equal(adm.can_view_all_contributions, true);
});

test('member requests a link, the jumuiya leader approves, the member sees their own giving', async () => {
  let s = await db.as(U.member).val(`select public.my_member_summary()`);
  assert.equal(s.linked, false);
  const r = await db.as(U.member).rpc('request_parish_link', { jumuiya_id: I['org:jumuiya:Clara'], full_name: 'Mtu X' });
  assert.equal(r.status, 'pending');
  // another member cannot approve; the Clara leader can
  await assert.rejects(db.as(U.other).val(`select public.decide_parish_link($1, true, $2)`, [r.request_id, U.p]), /ruhusa/);
  const d = await db.as(U.leader).val(`select public.decide_parish_link($1, true, $2)`, [r.request_id, U.p]);
  assert.equal(d.status, 'approved');
  // profile department follows the jumuiya → announcements & chat of the jumuiya
  const dep = await db.asAdmin().val(`select d.org_unit_id from public.profiles p join public.departments d on d.id = p.department_id where p.id = $1`, [U.member]);
  assert.equal(dep, I['org:jumuiya:Clara']);
  // payments by the person and by the family show up in the member's summary
  const pay = a => db.as(U.clerk).rpc('post_payment', { idempotency_key: db.key(), payment_method: 'cash', txn_date: '2026-03-01', ...a });
  await pay({ amount: 5000, category_id: I['cat:ZAKA'], parishioner_id: U.p, period_month: '2026-03-01' });
  await pay({ amount: 20000, category_id: I['cat:MAVUNO'], campaign_id: I['camp:MAVUNO:2026'], family_id: U.fam });
  s = await db.as(U.member).val(`select public.my_member_summary(2026)`);
  assert.equal(s.linked, true);
  assert.equal(s.parishioner.jumuiya, 'Clara');
  assert.equal(N(s.mine_year), 5000);
  assert.equal(N(s.family_year), 25000);
  assert.deepEqual(s.zaka_months, [3]);
  assert.equal(s.recent.length, 2);
  // the member reads only their own ledger rows
  assert.equal(N(await db.as(U.member).val(`select count(*) from public.finance_transactions`)), 2);
  assert.equal(N(await db.as(U.other).val(`select count(*) from public.finance_transactions`)), 0);
});

test('jumuiya announcements reach the jumuiya members', async () => {
  db.asAdmin();
  const dept = await db.val(`select id from public.departments where org_unit_id = $1`, [I['org:jumuiya:Clara']]);
  await db.q(`insert into public.announcements (title, content, target_type, department_id) values ('Kikao', 'Jumatano', 'department', $1)`, [dept]);
  assert.equal(N(await db.as(U.member).val(`select count(*) from public.announcements where title = 'Kikao'`)), 1);
  assert.equal(N(await db.as(U.other).val(`select count(*) from public.announcements where title = 'Kikao'`)), 0);
});

test('general dashboard overview reads the parish ledger and register', async () => {
  const o = await db.as(U.admin).val(`select public.church_overview()`);
  assert.equal(N(o.vigango), 7);
  assert.equal(N(o.income_year), 25000);
  assert.ok(N(o.parishioners) >= 1);
  const l = await db.as(U.leader).val(`select public.church_overview()`);
  assert.equal(l.scope, 'Clara');
});
