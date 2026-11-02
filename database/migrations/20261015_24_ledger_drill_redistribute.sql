-- ============================================================================
-- Minga Parish Management System — migration 24
--   1. ledger_drill(): the payments behind any total on screen (a member's,
--      family's, jumuiya's or kigango's Zaka, Ujenzi, Sadaka…).
--   2. Payments recorded together (a jumuiya's zaka split among its families)
--      share a batch_id, so they can be opened and corrected together.
--   3. redistribute_payments(): a wrong distribution is corrected. The old
--      lines are reversed and the same money is posted again to the right
--      payers / months, in ONE transaction. Nothing is deleted: the reversals
--      and the new receipts stay in the ledger.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- batch: lines posted together by one form
-- ---------------------------------------------------------------------------
alter table public.finance_transactions add column if not exists batch_id uuid;
create index if not exists ft_batch_idx on public.finance_transactions (batch_id) where batch_id is not null;

-- the posting functions mark the lines of one batch through a setting that
-- lasts until the end of the database transaction (post_payment stays as it is)
create or replace function public.ft_set_batch()
returns trigger language plpgsql as $$
begin
  new.batch_id := coalesce(new.batch_id, nullif(current_setting('minga.batch_id', true), '')::uuid);
  return new;
end $$;
drop trigger if exists finance_transactions_batch on public.finance_transactions;
create trigger finance_transactions_batch before insert on public.finance_transactions
  for each row execute function public.ft_set_batch();

-- a posted row may still get its batch once (used below for splits posted before this migration)
create or replace function public.protect_posted_transactions()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'Muamala uliothibitishwa hauwezi kufutwa — tumia reversal' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status = 'posted' then
    -- only the reversal link (and a first batch_id) may be set on a posted row
    -- (net_amount is generated: it is still NULL in NEW inside a BEFORE trigger)
    if (to_jsonb(new) - 'reversed_by_id' - 'reversal_reason' - 'net_amount' - case when old.batch_id is null then 'batch_id' else '' end)
       is distinct from (to_jsonb(old) - 'reversed_by_id' - 'reversal_reason' - 'net_amount' - case when old.batch_id is null then 'batch_id' else '' end) then
      raise exception 'Muamala uliothibitishwa hauwezi kubadilishwa — tumia reversal au adjustment' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- splits already posted: their lines were written in one database transaction (same posted_at)
update public.finance_transactions t set batch_id = g.batch
  from (select posted_at, recorded_by, (array_agg(id order by txn_no))[1] as batch
          from public.finance_transactions
         where batch_id is null and sign = 1 and description like 'Zaka ya Jumuiya ya % — %'
         group by posted_at, recorded_by having count(*) > 1) g
 where t.batch_id is null and t.sign = 1 and t.description like 'Zaka ya Jumuiya ya % — %'
   and t.posted_at = g.posted_at and t.recorded_by is not distinct from g.recorded_by;

-- One external reference (bank / mobile money) = one payment. The lines of one
-- batch share their reference, and a reversed payment frees it for the
-- corrected entry. The index covers single payments; the trigger covers batches.
drop index if exists public.ft_unique_external_ref;
create unique index if not exists ft_unique_external_ref
  on public.finance_transactions (payment_method, lower(btrim(reference_no)))
  where reference_no is not null and btrim(reference_no) <> '' and sign = 1 and status <> 'rejected'
        and payment_method in ('cheque','bank_transfer','mobile_money') and batch_id is null and reversed_by_id is null;

create or replace function public.ft_guard_external_ref()
returns trigger language plpgsql as $$
begin
  if new.sign = 1 and new.status <> 'rejected' and new.payment_method in ('cheque','bank_transfer','mobile_money')
     and coalesce(btrim(new.reference_no), '') <> ''
     and exists (select 1 from public.finance_transactions t
                  where t.payment_method = new.payment_method and lower(btrim(t.reference_no)) = lower(btrim(new.reference_no))
                    and t.sign = 1 and t.status <> 'rejected' and t.reversed_by_id is null
                    and (new.batch_id is null or t.batch_id is distinct from new.batch_id)) then
    raise exception 'duplicate key value violates unique constraint "ft_unique_external_ref"' using errcode = '23505';
  end if;
  return new;
end $$;
drop trigger if exists finance_transactions_external_ref on public.finance_transactions;
create trigger finance_transactions_external_ref before insert on public.finance_transactions
  for each row execute function public.ft_guard_external_ref();

-- ---------------------------------------------------------------------------
-- ledger_drill: the payments behind a total. Each screen totals by its own
-- rule, and the filter mirrors it:
--   unit         kigango / jumuiya: coalesce(org_unit_id, jumuiya_id) inside it (unit_summary, zaka_grid)
--   unit_self    only what the unit paid itself (org_unit_id = unit)
--   family       family_id (a member's payment carries the family too)
--   parishioner  parishioner_id
--   kinds / not_kinds   contribution groups (zaka, mavuno, ujenzi, sadaka, special, shukrani, income_other)
--   category, campaign, pledge, batch (lines posted together)
--   campaign_year  payments to that year's campaigns (Mavuno / Ujenzi amounts)
--   year         txn_date in the year;  zaka_year   period_month in the year (Zaka grids)
--   period_month one Zaka month;  from / to  a date range
-- Row Level Security applies (SECURITY INVOKER): nobody sees more than before.
-- ---------------------------------------------------------------------------
create or replace function public.ledger_drill(p jsonb)
returns jsonb language sql stable set search_path = public as $$
  with f as (
    select nullif(p->>'unit', '')::uuid as unit, nullif(p->>'unit_self', '')::uuid as unit_self,
           nullif(p->>'family', '')::uuid as family, nullif(p->>'parishioner', '')::uuid as parishioner,
           case when jsonb_typeof(p->'kinds') = 'array' then array(select jsonb_array_elements_text(p->'kinds')) end as kinds,
           case when jsonb_typeof(p->'not_kinds') = 'array' then array(select jsonb_array_elements_text(p->'not_kinds')) end as not_kinds,
           nullif(p->>'category', '')::uuid as category, nullif(p->>'campaign', '')::uuid as campaign,
           nullif(p->>'pledge', '')::uuid as pledge, nullif(p->>'batch', '')::uuid as batch,
           nullif(p->>'year', '')::int as yr, nullif(p->>'campaign_year', '')::int as cyr, nullif(p->>'zaka_year', '')::int as zyr,
           date_trunc('month', nullif(p->>'period_month', '')::date)::date as pm,
           nullif(p->>'from', '')::date as dfrom, nullif(p->>'to', '')::date as dto,
           coalesce(nullif(p->>'status', ''), 'posted') as st
  ),
  rows as (
    select l.*, t.batch_id,
           (select count(*) from public.transaction_attachments a where a.transaction_id = t.id) as attachments
      from public.v_ledger l
      join public.finance_transactions t on t.id = l.id
      cross join f
     where l.kind = 'income'
       and (case f.st when 'all' then l.status <> 'rejected' else l.status = f.st end)
       and (f.unit is null or coalesce(l.org_unit_id, l.jumuiya_id) = any (public.units_within(f.unit)))
       and (f.unit_self is null or l.org_unit_id = f.unit_self)
       and (f.family is null or l.family_id = f.family)
       and (f.parishioner is null or l.parishioner_id = f.parishioner)
       and (f.kinds is null or l.category_kind = any (f.kinds))
       and (f.not_kinds is null or l.category_kind <> all (f.not_kinds))
       and (f.category is null or l.category_id = f.category)
       and (f.campaign is null or l.campaign_id = f.campaign)
       and (f.pledge is null or l.pledge_id = f.pledge)
       and (f.batch is null or t.batch_id = f.batch)
       and (f.yr is null or (l.txn_date >= make_date(f.yr, 1, 1) and l.txn_date < make_date(f.yr + 1, 1, 1)))
       and (f.cyr is null or l.campaign_year = f.cyr)
       and (f.zyr is null or (l.period_month >= make_date(f.zyr, 1, 1) and l.period_month < make_date(f.zyr + 1, 1, 1)))
       and (f.pm is null or l.period_month = f.pm)
       and (f.dfrom is null or l.txn_date >= f.dfrom)
       and (f.dto is null or l.txn_date <= f.dto)
     order by l.txn_date desc, l.txn_no desc
     limit 3000
  )
  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.txn_date desc, rows.txn_no desc), '[]'::jsonb) from rows
$$;

-- ---------------------------------------------------------------------------
-- Reversal: the work itself is shared by reverse_transaction (a person with
-- finance.reverse) and redistribute_payments (also the clerk who recorded it).
-- ---------------------------------------------------------------------------
create or replace function public._reverse_txn(p_txn uuid, p_reason text, p_idempotency_key uuid, p_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.finance_transactions; r public.finance_transactions; v_fy uuid;
begin
  select * into r from public.finance_transactions where idempotency_key = p_idempotency_key;
  if r.id is not null then return jsonb_build_object('status','already_posted','transaction_id',r.id,'txn_no',r.txn_no); end if;
  select * into o from public.finance_transactions where id = p_txn for update;
  if o.id is null then raise exception 'Muamala haupo' using errcode = 'P0001'; end if;
  if o.status <> 'posted' then raise exception 'Muamala haujathibitishwa — hauwezi kurudishwa' using errcode = 'P0001'; end if;
  if o.sign = -1 then raise exception 'Huu tayari ni muamala wa kurudisha (already a reversal)' using errcode = 'P0001'; end if;
  if o.reversed_by_id is not null then raise exception 'Muamala Na. % umesharudishwa (already reversed)', o.txn_no using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Sababu inahitajika (reason required)' using errcode = 'P0001'; end if;
  v_fy := public.assert_period_open(o.parish_id, p_date);

  insert into public.finance_transactions (
    parish_id, idempotency_key, kind, sign, amount, status, txn_date, financial_year_id, period_month,
    category_id, campaign_id, pledge_id, fund_id, money_account_id, to_account_id,
    parishioner_id, family_id, org_unit_id, jumuiya_id, kigango_id, payer_name, payment_method, reference_no,
    description, reverses_id, reversal_reason, event_id, recorded_by, approved_by, posted_at, legacy_receipt_no)
  values (
    o.parish_id, p_idempotency_key, o.kind, -1, o.amount, 'posted', p_date, v_fy, o.period_month,
    o.category_id, o.campaign_id, o.pledge_id, o.fund_id, o.money_account_id, o.to_account_id,
    o.parishioner_id, o.family_id, o.org_unit_id, o.jumuiya_id, o.kigango_id, o.payer_name, o.payment_method, o.reference_no,
    'Kurudisha muamala #' || o.txn_no || ': ' || p_reason, o.id, p_reason, o.event_id, auth.uid(), auth.uid(), now(), o.legacy_receipt_no)
  returning * into r;

  update public.finance_transactions set reversed_by_id = r.id, reversal_reason = p_reason where id = o.id;
  -- mirror allocations: views multiply allocation amounts by the transaction sign
  insert into public.payment_allocations (transaction_id, pledge_id, amount)
    select r.id, pledge_id, amount from public.payment_allocations where transaction_id = o.id;
  perform public.write_journal(r.id);
  update public.receipts set status = 'void', void_reason = p_reason where transaction_id = o.id;
  update public.envelopes set status = 'distributed', returned_on = null, transaction_id = null where transaction_id = o.id;
  insert into public.audit_log (actor_id, action, table_name, row_id, old_data, new_data, note)
  values (auth.uid(), 'reverse_transaction', 'finance_transactions', o.id::text, to_jsonb(o), to_jsonb(r), p_reason);
  return jsonb_build_object('status','posted','transaction_id',r.id,'txn_no',r.txn_no,'reverses_txn_no',o.txn_no);
end $$;
revoke execute on function public._reverse_txn(uuid, text, uuid, date) from public, anon, authenticated;

create or replace function public.reverse_transaction(p_txn uuid, p_reason text, p_idempotency_key uuid, p_date date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.finance_transactions;
begin
  if exists (select 1 from public.finance_transactions where idempotency_key = p_idempotency_key) then
    return public._reverse_txn(p_txn, p_reason, p_idempotency_key, p_date);
  end if;
  select * into o from public.finance_transactions where id = p_txn;
  if o.id is null then raise exception 'Muamala haupo' using errcode = 'P0001'; end if;
  if not public.has_perm('finance.reverse', coalesce(o.org_unit_id, o.jumuiya_id)) then
    raise exception 'Huna ruhusa ya kufuta/kurekebisha muamala (permission denied)' using errcode = '42501';
  end if;
  return public._reverse_txn(p_txn, p_reason, p_idempotency_key, p_date);
end $$;

-- ---------------------------------------------------------------------------
-- post_zaka_split (migration 22) — its lines now form one batch
-- ---------------------------------------------------------------------------
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
    select coalesce(jsonb_agg(jsonb_build_object('payer', t.payer_name, 'amount', t.amount, 'receipt_no', r.receipt_no, 'receipt_id', r.id, 'transaction_id', t.id) order by i), '[]')
      into v_receipts
      from generate_series(1, jsonb_array_length(p->'lines')) i
      join public.finance_transactions t on t.idempotency_key = md5(v_key::text || ':' || i)::uuid
      left join public.receipts r on r.transaction_id = t.id;
    return jsonb_build_object('status', 'already_posted', 'batch_id', v_key, 'receipts', v_receipts);
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

  perform set_config('minga.batch_id', v_key::text, true);
  for v_line, v_idx in select * from jsonb_array_elements(p->'lines') with ordinality loop
    v_r := public.post_payment(jsonb_build_object(
      'idempotency_key', md5(v_key::text || ':' || v_idx)::uuid,
      'amount', v_line->'amount', 'txn_date', p->'txn_date', 'category_id', v_cat,
      'payment_method', p->'payment_method', 'reference_no', p->'reference_no',
      'period_month', p->'period_month', 'description', v_desc,
      'family_id', nullif(v_line->>'family_id', ''), 'parishioner_id', nullif(v_line->>'parishioner_id', ''),
      'receiving_officer', p->'receiving_officer', 'confirm_duplicate', true));
    v_receipts := v_receipts || jsonb_build_object('payer', (select payer_name from public.finance_transactions where id = (v_r->>'transaction_id')::uuid),
      'amount', v_line->'amount', 'receipt_no', v_r->>'receipt_no', 'receipt_id', v_r->>'receipt_id', 'transaction_id', v_r->>'transaction_id');
  end loop;
  perform set_config('minga.batch_id', '', true);

  return jsonb_build_object('status', 'posted', 'batch_id', v_key, 'total', v_total, 'count', jsonb_array_length(v_receipts), 'receipts', v_receipts);
end $$;

-- ---------------------------------------------------------------------------
-- redistribute_payments: correct who (or which month) a sum was given for.
--   p: idempotency_key, transaction_ids: [uuid], reason,
--      lines: [{ family_id | parishioner_id | org_unit_id, amount, period_month? }],
--      receiving_officer
-- The old lines must be of one kind (same contribution, campaign, payment
-- method and reference); the new lines must add up exactly to them. Allowed to
-- whoever may reverse payments, and to the clerk who recorded them.
-- ---------------------------------------------------------------------------
create or replace function public.redistribute_payments(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_key uuid := (p->>'idempotency_key')::uuid;
  v_reason text := btrim(coalesce(p->>'reason', ''));
  v_ids uuid[];
  o public.finance_transactions;
  v_first public.finance_transactions;
  v_total numeric(14,2) := 0;
  v_sum numeric(14,2) := 0;
  v_date date;
  v_line jsonb; v_idx bigint;
  v_kinds int; v_amt numeric(14,2);
  v_seen text[] := '{}'; v_who text;
  v_r jsonb;
  v_receipts jsonb := '[]'::jsonb;
  v_desc text;
  i int := 0;
begin
  if v_key is null then raise exception 'idempotency_key inahitajika' using errcode = 'P0001'; end if;

  -- same submission already processed (retry / double click) → its receipts
  if exists (select 1 from public.finance_transactions where idempotency_key = md5(v_key::text || ':1')::uuid) then
    select coalesce(jsonb_agg(jsonb_build_object('payer', t.payer_name, 'amount', t.amount, 'receipt_no', r.receipt_no, 'receipt_id', r.id, 'transaction_id', t.id) order by t.txn_no), '[]')
      into v_receipts
      from public.finance_transactions t left join public.receipts r on r.transaction_id = t.id
     where t.batch_id = v_key;
    return jsonb_build_object('status', 'already_posted', 'batch_id', v_key, 'receipts', v_receipts);
  end if;

  if length(v_reason) < 3 then raise exception 'Andika sababu ya kurekebisha' using errcode = 'P0001'; end if;
  if jsonb_typeof(p->'transaction_ids') <> 'array' or jsonb_array_length(p->'transaction_ids') = 0 then
    raise exception 'Chagua miamala ya kurekebisha' using errcode = 'P0001';
  end if;
  select array_agg(distinct x::uuid) into v_ids from jsonb_array_elements_text(p->'transaction_ids') x;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then
    raise exception 'Mgawanyo mpya hauna mstari wowote' using errcode = 'P0001';
  end if;

  -- the old lines
  for o in select * from public.finance_transactions where id = any (v_ids) order by txn_no for update loop
    i := i + 1;
    if o.kind <> 'income' or o.status <> 'posted' or o.sign <> 1 then
      raise exception 'Muamala Na. % hauwezi kurekebishwa', o.txn_no using errcode = 'P0001';
    end if;
    if o.reversed_by_id is not null then raise exception 'Muamala Na. % umesharudishwa', o.txn_no using errcode = 'P0001'; end if;
    if not (public.has_perm('finance.reverse', coalesce(o.org_unit_id, o.jumuiya_id))
            or (o.recorded_by = auth.uid() and public.has_perm('finance.record', coalesce(o.org_unit_id, o.jumuiya_id)))) then
      raise exception 'Huna ruhusa ya kurekebisha muamala Na. % (permission denied)', o.txn_no using errcode = '42501';
    end if;
    if v_first.id is null then v_first := o;
    elsif o.category_id <> v_first.category_id or o.campaign_id is distinct from v_first.campaign_id
       or o.payment_method <> v_first.payment_method
       or lower(btrim(coalesce(o.reference_no, ''))) <> lower(btrim(coalesce(v_first.reference_no, ''))) then
      raise exception 'Miamala ya kurekebisha pamoja lazima iwe ya aina moja, njia moja ya malipo na kumbukumbu moja' using errcode = 'P0001';
    end if;
    v_total := v_total + o.amount;
    v_date := least(coalesce(v_date, o.txn_date), o.txn_date);
  end loop;
  if i <> coalesce(array_length(v_ids, 1), 0) then raise exception 'Muamala mmojawapo haupo' using errcode = 'P0001'; end if;

  -- the new lines
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    v_kinds := (nullif(v_line->>'family_id', '') is not null)::int + (nullif(v_line->>'parishioner_id', '') is not null)::int
             + (nullif(v_line->>'org_unit_id', '') is not null)::int;
    if v_kinds <> 1 then raise exception 'Kila mstari ni mlipaji mmoja (muumini, familia au jumuiya)' using errcode = 'P0001'; end if;
    v_amt := round((v_line->>'amount')::numeric, 2);
    if v_amt is null or v_amt <= 0 then raise exception 'Kila kiasi lazima kiwe zaidi ya sifuri' using errcode = 'P0001'; end if;
    v_who := concat_ws(':', v_line->>'family_id', v_line->>'parishioner_id', v_line->>'org_unit_id',
                       date_trunc('month', coalesce(nullif(v_line->>'period_month', '')::date, v_first.period_month))::date);
    if v_who = any (v_seen) then raise exception 'Mlipaji mmoja ameandikwa mara mbili kwa mwezi mmoja' using errcode = 'P0001'; end if;
    v_seen := v_seen || v_who;
    v_sum := v_sum + v_amt;
  end loop;
  if v_sum <> v_total then
    raise exception 'Mgawanyo mpya (TZS %) lazima ulingane na kiasi cha awali (TZS %)', v_sum, v_total using errcode = 'P0001';
  end if;

  -- reverse the old lines on their own date (reports of that day / month stay right)
  i := 0;
  for o in select * from public.finance_transactions where id = any (v_ids) order by txn_no loop
    i := i + 1;
    perform public._reverse_txn(o.id, 'Marekebisho ya mgawanyo: ' || v_reason, md5(v_key::text || ':r' || i)::uuid, o.txn_date);
  end loop;

  -- post the same money again, as one batch
  v_desc := left('Marekebisho ya mgawanyo: ' || v_reason || coalesce(' — ' || nullif(v_first.description, ''), ''), 300);
  perform set_config('minga.batch_id', v_key::text, true);
  for v_line, v_idx in select * from jsonb_array_elements(p->'lines') with ordinality loop
    v_r := public.post_payment(jsonb_build_object(
      'idempotency_key', md5(v_key::text || ':' || v_idx)::uuid,
      'amount', v_line->'amount', 'txn_date', v_date, 'category_id', v_first.category_id, 'campaign_id', v_first.campaign_id,
      'payment_method', v_first.payment_method, 'reference_no', v_first.reference_no,
      'period_month', coalesce(nullif(v_line->>'period_month', '')::date, v_first.period_month),
      'description', v_desc, 'money_account_id', v_first.money_account_id,
      'family_id', nullif(v_line->>'family_id', ''), 'parishioner_id', nullif(v_line->>'parishioner_id', ''),
      'org_unit_id', nullif(v_line->>'org_unit_id', ''),
      'receiving_officer', p->'receiving_officer', 'confirm_duplicate', true));
    v_receipts := v_receipts || jsonb_build_object('payer', (select payer_name from public.finance_transactions where id = (v_r->>'transaction_id')::uuid),
      'amount', v_line->'amount', 'receipt_no', v_r->>'receipt_no', 'receipt_id', v_r->>'receipt_id', 'transaction_id', v_r->>'transaction_id');
  end loop;
  perform set_config('minga.batch_id', '', true);

  -- proof documents follow the money
  insert into public.transaction_attachments (transaction_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  select (r->>'transaction_id')::uuid, a.storage_path, a.file_name, a.mime_type, a.size_bytes, a.uploaded_by
    from jsonb_array_elements(v_receipts) r
    cross join (select distinct on (storage_path) * from public.transaction_attachments where transaction_id = any (v_ids)) a;

  insert into public.audit_log (actor_id, action, table_name, row_id, old_data, new_data, note)
  values (auth.uid(), 'redistribute_payments', 'finance_transactions', v_key::text, to_jsonb(v_ids), v_receipts, v_reason);

  return jsonb_build_object('status', 'posted', 'batch_id', v_key, 'total', v_total, 'count', jsonb_array_length(v_receipts), 'receipts', v_receipts);
end $$;

revoke execute on function public.redistribute_payments(jsonb) from public, anon;
grant execute on function public.redistribute_payments(jsonb) to authenticated;
grant execute on function public.ledger_drill(jsonb) to authenticated;
notify pgrst, 'reload schema';
