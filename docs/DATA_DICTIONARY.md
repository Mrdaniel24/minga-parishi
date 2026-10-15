# Data dictionary

New objects added by `database/migrations/20261015_0*.sql`. Existing Kanisa Hub tables (`profiles`, `departments`, `events`, `announcements`, `contributions`, `sermons`, `media_*`, `messages`, …) are unchanged. Money is `numeric(14,2)` in TZS.

## Parish and register (01)

| Table | Purpose | Key columns |
|---|---|---|
| `parishes` | Parish profile shown on every report and receipt | `code` (receipt prefix), `official_name`, `patron_saint`, `diocese`, address/phone/email, `logo_url`, `parish_priest`, `assistant_priests[]`, `fy_start_month`, `receipt_title/footer`, `report_header/footer`, `payment_accounts` jsonb, `verified_fields[]` |
| `org_units` | Tree: parish → kigango → jumuiya, plus parish `group`s | `parent_id`, `unit_type`, `name`, `zone` (parokiani/vigangoni), `legacy_names[]`, `is_active` |
| `org_unit_closure` (view) | ancestor/descendant pairs | — |
| `families` | Family | `family_code`, `family_name`, `jumuiya_id`, `head_parishioner_id`, `status`, `legacy_ref` |
| `parishioners` | Person in the parish register (not a login) | `full_name`, `gender`, `birth_year`, `phone`, `family_id`, `relationship`, `jumuiya_id`, `is_zaka_payer`, `membership_status`, `profile_id` (verified link to a login), `legacy_ref` |
| `membership_history` | Transfers between families / jumuiya (written by trigger) | from/to jumuiya and family, `changed_on`, `changed_by` |
| `leadership_positions`, `leadership_assignments` | Church leadership (separate from app permissions) | position, `org_unit_id`, `holder_name`, `parishioner_id`, dates, `status` |
| `parish_roles`, `role_permissions`, `parish_user_roles` | App permissions, optionally scoped to a kigango/jumuiya | role codes: parish_admin, parish_priest, accountant, treasurer, kigango_leader, jumuiya_leader, data_entry, auditor, member |
| `audit_log` | Append-only trail of every change and business action | `actor_id`, `action`, `table_name`, `row_id`, `old_data`, `new_data`, `note` |

Helper functions: `has_perm(permission, org_unit)`, `has_perm_anywhere`, `is_platform_admin`, `my_parish_access()`, `my_parishioner_id()`, `my_family_id()`, `org_ancestor_of_type`, `org_is_within`.

## Finance (02)

| Table | Purpose | Key columns / rules |
|---|---|---|
| `financial_years` | Calendar years 2024–2027 seeded | `status` open/closed |
| `accounting_periods` | Months; `is_locked` blocks posting | — |
| `funds` | GENERAL, UJENZI (restricted), JIMBO (restricted, money to forward to the diocese), SPECIAL | `is_restricted` |
| `ledger_accounts` | Chart of accounts (1000 cash, 1050 legacy Excel, 1100 bank, 1200 mobile money, 3000 equity, 4000–4900 income, 5000–5300 expense) | `account_type`, `money_kind` |
| `contribution_categories` | 39 income categories + 4 expense + TRANSFER | `kind` (zaka, mavuno, ujenzi, sadaka, shukrani, special, income_other, expense), `is_pledgeable`, `uses_period_month`, `fund_id`, `income_account_id`, `legacy_labels[]` |
| `campaigns` | A category in a year (Mavuno 2026 …) | `campaign_year`, `target_amount`, `overpayment_policy`, `status`, `event_id` |
| `campaign_targets` | WALICHOPANGIWA per community | `basis` fixed / per_family / per_member, `target_amount` generated |
| `pledges` | Ahadi by a person, a family or a community (exactly one) | `amount`, `due_on`, `status` active/cancelled/carried_forward, `carried_from_id`, attribution snapshot; one active pledge per payer per campaign |
| **`finance_transactions`** | **The single ledger** | `idempotency_key` (unique), `kind` income/expense/transfer/opening_balance/adjustment, `sign` (+1 / −1 reversal), `amount` > 0, `net_amount` = amount × sign, `status` pending/posted/rejected, `txn_date`, `financial_year_id`, `period_month`, `category_id`, `campaign_id`, `pledge_id`, `fund_id`, `money_account_id`, payer (`parishioner_id`/`family_id`/`org_unit_id`/`payer_name`), attribution snapshot `jumuiya_id`/`kigango_id`, `payment_method`, `reference_no` (unique per method for bank/mobile/cheque), `reverses_id`/`reversed_by_id`, `legacy_receipt_no`, `legacy_ref`, `import_batch_id`. Posted rows cannot be updated or deleted (trigger) |
| `payment_allocations` | Part of a payment applied to a pledge (split payments supported) | append-only |
| `journal_entries`, `journal_lines` | Double entry generated for every posted row; unbalanced entries rejected at commit | append-only |
| `receipt_counters`, `receipts` | Transaction-safe numbering `MNG-YYYY-NNNNNN`; amount in words (sw/en); `verification_code`; `status` valid/void; `print_count` | — |
| `approval_requests` | Expenses, legacy review rows | `request_type`, `status`, requester ≠ decider |
| `envelope_batches`, `envelopes` | Bahasha; distribution is not income | `status` unissued/distributed/returned/lost/cancelled, `transaction_id` once paid |
| `import_batches`, `import_issues`, `reconciliation_results` | Legacy import audit and formula parity | `source_sha256` unique per completed import |
| `report_snapshots` (08) | Daily / weekly / monthly / annual / outstanding snapshots | JSON computed from posted rows; `delivered_at` only after confirmed delivery |

## Calculation engine (04)

| Object | Replaces | Returns |
|---|---|---|
| `v_ledger` | MIAMALA-YOTE lookups | ledger with names, receipt number |
| `v_pledge_balances` | PANGIWA / TOA / BADO-ZIADA / % | pledged, received, paid (≤ pledge), outstanding (≥ 0), excess (≥ 0), completion %, overdue |
| `v_campaign_progress` | campaign summary sheets | target, pledged, collected, outstanding, % |
| `campaign_org_progress(campaign, 'jumuiya'|'kigango')` | RIPORT YA MAVUNO/UJENZI, REPT JUMUIYA, VIGAN… | target, pledged, collected, balance, excess, %, payers |
| `contribution_totals(from, to, level, category, campaign, scope)` | SUMIFS everywhere | totals per parish/kigango/jumuiya/family/person and category |
| `monthly_totals(year, scope)` | monthly report sheets | 12 months × income/expense/zaka/mavuno/ujenzi/sadaka/special |
| `zaka_grid(year, level, scope)` | register Zaka grid + BM/BN/BO/BP counters | Jan–Dec, total, months paid / unpaid |
| `v_account_balances`, `v_fund_balances`, `cashbook(account, from, to)` | — | trial balance, fund balances, running cashbook |
| `v_receipt_register` | RISITI | receipt register |
| `finance_integrity_checks()` | — | reconciliation checks |
| `parish_dashboard(year, scope)` | — | one JSON for the dashboard |

## Posting functions (03) — the only way to write money

`post_payment(jsonb)`, `reverse_transaction(txn, reason, key, date)`, `record_expense(jsonb)`, `decide_approval(request, approve, note)`, `post_transfer(jsonb)`, `create_pledge`, `update_pledge_amount`, `cancel_pledge`, `carry_forward_pledge`, `set_period_lock`, `close_financial_year`, `mark_receipt_printed`, `verify_receipt` (public), `update_pending_transaction` (07, pending rows only).
