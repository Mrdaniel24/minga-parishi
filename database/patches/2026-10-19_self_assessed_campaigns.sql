-- ============================================================================
-- Minga Parish Management System — migration 20: open contribution targets
-- A contribution may be recorded for a jumuiya without fixing its amount.
-- In that case target_amount remains zero, but the target row keeps the
-- contribution visible so the jumuiya can decide what to give.
-- ============================================================================

alter table public.campaign_targets
  add column if not exists self_assessed boolean not null default false;

-- Keep the existing zero-means-remove behavior unless the form explicitly
-- marks this as an open contribution for the community to decide.
create or replace function public.set_unit_target(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_unit public.org_units; v_cat public.contribution_categories; v_camp public.campaigns;
  v_year int; v_name text; v_amount numeric; v_id uuid; v_old public.campaign_targets;
  v_self_assessed boolean := coalesce((p->>'self_assessed')::boolean, false);
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
              v_year, v_name, make_date(v_year, 1, 1), make_date(v_year, 12, 31), 'jumuiya',
              case when v_self_assessed then 'free' else 'assigned' end, 'yearly')
      returning * into v_camp;
    end if;
  end if;
  v_amount := coalesce(nullif(p->>'amount', '')::numeric, 0);
  if v_self_assessed then v_amount := 0; end if;
  select * into v_old from public.campaign_targets where campaign_id = v_camp.id and org_unit_id = v_unit.id;
  if v_amount = 0 and not v_self_assessed then
    if v_old.id is not null then
      delete from public.campaign_targets where id = v_old.id;
      insert into public.audit_log (actor_id, action, table_name, row_id, old_data)
      values (auth.uid(), 'remove_unit_target', 'campaign_targets', v_old.id::text, to_jsonb(v_old));
    end if;
    return jsonb_build_object('status', 'removed', 'campaign_id', v_camp.id);
  end if;
  if v_amount < 0 then raise exception 'Kiasi si sahihi' using errcode = 'P0001'; end if;
  insert into public.campaign_targets (campaign_id, org_unit_id, basis, fixed_amount, starts_on, due_on, notes, created_by, self_assessed)
  values (v_camp.id, v_unit.id, 'fixed', v_amount, (p->>'starts_on')::date, (p->>'due_on')::date, nullif(p->>'notes', ''), auth.uid(), v_self_assessed)
  on conflict (campaign_id, org_unit_id) do update
     set basis = 'fixed', fixed_amount = excluded.fixed_amount, unit_count = null, unit_rate = null,
         starts_on = excluded.starts_on, due_on = excluded.due_on, notes = excluded.notes,
         self_assessed = excluded.self_assessed
  returning id into v_id;
  insert into public.audit_log (actor_id, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), 'set_unit_target', 'campaign_targets', v_id::text, to_jsonb(v_old), p);
  return jsonb_build_object('status', 'saved', 'campaign_id', v_camp.id, 'target_id', v_id, 'self_assessed', v_self_assessed);
end $$;

-- An open target should not switch a free-giving campaign into assigned mode.
create or replace function public.campaign_targets_rules() returns trigger language plpgsql set search_path = public as $$
begin
  if new.self_assessed then return new; end if;
  update public.campaigns cp set giver_level = 'jumuiya', amount_mode = 'assigned'
   where cp.id = new.campaign_id and (cp.giver_level is null or cp.amount_mode = 'free')
     and exists (select 1 from public.org_units o where o.id = new.org_unit_id and o.unit_type in ('jumuiya', 'group'))
     and not exists (select 1 from public.pledges pl where pl.campaign_id = cp.id);
  return new;
end $$;

drop trigger if exists campaign_targets_rules on public.campaign_targets;
create trigger campaign_targets_rules after insert on public.campaign_targets for each row execute function public.campaign_targets_rules();

revoke execute on function public.set_unit_target(jsonb) from public, anon;
grant execute on function public.set_unit_target(jsonb) to authenticated;
notify pgrst, 'reload schema';

