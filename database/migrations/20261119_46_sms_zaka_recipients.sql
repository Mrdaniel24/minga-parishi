-- Return only names for the selected Zaka group; caller must have comms.send.
create or replace function public.sms_zaka_recipients(
  p_year int, p_month int, p_unit uuid, p_audience text
)
returns table (full_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm('comms.send') then
    raise exception 'Huna ruhusa ya kuona orodha ya wapokeaji' using errcode = '42501';
  end if;
  if p_audience not in ('zaka_paid','zaka_unpaid') or p_year not between 2000 and 2100
     or p_month not between 1 and 12 or p_unit is null then
    raise exception 'Vigezo vya orodha ya Zaka si sahihi' using errcode = '22023';
  end if;
  return query
    select a.full_name
      from public.sms_audience(p_audience, array[p_unit], false, p_year, p_month) a
     order by a.full_name;
end $$;
revoke execute on function public.sms_zaka_recipients(int, int, uuid, text) from public, anon;
grant execute on function public.sms_zaka_recipients(int, int, uuid, text) to authenticated;
