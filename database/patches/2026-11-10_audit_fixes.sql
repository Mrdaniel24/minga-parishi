-- ============================================================================
-- Patch 2026-11-10 — run ONCE in Supabase → SQL Editor on the live database,
-- AFTER database/patches/2026-11-02_hatua_6_12.sql. Safe to run again.
-- Contains migrations 32–33:
--   32  Ukaguzi: akaunti iliyosimamishwa inapoteza ruhusa zote; kufuta muumini kunahitaji sababu
--   33  Maboresho: kumwondoa muumini bila kufuta rekodi (soft delete); SMS kwa waliolipa /
--       hawajalipa zaka; ripoti ya viongozi (kichujio cha cheo, vyeo vilivyoisha);
--       kurekebisha SMS iliyokwama; vichujio vipya vya kubonyeza jumla (ledger_drill)
-- ============================================================================

-- >>>>>>>>>>>>>>>>>>>> 20261015_32_audit_fixes.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- Minga Parish Management System — migration 32: fixes from the system audit (2026-11-10)
--   1. A suspended account (profiles.status <> 'active') loses every parish right
--      in the database itself. Before this, only the browser signed it out: the
--      same login could still read and post through the API until its token ran out.
--   2. Removing a member from the register needs a reason (the screen asked for
--      one, the database did not).
--   Re-runnable; changes no data.
-- ============================================================================

-- 1. rights only for active accounts
create or replace function public.has_perm(p_perm text, p_org uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.parish_user_roles ur
    join public.role_permissions rp on rp.role_code = ur.role_code
    join public.profiles pr on pr.id = ur.user_id and coalesce(pr.status, 'active') = 'active'
    where ur.user_id = auth.uid()
      and rp.permission = p_perm
      and (case when ur.org_unit_id is null then true
                when p_org is null then false
                else public.org_is_within(p_org, ur.org_unit_id) end)
  )
$$;

create or replace function public.has_perm_anywhere(p_perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or exists (
    select 1 from public.parish_user_roles ur
    join public.role_permissions rp on rp.role_code = ur.role_code
    join public.profiles pr on pr.id = ur.user_id and coalesce(pr.status, 'active') = 'active'
    where ur.user_id = auth.uid() and rp.permission = p_perm)
$$;

-- 2. removing a member: a reason is required (same function as migration 26 otherwise)
create or replace function public.delete_parishioner(p_parishioner uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  per public.parishioners;
  pl record;
  v_jum uuid;
  n_tx int := 0; n_pl int := 0;
begin
  select * into per from public.parishioners where id = p_parishioner;
  if per.id is null then raise exception 'Muumini hayupo' using errcode = 'P0001'; end if;
  v_jum := coalesce(per.jumuiya_id, (select jumuiya_id from public.families where id = per.family_id));
  if not public.has_perm('registry.write', v_jum) then
    raise exception 'Huna ruhusa ya kumfuta muumini huyu (permission denied)' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Sababu ya kumfuta muumini inahitajika (reason required)' using errcode = 'P0001';
  end if;

  perform set_config('minga.reattribute', 'on', true);
  update public.finance_transactions
     set payer_name = coalesce(nullif(btrim(payer_name), ''), per.full_name),
         family_id = coalesce(family_id, per.family_id),
         parishioner_id = null
   where parishioner_id = per.id;
  get diagnostics n_tx = row_count;
  perform set_config('minga.reattribute', 'off', true);

  for pl in select * from public.pledges where parishioner_id = per.id loop
    -- an active pledge whose new owner already has one for the campaign is closed
    if pl.status = 'active' and exists (
         select 1 from public.pledges x where x.campaign_id = pl.campaign_id and x.status = 'active' and x.id <> pl.id
           and coalesce(x.parishioner_id, x.family_id, x.org_unit_id) = coalesce(per.family_id, v_jum)) then
      update public.pledges set status = 'cancelled', status_reason = 'Muumini amefutwa kwenye rejista' where id = pl.id;
    end if;
    update public.pledges set parishioner_id = null,
           family_id = per.family_id,
           org_unit_id = case when per.family_id is null then v_jum end
     where id = pl.id;
    n_pl := n_pl + 1;
  end loop;

  update public.envelopes set parishioner_id = null, family_id = coalesce(family_id, per.family_id) where parishioner_id = per.id;
  update public.leadership_assignments set parishioner_id = null,
         status = 'ended', ends_on = case when status = 'active' then greatest(coalesce(starts_on, current_date), current_date) else ends_on end
   where parishioner_id = per.id;
  insert into public.audit_log (actor_id, action, table_name, row_id, old_data, note)
  values (auth.uid(), 'delete_parishioner', 'parishioners', per.id::text, to_jsonb(per) || jsonb_build_object('payments_kept', n_tx, 'pledges_moved', n_pl),
          btrim(p_reason));
  delete from public.parishioners where id = per.id;
  return jsonb_build_object('payments_kept', n_tx, 'pledges_moved', n_pl);
end $$;
revoke execute on function public.delete_parishioner(uuid, text) from public, anon;
grant execute on function public.delete_parishioner(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>> 20261015_33_maboresho.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- Minga Parish Management System — migration 33: maboresho (2026-11-10)
--   1. Kufuta muumini = kumwondoa kwenye rejista (soft delete). Rekodi yake inabaki
--      (membership_status = 'removed', lini, sababu, nani), malipo yanabaki yameunganishwa
--      naye, mahudhurio na historia ya vyeo vinabaki. Akaunti yake inatenganishwa,
--      vyeo vinamalizwa, ahadi zinazoendelea zinahamia familia (kama zamani).
--   2. SMS kwa "waliolipa zaka" (malipo halisi ya mwaka / mwezi) na "hawajalipa zaka".
--   3. Ripoti ya viongozi: kichujio cha cheo, na vyeo vilivyoisha ndani ya mwaka.
--   4. SMS iliyokwama kwenye "Inatumwa…": msimamizi anaiweka "Imetumwa" au "Imeshindikana".
--   Re-runnable; haibadilishi data iliyopo (isipokuwa safu mpya tupu).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. soft delete
-- ---------------------------------------------------------------------------
alter table public.parishioners drop constraint if exists parishioners_membership_status_check;
alter table public.parishioners add constraint parishioners_membership_status_check
  check (membership_status in ('active', 'inactive', 'moved', 'deceased', 'removed'));
alter table public.parishioners add column if not exists removed_on date;
alter table public.parishioners add column if not exists removed_reason text;
alter table public.parishioners add column if not exists removed_by uuid;

create or replace function public.delete_parishioner(p_parishioner uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  per public.parishioners;
  pl record;
  v_jum uuid;
  n_tx int := 0; n_pl int := 0;
begin
  select * into per from public.parishioners where id = p_parishioner for update;
  if per.id is null then raise exception 'Muumini hayupo' using errcode = 'P0001'; end if;
  v_jum := coalesce(per.jumuiya_id, (select jumuiya_id from public.families where id = per.family_id));
  if not public.has_perm('registry.write', v_jum) then
    raise exception 'Huna ruhusa ya kumfuta muumini huyu (permission denied)' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Sababu ya kumfuta muumini inahitajika (reason required)' using errcode = 'P0001';
  end if;
  if per.membership_status = 'removed' then
    raise exception 'Muumini huyu ameshaondolewa kwenye rejista' using errcode = 'P0001';
  end if;

  -- payments stay linked to the person (history); only counted here
  select count(*) into n_tx from public.finance_transactions where parishioner_id = per.id;

  -- open pledges are carried by the family (or the jumuiya when there is no family)
  for pl in select * from public.pledges where parishioner_id = per.id and status = 'active' loop
    if exists (
         select 1 from public.pledges x where x.campaign_id = pl.campaign_id and x.status = 'active' and x.id <> pl.id
           and coalesce(x.parishioner_id, x.family_id, x.org_unit_id) = coalesce(per.family_id, v_jum)) then
      update public.pledges set status = 'cancelled', status_reason = 'Muumini ameondolewa kwenye rejista' where id = pl.id;
    else
      update public.pledges set parishioner_id = null,
             family_id = per.family_id,
             org_unit_id = case when per.family_id is null then v_jum end
       where id = pl.id;
    end if;
    n_pl := n_pl + 1;
  end loop;

  update public.envelopes set parishioner_id = null, family_id = coalesce(family_id, per.family_id) where parishioner_id = per.id;
  -- titles end; the person stays on them so the history shows who held them
  update public.leadership_assignments set status = 'ended',
         ends_on = greatest(coalesce(starts_on, current_date), current_date)
   where parishioner_id = per.id and status = 'active';

  update public.parishioners
     set membership_status = 'removed', removed_on = current_date, removed_reason = btrim(p_reason),
         removed_by = auth.uid(), profile_id = null
   where id = per.id;

  insert into public.audit_log (actor_id, action, table_name, row_id, old_data, note)
  values (auth.uid(), 'delete_parishioner', 'parishioners', per.id::text, to_jsonb(per) || jsonb_build_object('payments_kept', n_tx, 'pledges_moved', n_pl),
          btrim(p_reason));
  return jsonb_build_object('payments_kept', n_tx, 'pledges_moved', n_pl, 'status', 'removed');
end $$;
revoke execute on function public.delete_parishioner(uuid, text) from public, anon;
grant execute on function public.delete_parishioner(uuid, text) to authenticated;

-- bringing a removed member back clears the removal note (the audit log keeps it)
create or replace function public.parishioner_clear_removed()
returns trigger language plpgsql as $$
begin
  if old.membership_status = 'removed' and new.membership_status <> 'removed' then
    new.removed_on := null; new.removed_reason := null; new.removed_by := null;
  end if;
  return new;
end $$;
drop trigger if exists parishioner_clear_removed on public.parishioners;
create trigger parishioner_clear_removed before update of membership_status on public.parishioners
  for each row execute function public.parishioner_clear_removed();

-- ---------------------------------------------------------------------------
-- 2. SMS: who actually paid zaka (or not) in a year / month
-- ---------------------------------------------------------------------------
alter table public.sms_messages drop constraint if exists sms_messages_audience_check;
alter table public.sms_messages add constraint sms_messages_audience_check
  check (audience in ('all', 'zaka_payers', 'zaka_paid', 'zaka_unpaid', 'leaders', 'units'));
alter table public.sms_messages add column if not exists zaka_year int;
alter table public.sms_messages add column if not exists zaka_month int check (zaka_month between 1 and 12);

-- zaka paid by the person, or by their family in the family's name
create or replace function public.zaka_paid_in(p_person uuid, p_family uuid, p_year int, p_month int default null)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(sum(t.net_amount), 0) > 0
    from public.finance_transactions t
    join public.contribution_categories c on c.id = t.category_id and c.kind = 'zaka'
   where t.status = 'posted'
     and (t.parishioner_id = p_person or (t.parishioner_id is null and p_family is not null and t.family_id = p_family))
     and extract(year from coalesce(t.period_month, t.txn_date)) = p_year
     and (p_month is null or extract(month from coalesce(t.period_month, t.txn_date)) = p_month)
$$;
revoke execute on function public.zaka_paid_in(uuid, uuid, int, int) from public, anon, authenticated;

drop function if exists public.sms_audience(text, uuid[], boolean);
create or replace function public.sms_audience(p_audience text, p_units uuid[], p_zaka_only boolean,
                                               p_year int default null, p_month int default null)
returns table (phone text, parishioner_id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select distinct on (public.normalize_phone(p.phone)) public.normalize_phone(p.phone), p.id, p.full_name
    from public.parishioners p
   where p.membership_status = 'active'
     and public.normalize_phone(p.phone) is not null
     and (p_audience <> 'zaka_payers' or p.is_zaka_payer)
     and (not coalesce(p_zaka_only, false) or p.is_zaka_payer)
     and (p_audience <> 'zaka_paid'
          or public.zaka_paid_in(p.id, p.family_id, coalesce(p_year, extract(year from current_date)::int), p_month))
     and (p_audience <> 'zaka_unpaid'
          or (p.is_zaka_payer and not public.zaka_paid_in(p.id, p.family_id, coalesce(p_year, extract(year from current_date)::int), p_month)))
     and (p_audience <> 'leaders' or exists (select 1 from public.leadership_assignments la where la.parishioner_id = p.id and la.status = 'active'))
     and (p_audience <> 'units' or exists (select 1 from unnest(coalesce(p_units, '{}')) u where public.org_is_within(p.jumuiya_id, u)))
   order by public.normalize_phone(p.phone), p.is_zaka_payer desc, p.created_at
$$;
revoke execute on function public.sms_audience(text, uuid[], boolean, int, int) from public, anon, authenticated;

create or replace function public.sms_preview(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_units uuid[];
begin
  if not public.has_perm('comms.send') then raise exception 'Huna ruhusa ya kutuma SMS (permission denied)' using errcode = '42501'; end if;
  select coalesce(array_agg(x::uuid), '{}') into v_units from jsonb_array_elements_text(coalesce(p->'unit_ids', '[]'::jsonb)) x;
  return jsonb_build_object('recipients', (select count(*) from public.sms_audience(p->>'audience', v_units, coalesce((p->>'zaka_only')::boolean, false),
                                                                                    nullif(p->>'zaka_year', '')::int, nullif(p->>'zaka_month', '')::int)),
                            'without_phone', (select count(*) from public.parishioners where membership_status = 'active' and public.normalize_phone(phone) is null));
end $$;
revoke execute on function public.sms_preview(jsonb) from public, anon;
grant execute on function public.sms_preview(jsonb) to authenticated;

-- p: body, audience, unit_ids, zaka_only, zaka_year, zaka_month
create or replace function public.sms_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_units uuid[];
  v_year int := nullif(p->>'zaka_year', '')::int;
  v_month int := nullif(p->>'zaka_month', '')::int;
  v_id uuid;
  n int;
begin
  if not public.has_perm('comms.send') then raise exception 'Huna ruhusa ya kutuma SMS (permission denied)' using errcode = '42501'; end if;
  if coalesce(btrim(p->>'body'), '') = '' then raise exception 'Andika ujumbe' using errcode = 'P0001'; end if;
  select coalesce(array_agg(x::uuid), '{}') into v_units from jsonb_array_elements_text(coalesce(p->'unit_ids', '[]'::jsonb)) x;
  if p->>'audience' = 'units' and cardinality(v_units) = 0 then raise exception 'Chagua kigango au jumuiya' using errcode = 'P0001'; end if;
  if p->>'audience' in ('zaka_paid', 'zaka_unpaid') then v_year := coalesce(v_year, extract(year from current_date)::int);
  else v_year := null; v_month := null; end if;
  insert into public.sms_messages (parish_id, body, audience, unit_ids, zaka_only, zaka_year, zaka_month, created_by)
  values (public.default_parish_id(), btrim(p->>'body'), p->>'audience', v_units, coalesce((p->>'zaka_only')::boolean, false), v_year, v_month, auth.uid())
  returning id into v_id;
  insert into public.sms_recipients (message_id, phone, parishioner_id, full_name)
  select v_id, a.phone, a.parishioner_id, a.full_name
    from public.sms_audience(p->>'audience', v_units, coalesce((p->>'zaka_only')::boolean, false), v_year, v_month) a;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Hakuna muumini mwenye namba ya simu kwenye kundi ulilochagua' using errcode = 'P0001'; end if;
  update public.sms_messages set recipients = n where id = v_id;
  insert into public.audit_log (actor_id, action, table_name, row_id, note) values (auth.uid(), 'sms_create', 'sms_messages', v_id::text, n || ' namba');
  return jsonb_build_object('id', v_id, 'recipients', n);
end $$;
revoke execute on function public.sms_create(jsonb) from public, anon;
grant execute on function public.sms_create(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. a message stuck on "sending": the sender checks with the provider, then says what happened
-- ---------------------------------------------------------------------------
create or replace function public.sms_resolve(p_id uuid, p_sent boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('comms.send') then raise exception 'Huna ruhusa (permission denied)' using errcode = '42501'; end if;
  update public.sms_messages
     set status = case when p_sent then 'sent' else 'failed' end,
         sent_at = case when p_sent then coalesce(sent_at, now()) end,
         result = coalesce(result, '{}'::jsonb) || jsonb_build_object('resolved_by', auth.uid(), 'resolved_at', now(), 'manual', true,
                                                                      'note', nullif(btrim(coalesce(p_note, '')), ''))
   where id = p_id and status = 'sending';
  if not found then raise exception 'Ujumbe huu haujakwama kwenye "Inatumwa"' using errcode = 'P0001'; end if;
  insert into public.audit_log (actor_id, action, table_name, row_id, note)
  values (auth.uid(), case when p_sent then 'sms_resolved_sent' else 'sms_resolved_failed' end, 'sms_messages', p_id::text, nullif(btrim(coalesce(p_note, '')), ''));
  return jsonb_build_object('status', case when p_sent then 'sent' else 'failed' end);
end $$;
revoke execute on function public.sms_resolve(uuid, boolean, text) from public, anon;
grant execute on function public.sms_resolve(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. leaders report: one title, and titles that ended during the year
-- ---------------------------------------------------------------------------
drop function if exists public.leaders_contributions(int, uuid);
create or replace function public.leaders_contributions(p_year int, p_scope uuid default null,
                                                        p_position uuid default null, p_include_ended boolean default true)
returns table (parishioner_id uuid, full_name text, phone text, titles text, ended_titles text, levels text,
               jumuiya_id uuid, kigango_id uuid, family_id uuid, family_name text,
               zaka numeric, zaka_months int, personal numeric, family numeric,
               pledged numeric, outstanding numeric, total numeric)
language sql stable security invoker set search_path = public as $$
  with asg as (
    select la.parishioner_id, la.org_unit_id, la.ends_on, lp.title_sw, lp.level, (la.status = 'active') as is_current
      from public.leadership_assignments la
      join public.leadership_positions lp on lp.id = la.position_id
     where la.parishioner_id is not null
       and (la.status = 'active'
            or (p_include_ended and la.status = 'ended'
                and coalesce(la.ends_on, current_date) >= make_date(p_year, 1, 1)
                and coalesce(la.starts_on, la.created_at::date) <= make_date(p_year, 12, 31)))
       and (p_position is null or la.position_id = p_position)
  ),
  lead as (
    select p.id, p.full_name, p.phone, p.family_id, p.jumuiya_id,
           string_agg(distinct a.title_sw, ', ') filter (where a.is_current) as titles,
           string_agg(distinct a.title_sw || ' (hadi ' || coalesce(to_char(a.ends_on, 'DD/MM/YYYY'), '?') || ')', ', ') filter (where not a.is_current) as ended_titles,
           string_agg(distinct a.level, ',') as levels
      from asg a
      join public.parishioners p on p.id = a.parishioner_id
     where (p_scope is null or p.jumuiya_id = any (public.units_within(p_scope)) or a.org_unit_id = any (public.units_within(p_scope)))
     group by p.id
  ),
  tx as (
    select t.parishioner_id, t.family_id, t.net_amount, t.period_month, c.kind as cat_kind
      from public.finance_transactions t
      join public.contribution_categories c on c.id = t.category_id
      left join public.campaigns cp on cp.id = t.campaign_id
     where t.status = 'posted' and t.kind = 'income' and c.kind <> 'expense'
       and (case when c.kind = 'zaka' then extract(year from coalesce(t.period_month, t.txn_date))
                 else coalesce(cp.campaign_year, extract(year from t.txn_date)) end) = p_year
       and (t.parishioner_id in (select id from lead) or (t.parishioner_id is null and t.family_id in (select family_id from lead)))
  ),
  per as (
    select l.id,
           coalesce(sum(tx.net_amount) filter (where tx.parishioner_id = l.id and tx.cat_kind = 'zaka'), 0) as zaka,
           count(distinct date_trunc('month', tx.period_month)) filter (where tx.parishioner_id = l.id and tx.cat_kind = 'zaka' and tx.net_amount > 0)::int as zaka_months,
           coalesce(sum(tx.net_amount) filter (where tx.parishioner_id = l.id and tx.cat_kind <> 'zaka'), 0) as personal,
           coalesce(sum(tx.net_amount) filter (where tx.parishioner_id is null and tx.family_id = l.family_id and tx.cat_kind <> 'zaka'), 0) as family
      from lead l left join tx on tx.parishioner_id = l.id or (tx.parishioner_id is null and tx.family_id = l.family_id)
     group by l.id
  ),
  pl as (
    select l.id, coalesce(sum(b.pledged), 0) as pledged, coalesce(sum(b.outstanding), 0) as outstanding
      from lead l
      join public.v_pledge_balances b on b.status = 'active' and b.campaign_year = p_year
       and (b.parishioner_id = l.id or (b.family_id = l.family_id and b.parishioner_id is null))
     group by l.id
  )
  select l.id, l.full_name, l.phone, l.titles, l.ended_titles, l.levels,
         l.jumuiya_id, public.org_ancestor_of_type(l.jumuiya_id, 'kigango'), l.family_id, f.family_name,
         per.zaka, per.zaka_months, per.personal, per.family,
         coalesce(pl.pledged, 0), coalesce(pl.outstanding, 0),
         per.zaka + per.personal + per.family
    from lead l
    join per on per.id = l.id
    left join pl on pl.id = l.id
    left join public.families f on f.id = l.family_id
   where (select public.has_perm_anywhere('finance.read'))
   order by l.full_name
$$;
revoke execute on function public.leaders_contributions(int, uuid, uuid, boolean) from public, anon;
grant execute on function public.leaders_contributions(int, uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. ledger_drill (migration 24) with two more filters, so every total of the
--    leaders report opens exactly the payments behind it:
--      gyear        zaka by the month it is for, other giving by campaign year (else payment year)
--      family_only  payments in the family's name only (no member named)
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
           nullif(p->>'gyear', '')::int as gyr, coalesce((p->>'family_only')::boolean, false) as fam_only,
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
       and (not f.fam_only or l.parishioner_id is null)
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
       and (f.gyr is null or (case when l.category_kind = 'zaka' then extract(year from coalesce(l.period_month, l.txn_date))
                                   else coalesce(l.campaign_year, extract(year from l.txn_date)) end) = f.gyr)
       and (f.pm is null or l.period_month = f.pm)
       and (f.dfrom is null or l.txn_date >= f.dfrom)
       and (f.dto is null or l.txn_date <= f.dto)
     order by l.txn_date desc, l.txn_no desc
     limit 3000
  )
  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.txn_date desc, rows.txn_no desc), '[]'::jsonb) from rows
$$;
grant execute on function public.ledger_drill(jsonb) to authenticated;

notify pgrst, 'reload schema';
