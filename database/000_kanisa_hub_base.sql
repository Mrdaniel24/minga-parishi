-- ============================================================================
-- Kanisa Hub — base schema (RECONSTRUCTED)
--
-- The original base schema lives only in the demo Supabase project and was
-- never committed. This file rebuilds it from the columns, filters and RPCs
-- the pages actually use, plus the patches in database/*.sql, so that a new
-- project (and the local test server) can run every Kanisa Hub page.
--
-- If you have owner access to the demo project, prefer a real dump:
--   supabase db dump --project-ref ztafklfgtsaolyvaybop --schema public
-- and compare. Requires the Supabase `auth` schema. Safe to re-run.
-- ============================================================================

create table if not exists public.departments (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  leader_name      text,
  meeting_schedule text,
  image_url        text,
  category         text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text,
  full_name      text,
  phone          text,
  whatsapp       text,
  gender         text,
  marital_status text,
  date_of_birth  date,
  address        text,
  avatar_url     text,
  department_id  uuid references public.departments(id) on delete set null,
  role           text not null default 'member' check (role in ('member','admin','super_admin')),
  status         text not null default 'active' check (status in ('active','inactive','suspended','pending')),
  joined_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.admin_permissions (
  id                          uuid primary key default gen_random_uuid(),
  admin_id                    uuid not null unique references public.profiles(id) on delete cascade,
  department_id               uuid references public.departments(id) on delete set null,
  can_manage_members          boolean not null default false,
  can_manage_contributions    boolean not null default false,
  can_view_all_contributions  boolean not null default false,
  can_manage_events           boolean not null default false,
  can_manage_announcements    boolean not null default false,
  can_manage_media            boolean not null default false,
  can_manage_sermons          boolean not null default false,
  can_manage_departments      boolean not null default false,
  can_view_reports            boolean not null default false,
  created_at                  timestamptz not null default now()
);

-- legacy giving table of the demo; parish money now lives in finance_transactions
create table if not exists public.contributions (
  id                uuid primary key default gen_random_uuid(),
  member_id         uuid references public.profiles(id) on delete set null,
  amount            numeric(14,2) not null check (amount > 0),
  currency          text not null default 'TZS',
  category          text,
  payment_method    text,
  status            text not null default 'completed',
  reference_number  text,
  snippe_reference  text,
  notes             text,
  recorded_by       uuid,
  contribution_date date not null default current_date,
  created_at        timestamptz not null default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contributions_member_id_fkey') then
    alter table public.contributions add constraint contributions_member_id_fkey foreign key (member_id) references public.profiles(id);
  end if;
exception when others then null; end $$;

create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  event_date    timestamptz not null,
  end_date      timestamptz,
  location      text,
  category      text,
  image_url     text,
  status        text not null default 'upcoming',
  max_attendees int,
  department_id uuid references public.departments(id) on delete set null,
  created_by    uuid,
  created_at    timestamptz not null default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_created_by_fkey') then
    alter table public.events add constraint events_created_by_fkey foreign key (created_by) references public.profiles(id) on delete set null;
  end if;
end $$;

create table if not exists public.announcements (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  content       text not null,
  priority      text not null default 'normal',
  target_type   text not null default 'all',
  department_id uuid references public.departments(id) on delete set null,
  image_url     text,
  is_active     boolean not null default true,
  expires_at    timestamptz,
  created_by    uuid,
  created_at    timestamptz not null default now()
);

create table if not exists public.sermons (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  speaker             text,
  description         text,
  series_name         text,
  video_url           text,
  audio_url           text,
  scripture_reference text,
  sermon_date         date,
  duration_minutes    int,
  is_published        boolean not null default true,
  created_by          uuid,
  created_at          timestamptz not null default now()
);

create table if not exists public.media_items (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  category      text,
  file_url      text,
  file_type     text,
  file_size     bigint,
  thumbnail_url text,
  is_public     boolean not null default true,
  is_published  boolean not null default true,
  uploaded_by   uuid,
  created_at    timestamptz not null default now()
);

create table if not exists public.media_gallery_events (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  description     text,
  event_date      date,
  cover_image_url text,
  drive_link      text,
  is_public       boolean not null default true,
  is_active       boolean not null default true,
  department_id   uuid references public.departments(id) on delete set null,
  created_by      uuid,
  created_at      timestamptz not null default now()
);

create table if not exists public.media_gallery_event_images (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.media_gallery_events(id) on delete cascade,
  image_url  text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  sender_id     uuid references public.profiles(id) on delete set null,
  content       text not null,
  created_at    timestamptz not null default now()
);

create table if not exists public.pinned_messages (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  message_id    uuid not null references public.messages(id) on delete cascade,
  pinned_by     uuid,
  created_at    timestamptz not null default now()
);

create table if not exists public.chat_restrictions (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments(id) on delete cascade,
  member_id     uuid references public.profiles(id) on delete cascade,
  type          text not null default 'mute',
  restricted_by uuid,
  created_at    timestamptz not null default now()
);

create table if not exists public.visitors (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  phone         text,
  area          text,
  first_time    boolean default true,
  wants_contact boolean default false,
  created_at    timestamptz not null default now()
);

create table if not exists public.system_settings (
  id uuid primary key default gen_random_uuid(),
  church_name text, church_address text, church_phone text, church_email text, tagline text,
  currency text default 'TZS', timezone text default 'Africa/Dar_es_Salaam',
  hero_badge_text text, hero_subtext text, about_label text, about_heading text, about_quote text, about_body text,
  about_main_image_url text, about_accent_image_url text, ministries_label text, ministries_heading text,
  bento_feature_title text, bento_feature_desc text, bento_feature_image_url text,
  church_lat numeric(10,8), church_lng numeric(11,8),
  updated_by uuid, updated_at timestamptz default now()
);

create table if not exists public.service_times (
  id uuid primary key default gen_random_uuid(), display_order int not null default 0, icon text not null default 'church',
  day_label text not null, title text not null, description text, time_label text not null,
  is_active boolean default true, created_at timestamptz default now()
);

create table if not exists public.church_contacts (
  id uuid primary key default gen_random_uuid(), department_name text not null, role_label text not null,
  phone text, email text, is_public boolean not null default true, sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- helpers and RLS
-- ---------------------------------------------------------------------------
create or replace function public.kh_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and status = 'active'
$$;
create or replace function public.kh_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.kh_role() in ('admin','super_admin'), false)
$$;

-- members cannot change their own role/status
create or replace function public.protect_profile_role_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and coalesce(public.kh_role(), '') <> 'super_admin'
     and (new.role is distinct from old.role or new.status is distinct from old.status) then
    raise exception 'Huwezi kubadilisha nafasi au hali ya akaunti' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists protect_profile_role_changes on public.profiles;
create trigger protect_profile_role_changes before update on public.profiles for each row execute function public.protect_profile_role_changes();

create or replace function public.get_public_stats()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('member_count', (select count(*) from public.profiles where status = 'active'),
                           'ministry_count', (select count(*) from public.departments where is_active))
$$;

create or replace function public.promote_to_admin(target_user_id uuid, target_full_name text, target_phone text,
  target_dept_id uuid, target_email text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.kh_role(), '') <> 'super_admin' then
    return jsonb_build_object('success', false, 'message', 'Super admin only');
  end if;
  insert into public.profiles (id, email, full_name, phone, department_id, role, status)
  values (target_user_id, target_email, target_full_name, target_phone, target_dept_id, 'admin', 'active')
  on conflict (id) do update set role = 'admin', full_name = coalesce(excluded.full_name, profiles.full_name),
    phone = coalesce(excluded.phone, profiles.phone), department_id = excluded.department_id;
  return jsonb_build_object('success', true);
end $$;

do $$ declare t text; begin
  foreach t in array array['departments','profiles','admin_permissions','contributions','events','announcements','sermons',
    'media_items','media_gallery_events','media_gallery_event_images','messages','pinned_messages','chat_restrictions',
    'visitors','system_settings','service_times','church_contacts'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create or replace function pg_temp.pol(p_table text, p_name text, p_sql text) returns void language plpgsql as $$
begin execute format('drop policy if exists %I on public.%I', p_name, p_table); execute p_sql; end $$;

-- public content
select pg_temp.pol(t, t || '_read', format('create policy %I on public.%I for select to anon, authenticated using (true)', t || '_read', t))
  from unnest(array['departments','events','sermons','service_times','system_settings','media_gallery_events','media_gallery_event_images']) t;
select pg_temp.pol('church_contacts','church_contacts_read','create policy church_contacts_read on public.church_contacts for select to anon, authenticated using (is_public)');
select pg_temp.pol('media_items','media_items_read','create policy media_items_read on public.media_items for select to anon, authenticated using (is_public or auth.uid() is not null)');
select pg_temp.pol('announcements','announcements_read','create policy announcements_read on public.announcements for select to authenticated using (
  target_type = ''all'' or department_id is null or public.kh_is_admin()
  or department_id = (select department_id from public.profiles where id = auth.uid()))');
-- admin writes
select pg_temp.pol(t, t || '_admin_write', format('create policy %I on public.%I for all to authenticated using (public.kh_is_admin()) with check (public.kh_is_admin())', t || '_admin_write', t))
  from unnest(array['departments','events','announcements','sermons','media_items','media_gallery_events','media_gallery_event_images',
                    'pinned_messages','chat_restrictions','system_settings','service_times','church_contacts','contributions']) t;
-- profiles
select pg_temp.pol('profiles','profiles_read','create policy profiles_read on public.profiles for select to authenticated using (true)');
select pg_temp.pol('profiles','profiles_self_insert','create policy profiles_self_insert on public.profiles for insert to authenticated with check (id = auth.uid() and role = ''member'')');
select pg_temp.pol('profiles','profiles_update','create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid() or public.kh_is_admin()) with check (id = auth.uid() or public.kh_is_admin())');
-- admin permissions
select pg_temp.pol('admin_permissions','admin_permissions_read','create policy admin_permissions_read on public.admin_permissions for select to authenticated using (admin_id = auth.uid() or public.kh_role() = ''super_admin'')');
select pg_temp.pol('admin_permissions','admin_permissions_write','create policy admin_permissions_write on public.admin_permissions for all to authenticated using (public.kh_role() = ''super_admin'') with check (public.kh_role() = ''super_admin'')');
-- legacy contributions: members see their own
select pg_temp.pol('contributions','contributions_read','create policy contributions_read on public.contributions for select to authenticated using (member_id = auth.uid() or public.kh_is_admin())');
-- chat: members of the department (or admins)
select pg_temp.pol('messages','messages_read','create policy messages_read on public.messages for select to authenticated using (
  public.kh_is_admin() or department_id = (select department_id from public.profiles where id = auth.uid()))');
select pg_temp.pol('messages','messages_send','create policy messages_send on public.messages for insert to authenticated with check (
  sender_id = auth.uid() and (public.kh_is_admin() or department_id = (select department_id from public.profiles where id = auth.uid())))');
select pg_temp.pol('pinned_messages','pinned_read','create policy pinned_read on public.pinned_messages for select to authenticated using (true)');
select pg_temp.pol('chat_restrictions','chat_restrictions_read','create policy chat_restrictions_read on public.chat_restrictions for select to authenticated using (true)');
-- visitors: anyone may register as a visitor, admins read
select pg_temp.pol('visitors','visitors_insert','create policy visitors_insert on public.visitors for insert to anon, authenticated with check (true)');
select pg_temp.pol('visitors','visitors_read','create policy visitors_read on public.visitors for select to authenticated using (public.kh_is_admin())');

grant execute on function public.get_public_stats() to anon, authenticated;
