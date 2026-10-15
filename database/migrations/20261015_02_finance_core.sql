-- ============================================================================
-- Minga Parish Management System — migration 02: financial data model
--   One authoritative ledger (finance_transactions). Every report, balance,
--   dashboard figure and receipt is derived from it — nothing is copied.
--
--   Money is NUMERIC(14,2). Posted rows are immutable; corrections are made
--   with reversal transactions (sign = -1) or adjustments.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Financial years and monthly accounting periods
-- ---------------------------------------------------------------------------
create table if not exists public.financial_years (
  id         uuid primary key default gen_random_uuid(),
  parish_id  uuid not null references public.parishes(id),
  label      text not null,                 -- '2026'
  starts_on  date not null,
  ends_on    date not null,
  status     text not null default 'open' check (status in ('open','closed')),
  closed_at  timestamptz,
  closed_by  uuid,
  unique (parish_id, label),
  check (ends_on > starts_on)
);

create table if not exists public.accounting_periods (
  id                 uuid primary key default gen_random_uuid(),
  financial_year_id  uuid not null references public.financial_years(id) on delete cascade,
  period_start       date not null,
  period_end         date not null,
  is_locked          boolean not null default false,
  locked_at          timestamptz,
  locked_by          uuid,
  unique (financial_year_id, period_start)
);

-- ---------------------------------------------------------------------------
-- Funds and chart of accounts (double entry)
-- ---------------------------------------------------------------------------
create table if not exists public.funds (
  id          uuid primary key default gen_random_uuid(),
  parish_id   uuid not null references public.parishes(id),
  code        text not null,
  name        text not null,
  is_restricted boolean not null default false,   -- e.g. Ujenzi money may only be spent on construction
  description text,
  unique (parish_id, code)
);

create table if not exists public.ledger_accounts (
  id            uuid primary key default gen_random_uuid(),
  parish_id     uuid not null references public.parishes(id),
  code          text not null,
  name          text not null,
  account_type  text not null check (account_type in ('asset','liability','equity','income','expense')),
  money_kind    text check (money_kind in ('cash','bank','mobile_money')),  -- set for accounts that hold money
  bank_name     text,
  account_number text,
  fund_id       uuid references public.funds(id),
  is_active     boolean not null default true,
  unique (parish_id, code)
);

-- ---------------------------------------------------------------------------
-- Contribution categories (aina za michango) and campaigns (per year)
-- ---------------------------------------------------------------------------
create table if not exists public.contribution_categories (
  id                 uuid primary key default gen_random_uuid(),
  parish_id          uuid not null references public.parishes(id),
  code               text not null,
  name_sw            text not null,
  name_en            text,
  kind               text not null check (kind in ('zaka','mavuno','ujenzi','sadaka','special','shukrani','income_other','expense')),
  is_pledgeable      boolean not null default false,
  uses_period_month  boolean not null default false,   -- Zaka: the month the payment is for
  fund_id            uuid references public.funds(id),
  income_account_id  uuid references public.ledger_accounts(id),
  expense_account_id uuid references public.ledger_accounts(id),
  legacy_labels      text[] not null default '{}',
  is_active          boolean not null default true,
  sort_order         int not null default 100,
  unique (parish_id, code)
);

create table if not exists public.campaigns (
  id                  uuid primary key default gen_random_uuid(),
  parish_id           uuid not null references public.parishes(id),
  category_id         uuid not null references public.contribution_categories(id),
  financial_year_id   uuid references public.financial_years(id),
  campaign_year       int not null,
  name                text not null,
  description         text,
  starts_on           date,
  ends_on             date,
  target_amount       numeric(14,2) check (target_amount is null or target_amount >= 0),
  overpayment_policy  text not null default 'record_as_excess'
                      check (overpayment_policy in ('record_as_excess','credit_next_campaign')),
  status              text not null default 'active' check (status in ('draft','active','closed')),
  recurs_annually     boolean not null default false,
  previous_campaign_id uuid references public.campaigns(id),
  event_id            uuid,                 -- optional link to public.events (Kanisa Hub)
  created_at          timestamptz not null default now(),
  unique (parish_id, category_id, campaign_year, name)
);

-- assessments per community ("WALICHOPANGIWA"): fixed, or units × rate (families × 60,000 …)
create table if not exists public.campaign_targets (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns(id) on delete cascade,
  org_unit_id   uuid not null references public.org_units(id),
  basis         text not null default 'fixed' check (basis in ('fixed','per_family','per_member')),
  fixed_amount  numeric(14,2) check (fixed_amount is null or fixed_amount >= 0),
  unit_count    int check (unit_count is null or unit_count >= 0),
  unit_rate     numeric(14,2) check (unit_rate is null or unit_rate >= 0),
  target_amount numeric(14,2) generated always as (
                  case when basis = 'fixed' then fixed_amount else coalesce(unit_count,0) * coalesce(unit_rate,0) end) stored,
  notes         text,
  unique (campaign_id, org_unit_id),
  check ((basis = 'fixed' and fixed_amount is not null) or (basis <> 'fixed' and unit_count is not null and unit_rate is not null))
);

-- ---------------------------------------------------------------------------
-- Pledges (ahadi) — by a parishioner, a family or a whole community
-- ---------------------------------------------------------------------------
create table if not exists public.pledges (
  id                uuid primary key default gen_random_uuid(),
  parish_id         uuid not null references public.parishes(id),
  campaign_id       uuid not null references public.campaigns(id),
  parishioner_id    uuid references public.parishioners(id),
  family_id         uuid references public.families(id),
  org_unit_id       uuid references public.org_units(id),
  amount            numeric(14,2) not null check (amount > 0),
  pledged_on        date not null default current_date,
  due_on            date,
  status            text not null default 'active' check (status in ('active','cancelled','carried_forward')),
  status_reason     text,
  carried_from_id   uuid references public.pledges(id),
  -- attribution snapshot (kept when the family later moves)
  jumuiya_id        uuid references public.org_units(id),
  kigango_id        uuid references public.org_units(id),
  legacy_ref        jsonb,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  check (num_nonnulls(parishioner_id, family_id, org_unit_id) = 1)
);
create unique index if not exists pledges_one_active_per_payer
  on public.pledges (campaign_id, coalesce(parishioner_id, family_id, org_unit_id)) where status = 'active';
create index if not exists pledges_campaign_idx on public.pledges (campaign_id);

-- ---------------------------------------------------------------------------
-- THE LEDGER
-- ---------------------------------------------------------------------------
create table if not exists public.finance_transactions (
  id                 uuid primary key default gen_random_uuid(),
  txn_no             bigint generated always as identity unique,
  parish_id          uuid not null references public.parishes(id),
  idempotency_key    uuid not null unique,                 -- one key per form submission: retries/double clicks reuse it
  kind               text not null check (kind in ('income','expense','transfer','opening_balance','adjustment')),
  sign               smallint not null default 1 check (sign in (1,-1)),   -- -1 = reversal of another row
  amount             numeric(14,2) not null check (amount > 0),
  net_amount         numeric(14,2) generated always as (amount * sign) stored,
  status             text not null default 'posted' check (status in ('pending','posted','rejected')),
  txn_date           date not null,
  financial_year_id  uuid not null references public.financial_years(id),
  period_month       date,                                 -- Zaka month the payment is for (1st of month)
  category_id        uuid not null references public.contribution_categories(id),
  campaign_id        uuid references public.campaigns(id),
  pledge_id          uuid references public.pledges(id),    -- primary obligation the payment was taken against
  fund_id            uuid references public.funds(id),
  money_account_id   uuid not null references public.ledger_accounts(id),   -- cash / bank / mobile money
  to_account_id      uuid references public.ledger_accounts(id),            -- transfers only
  parishioner_id     uuid references public.parishioners(id),
  family_id          uuid references public.families(id),
  org_unit_id        uuid references public.org_units(id),   -- community / group the money is credited to
  jumuiya_id         uuid references public.org_units(id),   -- attribution snapshot at posting time
  kigango_id         uuid references public.org_units(id),
  payer_name         text,
  payment_method     text not null default 'cash'
                     check (payment_method in ('cash','cheque','bank_transfer','mobile_money','envelope','other')),
  reference_no       text,                                 -- bank / mobile money / cheque reference
  description        text,
  reverses_id        uuid references public.finance_transactions(id),
  reversed_by_id     uuid references public.finance_transactions(id),
  reversal_reason    text,
  event_id           uuid,
  envelope_id        uuid,
  recorded_by        uuid,
  approved_by        uuid,
  posted_at          timestamptz,
  legacy_receipt_no  text,
  legacy_ref         jsonb,                                -- {sheet,row,...} for imported history
  import_batch_id    uuid,
  created_at         timestamptz not null default now(),
  check (sign = 1 or reverses_id is not null),
  check (kind <> 'transfer' or to_account_id is not null)
);
create index if not exists ft_date_idx      on public.finance_transactions (txn_date);
create index if not exists ft_fy_idx        on public.finance_transactions (financial_year_id);
create index if not exists ft_category_idx  on public.finance_transactions (category_id);
create index if not exists ft_campaign_idx  on public.finance_transactions (campaign_id);
create index if not exists ft_pledge_idx    on public.finance_transactions (pledge_id);
create index if not exists ft_family_idx    on public.finance_transactions (family_id);
create index if not exists ft_parishioner_idx on public.finance_transactions (parishioner_id);
create index if not exists ft_jumuiya_idx   on public.finance_transactions (jumuiya_id);
create index if not exists ft_kigango_idx   on public.finance_transactions (kigango_id);
-- the same external payment reference can be posted only once
create unique index if not exists ft_unique_external_ref
  on public.finance_transactions (payment_method, lower(btrim(reference_no)))
  where reference_no is not null and btrim(reference_no) <> '' and sign = 1 and status <> 'rejected'
        and payment_method in ('cheque','bank_transfer','mobile_money');
-- one reversal per original
create unique index if not exists ft_one_reversal on public.finance_transactions (reverses_id) where reverses_id is not null;

-- payment allocations: how much of a payment went to which pledge (split payments)
create table if not exists public.payment_allocations (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references public.finance_transactions(id),
  pledge_id       uuid not null references public.pledges(id),
  amount          numeric(14,2) not null check (amount > 0),
  created_at      timestamptz not null default now(),
  unique (transaction_id, pledge_id)
);
create index if not exists payment_allocations_pledge_idx on public.payment_allocations (pledge_id);

-- ---------------------------------------------------------------------------
-- Double-entry journal (generated from the ledger by the posting functions)
-- ---------------------------------------------------------------------------
create table if not exists public.journal_entries (
  id              uuid primary key default gen_random_uuid(),
  parish_id       uuid not null references public.parishes(id),
  transaction_id  uuid unique references public.finance_transactions(id),
  entry_date      date not null,
  memo            text,
  created_at      timestamptz not null default now()
);

create table if not exists public.journal_lines (
  id          bigint generated always as identity primary key,
  entry_id    uuid not null references public.journal_entries(id),
  account_id  uuid not null references public.ledger_accounts(id),
  fund_id     uuid references public.funds(id),
  debit       numeric(14,2) not null default 0 check (debit >= 0),
  credit      numeric(14,2) not null default 0 check (credit >= 0),
  check ((debit = 0) <> (credit = 0))
);
create index if not exists journal_lines_entry_idx on public.journal_lines (entry_id);
create index if not exists journal_lines_account_idx on public.journal_lines (account_id);

-- every journal entry must balance (checked at commit)
create or replace function public.check_journal_balanced()
returns trigger language plpgsql as $$
declare d numeric; c numeric; e uuid := coalesce(new.entry_id, old.entry_id);
begin
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from public.journal_lines where entry_id = e;
  if d <> c then
    raise exception 'Journal entry % haijalingana: debit % <> credit %', e, d, c using errcode = '23514';
  end if;
  return null;
end $$;
drop trigger if exists journal_lines_balanced on public.journal_lines;
create constraint trigger journal_lines_balanced after insert or update or delete on public.journal_lines
  deferrable initially deferred for each row execute function public.check_journal_balanced();

-- ---------------------------------------------------------------------------
-- Receipts (risiti) — transaction-safe numbering per series and year
-- ---------------------------------------------------------------------------
create table if not exists public.receipt_counters (
  parish_id  uuid not null references public.parishes(id),
  series     text not null,           -- e.g. '2026'
  last_no    bigint not null default 0,
  primary key (parish_id, series)
);

create table if not exists public.receipts (
  id              uuid primary key default gen_random_uuid(),
  parish_id       uuid not null references public.parishes(id),
  receipt_no      text not null unique,
  series          text not null,
  seq             bigint not null,
  transaction_id  uuid not null unique references public.finance_transactions(id),
  issued_at       timestamptz not null default now(),
  issued_by       uuid,
  receiving_officer text,
  payer_name      text,
  amount          numeric(14,2) not null,
  amount_words_sw text,
  amount_words_en text,
  verification_code text not null default upper(substr(md5(gen_random_uuid()::text), 1, 10)),
  status          text not null default 'valid' check (status in ('valid','void')),
  void_reason     text,
  print_count     int not null default 0,
  last_printed_at timestamptz,
  unique (parish_id, series, seq)
);

-- ---------------------------------------------------------------------------
-- Approvals (expenses and other actions needing a second person)
-- ---------------------------------------------------------------------------
create table if not exists public.approval_requests (
  id              uuid primary key default gen_random_uuid(),
  parish_id       uuid not null references public.parishes(id),
  request_type    text not null check (request_type in ('expense','reversal','adjustment','period_unlock','legacy_review')),
  transaction_id  uuid references public.finance_transactions(id),
  payload         jsonb,
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by    uuid,
  requested_at    timestamptz not null default now(),
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text
);

-- ---------------------------------------------------------------------------
-- Envelopes (bahasha): distribution is NOT income — only the linked posted
-- transaction counts.
-- ---------------------------------------------------------------------------
create table if not exists public.envelope_batches (
  id            uuid primary key default gen_random_uuid(),
  parish_id     uuid not null references public.parishes(id),
  campaign_id   uuid references public.campaigns(id),
  category_id   uuid references public.contribution_categories(id),
  name          text not null,
  issued_on     date,
  due_on        date,
  expected_amount_per_envelope numeric(14,2),
  notes         text,
  created_at    timestamptz not null default now()
);

create table if not exists public.envelopes (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references public.envelope_batches(id) on delete cascade,
  envelope_no     text not null,
  parishioner_id  uuid references public.parishioners(id),
  family_id       uuid references public.families(id),
  org_unit_id     uuid references public.org_units(id),
  expected_amount numeric(14,2),
  distributed_on  date,
  returned_on     date,
  status          text not null default 'unissued' check (status in ('unissued','distributed','returned','lost','cancelled')),
  transaction_id  uuid references public.finance_transactions(id),
  notes           text,
  unique (batch_id, envelope_no)
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ft_envelope_fk') then
    alter table public.finance_transactions add constraint ft_envelope_fk foreign key (envelope_id) references public.envelopes(id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Imports from the legacy workbook
-- ---------------------------------------------------------------------------
create table if not exists public.import_batches (
  id            uuid primary key default gen_random_uuid(),
  parish_id     uuid not null references public.parishes(id),
  source_name   text not null,
  source_sha256 text,
  status        text not null default 'preview' check (status in ('preview','approved','imported','rejected')),
  summary       jsonb,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  approved_by   uuid,
  approved_at   timestamptz
);

create table if not exists public.import_issues (
  id          bigint generated always as identity primary key,
  batch_id    uuid not null references public.import_batches(id) on delete cascade,
  severity    text not null check (severity in ('info','warning','error')),
  sheet       text,
  cell_ref    text,
  issue       text not null,
  detail      jsonb,
  resolution  text
);

-- formula-parity results (Excel vs database) kept for the reconciliation dashboard
create table if not exists public.reconciliation_results (
  id            bigint generated always as identity primary key,
  batch_id      uuid references public.import_batches(id) on delete cascade,
  sheet         text not null,
  cell_ref      text not null,
  description   text,
  excel_formula text,
  excel_value   numeric(16,2),
  system_value  numeric(16,2),
  difference    numeric(16,2) generated always as (coalesce(system_value,0) - coalesce(excel_value,0)) stored,
  status        text not null check (status in ('match','difference','excel_error','not_comparable')),
  explanation   text,
  resolution    text,
  checked_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Immutability of posted ledger rows
-- ---------------------------------------------------------------------------
create or replace function public.protect_posted_transactions()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'Muamala uliothibitishwa hauwezi kufutwa — tumia reversal' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status = 'posted' then
    -- only the reversal link may be set on a posted row
    -- (net_amount is generated: it is still NULL in NEW inside a BEFORE trigger)
    if (to_jsonb(new) - 'reversed_by_id' - 'reversal_reason' - 'net_amount')
       is distinct from (to_jsonb(old) - 'reversed_by_id' - 'reversal_reason' - 'net_amount') then
      raise exception 'Muamala uliothibitishwa hauwezi kubadilishwa — tumia reversal au adjustment' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists finance_transactions_protect on public.finance_transactions;
create trigger finance_transactions_protect before update or delete on public.finance_transactions
  for each row execute function public.protect_posted_transactions();

create or replace function public.protect_immutable()
returns trigger language plpgsql as $$
begin
  raise exception '% ni kumbukumbu za kudumu (append-only)', tg_table_name using errcode = '42501';
end $$;
do $$ declare t text; begin
  foreach t in array array['journal_lines','journal_entries','payment_allocations','audit_log'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_immutable', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.protect_immutable()', t || '_immutable', t);
  end loop;
end $$;

-- audit triggers on finance configuration tables (ledger rows are audited by the posting functions)
do $$ declare t text; begin
  foreach t in array array['financial_years','accounting_periods','funds','ledger_accounts','contribution_categories',
                           'campaigns','campaign_targets','pledges','receipts','approval_requests','envelope_batches','envelopes'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_row()', t || '_audit', t);
  end loop;
end $$;
