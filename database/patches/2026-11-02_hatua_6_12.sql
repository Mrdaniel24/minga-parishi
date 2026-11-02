-- ============================================================================
-- Patch 2026-11-02 — run ONCE in Supabase → SQL Editor on the live database,
-- AFTER database/patches/2026-10-31_zaka_miamala_vyeo.sql. Safe to run again.
-- Contains migrations 26–31 (maombi 6–12 ya Thomas):
--   26  Muumini / familia akihama jumuiya anahama na michango yake; akifutwa, miamala inabaki
--   27  Mwaka mpya unajifungua wenyewe; malipo ya mwaka uliopita yanaendelea kupokelewa
--   28  Ripoti ya michango ya viongozi (inaonwa na viongozi na ofisi tu)
--   29  Kuingia kwa namba ya simu + nenosiri; msimamizi anaweka nenosiri jipya
--   30  Mahudhurio ya waumini kwenye jumuiya (yanajazwa na kiongozi wa jumuiya)
--   31  Matangazo kwa watumiaji wote / baadhi, na SMS kwa wingi
-- ============================================================================

-- >>>>>>>>>>>>>>>>>>>> 20261015_26_member_move_delete.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- Minga Parish Management System — migration 26: moving and removing members
--   * A member (or a whole family) who moves to another jumuiya takes their
--     record with them, and — when asked — their money too: the jumuiya /
--     kigango a past payment is credited to follows them, so their giving
--     shows under the new jumuiya. Amounts, dates and receipts never change.
--   * A member who is removed from the register leaves their payments behind:
--     the payments stay (with the payer's name and family), only the link to
--     the deleted person is cleared.
--   Posted ledger rows stay immutable: only these functions may change the
--   attribution columns, and they log what they did in audit_log.
-- ============================================================================

-- posted rows: the attribution columns may change only inside the functions below
create or replace function public.protect_posted_transactions()
returns trigger language plpgsql as $$
declare
  v_keep text[] := array['reversed_by_id', 'reversal_reason', 'net_amount'];
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'Muamala uliothibitishwa hauwezi kufutwa — tumia reversal' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status = 'posted' then
    -- set by move_parishioner / move_family / delete_parishioner (security definer)
    if coalesce(current_setting('minga.reattribute', true), '') = 'on' then
      v_keep := v_keep || array['parishioner_id', 'family_id', 'jumuiya_id', 'kigango_id', 'org_unit_id', 'payer_name'];
    end if;
    -- only the reversal link may be set on a posted row
    -- (net_amount is generated: it is still NULL in NEW inside a BEFORE trigger)
    if (to_jsonb(new) - v_keep) is distinct from (to_jsonb(old) - v_keep) then
      raise exception 'Muamala uliothibitishwa hauwezi kubadilishwa — tumia reversal au adjustment' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- payments / pledges of a set of rows follow the new jumuiya.
-- Only rows credited to the old jumuiya itself move (money given to a kigango
-- or a group directly stays there).
create or replace function public.reattribute_money(p_parishioner uuid, p_family uuid, p_from uuid, p_to uuid, p_new_family uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_k uuid := public.org_ancestor_of_type(p_to, 'kigango');
  n int;
begin
  perform set_config('minga.reattribute', 'on', true);
  update public.finance_transactions t
     set jumuiya_id = p_to,
         kigango_id = v_k,
         org_unit_id = case when t.org_unit_id is not distinct from p_from then p_to else t.org_unit_id end,
         family_id = case when p_parishioner is not null and p_new_family is not null then p_new_family else t.family_id end
   where (case when p_parishioner is not null then t.parishioner_id = p_parishioner
               else t.family_id = p_family end)
     and t.jumuiya_id is not distinct from p_from
     and (t.org_unit_id is null or t.org_unit_id = p_from);
  get diagnostics n = row_count;
  perform set_config('minga.reattribute', 'off', true);
  update public.pledges pl
     set jumuiya_id = p_to, kigango_id = v_k
   where (case when p_parishioner is not null then pl.parishioner_id = p_parishioner else pl.family_id = p_family end)
     and pl.jumuiya_id is not distinct from p_from;
  return n;
end $$;
revoke execute on function public.reattribute_money(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- move one member to another family (and so, maybe, another jumuiya)
--   p_family: the family they join; p_new_family_name: or start a new family
--   in p_jumuiya with this name. p_move_money: their past payments follow.
create or replace function public.move_parishioner(p_parishioner uuid, p_family uuid, p_jumuiya uuid,
                                                   p_new_family_name text default null, p_move_money boolean default true,
                                                   p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  per public.parishioners;
  v_to_fam uuid := p_family;
  v_to_jum uuid := p_jumuiya;
  v_from_jum uuid;
  n int := 0;
begin
  select * into per from public.parishioners where id = p_parishioner;
  if per.id is null then raise exception 'Muumini hayupo' using errcode = 'P0001'; end if;
  v_from_jum := coalesce(per.jumuiya_id, (select jumuiya_id from public.families where id = per.family_id));
  if not public.has_perm('registry.write', v_from_jum) then
    raise exception 'Huna ruhusa ya kumhamisha muumini huyu (permission denied)' using errcode = '42501';
  end if;
  if v_to_fam is not null then
    select jumuiya_id into v_to_jum from public.families where id = v_to_fam;
    if not found then raise exception 'Familia hiyo haipo' using errcode = 'P0001'; end if;
  end if;
  if v_to_jum is null or not exists (select 1 from public.org_units where id = v_to_jum and unit_type = 'jumuiya') then
    raise exception 'Chagua jumuiya anayohamia' using errcode = 'P0001';
  end if;
  if not public.has_perm('registry.write', v_to_jum) then
    raise exception 'Huna ruhusa kwenye jumuiya anayohamia (permission denied)' using errcode = '42501';
  end if;
  if v_to_fam is null then
    if coalesce(btrim(p_new_family_name), '') = '' then
      raise exception 'Chagua familia au andika jina la familia mpya' using errcode = 'P0001';
    end if;
    insert into public.families (parish_id, family_name, jumuiya_id, phone)
    values (per.parish_id, btrim(p_new_family_name), v_to_jum, per.phone) returning id into v_to_fam;
    update public.families set head_parishioner_id = per.id where id = v_to_fam;
  end if;
  if v_to_fam is not distinct from per.family_id then
    raise exception 'Muumini yuko tayari kwenye familia hiyo' using errcode = 'P0001';
  end if;

  -- the person leaves their old family: it no longer has them as head
  update public.families set head_parishioner_id = null where id = per.family_id and head_parishioner_id = per.id;
  update public.parishioners set family_id = v_to_fam, jumuiya_id = v_to_jum,
         membership_status = case when membership_status = 'moved' then 'active' else membership_status end
   where id = per.id;
  update public.membership_history set reason = nullif(btrim(p_reason), '')
   where id = (select max(id) from public.membership_history where parishioner_id = per.id);
  -- titles held in the old jumuiya / kigango end with the move
  if v_from_jum is distinct from v_to_jum then
    update public.leadership_assignments set status = 'ended', ends_on = greatest(coalesce(starts_on, current_date), current_date)
     where parishioner_id = per.id and status = 'active' and org_unit_id in (v_from_jum, public.org_ancestor_of_type(v_from_jum, 'kigango'))
       and org_unit_id is distinct from public.org_ancestor_of_type(v_to_jum, 'kigango');
  end if;
  if p_move_money then
    n := public.reattribute_money(per.id, null, v_from_jum, v_to_jum, v_to_fam);
  end if;
  insert into public.audit_log (actor_id, action, table_name, row_id, new_data, note)
  values (auth.uid(), 'move_parishioner', 'parishioners', per.id::text,
          jsonb_build_object('from_jumuiya', v_from_jum, 'to_jumuiya', v_to_jum, 'from_family', per.family_id, 'to_family', v_to_fam,
                             'payments_moved', n, 'move_money', p_move_money), nullif(btrim(p_reason), ''));
  return jsonb_build_object('family_id', v_to_fam, 'jumuiya_id', v_to_jum, 'payments_moved', n);
end $$;
revoke execute on function public.move_parishioner(uuid, uuid, uuid, text, boolean, text) from public, anon;
grant execute on function public.move_parishioner(uuid, uuid, uuid, text, boolean, text) to authenticated;

-- move a whole family (and its members) to another jumuiya
create or replace function public.move_family(p_family uuid, p_jumuiya uuid, p_move_money boolean default true, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  fam public.families;
  n int := 0;
begin
  select * into fam from public.families where id = p_family;
  if fam.id is null then raise exception 'Familia haipo' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.org_units where id = p_jumuiya and unit_type = 'jumuiya') then
    raise exception 'Chagua jumuiya inayohamia' using errcode = 'P0001';
  end if;
  if fam.jumuiya_id is not distinct from p_jumuiya then
    raise exception 'Familia iko tayari kwenye jumuiya hiyo' using errcode = 'P0001';
  end if;
  if not public.has_perm('registry.write', fam.jumuiya_id) or not public.has_perm('registry.write', p_jumuiya) then
    raise exception 'Huna ruhusa ya kuhamisha familia hii (permission denied)' using errcode = '42501';
  end if;
  -- the families trigger moves its members and writes membership_history
  update public.families set jumuiya_id = p_jumuiya,
         status = case when status = 'moved' then 'active' else status end
   where id = fam.id;
  update public.membership_history set reason = nullif(btrim(p_reason), '')
   where id = (select max(id) from public.membership_history where family_id = fam.id);
  if p_move_money then
    n := public.reattribute_money(null, fam.id, fam.jumuiya_id, p_jumuiya, null);
  end if;
  insert into public.audit_log (actor_id, action, table_name, row_id, new_data, note)
  values (auth.uid(), 'move_family', 'families', fam.id::text,
          jsonb_build_object('from_jumuiya', fam.jumuiya_id, 'to_jumuiya', p_jumuiya, 'payments_moved', n, 'move_money', p_move_money),
          nullif(btrim(p_reason), ''));
  return jsonb_build_object('jumuiya_id', p_jumuiya, 'payments_moved', n);
end $$;
revoke execute on function public.move_family(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.move_family(uuid, uuid, boolean, text) to authenticated;

-- remove a member from the register. Their payments stay: they keep the
-- payer's name, family and jumuiya; only the link to the person is cleared.
-- Their pledges pass to their family (or jumuiya) so nothing paid is lost.
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
          nullif(btrim(p_reason), ''));
  delete from public.parishioners where id = per.id;
  return jsonb_build_object('payments_kept', n_tx, 'pledges_moved', n_pl);
end $$;
revoke execute on function public.delete_parishioner(uuid, text) from public, anon;
grant execute on function public.delete_parishioner(uuid, text) to authenticated;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>> 20261015_27_year_rollover.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- Minga Parish Management System — migration 27: the new year
--   When a new year starts, nobody has to remember to open it first: the first
--   payment dated in the new year opens its financial year (and its monthly
--   periods) by itself. Reports of the new year therefore start empty, while
--   payments for last year (e.g. December zaka paid in January, or last
--   year's Mavuno pledge) are still accepted: they are dated today and keep
--   the month / campaign they are for.
--   Only dates near today open a year (a typing mistake such as 2062 does not).
-- ============================================================================

create or replace function public.ensure_financial_year(p_parish uuid, p_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := public.fin_year_for(p_parish, p_date);
  v_m int;
  v_start date;
begin
  if v_id is not null or p_parish is null or p_date is null then return v_id; end if;
  if p_date < current_date - interval '2 years' or p_date > current_date + interval '1 year' then return null; end if;
  select coalesce(fy_start_month, 1) into v_m from public.parishes where id = p_parish;
  v_start := make_date(extract(year from p_date)::int, v_m, 1);
  if v_start > p_date then v_start := (v_start - interval '1 year')::date; end if;
  -- a year that overlaps one already defined is not created automatically
  if exists (select 1 from public.financial_years where parish_id = p_parish
              and starts_on <= (v_start + interval '1 year - 1 day')::date and ends_on >= v_start) then
    return null;
  end if;
  insert into public.financial_years (parish_id, label, starts_on, ends_on)
  values (p_parish,
          case when v_m = 1 then extract(year from v_start)::text
               else extract(year from v_start)::text || '/' || extract(year from v_start + interval '1 year')::text end,
          v_start, (v_start + interval '1 year - 1 day')::date)
  on conflict (parish_id, label) do nothing
  returning id into v_id;
  if v_id is null then return public.fin_year_for(p_parish, p_date); end if;
  perform public.ensure_periods(v_id);
  insert into public.audit_log (actor_id, action, table_name, row_id, note)
  values (auth.uid(), 'open_financial_year', 'financial_years', v_id::text, 'Mwaka umefunguliwa wenyewe na malipo ya kwanza');
  return v_id;
end $$;
revoke execute on function public.ensure_financial_year(uuid, date) from public, anon, authenticated;

-- every posting function checks the date through this: it now opens the year first
create or replace function public.assert_period_open(p_parish uuid, p_date date)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare fy public.financial_years;
begin
  perform public.ensure_financial_year(p_parish, p_date);
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
revoke execute on function public.assert_period_open(uuid, date) from public, anon;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>> 20261015_28_leader_report.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- Minga Parish Management System — migration 28: contributions of leaders
--   A report for the parish leadership only: every member who holds a title
--   (Katibu, Mwenyekiti, Mhazini… — migration 25) with what they gave in the
--   year: zaka (and in how many months), other contributions they gave
--   themselves, contributions given in their family's name, and what is still
--   owed on this year's pledges.
--   Runs with the caller's rights (RLS): a jumuiya / kigango leader sees the
--   leaders of their own community only; members (no finance.read) see nothing.
-- ============================================================================

create or replace function public.leaders_contributions(p_year int, p_scope uuid default null)
returns table (parishioner_id uuid, full_name text, phone text, titles text, levels text,
               jumuiya_id uuid, kigango_id uuid, family_id uuid, family_name text,
               zaka numeric, zaka_months int, personal numeric, family numeric,
               pledged numeric, outstanding numeric, total numeric)
language sql stable security invoker set search_path = public as $$
  with lead as (
    select p.id, p.full_name, p.phone, p.family_id, p.jumuiya_id,
           string_agg(distinct lp.title_sw, ', ') as titles,
           string_agg(distinct lp.level, ',') as levels
      from public.leadership_assignments la
      join public.leadership_positions lp on lp.id = la.position_id
      join public.parishioners p on p.id = la.parishioner_id
     where la.status = 'active'
       and (p_scope is null or p.jumuiya_id = any (public.units_within(p_scope)) or la.org_unit_id = any (public.units_within(p_scope)))
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
  select l.id, l.full_name, l.phone, l.titles, l.levels,
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
revoke execute on function public.leaders_contributions(int, uuid) from public, anon;
grant execute on function public.leaders_contributions(int, uuid) to authenticated;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>> 20261015_29_user_admin.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- Minga Parish Management System — migration 29: accounts by phone number
--   * People sign in with their PHONE NUMBER and a password (no e-mail
--     needed). Supabase signs in by e-mail, so an account made for a phone
--     number gets a private sign-in address made from the number:
--       0712 345 678  →  255712345678@simu.parokia.local
--     The login page turns the number typed into the same address, so nobody
--     ever sees it. No SMS is sent, so no SMS provider is needed for this.
--   * The administrator creates accounts here (name, phone, password, role),
--     sets a new password for anyone who forgot theirs, and can switch an
--     existing e-mail account to sign in by phone.
--   Only users.manage (Msimamizi wa Parokia) or the system administrator.
--   Nobody but the system administrator may touch a system administrator's
--   account.
-- ============================================================================

-- '0712 345 678', '+255 712…', '712345678' → '255712345678' (null when not a phone number)
create or replace function public.normalize_phone(p text)
returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if d ~ '^0[67]\d{8}$' then d := '255' || substr(d, 2);
  elsif d ~ '^[67]\d{8}$' then d := '255' || d;
  end if;
  if d !~ '^\d{10,15}$' then return null; end if;
  return d;
end $$;

create or replace function public.phone_login_email(p_phone text)
returns text language sql immutable as $$
  select public.normalize_phone(p_phone) || '@simu.parokia.local'
$$;

-- who may manage this account
create or replace function public.assert_can_manage_user(p_user uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_platform_admin() or public.has_perm('users.manage', null)) then
    raise exception 'Huna ruhusa ya kusimamia akaunti (permission denied)' using errcode = '42501';
  end if;
  if p_user is not null and not public.is_platform_admin()
     and exists (select 1 from public.profiles where id = p_user and role = 'super_admin') then
    raise exception 'Akaunti ya Msimamizi wa Mfumo inabadilishwa na yeye mwenyewe tu' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.assert_can_manage_user(uuid) from public, anon, authenticated;

create or replace function public.check_new_password(p_password text)
returns void language plpgsql immutable as $$
begin
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Nenosiri liwe na herufi/namba 6 au zaidi' using errcode = 'P0001';
  end if;
end $$;

-- create an account. p: full_name, phone, email (optional: then signs in by
-- e-mail instead), password, role_code, org_unit_id, parishioner_id (all optional)
create or replace function public.admin_create_user(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_name text := nullif(btrim(p->>'full_name'), '');
  v_phone text := public.normalize_phone(p->>'phone');
  v_email text := lower(nullif(btrim(p->>'email'), ''));
  v_login text;
  v_uid uuid := gen_random_uuid();
  v_person uuid := nullif(p->>'parishioner_id', '')::uuid;
begin
  perform public.assert_can_manage_user(null);
  if v_name is null then raise exception 'Andika jina la mtumiaji' using errcode = 'P0001'; end if;
  if nullif(btrim(p->>'phone'), '') is not null and v_phone is null then
    raise exception 'Namba ya simu si sahihi (mf. 0712345678)' using errcode = 'P0001';
  end if;
  if v_phone is null and v_email is null then
    raise exception 'Andika namba ya simu ya mtumiaji' using errcode = 'P0001';
  end if;
  perform public.check_new_password(p->>'password');
  v_login := coalesce(public.phone_login_email(v_phone), v_email);
  if exists (select 1 from auth.users where lower(email) = v_login) then
    raise exception 'Akaunti ya % ipo tayari', coalesce(v_phone, v_email) using errcode = 'P0001';
  end if;
  if v_phone is not null and exists (select 1 from public.profiles where phone = v_phone) then
    raise exception 'Namba % tayari inatumiwa na akaunti nyingine', v_phone using errcode = 'P0001';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_login,
          extensions.crypt(p->>'password', extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('full_name', v_name, 'phone', v_phone), now(), now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_uid::text, v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_login, 'email_verified', true),
          'email', now(), now(), now());
  -- the profile row comes from the on_auth_user_created trigger
  update public.profiles set full_name = v_name, phone = v_phone, email = coalesce(v_email, v_login) where id = v_uid;

  if nullif(p->>'role_code', '') is not null then
    insert into public.parish_user_roles (user_id, parish_id, role_code, org_unit_id)
    values (v_uid, public.default_parish_id(), p->>'role_code', nullif(p->>'org_unit_id', '')::uuid);
  end if;
  if v_person is not null then
    perform set_config('minga.approved_link', 'on', true);
    update public.parishioners set profile_id = v_uid where id = v_person and profile_id is null;
  end if;
  insert into public.audit_log (actor_id, action, table_name, row_id, new_data)
  values (auth.uid(), 'create_user', 'profiles', v_uid::text,
          jsonb_build_object('full_name', v_name, 'phone', v_phone, 'email', v_email, 'role', p->>'role_code'));
  return jsonb_build_object('id', v_uid, 'login', coalesce(v_phone, v_email));
end $$;
revoke execute on function public.admin_create_user(jsonb) from public, anon;
grant execute on function public.admin_create_user(jsonb) to authenticated;

-- a forgotten password: the administrator sets a new one and tells the person
create or replace function public.admin_set_password(p_user uuid, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.assert_can_manage_user(p_user);
  perform public.check_new_password(p_password);
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
   where id = p_user;
  if not found then raise exception 'Akaunti haipo' using errcode = 'P0001'; end if;
  insert into public.audit_log (actor_id, action, table_name, row_id) values (auth.uid(), 'reset_password', 'profiles', p_user::text);
  return jsonb_build_object('status', 'ok');
end $$;
revoke execute on function public.admin_set_password(uuid, text) from public, anon;
grant execute on function public.admin_set_password(uuid, text) to authenticated;

-- sign in by this phone number from now on (the e-mail stays on the profile as contact)
create or replace function public.admin_set_login_phone(p_user uuid, p_phone text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_login text := public.phone_login_email(p_phone);
begin
  perform public.assert_can_manage_user(p_user);
  if v_phone is null then raise exception 'Namba ya simu si sahihi (mf. 0712345678)' using errcode = 'P0001'; end if;
  if exists (select 1 from auth.users where lower(email) = v_login and id <> p_user)
     or exists (select 1 from public.profiles where phone = v_phone and id <> p_user) then
    raise exception 'Namba % tayari inatumiwa na akaunti nyingine', v_phone using errcode = 'P0001';
  end if;
  update auth.users set email = v_login, updated_at = now() where id = p_user;
  if not found then raise exception 'Akaunti haipo' using errcode = 'P0001'; end if;
  update auth.identities set identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email', v_login)
   where user_id = p_user and provider = 'email';
  update public.profiles set phone = v_phone where id = p_user;
  insert into public.audit_log (actor_id, action, table_name, row_id, new_data)
  values (auth.uid(), 'set_login_phone', 'profiles', p_user::text, jsonb_build_object('phone', v_phone));
  return jsonb_build_object('status', 'ok', 'phone', v_phone);
end $$;
revoke execute on function public.admin_set_login_phone(uuid, text) from public, anon;
grant execute on function public.admin_set_login_phone(uuid, text) to authenticated;

-- role / status of a profile: the system administrator, or a function that has checked rights itself
create or replace function public.protect_profile_role_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and coalesce(current_setting('minga.user_admin', true), '') <> 'on'
     and not exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin' and status = 'active')
     and (new.role is distinct from old.role or new.status is distinct from old.status or new.id is distinct from old.id) then
    raise exception 'Huwezi kubadilisha nafasi au hali ya akaunti' using errcode = '42501';
  end if;
  if coalesce(current_setting('minga.user_admin', true), '') = 'on' and new.role is distinct from old.role then
    raise exception 'Huwezi kubadilisha nafasi ya akaunti' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- suspend / re-activate an account (a suspended account cannot sign in to the system)
create or replace function public.admin_set_user_status(p_user uuid, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_can_manage_user(p_user);
  if p_user = auth.uid() then raise exception 'Huwezi kusimamisha akaunti yako mwenyewe' using errcode = 'P0001'; end if;
  perform set_config('minga.user_admin', 'on', true);   -- protect_profile_role_changes: rights were checked above
  update public.profiles set status = case when p_active then 'active' else 'inactive' end where id = p_user;
  if not found then raise exception 'Akaunti haipo' using errcode = 'P0001'; end if;
  perform set_config('minga.user_admin', 'off', true);
  insert into public.audit_log (actor_id, action, table_name, row_id, note)
  values (auth.uid(), case when p_active then 'activate_user' else 'suspend_user' end, 'profiles', p_user::text, null);
  return jsonb_build_object('status', case when p_active then 'active' else 'inactive' end);
end $$;
revoke execute on function public.admin_set_user_status(uuid, boolean) from public, anon;
grant execute on function public.admin_set_user_status(uuid, boolean) to authenticated;

-- find an account by phone number or e-mail (for giving a role / linking)
create or replace function public.find_user(p_login text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.profiles
   where (public.is_platform_admin() or public.has_perm('users.manage', null))
     and (lower(email) = lower(btrim(p_login))
          or (public.normalize_phone(p_login) is not null and phone = public.normalize_phone(p_login)))
   order by created_at limit 1
$$;
revoke execute on function public.find_user(text) from public, anon;
grant execute on function public.find_user(text) to authenticated;

create index if not exists profiles_phone_idx on public.profiles (phone);

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>> 20261015_30_attendance.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- Minga Parish Management System — migration 30: attendance in the jumuiya
--   The jumuiya leader records who came to each gathering (sala ya jumuiya,
--   mkutano…): one session per date, and for every member present / absent /
--   excused (ruhusa). Leaders and parish staff see each member's attendance
--   rate for the year.
--   Recording needs attendance.record in that jumuiya (jumuiya and kigango
--   leaders, parish administrator, karani); reading needs registry.read there.
-- ============================================================================

insert into public.role_permissions (role_code, permission)
select r, 'attendance.record' from unnest(array['parish_admin', 'kigango_leader', 'jumuiya_leader', 'data_entry']) r
on conflict do nothing;

create table if not exists public.attendance_sessions (
  id           uuid primary key default gen_random_uuid(),
  parish_id    uuid not null references public.parishes(id),
  org_unit_id  uuid not null references public.org_units(id),
  held_on      date not null,
  title        text not null default 'Sala ya jumuiya',
  notes        text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_unit_id, held_on, title)
);
create index if not exists attendance_sessions_unit_idx on public.attendance_sessions (org_unit_id, held_on desc);

create table if not exists public.attendance_marks (
  session_id      uuid not null references public.attendance_sessions(id) on delete cascade,
  parishioner_id  uuid not null references public.parishioners(id) on delete cascade,
  status          text not null check (status in ('present', 'absent', 'excused')),
  primary key (session_id, parishioner_id)
);
create index if not exists attendance_marks_person_idx on public.attendance_marks (parishioner_id);

alter table public.attendance_sessions enable row level security;
alter table public.attendance_marks enable row level security;
grant select on public.attendance_sessions, public.attendance_marks to authenticated;

drop policy if exists attendance_sessions_read on public.attendance_sessions;
create policy attendance_sessions_read on public.attendance_sessions for select to authenticated
  using ((select public.has_perm('registry.read')) or public.has_perm('registry.read', org_unit_id) or public.has_perm('attendance.record', org_unit_id));
drop policy if exists attendance_marks_read on public.attendance_marks;
create policy attendance_marks_read on public.attendance_marks for select to authenticated
  using (exists (select 1 from public.attendance_sessions s where s.id = session_id)
         or parishioner_id = (select public.my_parishioner_id()));
-- writes only through save_attendance / delete_attendance

-- p: id (to edit), org_unit_id, held_on, title, notes, marks: [{parishioner_id, status}]
create or replace function public.save_attendance(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_unit uuid := nullif(p->>'org_unit_id', '')::uuid;
  v_date date := coalesce(nullif(p->>'held_on', '')::date, current_date);
  v_title text := coalesce(nullif(btrim(p->>'title'), ''), 'Sala ya jumuiya');
  m jsonb;
  n int := 0;
begin
  if v_id is not null then
    select org_unit_id into v_unit from public.attendance_sessions where id = v_id;
    if not found then raise exception 'Mahudhurio hayo hayapo' using errcode = 'P0001'; end if;
  end if;
  if v_unit is null or not exists (select 1 from public.org_units where id = v_unit and unit_type = 'jumuiya') then
    raise exception 'Chagua jumuiya' using errcode = 'P0001';
  end if;
  if not public.has_perm('attendance.record', v_unit) then
    raise exception 'Ni kiongozi wa jumuiya hii anayeweza kujaza mahudhurio (permission denied)' using errcode = '42501';
  end if;
  if v_date > current_date then raise exception 'Tarehe ya mahudhurio haiwezi kuwa ya baadaye' using errcode = 'P0001'; end if;

  if v_id is null then
    insert into public.attendance_sessions (parish_id, org_unit_id, held_on, title, notes, created_by)
    values (public.default_parish_id(), v_unit, v_date, v_title, nullif(btrim(p->>'notes'), ''), auth.uid())
    on conflict (org_unit_id, held_on, title) do update set notes = excluded.notes, updated_at = now()
    returning id into v_id;
  else
    update public.attendance_sessions set held_on = v_date, title = v_title, notes = nullif(btrim(p->>'notes'), ''), updated_at = now()
     where id = v_id;
  end if;

  delete from public.attendance_marks where session_id = v_id;
  for m in select * from jsonb_array_elements(coalesce(p->'marks', '[]'::jsonb)) loop
    if not exists (select 1 from public.parishioners where id = (m->>'parishioner_id')::uuid and jumuiya_id = v_unit) then
      raise exception 'Muumini si wa jumuiya hii' using errcode = 'P0001';
    end if;
    insert into public.attendance_marks (session_id, parishioner_id, status)
    values (v_id, (m->>'parishioner_id')::uuid, coalesce(nullif(m->>'status', ''), 'present'))
    on conflict (session_id, parishioner_id) do update set status = excluded.status;
    n := n + 1;
  end loop;
  return jsonb_build_object('id', v_id, 'marks', n);
end $$;
revoke execute on function public.save_attendance(jsonb) from public, anon;
grant execute on function public.save_attendance(jsonb) to authenticated;

create or replace function public.delete_attendance(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_unit uuid;
begin
  select org_unit_id into v_unit from public.attendance_sessions where id = p_id;
  if v_unit is null then raise exception 'Mahudhurio hayo hayapo' using errcode = 'P0001'; end if;
  if not public.has_perm('attendance.record', v_unit) then
    raise exception 'Huna ruhusa (permission denied)' using errcode = '42501';
  end if;
  delete from public.attendance_sessions where id = p_id;
  return jsonb_build_object('status', 'deleted');
end $$;
revoke execute on function public.delete_attendance(uuid) from public, anon;
grant execute on function public.delete_attendance(uuid) to authenticated;

-- each member of a jumuiya with their attendance in a year (caller's rights)
create or replace function public.attendance_summary(p_unit uuid, p_year int)
returns table (parishioner_id uuid, full_name text, family_id uuid, sessions int, present int, excused int, absent int, rate numeric)
language sql stable security invoker set search_path = public as $$
  with s as (
    select id from public.attendance_sessions
     where org_unit_id = p_unit and extract(year from held_on) = p_year
  )
  select p.id, p.full_name, p.family_id,
         (select count(*) from s)::int,
         count(*) filter (where m.status = 'present')::int,
         count(*) filter (where m.status = 'excused')::int,
         ((select count(*) from s) - count(*) filter (where m.status in ('present', 'excused')))::int,
         case when (select count(*) from s) = 0 then null
              else round(100.0 * count(*) filter (where m.status = 'present') / (select count(*) from s), 0) end
    from public.parishioners p
    left join public.attendance_marks m on m.parishioner_id = p.id and m.session_id in (select id from s)
   where p.jumuiya_id = p_unit and p.membership_status = 'active'
   group by p.id
   order by p.full_name
$$;
revoke execute on function public.attendance_summary(uuid, int) from public, anon;
grant execute on function public.attendance_summary(uuid, int) to authenticated;

notify pgrst, 'reload schema';

-- >>>>>>>>>>>>>>>>>>>> 20261015_31_announcements_sms.sql >>>>>>>>>>>>>>>>>>>>
-- ============================================================================
-- Minga Parish Management System — migration 31: announcements and bulk SMS
--   * Matangazo: a notice shown on the users' first page, to everyone or to
--     some of them (staff, leaders, members, or the people of chosen vigango /
--     jumuiya), from a start date to an end date.
--   * SMS kwa wingi: a message to the phone numbers in the register — every
--     member with a phone, zaka payers only, leaders only, or the people of
--     chosen vigango / jumuiya. The list of numbers is fixed when the message
--     is created (so it can be checked and downloaded). Sending goes through
--     the SMS provider configured on the server (api/sms.js); until one is
--     configured the list can be downloaded and sent from a phone.
--   Needs comms.send (Msimamizi wa Parokia, Paroko).
-- ============================================================================

insert into public.role_permissions (role_code, permission)
select r, 'comms.send' from unnest(array['parish_admin', 'parish_priest']) r
on conflict do nothing;

create table if not exists public.parish_announcements (
  id          uuid primary key default gen_random_uuid(),
  parish_id   uuid not null references public.parishes(id),
  title       text not null,
  body        text not null,
  audience    text not null default 'all' check (audience in ('all', 'staff', 'leaders', 'members', 'units')),
  unit_ids    uuid[] not null default '{}',
  starts_on   date not null default current_date,
  ends_on     date,
  is_active   boolean not null default true,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  check (audience <> 'units' or cardinality(unit_ids) > 0)
);
alter table public.parish_announcements enable row level security;
grant select, insert, update, delete on public.parish_announcements to authenticated;
drop policy if exists parish_announcements_manage on public.parish_announcements;
create policy parish_announcements_manage on public.parish_announcements for all to authenticated
  using ((select public.has_perm('comms.send'))) with check ((select public.has_perm('comms.send')));
drop trigger if exists parish_announcements_audit on public.parish_announcements;
create trigger parish_announcements_audit after insert or update or delete on public.parish_announcements for each row execute function public.audit_row();

-- the notices the signed-in user should see today
create or replace function public.my_announcements()
returns setof public.parish_announcements language sql stable security definer set search_path = public as $$
  with me as (
    select public.is_platform_admin() as admin,
           exists (select 1 from public.parish_user_roles ur join public.role_permissions rp on rp.role_code = ur.role_code
                    where ur.user_id = auth.uid()) as staff,
           exists (select 1 from public.parish_user_roles ur where ur.user_id = auth.uid() and ur.role_code in ('kigango_leader', 'jumuiya_leader'))
             or exists (select 1 from public.leadership_assignments la where la.status = 'active' and la.parishioner_id = public.my_parishioner_id()) as leader,
           public.my_parishioner_id() as person,
           array(select ur.org_unit_id from public.parish_user_roles ur where ur.user_id = auth.uid() and ur.org_unit_id is not null)
             || array(select p.jumuiya_id from public.parishioners p where p.profile_id = auth.uid() and p.jumuiya_id is not null) as units
  )
  select a.* from public.parish_announcements a, me
   where a.is_active and a.starts_on <= current_date and (a.ends_on is null or a.ends_on >= current_date)
     and (me.admin or a.audience = 'all'
          or (a.audience = 'staff' and me.staff)
          or (a.audience = 'leaders' and me.leader)
          or (a.audience = 'members' and me.person is not null)
          or (a.audience = 'units' and exists (select 1 from unnest(me.units) u, unnest(a.unit_ids) t where public.org_is_within(u, t) or public.org_is_within(t, u))))
   order by a.starts_on desc, a.created_at desc
   limit 10
$$;
revoke execute on function public.my_announcements() from public, anon;
grant execute on function public.my_announcements() to authenticated;

-- ---------------------------------------------------------------------------
-- SMS
-- ---------------------------------------------------------------------------
create table if not exists public.sms_messages (
  id           uuid primary key default gen_random_uuid(),
  parish_id    uuid not null references public.parishes(id),
  body         text not null check (length(body) between 1 and 918),
  audience     text not null check (audience in ('all', 'zaka_payers', 'leaders', 'units')),
  unit_ids     uuid[] not null default '{}',
  zaka_only    boolean not null default false,
  recipients   int not null default 0,
  status       text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'failed')),
  provider     text,
  result       jsonb,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  sent_at      timestamptz
);
create table if not exists public.sms_recipients (
  message_id      uuid not null references public.sms_messages(id) on delete cascade,
  phone           text not null,
  parishioner_id  uuid references public.parishioners(id) on delete set null,
  full_name       text,
  primary key (message_id, phone)
);
alter table public.sms_messages enable row level security;
alter table public.sms_recipients enable row level security;
grant select on public.sms_messages, public.sms_recipients to authenticated;
drop policy if exists sms_messages_read on public.sms_messages;
create policy sms_messages_read on public.sms_messages for select to authenticated using ((select public.has_perm('comms.send')));
drop policy if exists sms_recipients_read on public.sms_recipients;
create policy sms_recipients_read on public.sms_recipients for select to authenticated using ((select public.has_perm('comms.send')));

-- the register people an SMS would go to (one row per phone number)
create or replace function public.sms_audience(p_audience text, p_units uuid[], p_zaka_only boolean)
returns table (phone text, parishioner_id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select distinct on (public.normalize_phone(p.phone)) public.normalize_phone(p.phone), p.id, p.full_name
    from public.parishioners p
   where p.membership_status = 'active'
     and public.normalize_phone(p.phone) is not null
     and (p_audience <> 'zaka_payers' or p.is_zaka_payer)
     and (not coalesce(p_zaka_only, false) or p.is_zaka_payer)
     and (p_audience <> 'leaders' or exists (select 1 from public.leadership_assignments la where la.parishioner_id = p.id and la.status = 'active'))
     and (p_audience <> 'units' or exists (select 1 from unnest(coalesce(p_units, '{}')) u where public.org_is_within(p.jumuiya_id, u)))
   order by public.normalize_phone(p.phone), p.is_zaka_payer desc, p.created_at
$$;
revoke execute on function public.sms_audience(text, uuid[], boolean) from public, anon, authenticated;

-- how many numbers a message would reach (before creating it)
create or replace function public.sms_preview(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_units uuid[];
begin
  if not public.has_perm('comms.send') then raise exception 'Huna ruhusa ya kutuma SMS (permission denied)' using errcode = '42501'; end if;
  select coalesce(array_agg(x::uuid), '{}') into v_units from jsonb_array_elements_text(coalesce(p->'unit_ids', '[]'::jsonb)) x;
  return jsonb_build_object('recipients', (select count(*) from public.sms_audience(p->>'audience', v_units, coalesce((p->>'zaka_only')::boolean, false))),
                            'without_phone', (select count(*) from public.parishioners where membership_status = 'active' and public.normalize_phone(phone) is null));
end $$;
revoke execute on function public.sms_preview(jsonb) from public, anon;
grant execute on function public.sms_preview(jsonb) to authenticated;

-- create the message with its fixed list of numbers. p: body, audience, unit_ids, zaka_only
create or replace function public.sms_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_units uuid[];
  v_id uuid;
  n int;
begin
  if not public.has_perm('comms.send') then raise exception 'Huna ruhusa ya kutuma SMS (permission denied)' using errcode = '42501'; end if;
  if coalesce(btrim(p->>'body'), '') = '' then raise exception 'Andika ujumbe' using errcode = 'P0001'; end if;
  select coalesce(array_agg(x::uuid), '{}') into v_units from jsonb_array_elements_text(coalesce(p->'unit_ids', '[]'::jsonb)) x;
  if p->>'audience' = 'units' and cardinality(v_units) = 0 then raise exception 'Chagua kigango au jumuiya' using errcode = 'P0001'; end if;
  insert into public.sms_messages (parish_id, body, audience, unit_ids, zaka_only, created_by)
  values (public.default_parish_id(), btrim(p->>'body'), p->>'audience', v_units, coalesce((p->>'zaka_only')::boolean, false), auth.uid())
  returning id into v_id;
  insert into public.sms_recipients (message_id, phone, parishioner_id, full_name)
  select v_id, a.phone, a.parishioner_id, a.full_name from public.sms_audience(p->>'audience', v_units, coalesce((p->>'zaka_only')::boolean, false)) a;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Hakuna muumini mwenye namba ya simu kwenye kundi ulilochagua' using errcode = 'P0001'; end if;
  update public.sms_messages set recipients = n where id = v_id;
  insert into public.audit_log (actor_id, action, table_name, row_id, note) values (auth.uid(), 'sms_create', 'sms_messages', v_id::text, n || ' namba');
  return jsonb_build_object('id', v_id, 'recipients', n);
end $$;
revoke execute on function public.sms_create(jsonb) from public, anon;
grant execute on function public.sms_create(jsonb) to authenticated;

-- used by the server (api/sms.js, with the sender's own sign-in): the message and its
-- numbers, claimed for sending so that two clicks never send it twice
create or replace function public.sms_claim(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.sms_messages;
begin
  if not public.has_perm('comms.send') then raise exception 'Huna ruhusa ya kutuma SMS (permission denied)' using errcode = '42501'; end if;
  select * into m from public.sms_messages where id = p_id for update;
  if m.id is null then raise exception 'Ujumbe haupo' using errcode = 'P0001'; end if;
  if m.status = 'sent' then raise exception 'Ujumbe huu umeshatumwa' using errcode = 'P0001'; end if;
  -- a send that never finished (server stopped) may be tried again after 15 minutes
  if m.status = 'sending' and m.claimed_at > now() - interval '15 minutes' then
    raise exception 'Ujumbe huu unatumwa sasa hivi — subiri' using errcode = 'P0001';
  end if;
  update public.sms_messages set status = 'sending', claimed_at = now() where id = m.id;
  return jsonb_build_object('id', m.id, 'body', m.body,
                            'phones', (select coalesce(jsonb_agg(phone order by phone), '[]'::jsonb) from public.sms_recipients where message_id = m.id));
end $$;
revoke execute on function public.sms_claim(uuid) from public, anon;
grant execute on function public.sms_claim(uuid) to authenticated;

create or replace function public.sms_finish(p_id uuid, p_ok boolean, p_provider text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('comms.send') then raise exception 'Huna ruhusa (permission denied)' using errcode = '42501'; end if;
  update public.sms_messages set status = case when p_ok then 'sent' else 'failed' end, provider = p_provider, result = p_result,
         sent_at = case when p_ok then now() end
   where id = p_id and status = 'sending';
  if not found then raise exception 'Ujumbe haukuwa unatumwa' using errcode = 'P0001'; end if;
  insert into public.audit_log (actor_id, action, table_name, row_id, note)
  values (auth.uid(), case when p_ok then 'sms_sent' else 'sms_failed' end, 'sms_messages', p_id::text, p_provider);
  return jsonb_build_object('status', case when p_ok then 'sent' else 'failed' end);
end $$;
revoke execute on function public.sms_finish(uuid, boolean, text, jsonb) from public, anon;
grant execute on function public.sms_finish(uuid, boolean, text, jsonb) to authenticated;

-- a message not sent (or sent from a phone instead) can be removed
create or replace function public.sms_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_perm('comms.send') then raise exception 'Huna ruhusa (permission denied)' using errcode = '42501'; end if;
  delete from public.sms_messages where id = p_id and status in ('draft', 'failed');
  if not found then raise exception 'Ujumbe uliokwisha tumwa haufutwi' using errcode = 'P0001'; end if;
  return jsonb_build_object('status', 'deleted');
end $$;
revoke execute on function public.sms_delete(uuid) from public, anon;
grant execute on function public.sms_delete(uuid) to authenticated;

notify pgrst, 'reload schema';
