-- Let community totals come from the amount manually entered or from lower-level pledges.
alter table public.campaign_targets add column if not exists target_source text not null default 'manual';
alter table public.campaign_targets drop constraint if exists campaign_targets_target_source_check;
alter table public.campaign_targets add constraint campaign_targets_target_source_check check(target_source in ('manual','families','parishioners'));

create or replace function public.campaign_target_source_sum(p_campaign uuid,p_unit uuid,p_source text)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce(sum(pl.amount),0)::numeric(14,2)
    from public.pledges pl
    left join public.families f on f.id=pl.family_id
    left join public.parishioners m on m.id=pl.parishioner_id
   where pl.campaign_id=p_campaign and pl.status='active'
     and ((p_source='families' and pl.family_id is not null and coalesce(pl.jumuiya_id,f.jumuiya_id)=p_unit)
       or (p_source='parishioners' and pl.parishioner_id is not null and coalesce(pl.jumuiya_id,m.jumuiya_id)=p_unit))
$$;
revoke all on function public.campaign_target_source_sum(uuid,uuid,text) from public,anon,authenticated;

create or replace function public.refresh_campaign_target_source(p_campaign uuid,p_unit uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.campaign_targets ct set fixed_amount=public.campaign_target_source_sum(ct.campaign_id,ct.org_unit_id,ct.target_source)
   where ct.campaign_id=p_campaign and ct.org_unit_id=p_unit and ct.target_source in ('families','parishioners');
end $$;
revoke all on function public.refresh_campaign_target_source(uuid,uuid) from public,anon,authenticated;

create or replace function public.campaign_target_source_rules()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.target_source in ('families','parishioners') then
    new.basis:='fixed';
    new.fixed_amount:=public.campaign_target_source_sum(new.campaign_id,new.org_unit_id,new.target_source);
    new.unit_count:=null; new.unit_rate:=null;
  end if;
  return new;
end $$;
drop trigger if exists campaign_target_source_rules on public.campaign_targets;
create trigger campaign_target_source_rules before insert or update of campaign_id,org_unit_id,target_source,fixed_amount,basis on public.campaign_targets
for each row execute function public.campaign_target_source_rules();

create or replace function public.pledges_refresh_campaign_target_source()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op in ('UPDATE','DELETE') then perform public.refresh_campaign_target_source(old.campaign_id,coalesce(old.jumuiya_id,old.org_unit_id)); end if;
  if tg_op in ('INSERT','UPDATE') then perform public.refresh_campaign_target_source(new.campaign_id,coalesce(new.jumuiya_id,new.org_unit_id)); end if;
  return null;
end $$;
drop trigger if exists pledges_refresh_campaign_target_source on public.pledges;
create trigger pledges_refresh_campaign_target_source after insert or update or delete on public.pledges
for each row execute function public.pledges_refresh_campaign_target_source();
create or replace function public.set_unit_target(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_unit public.org_units; v_cat public.contribution_categories; v_camp public.campaigns;
  v_year int; v_name text; v_amount numeric; v_id uuid; v_old public.campaign_targets;
  v_target_source text := coalesce(nullif(p->>'target_source',''),'manual');
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
  v_target_source := coalesce(nullif(p->>'target_source',''),'manual');
  if v_target_source not in ('manual','families','parishioners') then raise exception 'Chagua chanzo cha jumla ya mgao' using errcode='P0001'; end if;
  if v_self_assessed and v_target_source<>'manual' then raise exception 'Mgao wa hiari hauchanganywi na chanzo cha jumla' using errcode='P0001'; end if;
  v_amount := coalesce(nullif(p->>'amount', '')::numeric, 0);
  if v_self_assessed then v_amount := 0; end if;
  select * into v_old from public.campaign_targets where campaign_id = v_camp.id and org_unit_id = v_unit.id;
  if v_amount = 0 and not v_self_assessed and v_target_source='manual' then
    if v_old.id is not null then
      delete from public.campaign_targets where id = v_old.id;
      insert into public.audit_log (actor_id, action, table_name, row_id, old_data)
      values (auth.uid(), 'remove_unit_target', 'campaign_targets', v_old.id::text, to_jsonb(v_old));
    end if;
    return jsonb_build_object('status', 'removed', 'campaign_id', v_camp.id);
  end if;
  if v_amount < 0 then raise exception 'Kiasi si sahihi' using errcode = 'P0001'; end if;
  insert into public.campaign_targets (campaign_id, org_unit_id, basis, fixed_amount, starts_on, due_on, notes, created_by, self_assessed, target_source)
  values (v_camp.id, v_unit.id, 'fixed', v_amount, (p->>'starts_on')::date, (p->>'due_on')::date, nullif(p->>'notes', ''), auth.uid(), v_self_assessed, v_target_source)
  on conflict (campaign_id, org_unit_id) do update
     set basis = 'fixed', fixed_amount = excluded.fixed_amount, unit_count = null, unit_rate = null,
         starts_on = excluded.starts_on, due_on = excluded.due_on, notes = excluded.notes,
         self_assessed = excluded.self_assessed, target_source = excluded.target_source
  returning id into v_id;
  insert into public.audit_log (actor_id, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), 'set_unit_target', 'campaign_targets', v_id::text, to_jsonb(v_old), p);
  return jsonb_build_object('status', 'saved', 'campaign_id', v_camp.id, 'target_id', v_id, 'self_assessed', v_self_assessed);
end $$;
revoke all on function public.set_unit_target(jsonb) from public,anon;
grant execute on function public.set_unit_target(jsonb) to authenticated;
notify pgrst,'reload schema';


