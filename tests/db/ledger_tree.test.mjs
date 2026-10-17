// Miamala by level: Vigango → Kigango → Jumuiya → Familia → Muumini.
// Every level adds up to the level above it, and nothing is lost to a row limit.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, ids } from './harness.mjs';

let db, I, U = {};
const N = Number;
const sum = (rows, k = 'total') => rows.reduce((s, r) => s + N(r[k]), 0);
before(async () => {
  db = await createDb();
  I = await ids(db);
  U.admin = await db.user('admin@t.local', { parishRole: 'parish_admin' });
  U.clerk = await db.user('clerk@t.local', { parishRole: 'data_entry' });
  U.leader = await db.user('leader@t.local', { parishRole: 'jumuiya_leader', org: I['org:jumuiya:Clara'] });
  db.asAdmin();
  U.fam = await db.val(`insert into public.families (parish_id, family_name, jumuiya_id) values (public.default_parish_id(), 'Familia T', $1) returning id`, [I['org:jumuiya:Clara']]);
  U.p1 = await db.val(`insert into public.parishioners (parish_id, full_name, family_id, jumuiya_id) values (public.default_parish_id(), 'Baba T', $1, $2) returning id`, [U.fam, I['org:jumuiya:Clara']]);
  const pay = (x, amount) => db.as(U.clerk).rpc('post_payment', { idempotency_key: db.key(), payment_method: 'cash', amount, txn_date: '2026-05-10', ...x });
  await pay({ category_id: I['cat:ZAKA'], parishioner_id: U.p1, period_month: '2026-05-01' }, 3000);            // a person
  await pay({ category_id: I['cat:MAVUNO'], campaign_id: I['camp:MAVUNO:2026'], family_id: U.fam }, 20000);     // the family
  await pay({ category_id: I['cat:ZAKA'], org_unit_id: I['org:jumuiya:Clara'], payer_name: 'Jumuiya ya Clara', period_month: '2026-05-01' }, 50000);  // the jumuiya
  await pay({ category_id: I['cat:SHUKRANI'], org_unit_id: I['org:kigango:Mughanga'], payer_name: 'Kigango cha Mughanga' }, 7000);   // the kigango
  await pay({ category_id: I['cat:SADAKA_JUMAPILI'], payer_name: 'Jumapili ya 19' }, 400000);                    // the parish itself
});

const tree = (level, parent = null) => db.q(`select * from public.ledger_tree('2026-01-01', '2026-12-31', $1, $2)`, [level, parent]);

test('each level adds up to the one above; the "itself" row holds what was paid at that level', async () => {
  db.as(U.admin);
  const vig = await tree('kigango');
  assert.equal(sum(vig), 480000);
  assert.equal(N(vig.find(r => r.group_id === null).total), 400000);                         // parokiani
  const mug = vig.find(r => r.group_id === I['org:kigango:Mughanga']);
  assert.equal(N(mug.total), 80000);
  const jum = await tree('jumuiya', I['org:kigango:Mughanga']);
  assert.equal(sum(jum), 80000);
  assert.equal(N(jum.find(r => r.group_id === null).total), 7000);                           // kigango chenyewe
  const clara = jum.find(r => r.group_id === I['org:jumuiya:Clara']);
  assert.equal(N(clara.total), 73000); assert.equal(N(clara.zaka), 53000); assert.equal(N(clara.mavuno), 20000);
  const fam = await tree('family', I['org:jumuiya:Clara']);
  assert.equal(sum(fam), 73000);
  assert.equal(N(fam.find(r => r.group_id === null).total), 50000);                          // jumuiya yenyewe
  const ppl = await tree('parishioner', U.fam);
  assert.equal(sum(ppl), 23000);
  assert.equal(N(ppl.find(r => r.group_id === U.p1).total), 3000);
  assert.equal(N(ppl.find(r => r.group_id === null).total), 20000);                          // familia yenyewe
});

test('a jumuiya leader sees only their own jumuiya', async () => {
  db.as(U.leader);
  const vig = await tree('kigango');
  assert.equal(sum(vig), 73000);
});

test('a contribution whose jumuiya amounts arrive (MALENGO) becomes "kila jumuiya · kupangiwa"', async () => {
  db.asAdmin();
  const camp = await db.val(`select id from public.campaigns where id = $1`, [I['camp:RADIO_MARIA:2026']]);
  await db.q(`insert into public.campaign_targets (campaign_id, org_unit_id, basis, fixed_amount) values ($1, $2, 'fixed', 100000)`, [camp, I['org:jumuiya:Clara']]);
  const c = await db.one(`select giver_level, amount_mode from public.campaigns where id = $1`, [camp]);
  assert.deepEqual([c.giver_level, c.amount_mode], ['jumuiya', 'assigned']);
});
