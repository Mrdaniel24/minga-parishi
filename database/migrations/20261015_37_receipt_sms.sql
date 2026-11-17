-- ============================================================================
-- Minga Parish — migration 37: optional SMS receipt delivery
-- Receipt printing remains available; SMS is a separately requested action.
-- Every send is authorized and audited in the database.
-- ============================================================================

create table if not exists public.receipt_sms_log (
  id              uuid primary key default gen_random_uuid(),
  request_key     uuid not null unique,
  receipt_id      uuid not null references public.receipts(id),
  transaction_id  uuid not null references public.finance_transactions(id),
  parish_id       uuid not null references public.parishes(id),
  org_unit_id     uuid references public.org_units(id),
  phone           text not null,
  body            text not null check (length(body) between 1 and 918),
  status          text not null default 'sending' check (status in ('sending','sent','failed')),
  provider        text,
  result          jsonb,
  sent_by         uuid,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
alter table public.receipt_sms_log enable row level security;
revoke all on public.receipt_sms_log from public, anon, authenticated;

create or replace function public.receipt_sms_preview(p_receipt_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r public.receipts;
  t public.finance_transactions;
  v_phone text;
begin
  select * into r from public.receipts where id = p_receipt_id;
  if r.id is null then raise exception 'Risiti haipatikani' using errcode = 'P0001'; end if;
  select * into t from public.finance_transactions where id = r.transaction_id;
  if not public.has_perm('finance.record', coalesce(t.org_unit_id, t.jumuiya_id, t.kigango_id)) then
    raise exception 'Huna ruhusa ya kutuma risiti kwa SMS' using errcode = '42501';
  end if;
  select coalesce(public.normalize_phone(p.phone), public.normalize_phone(f.phone), public.normalize_phone(h.phone)) into v_phone
    from (select t.parishioner_id, t.family_id) x
    left join public.parishioners p on p.id = x.parishioner_id
    left join public.families f on f.id = x.family_id
    left join public.parishioners h on h.id = f.head_parishioner_id;
  return jsonb_build_object('phone', v_phone, 'receipt_no', r.receipt_no, 'payer_name', r.payer_name);
end $$;
revoke execute on function public.receipt_sms_preview(uuid) from public, anon;
grant execute on function public.receipt_sms_preview(uuid) to authenticated;

create or replace function public.receipt_sms_claim(p_receipt_id uuid, p_phone text, p_request_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.receipts;
  t public.finance_transactions;
  c public.contribution_categories;
  v_phone text;
  v_body text;
  v_job public.receipt_sms_log;
  v_inserted int;
begin
  if p_request_key is null then raise exception 'Namba ya ombi inahitajika' using errcode = 'P0001'; end if;
  select * into r from public.receipts where id = p_receipt_id;
  if r.id is null then raise exception 'Risiti haipatikani' using errcode = 'P0001'; end if;
  select * into t from public.finance_transactions where id = r.transaction_id for share;
  if t.id is null or t.status <> 'posted' or t.sign <> 1 or t.reversed_by_id is not null or r.status <> 'valid' then
    raise exception 'Risiti hii imebatilishwa au muamala si halali' using errcode = 'P0001';
  end if;
  if not public.has_perm('finance.record', coalesce(t.org_unit_id, t.jumuiya_id, t.kigango_id)) then
    raise exception 'Huna ruhusa ya kutuma risiti kwa SMS' using errcode = '42501';
  end if;
  v_phone := coalesce(public.normalize_phone(nullif(btrim(p_phone), '')), (
    select coalesce(public.normalize_phone(p.phone), public.normalize_phone(f.phone), public.normalize_phone(h.phone))
      from public.finance_transactions x
      left join public.parishioners p on p.id = x.parishioner_id
      left join public.families f on f.id = x.family_id
      left join public.parishioners h on h.id = f.head_parishioner_id
     where x.id = t.id
  ));
  if v_phone is null then raise exception 'Namba sahihi ya simu inahitajika kwa SMS' using errcode = 'P0001'; end if;
  select * into c from public.contribution_categories where id = t.category_id;
  v_body := (select coalesce(official_name, 'Parokia') from public.parishes where id = r.parish_id)
    || ': Tumepokea ' || to_char(r.amount, 'FM999G999G999G990') || ' TZS kutoka ' || coalesce(r.payer_name, 'kwako')
    || ' kwa ' || coalesce(c.name_sw, 'mchango') || '. Risiti ' || r.receipt_no || ' (' || to_char(t.txn_date, 'DD/MM/YYYY') || '). Asante.';
  if length(v_body) > 918 then v_body := left(v_body, 915) || '...'; end if;
  insert into public.receipt_sms_log (request_key, receipt_id, transaction_id, parish_id, org_unit_id, phone, body, sent_by)
  values (p_request_key, r.id, t.id, r.parish_id, coalesce(t.org_unit_id, t.jumuiya_id, t.kigango_id), v_phone, v_body, auth.uid())
  on conflict (request_key) do nothing;
  get diagnostics v_inserted = row_count;
  select * into v_job from public.receipt_sms_log where request_key = p_request_key for update;
  if v_job.receipt_id <> r.id or v_job.phone <> v_phone then raise exception 'Namba ya ombi imetumika kwa taarifa tofauti' using errcode = 'P0001'; end if;
  if v_job.status = 'sent' then raise exception 'Risiti hii imeshatumwa kwa SMS kwa ombi hili' using errcode = 'P0001'; end if;
  if v_inserted = 0 and v_job.status = 'sending' and v_job.created_at >= now() - interval '15 minutes' then
    raise exception 'SMS hii tayari inatumwa — subiri kabla ya kujaribu tena' using errcode = 'P0001';
  end if;
  if v_inserted = 0 and v_job.status in ('sending','failed') then
    update public.receipt_sms_log set status = 'sending', created_at = now() where id = v_job.id;
  end if;
  insert into public.audit_log (actor_id, action, table_name, row_id, note)
  values (auth.uid(), 'receipt_sms_claim', 'receipts', r.id::text, v_phone);
  return jsonb_build_object('id', v_job.id, 'body', v_job.body, 'phones', jsonb_build_array(v_job.phone));
end $$;
revoke execute on function public.receipt_sms_claim(uuid, text, uuid) from public, anon;
grant execute on function public.receipt_sms_claim(uuid, text, uuid) to authenticated;

create or replace function public.receipt_sms_finish(p_id uuid, p_ok boolean, p_provider text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.receipt_sms_log;
begin
  select * into j from public.receipt_sms_log where id = p_id for update;
  if j.id is null then raise exception 'Ombi la SMS halipo' using errcode = 'P0001'; end if;
  if not public.has_perm('finance.record', j.org_unit_id) then raise exception 'Huna ruhusa (permission denied)' using errcode = '42501'; end if;
  if j.status <> 'sending' then raise exception 'SMS hii haikuwa inatumwa' using errcode = 'P0001'; end if;
  update public.receipt_sms_log set status = case when p_ok then 'sent' else 'failed' end,
      provider = left(p_provider, 40), result = p_result, sent_at = case when p_ok then now() end where id = j.id;
  insert into public.audit_log (actor_id, action, table_name, row_id, note)
  values (auth.uid(), case when p_ok then 'receipt_sms_sent' else 'receipt_sms_failed' end, 'receipts', j.receipt_id::text, left(coalesce(p_provider, '') || ' ' || j.phone, 120));
  return jsonb_build_object('status', case when p_ok then 'sent' else 'failed' end);
end $$;
revoke execute on function public.receipt_sms_finish(uuid, boolean, text, jsonb) from public, anon;
grant execute on function public.receipt_sms_finish(uuid, boolean, text, jsonb) to authenticated;

notify pgrst, 'reload schema';
