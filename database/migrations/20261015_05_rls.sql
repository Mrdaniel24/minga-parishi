-- ============================================================================
-- Minga Parish Management System — migration 05: roles, permissions and RLS
--   The browser only ever uses the anon key; everything below is what actually
--   protects the data. Ledger tables have NO insert/update/delete policies:
--   writes happen only through the SECURITY DEFINER posting functions.
-- ============================================================================

insert into public.parish_roles (code, name_sw, name_en, scoped, sort_order) values
  ('parish_admin',   'Msimamizi wa Mfumo wa Parokia', 'Parish Administrator', false, 10),
  ('parish_priest',  'Paroko',                        'Parish Priest',        false, 20),
  ('accountant',     'Mhasibu wa Parokia',            'Parish Accountant',    false, 30),
  ('treasurer',      'Mtunza Hazina',                 'Parish Treasurer',     false, 40),
  ('kigango_leader', 'Kiongozi wa Kigango',           'Kigango Leader',       true,  50),
  ('jumuiya_leader', 'Kiongozi wa Jumuiya',           'Jumuiya Leader',       true,  60),
  ('data_entry',     'Karani wa Kuingiza Taarifa',    'Data Entry Officer',   false, 70),
  ('auditor',        'Mkaguzi',                       'Auditor',              false, 80),
  ('member',         'Muumini',                       'Member',               false, 90)
on conflict (code) do update set name_sw = excluded.name_sw, name_en = excluded.name_en, scoped = excluded.scoped;

insert into public.role_permissions (role_code, permission)
select r, p from (values
  ('parish_admin','parish.configure'), ('parish_admin','users.manage'), ('parish_admin','registry.read'), ('parish_admin','registry.write'),
  ('parish_admin','finance.read'), ('parish_admin','finance.record'), ('parish_admin','finance.pledge'), ('parish_admin','finance.reverse'),
  ('parish_admin','finance.approve'), ('parish_admin','finance.expense.record'), ('parish_admin','finance.configure'),
  ('parish_admin','finance.period.lock'), ('parish_admin','finance.import'), ('parish_admin','audit.read'),
  ('parish_priest','registry.read'), ('parish_priest','finance.read'), ('parish_priest','finance.approve'), ('parish_priest','audit.read'),
  ('accountant','registry.read'), ('accountant','finance.read'), ('accountant','finance.record'), ('accountant','finance.pledge'),
  ('accountant','finance.reverse'), ('accountant','finance.approve'), ('accountant','finance.expense.record'),
  ('accountant','finance.configure'), ('accountant','finance.period.lock'), ('accountant','finance.import'), ('accountant','audit.read'),
  ('treasurer','registry.read'), ('treasurer','finance.read'), ('treasurer','finance.record'), ('treasurer','finance.pledge'),
  ('treasurer','finance.approve'), ('treasurer','finance.expense.record'),
  ('kigango_leader','registry.read'), ('kigango_leader','registry.write'), ('kigango_leader','finance.read'), ('kigango_leader','finance.pledge'),
  ('jumuiya_leader','registry.read'), ('jumuiya_leader','registry.write'), ('jumuiya_leader','finance.read'), ('jumuiya_leader','finance.pledge'),
  ('data_entry','registry.read'), ('data_entry','registry.write'), ('data_entry','finance.read'), ('data_entry','finance.record'), ('data_entry','finance.pledge'),
  ('auditor','registry.read'), ('auditor','finance.read'), ('auditor','audit.read')
) v(r, p)
on conflict do nothing;

-- scoped roles must name a community; parish-wide roles must not
create or replace function public.check_user_role_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare s boolean;
begin
  select scoped into s from public.parish_roles where code = new.role_code;
  if s and new.org_unit_id is null then raise exception 'Nafasi % inahitaji kigango/jumuiya', new.role_code using errcode = 'P0001'; end if;
  if not s and new.org_unit_id is not null then raise exception 'Nafasi % ni ya parokia nzima', new.role_code using errcode = 'P0001'; end if;
  -- auth.uid() is null only for direct database sessions (SQL editor / service role),
  -- which is how the first Parish Administrator is created.
  if new.role_code = 'parish_admin' and auth.uid() is not null and not public.is_platform_admin()
     and not exists (select 1 from public.parish_user_roles where user_id = auth.uid() and role_code = 'parish_admin') then
    raise exception 'Ni Msimamizi pekee anayeweza kutoa nafasi hii' using errcode = '42501';
  end if;
  new.granted_by := auth.uid();
  return new;
end $$;
drop trigger if exists parish_user_roles_scope on public.parish_user_roles;
create trigger parish_user_roles_scope before insert or update on public.parish_user_roles
  for each row execute function public.check_user_role_scope();

-- linking a login account to a register entry is an administrator decision
create or replace function public.guard_parishioner_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.profile_id is distinct from (case when tg_op = 'UPDATE' then old.profile_id end)
     and new.profile_id is not null and auth.uid() is not null and not public.has_perm('users.manage', null)
     and coalesce(current_setting('minga.approved_link', true), '') <> 'on' then   -- set by decide_parish_link (09)
    raise exception 'Kuunganisha akaunti na muumini kunahitaji ruhusa ya msimamizi' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists parishioners_link_guard on public.parishioners;
create trigger parishioners_link_guard before insert or update on public.parishioners
  for each row execute function public.guard_parishioner_link();

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['audit_log','parishes','org_units','families','parishioners','membership_history',
    'leadership_positions','leadership_assignments','parish_roles','role_permissions','parish_user_roles',
    'financial_years','accounting_periods','funds','ledger_accounts','contribution_categories','campaigns',
    'campaign_targets','pledges','finance_transactions','payment_allocations','journal_entries','journal_lines',
    'receipt_counters','receipts','approval_requests','envelope_batches','envelopes','import_batches',
    'import_issues','reconciliation_results'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- helper to (re)create a policy idempotently
create or replace function pg_temp.pol(p_table text, p_name text, p_sql text) returns void language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', p_name, p_table);
  execute p_sql;
end $$;

-- identity & structure: readable by everyone signed in (names only, no money)
select pg_temp.pol('parishes','parishes_read','create policy parishes_read on public.parishes for select to anon, authenticated using (true)');
select pg_temp.pol('parishes','parishes_write','create policy parishes_write on public.parishes for update to authenticated using (public.has_perm(''parish.configure'')) with check (public.has_perm(''parish.configure''))');
select pg_temp.pol('org_units','org_units_read','create policy org_units_read on public.org_units for select to anon, authenticated using (true)');
select pg_temp.pol('org_units','org_units_insert','create policy org_units_insert on public.org_units for insert to authenticated with check (public.has_perm(''parish.configure''))');
select pg_temp.pol('org_units','org_units_update','create policy org_units_update on public.org_units for update to authenticated using (public.has_perm(''parish.configure'')) with check (public.has_perm(''parish.configure''))');

-- register (families / parishioners): scoped by community
select pg_temp.pol('families','families_read','create policy families_read on public.families for select to authenticated using ((select public.has_perm(''registry.read'')) or public.has_perm(''registry.read'', jumuiya_id) or id = (select public.my_family_id()))');
select pg_temp.pol('families','families_insert','create policy families_insert on public.families for insert to authenticated with check (public.has_perm(''registry.write'', jumuiya_id))');
select pg_temp.pol('families','families_update','create policy families_update on public.families for update to authenticated using (public.has_perm(''registry.write'', jumuiya_id)) with check (public.has_perm(''registry.write'', jumuiya_id))');
select pg_temp.pol('parishioners','parishioners_read','create policy parishioners_read on public.parishioners for select to authenticated using ((select public.has_perm(''registry.read'')) or public.has_perm(''registry.read'', jumuiya_id) or profile_id = auth.uid() or (family_id is not null and family_id = (select public.my_family_id())))');
select pg_temp.pol('parishioners','parishioners_insert','create policy parishioners_insert on public.parishioners for insert to authenticated with check (public.has_perm(''registry.write'', jumuiya_id))');
select pg_temp.pol('parishioners','parishioners_update','create policy parishioners_update on public.parishioners for update to authenticated using (public.has_perm(''registry.write'', jumuiya_id)) with check (public.has_perm(''registry.write'', jumuiya_id))');
select pg_temp.pol('membership_history','membership_history_read','create policy membership_history_read on public.membership_history for select to authenticated using (public.has_perm_anywhere(''registry.read''))');

select pg_temp.pol('leadership_positions','leadership_positions_read','create policy leadership_positions_read on public.leadership_positions for select to authenticated using (true)');
select pg_temp.pol('leadership_positions','leadership_positions_write','create policy leadership_positions_write on public.leadership_positions for all to authenticated using (public.has_perm(''parish.configure'')) with check (public.has_perm(''parish.configure''))');
select pg_temp.pol('leadership_assignments','leadership_read','create policy leadership_read on public.leadership_assignments for select to authenticated using (true)');
select pg_temp.pol('leadership_assignments','leadership_write','create policy leadership_write on public.leadership_assignments for all to authenticated using (public.has_perm(''registry.write'', org_unit_id)) with check (public.has_perm(''registry.write'', org_unit_id))');

-- roles
select pg_temp.pol('parish_roles','parish_roles_read','create policy parish_roles_read on public.parish_roles for select to authenticated using (true)');
select pg_temp.pol('role_permissions','role_permissions_read','create policy role_permissions_read on public.role_permissions for select to authenticated using (true)');
select pg_temp.pol('role_permissions','role_permissions_write','create policy role_permissions_write on public.role_permissions for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin())');
select pg_temp.pol('parish_user_roles','pur_read','create policy pur_read on public.parish_user_roles for select to authenticated using (user_id = auth.uid() or (select public.has_perm(''users.manage'')))');
select pg_temp.pol('parish_user_roles','pur_insert','create policy pur_insert on public.parish_user_roles for insert to authenticated with check ((select public.has_perm(''users.manage'')))');
select pg_temp.pol('parish_user_roles','pur_delete','create policy pur_delete on public.parish_user_roles for delete to authenticated using (public.has_perm(''users.manage'') and user_id <> auth.uid())');

select pg_temp.pol('audit_log','audit_read','create policy audit_read on public.audit_log for select to authenticated using ((select public.has_perm(''audit.read'')))');

-- finance configuration: readable by signed-in users, editable by finance.configure
do $$ declare t text; begin
  foreach t in array array['financial_years','accounting_periods','funds','ledger_accounts','contribution_categories','campaigns','campaign_targets','envelope_batches'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_perm(''finance.configure''))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_perm(''finance.configure'')) with check (public.has_perm(''finance.configure''))', t || '_update', t);
  end loop;
end $$;
-- locking is done only through set_period_lock / close_financial_year
drop policy if exists accounting_periods_update on public.accounting_periods;
drop policy if exists financial_years_update on public.financial_years;
create policy financial_years_update on public.financial_years for update to authenticated
  using (public.has_perm('finance.configure') and status = 'open') with check (status = 'open');

-- ledger and derived rows: read-only, scoped; members see their own / their family's
select pg_temp.pol('finance_transactions','ft_read','create policy ft_read on public.finance_transactions for select to authenticated using ((select public.has_perm(''finance.read'')) or public.has_perm(''finance.read'', coalesce(org_unit_id, jumuiya_id))
  or (parishioner_id is not null and parishioner_id = (select public.my_parishioner_id()))
  or (family_id is not null and family_id = (select public.my_family_id())))');
select pg_temp.pol('pledges','pledges_read','create policy pledges_read on public.pledges for select to authenticated using ((select public.has_perm(''finance.read'')) or public.has_perm(''finance.read'', coalesce(org_unit_id, jumuiya_id))
  or (parishioner_id is not null and parishioner_id = (select public.my_parishioner_id()))
  or (family_id is not null and family_id = (select public.my_family_id())))');
select pg_temp.pol('payment_allocations','pa_read','create policy pa_read on public.payment_allocations for select to authenticated using (
  (select public.has_perm(''finance.read'')) or exists (select 1 from public.finance_transactions t where t.id = transaction_id))');
select pg_temp.pol('receipts','receipts_read','create policy receipts_read on public.receipts for select to authenticated using (
  (select public.has_perm(''finance.read'')) or exists (select 1 from public.finance_transactions t where t.id = transaction_id))');
select pg_temp.pol('journal_entries','je_read','create policy je_read on public.journal_entries for select to authenticated using ((select public.has_perm(''finance.read'')))');
select pg_temp.pol('journal_lines','jl_read','create policy jl_read on public.journal_lines for select to authenticated using ((select public.has_perm(''finance.read'')))');
select pg_temp.pol('approval_requests','ar_read','create policy ar_read on public.approval_requests for select to authenticated using ((select public.has_perm(''finance.read'')) or requested_by = auth.uid())');
select pg_temp.pol('envelopes','env_read','create policy env_read on public.envelopes for select to authenticated using ((select public.has_perm(''finance.read'')) or public.has_perm(''finance.read'', org_unit_id) or (parishioner_id is not null and parishioner_id = (select public.my_parishioner_id()))
  or (family_id is not null and family_id = (select public.my_family_id())))');
select pg_temp.pol('envelopes','env_write','create policy env_write on public.envelopes for insert to authenticated with check (public.has_perm(''finance.record'', org_unit_id))');
select pg_temp.pol('envelopes','env_update','create policy env_update on public.envelopes for update to authenticated using (public.has_perm(''finance.record'', org_unit_id) and transaction_id is null) with check (public.has_perm(''finance.record'', org_unit_id))');

do $$ declare t text; begin
  foreach t in array array['import_batches','import_issues','reconciliation_results'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.has_perm(''finance.import'')) or (select public.has_perm(''audit.read'')))', t || '_read', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Function privileges: internal helpers are not callable through the API
-- ---------------------------------------------------------------------------
revoke execute on function public.write_journal(uuid) from public, anon, authenticated;
revoke execute on function public.issue_receipt(uuid, text) from public, anon, authenticated;
revoke execute on function public.ensure_periods(uuid) from public, anon, authenticated;
revoke execute on function public.audit_row() from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['post_payment(jsonb)','reverse_transaction(uuid,text,uuid,date)','record_expense(jsonb)',
    'decide_approval(uuid,boolean,text)','post_transfer(jsonb)','create_pledge(jsonb)','update_pledge_amount(uuid,numeric,text)',
    'cancel_pledge(uuid,text)','carry_forward_pledge(uuid,uuid)','set_period_lock(uuid,boolean)','close_financial_year(uuid)',
    'mark_receipt_printed(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
grant execute on function public.verify_receipt(text, text) to anon, authenticated;
