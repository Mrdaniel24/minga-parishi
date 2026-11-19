-- Personalize the optional receipt SMS sent after recording a Zaka payment.
-- Other contribution receipts keep the same data, with a clearer greeting.

create or replace function public.receipt_sms_claim(p_receipt_id uuid, p_phone text, p_request_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.receipts;
  t public.finance_transactions;
  c public.contribution_categories;
  v_phone text;
  v_body text;
  v_month text;
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

  if c.kind = 'zaka' then
    v_month := case extract(month from t.period_month)::int
      when 1 then 'Januari' when 2 then 'Februari' when 3 then 'Machi'
      when 4 then 'Aprili' when 5 then 'Mei' when 6 then 'Juni'
      when 7 then 'Julai' when 8 then 'Agosti' when 9 then 'Septemba'
      when 10 then 'Oktoba' when 11 then 'Novemba' when 12 then 'Desemba'
      else null end;
    v_body := 'Ndugu ' || coalesce(nullif(btrim(r.payer_name), ''), 'Muumini')
      || ', tumepokea malipo yako ya Zaka'
      || case when v_month is not null then ' ya ' || v_month || ' ' || to_char(t.period_month, 'YYYY') else '' end
      || ', kiasi cha TZS ' || to_char(r.amount, 'FM999G999G999G990')
      || '. Risiti Na. ' || r.receipt_no || ', tarehe ' || to_char(t.txn_date, 'DD/MM/YYYY')
      || '. Mungu akubariki.';
  else
    v_body := 'Ndugu ' || coalesce(nullif(btrim(r.payer_name), ''), 'Muumini')
      || ', tumepokea mchango wako wa ' || coalesce(c.name_sw, 'mchango')
      || ', kiasi cha TZS ' || to_char(r.amount, 'FM999G999G999G990')
      || '. Risiti Na. ' || r.receipt_no || ', tarehe ' || to_char(t.txn_date, 'DD/MM/YYYY')
      || '. Asante. Mungu akubariki.';
  end if;
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

notify pgrst, 'reload schema';
