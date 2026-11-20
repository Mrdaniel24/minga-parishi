-- Return a selected Zaka audience grouped by family for the SMS drill-down.
-- Phone numbers are deliberately omitted; this RPC is for viewing recipient names.
create or replace function public.sms_zaka_recipient_tree(
  p_year int, p_month int, p_unit uuid, p_audience text
)
returns table (family_id uuid, family_name text, family_code text, parishioner_id uuid, full_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('comms.send') then
    raise exception 'Huna ruhusa ya kuona wapokeaji wa SMS' using errcode = '42501';
  end if;
  if p_audience not in ('zaka_paid','zaka_unpaid') or p_year not between 2000 and 2100
     or p_month not between 1 and 12 or p_unit is null then
    raise exception 'Vigezo vya orodha ya Zaka si sahihi' using errcode = '22023';
  end if;
  return query
    select f.id, f.family_name, f.family_code, a.parishioner_id, a.full_name
      from public.sms_audience(p_audience, array[p_unit], false, p_year, p_month) a
      join public.parishioners p on p.id = a.parishioner_id
      left join public.families f on f.id = p.family_id
     order by f.family_name nulls last, f.family_code nulls last, a.full_name;
end $$;
revoke execute on function public.sms_zaka_recipient_tree(int, int, uuid, text) from public, anon;
grant execute on function public.sms_zaka_recipient_tree(int, int, uuid, text) to authenticated;
