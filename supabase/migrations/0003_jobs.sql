-- 0003_jobs.sql
-- Yoodle — jobs, with a two-tier location model.
--
-- LOCATION PRIVACY (the decision behind this design):
--   `location`        exact point. NOT readable by anon or authenticated.
--   `location_coarse` derived, rounded to ~1.1 km. This is what clients read.
--   coarse_lat/long   the same coarse point as plain floats, because PostgREST
--                     would otherwise hand the client useless WKB hex.
--
-- RLS is row-level, so it cannot hide a *column* from a user who may read the
-- row. Column-level REVOKE does that, and an RPC (0007) hands the exact point
-- only to the poster and the accepted worker.

create table if not exists public.jobs (
  id              uuid primary key default gen_random_uuid(),
  poster_id       uuid not null references public.profiles (id) on delete cascade,
  title           text not null,
  description     text,
  category        text not null,
  budget          numeric(10, 2),
  location        extensions.geography(Point, 4326),
  location_coarse extensions.geography(Point, 4326),
  coarse_lat      double precision,
  coarse_long     double precision,
  status          text not null default 'draft',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint jobs_title_length check (char_length(title) between 3 and 140),
  constraint jobs_budget_positive check (budget is null or budget >= 0),
  constraint jobs_status_valid
    check (status in ('draft', 'published', 'assigned', 'completed', 'cancelled'))
);

comment on column public.jobs.location is
  'EXACT point. SELECT is revoked from anon/authenticated — read via job_exact_location().';
comment on column public.jobs.location_coarse is
  'Neighbourhood-level point derived from location. Safe for public browsing.';

-- Spatial index for the radius search in 0007. Built on the coarse column,
-- since that is the only one public search may touch.
create index if not exists jobs_location_coarse_gix
  on public.jobs using gist (location_coarse);

create index if not exists jobs_status_created_idx
  on public.jobs (status, created_at desc);

create index if not exists jobs_poster_idx on public.jobs (poster_id);

-- ---------------------------------------------------------------------------
-- Derive the coarse location. Rounding to 2 decimal places of lat/long is
-- ~1.1 km at the equator and ~0.8 km at Canadian latitudes — neighbourhood
-- level, not street level.
--
-- Done in a trigger rather than a generated column so it cannot be bypassed by
-- a client writing location_coarse directly, and so it is not subject to the
-- IMMUTABLE requirements generated columns impose on PostGIS calls.
-- ---------------------------------------------------------------------------
create or replace function app.derive_coarse_location()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_lat  double precision;
  v_long double precision;
begin
  if new.location is null then
    new.location_coarse := null;
    new.coarse_lat := null;
    new.coarse_long := null;
    return new;
  end if;

  v_lat  := round(extensions.st_y(new.location::extensions.geometry)::numeric, 2)::double precision;
  v_long := round(extensions.st_x(new.location::extensions.geometry)::numeric, 2)::double precision;

  new.coarse_lat := v_lat;
  new.coarse_long := v_long;
  new.location_coarse :=
    extensions.st_setsrid(extensions.st_point(v_long, v_lat), 4326)::extensions.geography;

  return new;
end
$$;

drop trigger if exists jobs_derive_coarse_location on public.jobs;
create trigger jobs_derive_coarse_location
  before insert or update of location on public.jobs
  for each row execute function app.derive_coarse_location();

drop trigger if exists jobs_touch_updated_at on public.jobs;
create trigger jobs_touch_updated_at
  before update on public.jobs
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.jobs enable row level security;

drop policy if exists jobs_select_published on public.jobs;
drop policy if exists jobs_select_own on public.jobs;
drop policy if exists jobs_insert_own on public.jobs;
drop policy if exists jobs_update_own on public.jobs;
drop policy if exists jobs_delete_own on public.jobs;

-- "Anyone can read published jobs" — including anonymous visitors.
create policy jobs_select_published
  on public.jobs
  for select
  to anon, authenticated
  using (status = 'published');

-- A poster always sees their own jobs, including drafts.
create policy jobs_select_own
  on public.jobs
  for select
  to authenticated
  using (poster_id = auth.uid());

create policy jobs_insert_own
  on public.jobs
  for insert
  to authenticated
  with check (poster_id = auth.uid());

-- "A job's poster can edit/delete it."
create policy jobs_update_own
  on public.jobs
  for update
  to authenticated
  using (poster_id = auth.uid())
  with check (poster_id = auth.uid());

create policy jobs_delete_own
  on public.jobs
  for delete
  to authenticated
  using (poster_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Column privileges — this is what actually protects the exact address.
--
-- Supabase grants SELECT on all columns to anon/authenticated by default, so
-- the blanket grant must be revoked first and then re-granted column by column.
-- `location` is omitted from every SELECT grant below. Adding a column later?
-- It will NOT be readable until you add it here.
-- ---------------------------------------------------------------------------
revoke select on public.jobs from anon, authenticated;

-- `location_coarse` is granted because nearby_jobs() is SECURITY INVOKER (so
-- that RLS keeps applying inside it) and therefore reads this column with the
-- caller's own privileges — without the grant, every radius search fails with
-- "permission denied for table jobs". It is safe to expose: it is the rounded
-- point, and over PostgREST it arrives as WKB hex, which is why coarse_lat and
-- coarse_long exist for clients to actually use.
grant select (
  id, poster_id, title, description, category, budget,
  location_coarse, coarse_lat, coarse_long, status, created_at, updated_at
) on public.jobs to anon, authenticated;

-- Posters must be able to WRITE the exact point, just never read it back in
-- bulk. location_coarse/coarse_* are trigger-derived, so clients cannot set them.
revoke insert, update on public.jobs from anon, authenticated;

grant insert (poster_id, title, description, category, budget, location, status)
  on public.jobs to authenticated;

grant update (title, description, category, budget, location, status)
  on public.jobs to authenticated;

grant delete on public.jobs to authenticated;
