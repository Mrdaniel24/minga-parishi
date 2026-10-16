-- ============================================================================
-- Minga Parish Management System — migration 00: accounts (standalone base)
--   The system stands on its own: no Kanisa Hub tables are needed.
--   Supabase provides auth.users; this migration adds public.profiles, one row
--   per login account, created automatically when an account is added
--   (Supabase dashboard → Authentication → Add user, or sign-up).
--
--   profiles.role:  'user'        — ordinary account; what it may see comes only
--                                   from parish roles (parish_user_roles)
--                   'super_admin' — system administrator (everything)
-- ============================================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  phone       text,
  role        text not null default 'user' check (role in ('user', 'super_admin')),
  status      text not null default 'active' check (status in ('active', 'inactive')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists profiles_email_idx on public.profiles (lower(email));
alter table public.profiles enable row level security;

-- a profile is created for every new login account
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(coalesce(new.email, ''), '@', 1)),
          nullif(new.raw_user_meta_data->>'phone', ''))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- accounts that existed before this migration get a profile too
insert into public.profiles (id, email, full_name)
select u.id, u.email, split_part(coalesce(u.email, ''), '@', 1) from auth.users u
on conflict (id) do nothing;

-- nobody but a super admin (or the database owner / SQL editor) may change role or status
create or replace function public.protect_profile_role_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and not exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin' and status = 'active')
     and (new.role is distinct from old.role or new.status is distinct from old.status or new.id is distinct from old.id) then
    raise exception 'Huwezi kubadilisha nafasi au hali ya akaunti' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists protect_profile_role_changes on public.profiles;
create trigger protect_profile_role_changes before update on public.profiles
  for each row execute function public.protect_profile_role_changes();

-- profiles are written by the trigger above and by administrators only
revoke insert, delete on public.profiles from anon, authenticated;
revoke all on public.profiles from anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
-- Read/update policies are in migration 10 (they use has_perm from migration 01).
