-- ============================================================================
-- Minga Parish Management System — migration 26: moving and removing members
--   * A member (or a whole family) who moves to another jumuiya takes their
--     record with them, and — when asked — their money too: the jumuiya /
--     kigango a past payment is credited to follows them, so their giving
--     shows under the new jumuiya. Amounts, dates and receipts never change.
--   * A member who is removed from the register leaves their payments behind:
--     the payments stay (with the payer's name and family), only the link to
--     the deleted person is cleared.
--   Posted ledger rows stay immutable: only these functions may change the
--   attribution columns, and they log what they did in audit_log.
-- ============================================================================

-- posted rows: the attribution columns may change only inside the functions below
create or replace function public.protect_posted_transactions()
returns trigger language plpgsql as $$
declare
  v_keep text[] := array['reversed_by_id', 'reversal_reason', 'net_amount'];
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'Muamala uliothibitishwa hauwezi kufutwa — tumia reversal' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status = 'posted' then
    -- set by move_parishioner / move_family / delete_parishioner (security definer)
    if coalesce(current_setting('minga.reattribute', true), '') = 'on' then
      v_keep := v_keep || array['parishioner_id', 'family_id', 'jumuiya_id', 'kigango_id', 'org_unit_id', 'payer_name'];
    end if;
    -- only the reversal link may be set on a posted row
    -- (net_amount is generated: it is still NULL in NEW inside a BEFORE trigger)
    if (to_jsonb(new) - v_keep) is distinct from (to_jsonb(old) - v_keep) then
      raise exception 'Muamala uliothibitishwa hauwezi kubadilishwa — tumia reversal au adjustment' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- payments / pledges of a set of rows follow the new jumuiya.
-- Only rows credited to the old jumuiya itself move (money given to a kigango
-- or a group directly stays there).
create or replace function public.reattribute_money(p_parishioner uuid, p_family uuid, p_from uuid, p_to uuid, p_new_family uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_k uuid := public.org_ancestor_of_type(p_to, 'kigango');
  n int;
begin
  perform set_config('minga.reattribute', 'on', true);
  update public.finance_transactions t
     set jumuiya_id = p_to,
         kigango_id = v_k,
         org_unit_id = case when t.org_unit_id is not distinct from p_from then p_to else t.org_unit_id end,
         family_id = case when p_parishioner is not null and p_new_family is not null then p_new_family else t.family_id end
   where (case when p_parishioner is not null then t.parishioner_id = p_parishioner
               else t.family_id = p_family end)
     and t.jumuiya_id is not distinct from p_from
     and (t.org_unit_id is null or t.org_unit_id = p_from);
  get diagnostics n = row_count;
  perform set_config('minga.reattribute', 'off', true);
  update public.pledges pl
     set jumuiya_id = p_to, kigango_id = v_k
   where (case when p_parishioner is not null then pl.parishioner_id = p_parishioner else pl.family_id = p_family end)
     and pl.jumuiya_id is not distinct from p_from;
  return n;
end $$;
revoke execute on function public.reattribute_money(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- move one member to another family (and so, maybe, another jumuiya)
--   p_family: the family they join; p_new_family_name: or start a new family
--   in p_jumuiya with this name. p_move_money: their past payments follow.
create or replace function public.move_parishioner(p_parishioner uuid, p_family uuid, p_jumuiya uuid,
                                                   p_new_family_name text default null, p_move_money boolean default true,
                                                   p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  per public.parishioners;
  v_to_fam uuid := p_family;
  v_to_jum uuid := p_jumuiya;
  v_from_jum uuid;
  n int := 0;
begin
  select * into per from public.parishioners where id = p_parishioner;
  if per.id is null then raise exception 'Muumini hayupo' using errcode = 'P0001'; end if;
  v_from_jum := coalesce(per.jumuiya_id, (select jumuiya_id from public.families where id = per.family_id));
  if not public.has_perm('registry.write', v_from_jum) then
    raise exception 'Huna ruhusa ya kumhamisha muumini huyu (permission denied)' using errcode = '42501';
  end if;
  if v_to_fam is not null then
    select jumuiya_id into v_to_jum from public.families where id = v_to_fam;
    if not found then raise exception 'Familia hiyo haipo' using errcode = 'P0001'; end if;
  end if;
  if v_to_jum is null or not exists (select 1 from public.org_units where id = v_to_jum and unit_type = 'jumuiya') then
    raise exception 'Chagua jumuiya anayohamia' using errcode = 'P0001';
  end if;
  if not public.has_perm('registry.write', v_to_jum) then
    raise exception 'Huna ruhusa kwenye jumuiya anayohamia (permission denied)' using errcode = '42501';
  end if;
  if v_to_fam is null then
    if coalesce(btrim(p_new_family_name), '') = '' then
      raise exception 'Chagua familia au andika jina la familia mpya' using errcode = 'P0001';
    end if;
    insert into public.families (parish_id, family_name, jumuiya_id, phone)
    values (per.parish_id, btrim(p_new_family_name), v_to_jum, per.phone) returning id into v_to_fam;
    update public.families set head_parishioner_id = per.id where id = v_to_fam;
  end if;
  if v_to_fam is not distinct from per.family_id then
    raise exception 'Muumini yuko tayari kwenye familia hiyo' using errcode = 'P0001';
  end if;

  -- the person leaves their old family: it no longer has them as head
  update public.families set head_parishioner_id = null where id = per.family_id and head_parishioner_id = per.id;
  update public.parishioners set family_id = v_to_fam, jumuiya_id = v_to_jum,
         membership_status = case when membership_status = 'moved' then 'active' else membership_status end
   where id = per.id;
  update public.membership_history set reason = nullif(btrim(p_reason), '')
   where id = (select max(id) from public.membership_history where parishioner_id = per.id);
  -- titles held in the old jumuiya / kigango end with the move
  if v_from_jum is distinct from v_to_jum then
    update public.leadership_assignments set status = 'ended', ends_on = greatest(coalesce(starts_on, current_date), current_date)
     where parishioner_id = per.id and status = 'active' and org_unit_id in (v_from_jum, public.org_ancestor_of_type(v_from_jum, 'kigango'))
       and org_unit_id is distinct from public.org_ancestor_of_type(v_to_jum, 'kigango');
  end if;
  if p_move_money then
    n := public.reattribute_money(per.id, null, v_from_jum, v_to_jum, v_to_fam);
  end if;
  insert into public.audit_log (actor_id, action, table_name, row_id, new_data, note)
  values (auth.uid(), 'move_parishioner', 'parishioners', per.id::text,
          jsonb_build_object('from_jumuiya', v_from_jum, 'to_jumuiya', v_to_jum, 'from_family', per.family_id, 'to_family', v_to_fam,
                             'payments_moved', n, 'move_money', p_move_money), nullif(btrim(p_reason), ''));
  return jsonb_build_object('family_id', v_to_fam, 'jumuiya_id', v_to_jum, 'payments_moved', n);
end $$;
revoke execute on function public.move_parishioner(uuid, uuid, uuid, text, boolean, text) from public, anon;
grant execute on function public.move_parishioner(uuid, uuid, uuid, text, boolean, text) to authenticated;

-- move a whole family (and its members) to another jumuiya
create or replace function public.move_family(p_family uuid, p_jumuiya uuid, p_move_money boolean default true, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  fam public.families;
  n int := 0;
begin
  select * into fam from public.families where id = p_family;
  if fam.id is null then raise exception 'Familia haipo' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.org_units where id = p_jumuiya and unit_type = 'jumuiya') then
    raise exception 'Chagua jumuiya inayohamia' using errcode = 'P0001';
  end if;
  if fam.jumuiya_id is not distinct from p_jumuiya then
    raise exception 'Familia iko tayari kwenye jumuiya hiyo' using errcode = 'P0001';
  end if;
  if not public.has_perm('registry.write', fam.jumuiya_id) or not public.has_perm('registry.write', p_jumuiya) then
    raise exception 'Huna ruhusa ya kuhamisha familia hii (permission denied)' using errcode = '42501';
  end if;
  -- the families trigger moves its members and writes membership_history
  update public.families set jumuiya_id = p_jumuiya,
         status = case when status = 'moved' then 'active' else status end
   where id = fam.id;
  update public.membership_history set reason = nullif(btrim(p_reason), '')
   where id = (select max(id) from public.membership_history where family_id = fam.id);
  if p_move_money then
    n := public.reattribute_money(null, fam.id, fam.jumuiya_id, p_jumuiya, null);
  end if;
  insert into public.audit_log (actor_id, action, table_name, row_id, new_data, note)
  values (auth.uid(), 'move_family', 'families', fam.id::text,
          jsonb_build_object('from_jumuiya', fam.jumuiya_id, 'to_jumuiya', p_jumuiya, 'payments_moved', n, 'move_money', p_move_money),
          nullif(btrim(p_reason), ''));
  return jsonb_build_object('jumuiya_id', p_jumuiya, 'payments_moved', n);
end $$;
revoke execute on function public.move_family(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.move_family(uuid, uuid, boolean, text) to authenticated;

-- remove a member from the register. Their payments stay: they keep the
-- payer's name, family and jumuiya; only the link to the person is cleared.
-- Their pledges pass to their family (or jumuiya) so nothing paid is lost.
create or replace function public.delete_parishioner(p_parishioner uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  per public.parishioners;
  pl record;
  v_jum uuid;
  n_tx int := 0; n_pl int := 0;
begin
  select * into per from public.parishioners where id = p_parishioner;
  if per.id is null then raise exception 'Muumini hayupo' using errcode = 'P0001'; end if;
  v_jum := coalesce(per.jumuiya_id, (select jumuiya_id from public.families where id = per.family_id));
  if not public.has_perm('registry.write', v_jum) then
    raise exception 'Huna ruhusa ya kumfuta muumini huyu (permission denied)' using errcode = '42501';
  end if;

  perform set_config('minga.reattribute', 'on', true);
  update public.finance_transactions
     set payer_name = coalesce(nullif(btrim(payer_name), ''), per.full_name),
         family_id = coalesce(family_id, per.family_id),
         parishioner_id = null
   where parishioner_id = per.id;
  get diagnostics n_tx = row_count;
  perform set_config('minga.reattribute', 'off', true);

  for pl in select * from public.pledges where parishioner_id = per.id loop
    -- an active pledge whose new owner already has one for the campaign is closed
    if pl.status = 'active' and exists (
         select 1 from public.pledges x where x.campaign_id = pl.campaign_id and x.status = 'active' and x.id <> pl.id
           and coalesce(x.parishioner_id, x.family_id, x.org_unit_id) = coalesce(per.family_id, v_jum)) then
      update public.pledges set status = 'cancelled', status_reason = 'Muumini amefutwa kwenye rejista' where id = pl.id;
    end if;
    update public.pledges set parishioner_id = null,
           family_id = per.family_id,
           org_unit_id = case when per.family_id is null then v_jum end
     where id = pl.id;
    n_pl := n_pl + 1;
  end loop;

  update public.envelopes set parishioner_id = null, family_id = coalesce(family_id, per.family_id) where parishioner_id = per.id;
  update public.leadership_assignments set parishioner_id = null,
         status = 'ended', ends_on = case when status = 'active' then greatest(coalesce(starts_on, current_date), current_date) else ends_on end
   where parishioner_id = per.id;
  insert into public.audit_log (actor_id, action, table_name, row_id, old_data, note)
  values (auth.uid(), 'delete_parishioner', 'parishioners', per.id::text, to_jsonb(per) || jsonb_build_object('payments_kept', n_tx, 'pledges_moved', n_pl),
          nullif(btrim(p_reason), ''));
  delete from public.parishioners where id = per.id;
  return jsonb_build_object('payments_kept', n_tx, 'pledges_moved', n_pl);
end $$;
revoke execute on function public.delete_parishioner(uuid, text) from public, anon;
grant execute on function public.delete_parishioner(uuid, text) to authenticated;

notify pgrst, 'reload schema';
