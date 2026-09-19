-- seed_test_data.sql
-- THROWAWAY PROJECT ONLY. Never run against production.
--
-- Creates deterministic geography so the radius assertions below have exact,
-- checkable answers. Distances are from Toronto City Hall (43.6532, -79.3832).
--
-- PREREQUISITE: create two accounts first (Authentication -> Users -> Add user,
-- or via the app's signUpWithEmail), then paste their UUIDs here.

do $$
declare
  -- ⬇⬇ REPLACE THESE TWO ⬇⬇
  user_a uuid := '00000000-0000-0000-0000-00000000000a';
  user_b uuid := '00000000-0000-0000-0000-00000000000b';
  job_a  uuid;
begin
  if not exists (select 1 from auth.users where id = user_a)
     or not exists (select 1 from auth.users where id = user_b) then
    raise exception 'Replace user_a/user_b with real auth.users UUIDs before running this.';
  end if;

  update public.profiles set display_name = 'Account A' where id = user_a;
  update public.profiles set display_name = 'Account B' where id = user_b;

  -- A's published job, at City Hall exactly.
  insert into public.jobs (poster_id, title, category, budget, location, status)
  values (
    user_a, 'Shovel my driveway', 'outdoor', 40.00,
    extensions.st_setsrid(extensions.st_point(-79.3832, 43.6532), 4326)::extensions.geography,
    'published'
  )
  returning id into job_a;

  -- ~1.4 km north of City Hall.
  insert into public.jobs (poster_id, title, category, budget, location, status)
  values (
    user_a, 'Assemble a bookshelf', 'indoor', 60.00,
    extensions.st_setsrid(extensions.st_point(-79.3832, 43.6658), 4326)::extensions.geography,
    'published'
  );

  -- ~11 km away — outside a 5 km radius.
  insert into public.jobs (poster_id, title, category, budget, location, status)
  values (
    user_a, 'Dog walking in Scarborough', 'pets', 25.00,
    extensions.st_setsrid(extensions.st_point(-79.2600, 43.7000), 4326)::extensions.geography,
    'published'
  );

  -- A DRAFT at City Hall. Must NEVER appear in browse results for anyone,
  -- including A: browse_jobs filters on status rather than trusting RLS.
  insert into public.jobs (poster_id, title, category, budget, location, status)
  values (
    user_a, 'Draft job - should stay hidden', 'outdoor', 10.00,
    extensions.st_setsrid(extensions.st_point(-79.3832, 43.6532), 4326)::extensions.geography,
    'draft'
  );

  -- B offers on A's first job, so B is a participant and may message A.
  insert into public.offers (job_id, worker_id, amount, status)
  values (job_a, user_b, 35.00, 'pending');

  insert into public.messages (job_id, sender_id, recipient_id, body)
  values (job_a, user_b, user_a, 'Hi, I can come by Saturday morning.');

  raise notice 'Seeded. Job A id = %', job_a;
end
$$;

-- ---------------------------------------------------------------------------
-- Expected results, as the SERVICE ROLE (bypasses RLS — ground truth).
-- ---------------------------------------------------------------------------

-- Coarse rounding: City Hall 43.6532,-79.3832 must become 43.65,-79.38.
select title, coarse_lat, coarse_long
from public.jobs
order by title;

-- These three checks used to go through public.nearby_jobs(). That function was
-- dropped in migration 0012 (superseded by browse_jobs, and an uncapped,
-- draft-leaking endpoint in its own right). They now hit public.jobs directly,
-- which keeps them as GROUND TRUTH: browse_jobs deliberately hides drafts, so
-- running these through it would defeat the point of the draft row below.

-- 5 km radius from City Hall.
-- EXPECT exactly 3 rows: 'Shovel my driveway' (~0 m),
--   'Assemble a bookshelf' (~1.4 km), and 'Draft job - should stay hidden'
--   (~0 m) — the draft appears HERE only because the service role bypasses RLS.
select
  title,
  round(extensions.st_distance(
    location_coarse,
    extensions.st_setsrid(extensions.st_point(-79.3832, 43.6532), 4326)::extensions.geography
  )) as metres
from public.jobs
where location_coarse is not null
  and extensions.st_dwithin(
    location_coarse,
    extensions.st_setsrid(extensions.st_point(-79.3832, 43.6532), 4326)::extensions.geography,
    5000)
order by metres;

-- 20 km radius: EXPECT all 4 rows, Scarborough last at ~11 km.
select
  title,
  round(extensions.st_distance(
    location_coarse,
    extensions.st_setsrid(extensions.st_point(-79.3832, 43.6532), 4326)::extensions.geography
  )) as metres
from public.jobs
where location_coarse is not null
  and extensions.st_dwithin(
    location_coarse,
    extensions.st_setsrid(extensions.st_point(-79.3832, 43.6532), 4326)::extensions.geography,
    20000)
order by metres;

-- 500 m radius: EXPECT 2 rows (City Hall job + the draft), NOT the bookshelf.
select
  title,
  round(extensions.st_distance(
    location_coarse,
    extensions.st_setsrid(extensions.st_point(-79.3832, 43.6532), 4326)::extensions.geography
  )) as metres
from public.jobs
where location_coarse is not null
  and extensions.st_dwithin(
    location_coarse,
    extensions.st_setsrid(extensions.st_point(-79.3832, 43.6532), 4326)::extensions.geography,
    500)
order by metres;
