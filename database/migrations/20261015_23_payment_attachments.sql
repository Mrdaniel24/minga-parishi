-- ============================================================================
-- Minga Parish Management System — migration 23: proof of payment (optional)
--   A photo of the bank slip or a PDF can be attached to any payment, when it
--   is recorded or later. Files live in the private Storage bucket
--   "payment-proofs" under <transaction id>/…; this table says which payment a
--   file belongs to. Whoever can see the payment can see its proof.
-- ============================================================================

create table if not exists public.transaction_attachments (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references public.finance_transactions(id),
  storage_path    text not null,                 -- path inside the bucket payment-proofs
  file_name       text not null,
  mime_type       text,
  size_bytes      bigint,
  uploaded_by     uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index if not exists transaction_attachments_txn_idx on public.transaction_attachments (transaction_id);

alter table public.transaction_attachments enable row level security;
drop policy if exists ta_read on public.transaction_attachments;
create policy ta_read on public.transaction_attachments for select to authenticated using (
  exists (select 1 from public.finance_transactions t where t.id = transaction_id));
-- written only through add_payment_attachment (no insert/update/delete policy)
revoke insert, update, delete on public.transaction_attachments from anon, authenticated;
grant select on public.transaction_attachments to authenticated;

-- record an uploaded file against one payment, or every line of one batch
--   p: transaction_ids: [uuid], storage_path, file_name, mime_type, size_bytes
create or replace function public.add_payment_attachment(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_path text := btrim(coalesce(p->>'storage_path', ''));
  v_mime text := lower(coalesce(p->>'mime_type', ''));
  v_size bigint := nullif(p->>'size_bytes', '')::bigint;
  v_id uuid; t public.finance_transactions; n int := 0;
begin
  if v_path = '' or v_path like '%..%' then raise exception 'Faili halijulikani' using errcode = 'P0001'; end if;
  if v_mime <> 'application/pdf' and v_mime not like 'image/%' then
    raise exception 'Weka picha au PDF tu' using errcode = 'P0001';
  end if;
  if v_size > 10 * 1024 * 1024 then raise exception 'Faili ni kubwa mno (mwisho MB 10)' using errcode = 'P0001'; end if;
  if jsonb_typeof(p->'transaction_ids') <> 'array' or jsonb_array_length(p->'transaction_ids') = 0 then
    raise exception 'Chagua muamala' using errcode = 'P0001';
  end if;
  for v_id in select distinct x::uuid from jsonb_array_elements_text(p->'transaction_ids') x loop
    select * into t from public.finance_transactions where id = v_id;
    if t.id is null then raise exception 'Muamala haupo' using errcode = 'P0001'; end if;
    if not public.has_perm('finance.record', coalesce(t.org_unit_id, t.jumuiya_id)) then
      raise exception 'Huna ruhusa ya kuambatisha uthibitisho (permission denied)' using errcode = '42501';
    end if;
    insert into public.transaction_attachments (transaction_id, storage_path, file_name, mime_type, size_bytes)
    values (t.id, v_path, left(coalesce(nullif(btrim(p->>'file_name'), ''), 'uthibitisho'), 200), v_mime, v_size);
    n := n + 1;
  end loop;
  insert into public.audit_log (actor_id, action, table_name, row_id, new_data)
  values (auth.uid(), 'add_payment_attachment', 'transaction_attachments', v_path, p);
  return jsonb_build_object('status', 'saved', 'count', n);
end $$;
revoke execute on function public.add_payment_attachment(jsonb) from public, anon;
grant execute on function public.add_payment_attachment(jsonb) to authenticated;

-- Storage (only on Supabase; skipped where there is no storage schema, e.g. the tests)
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then return; end if;
  execute $q$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
           values ('payment-proofs', 'payment-proofs', false, 10485760,
                   array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
           on conflict (id) do nothing$q$;
  execute 'drop policy if exists payment_proofs_insert on storage.objects';
  execute $q$create policy payment_proofs_insert on storage.objects for insert to authenticated with check (
             bucket_id = 'payment-proofs' and exists (
               select 1 from public.finance_transactions t
                where t.id::text = split_part(name, '/', 1)
                  and public.has_perm('finance.record', coalesce(t.org_unit_id, t.jumuiya_id))))$q$;
  execute 'drop policy if exists payment_proofs_read on storage.objects';
  execute $q$create policy payment_proofs_read on storage.objects for select to authenticated using (
             bucket_id = 'payment-proofs' and exists (
               select 1 from public.finance_transactions t where t.id::text = split_part(name, '/', 1)))$q$;
end $$;

notify pgrst, 'reload schema';
