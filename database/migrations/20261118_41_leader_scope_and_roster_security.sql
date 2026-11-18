-- Keep leader logins and parish leadership entries tied to the right unit,
-- and limit the leadership directory to the viewer's authorized scope.

create or replace function public.check_user_role_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_scoped boolean;
  v_unit_type text;
  v_unit_parish uuid;
begin
  select scoped into v_scoped from public.parish_roles where code = new.role_code;
  if v_scoped and new.org_unit_id is null then
    raise exception 'Nafasi % inahitaji kuchagua kigango au jumuiya', new.role_code using errcode = 'P0001';
  end if;
  if not v_scoped and new.org_unit_id is not null then
    raise exception 'Nafasi % ni ya Parokia nzima; usichague eneo', new.role_code using errcode = 'P0001';
  end if;

  if v_scoped then
    select unit_type, parish_id into v_unit_type, v_unit_parish
      from public.org_units where id = new.org_unit_id and is_active;
    if not found then
      raise exception 'Eneo la nafasi hii halipo au halitumiki tena' using errcode = 'P0001';
    end if;
    if v_unit_parish is distinct from new.parish_id then
      raise exception 'Eneo la kiongozi lazima liwe ndani ya Parokia ya nafasi yake' using errcode = 'P0001';
    end if;
    if new.role_code = 'kigango_leader' and v_unit_type <> 'kigango' then
      raise exception 'Kiongozi wa Kigango lazima apewe Kigango, si Jumuiya' using errcode = 'P0001';
    end if;
    if new.role_code = 'jumuiya_leader' and v_unit_type <> 'jumuiya' then
      raise exception 'Kiongozi wa Jumuiya lazima apewe Jumuiya, si Kigango' using errcode = 'P0001';
    end if;
  end if;

  if new.role_code = 'parish_admin' and auth.uid() is not null and not public.is_platform_admin()
     and not exists (select 1 from public.parish_user_roles where user_id = auth.uid() and role_code = 'parish_admin') then
    raise exception 'Ni Msimamizi pekee anayeweza kutoa nafasi hii' using errcode = '42501';
  end if;
  new.granted_by := auth.uid();
  return new;
end $$;
revoke all on function public.check_user_role_scope() from public, anon, authenticated;

create or replace function public.check_leadership_assignment_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_level text;
  v_position_active boolean;
  v_unit_type text;
  v_unit_active boolean;
  v_unit_parish uuid;
  v_person_parish uuid;
begin
  select lp.level, lp.is_active, ou.unit_type, ou.is_active, ou.parish_id
    into v_level, v_position_active, v_unit_type, v_unit_active, v_unit_parish
    from public.leadership_positions lp
    cross join public.org_units ou
   where lp.id = new.position_id and ou.id = new.org_unit_id;
  if not found then
    raise exception 'Cheo au eneo la uongozi halipo' using errcode = 'P0001';
  end if;
  if new.status = 'active' and (not v_position_active or not v_unit_active) then
    raise exception 'Cheo au eneo hili halitumiki tena kwa uongozi mpya' using errcode = 'P0001';
  end if;
  if v_level <> v_unit_type then
    raise exception 'Ngazi ya cheo (%) lazima ilingane na ngazi ya eneo (%)', v_level, v_unit_type using errcode = 'P0001';
  end if;
  if new.parishioner_id is not null then
    select parish_id into v_person_parish from public.parishioners where id = new.parishioner_id;
    if not found or v_person_parish is distinct from v_unit_parish then
      raise exception 'Kiongozi aliyechaguliwa lazima awe muumini wa Parokia hii' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.check_leadership_assignment_scope() from public, anon, authenticated;

drop trigger if exists leadership_assignments_scope_check on public.leadership_assignments;
create trigger leadership_assignments_scope_check
before insert or update of position_id, org_unit_id, parishioner_id
on public.leadership_assignments
for each row execute function public.check_leadership_assignment_scope();

drop policy if exists leadership_read on public.leadership_assignments;
create policy leadership_read on public.leadership_assignments for select to authenticated
using (public.has_perm('registry.read', org_unit_id) or parishioner_id = (select public.my_parishioner_id()));
