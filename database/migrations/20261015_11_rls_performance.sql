-- ============================================================================
-- Minga Parish Management System — migration 11: faster row level security
--   The read policies of migration 05 called has_perm(permission, unit) for
--   EVERY row; for a scoped user (jumuiya/kigango leader, member) that walks the
--   org tree once per row, which on the real ledger (5,800 transactions) is slow
--   enough to hit Supabase's statement timeout on the dashboard.
--   Now the user's allowed units are computed ONCE per query (perm_units) and
--   each row only checks membership in that list. Same rules, same results.
-- ============================================================================

-- every org unit in which the current user holds p_perm through a scoped role
-- (the unit of the role and everything below it). Parish-wide roles are covered
-- by has_perm(p_perm) and are not listed here.
create or replace function public.perm_units(p_perm text)
returns uuid[] language sql stable security definer set search_path = public as $$
  with recursive scope as (
    select ur.org_unit_id as id
      from public.parish_user_roles ur
      join public.role_permissions rp on rp.role_code = ur.role_code
     where ur.user_id = auth.uid() and rp.permission = p_perm and ur.org_unit_id is not null
    union
    select o.id from public.org_units o join scope s on o.parent_id = s.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) from scope
$$;
revoke execute on function public.perm_units(text) from public, anon;
grant execute on function public.perm_units(text) to authenticated;

-- register
drop policy if exists families_read on public.families;
create policy families_read on public.families for select to authenticated using (
  (select public.has_perm('registry.read'))
  or jumuiya_id = any ((select public.perm_units('registry.read'))::uuid[])
  or id = (select public.my_family_id()));

drop policy if exists parishioners_read on public.parishioners;
create policy parishioners_read on public.parishioners for select to authenticated using (
  (select public.has_perm('registry.read'))
  or jumuiya_id = any ((select public.perm_units('registry.read'))::uuid[])
  or profile_id = (select auth.uid())
  or (family_id is not null and family_id = (select public.my_family_id())));

-- ledger
drop policy if exists ft_read on public.finance_transactions;
create policy ft_read on public.finance_transactions for select to authenticated using (
  (select public.has_perm('finance.read'))
  or coalesce(org_unit_id, jumuiya_id) = any ((select public.perm_units('finance.read'))::uuid[])
  or (parishioner_id is not null and parishioner_id = (select public.my_parishioner_id()))
  or (family_id is not null and family_id = (select public.my_family_id())));

drop policy if exists pledges_read on public.pledges;
create policy pledges_read on public.pledges for select to authenticated using (
  (select public.has_perm('finance.read'))
  or coalesce(org_unit_id, jumuiya_id) = any ((select public.perm_units('finance.read'))::uuid[])
  or (parishioner_id is not null and parishioner_id = (select public.my_parishioner_id()))
  or (family_id is not null and family_id = (select public.my_family_id())));

drop policy if exists env_read on public.envelopes;
create policy env_read on public.envelopes for select to authenticated using (
  (select public.has_perm('finance.read'))
  or org_unit_id = any ((select public.perm_units('finance.read'))::uuid[])
  or (parishioner_id is not null and parishioner_id = (select public.my_parishioner_id()))
  or (family_id is not null and family_id = (select public.my_family_id())));
