-- SaaS packages and parish entitlements.
-- Run once in Supabase SQL Editor. Existing parishes without a subscription stay
-- on the core plan (legacy) until the system administrator assigns a plan.

create table if not exists public.subscription_plans (
  code text primary key check (code in ('demo','parish','ai')),
  name_sw text not null,
  monthly_tzs integer not null check (monthly_tzs >= 0),
  yearly_tzs integer not null check (yearly_tzs >= 0),
  features jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort_order integer not null default 100
);
insert into public.subscription_plans(code,name_sw,monthly_tzs,yearly_tzs,features,sort_order) values
 ('demo','Demo ya Kuangalia',0,0,'{"core":false,"ai_quick_ask":false,"sample_data_only":true}',10),
 ('parish','Usimamizi wa Parokia',50000,480000,'{"core":true,"ai_quick_ask":false,"sms":true,"chat":true,"standard_reports":true}',20),
 ('ai','Ripoti na Majibu ya Haraka',70000,672000,'{"core":true,"ai_quick_ask":true,"sms":true,"chat":true,"standard_reports":true}',30)
on conflict(code) do update set name_sw=excluded.name_sw,monthly_tzs=excluded.monthly_tzs,
  yearly_tzs=excluded.yearly_tzs,features=excluded.features,is_active=true,sort_order=excluded.sort_order;

create table if not exists public.parish_subscriptions (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null unique references public.parishes(id) on delete cascade,
  plan_code text not null references public.subscription_plans(code),
  status text not null check(status in ('active','trialing','past_due','suspended','cancelled')),
  billing_cycle text not null default 'monthly' check(billing_cycle in ('monthly','yearly','manual')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  notes text,
  assigned_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check(ends_at is null or ends_at > starts_at)
);
create index if not exists parish_subscriptions_plan_status_idx on public.parish_subscriptions(plan_code,status,ends_at);

create table if not exists public.parish_subscription_events (
  id bigint generated always as identity primary key,
  parish_id uuid not null references public.parishes(id) on delete cascade,
  old_plan_code text,
  new_plan_code text not null,
  old_status text,
  new_status text not null,
  billing_cycle text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  note text
);
create index if not exists parish_subscription_events_parish_idx on public.parish_subscription_events(parish_id,changed_at desc);

alter table public.subscription_plans enable row level security;
alter table public.parish_subscriptions enable row level security;
alter table public.parish_subscription_events enable row level security;
revoke all on public.parish_subscriptions,public.parish_subscription_events from anon,authenticated;
grant select on public.subscription_plans to authenticated;
drop policy if exists subscription_plans_read on public.subscription_plans;
create policy subscription_plans_read on public.subscription_plans for select to authenticated using(is_active);

create or replace function public.subscription_core_enabled(p_parish_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select case when s.parish_id is null then true
    else s.status in ('active','trialing')
      and (s.ends_at is null or s.ends_at > now())
      and s.plan_code in ('parish','ai')
  end
  from (select p_parish_id as parish_id) requested
  left join public.parish_subscriptions s on s.parish_id=requested.parish_id
$$;
revoke all on function public.subscription_core_enabled(uuid) from public,anon,authenticated;

-- Apply the paid-core entitlement centrally to role permission checks. Parishes
-- without an assigned plan retain existing behavior; Free/expired/suspended
-- parishes cannot use live parish permissions. Platform system administrators
-- retain access to manage subscriptions.
create or replace function public.has_perm(p_perm text,p_org uuid default null)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_platform_admin() or exists(
    select 1 from public.parish_user_roles ur
    join public.role_permissions rp on rp.role_code=ur.role_code
    where ur.user_id=auth.uid() and rp.permission=p_perm
      and public.subscription_core_enabled(ur.parish_id)
      and (case when ur.org_unit_id is null then true
        when p_org is null then false
        else public.org_is_within(p_org,ur.org_unit_id) end)
  )
$$;
create or replace function public.has_perm_anywhere(p_perm text)
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_platform_admin() or exists(
    select 1 from public.parish_user_roles ur
    join public.role_permissions rp on rp.role_code=ur.role_code
    where ur.user_id=auth.uid() and rp.permission=p_perm
      and public.subscription_core_enabled(ur.parish_id)
  )
$$;

create or replace function public.my_parish_subscription_access()
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare v_parish uuid; v_sub public.parish_subscriptions; v_plan public.subscription_plans;
  v_active boolean; v_features jsonb;
begin
  select ur.parish_id into v_parish from public.parish_user_roles ur where ur.user_id=auth.uid() order by ur.granted_at limit 1;
  if v_parish is null then
    select p.parish_id into v_parish from public.parishioners p where p.profile_id=auth.uid() limit 1;
  end if;
  if v_parish is null and public.is_platform_admin() then select id into v_parish from public.parishes order by code limit 1; end if;
  if v_parish is null then return jsonb_build_object('plan_code','none','status','unassigned','core_enabled',false,'features','{}'::jsonb); end if;
  select * into v_sub from public.parish_subscriptions where parish_id=v_parish;
  if v_sub.id is null then
    select * into v_plan from public.subscription_plans where code='parish';
    v_active:=true;
    return jsonb_build_object('parish_id',v_parish,'plan_code','parish','plan_name',v_plan.name_sw,
      'status','legacy','billing_cycle','manual','starts_at',null,'ends_at',null,'core_enabled',true,
      'features',v_plan.features,'legacy',true);
  end if;
  select * into v_plan from public.subscription_plans where code=v_sub.plan_code;
  v_active:=v_sub.status in ('active','trialing') and (v_sub.ends_at is null or v_sub.ends_at>now());
  v_features:=case when v_active then v_plan.features else jsonb_build_object('core',false,'ai_quick_ask',false) end;
  return jsonb_build_object('parish_id',v_parish,'plan_code',v_sub.plan_code,'plan_name',v_plan.name_sw,
    'status',case when v_sub.ends_at is not null and v_sub.ends_at<=now() then 'expired' else v_sub.status end,
    'billing_cycle',v_sub.billing_cycle,'starts_at',v_sub.starts_at,'ends_at',v_sub.ends_at,
    'core_enabled',coalesce((v_features->>'core')::boolean,false),'features',v_features,'legacy',false);
end $$;
revoke all on function public.my_parish_subscription_access() from public,anon;
grant execute on function public.my_parish_subscription_access() to authenticated;

-- Chat is part of the paid core plan. Keep its data policies aligned with the
-- same subscription check, including the member and family room paths.
drop policy if exists chat_rooms_read on public.chat_rooms;
create policy chat_rooms_read on public.chat_rooms for select to authenticated
  using (public.subscription_core_enabled(parish_id) and
    public.chat_can_access_scope(parish_id,org_unit_id,family_id,person_key,id));
drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages for select to authenticated
  using (public.subscription_core_enabled(parish_id) and
    public.chat_can_access_scope(parish_id,org_unit_id,family_id,person_key,room_id));
drop policy if exists chat_messages_send on public.chat_messages;
create policy chat_messages_send on public.chat_messages for insert to authenticated
  with check (sender_id=auth.uid() and public.subscription_core_enabled(parish_id) and
    public.chat_can_access_scope(parish_id,org_unit_id,family_id,person_key,room_id));

create or replace function public.chat_create_private_room(p_parishioner_id uuid)
returns uuid language plpgsql security definer set search_path=public,auth as $$
declare v_me public.parishioners; v_other public.parishioners; v_room uuid; v_key text; v_title text;
begin
  select * into v_me from public.parishioners where profile_id=auth.uid() and membership_status='active';
  if v_me.id is null then raise exception 'Akaunti yako haijaunganishwa na muumini hai' using errcode='42501'; end if;
  if not public.subscription_core_enabled(v_me.parish_id) then raise exception 'Chat inahitaji kifurushi cha Usimamizi wa Parokia' using errcode='42501'; end if;
  select * into v_other from public.parishioners where id=p_parishioner_id and parish_id=v_me.parish_id and membership_status='active' and profile_id is not null;
  if v_other.id is null or v_other.id=v_me.id then raise exception 'Chagua muumini mwingine mwenye akaunti iliyounganishwa' using errcode='22023'; end if;
  v_key:=least(v_me.id::text,v_other.id::text)||':'||greatest(v_me.id::text,v_other.id::text);
  v_title:=v_me.full_name||' · '||v_other.full_name;
  insert into public.chat_rooms(parish_id,scope_type,title,person_key)
    values(v_me.parish_id,'person',v_title,v_key)
    on conflict (parish_id,person_key) where scope_type='person' do update set title=excluded.title returning id into v_room;
  insert into public.chat_room_participants(room_id,user_id,parishioner_id)
    values(v_room,v_me.profile_id,v_me.id),(v_room,v_other.profile_id,v_other.id)
    on conflict(room_id,user_id) do update set parishioner_id=excluded.parishioner_id;
  return v_room;
end $$;
revoke all on function public.chat_create_private_room(uuid) from public,anon;
grant execute on function public.chat_create_private_room(uuid) to authenticated;

create or replace function public.admin_list_parish_subscriptions()
returns table(parish_id uuid,parish_name text,plan_code text,plan_name text,status text,billing_cycle text,starts_at timestamptz,ends_at timestamptz,notes text,legacy boolean)
language plpgsql stable security definer set search_path=public as $$
begin
  if not public.is_platform_admin() then raise exception 'Msimamizi wa mfumo pekee' using errcode='42501'; end if;
  return query
  select p.id,p.official_name,coalesce(s.plan_code,'parish'),coalesce(sp.name_sw,'Usimamizi wa Parokia'),
    coalesce(s.status,'legacy'),coalesce(s.billing_cycle,'manual'),s.starts_at,s.ends_at,s.notes,(s.id is null)
  from public.parishes p left join public.parish_subscriptions s on s.parish_id=p.id
    left join public.subscription_plans sp on sp.code=coalesce(s.plan_code,'parish')
  order by p.official_name;
end $$;
revoke all on function public.admin_list_parish_subscriptions() from public,anon;
grant execute on function public.admin_list_parish_subscriptions() to authenticated;

create or replace function public.admin_set_parish_subscription(
  p_parish_id uuid,p_plan_code text,p_status text,p_billing_cycle text,p_starts_at timestamptz,p_ends_at timestamptz,p_notes text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare previous public.parish_subscriptions; saved public.parish_subscriptions;
begin
  if not public.is_platform_admin() then raise exception 'Msimamizi wa mfumo pekee' using errcode='42501'; end if;
  if not exists(select 1 from public.parishes where id=p_parish_id) then raise exception 'Parokia haikupatikana'; end if;
  if not exists(select 1 from public.subscription_plans where code=p_plan_code and is_active) then raise exception 'Kifurushi hakipo'; end if;
  if p_status not in ('active','trialing','past_due','suspended','cancelled') then raise exception 'Hali ya subscription si sahihi'; end if;
  if p_billing_cycle not in ('monthly','yearly','manual') then raise exception 'Kipindi cha malipo si sahihi'; end if;
  select * into previous from public.parish_subscriptions where parish_id=p_parish_id;
  insert into public.parish_subscriptions(parish_id,plan_code,status,billing_cycle,starts_at,ends_at,notes,assigned_by,updated_at)
    values(p_parish_id,p_plan_code,p_status,p_billing_cycle,coalesce(p_starts_at,now()),p_ends_at,nullif(btrim(p_notes),''),auth.uid(),now())
  on conflict(parish_id) do update set plan_code=excluded.plan_code,status=excluded.status,billing_cycle=excluded.billing_cycle,
    starts_at=excluded.starts_at,ends_at=excluded.ends_at,notes=excluded.notes,assigned_by=excluded.assigned_by,updated_at=now()
  returning * into saved;
  insert into public.parish_subscription_events(parish_id,old_plan_code,new_plan_code,old_status,new_status,billing_cycle,starts_at,ends_at,changed_by,note)
    values(p_parish_id,previous.plan_code,saved.plan_code,previous.status,saved.status,saved.billing_cycle,saved.starts_at,saved.ends_at,auth.uid(),saved.notes);
  return jsonb_build_object('parish_id',saved.parish_id,'plan_code',saved.plan_code,'status',saved.status,'ends_at',saved.ends_at);
end $$;
revoke all on function public.admin_set_parish_subscription(uuid,text,text,text,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.admin_set_parish_subscription(uuid,text,text,text,timestamptz,timestamptz,text) to authenticated;

