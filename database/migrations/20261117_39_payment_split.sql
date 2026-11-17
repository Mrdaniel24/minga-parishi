-- Distribute one received payment across units, families, or parishioners.
-- Every recipient receives a ledger line and receipt; the batch is atomic.
create or replace function public.post_payment_split(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_key uuid := nullif(p->>'idempotency_key', '')::uuid;
  v_parish uuid := public.default_parish_id();
  v_root public.org_units;
  v_units uuid[];
  v_total numeric(14,2) := round((p->>'amount')::numeric, 2);
  v_cat uuid := nullif(p->>'category_id', '')::uuid;
  v_line jsonb; v_idx bigint;
  v_sum numeric(14,2) := 0;
  v_amt numeric(14,2);
  v_kind_count int;
  v_target_unit uuid;
  v_identity text;
  v_seen text[] := '{}';
  v_desc text;
  v_r jsonb;
  v_receipts jsonb := '[]'::jsonb;
begin
  if v_key is null then raise exception 'idempotency_key inahitajika' using errcode = 'P0001'; end if;
  select * into v_root from public.org_units where id = nullif(p->>'root_unit_id', '')::uuid and parish_id = v_parish;
  if v_root.id is null or v_root.unit_type not in ('kigango','jumuiya') then
    raise exception 'Eneo la mgawanyo halijulikani' using errcode = 'P0001';
  end if;
  if not public.has_perm('finance.record', v_root.id) then
    raise exception 'Huna ruhusa ya kurekodi malipo katika eneo hili (permission denied)' using errcode = '42501';
  end if;
  if v_total is null or v_total <= 0 then raise exception 'Kiasi lazima kiwe zaidi ya sifuri' using errcode = 'P0001'; end if;
  if v_cat is null or not exists (select 1 from public.contribution_categories where id = v_cat and parish_id = v_parish and is_active and kind <> 'expense') then
    raise exception 'Aina ya mapato haijulikani au haifanyi kazi' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 or jsonb_array_length(p->'lines') > 5000 then
    raise exception 'Weka angalau mpokeaji mmoja (wasiozidi 5000)' using errcode = 'P0001';
  end if;

  -- A retry returns the original receipts, even if the client resends the form.
  if exists (select 1 from public.finance_transactions where batch_id = v_key and sign = 1) then
    select coalesce(jsonb_agg(jsonb_build_object('payer', t.payer_name, 'amount', t.amount, 'receipt_no', r.receipt_no,
      'receipt_id', r.id, 'transaction_id', t.id) order by t.txn_no), '[]'::jsonb)
      into v_receipts
      from public.finance_transactions t left join public.receipts r on r.transaction_id = t.id
     where t.batch_id = v_key and t.sign = 1;
    return jsonb_build_object('status', 'already_posted', 'batch_id', v_key, 'receipts', v_receipts);
  end if;

  v_units := public.units_within(v_root.id);
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    v_kind_count := (nullif(v_line->>'org_unit_id', '') is not null)::int
                  + (nullif(v_line->>'family_id', '') is not null)::int
                  + (nullif(v_line->>'parishioner_id', '') is not null)::int;
    if v_kind_count <> 1 then raise exception 'Kila mstari uwe na mpokeaji mmoja tu' using errcode = 'P0001'; end if;
    v_amt := round((v_line->>'amount')::numeric, 2);
    if v_amt is null or v_amt <= 0 then raise exception 'Kila kiasi cha mgao lazima kiwe zaidi ya sifuri' using errcode = 'P0001'; end if;
    v_identity := concat_ws(':', coalesce(nullif(v_line->>'org_unit_id',''), ''),
      coalesce(nullif(v_line->>'family_id',''), ''), coalesce(nullif(v_line->>'parishioner_id',''), ''));
    if v_identity = any(v_seen) then raise exception 'Mpokeaji amewekwa mara mbili kwenye mgao' using errcode = 'P0001'; end if;
    v_seen := array_append(v_seen, v_identity);

    if nullif(v_line->>'org_unit_id','') is not null and not exists (
      select 1 from public.org_units u where u.id = (v_line->>'org_unit_id')::uuid and u.parish_id = v_parish and u.is_active and u.id = any(v_units)) then
      raise exception 'Kigango au jumuiya si sehemu ya eneo lililochaguliwa' using errcode = 'P0001';
    end if;
    if nullif(v_line->>'family_id','') is not null and not exists (
      select 1 from public.families f where f.id = (v_line->>'family_id')::uuid and f.parish_id = v_parish and f.status = 'active' and f.jumuiya_id = any(v_units)) then
      raise exception 'Familia si sehemu ya eneo lililochaguliwa' using errcode = 'P0001';
    end if;
    if nullif(v_line->>'parishioner_id','') is not null and not exists (
      select 1 from public.parishioners m where m.id = (v_line->>'parishioner_id')::uuid and m.parish_id = v_parish
        and m.membership_status = 'active' and m.jumuiya_id = any(v_units)) then
      raise exception 'Muumini si sehemu ya eneo lililochaguliwa' using errcode = 'P0001';
    end if;
    v_target_unit := coalesce(nullif(v_line->>'org_unit_id','')::uuid,
      (select jumuiya_id from public.families where id = nullif(v_line->>'family_id','')::uuid),
      (select jumuiya_id from public.parishioners where id = nullif(v_line->>'parishioner_id','')::uuid));
    if not public.has_perm('finance.record', v_target_unit) then
      raise exception 'Huna ruhusa ya kurekodi malipo kwa mpokeaji huyu (permission denied)' using errcode = '42501';
    end if;
    v_sum := v_sum + v_amt;
  end loop;
  if v_sum <> v_total then
    raise exception 'Mgawanyo (TZS %) lazima ulingane na kiasi kilichopokelewa (TZS %)', v_sum, v_total using errcode = 'P0001';
  end if;

  v_desc := left(concat_ws(' — ', nullif(btrim(p->>'description'), ''),
    'Mgawanyo kutoka ' || v_root.unit_type || ' ya ' || v_root.name,
    case when nullif(btrim(p->>'brought_by'), '') is not null then 'imeletwa na ' || btrim(p->>'brought_by') end), 300);

  perform set_config('minga.batch_id', v_key::text, true);
  for v_line, v_idx in select * from jsonb_array_elements(p->'lines') with ordinality loop
    v_r := public.post_payment(jsonb_build_object(
      'idempotency_key', md5(v_key::text || ':' || v_idx)::uuid,
      'amount', v_line->'amount', 'txn_date', p->'txn_date', 'category_id', v_cat,
      'campaign_id', nullif(p->>'campaign_id', ''), 'payment_method', p->'payment_method',
      'reference_no', p->'reference_no', 'period_month', p->'period_month', 'description', v_desc,
      'org_unit_id', nullif(v_line->>'org_unit_id',''), 'family_id', nullif(v_line->>'family_id',''),
      'parishioner_id', nullif(v_line->>'parishioner_id',''), 'receiving_officer', p->'receiving_officer',
      'confirm_duplicate', true));
    if v_r->>'status' not in ('posted','already_posted') then
      raise exception 'Malipo ya mpokeaji mmoja hayakukubaliwa; mgao wote umeghairiwa. %', coalesce(v_r->>'message','') using errcode = 'P0001';
    end if;
    v_receipts := v_receipts || jsonb_build_array(jsonb_build_object(
      'payer', (select payer_name from public.finance_transactions where id = (v_r->>'transaction_id')::uuid),
      'amount', v_line->'amount', 'receipt_no', v_r->>'receipt_no', 'receipt_id', v_r->>'receipt_id', 'transaction_id', v_r->>'transaction_id'));
  end loop;
  perform set_config('minga.batch_id', '', true);
  return jsonb_build_object('status', 'posted', 'batch_id', v_key, 'total', v_total,
    'count', jsonb_array_length(v_receipts), 'receipts', v_receipts);
end $$;

revoke execute on function public.post_payment_split(jsonb) from public, anon;
grant execute on function public.post_payment_split(jsonb) to authenticated;
notify pgrst, 'reload schema';
