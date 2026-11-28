-- Private family and one-to-one chat rooms.
-- Run after 2026-11-27_parish_chat.sql in Supabase SQL Editor.
-- No existing parish/unit chat messages or rooms are deleted.

alter table public.chat_rooms add column if not exists family_id uuid references public.families(id) on delete cascade;
alter table public.chat_rooms add column if not exists person_key text;
alter table public.chat_messages add column if not exists family_id uuid references public.families(id) on delete cascade;
alter table public.chat_messages add column if not exists person_key text;
-- The original table also has a generated CHECK on scope_type; widen it for private scopes.
alter table public.chat_rooms drop constraint if exists chat_rooms_scope_type_check;
alter table public.chat_rooms add constraint chat_rooms_scope_type_check
  check (scope_type in ('parish','kigango','jumuiya','family','person'));
alter table public.chat_rooms drop constraint if exists chat_room_scope_matches;
alter table public.chat_rooms add constraint chat_room_scope_matches check (
  (scope_type = 'parish' and org_unit_id is null and family_id is null and person_key is null) or
  (scope_type in ('kigango','jumuiya') and org_unit_id is not null and family_id is null and person_key is null) or
  (scope_type = 'family' and org_unit_id is null and family_id is not null and person_key is null) or
  (scope_type = 'person' and org_unit_id is null and family_id is null and person_key is not null)
);
-- The original parish-only index matched every room with a NULL org_unit_id,
-- including family rooms. Narrow it to parish rooms so families can have many rooms.
drop index if exists public.chat_rooms_parish_scope_uq;
create unique index if not exists chat_rooms_parish_scope_uq on public.chat_rooms(parish_id) where scope_type='parish';
create unique index if not exists chat_rooms_family_uq on public.chat_rooms(parish_id,family_id) where scope_type='family';
create unique index if not exists chat_rooms_person_uq on public.chat_rooms(parish_id,person_key) where scope_type='person';
create index if not exists chat_rooms_family_idx on public.chat_rooms(parish_id,family_id) where family_id is not null;

create table if not exists public.chat_room_participants (
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  parishioner_id uuid not null references public.parishioners(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key(room_id,user_id),
  unique(room_id,parishioner_id)
);
alter table public.chat_room_participants enable row level security;
revoke all on public.chat_room_participants from anon,authenticated;

create or replace function public.chat_can_access_scope(
  p_parish_id uuid,p_org_unit_id uuid,p_family_id uuid,p_person_key text,p_room_id uuid default null
) returns boolean language sql stable security definer set search_path=public,auth as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles pr where pr.id=auth.uid() and coalesce(pr.status,'active')='active'
  ) and exists(select 1 from public.parishes p where p.id=p_parish_id) and (
    public.is_platform_admin() or
    exists(select 1 from public.parish_user_roles ur where ur.user_id=auth.uid() and ur.parish_id=p_parish_id
      and (ur.org_unit_id is null or exists(select 1 from public.org_units ou where ou.id=ur.org_unit_id and ou.is_active))
      and ((p_org_unit_id is null and p_family_id is null and p_person_key is null and ur.org_unit_id is null)
        or (p_org_unit_id is not null and (ur.org_unit_id is null or public.org_is_within(p_org_unit_id,ur.org_unit_id)
          or public.org_is_within(ur.org_unit_id,p_org_unit_id))))) or
    (p_org_unit_id is not null and exists(select 1 from public.parishioners m
      where m.profile_id=auth.uid() and m.parish_id=p_parish_id and m.membership_status='active'
        and public.org_is_within(coalesce(m.jumuiya_id,(select f.jumuiya_id from public.families f where f.id=m.family_id)),p_org_unit_id))) or
    (p_family_id is not null and exists(select 1 from public.parishioners m
      where m.profile_id=auth.uid() and m.parish_id=p_parish_id and m.family_id=p_family_id and m.membership_status='active')) or
    (p_person_key is not null and p_room_id is not null and exists(select 1 from public.chat_room_participants cp
      where cp.room_id=p_room_id and cp.user_id=auth.uid()))
  )
$$;
revoke all on function public.chat_can_access_scope(uuid,uuid,uuid,text,uuid) from public,anon;
grant execute on function public.chat_can_access_scope(uuid,uuid,uuid,text,uuid) to authenticated;

drop policy if exists chat_rooms_read on public.chat_rooms;
create policy chat_rooms_read on public.chat_rooms for select to authenticated
  using (public.chat_can_access_scope(parish_id,org_unit_id,family_id,person_key,id));
drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages for select to authenticated
  using (public.chat_can_access_scope(parish_id,org_unit_id,family_id,person_key,room_id));
drop policy if exists chat_messages_send on public.chat_messages;
create policy chat_messages_send on public.chat_messages for insert to authenticated
  with check (sender_id=auth.uid() and public.chat_can_access_scope(parish_id,org_unit_id,family_id,person_key,room_id));

create or replace function public.chat_prepare_message()
returns trigger language plpgsql security definer set search_path=public,auth as $$
declare r public.chat_rooms; v_name text;
begin
  if auth.uid() is null then raise exception 'Ingia kwanza kutuma ujumbe' using errcode='42501'; end if;
  select * into r from public.chat_rooms where id=new.room_id;
  if r.id is null or not public.chat_can_access_scope(r.parish_id,r.org_unit_id,r.family_id,r.person_key,r.id) then
    raise exception 'Huna ruhusa ya kutuma ujumbe katika eneo hili' using errcode='42501';
  end if;
  select nullif(btrim(full_name),'') into v_name from public.profiles where id=auth.uid();
  new.parish_id:=r.parish_id; new.org_unit_id:=r.org_unit_id; new.family_id:=r.family_id; new.person_key:=r.person_key;
  new.sender_id:=auth.uid(); new.sender_name:=coalesce(v_name,'Muumini'); new.body:=btrim(new.body); new.created_at:=now();
  return new;
end $$;
revoke all on function public.chat_prepare_message() from public,anon,authenticated;

create or replace function public.chat_create_private_room(p_parishioner_id uuid)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare v_me public.parishioners; v_other public.parishioners; v_room uuid; v_key text; v_title text;
begin
  select * into v_me from public.parishioners where profile_id=auth.uid() and membership_status='active';
  if v_me.id is null then raise exception 'Akaunti yako haijaunganishwa na muumini hai' using errcode='42501'; end if;
  select * into v_other from public.parishioners where id=p_parishioner_id and parish_id=v_me.parish_id and membership_status='active' and profile_id is not null;
  if v_other.id is null or v_other.id=v_me.id then raise exception 'Chagua muumini mwingine mwenye akaunti iliyounganishwa' using errcode='22023'; end if;
  v_key:=least(v_me.id::text,v_other.id::text)||':'||greatest(v_me.id::text,v_other.id::text);
  v_title:=v_me.full_name||' · '||v_other.full_name;
  insert into public.chat_rooms(parish_id,scope_type,title,person_key)
    values(v_me.parish_id,'person',v_title,v_key)
    on conflict (parish_id,person_key) where scope_type='person' do update set title=excluded.title returning id into v_room;
  insert into public.chat_room_participants(room_id,user_id,parishioner_id)
    values(v_room,v_me.profile_id,v_me.id),(v_room,v_other.profile_id,v_other.id)
    on conflict(room_id,user_id) do update set parishioner_id=excluded.parishioner_id;
  return v_room;
end $$;
revoke all on function public.chat_create_private_room(uuid) from public,anon;
grant execute on function public.chat_create_private_room(uuid) to authenticated;

create or replace function public.chat_create_family_rooms()
returns integer language plpgsql security definer set search_path=public as $$
declare f record; n integer:=0;
begin
  for f in select distinct fa.id,fa.parish_id,fa.family_name from public.families fa
    join public.parishioners p on p.family_id=fa.id and p.membership_status='active'
    where fa.status='active' and p.profile_id is not null
  loop
    insert into public.chat_rooms(parish_id,scope_type,title,family_id)
      values(f.parish_id,'family','Familia · '||f.family_name,f.id)
      on conflict (parish_id,family_id) where scope_type='family' do update set title=excluded.title;
    n:=n+1;
  end loop;
  return n;
end $$;
revoke all on function public.chat_create_family_rooms() from public,anon,authenticated;

select public.chat_create_family_rooms();

