-- ============================================================================
-- Minga Parish Management System — migration 35: keep dashboard details in year
--   The dashboard's recent payments and outstanding pledges follow its selected
--   year, just like its annual reports. Cash available remains a live balance.
-- ============================================================================

create or replace function public.parish_dashboard(p_year int default extract(year from current_date)::int, p_scope uuid default null)
returns jsonb language sql stable set search_path = public as $$
  with t as (
    select t.*, c.kind as ck from public.finance_transactions t join public.contribution_categories c on c.id = t.category_id
    where t.status = 'posted'
      and (case when p_scope is null then true else coalesce(t.org_unit_id, t.jumuiya_id) = any ((select public.units_within(p_scope))::uuid[]) end)
  ),
  y as (select * from t where extract(year from txn_date) = p_year)
  select jsonb_build_object(
    'year', p_year,
    'counts', jsonb_build_object(
       'parishioners', (select count(*) from public.parishioners where membership_status = 'active'
                          and (case when p_scope is null then true else jumuiya_id = any ((select public.units_within(p_scope))::uuid[]) end)),
       'families', (select count(*) from public.families where status = 'active'
                          and (case when p_scope is null then true else jumuiya_id = any ((select public.units_within(p_scope))::uuid[]) end)),
       'jumuiya', (select count(*) from public.org_units where unit_type = 'jumuiya' and is_active
                          and (case when p_scope is null then true else id = any ((select public.units_within(p_scope))::uuid[]) end)),
       'vigango', (select count(*) from public.org_units where unit_type = 'kigango' and is_active
                          and (case when p_scope is null then true else id = any ((select public.units_within(p_scope))::uuid[]) end))),
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
                                        and b.campaign_year = p_year
                                        and (case when p_scope is null then true else b.jumuiya_id = any ((select public.units_within(p_scope))::uuid[]) end)), 0),
       'cash_available', coalesce((select sum(net_amount) filter (where kind in ('income','opening_balance','adjustment'))
                                   - coalesce(sum(net_amount) filter (where kind = 'expense'), 0) from t), 0)),
    'monthly', (select jsonb_agg(to_jsonb(m) order by m.month) from public.monthly_totals(p_year, p_scope) m),
    'campaigns', (select jsonb_agg(to_jsonb(v) order by v.collected desc) from public.v_campaign_progress v
                   where v.campaign_year = p_year and p_scope is null),
    'recent', (select jsonb_agg(x) from (select txn_no, txn_date, payer_name, category_name, net_amount,
                                                 coalesce(receipt_no, 'Excel #' || legacy_receipt_no) as receipt_no,
                                                 coalesce(jumuiya_name, org_unit_name, kigango_name) as jumuiya_name
                                          from public.v_ledger l where l.status = 'posted' and l.txn_date <= current_date
                                            and extract(year from l.txn_date) = p_year
                                            and (case when p_scope is null then true else coalesce(l.org_unit_id, l.jumuiya_id) = any ((select public.units_within(p_scope))::uuid[]) end)
                                          order by l.txn_date desc, l.txn_no desc limit 10) x),
    'alerts', public.dashboard_alerts()
  )
$$;

notify pgrst, 'reload schema';

