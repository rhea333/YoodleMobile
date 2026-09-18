-- 0007_location_rpcs.sql
-- Yoodle — the two location reads clients are allowed to make.
--
-- Both are SECURITY INVOKER (the default), NOT definer: that keeps RLS on
-- public.jobs in force inside the function, so nearby_jobs can never return a
-- draft or someone else's unpublished job.

-- ---------------------------------------------------------------------------
-- Radius search over the COARSE location. This is the public job-browsing
-- query. ST_DWithin on a geography column uses the GIST index from 0003.
--
-- Parameters are p_-prefixed so they cannot be confused with the output
-- columns of the same name inside the function body.
-- ---------------------------------------------------------------------------
create or replace function public.nearby_jobs(
  p_lat float,
  p_long float,
  p_radius_meters float
)
returns table (
  id              uuid,
  title           text,
  category        text,
  budget          numeric,
  status          text,
  lat             double precision,
  long            double precision,
  distance_meters double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    j.id,
    j.title,
    j.category,
    j.budget,
    j.status,
    j.coarse_lat  as lat,
    j.coarse_long as long,
    extensions.st_distance(
      j.location_coarse,
      extensions.st_setsrid(extensions.st_point(p_long, p_lat), 4326)::extensions.geography
    ) as distance_meters
  from public.jobs j
  where j.location_coarse is not null
    and extensions.st_dwithin(
      j.location_coarse,
      extensions.st_setsrid(extensions.st_point(p_long, p_lat), 4326)::extensions.geography,
      p_radius_meters
    )
  order by distance_meters asc;
$$;

comment on function public.nearby_jobs(float, float, float) is
  'Radius search over the coarse (neighbourhood) location. Never exposes the exact point.';

grant execute on function public.nearby_jobs(float, float, float) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The exact point, for the two people who legitimately need to get there.
--
-- SECURITY DEFINER is required: SELECT on jobs.location is revoked from
-- authenticated, so an invoker-rights function could not read it either. The
-- authorisation check is therefore this function's entire job — it returns zero
-- rows for anyone who is not the poster or the accepted worker.
-- ---------------------------------------------------------------------------
create or replace function public.job_exact_location(p_job_id uuid)
returns table (lat double precision, long double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select
    extensions.st_y(j.location::extensions.geometry) as lat,
    extensions.st_x(j.location::extensions.geometry) as long
  from public.jobs j
  where j.id = p_job_id
    and j.location is not null
    and (app.is_job_poster(p_job_id) or app.is_accepted_worker(p_job_id));
$$;

comment on function public.job_exact_location(uuid) is
  'Exact job location. Returns rows ONLY for the job poster or the worker whose offer was accepted.';

-- Deliberately NOT granted to anon.
grant execute on function public.job_exact_location(uuid) to authenticated;
