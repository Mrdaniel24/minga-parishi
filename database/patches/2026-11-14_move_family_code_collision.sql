-- Run this patch in Supabase SQL Editor to allow whole-family transfers when
-- the destination jumuiya already has a family using the same local code.
create or replace function public.move_family(p_family uuid, p_jumuiya uuid, p_move_money boolean default true, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  fam public.families;
  n int := 0;
  v_family_code text;
  v_suffix int := 2;
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

  v_family_code := fam.family_code;
  if v_family_code is not null and exists (
    select 1 from public.families f
     where f.parish_id = fam.parish_id and f.jumuiya_id = p_jumuiya and f.family_code = v_family_code
  ) then
    loop
      v_family_code := coalesce(nullif(btrim(fam.family_code), ''), 'FAM') || '-' || v_suffix::text;
      exit when not exists (
        select 1 from public.families f
         where f.parish_id = fam.parish_id and f.jumuiya_id = p_jumuiya and f.family_code = v_family_code
      );
      v_suffix := v_suffix + 1;
    end loop;
  end if;

  -- The families trigger moves members and records membership_history.
  update public.families set jumuiya_id = p_jumuiya,
         family_code = v_family_code,
         status = case when status = 'moved' then 'active' else status end
   where id = fam.id;
  update public.membership_history set reason = nullif(btrim(p_reason), '')
   where id = (select max(id) from public.membership_history where family_id = fam.id);
  if p_move_money then
    n := public.reattribute_money(null, fam.id, fam.jumuiya_id, p_jumuiya, null);
  end if;
  insert into public.audit_log (actor_id, action, table_name, row_id, old_data, new_data, note)
  values (auth.uid(), 'move_family', 'families', fam.id::text,
          jsonb_build_object('family_code', fam.family_code, 'jumuiya_id', fam.jumuiya_id),
          jsonb_build_object('family_code', v_family_code, 'jumuiya_id', p_jumuiya,
                             'payments_moved', n, 'move_money', p_move_money),
          nullif(btrim(p_reason), ''));
  return jsonb_build_object('jumuiya_id', p_jumuiya, 'payments_moved', n,
                            'previous_family_code', fam.family_code, 'family_code', v_family_code);
end $$;
revoke execute on function public.move_family(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.move_family(uuid, uuid, boolean, text) to authenticated;
