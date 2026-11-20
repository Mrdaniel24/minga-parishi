-- Link parishioner accounts by a verified unique phone match instead of a
-- separate manual-link form. Ambiguous and inactive records are never linked.
do $$
begin
  perform set_config('minga.approved_link', 'on', true);
  with unique_people as (
    select public.normalize_phone(p.phone) as phone, min(p.id::text)::uuid as parishioner_id
      from public.parishioners p
     where p.parish_id = public.default_parish_id()
       and public.normalize_phone(p.phone) is not null
     group by public.normalize_phone(p.phone)
    having count(*) = 1 and bool_and(p.membership_status = 'active') and bool_and(p.profile_id is null)
  ), unique_profiles as (
    select public.normalize_phone(pr.phone) as phone, min(pr.id::text)::uuid as profile_id
      from public.profiles pr
     where public.normalize_phone(pr.phone) is not null
     group by public.normalize_phone(pr.phone)
    having count(*) = 1 and bool_and(pr.status = 'active')
  )
  update public.parishioners p
     set profile_id = pr.profile_id
    from unique_people up
    join unique_profiles pr using (phone)
   where p.id = up.parishioner_id
     and p.profile_id is null;
end $$;

create or replace function public.admin_create_user(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_name text := nullif(btrim(p->>'full_name'), '');
  v_phone text := public.normalize_phone(p->>'phone');
  v_email text := lower(nullif(btrim(p->>'email'), ''));
  v_login text;
  v_uid uuid := gen_random_uuid();
  v_person uuid := nullif(p->>'parishioner_id', '')::uuid;
  v_match_count int := 0;
  v_candidate_status text;
  v_candidate_profile uuid;
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

  if v_person is null and v_phone is not null then
    select count(*)::int into v_match_count
      from public.parishioners p
     where p.parish_id = public.default_parish_id()
       and public.normalize_phone(p.phone) = v_phone;
    if v_match_count > 1 then
      raise exception 'Namba hii ipo kwenye rekodi zaidi ya moja ya waumini. Rekebisha namba zinazojirudia kabla ya kutengeneza akaunti.' using errcode = 'P0001';
    elsif v_match_count = 1 then
      select p.id, p.membership_status, p.profile_id
        into v_person, v_candidate_status, v_candidate_profile
        from public.parishioners p
       where p.parish_id = public.default_parish_id()
         and public.normalize_phone(p.phone) = v_phone;
      if v_candidate_status <> 'active' then
        raise exception 'Rekodi ya muumini yenye namba hii haitumiki. Rekebisha rejista kwanza.' using errcode = 'P0001';
      end if;
      if v_candidate_profile is not null then
        raise exception 'Rekodi ya muumini yenye namba hii tayari imeunganishwa na akaunti.' using errcode = 'P0001';
      end if;
    end if;
  elsif v_person is not null then
    if not exists (select 1 from public.parishioners p where p.id = v_person
        and p.parish_id = public.default_parish_id() and p.membership_status = 'active'
        and p.profile_id is null and public.normalize_phone(p.phone) = v_phone) then
      raise exception 'Rekodi ya muumini haipo, haipo hai, tayari imeunganishwa au namba hazilingani.' using errcode = 'P0001';
    end if;
  end if;

  v_login := coalesce(public.phone_login_email(v_phone), v_email);
  if exists (select 1 from auth.users where lower(email) = v_login) then
    raise exception 'Akaunti ya % ipo tayari', coalesce(v_phone, v_email) using errcode = 'P0001';
  end if;
  if v_phone is not null and exists (select 1 from public.profiles where public.normalize_phone(phone) = v_phone) then
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
  update public.profiles set full_name = v_name, phone = v_phone, email = coalesce(v_email, v_login) where id = v_uid;

  if nullif(p->>'role_code', '') is not null then
    insert into public.parish_user_roles (user_id, parish_id, role_code, org_unit_id)
    values (v_uid, public.default_parish_id(), p->>'role_code', nullif(p->>'org_unit_id', '')::uuid);
  end if;
  if v_person is not null then
    perform set_config('minga.approved_link', 'on', true);
    update public.parishioners set profile_id = v_uid where id = v_person and profile_id is null;
    if not found then raise exception 'Rekodi ya muumini tayari imeunganishwa na akaunti nyingine.' using errcode = 'P0001'; end if;
  end if;
  insert into public.audit_log (actor_id, action, table_name, row_id, new_data)
  values (auth.uid(), 'create_user', 'profiles', v_uid::text,
          jsonb_build_object('full_name', v_name, 'phone', v_phone, 'email', v_email, 'role', p->>'role_code', 'parishioner_id', v_person));
  return jsonb_build_object('id', v_uid, 'login', coalesce(v_phone, v_email), 'linked', v_person is not null, 'parishioner_id', v_person);
end $$;
revoke execute on function public.admin_create_user(jsonb) from public, anon;
grant execute on function public.admin_create_user(jsonb) to authenticated;

-- Changing an existing login to a phone also performs the same safe match.
create or replace function public.admin_set_login_phone(p_user uuid, p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_login text := public.phone_login_email(p_phone);
  v_count int := 0;
  v_person uuid;
  v_status text;
  v_linked_profile uuid;
begin
  perform public.assert_can_manage_user(p_user);
  if v_phone is null then raise exception 'Namba ya simu si sahihi (mf. 0712345678)' using errcode = 'P0001'; end if;
  if exists (select 1 from auth.users where lower(email) = v_login and id <> p_user)
     or exists (select 1 from public.profiles where public.normalize_phone(phone) = v_phone and id <> p_user) then
    raise exception 'Namba % tayari inatumiwa na akaunti nyingine', v_phone using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.parishioners where profile_id = p_user) then
    select count(*)::int into v_count from public.parishioners p
     where p.parish_id = public.default_parish_id() and public.normalize_phone(p.phone) = v_phone;
    if v_count > 1 then
      raise exception 'Namba hii ipo kwenye rekodi zaidi ya moja ya waumini. Rekebisha namba zinazojirudia kwanza.' using errcode = 'P0001';
    elsif v_count = 1 then
      select p.id, p.membership_status, p.profile_id into v_person, v_status, v_linked_profile
        from public.parishioners p where p.parish_id = public.default_parish_id() and public.normalize_phone(p.phone) = v_phone;
      if v_status <> 'active' then raise exception 'Rekodi ya muumini yenye namba hii haitumiki.' using errcode = 'P0001'; end if;
      if v_linked_profile is not null and v_linked_profile <> p_user then
        raise exception 'Rekodi ya muumini yenye namba hii tayari imeunganishwa na akaunti nyingine.' using errcode = 'P0001';
      end if;
    end if;
  end if;

  update auth.users set email = v_login, updated_at = now() where id = p_user;
  if not found then raise exception 'Akaunti haipo' using errcode = 'P0001'; end if;
  update auth.identities set identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email', v_login)
   where user_id = p_user and provider = 'email';
  update public.profiles set phone = v_phone where id = p_user;
  if v_person is not null and v_linked_profile is null then
    perform set_config('minga.approved_link', 'on', true);
    update public.parishioners set profile_id = p_user where id = v_person and profile_id is null;
    if not found then raise exception 'Rekodi ya muumini tayari imeunganishwa na akaunti nyingine.' using errcode = 'P0001'; end if;
  end if;
  insert into public.audit_log (actor_id, action, table_name, row_id, new_data)
  values (auth.uid(), 'set_login_phone', 'profiles', p_user::text,
          jsonb_build_object('phone', v_phone, 'parishioner_id', v_person));
  return jsonb_build_object('status', 'ok', 'phone', v_phone, 'linked', v_person is not null);
end $$;
revoke execute on function public.admin_set_login_phone(uuid, text) from public, anon;
grant execute on function public.admin_set_login_phone(uuid, text) to authenticated;

notify pgrst, 'reload schema';
