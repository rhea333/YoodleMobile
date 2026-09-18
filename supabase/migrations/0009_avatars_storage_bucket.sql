-- 0009_avatars_storage_bucket.sql
-- Yoodle — the `avatars` bucket and its owner-only write policies.
--
-- Paired with the client-side checks in /src/services/profiles.ts. That copy
-- exists to fail fast with a readable message; THIS file is the boundary that
-- actually holds, because it survives a modified client.

-- Public bucket, but writes are owner-only and constrained server-side.
-- file_size_limit and allowed_mime_types are enforced by Storage itself, so a
-- client that skips the app's own pre-upload validation still cannot abuse it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true, 5242880,
  array['image/jpeg','image/png','image/webp','image/heic']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatars_read_all on storage.objects;
drop policy if exists avatars_insert_own_folder on storage.objects;
drop policy if exists avatars_update_own_folder on storage.objects;
drop policy if exists avatars_delete_own_folder on storage.objects;

-- Public bucket: anyone may read.
create policy avatars_read_all
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');

-- Writes are confined to a folder named after the caller's own uid, so one user
-- can never overwrite another's avatar. storage.foldername() splits the path;
-- element 1 is the first segment.
create policy avatars_insert_own_folder
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_update_own_folder
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_delete_own_folder
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
