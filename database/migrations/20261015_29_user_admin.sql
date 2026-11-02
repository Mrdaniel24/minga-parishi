-- ============================================================================
-- Minga Parish Management System — migration 29: accounts by phone number
--   * People sign in with their PHONE NUMBER and a password (no e-mail
--     needed). Supabase signs in by e-mail, so an account made for a phone
--     number gets a private sign-in address made from the number:
--       0712 345 678  →  255712345678@simu.parokia.local
--     The login page turns the number typed into the same address, so nobody
--     ever sees it. No SMS is sent, so no SMS provider is needed for this.
--   * The administrator creates accounts here (name, phone, password, role),
--     sets a new password for anyone who forgot theirs, and can switch an
--     existing e-mail account to sign in by phone.
--   Only users.manage (Msimamizi wa Parokia) or the system administrator.
--   Nobody but the system administrator may touch a system administrator's
--   account.
-- ============================================================================

-- '0712 345 678', '+255 712…', '712345678' → '255712345678' (null when not a phone number)
create or replace function public.normalize_phone(p text)
returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d ~ '^0[67]\d{8}$' then d := '255' || substr(d, 2);
  elsif d ~ '^[67]\d{8}$' then d := '255' || d;
  end if;
  if d !~ '^\d{10,15}$' then return null; end if;
  return d;
end $$;

create or replace function public.phone_login_email(p_phone text)
returns text language sql immutable as $$
  select public.normalize_phone(p_phone) || '@simu.parokia.local'
$$;

-- who may manage this account
create or replace function public.assert_can_manage_user(p_user uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_platform_admin() or public.has_perm('users.manage', null)) then
    raise exception 'Huna ruhusa ya kusimamia akaunti (permission denied)' using errcode = '42501';
  end if;
  if p_user is not null and not public.is_platform_admin()
     and exists (select 1 from public.profiles where id = p_user and role = 'super_admin') then
    raise exception 'Akaunti ya Msimamizi wa Mfumo inabadilishwa na yeye mwenyewe tu' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.assert_can_manage_user(uuid) from public, anon, authenticated;

create or replace function public.check_new_password(p_password text)
returns void language plpgsql immutable as $$
begin
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Nenosiri liwe na herufi/namba 6 au zaidi' using errcode = 'P0001';
  end if;
end $$;

-- create an account. p: full_name, phone, email (optional: then signs in by
-- e-mail instead), password, role_code, org_unit_id, parishioner_id (all optional)
create or replace function public.admin_create_user(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_name text := nullif(btrim(p->>'full_name'), '');
  v_phone text := public.normalize_phone(p->>'phone');
  v_email text := lower(nullif(btrim(p->>'email'), ''));
  v_login text;
  v_uid uuid := gen_random_uuid();
  v_person uuid := nullif(p->>'parishioner_id', '')::uuid;
begin
  perform public.assert_can_manage_user(null);
  if v_name is null then raise exception 'Andika jina la mtumiaji' using errcode = 'P0001'; end if;
  if nullif(btrim(p->>'phone'), '') is not null and v_phone is null then
    raise exception 'Namba ya simu si sahihi (mf. 0712345678)' using errcode = 'P0001';
  end if;
  if v_phone is null and v_email is null then
    raise exception 'Andika namba ya simu ya mtumiaji' using errcode = 'P0001';
  end if;
  perform public.check_new_password(p->>'password');
  v_login := coalesce(public.phone_login_email(v_phone), v_email);
  if exists (select 1 from auth.users where lower(email) = v_login) then
    raise exception 'Akaunti ya % ipo tayari', coalesce(v_phone, v_email) using errcode = 'P0001';
  end if;
  if v_phone is not null and exists (select 1 from public.profiles where phone = v_phone) then
    raise exception 'Namba % tayari inatumiwa na akaunti nyingine', v_phone using errcode = 'P0001';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_login,
          extensions.crypt(p->>'password', extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('full_name', v_name, 'phone', v_phone), now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_uid::text, v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_login, 'email_verified', true),
          'email', now(), now(), now());
  -- the profile row comes from the on_auth_user_created trigger
  update public.profiles set full_name = v_name, phone = v_phone, email = coalesce(v_email, v_login) where id = v_uid;

  if nullif(p->>'role_code', '') is not null then
    insert into public.parish_user_roles (user_id, parish_id, role_code, org_unit_id)
    values (v_uid, public.default_parish_id(), p->>'role_code', nullif(p->>'org_unit_id', '')::uuid);
  end if;
  if v_person is not null then
    perform set_config('minga.approved_link', 'on', true);
    update public.parishioners set profile_id = v_uid where id = v_person and profile_id is null;
  end if;
  insert into public.audit_log (actor_id, action, table_name, row_id, new_data)
  values (auth.uid(), 'create_user', 'profiles', v_uid::text,
          jsonb_build_object('full_name', v_name, 'phone', v_phone, 'email', v_email, 'role', p->>'role_code'));
  return jsonb_build_object('id', v_uid, 'login', coalesce(v_phone, v_email));
end $$;
revoke execute on function public.admin_create_user(jsonb) from public, anon;
grant execute on function public.admin_create_user(jsonb) to authenticated;

-- a forgotten password: the administrator sets a new one and tells the person
create or replace function public.admin_set_password(p_user uuid, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.assert_can_manage_user(p_user);
  perform public.check_new_password(p_password);
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where id = p_user;
  if not found then raise exception 'Akaunti haipo' using errcode = 'P0001'; end if;
  insert into public.audit_log (actor_id, action, table_name, row_id) values (auth.uid(), 'reset_password', 'profiles', p_user::text);
  return jsonb_build_object('status', 'ok');
end $$;
revoke execute on function public.admin_set_password(uuid, text) from public, anon;
grant execute on function public.admin_set_password(uuid, text) to authenticated;

-- sign in by this phone number from now on (the e-mail stays on the profile as contact)
create or replace function public.admin_set_login_phone(p_user uuid, p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_login text := public.phone_login_email(p_phone);
begin
  perform public.assert_can_manage_user(p_user);
  if v_phone is null then raise exception 'Namba ya simu si sahihi (mf. 0712345678)' using errcode = 'P0001'; end if;
  if exists (select 1 from auth.users where lower(email) = v_login and id <> p_user)
     or exists (select 1 from public.profiles where phone = v_phone and id <> p_user) then
    raise exception 'Namba % tayari inatumiwa na akaunti nyingine', v_phone using errcode = 'P0001';
  end if;
  update auth.users set email = v_login, updated_at = now() where id = p_user;
  if not found then raise exception 'Akaunti haipo' using errcode = 'P0001'; end if;
  update auth.identities set identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email', v_login)
   where user_id = p_user and provider = 'email';
  update public.profiles set phone = v_phone where id = p_user;
  insert into public.audit_log (actor_id, action, table_name, row_id, new_data)
  values (auth.uid(), 'set_login_phone', 'profiles', p_user::text, jsonb_build_object('phone', v_phone));
  return jsonb_build_object('status', 'ok', 'phone', v_phone);
end $$;
revoke execute on function public.admin_set_login_phone(uuid, text) from public, anon;
grant execute on function public.admin_set_login_phone(uuid, text) to authenticated;

-- role / status of a profile: the system administrator, or a function that has checked rights itself
create or replace function public.protect_profile_role_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and coalesce(current_setting('minga.user_admin', true), '') <> 'on'
     and not exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin' and status = 'active')
     and (new.role is distinct from old.role or new.status is distinct from old.status or new.id is distinct from old.id) then
    raise exception 'Huwezi kubadilisha nafasi au hali ya akaunti' using errcode = '42501';
  end if;
  if coalesce(current_setting('minga.user_admin', true), '') = 'on' and new.role is distinct from old.role then
    raise exception 'Huwezi kubadilisha nafasi ya akaunti' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- suspend / re-activate an account (a suspended account cannot sign in to the system)
create or replace function public.admin_set_user_status(p_user uuid, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_can_manage_user(p_user);
  if p_user = auth.uid() then raise exception 'Huwezi kusimamisha akaunti yako mwenyewe' using errcode = 'P0001'; end if;
  perform set_config('minga.user_admin', 'on', true);   -- protect_profile_role_changes: rights were checked above
  update public.profiles set status = case when p_active then 'active' else 'inactive' end where id = p_user;
  if not found then raise exception 'Akaunti haipo' using errcode = 'P0001'; end if;
  perform set_config('minga.user_admin', 'off', true);
  insert into public.audit_log (actor_id, action, table_name, row_id, note)
  values (auth.uid(), case when p_active then 'activate_user' else 'suspend_user' end, 'profiles', p_user::text, null);
  return jsonb_build_object('status', case when p_active then 'active' else 'inactive' end);
end $$;
revoke execute on function public.admin_set_user_status(uuid, boolean) from public, anon;
grant execute on function public.admin_set_user_status(uuid, boolean) to authenticated;

-- find an account by phone number or e-mail (for giving a role / linking)
create or replace function public.find_user(p_login text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.profiles
   where (public.is_platform_admin() or public.has_perm('users.manage', null))
     and (lower(email) = lower(btrim(p_login))
          or (public.normalize_phone(p_login) is not null and phone = public.normalize_phone(p_login)))
   order by created_at limit 1
$$;
revoke execute on function public.find_user(text) from public, anon;
grant execute on function public.find_user(text) to authenticated;

create index if not exists profiles_phone_idx on public.profiles (phone);

notify pgrst, 'reload schema';
