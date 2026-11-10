// Migration 33 (maboresho 2026-11-10): soft delete keeps attendance and titles,
// SMS to who actually paid zaka (or not), leaders report filters, stuck SMS.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, ids } from './harness.mjs';

let db, I, U = {};
const N = Number;
const CLARA = () => I['org:jumuiya:Clara'];

before(async () => {
  db = await createDb();
  I = await ids(db);
  U.admin = await db.user('admin@t.local', { parishRole: 'parish_admin' });
  U.clerk = await db.user('clerk@t.local', { parishRole: 'data_entry' });
  U.clara = await db.user('clara@t.local', { parishRole: 'jumuiya_leader', org: CLARA() });
  db.asAdmin();
  U.fam = await db.val(`insert into public.families (parish_id, family_name, jumuiya_id) values (public.default_parish_id(), 'Familia M', $1) returning id`, [CLARA()]);
  U.fam2 = await db.val(`insert into public.families (parish_id, family_name, jumuiya_id) values (public.default_parish_id(), 'Familia N', $1) returning id`, [CLARA()]);
  const person = (name, fam, phone, zaka = true) => db.val(
    `insert into public.parishioners (parish_id, full_name, family_id, jumuiya_id, phone, is_zaka_payer) values (public.default_parish_id(), $1, $2, $3, $4, $5) returning id`,
    [name, fam, CLARA(), phone, zaka]);
  U.paid = await person('Amelipa', U.fam, '0711 000 101');
  U.famPaid = await person('Wa familia iliyolipa', U.fam2, '0711 000 102');
  U.unpaid = await person('Hajalipa', null, '0711 000 103');
  U.notPayer = await person('Si mlipa zaka', null, '0711 000 104', false);
  const today = new Date().toISOString().slice(0, 10);
  await pay({ amount: 3000, category_id: I['cat:ZAKA'], parishioner_id: U.paid, txn_date: '2026-03-02', period_month: '2026-03-01' });
  await pay({ amount: 5000, category_id: I['cat:ZAKA'], family_id: U.fam2, txn_date: '2026-04-02', period_month: '2026-04-01' });
  // a payment that was reversed does not count as paid
  const r = await pay({ amount: 2000, category_id: I['cat:ZAKA'], parishioner_id: U.unpaid, txn_date: '2026-03-03', period_month: '2026-03-01' });
  await db.as(U.admin).val(`select public.reverse_transaction($1, 'Kosa la kuandika', gen_random_uuid(), $2::date)`, [r.transaction_id, today]);
});

const pay = p => db.as(U.clerk).rpc('post_payment', { idempotency_key: db.key(), payment_method: 'cash', ...p });
const names = async (aud, extra = {}) => {
  const m = await db.as(U.admin).rpc('sms_create', { body: 'Jaribio', audience: aud, ...extra });
  return (await db.asAdmin().q(`select full_name from public.sms_recipients where message_id = $1 order by 1`, [m.id])).map(r => r.full_name);
};

test('SMS to who actually paid zaka in a year / month, and to zaka payers who did not', async () => {
  assert.deepEqual(await names('zaka_paid', { zaka_year: 2026 }), ['Amelipa', 'Wa familia iliyolipa']);
  assert.deepEqual(await names('zaka_paid', { zaka_year: 2026, zaka_month: 3 }), ['Amelipa']);
  assert.deepEqual(await names('zaka_unpaid', { zaka_year: 2026 }), ['Hajalipa']);
  assert.deepEqual(await names('zaka_unpaid', { zaka_year: 2026, zaka_month: 4 }), ['Amelipa', 'Hajalipa']);
  const p = await db.as(U.admin).rpc('sms_preview', { audience: 'zaka_paid', zaka_year: 2025 });
  assert.equal(p.recipients, 0);
  const saved = await db.asAdmin().one(`select zaka_year, zaka_month from public.sms_messages where audience = 'zaka_paid' and zaka_month = 3`);
  assert.deepEqual(saved, { zaka_year: 2026, zaka_month: 3 });
});

test('a message stuck on "sending" is marked sent or failed by the sender, and logged', async () => {
  const m = await db.as(U.admin).rpc('sms_create', { body: 'Imekwama', audience: 'all' });
  await assert.rejects(db.as(U.admin).val(`select public.sms_resolve($1, true)`, [m.id]), /haujakwama/);
  await db.as(U.admin).val(`select public.sms_claim($1)`, [m.id]);
  await assert.rejects(db.as(U.clerk).val(`select public.sms_resolve($1, false)`, [m.id]), /ruhusa/);
  const r = await db.as(U.admin).val(`select public.sms_resolve($1, false, 'Beem haikupokea')`, [m.id]);
  assert.equal(r.status, 'failed');
  db.asAdmin();
  const row = await db.one(`select status, result->>'note' as note, (result->>'manual')::boolean as manual from public.sms_messages where id = $1`, [m.id]);
  assert.deepEqual(row, { status: 'failed', note: 'Beem haikupokea', manual: true });
  assert.ok(N(await db.val(`select count(*) from public.audit_log where action = 'sms_resolved_failed' and row_id = $1`, [m.id])) === 1);
  // failed can be tried again; stuck again and the provider says it went: sent
  await db.as(U.admin).val(`select public.sms_claim($1)`, [m.id]);
  assert.equal((await db.as(U.admin).val(`select public.sms_resolve($1, true)`, [m.id])).status, 'sent');
  await assert.rejects(db.as(U.admin).val(`select public.sms_claim($1)`, [m.id]), /umeshatumwa/);
});

test('leaders report: filter by one title, and titles that ended during the year are shown', async () => {
  db.asAdmin();
  const [katibu, mhazini] = (await db.q(`select id from public.leadership_positions where level = 'jumuiya' and is_active order by sort_order limit 2`)).map(r => r.id);
  await db.as(U.clerk).val(`select public.set_person_titles($1, $2::uuid[])`, [U.paid, [katibu]]);
  await db.as(U.clerk).val(`select public.set_person_titles($1, $2::uuid[])`, [U.unpaid, [mhazini]]);
  await db.as(U.clerk).val(`select public.set_person_titles($1, $2::uuid[])`, [U.unpaid, []]);     // ended today
  const year = new Date().getFullYear();
  const all = await db.as(U.clerk).q(`select * from public.leaders_contributions($1)`, [year]);
  const ended = all.find(r => r.parishioner_id === U.unpaid);
  assert.ok(ended, 'a title that ended this year is still in the report');
  assert.equal(ended.titles, null);
  assert.match(ended.ended_titles, /\(hadi \d\d\/\d\d\/\d{4}\)/);
  const current = await db.as(U.clerk).q(`select * from public.leaders_contributions($1, null, null, false)`, [year]);
  assert.ok(!current.some(r => r.parishioner_id === U.unpaid));
  const onlyKatibu = await db.as(U.clerk).q(`select * from public.leaders_contributions($1, null, $2)`, [year, katibu]);
  assert.deepEqual(onlyKatibu.map(r => r.parishioner_id), [U.paid]);
  // an earlier year: current titles are listed as before, a title that ended this year is not
  const old = await db.as(U.clerk).q(`select * from public.leaders_contributions($1)`, [year - 5]);
  assert.ok(old.some(r => r.parishioner_id === U.paid));
  assert.ok(!old.some(r => r.parishioner_id === U.unpaid));
});

test('a removed member keeps attendance and title history; can be brought back', async () => {
  db.asAdmin();
  const katibu = await db.val(`select id from public.leadership_positions where level = 'jumuiya' and is_active order by sort_order limit 1`);
  const p = await db.val(`insert into public.parishioners (parish_id, full_name, family_id, jumuiya_id) values (public.default_parish_id(), 'Mtu wa Mahudhurio', $1, $2) returning id`, [U.fam, CLARA()]);
  await db.as(U.clerk).val(`select public.set_person_titles($1, $2::uuid[])`, [p, [katibu]]);
  const today = new Date().toISOString().slice(0, 10);
  await db.as(U.clara).rpc('save_attendance', { org_unit_id: CLARA(), held_on: today, title: 'Sala', marks: [{ parishioner_id: p, status: 'present' }] });
  await db.as(U.clara).val(`select public.delete_parishioner($1, 'Amehamia parokia nyingine')`, [p]);
  db.asAdmin();
  assert.equal(N(await db.val(`select count(*) from public.attendance_marks where parishioner_id = $1`, [p])), 1);
  assert.deepEqual(await db.one(`select status, parishioner_id from public.leadership_assignments where parishioner_id = $1`, [p]), { status: 'ended', parishioner_id: p });
  // not on new attendance lists or SMS lists any more
  const roster = await db.as(U.clara).q(`select * from public.attendance_summary($1, $2)`, [CLARA(), new Date().getFullYear()]);
  assert.ok(!roster.some(r => r.parishioner_id === p));
  // brought back: active again, the removal note is cleared (the audit log keeps it)
  await db.as(U.admin).q(`update public.parishioners set membership_status = 'active' where id = $1`, [p]);
  assert.deepEqual(await db.asAdmin().one(`select membership_status, removed_reason from public.parishioners where id = $1`, [p]), { membership_status: 'active', removed_reason: null });
});
