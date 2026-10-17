-- ============================================================================
-- Minga Parish Management System — migration 17: simpler contribution rules
--   The form ticks who in a family is assigned (Baba, Mama, Mtoto, Mjukuu,
--   Wengine) with an amount each. "Pangia wote" now assigns ONLY the ticked
--   relationships; "WENGINE" covers everyone else (also people with no
--   relationship recorded). With nothing ticked, everyone gets the amount.
-- ============================================================================

create or replace function public.assign_campaign(p_campaign uuid, p_amount numeric default null, p_scope uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cp public.campaigns; n int := 0; skipped int := 0; v_amt numeric; r record;
  v_mult int; v_units uuid[]; v_rate numeric;
begin
  select * into cp from public.campaigns where id = p_campaign;
  if cp.id is null then raise exception 'Kampeni haipo' using errcode = 'P0001'; end if;
  if cp.status = 'closed' then raise exception 'Kampeni imefungwa' using errcode = 'P0001'; end if;
  if cp.giver_level is null then raise exception 'Weka kwanza "nani anatoa" kwenye kanuni za kampeni hii' using errcode = 'P0001'; end if;
  if not public.has_perm('finance.pledge', p_scope) then
    raise exception 'Huna ruhusa ya kupangia michango (permission denied)' using errcode = '42501';
  end if;
  if p_amount is not null and p_amount <= 0 then raise exception 'Kiasi lazima kiwe zaidi ya sifuri' using errcode = 'P0001'; end if;
  v_mult := case when cp.frequency = 'monthly' then 12 else 1 end;
  v_units := case when p_scope is null then null else public.units_within(p_scope) end;

  if cp.giver_level = 'parishioner' then
    for r in select p.id, p.relationship, p.jumuiya_id from public.parishioners p
              where p.parish_id = cp.parish_id and p.membership_status = 'active'
                and (v_units is null or p.jumuiya_id = any (v_units))
                and not exists (select 1 from public.pledges pl where pl.campaign_id = cp.id and pl.parishioner_id = p.id and pl.status = 'active')
    loop
      if cp.relation_rates <> '{}'::jsonb then
        -- only the relationships ticked on the form (Baba, Mama, Mtoto, … "Wengine" = everyone else)
        v_rate := coalesce((cp.relation_rates ->> upper(btrim(coalesce(r.relationship, ''))))::numeric,
                           (cp.relation_rates ->> 'WENGINE')::numeric);
        if v_rate is null then skipped := skipped + 1; continue; end if;
        v_amt := coalesce(p_amount, v_rate);
      else
        v_amt := coalesce(p_amount, cp.default_amount);
      end if;
      if v_amt is null or v_amt <= 0 then skipped := skipped + 1; continue; end if;
      insert into public.pledges (parish_id, campaign_id, parishioner_id, amount, jumuiya_id, kigango_id, source, created_by)
      values (cp.parish_id, cp.id, r.id, v_amt * v_mult, r.jumuiya_id, public.org_ancestor_of_type(r.jumuiya_id, 'kigango'), 'assigned', auth.uid());
      n := n + 1;
    end loop;
  elsif cp.giver_level = 'family' then
    v_amt := coalesce(p_amount, cp.default_amount);
    if v_amt is null then raise exception 'Weka kiasi cha kupangia kila familia' using errcode = 'P0001'; end if;
    for r in select f.id, f.jumuiya_id from public.families f
              where f.parish_id = cp.parish_id and f.status = 'active'
                and (v_units is null or f.jumuiya_id = any (v_units))
                and not exists (select 1 from public.pledges pl where pl.campaign_id = cp.id and pl.family_id = f.id and pl.status = 'active')
    loop
      insert into public.pledges (parish_id, campaign_id, family_id, amount, jumuiya_id, kigango_id, source, created_by)
      values (cp.parish_id, cp.id, r.id, v_amt * v_mult, r.jumuiya_id, public.org_ancestor_of_type(r.jumuiya_id, 'kigango'), 'assigned', auth.uid());
      n := n + 1;
    end loop;
  else
    v_amt := coalesce(p_amount, cp.default_amount);
    if v_amt is null then raise exception 'Weka kiasi cha kupangia kila %', cp.giver_level using errcode = 'P0001'; end if;
    for r in select o.id from public.org_units o
              where o.parish_id = cp.parish_id and o.unit_type = cp.giver_level and o.is_active
                and (v_units is null or o.id = any (v_units))
                and not exists (select 1 from public.pledges pl where pl.campaign_id = cp.id and pl.org_unit_id = o.id and pl.status = 'active')
    loop
      insert into public.pledges (parish_id, campaign_id, org_unit_id, amount, jumuiya_id, kigango_id, source, created_by)
      values (cp.parish_id, cp.id, r.id, v_amt * v_mult,
              case when cp.giver_level = 'jumuiya' then r.id end,
              public.org_ancestor_of_type(r.id, 'kigango'), 'assigned', auth.uid());
      n := n + 1;
    end loop;
  end if;

  insert into public.audit_log (actor_id, action, table_name, row_id, note)
  values (auth.uid(), 'assign_campaign', 'campaigns', cp.id::text,
          format('%s waliopangiwa (%s); kiasi %s; eneo %s', n, cp.giver_level, coalesce(p_amount::text, 'kanuni'), coalesce(p_scope::text, 'parokia')));
  return jsonb_build_object('status', 'assigned', 'created', n, 'skipped_no_rate', skipped);
end $$;
revoke execute on function public.assign_campaign(uuid, numeric, uuid) from public, anon;
grant execute on function public.assign_campaign(uuid, numeric, uuid) to authenticated;

notify pgrst, 'reload schema';
