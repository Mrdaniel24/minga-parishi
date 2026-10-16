// Local development / training server — NOT for production.
//
//   node tools/dev/local-supabase.mjs [--port 5600] [--import <private_dir>]
//
// Serves the static app AND a small Supabase-compatible API (the PostgREST
// and GoTrue subset the app uses) on top of an in-process PostgreSQL (PGlite)
// loaded with every migration in database/migrations. Row Level Security is
// enforced exactly as in Supabase: each request runs as role `authenticated`
// with request.jwt.claim.sub set to the signed-in user.
//
// Sign in at /login.html with any of the users printed at start-up (password: Demo@2026).
// With --import, the private workbook import is loaded (stays on this machine).
import http from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { createDb } from '../../tests/db/harness.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));
const PORT = Number(args.port || 5600);
const PASSWORD = 'Demo@2026';   // same accounts and password as database/demo/demo_accounts.sql

const db = await createDb();
const pg = db.raw;
const USERS = {};
for (const [email, role, scope] of [
  ['superadmin@minga.demo', null], ['admin@minga.demo', 'parish_admin'], ['mhasibu@minga.demo', 'accountant'], ['mhazini@minga.demo', 'treasurer'],
  ['karani@minga.demo', 'data_entry'], ['mkaguzi@minga.demo', 'auditor'], ['paroko@minga.demo', 'parish_priest'],
  ['jumuiya@minga.demo', 'jumuiya_leader', 'jumuiya|Clara'], ['kigango@minga.demo', 'kigango_leader', 'kigango|Mughanga'],
  ['muumini@minga.demo', 'member']]) {
  const org = scope ? (await pg.query(`select id from public.org_units where unit_type = $1 and name = $2`, scope.split('|'))).rows[0].id : null;
  USERS[email] = await db.user(email, { parishRole: role, org });
  await pg.query(`update public.profiles set full_name = $2, role = case when $3 then 'super_admin' else role end where id = $1`,
    [USERS[email], email.split('@')[0].replace(/^./, c => c.toUpperCase()), email.startsWith('superadmin')]);
}
if (args.import) {
  console.log('loading private import…');
  await pg.exec(readFileSync(join(args.import, 'import', 'minga_import.sql'), 'utf8'));
  await pg.exec('analyze');
  // let the test member see a real record: the register person with the most payments
  const top = (await pg.query(`select parishioner_id from public.finance_transactions where parishioner_id is not null
                                group by 1 order by count(*) desc limit 1`)).rows[0];
  if (top) await pg.query(`update public.parishioners set profile_id = $1 where id = $2`, [USERS['muumini@minga.demo'], top.parishioner_id]);
} else {
  await seedSample();
}

/* ---------------- tiny JWT (unsigned: local only) ---------------- */
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub, email) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 86400 })}.local`;
const subOf = req => {
  const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try { const p = JSON.parse(Buffer.from(t.split('.')[1], 'base64url')); return p.sub || null; } catch { return null; }
};
const userObj = (id, email) => ({ id, email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() });

/* ---------------- PostgREST subset ---------------- */
const ident = s => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) throw httpErr(400, `bad identifier ${s}`);
  return `"${s}"`;
};
function httpErr(status, message, code = 'PGRST100') { const e = new Error(message); e.status = status; e.code = code; return e; }

const fkCache = {};
async function fks() {
  if (fkCache.all) return fkCache.all;
  const r = await pg.query(`
    select c.conname, tc.relname as tbl, a.attname as col, tf.relname as ref, af.attname as refcol
    from pg_constraint c join pg_class tc on tc.oid = c.conrelid join pg_class tf on tf.oid = c.confrelid
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
    where c.contype = 'f' and tc.relnamespace = 'public'::regnamespace`);
  return (fkCache.all = r.rows);
}

function splitTop(s, sep = ',') {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++; if (ch === ')') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

async function selectList(table, alias, select) {
  const parts = splitTop(select || '*');
  const cols = [];
  for (const p of parts) {
    const m = p.match(/^([a-zA-Z_][\w]*)(?:!([\w]+))?\((.*)\)$/s);
    if (!m) { cols.push(p === '*' ? `${alias}.*` : `${alias}.${ident(p.split(':')[0])}`); continue; }
    const [, target, hint, inner] = m;
    const all = await fks();
    // to-one: FK on base table pointing to target; to-many: FK on target pointing to base
    let one = all.filter(f => f.tbl === table && f.ref === target && (!hint || f.conname === hint || f.col === hint));
    let many = all.filter(f => f.tbl === target && f.ref === table && (!hint || f.conname === hint || f.col === hint));
    const a2 = `${alias}_${target}`;
    const innerCols = await selectList(target, a2, inner);
    if (one.length) {
      const f = one[0];
      cols.push(`(select to_jsonb(x) from (select ${innerCols} from public.${ident(target)} ${a2} where ${a2}.${ident(f.refcol)} = ${alias}.${ident(f.col)}) x) as ${ident(target)}`);
    } else if (many.length) {
      const f = many[0];
      cols.push(`coalesce((select jsonb_agg(to_jsonb(x)) from (select ${innerCols} from public.${ident(target)} ${a2} where ${a2}.${ident(f.col)} = ${alias}.${ident(f.refcol)}) x), '[]'::jsonb) as ${ident(target)}`);
    } else throw httpErr(400, `no relationship ${table} -> ${target}`, 'PGRST200');
  }
  return cols.join(', ');
}

function filterSql(col, expr, params, alias) {
  const c = `${alias}.${ident(col)}`;
  const neg = expr.startsWith('not.');
  if (neg) expr = expr.slice(4);
  const i = expr.indexOf('.');
  const op = expr.slice(0, i), val = expr.slice(i + 1);
  const p = v => { params.push(v); return `$${params.length}`; };
  let sql;
  switch (op) {
    case 'eq': sql = `${c} = ${p(val)}`; break;
    case 'neq': sql = `${c} <> ${p(val)}`; break;
    case 'gt': sql = `${c} > ${p(val)}`; break;
    case 'gte': sql = `${c} >= ${p(val)}`; break;
    case 'lt': sql = `${c} < ${p(val)}`; break;
    case 'lte': sql = `${c} <= ${p(val)}`; break;
    case 'like': sql = `${c}::text like ${p(val.replace(/\*/g, '%'))}`; break;
    case 'ilike': sql = `${c}::text ilike ${p(val.replace(/\*/g, '%'))}`; break;
    case 'is': sql = `${c} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`; break;
    case 'in': {
      const items = val.replace(/^\(|\)$/g, '').split(',').map(x => x.replace(/^"|"$/g, ''));
      sql = items.length ? `${c}::text in (${items.map(x => p(x)).join(',')})` : 'false'; break;
    }
    default: throw httpErr(400, `operator ${op} not supported`);
  }
  return neg ? `not (${sql})` : sql;
}

function whereSql(sp, params, alias) {
  const conds = [];
  for (const [k, v] of sp) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'or') {
      const items = splitTop(v.replace(/^\(|\)$/g, ''));
      conds.push('(' + items.map(it => { const j = it.indexOf('.'); return filterSql(it.slice(0, j), it.slice(j + 1), params, alias); }).join(' or ') + ')');
    } else conds.push(filterSql(k, v, params, alias));
  }
  return conds.length ? ' where ' + conds.join(' and ') : '';
}

async function asUser(sub, fn) {
  return pg.transaction(async tx => {
    if (sub) await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub]);
    await tx.exec(sub ? 'set local role authenticated' : 'set local role anon');
    return fn(tx);
  });
}

async function rest(req, res, url, body, sub) {
  const name = url.pathname.replace(/^\/rest\/v1\//, '');
  const sp = url.searchParams;
  const prefer = req.headers['prefer'] || '';
  if (name.startsWith('rpc/')) {
    const fn = name.slice(4);
    const argsObj = body ? JSON.parse(body) : Object.fromEntries(sp);
    const keys = Object.keys(argsObj);
    const params = keys.map(k => (argsObj[k] !== null && typeof argsObj[k] === 'object') ? JSON.stringify(argsObj[k]) : argsObj[k]);
    const sql = `select * from public.${ident(fn)}(${keys.map((k, i) => `${ident(k)} => $${i + 1}`).join(', ')})`;
    const r = await asUser(sub, tx => tx.query(sql, params));
    const rettype = r.fields.length === 1 && r.fields[0].name === fn ? 'scalar' : 'set';
    const rows = r.rows;
    const fnInfo = (await pg.query(`select proretset from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace limit 1`, [fn])).rows[0];
    const data = fnInfo && !fnInfo.proretset ? (rettype === 'scalar' ? rows[0]?.[fn] ?? null : rows[0] ?? null) : rows;
    return send(res, 200, data);
  }
  const table = name, alias = 't';
  if (req.method === 'GET' || req.method === 'HEAD') {
    const params = [];
    let sql = `select ${await selectList(table, alias, sp.get('select'))} from public.${ident(table)} ${alias}${whereSql(sp, params, alias)}`;
    if (sp.get('order')) sql += ' order by ' + sp.get('order').split(',').map(o => {
      const [c, ...mods] = o.split('.');
      return `${alias}.${ident(c)}${mods.includes('desc') ? ' desc' : ' asc'}${mods.includes('nullsfirst') ? ' nulls first' : mods.includes('nullslast') ? ' nulls last' : ''}`;
    }).join(', ');
    const countSql = /count=exact/.test(prefer) ? `select count(*)::int n from public.${ident(table)} ${alias}${whereSql(sp, [], alias)}` : null;
    if (sp.get('limit')) sql += ` limit ${Number(sp.get('limit'))}`;
    if (sp.get('offset')) sql += ` offset ${Number(sp.get('offset'))}`;
    const { rows, count } = await asUser(sub, async tx => ({ rows: (await tx.query(sql, params)).rows,
      count: countSql ? (await tx.query(countSql, params.slice())).rows[0].n : null }));
    if (count !== null) res.setHeader('Content-Range', `0-${Math.max(rows.length - 1, 0)}/${count}`);
    if ((req.headers.accept || '').includes('vnd.pgrst.object')) {
      if (rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null });
      return send(res, 200, rows[0]);
    }
    return send(res, 200, rows);
  }
  const returning = /return=representation/.test(prefer) ? ' returning *' : '';
  if (req.method === 'POST') {
    let rows = JSON.parse(body); if (!Array.isArray(rows)) rows = [rows];
    const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
    const params = [];
    const values = rows.map(r => '(' + cols.map(c => { const v = r[c]; params.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v); return r.hasOwnProperty(c) ? `$${params.length}` : 'default'; }).join(',') + ')').join(',');
    let sql = `insert into public.${ident(table)} (${cols.map(ident).join(',')}) values ${values}`;
    if (sp.get('on_conflict')) {
      const oc = sp.get('on_conflict').split(',').map(ident).join(',');
      sql += /ignore-duplicates/.test(prefer) ? ` on conflict (${oc}) do nothing` : ` on conflict (${oc}) do update set ${cols.map(c => `${ident(c)} = excluded.${ident(c)}`).join(',')}`;
    }
    const r = await asUser(sub, tx => tx.query(sql.replace(/ (\w+) \(/, ' $1 (') + returning, params));
    return send(res, 201, returning ? r.rows : null);
  }
  if (req.method === 'PATCH') {
    const row = JSON.parse(body); const params = [];
    const sets = Object.keys(row).map(c => { const v = row[c]; params.push(v !== null && typeof v === 'object' ? JSON.stringify(v) : v); return `${ident(c)} = $${params.length}`; });
    const sql = `update public.${ident(table)} ${alias} set ${sets.join(',')}${whereSql(sp, params, alias)}${returning}`;
    const r = await asUser(sub, tx => tx.query(sql, params));
    return send(res, 200, returning ? r.rows : null);
  }
  if (req.method === 'DELETE') {
    const params = [];
    const r = await asUser(sub, tx => tx.query(`delete from public.${ident(table)} ${alias}${whereSql(sp, params, alias)}${returning}`, params));
    return send(res, 200, returning ? r.rows : null);
  }
  throw httpErr(405, 'method not allowed');
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range' });
  res.end(data === null || data === undefined ? (status === 201 || status === 200 ? '' : 'null') : JSON.stringify(data));
}

/* ---------------- Storage subset (uploads kept in tools/dev/.storage, local only) ---------------- */
const STORE = join(ROOT, 'tools', 'dev', '.storage');
function multipartFile(raw, ctype) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ctype || '');
  if (!m) return { data: raw, type: ctype };
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  let pos = 0, best = null;
  while ((pos = raw.indexOf(boundary, pos)) !== -1) {
    const start = pos + boundary.length + 2;
    const headEnd = raw.indexOf('\r\n\r\n', start);
    const next = raw.indexOf(boundary, start);
    if (headEnd === -1 || next === -1) break;
    const headers = raw.slice(start, headEnd).toString();
    const data = raw.slice(headEnd + 4, next - 2);
    if (/filename=|name=""/.test(headers) || /Content-Type:/i.test(headers)) best = { data, type: (/Content-Type:\s*([^\r\n]+)/i.exec(headers) || [])[1] };
    pos = next;
  }
  return best || { data: raw, type: 'application/octet-stream' };
}
async function storage(req, res, url, raw, sub) {
  const p = decodeURIComponent(url.pathname.replace(/^\/storage\/v1\//, ''));
  if (req.method === 'GET' && p.startsWith('object/public/')) {
    const file = normalize(join(STORE, p.slice('object/public/'.length)));
    if (!file.startsWith(STORE) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    return res.end(readFileSync(file));
  }
  if (!sub) return send(res, 401, { statusCode: '401', error: 'Unauthorized', message: 'sign in to upload' });
  if ((req.method === 'POST' || req.method === 'PUT') && p.startsWith('object/')) {
    const key = p.slice('object/'.length);
    const file = normalize(join(STORE, key));
    if (!file.startsWith(STORE)) return send(res, 400, { message: 'bad path' });
    const { data } = multipartFile(raw, req.headers['content-type']);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
    return send(res, 200, { Key: key, Id: key, path: key.split('/').slice(1).join('/'), fullPath: key });
  }
  if (req.method === 'DELETE' && p.startsWith('object/')) {
    const bucket = p.slice('object/'.length);
    const { prefixes = [] } = JSON.parse(raw.toString() || '{}');
    for (const k of prefixes) { const file = normalize(join(STORE, bucket, k)); if (file.startsWith(STORE) && existsSync(file)) rmSync(file); }
    return send(res, 200, prefixes.map(name => ({ name })));
  }
  return send(res, 200, []);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
function serveStatic(url, res) {
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (!p || p.endsWith('/') || p.endsWith('\\')) p = join(p, 'index.html');
  const file = join(ROOT, p);
  if (!file.startsWith(ROOT) || /[\\/](private|node_modules|\.git)[\\/]/.test(file) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  let buf = readFileSync(file);
  if (extname(file) === '.html') buf = Buffer.from(buf.toString('utf8').replace('<head>', `<head><script>window.PM_LOCAL_URL=location.origin;</script>`));
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(buf);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' });
    return res.end();
  }
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks);
  const body = raw.toString('utf8');
  try {
    if (url.pathname.startsWith('/auth/v1/')) {
      const ep = url.pathname.slice(9);
      if (ep === 'token') {
        const { email, password, refresh_token } = JSON.parse(body || '{}');
        const em = email || (refresh_token || '').replace(/^r-/, '');
        if (!USERS[em] || (email && password !== PASSWORD)) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', msg: 'Invalid login credentials' });
        return send(res, 200, { access_token: jwt(USERS[em], em), token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: 'r-' + em, user: userObj(USERS[em], em) });
      }
      if (ep === 'user') {
        const sub = subOf(req); const em = Object.keys(USERS).find(e => USERS[e] === sub);
        return sub && em ? send(res, 200, userObj(sub, em)) : send(res, 401, { code: 401, msg: 'invalid JWT' });
      }
      if (ep === 'logout') { res.writeHead(204); return res.end(); }
      return send(res, 404, { msg: 'not implemented in local server' });
    }
    if (url.pathname.startsWith('/rest/v1/')) return await rest(req, res, url, body, subOf(req));
    if (url.pathname.startsWith('/storage/v1/')) return storage(req, res, url, raw, subOf(req));
    return serveStatic(url, res);
  } catch (e) {
    const status = e.status || 400;
    send(res, status, { code: e.code || 'P0001', message: e.message, details: e.detail || null, hint: e.hint || null });
  }
}).listen(PORT, () => {
  console.log(`Minga Parish local server: http://localhost:${PORT}/login.html`);
  console.log(`password for all users: ${PASSWORD}`);
  Object.keys(USERS).forEach(e => console.log('  ' + e));
});

/* ---------- synthetic sample data (clearly fictitious) when no import is given ---------- */
async function seedSample() {
  const q = (s, p) => pg.query(s, p);
  const units = (await q(`select id, name from public.org_units where unit_type = 'jumuiya' order by name limit 6`)).rows;
  const cat = Object.fromEntries((await q(`select code, id from public.contribution_categories`)).rows.map(r => [r.code, r.id]));
  const camp = (await q(`select cp.id from public.campaigns cp join public.contribution_categories c on c.id = cp.category_id where c.code = 'MAVUNO' and cp.campaign_year = extract(year from current_date)`)).rows[0]?.id;
  const acc = (await q(`select id from public.ledger_accounts where code = '1000'`)).rows[0].id;
  const fy = y => q(`select id from public.financial_years where label = $1`, [String(y)]).then(r => r.rows[0]?.id);
  let n = 0;
  for (const u of units) {
    for (let f = 1; f <= 4; f++) {
      const fam = (await q(`insert into public.families (parish_id, family_name, family_code, jumuiya_id) values (public.default_parish_id(), $1, $2, $3) returning id`,
        [`Familia ya Mfano ${u.name} ${f}`, String(f), u.id])).rows[0].id;
      for (const [nm, rel] of [['Baba', 'BABA'], ['Mama', 'MAMA'], ['Mtoto', 'MTOTO']]) {
        await q(`insert into public.parishioners (parish_id, full_name, family_id, jumuiya_id, relationship, is_zaka_payer) values (public.default_parish_id(), $1, $2, $3, $4, $5)`,
          [`${nm} Mfano ${u.name.split(' ')[0]} ${f}`, fam, u.id, rel, rel !== 'MTOTO']);
      }
      if (camp) await q(`insert into public.pledges (parish_id, campaign_id, family_id, amount, jumuiya_id, kigango_id) values (public.default_parish_id(), $1, $2, $3, $4, public.org_ancestor_of_type($4, 'kigango'))`,
        [camp, fam, 100000 * f, u.id]);
      // a few payments, posted through the real engine as the accountant
      const mh = USERS['mhasibu@minga.demo'];
      await asUser(mh, tx => tx.query(`select public.post_payment($1::jsonb)`, [JSON.stringify({ idempotency_key: crypto.randomUUID(), amount: 50000 * f, category_id: cat.MAVUNO, campaign_id: camp, family_id: fam, payment_method: 'cash', receiving_officer: 'Mhasibu' })]));
      await asUser(mh, tx => tx.query(`select public.post_payment($1::jsonb)`, [JSON.stringify({ idempotency_key: crypto.randomUUID(), amount: 3000, category_id: cat.ZAKA, family_id: fam, payment_method: 'cash', period_month: new Date().toISOString().slice(0, 8) + '01' })]));
      n += 2;
    }
  }
  await asUser(USERS['mhasibu@minga.demo'], tx => tx.query(`select public.post_payment($1::jsonb)`, [JSON.stringify({ idempotency_key: crypto.randomUUID(), amount: 450000, category_id: cat.SADAKA_JUMAPILI, payer_name: 'Sadaka ya Jumapili (mfano)', payment_method: 'cash' })]));
  const p = (await q(`select id from public.parishioners where full_name like 'Baba Mfano Aloyce 1%' limit 1`)).rows[0].id;
  await q(`update public.parishioners set profile_id = $1 where id = $2`, [USERS['muumini@minga.demo'], p]);
  USERS['mpya@minga.demo'] = await db.user('mpya@minga.demo');   // an account with no parish role yet
  console.log(`sample data: ${units.length * 4} families, ${n + 1} payments (fictitious names "Mfano")`);
}
