-- Minga Parish — member and scoped leader payment submissions.
-- Submissions remain outside the posted ledger totals until a separate approver
-- verifies the attached proof and approves the request.

alter table public.approval_requests drop constraint if exists approval_requests_request_type_check;
alter table public.approval_requests add constraint approval_requests_request_type_check
  check (request_type in ('expense','payment_submission','reversal','adjustment','period_unlock','legacy_review'));

-- Leaders may submit proof-backed payments within their assigned community.
-- Ordinary members are authorized by their active, linked parishioner profile
-- and the RPC below limits them to themselves (or their approved family).
insert into public.role_permissions(role_code, permission) values
  ('jumuiya_leader','finance.submit_payment'),
  ('kigango_leader','finance.submit_payment')
on conflict do nothing;

-- Custom approvers need to read the pending request and its limited ledger
-- row even if they do not have broad finance.read privileges.
drop policy if exists ar_read on public.approval_requests;
create policy ar_read on public.approval_requests for select to authenticated using (
  public.has_perm('finance.read') or public.has_perm('finance.approve') or requested_by=auth.uid()
);
drop policy if exists ft_read on public.finance_transactions;
create policy ft_read on public.finance_transactions for select to authenticated using (
  public.has_perm('finance.read') or public.has_perm('finance.read',coalesce(org_unit_id,jumuiya_id))
  or (parishioner_id is not null and parishioner_id=public.my_parishioner_id())
  or (parishioner_id is null and family_id is not null and family_id=public.my_family_id())
  or (status='pending' and public.has_perm('finance.approve') and exists(
    select 1 from public.approval_requests ar where ar.transaction_id=finance_transactions.id
      and ar.request_type='payment_submission' and ar.status='pending'))
);

create or replace function public.submit_payment_for_review(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_key uuid := nullif(p->>'idempotency_key','')::uuid;
  v_parish uuid := public.default_parish_id();
  v_amount numeric(14,2) := round(nullif(p->>'amount','')::numeric, 2);
  v_date date := coalesce(nullif(p->>'txn_date','')::date, current_date);
  v_person uuid := nullif(p->>'parishioner_id','')::uuid;
  v_family uuid := nullif(p->>'family_id','')::uuid;
  v_unit uuid := nullif(p->>'org_unit_id','')::uuid;
  v_my_person uuid := public.my_parishioner_id();
  v_scope uuid;
  v_is_leader boolean := false;
  v_cat public.contribution_categories;
  v_campaign public.campaigns;
  v_pledge public.pledges;
  v_attr record;
  v_txn public.finance_transactions;
  v_dup public.finance_transactions;
  v_req uuid;
  v_fy uuid;
  v_period date;
  v_method text := coalesce(nullif(p->>'payment_method',''), 'cash');
  v_payer text;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id=auth.uid() and coalesce(status,'active')='active'
  ) then raise exception 'Ingia kwenye akaunti hai kwanza' using errcode='42501'; end if;
  if v_key is null then raise exception 'Namba ya ombi inahitajika' using errcode='P0001'; end if;
  select * into v_txn from public.finance_transactions where idempotency_key=v_key;
  if v_txn.id is not null then
    if v_txn.recorded_by is distinct from auth.uid() then raise exception 'Namba hii ya ombi imetumika tayari' using errcode='42501'; end if;
    return jsonb_build_object('status',case v_txn.status when 'pending' then 'pending_review' when 'posted' then 'approved' else 'rejected' end,
      'transaction_id',v_txn.id,'txn_no',v_txn.txn_no);
  end if;
  if v_amount is null or v_amount <= 0 or v_amount > 1000000000 then
    raise exception 'Kiasi cha malipo si sahihi' using errcode='P0001';
  end if;
  if v_method not in ('cash','cheque','bank_transfer','mobile_money','other') then
    raise exception 'Njia ya malipo si sahihi' using errcode='P0001';
  end if;
  if v_method in ('cheque','bank_transfer','mobile_money') and coalesce(btrim(p->>'reference_no'),'')='' then
    raise exception 'Namba ya kumbukumbu inahitajika kwa malipo haya' using errcode='P0001';
  end if;
  if num_nonnulls(v_person,v_family,v_unit) <> 1 then
    raise exception 'Chagua mlipaji mmoja kutoka kwenye rejista' using errcode='P0001';
  end if;

  select * into v_cat from public.contribution_categories
   where id=nullif(p->>'category_id','')::uuid and parish_id=v_parish and is_active;
  if v_cat.id is null or v_cat.kind='expense' then
    raise exception 'Chagua aina halali ya mchango' using errcode='P0001';
  end if;
  if nullif(p->>'campaign_id','') is not null then
    select * into v_campaign from public.campaigns
     where id=(p->>'campaign_id')::uuid and parish_id=v_parish;
    if v_campaign.id is null or v_campaign.category_id<>v_cat.id or v_campaign.status='closed' then
      raise exception 'Kampeni haipo, imefungwa au haiendani na mchango' using errcode='P0001';
    end if;
  end if;
  if v_cat.uses_period_month then
    v_period := date_trunc('month', coalesce(nullif(p->>'period_month','')::date, v_date))::date;
  end if;
  v_fy := public.assert_period_open(v_parish, v_date);
  select * into v_attr from public.resolve_attribution(v_person,v_family,v_unit);
  v_scope := coalesce(v_attr.jumuiya_id,v_attr.kigango_id,v_unit);

  select exists(
    select 1 from public.parish_user_roles ur
    join public.parish_roles pr on pr.code=ur.role_code
    where ur.user_id=auth.uid() and ur.role_code in ('jumuiya_leader','kigango_leader')
      and ur.org_unit_id is not null and public.has_perm('finance.submit_payment',v_scope)
  ) into v_is_leader;

  if v_is_leader then
    if v_scope is null or not public.has_perm('finance.submit_payment',v_scope) then
      raise exception 'Malipo haya yako nje ya eneo lako la uongozi' using errcode='42501';
    end if;
  else
    if v_my_person is null or v_person is distinct from v_my_person
       and not (v_family is not null and v_family=public.my_family_id()
         and exists(select 1 from public.family_access_grants g where g.parishioner_id=v_my_person
           and g.family_id=v_family and g.status='active')) then
      raise exception 'Unaweza kuwasilisha malipo yako au ya familia uliyoidhinishwa kuiwakilisha tu' using errcode='42501';
    end if;
    if v_unit is not null then raise exception 'Muumini binafsi hawezi kuwasilisha malipo ya kitengo' using errcode='42501'; end if;
  end if;

  if v_campaign.id is not null then
    select * into v_pledge from public.pledges
     where campaign_id=v_campaign.id and status='active'
       and ((v_person is not null and parishioner_id=v_person)
         or (v_family is not null and family_id=v_family)
         or (v_person is null and v_family is null and org_unit_id=v_unit))
     order by (parishioner_id is not null) desc,(family_id is not null) desc limit 1;
  end if;
  v_payer := coalesce(
    (select full_name from public.parishioners where id=v_person),
    (select family_name from public.families where id=v_family),
    (select name from public.org_units where id=v_unit)
  );
  if v_payer is null then raise exception 'Mlipaji hayupo kwenye rejista' using errcode='P0001'; end if;

  if not coalesce((p->>'confirm_duplicate')::boolean,false) then
    select * into v_dup from public.finance_transactions t
     where t.parish_id=v_parish and t.kind='income' and t.sign=1 and t.status<>'rejected'
       and t.category_id=v_cat.id and t.amount=v_amount and t.txn_date=v_date
       and t.parishioner_id is not distinct from v_person
       and t.family_id is not distinct from v_attr.family_id
       and t.org_unit_id is not distinct from coalesce(v_unit,v_attr.org_unit_id)
       and t.period_month is not distinct from v_period
       and lower(coalesce(t.payer_name,''))=lower(v_payer)
     limit 1;
    if v_dup.id is not null then
      return jsonb_build_object('status','possible_duplicate','existing_transaction_id',v_dup.id,
        'existing_txn_no',v_dup.txn_no,'message','Malipo kama haya yanaonekana tayari. Hakiki kama hili ni malipo mapya.');
    end if;
  end if;

  insert into public.finance_transactions (
    parish_id,idempotency_key,kind,amount,status,txn_date,financial_year_id,period_month,
    category_id,campaign_id,pledge_id,fund_id,money_account_id,parishioner_id,family_id,
    org_unit_id,jumuiya_id,kigango_id,payer_name,payment_method,reference_no,description,recorded_by
  ) values (
    v_parish,v_key,'income',v_amount,'pending',v_date,v_fy,v_period,
    v_cat.id,v_campaign.id,v_pledge.id,v_cat.fund_id,
    public.money_account_for(v_parish,v_method,null),v_person,v_attr.family_id,
    coalesce(v_unit,v_attr.org_unit_id),v_attr.jumuiya_id,v_attr.kigango_id,v_payer,v_method,
    nullif(btrim(p->>'reference_no'),''),nullif(btrim(p->>'description'),''),auth.uid()
  ) returning * into v_txn;
  if v_pledge.id is not null then
    insert into public.payment_allocations(transaction_id,pledge_id,amount)
    values(v_txn.id,v_pledge.id,v_amount);
  end if;
  insert into public.approval_requests(parish_id,request_type,transaction_id,requested_by)
  values(v_parish,'payment_submission',v_txn.id,auth.uid()) returning id into v_req;
  insert into public.audit_log(actor_id,action,table_name,row_id,new_data)
  values(auth.uid(),'submit_payment_for_review','finance_transactions',v_txn.id::text,to_jsonb(v_txn));
  return jsonb_build_object('status','pending_review','transaction_id',v_txn.id,'txn_no',v_txn.txn_no,'approval_id',v_req);
end $$;
revoke all on function public.submit_payment_for_review(jsonb) from public,anon;
grant execute on function public.submit_payment_for_review(jsonb) to authenticated;

-- Attachments on pending submissions can be added by their submitter; ordinary
-- staff retain the existing scoped finance.record attachment permission.
create or replace function public.add_payment_attachment(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_path text := btrim(coalesce(p->>'storage_path',''));
  v_mime text := lower(coalesce(p->>'mime_type',''));
  v_size bigint := nullif(p->>'size_bytes','')::bigint;
  v_id uuid; t public.finance_transactions; n int := 0;
begin
  if v_path='' or v_path like '%..%' then raise exception 'Faili halijulikani' using errcode='P0001'; end if;
  if v_mime<>'application/pdf' and v_mime not like 'image/%' then raise exception 'Weka picha au PDF tu' using errcode='P0001'; end if;
  if v_size is null or v_size<=0 or v_size>10*1024*1024 then raise exception 'Faili si sahihi au ni kubwa mno (mwisho MB 10)' using errcode='P0001'; end if;
  if jsonb_typeof(p->'transaction_ids')<>'array' or jsonb_array_length(p->'transaction_ids')=0 then
    raise exception 'Chagua muamala' using errcode='P0001';
  end if;
  for v_id in select distinct x::uuid from jsonb_array_elements_text(p->'transaction_ids') x loop
    select * into t from public.finance_transactions where id=v_id for share;
    if t.id is null then raise exception 'Muamala haupo' using errcode='P0001'; end if;
    if not public.has_perm('finance.record',coalesce(t.org_unit_id,t.jumuiya_id))
       and not (t.status='pending' and t.recorded_by=auth.uid() and exists(
         select 1 from public.approval_requests ar where ar.transaction_id=t.id
           and ar.request_type='payment_submission' and ar.status='pending')) then
      raise exception 'Huna ruhusa ya kuambatisha uthibitisho' using errcode='42501';
    end if;
    insert into public.transaction_attachments(transaction_id,storage_path,file_name,mime_type,size_bytes)
    values(t.id,v_path,left(coalesce(nullif(btrim(p->>'file_name'),''),'uthibitisho'),200),v_mime,v_size);
    n:=n+1;
  end loop;
  insert into public.audit_log(actor_id,action,table_name,row_id,new_data)
  values(auth.uid(),'add_payment_attachment','transaction_attachments',v_path,p);
  return jsonb_build_object('status','saved','count',n);
end $$;
revoke all on function public.add_payment_attachment(jsonb) from public,anon;
grant execute on function public.add_payment_attachment(jsonb) to authenticated;

-- A submission cannot be approved without proof. Issue the official receipt
-- only at approval time, after the transaction has become posted.
create or replace function public.decide_approval(p_request uuid,p_approve boolean,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a public.approval_requests; t public.finance_transactions; f public.funds; v_avail numeric; v_receipt public.receipts;
begin
  select * into a from public.approval_requests where id=p_request for update;
  if a.id is null or a.status<>'pending' then raise exception 'Ombi halipo au limeshaamuliwa' using errcode='P0001'; end if;
  if not public.has_perm('finance.approve',null) then raise exception 'Huna ruhusa ya kuidhinisha' using errcode='42501'; end if;
  if a.requested_by=auth.uid() then raise exception 'Huwezi kuidhinisha ombi lako mwenyewe' using errcode='42501'; end if;
  select * into t from public.finance_transactions where id=a.transaction_id for update;
  if a.request_type='payment_submission' then
    if t.kind<>'income' or t.status<>'pending' then raise exception 'Malipo hayapo kwenye foleni ya idhini' using errcode='P0001'; end if;
    if p_approve and not exists(select 1 from public.transaction_attachments where transaction_id=t.id) then
      raise exception 'Malipo hayawezi kuidhinishwa bila risiti ya uthibitisho' using errcode='P0001';
    end if;
    if not p_approve and coalesce(length(btrim(p_note)),0)<3 then
      raise exception 'Andika sababu ya kukataa malipo' using errcode='P0001';
    end if;
  end if;
  if p_approve then
    perform public.assert_period_open(t.parish_id,t.txn_date);
    select * into f from public.funds where id=t.fund_id;
    if t.kind='expense' and f.is_restricted then
      select coalesce(sum(net_amount) filter(where kind='income'),0)-coalesce(sum(net_amount) filter(where kind='expense'),0)
       into v_avail from public.finance_transactions where fund_id=f.id and status='posted';
      if t.amount>v_avail then raise exception 'Mfuko maalumu % hauna fedha za kutosha (salio % < %)',f.name,v_avail,t.amount using errcode='P0001'; end if;
    end if;
    update public.finance_transactions set status='posted',approved_by=auth.uid(),posted_at=now() where id=t.id;
    perform public.write_journal(t.id);
    if a.request_type='payment_submission' then v_receipt:=public.issue_receipt(t.id,null); end if;
  else
    update public.finance_transactions set status='rejected',approved_by=auth.uid() where id=t.id;
  end if;
  update public.approval_requests set status=case when p_approve then 'approved' else 'rejected' end,
    decided_by=auth.uid(),decided_at=now(),decision_note=nullif(btrim(p_note),'') where id=a.id;
  insert into public.audit_log(actor_id,action,table_name,row_id,note)
  values(auth.uid(),case when p_approve then 'approve' else 'reject' end,'approval_requests',a.id::text,p_note);
  return jsonb_build_object('status',case when p_approve then 'approved' else 'rejected' end,
    'transaction_id',t.id,'receipt_id',v_receipt.id,'receipt_no',v_receipt.receipt_no);
end $$;
revoke all on function public.decide_approval(uuid,boolean,text) from public,anon;
grant execute on function public.decide_approval(uuid,boolean,text) to authenticated;

-- Secure bucket access for owner uploads while pending, and preserve scoped
-- finance staff access. Reads remain limited by transaction RLS.
do $$ begin
  if to_regclass('storage.objects') is null then return; end if;
  execute 'drop policy if exists payment_proofs_insert on storage.objects';
  execute $p$create policy payment_proofs_insert on storage.objects for insert to authenticated with check (
    bucket_id='payment-proofs' and exists(select 1 from public.finance_transactions t
      where t.id::text=split_part(name,'/',1) and (
        public.has_perm('finance.record',coalesce(t.org_unit_id,t.jumuiya_id)) or
        (t.status='pending' and t.recorded_by=auth.uid() and exists(select 1 from public.approval_requests ar
          where ar.transaction_id=t.id and ar.request_type='payment_submission' and ar.status='pending'))
      )))$p$;
end $$;

notify pgrst,'reload schema';
