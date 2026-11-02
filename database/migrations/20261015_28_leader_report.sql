-- ============================================================================
-- Minga Parish Management System — migration 28: contributions of leaders
--   A report for the parish leadership only: every member who holds a title
--   (Katibu, Mwenyekiti, Mhazini… — migration 25) with what they gave in the
--   year: zaka (and in how many months), other contributions they gave
--   themselves, contributions given in their family's name, and what is still
--   owed on this year's pledges.
--   Runs with the caller's rights (RLS): a jumuiya / kigango leader sees the
--   leaders of their own community only; members (no finance.read) see nothing.
-- ============================================================================

create or replace function public.leaders_contributions(p_year int, p_scope uuid default null)
returns table (parishioner_id uuid, full_name text, phone text, titles text, levels text,
               jumuiya_id uuid, kigango_id uuid, family_id uuid, family_name text,
               zaka numeric, zaka_months int, personal numeric, family numeric,
               pledged numeric, outstanding numeric, total numeric)
language sql stable security invoker set search_path = public as $$
  with lead as (
    select p.id, p.full_name, p.phone, p.family_id, p.jumuiya_id,
           string_agg(distinct lp.title_sw, ', ') as titles,
           string_agg(distinct lp.level, ',') as levels
      from public.leadership_assignments la
      join public.leadership_positions lp on lp.id = la.position_id
      join public.parishioners p on p.id = la.parishioner_id
     where la.status = 'active'
       and (p_scope is null or p.jumuiya_id = any (public.units_within(p_scope)) or la.org_unit_id = any (public.units_within(p_scope)))
     group by p.id
  ),
  tx as (
    select t.parishioner_id, t.family_id, t.net_amount, t.period_month, c.kind as cat_kind
      from public.finance_transactions t
      join public.contribution_categories c on c.id = t.category_id
      left join public.campaigns cp on cp.id = t.campaign_id
     where t.status = 'posted' and t.kind = 'income' and c.kind <> 'expense'
       and (case when c.kind = 'zaka' then extract(year from coalesce(t.period_month, t.txn_date))
                 else coalesce(cp.campaign_year, extract(year from t.txn_date)) end) = p_year
       and (t.parishioner_id in (select id from lead) or (t.parishioner_id is null and t.family_id in (select family_id from lead)))
  ),
  per as (
    select l.id,
           coalesce(sum(tx.net_amount) filter (where tx.parishioner_id = l.id and tx.cat_kind = 'zaka'), 0) as zaka,
           count(distinct date_trunc('month', tx.period_month)) filter (where tx.parishioner_id = l.id and tx.cat_kind = 'zaka' and tx.net_amount > 0)::int as zaka_months,
           coalesce(sum(tx.net_amount) filter (where tx.parishioner_id = l.id and tx.cat_kind <> 'zaka'), 0) as personal,
           coalesce(sum(tx.net_amount) filter (where tx.parishioner_id is null and tx.family_id = l.family_id and tx.cat_kind <> 'zaka'), 0) as family
      from lead l left join tx on tx.parishioner_id = l.id or (tx.parishioner_id is null and tx.family_id = l.family_id)
     group by l.id
  ),
  pl as (
    select l.id, coalesce(sum(b.pledged), 0) as pledged, coalesce(sum(b.outstanding), 0) as outstanding
      from lead l
      join public.v_pledge_balances b on b.status = 'active' and b.campaign_year = p_year
       and (b.parishioner_id = l.id or (b.family_id = l.family_id and b.parishioner_id is null))
     group by l.id
  )
  select l.id, l.full_name, l.phone, l.titles, l.levels,
         l.jumuiya_id, public.org_ancestor_of_type(l.jumuiya_id, 'kigango'), l.family_id, f.family_name,
         per.zaka, per.zaka_months, per.personal, per.family,
         coalesce(pl.pledged, 0), coalesce(pl.outstanding, 0),
         per.zaka + per.personal + per.family
    from lead l
    join per on per.id = l.id
    left join pl on pl.id = l.id
    left join public.families f on f.id = l.family_id
   where (select public.has_perm_anywhere('finance.read'))
   order by l.full_name
$$;
revoke execute on function public.leaders_contributions(int, uuid) from public, anon;
grant execute on function public.leaders_contributions(int, uuid) to authenticated;

notify pgrst, 'reload schema';
