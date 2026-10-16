// database/demo/demo_accounts.sql creates one sign-in per role, adds no records,
// can be run twice, and demo_remove.sql takes it all away again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from './harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => readFileSync(join(ROOT, 'database', 'demo', f), 'utf8');
// the parts of Supabase's auth schema the script writes to (pgcrypto lives in "extensions")
const AUTH_EXTRA = `
alter table auth.users add column if not exists instance_id uuid, add column if not exists aud text, add column if not exists role text,
  add column if not exists encrypted_password text, add column if not exists email_confirmed_at timestamptz,
  add column if not exists raw_app_meta_data jsonb, add column if not exists created_at timestamptz, add column if not exists updated_at timestamptz,
  add column if not exists confirmation_token text, add column if not exists email_change text,
  add column if not exists email_change_token_new text, add column if not exists recovery_token text;
create table if not exists auth.identities (id uuid primary key default gen_random_uuid(), provider_id text, user_id uuid references auth.users(id) on delete cascade,
  identity_data jsonb, provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
create or replace function extensions.gen_salt(text) returns text language sql as $$ select '$2a$06$stubstubstubstubstubst' $$;
create or replace function extensions.crypt(text, text) returns text language sql as $$ select $2 || md5($1) $$;`;

test('demo accounts: one per role, no records added, re-runnable, removable', { timeout: 300000 }, async () => {
  const db = await createDb();
  await db.raw.exec(AUTH_EXTRA);
  db.asAdmin();
  const fam = await db.val(`insert into public.families (parish_id, family_name, jumuiya_id) values (public.default_parish_id(), 'Familia A', (select id from public.org_units where name = 'Clara' and unit_type = 'jumuiya')) returning id`);
  const person = await db.val(`insert into public.parishioners (parish_id, full_name, family_id) values (public.default_parish_id(), 'Mtu A', $1) returning id`, [fam]);
  const before = await db.one(`select (select count(*) from public.families)::int f, (select count(*) from public.parishioners)::int p, (select count(*) from public.finance_transactions)::int t`);

  await db.raw.exec(read('demo_accounts.sql'));
  await db.raw.exec(read('demo_accounts.sql'));

  const accts = await db.q(`select p.email, p.role, ur.role_code, o.name unit from public.profiles p
     left join public.parish_user_roles ur on ur.user_id = p.id left join public.org_units o on o.id = ur.org_unit_id
     where p.email like '%@minga.demo' order by p.email`);
  assert.equal(accts.length, 10);
  assert.equal(accts.find(a => a.email === 'superadmin@minga.demo').role, 'super_admin');
  assert.equal(accts.find(a => a.email === 'jumuiya@minga.demo').unit, 'Clara');
  assert.equal(accts.find(a => a.email === 'kigango@minga.demo').unit, 'Mughanga');
  assert.equal(N(await db.val(`select count(*) from auth.identities`)), 10);
  assert.deepEqual(await db.one(`select (select count(*) from public.families)::int f, (select count(*) from public.parishioners)::int p, (select count(*) from public.finance_transactions)::int t`), before);
  assert.equal(await db.val(`select p.email from public.parishioners x join public.profiles p on p.id = x.profile_id where x.id = $1`, [person]), 'muumini@minga.demo');

  await db.raw.exec(read('demo_remove.sql'));
  assert.equal(N(await db.val(`select count(*) from public.profiles where email like '%@minga.demo'`)), 0);
  assert.equal(N(await db.val(`select count(*) from public.parish_user_roles`)), 0);
  assert.equal(await db.val(`select profile_id from public.parishioners where id = $1`, [person]), null);
  assert.equal(N(await db.val(`select count(*) from public.parishioners`)), before.p);
});
const N = Number;
