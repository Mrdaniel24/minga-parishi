-- Private per-user storage for profile photos.
-- Uploads are limited to 3 MB in the application and to the listed image types here.
do $$ begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then return; end if;
  execute $q$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('avatars', 'avatars', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = excluded.public,
      file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types$q$;
  execute 'drop policy if exists avatars_read on storage.objects';
  execute 'drop policy if exists avatars_read_own on storage.objects';
  execute $q$create policy avatars_read_own on storage.objects for select to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$q$;
  execute 'drop policy if exists avatars_insert_own on storage.objects';
  execute $q$create policy avatars_insert_own on storage.objects for insert to authenticated
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$q$;
  execute 'drop policy if exists avatars_update_own on storage.objects';
  execute $q$create policy avatars_update_own on storage.objects for update to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$q$;
  execute 'drop policy if exists avatars_delete_own on storage.objects';
  execute $q$create policy avatars_delete_own on storage.objects for delete to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)$q$;
end $$;
