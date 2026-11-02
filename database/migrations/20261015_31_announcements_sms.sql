-- ============================================================================
-- Minga Parish Management System — migration 31: announcements and bulk SMS
--   * Matangazo: a notice shown on the users' first page, to everyone or to
--     some of them (staff, leaders, members, or the people of chosen vigango /
--     jumuiya), from a start date to an end date.
--   * SMS kwa wingi: a message to the phone numbers in the register — every
--     member with a phone, zaka payers only, leaders only, or the people of
--     chosen vigango / jumuiya. The list of numbers is fixed when the message
--     is created (so it can be checked and downloaded). Sending goes through
--     the SMS provider configured on the server (api/sms.js); until one is
--     configured the list can be downloaded and sent from a phone.
--   Needs comms.send (Msimamizi wa Parokia, Paroko).
-- ============================================================================

insert into public.role_permissions (role_code, permission)
select r, 'comms.send' from unnest(array['parish_admin', 'parish_priest']) r
on conflict do nothing;

create table if not exists public.parish_announcements (
  id          uuid primary key default gen_random_uuid(),
  parish_id   uuid not null references public.parishes(id),
  title       text not null,
  body        text not null,
  audience    text not null default 'all' check (audience in ('all', 'staff', 'leaders', 'members', 'units')),
  unit_ids    uuid[] not null default '{}',
  starts_on   date not null default current_date,
  ends_on     date,
  is_active   boolean not null default true,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  check (audience <> 'units' or cardinality(unit_ids) > 0)
);
alter table public.parish_announcements enable row level security;
grant select, insert, update, delete on public.parish_announcements to authenticated;
drop policy if exists parish_announcements_manage on public.parish_announcements;
create policy parish_announcements_manage on public.parish_announcements for all to authenticated
  using ((select public.has_perm('comms.send'))) with check ((select public.has_perm('comms.send')));
drop trigger if exists parish_announcements_audit on public.parish_announcements;
create trigger parish_announcements_audit after insert or update or delete on public.parish_announcements for each row execute function public.audit_row();

-- the notices the signed-in user should see today
create or replace function public.my_announcements()
returns setof public.parish_announcements language sql stable security definer set search_path = public as $$
  with me as (
    select public.is_platform_admin() as admin,
           exists (select 1 from public.parish_user_roles ur join public.role_permissions rp on rp.role_code = ur.role_code
                    where ur.user_id = auth.uid()) as staff,
           exists (select 1 from public.parish_user_roles ur where ur.user_id = auth.uid() and ur.role_code in ('kigango_leader', 'jumuiya_leader'))
             or exists (select 1 from public.leadership_assignments la where la.status = 'active' and la.parishioner_id = public.my_parishioner_id()) as leader,
           public.my_parishioner_id() as person,
           array(select ur.org_unit_id from public.parish_user_roles ur where ur.user_id = auth.uid() and ur.org_unit_id is not null)
             || array(select p.jumuiya_id from public.parishioners p where p.profile_id = auth.uid() and p.jumuiya_id is not null) as units
  )
  select a.* from public.parish_announcements a, me
   where a.is_active and a.starts_on <= current_date and (a.ends_on is null or a.ends_on >= current_date)
     and (me.admin or a.audience = 'all'
          or (a.audience = 'staff' and me.staff)
          or (a.audience = 'leaders' and me.leader)
          or (a.audience = 'members' and me.person is not null)
          or (a.audience = 'units' and exists (select 1 from unnest(me.units) u, unnest(a.unit_ids) t where public.org_is_within(u, t) or public.org_is_within(t, u))))
   order by a.starts_on desc, a.created_at desc
   limit 10
$$;
revoke execute on function public.my_announcements() from public, anon;
grant execute on function public.my_announcements() to authenticated;

-- ---------------------------------------------------------------------------
-- SMS
-- ---------------------------------------------------------------------------
create table if not exists public.sms_messages (
  id           uuid primary key default gen_random_uuid(),
  parish_id    uuid not null references public.parishes(id),
  body         text not null check (length(body) between 1 and 918),
  audience     text not null check (audience in ('all', 'zaka_payers', 'leaders', 'units')),
  unit_ids     uuid[] not null default '{}',
  zaka_only    boolean not null default false,
  recipients   int not null default 0,
  status       text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'failed')),
  provider     text,
  result       jsonb,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  sent_at      timestamptz
);
create table if not exists public.sms_recipients (
  message_id      uuid not null references public.sms_messages(id) on delete cascade,
  phone           text not null,
  parishioner_id  uuid references public.parishioners(id) on delete set null,
  full_name       text,
  primary key (message_id, phone)
);
alter table public.sms_messages enable row level security;
alter table public.sms_recipients enable row level security;
grant select on public.sms_messages, public.sms_recipients to authenticated;
drop policy if exists sms_messages_read on public.sms_messages;
create policy sms_messages_read on public.sms_messages for select to authenticated using ((select public.has_perm('comms.send')));
drop policy if exists sms_recipients_read on public.sms_recipients;
create policy sms_recipients_read on public.sms_recipients for select to authenticated using ((select public.has_perm('comms.send')));

-- the register people an SMS would go to (one row per phone number)
create or replace function public.sms_audience(p_audience text, p_units uuid[], p_zaka_only boolean)
returns table (phone text, parishioner_id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select distinct on (public.normalize_phone(p.phone)) public.normalize_phone(p.phone), p.id, p.full_name
    from public.parishioners p
   where p.membership_status = 'active'
     and public.normalize_phone(p.phone) is not null
     and (p_audience <> 'zaka_payers' or p.is_zaka_payer)
     and (not coalesce(p_zaka_only, false) or p.is_zaka_payer)
     and (p_audience <> 'leaders' or exists (select 1 from public.leadership_assignments la where la.parishioner_id = p.id and la.status = 'active'))
     and (p_audience <> 'units' or exists (select 1 from unnest(coalesce(p_units, '{}')) u where public.org_is_within(p.jumuiya_id, u)))
   order by public.normalize_phone(p.phone), p.is_zaka_payer desc, p.created_at
$$;
revoke execute on function public.sms_audience(text, uuid[], boolean) from public, anon, authenticated;

-- how many numbers a message would reach (before creating it)
create or replace function public.sms_preview(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_units uuid[];
begin
  if not public.has_perm('comms.send') then raise exception 'Huna ruhusa ya kutuma SMS (permission denied)' using errcode = '42501'; end if;
  select coalesce(array_agg(x::uuid), '{}') into v_units from jsonb_array_elements_text(coalesce(p->'unit_ids', '[]'::jsonb)) x;
  return jsonb_build_object('recipients', (select count(*) from public.sms_audience(p->>'audience', v_units, coalesce((p->>'zaka_only')::boolean, false))),
                            'without_phone', (select count(*) from public.parishioners where membership_status = 'active' and public.normalize_phone(phone) is null));
end $$;
revoke execute on function public.sms_preview(jsonb) from public, anon;
grant execute on function public.sms_preview(jsonb) to authenticated;

-- create the message with its fixed list of numbers. p: body, audience, unit_ids, zaka_only
create or replace function public.sms_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_units uuid[];
  v_id uuid;
  n int;
begin
  if not public.has_perm('comms.send') then raise exception 'Huna ruhusa ya kutuma SMS (permission denied)' using errcode = '42501'; end if;
  if coalesce(btrim(p->>'body'), '') = '' then raise exception 'Andika ujumbe' using errcode = 'P0001'; end if;
  select coalesce(array_agg(x::uuid), '{}') into v_units from jsonb_array_elements_text(coalesce(p->'unit_ids', '[]'::jsonb)) x;
  if p->>'audience' = 'units' and cardinality(v_units) = 0 then raise exception 'Chagua kigango au jumuiya' using errcode = 'P0001'; end if;
  insert into public.sms_messages (parish_id, body, audience, unit_ids, zaka_only, created_by)
  values (public.default_parish_id(), btrim(p->>'body'), p->>'audience', v_units, coalesce((p->>'zaka_only')::boolean, false), auth.uid())
  returning id into v_id;
  insert into public.sms_recipients (message_id, phone, parishioner_id, full_name)
  select v_id, a.phone, a.parishioner_id, a.full_name from public.sms_audience(p->>'audience', v_units, coalesce((p->>'zaka_only')::boolean, false)) a;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Hakuna muumini mwenye namba ya simu kwenye kundi ulilochagua' using errcode = 'P0001'; end if;
  update public.sms_messages set recipients = n where id = v_id;
  insert into public.audit_log (actor_id, action, table_name, row_id, note) values (auth.uid(), 'sms_create', 'sms_messages', v_id::text, n || ' namba');
  return jsonb_build_object('id', v_id, 'recipients', n);
end $$;
revoke execute on function public.sms_create(jsonb) from public, anon;
grant execute on function public.sms_create(jsonb) to authenticated;

-- used by the server (api/sms.js, with the sender's own sign-in): the message and its
-- numbers, claimed for sending so that two clicks never send it twice
create or replace function public.sms_claim(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.sms_messages;
begin
  if not public.has_perm('comms.send') then raise exception 'Huna ruhusa ya kutuma SMS (permission denied)' using errcode = '42501'; end if;
  select * into m from public.sms_messages where id = p_id for update;
  if m.id is null then raise exception 'Ujumbe haupo' using errcode = 'P0001'; end if;
  if m.status = 'sent' then raise exception 'Ujumbe huu umeshatumwa' using errcode = 'P0001'; end if;
  -- a send that never finished (server stopped) may be tried again after 15 minutes
  if m.status = 'sending' and m.claimed_at > now() - interval '15 minutes' then
    raise exception 'Ujumbe huu unatumwa sasa hivi — subiri' using errcode = 'P0001';
  end if;
  update public.sms_messages set status = 'sending', claimed_at = now() where id = m.id;
  return jsonb_build_object('id', m.id, 'body', m.body,
                            'phones', (select coalesce(jsonb_agg(phone order by phone), '[]'::jsonb) from public.sms_recipients where message_id = m.id));
end $$;
revoke execute on function public.sms_claim(uuid) from public, anon;
grant execute on function public.sms_claim(uuid) to authenticated;

create or replace function public.sms_finish(p_id uuid, p_ok boolean, p_provider text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('comms.send') then raise exception 'Huna ruhusa (permission denied)' using errcode = '42501'; end if;
  update public.sms_messages set status = case when p_ok then 'sent' else 'failed' end, provider = p_provider, result = p_result,
         sent_at = case when p_ok then now() end
   where id = p_id and status = 'sending';
  if not found then raise exception 'Ujumbe haukuwa unatumwa' using errcode = 'P0001'; end if;
  insert into public.audit_log (actor_id, action, table_name, row_id, note)
  values (auth.uid(), case when p_ok then 'sms_sent' else 'sms_failed' end, 'sms_messages', p_id::text, p_provider);
  return jsonb_build_object('status', case when p_ok then 'sent' else 'failed' end);
end $$;
revoke execute on function public.sms_finish(uuid, boolean, text, jsonb) from public, anon;
grant execute on function public.sms_finish(uuid, boolean, text, jsonb) to authenticated;

-- a message not sent (or sent from a phone instead) can be removed
create or replace function public.sms_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('comms.send') then raise exception 'Huna ruhusa (permission denied)' using errcode = '42501'; end if;
  delete from public.sms_messages where id = p_id and status in ('draft', 'failed');
  if not found then raise exception 'Ujumbe uliokwisha tumwa haufutwi' using errcode = 'P0001'; end if;
  return jsonb_build_object('status', 'deleted');
end $$;
revoke execute on function public.sms_delete(uuid) from public, anon;
grant execute on function public.sms_delete(uuid) to authenticated;

notify pgrst, 'reload schema';
