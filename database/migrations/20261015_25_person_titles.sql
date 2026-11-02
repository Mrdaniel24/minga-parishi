-- ============================================================================
-- Minga Parish Management System — migration 25: titles (vyeo) in the register
--   The system administrator keeps the list of titles (Katibu, Mwenyekiti,
--   Mhazini…, migration 06 seeds the usual ones). When a member is registered
--   or edited, any number of titles can be given to them: each one is a
--   leadership assignment in the member's own jumuiya (or its kigango, or the
--   parish, by the title's level). A title taken away is ended, not deleted.
-- ============================================================================

alter table public.leadership_positions add column if not exists is_active boolean not null default true;
grant select, insert, update, delete on public.leadership_positions to authenticated;   -- RLS: parish.configure writes

-- the unit a title of this level is held in, for a member of p_jumuiya
create or replace function public.title_unit(p_level text, p_jumuiya uuid)
returns uuid language sql stable set search_path = public as $$
  select case p_level
           when 'jumuiya' then p_jumuiya
           when 'kigango' then public.org_ancestor_of_type(p_jumuiya, 'kigango')
           when 'parish'  then (select id from public.org_units where unit_type = 'parish' order by created_at limit 1)
         end
$$;

-- set the titles a member holds: p_positions is the full list (others are ended today)
create or replace function public.set_person_titles(p_parishioner uuid, p_positions uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  per public.parishioners;
  pos public.leadership_positions;
  a record;
  v_unit uuid;
  n_add int := 0; n_end int := 0;
begin
  select * into per from public.parishioners where id = p_parishioner;
  if per.id is null then raise exception 'Muumini hayupo' using errcode = 'P0001'; end if;
  p_positions := coalesce(p_positions, '{}');

  -- titles taken away
  for a in select la.id, la.org_unit_id from public.leadership_assignments la
            where la.parishioner_id = per.id and la.status = 'active' and la.position_id <> all (p_positions) loop
    if not public.has_perm('registry.write', a.org_unit_id) then
      raise exception 'Huna ruhusa ya kubadilisha cheo hiki (permission denied)' using errcode = '42501';
    end if;
    update public.leadership_assignments set status = 'ended', ends_on = greatest(coalesce(starts_on, current_date), current_date) where id = a.id;
    n_end := n_end + 1;
  end loop;

  -- titles given
  for pos in select * from public.leadership_positions where id = any (p_positions) loop
    continue when exists (select 1 from public.leadership_assignments
                           where parishioner_id = per.id and position_id = pos.id and status = 'active');
    if not pos.is_active then raise exception 'Cheo "%" hakitumiki tena', pos.title_sw using errcode = 'P0001'; end if;
    v_unit := public.title_unit(pos.level, per.jumuiya_id);
    if v_unit is null then
      raise exception 'Cheo "%" kinahitaji muumini awe kwenye jumuiya', pos.title_sw using errcode = 'P0001';
    end if;
    if not public.has_perm('registry.write', v_unit) then
      raise exception 'Huna ruhusa ya kutoa cheo "%" (permission denied)', pos.title_sw using errcode = '42501';
    end if;
    insert into public.leadership_assignments (position_id, org_unit_id, parishioner_id, holder_name, phone, starts_on, status)
    values (pos.id, v_unit, per.id, per.full_name, per.phone, current_date, 'active');
    n_add := n_add + 1;
  end loop;
  return jsonb_build_object('added', n_add, 'ended', n_end);
end $$;
revoke execute on function public.set_person_titles(uuid, uuid[]) from public, anon;
grant execute on function public.set_person_titles(uuid, uuid[]) to authenticated;

-- a title can be deleted only while nobody has ever held it; otherwise it is switched off
create or replace function public.delete_leadership_position(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('parish.configure') then
    raise exception 'Huna ruhusa (permission denied)' using errcode = '42501';
  end if;
  if exists (select 1 from public.leadership_assignments where position_id = p_id) then
    update public.leadership_positions set is_active = false where id = p_id;
    return jsonb_build_object('status', 'deactivated');
  end if;
  delete from public.leadership_positions where id = p_id;
  return jsonb_build_object('status', 'deleted');
end $$;
revoke execute on function public.delete_leadership_position(uuid) from public, anon;
grant execute on function public.delete_leadership_position(uuid) to authenticated;

notify pgrst, 'reload schema';
