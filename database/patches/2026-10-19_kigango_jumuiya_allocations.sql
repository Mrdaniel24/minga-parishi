-- ============================================================================
-- Minga Parish Management System — migration 19: split a kigango target
--   Optional jumuiya portions are stored separately from existing targets.
--   They remain part of the kigango total and are not counted twice.
-- ============================================================================

create table if not exists public.kigango_target_allocations (
  id               uuid primary key default gen_random_uuid(),
  parent_target_id uuid not null references public.campaign_targets(id) on delete cascade,
  campaign_id      uuid not null references public.campaigns(id) on delete cascade,
  kigango_id       uuid not null references public.org_units(id) on delete cascade,
  jumuiya_id       uuid not null references public.org_units(id) on delete cascade,
  amount           numeric(14,2) not null check (amount > 0),
  starts_on        date,
  due_on           date,
  notes            text,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  unique (parent_target_id, jumuiya_id)
);

create index if not exists kigango_target_allocations_campaign_idx
  on public.kigango_target_allocations(campaign_id, kigango_id, jumuiya_id);

alter table public.kigango_target_allocations enable row level security;
drop policy if exists kigango_target_allocations_read on public.kigango_target_allocations;
create policy kigango_target_allocations_read on public.kigango_target_allocations
  for select to authenticated using (
    public.has_perm('finance.read', kigango_id) or public.has_perm('finance.read', jumuiya_id)
    or public.has_perm('finance.pledge', kigango_id) or public.has_perm('finance.pledge', jumuiya_id)
  );
revoke all on public.kigango_target_allocations from public, anon;
grant select on public.kigango_target_allocations to authenticated;

-- Save the kigango total and its optional jumuiya portions atomically.
-- The database checks scope permissions and rejects allocations over the total.
create or replace function public.set_kigango_targets(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_kigango public.org_units;
  v_child public.org_units;
  v_old public.kigango_target_allocations;
  v_parent_target_id uuid;
  v_child_id uuid;
  v_saved jsonb;
  v_allocations jsonb;
  v_item jsonb;
  v_amount numeric;
  v_total numeric;
  v_allocated numeric := 0;
  v_distribute boolean;
begin
  select * into v_kigango from public.org_units where id = (p->>'org_unit_id')::uuid;
  if v_kigango.id is null or v_kigango.unit_type <> 'kigango' or not v_kigango.is_active then
    raise exception 'Chagua kigango kinachotumika' using errcode = 'P0001';
  end if;
  if not public.has_perm('finance.pledge', v_kigango.id) then
    raise exception 'Huna ruhusa ya kupangia michango kwa %', v_kigango.name using errcode = '42501';
  end if;

  v_distribute := coalesce((p->>'distribute_to_jumuiya')::boolean, false);
  v_allocations := coalesce(p->'allocations', '[]'::jsonb);
  if jsonb_typeof(v_allocations) <> 'array' then
    raise exception 'Orodha ya mgao wa jumuiya si sahihi' using errcode = 'P0001';
  end if;
  v_total := coalesce(nullif(p->>'amount', '')::numeric, 0);
  if v_total < 0 then raise exception 'Kiasi si sahihi' using errcode = 'P0001'; end if;

  if v_distribute then
    if exists (
      select 1 from jsonb_array_elements(v_allocations) as x(item)
       group by x.item->>'org_unit_id' having count(*) > 1
    ) then
      raise exception 'Jumuiya imerudiwa kwenye mgao' using errcode = 'P0001';
    end if;
    for v_item in select value from jsonb_array_elements(v_allocations) loop
      begin
        v_child_id := (v_item->>'org_unit_id')::uuid;
        v_amount := coalesce(nullif(v_item->>'amount', '')::numeric, 0);
      exception when others then
        raise exception 'Jumuiya au kiasi cha mgao si sahihi' using errcode = 'P0001';
      end;
      if v_amount < 0 then raise exception 'Kiasi cha jumuiya hakiwezi kuwa hasi' using errcode = 'P0001'; end if;
      select * into v_child from public.org_units where id = v_child_id;
      if v_child.id is null or not v_child.is_active or v_child.parent_id <> v_kigango.id
         or v_child.unit_type not in ('jumuiya', 'group') or v_child.parish_id <> v_kigango.parish_id then
        raise exception 'Jumuiya lazima iwe chini ya kigango hiki' using errcode = 'P0001';
      end if;
      if v_amount > 0 and not public.has_perm('finance.pledge', v_child.id) then
        raise exception 'Huna ruhusa ya kupangia jumuiya ya %', v_child.name using errcode = '42501';
      end if;
      v_allocated := v_allocated + v_amount;
    end loop;
    if v_allocated > v_total then
      raise exception 'Jumla ya mgao wa jumuiya haiwezi kuzidi kiasi cha kigango' using errcode = 'P0001';
    end if;
  end if;

  v_saved := public.set_unit_target(p);
  v_parent_target_id := nullif(v_saved->>'target_id', '')::uuid;
  if v_parent_target_id is null then
    -- Removing the parent target cascades to any portions linked to it.
    return v_saved;
  end if;

  if not v_distribute then
    for v_old in select * from public.kigango_target_allocations where parent_target_id = v_parent_target_id for update loop
      if not public.has_perm('finance.pledge', v_old.jumuiya_id) then
        raise exception 'Huna ruhusa ya kubadilisha mgao wa jumuiya' using errcode = '42501';
      end if;
      delete from public.kigango_target_allocations where id = v_old.id;
      insert into public.audit_log (actor_id, action, table_name, row_id, old_data)
      values (auth.uid(), 'remove_kigango_allocation', 'kigango_target_allocations', v_old.id::text, to_jsonb(v_old));
    end loop;
    return v_saved || jsonb_build_object('allocated', 0);
  end if;

  -- Remove old portions omitted from the form or set to zero.
  for v_old in
    select * from public.kigango_target_allocations a
     where a.parent_target_id = v_parent_target_id
       and not exists (
         select 1 from jsonb_array_elements(v_allocations) as x(item)
          where x.item->>'org_unit_id' = a.jumuiya_id::text
            and coalesce(nullif(x.item->>'amount', '')::numeric, 0) > 0
       )
     for update
  loop
    if not public.has_perm('finance.pledge', v_old.jumuiya_id) then
      raise exception 'Huna ruhusa ya kubadilisha mgao wa jumuiya' using errcode = '42501';
    end if;
    delete from public.kigango_target_allocations where id = v_old.id;
    insert into public.audit_log (actor_id, action, table_name, row_id, old_data)
    values (auth.uid(), 'remove_kigango_allocation', 'kigango_target_allocations', v_old.id::text, to_jsonb(v_old));
  end loop;

  for v_item in select value from jsonb_array_elements(v_allocations) loop
    v_child_id := (v_item->>'org_unit_id')::uuid;
    v_amount := coalesce(nullif(v_item->>'amount', '')::numeric, 0);
    if v_amount <= 0 then continue; end if;
    select * into v_child from public.org_units where id = v_child_id;
    select * into v_old from public.kigango_target_allocations
     where parent_target_id = v_parent_target_id and jumuiya_id = v_child.id for update;
    insert into public.kigango_target_allocations (parent_target_id, campaign_id, kigango_id, jumuiya_id,
      amount, starts_on, due_on, notes, created_by)
    values (v_parent_target_id, (v_saved->>'campaign_id')::uuid, v_kigango.id, v_child.id,
      v_amount, (p->>'starts_on')::date, (p->>'due_on')::date, nullif(p->>'notes', ''), auth.uid())
    on conflict (parent_target_id, jumuiya_id) do update
       set amount = excluded.amount, starts_on = excluded.starts_on, due_on = excluded.due_on, notes = excluded.notes
    returning id into v_child_id;
    insert into public.audit_log (actor_id, action, table_name, row_id, old_data, new_data)
    values (auth.uid(), 'set_kigango_allocation', 'kigango_target_allocations', v_child_id::text, to_jsonb(v_old), v_item);
  end loop;
  return v_saved || jsonb_build_object('allocated', v_allocated);
end $$;

revoke execute on function public.set_kigango_targets(jsonb) from public, anon;
grant execute on function public.set_kigango_targets(jsonb) to authenticated;

-- Jumuiya portions count under their own lines. The kigango line remains the
-- total less portions already assigned to its jumuiya.
create or replace function public.campaign_tree(p_campaign uuid, p_level text, p_parent uuid default null)
returns table (group_id uuid, group_name text, target numeric, pledged numeric, paid numeric, collected numeric,
               obligation numeric, gave numeric, balance numeric, pct numeric, payers bigint, pledges bigint)
language sql stable set search_path = public as $$
  with src as (
    select coalesce(case when ou.unit_type = 'kigango' then ou.id end, public.org_ancestor_of_type(ou.id, 'kigango')) as kg,
           case when ou.unit_type in ('jumuiya', 'group') then ou.id end as jm, null::uuid as fam, null::uuid as per,
           case when p_level = 'jumuiya' and ou.unit_type = 'kigango'
             then greatest(ct.target_amount - coalesce((select sum(a.amount) from public.kigango_target_allocations a where a.parent_target_id = ct.id), 0), 0)
             else ct.target_amount end as target,
           0::numeric as pledged, 0::numeric as paid, 0::numeric as collected, null::text as payer, 0 as pl
      from public.campaign_targets ct join public.org_units ou on ou.id = ct.org_unit_id
     where ct.campaign_id = p_campaign
    union all
    select a.kigango_id, a.jumuiya_id, null::uuid, null::uuid,
           case when p_level = 'kigango' then 0::numeric else a.amount end,
           0::numeric, 0::numeric, 0::numeric, null::text, 0
      from public.kigango_target_allocations a
     where a.campaign_id = p_campaign
    union all
    select coalesce(b.kigango_id, public.org_ancestor_of_type(b.jumuiya_id, 'kigango')),
           case when b.org_unit_id is not null and ou.unit_type = 'kigango' then null else b.jumuiya_id end,
           coalesce(b.family_id, pr.family_id), b.parishioner_id,
           0, b.pledged, b.paid, 0, null, 1
      from public.v_pledge_balances b
      left join public.parishioners pr on pr.id = b.parishioner_id
      left join public.org_units ou on ou.id = b.org_unit_id
     where b.campaign_id = p_campaign and b.status = 'active'
    union all
    select l.tree_kigango_id, l.tree_jumuiya_id, l.family_id, l.parishioner_id,
           0, 0, 0, l.net_amount, coalesce(l.parishioner_id::text, l.family_id::text, lower(l.payer_name)), 0
      from public.v_ledger_tree l
     where l.campaign_id = p_campaign and l.status = 'posted' and l.kind = 'income'
  ),
  lvl as (
    select case p_level when 'kigango' then kg when 'jumuiya' then jm when 'family' then fam else per end as gid, src.*
      from src
     where case p_level when 'kigango' then true when 'jumuiya' then kg = p_parent
                        when 'family' then jm = p_parent else fam = p_parent end
  ),
  agg as (
    select gid, sum(target) as target, sum(pledged) as pledged, sum(paid) as paid, sum(collected) as collected,
           count(distinct payer) as payers, sum(pl) as pledges
      from lvl group by gid
  )
  select a.gid,
         case p_level when 'family' then (select family_name from public.families where id = a.gid)
                      when 'parishioner' then (select full_name from public.parishioners where id = a.gid)
                      else (select name from public.org_units where id = a.gid) end,
         a.target, a.pledged, a.paid, a.collected,
         greatest(a.target, a.pledged),
         case when a.target > 0 then a.collected else greatest(a.paid, a.collected) end,
         greatest(greatest(a.target, a.pledged) - case when a.target > 0 then a.collected else greatest(a.paid, a.collected) end, 0),
         case when greatest(a.target, a.pledged) > 0
              then round(least((case when a.target > 0 then a.collected else greatest(a.paid, a.collected) end) / greatest(a.target, a.pledged), 9.99) * 100, 1) end,
         a.payers, a.pledges
    from agg a
$$;

grant execute on function public.campaign_tree(uuid, text, uuid) to authenticated;

-- An allocation is part of a kigango target, not an extra target in a kigango
-- total. At a jumuiya scope it is included in that jumuiya's assigned amount.
create or replace function public.unit_contributions(p_year int, p_unit uuid)
returns table (campaign_id uuid, campaign_name text, category_id uuid, category_code text, category_name text, category_kind text,
               giver_level text, amount_mode text, frequency text,
               target numeric, starts_on date, due_on date, notes text, own_target boolean,
               pledged numeric, paid numeric, collected numeric, obligation numeric, balance numeric, pct numeric, payers bigint)
language sql stable set search_path = public as $$
  with u as (select unnest(public.units_within(p_unit)) as id),
  unit as (select unit_type from public.org_units where id = p_unit),
  cps as (
    select cp.*, c.code, c.name_sw, c.kind from public.campaigns cp join public.contribution_categories c on c.id = cp.category_id
     where cp.campaign_year = p_year and c.kind not in ('zaka', 'expense')
  ),
  target_rows as (
    select ct.campaign_id, ct.target_amount as target, ct.starts_on, ct.due_on, ct.notes, ct.org_unit_id = p_unit as own
      from public.campaign_targets ct
     where ct.org_unit_id in (select id from u) and ct.campaign_id in (select id from cps)
    union all
    select a.campaign_id, a.amount, a.starts_on, a.due_on, a.notes, a.jumuiya_id = p_unit
      from public.kigango_target_allocations a
     where (select unit_type from unit) <> 'kigango' and a.jumuiya_id in (select id from u)
       and a.campaign_id in (select id from cps)
  ),
  tg as (
    select campaign_id, sum(target) as target, min(starts_on) as s, max(due_on) as d,
           string_agg(notes, '; ') as notes, bool_or(own) as own
      from target_rows group by campaign_id
  ),
  pl as (
    select b.campaign_id, sum(b.pledged) as pledged, sum(b.paid) as paid
      from public.v_pledge_balances b
     where b.status = 'active' and b.campaign_id in (select id from cps)
       and coalesce(b.org_unit_id, b.jumuiya_id) in (select id from u)
     group by b.campaign_id
  ),
  col as (
    select t.campaign_id, sum(t.net_amount) as collected,
           count(distinct coalesce(t.parishioner_id::text, t.family_id::text, lower(t.payer_name))) as payers
      from public.finance_transactions t
     where t.status = 'posted' and t.kind = 'income' and t.campaign_id in (select id from cps)
       and coalesce(t.org_unit_id, t.jumuiya_id) in (select id from u)
     group by t.campaign_id
  )
  select cps.id, cps.name, cps.category_id, cps.code, cps.name_sw, cps.kind, cps.giver_level, cps.amount_mode, cps.frequency,
         coalesce(tg.target, 0), coalesce(tg.s, cps.starts_on), coalesce(tg.d, cps.ends_on), tg.notes, coalesce(tg.own, false),
         coalesce(pl.pledged, 0), coalesce(pl.paid, 0), coalesce(col.collected, 0),
         greatest(coalesce(tg.target, 0), coalesce(pl.pledged, 0)),
         case when coalesce(tg.target, 0) > 0 then greatest(tg.target - coalesce(col.collected, 0), 0)
              else greatest(coalesce(pl.pledged, 0) - greatest(coalesce(pl.paid, 0), coalesce(col.collected, 0)), 0) end,
         case when coalesce(tg.target, 0) > 0 then round(least(coalesce(col.collected, 0) / tg.target, 9.99) * 100, 1)
              when coalesce(pl.pledged, 0) > 0 then round(least(greatest(coalesce(pl.paid, 0), coalesce(col.collected, 0)) / pl.pledged, 9.99) * 100, 1) end,
         coalesce(col.payers, 0)
    from cps left join tg on tg.campaign_id = cps.id left join pl on pl.campaign_id = cps.id left join col on col.campaign_id = cps.id
   where tg.campaign_id is not null or pl.campaign_id is not null or col.campaign_id is not null
   order by (coalesce(tg.target, 0) + coalesce(pl.pledged, 0)) desc, cps.name
$$;

grant execute on function public.unit_contributions(int, uuid) to authenticated;

-- In kigango summaries, keep the parent target as the total. When a specific
-- kigango's jumuiya are listed, show each of their allocation portions.
create or replace function public.unit_summary(p_year int, p_parent uuid default null)
returns table (unit_id uuid, unit_name text, unit_type text, ordinal int, families bigint, parishioners bigint,
               zaka numeric, mavuno numeric, ujenzi numeric, sadaka numeric, special numeric, other numeric, income numeric,
               pledged numeric, paid numeric, outstanding numeric)
language sql stable set search_path = public as $$
  with recursive kids as (
    select o.id as child, o.id as unit
      from public.org_units o
     where o.is_active and (case when p_parent is null
       then o.unit_type = 'kigango' and o.parent_id = (select id from public.org_units where unit_type = 'parish' limit 1)
       else o.parent_id = p_parent and o.unit_type in ('kigango','jumuiya') end)
    union all
    select k.child, o.id from public.org_units o join kids k on o.parent_id = k.unit
  ),
  tx as (
    select k.child, c.kind as ck, sum(t.net_amount) as amt
      from public.finance_transactions t join public.contribution_categories c on c.id = t.category_id
      join kids k on k.unit = coalesce(t.org_unit_id, t.jumuiya_id)
     where t.status = 'posted' and t.kind = 'income' and t.txn_date >= make_date(p_year, 1, 1) and t.txn_date < make_date(p_year + 1, 1, 1)
     group by k.child, c.kind
  ),
  pl as (
    select k.child, sum(b.pledged) as pledged, sum(b.paid) as paid, sum(b.outstanding) as outstanding
      from public.v_pledge_balances b join kids k on k.unit = coalesce(b.org_unit_id, b.jumuiya_id)
     where b.campaign_year = p_year and b.status = 'active' group by k.child
  ),
  target_rows as (
    select k.child, ct.campaign_id, ct.target_amount as target
      from public.campaign_targets ct join public.campaigns cp on cp.id = ct.campaign_id and cp.campaign_year = p_year
      join kids k on k.unit = ct.org_unit_id
    union all
    select k.child, a.campaign_id, a.amount
      from public.kigango_target_allocations a
      join public.campaigns cp on cp.id = a.campaign_id and cp.campaign_year = p_year
      join kids k on k.unit = a.jumuiya_id
     where p_parent is not null
  ),
  tg as (select child, campaign_id, sum(target) as target from target_rows group by child, campaign_id),
  tc as (
    select k.child, t.campaign_id, sum(t.net_amount) as col
      from public.finance_transactions t join kids k on k.unit = coalesce(t.org_unit_id, t.jumuiya_id)
     where t.status = 'posted' and t.kind = 'income' and t.campaign_id in (select campaign_id from tg)
     group by k.child, t.campaign_id
  ),
  tgs as (
    select tg.child, sum(tg.target) as target, sum(least(coalesce(tc.col, 0), tg.target)) as paid
      from tg left join tc on tc.child = tg.child and tc.campaign_id = tg.campaign_id group by tg.child
  ),
  fam as (select k.child, count(*) as n from public.families f join kids k on k.unit = f.jumuiya_id where f.status = 'active' group by k.child),
  ppl as (select k.child, count(*) as n from public.parishioners p join kids k on k.unit = p.jumuiya_id where p.membership_status = 'active' group by k.child)
  select o.id, o.name, o.unit_type, o.ordinal,
         coalesce((select n from fam where fam.child = o.id), 0), coalesce((select n from ppl where ppl.child = o.id), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id and ck = 'zaka'), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id and ck = 'mavuno'), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id and ck = 'ujenzi'), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id and ck = 'sadaka'), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id and ck in ('special','shukrani')), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id and ck not in ('zaka','mavuno','ujenzi','sadaka','special','shukrani')), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id), 0),
         coalesce((select pledged from pl where pl.child = o.id), 0) + coalesce((select target from tgs where tgs.child = o.id), 0),
         coalesce((select paid from pl where pl.child = o.id), 0) + coalesce((select paid from tgs where tgs.child = o.id), 0),
         coalesce((select outstanding from pl where pl.child = o.id), 0) + coalesce((select target - paid from tgs where tgs.child = o.id), 0)
    from public.org_units o where o.id in (select child from kids) order by o.ordinal nulls last, o.name
$$;

grant execute on function public.unit_summary(int, uuid) to authenticated;
notify pgrst, 'reload schema';

