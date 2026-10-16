# Implementation status (2026-10-16)

"Verified" = covered by an automated test (`npm test`) or exercised in the browser against the real migrations (local server). Nothing here has been deployed to a live Supabase project yet.

| Phase / module | Status | Evidence |
|---|---|---|
| 1 Repository audit | Done | `REPOSITORY_AUDIT.md` |
| 2 Workbook & formula audit (103 sheets, VBA, named ranges, errors) | Done | `WORKBOOK_AUDIT.md`, `FORMULA_MAPPING.md`, `WORKSHEET_DEPENDENCIES.md`, `DATA_DICTIONARY.md`, `LEGACY_TO_DATABASE_MAPPING.md`, `MIGRATION_RISKS.md` |
| 3 Financial engine (ledger, balances, aggregations, journal, reversals, idempotency, period locks) | Done, verified | 19 tests; legacy parity 2,070/2,074 (4 = Excel errors) |
| 4 Parish identity, structure, families, members, leadership | Done (leadership empty until entered) | seed + import; screens verified |
| 5 Transactions, Zaka, Mavuno, Ujenzi, special campaigns, pledges, expenses, receipts | Done, verified | tests + browser (payment → receipt) |
| 6 Reports (10 report types), Excel/PDF export, reconciliation, scheduled snapshots | Done; PDF is the browser's "Save as PDF"; snapshots need pg_cron enabled | tests for totals & snapshots |
| 7 Events & envelopes | Envelopes done. Events module not built (transactions keep an unused `event_id` column for later) | — |
| 8 Historical migration | Import built and verified locally; **not yet run in production**; 243 rows await review and decisions R-01…R-21 | `tests/db/import.test.mjs` |
| 9 Personalisation & localisation | Parish name on login, footer, receipts, reports; parish screens in Kiswahili with EN switch for menu/key labels | — |
| 10 Deployment | Ready: `database/supabase_setup.sql` + `DEPLOYMENT.md`; not yet run on the parish project | — |

## Standalone (2026-10-16)
- Kanisa Hub removed: no `admin/`, `member/`, `super-admin/`, `public/` portals, no base schema, no integration migration (09), no chat/sermons/media/chatbot.
- `00_base.sql`: own `profiles` table, created automatically for each new login account; only a super admin can change role/status.
- `10_profiles_rls.sql`: a user sees only their own account; `users.manage` and the super admin can look accounts up by e-mail.
- Own `login.html`, `reset.html`, `assets/js/config.js`, `assets/js/parish/shell.js` (guard, menu, top bar, toasts).
- The former `church_overview()` leak (any signed-in user saw parish income and payer names) is gone with migration 09; `tests/db/standalone.test.mjs` proves an account without a role sees no money, people or accounts.
- `database/supabase_setup.sql`: all migrations in one file for the Supabase SQL editor; `tests/db/setup_sql.test.mjs` checks it is current and runs twice on an empty project.
- Member self-service portal (self-registration + link requests) is out until the parish decides; an administrator can still link an account to a register person (*Watumiaji → Unganisha akaunti*).
- Tests: 27 (`npm test`), including the legacy import with the real workbook when `MINGA_PRIVATE_DIR` is set.

## Known limitations / next work
- Online giving (M-Pesa etc.) is not built; when added it must post through `post_payment`.
- **Delivery of scheduled reports and SMS statements** (e-mail/SMS provider) is not implemented; snapshots are stored only.
- **Bank reconciliation** is manual (cashbook per account); no bank-statement import.
- **Payer linking** of legacy rows is exact-name only (834 rows); a matching assistant would improve family statements.
- The English translation covers menus and key labels, not every sentence of the parish screens.
