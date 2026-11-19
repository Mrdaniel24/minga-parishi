-- Editable SMS templates with recipient-specific values and a live sample preview.
alter table public.sms_recipients
  add column if not exists personalized_body text;

create or replace function public.sms_template_data(p_person uuid, p_year int, p_month int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p public.parishioners;
  f public.families;
  v_unit uuid;
  v_jumuiya text;
  v_kigango text;
  v_total numeric := 0;
  v_paid_months int := 0;
  v_month_name text;
  v_months jsonb;
begin
  select * into p from public.parishioners where id = p_person;
  if p.id is null then return '{}'::jsonb; end if;
  select * into f from public.families where id = p.family_id;
  v_unit := coalesce(p.jumuiya_id, f.jumuiya_id);
  select name into v_jumuiya from public.org_units where id = public.org_ancestor_of_type(v_unit, 'jumuiya');
  select name into v_kigango from public.org_units where id = public.org_ancestor_of_type(v_unit, 'kigango');

  select coalesce(sum(t.net_amount), 0), count(distinct date_trunc('month', coalesce(t.period_month, t.txn_date)))::int
    into v_total, v_paid_months
    from public.finance_transactions t
    join public.contribution_categories c on c.id = t.category_id and c.kind = 'zaka'
   where t.status = 'posted' and t.sign = 1 and t.reversed_by_id is null
     and (t.parishioner_id = p.id or (t.parishioner_id is null and p.family_id is not null and t.family_id = p.family_id))
     and extract(year from coalesce(t.period_month, t.txn_date)) = coalesce(p_year, extract(year from current_date)::int)
     and (p_month is null or extract(month from coalesce(t.period_month, t.txn_date)) = p_month);

  select coalesce(jsonb_object_agg('zaka_' || m.token, to_char(coalesce(x.amount, 0), 'FM999G999G999G990')), '{}'::jsonb)
    into v_months
    from (values (1,'jan'),(2,'feb'),(3,'mar'),(4,'apr'),(5,'mei'),(6,'jun'),
                 (7,'jul'),(8,'ago'),(9,'sep'),(10,'okt'),(11,'nov'),(12,'des')) as m(n, token)
    left join lateral (
      select sum(t.net_amount) as amount
        from public.finance_transactions t
        join public.contribution_categories c on c.id = t.category_id and c.kind = 'zaka'
       where t.status = 'posted' and t.sign = 1 and t.reversed_by_id is null
         and (t.parishioner_id = p.id or (t.parishioner_id is null and p.family_id is not null and t.family_id = p.family_id))
         and extract(year from coalesce(t.period_month, t.txn_date)) = coalesce(p_year, extract(year from current_date)::int)
         and extract(month from coalesce(t.period_month, t.txn_date)) = m.n
    ) x on true;

  v_month_name := case coalesce(p_month, 0)
    when 1 then 'Januari' when 2 then 'Februari' when 3 then 'Machi' when 4 then 'Aprili'
    when 5 then 'Mei' when 6 then 'Juni' when 7 then 'Julai' when 8 then 'Agosti'
    when 9 then 'Septemba' when 10 then 'Oktoba' when 11 then 'Novemba' when 12 then 'Desemba'
    else 'Mwaka mzima' end;
  return jsonb_build_object(
    'jina', p.full_name,
    'familia', coalesce(f.family_name, '—'),
    'jumuiya', coalesce(v_jumuiya, '—'),
    'kigango', coalesce(v_kigango, '—'),
    'tarehe', to_char(current_date, 'DD/MM/YYYY'),
    'mwezi', v_month_name,
    'mwaka', coalesce(p_year, extract(year from current_date)::int)::text,
    'kiasi', to_char(v_total, 'FM999G999G999G990'),
    'miezi_iliyolipwa', coalesce(v_paid_months, 0)::text
  ) || v_months;
end $$;
revoke execute on function public.sms_template_data(uuid, int, int) from public, anon, authenticated;

create or replace function public.sms_render_template(p_body text, p_data jsonb)
returns text language plpgsql immutable set search_path = public as $$
declare
  v_body text := coalesce(p_body, '');
  x record;
begin
  for x in select key, value from jsonb_each_text(coalesce(p_data, '{}'::jsonb)) loop
    v_body := replace(v_body, '@' || x.key, x.value);
  end loop;
  return v_body;
end $$;
revoke execute on function public.sms_render_template(text, jsonb) from public, anon, authenticated;

create or replace function public.sms_preview(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_units uuid[];
  v_year int := coalesce(nullif(p->>'zaka_year', '')::int, extract(year from current_date)::int);
  v_month int := nullif(p->>'zaka_month', '')::int;
  v_audience text := coalesce(p->>'audience', 'all');
  v_sample jsonb;
begin
  if not public.has_perm('comms.send') then raise exception 'Huna ruhusa ya kutuma SMS (permission denied)' using errcode = '42501'; end if;
  select coalesce(array_agg(x::uuid), '{}') into v_units from jsonb_array_elements_text(coalesce(p->'unit_ids', '[]'::jsonb)) x;
  select jsonb_build_object(
           'name', a.full_name,
           'body', public.sms_render_template(coalesce(p->>'body', ''), public.sms_template_data(a.parishioner_id, v_year, v_month))
         ) into v_sample
    from public.sms_audience(v_audience, v_units, coalesce((p->>'zaka_only')::boolean, false), v_year, v_month) a
   order by a.full_name nulls last limit 1;
  return jsonb_build_object(
    'recipients', (select count(*) from public.sms_audience(v_audience, v_units, coalesce((p->>'zaka_only')::boolean, false), v_year, v_month)),
    'without_phone', (select count(*) from public.parishioners where membership_status = 'active' and public.normalize_phone(phone) is null),
    'sample', v_sample,
    'sample_length', coalesce(length(v_sample->>'body'), 0)
  );
end $$;
revoke execute on function public.sms_preview(jsonb) from public, anon;
grant execute on function public.sms_preview(jsonb) to authenticated;

-- Store the rendered text with the frozen recipient list so every person gets
-- their own values and retries reproduce the exact same message.
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

create or replace function public.sms_claim(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m public.sms_messages;
  v_groups jsonb;
  v_phones jsonb;
begin
  if not public.has_perm('comms.send') then raise exception 'Huna ruhusa ya kutuma SMS (permission denied)' using errcode = '42501'; end if;
  select * into m from public.sms_messages where id = p_id for update;
  if m.id is null then raise exception 'Ujumbe haupo' using errcode = 'P0001'; end if;
  if m.status = 'sent' then raise exception 'Ujumbe huu umeshatumwa' using errcode = 'P0001'; end if;
  if m.status = 'sending' and m.claimed_at > now() - interval '15 minutes' then
    raise exception 'Ujumbe huu unatumwa sasa hivi — subiri' using errcode = 'P0001';
  end if;
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
  return jsonb_build_object('id', m.id, 'body', m.body, 'phones', v_phones, 'messages', v_groups);
end $$;
revoke execute on function public.sms_claim(uuid) from public, anon;
grant execute on function public.sms_claim(uuid) to authenticated;

notify pgrst, 'reload schema';
