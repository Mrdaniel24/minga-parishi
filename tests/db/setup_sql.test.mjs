// database/supabase_setup.sql (what is pasted into the Supabase SQL editor) must
// match the migrations and run cleanly on an empty project — twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { SUPABASE_STUB } from './harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sql = readFileSync(join(ROOT, 'database', 'supabase_setup.sql'), 'utf8');

test('supabase_setup.sql contains every migration, unchanged', () => {
  for (const f of readdirSync(join(ROOT, 'database', 'migrations')).filter(f => f.endsWith('.sql'))) {
    assert.ok(sql.includes(readFileSync(join(ROOT, 'database', 'migrations', f), 'utf8')), `${f} is missing or stale — run: npm run setup:sql`);
  }
});

test('supabase_setup.sql runs on an empty project and can be run again', { timeout: 300000 }, async () => {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(`insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'mzee@parokia.test')`);   // an account made before setup
  await db.exec(sql);
  await db.exec(sql);
  const r = (await db.query(`select (select count(*) from public.org_units where unit_type = 'kigango')::int k,
    (select count(*) from public.profiles)::int p, (select count(*) from public.parishes)::int par`)).rows[0];
  assert.deepEqual(r, { k: 7, p: 1, par: 1 });
  await db.exec(`insert into auth.users (id, email) values ('22222222-2222-2222-2222-222222222222', 'mpya@parokia.test')`);
  assert.equal((await db.query(`select role from public.profiles where email = 'mpya@parokia.test'`)).rows[0].role, 'user');
});
