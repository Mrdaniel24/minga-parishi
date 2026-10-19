-- Campaign names can be corrected in the UI. Deletion is allowed only while
-- the campaign has no financial history or issued envelope batches.
create or replace function public.rename_campaign(p_id uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.campaigns;
  v_name text := trim(coalesce(p_name, ''));
  v_old_name text;
begin
  select * into c from public.campaigns where id = p_id;
  if c.id is null then
    raise exception 'Mchango haupo' using errcode = 'P0001';
  end if;
  v_old_name := c.name;

  if not public.is_platform_admin() and not exists (
    select 1
      from public.parish_user_roles ur
      join public.role_permissions rp on rp.role_code = ur.role_code
     where ur.user_id = auth.uid()
       and ur.parish_id = c.parish_id
       and ur.org_unit_id is null
       and rp.permission = 'finance.configure'
  ) then
    raise exception 'Huna ruhusa ya kubadilisha mipangilio ya fedha katika parokia hii (permission denied)' using errcode = '42501';
  end if;
  if v_name = '' or length(v_name) > 160 then
    raise exception 'Jina la mchango linahitajika (herufi zisizozidi 160)' using errcode = 'P0001';
  end if;

  update public.campaigns set name = v_name where id = p_id returning * into c;
  insert into public.audit_log (actor_id, action, table_name, row_id, old_data, new_data)
  values (auth.uid(), 'rename_campaign', 'campaigns', p_id::text,
          jsonb_build_object('name', v_old_name),
          jsonb_build_object('name', v_name));
  return jsonb_build_object('status', 'renamed', 'name', v_name);
end $$;

create or replace function public.delete_campaign(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.campaigns;
  n_tx bigint;
  n_pledges bigint;
  n_envelopes bigint;
begin
  select * into c from public.campaigns where id = p_id;
  if c.id is null then
    raise exception 'Mchango haupo' using errcode = 'P0001';
  end if;

  if not public.is_platform_admin() and not exists (
    select 1
      from public.parish_user_roles ur
      join public.role_permissions rp on rp.role_code = ur.role_code
     where ur.user_id = auth.uid()
       and ur.parish_id = c.parish_id
       and ur.org_unit_id is null
       and rp.permission = 'finance.configure'
  ) then
    raise exception 'Huna ruhusa ya kubadilisha mipangilio ya fedha katika parokia hii (permission denied)' using errcode = '42501';
  end if;

  select count(*) into n_tx from public.finance_transactions where campaign_id = p_id;
  if n_tx > 0 then
    raise exception 'Mchango "%" una miamala % — hauwezi kufutwa ili historia ya malipo ibaki salama.', c.name, n_tx using errcode = 'P0001';
  end if;

  select count(*) into n_pledges from public.pledges where campaign_id = p_id;
  if n_pledges > 0 then
    raise exception 'Mchango "%" una ahadi % — hauwezi kufutwa ili taarifa za ahadi zibaki salama.', c.name, n_pledges using errcode = 'P0001';
  end if;

  select count(*) into n_envelopes from public.envelope_batches where campaign_id = p_id;
  if n_envelopes > 0 then
    raise exception 'Mchango "%" una bahasha % — hauwezi kufutwa. Zima kampeni badala yake.', c.name, n_envelopes using errcode = 'P0001';
  end if;

  if exists (select 1 from public.campaigns where previous_campaign_id = p_id) then
    raise exception 'Kampeni hii imeunganishwa na kampeni nyingine — haiwezi kufutwa.' using errcode = 'P0001';
  end if;

  -- Targets are plans, not payments; they are removed by the campaign's
  -- ON DELETE CASCADE foreign key only after all history checks pass.
  delete from public.campaigns where id = p_id;
  insert into public.audit_log (actor_id, action, table_name, row_id, old_data)
  values (auth.uid(), 'delete_campaign', 'campaigns', p_id::text, to_jsonb(c));
  return jsonb_build_object('status', 'deleted');
end $$;

revoke execute on function public.rename_campaign(uuid, text) from public, anon;
grant execute on function public.rename_campaign(uuid, text) to authenticated;
revoke execute on function public.delete_campaign(uuid) from public, anon;
grant execute on function public.delete_campaign(uuid) to authenticated;
notify pgrst, 'reload schema';
