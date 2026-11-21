-- Add a tightly scoped one-recipient SMS path for verifying the configured
-- provider. The regular group composer must never interpret audience='test'
-- as the parish-wide audience.
alter table public.sms_messages drop constraint if exists sms_messages_audience_check;
alter table public.sms_messages add constraint sms_messages_audience_check
  check (audience in ('all', 'zaka_payers', 'zaka_paid', 'zaka_unpaid', 'leaders', 'units', 'test'));

create or replace function public.sms_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_units uuid[];
  v_year int := coalesce(nullif(p->>'zaka_year', '')::int, extract(year from current_date)::int);
  v_month int := nullif(p->>'zaka_month', '')::int;
  v_body text := btrim(coalesce(p->>'body', ''));
  v_invalid text;
  v_id uuid;
  n int;
begin
  if not public.has_perm('comms.send') then raise exception 'Huna ruhusa ya kutuma SMS (permission denied)' using errcode = '42501'; end if;
  if coalesce(p->>'audience', '') not in ('all', 'zaka_payers', 'zaka_paid', 'zaka_unpaid', 'leaders', 'units') then
    raise exception 'Chagua kundi halali la SMS' using errcode = 'P0001';
  end if;
  if v_body = '' then raise exception 'Andika ujumbe' using errcode = 'P0001'; end if;
  if length(v_body) > 918 then raise exception 'Ujumbe usizidi herufi 918' using errcode = 'P0001'; end if;
  select coalesce(array_agg(x::uuid), '{}') into v_units from jsonb_array_elements_text(coalesce(p->'unit_ids', '[]'::jsonb)) x;
  if p->>'audience' = 'units' and cardinality(v_units) = 0 then raise exception 'Chagua kigango au jumuiya' using errcode = 'P0001'; end if;
  select string_agg(distinct m[1], ', ') into v_invalid
    from regexp_matches(v_body, '@([a-z][a-z0-9_]*)', 'g') m
   where m[1] <> all(array['jina','familia','jumuiya','kigango','tarehe','mwezi','mwaka','kiasi','miezi_iliyolipwa',
                            'zaka_jan','zaka_feb','zaka_mar','zaka_apr','zaka_mei','zaka_jun','zaka_jul','zaka_ago',
                            'zaka_sep','zaka_okt','zaka_nov','zaka_des']);
  if v_invalid is not null then raise exception 'Alama za ujumbe hazitambuliki: @%' , v_invalid using errcode = 'P0001'; end if;
  if p->>'audience' in ('zaka_paid', 'zaka_unpaid') then
    v_year := coalesce(v_year, extract(year from current_date)::int);
  end if;
  insert into public.sms_messages (parish_id, body, audience, unit_ids, zaka_only, zaka_year, zaka_month, created_by)
  values (public.default_parish_id(), v_body, p->>'audience', v_units, coalesce((p->>'zaka_only')::boolean, false),
          v_year, v_month, auth.uid())
  returning id into v_id;
  insert into public.sms_recipients (message_id, phone, parishioner_id, full_name, personalized_body)
  select v_id, a.phone, a.parishioner_id, a.full_name,
         public.sms_render_template(v_body, public.sms_template_data(a.parishioner_id, v_year, v_month))
    from public.sms_audience(p->>'audience', v_units, coalesce((p->>'zaka_only')::boolean, false), v_year, v_month) a;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Hakuna muumini mwenye namba ya simu kwenye kundi ulilochagua' using errcode = 'P0001'; end if;
  if exists (select 1 from public.sms_recipients where message_id = v_id and length(personalized_body) > 918) then
    raise exception 'Ujumbe uliokamilika kwa baadhi ya wapokeaji umezidi herufi 918. Fupisha template.' using errcode = 'P0001';
  end if;
  update public.sms_messages set recipients = n where id = v_id;
  insert into public.audit_log (actor_id, action, table_name, row_id, note) values (auth.uid(), 'sms_create', 'sms_messages', v_id::text, n || ' namba');
  return jsonb_build_object('id', v_id, 'recipients', n);
end $$;
revoke execute on function public.sms_create(jsonb) from public, anon;
grant execute on function public.sms_create(jsonb) to authenticated;

create or replace function public.sms_create_test(p_phone text, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  if not public.has_perm('comms.send') then raise exception 'Huna ruhusa ya kutuma SMS (permission denied)' using errcode = '42501'; end if;
  if v_phone is null or v_phone !~ '^255[67][0-9]{8}$' then raise exception 'Weka namba halali ya simu ya Tanzania' using errcode = 'P0001'; end if;
  if v_body = '' then raise exception 'Andika ujumbe wa jaribio' using errcode = 'P0001'; end if;
  if length(v_body) > 918 then raise exception 'Ujumbe usizidi herufi 918' using errcode = 'P0001'; end if;

  insert into public.sms_messages (parish_id, body, audience, unit_ids, created_by)
  values (public.default_parish_id(), v_body, 'test', '{}', auth.uid())
  returning id into v_id;
  insert into public.sms_recipients (message_id, phone, parishioner_id, full_name, personalized_body)
  values (v_id, v_phone, null, 'Namba ya majaribio', v_body);
  update public.sms_messages set recipients = 1 where id = v_id;
  insert into public.audit_log (actor_id, action, table_name, row_id, note)
  values (auth.uid(), 'sms_test_create', 'sms_messages', v_id::text, 'SMS ya majaribio · mpokeaji 1');
  return jsonb_build_object('id', v_id, 'recipients', 1, 'phone', v_phone);
end $$;
revoke execute on function public.sms_create_test(text, text) from public, anon;
grant execute on function public.sms_create_test(text, text) to authenticated;

create or replace function public.sms_claim(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m public.sms_messages;
  v_groups jsonb;
  v_phones jsonb;
  v_count int;
begin
  if not public.has_perm('comms.send') then raise exception 'Huna ruhusa ya kutuma SMS (permission denied)' using errcode = '42501'; end if;
  select * into m from public.sms_messages where id = p_id for update;
  if m.id is null then raise exception 'Ujumbe haupo' using errcode = 'P0001'; end if;
  if m.status = 'sent' then raise exception 'Ujumbe huu umeshatumwa' using errcode = 'P0001'; end if;
  if m.status = 'sending' and m.claimed_at > now() - interval '15 minutes' then
    raise exception 'Ujumbe huu unatumwa sasa hivi — subiri' using errcode = 'P0001';
  end if;
  select count(*) into v_count from public.sms_recipients where message_id = m.id;
  if m.audience = 'test' and v_count <> 1 then raise exception 'SMS ya majaribio lazima iwe na mpokeaji mmoja tu' using errcode = 'P0001'; end if;
  update public.sms_messages set status = 'sending', claimed_at = now() where id = m.id;
  select coalesce(jsonb_agg(jsonb_build_object('body', g.body, 'phones', g.phones) order by g.body), '[]'::jsonb)
    into v_groups
    from (
      select coalesce(r.personalized_body, m.body) as body, jsonb_agg(r.phone order by r.phone) as phones
        from public.sms_recipients r where r.message_id = m.id
       group by coalesce(r.personalized_body, m.body)
    ) g;
  select coalesce(jsonb_agg(r.phone order by r.phone), '[]'::jsonb) into v_phones
    from public.sms_recipients r where r.message_id = m.id;
  return jsonb_build_object('id', m.id, 'body', m.body, 'phones', v_phones, 'messages', v_groups, 'audience', m.audience);
end $$;
revoke execute on function public.sms_claim(uuid) from public, anon;
grant execute on function public.sms_claim(uuid) to authenticated;

notify pgrst, 'reload schema';
