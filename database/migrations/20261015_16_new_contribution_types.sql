-- ============================================================================
-- Minga Parish Management System — migration 16: a new contribution type can be
-- added wherever a contribution is chosen (recording a payment, assigning a
-- jumuiya, a new campaign) — not only in Settings. If a type with the same name
-- already exists (or exists switched off) it is used / switched back on instead
-- of creating a duplicate.
-- ============================================================================

create or replace function public.create_contribution_type(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_parish uuid := public.default_parish_id();
  v_name text := trim(regexp_replace(coalesce(p->>'name', ''), '\s+', ' ', 'g'));
  v_kind text := coalesce(nullif(p->>'kind', ''), 'special');
  v_cat public.contribution_categories;
  v_code text; v_n int := 1;
begin
  if not (public.has_perm_anywhere('finance.record') or public.has_perm_anywhere('finance.pledge') or public.has_perm_anywhere('finance.configure')) then
    raise exception 'Huna ruhusa ya kuongeza aina ya mchango (permission denied)' using errcode = '42501';
  end if;
  if length(v_name) < 3 then raise exception 'Andika jina la mchango (herufi 3 au zaidi)' using errcode = 'P0001'; end if;
  if v_kind not in ('mavuno','ujenzi','sadaka','special','shukrani','income_other') then
    raise exception 'Aina si sahihi' using errcode = 'P0001';
  end if;
  select * into v_cat from public.contribution_categories
   where parish_id = v_parish and (lower(name_sw) = lower(v_name) or lower(coalesce(name_en, '')) = lower(v_name)) limit 1;
  if v_cat.id is not null then
    if not v_cat.is_active then update public.contribution_categories set is_active = true where id = v_cat.id; end if;
    return jsonb_build_object('id', v_cat.id, 'code', v_cat.code, 'name', v_cat.name_sw, 'created', false);
  end if;
  v_code := left(upper(trim(both '_' from regexp_replace(upper(v_name), '[^A-Z0-9]+', '_', 'g'))), 30);
  if v_code = '' then v_code := 'MCHANGO'; end if;
  while exists (select 1 from public.contribution_categories where parish_id = v_parish and code = v_code || case when v_n = 1 then '' else '_' || v_n end) loop
    v_n := v_n + 1;
  end loop;
  v_code := v_code || case when v_n = 1 then '' else '_' || v_n end;
  insert into public.contribution_categories (parish_id, code, name_sw, kind, is_pledgeable, uses_period_month, fund_id, sort_order)
  values (v_parish, v_code, v_name, v_kind, true, false,
          coalesce((select fund_id from public.contribution_categories where parish_id = v_parish and kind = v_kind and fund_id is not null order by sort_order limit 1),
                   (select id from public.funds where parish_id = v_parish and code = 'SPECIAL')),
          500)
  returning * into v_cat;
  insert into public.audit_log (actor_id, action, table_name, row_id, new_data)
  values (auth.uid(), 'create_contribution_type', 'contribution_categories', v_cat.id::text, to_jsonb(v_cat));
  return jsonb_build_object('id', v_cat.id, 'code', v_cat.code, 'name', v_cat.name_sw, 'created', true);
end $$;

revoke execute on function public.create_contribution_type(jsonb) from public, anon;
grant execute on function public.create_contribution_type(jsonb) to authenticated;

-- ask Supabase (PostgREST) to see the new functions right away
notify pgrst, 'reload schema';
