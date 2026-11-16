-- ============================================================================
-- Minga Parish — migration 36: self-registration for ordinary parish members
--   Public sign-up creates ordinary member accounts only. Account and family
--   records are written atomically by the server's service-role endpoint.
--   Temporary passwords are generated and delivered by the configured SMS
--   provider; they are never returned to the browser or stored in this DB.
-- ============================================================================

create table if not exists public.public_registration_attempts (
  id          bigint generated always as identity primary key,
  phone_hash  text not null,
  ip_hash     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists public_registration_phone_time_idx
  on public.public_registration_attempts (phone_hash, created_at desc);
create index if not exists public_registration_ip_time_idx
  on public.public_registration_attempts (ip_hash, created_at desc);
alter table public.public_registration_attempts enable row level security;
revoke all on public.public_registration_attempts from public, anon, authenticated;

-- Only return the minimum needed to let a member select their existing family.
create or replace function public.public_signup_families(p_jumuiya uuid)
returns table (id uuid, family_name text, family_code text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.org_units ou where ou.id = p_jumuiya and ou.unit_type = 'jumuiya' and ou.is_active) then
    raise exception 'Chagua jumuiya iliyo hai' using errcode = 'P0001';
  end if;
  return query
    select f.id, f.family_name, f.family_code
      from public.families f
     where f.jumuiya_id = p_jumuiya and f.status = 'active'
     order by f.family_name, f.family_code;
end $$;
revoke all on function public.public_signup_families(uuid) from public;
grant execute on function public.public_signup_families(uuid) to anon, authenticated;

-- Hashes (not raw phone/IP values) are supplied by the server and retained only
-- long enough to enforce rolling 24-hour limits: 3 registrations per phone,
-- 20 member accounts per IP address.
create or replace function public.consume_registration_attempt(p_phone_hash text, p_ip_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_phone_count int; v_ip_count int;
begin
  if length(coalesce(p_phone_hash, '')) <> 64 or length(coalesce(p_ip_hash, '')) <> 64 then return false; end if;
  perform pg_advisory_xact_lock(hashtext(p_ip_hash)::bigint);
  delete from public.public_registration_attempts where created_at < now() - interval '24 hours';
  insert into public.public_registration_attempts (phone_hash, ip_hash) values (p_phone_hash, p_ip_hash);
  select count(*) into v_phone_count from public.public_registration_attempts
   where phone_hash = p_phone_hash and created_at >= now() - interval '24 hours';
  select count(*) into v_ip_count from public.public_registration_attempts
   where ip_hash = p_ip_hash and created_at >= now() - interval '24 hours';
  return v_phone_count <= 3 and v_ip_count <= 20;
end $$;
revoke all on function public.consume_registration_attempt(text, text) from public, anon, authenticated;
grant execute on function public.consume_registration_attempt(text, text) to service_role;

-- p: kigango_id, jumuiya_id, family_id (existing) OR new_family_name/head_index,
--    members: [{full_name, phone, password, gender, birth_year, relationship}]
-- Passwords are generated server-side and passed only to this service-role RPC;
-- Auth users and member/family records are committed in one transaction.
create or replace function public.register_member_family(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_kigango uuid := nullif(p->>'kigango_id', '')::uuid;
  v_jumuiya uuid := nullif(p->>'jumuiya_id', '')::uuid;
  v_family uuid := nullif(p->>'family_id', '')::uuid;
  v_family_name text := nullif(btrim(p->>'new_family_name'), '');
  v_head_index int := nullif(p->>'head_index', '')::int;
  v_parish uuid;
  v_members jsonb := p->'members';
  v_count int;
  v_i int := 0;
  v_m jsonb;
  v_profile uuid;
  v_person uuid;
  v_head_person uuid;
  v_name text;
  v_phone text;
  v_gender text;
  v_relationship text;
  v_birth_year int;
  v_password text;
  v_login text;
  v_phones text[] := '{}';
begin
  select parish_id into v_parish from public.org_units
   where id = v_jumuiya and unit_type = 'jumuiya' and parent_id = v_kigango and is_active;
  if v_parish is null or v_parish <> public.default_parish_id() then
    raise exception 'Kigango na jumuiya hazilingani au hazitumiki' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_members) <> 'array' then raise exception 'Ongeza muumini mmoja au zaidi' using errcode = 'P0001'; end if;
  v_count := jsonb_array_length(v_members);
  if v_count < 1 or v_count > 12 then raise exception 'Usajili mmoja unaweza kuwa na waumini 1 hadi 12' using errcode = 'P0001'; end if;

  if v_family is null then
    if v_family_name is null or v_head_index is null or v_head_index < 0 or v_head_index >= v_count then
      raise exception 'Jina la familia na mkuu wa familia vinahitajika' using errcode = 'P0001';
    end if;
  else
    if v_head_index is not null then raise exception 'Familia iliyopo tayari ina mkuu wake' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.families where id = v_family and jumuiya_id = v_jumuiya and status = 'active') then
      raise exception 'Familia hiyo haipo kwenye jumuiya uliyochagua' using errcode = 'P0001';
    end if;
  end if;

  -- Validate the whole set before inserting any member.
  for v_m in select value from jsonb_array_elements(v_members) loop
    v_name := nullif(btrim(v_m->>'full_name'), '');
    v_phone := public.normalize_phone(v_m->>'phone');
    v_password := coalesce(v_m->>'password', '');
    v_gender := nullif(v_m->>'gender', '');
    v_relationship := upper(btrim(coalesce(v_m->>'relationship', '')));
    v_birth_year := nullif(v_m->>'birth_year', '')::int;
    if v_name is null or v_phone is null or v_birth_year is null or length(v_password) < 12 then
      raise exception 'Jina, simu sahihi, umri na nenosiri la muda vinahitajika kwa kila muumini' using errcode = 'P0001';
    end if;
    if v_gender is not null and v_gender not in ('male','female') then raise exception 'Jinsi si sahihi' using errcode = 'P0001'; end if;
    if v_relationship not in ('BABA','MAMA','MTOTO','MJUKUU','BIBI','BABU','KAKA','DADA','MJOMBA','SHANGAZI','MWINGINE') then
      raise exception 'Chagua uhusiano wa muumini na familia' using errcode = 'P0001';
    end if;
    if v_birth_year < 1900 or v_birth_year > extract(year from current_date)::int then
      raise exception 'Mwaka wa kuzaliwa si sahihi' using errcode = 'P0001';
    end if;
    if v_phone = any(v_phones) then raise exception 'Kila muumini lazima awe na namba yake ya simu' using errcode = 'P0001'; end if;
    perform pg_advisory_xact_lock(hashtext(v_phone)::bigint);
    if exists (select 1 from public.profiles pr where public.normalize_phone(pr.phone) = v_phone)
       or exists (select 1 from public.parishioners old where public.normalize_phone(old.phone) = v_phone)
       or exists (select 1 from auth.users au where lower(au.email) = public.phone_login_email(v_phone)) then
      raise exception 'Namba % tayari ipo kwenye rejista', v_phone using errcode = 'P0001';
    end if;
    v_phones := array_append(v_phones, v_phone);
    v_i := v_i + 1;
  end loop;

  if v_family is null and exists (select 1 from public.families f
       where f.jumuiya_id = v_jumuiya and f.status = 'active' and lower(btrim(f.family_name)) = lower(v_family_name)) then
    raise exception 'Jina hilo la familia lipo tayari kwenye jumuiya. Chagua familia iliyopo.' using errcode = 'P0001';
  end if;

  if v_family is null then
    insert into public.families (parish_id, family_name, jumuiya_id, phone)
    values (v_parish, v_family_name, v_jumuiya, v_phones[v_head_index + 1]) returning id into v_family;
  end if;

  v_i := 0;
  for v_m in select value from jsonb_array_elements(v_members) loop
    v_profile := gen_random_uuid();
    v_phone := public.normalize_phone(v_m->>'phone');
    v_login := public.phone_login_email(v_phone);
    v_password := v_m->>'password';
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', v_profile, 'authenticated', 'authenticated', v_login,
      extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', btrim(v_m->>'full_name'), 'phone', v_phone, 'must_change_password', true),
      now(), now(), '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_profile::text, v_profile, jsonb_build_object('sub', v_profile::text, 'email', v_login, 'email_verified', true),
      'email', now(), now(), now());
    update public.profiles set full_name = btrim(v_m->>'full_name'), phone = v_phone, email = v_login where id = v_profile;
    insert into public.parishioners (parish_id, full_name, gender, birth_year, phone, family_id,
      relationship, jumuiya_id, profile_id, membership_status, registered_on)
    values (v_parish, btrim(v_m->>'full_name'), nullif(v_m->>'gender',''),
      (v_m->>'birth_year')::int, public.normalize_phone(v_m->>'phone'), v_family,
      upper(btrim(v_m->>'relationship')), v_jumuiya, v_profile, 'active', current_date)
    returning id into v_person;
    if v_head_index = v_i then v_head_person := v_person; end if;
    v_i := v_i + 1;
  end loop;
  if v_head_person is not null then update public.families set head_parishioner_id = v_head_person where id = v_family; end if;
  return jsonb_build_object('family_id', v_family, 'members', v_count, 'jumuiya_id', v_jumuiya);
end $$;
revoke all on function public.register_member_family(jsonb) from public, anon, authenticated;
grant execute on function public.register_member_family(jsonb) to service_role;

notify pgrst, 'reload schema';
