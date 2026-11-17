// Public member registration stays server-only, household-scoped and rate-limited.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, ids } from './harness.mjs';

let db, I, parish, kigango, jumuiya, family;
const member = (phone, full_name, relationship='MTOTO') => ({
  phone, full_name, relationship, gender:'female', birth_year:2000, password:'Temporary-Password-123',
});

before(async () => {
  db = await createDb(); I = await ids(db);
  jumuiya = I['org:jumuiya:Clara'];
  kigango = await db.val('select parent_id from public.org_units where id=$1', [jumuiya]);
  parish = await db.val('select parish_id from public.org_units where id=$1', [jumuiya]);
  db.asAdmin();
  family = await db.val(`insert into public.families (parish_id,family_name,jumuiya_id)
    values ($1,'Familia Iliyopo',$2) returning id`, [parish,jumuiya]);
});

test('self-registration RPC is server-only; public family lookup returns only one jumuiya', async () => {
  assert.equal(await db.val(`select has_function_privilege('anon','public.register_member_family(jsonb)','execute')`), false);
  assert.equal(await db.val(`select has_function_privilege('authenticated','public.register_member_family(jsonb)','execute')`), false);
  assert.equal(await db.val(`select has_function_privilege('service_role','public.register_member_family(jsonb)','execute')`), true);
  assert.equal(await db.val(`select has_function_privilege('service_role','public.consume_registration_attempt(text,text)','execute')`), true);
  assert.equal(await db.val(`select has_function_privilege('anon','public.consume_registration_attempt(text,text)','execute')`), false);
  const rows = await db.q('select * from public.public_signup_families($1)', [jumuiya]);
  assert.deepEqual(rows, [{ id:family, family_name:'Familia Iliyopo', family_code:null }]);
  assert.deepEqual(await db.q('select * from public.public_signup_families($1)', [I['org:jumuiya:Dominico']]), []);
});

test('new family registration creates an ordinary account link for every member and sets the family head', async () => {
  const result = await db.val(`select public.register_member_family($1::jsonb)`, [JSON.stringify({
    kigango_id:kigango, jumuiya_id:jumuiya, new_family_name:'Familia Mpya', head_index:0,
    members:[member('0712000101','Baba wa Familia','BABA'),member('0712000102','Mama wa Familia','MAMA')],
  })]);
  assert.equal(result.members,2);
  const rows = await db.q(`select p.full_name,p.phone,p.family_id,p.profile_id,pr.role,p.membership_status
    from public.parishioners p join public.profiles pr on pr.id=p.profile_id where p.family_id=$1 order by p.full_name`, [result.family_id]);
  assert.equal(rows.length,2);
  assert.ok(rows.every(x=>x.role==='user'&&x.membership_status==='active'));
  const headId = await db.val(`select p.id from public.parishioners p join public.profiles pr on pr.id=p.profile_id where p.phone='255712000101'`);
  assert.equal(await db.val('select head_parishioner_id from public.families where id=$1', [result.family_id]),headId);
  assert.equal(Number(await db.val(`select count(*) from public.parish_user_roles pur join public.parishioners p on p.profile_id=pur.user_id where p.family_id=$1`,[result.family_id])),0);
  assert.equal(Number(await db.val(`select count(*) from auth.users au join public.parishioners p on p.profile_id=au.id where p.family_id=$1`,[result.family_id])),2);
});

test('a member joins only an existing family in the selected jumuiya; other jumuiya is rejected', async () => {
  const result = await db.val('select public.register_member_family($1::jsonb)', [JSON.stringify({
    kigango_id:kigango,jumuiya_id:jumuiya,family_id:family,head_index:null,
    members:[member('0712000103','Mwanafamilia Mpya')],
  })]);
  assert.equal(result.family_id,family);
  const before = Number(await db.val('select count(*) from public.parishioners'));
  const other = I['org:jumuiya:Dominico'];
  const otherKigango = await db.val('select parent_id from public.org_units where id=$1',[other]);
  await assert.rejects(db.val('select public.register_member_family($1::jsonb)', [JSON.stringify({
    kigango_id:otherKigango,jumuiya_id:other,family_id:family,head_index:null,
    members:[member('0712000103','Mwanafamilia Mpya')],
  })]), /Familia hiyo haipo/);
  assert.equal(Number(await db.val('select count(*) from public.parishioners')),before);
});

test('public registration refuses repeated phone numbers before writing family or member records', async () => {
  const beforeFamilies = Number(await db.val('select count(*) from public.families'));
  const beforeMembers = Number(await db.val('select count(*) from public.parishioners'));
  await assert.rejects(db.val('select public.register_member_family($1::jsonb)', [JSON.stringify({
    kigango_id:kigango,jumuiya_id:jumuiya,new_family_name:'Haitaundwa',head_index:0,
    members:[member('0712000104','Mtu A','BABA'),member('0712000104','Mtu B','MAMA')],
  })]), /namba yake ya simu/);
  assert.equal(Number(await db.val('select count(*) from public.families')),beforeFamilies);
  assert.equal(Number(await db.val('select count(*) from public.parishioners')),beforeMembers);
});

test('registration quota allows three attempts per phone and blocks the fourth', async () => {
  const phoneHash = 'a'.repeat(64), ipHash = 'b'.repeat(64);
  assert.equal(await db.val('select public.consume_registration_attempt($1,$2)',[phoneHash,ipHash]),true);
  assert.equal(await db.val('select public.consume_registration_attempt($1,$2)',[phoneHash,ipHash]),true);
  assert.equal(await db.val('select public.consume_registration_attempt($1,$2)',[phoneHash,ipHash]),true);
  assert.equal(await db.val('select public.consume_registration_attempt($1,$2)',[phoneHash,ipHash]),false);
  assert.equal(await db.val("select public.consume_registration_attempt('short',$1)",[ipHash]),false);
});
