-- 0001_extensions_and_helpers.sql
-- Yoodle — prerequisites for every later migration. Run this first.
--
-- PostGIS is NOT created here on purpose. Per Supabase's docs, PostGIS 2.3+ is
-- not relocatable between schemas, so where it lands is a one-time, effectively
-- irreversible choice. Enable it from the dashboard (Database -> Extensions ->
-- postgis -> "Create a new schema") or run, once, as a superuser:
--
--     create extension postgis with schema "extensions";
--
-- Every later migration assumes it lives in "extensions" and schema-qualifies
-- accordingly (extensions.geography, extensions.st_dwithin, ...). If you put it
-- somewhere else, search-and-replace that prefix before running anything.

-- Fail fast and loudly rather than producing a half-built schema.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'postgis') then
    raise exception
      'PostGIS is not enabled. Enable it into the "extensions" schema before running these migrations.';
  end if;

  if not exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'postgis' and n.nspname = 'extensions'
  ) then
    raise warning
      'PostGIS is enabled but NOT in the "extensions" schema. These migrations schema-qualify as extensions.*, so they will fail. See the header of this file.';
  end if;
end
$$;

-- nearby_jobs() runs with the CALLER's privileges (security invoker, so that
-- RLS still applies), which means the caller needs to reach the PostGIS
-- functions itself. Supabase grants this by default; re-asserted here so a
-- locked-down project does not fail confusingly at query time.
--
-- Wrapped because granting on a schema you do not own raises — and that is a
-- reason to warn, not a reason to abandon the migration.
do $$
begin
  grant usage on schema extensions to anon, authenticated;
exception
  when insufficient_privilege or others then
    raise warning
      'Could not grant usage on schema extensions (%). This is usually already granted by Supabase; if nearby_jobs() later fails with "permission denied", grant it manually as the postgres role.',
      sqlerrm;
end
$$;

-- ---------------------------------------------------------------------------
-- Private helper schema.
--
-- RLS policies that query other tables can recurse (a policy on `messages`
-- reading `jobs`, whose own policy reads `offers`, ...) and are re-evaluated per
-- row. These helpers are SECURITY DEFINER so they read past RLS once, which
-- both breaks the recursion and keeps the policies readable.
--
-- SECURITY DEFINER is only safe because each function below is narrow, takes no
-- free-form SQL, pins `search_path`, and answers a single boolean question
-- about a specific job. Do not add a function here that returns table data.
--
-- WHY plpgsql AND NOT sql: a `language sql` body is name-resolved at CREATE
-- time, so these would fail here — public.jobs and public.offers do not exist
-- until 0003/0004. plpgsql bodies resolve on first execution instead, which
-- keeps this file first and one-table-per-file intact. There is no meaningful
-- performance cost: SECURITY DEFINER functions are never inlined either way.
-- ---------------------------------------------------------------------------
create schema if not exists app;

revoke all on schema app from public;
grant usage on schema app to authenticated, anon;

-- Is the calling user the poster of this job?
create or replace function app.is_job_poster(p_job_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1 from public.jobs j
    where j.id = p_job_id and j.poster_id = auth.uid()
  );
end
$$;

-- Has the calling user made any offer on this job (any status)?
create or replace function app.has_offer_on_job(p_job_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1 from public.offers o
    where o.job_id = p_job_id and o.worker_id = auth.uid()
  );
end
$$;

-- Is the calling user the worker whose offer was ACCEPTED on this job?
create or replace function app.is_accepted_worker(p_job_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1 from public.offers o
    where o.job_id = p_job_id
      and o.worker_id = auth.uid()
      and o.status = 'accepted'
  );
end
$$;

-- Is the calling user either side of this job? Used by messages and reviews.
create or replace function app.is_job_participant(p_job_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return app.is_job_poster(p_job_id) or app.has_offer_on_job(p_job_id);
end
$$;

-- The same two questions, but about an ARBITRARY user rather than the caller.
-- Needed by the messages INSERT policy, which must validate the *recipient*.
create or replace function app.is_job_poster_id(p_job_id uuid, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1 from public.jobs j
    where j.id = p_job_id and j.poster_id = p_user_id
  );
end
$$;

create or replace function app.has_offer_on_job_as(p_job_id uuid, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1 from public.offers o
    where o.job_id = p_job_id and o.worker_id = p_user_id
  );
end
$$;

-- Does this job exist and is it in a given status?
create or replace function app.job_has_status(p_job_id uuid, p_status text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1 from public.jobs j
    where j.id = p_job_id and j.status = p_status
  );
end
$$;

grant execute on function
  app.is_job_poster(uuid),
  app.has_offer_on_job(uuid),
  app.is_accepted_worker(uuid),
  app.is_job_participant(uuid),
  app.is_job_poster_id(uuid, uuid),
  app.has_offer_on_job_as(uuid, uuid),
  app.job_has_status(uuid, text)
to authenticated;

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest.
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;
