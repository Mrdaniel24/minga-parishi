# Formula mapping — Excel → PostgreSQL

Every financially relevant formula family found in the workbook, what it means, where it now lives, and how it was validated.
Cell counts come from the structural scan (`docs/WORKBOOK_AUDIT.md`). "Validated" means a passing automated test or the legacy parity run.

## How the workbook calculates

1. A payment is typed **once** into a jumuiya block of `AKAUNTI BOOK-MIAMALA YOTE` under a purpose section.
2. Each section ends with a subtotal row: key `=CONCATENATE(purpose," ",jumuiya)`, totals `=SUM(L…)` (2025) and `=SUM(M…)` (2026), and for assessed campaigns a target `K` (WALICHOPANGIWA), balance `N=K-L` and percent `O=L/K`.
3. ~70 report sheets `VLOOKUP` those keys (column 7 = target, 8 = 2025 paid, 9 = 2026 paid, 10 = balance) — a hand-built SUMIFS.
4. The same payments are typed **again** per person in `PAROKIA DATA BASE` (Zaka months, Mavuno/Ujenzi TOA), which drives the family reports and SMS texts.

In the new system step 1 is the only data entry; steps 2–4 are database views and functions.

## Ledger (`AKAUNTI BOOK-MIAMALA YOTE`)

| Formula family (example) | Cells | Business meaning | Database equivalent | Validation |
|---|---:|---|---|---|
| `=SUM(L21:L121)` / `=SUM(M…)` | 2,095 | Total paid in a purpose × jumuiya block for 2025 / 2026 | `contribution_totals(from,to,level,category,campaign,scope)`, `campaign_org_progress(campaign, level)` → `collected`; sum of `finance_transactions.net_amount` where `status='posted'` | **Legacy parity: 2,070 of 2,074 subtotals equal exactly**; the 4 others are Excel errors (below). `tests/db/import.test.mjs` |
| `=CONCATENATE(I671," ",G687)` | 1,526 | Lookup key "purpose jumuiya" | Not needed — rows carry `category_id`, `campaign_id`, `jumuiya_id`, `kigango_id` foreign keys | — |
| `=HOMEBOOK!$L$63` etc. | 19,697 | Section / header labels | `contribution_categories.legacy_labels` (the 96 purpose spellings found are matched by 107 legacy labels onto 39 income categories, `tools/migration/mapping.json`) | Every ledger row mapped or sent to review |
| `K =J900*60000` / `=J1049*2000` / `=J12356*20000` | 93 | Assessment = families/members × rate | `campaign_targets(basis='per_family'|'per_member', unit_count, unit_rate)`; `target_amount` is a generated column | `campaign targets per community` test |
| `K` typed (e.g. 8,000,000) | 314 | Fixed assessment | `campaign_targets(basis='fixed')` | as above |
| `N =K687-L687` | 1,104 | KIASI BADO (balance) | `balance = greatest(target − collected, 0)`; `excess = greatest(collected − target, 0)` | test; Excel shows negative balances when overpaid — the system never does |
| `O =L687/K687` | 854 | % YA UTOAJI | `pct = collected / target × 100` (null when no target) | 437 `#DIV/0!` in Excel where K is empty → null |
| `=468400+38800`, `=200000/9` | 9 | Amounts typed as arithmetic | Imported as the evaluated value; `=200000/9` gives 22,222.22 (non-integer) — flagged | `MIGRATION_RISKS.md` |
| `E =IF(F3619="","",ROW(3211:3211))`, `ROW(14:205740)` | 9 | Receipt numbers generated from row numbers | Real receipt numbering: `issue_receipt()` locks `receipt_counters` → `MNG-YYYY-000001`, unique | `receipts are unique and sequential` test |
| `O8 =IF(COUNT(M8:N8)="",…)` | 2 | Dead formula (COUNT never equals "") | dropped | — |

### Excel errors found by the parity run (not reproduced)

| Cell | Excel | Correct (system) | Cause |
|---|---:|---:|---|
| L434 `=SUM(L351:L432)` KUKODISHA SHAMBA PAROKIANI | 6,359,350 | 5,414,350 | range includes subtotals L355 and L365 → +945,000 double counted |
| M434 `=SUM(M351:M432)` | 3,084,526 | 3,082,500 | range includes the header cell M367 that holds the year label **2026** → +2,026 |
| L601 `=SUM(L439:L599)` | 14,779,008 | 10,739,858 | range includes subtotal L494 → +4,039,150 |
| M6638 `=SUM(M6605:M6636)` MAVUNO AUGUSTINO | 936,000 | 886,000 | range includes subtotal M6609 → +50,000 |

These need the accountant's confirmation before any historical report is re-issued (`MIGRATION_RISKS.md` R-01).

## Receipt index and receipt (`MIAMALA-YOTE`, `RISITI`)

| Formula | Cells | Meaning | Equivalent |
|---|---:|---|---|
| `=IF(B9="","",VLOOKUP(B9,'AKAUNTI BOOK…'!$E$17:$O$511065,n,FALSE))` | 63,972 | Fetch any ledger column by receipt number | `v_ledger`, `v_receipt_register` (joins, no lookup). Legacy receipt numbers are **not unique** (76 numbers on 155 rows) so a VLOOKUP returned the first match only; the system keeps them as `legacy_receipt_no` and issues new unique numbers |
| `RISITI!D16 =CHOOSE(LEFT(TEXT(D15,"000000000.00"))+1,…)` | 48 | Amount in English words | `amount_words_en()`; plus Kiswahili `amount_words_sw()` (e.g. 225,000 → "Shilingi laki mbili na elfu ishirini na tano") — tested |

## Register (`PAROKIA DATA BASE`)

| Formula | Cells | Meaning | Equivalent / correction |
|---|---:|---|---|
| Zaka grid Q…BL (typed, 4 year-columns per month) | — | Zaka per person per month 2025–2028 | **Not imported** (duplicate of ledger rows). `zaka_grid(year, level, scope)` builds Jan–Dec from posted Zaka payments (`period_month`) |
| `BM =COUNTA($Q,$U,$Y,$AC,$AG,$AK,$AO,$AS,$AY,$BA,$BE,$BI,)-1` | 6,347 | Months paid in 2025 | `zaka_grid.months_paid`. **Bug:** uses `$AY` (Sept **2027**) instead of `$AW` (Sept 2025). Trailing empty argument is why `-1` is needed |
| `BN =12-$BO` | 6,348 | Months NOT paid in 2025 | **Bug:** subtracts the **2026** count (BO). System: `months_unpaid = months elapsed in the year − months paid` (a future month is not "unpaid") — tested |
| `BW =IF(BV<>BU,IF(BV>BU,"ZAIDI"&TEXT(BU-BV),"BADO"&TEXT(BV-BU)),"-")` (and BZ, CC, CF, CI, CL) | 8,272 | Pledge status text | `v_pledge_balances.outstanding` / `.excess`. Excel prints `BADO-60,000` (negative) because the subtraction is reversed; the system returns two non-negative numbers |
| `BY =10000+10000+10000+10000` | ~80 | Payments re-typed as sums | Not imported; computed from the ledger |
| `CM/CP =IF($K="BABA",5000,IF($K="MAMA",5000,…IF($K="MTOTO",2000…` | 12,008 | Envelope assessment per relationship (rates also in HOMEDATA J17:K38) | Envelope module: `envelopes.expected_amount` / `campaign_targets(basis='per_member')`. Rate table to be confirmed (R-12) |
| `CO =IF(SUM(CM23:CM27)<>SUM(CN23:CN27),…)` | 162 | Family envelope status | `v_pledge_balances` / envelope report |
| `CX…DN =CONCATENATE("KRISTO, ",$I23," ZAKA ",…)` | ~60,000 | SMS statement texts | Statement screen (`#/statement`). SMS sending is not implemented |
| `N =IF(ISNUMBER(O23),($O$4-O23),"")` | 176 | Birth year from age | Broken: `$O$4` is empty so the result is −age. Age kept in `legacy_ref.age_recorded`; `birth_year` left empty (not invented) |
| `CW208 =CONCATENATE($G208,$CW$20,#REF!)` | 732 `#REF!` | Family key for one block whose jumuiya header was deleted | Rows still imported by named range; SMS builder in Excel was broken for that block |

## Reports (≈70 sheets)

| Pattern | Meaning | Equivalent |
|---|---|---|
| `VLOOKUP(CONCATENATE(purpose," ",jumuiya), AKAUNTI!$E:$O, 7|8|9|10)` | target / paid 2025 / paid 2026 / balance per jumuiya | `campaign_org_progress(campaign,'jumuiya')` |
| Kigango sheets summing jumuiya rows (`=SUM(G13:G22)`, `=SUM(G23,G38,G48)`) | kigango and parish totals | `campaign_org_progress(campaign,'kigango')`, `contribution_totals(…,'kigango'|'parish')` — kigango derived from the jumuiya's parent, so no manual list of rows |
| `REPT JUMUIYA… G =IF(F12>E12,F12-E12," -")` | ziada (excess) | `excess` column |
| `RIPORT-YA-ZAKA I =VLOOKUP(H12, DB, n)`, `K=J-I`, `O=K*2000`, `M=L/J` | members, non-payers, expected shortfall at 2,000 | `zaka_grid` (counts). The 2,000/month figure is a business rule to confirm (R-13) before it is used in a report |
| `MADENI YOTE` VLOOKUP of REPT sheets | all debts | `v_pledge_balances` (outstanding ≥ 0), `#/pledges`, report "Ahadi ambazo hazijalipwa" |
| `RISITI`, `FOMU…` | printable forms | `parish/receipt.html`, print/PDF of every report |
| `BAHASHA RADI MARIA S =N11-R11`, `KAPU LA MAMA S =N11-L11` | ziada/bado for envelopes | **Both wrong** (should be collected − assigned = `R-L`). `KAPU LA MAMA` is a copy of the Radio Maria sheet (same title and figures). Envelope module computes from posted envelope payments |

## Campaign assessments (`MICHANGO-2026`)

| Formula | Meaning | Equivalent |
|---|---|---|
| `G =SUM(D:F)` | jumuiya total for three diocesan contributions | sum of `campaign_targets` |
| `D72 =ROUNDUP(($D$52/11),-2)` | split a kigango target equally across its 11 jumuiya, rounded up to 100 | imported as the rounded per-jumuiya amount (136,400). Because of the rounding the parish total is **9,060,400** (row 94) vs **9,060,000** (row 56) |
| `I94` vs `I56` | Kongamano la Utoto total | 5,180,000 vs 6,340,000: Kinyeto/Kisasida/Songa have it only at kigango level (rows 50–53) and Ntunduu's column I is a different item ("KUMPONGEZA KATEKISTA", I71). The importer uses jumuiya rows and adds a kigango-level target only where no jumuiya target exists, and maps Ntunduu's column to *Pongezi kwa Makatekista* |
| Subtotal labelled "JUMLA MUGHANGA" under "KIGANGO CHA MT. EDWARD MANGUA" (C19) | label copy error | structure from HOMEDATA (Mangua = 7 jumuiya) |

## Not carried over

- VBA (`HideRowsWithHyphen`, `SaveDropdownItemsToPDF`, `SaveDropdownsWithDynamicRowHiding`): presentation only. Replaced by filters, "only with balance" options, print/PDF and Excel export on every report.
- `NOW()` / `TODAY()` report dates: replaced by the generation timestamp in each report header.
