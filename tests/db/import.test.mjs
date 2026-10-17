// End-to-end legacy import + formula parity.
// Needs the PRIVATE import package (never committed):
//   MINGA_PRIVATE_DIR=<dir containing import/minga_import.sql> npm test
// Without it the test is skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb } from './harness.mjs';

const dir = process.env.MINGA_PRIVATE_DIR;
const file = dir && join(dir, 'import', 'minga_import.sql');
const skip = !file || !existsSync(file) ? 'set MINGA_PRIVATE_DIR to run the legacy import test' : false;

test('legacy workbook import: completeness, formula parity and integrity', { skip, timeout: 600000 }, async () => {
  const db = await createDb();
  await db.raw.exec(readFileSync(file, 'utf8'));
  db.asAdmin();

  const batch = await db.one(`select id, status, summary from public.import_batches`);
  assert.equal(batch.status, 'imported');
  const counts = await db.one(`select (select count(*) from public.families)::int families, (select count(*) from public.parishioners)::int people,
      (select count(*) from public.finance_transactions)::int txns, (select count(*) from public.pledges)::int pledges`);
  assert.equal(counts.txns, batch.summary.transactions);
  assert.equal(counts.families, batch.summary.families);
  assert.equal(counts.people, batch.summary.parishioners);

  // block-level parity: every Excel SUM subtotal is reproduced, except the four
  // documented Excel errors (ranges that double-count other subtotals / a year label)
  const rec = await db.q(`select status, count(*)::int n from public.reconciliation_results group by status`);
  const by = Object.fromEntries(rec.map(r => [r.status, r.n]));
  const diffs = await db.q(`select cell_ref, excel_value, system_value, explanation from public.reconciliation_results where status = 'difference' order by cell_ref`);
  console.log('parity', by, diffs.map(d => `${d.cell_ref}: excel ${d.excel_value} system ${d.system_value}`));
  assert.ok(by.match >= 2070, `matches: ${by.match}`);
  for (const d of diffs) assert.ok(d.explanation, `unexplained difference at ${d.cell_ref}`);

  // the workbook's PANGIWA amounts arrive as assigned amounts, not promises
  assert.equal(Number(await db.val(`select count(*) from public.pledges where legacy_ref is not null and source <> 'assigned'`)), 0);

  // contributions the workbook assigned to every jumuiya (MALENGO) are "kila jumuiya · kupangiwa"
  const wrong = await db.q(`select cp.name from public.campaigns cp where exists (select 1 from public.campaign_targets ct where ct.campaign_id = cp.id)
     and not exists (select 1 from public.pledges p where p.campaign_id = cp.id) and (cp.giver_level is distinct from 'jumuiya' or cp.amount_mode <> 'assigned')
     and cp.giver_level is distinct from 'parishioner'`);
  assert.deepEqual(wrong, []);

  // integrity of the imported ledger
  const checks = await db.q(`select * from public.finance_integrity_checks()`);
  for (const c of checks) assert.ok(c.ok, `${c.check_code}: ${c.problem_count}`);

  // pending rows do not count; posted rows do
  const t = await db.one(`select sum(amount) filter (where status = 'posted') posted, sum(amount) filter (where status = 'pending') pending,
                                 count(*) filter (where status = 'pending')::int pending_n from public.finance_transactions`);
  const dash25 = await db.val(`select public.parish_dashboard(2025)`);
  const dash26 = await db.val(`select public.parish_dashboard(2026)`);
  const pendingReviews = Number(await db.val(`select count(*) from public.approval_requests where request_type = 'legacy_review' and status = 'pending'`));
  assert.equal(pendingReviews, t.pending_n);
  console.log('posted', t.posted, 'pending', t.pending, 'income 2025', dash25.totals.income_year, 'income 2026', dash26.totals.income_year);

  // the import cannot run twice
  await assert.rejects(db.raw.exec(readFileSync(file, 'utf8')), /duplicate key|already imported|import_batches_sha_once/);
});
