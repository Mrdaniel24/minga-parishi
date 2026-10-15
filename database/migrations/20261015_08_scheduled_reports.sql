-- ============================================================================
-- Minga Parish Management System — migration 08: scheduled report snapshots
--   Periodic summaries (daily / weekly / monthly / annual / outstanding pledges)
--   are computed from posted ledger rows and stored as JSON snapshots, so the
--   parish keeps a record of what each report said on the day it was produced.
--   Snapshots never create or copy transactions.
--
--   Scheduling uses pg_cron when it is enabled on the Supabase project
--   (Database → Extensions → pg_cron). Delivery (SMS / e-mail) is NOT done
--   here; a snapshot only records `delivered_at` once a sender confirms it.
-- ============================================================================

create table if not exists public.report_snapshots (
  id            bigint generated always as identity primary key,
  parish_id     uuid not null references public.parishes(id),
  report_kind   text not null check (report_kind in ('daily','weekly','monthly','annual','outstanding_pledges','campaigns')),
  period_start  date not null,
  period_end    date not null,
  data          jsonb not null,
  generated_at  timestamptz not null default now(),
  delivered_at  timestamptz,
  delivery_note text,
  unique (parish_id, report_kind, period_start, period_end)
);
alter table public.report_snapshots enable row level security;
drop policy if exists report_snapshots_read on public.report_snapshots;
create policy report_snapshots_read on public.report_snapshots for select to authenticated using (public.has_perm('finance.read'));

create or replace function public.generate_report_snapshot(p_kind text, p_day date default current_date - 1)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_parish uuid := public.default_parish_id(); a date; b date; v jsonb; v_id bigint;
begin
  case p_kind
    when 'daily'   then a := p_day; b := p_day;
    when 'weekly'  then a := date_trunc('week', p_day)::date; b := a + 6;
    when 'monthly' then a := date_trunc('month', p_day)::date; b := (a + interval '1 month - 1 day')::date;
    when 'annual'  then a := date_trunc('year', p_day)::date; b := (a + interval '1 year - 1 day')::date;
    else a := p_day; b := p_day;
  end case;
  if p_kind in ('daily','weekly','monthly','annual') then
    v := jsonb_build_object(
      'by_category', (select coalesce(jsonb_agg(to_jsonb(x) order by x.total desc), '[]') from public.contribution_totals(a, b, 'parish') x),
      'by_kigango',  (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.contribution_totals(a, b, 'kigango') x),
      'income',   (select coalesce(sum(net_amount), 0) from public.finance_transactions where status = 'posted' and kind = 'income' and txn_date between a and b),
      'expenses', (select coalesce(sum(net_amount), 0) from public.finance_transactions where status = 'posted' and kind = 'expense' and txn_date between a and b),
      'receipts', (select count(*) from public.receipts r join public.finance_transactions t on t.id = r.transaction_id where t.txn_date between a and b and r.status = 'valid'));
  elsif p_kind = 'outstanding_pledges' then
    v := (select jsonb_build_object('total_outstanding', coalesce(sum(outstanding), 0),
           'by_campaign', coalesce(jsonb_agg(x) filter (where x is not null), '[]'))
          from (select campaign_name, sum(pledged) pledged, sum(paid) paid, sum(outstanding) outstanding
                from public.v_pledge_balances where status = 'active' group by campaign_name) x);
  else
    v := (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.v_campaign_progress c where c.status <> 'closed');
  end if;
  insert into public.report_snapshots (parish_id, report_kind, period_start, period_end, data)
  values (v_parish, p_kind, a, b, v)
  on conflict (parish_id, report_kind, period_start, period_end) do update set data = excluded.data, generated_at = now()
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.generate_report_snapshot(text, date) from public, anon, authenticated;

-- schedule with pg_cron when available (times are UTC; Africa/Dar_es_Salaam = UTC+3)
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('minga-daily',   '15 21 * * *', $c$select public.generate_report_snapshot('daily', (now() at time zone 'Africa/Dar_es_Salaam')::date)$c$);
    perform cron.schedule('minga-weekly',  '30 21 * * 0', $c$select public.generate_report_snapshot('weekly', (now() at time zone 'Africa/Dar_es_Salaam')::date)$c$);
    perform cron.schedule('minga-monthly', '45 21 28-31 * *', $c$select public.generate_report_snapshot('monthly', (now() at time zone 'Africa/Dar_es_Salaam')::date)
                                                                 where extract(day from (now() at time zone 'Africa/Dar_es_Salaam') + interval '1 day') = 1$c$);
    perform cron.schedule('minga-outstanding', '0 22 * * 0', $c$select public.generate_report_snapshot('outstanding_pledges', (now() at time zone 'Africa/Dar_es_Salaam')::date)$c$);
  end if;
end $$;
