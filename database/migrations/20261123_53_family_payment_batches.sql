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
           and g.family_id=v_family and g.status='active'))
       and not (v_person is not null and v_family is null
         and exists(select 1 from public.parishioners member
           join public.family_access_grants g on g.family_id=member.family_id and g.parishioner_id=v_my_person and g.status='active'
          where member.id=v_person and member.family_id=public.my_family_id() and member.membership_status='active')) then
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
revoke all on function public.submit_payment_for_review(jsonb) from public, anon;
grant execute on function public.submit_payment_for_review(jsonb) to authenticated;

-- A single external receipt can contain several contribution categories and recipients.
-- Each line remains a normal pending ledger transaction, but shares one batch id.
create index if not exists finance_transactions_batch_id_idx
  on public.finance_transactions(batch_id) where batch_id is not null;

create or replace function public.submit_payment_batch_for_review(p jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_batch uuid := nullif(p->>'idempotency_key','')::uuid;
  v_lines jsonb := p->'lines'; v_line jsonb; v_result jsonb;
  v_ids uuid[] := '{}'; v_requests uuid[] := '{}'; v_id uuid;
  v_idx bigint; v_total numeric(14,2):=0; v_sum numeric(14,2):=0;
  v_existing int; v_status text;
begin
  if auth.uid() is null or v_batch is null then raise exception 'Ingia na anza ombi jipya' using errcode='42501'; end if;
  if jsonb_typeof(v_lines)<>'array' or jsonb_array_length(v_lines)<1 or jsonb_array_length(v_lines)>20 then
    raise exception 'Weka angalau mstari mmoja (isiyozidi 20)' using errcode='P0001';
  end if;
  if coalesce(p->>'payment_method','cash') not in ('cash','cheque','bank_transfer','mobile_money','other') then
    raise exception 'Njia ya malipo si sahihi' using errcode='P0001';
  end if;
  for v_line,v_idx in select value,ordinality from jsonb_array_elements(v_lines) with ordinality loop
    if coalesce(nullif(v_line->>'amount','')::numeric,0)<=0 then raise exception 'Kila mstari uwe na kiasi zaidi ya sifuri' using errcode='P0001'; end if;
    v_sum:=v_sum+round((v_line->>'amount')::numeric,2);
  end loop;
  v_total:=round(coalesce(nullif(p->>'amount','')::numeric,v_sum),2);
  if v_total<=0 or v_total>1000000000 then raise exception 'Jumla ya risiti si sahihi' using errcode='P0001'; end if;
  if v_sum<>v_total then raise exception 'Jumla ya mistari (%) lazima ilingane na risiti (%)',v_sum,v_total using errcode='P0001'; end if;
  if exists(select 1 from public.finance_transactions where batch_id=v_batch) then
    if exists(select 1 from public.finance_transactions where batch_id=v_batch and (recorded_by<>auth.uid() or status<>'pending')) then
      raise exception 'Ombi hili la malipo limeshashughulikiwa' using errcode='P0001';
    end if;
    select array_agg(id order by txn_no) into v_ids from public.finance_transactions where batch_id=v_batch;
    select array_agg(ar.id order by t.txn_no) into v_requests from public.finance_transactions t join public.approval_requests ar on ar.transaction_id=t.id and ar.status='pending'
      where t.batch_id=v_batch and ar.request_type='payment_submission';
    return jsonb_build_object('status','pending_review','batch_id',v_batch,'transaction_ids',to_jsonb(v_ids),'approval_ids',to_jsonb(v_requests),'count',cardinality(v_ids));
  end if;
  -- Let the existing external-reference guard recognise all lines as one bank/mobile payment.
  perform set_config('minga.batch_id',v_batch::text,true);
  for v_line,v_idx in select value,ordinality from jsonb_array_elements(v_lines) with ordinality loop
    v_result:=public.submit_payment_for_review(
      (p - 'lines' - 'amount' - 'idempotency_key' - 'confirm_duplicate') || v_line ||
      jsonb_build_object('idempotency_key',md5(v_batch::text||':'||v_idx)::uuid,
        'confirm_duplicate',coalesce((p->>'confirm_duplicate')::boolean,false)));
    if v_result->>'status'='possible_duplicate' then
      raise exception 'Huenda kuna mstari unaorudiwa. Hakiki rekodi iliyopo kisha tuma tena ukithibitisha kuwa malipo ni mapya.' using errcode='P0001';
    end if;
    if v_result->>'status'<>'pending_review' then raise exception 'Mstari haujawekwa kwenye foleni ya uhakiki' using errcode='P0001'; end if;
    v_id:=(v_result->>'transaction_id')::uuid;
    v_ids:=array_append(v_ids,v_id);
    v_requests:=array_append(v_requests,(v_result->>'approval_id')::uuid);
  end loop;
  update public.finance_transactions set batch_id=v_batch where id=any(v_ids) and recorded_by=auth.uid() and status='pending';
  perform set_config('minga.batch_id','',true);
  return jsonb_build_object('status','pending_review','batch_id',v_batch,'transaction_ids',to_jsonb(v_ids),'approval_ids',to_jsonb(v_requests),'count',cardinality(v_ids),'total',v_total);
end $$;
revoke all on function public.submit_payment_batch_for_review(jsonb) from public,anon;
grant execute on function public.submit_payment_batch_for_review(jsonb) to authenticated;

-- One review decision applies to every category/recipient line in the receipt batch.
create or replace function public.decide_payment_submission_batch(p_batch uuid,p_approve boolean,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; v_results jsonb:='[]'::jsonb; v_one jsonb; v_count int:=0;
begin
  if not public.has_perm('finance.approve',null) then raise exception 'Huna ruhusa ya kuidhinisha' using errcode='42501'; end if;
  if p_batch is null then raise exception 'Kundi la malipo halipo' using errcode='P0001'; end if;
  if not p_approve and coalesce(length(btrim(p_note)),0)<3 then raise exception 'Andika sababu ya kukataa kundi hili la malipo' using errcode='P0001'; end if;
  if not exists(select 1 from public.finance_transactions where batch_id=p_batch and status='pending') then
    raise exception 'Hakuna malipo yanayosubiri katika kundi hili' using errcode='P0001';
  end if;
  perform set_config('minga.approving_batch',p_batch::text,true);
  for r in select ar.id from public.finance_transactions t join public.approval_requests ar on ar.transaction_id=t.id
    where t.batch_id=p_batch and t.status='pending' and ar.request_type='payment_submission' and ar.status='pending' order by t.txn_no for update of ar loop
    v_one:=public.decide_approval(r.id,p_approve,p_note);
    v_results:=v_results||jsonb_build_array(v_one); v_count:=v_count+1;
  end loop;
  if v_count=0 then raise exception 'Maombi yote ya kundi hili yamekwishaamuliwa' using errcode='P0001'; end if;
  perform set_config('minga.approving_batch','',true);
  return jsonb_build_object('status',case when p_approve then 'approved' else 'rejected' end,'batch_id',p_batch,'count',v_count,'results',v_results);
end $$;
revoke all on function public.decide_payment_submission_batch(uuid,boolean,text) from public,anon;
grant execute on function public.decide_payment_submission_batch(uuid,boolean,text) to authenticated;

-- Members with an approved family representative grant can see family members' posted gifts.
create or replace function public.my_family_is_representative()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.parishioners self join public.family_access_grants g
    on g.parishioner_id=self.id and g.family_id=self.family_id and g.status='active'
    where self.profile_id=auth.uid() and self.membership_status='active')
$$;
revoke all on function public.my_family_is_representative() from public,anon;
grant execute on function public.my_family_is_representative() to authenticated;
drop policy if exists ft_family_representative_read on public.finance_transactions;
create policy ft_family_representative_read on public.finance_transactions for select to authenticated using (
  parishioner_id is not null and family_id=public.my_family_id() and public.my_family_is_representative()
);

create or replace function public.member_jumuiya_contributions(p_year int default extract(year from current_date)::int)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_person public.parishioners; v_jum uuid; v_rows jsonb;
begin
  select * into v_person from public.parishioners where profile_id=auth.uid() and membership_status='active';
  if v_person.id is null or not exists(select 1 from public.profiles where id=auth.uid() and status='active') then
    raise exception 'Akaunti ya muumini haijaunganishwa' using errcode='42501';
  end if;
  select coalesce(v_person.jumuiya_id,f.jumuiya_id) into v_jum from public.families f where f.id=v_person.family_id;
  if v_jum is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('campaign_id',x.campaign_id,'campaign_name',x.campaign_name,'category_name',x.category_name,
    'target',x.target,'pledged',x.pledged,'paid',x.paid,'collected',x.collected,'balance',x.balance,'pct',x.pct) order by x.campaign_name),'[]'::jsonb)
    into v_rows from public.unit_contributions(p_year,v_jum) x;
  v_rows:=v_rows||jsonb_build_array(jsonb_build_object('campaign_name','Zaka','category_name','Zaka','target',0,'pledged',0,
    'paid',(select coalesce(sum(t.net_amount),0) from public.finance_transactions t join public.contribution_categories c on c.id=t.category_id
      where t.status='posted' and t.kind='income' and c.kind='zaka' and t.txn_date>=make_date(p_year,1,1)
        and t.txn_date<make_date(p_year+1,1,1) and coalesce(t.org_unit_id,t.jumuiya_id)=v_jum),
    'collected',(select coalesce(sum(t.net_amount),0) from public.finance_transactions t join public.contribution_categories c on c.id=t.category_id
      where t.status='posted' and t.kind='income' and c.kind='zaka' and t.txn_date>=make_date(p_year,1,1)
        and t.txn_date<make_date(p_year+1,1,1) and coalesce(t.org_unit_id,t.jumuiya_id)=v_jum),'balance',0,'pct',null));
  return v_rows;
end $$;
revoke all on function public.member_jumuiya_contributions(int) from public,anon;
grant execute on function public.member_jumuiya_contributions(int) to authenticated;
notify pgrst,'reload schema';



-- Prevent a client from approving only one line of a multi-line receipt.
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
    if t.batch_id is not null and current_setting('minga.approving_batch',true) is distinct from t.batch_id::text then
      raise exception 'Risiti hii imegawanywa; idhinisha au kataa kundi zima' using errcode='P0001';
    end if;
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
notify pgrst,'reload schema';
