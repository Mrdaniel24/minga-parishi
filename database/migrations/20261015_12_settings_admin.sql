-- ============================================================================
-- Minga Parish Management System — migration 12: managing contribution types
-- and funds from the Settings screen
--   * funds can be switched off (is_active) like contribution types
--   * a contribution type or fund can be DELETED only while nothing uses it;
--     once money has been recorded against it, it can only be switched off,
--     so the history and the reports stay correct.
-- ============================================================================

alter table public.funds add column if not exists is_active boolean not null default true;

create or replace function public.delete_contribution_category(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.contribution_categories; n_tx int; n_camp int; n_env int;
begin
  select * into c from public.contribution_categories where id = p_id;
  if c.id is null then raise exception 'Aina ya mchango haipo' using errcode = 'P0001'; end if;
  if not public.has_perm('finance.configure', null) then
    raise exception 'Huna ruhusa ya kubadilisha mipangilio ya fedha (permission denied)' using errcode = '42501';
  end if;
  select count(*) into n_tx from public.finance_transactions where category_id = p_id;
  select count(*) into n_camp from public.campaigns where category_id = p_id;
  select count(*) into n_env from public.envelope_batches where category_id = p_id;
  if n_tx > 0 then
    raise exception 'Aina "%" ina miamala % — haiwezi kufutwa. Izime (Haitumiki) ili isionekane tena kwenye malipo mapya.', c.name_sw, n_tx using errcode = 'P0001';
  end if;
  if n_camp + n_env > 0 then
    raise exception 'Aina "%" ina kampeni/bahasha zake — zifute kwanza, au izime aina hii.', c.name_sw using errcode = 'P0001';
  end if;
  delete from public.contribution_categories where id = p_id;
  insert into public.audit_log (actor_id, action, table_name, row_id, old_data)
  values (auth.uid(), 'delete_contribution_category', 'contribution_categories', p_id::text, to_jsonb(c));
  return jsonb_build_object('status', 'deleted');
end $$;

create or replace function public.delete_fund(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f public.funds; n_cat int; n_tx int; n_acc int;
begin
  select * into f from public.funds where id = p_id;
  if f.id is null then raise exception 'Mfuko haupo' using errcode = 'P0001'; end if;
  if not public.has_perm('finance.configure', null) then
    raise exception 'Huna ruhusa ya kubadilisha mipangilio ya fedha (permission denied)' using errcode = '42501';
  end if;
  select count(*) into n_cat from public.contribution_categories where fund_id = p_id;
  select count(*) into n_tx from public.finance_transactions where fund_id = p_id;
  select count(*) into n_acc from public.ledger_accounts where fund_id = p_id;
  if n_tx > 0 then
    raise exception 'Mfuko "%" una miamala % — hauwezi kufutwa. Uzime (Haitumiki) badala yake.', f.name, n_tx using errcode = 'P0001';
  end if;
  if n_cat > 0 then
    raise exception 'Mfuko "%" unatumiwa na aina % za michango — zihamishie mfuko mwingine kwanza.', f.name, n_cat using errcode = 'P0001';
  end if;
  if n_acc > 0 then
    raise exception 'Mfuko "%" umeunganishwa na akaunti % za uhasibu — hauwezi kufutwa. Uzime badala yake.', f.name, n_acc using errcode = 'P0001';
  end if;
  delete from public.funds where id = p_id;
  insert into public.audit_log (actor_id, action, table_name, row_id, old_data)
  values (auth.uid(), 'delete_fund', 'funds', p_id::text, to_jsonb(f));
  return jsonb_build_object('status', 'deleted');
end $$;

revoke execute on function public.delete_contribution_category(uuid) from public, anon;
revoke execute on function public.delete_fund(uuid) from public, anon;
grant execute on function public.delete_contribution_category(uuid) to authenticated;
grant execute on function public.delete_fund(uuid) to authenticated;
