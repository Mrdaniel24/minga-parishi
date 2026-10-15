// Test harness: a real PostgreSQL (PGlite, in-process WASM) with a minimal
// Supabase-compatible auth layer, then every migration in database/migrations.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS = join(ROOT, 'database', 'migrations');

// What Supabase provides before any SQL of ours runs (auth schema and API roles).
// The Kanisa Hub base tables come from database/000_kanisa_hub_base.sql.
const SUPABASE_STUB = `
create schema if not exists auth;
create schema if not exists extensions;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon nologin;
create role authenticated nologin;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

export async function createDb() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(readFileSync(join(ROOT, 'database', '000_kanisa_hub_base.sql'), 'utf8'));
  for (const f of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${e.message}`);
    }
  }
  return wrap(db);
}

function wrap(db) {
  let current = null;   // user id the next statements run as (null = superuser / service role)

  async function run(sql, params = []) {
    if (!current) return db.query(sql, params);
    // each call is its own transaction, like one PostgREST request
    return db.transaction(async tx => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [current]);
      await tx.exec('set local role authenticated');
      return tx.query(sql, params);
    });
  }

  const api = {
    raw: db,
    async q(sql, params) { return (await run(sql, params)).rows; },
    async one(sql, params) { return (await run(sql, params)).rows[0]; },
    async val(sql, params) { const r = (await run(sql, params)).rows[0]; return r ? Object.values(r)[0] : undefined; },
    as(userId) { current = userId; return api; },
    asAdmin() { current = null; return api; },
    async rpc(fn, arg) {
      const r = await run(`select public.${fn}($1::jsonb) as r`, [JSON.stringify(arg)]);
      return r.rows[0].r;
    },
    // create an auth user + profile, optionally with a parish role
    async user(email, { role = 'member', parishRole = null, org = null } = {}) {
      const id = randomUUID();
      const prev = current; current = null;
      await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
      await db.query('insert into public.profiles (id, email, full_name, role) values ($1, $2, $2, $3)', [id, email, role]);
      if (parishRole) {
        await db.query(`insert into public.parish_user_roles (user_id, parish_id, role_code, org_unit_id)
                        values ($1, public.default_parish_id(), $2, $3)`, [id, parishRole, org]);
      }
      current = prev;
      return id;
    },
    key: () => randomUUID(),
  };
  return api;
}

export const ids = async (db) => {
  const rows = await db.asAdmin().q(`
    select 'org:' || unit_type || ':' || name as k, id from public.org_units
    union all select 'cat:' || code, id from public.contribution_categories
    union all select 'camp:' || c.code || ':' || cp.campaign_year, cp.id from public.campaigns cp join public.contribution_categories c on c.id = cp.category_id
    union all select 'acc:' || code, id from public.ledger_accounts
    union all select 'fund:' || code, id from public.funds
    union all select 'fy:' || label, id from public.financial_years`);
  return Object.fromEntries(rows.map(r => [r.k, r.id]));
};
