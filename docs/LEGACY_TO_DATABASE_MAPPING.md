# Legacy → database mapping

The importer is `tools/migration/extract_workbook.py` (reads the workbook) → `tools/migration/build_import.py` (writes a private SQL script) → `database/migrations/20261015_07_legacy_import.sql` (loader functions). Names, aliases and category labels are in `tools/migration/mapping.json`.

## Organisation

| Workbook | Database |
|---|---|
| `HOMEBOOK!D4:D7` (Jimbo Katoliki Singida, Parokia ya Mt. Aloyce Gonzaga – Minga, S.L.P. 54 Singida, "Stakabadhi ya Malipo") | `parishes` (code `MNG`), `verified_fields` lists what came from the workbook |
| `HOMEDATA!C34:E85` groups MUGHANGA, MINGA, MANGUA, SONGA, KISASIDA, NTUNDUU, KINYETO | `org_units` type `kigango` (parent = parish), `zone` parokiani / vigangoni |
| 51 jumuiya names (`HOMEDATA!E35:E85`) | `org_units` type `jumuiya`, `legacy_names` = every spelling + named-range names |
| Parish-level groups in the parish block / HOMEBOOK H72:H96 (Kanda, WAWATA, Kwaya, Kamati …) | `org_units` type `group` |
| Named ranges `CLARA_` … `SONGA` (ledger) and `CLARA` … `BIKIRA_MARIA_WA_AMANI` (register) | used to attribute rows to jumuiya; stored in `legacy_ref.block` |

## Register — `PAROKIA DATA BASE`

| Column | Meaning | Database |
|---|---|---|
| block (named range) | jumuiya | `families.jumuiya_id`, `parishioners.jumuiya_id` |
| G FAMILIA NAMBA | family number in the jumuiya | `families.family_code`; family id is deterministic (re-import safe) |
| H SNO | person number in family | `legacy_ref.sno` |
| I JINA | name | `parishioners.full_name`; `families.family_name` = "Familia ya " + head (BABA, else MAMA, else first) |
| J JINSI (ME/KE) | sex | `gender` male/female |
| K UHUSIANO | relationship | `relationship`; head → `families.head_parishioner_id` |
| L CHEO | title | `legacy_ref.cheo` |
| M UTAMBUZI WA MLIPA ZAKA | Zaka payer flag | `is_zaka_payer` |
| O UMRI | age | `legacy_ref.age_recorded` (birth year not invented) |
| P SIMU | phone | `phone` (leading 0 restored on 9-digit numbers) |
| BU / BX / CA (PANGIWA Mavuno 2025/26/27) | family Mavuno pledge | `pledges` (family) in campaign *Mavuno YYYY* |
| CD / CG / CJ (PANGIWA Ujenzi) | family Ujenzi assessment | `pledges` in campaign *Ujenzi YYYY* (R-15) |
| BV, BY, CE, CH (TOA), Q…BL (Zaka months) | payments typed again | not imported — recomputed from the ledger (R-11) |
| CX…DN | SMS texts | statement screen |

## Ledger — `AKAUNTI BOOK-MIAMALA YOTE`

| Column | Meaning | `finance_transactions` |
|---|---|---|
| E NA | receipt number | `legacy_receipt_no` (+ new unique `receipts.receipt_no` for new payments) |
| F KIGANGO CHA | kigango | used with G to resolve the jumuiya inside vigango blocks |
| G JUMUIYA YA MT. | jumuiya / group / Sunday name | `org_unit_id` → `jumuiya_id`, `kigango_id` (snapshot) ; Sunday names kept in `legacy_ref.jumuiya_col` |
| H NIMEPOKEA KUTOKA KWA | payer | `payer_name`; `parishioner_id` when an exact match exists in the same jumuiya |
| I TAREHE | date (date or dd/mm/yyyy text) | `txn_date` (missing → pending, R-04) |
| J MUDA | time | `legacy_ref` |
| K KWA AJILI YA | purpose | `category_id` via `legacy_labels`; Zaka month → `period_month`; label year (e.g. "DENI MAVUNO-2024") → campaign year |
| L KIASI-2025 / M KIASI 2026 | amount, by year column | `amount`; the column year is the campaign / Zaka year (`legacy_ref.ledger_year`) while `financial_year_id` follows the cash date (117 rows dated 2026 sit in the 2025 column) |
| N TASILIMU/HUNDI | method | `payment_method` (R-03) |
| O JINA LA MPOKEAJI | receiver | `legacy_ref.received_by` |
| Subtotal rows (CONCATENATE key + SUM) | block totals | not imported; checked in `reconciliation_results` |

All legacy rows: `kind='income'`, `money_account_id` = account **1050**, `import_batch_id` set, `legacy_ref = {sheet,row,ledger_year,block,section,purpose,receipt_no,method,…}`. Pledged campaign rows are allocated to the family pledge of the same campaign when the payer was linked to a family.

## Campaign assessments — `MICHANGO-2026`

| Column | Category |
|---|---|
| POSHO MAKATEKISTA & MAFRATERI | MAKATEKISTA |
| KUWAPONGEZI MAPADRI NA MAKATEKISTA | KUPONGEZA_MAPADRI |
| KUMPONGEZA BABA ASKOFU | ZAWADI_ASKOFU |
| ZAWADI KRISTO MFUFUKA | KRISTO_MFUFUKA |
| KONGAMANO LA UTOTO (Ntunduu: KUMPONGEZA KATEKISTA) | KONGAMANO_UTOTO (Ntunduu: PONGEZI_MAKATEKISTA) |
| KUSOMESHA MAFRATERI | MAFRATERI |
| RADIO MARIA | RADIO_MARIA |
| MCHANGO WA VIWAWA | VIWAWA |

Each becomes `campaign_targets(campaign = <category> 2026, org_unit = jumuiya, basis = fixed)`; kigango-level lines are added only where no jumuiya line exists for that category.
