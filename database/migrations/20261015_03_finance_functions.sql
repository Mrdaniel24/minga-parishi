-- ============================================================================
-- Minga Parish Management System — migration 03: posting engine
--   All writes to the ledger go through these SECURITY DEFINER functions.
--   Each function checks permissions itself (has_perm), runs in one database
--   transaction, and is idempotent where the UI can retry.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.fin_year_for(p_parish uuid, p_date date)
returns uuid language sql stable set search_path = public as $$
  select id from public.financial_years
  where parish_id = p_parish and p_date between starts_on and ends_on
  order by starts_on desc limit 1
$$;

create or replace function public.assert_period_open(p_parish uuid, p_date date)
returns uuid language plpgsql stable set search_path = public as $$
declare fy public.financial_years;
begin
  select * into fy from public.financial_years
   where parish_id = p_parish and p_date between starts_on and ends_on order by starts_on desc limit 1;
  if fy.id is null then
    raise exception 'Hakuna mwaka wa fedha unaojumuisha tarehe % (No financial year covers %)', p_date, p_date using errcode = 'P0001';
  end if;
  if fy.status = 'closed' then
    raise exception 'Mwaka wa fedha % umefungwa (financial year closed)', fy.label using errcode = 'P0001';
  end if;
  if exists (select 1 from public.accounting_periods
             where financial_year_id = fy.id and p_date between period_start and period_end and is_locked) then
    raise exception 'Kipindi cha % kimefungwa (period locked)', to_char(p_date, 'YYYY-MM') using errcode = 'P0001';
  end if;
  return fy.id;
end $$;

create or replace function public.default_parish_id()
returns uuid language sql stable set search_path = public as $$
  select id from public.parishes order by created_at limit 1
$$;

create or replace function public.money_account_for(p_parish uuid, p_method text, p_account uuid)
returns uuid language plpgsql stable set search_path = public as $$
declare v uuid; k text;
begin
  if p_account is not null then
    select id into v from public.ledger_accounts
     where id = p_account and parish_id = p_parish and money_kind is not null and is_active;
    if v is null then raise exception 'Akaunti ya fedha si sahihi (invalid money account)' using errcode = 'P0001'; end if;
    return v;
  end if;
  k := case p_method when 'cash' then 'cash' when 'envelope' then 'cash' when 'mobile_money' then 'mobile_money' else 'bank' end;
  select id into v from public.ledger_accounts
   where parish_id = p_parish and money_kind = k and is_active order by code limit 1;
  if v is null then raise exception 'Hakuna akaunti ya fedha ya aina % (no % account configured)', k, k using errcode = 'P0001'; end if;
  return v;
end $$;

-- resolve jumuiya / kigango snapshot for a payer
create or replace function public.resolve_attribution(p_parishioner uuid, p_family uuid, p_org uuid,
  out family_id uuid, out jumuiya_id uuid, out kigango_id uuid, out org_unit_id uuid)
language plpgsql stable set search_path = public as $$
declare t text;
begin
  family_id := p_family;
  if p_parishioner is not null then
    select coalesce(p.family_id, p_family), coalesce(p.jumuiya_id, f.jumuiya_id)
      into family_id, jumuiya_id
      from public.parishioners p left join public.families f on f.id = p.family_id where p.id = p_parishioner;
    if not found then raise exception 'Muumini hayupo (parishioner not found)' using errcode = 'P0001'; end if;
  end if;
  if jumuiya_id is null and family_id is not null then
    select f.jumuiya_id into jumuiya_id from public.families f where f.id = family_id;
  end if;
  org_unit_id := coalesce(p_org, jumuiya_id);
  if jumuiya_id is null and org_unit_id is not null then
    jumuiya_id := public.org_ancestor_of_type(org_unit_id, 'jumuiya');
  end if;
  if org_unit_id is not null then
    kigango_id := public.org_ancestor_of_type(org_unit_id, 'kigango');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Amount in words (Kiswahili and English) for receipts
-- ---------------------------------------------------------------------------
create or replace function public.amount_words_sw(p numeric)
returns text language plpgsql immutable as $$
declare n bigint := trunc(abs(p)); cents int := round((abs(p) - trunc(abs(p))) * 100);
begin
  if n = 0 and cents = 0 then return 'Shilingi sifuri'; end if;
  return 'Shilingi ' || public._sw_words(n)
         || case when cents > 0 then ' na senti ' || public._sw_words(cents) else '' end;
end $$;

create or replace function public._sw_words(n bigint)
returns text language plpgsql immutable as $$
declare
  units text[] := array['moja','mbili','tatu','nne','tano','sita','saba','nane','tisa'];
  tens  text[] := array['kumi','ishirini','thelathini','arobaini','hamsini','sitini','sabini','themanini','tisini'];
  r bigint;
begin
  if n = 0 then return ''; end if;
  if n < 10 then return units[n]; end if;
  if n < 100 then
    return tens[n / 10] || case when n % 10 > 0 then ' na ' || units[n % 10] else '' end;
  end if;
  if n < 1000 then
    r := n % 100;
    return 'mia ' || units[n / 100] || case when r > 0 then ' na ' || public._sw_words(r) else '' end;
  end if;
  if n < 100000 then
    r := n % 1000;
    return 'elfu ' || public._sw_words(n / 1000) || case when r > 0 then ' na ' || public._sw_words(r) else '' end;
  end if;
  if n < 1000000 then
    r := n % 100000;
    return 'laki ' || units[n / 100000] || case when r > 0 then ' na ' || public._sw_words(r) else '' end;
  end if;
  if n < 1000000000 then
    r := n % 1000000;
    return 'milioni ' || public._sw_words(n / 1000000) || case when r > 0 then ', ' || public._sw_words(r) else '' end;
  end if;
  r := n % 1000000000;
  return 'bilioni ' || public._sw_words(n / 1000000000) || case when r > 0 then ', ' || public._sw_words(r) else '' end;
end $$;

create or replace function public._en_words(n bigint)
returns text language plpgsql immutable as $$
declare
  ones text[] := array['One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve',
                       'Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  tens text[] := array['','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  r bigint;
begin
  if n = 0 then return ''; end if;
  if n < 20 then return ones[n]; end if;
  if n < 100 then return tens[n / 10] || case when n % 10 > 0 then '-' || ones[n % 10] else '' end; end if;
  if n < 1000 then
    r := n % 100;
    return ones[n / 100] || ' Hundred' || case when r > 0 then ' and ' || public._en_words(r) else '' end;
  end if;
  if n < 1000000 then
    r := n % 1000;
    return public._en_words(n / 1000) || ' Thousand' || case when r = 0 then '' when r < 100 then ' and ' else ' ' end || public._en_words(r);
  end if;
  if n < 1000000000 then
    r := n % 1000000;
    return public._en_words(n / 1000000) || ' Million' || case when r = 0 then '' when r < 100 then ' and ' else ' ' end || public._en_words(r);
  end if;
  r := n % 1000000000;
  return public._en_words(n / 1000000000) || ' Billion' || case when r = 0 then '' when r < 100 then ' and ' else ' ' end || public._en_words(r);
end $$;

create or replace function public.amount_words_en(p numeric)
returns text language plpgsql immutable as $$
declare n bigint := trunc(abs(p)); cents int := round((abs(p) - trunc(abs(p))) * 100);
begin
  if n = 0 and cents = 0 then return 'Zero Shillings Only'; end if;
  return trim(public._en_words(n)) || ' Shillings'
         || case when cents > 0 then ' and ' || public._en_words(cents) || ' Cents' else '' end || ' Only';
end $$;

-- ---------------------------------------------------------------------------
-- Receipt numbering — the counter row is locked inside the posting transaction,
-- so two simultaneous payments can never receive the same number.
-- ---------------------------------------------------------------------------
create or replace function public.issue_receipt(p_txn uuid, p_officer text default null)
returns public.receipts language plpgsql security definer set search_path = public as $$
declare
  t public.finance_transactions; p public.parishes; s text; n bigint; r public.receipts;
begin
  select * into t from public.finance_transactions where id = p_txn;
  select * into r from public.receipts where transaction_id = p_txn;
  if r.id is not null then return r; end if;
  select * into p from public.parishes where id = t.parish_id;
  s := to_char(t.txn_date, 'YYYY');
  insert into public.receipt_counters (parish_id, series, last_no) values (t.parish_id, s, 0)
    on conflict (parish_id, series) do nothing;
  update public.receipt_counters set last_no = last_no + 1
   where parish_id = t.parish_id and series = s returning last_no into n;
  insert into public.receipts (parish_id, receipt_no, series, seq, transaction_id, issued_by, receiving_officer,
                               payer_name, amount, amount_words_sw, amount_words_en)
  values (t.parish_id, coalesce(p.receipt_prefix, p.code) || '-' || s || '-' || lpad(n::text, 6, '0'), s, n, t.id,
          auth.uid(), p_officer, t.payer_name, t.amount, public.amount_words_sw(t.amount), public.amount_words_en(t.amount))
  returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Journal generation
-- ---------------------------------------------------------------------------
create or replace function public.write_journal(p_txn uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t public.finance_transactions; c public.contribution_categories; e uuid; other uuid; dr uuid; cr uuid;
begin
  select * into t from public.finance_transactions where id = p_txn;
  if t.status <> 'posted' then return null; end if;
  select * into c from public.contribution_categories where id = t.category_id;
  if t.kind = 'income' then
    other := coalesce(c.income_account_id,
                      (select id from public.ledger_accounts where parish_id = t.parish_id and account_type = 'income' order by code limit 1));
    dr := t.money_account_id; cr := other;
  elsif t.kind = 'expense' then
    other := coalesce(c.expense_account_id,
                      (select id from public.ledger_accounts where parish_id = t.parish_id and account_type = 'expense' order by code limit 1));
    dr := other; cr := t.money_account_id;
  elsif t.kind = 'transfer' then
    dr := t.to_account_id; cr := t.money_account_id;
  else  -- opening_balance / adjustment: against equity
    other := (select id from public.ledger_accounts where parish_id = t.parish_id and account_type = 'equity' order by code limit 1);
    dr := t.money_account_id; cr := other;
  end if;
  if dr is null or cr is null then
    raise exception 'Akaunti za journal hazijawekwa kwa aina hii (missing ledger account for %)', t.kind using errcode = 'P0001';
  end if;
  if t.sign = -1 then other := dr; dr := cr; cr := other; end if;   -- reversal swaps sides
  insert into public.journal_entries (parish_id, transaction_id, entry_date, memo)
  values (t.parish_id, t.id, t.txn_date, coalesce(t.description, t.kind) || ' #' || t.txn_no) returning id into e;
  insert into public.journal_lines (entry_id, account_id, fund_id, debit, credit) values
    (e, dr, t.fund_id, t.amount, 0),
    (e, cr, t.fund_id, 0, t.amount);
  return e;
end $$;

-- ---------------------------------------------------------------------------
-- POST A PAYMENT (michango / zaka / mavuno / ujenzi / sadaka …)
--
-- p fields: idempotency_key (uuid, required), amount, txn_date, category_id,
--   campaign_id, pledge_id, parishioner_id, family_id, org_unit_id, payer_name,
--   payment_method, money_account_id, reference_no, description, period_month,
--   allocations [{pledge_id, amount}], confirm_duplicate (bool),
--   receiving_officer, envelope_id, event_id
-- Returns {status: posted | already_posted | possible_duplicate, ...}
-- ---------------------------------------------------------------------------
create or replace function public.post_payment(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_key uuid := (p->>'idempotency_key')::uuid;
  v_amount numeric(14,2) := round((p->>'amount')::numeric, 2);
  v_date date := coalesce((p->>'txn_date')::date, current_date);
  v_parish uuid := coalesce((p->>'parish_id')::uuid, public.default_parish_id());
  v_cat public.contribution_categories;
  v_campaign public.campaigns;
  v_pledge public.pledges;
  v_attr record;
  v_fy uuid;
  v_txn public.finance_transactions;
  v_dup public.finance_transactions;
  v_receipt public.receipts;
  v_method text := coalesce(nullif(p->>'payment_method',''), 'cash');
  v_period date;
  v_alloc jsonb; v_alloc_total numeric := 0;
  v_payer text;
begin
  if v_key is null then raise exception 'idempotency_key inahitajika' using errcode = 'P0001'; end if;

  -- 1. same submission already processed → return the original result (retry / double click)
  select * into v_txn from public.finance_transactions where idempotency_key = v_key;
  if v_txn.id is not null then
    select * into v_receipt from public.receipts where transaction_id = v_txn.id;
    return jsonb_build_object('status','already_posted','transaction_id',v_txn.id,'txn_no',v_txn.txn_no,
                              'receipt_no',v_receipt.receipt_no);
  end if;

  -- 2. validation
  if v_amount is null or v_amount <= 0 then raise exception 'Kiasi lazima kiwe zaidi ya sifuri (amount must be positive)' using errcode = 'P0001'; end if;
  if v_amount > 1000000000 then raise exception 'Kiasi ni kikubwa mno (amount too large)' using errcode = 'P0001'; end if;
  select * into v_cat from public.contribution_categories
   where id = (p->>'category_id')::uuid and parish_id = v_parish and is_active;
  if v_cat.id is null then raise exception 'Aina ya mchango haijulikani (unknown category)' using errcode = 'P0001'; end if;
  if v_cat.kind = 'expense' then raise exception 'Tumia record_expense kwa matumizi' using errcode = 'P0001'; end if;
  if v_method not in ('cash','cheque','bank_transfer','mobile_money','envelope','other') then
    raise exception 'Njia ya malipo si sahihi (invalid payment method)' using errcode = 'P0001';
  end if;
  if v_method in ('bank_transfer','mobile_money') and coalesce(btrim(p->>'reference_no'),'') = '' then
    raise exception 'Namba ya kumbukumbu inahitajika kwa malipo ya benki/simu (reference required)' using errcode = 'P0001';
  end if;
  if nullif(p->>'parishioner_id','') is null and nullif(p->>'family_id','') is null
     and nullif(p->>'org_unit_id','') is null and coalesce(btrim(p->>'payer_name'),'') = '' then
    raise exception 'Mlipaji anahitajika (payer required)' using errcode = 'P0001';
  end if;

  select * into v_attr from public.resolve_attribution((p->>'parishioner_id')::uuid, (p->>'family_id')::uuid, (p->>'org_unit_id')::uuid);

  if not public.has_perm('finance.record', coalesce(v_attr.org_unit_id, v_attr.jumuiya_id)) then
    raise exception 'Huna ruhusa ya kurekodi malipo (permission denied)' using errcode = '42501';
  end if;

  v_fy := public.assert_period_open(v_parish, v_date);

  if nullif(p->>'campaign_id','') is not null then
    select * into v_campaign from public.campaigns where id = (p->>'campaign_id')::uuid and parish_id = v_parish;
    if v_campaign.id is null or v_campaign.category_id <> v_cat.id then
      raise exception 'Kampeni hailingani na aina ya mchango (campaign/category mismatch)' using errcode = 'P0001';
    end if;
    if v_campaign.status = 'closed' then raise exception 'Kampeni % imefungwa', v_campaign.name using errcode = 'P0001'; end if;
  end if;

  if v_cat.uses_period_month then
    v_period := date_trunc('month', coalesce((p->>'period_month')::date, v_date))::date;
  end if;

  -- 3. obligation (pledge) the payment is taken against
  if nullif(p->>'pledge_id','') is not null then
    select * into v_pledge from public.pledges where id = (p->>'pledge_id')::uuid and parish_id = v_parish;
    if v_pledge.id is null or v_pledge.status <> 'active' then
      raise exception 'Ahadi haipo au haiko hai (pledge not active)' using errcode = 'P0001';
    end if;
    if v_campaign.id is null then select * into v_campaign from public.campaigns where id = v_pledge.campaign_id; end if;
    if v_pledge.campaign_id <> v_campaign.id then raise exception 'Ahadi si ya kampeni hii' using errcode = 'P0001'; end if;
  elsif v_campaign.id is not null then
    -- most specific obligation first: the person's own pledge, then their family's,
    -- then (for a payment made by a community itself) the community's
    select * into v_pledge from public.pledges
     where campaign_id = v_campaign.id and status = 'active'
       and ((nullif(p->>'parishioner_id','') is not null and parishioner_id = (p->>'parishioner_id')::uuid)
         or (v_attr.family_id is not null and family_id = v_attr.family_id)
         or (nullif(p->>'parishioner_id','') is null and v_attr.family_id is null and nullif(p->>'org_unit_id','') is not null
             and org_unit_id = (p->>'org_unit_id')::uuid))
     order by (parishioner_id is not null) desc, (family_id is not null) desc
     limit 1;
  end if;

  v_payer := coalesce(nullif(btrim(p->>'payer_name'),''),
                      (select full_name from public.parishioners where id = (p->>'parishioner_id')::uuid),
                      (select family_name from public.families where id = v_attr.family_id),
                      (select name from public.org_units where id = v_attr.org_unit_id));

  -- 4. possible duplicate (same payer, amount, category and day) — ask the user to confirm
  if not coalesce((p->>'confirm_duplicate')::boolean, false) then
    select * into v_dup from public.finance_transactions t
     where t.parish_id = v_parish and t.sign = 1 and t.reversed_by_id is null and t.status <> 'rejected'
       and t.category_id = v_cat.id and t.amount = v_amount and t.txn_date = v_date
       and t.campaign_id is not distinct from v_campaign.id
       and t.parishioner_id is not distinct from (p->>'parishioner_id')::uuid
       and t.family_id is not distinct from v_attr.family_id
       and t.org_unit_id is not distinct from v_attr.org_unit_id
       and t.period_month is not distinct from v_period
       and lower(coalesce(t.payer_name,'')) = lower(coalesce(v_payer,''))
     limit 1;
    if v_dup.id is not null then
      return jsonb_build_object('status','possible_duplicate','existing_transaction_id',v_dup.id,'existing_txn_no',v_dup.txn_no,
        'message','Malipo kama haya yamesharekodiwa leo. Thibitisha kama ni malipo mapya.');
    end if;
  end if;

  -- 5. ledger row
  insert into public.finance_transactions (
    parish_id, idempotency_key, kind, amount, status, txn_date, financial_year_id, period_month,
    category_id, campaign_id, pledge_id, fund_id, money_account_id,
    parishioner_id, family_id, org_unit_id, jumuiya_id, kigango_id, payer_name,
    payment_method, reference_no, description, event_id, envelope_id, recorded_by, approved_by, posted_at)
  values (
    v_parish, v_key, 'income', v_amount, 'posted', v_date, v_fy, v_period,
    v_cat.id, v_campaign.id, v_pledge.id, v_cat.fund_id, public.money_account_for(v_parish, v_method, (p->>'money_account_id')::uuid),
    (p->>'parishioner_id')::uuid, v_attr.family_id, v_attr.org_unit_id, v_attr.jumuiya_id, v_attr.kigango_id,
    v_payer, v_method, nullif(btrim(p->>'reference_no'),''), nullif(btrim(p->>'description'),''),
    (p->>'event_id')::uuid, (p->>'envelope_id')::uuid, auth.uid(), auth.uid(), now())
  returning * into v_txn;

  -- 6. allocation to obligations
  if jsonb_typeof(p->'allocations') = 'array' and jsonb_array_length(p->'allocations') > 0 then
    for v_alloc in select * from jsonb_array_elements(p->'allocations') loop
      perform 1 from public.pledges pl where pl.id = (v_alloc->>'pledge_id')::uuid and pl.status = 'active' and pl.parish_id = v_parish;
      if not found then raise exception 'Ahadi % haipo/haiko hai', v_alloc->>'pledge_id' using errcode = 'P0001'; end if;
      insert into public.payment_allocations (transaction_id, pledge_id, amount)
      values (v_txn.id, (v_alloc->>'pledge_id')::uuid, round((v_alloc->>'amount')::numeric, 2));
      v_alloc_total := v_alloc_total + round((v_alloc->>'amount')::numeric, 2);
    end loop;
    if v_alloc_total > v_amount then raise exception 'Mgawanyo unazidi kiasi kilicholipwa (allocations exceed amount)' using errcode = 'P0001'; end if;
  elsif v_pledge.id is not null then
    insert into public.payment_allocations (transaction_id, pledge_id, amount) values (v_txn.id, v_pledge.id, v_amount);
  end if;

  -- 7. accounting, receipt, envelope, audit
  perform public.write_journal(v_txn.id);
  v_receipt := public.issue_receipt(v_txn.id, nullif(p->>'receiving_officer',''));
  if v_txn.envelope_id is not null then
    update public.envelopes set status = 'returned', returned_on = v_date, transaction_id = v_txn.id where id = v_txn.envelope_id;
  end if;
  insert into public.audit_log (actor_id, action, table_name, row_id, new_data)
  values (auth.uid(), 'post_payment', 'finance_transactions', v_txn.id::text, to_jsonb(v_txn));

  return jsonb_build_object('status','posted','transaction_id',v_txn.id,'txn_no',v_txn.txn_no,
    'receipt_no',v_receipt.receipt_no,'receipt_id',v_receipt.id,'pledge_id',v_pledge.id,
    'pledge', (select to_jsonb(b) from public.v_pledge_balances b where b.pledge_id = v_pledge.id));
end $$;

-- ---------------------------------------------------------------------------
-- REVERSE a posted transaction (correction). The original stays untouched
-- except for the link; a mirror row with sign = -1 is posted on p_date.
-- ---------------------------------------------------------------------------
create or replace function public.reverse_transaction(p_txn uuid, p_reason text, p_idempotency_key uuid, p_date date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.finance_transactions; r public.finance_transactions; v_fy uuid;
begin
  select * into r from public.finance_transactions where idempotency_key = p_idempotency_key;
  if r.id is not null then return jsonb_build_object('status','already_posted','transaction_id',r.id,'txn_no',r.txn_no); end if;
  select * into o from public.finance_transactions where id = p_txn for update;
  if o.id is null then raise exception 'Muamala haupo' using errcode = 'P0001'; end if;
  if not public.has_perm('finance.reverse', coalesce(o.org_unit_id, o.jumuiya_id)) then
    raise exception 'Huna ruhusa ya kufuta/kurekebisha muamala (permission denied)' using errcode = '42501';
  end if;
  if o.status <> 'posted' then raise exception 'Muamala haujathibitishwa — hauwezi kurudishwa' using errcode = 'P0001'; end if;
  if o.sign = -1 then raise exception 'Huu tayari ni muamala wa kurudisha (already a reversal)' using errcode = 'P0001'; end if;
  if o.reversed_by_id is not null then raise exception 'Muamala huu umesharudishwa (already reversed)' using errcode = 'P0001'; end if;
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

-- ---------------------------------------------------------------------------
-- EXPENSES: recorded as pending, posted only after a second person approves.
-- ---------------------------------------------------------------------------
create or replace function public.record_expense(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_key uuid := (p->>'idempotency_key')::uuid;
  v_parish uuid := coalesce((p->>'parish_id')::uuid, public.default_parish_id());
  v_amount numeric(14,2) := round((p->>'amount')::numeric, 2);
  v_date date := coalesce((p->>'txn_date')::date, current_date);
  v_cat public.contribution_categories; v_txn public.finance_transactions; v_fy uuid; v_req uuid;
  v_method text := coalesce(nullif(p->>'payment_method',''), 'cash');
begin
  if v_key is null then raise exception 'idempotency_key inahitajika' using errcode = 'P0001'; end if;
  select * into v_txn from public.finance_transactions where idempotency_key = v_key;
  if v_txn.id is not null then return jsonb_build_object('status','already_recorded','transaction_id',v_txn.id,'txn_no',v_txn.txn_no); end if;
  if not public.has_perm('finance.expense.record', null) then
    raise exception 'Huna ruhusa ya kurekodi matumizi (permission denied)' using errcode = '42501';
  end if;
  if v_amount is null or v_amount <= 0 then raise exception 'Kiasi lazima kiwe zaidi ya sifuri' using errcode = 'P0001'; end if;
  if coalesce(btrim(p->>'description'),'') = '' then raise exception 'Maelezo ya matumizi yanahitajika' using errcode = 'P0001'; end if;
  select * into v_cat from public.contribution_categories where id = (p->>'category_id')::uuid and parish_id = v_parish and kind = 'expense';
  if v_cat.id is null then raise exception 'Chagua aina ya matumizi (expense category)' using errcode = 'P0001'; end if;
  v_fy := public.assert_period_open(v_parish, v_date);
  insert into public.finance_transactions (parish_id, idempotency_key, kind, amount, status, txn_date, financial_year_id,
    category_id, campaign_id, fund_id, money_account_id, org_unit_id, payer_name, payment_method, reference_no, description,
    event_id, recorded_by)
  values (v_parish, v_key, 'expense', v_amount, 'pending', v_date, v_fy, v_cat.id, (p->>'campaign_id')::uuid,
    coalesce((p->>'fund_id')::uuid, v_cat.fund_id), public.money_account_for(v_parish, v_method, (p->>'money_account_id')::uuid),
    (p->>'org_unit_id')::uuid, nullif(btrim(p->>'payee'),''), v_method, nullif(btrim(p->>'reference_no'),''),
    btrim(p->>'description'), (p->>'event_id')::uuid, auth.uid())
  returning * into v_txn;
  insert into public.approval_requests (parish_id, request_type, transaction_id, requested_by)
  values (v_parish, 'expense', v_txn.id, auth.uid()) returning id into v_req;
  insert into public.audit_log (actor_id, action, table_name, row_id, new_data)
  values (auth.uid(), 'record_expense', 'finance_transactions', v_txn.id::text, to_jsonb(v_txn));
  return jsonb_build_object('status','pending_approval','transaction_id',v_txn.id,'txn_no',v_txn.txn_no,'approval_id',v_req);
end $$;

create or replace function public.decide_approval(p_request uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.approval_requests; t public.finance_transactions; f public.funds; v_avail numeric;
begin
  select * into a from public.approval_requests where id = p_request for update;
  if a.id is null or a.status <> 'pending' then raise exception 'Ombi halipo au limeshaamuliwa' using errcode = 'P0001'; end if;
  if not public.has_perm('finance.approve', null) then raise exception 'Huna ruhusa ya kuidhinisha' using errcode = '42501'; end if;
  if a.requested_by = auth.uid() then
    raise exception 'Huwezi kuidhinisha ombi lako mwenyewe (separation of duties)' using errcode = '42501';
  end if;
  select * into t from public.finance_transactions where id = a.transaction_id for update;
  if p_approve then
    perform public.assert_period_open(t.parish_id, t.txn_date);
    select * into f from public.funds where id = t.fund_id;
    if t.kind = 'expense' and f.is_restricted then
      select coalesce(sum(net_amount) filter (where kind = 'income'),0) - coalesce(sum(net_amount) filter (where kind = 'expense'),0)
        into v_avail from public.finance_transactions where fund_id = f.id and status = 'posted';
      if t.amount > v_avail then
        raise exception 'Mfuko maalumu % hauna fedha za kutosha (restricted fund balance % < %)', f.name, v_avail, t.amount using errcode = 'P0001';
      end if;
    end if;
    update public.finance_transactions set status = 'posted', approved_by = auth.uid(), posted_at = now() where id = t.id;
    perform public.write_journal(t.id);
  else
    update public.finance_transactions set status = 'rejected', approved_by = auth.uid() where id = t.id;
  end if;
  update public.approval_requests set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = a.id;
  insert into public.audit_log (actor_id, action, table_name, row_id, note)
  values (auth.uid(), case when p_approve then 'approve' else 'reject' end, 'approval_requests', a.id::text, p_note);
  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end, 'transaction_id', t.id);
end $$;

-- transfer between money accounts (e.g. cash deposited to bank) — not income
create or replace function public.post_transfer(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_key uuid := (p->>'idempotency_key')::uuid; v_parish uuid := coalesce((p->>'parish_id')::uuid, public.default_parish_id());
  v_date date := coalesce((p->>'txn_date')::date, current_date); v_txn public.finance_transactions; v_cat uuid;
begin
  select * into v_txn from public.finance_transactions where idempotency_key = v_key;
  if v_txn.id is not null then return jsonb_build_object('status','already_posted','transaction_id',v_txn.id); end if;
  if not public.has_perm('finance.approve', null) then raise exception 'Huna ruhusa' using errcode = '42501'; end if;
  if (p->>'from_account_id') = (p->>'to_account_id') then raise exception 'Akaunti mbili lazima zitofautiane' using errcode = 'P0001'; end if;
  select id into v_cat from public.contribution_categories where parish_id = v_parish and code = 'TRANSFER';
  insert into public.finance_transactions (parish_id, idempotency_key, kind, amount, status, txn_date, financial_year_id, category_id,
    money_account_id, to_account_id, payment_method, reference_no, description, recorded_by, approved_by, posted_at)
  values (v_parish, v_key, 'transfer', round((p->>'amount')::numeric,2), 'posted', v_date, public.assert_period_open(v_parish, v_date), v_cat,
    public.money_account_for(v_parish, 'cash', (p->>'from_account_id')::uuid), public.money_account_for(v_parish, 'cash', (p->>'to_account_id')::uuid),
    'other', nullif(btrim(p->>'reference_no'),''), coalesce(nullif(btrim(p->>'description'),''), 'Uhamisho wa fedha'), auth.uid(), auth.uid(), now())
  returning * into v_txn;
  perform public.write_journal(v_txn.id);
  return jsonb_build_object('status','posted','transaction_id',v_txn.id,'txn_no',v_txn.txn_no);
end $$;

-- ---------------------------------------------------------------------------
-- PLEDGES
-- ---------------------------------------------------------------------------
create or replace function public.create_pledge(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_parish uuid := coalesce((p->>'parish_id')::uuid, public.default_parish_id());
  v_attr record; v_pl public.pledges; c public.campaigns;
begin
  select * into c from public.campaigns where id = (p->>'campaign_id')::uuid and parish_id = v_parish;
  if c.id is null then raise exception 'Kampeni haipo' using errcode = 'P0001'; end if;
  if c.status = 'closed' then raise exception 'Kampeni imefungwa' using errcode = 'P0001'; end if;
  select * into v_attr from public.resolve_attribution((p->>'parishioner_id')::uuid, (p->>'family_id')::uuid, (p->>'org_unit_id')::uuid);
  if not public.has_perm('finance.pledge', coalesce(v_attr.org_unit_id, v_attr.jumuiya_id)) then
    raise exception 'Huna ruhusa ya kuweka ahadi' using errcode = '42501';
  end if;
  insert into public.pledges (parish_id, campaign_id, parishioner_id, family_id, org_unit_id, amount, pledged_on, due_on,
                              jumuiya_id, kigango_id, created_by)
  values (v_parish, c.id, (p->>'parishioner_id')::uuid,
          case when nullif(p->>'parishioner_id','') is null then (p->>'family_id')::uuid end,
          case when nullif(p->>'parishioner_id','') is null and nullif(p->>'family_id','') is null then (p->>'org_unit_id')::uuid end,
          round((p->>'amount')::numeric, 2), coalesce((p->>'pledged_on')::date, current_date), (p->>'due_on')::date,
          v_attr.jumuiya_id, v_attr.kigango_id, auth.uid())
  returning * into v_pl;
  return jsonb_build_object('status','created','pledge_id',v_pl.id);
exception when unique_violation then
  raise exception 'Mlipaji huyu tayari ana ahadi hai kwenye kampeni hii (active pledge exists)' using errcode = 'P0001';
end $$;

-- change the pledged amount (not the payments) — logged in the audit trail
create or replace function public.update_pledge_amount(p_pledge uuid, p_amount numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pl public.pledges;
begin
  select * into pl from public.pledges where id = p_pledge for update;
  if pl.id is null or pl.status <> 'active' then raise exception 'Ahadi haipo/haiko hai' using errcode = 'P0001'; end if;
  if not public.has_perm('finance.pledge', coalesce(pl.org_unit_id, pl.jumuiya_id)) then raise exception 'Huna ruhusa' using errcode = '42501'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Sababu inahitajika' using errcode = 'P0001'; end if;
  update public.pledges set amount = round(p_amount, 2), status_reason = p_reason where id = p_pledge;
  return jsonb_build_object('status','updated');
end $$;

create or replace function public.cancel_pledge(p_pledge uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pl public.pledges; v_received numeric;
begin
  select * into pl from public.pledges where id = p_pledge for update;
  if pl.id is null or pl.status <> 'active' then raise exception 'Ahadi haipo/haiko hai' using errcode = 'P0001'; end if;
  if not public.has_perm('finance.pledge', coalesce(pl.org_unit_id, pl.jumuiya_id)) then raise exception 'Huna ruhusa' using errcode = '42501'; end if;
  select coalesce(sum(a.amount * t.sign),0) into v_received
    from public.payment_allocations a join public.finance_transactions t on t.id = a.transaction_id
   where a.pledge_id = pl.id and t.status = 'posted';
  if v_received <> 0 then
    raise exception 'Ahadi ina malipo ya TZS % — punguza kiasi badala ya kufuta (pledge has payments)', v_received using errcode = 'P0001';
  end if;
  update public.pledges set status = 'cancelled', status_reason = p_reason where id = pl.id;
  return jsonb_build_object('status','cancelled');
end $$;

-- Move the unpaid part of a pledge into a new campaign (e.g. Mavuno 2025 → 2026)
-- without double counting: the old pledge is closed at what was paid.
create or replace function public.carry_forward_pledge(p_pledge uuid, p_new_campaign uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pl public.pledges; b record; n public.pledges;
begin
  select * into pl from public.pledges where id = p_pledge for update;
  if pl.id is null or pl.status <> 'active' then raise exception 'Ahadi haipo/haiko hai' using errcode = 'P0001'; end if;
  if not public.has_perm('finance.pledge', coalesce(pl.org_unit_id, pl.jumuiya_id)) then raise exception 'Huna ruhusa' using errcode = '42501'; end if;
  select * into b from public.v_pledge_balances where pledge_id = pl.id;
  if b.outstanding <= 0 then raise exception 'Hakuna deni la kuhamisha (nothing outstanding)' using errcode = 'P0001'; end if;
  insert into public.pledges (parish_id, campaign_id, parishioner_id, family_id, org_unit_id, amount, pledged_on, due_on,
                              status, carried_from_id, jumuiya_id, kigango_id, created_by)
  values (pl.parish_id, p_new_campaign, pl.parishioner_id, pl.family_id, pl.org_unit_id, b.outstanding, current_date, null,
          'active', pl.id, pl.jumuiya_id, pl.kigango_id, auth.uid())
  returning * into n;
  update public.pledges set status = 'carried_forward', status_reason = 'Deni limehamishiwa ahadi ' || n.id where id = pl.id;
  return jsonb_build_object('status','carried','new_pledge_id',n.id,'amount',b.outstanding);
end $$;

-- ---------------------------------------------------------------------------
-- PERIOD LOCKING AND YEAR CLOSING
-- ---------------------------------------------------------------------------
create or replace function public.ensure_periods(p_fy uuid)
returns void language plpgsql security definer set search_path = public as $$
declare fy public.financial_years; d date;
begin
  select * into fy from public.financial_years where id = p_fy;
  d := date_trunc('month', fy.starts_on)::date;
  while d <= fy.ends_on loop
    insert into public.accounting_periods (financial_year_id, period_start, period_end)
    values (fy.id, greatest(d, fy.starts_on), least((d + interval '1 month - 1 day')::date, fy.ends_on))
    on conflict (financial_year_id, period_start) do nothing;
    d := (d + interval '1 month')::date;
  end loop;
end $$;

create or replace function public.set_period_lock(p_period uuid, p_locked boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('finance.period.lock', null) then raise exception 'Huna ruhusa' using errcode = '42501'; end if;
  update public.accounting_periods set is_locked = p_locked,
         locked_at = case when p_locked then now() end, locked_by = case when p_locked then auth.uid() end
   where id = p_period;
  insert into public.audit_log (actor_id, action, table_name, row_id) values (auth.uid(), case when p_locked then 'lock_period' else 'unlock_period' end, 'accounting_periods', p_period::text);
  return jsonb_build_object('status', case when p_locked then 'locked' else 'unlocked' end);
end $$;

create or replace function public.close_financial_year(p_fy uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pending int;
begin
  if not public.has_perm('finance.period.lock', null) then raise exception 'Huna ruhusa' using errcode = '42501'; end if;
  select count(*) into v_pending from public.finance_transactions where financial_year_id = p_fy and status = 'pending';
  if v_pending > 0 then raise exception 'Kuna miamala % inayosubiri idhini — iamue kwanza', v_pending using errcode = 'P0001'; end if;
  perform public.ensure_periods(p_fy);
  update public.accounting_periods set is_locked = true, locked_at = now(), locked_by = auth.uid() where financial_year_id = p_fy;
  update public.financial_years set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = p_fy;
  insert into public.audit_log (actor_id, action, table_name, row_id) values (auth.uid(), 'close_financial_year', 'financial_years', p_fy::text);
  return jsonb_build_object('status','closed');
end $$;

-- receipt reprint counter (the receipt content never changes)
create or replace function public.mark_receipt_printed(p_receipt uuid)
returns void language sql security definer set search_path = public as $$
  update public.receipts set print_count = print_count + 1, last_printed_at = now()
   where id = p_receipt
     and exists (select 1 from public.finance_transactions t where t.id = receipts.transaction_id)
     and (public.has_perm_anywhere('finance.read')
          or exists (select 1 from public.finance_transactions t where t.id = receipts.transaction_id
                     and (t.parishioner_id = public.my_parishioner_id() or t.family_id = public.my_family_id())))
$$;

-- public receipt verification by number + code (no personal data returned)
create or replace function public.verify_receipt(p_receipt_no text, p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('valid', r.status = 'valid', 'status', r.status, 'receipt_no', r.receipt_no,
                    'amount', r.amount, 'issued_at', r.issued_at, 'parish', p.official_name)
                   from public.receipts r join public.parishes p on p.id = r.parish_id
                   where r.receipt_no = p_receipt_no and r.verification_code = upper(p_code)),
                  jsonb_build_object('valid', false, 'status', 'not_found'))
$$;
