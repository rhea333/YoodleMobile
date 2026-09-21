-- 0018_reviews_counterparty_and_ratings.sql
-- Yoodle — make reviews mean something: tighten who may review whom, enforce
-- one review per job per reviewer, and expose an aggregate rating.
--
-- 0006 created `reviews` before there was any UI for it, and its rules were
-- looser than they read. Two of them are reputation holes rather than
-- theoretical ones, and both are fixed here:
--
--   1. ANY BIDDER COULD REVIEW, AND BE REVIEWED. `app.is_job_participant`
--      answers "poster or has an offer on this job" — not "poster or the
--      worker who actually did the job". Combined with
--      `app.has_offer_on_job_as` on the reviewee side, a poster could leave a
--      one-star review for every worker who bid and lost, and every losing
--      bidder could review the poster. Reputation damage with no transaction
--      behind it, from someone you never worked with.
--
--   2. THE UNIQUE CONSTRAINT WAS PER PAIR, NOT PER REVIEWER.
--      `unique (job_id, reviewer_id, reviewee_id)` stops one reviewer
--      reviewing one person twice on a job; it does NOT stop one reviewer
--      leaving several reviews on the same job against different people. That
--      only mattered because of hole 1, but "one review per job per reviewer"
--      is the rule the product wants, so it is now the rule the database
--      enforces.
--
-- Both are enforced in the DATABASE, not the UI. The screens also check, but a
-- replayed insert goes straight to Postgres, and that is the layer that has to
-- say no.

-- ---------------------------------------------------------------------------
-- 1. Who actually did this job?
-- ---------------------------------------------------------------------------

-- `app.is_accepted_worker(job)` already answers this for the CALLER. Reviews
-- need it for an arbitrary user, because the reviewee is not the caller.
create or replace function app.is_accepted_worker_as(p_job_id uuid, p_user_id uuid)
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
      and o.worker_id = p_user_id
      and o.status = 'accepted'
  );
end
$$;

grant execute on function app.is_accepted_worker_as(uuid, uuid) to authenticated;

comment on function app.is_accepted_worker_as(uuid, uuid) is
  'Is this user the ACCEPTED worker on this job? The "as" variant of app.is_accepted_worker, for policies that must validate someone other than the caller.';

-- ---------------------------------------------------------------------------
-- 2. One review per job per reviewer.
-- ---------------------------------------------------------------------------
--
-- Strictly stronger than what it replaces: uniqueness on (job_id, reviewer_id)
-- implies uniqueness on (job_id, reviewer_id, reviewee_id), so nothing that
-- was rejected before is accepted now.
--
-- If this ADD fails with 23505, the table already holds a reviewer with two
-- reviews on one job. That is data created under the old rule and needs a
-- decision about which to keep — deliberately not resolved automatically here,
-- because silently deleting somebody's review is worse than a failed migration.

alter table public.reviews
  drop constraint if exists reviews_one_per_pair_per_job;

alter table public.reviews
  drop constraint if exists reviews_one_per_job_per_reviewer;

alter table public.reviews
  add constraint reviews_one_per_job_per_reviewer unique (job_id, reviewer_id);

comment on constraint reviews_one_per_job_per_reviewer on public.reviews is
  'One review per job per reviewer, enforced here rather than in the UI so a replayed insert cannot bypass it.';

-- ---------------------------------------------------------------------------
-- 3. Only the two people who transacted may review each other.
-- ---------------------------------------------------------------------------

drop policy if exists reviews_insert_participant on public.reviews;
drop policy if exists reviews_insert_counterparty on public.reviews;

create policy reviews_insert_counterparty
  on public.reviews
  for insert
  to authenticated
  with check (
    -- You review as yourself. A forged reviewer_id fails here.
    reviewer_id = auth.uid()

    -- Only after the job is done, so a review cannot be used as leverage
    -- mid-job. Phase 7 made `completed` mean the payment was released, which
    -- makes this stricter than it was: the status is now set by an Edge
    -- Function after a transfer lands, not by anyone tapping a button.
    and app.job_has_status(job_id, 'completed')

    -- Belt and braces with `reviews_no_self_review`; the two branches below
    -- already make it impossible, since nobody is both poster and worker.
    and reviewer_id <> reviewee_id

    and (
      -- The poster reviewing the worker who did the job.
      (
        app.is_job_poster_id(job_id, reviewer_id)
        and app.is_accepted_worker_as(job_id, reviewee_id)
      )
      -- The worker who did the job reviewing the poster.
      or (
        app.is_accepted_worker_as(job_id, reviewer_id)
        and app.is_job_poster_id(job_id, reviewee_id)
      )
    )
  );

-- `reviews_update_own` and `reviews_delete_own` from 0006 are left alone.
-- Editing your own review is not a second review — the unique constraint still
-- holds one row per job per reviewer — and the column grants from 0006 already
-- prevent an update moving a review to a different job or person.

-- ---------------------------------------------------------------------------
-- 4. Aggregate rating.
-- ---------------------------------------------------------------------------
--
-- A VIEW, not columns on `profiles` maintained by a trigger. The average is
-- derived data, and derived data kept in two places eventually disagrees: a
-- missed trigger, a manual delete, or a restore leaves a stored average that
-- no longer matches the rows it claims to summarise, and nothing surfaces it.
-- Computed on read it cannot drift, there is no backfill, and a review that is
-- edited or removed is reflected immediately.
--
-- Profiles with no reviews are ABSENT rather than present with zero. Callers
-- treat a missing row as "no reviews yet", which is a different statement from
-- "rated zero" — and zero is not even a valid rating.

drop view if exists public.profile_ratings;

create view public.profile_ratings
with (security_invoker = true)
as
  select
    r.reviewee_id            as profile_id,
    round(avg(r.rating), 2)  as rating_avg,
    count(*)::integer        as rating_count
  from public.reviews r
  group by r.reviewee_id;

-- `security_invoker` matters even though it changes nothing today. Without it
-- the view runs as its OWNER, so it would keep working if `reviews` were ever
-- restricted — quietly becoming a way to read aggregates of rows the caller
-- is not allowed to see. Reviews are public now; this keeps the view honest if
-- that ever changes.

comment on view public.profile_ratings is
  'Average rating and review count per reviewed profile, aggregated on read. No row means no reviews yet.';

-- 0013 revoked anon's default grants, so anything new must be granted by name.
-- Reviews are public reputation (`reviews_select_all`, 0006) and the aggregate
-- is strictly less information than the rows it is built from.
grant select on public.profile_ratings to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Read path for the reviews list.
-- ---------------------------------------------------------------------------
-- The profile screen lists a reviewee's reviews newest-first. 0006 indexed
-- exactly that with `reviews_reviewee_idx (reviewee_id, created_at desc)`.
--
-- This one supports the OTHER question the app asks constantly: "have I already
-- reviewed this job?", which the prompt checks before it renders.
create index if not exists reviews_reviewer_job_idx
  on public.reviews (reviewer_id, job_id);

-- ---------------------------------------------------------------------------
-- 6. The worker can see the job they were hired for.
-- ---------------------------------------------------------------------------
--
-- REQUIRED BY THIS PHASE, and a pre-existing bug in its own right.
--
-- `jobs_select_published` covers `status = 'published'` and `jobs_select_own`
-- covers the poster. Nothing covered the ACCEPTED WORKER, so the moment a job
-- left `published` the person actually doing it could no longer read it. The
-- worker therefore could not see that the job was complete, nor who the poster
-- was — which is exactly what they need in order to review them. (It is also
-- why an accepted or completed job has been rendering as "A job" on the
-- worker's side of the Offers screen.)
--
-- This exposes NO new columns. The grant from 0003 gives `authenticated` the
-- coarse location only; `location_exact` is not in it and is not readable by
-- any client role. The accepted worker is already trusted with more than this
-- policy grants — `job_exact_location` (0007) hands them the precise point on
-- request — so this is narrower than access they already have.

drop policy if exists jobs_select_accepted_worker on public.jobs;

create policy jobs_select_accepted_worker
  on public.jobs
  for select
  to authenticated
  using (app.is_accepted_worker(id));
