-- Restore the month-aware recipient query on projects where the older 3-arg
-- function is still installed, and scope paid/unpaid lists to a selected unit.
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

create or replace function public.sms_audience(
  p_audience text,
  p_units uuid[],
  p_zaka_only boolean,
  p_year int default null,
  p_month int default null
)
returns table (phone text, parishioner_id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select distinct on (public.normalize_phone(p.phone))
         public.normalize_phone(p.phone), p.id, p.full_name
    from public.parishioners p
    left join public.families f on f.id = p.family_id
   where p.parish_id = public.default_parish_id()
     and p.membership_status = 'active'
     and public.normalize_phone(p.phone) is not null
     and (p_audience <> 'zaka_payers' or p.is_zaka_payer)
     and (p_audience not in ('zaka_paid','zaka_unpaid') or p.is_zaka_payer)
     and (not coalesce(p_zaka_only, false) or p.is_zaka_payer)
     and (p_audience <> 'zaka_paid'
          or public.zaka_paid_in(p.id, p.family_id, coalesce(p_year, extract(year from current_date)::int), p_month))
     and (p_audience <> 'zaka_unpaid'
          or not public.zaka_paid_in(p.id, p.family_id, coalesce(p_year, extract(year from current_date)::int), p_month))
     and (p_audience <> 'leaders' or exists (
       select 1 from public.leadership_assignments la
        where la.parishioner_id = p.id and la.status = 'active'))
     and (coalesce(cardinality(p_units), 0) = 0 or exists (
       select 1 from unnest(p_units) u where public.org_is_within(coalesce(p.jumuiya_id, f.jumuiya_id), u)))
   order by public.normalize_phone(p.phone), p.is_zaka_payer desc, p.created_at
$$;
revoke execute on function public.sms_audience(text, uuid[], boolean, int, int) from public, anon, authenticated;

create or replace function public.sms_zaka_roster(p_year int, p_month int)
returns table (unit_id uuid, parent_id uuid, unit_type text, unit_name text,
               paid_count bigint, unpaid_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('comms.send') then
    raise exception 'Huna ruhusa ya kuona wapokeaji wa SMS' using errcode = '42501';
  end if;
  if p_year not between 2000 and 2100 or p_month not between 1 and 12 then
    raise exception 'Chagua mwaka na mwezi sahihi' using errcode = '22023';
  end if;
  return query
  select u.id, u.parent_id, u.unit_type, u.name,
         (select count(*) from public.sms_audience('zaka_paid', array[u.id], false, p_year, p_month)),
         (select count(*) from public.sms_audience('zaka_unpaid', array[u.id], false, p_year, p_month))
    from public.org_units u
   where u.parish_id = public.default_parish_id()
     and u.is_active and u.unit_type in ('kigango','jumuiya')
   order by case u.unit_type when 'kigango' then 0 else 1 end, u.ordinal nulls last, u.name;
end $$;
revoke execute on function public.sms_zaka_roster(int, int) from public, anon;
grant execute on function public.sms_zaka_roster(int, int) to authenticated;
