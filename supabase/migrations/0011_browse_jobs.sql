-- 0011_browse_jobs.sql
-- Yoodle — the paginated, filtered job-browsing read.
--
-- `nearby_jobs` (0007) is kept as-is, but it is not what the browse screen can
-- use. Three reasons:
--
--   1. NO STATUS FILTER. It leans entirely on RLS, and `jobs_select_own` lets a
--      poster read their OWN drafts — so a poster browsing their neighbourhood
--      would see their unpublished drafts mixed in with real listings.
--   2. NO PAGINATION. It returns every job in the radius in one response, which
--      is both a scraping surface and unusable on a phone.
--   3. No category or text filter, which the browse UI needs.
--
-- Both functions are SECURITY INVOKER so RLS stays in force inside them.

-- ---------------------------------------------------------------------------
-- ANTI-SCRAPE CAPS. Enforced HERE rather than in the client, because a caller
-- can send whatever arguments it likes:
--
--   radius  clamped to 500 m .. 50 km   — one call cannot sweep the country
--   limit   clamped to 1 .. 50          — one call cannot drain the radius
--   offset  clamped to 0 .. 500         — deep paging cannot walk past ~550
--                                         rows without moving the centre
--
-- The offset ceiling is the load-bearing one: without it, limit alone only
-- changes how many requests a scraper needs, not what it can ultimately reach.
-- ---------------------------------------------------------------------------
create or replace function public.browse_jobs(
  p_lat            float,
  p_long           float,
  p_radius_meters  float default 10000,
  p_category       text  default null,
  p_search         text  default null,
  p_limit          int   default 20,
  p_offset         int   default 0
)
returns table (
  id              uuid,
  poster_id       uuid,
  title           text,
  description     text,
  category        text,
  budget          numeric,
  lat             double precision,
  long            double precision,
  distance_meters double precision,
  created_at      timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    q.id, q.poster_id, q.title, q.description, q.category, q.budget,
    q.lat, q.long, q.distance_meters, q.created_at
  from (
    select
      j.id,
      j.poster_id,
      j.title,
      j.description,
      j.category,
      j.budget,
      j.coarse_lat  as lat,
      j.coarse_long as long,
      extensions.st_distance(
        j.location_coarse,
        extensions.st_setsrid(extensions.st_point(p_long, p_lat), 4326)::extensions.geography
      ) as distance_meters,
      j.created_at
    from public.jobs j
    where
      -- Explicit, not inherited from RLS. See reason 1 above.
      j.status = 'published'
      and j.location_coarse is not null
      and extensions.st_dwithin(
        j.location_coarse,
        extensions.st_setsrid(extensions.st_point(p_long, p_lat), 4326)::extensions.geography,
        least(greatest(coalesce(p_radius_meters, 10000), 500), 50000)
      )
      and (
        nullif(btrim(coalesce(p_category, '')), '') is null
        or j.category = btrim(p_category)
      )
      and (
        nullif(btrim(coalesce(p_search, '')), '') is null
        -- The wildcards in user input are escaped, so a search for "100%" looks
        -- for a literal percent sign instead of matching every row.
        or j.title ilike '%' || replace(replace(replace(btrim(p_search), '\', '\'), '%', '\%'), '_', '\_') || '%'
        or coalesce(j.description, '') ilike '%' || replace(replace(replace(btrim(p_search), '\', '\'), '%', '\%'), '_', '\_') || '%'
      )
  ) q
  -- A TOTAL order, which offset pagination depends on. Distance alone is not
  -- one: coarse locations are rounded to 2dp, so large groups of jobs share a
  -- distance exactly, and any tie would let rows shuffle between pages —
  -- showing duplicates on one page and skipping others entirely.
  order by q.distance_meters asc, q.created_at desc, q.id asc
  limit  least(greatest(coalesce(p_limit, 20), 1), 50)
  offset least(greatest(coalesce(p_offset, 0), 0), 500);
$$;

comment on function public.browse_jobs(float, float, float, text, text, int, int) is
  'Paginated neighbourhood job browse. Published only, coarse location only, with radius/limit/offset caps.';

grant execute on function public.browse_jobs(float, float, float, text, text, int, int)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The category chips. Derived from the jobs actually in range rather than from
-- a fixed taxonomy, so the UI cannot offer a filter that returns nothing, and
-- so no category list has to be invented and kept in sync.
-- ---------------------------------------------------------------------------
create or replace function public.nearby_job_categories(
  p_lat           float,
  p_long          float,
  p_radius_meters float default 10000
)
returns table (category text, job_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select j.category, count(*) as job_count
  from public.jobs j
  where j.status = 'published'
    and j.location_coarse is not null
    and extensions.st_dwithin(
      j.location_coarse,
      extensions.st_setsrid(extensions.st_point(p_long, p_lat), 4326)::extensions.geography,
      least(greatest(coalesce(p_radius_meters, 10000), 500), 50000)
    )
  group by j.category
  order by count(*) desc, j.category asc
  limit 24;
$$;

comment on function public.nearby_job_categories(float, float, float) is
  'Distinct categories among published jobs in range, with counts. Drives the browse filter chips.';

grant execute on function public.nearby_job_categories(float, float, float) to anon, authenticated;
