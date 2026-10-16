-- ============================================================================
-- Minga Parish Management System — DEMO login accounts (one per role)
--
--   Creates 10 accounts so anyone reviewing the system can sign in as each
--   role. It adds NO records: the data seen is whatever is in the database
--   (the Excel import). Run after database/supabase_setup.sql, before or after
--   the import: Supabase → SQL Editor → paste → Run. Running it again only
--   re-links the demo member (the accounts are not duplicated).
--
--   Every account has the password  Demo@2026
--   ⚠ Anyone who knows it can read the parish data. Before the system is shown
--   outside the team, run database/demo/demo_remove.sql (or change passwords).
-- ============================================================================

-- links muumini@minga.demo to the register person with the most posted payments
create or replace function public.demo_link_member()
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := (select id from public.profiles where email = 'muumini@minga.demo');
        v_person uuid;
begin
  if v_user is null or exists (select 1 from public.parishioners where profile_id = v_user) then return; end if;
  select parishioner_id into v_person from public.finance_transactions
   where parishioner_id is not null and status = 'posted'
   group by parishioner_id order by count(*) desc limit 1;
  if v_person is null then select id into v_person from public.parishioners order by created_at limit 1; end if;
  if v_person is not null then update public.parishioners set profile_id = v_user where id = v_person; end if;
end $$;
revoke execute on function public.demo_link_member() from public, anon, authenticated;

do $demo$
declare
  v_pw       constant text := 'Demo@2026';
  v_parish   uuid := public.default_parish_id();
  v_uid      uuid;
  v_acc      record;
begin
  if v_parish is null then
    raise exception 'Endesha database/supabase_setup.sql kwanza (hakuna parokia kwenye database).';
  end if;
  if exists (select 1 from auth.users where email = 'superadmin@minga.demo') then
    perform public.demo_link_member();
    raise notice 'Akaunti za demo tayari zipo — muumini wa demo ameunganishwa upya tu.';
    return;
  end if;

  -- ------------------------------------------------------------------
  -- 1. demo login accounts (one per role)
  -- ------------------------------------------------------------------
  for v_acc in
    select * from (values
      ('superadmin@minga.demo', 'Msimamizi Mkuu (Demo)',      null::text,       null::text, null::text),
      ('admin@minga.demo',      'Katibu wa Parokia (Demo)',   'parish_admin',   null, null),
      ('paroko@minga.demo',     'Fr. Paroko (Demo)',          'parish_priest',  null, null),
      ('mhasibu@minga.demo',    'Mhasibu (Demo)',             'accountant',     null, null),
      ('mhazini@minga.demo',    'Mtunza Hazina (Demo)',       'treasurer',      null, null),
      ('karani@minga.demo',     'Karani (Demo)',              'data_entry',     null, null),
      ('mkaguzi@minga.demo',    'Mkaguzi (Demo)',             'auditor',        null, null),
      ('kigango@minga.demo',    'Kiongozi wa Kigango (Demo)', 'kigango_leader', 'kigango', 'Mughanga'),
      ('jumuiya@minga.demo',    'Kiongozi wa Jumuiya (Demo)', 'jumuiya_leader', 'jumuiya', 'Clara'),
      ('muumini@minga.demo',    'Muumini (Demo)',             'member',         null, null)
    ) a(email, full_name, role_code, unit_type, unit_name)
  loop
    v_uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_acc.email,
            extensions.crypt(v_pw, extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', v_acc.full_name),
            now(), now(), '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_uid::text, v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_acc.email, 'email_verified', true),
            'email', now(), now(), now());
    -- the profile was created by the on_auth_user_created trigger
    update public.profiles set full_name = v_acc.full_name,
           role = case when v_acc.email = 'superadmin@minga.demo' then 'super_admin' else 'user' end
     where id = v_uid;
    if v_acc.role_code is not null then
      insert into public.parish_user_roles (user_id, parish_id, role_code, org_unit_id)
      values (v_uid, v_parish, v_acc.role_code,
              (select id from public.org_units where parish_id = v_parish and unit_type = v_acc.unit_type and name = v_acc.unit_name));
    end if;
  end loop;

  -- ------------------------------------------------------------------
  -- 2. the demo member account is linked to a register person (if the
  --    register is already loaded): the one with the most payments
  -- ------------------------------------------------------------------
  perform public.demo_link_member();

  raise notice 'Akaunti 10 za demo zimewekwa. Nenosiri la akaunti zote: %', v_pw;
end
$demo$;

select p.email as akaunti, p.full_name as jina,
       coalesce(r.name_sw, case when p.role = 'super_admin' then 'Msimamizi wa Mfumo (kila kitu)' end) as nafasi,
       o.name as eneo, 'Demo@2026' as nenosiri
  from public.profiles p
  left join public.parish_user_roles ur on ur.user_id = p.id
  left join public.parish_roles r on r.code = ur.role_code
  left join public.org_units o on o.id = ur.org_unit_id
 where p.email like '%@minga.demo'
 order by coalesce(r.sort_order, 0);
