// Moving / removing members, the new year, leaders' report, accounts by phone,
// attendance, announcements and SMS (migrations 26–31) — run with: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, ids } from './harness.mjs';

let db, I, U = {};
const N = v => Number(v);
const CLARA = () => I['org:jumuiya:Clara'], AUG = () => I['org:jumuiya:Augustino'];

before(async () => {
  db = await createDb();
  I = await ids(db);
  U.admin = await db.user('admin@test.local', { parishRole: 'parish_admin' });
  U.clerk = await db.user('clerk@test.local', { parishRole: 'data_entry' });
  U.clara = await db.user('clara@test.local', { parishRole: 'jumuiya_leader', org: CLARA() });
  U.super = await db.user('super@test.local', { role: 'super_admin' });
  U.plain = await db.user('plain@test.local');
  db.asAdmin();
  const fam = (name, jum) => db.val(
    `insert into public.families (parish_id, family_name, jumuiya_id) values (public.default_parish_id(), $1, $2) returning id`, [name, jum]);
  const person = (name, family, jum, phone = null, zaka = false) => db.val(
    `insert into public.parishioners (parish_id, full_name, family_id, jumuiya_id, phone, is_zaka_payer) values (public.default_parish_id(), $1, $2, $3, $4, $5) returning id`,
    [name, family, jum, phone, zaka]);
  U.famA = await fam('Familia A', CLARA());
  U.famC = await fam('Familia C', AUG());
  U.pA1 = await person('Mtu A1', U.famA, CLARA(), '0712 000 001', true);
  U.pA2 = await person('Mtu A2', U.famA, CLARA(), '+255 712 000 002');
  U.pA3 = await person('Mtu A3', U.famA, CLARA(), '0712000001', true);   // same number as A1
  U.pC1 = await person('Mtu C1', U.famC, AUG(), '0754 000 003', true);
});

const pay = (who, p) => db.as(who).rpc('post_payment', { idempotency_key: db.key(), payment_method: 'cash', ...p });
const call = (who, sql, params) => db.as(who).val(sql, params);

test('a member who moves to another jumuiya takes their payments along; history is kept', async () => {
  await pay(U.clerk, { amount: 5000, category_id: I['cat:ZAKA'], parishioner_id: U.pA2, txn_date: '2026-03-02', period_month: '2026-03-01' });
  await pay(U.clerk, { amount: 7000, category_id: I['cat:SHUKRANI'], parishioner_id: U.pA2, txn_date: '2026-03-09' });
  // a jumuiya leader cannot move someone into a jumuiya that is not theirs
  await assert.rejects(call(U.clara, `select public.move_parishioner($1, $2, null)`, [U.pA2, U.famC]), /ruhusa/);
  const r = await call(U.clerk, `select public.move_parishioner($1, $2, null, null, true, 'Amehamia Augustino')`, [U.pA2, U.famC]);
  assert.equal(r.payments_moved, 2);
  db.asAdmin();
  const p = await db.one(`select family_id, jumuiya_id from public.parishioners where id = $1`, [U.pA2]);
  assert.deepEqual(p, { family_id: U.famC, jumuiya_id: AUG() });
  const tx = await db.q(`select jumuiya_id, kigango_id, org_unit_id, family_id, amount from public.finance_transactions where parishioner_id = $1`, [U.pA2]);
  assert.equal(tx.length, 2);
  const augK = await db.val(`select public.org_ancestor_of_type($1, 'kigango')`, [AUG()]);
  assert.ok(tx.every(t => t.jumuiya_id === AUG() && t.org_unit_id === AUG() && t.family_id === U.famC && t.kigango_id === augK));
  const h = await db.one(`select from_jumuiya_id, to_jumuiya_id, reason from public.membership_history where parishioner_id = $1 order by id desc limit 1`, [U.pA2]);
  assert.deepEqual(h, { from_jumuiya_id: CLARA(), to_jumuiya_id: AUG(), reason: 'Amehamia Augustino' });
  // the ledger is still immutable outside these functions
  await assert.rejects(db.q(`update public.finance_transactions set jumuiya_id = $1 where parishioner_id = $2`, [CLARA(), U.pA2]), /hauwezi kubadilishwa/);
  // moving back without the money leaves the payments in Augustino
  const back = await call(U.clerk, `select public.move_parishioner($1, $2, null, null, false)`, [U.pA2, U.famA]);
  assert.equal(back.payments_moved, 0);
  assert.equal(N(await db.asAdmin().val(`select count(*) from public.finance_transactions where parishioner_id = $1 and jumuiya_id = $2`, [U.pA2, AUG()])), 2);
});

test('a member can start a new family in the new jumuiya; a whole family can move', async () => {
  const r = await call(U.clerk, `select public.move_parishioner($1, null, $2, 'Familia Mpya ya A3', true)`, [U.pA3, AUG()]);
  const f = await db.asAdmin().one(`select family_name, jumuiya_id, head_parishioner_id from public.families where id = $1`, [r.family_id]);
  assert.deepEqual(f, { family_name: 'Familia Mpya ya A3', jumuiya_id: AUG(), head_parishioner_id: U.pA3 });
  await pay(U.clerk, { amount: 3000, category_id: I['cat:ZAKA'], family_id: U.famC, txn_date: '2026-04-02', period_month: '2026-04-01' });
  const m = await call(U.clerk, `select public.move_family($1, $2, true)`, [U.famC, CLARA()]);
  assert.ok(m.payments_moved >= 1);
  db.asAdmin();
  assert.equal(await db.val(`select jumuiya_id from public.parishioners where id = $1`, [U.pC1]), CLARA());
  assert.equal(N(await db.val(`select count(*) from public.finance_transactions where family_id = $1 and jumuiya_id <> $2`, [U.famC, CLARA()])), 0);
});

test('a whole family can move when its local family code already exists in the destination', async () => {
  db.asAdmin();
  const source = await db.val(`insert into public.families (parish_id, family_name, family_code, jumuiya_id)
    values (public.default_parish_id(), 'Familia yenye namba inayohama', 'F-23', $1) returning id`, [AUG()]);
  const destination = await db.val(`insert into public.families (parish_id, family_name, family_code, jumuiya_id)
    values (public.default_parish_id(), 'Familia iliyopo yenye namba', 'F-23', $1) returning id`, [CLARA()]);
  const member = await db.val(`insert into public.parishioners (parish_id, full_name, family_id, jumuiya_id)
    values (public.default_parish_id(), 'Muumini wa familia inayohama', $1, $2) returning id`, [source, AUG()]);
  await pay(U.clerk, { amount: 4500, category_id: I['cat:ZAKA'], parishioner_id: member, txn_date: '2026-05-11', period_month: '2026-05-01' });

  const moved = await call(U.clerk, `select public.move_family($1, $2, true, 'Jaribio la mgongano wa namba')`, [source, CLARA()]);
  assert.equal(moved.previous_family_code, 'F-23');
  assert.equal(moved.family_code, 'F-23-2');
  assert.equal(moved.payments_moved, 1);
  db.asAdmin();
  assert.equal(await db.val(`select jumuiya_id from public.families where id = $1`, [source]), CLARA());
  assert.equal(await db.val(`select jumuiya_id from public.parishioners where id = $1`, [member]), CLARA());
  assert.equal(await db.val(`select family_id from public.finance_transactions where parishioner_id = $1 and jumuiya_id = $2`, [member, CLARA()]), source);
  assert.equal(await db.val(`select family_code from public.families where id = $1`, [destination]), 'F-23');
  assert.ok(await db.val(`select count(*) from public.audit_log where action = 'move_family' and row_id = $1
    and old_data->>'family_code' = 'F-23' and new_data->>'family_code' = 'F-23-2'`, [source]) > 0);
});

test('a removed member stays on record (soft delete): payments, name and family kept', async () => {
  const p = await db.asAdmin().val(`insert into public.parishioners (parish_id, full_name, family_id, jumuiya_id) values (public.default_parish_id(), 'Mtu Atakayefutwa', $1, $2) returning id`, [U.famA, CLARA()]);
  await pay(U.clerk, { amount: 4000, category_id: I['cat:ZAKA'], parishioner_id: p, txn_date: '2026-05-02', period_month: '2026-05-01' });
  await assert.rejects(call(U.plain, `select public.delete_parishioner($1)`, [p]), /ruhusa/);
  const r = await call(U.clara, `select public.delete_parishioner($1, 'Ameondoka parokiani')`, [p]);
  assert.equal(r.payments_kept, 1);
  db.asAdmin();
  const per = await db.one(`select membership_status, removed_reason, removed_by, removed_on is not null as dated from public.parishioners where id = $1`, [p]);
  assert.deepEqual(per, { membership_status: 'removed', removed_reason: 'Ameondoka parokiani', removed_by: U.clara, dated: true });
  const t = await db.one(`select parishioner_id, family_id, jumuiya_id, amount from public.finance_transactions where parishioner_id = $1`, [p]);
  assert.deepEqual({ ...t, amount: N(t.amount) }, { parishioner_id: p, family_id: t.family_id, jumuiya_id: CLARA(), amount: 4000 });
  assert.ok(await db.val(`select count(*) from public.audit_log where action = 'delete_parishioner' and row_id = $1`, [p]) > 0);
  await assert.rejects(call(U.clara, `select public.delete_parishioner($1, 'tena')`, [p]), /ameshaondolewa/);
});

test('the first payment of a new year opens that year by itself', async () => {
  db.asAdmin();
  const fy = await db.val(`select id from public.financial_years where label = '2027'`);
  await db.q(`update public.campaigns set financial_year_id = null where financial_year_id = $1`, [fy]);
  await db.q(`delete from public.accounting_periods where financial_year_id = $1`, [fy]);
  await db.q(`delete from public.financial_years where id = $1`, [fy]);
  // December zaka paid in January: dated in the new year, counted for December
  const r = await pay(U.clerk, { amount: 6000, category_id: I['cat:ZAKA'], parishioner_id: U.pA1, txn_date: '2027-01-04', period_month: '2026-12-01' });
  assert.equal(r.status, 'posted');
  db.asAdmin();
  const y = await db.one(`select label, starts_on::text s, ends_on::text e, (select count(*) from public.accounting_periods where financial_year_id = f.id)::int n
                            from public.financial_years f where label = '2027'`);
  assert.deepEqual(y, { label: '2027', s: '2027-01-01', e: '2027-12-31', n: 12 });
  assert.equal(await db.val(`select to_char(period_month, 'YYYY-MM') from public.finance_transactions where id = $1`, [r.transaction_id]), '2026-12');
  // a date far from today does not open a year
  await assert.rejects(pay(U.clerk, { amount: 1000, category_id: I['cat:SHUKRANI'], parishioner_id: U.pA1, txn_date: '2062-01-04' }), /Hakuna mwaka wa fedha/);
});

test('leaders report: members with titles and what they gave; scoped and hidden from members', async () => {
  db.asAdmin();
  const katibu = await db.val(`select id from public.leadership_positions where level = 'jumuiya' order by sort_order limit 1`);
  await db.as(U.clerk).val(`select public.set_person_titles($1, $2::uuid[])`, [U.pA1, [katibu]]);
  await pay(U.clerk, { amount: 2000, category_id: I['cat:ZAKA'], parishioner_id: U.pA1, txn_date: '2026-06-02', period_month: '2026-06-01' });
  await pay(U.clerk, { amount: 2500, category_id: I['cat:ZAKA'], parishioner_id: U.pA1, txn_date: '2026-07-02', period_month: '2026-07-01' });
  await pay(U.clerk, { amount: 9000, category_id: I['cat:SHUKRANI'], parishioner_id: U.pA1, txn_date: '2026-07-09' });
  const rows = await db.as(U.clerk).q(`select * from public.leaders_contributions(2026)`);
  const a1 = rows.find(r => r.parishioner_id === U.pA1);
  assert.ok(a1, 'the leader is listed');
  assert.equal(N(a1.zaka), 10500);       // June + July, and December's 6,000 paid in January (test above)
  assert.equal(a1.zaka_months, 3);
  assert.equal(N(a1.personal), 9000);
  assert.ok(a1.titles.length > 0);
  // the Clara leader sees Clara's leaders; a plain account sees nothing
  assert.ok((await db.as(U.clara).q(`select * from public.leaders_contributions(2026)`)).some(r => r.parishioner_id === U.pA1));
  assert.equal((await db.as(U.plain).q(`select * from public.leaders_contributions(2026)`)).length, 0);
});

test('accounts by phone: the administrator creates them, resets passwords, switches e-mail accounts to phone', async () => {
  assert.equal(await db.asAdmin().val(`select public.normalize_phone('0712 345 678')`), '255712345678');
  assert.equal(await db.val(`select public.normalize_phone('+255-754-000-111')`), '255754000111');
  assert.equal(await db.val(`select public.normalize_phone('12')`), null);
  const r = await db.as(U.admin).val(`select public.admin_create_user($1::jsonb)`, [JSON.stringify({
    full_name: 'Katibu Clara', phone: '0713 111 222', password: 'siri123', role_code: 'jumuiya_leader', org_unit_id: CLARA(), parishioner_id: U.pA1 })]);
  db.asAdmin();
  const u = await db.one(`select email, encrypted_password from auth.users where id = $1`, [r.id]);
  assert.equal(u.email, '255713111222@simu.parokia.local');
  assert.equal(u.encrypted_password, await db.val(`select extensions.crypt('siri123', 'x$')`));
  assert.deepEqual(await db.one(`select full_name, phone from public.profiles where id = $1`, [r.id]), { full_name: 'Katibu Clara', phone: '255713111222' });
  assert.equal(await db.val(`select role_code from public.parish_user_roles where user_id = $1`, [r.id]), 'jumuiya_leader');
  assert.equal(await db.val(`select profile_id from public.parishioners where id = $1`, [U.pA1]), r.id);
  // the same number twice, a bad number, a short password
  const mk = p => db.as(U.admin).val(`select public.admin_create_user($1::jsonb)`, [JSON.stringify(p)]);
  await assert.rejects(mk({ full_name: 'X', phone: '0713111222', password: 'siri123' }), /ipo tayari|inatumiwa/);
  await assert.rejects(mk({ full_name: 'X', phone: '12', password: 'siri123' }), /si sahihi/);
  await assert.rejects(mk({ full_name: 'X', phone: '0713111333', password: '123' }), /6/);
  await assert.rejects(db.as(U.clerk).val(`select public.admin_create_user($1::jsonb)`, [JSON.stringify({ full_name: 'X', phone: '0713111444', password: 'siri123' })]), /ruhusa/);
  // forgotten password
  await db.as(U.admin).val(`select public.admin_set_password($1, 'mpya456')`, [r.id]);
  assert.equal(await db.asAdmin().val(`select encrypted_password from auth.users where id = $1`, [r.id]), await db.val(`select extensions.crypt('mpya456', 'x$')`));
  await assert.rejects(db.as(U.admin).val(`select public.admin_set_password($1, 'mpya456')`, [U.super]), /Msimamizi wa Mfumo/);
  await assert.rejects(db.as(U.clara).val(`select public.admin_set_password($1, 'mpya456')`, [r.id]), /ruhusa/);
  // an e-mail account switched to phone
  await db.as(U.admin).val(`select public.admin_set_login_phone($1, '0744 555 666')`, [U.clerk]);
  assert.equal(await db.asAdmin().val(`select email from auth.users where id = $1`, [U.clerk]), '255744555666@simu.parokia.local');
  assert.equal(await db.as(U.admin).val(`select public.find_user('0744555666')`), U.clerk);
  assert.equal(await db.as(U.clara).val(`select public.find_user('0744555666')`), null);
  // suspend and re-activate
  await db.as(U.admin).val(`select public.admin_set_user_status($1, false)`, [U.plain]);
  assert.equal(await db.asAdmin().val(`select status from public.profiles where id = $1`, [U.plain]), 'inactive');
  await db.as(U.admin).val(`select public.admin_set_user_status($1, true)`, [U.plain]);
  await assert.rejects(db.as(U.admin).val(`select public.admin_set_user_status($1, false)`, [U.admin]), /mwenyewe/);
});

test('attendance: the jumuiya leader records it; others cannot; the summary counts it', async () => {
  const marks = [{ parishioner_id: U.pA1, status: 'present' }, { parishioner_id: U.pC1, status: 'excused' }];
  const r = await db.as(U.clara).rpc('save_attendance', { org_unit_id: CLARA(), held_on: '2026-10-04', title: 'Sala ya jumuiya', marks });
  assert.equal(r.marks, 2);
  await assert.rejects(db.as(U.clara).rpc('save_attendance', { org_unit_id: AUG(), held_on: '2026-10-04', marks: [] }), /permission denied/);
  // A3 moved to Augustino (test above)
  await assert.rejects(db.as(U.clara).rpc('save_attendance', { org_unit_id: CLARA(), held_on: '2026-10-11', marks: [{ parishioner_id: U.pA3, status: 'present' }] }), /si wa jumuiya/);
  await db.as(U.clara).rpc('save_attendance', { org_unit_id: CLARA(), held_on: '2026-10-18', marks: [{ parishioner_id: U.pA1, status: 'present' }] });
  const s = await db.as(U.clara).q(`select * from public.attendance_summary($1, 2026)`, [CLARA()]);
  const a1 = s.find(x => x.parishioner_id === U.pA1), c1 = s.find(x => x.parishioner_id === U.pC1);
  assert.deepEqual([a1.sessions, a1.present, N(a1.rate)], [2, 2, 100]);
  assert.deepEqual([c1.present, c1.excused, c1.absent], [0, 1, 1]);
  // editing a session replaces its marks
  await db.as(U.clara).rpc('save_attendance', { id: r.id, held_on: '2026-10-04', title: 'Sala ya jumuiya', marks: [{ parishioner_id: U.pA1, status: 'absent' }] });
  assert.equal(N(await db.asAdmin().val(`select count(*) from public.attendance_marks where session_id = $1`, [r.id])), 1);
  await db.as(U.clara).val(`select public.delete_attendance($1)`, [r.id]);
  assert.equal(N(await db.asAdmin().val(`select count(*) from public.attendance_sessions where id = $1`, [r.id])), 0);
});

test('announcements reach the chosen audience only', async () => {
  db.asAdmin();
  const ins = (title, audience, units = []) => db.val(`insert into public.parish_announcements (parish_id, title, body, audience, unit_ids)
    values (public.default_parish_id(), $1, 'Maelezo', $2, $3::uuid[]) returning id`, [title, audience, units]);
  await ins('Kwa wote', 'all'); await ins('Kwa wafanyakazi', 'staff'); await ins('Kwa Augustino', 'units', [AUG()]); await ins('Kwa Clara', 'units', [CLARA()]);
  const titles = async who => (await db.as(who).q(`select title from public.my_announcements()`)).map(r => r.title).sort();
  assert.deepEqual(await titles(U.clara), ['Kwa Clara', 'Kwa wafanyakazi', 'Kwa wote']);
  assert.deepEqual(await titles(U.plain), ['Kwa wote']);
  // only comms.send may write them
  await assert.rejects(db.as(U.clerk).q(`insert into public.parish_announcements (parish_id, title, body) values (public.default_parish_id(), 'x', 'y')`), /row-level|permission/);
  await db.as(U.admin).q(`insert into public.parish_announcements (parish_id, title, body) values (public.default_parish_id(), 'Na msimamizi', 'y')`);
});

test('SMS: the list of numbers is fixed when created (one per number), sent once', async () => {
  const prev = await db.as(U.admin).rpc('sms_preview', { audience: 'zaka_payers' });
  assert.ok(prev.recipients >= 2);
  await assert.rejects(db.as(U.clerk).rpc('sms_create', { body: 'Habari', audience: 'all' }), /ruhusa/);
  const m = await db.as(U.admin).rpc('sms_create', { body: 'Kikao cha Clara Jumapili', audience: 'units', unit_ids: [CLARA()] });
  db.asAdmin();
  const phones = (await db.q(`select phone from public.sms_recipients where message_id = $1 order by phone`, [m.id])).map(r => r.phone);
  assert.equal(new Set(phones).size, phones.length, 'no number twice');
  assert.ok(phones.includes('255712000001'));
  assert.ok(phones.every(p => /^255\d{9}$/.test(p)));
  const c = await db.as(U.admin).val(`select public.sms_claim($1)`, [m.id]);
  assert.equal(c.phones.length, m.recipients);
  await assert.rejects(db.as(U.admin).val(`select public.sms_claim($1)`, [m.id]), /sasa hivi/);
  await db.as(U.admin).val(`select public.sms_finish($1, true, 'beem', '{}'::jsonb)`, [m.id]);
  await assert.rejects(db.as(U.admin).val(`select public.sms_claim($1)`, [m.id]), /umeshatumwa/);
  await assert.rejects(db.as(U.admin).val(`select public.sms_delete($1)`, [m.id]), /haufutwi/);
});
