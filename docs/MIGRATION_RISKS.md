# Migration risks and decisions needed

Status of the legacy import (run against a real PostgreSQL with all migrations, `tests/db/import.test.mjs`):

| | |
|---|---|
| Ledger rows imported | 5,796 (TZS 387.8 M) |
| → posted (count in reports) | 5,553 rows, TZS 375,168,163 |
| → pending review (count in nothing until approved) | 243 rows, TZS 12,611,422 |
| Families / parishioners | 862 / 2,231 |
| Family pledges (register PANGIWA) | 2,299 |
| 2026 campaign targets (MICHANGO-2026) | 316 |
| Excel subtotals re-checked | 2,074 — 2,070 equal, 4 Excel errors (FORMULA_MAPPING.md) |
| Integrity checks | all pass (every posted row has a balanced journal; ledger = income accounts) |

Nothing below was changed silently. Each item is either held as *pending* in **Uhakiki wa Fedha → Kumbukumbu za zamani** or listed for a decision.

## Decisions for the parish (please confirm)

| # | Item | What the workbook shows | What the system does now | Needed |
|---|---|---|---|---|
| R-01 | Four Excel subtotals that double count | L434, M434, L601, M6638 include other subtotals or the year label "2026" | System totals exclude the double count (differences +945,000; +2,026; +4,039,150; +50,000) | Accountant confirms the corrected figures before any old report is re-issued |
| R-02 | Classification of Minga, Mughanga, Mangua | Called "Kigango cha …" and also grouped as "Parokiani" in some reports | **Decided (2026-10-16): all seven are vigango** — no parokiani/vigangoni zone | Done |
| R-03 | Payment method "HUNDI" (cheque) | On 5,433 of 5,460 rows — looks like the form's default | Imported as `other`, raw value kept in `legacy_ref.method`; all legacy money sits in account **1050 "Kumbukumbu za Excel"** | Confirm how money was actually received; accountant can transfer 1050 → cash/bank with *post_transfer* |
| R-04 | Missing / invalid dates | 143 rows with no date, 20 unreadable or out of range (e.g. `2035-03-01`, `31/0672026`, `NOT SEEN`) — TZS 8.87 M | **Pending**, placeholder 31 Dec of the ledger year, raw value kept | Enter the correct date and approve each |
| R-05 | Vigango jumuiya section, rows 13,877–18,438 | 140 rows (TZS 6.81 M), mostly without receipt numbers or dates, outside every named range; only 3 rows match rows in the kigango blocks above | **Pending** — not counted until confirmed | Confirm they are not the same money as the KINYETO/NTUNDUU/KISASIDA/SONGA blocks |
| R-06 | In-kind contributions | 25 rows (TZS 1.30 M) "MIFUGO NA MAZAO", "MAHINDI DEBE 3", "VITU HALISI" | **Pending** in category *Vitu Halisi (imethaminishwa)* | Confirm the valuation, or reject so they stay out of money totals |
| R-07 | Unclassified money | 4 rows (TZS 544,000): "HAIFAHAMIKI", "PESA ILIYOWEKWA KIMAKOSA", block "MIAMALA YA JAN-MWANZONI" | **Pending** in suspense category | Classify |
| R-08 | Receipt numbers | 336 rows have none; 76 numbers are used on 155 rows | Kept as `legacy_receipt_no` (not unique); new receipts are numbered `MNG-YYYY-000001`, unique | None — informational |
| R-09 | Section heading ≠ row purpose | 513 rows sit under a heading that differs from their own "KWA AJILI YA" (e.g. 61 *Mchango wa Pili* rows under *Mauzo ya Samaki*) | Category taken from the row's purpose; heading kept in `legacy_ref.filed_under`. Block parity still holds (same rows) but **category** totals differ from those Excel blocks | Spot-check |
| R-10 | Zaka labels | "10 ZAKA - SEPTEMBA" (2 rows), "6: ZAKA - MEI" (1) — number and month disagree | Month name used | Confirm |
| R-11 | Payments typed a second time in the register | Zaka grid, Mavuno/Ujenzi "TOA" | **Not imported** (would double count). Payer → person link made only on exact name match inside the same jumuiya (834 rows); others keep the payer's name and jumuiya | Gradually link payers to people (statement screens improve as links grow) |
| R-12 | Envelope rates per relationship | HOMEDATA J17:K38 (BABA 5,000 … MTOTO 2,000) and register CM/CP | Envelope module supports expected amounts; rates not auto-applied | Confirm the rate table per campaign |
| R-13 | Zaka "expected" rate | RIPORT-YA-ZAKA `O=K*2000` | Not used in any report | Confirm whether 2,000/month is policy |
| R-14 | Ledger WALICHOPANGIWA targets (column K, 407 subtotal rows) | Year is ambiguous (the balance N uses the 2025 column L) | MICHANGO-2026 targets imported; ledger K targets **not** imported | Say which year they belong to; then import (generator change only) |
| R-15 | Register PANGIWA for Ujenzi | 60,000 per family looks like an assessment rather than a voluntary pledge | Imported as family pledges in campaign *Ujenzi 2025/2026* | Confirm |
| R-16 | Fractional amount | `=200000/9` → 22,222.22 | Imported as 22,222.22 | Confirm the intended amount |
| R-17 | Envelope / Kapu la Mama sheets | Kapu la Mama sheet is a copy of the Radio Maria sheet; ZIADA/BADO formulas wrong in both | Not imported (counts typed by hand); amounts come from the ledger | Provide the real Kapu la Mama figures if they exist elsewhere |
| R-18 | Rafiki wa Papa envelope list | Names, phones, envelope numbers | Not yet imported into *Bahasha* | Approve import into an envelope batch |
| R-19 | Leadership | No verifiable list of current leaders (only names appearing as payers) | Nothing invented; positions are ready in *Viongozi* | Enter leaders |
| R-20 | Parish identity | Verified: name, diocese, postal address, patron saint, receipt title | Unverified fields left empty (phone, email, priest, logo, history …) | Fill in *Taarifa za Parokia* |
| R-21 | Age → birth year | `N = $O$4 − age` broken (O4 empty) | Age kept in `legacy_ref`, birth year empty | Optional: enter birth years |

## Technical risks

| # | Risk | Mitigation |
|---|---|---|
| T-01 | Resolved (2026-10-16): the system no longer depends on Kanisa Hub; `00_base.sql` provides the only base table (`profiles`). | — |
| T-02 | Resolved (2026-10-16): `assets/js/config.js` points at the parish's own Supabase project | — |
| T-03 | Personal data in the workbook | Workbook, extraction JSON and import SQL live outside the repo (`.gitignore` covers `private/`, `*.xlsm`, `minga_import.sql`, `workbook.json`); the import script runs only in the SQL editor |
| T-04 | Running the import twice | Refused by the import script and a unique index on the workbook hash |
| T-05 | Online payments (Snippe) and AI chatbot from the demo | Unchanged and still not configured |
