-- Verified Member Portal: member-owned data, delegated family permissions and reviewed requests.

-- Disable the former server RPC that created auth accounts for every person in a family.
revoke all on function public.register_member_family(jsonb) from public, anon, authenticated, service_role;

create table if not exists public.family_access_grants (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id),
  family_id uuid not null references public.families(id),
  parishioner_id uuid not null references public.parishioners(id),
  role text not null default 'representative' check (role = 'representative'),
  status text not null default 'pending' check (status in ('pending','active','revoked','suspended')),
  approved_by uuid references public.profiles(id), approved_at timestamptz, revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists family_access_one_active_rep on public.family_access_grants(family_id, parishioner_id, role) where status = 'active';
create index if not exists family_access_member_idx on public.family_access_grants(parishioner_id, status);
alter table public.family_access_grants enable row level security;
revoke all on public.family_access_grants from public, anon, authenticated;

create or replace function public.revoke_family_grants_on_move()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name='parishioners' then
    if new.family_id is distinct from old.family_id or (new.membership_status is distinct from old.membership_status and new.membership_status<>'active') then
      update public.family_access_grants set status='revoked',revoked_at=now()
       where parishioner_id=new.id and status='active';
    end if;
  elsif tg_table_name='families' then
    if new.jumuiya_id is distinct from old.jumuiya_id or new.status<>'active' then
      update public.family_access_grants set status='revoked',revoked_at=now()
       where family_id=new.id and status='active';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists family_grants_revoke_member on public.parishioners;
create trigger family_grants_revoke_member after update of family_id,membership_status on public.parishioners
for each row execute function public.revoke_family_grants_on_move();
drop trigger if exists family_grants_revoke_family on public.families;
create trigger family_grants_revoke_family after update of jumuiya_id,status on public.families
for each row execute function public.revoke_family_grants_on_move();
revoke all on function public.revoke_family_grants_on_move() from public, anon, authenticated;

create table if not exists public.family_link_requests (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id),
  requested_by uuid not null references public.profiles(id),
  parishioner_id uuid not null references public.parishioners(id),
  family_id uuid not null references public.families(id),
  request_type text not null check (request_type in ('claim','representative')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, review_note text,
  created_at timestamptz not null default now()
);
create index if not exists family_link_pending_idx on public.family_link_requests(parish_id, status, created_at desc);
alter table public.family_link_requests enable row level security;
revoke all on public.family_link_requests from public, anon, authenticated;

create table if not exists public.family_change_requests (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id),
  family_id uuid references public.families(id),
  jumuiya_id uuid not null references public.org_units(id),
  requested_by uuid references public.profiles(id),
  request_type text not null check (request_type in ('public_registration','add_member','correct_family','move_family')),
  requested_data jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, review_note text,
  created_at timestamptz not null default now()
);
create index if not exists family_change_pending_idx on public.family_change_requests(parish_id, status, created_at desc);
alter table public.family_change_requests enable row level security;
revoke all on public.family_change_requests from public, anon, authenticated;

-- Keep an immutable audit trail for grants and both request/review queues.
drop trigger if exists family_access_grants_audit on public.family_access_grants;
create trigger family_access_grants_audit after insert or update or delete on public.family_access_grants for each row execute function public.audit_row();
drop trigger if exists family_link_requests_audit on public.family_link_requests;
create trigger family_link_requests_audit after insert or update or delete on public.family_link_requests for each row execute function public.audit_row();
drop trigger if exists family_change_requests_audit on public.family_change_requests;
create trigger family_change_requests_audit after insert or update or delete on public.family_change_requests for each row execute function public.audit_row();

-- Ordinary members can see their own payment history and family-level payments only.
drop policy if exists ft_read on public.finance_transactions;
create policy ft_read on public.finance_transactions for select to authenticated using (
  (select public.has_perm('finance.read'))
  or public.has_perm('finance.read', coalesce(org_unit_id, jumuiya_id))
  or (parishioner_id is not null and parishioner_id = (select public.my_parishioner_id()))
  or (parishioner_id is null and family_id is not null and family_id = (select public.my_family_id()))
);
drop policy if exists pledges_read on public.pledges;
create policy pledges_read on public.pledges for select to authenticated using (
  (select public.has_perm('finance.read'))
  or public.has_perm('finance.read', coalesce(org_unit_id, jumuiya_id))
  or (parishioner_id is not null and parishioner_id = (select public.my_parishioner_id()))
  or (parishioner_id is null and family_id is not null and family_id = (select public.my_family_id()))
);
-- A member sees a minimum family roster from member_portal_context(), never phone/address fields.
drop policy if exists families_read on public.families;
create policy families_read on public.families for select to authenticated using (
  (select public.has_perm('registry.read')) or public.has_perm('registry.read',jumuiya_id)
);
drop policy if exists parishioners_read on public.parishioners;
create policy parishioners_read on public.parishioners for select to authenticated using (
  (select public.has_perm('registry.read')) or public.has_perm('registry.read',jumuiya_id) or profile_id=auth.uid()
);
drop policy if exists env_read on public.envelopes;
create policy env_read on public.envelopes for select to authenticated using (
  (select public.has_perm('finance.read')) or public.has_perm('finance.read',org_unit_id)
  or (parishioner_id is not null and parishioner_id=(select public.my_parishioner_id()))
  or (parishioner_id is null and family_id is not null and family_id=(select public.my_family_id()))
);

create or replace function public.member_portal_context()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object(
    'parishioner_id', p.id, 'full_name', p.full_name, 'family_id', p.family_id,
    'family_name', f.family_name, 'family_code', f.family_code, 'jumuiya_id', coalesce(p.jumuiya_id, f.jumuiya_id),
    'jumuiya_name', j.name, 'kigango_name', k.name,
    'is_representative', exists(select 1 from public.family_access_grants g where g.parishioner_id=p.id and g.family_id=p.family_id and g.status='active'),
    'family_members', coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.full_name,'relationship',m.relationship) order by m.full_name)
      from public.parishioners m where m.family_id=p.family_id and m.membership_status='active'), '[]'::jsonb)
  ) from public.parishioners p
    left join public.families f on f.id=p.family_id
    left join public.org_units j on j.id=coalesce(p.jumuiya_id,f.jumuiya_id)
    left join public.org_units k on k.id=j.parent_id
    where p.profile_id=auth.uid() and p.membership_status='active'
      and exists(select 1 from public.profiles pr where pr.id=auth.uid() and pr.status='active') limit 1), '{}'::jsonb)
$$;
revoke all on function public.member_portal_context() from public, anon;
grant execute on function public.member_portal_context() to authenticated;

create or replace function public.member_portal_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_person uuid := public.my_parishioner_id();
begin
  if auth.uid() is null or v_person is null
      or not exists(select 1 from public.profiles where id=auth.uid() and status='active')
      or not exists(select 1 from public.parishioners where id=v_person and membership_status='active') then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'total_paid',coalesce((select sum(net_amount) from public.finance_transactions where parishioner_id=v_person and kind='income' and status='posted'),0),
    'payment_count',coalesce((select count(*) from public.finance_transactions where parishioner_id=v_person and kind='income' and status='posted'),0),
    'last_payment', (select max(txn_date) from public.finance_transactions where parishioner_id=v_person and kind='income' and status='posted')
  );
end $$;
revoke all on function public.member_portal_summary() from public, anon;
grant execute on function public.member_portal_summary() to authenticated;

create or replace function public.request_member_link(p_full_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_profile public.profiles; v_person public.parishioners; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Ingia kwanza' using errcode='42501'; end if;
  select * into v_profile from public.profiles where id=auth.uid() and status='active';
  if v_profile.id is null or length(btrim(coalesce(p_full_name,''))) < 3 then raise exception 'Jina kamili linahitajika'; end if;
  if not exists(select 1 from auth.users u where u.id=auth.uid() and u.phone_confirmed_at is not null
      and public.normalize_phone(u.phone)=public.normalize_phone(v_profile.phone)) then
    raise exception 'Thibitisha kwanza namba ya simu ya akaunti hii kwa msimbo wa SMS.';
  end if;
  if exists(select 1 from public.parishioners where profile_id=auth.uid()) then raise exception 'Akaunti tayari imeunganishwa na rejista'; end if;
  select * into v_person from public.parishioners p where p.profile_id is null and p.membership_status='active'
    and public.normalize_phone(p.phone)=public.normalize_phone(v_profile.phone)
    and lower(regexp_replace(btrim(p.full_name),'[[:space:]]+',' ','g'))=lower(regexp_replace(btrim(p_full_name),'[[:space:]]+',' ','g'))
  order by p.created_at limit 1;
  if v_person.id is null then raise exception 'Hatukupata rekodi inayolingana na jina na simu ya akaunti hii. Wasiliana na Ofisi ya Parokia.'; end if;
  if exists(select 1 from public.family_link_requests where requested_by=auth.uid() and parishioner_id=v_person.id and status='pending') then
    raise exception 'Ombi lako linasubiri ukaguzi wa Ofisi ya Parokia';
  end if;
  insert into public.family_link_requests(parish_id,requested_by,parishioner_id,family_id,request_type)
  values(v_person.parish_id,auth.uid(),v_person.id,v_person.family_id,'claim') returning id into v_id;
  return v_id;
end $$;
revoke all on function public.request_member_link(text) from public, anon;
grant execute on function public.request_member_link(text) to authenticated;

create or replace function public.request_family_link(p_type text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_person public.parishioners; v_id uuid;
begin
  if auth.uid() is null or p_type not in ('claim','representative') then raise exception 'Ombi si sahihi' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and status='active') then raise exception 'Akaunti haijawezeshwa'; end if;
  select * into v_person from public.parishioners where profile_id=auth.uid() and membership_status='active';
  if v_person.id is null or v_person.family_id is null then raise exception 'Akaunti yako haijaunganishwa na familia'; end if;
  if p_type='representative' and exists(select 1 from public.family_access_grants where family_id=v_person.family_id and parishioner_id=v_person.id and status='active') then
    raise exception 'Tayari una ruhusa ya mwakilishi';
  end if;
  if exists(select 1 from public.family_link_requests where requested_by=auth.uid() and request_type=p_type and status='pending') then raise exception 'Ombi hili linasubiri ukaguzi'; end if;
  insert into public.family_link_requests(parish_id,requested_by,parishioner_id,family_id,request_type)
  values(v_person.parish_id,auth.uid(),v_person.id,v_person.family_id,p_type) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.request_family_link(text) from public, anon;
grant execute on function public.request_family_link(text) to authenticated;

-- Server-only entry point used by the public registration form: submissions are requests, never accounts.
create or replace function public.submit_public_family_request(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_kig uuid := nullif(p->>'kigango_id','')::uuid; v_jum uuid := nullif(p->>'jumuiya_id','')::uuid; v_parish uuid; v_family uuid; v_id uuid; v_members jsonb := p->'members';
begin
  select j.parish_id into v_parish from public.org_units j join public.org_units k on k.id=j.parent_id
   where j.id=v_jum and j.unit_type='jumuiya' and j.is_active and k.id=v_kig and k.unit_type='kigango' and k.is_active;
  if v_parish is null or v_parish<>public.default_parish_id() then raise exception 'Jumuiya haijulikani'; end if;
  if jsonb_typeof(v_members)<>'array' or jsonb_array_length(v_members)<1 or jsonb_array_length(v_members)>12 then raise exception 'Orodha ya wanafamilia si sahihi'; end if;
  v_family := nullif(p->>'family_id','')::uuid;
  if v_family is not null and not exists(select 1 from public.families where id=v_family and jumuiya_id=v_jum and status='active') then raise exception 'Familia haipo kwenye jumuiya hiyo'; end if;
  if length(btrim(coalesce(p->>'contact_name','')))<3 or public.normalize_phone(p->>'contact_phone') is null then raise exception 'Jina na simu ya mawasiliano vinahitajika'; end if;
  if length(btrim(coalesce(p->>'new_family_name',''))) > 120 then raise exception 'Jina la familia ni refu mno'; end if;
  insert into public.family_change_requests(parish_id,family_id,jumuiya_id,request_type,requested_data)
  values(v_parish,v_family,v_jum,'public_registration',jsonb_build_object(
    'contact_name',left(btrim(p->>'contact_name'),120),'contact_phone',public.normalize_phone(p->>'contact_phone'),
    'new_family_name',left(btrim(coalesce(p->>'new_family_name','')),120),'head_index',nullif(p->>'head_index','')::int,'members',v_members)) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.submit_public_family_request(jsonb) from public, anon, authenticated;
grant execute on function public.submit_public_family_request(jsonb) to service_role;

create or replace function public.member_my_requests()
returns jsonb language sql stable security definer set search_path = public as $$
 select jsonb_build_object(
   'links',coalesce((select jsonb_agg(jsonb_build_object('id',id,'type',request_type,'status',status,'created_at',created_at,'review_note',review_note) order by created_at desc) from public.family_link_requests where requested_by=auth.uid()),'[]'::jsonb),
   'changes',coalesce((select jsonb_agg(jsonb_build_object('id',id,'type',request_type,'status',status,'created_at',created_at,'review_note',review_note) order by created_at desc) from public.family_change_requests where requested_by=auth.uid()),'[]'::jsonb)
 ) where auth.uid() is not null
$$;
revoke all on function public.member_my_requests() from public, anon;
grant execute on function public.member_my_requests() to authenticated;

create or replace function public.member_request_change(p_type text, p_data jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_person public.parishioners; v_family public.families; v_id uuid;
begin
  if auth.uid() is null or p_type not in ('correct_family','add_member','move_family') then raise exception 'Ombi si sahihi' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=auth.uid() and status='active') then raise exception 'Akaunti haijawezeshwa'; end if;
  select * into v_person from public.parishioners where profile_id=auth.uid() and membership_status='active';
  select * into v_family from public.families where id=v_person.family_id and status='active';
  if v_family.id is null then raise exception 'Akaunti yako haina familia iliyothibitishwa'; end if;
  if p_type in ('add_member','move_family') and not exists(select 1 from public.family_access_grants where family_id=v_family.id and parishioner_id=v_person.id and status='active') then
    raise exception 'Mwakilishi wa familia pekee anaweza kutuma ombi hili';
  end if;
  if jsonb_typeof(p_data)<>'object' or length(p_data::text)>5000 then raise exception 'Taarifa za ombi si sahihi'; end if;
  if p_type='correct_family' and (p_data - array['family_name','phone','address','member_name','member_phone','gender','birth_year']) <> '{}'::jsonb then raise exception 'Sehemu za kusahihisha hazitambuliki'; end if;
  if p_type='add_member' and (p_data - array['full_name','phone','gender','birth_year','relationship']) <> '{}'::jsonb then raise exception 'Taarifa za mwanafamilia hazitambuliki'; end if;
  if p_type='move_family' and (p_data - array['target_jumuiya_id']) <> '{}'::jsonb then raise exception 'Jumuiya ya kuhamia haijatambulika'; end if;
  if p_type='correct_family' and ((p_data ? 'phone' and public.normalize_phone(p_data->>'phone') is null)
      or (p_data ? 'member_phone' and public.normalize_phone(p_data->>'member_phone') is null)) then
    raise exception 'Namba ya simu si sahihi';
  end if;
  if p_type='add_member' and (length(btrim(coalesce(p_data->>'full_name','')))<3
      or public.normalize_phone(p_data->>'phone') is null
      or (nullif(p_data->>'gender','') is not null and p_data->>'gender' not in ('male','female'))
      or (nullif(p_data->>'birth_year','') is not null and (p_data->>'birth_year')::int not between 1900 and extract(year from current_date)::int)
      or upper(coalesce(p_data->>'relationship','MWINGINE')) not in ('BABA','MAMA','MTOTO','MJUKUU','BIBI','BABU','KAKA','DADA','MJOMBA','SHANGAZI','MWINGINE')) then
    raise exception 'Taarifa za mwanafamilia si sahihi';
  end if;
  if p_type='move_family' and not exists(select 1 from public.org_units where id=(p_data->>'target_jumuiya_id')::uuid
      and parish_id=v_person.parish_id and unit_type='jumuiya' and is_active and id<>v_family.jumuiya_id) then
    raise exception 'Chagua jumuiya nyingine iliyo hai ndani ya Parokia';
  end if;
  insert into public.family_change_requests(parish_id,family_id,jumuiya_id,requested_by,request_type,requested_data)
  values(v_person.parish_id,v_family.id,v_family.jumuiya_id,auth.uid(),p_type,p_data) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.member_request_change(text,jsonb) from public, anon;
grant execute on function public.member_request_change(text,jsonb) to authenticated;

create or replace function public.parish_family_requests()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_parish uuid := public.default_parish_id();
begin
  if not public.has_perm_anywhere('registry.write') then raise exception 'Huna ruhusa ya kuona maombi haya' using errcode='42501'; end if;
  return jsonb_build_object(
    'links',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'type',r.request_type,'status',r.status,'created_at',r.created_at,'member',p.full_name,'family',f.family_name,'jumuiya',j.name,'requester',pr.full_name) order by r.created_at) from public.family_link_requests r join public.parishioners p on p.id=r.parishioner_id join public.families f on f.id=r.family_id join public.org_units j on j.id=f.jumuiya_id join public.profiles pr on pr.id=r.requested_by where r.parish_id=v_parish and r.status='pending' and public.has_perm('registry.write',f.jumuiya_id)),'[]'::jsonb),
    'changes',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'type',r.request_type,'status',r.status,'created_at',r.created_at,'data',r.requested_data,'family',f.family_name,'jumuiya',j.name,'target_jumuiya',(select t.name from public.org_units t where t.id=nullif(r.requested_data->>'target_jumuiya_id','')::uuid),'requester',pr.full_name) order by r.created_at) from public.family_change_requests r left join public.families f on f.id=r.family_id join public.org_units j on j.id=r.jumuiya_id left join public.profiles pr on pr.id=r.requested_by where r.parish_id=v_parish and r.status='pending' and public.has_perm('registry.write',r.jumuiya_id)),'[]'::jsonb)
  );
end $$;
revoke all on function public.parish_family_requests() from public, anon;
grant execute on function public.parish_family_requests() to authenticated;

create or replace function public.decide_family_link(p_request uuid,p_approve boolean,p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r public.family_link_requests; p public.parishioners;
begin
  select * into r from public.family_link_requests where id=p_request and status='pending' for update;
  if r.id is null then raise exception 'Ombi halipo au limeshashughulikiwa'; end if;
  if not public.has_perm('registry.write',(select jumuiya_id from public.families where id=r.family_id)) then raise exception 'Huna ruhusa ya kuamua ombi hili' using errcode='42501'; end if;
  if p_approve and r.request_type='claim' then
    select * into p from public.parishioners where id=r.parishioner_id and profile_id is null and membership_status='active' for update;
    if p.id is null or exists(select 1 from public.parishioners where profile_id=r.requested_by) then raise exception 'Rekodi haiwezi kuunganishwa tena'; end if;
    perform set_config('minga.approved_link','on',true);
    update public.parishioners set profile_id=r.requested_by where id=p.id;
  elsif p_approve and r.request_type='representative' then
    if not exists(select 1 from public.parishioners where id=r.parishioner_id and family_id=r.family_id and membership_status='active') then raise exception 'Muumini si wa familia hii'; end if;
    insert into public.family_access_grants(parish_id,family_id,parishioner_id,status,approved_by,approved_at)
    values(r.parish_id,r.family_id,r.parishioner_id,'active',auth.uid(),now()) on conflict do nothing;
  end if;
  update public.family_link_requests set status=case when p_approve then 'approved' else 'rejected' end,reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(btrim(p_note),'') where id=r.id;
end $$;
revoke all on function public.decide_family_link(uuid,boolean,text) from public, anon;
grant execute on function public.decide_family_link(uuid,boolean,text) to authenticated;

create or replace function public.decide_family_change(p_request uuid,p_approve boolean,p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.family_change_requests; v_family uuid; v_item jsonb; v_index int:=0; v_head uuid; v_person uuid; v_existing public.parishioners; v_jum public.org_units;
begin
  select * into r from public.family_change_requests where id=p_request and status='pending' for update;
  if r.id is null then raise exception 'Ombi halipo au limeshashughulikiwa'; end if;
  if not public.has_perm('registry.write',r.jumuiya_id) then raise exception 'Huna ruhusa ya kuamua ombi hili' using errcode='42501'; end if;
  if p_approve and r.request_type='public_registration' then
    select * into v_jum from public.org_units where id=r.jumuiya_id and is_active and unit_type='jumuiya';
    if v_jum.id is null then raise exception 'Jumuiya haipo tena'; end if;
    v_family:=r.family_id;
    if v_family is null then
      if exists(select 1 from public.families where jumuiya_id=r.jumuiya_id and status='active' and lower(btrim(family_name))=lower(btrim(r.requested_data->>'new_family_name'))) then raise exception 'Jina la familia lipo tayari'; end if;
      insert into public.families(parish_id,family_name,jumuiya_id,phone) values(r.parish_id,btrim(r.requested_data->>'new_family_name'),r.jumuiya_id,public.normalize_phone(r.requested_data#>>'{members,0,phone}')) returning id into v_family;
    end if;
    for v_item in select value from jsonb_array_elements(r.requested_data->'members') loop
      select * into v_existing from public.parishioners where parish_id=r.parish_id and public.normalize_phone(phone)=public.normalize_phone(v_item->>'phone') limit 1;
      if v_existing.id is not null then
        if v_existing.family_id is distinct from v_family or lower(btrim(v_existing.full_name))<>lower(btrim(v_item->>'full_name')) then
          raise exception 'Simu ya % tayari imeunganishwa na rekodi nyingine. Hakiki ombi kabla ya kuendelea.',v_item->>'full_name';
        end if;
        v_person:=v_existing.id;
      else
        insert into public.parishioners(parish_id,full_name,gender,birth_year,phone,family_id,relationship,jumuiya_id,membership_status,registered_on)
        values(r.parish_id,left(btrim(v_item->>'full_name'),120),nullif(v_item->>'gender',''),nullif(v_item->>'birth_year','')::int,public.normalize_phone(v_item->>'phone'),v_family,upper(btrim(v_item->>'relationship')),r.jumuiya_id,'active',current_date) returning id into v_person;
      end if;
      if v_index=nullif(r.requested_data->>'head_index','')::int then v_head:=v_person; end if;
      v_index:=v_index+1;
    end loop;
    if v_head is not null then update public.families set head_parishioner_id=v_head where id=v_family; end if;
  elsif p_approve and r.request_type='add_member' then
    v_item:=r.requested_data;
    if length(btrim(coalesce(v_item->>'full_name','')))<3 or public.normalize_phone(v_item->>'phone') is null then raise exception 'Jina na simu ya mwanafamilia vinahitajika'; end if;
    if exists(select 1 from public.parishioners where parish_id=r.parish_id and public.normalize_phone(phone)=public.normalize_phone(v_item->>'phone')) then raise exception 'Simu hii ipo tayari kwenye rejista'; end if;
    insert into public.parishioners(parish_id,full_name,gender,birth_year,phone,family_id,relationship,jumuiya_id,membership_status,registered_on)
    values(r.parish_id,left(btrim(v_item->>'full_name'),120),nullif(v_item->>'gender',''),nullif(v_item->>'birth_year','')::int,public.normalize_phone(v_item->>'phone'),r.family_id,upper(btrim(coalesce(v_item->>'relationship','MWINGINE'))),r.jumuiya_id,'active',current_date);
  elsif p_approve and r.request_type='correct_family' then
    v_item:=r.requested_data;
    if v_item ?| array['family_name','phone','address'] then
      update public.families set family_name=coalesce(nullif(btrim(v_item->>'family_name'),''),family_name),
        phone=case when v_item ? 'phone' then public.normalize_phone(v_item->>'phone') else phone end,
        address=case when v_item ? 'address' then nullif(btrim(v_item->>'address'),'') else address end where id=r.family_id;
    end if;
    if v_item ?| array['member_name','member_phone','gender','birth_year'] then
      update public.parishioners set full_name=coalesce(nullif(btrim(v_item->>'member_name'),''),full_name),
        phone=case when v_item ? 'member_phone' then public.normalize_phone(v_item->>'member_phone') else phone end,
        gender=case when v_item ? 'gender' then nullif(v_item->>'gender','') else gender end,
        birth_year=case when v_item ? 'birth_year' then nullif(v_item->>'birth_year','')::int else birth_year end
      where profile_id=r.requested_by and family_id=r.family_id;
    end if;
  elsif p_approve and r.request_type='move_family' then
    v_item:=r.requested_data;
    if not public.has_perm('registry.write',(v_item->>'target_jumuiya_id')::uuid) then raise exception 'Huna ruhusa ya jumuiya inayopokea familia' using errcode='42501'; end if;
    perform public.move_family(r.family_id,(v_item->>'target_jumuiya_id')::uuid,false,'Ombi la mwakilishi wa familia #'||r.id::text);
  end if;
  update public.family_change_requests set status=case when p_approve then 'approved' else 'rejected' end,reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(btrim(p_note),'') where id=r.id;
  return jsonb_build_object('family_id',v_family);
end $$;
revoke all on function public.decide_family_change(uuid,boolean,text) from public, anon;
grant execute on function public.decide_family_change(uuid,boolean,text) to authenticated;

notify pgrst, 'reload schema';
