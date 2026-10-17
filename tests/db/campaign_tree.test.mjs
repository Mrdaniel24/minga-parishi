// One contribution, level by level: vigango → jumuiya → familia → muumini.
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
  U.famA = await db.val(`insert into public.families (parish_id, family_name, jumuiya_id) values (public.default_parish_id(), 'Familia A', $1) returning id`, [I['org:jumuiya:Clara']]);
  U.baba = await db.val(`insert into public.parishioners (parish_id, full_name, family_id, jumuiya_id, relationship) values (public.default_parish_id(), 'Baba A', $1, $2, 'BABA') returning id`, [U.famA, I['org:jumuiya:Clara']]);
  const pay = x => db.as(U.clerk).rpc('post_payment', { idempotency_key: db.key(), payment_method: 'cash', txn_date: '2026-05-10', ...x });
  // Radio Maria: the jumuiya is given 100,000 and pays 30,000 itself + 10,000 from a member
  await db.as(U.admin).val(`select public.set_unit_target($1)`, [{ org_unit_id: I['org:jumuiya:Clara'], campaign_id: I['camp:RADIO_MARIA:2026'], amount: 100000 }]);
  await pay({ category_id: I['cat:RADIO_MARIA'], campaign_id: I['camp:RADIO_MARIA:2026'], org_unit_id: I['org:jumuiya:Clara'], payer_name: 'Jumuiya ya Clara', amount: 30000 });
  await pay({ category_id: I['cat:RADIO_MARIA'], campaign_id: I['camp:RADIO_MARIA:2026'], parishioner_id: U.baba, amount: 10000 });
  // Mavuno: the family is assigned 50,000 and pays 20,000 (another contribution — must not show under Radio Maria)
  await db.as(U.admin).rpc('create_pledge', { campaign_id: I['camp:MAVUNO:2026'], family_id: U.famA, amount: 50000, source: 'assigned' });
  await pay({ category_id: I['cat:MAVUNO'], campaign_id: I['camp:MAVUNO:2026'], family_id: U.famA, amount: 20000 });
});

const tree = (camp, level, parent = null) => db.as(U.admin).q(`select * from public.campaign_tree($1, $2, $3)`, [camp, level, parent]);

test('Radio Maria only: kigango → jumuiya with the jumuiya amount and the %; nothing from Mavuno', async () => {
  const camp = I['camp:RADIO_MARIA:2026'];
  const k = (await tree(camp, 'kigango')).find(r => r.group_id === I['org:kigango:Mughanga']);
  assert.equal(N(k.target), 100000); assert.equal(N(k.gave), 40000); assert.equal(N(k.balance), 60000); assert.equal(N(k.pct), 40);
  const j = (await tree(camp, 'jumuiya', I['org:kigango:Mughanga'])).find(r => r.group_id === I['org:jumuiya:Clara']);
  assert.equal(N(j.gave), 40000); assert.equal(N(j.payers), 2);
  const f = await tree(camp, 'family', I['org:jumuiya:Clara']);
  assert.equal(N(f.find(r => r.group_id === null).collected), 30000);           // the jumuiya itself
  assert.equal(N(f.find(r => r.group_id === U.famA).collected), 10000);         // through Baba A
});

test('Mavuno per family: assigned, paid, left down to the family and the person', async () => {
  const camp = I['camp:MAVUNO:2026'];
  const f = (await tree(camp, 'family', I['org:jumuiya:Clara'])).find(r => r.group_id === U.famA);
  assert.equal(N(f.pledged), 50000); assert.equal(N(f.gave), 20000); assert.equal(N(f.balance), 30000); assert.equal(N(f.pct), 40);
  const p = await tree(camp, 'parishioner', U.famA);
  assert.equal(N(p.find(r => r.group_id === null).pledged), 50000);             // the family as a whole
});
