-- Zaka brought by a jumuiya, divided among its families and members.
-- A jumuiya representative brings one sum (e.g. 200,000) with a list of who
-- paid it. The sum is split into lines — a family, or members of a family —
-- and every line becomes its own payment (own receipt) in ONE transaction:
-- either every line is posted or none is. The lines must add up exactly to
-- the sum that was brought.
--   p: idempotency_key, jumuiya_id, amount, txn_date, payment_method,
--      reference_no, period_month, brought_by, receiving_officer,
--      lines: [{ family_id | parishioner_id, amount }]
create or replace function public.post_zaka_split(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_key uuid := (p->>'idempotency_key')::uuid;
  v_parish uuid := public.default_parish_id();
  v_total numeric(14,2) := round((p->>'amount')::numeric, 2);
  v_jum public.org_units;
  v_cat uuid;
  v_line jsonb; v_idx bigint;
  v_sum numeric := 0;
  v_fam uuid; v_per uuid; v_amt numeric(14,2);
  v_seen text[] := '{}';
  v_desc text;
  v_r jsonb;
  v_receipts jsonb := '[]'::jsonb;
begin
  if v_key is null then raise exception 'idempotency_key inahitajika' using errcode = 'P0001'; end if;
  select * into v_jum from public.org_units where id = (p->>'jumuiya_id')::uuid and parish_id = v_parish;
  if v_jum.id is null or v_jum.unit_type not in ('jumuiya', 'group') then
    raise exception 'Jumuiya haijulikani' using errcode = 'P0001';
  end if;
  if not public.has_perm('finance.record', v_jum.id) then
    raise exception 'Huna ruhusa ya kurekodi malipo (permission denied)' using errcode = '42501';
  end if;
  select id into v_cat from public.contribution_categories where parish_id = v_parish and code = 'ZAKA' and is_active;
  if v_cat is null then raise exception 'Aina ya mchango "Zaka" haipo' using errcode = 'P0001'; end if;
  if v_total is null or v_total <= 0 then raise exception 'Kiasi lazima kiwe zaidi ya sifuri' using errcode = 'P0001'; end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then
    raise exception 'Gawanya kiasi kwa angalau familia moja' using errcode = 'P0001';
  end if;

  -- same submission already processed (retry / double click) → its receipts
  if exists (select 1 from public.finance_transactions where idempotency_key = md5(v_key::text || ':1')::uuid) then
    select coalesce(jsonb_agg(jsonb_build_object('payer', t.payer_name, 'amount', t.amount, 'receipt_no', r.receipt_no, 'receipt_id', r.id) order by i), '[]')
      into v_receipts
      from generate_series(1, jsonb_array_length(p->'lines')) i
      join public.finance_transactions t on t.idempotency_key = md5(v_key::text || ':' || i)::uuid
      left join public.receipts r on r.transaction_id = t.id;
    return jsonb_build_object('status', 'already_posted', 'receipts', v_receipts);
  end if;

  -- every line: one payer of this jumuiya, a positive amount, nobody twice
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    v_fam := nullif(v_line->>'family_id', '')::uuid;
    v_per := nullif(v_line->>'parishioner_id', '')::uuid;
    v_amt := round((v_line->>'amount')::numeric, 2);
    if (v_fam is null) = (v_per is null) then
      raise exception 'Kila mstari ni familia au muumini mmoja' using errcode = 'P0001';
    end if;
    if v_amt is null or v_amt <= 0 then raise exception 'Kila kiasi lazima kiwe zaidi ya sifuri' using errcode = 'P0001'; end if;
    if v_fam is not null and not exists (select 1 from public.families where id = v_fam and jumuiya_id = v_jum.id) then
      raise exception 'Familia si ya Jumuiya ya %', v_jum.name using errcode = 'P0001';
    end if;
    if v_per is not null and not exists (select 1 from public.parishioners where id = v_per and jumuiya_id = v_jum.id) then
      raise exception 'Muumini si wa Jumuiya ya %', v_jum.name using errcode = 'P0001';
    end if;
    if coalesce(v_fam, v_per)::text = any (v_seen) then
      raise exception 'Mlipaji mmoja ameandikwa mara mbili' using errcode = 'P0001';
    end if;
    v_seen := v_seen || coalesce(v_fam, v_per)::text;
    v_sum := v_sum + v_amt;
  end loop;
  if v_sum <> v_total then
    raise exception 'Mgawanyo (TZS %) haulingani na kiasi kilicholetwa (TZS %)', v_sum, v_total using errcode = 'P0001';
  end if;

  v_desc := left(concat_ws(' — ', 'Zaka ya Jumuiya ya ' || v_jum.name,
                 'imeletwa na ' || nullif(btrim(p->>'brought_by'), ''),
                 'jumla TZS ' || to_char(v_total, 'FM999,999,999,990')), 300);

  for v_line, v_idx in select * from jsonb_array_elements(p->'lines') with ordinality loop
    v_r := public.post_payment(jsonb_build_object(
      'idempotency_key', md5(v_key::text || ':' || v_idx)::uuid,
      'amount', v_line->'amount', 'txn_date', p->'txn_date', 'category_id', v_cat,
      'payment_method', p->'payment_method', 'reference_no', p->'reference_no',
      'period_month', p->'period_month', 'description', v_desc,
      'family_id', nullif(v_line->>'family_id', ''), 'parishioner_id', nullif(v_line->>'parishioner_id', ''),
      'receiving_officer', p->'receiving_officer', 'confirm_duplicate', true));
    v_receipts := v_receipts || jsonb_build_object('payer', (select payer_name from public.finance_transactions where id = (v_r->>'transaction_id')::uuid),
      'amount', v_line->'amount', 'receipt_no', v_r->>'receipt_no', 'receipt_id', v_r->>'receipt_id');
  end loop;

  return jsonb_build_object('status', 'posted', 'total', v_total, 'count', jsonb_array_length(v_receipts), 'receipts', v_receipts);
end $$;

revoke execute on function public.post_zaka_split(jsonb) from public, anon;
grant execute on function public.post_zaka_split(jsonb) to authenticated;
notify pgrst, 'reload schema';
