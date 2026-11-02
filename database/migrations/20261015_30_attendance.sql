-- ============================================================================
-- Minga Parish Management System — migration 30: attendance in the jumuiya
--   The jumuiya leader records who came to each gathering (sala ya jumuiya,
--   mkutano…): one session per date, and for every member present / absent /
--   excused (ruhusa). Leaders and parish staff see each member's attendance
--   rate for the year.
--   Recording needs attendance.record in that jumuiya (jumuiya and kigango
--   leaders, parish administrator, karani); reading needs registry.read there.
-- ============================================================================

insert into public.role_permissions (role_code, permission)
select r, 'attendance.record' from unnest(array['parish_admin', 'kigango_leader', 'jumuiya_leader', 'data_entry']) r
on conflict do nothing;

create table if not exists public.attendance_sessions (
  id           uuid primary key default gen_random_uuid(),
  parish_id    uuid not null references public.parishes(id),
  org_unit_id  uuid not null references public.org_units(id),
  held_on      date not null,
  title        text not null default 'Sala ya jumuiya',
  notes        text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_unit_id, held_on, title)
);
create index if not exists attendance_sessions_unit_idx on public.attendance_sessions (org_unit_id, held_on desc);

create table if not exists public.attendance_marks (
  session_id      uuid not null references public.attendance_sessions(id) on delete cascade,
  parishioner_id  uuid not null references public.parishioners(id) on delete cascade,
  status          text not null check (status in ('present', 'absent', 'excused')),
  primary key (session_id, parishioner_id)
);
create index if not exists attendance_marks_person_idx on public.attendance_marks (parishioner_id);

alter table public.attendance_sessions enable row level security;
alter table public.attendance_marks enable row level security;
grant select on public.attendance_sessions, public.attendance_marks to authenticated;

drop policy if exists attendance_sessions_read on public.attendance_sessions;
create policy attendance_sessions_read on public.attendance_sessions for select to authenticated
  using ((select public.has_perm('registry.read')) or public.has_perm('registry.read', org_unit_id) or public.has_perm('attendance.record', org_unit_id));
drop policy if exists attendance_marks_read on public.attendance_marks;
create policy attendance_marks_read on public.attendance_marks for select to authenticated
  using (exists (select 1 from public.attendance_sessions s where s.id = session_id)
         or parishioner_id = (select public.my_parishioner_id()));
-- writes only through save_attendance / delete_attendance

-- p: id (to edit), org_unit_id, held_on, title, notes, marks: [{parishioner_id, status}]
create or replace function public.save_attendance(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_unit uuid := nullif(p->>'org_unit_id', '')::uuid;
  v_date date := coalesce(nullif(p->>'held_on', '')::date, current_date);
  v_title text := coalesce(nullif(btrim(p->>'title'), ''), 'Sala ya jumuiya');
  m jsonb;
  n int := 0;
begin
  if v_id is not null then
    select org_unit_id into v_unit from public.attendance_sessions where id = v_id;
    if not found then raise exception 'Mahudhurio hayo hayapo' using errcode = 'P0001'; end if;
  end if;
  if v_unit is null or not exists (select 1 from public.org_units where id = v_unit and unit_type = 'jumuiya') then
    raise exception 'Chagua jumuiya' using errcode = 'P0001';
  end if;
  if not public.has_perm('attendance.record', v_unit) then
    raise exception 'Ni kiongozi wa jumuiya hii anayeweza kujaza mahudhurio (permission denied)' using errcode = '42501';
  end if;
  if v_date > current_date then raise exception 'Tarehe ya mahudhurio haiwezi kuwa ya baadaye' using errcode = 'P0001'; end if;

  if v_id is null then
    insert into public.attendance_sessions (parish_id, org_unit_id, held_on, title, notes, created_by)
    values (public.default_parish_id(), v_unit, v_date, v_title, nullif(btrim(p->>'notes'), ''), auth.uid())
    on conflict (org_unit_id, held_on, title) do update set notes = excluded.notes, updated_at = now()
    returning id into v_id;
  else
    update public.attendance_sessions set held_on = v_date, title = v_title, notes = nullif(btrim(p->>'notes'), ''), updated_at = now()
     where id = v_id;
  end if;

  delete from public.attendance_marks where session_id = v_id;
  for m in select * from jsonb_array_elements(coalesce(p->'marks', '[]'::jsonb)) loop
    if not exists (select 1 from public.parishioners where id = (m->>'parishioner_id')::uuid and jumuiya_id = v_unit) then
      raise exception 'Muumini si wa jumuiya hii' using errcode = 'P0001';
    end if;
    insert into public.attendance_marks (session_id, parishioner_id, status)
    values (v_id, (m->>'parishioner_id')::uuid, coalesce(nullif(m->>'status', ''), 'present'))
    on conflict (session_id, parishioner_id) do update set status = excluded.status;
    n := n + 1;
  end loop;
  return jsonb_build_object('id', v_id, 'marks', n);
end $$;
revoke execute on function public.save_attendance(jsonb) from public, anon;
grant execute on function public.save_attendance(jsonb) to authenticated;

create or replace function public.delete_attendance(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_unit uuid;
begin
  select org_unit_id into v_unit from public.attendance_sessions where id = p_id;
  if v_unit is null then raise exception 'Mahudhurio hayo hayapo' using errcode = 'P0001'; end if;
  if not public.has_perm('attendance.record', v_unit) then
    raise exception 'Huna ruhusa (permission denied)' using errcode = '42501';
  end if;
  delete from public.attendance_sessions where id = p_id;
  return jsonb_build_object('status', 'deleted');
end $$;
revoke execute on function public.delete_attendance(uuid) from public, anon;
grant execute on function public.delete_attendance(uuid) to authenticated;

-- each member of a jumuiya with their attendance in a year (caller's rights)
create or replace function public.attendance_summary(p_unit uuid, p_year int)
returns table (parishioner_id uuid, full_name text, family_id uuid, sessions int, present int, excused int, absent int, rate numeric)
language sql stable security invoker set search_path = public as $$
  with s as (
    select id from public.attendance_sessions
     where org_unit_id = p_unit and extract(year from held_on) = p_year
  )
  select p.id, p.full_name, p.family_id,
         (select count(*) from s)::int,
         count(*) filter (where m.status = 'present')::int,
         count(*) filter (where m.status = 'excused')::int,
         ((select count(*) from s) - count(*) filter (where m.status in ('present', 'excused')))::int,
         case when (select count(*) from s) = 0 then null
              else round(100.0 * count(*) filter (where m.status = 'present') / (select count(*) from s), 0) end
    from public.parishioners p
    left join public.attendance_marks m on m.parishioner_id = p.id and m.session_id in (select id from s)
   where p.jumuiya_id = p_unit and p.membership_status = 'active'
   group by p.id
   order by p.full_name
$$;
revoke execute on function public.attendance_summary(uuid, int) from public, anon;
grant execute on function public.attendance_summary(uuid, int) to authenticated;

notify pgrst, 'reload schema';
