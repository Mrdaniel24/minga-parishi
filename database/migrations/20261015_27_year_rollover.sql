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
