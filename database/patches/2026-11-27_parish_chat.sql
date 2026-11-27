-- Chat ya parokia, vigango na jumuiya.
-- Run once in Supabase SQL Editor after reviewing. Existing parish records remain unchanged.

create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete cascade,
  org_unit_id uuid references public.org_units(id) on delete cascade,
  scope_type text not null check (scope_type in ('parish','kigango','jumuiya')),
  title text not null,
  created_at timestamptz not null default now(),
  constraint chat_room_scope_matches check (
    (scope_type = 'parish' and org_unit_id is null) or
    (scope_type in ('kigango','jumuiya') and org_unit_id is not null)
  )
);
create unique index if not exists chat_rooms_parish_scope_uq on public.chat_rooms(parish_id) where org_unit_id is null;
create unique index if not exists chat_rooms_unit_scope_uq on public.chat_rooms(parish_id,org_unit_id) where org_unit_id is not null;
create index if not exists chat_rooms_parish_type_idx on public.chat_rooms(parish_id,scope_type,title);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  parish_id uuid not null references public.parishes(id) on delete cascade,
  org_unit_id uuid references public.org_units(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  sender_name text not null,
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_room_time_idx on public.chat_messages(room_id,created_at desc);
create index if not exists chat_messages_parish_time_idx on public.chat_messages(parish_id,created_at desc);

alter table public.chat_rooms enable row level security;
alter table public.chat_messages enable row level security;
revoke all on public.chat_rooms, public.chat_messages from anon;
grant select on public.chat_rooms to authenticated;
grant select,insert on public.chat_messages to authenticated;

create or replace function public.chat_can_access(p_parish_id uuid,p_room_unit_id uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles pr where pr.id=auth.uid() and coalesce(pr.status,'active')='active'
  ) and (
    public.is_platform_admin() or
    exists(select 1 from public.parish_user_roles ur
      where ur.user_id=auth.uid() and ur.parish_id=p_parish_id
        and (p_room_unit_id is null or ur.org_unit_id is null or public.org_is_within(p_room_unit_id,ur.org_unit_id)
          or public.org_is_within(ur.org_unit_id,p_room_unit_id))) or
    exists(select 1 from public.parishioners m
      where m.profile_id=auth.uid() and m.parish_id=p_parish_id and m.membership_status='active'
        and (p_room_unit_id is null or (coalesce(m.jumuiya_id,(select f.jumuiya_id from public.families f where f.id=m.family_id)) is not null
          and public.org_is_within(coalesce(m.jumuiya_id,(select f.jumuiya_id from public.families f where f.id=m.family_id)),p_room_unit_id))))
  )
$$;
revoke all on function public.chat_can_access(uuid,uuid) from public,anon;
grant execute on function public.chat_can_access(uuid,uuid) to authenticated;

drop policy if exists chat_rooms_read on public.chat_rooms;
create policy chat_rooms_read on public.chat_rooms for select to authenticated
  using (public.chat_can_access(parish_id,org_unit_id));
drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages for select to authenticated
  using (public.chat_can_access(parish_id,org_unit_id));
drop policy if exists chat_messages_send on public.chat_messages;
create policy chat_messages_send on public.chat_messages for insert to authenticated
  with check (sender_id=auth.uid() and public.chat_can_access(parish_id,org_unit_id));

create or replace function public.chat_prepare_message()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare r public.chat_rooms; v_name text;
begin
  if auth.uid() is null then raise exception 'Ingia kwanza kutuma ujumbe' using errcode='42501'; end if;
  select * into r from public.chat_rooms where id=new.room_id;
  if r.id is null or not public.chat_can_access(r.parish_id,r.org_unit_id) then
    raise exception 'Huna ruhusa ya kutuma ujumbe katika eneo hili' using errcode='42501';
  end if;
  select nullif(btrim(full_name),'') into v_name from public.profiles where id=auth.uid();
  new.parish_id:=r.parish_id;
  new.org_unit_id:=r.org_unit_id;
  new.sender_id:=auth.uid();
  new.sender_name:=coalesce(v_name,'Muumini');
  new.body:=btrim(new.body);
  new.created_at:=now();
  return new;
end $$;
revoke all on function public.chat_prepare_message() from public,anon,authenticated;
drop trigger if exists chat_prepare_message on public.chat_messages;
create trigger chat_prepare_message before insert on public.chat_messages
  for each row execute function public.chat_prepare_message();

create or replace function public.chat_create_parish_room()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.chat_rooms(parish_id,org_unit_id,scope_type,title)
  values(new.id,null,'parish',coalesce(nullif(new.short_name,''),new.official_name,'Parokia'))
  on conflict (parish_id) where org_unit_id is null do update set title=excluded.title;
  return new;
end $$;
revoke all on function public.chat_create_parish_room() from public,anon,authenticated;
drop trigger if exists chat_create_parish_room on public.parishes;
create trigger chat_create_parish_room after insert or update of official_name,short_name on public.parishes
  for each row execute function public.chat_create_parish_room();

create or replace function public.chat_create_unit_room()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.unit_type in ('kigango','jumuiya') and new.is_active then
    insert into public.chat_rooms(parish_id,org_unit_id,scope_type,title)
    values(new.parish_id,new.id,new.unit_type,
      case new.unit_type when 'kigango' then 'Kigango cha '||new.name else 'Jumuiya ya '||new.name end)
    on conflict (parish_id,org_unit_id) where org_unit_id is not null do update set title=excluded.title;
  end if;
  return new;
end $$;
revoke all on function public.chat_create_unit_room() from public,anon,authenticated;
drop trigger if exists chat_create_unit_room on public.org_units;
create trigger chat_create_unit_room after insert or update of name,is_active,unit_type on public.org_units
  for each row execute function public.chat_create_unit_room();

insert into public.chat_rooms(parish_id,org_unit_id,scope_type,title)
select p.id,null,'parish',coalesce(nullif(p.short_name,''),p.official_name,'Parokia') from public.parishes p
on conflict (parish_id) where org_unit_id is null do update set title=excluded.title;
insert into public.chat_rooms(parish_id,org_unit_id,scope_type,title)
select u.parish_id,u.id,u.unit_type,
  case u.unit_type when 'kigango' then 'Kigango cha '||u.name else 'Jumuiya ya '||u.name end
from public.org_units u where u.is_active and u.unit_type in ('kigango','jumuiya')
on conflict (parish_id,org_unit_id) where org_unit_id is not null do update set title=excluded.title;

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_messages') then
      alter publication supabase_realtime add table public.chat_messages;
    end if;
  end if;
end $$;
