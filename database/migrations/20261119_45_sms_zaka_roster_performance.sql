-- Aggregate monthly Zaka once, then split the roster by Kigango/Jumuiya.
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
  with units as (
    select u.id, u.parent_id, u.unit_type, u.name, u.ordinal
      from public.org_units u
     where u.parish_id = public.default_parish_id() and u.is_active
       and u.unit_type in ('kigango','jumuiya')
  ), payers as (
    select p.id, p.family_id, public.normalize_phone(p.phone) as phone,
           coalesce(p.jumuiya_id, f.jumuiya_id) as jumuiya_id,
           public.org_ancestor_of_type(coalesce(p.jumuiya_id, f.jumuiya_id), 'kigango') as kigango_id
      from public.parishioners p
      left join public.families f on f.id = p.family_id
     where p.parish_id = public.default_parish_id()
       and p.membership_status = 'active' and p.is_zaka_payer
       and public.normalize_phone(p.phone) is not null
  ), payments as (
    select x.person_id, sum(x.amount) as amount
      from (
        select p.id as person_id, t.net_amount as amount
          from payers p
          join public.finance_transactions t on t.parishioner_id = p.id
          join public.contribution_categories c on c.id = t.category_id and c.kind = 'zaka'
         where t.status = 'posted'
           and extract(year from coalesce(t.period_month, t.txn_date)) = p_year
           and extract(month from coalesce(t.period_month, t.txn_date)) = p_month
        union all
        select p.id, t.net_amount
          from payers p
          join public.finance_transactions t on t.family_id = p.family_id and t.parishioner_id is null
          join public.contribution_categories c on c.id = t.category_id and c.kind = 'zaka'
         where p.family_id is not null and t.status = 'posted'
           and extract(year from coalesce(t.period_month, t.txn_date)) = p_year
           and extract(month from coalesce(t.period_month, t.txn_date)) = p_month
      ) x
     group by x.person_id
  ), classified as (
    select p.phone, p.jumuiya_id, p.kigango_id, coalesce(pay.amount, 0) > 0 as paid
      from payers p left join payments pay on pay.person_id = p.id
  ), recipients as (
    select u.id as unit_id, c.phone, bool_or(c.paid) as paid
      from units u
      join classified c on (u.unit_type = 'jumuiya' and c.jumuiya_id = u.id)
                      or (u.unit_type = 'kigango' and c.kigango_id = u.id)
     group by u.id, c.phone
  )
  select u.id, u.parent_id, u.unit_type, u.name,
         count(r.phone) filter (where r.paid),
         count(r.phone) filter (where not r.paid)
    from units u left join recipients r on r.unit_id = u.id
   group by u.id, u.parent_id, u.unit_type, u.name, u.ordinal
   order by case u.unit_type when 'kigango' then 0 else 1 end, u.ordinal nulls last, u.name;
end $$;
revoke execute on function public.sms_zaka_roster(int, int) from public, anon;
grant execute on function public.sms_zaka_roster(int, int) to authenticated;
