// Financial engine tests — run with:  npm test
// Every test talks to a real PostgreSQL (PGlite) loaded with all migrations.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, ids } from './harness.mjs';

let db, I, U = {};
const N = v => Number(v);

before(async () => {
  db = await createDb();
  I = await ids(db);
  U.admin    = await db.user('admin@test.local',    { parishRole: 'parish_admin' });
  U.acct     = await db.user('acct@test.local',     { parishRole: 'accountant' });
  U.treas    = await db.user('treas@test.local',    { parishRole: 'treasurer' });
  U.clerk    = await db.user('clerk@test.local',    { parishRole: 'data_entry' });
  U.auditor  = await db.user('auditor@test.local',  { parishRole: 'auditor' });
  U.clara    = await db.user('clara@test.local',    { parishRole: 'jumuiya_leader', org: I['org:jumuiya:Clara'] });
  U.mughanga = await db.user('mugh@test.local',     { parishRole: 'kigango_leader', org: I['org:kigango:Mughanga'] });
  U.member   = await db.user('member@test.local');

  // register: two families in Clara (Mughanga), one in Augustino (Minga)
  db.asAdmin();
  const fam = async (name, jum) => db.val(
    `insert into public.families (parish_id, family_name, jumuiya_id) values (public.default_parish_id(), $1, $2) returning id`, [name, jum]);
  const person = async (name, family, jum, profile = null) => db.val(
    `insert into public.parishioners (parish_id, full_name, family_id, jumuiya_id, profile_id) values (public.default_parish_id(), $1, $2, $3, $4) returning id`,
    [name, family, jum, profile]);
  U.famA = await fam('Familia A', I['org:jumuiya:Clara']);
  U.famB = await fam('Familia B', I['org:jumuiya:Clara']);
  U.famC = await fam('Familia C', I['org:jumuiya:Augustino']);
  U.pA1 = await person('Mtu A1', U.famA, I['org:jumuiya:Clara'], U.member);
  U.pB1 = await person('Mtu B1', U.famB, I['org:jumuiya:Clara']);
  U.pC1 = await person('Mtu C1', U.famC, I['org:jumuiya:Augustino']);
});

const pay = (who, p) => db.as(who).rpc('post_payment', { idempotency_key: db.key(), payment_method: 'cash', ...p });

test('reference data: parish identity and structure seeded from the workbook', async () => {
  db.asAdmin();
  const p = await db.one('select official_name, diocese from public.parishes');
  assert.equal(p.official_name, 'Parokia ya Mt. Aloyce Gonzaga - Minga');
  assert.equal(p.diocese, 'Jimbo Katoliki Singida');
  assert.equal(N(await db.val(`select count(*) from public.org_units where unit_type = 'kigango'`)), 7);
  assert.equal(N(await db.val(`select count(*) from public.org_units where unit_type = 'jumuiya'`)), 51);
  const perKigango = await db.q(`select k.name, count(j.*)::int n from public.org_units k join public.org_units j on j.parent_id = k.id
                                 where k.unit_type = 'kigango' group by k.name order by k.name`);
  assert.deepEqual(Object.fromEntries(perKigango.map(r => [r.name, r.n])),
    { Kinyeto: 6, Kisasida: 4, Mangua: 7, Minga: 11, Mughanga: 10, Ntunduu: 11, Songa: 2 });
});

test('amount in words (Kiswahili and English) for receipts', async () => {
  db.asAdmin();
  assert.equal(await db.val(`select public.amount_words_sw(225000)`), 'Shilingi laki mbili na elfu ishirini na tano');
  assert.equal(await db.val(`select public.amount_words_sw(1250500)`), 'Shilingi milioni moja, laki mbili na elfu hamsini na mia tano');
  assert.equal(await db.val(`select public.amount_words_sw(5000)`), 'Shilingi elfu tano');
  assert.equal(await db.val(`select public.amount_words_en(507200)`), 'Five Hundred and Seven Thousand Two Hundred Shillings Only');
  assert.equal(await db.val(`select public.amount_words_en(2050)`), 'Two Thousand and Fifty Shillings Only');
});

test('Mavuno pledge: partial payments, outstanding, completion and overpayment shown separately', async () => {
  const camp = I['camp:MAVUNO:2026'], cat = I['cat:MAVUNO'];
  const r0 = await db.as(U.clara).rpc('create_pledge', { campaign_id: camp, family_id: U.famA, amount: 300000 });
  assert.equal(r0.status, 'created');
  for (const amount of [100000, 50000, 75000]) {
    const r = await pay(U.clerk, { amount, category_id: cat, campaign_id: camp, family_id: U.famA, txn_date: '2026-03-10' });
    assert.equal(r.status, 'posted', JSON.stringify(r));
    assert.ok(r.receipt_no);
  }
  let b = await db.asAdmin().one('select * from public.v_pledge_balances where pledge_id = $1', [r0.pledge_id]);
  assert.deepEqual([N(b.pledged), N(b.paid), N(b.outstanding), N(b.excess), N(b.completion_pct)], [300000, 225000, 75000, 0, 75]);

  await pay(U.clerk, { amount: 100000, category_id: cat, campaign_id: camp, family_id: U.famA, txn_date: '2026-04-10' });
  b = await db.asAdmin().one('select * from public.v_pledge_balances where pledge_id = $1', [r0.pledge_id]);
  assert.deepEqual([N(b.received), N(b.paid), N(b.outstanding), N(b.excess), N(b.completion_pct)], [325000, 300000, 0, 25000, 100]);
  U.pledgeA = r0.pledge_id;
});

test('a family member paying is credited to the family pledge', async () => {
  const camp = I['camp:MAVUNO:2027'];
  const p = await db.as(U.acct).rpc('create_pledge', { campaign_id: camp, family_id: U.famB, amount: 80000 });
  const r = await pay(U.clerk, { amount: 30000, category_id: I['cat:MAVUNO'], campaign_id: camp, parishioner_id: U.pB1, txn_date: '2027-02-01' });
  assert.equal(r.pledge_id, p.pledge_id);
  const b = await db.asAdmin().one('select * from public.v_pledge_balances where pledge_id = $1', [p.pledge_id]);
  assert.deepEqual([N(b.paid), N(b.outstanding)], [30000, 50000]);
});

test('one payment updates every level: family, jumuiya, kigango, parish, campaign, dashboard', async () => {
  const camp = I['camp:MAVUNO:2026'], cat = I['cat:MAVUNO'];
  await pay(U.clerk, { amount: 40000, category_id: cat, campaign_id: camp, family_id: U.famB, txn_date: '2026-05-02' });
  await pay(U.clerk, { amount: 60000, category_id: cat, campaign_id: camp, family_id: U.famC, txn_date: '2026-05-02' });
  db.asAdmin();
  const tot = async level => Object.fromEntries((await db.q(
    `select group_name, total from public.contribution_totals('2026-01-01','2026-12-31',$1,$2)`, [level, cat])).map(r => [r.group_name, N(r.total)]));
  assert.deepEqual(await tot('family'), { 'Familia A': 325000, 'Familia B': 40000, 'Familia C': 60000 });
  assert.deepEqual(await tot('jumuiya'), { Augustino: 60000, Clara: 365000 });
  assert.deepEqual(await tot('kigango'), { Minga: 60000, Mughanga: 365000 });
  const parish = await tot('parish');
  assert.equal(Object.values(parish)[0], 425000);
  const cp = await db.one('select collected from public.v_campaign_progress where campaign_id = $1', [camp]);
  assert.equal(N(cp.collected), 425000);
  const dash = await db.val('select public.parish_dashboard(2026)');
  assert.equal(N(dash.totals.mavuno), 425000);
  assert.equal(N(dash.counts.vigango), 7);
});

test('idempotency: the same submission (retry / double click) is posted once', async () => {
  const key = db.key();
  const p = { idempotency_key: key, amount: 15000, category_id: I['cat:SADAKA_WIKI'], payer_name: 'Sadaka ya Jumatano',
              payment_method: 'cash', txn_date: '2026-05-06' };
  const a = await db.as(U.clerk).rpc('post_payment', p);
  const b = await db.as(U.clerk).rpc('post_payment', p);
  assert.equal(a.status, 'posted');
  assert.equal(b.status, 'already_posted');
  assert.equal(a.transaction_id, b.transaction_id);
  assert.equal(N(await db.asAdmin().val('select count(*) from public.finance_transactions where idempotency_key = $1', [key])), 1);
});

test('possible duplicate is held for confirmation; external references are unique', async () => {
  const base = { amount: 20000, category_id: I['cat:SHUKRANI'], parishioner_id: U.pB1, txn_date: '2026-05-07' };
  assert.equal((await pay(U.clerk, base)).status, 'posted');
  const dup = await pay(U.clerk, base);
  assert.equal(dup.status, 'possible_duplicate');
  assert.equal((await pay(U.clerk, { ...base, confirm_duplicate: true })).status, 'posted');

  const mm = { amount: 30000, category_id: I['cat:SHUKRANI'], parishioner_id: U.pC1, payment_method: 'mobile_money', reference_no: 'MPESA-ABC123', txn_date: '2026-05-07' };
  assert.equal((await pay(U.clerk, mm)).status, 'posted');
  await assert.rejects(pay(U.clerk, { ...mm, amount: 31000, confirm_duplicate: true }), /duplicate key|unique/i);
  await assert.rejects(pay(U.clerk, { ...mm, reference_no: '' }), /reference required/i);
});

test('reversal: totals, pledge balance, receipt and journal all correct themselves', async () => {
  const camp = I['camp:MAVUNO:2026'], cat = I['cat:MAVUNO'];
  const p2 = await db.as(U.acct).rpc('create_pledge', { campaign_id: camp, family_id: U.famC, amount: 200000 });
  const r = await pay(U.clerk, { amount: 50000, category_id: cat, campaign_id: camp, family_id: U.famC, txn_date: '2026-06-01' });
  let b = await db.asAdmin().one('select * from public.v_pledge_balances where pledge_id = $1', [p2.pledge_id]);
  assert.equal(N(b.paid), 50000);

  await assert.rejects(db.as(U.clerk).val(`select public.reverse_transaction($1, 'kosa', $2)`, [r.transaction_id, db.key()]), /permission denied/);
  const rev = await db.as(U.acct).val(`select public.reverse_transaction($1, 'Kiasi kiliandikwa vibaya', $2, '2026-06-02')`, [r.transaction_id, db.key()]);
  assert.equal(rev.status, 'posted');
  b = await db.asAdmin().one('select * from public.v_pledge_balances where pledge_id = $1', [p2.pledge_id]);
  assert.deepEqual([N(b.paid), N(b.outstanding)], [0, 200000]);
  assert.equal(await db.val('select status from public.receipts where transaction_id = $1', [r.transaction_id]), 'void');
  const net = await db.val(`select sum(net_amount) from public.finance_transactions where id in ($1, $2)`, [r.transaction_id, rev.transaction_id]);
  assert.equal(N(net), 0);
  await assert.rejects(db.as(U.acct).val(`select public.reverse_transaction($1, 'tena', $2)`, [r.transaction_id, db.key()]), /already reversed/);
  // posted rows are immutable even for the database owner
  db.asAdmin();
  await assert.rejects(db.q('update public.finance_transactions set amount = 1 where id = $1', [r.transaction_id]), /hauwezi kubadilishwa/);
  await assert.rejects(db.q('delete from public.finance_transactions where id = $1', [r.transaction_id]), /hauwezi kufutwa/);
});

test('Zaka grid: months paid / unpaid per person (legacy month-count bug fixed)', async () => {
  for (const [m, amt] of [['2025-01-01', 2000], ['2025-02-01', 3000], ['2025-03-01', 2000], ['2025-03-01', 1000]]) {
    const r = await pay(U.clerk, { amount: amt, category_id: I['cat:ZAKA'], parishioner_id: U.pB1, period_month: m, txn_date: '2025-04-30', confirm_duplicate: true });
    assert.equal(r.status, 'posted');
  }
  const row = await db.asAdmin().one(`select * from public.zaka_grid(2025, 'parishioner') where group_id = $1`, [U.pB1]);
  assert.deepEqual([N(row.m01), N(row.m02), N(row.m03), row.m04, N(row.total), row.months_paid, row.months_unpaid],
                   [2000, 3000, 3000, null, 8000, 3, 9]);
  const j = await db.one(`select * from public.zaka_grid(2025, 'jumuiya') where group_name = 'Clara'`);
  assert.equal(N(j.total), 8000);
});

test('financial year boundaries and payments against a previous-year pledge', async () => {
  const camp25 = I['camp:MAVUNO:2025'];
  const pl = await db.as(U.acct).rpc('create_pledge', { campaign_id: camp25, family_id: U.famB, amount: 100000, pledged_on: '2025-03-01' });
  const a = await pay(U.clerk, { amount: 60000, category_id: I['cat:MAVUNO'], campaign_id: camp25, family_id: U.famB, txn_date: '2025-12-31' });
  const b = await pay(U.clerk, { amount: 40000, category_id: I['cat:MAVUNO'], campaign_id: camp25, family_id: U.famB, txn_date: '2026-01-01' });
  db.asAdmin();
  const fy = await db.q(`select t.id, fy.label from public.finance_transactions t join public.financial_years fy on fy.id = t.financial_year_id where t.id in ($1,$2)`, [a.transaction_id, b.transaction_id]);
  assert.deepEqual(Object.fromEntries(fy.map(r => [r.id, r.label])), { [a.transaction_id]: '2025', [b.transaction_id]: '2026' });
  const bal = await db.one('select * from public.v_pledge_balances where pledge_id = $1', [pl.pledge_id]);
  assert.deepEqual([N(bal.paid), N(bal.outstanding)], [100000, 0]);
  const c25 = await db.one('select collected from public.v_campaign_progress where campaign_id = $1', [camp25]);
  assert.equal(N(c25.collected), 100000);      // counted in the 2025 campaign …
  const y26 = await db.val(`select public.parish_dashboard(2026)`);
  assert.ok(N(y26.totals.mavuno) >= 40000);      // … and as 2026 cash
});

test('carry forward moves only the unpaid balance — no double counting', async () => {
  const p = await db.as(U.acct).rpc('create_pledge', { campaign_id: I['camp:UJENZI:2025'], family_id: U.famA, amount: 120000 });
  await pay(U.clerk, { amount: 20000, category_id: I['cat:UJENZI'], campaign_id: I['camp:UJENZI:2025'], family_id: U.famA, txn_date: '2025-08-01' });
  const before = N(await db.asAdmin().val(`select sum(outstanding) from public.v_pledge_balances where family_id = $1 and category_code = 'UJENZI'`, [U.famA]));
  const cf = await db.as(U.acct).val(`select public.carry_forward_pledge($1, $2)`, [p.pledge_id, I['camp:UJENZI:2026']]);
  assert.equal(N(cf.amount), 100000);
  const after = N(await db.asAdmin().val(`select sum(outstanding) from public.v_pledge_balances where family_id = $1 and category_code = 'UJENZI'`, [U.famA]));
  assert.equal(before, 100000);
  assert.equal(after, 100000);
});

test('campaign targets per community (families × rate) and progress', async () => {
  db.asAdmin();
  await db.q(`insert into public.campaign_targets (campaign_id, org_unit_id, basis, unit_count, unit_rate) values ($1, $2, 'per_family', 12, 60000)`,
             [I['camp:UJENZI:2026'], I['org:jumuiya:Clara']]);
  await pay(U.clerk, { amount: 300000, category_id: I['cat:UJENZI'], campaign_id: I['camp:UJENZI:2026'], org_unit_id: I['org:jumuiya:Clara'], txn_date: '2026-07-01' });
  const rows = await db.asAdmin().q(`select * from public.campaign_org_progress($1, 'jumuiya')`, [I['camp:UJENZI:2026']]);
  const clara = rows.find(r => r.org_unit_name === 'Clara');
  assert.deepEqual([N(clara.target), N(clara.collected), N(clara.balance), N(clara.pct)], [720000, 300000, 420000, 41.67]);
  const kig = await db.q(`select * from public.campaign_org_progress($1, 'kigango')`, [I['camp:UJENZI:2026']]);
  assert.equal(N(kig.find(r => r.org_unit_name === 'Mughanga').target), 720000);
});

test('expenses need a second person; restricted funds cannot be overspent', async () => {
  const e = await db.as(U.treas).rpc('record_expense', { idempotency_key: db.key(), amount: 50000, category_id: I['cat:MATUMIZI_JUMLA'],
                                                          description: 'Umeme wa kanisa', txn_date: '2026-07-05' });
  assert.equal(e.status, 'pending_approval');
  const before = N(await db.asAdmin().val(`select public.parish_dashboard(2026)->'totals'->>'expenses_year'`));
  assert.equal(before, 0);
  await assert.rejects(db.as(U.treas).val(`select public.decide_approval($1, true)`, [e.approval_id]), /separation of duties/);
  await assert.rejects(db.as(U.clerk).val(`select public.decide_approval($1, true)`, [e.approval_id]), /ruhusa/);
  const ok = await db.as(U.acct).val(`select public.decide_approval($1, true, 'Sawa')`, [e.approval_id]);
  assert.equal(ok.status, 'approved');
  assert.equal(N(await db.asAdmin().val(`select public.parish_dashboard(2026)->'totals'->>'expenses_year'`)), 50000);

  const big = await db.as(U.treas).rpc('record_expense', { idempotency_key: db.key(), amount: 99000000, category_id: I['cat:MATUMIZI_UJENZI'],
                                                            description: 'Saruji', txn_date: '2026-07-06' });
  await assert.rejects(db.as(U.acct).val(`select public.decide_approval($1, true)`, [big.approval_id]), /restricted fund/);
  await db.as(U.acct).val(`select public.decide_approval($1, false, 'Haitoshi')`, [big.approval_id]);
});

test('locked periods and closed years refuse postings', async () => {
  db.asAdmin();
  const period = await db.val(`select ap.id from public.accounting_periods ap join public.financial_years fy on fy.id = ap.financial_year_id
                               where fy.label = '2026' and ap.period_start = '2026-02-01'`);
  await assert.rejects(db.as(U.clerk).val(`select public.set_period_lock($1, true)`, [period]), /ruhusa/);
  await db.as(U.acct).val(`select public.set_period_lock($1, true)`, [period]);
  await assert.rejects(pay(U.clerk, { amount: 1000, category_id: I['cat:SADAKA_WIKI'], payer_name: 'X', txn_date: '2026-02-15' }), /period locked/);
  await db.as(U.acct).val(`select public.set_period_lock($1, false)`, [period]);
  assert.equal((await pay(U.clerk, { amount: 1000, category_id: I['cat:SADAKA_WIKI'], payer_name: 'X', txn_date: '2026-02-15' })).status, 'posted');

  await db.as(U.acct).val(`select public.close_financial_year($1)`, [I['fy:2024']]);
  await assert.rejects(pay(U.clerk, { amount: 1000, category_id: I['cat:SADAKA_WIKI'], payer_name: 'X', txn_date: '2024-06-01' }), /financial year closed/);
});

test('receipts are unique and sequential per year', async () => {
  db.asAdmin();
  const r = await db.q(`select series, seq, receipt_no from public.receipts order by series, seq`);
  assert.equal(new Set(r.map(x => x.receipt_no)).size, r.length);
  for (const s of new Set(r.map(x => x.series))) {
    const seqs = r.filter(x => x.series === s).map(x => N(x.seq));
    assert.deepEqual(seqs, seqs.map((_, i) => i + 1), `gap in series ${s}`);
  }
  assert.match(r[0].receipt_no, /^MNG-\d{4}-\d{6}$/);
  const v = await db.as(U.member).val(`select public.verify_receipt($1, 'WRONG')`, [r[0].receipt_no]);
  assert.equal(v.valid, false);
});

test('row level security: each role sees only what it should', async () => {
  const count = async (u, sql = 'select count(*) from public.finance_transactions') => N(await db.as(u).val(sql));
  const total = N(await db.asAdmin().val('select count(*) from public.finance_transactions'));
  assert.equal(await count(U.acct), total);
  assert.equal(await count(U.auditor), total);
  // jumuiya leader: only rows attributed to Clara
  const claraRows = N(await db.asAdmin().val(`select count(*) from public.finance_transactions where coalesce(org_unit_id, jumuiya_id) = $1`, [I['org:jumuiya:Clara']]));
  assert.equal(await count(U.clara), claraRows);
  assert.ok(claraRows > 0 && claraRows < total);
  // kigango leader sees Clara (inside Mughanga) but not Augustino (Minga)
  assert.equal(N(await db.as(U.mughanga).val(`select count(*) from public.finance_transactions where jumuiya_id = $1`, [I['org:jumuiya:Augustino']])), 0);
  assert.ok(await count(U.mughanga) >= claraRows);
  // member: only own and own family's rows
  const mine = N(await db.asAdmin().val(`select count(*) from public.finance_transactions where parishioner_id = $1 or family_id = $2`, [U.pA1, U.famA]));
  assert.equal(await count(U.member), mine);
  assert.equal(N(await db.as(U.member).val('select count(*) from public.parishioners')), 1);
  // read-only roles cannot post; leaders cannot post payments
  await assert.rejects(pay(U.auditor, { amount: 1000, category_id: I['cat:SHUKRANI'], payer_name: 'Y' }), /permission denied/);
  await assert.rejects(pay(U.clara, { amount: 1000, category_id: I['cat:SHUKRANI'], family_id: U.famA }), /permission denied/);
  // nobody writes to the ledger directly
  await assert.rejects(db.as(U.acct).q(`insert into public.finance_transactions (parish_id, idempotency_key, kind, amount, txn_date, financial_year_id, category_id, money_account_id)
     values (public.default_parish_id(), gen_random_uuid(), 'income', 5, current_date, $1, $2, $3)`, [I['fy:2026'], I['cat:SHUKRANI'], I['acc:1000']]), /row-level security|permission/i);
  // a scoped leader cannot see another community's register
  assert.equal(N(await db.as(U.clara).val(`select count(*) from public.families where jumuiya_id = $1`, [I['org:jumuiya:Augustino']])), 0);
});

test('integrity checks pass and the journal mirrors the ledger', async () => {
  db.asAdmin();
  const checks = await db.q('select * from public.finance_integrity_checks()');
  for (const c of checks) assert.ok(c.ok, `${c.check_code}: ${c.problem_count}`);
  const inc = N(await db.val(`select sum(net_amount) from public.finance_transactions where status = 'posted' and kind = 'income'`));
  const accInc = N(await db.val(`select sum(balance) from public.v_account_balances where account_type = 'income'`));
  assert.equal(inc, accInc);
  // an unbalanced journal is rejected at commit
  await assert.rejects(db.raw.transaction(async tx => {
    const e = (await tx.query(`insert into public.journal_entries (parish_id, entry_date) values (public.default_parish_id(), current_date) returning id`)).rows[0].id;
    await tx.query(`insert into public.journal_lines (entry_id, account_id, debit) values ($1, $2, 100)`, [e, I['acc:1000']]);
  }), /haijalingana/);
});

test('scheduled report snapshots summarise posted records without creating transactions', async () => {
  db.asAdmin();
  const before = Number(await db.val('select count(*) from public.finance_transactions'));
  const id = await db.val(`select public.generate_report_snapshot('monthly', '2026-05-15')`);
  const snap = await db.one('select * from public.report_snapshots where id = $1', [id]);
  assert.equal(snap.period_start.toISOString?.().slice(0, 10) ?? String(snap.period_start), '2026-05-01');
  const income = Number(await db.val(`select sum(net_amount) from public.finance_transactions where status = 'posted' and kind = 'income' and txn_date between '2026-05-01' and '2026-05-31'`));
  assert.equal(Number(snap.data.income), income);
  assert.equal(Number(await db.val('select count(*) from public.finance_transactions')), before);
  await db.val(`select public.generate_report_snapshot('outstanding_pledges')`);
});

