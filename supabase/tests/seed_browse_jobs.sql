-- seed_browse_jobs.sql
-- Test data for the phase 4 browse screen. NOT a migration — run it by hand.
--
-- Reference centre: 43.65, -79.38 (downtown Toronto).
--
-- Every seeded point sits exactly ON the 2-decimal-place grid, so the coarse
-- rounding in `app.derive_coarse_location` is a no-op and the distance the app
-- shows is the distance intended here. Seeding at, say, 43.6537 would round to
-- 43.65 and quietly move the job up to ~400 m — which would make a radius test
-- unreadable.
--
-- 0.01 degree of latitude  = ~1.11 km.
-- 0.01 degree of longitude = ~0.81 km at this latitude.
--
-- Idempotent: re-running replaces the seeded rows and leaves everything else.

begin;

-- Migration 0014 added a 10-jobs-per-hour posting limit, and this fixture
-- inserts 54 rows for a single poster. The trigger is suppressed for the
-- duration of the seed and restored before commit — a fixture is not the thing
-- the limit exists to stop, and leaving it off would silently disable the limit
-- for everyone.
alter table public.jobs disable trigger jobs_rate_limit;

delete from public.jobs where title like 'Seed %';

-- ---------------------------------------------------------------------------
-- 45 jobs at ONE coarse point, all therefore at an IDENTICAL distance.
--
-- Two things depend on the size of this cluster:
--
--   * PAGINATION. With a page size of 20, page boundaries fall INSIDE the tied
--     group. That is exactly where offset pagination breaks if the sort is not
--     a total order: ordered by distance alone these rows could come back in a
--     different sequence per query, duplicating some on page 2 and skipping
--     others entirely.
--   * THE LIMIT CAP. It takes more than 50 in-range rows for browse_jobs's
--     50-row ceiling to actually bind. Below that the cap is untested
--     arithmetic rather than demonstrated behaviour.
-- ---------------------------------------------------------------------------
insert into public.jobs (poster_id, title, description, category, budget, location, status)
select
  p.id,
  'Seed tie ' || lpad(g::text, 2, '0'),
  'One of 45 jobs at the same coarse point, for pagination ordering. #' || g,
  (array['outdoor', 'indoor', 'pets', 'moving', 'cleaning'])[1 + (g % 5)],
  20 + g,
  extensions.st_setsrid(extensions.st_point(-79.38, 43.66), 4326)::extensions.geography,
  'published'
from generate_series(1, 45) g
cross join (select id from public.profiles where display_name = 'Account A' limit 1) p;

-- ---------------------------------------------------------------------------
-- Known distances from 43.65,-79.38, for the radius test. The default browse
-- radius is 10 km, so the last three should NOT appear until it is widened.
-- ---------------------------------------------------------------------------
insert into public.jobs (poster_id, title, description, category, budget, location, status)
select
  p.id, v.title, v.description, v.category, v.budget,
  extensions.st_setsrid(extensions.st_point(v.long, v.lat), 4326)::extensions.geography,
  'published'
from (values
  ('Seed 000m - same block',      'Distance ~0 m. Should always be first.',        'indoor',   30.00, 43.65, -79.38),
  ('Seed 1.1km - one grid north', 'Distance ~1.11 km.',                            'outdoor',  45.00, 43.66, -79.38),
  ('Seed 2.2km - two grids',      'Distance ~2.22 km.',                            'pets',     25.00, 43.67, -79.38),
  ('Seed 5.6km - five grids',     'Distance ~5.56 km.',                            'moving',   90.00, 43.70, -79.38),
  ('Seed 8.9km - inside 10km',    'Distance ~8.89 km. Last one inside the default radius.', 'cleaning', 55.00, 43.73, -79.38),
  ('Seed 11.1km - outside 10km',  'Distance ~11.11 km. Should be HIDDEN by default.',       'outdoor',  70.00, 43.75, -79.38),
  ('Seed 16.7km - well outside',  'Distance ~16.68 km. Should be HIDDEN by default.',       'indoor',   40.00, 43.80, -79.38),
  ('Seed 38.9km - far outside',   'Distance ~38.9 km. Inside the 50 km cap, outside any sane browse radius.', 'tech', 120.00, 44.00, -79.38)
) as v(title, description, category, budget, lat, long)
cross join (select id from public.profiles where display_name = 'Account A' limit 1) p;

-- A draft 1.1 km away. It must NEVER appear in browse results, including for
-- its own poster — that is the bug `browse_jobs` fixes over `nearby_jobs`.
insert into public.jobs (poster_id, title, description, category, budget, location, status)
select
  p.id,
  'Seed DRAFT - must never appear',
  'Unpublished. Visible to its poster via RLS, but browse_jobs filters on status.',
  'outdoor', 15.00,
  extensions.st_setsrid(extensions.st_point(-79.38, 43.66), 4326)::extensions.geography,
  'draft'
from (select id from public.profiles where display_name = 'Account A' limit 1) p;

alter table public.jobs enable trigger jobs_rate_limit;

commit;
