-- ============================================================================
-- Minga Parish Management System — migration 14: what a jumuiya / kigango is
-- assigned (kupangiwa) and how far it has paid, the way the workbook works:
--   * Zaka                       → per muumini, every month
--   * Mavuno / Ujenzi            → per familia (PANGIWA → TOA → BADO)
--   * michango maalumu (Posho ya Makatekista, Radio Maria, …) → the jumuiya is
--     given an amount (the 2026 MALENGO sheet) and pays it; the % is computed.
-- A jumuiya (or the parish for it) records an assignment: which contribution,
-- how much, from when and by when. unit_contributions() returns, for one
-- jumuiya or kigango and one year, every contribution it owes or has paid.
-- ============================================================================

alter table public.campaign_targets add column if not exists starts_on  date;
alter table public.campaign_targets add column if not exists due_on     date;
alter table public.campaign_targets add column if not exists created_by uuid;
alter table public.campaign_targets add column if not exists created_at timestamptz not null default now();

-- contribution types that are only headings in the workbook (no money ever
-- recorded) are switched off: hidden everywhere, can be switched on in Settings
update public.contribution_categories c set is_active = false
 where c.code in ('KAPU_LA_MAMA', 'RAFIKI_WA_PAPA') and c.is_active
   and not exists (select 1 from public.finance_transactions t where t.category_id = c.id);

-- ---------------------------------------------------------------------------
-- set_unit_target: give a jumuiya / kigango an amount for one contribution
--   p = { org_unit_id, campaign_id | (category_id, year, name), amount,
--         starts_on, due_on, notes }
--   amount 0 / null removes the assignment (only while nothing is paid).
-- ---------------------------------------------------------------------------
create or replace function public.set_unit_target(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_unit public.org_units; v_cat public.contribution_categories; v_camp public.campaigns;
  v_year int; v_name text; v_amount numeric; v_id uuid; v_old public.campaign_targets;
begin
  select * into v_unit from public.org_units where id = (p->>'org_unit_id')::uuid;
  if v_unit.id is null or v_unit.unit_type not in ('jumuiya', 'kigango', 'group') then
    raise exception 'Chagua jumuiya au kigango' using errcode = 'P0001';
  end if;
  if not public.has_perm('finance.pledge', v_unit.id) then
    raise exception 'Huna ruhusa ya kupangia michango kwa %', v_unit.name using errcode = '42501';
  end if;
  if p->>'campaign_id' is not null then
    select * into v_camp from public.campaigns where id = (p->>'campaign_id')::uuid and parish_id = v_unit.parish_id;
    if v_camp.id is null then raise exception 'Mchango haupo' using errcode = 'P0001'; end if;
  else
    select * into v_cat from public.contribution_categories where id = (p->>'category_id')::uuid and parish_id = v_unit.parish_id;
    if v_cat.id is null or v_cat.kind in ('zaka', 'expense') then raise exception 'Chagua aina ya mchango' using errcode = 'P0001'; end if;
    v_year := coalesce((p->>'year')::int, extract(year from current_date)::int);
    v_name := coalesce(nullif(trim(p->>'name'), ''), v_cat.name_sw || ' ' || v_year);
    select * into v_camp from public.campaigns
     where parish_id = v_unit.parish_id and category_id = v_cat.id and campaign_year = v_year and lower(name) = lower(v_name);
    if v_camp.id is null then
      insert into public.campaigns (parish_id, category_id, financial_year_id, campaign_year, name, starts_on, ends_on,
                                    giver_level, amount_mode, frequency)
      values (v_unit.parish_id, v_cat.id,
              (select id from public.financial_years where parish_id = v_unit.parish_id and label = v_year::text),
              v_year, v_name, make_date(v_year, 1, 1), make_date(v_year, 12, 31), 'jumuiya', 'assigned', 'yearly')
      returning * into v_camp;
    end if;
  end if;
  v_amount := nullif((p->>'amount')::numeric, 0);
  select * into v_old from public.campaign_targets where campaign_id = v_camp.id and org_unit_id = v_unit.id;
  if v_amount is null then
    if v_old.id is not null then
      delete from public.campaign_targets where id = v_old.id;
      insert into public.audit_log (actor_id, action, table_name, row_id, old_data)
      values (auth.uid(), 'remove_unit_target', 'campaign_targets', v_old.id::text, to_jsonb(v_old));
    end if;
    return jsonb_build_object('status', 'removed', 'campaign_id', v_camp.id);
  end if;
  if v_amount < 0 then raise exception 'Kiasi si sahihi' using errcode = 'P0001'; end if;
  insert into public.campaign_targets (campaign_id, org_unit_id, basis, fixed_amount, starts_on, due_on, notes, created_by)
  values (v_camp.id, v_unit.id, 'fixed', v_amount, (p->>'starts_on')::date, (p->>'due_on')::date, nullif(p->>'notes', ''), auth.uid())
  on conflict (campaign_id, org_unit_id) do update
     set basis = 'fixed', fixed_amount = excluded.fixed_amount, unit_count = null, unit_rate = null,
         starts_on = excluded.starts_on, due_on = excluded.due_on, notes = excluded.notes
  returning id into v_id;
  insert into public.audit_log (actor_id, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), 'set_unit_target', 'campaign_targets', v_id::text, to_jsonb(v_old), p);
  return jsonb_build_object('status', 'saved', 'campaign_id', v_camp.id, 'target_id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- unit_contributions: every contribution (except Zaka) a jumuiya / kigango owes
-- or has paid in one year — assigned amount (lengo), family/person amounts,
-- what came in, what is left and the %.
-- ---------------------------------------------------------------------------
create or replace function public.unit_contributions(p_year int, p_unit uuid)
returns table (campaign_id uuid, campaign_name text, category_id uuid, category_code text, category_name text, category_kind text,
               giver_level text, amount_mode text, frequency text,
               target numeric, starts_on date, due_on date, notes text, own_target boolean,
               pledged numeric, paid numeric, collected numeric, obligation numeric, balance numeric, pct numeric, payers bigint)
language sql stable set search_path = public as $$
  with u as (select unnest(public.units_within(p_unit)) as id),
  cps as (
    select cp.*, c.code, c.name_sw, c.kind
      from public.campaigns cp join public.contribution_categories c on c.id = cp.category_id
     where cp.campaign_year = p_year and c.kind not in ('zaka', 'expense')
  ),
  tg as (
    select ct.campaign_id, sum(ct.target_amount) as target, min(ct.starts_on) as s, max(ct.due_on) as d,
           string_agg(ct.notes, '; ') as notes, bool_or(ct.org_unit_id = p_unit) as own
      from public.campaign_targets ct
     where ct.org_unit_id in (select id from u) and ct.campaign_id in (select id from cps)
     group by 1
  ),
  pl as (
    select b.campaign_id, sum(b.pledged) as pledged, sum(b.paid) as paid
      from public.v_pledge_balances b
     where b.status = 'active' and b.campaign_id in (select id from cps)
       and coalesce(b.org_unit_id, b.jumuiya_id) in (select id from u)
     group by 1
  ),
  col as (
    select t.campaign_id, sum(t.net_amount) as collected,
           count(distinct coalesce(t.parishioner_id::text, t.family_id::text, lower(t.payer_name))) as payers
      from public.finance_transactions t
     where t.status = 'posted' and t.kind = 'income' and t.campaign_id in (select id from cps)
       and coalesce(t.org_unit_id, t.jumuiya_id) in (select id from u)
     group by 1
  )
  select cps.id, cps.name, cps.category_id, cps.code, cps.name_sw, cps.kind, cps.giver_level, cps.amount_mode, cps.frequency,
         coalesce(tg.target, 0), coalesce(tg.s, cps.starts_on), coalesce(tg.d, cps.ends_on), tg.notes, coalesce(tg.own, false),
         coalesce(pl.pledged, 0), coalesce(pl.paid, 0), coalesce(col.collected, 0),
         greatest(coalesce(tg.target, 0), coalesce(pl.pledged, 0)),
         case when coalesce(tg.target, 0) > 0 then greatest(tg.target - coalesce(col.collected, 0), 0)
              else greatest(coalesce(pl.pledged, 0) - greatest(coalesce(pl.paid, 0), coalesce(col.collected, 0)), 0) end,
         -- money handed in by the jumuiya as a lump also counts, not only what is linked to each family
         case when coalesce(tg.target, 0) > 0 then round(least(coalesce(col.collected, 0) / tg.target, 9.99) * 100, 1)
              when coalesce(pl.pledged, 0) > 0 then round(least(greatest(coalesce(pl.paid, 0), coalesce(col.collected, 0)) / pl.pledged, 9.99) * 100, 1) end,
         coalesce(col.payers, 0)
    from cps
    left join tg on tg.campaign_id = cps.id
    left join pl on pl.campaign_id = cps.id
    left join col on col.campaign_id = cps.id
   where tg.campaign_id is not null or pl.campaign_id is not null or col.campaign_id is not null
   order by (coalesce(tg.target, 0) + coalesce(pl.pledged, 0)) desc, cps.name
$$;

-- ---------------------------------------------------------------------------
-- unit_summary: "pangiwa / bado" now also counts what the jumuiya itself was
-- assigned (lengo), not only family and personal amounts
-- ---------------------------------------------------------------------------
create or replace function public.unit_summary(p_year int, p_parent uuid default null)
returns table (unit_id uuid, unit_name text, unit_type text, ordinal int, families bigint, parishioners bigint,
               zaka numeric, mavuno numeric, ujenzi numeric, sadaka numeric, special numeric, other numeric, income numeric,
               pledged numeric, paid numeric, outstanding numeric)
language sql stable set search_path = public as $$
  with recursive kids as (
    select o.id as child, o.id as unit from public.org_units o
     where o.is_active and (case when p_parent is null
                                 then o.unit_type = 'kigango' and o.parent_id = (select id from public.org_units where unit_type = 'parish' limit 1)
                                 else o.parent_id = p_parent and o.unit_type in ('kigango','jumuiya') end)
    union all
    select k.child, o.id from public.org_units o join kids k on o.parent_id = k.unit
  ),
  tx as (
    select k.child, c.kind as ck, sum(t.net_amount) as amt
      from public.finance_transactions t
      join public.contribution_categories c on c.id = t.category_id
      join kids k on k.unit = coalesce(t.org_unit_id, t.jumuiya_id)
     where t.status = 'posted' and t.kind = 'income'
       and t.txn_date >= make_date(p_year, 1, 1) and t.txn_date < make_date(p_year + 1, 1, 1)
     group by 1, 2
  ),
  pl as (
    select k.child, sum(b.pledged) as pledged, sum(b.paid) as paid, sum(b.outstanding) as outstanding
      from public.v_pledge_balances b join kids k on k.unit = coalesce(b.org_unit_id, b.jumuiya_id)
     where b.campaign_year = p_year and b.status = 'active'
     group by 1
  ),
  tg as (
    select k.child, ct.campaign_id, sum(ct.target_amount) as target
      from public.campaign_targets ct
      join public.campaigns cp on cp.id = ct.campaign_id and cp.campaign_year = p_year
      join kids k on k.unit = ct.org_unit_id
     group by 1, 2
  ),
  tc as (
    select k.child, t.campaign_id, sum(t.net_amount) as col
      from public.finance_transactions t join kids k on k.unit = coalesce(t.org_unit_id, t.jumuiya_id)
     where t.status = 'posted' and t.kind = 'income' and t.campaign_id in (select campaign_id from tg)
     group by 1, 2
  ),
  tgs as (
    select tg.child, sum(tg.target) as target, sum(least(coalesce(tc.col, 0), tg.target)) as paid
      from tg left join tc on tc.child = tg.child and tc.campaign_id = tg.campaign_id
     group by 1
  ),
  fam as (select k.child, count(*) as n from public.families f join kids k on k.unit = f.jumuiya_id where f.status = 'active' group by 1),
  ppl as (select k.child, count(*) as n from public.parishioners p join kids k on k.unit = p.jumuiya_id where p.membership_status = 'active' group by 1)
  select o.id, o.name, o.unit_type, o.ordinal,
         coalesce((select n from fam where fam.child = o.id), 0),
         coalesce((select n from ppl where ppl.child = o.id), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id and ck = 'zaka'), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id and ck = 'mavuno'), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id and ck = 'ujenzi'), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id and ck = 'sadaka'), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id and ck in ('special','shukrani')), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id and ck not in ('zaka','mavuno','ujenzi','sadaka','special','shukrani')), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id), 0),
         coalesce((select pledged from pl where pl.child = o.id), 0) + coalesce((select target from tgs where tgs.child = o.id), 0),
         coalesce((select paid from pl where pl.child = o.id), 0) + coalesce((select paid from tgs where tgs.child = o.id), 0),
         coalesce((select outstanding from pl where pl.child = o.id), 0)
           + coalesce((select target - paid from tgs where tgs.child = o.id), 0)
    from public.org_units o
   where o.id in (select child from kids)
   order by o.ordinal nulls last, o.name
$$;

revoke execute on function public.set_unit_target(jsonb) from public, anon;
grant execute on function public.set_unit_target(jsonb) to authenticated;
grant execute on function public.unit_contributions(int, uuid) to authenticated;
grant execute on function public.unit_summary(int, uuid) to authenticated;
