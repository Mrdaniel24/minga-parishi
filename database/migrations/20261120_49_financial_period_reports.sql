-- Periodic income and expense statements with approved budgets and reasons.
create table if not exists public.financial_period_budgets (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id),
  org_unit_id uuid references public.org_units(id),
  period_start date not null,
  period_end date not null,
  category_id uuid not null references public.contribution_categories(id),
  budget_amount numeric(14,2) not null default 0 check (budget_amount >= 0),
  variance_reason text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (parish_id,org_unit_id,period_start,period_end,category_id)
);
create unique index if not exists financial_period_budgets_scope_unique
  on public.financial_period_budgets(parish_id,org_unit_id,period_start,period_end,category_id) nulls not distinct;
alter table public.financial_period_budgets enable row level security;
drop policy if exists financial_period_budgets_read on public.financial_period_budgets;
create policy financial_period_budgets_read on public.financial_period_budgets for select to authenticated
  using (public.has_perm('finance.read') or public.has_perm('finance.read',org_unit_id));
revoke all on public.financial_period_budgets from anon,authenticated;
grant select on public.financial_period_budgets to authenticated;

create or replace function public.save_financial_period_budget(p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_parish uuid := public.default_parish_id();
  v_unit uuid := nullif(p->>'org_unit_id','')::uuid;
  v_start date := (p->>'period_start')::date;
  v_end date := (p->>'period_end')::date;
  v_category uuid := (p->>'category_id')::uuid;
  v_amount numeric(14,2) := round((p->>'budget_amount')::numeric,2);
  v_reason text := nullif(btrim(p->>'variance_reason'),'');
begin
  if auth.uid() is null or not public.has_perm('finance.configure',v_unit) then
    raise exception 'Huna ruhusa ya kuweka bajeti ya kipindi hiki' using errcode='42501';
  end if;
  if v_start is null or v_end is null or v_end<v_start or v_amount is null or v_amount<0 then
    raise exception 'Tarehe au kiasi cha bajeti si sahihi' using errcode='P0001';
  end if;
  if v_unit is not null and not exists(select 1 from public.org_units where id=v_unit and parish_id=v_parish and is_active and unit_type in ('parish','kigango','jumuiya')) then
    raise exception 'Eneo la ripoti si sahihi' using errcode='P0001';
  end if;
  if not exists(select 1 from public.contribution_categories where id=v_category and parish_id=v_parish and is_active and kind in ('expense','zaka','mavuno','ujenzi','sadaka','special','shukrani','income_other')) then
    raise exception 'Aina ya mapato au matumizi si sahihi' using errcode='P0001';
  end if;
  insert into public.financial_period_budgets(parish_id,org_unit_id,period_start,period_end,category_id,budget_amount,variance_reason,updated_by,updated_at)
  values(v_parish,v_unit,v_start,v_end,v_category,v_amount,v_reason,auth.uid(),now())
  on conflict (parish_id,org_unit_id,period_start,period_end,category_id) do update set
    budget_amount=excluded.budget_amount,variance_reason=excluded.variance_reason,updated_by=excluded.updated_by,updated_at=now();
  insert into public.audit_log(actor_id,action,table_name,row_id,new_data)
  values(auth.uid(),'save_financial_period_budget','financial_period_budgets',v_category::text,
    jsonb_build_object('org_unit_id',v_unit,'period_start',v_start,'period_end',v_end,'category_id',v_category,'budget_amount',v_amount,'variance_reason',v_reason));
  return jsonb_build_object('status','saved');
end $$;
revoke all on function public.save_financial_period_budget(jsonb) from public,anon;
grant execute on function public.save_financial_period_budget(jsonb) to authenticated;

create or replace function public.financial_period_report(p_from date,p_to date,p_scope uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_parish uuid := public.default_parish_id();
  v_opening numeric(14,2);
  v_income numeric(14,2);
  v_expense numeric(14,2);
  v_adjustment numeric(14,2);
  v_lines jsonb;
begin
  if auth.uid() is null or not public.has_perm('finance.read',p_scope) then
    raise exception 'Huna ruhusa ya kusoma ripoti hii' using errcode='42501';
  end if;
  if p_from is null or p_to is null or p_to<p_from then raise exception 'Kipindi cha ripoti si sahihi' using errcode='P0001'; end if;
  if p_scope is not null and not exists(select 1 from public.org_units where id=p_scope and parish_id=v_parish and is_active) then
    raise exception 'Eneo la ripoti si sahihi' using errcode='P0001';
  end if;
  select coalesce(sum(case when ft.kind='income' then ft.net_amount when ft.kind='expense' then -ft.net_amount
                           when ft.kind in ('opening_balance','adjustment') then ft.net_amount else 0 end),0)
    into v_opening from public.finance_transactions ft where ft.parish_id=v_parish and ft.status='posted' and ft.txn_date<p_from
      and (p_scope is null or coalesce(ft.org_unit_id,ft.jumuiya_id,ft.kigango_id)=any(public.units_within(p_scope)));
  select coalesce(sum(ft.net_amount) filter(where ft.kind='income'),0),coalesce(sum(ft.net_amount) filter(where ft.kind='expense'),0),
    coalesce(sum(ft.net_amount) filter(where ft.kind='adjustment'),0)
    into v_income,v_expense,v_adjustment from public.finance_transactions ft where ft.parish_id=v_parish and ft.status='posted'
      and ft.txn_date between p_from and p_to
      and (p_scope is null or coalesce(ft.org_unit_id,ft.jumuiya_id,ft.kigango_id)=any(public.units_within(p_scope)));
  with actuals as (
    select t.category_id,sum(t.net_amount) as actual_amount from public.finance_transactions t
    where t.parish_id=v_parish and t.status='posted' and t.txn_date between p_from and p_to
      and t.kind in ('income','expense')
      and (p_scope is null or coalesce(t.org_unit_id,t.jumuiya_id,t.kigango_id)=any(public.units_within(p_scope)))
    group by t.category_id
  ), budgets as (
    select b.category_id,sum(b.budget_amount) as budget_amount,string_agg(nullif(b.variance_reason,''),'; ' order by b.updated_at desc) as variance_reason
    from public.financial_period_budgets b where b.parish_id=v_parish and b.period_start=p_from and b.period_end=p_to
      and (b.org_unit_id is not distinct from p_scope or (p_scope is not null and b.org_unit_id is null and not exists(
        select 1 from public.financial_period_budgets exact_scope where exact_scope.parish_id=v_parish and exact_scope.org_unit_id=p_scope
          and exact_scope.period_start=p_from and exact_scope.period_end=p_to and exact_scope.category_id=b.category_id)))
    group by b.category_id
  ), ids as (
    select id as category_id from public.contribution_categories where parish_id=v_parish and is_active and code<>'TRANSFER'
    union select category_id from actuals
    union select category_id from budgets
  )
  select coalesce(jsonb_agg(jsonb_build_object('category_id',i.category_id,'code',c.code,'name',c.name_sw,'kind',c.kind,
      'budget_amount',coalesce(b.budget_amount,0),'actual_amount',coalesce(a.actual_amount,0),
      'variance_amount',coalesce(a.actual_amount,0)-coalesce(b.budget_amount,0),'variance_reason',b.variance_reason)
      order by c.kind,c.sort_order,c.name_sw),'[]'::jsonb)
    into v_lines from ids i join public.contribution_categories c on c.id=i.category_id
    left join actuals a on a.category_id=i.category_id left join budgets b on b.category_id=i.category_id;
  return jsonb_build_object('period_start',p_from,'period_end',p_to,'opening_balance',v_opening,
    'income_total',v_income,'expense_total',v_expense,'adjustment_total',v_adjustment,
    'closing_balance',v_opening+v_income-v_expense+v_adjustment,'lines',v_lines);
end $$;
revoke all on function public.financial_period_report(date,date,uuid) from public,anon;
grant execute on function public.financial_period_report(date,date,uuid) to authenticated;
notify pgrst,'reload schema';
