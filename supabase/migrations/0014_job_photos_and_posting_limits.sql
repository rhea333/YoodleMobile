-- 0014_job_photos_and_posting_limits.sql
-- Yoodle — what the posting flow needs: photo storage, a description ceiling,
-- and a rate limit on posting.

-- ---------------------------------------------------------------------------
-- 1. Photos. Stored as an array of STORAGE PATHS, not URLs.
--
-- Paths rather than URLs because a URL bakes in the project ref and the
-- public/private decision at write time; a path lets the client build whichever
-- URL is right today, and survives the bucket being made private later.
--
-- An array column rather than a job_photos table: the cap is 3, there is no
-- per-photo metadata, and the array inherits the jobs row's RLS for free
-- instead of needing its own four policies kept in sync with the parent.
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists photo_paths text[] not null default '{}';

comment on column public.jobs.photo_paths is
  'Storage paths in the job-photos bucket, max 3. EXIF is stripped client-side by re-encoding before upload.';

alter table public.jobs drop constraint if exists jobs_photo_paths_max;
alter table public.jobs add constraint jobs_photo_paths_max
  check (coalesce(array_length(photo_paths, 1), 0) <= 3);

-- Reject a path that does not start with the poster's own uid folder. The
-- storage policies below already stop a user WRITING outside their folder; this
-- stops them RECORDING someone else's path against their job, which would make
-- the listing display another user's image.
--
-- A trigger rather than a CHECK constraint: verifying "every element matches"
-- needs to unnest the array, and PostgreSQL does not permit a subquery inside a
-- CHECK.
create or replace function app.validate_job_photo_paths()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_path text;
begin
  if new.photo_paths is null or array_length(new.photo_paths, 1) is null then
    return new;
  end if;

  foreach v_path in array new.photo_paths loop
    if v_path not like new.poster_id::text || '/%' then
      raise exception 'Job photo path % must live under the poster''s own folder.', v_path
        using errcode = 'check_violation';
    end if;
  end loop;

  return new;
end
$$;

drop trigger if exists jobs_validate_photo_paths on public.jobs;
create trigger jobs_validate_photo_paths
  before insert or update of photo_paths on public.jobs
  for each row execute function app.validate_job_photo_paths();

-- ---------------------------------------------------------------------------
-- 2. A ceiling on the free-text description.
--
-- The client sanitises and truncates, but the client is not the boundary. 4000
-- characters is far past any real listing and well short of a payload that
-- makes a row expensive to move around.
-- ---------------------------------------------------------------------------
alter table public.jobs drop constraint if exists jobs_description_length;
alter table public.jobs add constraint jobs_description_length
  check (description is null or char_length(description) <= 4000);

-- ---------------------------------------------------------------------------
-- 3. Posting rate limit.
--
-- The spec allowed logging this as an open item; it is cheap enough to enforce
-- properly. Enforced in a trigger rather than the client for the obvious
-- reason: a scripted poster does not run the client.
--
-- 10 per rolling hour per poster. Well above any genuine use (and above manual
-- testing), low enough that flooding a neighbourhood takes visible effort.
-- Counts ALL statuses, so deleting or cancelling does not reset the budget.
--
-- This is per-account, so it does not stop someone registering many accounts.
-- That is a signup-side problem; see SECURITY.md.
-- ---------------------------------------------------------------------------
create or replace function app.enforce_job_post_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent int;
  v_limit  constant int := 10;
begin
  select count(*) into v_recent
  from public.jobs
  where poster_id = new.poster_id
    and created_at > now() - interval '1 hour';

  if v_recent >= v_limit then
    raise exception 'Too many jobs posted in the last hour. Please try again later.'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

drop trigger if exists jobs_rate_limit on public.jobs;
create trigger jobs_rate_limit
  before insert on public.jobs
  for each row execute function app.enforce_job_post_rate_limit();

-- ---------------------------------------------------------------------------
-- 4. Column privileges for the new column, following 0003's pattern: the
-- blanket grant was revoked there, so a new column is invisible and unwritable
-- until named here.
-- ---------------------------------------------------------------------------
grant select (photo_paths) on public.jobs to anon, authenticated;
grant insert (photo_paths), update (photo_paths) on public.jobs to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The job-photos bucket. Same shape as avatars (0009): public read, writes
-- confined to a folder named after the caller's uid, limits enforced by Storage
-- itself so a modified client cannot exceed them.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-photos', 'job-photos', true, 5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists job_photos_read_all on storage.objects;
drop policy if exists job_photos_insert_own_folder on storage.objects;
drop policy if exists job_photos_update_own_folder on storage.objects;
drop policy if exists job_photos_delete_own_folder on storage.objects;

create policy job_photos_read_all
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'job-photos');

create policy job_photos_insert_own_folder
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy job_photos_update_own_folder
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy job_photos_delete_own_folder
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
