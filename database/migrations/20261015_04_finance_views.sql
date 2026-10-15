-- ============================================================================
-- Minga Parish Management System — migration 04: calculation engine (read side)
--   These views/functions replace the workbook's SUM / SUMIFS / VLOOKUP report
--   formulas. All are SECURITY INVOKER, so Row Level Security limits each user
--   to the communities they may see. Only status = 'posted' rows count;
--   reversals carry sign = -1 so every total nets out automatically.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Ledger with names (replaces 'MIAMALA-YOTE' VLOOKUP-by-receipt sheet)
-- ---------------------------------------------------------------------------
create or replace view public.v_ledger with (security_invoker = true) as
select t.id, t.txn_no, t.parish_id, t.kind, t.sign, t.amount, t.net_amount, t.status, t.txn_date,
       fy.label as financial_year, t.period_month,
       t.category_id, c.code as category_code, c.name_sw as category_name, c.kind as category_kind,
       t.campaign_id, cp.name as campaign_name, cp.campaign_year,
       t.pledge_id, t.fund_id, f.name as fund_name, t.money_account_id, a.name as money_account_name,
       t.parishioner_id, t.family_id, fam.family_name, t.org_unit_id, ou.name as org_unit_name,
       t.jumuiya_id, j.name as jumuiya_name, t.kigango_id, k.name as kigango_name,
       t.payer_name, t.payment_method, t.reference_no, t.description,
       t.reverses_id, t.reversed_by_id, t.reversal_reason,
       r.receipt_no, r.status as receipt_status, t.legacy_receipt_no,
       t.recorded_by, t.approved_by, t.posted_at, t.created_at, t.event_id, t.envelope_id
from public.finance_transactions t
join public.financial_years fy on fy.id = t.financial_year_id
join public.contribution_categories c on c.id = t.category_id
left join public.campaigns cp on cp.id = t.campaign_id
left join public.funds f on f.id = t.fund_id
left join public.ledger_accounts a on a.id = t.money_account_id
left join public.families fam on fam.id = t.family_id
left join public.org_units ou on ou.id = t.org_unit_id
left join public.org_units j on j.id = t.jumuiya_id
left join public.org_units k on k.id = t.kigango_id
left join public.receipts r on r.transaction_id = t.id;

-- ---------------------------------------------------------------------------
-- Pledge balances (replaces PANGIWA / TOA / BADO-ZIADA / % columns)
--   received    = payments applied to the pledge (reversals subtract)
--   paid        = part of received that counts against the pledge (≤ pledge)
--   outstanding = pledge − paid, never negative
--   excess      = received above the pledge, shown separately (never as negative debt)
-- ---------------------------------------------------------------------------
create or replace view public.v_pledge_balances with (security_invoker = true) as
select pl.id as pledge_id, pl.parish_id, pl.campaign_id, cp.name as campaign_name, cp.campaign_year,
       cp.category_id, c.code as category_code, c.name_sw as category_name,
       pl.parishioner_id, pr.full_name as parishioner_name, pl.family_id, fam.family_name,
       pl.org_unit_id, ou.name as org_unit_name,
       coalesce(pl.jumuiya_id, ou.id) as jumuiya_id, pl.kigango_id,
       pl.amount as pledged, pl.status, pl.pledged_on, pl.due_on, pl.carried_from_id,
       coalesce(x.received, 0) as received,
       least(coalesce(x.received, 0), pl.amount) as paid,
       case when pl.status = 'active' then greatest(pl.amount - coalesce(x.received, 0), 0) else 0 end as outstanding,
       greatest(coalesce(x.received, 0) - pl.amount, 0) as excess,
       round(least(coalesce(x.received, 0) / pl.amount, 1) * 100, 2) as completion_pct,
       x.payment_count, x.last_payment_on,
       (pl.status = 'active' and pl.due_on is not null and pl.due_on < current_date
        and coalesce(x.received, 0) < pl.amount) as is_overdue
from public.pledges pl
join public.campaigns cp on cp.id = pl.campaign_id
join public.contribution_categories c on c.id = cp.category_id
left join public.parishioners pr on pr.id = pl.parishioner_id
left join public.families fam on fam.id = pl.family_id
left join public.org_units ou on ou.id = pl.org_unit_id
left join lateral (
  select sum(a.amount * t.sign) as received,
         count(*) filter (where t.sign = 1) - count(*) filter (where t.sign = -1) as payment_count,
         max(t.txn_date) filter (where t.sign = 1) as last_payment_on
  from public.payment_allocations a
  join public.finance_transactions t on t.id = a.transaction_id and t.status = 'posted'
  where a.pledge_id = pl.id
) x on true
where pl.status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- Campaign progress (whole campaign)
-- ---------------------------------------------------------------------------
create or replace view public.v_campaign_progress with (security_invoker = true) as
select cp.id as campaign_id, cp.parish_id, cp.name, cp.campaign_year, cp.status, cp.starts_on, cp.ends_on,
       c.id as category_id, c.code as category_code, c.name_sw as category_name, c.kind as category_kind,
       coalesce(cp.target_amount, tg.target_total, 0) as target,
       coalesce(pb.pledged, 0) as pledged,
       coalesce(pb.outstanding, 0) as outstanding_pledges,
       coalesce(pb.excess, 0) as pledge_excess,
       coalesce(col.collected, 0) as collected,
       coalesce(col.payers, 0) as payers,
       case when coalesce(cp.target_amount, tg.target_total, 0) > 0
            then round(coalesce(col.collected, 0) / coalesce(cp.target_amount, tg.target_total) * 100, 2) end as target_pct
from public.campaigns cp
join public.contribution_categories c on c.id = cp.category_id
left join (select campaign_id, sum(target_amount) as target_total from public.campaign_targets group by campaign_id) tg
       on tg.campaign_id = cp.id
left join (select campaign_id, sum(pledged) as pledged, sum(outstanding) as outstanding, sum(excess) as excess
           from public.v_pledge_balances where status = 'active' group by campaign_id) pb on pb.campaign_id = cp.id
left join (select campaign_id, sum(net_amount) as collected,
                  count(distinct coalesce(parishioner_id::text, family_id::text, org_unit_id::text, lower(payer_name))) as payers
           from public.finance_transactions where status = 'posted' and kind = 'income' group by campaign_id) col
       on col.campaign_id = cp.id;

-- ---------------------------------------------------------------------------
-- Campaign progress per community (replaces RIPORT YA MAVUNO / UJENZI,
-- REPT JUMUIYA…, VIGAN-… report sheets and the ledger's K/L/N/O columns:
--   WALICHOPANGIWA (target) · WALICHOTOA (collected) · KIASI BADO · % YA UTOAJI)
-- p_level: 'jumuiya' or 'kigango'
-- ---------------------------------------------------------------------------
create or replace function public.campaign_org_progress(p_campaign uuid, p_level text default 'jumuiya')
returns table (org_unit_id uuid, org_unit_name text, kigango_name text, target numeric, pledged numeric,
               collected numeric, balance numeric, excess numeric, pct numeric, payers bigint)
language sql stable set search_path = public as $$
  with units as (
    select o.id, o.name, k.name as kname
    from public.org_units o
    left join public.org_units k on k.id = public.org_ancestor_of_type(o.id, 'kigango')
    where o.unit_type = p_level or (p_level = 'jumuiya' and o.unit_type = 'group')
  ),
  tgt as (
    select case when p_level = 'kigango' then public.org_ancestor_of_type(ct.org_unit_id, 'kigango') else ct.org_unit_id end as uid,
           sum(ct.target_amount) as target
    from public.campaign_targets ct where ct.campaign_id = p_campaign group by 1
  ),
  col as (
    select case when p_level = 'kigango' then t.kigango_id else coalesce(t.jumuiya_id, t.org_unit_id) end as uid,
           sum(t.net_amount) as collected,
           count(distinct coalesce(t.parishioner_id::text, t.family_id::text, lower(t.payer_name))) as payers
    from public.finance_transactions t
    where t.campaign_id = p_campaign and t.status = 'posted' and t.kind = 'income'
    group by 1
  ),
  pld as (
    select case when p_level = 'kigango' then b.kigango_id else b.jumuiya_id end as uid, sum(b.pledged) as pledged
    from public.v_pledge_balances b where b.campaign_id = p_campaign and b.status = 'active' group by 1
  )
  select u.id, u.name, u.kname,
         coalesce(tgt.target, 0), coalesce(pld.pledged, 0), coalesce(col.collected, 0),
         greatest(coalesce(tgt.target, 0) - coalesce(col.collected, 0), 0),
         greatest(coalesce(col.collected, 0) - coalesce(tgt.target, 0), 0),
         case when coalesce(tgt.target, 0) > 0 then round(coalesce(col.collected, 0) / tgt.target * 100, 2) end,
         coalesce(col.payers, 0)
  from units u
  left join tgt on tgt.uid = u.id
  left join col on col.uid = u.id
  left join pld on pld.uid = u.id
  where tgt.uid is not null or col.uid is not null or pld.uid is not null
  order by u.kname nulls first, u.name
$$;

-- ---------------------------------------------------------------------------
-- SUMIFS engine: totals by community level, category and period
--   p_level: 'parish' | 'kigango' | 'jumuiya' | 'family' | 'parishioner'
-- ---------------------------------------------------------------------------
create or replace function public.contribution_totals(
  p_from date, p_to date, p_level text default 'jumuiya',
  p_category uuid default null, p_campaign uuid default null, p_scope uuid default null)
returns table (group_id uuid, group_name text, category_id uuid, category_name text,
               total numeric, payments bigint, reversals bigint)
language sql stable set search_path = public as $$
  select case p_level when 'parish' then t.parish_id when 'kigango' then t.kigango_id
                      when 'jumuiya' then coalesce(t.jumuiya_id, t.org_unit_id)
                      when 'family' then t.family_id else t.parishioner_id end,
         case p_level when 'parish' then (select official_name from public.parishes where id = t.parish_id)
                      when 'kigango' then (select name from public.org_units where id = t.kigango_id)
                      when 'jumuiya' then (select name from public.org_units where id = coalesce(t.jumuiya_id, t.org_unit_id))
                      when 'family' then (select family_name from public.families where id = t.family_id)
                      else (select full_name from public.parishioners where id = t.parishioner_id) end,
         t.category_id, c.name_sw,
         sum(t.net_amount), count(*) filter (where t.sign = 1), count(*) filter (where t.sign = -1)
  from public.finance_transactions t
  join public.contribution_categories c on c.id = t.category_id
  where t.status = 'posted' and t.kind = 'income'
    and t.txn_date between p_from and p_to
    and (p_category is null or t.category_id = p_category)
    and (p_campaign is null or t.campaign_id = p_campaign)
    and (case when p_scope is null then true else public.org_is_within(coalesce(t.org_unit_id, t.jumuiya_id), p_scope) end)
  group by 1, 2, 3, 4
  order by 2, 4
$$;

-- monthly totals for a year (dashboard trend, MONTHLY / ANNUAL collection reports)
create or replace function public.monthly_totals(p_year int, p_scope uuid default null)
returns table (month date, income numeric, expense numeric, zaka numeric, mavuno numeric, ujenzi numeric,
               sadaka numeric, special numeric, other numeric)
language sql stable set search_path = public as $$
  with m as (select generate_series(make_date(p_year,1,1), make_date(p_year,12,1), interval '1 month')::date as month)
  select m.month,
    coalesce(sum(t.net_amount) filter (where t.kind = 'income'), 0),
    coalesce(sum(t.net_amount) filter (where t.kind = 'expense'), 0),
    coalesce(sum(t.net_amount) filter (where t.kind = 'income' and c.kind = 'zaka'), 0),
    coalesce(sum(t.net_amount) filter (where t.kind = 'income' and c.kind = 'mavuno'), 0),
    coalesce(sum(t.net_amount) filter (where t.kind = 'income' and c.kind = 'ujenzi'), 0),
    coalesce(sum(t.net_amount) filter (where t.kind = 'income' and c.kind = 'sadaka'), 0),
    coalesce(sum(t.net_amount) filter (where t.kind = 'income' and c.kind in ('special','shukrani')), 0),
    coalesce(sum(t.net_amount) filter (where t.kind = 'income' and c.kind = 'income_other'), 0)
  from m
  left join public.finance_transactions t
    on t.status = 'posted' and date_trunc('month', t.txn_date)::date = m.month
   and (case when p_scope is null then true else public.org_is_within(coalesce(t.org_unit_id, t.jumuiya_id), p_scope) end)
  left join public.contribution_categories c on c.id = t.category_id
  group by m.month order by m.month
$$;

-- ---------------------------------------------------------------------------
-- ZAKA: January–December grid per person / family / community
--   (replaces PAROKIA DATA BASE columns Q…BL and the BM/BN/BO/BP counters —
--    with the legacy month-count bugs fixed, see FORMULA_MAPPING.md)
-- ---------------------------------------------------------------------------
create or replace function public.zaka_grid(p_year int, p_level text default 'parishioner', p_scope uuid default null)
returns table (group_id uuid, group_name text, jumuiya_name text,
               m01 numeric, m02 numeric, m03 numeric, m04 numeric, m05 numeric, m06 numeric,
               m07 numeric, m08 numeric, m09 numeric, m10 numeric, m11 numeric, m12 numeric,
               total numeric, months_paid int, months_unpaid int)
language sql stable set search_path = public as $$
  with z as (
    select case p_level when 'parishioner' then t.parishioner_id when 'family' then t.family_id
                        when 'jumuiya' then t.jumuiya_id else t.kigango_id end as gid,
           extract(month from t.period_month)::int as m, sum(t.net_amount) as amt
    from public.finance_transactions t
    join public.contribution_categories c on c.id = t.category_id and c.kind = 'zaka'
    where t.status = 'posted' and t.kind = 'income'
      and t.period_month >= make_date(p_year, 1, 1) and t.period_month < make_date(p_year + 1, 1, 1)
      and (case when p_scope is null then true else public.org_is_within(coalesce(t.org_unit_id, t.jumuiya_id), p_scope) end)
    group by 1, 2
  ),
  -- months elapsed in the year (a month not yet reached is not "unpaid")
  lim as (select case when p_year < extract(year from current_date) then 12
                      when p_year > extract(year from current_date) then 0
                      else extract(month from current_date)::int end as months)
  select z.gid,
         case p_level when 'parishioner' then (select full_name from public.parishioners where id = z.gid)
                      when 'family' then (select family_name from public.families where id = z.gid)
                      else (select name from public.org_units where id = z.gid) end,
         case p_level when 'parishioner' then (select o.name from public.parishioners p join public.org_units o on o.id = p.jumuiya_id where p.id = z.gid)
                      when 'family' then (select o.name from public.families f join public.org_units o on o.id = f.jumuiya_id where f.id = z.gid)
                      else null end,
         sum(amt) filter (where m = 1), sum(amt) filter (where m = 2), sum(amt) filter (where m = 3),
         sum(amt) filter (where m = 4), sum(amt) filter (where m = 5), sum(amt) filter (where m = 6),
         sum(amt) filter (where m = 7), sum(amt) filter (where m = 8), sum(amt) filter (where m = 9),
         sum(amt) filter (where m = 10), sum(amt) filter (where m = 11), sum(amt) filter (where m = 12),
         sum(amt),
         (count(*) filter (where amt > 0))::int,
         greatest((select months from lim) - (count(*) filter (where amt > 0 and m <= (select months from lim)))::int, 0)
  from z
  group by z.gid
  order by 3 nulls last, 2
$$;

-- ---------------------------------------------------------------------------
-- Accounting views
-- ---------------------------------------------------------------------------
create or replace view public.v_account_balances with (security_invoker = true) as
select a.id as account_id, a.parish_id, a.code, a.name, a.account_type, a.money_kind,
       coalesce(sum(l.debit), 0) as total_debit, coalesce(sum(l.credit), 0) as total_credit,
       case when a.account_type in ('asset','expense') then coalesce(sum(l.debit) - sum(l.credit), 0)
            else coalesce(sum(l.credit) - sum(l.debit), 0) end as balance
from public.ledger_accounts a
left join public.journal_lines l on l.account_id = a.id
group by a.id;

create or replace view public.v_fund_balances with (security_invoker = true) as
select f.id as fund_id, f.parish_id, f.code, f.name, f.is_restricted,
       coalesce(sum(t.net_amount) filter (where t.kind = 'income'), 0) as income,
       coalesce(sum(t.net_amount) filter (where t.kind = 'expense'), 0) as expenses,
       coalesce(sum(t.net_amount) filter (where t.kind = 'income'), 0)
       - coalesce(sum(t.net_amount) filter (where t.kind = 'expense'), 0) as balance
from public.funds f
left join public.finance_transactions t on t.fund_id = f.id and t.status = 'posted'
group by f.id;

-- cashbook with opening balance and running balance for one money account
create or replace function public.cashbook(p_account uuid, p_from date, p_to date)
returns table (txn_date date, txn_no bigint, receipt_no text, description text, payer text,
               money_in numeric, money_out numeric, balance numeric)
language sql stable set search_path = public as $$
  with mv as (
    select t.txn_date, t.txn_no, r.receipt_no,
           coalesce(t.description, c.name_sw) as description, t.payer_name,
           case when (t.kind in ('income','opening_balance','adjustment') and t.money_account_id = p_account)
                  or (t.kind = 'transfer' and t.to_account_id = p_account) then t.net_amount else 0 end as money_in,
           case when (t.kind = 'expense' and t.money_account_id = p_account)
                  or (t.kind = 'transfer' and t.money_account_id = p_account) then t.net_amount else 0 end as money_out
    from public.finance_transactions t
    join public.contribution_categories c on c.id = t.category_id
    left join public.receipts r on r.transaction_id = t.id
    where t.status = 'posted' and (t.money_account_id = p_account or t.to_account_id = p_account)
  ),
  opening as (select coalesce(sum(money_in - money_out), 0) as bal from mv where txn_date < p_from)
  select null::date, null::bigint, null::text, 'SALIO LA KUANZIA (opening balance)', null::text, null::numeric, null::numeric,
         (select bal from opening)
  union all
  select txn_date, txn_no, receipt_no, description, payer_name, money_in, money_out,
         (select bal from opening) + sum(money_in - money_out) over (order by txn_date, txn_no)
  from mv where txn_date between p_from and p_to
$$;

create or replace view public.v_receipt_register with (security_invoker = true) as
select r.id, r.receipt_no, r.series, r.seq, r.issued_at, r.status, r.void_reason, r.print_count,
       r.payer_name, r.amount, r.amount_words_sw, r.receiving_officer,
       t.txn_no, t.txn_date, t.payment_method, t.reference_no, c.name_sw as category_name,
       j.name as jumuiya_name, k.name as kigango_name, t.parishioner_id, t.family_id, t.jumuiya_id, t.kigango_id
from public.receipts r
join public.finance_transactions t on t.id = r.transaction_id
join public.contribution_categories c on c.id = t.category_id
left join public.org_units j on j.id = t.jumuiya_id
left join public.org_units k on k.id = t.kigango_id;

-- ---------------------------------------------------------------------------
-- Integrity / reconciliation checks (Uhakiki wa Fedha)
-- ---------------------------------------------------------------------------
create or replace function public.finance_integrity_checks()
returns table (check_code text, description text, problem_count bigint, ok boolean)
language sql stable set search_path = public as $$
  with checks as (
    select 'posted_without_journal' as code, 'Miamala iliyothibitishwa bila journal' as d,
           (select count(*) from public.finance_transactions t where t.status = 'posted'
              and not exists (select 1 from public.journal_entries e where e.transaction_id = t.id)) as n
    union all
    select 'unbalanced_journal', 'Journal zisizolingana (debit ≠ credit)',
           (select count(*) from (select entry_id from public.journal_lines group by entry_id having sum(debit) <> sum(credit)) x)
    union all
    select 'journal_amount_mismatch', 'Journal ≠ kiasi cha muamala',
           (select count(*) from public.finance_transactions t join public.journal_entries e on e.transaction_id = t.id
             where (select sum(debit) from public.journal_lines l where l.entry_id = e.id) <> t.amount)
    union all
    select 'income_without_receipt', 'Mapato yasiyo na risiti (mbali na kumbukumbu za zamani)',
           (select count(*) from public.finance_transactions t where t.status = 'posted' and t.kind = 'income' and t.sign = 1
              and t.import_batch_id is null and not exists (select 1 from public.receipts r where r.transaction_id = t.id))
    union all
    select 'allocation_exceeds_payment', 'Mgawanyo unaozidi kiasi cha malipo',
           (select count(*) from (select a.transaction_id from public.payment_allocations a join public.finance_transactions t on t.id = a.transaction_id
              group by a.transaction_id, t.amount having sum(a.amount) > t.amount) x)
    union all
    select 'reversal_link_broken', 'Reversal zisizo na kiungo sahihi',
           (select count(*) from public.finance_transactions o where o.reversed_by_id is not null
              and not exists (select 1 from public.finance_transactions r where r.id = o.reversed_by_id and r.reverses_id = o.id and r.amount = o.amount))
    union all
    select 'pending_expenses', 'Matumizi yanayosubiri idhini',
           (select count(*) from public.finance_transactions where status = 'pending')
    union all
    select 'ledger_vs_accounts', 'Jumla ya mapato (ledger) ≠ jumla ya akaunti za mapato',
           (select case when abs(coalesce((select sum(net_amount) from public.finance_transactions where status = 'posted' and kind = 'income'),0)
                   - coalesce((select sum(l.credit - l.debit) from public.journal_lines l join public.ledger_accounts a on a.id = l.account_id and a.account_type = 'income'),0)) < 0.005
                   then 0 else 1 end)
  )
  select code, d, n, n = 0 or code = 'pending_expenses' from checks
$$;

-- ---------------------------------------------------------------------------
-- Dashboard summary (one round trip for the finance dashboard)
-- ---------------------------------------------------------------------------
create or replace function public.parish_dashboard(p_year int default extract(year from current_date)::int, p_scope uuid default null)
returns jsonb language sql stable set search_path = public as $$
  with t as (
    select t.*, c.kind as ck from public.finance_transactions t join public.contribution_categories c on c.id = t.category_id
    where t.status = 'posted'
      and (case when p_scope is null then true else public.org_is_within(coalesce(t.org_unit_id, t.jumuiya_id), p_scope) end)
  ),
  y as (select * from t where extract(year from txn_date) = p_year)
  select jsonb_build_object(
    'year', p_year,
    'counts', jsonb_build_object(
       'parishioners', (select count(*) from public.parishioners where membership_status = 'active'
                          and (case when p_scope is null then true else public.org_is_within(jumuiya_id, p_scope) end)),
       'families', (select count(*) from public.families where status = 'active'
                          and (case when p_scope is null then true else public.org_is_within(jumuiya_id, p_scope) end)),
       'jumuiya', (select count(*) from public.org_units where unit_type = 'jumuiya' and is_active
                          and (case when p_scope is null then true else public.org_is_within(id, p_scope) end)),
       'vigango', (select count(*) from public.org_units where unit_type = 'kigango' and is_active
                          and (case when p_scope is null then true else public.org_is_within(id, p_scope) end))),
    'totals', jsonb_build_object(
       'income_year', coalesce((select sum(net_amount) from y where kind = 'income'), 0),
       'income_month', coalesce((select sum(net_amount) from y where kind = 'income'
                                  and date_trunc('month', txn_date) = date_trunc('month', current_date)), 0),
       'expenses_year', coalesce((select sum(net_amount) from y where kind = 'expense'), 0),
       'zaka', coalesce((select sum(net_amount) from y where kind = 'income' and ck = 'zaka'), 0),
       'mavuno', coalesce((select sum(net_amount) from y where kind = 'income' and ck = 'mavuno'), 0),
       'ujenzi', coalesce((select sum(net_amount) from y where kind = 'income' and ck = 'ujenzi'), 0),
       'sadaka', coalesce((select sum(net_amount) from y where kind = 'income' and ck = 'sadaka'), 0),
       'special', coalesce((select sum(net_amount) from y where kind = 'income' and ck in ('special','shukrani')), 0),
       'outstanding_pledges', coalesce((select sum(outstanding) from public.v_pledge_balances b where b.status = 'active'
                                        and (case when p_scope is null then true else public.org_is_within(b.jumuiya_id, p_scope) end)), 0),
       'cash_available', coalesce((select sum(net_amount) filter (where kind in ('income','opening_balance','adjustment'))
                                   - coalesce(sum(net_amount) filter (where kind = 'expense'), 0) from t), 0)),
    'monthly', (select jsonb_agg(to_jsonb(m) order by m.month) from public.monthly_totals(p_year, p_scope) m),
    'campaigns', (select jsonb_agg(to_jsonb(v) order by v.collected desc) from public.v_campaign_progress v
                   where v.campaign_year = p_year and p_scope is null),
    'recent', (select jsonb_agg(x) from (select txn_no, txn_date, payer_name, category_name, net_amount,
                                                 coalesce(receipt_no, 'Excel #' || legacy_receipt_no) as receipt_no,
                                                 coalesce(jumuiya_name, org_unit_name, kigango_name) as jumuiya_name
                                          from public.v_ledger l where l.status = 'posted' and l.txn_date <= current_date
                                            and (case when p_scope is null then true else public.org_is_within(coalesce(l.org_unit_id, l.jumuiya_id), p_scope) end)
                                          order by l.txn_date desc, l.txn_no desc limit 10) x),
    'alerts', (select jsonb_agg(to_jsonb(c)) from public.finance_integrity_checks() c where not c.ok)
  )
$$;
