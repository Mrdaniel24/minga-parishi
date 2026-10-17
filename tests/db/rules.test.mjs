// Contribution rules (who gives, assigned/pledge/free, yearly/monthly) and the
// Kigango → Jumuiya → Familia summaries.
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
  db.asAdmin();
  const fam = async (name, j) => db.val(`insert into public.families (parish_id, family_name, jumuiya_id) values (public.default_parish_id(), $1, $2) returning id`, [name, I[`org:jumuiya:${j}`]]);
  const person = async (name, f, j, rel) => db.val(`insert into public.parishioners (parish_id, full_name, family_id, jumuiya_id, relationship) values (public.default_parish_id(), $1, $2, $3, $4) returning id`, [name, f, I[`org:jumuiya:${j}`], rel]);
  U.famA = await fam('Familia A', 'Clara'); U.famB = await fam('Familia B', 'Clara'); U.famC = await fam('Familia C', 'Dominico');
  U.babaA = await person('Baba A', U.famA, 'Clara', 'BABA'); U.mamaA = await person('Mama A', U.famA, 'Clara', 'MAMA');
  U.mtotoA = await person('Mtoto A', U.famA, 'Clara', 'MTOTO'); U.babaC = await person('Baba C', U.famC, 'Dominico', 'BABA');
});

test('rules from the workbook are set on the existing campaigns', async () => {
  db.asAdmin();
  const r = await db.q(`select c.code, cp.giver_level, cp.amount_mode, cp.frequency, cp.relation_rates->>'MTOTO' as mtoto
    from public.campaigns cp join public.contribution_categories c on c.id = cp.category_id where cp.campaign_year = 2026 and c.code in ('MAVUNO','UJENZI','MTOTO_YESU','RADIO_MARIA') order by 1`);
  const by = Object.fromEntries(r.map(x => [x.code, x]));
  assert.equal(by.MAVUNO.giver_level, 'family'); assert.equal(by.MAVUNO.amount_mode, 'assigned');
  assert.equal(by.UJENZI.giver_level, 'family');
  assert.equal(by.MTOTO_YESU.giver_level, 'parishioner'); assert.equal(by.MTOTO_YESU.mtoto, '2000');
  assert.equal(by.RADIO_MARIA.amount_mode, 'free');
});

test('"Pangia wote" per family: every family once, existing amounts kept, run again creates nothing', async () => {
  const camp = I['camp:MAVUNO:2026'];
  await db.as(U.admin).rpc('create_pledge', { campaign_id: camp, family_id: U.famB, amount: 300000 });   // a promise already made
  const r1 = await db.as(U.admin).val(`select public.assign_campaign($1, 100000, null)`, [camp]);
  assert.equal(r1.created, 2);                                       // A and C, not B
  const r2 = await db.as(U.admin).val(`select public.assign_campaign($1, 100000, null)`, [camp]);
  assert.equal(r2.created, 0);
  db.asAdmin();
  const rows = await db.q(`select family_name, pledged::int, source from public.v_pledge_balances where campaign_id = $1 order by 1`, [camp]);
  assert.deepEqual(rows.map(r => [r.family_name, r.pledged, r.source]),
    [['Familia A', 100000, 'assigned'], ['Familia B', 300000, 'pledge'], ['Familia C', 100000, 'assigned']]);
});

test('per person with rates by relationship (Baba 5,000 · Mtoto 2,000), limited to one jumuiya', async () => {
  const camp = I['camp:MTOTO_YESU:2026'];
  const r = await db.as(U.admin).val(`select public.assign_campaign($1, null, $2)`, [camp, I['org:jumuiya:Clara']]);
  assert.equal(r.created, 3);
  db.asAdmin();
  const rows = await db.q(`select parishioner_name, pledged::int from public.v_pledge_balances where campaign_id = $1 order by 1`, [camp]);
  assert.deepEqual(rows.map(x => [x.parishioner_name, x.pledged]), [['Baba A', 5000], ['Mama A', 5000], ['Mtoto A', 2000]]);
});

test('per jumuiya, monthly: the year obligation is 12 × the monthly amount; payments record their month', async () => {
  db.asAdmin();
  const cat = await db.val(`insert into public.contribution_categories (parish_id, code, name_sw, kind, is_pledgeable) values (public.default_parish_id(), 'KWAYA', 'Mchango wa Kwaya', 'special', true) returning id`);
  const camp = await db.val(`insert into public.campaigns (parish_id, category_id, campaign_year, name, giver_level, amount_mode, frequency, default_amount)
    values (public.default_parish_id(), $1, 2026, 'Kwaya 2026', 'jumuiya', 'assigned', 'monthly', 10000) returning id`, [cat]);
  const r = await db.as(U.admin).val(`select public.assign_campaign($1, null, $2)`, [camp, I['org:kigango:Mughanga']]);
  const nJ = N(await db.asAdmin().val(`select count(*) from public.org_units where unit_type = 'jumuiya' and is_active and parent_id = $1`, [I['org:kigango:Mughanga']]));
  assert.equal(r.created, nJ);
  assert.equal(N(await db.val(`select amount from public.pledges where campaign_id = $1 and org_unit_id = $2`, [camp, I['org:jumuiya:Clara']])), 120000);
  const p = await db.as(U.clerk).rpc('post_payment', { idempotency_key: db.key(), payment_method: 'cash', category_id: cat, campaign_id: camp,
    org_unit_id: I['org:jumuiya:Clara'], payer_name: 'Jumuiya ya Clara', amount: 10000, txn_date: '2026-03-15', period_month: '2026-02-01' });
  db.asAdmin();
  assert.equal(String((await db.one(`select period_month::text p from public.finance_transactions where id = $1`, [p.transaction_id])).p), '2026-02-01');
  const g = await db.q(`select group_name, m02::int, total::int from public.campaign_month_grid($1, 'jumuiya', null)`, [camp]);
  assert.deepEqual(g.map(x => [x.group_name, x.m02, x.total]), [['Clara', 10000, 10000]]);
});

test('only finance roles may assign; a jumuiya leader only inside their jumuiya', async () => {
  const camp = I['camp:UJENZI:2026'];
  await assert.rejects(db.as(U.leader).val(`select public.assign_campaign($1, 50000, null)`, [camp]), /ruhusa/);
  const r = await db.as(U.leader).val(`select public.assign_campaign($1, 50000, $2)`, [camp, I['org:jumuiya:Clara']]);
  assert.equal(r.created, 2);
  await assert.rejects(db.as(U.leader).val(`select public.assign_campaign($1, 50000, $2)`, [camp, I['org:jumuiya:Dominico']]), /ruhusa/);
});

test('kigango and jumuiya summaries add up to the parish', async () => {
  await db.as(U.clerk).rpc('post_payment', { idempotency_key: db.key(), payment_method: 'cash', category_id: I['cat:ZAKA'], parishioner_id: U.babaA, amount: 3000, txn_date: '2026-04-02', period_month: '2026-04-01' });
  await db.as(U.clerk).rpc('post_payment', { idempotency_key: db.key(), payment_method: 'cash', category_id: I['cat:MAVUNO'], campaign_id: I['camp:MAVUNO:2026'], family_id: U.famC, amount: 40000, txn_date: '2026-04-03' });
  db.as(U.admin);
  const vig = await db.q(`select * from public.unit_summary(2026, null)`);
  assert.equal(vig.length, 7);
  const d = await db.val(`select public.parish_dashboard(2026, null)`);
  const kTotal = vig.reduce((s, r) => s + N(r.income), 0);
  const parishLevel = N(await db.asAdmin().val(`select coalesce(sum(net_amount),0) from public.finance_transactions where status='posted' and kind='income'
     and extract(year from txn_date)=2026 and coalesce(org_unit_id, jumuiya_id) is null`));
  assert.equal(kTotal + parishLevel, N(d.totals.income_year));
  const mug = vig.find(r => r.unit_name === 'Mughanga');
  const jum = await db.as(U.admin).q(`select * from public.unit_summary(2026, $1)`, [mug.unit_id]);
  assert.equal(jum.reduce((s, r) => s + N(r.income), 0), N(mug.income) - N(await db.asAdmin().val(`select coalesce(sum(net_amount),0) from public.finance_transactions where org_unit_id = $1 and extract(year from txn_date)=2026 and status='posted' and kind='income'`, [mug.unit_id])));
  const clara = jum.find(r => r.unit_name === 'Clara');
  assert.equal(N(clara.families), 2); assert.equal(N(clara.parishioners), 3); assert.equal(N(clara.zaka), 3000);
  const fams = await db.as(U.leader).q(`select * from public.family_summary(2026, $1)`, [I['org:jumuiya:Clara']]);
  assert.deepEqual(fams.map(f => f.family_name).sort(), ['Familia A', 'Familia B']);
  assert.equal(N(fams.find(f => f.family_name === 'Familia A').zaka), 3000);
  // the leader of Clara sees nothing of Dominico
  const other = await db.as(U.leader).q(`select * from public.family_summary(2026, $1)`, [I['org:jumuiya:Dominico']]);
  assert.equal(other.length, 0);
});

test('zaka grid carries the jumuiya, kigango and family of each row', async () => {
  db.as(U.admin);
  const r = await db.q(`select group_name, jumuiya_id, kigango_id, family_id, total::int from public.zaka_grid_tree(2026, 'parishioner', null) where group_id = $1`, [U.babaA]);
  assert.equal(r.length, 1);
  assert.equal(r[0].jumuiya_id, I['org:jumuiya:Clara']); assert.equal(r[0].kigango_id, I['org:kigango:Mughanga']); assert.equal(r[0].family_id, U.famA);
  const k = await db.q(`select group_id, kigango_id from public.zaka_grid_tree(2026, 'kigango', null)`);
  assert.ok(k.every(x => x.group_id === x.kigango_id));
});

test('ticked relationships only: Baba and Mama ticked → the child is not assigned; "Wengine" covers the rest', async () => {
  db.asAdmin();
  const cat = await db.val(`insert into public.contribution_categories (parish_id, code, name_sw, kind, is_pledgeable) values (public.default_parish_id(), 'TICK_T', 'Mchango wa Wazazi', 'special', true) returning id`);
  const camp = await db.val(`insert into public.campaigns (parish_id, category_id, campaign_year, name, giver_level, amount_mode, relation_rates)
    values (public.default_parish_id(), $1, 2026, 'Wazazi 2026', 'parishioner', 'assigned', '{"BABA":4000,"MAMA":3000}') returning id`, [cat]);
  const r = await db.as(U.admin).val(`select public.assign_campaign($1, null, $2)`, [camp, I['org:jumuiya:Clara']]);
  assert.equal(r.created, 2); assert.equal(r.skipped_no_rate, 1);
  db.asAdmin();
  const rows = await db.q(`select parishioner_name, pledged::int from public.v_pledge_balances where campaign_id = $1 order by 1`, [camp]);
  assert.deepEqual(rows.map(x => [x.parishioner_name, x.pledged]), [['Baba A', 4000], ['Mama A', 3000]]);
  await db.q(`update public.campaigns set relation_rates = '{"BABA":4000,"MAMA":3000,"WENGINE":1000}' where id = $1`, [camp]);
  const r2 = await db.as(U.admin).val(`select public.assign_campaign($1, null, $2)`, [camp, I['org:jumuiya:Clara']]);
  assert.equal(r2.created, 1);
  db.asAdmin();
  assert.equal(Number(await db.val(`select amount from public.pledges where campaign_id = $1 and parishioner_id = $2`, [camp, U.mtotoA])), 1000);
});
