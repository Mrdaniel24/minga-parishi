-- ============================================================================
-- Minga Parish Management System — migration 09: one system
--   Ties the Kanisa Hub modules (accounts, departments, announcements, chat,
--   events) to the parish register and ledger:
--     * every jumuiya / parish group is also a Kanisa Hub "department", so
--       group announcements, group chat and department-scoped admins work
--       per jumuiya;
--     * a signed-in member is linked to their parish register entry after an
--       administrator approves a link request — then they see their own
--       contributions, pledges, Zaka, receipts and their jumuiya;
--     * a parish role (e.g. jumuiya leader) makes the user a Kanisa Hub admin
--       of that jumuiya automatically;
--     * events can be tied to fundraising campaigns.
-- ============================================================================

alter table public.departments add column if not exists org_unit_id uuid references public.org_units(id) on delete set null;
create unique index if not exists departments_org_unit_once on public.departments (org_unit_id) where org_unit_id is not null;
alter table public.events add column if not exists campaign_id uuid references public.campaigns(id) on delete set null;
alter table public.events add column if not exists org_unit_id uuid references public.org_units(id) on delete set null;

-- one department per jumuiya / group (names stay in sync)
create or replace function public.sync_org_departments()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; u record;
begin
  for u in select o.*, k.name as kname from public.org_units o left join public.org_units k on k.id = o.parent_id
           where o.unit_type in ('jumuiya','group') loop
    if exists (select 1 from public.departments where org_unit_id = u.id) then
      update public.departments set name = case when u.unit_type = 'jumuiya' then 'Jumuiya ya ' || u.name else u.name end,
             is_active = u.is_active where org_unit_id = u.id;
    else
      insert into public.departments (name, description, category, is_active, org_unit_id)
      values (case when u.unit_type = 'jumuiya' then 'Jumuiya ya ' || u.name else u.name end,
              case when u.unit_type = 'jumuiya' then 'Jumuiya Ndogo Ndogo ya Kikristo — Kigango cha ' || coalesce(u.kname, '') else 'Chama / kikundi cha parokia' end,
              u.unit_type, u.is_active, u.id);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.trg_org_unit_department()
returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.sync_org_departments(); return null; end $$;
drop trigger if exists org_units_department_sync on public.org_units;
create trigger org_units_department_sync after insert or update of name, is_active, parent_id on public.org_units
  for each statement execute function public.trg_org_unit_department();
select public.sync_org_departments();

-- ---------------------------------------------------------------------------
-- Member ↔ register link requests
-- ---------------------------------------------------------------------------
create table if not exists public.parish_link_requests (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null references auth.users(id) on delete cascade,
  jumuiya_id      uuid references public.org_units(id),
  full_name       text not null,
  phone           text,
  family_name     text,
  note            text,
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  parishioner_id  uuid references public.parishioners(id),
  decided_by      uuid,
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now()
);
create unique index if not exists parish_link_requests_one_pending on public.parish_link_requests (profile_id) where status = 'pending';
alter table public.parish_link_requests enable row level security;
drop policy if exists plr_read on public.parish_link_requests;
create policy plr_read on public.parish_link_requests for select to authenticated
  using (profile_id = auth.uid() or public.has_perm('users.manage') or public.has_perm('registry.write', jumuiya_id));

create or replace function public.request_parish_link(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_j uuid := nullif(p->>'jumuiya_id','')::uuid;
begin
  if auth.uid() is null then raise exception 'Ingia kwanza' using errcode = '42501'; end if;
  if public.my_parishioner_id() is not null then return jsonb_build_object('status','already_linked'); end if;
  if v_j is null and nullif(p->>'department_id','') is not null then
    select org_unit_id into v_j from public.departments where id = (p->>'department_id')::uuid;
  end if;
  insert into public.parish_link_requests (profile_id, jumuiya_id, full_name, phone, family_name, note)
  values (auth.uid(), v_j, coalesce(nullif(btrim(p->>'full_name'),''), (select full_name from public.profiles where id = auth.uid()), '—'),
          nullif(btrim(p->>'phone'),''), nullif(btrim(p->>'family_name'),''), nullif(btrim(p->>'note'),''))
  on conflict (profile_id) where status = 'pending' do update
    set jumuiya_id = excluded.jumuiya_id, full_name = excluded.full_name, phone = excluded.phone,
        family_name = excluded.family_name, note = excluded.note, created_at = now()
  returning id into v_id;
  return jsonb_build_object('status','pending','request_id',v_id);
end $$;

-- approve: link to an existing register entry, or create a new one in the jumuiya
create or replace function public.decide_parish_link(p_request uuid, p_approve boolean, p_parishioner uuid default null,
                                                      p_family uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.parish_link_requests; v_p uuid; v_dept uuid; v_j uuid;
begin
  select * into r from public.parish_link_requests where id = p_request for update;
  if r.id is null or r.status <> 'pending' then raise exception 'Ombi halipo au limeshaamuliwa' using errcode = 'P0001'; end if;
  if not (public.has_perm('users.manage') or public.has_perm('registry.write', r.jumuiya_id)) then
    raise exception 'Huna ruhusa' using errcode = '42501';
  end if;
  if p_approve then
    perform set_config('minga.approved_link', 'on', true);    -- this transaction only
    if p_parishioner is not null then
      v_p := p_parishioner;
      if exists (select 1 from public.parishioners where id = v_p and profile_id is not null and profile_id <> r.profile_id) then
        raise exception 'Muumini huyu tayari ameunganishwa na akaunti nyingine' using errcode = 'P0001';
      end if;
      update public.parishioners set profile_id = r.profile_id, phone = coalesce(phone, r.phone) where id = v_p;
    else
      insert into public.parishioners (parish_id, full_name, phone, family_id, jumuiya_id, profile_id, registered_on)
      values (public.default_parish_id(), r.full_name, r.phone, p_family,
              coalesce((select jumuiya_id from public.families where id = p_family), r.jumuiya_id), r.profile_id, current_date)
      returning id into v_p;
    end if;
    select jumuiya_id into v_j from public.parishioners where id = v_p;
    select id into v_dept from public.departments where org_unit_id = v_j;
    update public.profiles set department_id = coalesce(v_dept, department_id), phone = coalesce(phone, r.phone) where id = r.profile_id;
  end if;
  update public.parish_link_requests set status = case when p_approve then 'approved' else 'rejected' end,
         parishioner_id = v_p, decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = r.id;
  insert into public.audit_log (actor_id, action, table_name, row_id, note)
  values (auth.uid(), case when p_approve then 'approve_link' else 'reject_link' end, 'parish_link_requests', r.id::text, p_note);
  return jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end, 'parishioner_id', v_p);
end $$;

-- the member's jumuiya follows the register: keep profiles.department_id in step
create or replace function public.trg_parishioner_department()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_dept uuid;
begin
  if new.profile_id is not null and (tg_op = 'INSERT' or new.jumuiya_id is distinct from old.jumuiya_id or new.profile_id is distinct from old.profile_id) then
    select id into v_dept from public.departments where org_unit_id = new.jumuiya_id;
    if v_dept is not null then update public.profiles set department_id = v_dept where id = new.profile_id; end if;
  end if;
  return new;
end $$;
drop trigger if exists parishioners_department on public.parishioners;
create trigger parishioners_department after insert or update of jumuiya_id, profile_id on public.parishioners
  for each row execute function public.trg_parishioner_department();

-- a parish role makes the user a Kanisa Hub admin (scoped leaders: of their jumuiya's department)
create or replace function public.trg_parish_role_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_dept uuid; v_scoped boolean;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.parish_user_roles where user_id = old.user_id and role_code <> 'member') then
      update public.profiles set role = 'member' where id = old.user_id and role = 'admin';
      delete from public.admin_permissions where admin_id = old.user_id;
    end if;
    return old;
  end if;
  if new.role_code = 'member' then return new; end if;
  select id into v_dept from public.departments where org_unit_id = new.org_unit_id;
  v_scoped := new.org_unit_id is not null;
  update public.profiles set role = 'admin' where id = new.user_id and role = 'member';
  insert into public.admin_permissions (admin_id, department_id, can_manage_members, can_manage_contributions, can_view_all_contributions,
    can_manage_events, can_manage_announcements, can_manage_media, can_manage_sermons, can_manage_departments, can_view_reports)
  values (new.user_id, case when v_scoped then v_dept end, true, true, not v_scoped, true, true, not v_scoped, not v_scoped, not v_scoped, true)
  on conflict (admin_id) do update set
    department_id = case when excluded.department_id is null then null else coalesce(admin_permissions.department_id, excluded.department_id) end,
    can_manage_members = true, can_manage_contributions = true, can_view_reports = true,
    can_view_all_contributions = admin_permissions.can_view_all_contributions or excluded.can_view_all_contributions,
    can_manage_events = true, can_manage_announcements = true,
    can_manage_media = admin_permissions.can_manage_media or excluded.can_manage_media,
    can_manage_sermons = admin_permissions.can_manage_sermons or excluded.can_manage_sermons,
    can_manage_departments = admin_permissions.can_manage_departments or excluded.can_manage_departments;
  return new;
end $$;
drop trigger if exists parish_user_roles_profile on public.parish_user_roles;
create trigger parish_user_roles_profile after insert or delete on public.parish_user_roles
  for each row execute function public.trg_parish_role_profile();

-- ---------------------------------------------------------------------------
-- What a member sees about themselves (member dashboard / "Michango Yangu")
-- ---------------------------------------------------------------------------
create or replace function public.my_member_summary(p_year int default extract(year from current_date)::int)
returns jsonb language sql stable security definer set search_path = public as $$
  with me as (
    select p.*, f.family_name, j.name as jumuiya_name, k.name as kigango_name
    from public.parishioners p
    left join public.families f on f.id = p.family_id
    left join public.org_units j on j.id = p.jumuiya_id
    left join public.org_units k on k.id = public.org_ancestor_of_type(p.jumuiya_id, 'kigango')
    where p.profile_id = auth.uid() limit 1
  ),
  tx as (
    select t.*, c.name_sw as category_name, c.kind as ck, cp.name as campaign_name, r.receipt_no, r.id as receipt_id
    from public.finance_transactions t
    join public.contribution_categories c on c.id = t.category_id
    left join public.campaigns cp on cp.id = t.campaign_id
    left join public.receipts r on r.transaction_id = t.id
    where t.status = 'posted' and t.kind = 'income'
      and (t.parishioner_id = (select id from me) or (t.family_id is not null and t.family_id = (select family_id from me)))
  )
  select case when not exists (select 1 from me) then
    jsonb_build_object('linked', false,
      'request', (select to_jsonb(r) from public.parish_link_requests r where r.profile_id = auth.uid() order by created_at desc limit 1))
  else jsonb_build_object(
    'linked', true,
    'parishioner', (select jsonb_build_object('id', id, 'full_name', full_name, 'family_id', family_id, 'family_name', family_name,
                     'jumuiya_id', jumuiya_id, 'jumuiya', jumuiya_name, 'kigango', kigango_name, 'is_zaka_payer', is_zaka_payer) from me),
    'year', p_year,
    'mine_year', coalesce((select sum(net_amount) from tx where parishioner_id = (select id from me) and extract(year from txn_date) = p_year), 0),
    'family_year', coalesce((select sum(net_amount) from tx where extract(year from txn_date) = p_year), 0),
    'by_kind', coalesce((select jsonb_object_agg(ck, s) from (select ck, sum(net_amount) s from tx where extract(year from txn_date) = p_year group by ck) x), '{}'),
    'zaka_months', coalesce((select jsonb_agg(distinct extract(month from period_month)::int) from tx
                             where ck = 'zaka' and parishioner_id = (select id from me) and extract(year from period_month) = p_year), '[]'),
    'pledges', coalesce((select jsonb_agg(to_jsonb(b) order by b.campaign_year desc) from public.v_pledge_balances b
                         where b.status = 'active' and (b.parishioner_id = (select id from me) or b.family_id = (select family_id from me))), '[]'),
    'recent', coalesce((select jsonb_agg(x) from (select txn_date, category_name, campaign_name, net_amount, receipt_no, receipt_id, payer_name
                                                  from tx order by txn_date desc, txn_no desc limit 20) x), '[]'),
    'jumuiya_campaigns', coalesce((select jsonb_agg(x) from (
        select cp.name, g.target, g.collected, g.pct from public.campaigns cp
        cross join lateral public.campaign_org_progress(cp.id, 'jumuiya') g
        where cp.campaign_year = p_year and cp.status <> 'closed' and g.org_unit_id = (select jumuiya_id from me) and g.target > 0) x), '[]')
  ) end
$$;
grant execute on function public.my_member_summary(int) to authenticated;

-- ---------------------------------------------------------------------------
-- One overview for the general admin / super-admin dashboards
-- ---------------------------------------------------------------------------
create or replace function public.church_overview()
returns jsonb language sql stable security definer set search_path = public as $$
  with scope as (    -- department-scoped admins see their jumuiya; others the parish
    select case when public.kh_role() = 'super_admin' or public.has_perm('finance.read') then null
                else (select d.org_unit_id from public.admin_permissions ap join public.departments d on d.id = ap.department_id
                      where ap.admin_id = auth.uid()) end as unit
  ),
  t as (select * from public.finance_transactions x
        where x.status = 'posted' and x.kind = 'income'
          and (case when (select unit from scope) is null then true else public.org_is_within(coalesce(x.org_unit_id, x.jumuiya_id), (select unit from scope)) end))
  select jsonb_build_object(
    'scope', (select name from public.org_units where id = (select unit from scope)),
    'accounts', (select count(*) from public.profiles where status = 'active'),
    'accounts_linked', (select count(*) from public.parishioners where profile_id is not null),
    'parishioners', (select count(*) from public.parishioners p where membership_status = 'active'
                       and (case when (select unit from scope) is null then true else public.org_is_within(p.jumuiya_id, (select unit from scope)) end)),
    'families', (select count(*) from public.families f where status = 'active'
                   and (case when (select unit from scope) is null then true else public.org_is_within(f.jumuiya_id, (select unit from scope)) end)),
    'jumuiya', (select count(*) from public.org_units where unit_type = 'jumuiya' and is_active),
    'vigango', (select count(*) from public.org_units where unit_type = 'kigango' and is_active),
    'income_month', coalesce((select sum(net_amount) from t where date_trunc('month', txn_date) = date_trunc('month', current_date)), 0),
    'income_prev_month', coalesce((select sum(net_amount) from t where date_trunc('month', txn_date) = date_trunc('month', current_date - interval '1 month')), 0),
    'income_year', coalesce((select sum(net_amount) from t where date_trunc('year', txn_date) = date_trunc('year', current_date)), 0),
    'monthly', (select jsonb_agg(jsonb_build_object('month', m, 'total', coalesce((select sum(net_amount) from t where date_trunc('month', txn_date) = m), 0)) order by m)
                from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') m),
    'by_kind', coalesce((select jsonb_object_agg(k, s) from (select c.kind k, sum(t.net_amount) s from t join public.contribution_categories c on c.id = t.category_id
                          where date_trunc('year', t.txn_date) = date_trunc('year', current_date) group by c.kind) x), '{}'),
    'recent', coalesce((select jsonb_agg(x) from (select t.txn_date, t.payer_name, c.name_sw category, t.net_amount amount, o.name jumuiya
                         from t join public.contribution_categories c on c.id = t.category_id
                         left join public.org_units o on o.id = coalesce(t.jumuiya_id, t.org_unit_id, t.kigango_id)
                         where t.txn_date <= current_date
                         order by t.txn_date desc, t.txn_no desc limit 8) x), '[]'),
    'outstanding_pledges', coalesce((select sum(outstanding) from public.v_pledge_balances b where b.status = 'active'
                                     and (case when (select unit from scope) is null then true else public.org_is_within(b.jumuiya_id, (select unit from scope)) end)), 0),
    'pending_links', (select count(*) from public.parish_link_requests r where r.status = 'pending'
                        and (case when (select unit from scope) is null then true else public.org_is_within(r.jumuiya_id, (select unit from scope)) end)),
    'pending_approvals', (select count(*) from public.approval_requests where status = 'pending'),
    'upcoming_events', (select count(*) from public.events where event_date >= now())
  )
$$;
grant execute on function public.church_overview() to authenticated;

revoke execute on function public.sync_org_departments() from public, anon, authenticated;
grant execute on function public.request_parish_link(jsonb) to authenticated;
grant execute on function public.decide_parish_link(uuid, boolean, uuid, uuid, text) to authenticated;
