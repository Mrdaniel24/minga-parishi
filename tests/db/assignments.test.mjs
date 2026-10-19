// A jumuiya is given an amount for a contribution (what, how much, by when);
// payments are counted and the % computed, the same for the kigango above it.
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
  U.famA = await db.val(`insert into public.families (parish_id, family_name, jumuiya_id) values (public.default_parish_id(), 'Familia A', $1) returning id`, [I['org:jumuiya:Clara']]);
});

test('the jumuiya leader assigns their own jumuiya: what, how much, by when — not another jumuiya', async () => {
  const r = await db.as(U.leader).val(`select public.set_unit_target($1)`, [{ org_unit_id: I['org:jumuiya:Clara'], category_id: I['cat:RADIO_MARIA'],
    year: 2026, amount: 100000, starts_on: '2026-01-01', due_on: '2026-06-30', notes: 'Radio Maria nusu ya kwanza' }]);
  assert.equal(r.status, 'saved');
  U.camp = r.campaign_id;
  await assert.rejects(db.as(U.leader).val(`select public.set_unit_target($1)`, [{ org_unit_id: I['org:jumuiya:Dominico'], campaign_id: U.camp, amount: 5 }]), /ruhusa/);
  // a new name creates a contribution of that type for the year, assigned to the jumuiya
  const n = await db.as(U.leader).val(`select public.set_unit_target($1)`, [{ org_unit_id: I['org:jumuiya:Clara'], category_id: I['cat:UJENZI'],
    year: 2026, name: 'Ujenzi wa choo cha kigango 2026', amount: 50000, due_on: '2026-12-31' }]);
  db.asAdmin();
  const c = await db.one(`select name, giver_level, amount_mode from public.campaigns where id = $1`, [n.campaign_id]);
  assert.deepEqual([c.name, c.giver_level, c.amount_mode], ['Ujenzi wa choo cha kigango 2026', 'jumuiya', 'assigned']);
});

test('a self-assessed contribution stays listed with no fixed amount; zero still removes it when not marked self-assessed', async () => {
  const unit = I['org:jumuiya:Clara'];
  const saved = await db.as(U.admin).val(`select public.set_unit_target($1)`, [{ org_unit_id: unit,
    category_id: I['cat:RADIO_MARIA'], name: 'Mchango wazi wa kipimo', amount: 0, self_assessed: true, year: 2026 }]);
  const camp = saved.campaign_id;
  assert.equal(saved.status, 'saved');
  assert.equal(saved.self_assessed, true);
  const target = await db.asAdmin().one(`select target_amount, self_assessed from public.campaign_targets where campaign_id = $1 and org_unit_id = $2`, [camp, unit]);
  assert.equal(N(target.target_amount), 0);
  assert.equal(target.self_assessed, true);
  const summary = (await db.asAdmin().q(`select * from public.unit_contributions(2026, $1)`, [unit])).find(r => r.campaign_id === camp);
  assert.ok(summary);
  assert.equal(N(summary.target), 0);

  const removed = await db.as(U.admin).val(`select public.set_unit_target($1)`, [{ org_unit_id: unit, campaign_id: camp, amount: 0 }]);
  assert.equal(removed.status, 'removed');
  assert.equal(N(await db.asAdmin().val(`select count(*) from public.campaign_targets where campaign_id = $1 and org_unit_id = $2`, [camp, unit])), 0);
});

test('payments count towards the assignment and the % is computed for the jumuiya and its kigango', async () => {
  await db.as(U.clerk).rpc('post_payment', { idempotency_key: db.key(), payment_method: 'cash', category_id: I['cat:RADIO_MARIA'], campaign_id: U.camp,
    org_unit_id: I['org:jumuiya:Clara'], payer_name: 'Jumuiya ya Clara', amount: 40000, txn_date: '2026-03-01' });
  // a member of the jumuiya paying also counts for the jumuiya
  await db.as(U.clerk).rpc('post_payment', { idempotency_key: db.key(), payment_method: 'cash', category_id: I['cat:RADIO_MARIA'], campaign_id: U.camp,
    family_id: U.famA, amount: 10000, txn_date: '2026-03-02' });
  db.as(U.leader);
  const rows = await db.q(`select * from public.unit_contributions(2026, $1)`, [I['org:jumuiya:Clara']]);
  const rm = rows.find(r => r.campaign_id === U.camp);
  assert.equal(N(rm.target), 100000); assert.equal(N(rm.collected), 50000); assert.equal(N(rm.balance), 50000); assert.equal(N(rm.pct), 50);
  assert.equal(String(rm.due_on.toISOString?.() ?? rm.due_on).slice(0, 10), '2026-06-30');
  assert.equal(rm.own_target, true);
  // nothing else: contributions this jumuiya neither owes nor paid are not listed
  assert.ok(rows.every(r => N(r.target) > 0 || N(r.pledged) > 0 || N(r.collected) > 0));
  db.as(U.admin);
  const k = (await db.q(`select * from public.unit_contributions(2026, $1)`, [I['org:kigango:Mughanga']])).find(r => r.campaign_id === U.camp);
  assert.equal(N(k.target), 100000); assert.equal(N(k.collected), 50000); assert.equal(k.own_target, false);
  // the kigango card counts the jumuiya's assignment in "pangiwa" and "bado"
  const card = (await db.q(`select * from public.unit_summary(2026, null)`)).find(r => r.unit_id === I['org:kigango:Mughanga']);
  assert.ok(N(card.pledged) >= 150000); assert.ok(N(card.outstanding) >= 100000);
});

test('removing an assignment; switched-off headings from the workbook', async () => {
  const r = await db.as(U.leader).val(`select public.set_unit_target($1)`, [{ org_unit_id: I['org:jumuiya:Clara'], campaign_id: U.camp, amount: 0 }]);
  assert.equal(r.status, 'removed');
  db.asAdmin();
  assert.equal(N(await db.val(`select count(*) from public.campaign_targets where campaign_id = $1`, [U.camp])), 0);
  const off = await db.q(`select code from public.contribution_categories where code in ('KAPU_LA_MAMA','RAFIKI_WA_PAPA') and is_active`);
  assert.equal(off.length, 0);
});
