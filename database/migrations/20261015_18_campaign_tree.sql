-- ============================================================================
-- Minga Parish Management System — migration 18: ONE contribution, level by level
--   Radio Maria 2026 → vigango → jumuiya of a kigango → families of a jumuiya →
--   members of a family. Each line: assigned (lengo / pangiwa), given, left, %.
--   The line with group_id null is what belongs to the level itself (paid at
--   the parish, by the kigango, by the jumuiya as a whole, by the family).
-- ============================================================================

create or replace function public.campaign_tree(p_campaign uuid, p_level text, p_parent uuid default null)
returns table (group_id uuid, group_name text, target numeric, pledged numeric, paid numeric, collected numeric,
               obligation numeric, gave numeric, balance numeric, pct numeric, payers bigint, pledges bigint)
language sql stable set search_path = public as $$
  with src as (
    -- what each jumuiya / kigango was given (MALENGO / "Pangia mchango")
    select coalesce(case when ou.unit_type = 'kigango' then ou.id end, public.org_ancestor_of_type(ou.id, 'kigango')) as kg,
           case when ou.unit_type in ('jumuiya', 'group') then ou.id end as jm, null::uuid as fam, null::uuid as per,
           ct.target_amount as target, 0::numeric as pledged, 0::numeric as paid, 0::numeric as collected, null::text as payer, 0 as pl
      from public.campaign_targets ct join public.org_units ou on ou.id = ct.org_unit_id
     where ct.campaign_id = p_campaign
    union all
    -- what each family / person was assigned or promised
    select coalesce(b.kigango_id, public.org_ancestor_of_type(b.jumuiya_id, 'kigango')),
           case when b.org_unit_id is not null and ou.unit_type = 'kigango' then null else b.jumuiya_id end,
           coalesce(b.family_id, pr.family_id), b.parishioner_id,
           0, b.pledged, b.paid, 0, null, 1
      from public.v_pledge_balances b
      left join public.parishioners pr on pr.id = b.parishioner_id
      left join public.org_units ou on ou.id = b.org_unit_id
     where b.campaign_id = p_campaign and b.status = 'active'
    union all
    -- what came in
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
notify pgrst, 'reload schema';
