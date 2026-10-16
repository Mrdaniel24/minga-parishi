-- ============================================================================
-- Minga Parish Management System — migration 10: who may see login accounts
--   A user sees their own profile. People who manage users (users.manage) and
--   the system administrator see all profiles, so they can give roles by e-mail.
--   Nobody else can list accounts or e-mail addresses.
-- ============================================================================

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_platform_admin() or public.has_perm('users.manage', null));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_platform_admin())
  with check (id = auth.uid() or public.is_platform_admin());

-- no leftovers from the Kanisa Hub era, if this runs on an old database
drop policy if exists profiles_self_insert on public.profiles;
