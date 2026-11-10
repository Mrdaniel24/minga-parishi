-- ============================================================================
-- Minga Parish Management System — migration 32: fixes from the system audit (2026-11-10)
--   1. A suspended account (profiles.status <> 'active') loses every parish right
--      in the database itself. Before this, only the browser signed it out: the
--      same login could still read and post through the API until its token ran out.
--   2. Removing a member from the register needs a reason (the screen asked for
--      one, the database did not).
--   Re-runnable; changes no data.
-- ============================================================================

-- 1. rights only for active accounts
create or replace function public.has_perm(p_perm text, p_org uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.parish_user_roles ur
    join public.role_permissions rp on rp.role_code = ur.role_code
    join public.profiles pr on pr.id = ur.user_id and coalesce(pr.status, 'active') = 'active'
    where ur.user_id = auth.uid()
      and rp.permission = p_perm
      and (case when ur.org_unit_id is null then true
                when p_org is null then false
                else public.org_is_within(p_org, ur.org_unit_id) end)
  )
$$;

create or replace function public.has_perm_anywhere(p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or exists (
    select 1 from public.parish_user_roles ur
    join public.role_permissions rp on rp.role_code = ur.role_code
    join public.profiles pr on pr.id = ur.user_id and coalesce(pr.status, 'active') = 'active'
    where ur.user_id = auth.uid() and rp.permission = p_perm)
$$;

-- 2. removing a member: a reason is required (same function as migration 26 otherwise)
create or replace function public.delete_parishioner(p_parishioner uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  per public.parishioners;
  pl record;
  v_jum uuid;
  n_tx int := 0; n_pl int := 0;
begin
  select * into per from public.parishioners where id = p_parishioner;
  if per.id is null then raise exception 'Muumini hayupo' using errcode = 'P0001'; end if;
  v_jum := coalesce(per.jumuiya_id, (select jumuiya_id from public.families where id = per.family_id));
  if not public.has_perm('registry.write', v_jum) then
    raise exception 'Huna ruhusa ya kumfuta muumini huyu (permission denied)' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Sababu ya kumfuta muumini inahitajika (reason required)' using errcode = 'P0001';
  end if;

  perform set_config('minga.reattribute', 'on', true);
  update public.finance_transactions
     set payer_name = coalesce(nullif(btrim(payer_name), ''), per.full_name),
         family_id = coalesce(family_id, per.family_id),
         parishioner_id = null
   where parishioner_id = per.id;
  get diagnostics n_tx = row_count;
  perform set_config('minga.reattribute', 'off', true);

  for pl in select * from public.pledges where parishioner_id = per.id loop
    -- an active pledge whose new owner already has one for the campaign is closed
    if pl.status = 'active' and exists (
         select 1 from public.pledges x where x.campaign_id = pl.campaign_id and x.status = 'active' and x.id <> pl.id
           and coalesce(x.parishioner_id, x.family_id, x.org_unit_id) = coalesce(per.family_id, v_jum)) then
      update public.pledges set status = 'cancelled', status_reason = 'Muumini amefutwa kwenye rejista' where id = pl.id;
    end if;
    update public.pledges set parishioner_id = null,
           family_id = per.family_id,
           org_unit_id = case when per.family_id is null then v_jum end
     where id = pl.id;
    n_pl := n_pl + 1;
  end loop;

  update public.envelopes set parishioner_id = null, family_id = coalesce(family_id, per.family_id) where parishioner_id = per.id;
  update public.leadership_assignments set parishioner_id = null,
         status = 'ended', ends_on = case when status = 'active' then greatest(coalesce(starts_on, current_date), current_date) else ends_on end
   where parishioner_id = per.id;
  insert into public.audit_log (actor_id, action, table_name, row_id, old_data, note)
  values (auth.uid(), 'delete_parishioner', 'parishioners', per.id::text, to_jsonb(per) || jsonb_build_object('payments_kept', n_tx, 'pledges_moved', n_pl),
          btrim(p_reason));
  delete from public.parishioners where id = per.id;
  return jsonb_build_object('payments_kept', n_tx, 'pledges_moved', n_pl);
end $$;
revoke execute on function public.delete_parishioner(uuid, text) from public, anon;
grant execute on function public.delete_parishioner(uuid, text) to authenticated;

notify pgrst, 'reload schema';
