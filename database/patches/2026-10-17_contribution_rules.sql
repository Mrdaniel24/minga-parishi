-- PATCH 2026-10-17: contribution rules per year (who gives / assigned-pledge-free / yearly-monthly),
-- "Pangia wote", and the Kigango → Jumuiya → Familia summaries used by the new pages.
-- For a database set up earlier. Safe to run more than once. Supabase → SQL Editor → Run.
-- ============================================================================
-- Minga Parish Management System — migration 13: contribution rules + summaries
--   Every campaign (a contribution type for one year, e.g. "Mavuno 2026") gets
--   its own rules, which may change from year to year:
--     giver_level  who gives:   parishioner | family | jumuiya | kigango (null = anyone)
--     amount_mode  how much:    assigned (kupangiwa) | pledge (ahadi) | free (hiari)
--     frequency    how often:   yearly | monthly
--     default_amount / relation_rates (e.g. {"BABA":5000,"MTOTO":2000})
--   assign_campaign() gives every giver of the campaign its assigned amount in
--   one go. pledges.source tells an assigned amount from a promise.
--   unit_summary() / family_summary() feed the Kigango → Jumuiya → Familia pages.
-- ============================================================================

alter table public.campaigns add column if not exists giver_level text
  check (giver_level is null or giver_level in ('parishioner','family','jumuiya','kigango'));
alter table public.campaigns add column if not exists amount_mode text not null default 'pledge'
  check (amount_mode in ('assigned','pledge','free'));
alter table public.campaigns add column if not exists frequency text not null default 'yearly'
  check (frequency in ('yearly','monthly'));
alter table public.campaigns add column if not exists default_amount numeric(14,2)
  check (default_amount is null or default_amount >= 0);
alter table public.campaigns add column if not exists relation_rates jsonb not null default '{}'::jsonb;

alter table public.pledges add column if not exists source text not null default 'pledge'
  check (source in ('pledge','assigned'));

-- amounts imported from the workbook (PANGIWA columns) were assigned, not promised
create or replace function public.pledges_legacy_source() returns trigger language plpgsql set search_path = public as $$
begin
  if new.legacy_ref is not null and new.source = 'pledge' then new.source := 'assigned'; end if;
  return new;
end $$;
drop trigger if exists pledges_legacy_source on public.pledges;
create trigger pledges_legacy_source before insert on public.pledges for each row execute function public.pledges_legacy_source();

-- what the Excel workbook did (only for campaigns nobody has configured yet)
do $$
begin
  -- the register's PANGIWA columns were amounts set by the parish, not promises
  update public.pledges set source = 'assigned' where legacy_ref is not null and source = 'pledge';

  update public.campaigns cp set giver_level = 'family', amount_mode = 'assigned'
    from public.contribution_categories c
   where c.id = cp.category_id and c.code in ('MAVUNO','UJENZI') and cp.giver_level is null;

  update public.campaigns cp set giver_level = 'parishioner', amount_mode = 'assigned',
         relation_rates = '{"BABA":5000,"MAMA":5000,"SHANGAZI":5000,"MJOMBA":5000,"KAKA":5000,"DADA":5000,"BIBI":5000,"BABU":5000,"MTOTO":2000,"MPWA":2000,"MKAMWANA":2000,"MJUKUU":2000}'::jsonb
    from public.contribution_categories c
   where c.id = cp.category_id and c.code in ('MTOTO_YESU','KRISTO_MFUFUKA') and cp.giver_level is null;

  update public.campaigns cp set amount_mode = 'free'
    from public.contribution_categories c
   where c.id = cp.category_id and c.kind not in ('mavuno','ujenzi')
     and c.code not in ('MTOTO_YESU','KRISTO_MFUFUKA') and cp.giver_level is null and cp.amount_mode = 'pledge'
     and not exists (select 1 from public.pledges pl where pl.campaign_id = cp.id);
end $$;

-- pledges: what kind of obligation (columns appended at the end of the view)
create or replace view public.v_pledge_balances with (security_invoker = true) as
select pl.id as pledge_id, pl.parish_id, pl.campaign_id, cp.name as campaign_name, cp.campaign_year,
       cp.category_id, c.code as category_code, c.name_sw as category_name,
       pl.parishioner_id, pr.full_name as parishioner_name, pl.family_id, fam.family_name,
       pl.org_unit_id, ou.name as org_unit_name,
       coalesce(pl.jumuiya_id, ou.id) as jumuiya_id, pl.kigango_id,
       pl.amount as pledged, pl.status, pl.pledged_on, pl.due_on, pl.carried_from_id,
       coalesce(x.received, 0) as received,
       least(coalesce(x.received, 0), pl.amount) as paid,
       case when pl.status = 'active' then greatest(pl.amount - coalesce(x.received, 0), 0) else 0 end as outstanding,
       greatest(coalesce(x.received, 0) - pl.amount, 0) as excess,
       round(least(coalesce(x.received, 0) / pl.amount, 1) * 100, 2) as completion_pct,
       x.payment_count, x.last_payment_on,
       (pl.status = 'active' and pl.due_on is not null and pl.due_on < current_date
        and coalesce(x.received, 0) < pl.amount) as is_overdue,
       pl.source, cp.giver_level, cp.amount_mode, cp.frequency
from public.pledges pl
join public.campaigns cp on cp.id = pl.campaign_id
join public.contribution_categories c on c.id = cp.category_id
left join public.parishioners pr on pr.id = pl.parishioner_id
left join public.families fam on fam.id = pl.family_id
left join public.org_units ou on ou.id = pl.org_unit_id
left join lateral (
  select sum(a.amount * t.sign) as received,
         count(*) filter (where t.sign = 1) - count(*) filter (where t.sign = -1) as payment_count,
         max(t.txn_date) filter (where t.sign = 1) as last_payment_on
  from public.payment_allocations a
  join public.finance_transactions t on t.id = a.transaction_id and t.status = 'posted'
  where a.pledge_id = pl.id
) x on true
where pl.status <> 'cancelled';

-- create_pledge: may record an assigned amount (source = 'assigned')
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
                              jumuiya_id, kigango_id, created_by, source)
  values (v_parish, c.id, (p->>'parishioner_id')::uuid,
          case when nullif(p->>'parishioner_id','') is null then (p->>'family_id')::uuid end,
          case when nullif(p->>'parishioner_id','') is null and nullif(p->>'family_id','') is null then (p->>'org_unit_id')::uuid end,
          round((p->>'amount')::numeric, 2), coalesce((p->>'pledged_on')::date, current_date), (p->>'due_on')::date,
          v_attr.jumuiya_id, v_attr.kigango_id, auth.uid(),
          case when p->>'source' = 'assigned' then 'assigned' else 'pledge' end)
  returning * into v_pl;
  return jsonb_build_object('status','created','pledge_id',v_pl.id);
exception when unique_violation then
  raise exception 'Mlipaji huyu tayari ana ahadi hai kwenye kampeni hii (active pledge exists)' using errcode = 'P0001';
end $$;

-- post_payment: monthly campaigns record the month the payment is for
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

  if v_cat.uses_period_month or coalesce(v_campaign.frequency, 'yearly') = 'monthly' then
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
-- Give every giver of a campaign its assigned amount ("Pangia wote").
-- Givers that already have an amount are left as they are. p_scope limits it
-- to one kigango/jumuiya (null = whole parish). Monthly campaigns: the yearly
-- obligation is 12 × the monthly amount.
-- ---------------------------------------------------------------------------
create or replace function public.assign_campaign(p_campaign uuid, p_amount numeric default null, p_scope uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cp public.campaigns; n int := 0; skipped int := 0; v_amt numeric; r record;
  v_mult int; v_units uuid[];
begin
  select * into cp from public.campaigns where id = p_campaign;
  if cp.id is null then raise exception 'Kampeni haipo' using errcode = 'P0001'; end if;
  if cp.status = 'closed' then raise exception 'Kampeni imefungwa' using errcode = 'P0001'; end if;
  if cp.giver_level is null then raise exception 'Weka kwanza "nani anatoa" kwenye kanuni za kampeni hii' using errcode = 'P0001'; end if;
  if not public.has_perm('finance.pledge', p_scope) then
    raise exception 'Huna ruhusa ya kupangia michango (permission denied)' using errcode = '42501';
  end if;
  if p_amount is not null and p_amount <= 0 then raise exception 'Kiasi lazima kiwe zaidi ya sifuri' using errcode = 'P0001'; end if;
  v_mult := case when cp.frequency = 'monthly' then 12 else 1 end;
  v_units := case when p_scope is null then null else public.units_within(p_scope) end;

  if cp.giver_level = 'parishioner' then
    for r in select p.id, p.relationship, p.jumuiya_id from public.parishioners p
              where p.parish_id = cp.parish_id and p.membership_status = 'active'
                and (v_units is null or p.jumuiya_id = any (v_units))
                and not exists (select 1 from public.pledges pl where pl.campaign_id = cp.id and pl.parishioner_id = p.id and pl.status = 'active')
    loop
      v_amt := coalesce(p_amount, (cp.relation_rates ->> upper(btrim(coalesce(r.relationship, ''))))::numeric, cp.default_amount);
      if v_amt is null or v_amt <= 0 then skipped := skipped + 1; continue; end if;
      insert into public.pledges (parish_id, campaign_id, parishioner_id, amount, jumuiya_id, kigango_id, source, created_by)
      values (cp.parish_id, cp.id, r.id, v_amt * v_mult, r.jumuiya_id, public.org_ancestor_of_type(r.jumuiya_id, 'kigango'), 'assigned', auth.uid());
      n := n + 1;
    end loop;
  elsif cp.giver_level = 'family' then
    v_amt := coalesce(p_amount, cp.default_amount);
    if v_amt is null then raise exception 'Weka kiasi cha kupangia kila familia' using errcode = 'P0001'; end if;
    for r in select f.id, f.jumuiya_id from public.families f
              where f.parish_id = cp.parish_id and f.status = 'active'
                and (v_units is null or f.jumuiya_id = any (v_units))
                and not exists (select 1 from public.pledges pl where pl.campaign_id = cp.id and pl.family_id = f.id and pl.status = 'active')
    loop
      insert into public.pledges (parish_id, campaign_id, family_id, amount, jumuiya_id, kigango_id, source, created_by)
      values (cp.parish_id, cp.id, r.id, v_amt * v_mult, r.jumuiya_id, public.org_ancestor_of_type(r.jumuiya_id, 'kigango'), 'assigned', auth.uid());
      n := n + 1;
    end loop;
  else
    v_amt := coalesce(p_amount, cp.default_amount);
    if v_amt is null then raise exception 'Weka kiasi cha kupangia kila %', cp.giver_level using errcode = 'P0001'; end if;
    for r in select o.id from public.org_units o
              where o.parish_id = cp.parish_id and o.unit_type = cp.giver_level and o.is_active
                and (v_units is null or o.id = any (v_units))
                and not exists (select 1 from public.pledges pl where pl.campaign_id = cp.id and pl.org_unit_id = o.id and pl.status = 'active')
    loop
      insert into public.pledges (parish_id, campaign_id, org_unit_id, amount, jumuiya_id, kigango_id, source, created_by)
      values (cp.parish_id, cp.id, r.id, v_amt * v_mult,
              case when cp.giver_level = 'jumuiya' then r.id end,
              public.org_ancestor_of_type(r.id, 'kigango'), 'assigned', auth.uid());
      n := n + 1;
    end loop;
  end if;

  insert into public.audit_log (actor_id, action, table_name, row_id, note)
  values (auth.uid(), 'assign_campaign', 'campaigns', cp.id::text,
          format('%s waliopangiwa (%s); kiasi %s; eneo %s', n, cp.giver_level, coalesce(p_amount::text, 'kanuni'), coalesce(p_scope::text, 'parokia')));
  return jsonb_build_object('status', 'assigned', 'created', n, 'skipped_no_rate', skipped);
end $$;
revoke execute on function public.assign_campaign(uuid, numeric, uuid) from public, anon;
grant execute on function public.assign_campaign(uuid, numeric, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Summary per child unit for one year: the kigango list (p_parent null) or the
-- jumuiya of one kigango. Runs with the caller's rights (RLS applies).
-- ---------------------------------------------------------------------------
create or replace function public.unit_summary(p_year int, p_parent uuid default null)
returns table (unit_id uuid, unit_name text, unit_type text, ordinal int, families bigint, parishioners bigint,
               zaka numeric, mavuno numeric, ujenzi numeric, sadaka numeric, special numeric, other numeric, income numeric,
               pledged numeric, paid numeric, outstanding numeric)
language sql stable set search_path = public as $$
  with recursive kids as (
    select o.id as child, o.id as unit from public.org_units o
     where o.is_active and (case when p_parent is null
                                 then o.unit_type = 'kigango' and o.parent_id = (select id from public.org_units where unit_type = 'parish' limit 1)
                                 else o.parent_id = p_parent and o.unit_type in ('kigango','jumuiya') end)
    union all
    select k.child, o.id from public.org_units o join kids k on o.parent_id = k.unit
  ),
  tx as (
    select k.child, c.kind as ck, sum(t.net_amount) as amt
      from public.finance_transactions t
      join public.contribution_categories c on c.id = t.category_id
      join kids k on k.unit = coalesce(t.org_unit_id, t.jumuiya_id)
     where t.status = 'posted' and t.kind = 'income'
       and t.txn_date >= make_date(p_year, 1, 1) and t.txn_date < make_date(p_year + 1, 1, 1)
     group by 1, 2
  ),
  pl as (
    select k.child, sum(b.pledged) as pledged, sum(b.paid) as paid, sum(b.outstanding) as outstanding
      from public.v_pledge_balances b join kids k on k.unit = coalesce(b.org_unit_id, b.jumuiya_id)
     where b.campaign_year = p_year and b.status = 'active'
     group by 1
  ),
  fam as (select k.child, count(*) as n from public.families f join kids k on k.unit = f.jumuiya_id where f.status = 'active' group by 1),
  ppl as (select k.child, count(*) as n from public.parishioners p join kids k on k.unit = p.jumuiya_id where p.membership_status = 'active' group by 1)
  select o.id, o.name, o.unit_type, o.ordinal,
         coalesce((select n from fam where fam.child = o.id), 0),
         coalesce((select n from ppl where ppl.child = o.id), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id and ck = 'zaka'), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id and ck = 'mavuno'), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id and ck = 'ujenzi'), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id and ck = 'sadaka'), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id and ck in ('special','shukrani')), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id and ck not in ('zaka','mavuno','ujenzi','sadaka','special','shukrani')), 0),
         coalesce((select sum(amt) from tx where tx.child = o.id), 0),
         coalesce((select pledged from pl where pl.child = o.id), 0),
         coalesce((select paid from pl where pl.child = o.id), 0),
         coalesce((select outstanding from pl where pl.child = o.id), 0)
    from public.org_units o
   where o.id in (select child from kids)
   order by o.ordinal nulls last, o.name
$$;

-- per family of one jumuiya for one year (register + giving)
create or replace function public.family_summary(p_year int, p_jumuiya uuid)
returns table (family_id uuid, family_name text, family_code text, members bigint, head_name text,
               zaka numeric, income numeric, pledged numeric, paid numeric, outstanding numeric, last_payment date)
language sql stable set search_path = public as $$
  with fams as (select f.* from public.families f where f.jumuiya_id = p_jumuiya and f.status = 'active'),
  tx as (
    select t.family_id, c.kind as ck, sum(t.net_amount) as amt, max(t.txn_date) as last_on
      from public.finance_transactions t join public.contribution_categories c on c.id = t.category_id
     where t.family_id in (select id from fams) and t.status = 'posted' and t.kind = 'income'
       and t.txn_date >= make_date(p_year, 1, 1) and t.txn_date < make_date(p_year + 1, 1, 1)
     group by 1, 2
  ),
  pl as (
    select coalesce(b.family_id, p.family_id) as family_id, sum(b.pledged) as pledged, sum(b.paid) as paid, sum(b.outstanding) as outstanding
      from public.v_pledge_balances b left join public.parishioners p on p.id = b.parishioner_id
     where b.campaign_year = p_year and b.status = 'active'
       and coalesce(b.family_id, p.family_id) in (select id from fams)
     group by 1
  )
  select f.id, f.family_name, f.family_code,
         (select count(*) from public.parishioners p where p.family_id = f.id and p.membership_status = 'active'),
         (select full_name from public.parishioners p where p.id = f.head_parishioner_id),
         coalesce((select sum(amt) from tx where tx.family_id = f.id and ck = 'zaka'), 0),
         coalesce((select sum(amt) from tx where tx.family_id = f.id), 0),
         coalesce((select pledged from pl where pl.family_id = f.id), 0),
         coalesce((select paid from pl where pl.family_id = f.id), 0),
         coalesce((select outstanding from pl where pl.family_id = f.id), 0),
         (select max(last_on) from tx where tx.family_id = f.id)
    from fams f
   order by nullif(regexp_replace(coalesce(f.family_code, ''), '\D', '', 'g'), '')::int nulls last, f.family_name
$$;

-- month grid for any contribution (campaign), like the Zaka grid
create or replace function public.campaign_month_grid(p_campaign uuid, p_level text default 'parishioner', p_scope uuid default null)
returns table (group_id uuid, group_name text, jumuiya_name text,
               m01 numeric, m02 numeric, m03 numeric, m04 numeric, m05 numeric, m06 numeric,
               m07 numeric, m08 numeric, m09 numeric, m10 numeric, m11 numeric, m12 numeric, total numeric)
language sql stable set search_path = public as $$
  with z as (
    select case p_level when 'parishioner' then t.parishioner_id when 'family' then t.family_id
                        when 'jumuiya' then t.jumuiya_id else t.kigango_id end as gid,
           extract(month from coalesce(t.period_month, t.txn_date))::int as m, sum(t.net_amount) as amt
      from public.finance_transactions t
     where t.campaign_id = p_campaign and t.status = 'posted' and t.kind = 'income'
       and (case when p_scope is null then true else coalesce(t.org_unit_id, t.jumuiya_id) = any ((select public.units_within(p_scope))::uuid[]) end)
     group by 1, 2
  )
  select z.gid,
         case p_level when 'parishioner' then (select full_name from public.parishioners where id = z.gid)
                      when 'family' then (select family_name from public.families where id = z.gid)
                      else (select name from public.org_units where id = z.gid) end,
         case p_level when 'parishioner' then (select o.name from public.parishioners p join public.org_units o on o.id = p.jumuiya_id where p.id = z.gid)
                      when 'family' then (select o.name from public.families f join public.org_units o on o.id = f.jumuiya_id where f.id = z.gid)
                      else null end,
         sum(amt) filter (where m = 1), sum(amt) filter (where m = 2), sum(amt) filter (where m = 3),
         sum(amt) filter (where m = 4), sum(amt) filter (where m = 5), sum(amt) filter (where m = 6),
         sum(amt) filter (where m = 7), sum(amt) filter (where m = 8), sum(amt) filter (where m = 9),
         sum(amt) filter (where m = 10), sum(amt) filter (where m = 11), sum(amt) filter (where m = 12),
         sum(amt)
    from z group by z.gid order by 3 nulls last, 2
$$;
grant execute on function public.unit_summary(int, uuid) to authenticated;
grant execute on function public.family_summary(int, uuid) to authenticated;
grant execute on function public.campaign_month_grid(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Zaka grid with the jumuiya and kigango of every row, so the parish page can
-- be grouped Kigango → Jumuiya → (Familia) like the rest of the system.
-- ---------------------------------------------------------------------------
create or replace function public.zaka_grid_tree(p_year int, p_level text default 'jumuiya', p_scope uuid default null)
returns table (group_id uuid, group_name text, jumuiya_id uuid, kigango_id uuid, family_id uuid,
               m01 numeric, m02 numeric, m03 numeric, m04 numeric, m05 numeric, m06 numeric,
               m07 numeric, m08 numeric, m09 numeric, m10 numeric, m11 numeric, m12 numeric,
               total numeric, months_paid int, months_unpaid int)
language sql stable set search_path = public as $$
  select g.group_id, g.group_name, u.jid, coalesce(case when p_level = 'kigango' then g.group_id end, public.org_ancestor_of_type(u.jid, 'kigango')),
         u.fid, g.m01, g.m02, g.m03, g.m04, g.m05, g.m06, g.m07, g.m08, g.m09, g.m10, g.m11, g.m12, g.total, g.months_paid, g.months_unpaid
    from public.zaka_grid(p_year, p_level, p_scope) g
    left join lateral (
      select case p_level when 'parishioner' then (select p.jumuiya_id from public.parishioners p where p.id = g.group_id)
                          when 'family' then (select f.jumuiya_id from public.families f where f.id = g.group_id)
                          when 'jumuiya' then g.group_id end as jid,
             case p_level when 'parishioner' then (select p.family_id from public.parishioners p where p.id = g.group_id)
                          when 'family' then g.group_id end as fid
    ) u on true
$$;
grant execute on function public.zaka_grid_tree(int, text, uuid) to authenticated;
