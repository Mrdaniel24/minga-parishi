-- ============================================================================
-- Minga Parish Management System — migration 07: legacy workbook import
--   Server-side loader used by the generated (private) import script
--   (tools/migration/build_import.py). The loader functions are NOT callable
--   through the API: run the generated script from the Supabase SQL editor or
--   psql as the database owner, after an administrator approved the preview.
--
--   Rules enforced here:
--     * subtotal/summary rows are never imported as payments (the generator
--       sends individual receipt rows only);
--     * every imported row keeps its source reference (sheet, row, receipt no);
--     * imported rows go to the "legacy" money account (1050) until the
--       accountant reconciles them with the bank/cash books;
--     * rows the generator could not resolve safely arrive as status 'pending'
--       with a 'legacy_review' approval request — they count in no total until
--       an accountant fixes and approves them;
--     * the same workbook (sha256) can be imported only once.
-- ============================================================================

create unique index if not exists import_batches_sha_once on public.import_batches (source_sha256) where status = 'imported';

create or replace function public.org_unit_by_key(p_parish uuid, p_key text)
returns uuid language sql stable set search_path = public as $$
  select id from public.org_units
  where parish_id = p_parish and unit_type = split_part(p_key, '|', 1) and name = split_part(p_key, '|', 2)
$$;

create or replace function public.import_legacy_transactions(p_batch uuid, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_parish uuid; v_legacy_acc uuid; v_cat public.contribution_categories; v_txn uuid; n int := 0;
  v_fy uuid; v_attr record; v_pledge uuid; v_campaign uuid; v_org uuid; v_status text;
begin
  select parish_id into v_parish from public.import_batches where id = p_batch;
  if v_parish is null then raise exception 'Import batch % haipo', p_batch; end if;
  select id into v_legacy_acc from public.ledger_accounts where parish_id = v_parish and code = '1050';
  for r in select * from jsonb_array_elements(p_rows) loop
    select * into v_cat from public.contribution_categories where parish_id = v_parish and code = r->>'category';
    if v_cat.id is null then raise exception 'Aina % haijulikani (row %)', r->>'category', r->'legacy'->>'row'; end if;
    v_fy := public.fin_year_for(v_parish, (r->>'txn_date')::date);
    if v_fy is null then raise exception 'Hakuna mwaka wa fedha kwa % (row %)', r->>'txn_date', r->'legacy'->>'row'; end if;
    v_org := case when nullif(r->>'org','') is not null then public.org_unit_by_key(v_parish, r->>'org') end;
    if nullif(r->>'org','') is not null and v_org is null then raise exception 'Kitengo % hakipo (row %)', r->>'org', r->'legacy'->>'row'; end if;
    select * into v_attr from public.resolve_attribution((r->>'parishioner_id')::uuid, (r->>'family_id')::uuid, v_org);
    v_campaign := null; v_pledge := null;
    if nullif(r->>'campaign_year','') is not null then
      select id into v_campaign from public.campaigns
       where parish_id = v_parish and category_id = v_cat.id and campaign_year = (r->>'campaign_year')::int
       order by created_at limit 1;
      if v_campaign is null then raise exception 'Kampeni % % haipo (row %)', r->>'category', r->>'campaign_year', r->'legacy'->>'row'; end if;
      if v_attr.family_id is not null then
        select id into v_pledge from public.pledges
         where campaign_id = v_campaign and family_id = v_attr.family_id and status = 'active' limit 1;
      end if;
    end if;
    v_status := coalesce(r->>'status', 'posted');
    insert into public.finance_transactions (
      parish_id, idempotency_key, kind, amount, status, txn_date, financial_year_id, period_month,
      category_id, campaign_id, pledge_id, fund_id, money_account_id, parishioner_id, family_id, org_unit_id,
      jumuiya_id, kigango_id, payer_name, payment_method, description, posted_at, legacy_receipt_no, legacy_ref, import_batch_id)
    values (
      v_parish, (r->>'key')::uuid, 'income', round((r->>'amount')::numeric, 2), v_status, (r->>'txn_date')::date, v_fy,
      (r->>'period_month')::date, v_cat.id, v_campaign, v_pledge, v_cat.fund_id, v_legacy_acc,
      (r->>'parishioner_id')::uuid, v_attr.family_id, v_attr.org_unit_id, v_attr.jumuiya_id, v_attr.kigango_id,
      nullif(r->>'payer_name',''), coalesce(r->>'payment_method','other'), nullif(r->>'description',''),
      case when v_status = 'posted' then now() end,
      nullif(r->>'legacy_receipt_no',''), r->'legacy', p_batch)
    on conflict (idempotency_key) do nothing
    returning id into v_txn;
    if v_txn is not null then
      if v_pledge is not null then
        insert into public.payment_allocations (transaction_id, pledge_id, amount) values (v_txn, v_pledge, round((r->>'amount')::numeric, 2));
      end if;
      if v_status = 'posted' then
        perform public.write_journal(v_txn);
      else
        insert into public.approval_requests (parish_id, request_type, transaction_id, payload)
        values (v_parish, 'legacy_review', v_txn, jsonb_build_object('issues', r->'issues', 'legacy', r->'legacy'));
      end if;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.import_legacy_transactions(uuid, jsonb) from public, anon, authenticated;

-- Correct a pending (not yet posted) imported row before approving it.
create or replace function public.update_pending_transaction(p_txn uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.finance_transactions; v_cat uuid; v_date date; v_attr record;
begin
  select * into t from public.finance_transactions where id = p_txn for update;
  if t.id is null or t.status <> 'pending' then raise exception 'Muamala haupo au umeshathibitishwa' using errcode = 'P0001'; end if;
  if not public.has_perm('finance.approve', null) then raise exception 'Huna ruhusa' using errcode = '42501'; end if;
  v_date := coalesce((p->>'txn_date')::date, t.txn_date);
  v_cat := coalesce((p->>'category_id')::uuid, t.category_id);
  select * into v_attr from public.resolve_attribution(
    coalesce((p->>'parishioner_id')::uuid, t.parishioner_id), coalesce((p->>'family_id')::uuid, t.family_id),
    coalesce((p->>'org_unit_id')::uuid, t.org_unit_id));
  update public.finance_transactions set
    txn_date = v_date,
    financial_year_id = coalesce(public.fin_year_for(parish_id, v_date), financial_year_id),
    category_id = v_cat,
    fund_id = (select fund_id from public.contribution_categories where id = v_cat),
    period_month = case when p ? 'period_month' then (p->>'period_month')::date else period_month end,
    parishioner_id = coalesce((p->>'parishioner_id')::uuid, parishioner_id),
    family_id = v_attr.family_id, org_unit_id = v_attr.org_unit_id, jumuiya_id = v_attr.jumuiya_id, kigango_id = v_attr.kigango_id,
    amount = coalesce(round((p->>'amount')::numeric, 2), amount),
    payer_name = coalesce(nullif(btrim(p->>'payer_name'),''), payer_name),
    description = coalesce(nullif(btrim(p->>'description'),''), description)
  where id = p_txn;
  insert into public.audit_log (actor_id, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), 'update_pending_transaction', 'finance_transactions', p_txn::text, to_jsonb(t), p);
  return jsonb_build_object('status','updated');
end $$;
revoke execute on function public.update_pending_transaction(uuid, jsonb) from public, anon;
grant execute on function public.update_pending_transaction(uuid, jsonb) to authenticated;

-- Block-level formula parity: the sum of imported rows (posted + pending) inside
-- each legacy SUM(range) must equal the cached Excel subtotal. This proves that
-- no row was lost or duplicated by the import. Call after an import.
create or replace function public.reconcile_legacy_subtotals(p_batch uuid, p_subtotals jsonb)
returns table (status text, n bigint) language plpgsql security definer set search_path = public as $$
declare s jsonb;
begin
  delete from public.reconciliation_results where batch_id = p_batch and sheet = 'AKAUNTI BOOK-MIAMALA YOTE';
  for s in select * from jsonb_array_elements(p_subtotals) loop
    insert into public.reconciliation_results (batch_id, sheet, cell_ref, description, excel_formula, excel_value, system_value, status, explanation)
    select p_batch, 'AKAUNTI BOOK-MIAMALA YOTE', s->>'cell', s->>'key', s->>'formula', (s->>'excel')::numeric,
           coalesce(sum(t.amount), 0),
           case when abs(coalesce(sum(t.amount), 0) - (s->>'excel')::numeric) < 0.005 then 'match' else 'difference' end,
           s->>'explanation'
    from (select 1) one
    left join public.finance_transactions t
      on t.import_batch_id = p_batch and t.sign = 1
     and (t.legacy_ref->>'row')::int between (s->>'r1')::int and (s->>'r2')::int
     and (t.legacy_ref->>'ledger_year')::int = (s->>'year')::int;
  end loop;
  return query select r.status, count(*) from public.reconciliation_results r where r.batch_id = p_batch group by r.status;
end $$;
revoke execute on function public.reconcile_legacy_subtotals(uuid, jsonb) from public, anon, authenticated;
