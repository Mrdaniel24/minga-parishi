# Implementation status (2026-10-15)

"Verified" = covered by an automated test (`npm test`) or exercised in the browser against the real migrations (local server). Nothing here has been deployed to a live Supabase project yet.

| Phase / module | Status | Evidence |
|---|---|---|
| 1 Repository audit | Done | `REPOSITORY_AUDIT.md` |
| 2 Workbook & formula audit (103 sheets, VBA, named ranges, errors) | Done | `WORKBOOK_AUDIT.md`, `FORMULA_MAPPING.md`, `WORKSHEET_DEPENDENCIES.md`, `DATA_DICTIONARY.md`, `LEGACY_TO_DATABASE_MAPPING.md`, `MIGRATION_RISKS.md` |
| 3 Financial engine (ledger, balances, aggregations, journal, reversals, idempotency, period locks) | Done, verified | 19 tests; legacy parity 2,070/2,074 (4 = Excel errors) |
| 4 Parish identity, structure, families, members, leadership | Done (leadership empty until entered) | seed + import; screens verified |
| 5 Transactions, Zaka, Mavuno, Ujenzi, special campaigns, pledges, expenses, receipts | Done, verified | tests + browser (payment → receipt) |
| 6 Reports (10 report types), Excel/PDF export, reconciliation, scheduled snapshots | Done; PDF is the browser's "Save as PDF"; snapshots need pg_cron enabled | tests for totals & snapshots |
| 7 Events & envelopes | Envelopes done. Events: existing Kanisa Hub module kept; campaigns/expenses/payments carry `event_id`, but there is no event-budget screen yet | — |
| 8 Historical migration | Import built and verified locally; **not yet run in production**; 243 rows await review and decisions R-01…R-21 | `tests/db/import.test.mjs` |
| 9 Personalisation & localisation | Parish name on login, footer, receipts, reports; parish screens in Kiswahili with EN switch for menu/key labels | — |
| 10 Deployment | Not done — needs a new Supabase project and the base-schema dump (`DEPLOYMENT.md`) | — |

## One system (migration 09 + shared menu)
- **One menu** for Super Admin, Admin and Member (`assets/js/admin-layout.js`): Kanisa (announcements, events, sermons, media, chat, groups), Parokia (register, money, reports), Mfumo, Yangu — items appear by role and permission.
- **Every jumuiya and parish group is a Kanisa Hub group** (department): jumuiya announcements, jumuiya chat and jumuiya-scoped admins work through the existing modules.
- **Members are linked to the register**: on registration the member picks their jumuiya → link request → jumuiya leader/administrator approves (*Maombi ya Kuunganishwa*) → the member's dashboard and *Michango Yangu* show their jumuiya, family, giving, Zaka months, pledges and receipts from the parish ledger.
- **A parish role makes the user an admin** of the Kanisa Hub portal (scoped leaders: of their jumuiya).
- **One money system**: Admin/Super-Admin dashboards read the parish ledger and register; the old *Contributions* and *Reports* pages open the parish *Miamala* and *Ripoti*.
- Kiswahili is the default language everywhere.
- Tests: 23 database tests (`npm test`), including 5 for the integration.

## Known limitations / next work
- Events: an event can be tied to a campaign (`events.campaign_id`), but the event pages do not yet show the campaign's progress.
- Online giving (Snippe) was removed from *Michango Yangu*; it must post through `post_payment` before it is turned back on.
- **Delivery of scheduled reports and SMS statements** (e-mail/SMS provider) is not implemented; snapshots are stored only.
- **Bank reconciliation** is manual (cashbook per account); no bank-statement import.
- **Event budgets / attendance** screens not built (events module from the demo is unchanged).
- **Payer linking** of legacy rows is exact-name only (834 rows); a matching assistant would improve family statements.
- The English translation covers menus and key labels, not every sentence of the parish screens.
- Online payments (Snippe) remain unconfigured, as in the demo.
