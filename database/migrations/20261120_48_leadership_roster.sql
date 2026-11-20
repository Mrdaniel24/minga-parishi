-- Standard five leadership offices for each parish, kigango and jumuiya.
-- This directory of elected offices remains separate from system permissions.

insert into public.leadership_positions(code,title_sw,title_en,level,sort_order,is_active) values
  ('MWENYEKITI_PAROKIA','Mwenyekiti wa Parokia','Parish Chair','parish',70,true),
  ('MWENYEKITI_MSAIDIZI_PAROKIA','Mwenyekiti Msaidizi wa Parokia','Parish Vice Chair','parish',71,true),
  ('KATIBU_PAROKIA','Katibu wa Parokia','Parish Secretary','parish',72,true),
  ('KATIBU_MSAIDIZI_PAROKIA','Katibu Msaidizi wa Parokia','Assistant Parish Secretary','parish',73,true),
  ('MWASIBU_PAROKIA','Mwasibu wa Parokia','Parish Accountant','parish',74,true),
  ('MWENYEKITI_KIGANGO','Mwenyekiti wa Kigango','Kigango Chair','kigango',170,true),
  ('MWENYEKITI_MSAIDIZI_KIGANGO','Mwenyekiti Msaidizi wa Kigango','Kigango Vice Chair','kigango',171,true),
  ('KATIBU_KIGANGO','Katibu wa Kigango','Kigango Secretary','kigango',172,true),
  ('KATIBU_MSAIDIZI_KIGANGO','Katibu Msaidizi wa Kigango','Assistant Kigango Secretary','kigango',173,true),
  ('MWASIBU_KIGANGO','Mwasibu wa Kigango','Kigango Accountant','kigango',174,true),
  ('MWENYEKITI_JUMUIYA','Mwenyekiti wa Jumuiya','Jumuiya Chair','jumuiya',270,true),
  ('MWENYEKITI_MSAIDIZI_JUMUIYA','Mwenyekiti Msaidizi wa Jumuiya','Jumuiya Vice Chair','jumuiya',271,true),
  ('KATIBU_JUMUIYA','Katibu wa Jumuiya','Jumuiya Secretary','jumuiya',272,true),
  ('KATIBU_MSAIDIZI_JUMUIYA','Katibu Msaidizi wa Jumuiya','Assistant Jumuiya Secretary','jumuiya',273,true),
  ('MWASIBU_JUMUIYA','Mwasibu wa Jumuiya','Jumuiya Accountant','jumuiya',274,true)
on conflict(code) do update set title_sw=excluded.title_sw,title_en=excluded.title_en,
  level=excluded.level,sort_order=excluded.sort_order,is_active=true;

-- Keep only the five offices requested at each level. Remove old office
-- definitions and their old assignments so they do not appear as alternatives.
delete from public.leadership_assignments la
using public.leadership_positions lp
where la.position_id=lp.id and lp.code not in (
  'MWENYEKITI_PAROKIA','MWENYEKITI_MSAIDIZI_PAROKIA','KATIBU_PAROKIA','KATIBU_MSAIDIZI_PAROKIA','MWASIBU_PAROKIA',
  'MWENYEKITI_KIGANGO','MWENYEKITI_MSAIDIZI_KIGANGO','KATIBU_KIGANGO','KATIBU_MSAIDIZI_KIGANGO','MWASIBU_KIGANGO',
  'MWENYEKITI_JUMUIYA','MWENYEKITI_MSAIDIZI_JUMUIYA','KATIBU_JUMUIYA','KATIBU_MSAIDIZI_JUMUIYA','MWASIBU_JUMUIYA'
);
delete from public.leadership_positions where code not in (
  'MWENYEKITI_PAROKIA','MWENYEKITI_MSAIDIZI_PAROKIA','KATIBU_PAROKIA','KATIBU_MSAIDIZI_PAROKIA','MWASIBU_PAROKIA',
  'MWENYEKITI_KIGANGO','MWENYEKITI_MSAIDIZI_KIGANGO','KATIBU_KIGANGO','KATIBU_MSAIDIZI_KIGANGO','MWASIBU_KIGANGO',
  'MWENYEKITI_JUMUIYA','MWENYEKITI_MSAIDIZI_JUMUIYA','KATIBU_JUMUIYA','KATIBU_MSAIDIZI_JUMUIYA','MWASIBU_JUMUIYA'
);

create or replace function public.save_unit_leadership(p_unit uuid,p_assignments jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  u public.org_units;
  v_codes text[];
  v_required uuid[];
  v_seen uuid[] := '{}'::uuid[];
  v_seen_positions uuid[] := '{}'::uuid[];
  a jsonb;
  v_position uuid;
  v_person uuid;
  v_code text;
  v_name text;
  v_phone text;
  v_jum uuid;
  v_saved int := 0;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and coalesce(status,'active')='active') then
    raise exception 'Ingia kwenye akaunti hai kwanza' using errcode='42501';
  end if;
  if not public.has_perm('registry.write',p_unit) then raise exception 'Huna ruhusa ya kusimamia viongozi wa eneo hili' using errcode='42501'; end if;
  select * into u from public.org_units where id=p_unit and is_active and unit_type in ('parish','kigango','jumuiya');
  if u.id is null then raise exception 'Chagua Parokia, Kigango au Jumuiya hai' using errcode='P0001'; end if;
  v_codes:=case u.unit_type
    when 'parish' then array['MWENYEKITI_PAROKIA','MWENYEKITI_MSAIDIZI_PAROKIA','KATIBU_PAROKIA','KATIBU_MSAIDIZI_PAROKIA','MWASIBU_PAROKIA']
    when 'kigango' then array['MWENYEKITI_KIGANGO','MWENYEKITI_MSAIDIZI_KIGANGO','KATIBU_KIGANGO','KATIBU_MSAIDIZI_KIGANGO','MWASIBU_KIGANGO']
    else array['MWENYEKITI_JUMUIYA','MWENYEKITI_MSAIDIZI_JUMUIYA','KATIBU_JUMUIYA','KATIBU_MSAIDIZI_JUMUIYA','MWASIBU_JUMUIYA'] end;
  if jsonb_typeof(p_assignments)<>'array' or jsonb_array_length(p_assignments)<>5 then
    raise exception 'Weka viongozi wote watano wa ngazi hii' using errcode='P0001';
  end if;
  select array_agg(id) into v_required from public.leadership_positions where code=any(v_codes) and is_active;
  if cardinality(v_required)<>5 then raise exception 'Nafasi za uongozi hazijakamilika kwenye mfumo' using errcode='P0001'; end if;

  for a in select value from jsonb_array_elements(p_assignments) loop
    v_position:=nullif(a->>'position_id','')::uuid;
    v_person:=nullif(a->>'parishioner_id','')::uuid;
    select code into v_code from public.leadership_positions where id=v_position and is_active and id=any(v_required);
    if v_code is null then raise exception 'Nafasi haipo au haiendani na ngazi hii' using errcode='P0001'; end if;
    if v_position=any(v_seen_positions) then raise exception 'Nafasi imerudiwa' using errcode='P0001'; end if;
    v_seen_positions:=array_append(v_seen_positions,v_position);
    if v_person is null or v_person=any(v_seen) then raise exception 'Chagua waumini watano tofauti' using errcode='P0001'; end if;
    v_seen:=array_append(v_seen,v_person);
    select full_name,phone,coalesce(jumuiya_id,(select jumuiya_id from public.families where id=parishioners.family_id))
      into v_name,v_phone,v_jum from public.parishioners where id=v_person and parish_id=u.parish_id and membership_status='active';
    if v_name is null then raise exception 'Muumini hayupo, si hai au anatoka Parokia nyingine' using errcode='P0001'; end if;
    if u.unit_type='jumuiya' and v_jum is distinct from u.id then raise exception 'Muumini lazima awe wa Jumuiya iliyochaguliwa' using errcode='P0001'; end if;
    if u.unit_type='kigango' and not exists(select 1 from public.org_units j where j.id=v_jum and j.parent_id=u.id and j.unit_type='jumuiya' and j.is_active) then
      raise exception 'Muumini lazima awe wa Kigango kilichochaguliwa' using errcode='P0001';
    end if;
  end loop;
  if cardinality(v_seen)<>5 or cardinality(v_seen_positions)<>5
     or not (v_seen_positions @> v_required and v_seen_positions <@ v_required) then
    raise exception 'Jaza nafasi tano zote bila kurudia cheo' using errcode='P0001';
  end if;

  update public.leadership_assignments set status='ended',ends_on=current_date
   where org_unit_id=p_unit and position_id=any(v_required) and status='active';
  for a in select value from jsonb_array_elements(p_assignments) loop
    v_position:=(a->>'position_id')::uuid; v_person:=(a->>'parishioner_id')::uuid;
    select full_name,phone into v_name,v_phone from public.parishioners where id=v_person;
    insert into public.leadership_assignments(position_id,org_unit_id,parishioner_id,holder_name,phone,starts_on,status)
    values(v_position,p_unit,v_person,v_name,v_phone,current_date,'active');
    v_saved:=v_saved+1;
  end loop;
  insert into public.audit_log(actor_id,action,table_name,row_id,new_data)
    values(auth.uid(),'save_unit_leadership','leadership_assignments',p_unit::text,jsonb_build_object('unit_id',p_unit,'assignments',p_assignments));
  return jsonb_build_object('status','saved','count',v_saved);
end $$;
revoke all on function public.save_unit_leadership(uuid,jsonb) from public,anon;
grant execute on function public.save_unit_leadership(uuid,jsonb) to authenticated;

notify pgrst,'reload schema';
