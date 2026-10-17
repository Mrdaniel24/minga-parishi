-- ============================================================================
-- Minga Parish Management System — migration 15: Miamala by level
--   Vigango → Kigango → Jumuiya → Familia → Muumini → the payments themselves.
-- v_ledger_tree: every ledger line with the kigango and jumuiya it belongs to,
--   also when the payer is the kigango / jumuiya itself (org_unit_id).
-- ledger_tree(): totals for one level, computed in the database (no row limit).
-- ============================================================================

create or replace view public.v_ledger_tree with (security_invoker = true) as
select l.*,
       coalesce(l.kigango_id, case when ou.unit_type = 'kigango' then ou.id when pu.unit_type = 'kigango' then pu.id end) as tree_kigango_id,
       coalesce(l.jumuiya_id, case when ou.unit_type in ('jumuiya', 'group') then ou.id end) as tree_jumuiya_id
  from public.v_ledger l
  left join public.org_units ou on ou.id = l.org_unit_id
  left join public.org_units pu on pu.id = ou.parent_id;

-- p_level: 'kigango' (all vigango) | 'jumuiya' (of kigango p_parent) |
--          'family' (of jumuiya p_parent) | 'parishioner' (of family p_parent)
-- the row with group_id null is "the level itself": paid at the parish /
-- by the kigango / by the jumuiya / by the family, not by someone below it.
create or replace function public.ledger_tree(p_from date, p_to date, p_level text, p_parent uuid default null,
                                              p_category uuid default null, p_status text default 'posted')
returns table (group_id uuid, group_name text, n bigint, zaka numeric, mavuno numeric, ujenzi numeric, sadaka numeric, other numeric, total numeric)
language sql stable set search_path = public as $$
  with b as (
    select case p_level when 'kigango' then l.tree_kigango_id when 'jumuiya' then l.tree_jumuiya_id
                        when 'family' then l.family_id else l.parishioner_id end as gid,
           l.category_kind as ck, l.net_amount as amt
      from public.v_ledger_tree l
     where l.kind = 'income' and l.txn_date between p_from and p_to
       and (case p_status when 'all' then l.status <> 'rejected' else l.status = p_status end)
       and (p_category is null or l.category_id = p_category)
       and (case p_level when 'kigango' then true
                         when 'jumuiya' then l.tree_kigango_id = p_parent
                         when 'family' then l.tree_jumuiya_id = p_parent
                         else l.family_id = p_parent end)
  )
  select b.gid,
         case p_level when 'kigango' then (select name from public.org_units where id = b.gid)
                      when 'jumuiya' then (select name from public.org_units where id = b.gid)
                      when 'family' then (select family_name from public.families where id = b.gid)
                      else (select full_name from public.parishioners where id = b.gid) end,
         count(*),
         coalesce(sum(amt) filter (where ck = 'zaka'), 0),
         coalesce(sum(amt) filter (where ck = 'mavuno'), 0),
         coalesce(sum(amt) filter (where ck = 'ujenzi'), 0),
         coalesce(sum(amt) filter (where ck = 'sadaka'), 0),
         coalesce(sum(amt) filter (where ck not in ('zaka', 'mavuno', 'ujenzi', 'sadaka')), 0),
         coalesce(sum(amt), 0)
    from b group by b.gid
$$;

grant select on public.v_ledger_tree to authenticated;
grant execute on function public.ledger_tree(date, date, text, uuid, uuid, text) to authenticated;

-- contributions for which the workbook gave every jumuiya an amount (MALENGO)
-- are "kila jumuiya · kupangiwa", not free giving
update public.campaigns cp set giver_level = 'jumuiya', amount_mode = 'assigned'
 where exists (select 1 from public.campaign_targets ct join public.org_units o on o.id = ct.org_unit_id
                where ct.campaign_id = cp.id and o.unit_type in ('jumuiya', 'group'))
   and (cp.giver_level is null or cp.amount_mode = 'free')
   and not exists (select 1 from public.pledges pl where pl.campaign_id = cp.id);

-- the same when the amounts arrive later (the workbook import runs after setup)
create or replace function public.campaign_targets_rules() returns trigger language plpgsql set search_path = public as $$
begin
  update public.campaigns cp set giver_level = 'jumuiya', amount_mode = 'assigned'
   where cp.id = new.campaign_id and (cp.giver_level is null or cp.amount_mode = 'free')
     and exists (select 1 from public.org_units o where o.id = new.org_unit_id and o.unit_type in ('jumuiya', 'group'))
     and not exists (select 1 from public.pledges pl where pl.campaign_id = cp.id);
  return new;
end $$;
drop trigger if exists campaign_targets_rules on public.campaign_targets;
create trigger campaign_targets_rules after insert on public.campaign_targets for each row execute function public.campaign_targets_rules();
