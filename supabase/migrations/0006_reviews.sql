-- 0006_reviews.sql
-- Yoodle — reputation. One review per reviewer per counterparty per job.

create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs (id) on delete cascade,
  reviewer_id uuid not null references public.profiles (id) on delete cascade,
  reviewee_id uuid not null references public.profiles (id) on delete cascade,
  rating      smallint not null,
  comment     text,
  created_at  timestamptz not null default now(),

  constraint reviews_rating_range check (rating between 1 and 5),
  constraint reviews_comment_length check (comment is null or char_length(comment) <= 2000),
  constraint reviews_no_self_review check (reviewer_id <> reviewee_id),
  constraint reviews_one_per_pair_per_job unique (job_id, reviewer_id, reviewee_id)
);

create index if not exists reviews_reviewee_idx on public.reviews (reviewee_id, created_at desc);

alter table public.reviews enable row level security;

drop policy if exists reviews_select_all on public.reviews;
drop policy if exists reviews_insert_participant on public.reviews;
drop policy if exists reviews_update_own on public.reviews;
drop policy if exists reviews_delete_own on public.reviews;

-- ASSUMPTION (the spec did not define review visibility): reviews are public
-- reputation and readable by anyone, including anonymous browsers — a rating is
-- worth little if you must sign up to see it.
create policy reviews_select_all
  on public.reviews
  for select
  to anon, authenticated
  using (true);

-- You may review only as yourself, only on a job you were party to, and only
-- once it is completed — so a review cannot be used as leverage mid-job.
create policy reviews_insert_participant
  on public.reviews
  for insert
  to authenticated
  with check (
    reviewer_id = auth.uid()
    and app.is_job_participant(job_id)
    and app.job_has_status(job_id, 'completed')
    and (
      app.is_job_poster_id(job_id, reviewee_id)
      or app.has_offer_on_job_as(job_id, reviewee_id)
    )
  );

create policy reviews_update_own
  on public.reviews
  for update
  to authenticated
  using (reviewer_id = auth.uid())
  with check (reviewer_id = auth.uid());

create policy reviews_delete_own
  on public.reviews
  for delete
  to authenticated
  using (reviewer_id = auth.uid());

-- A review may not be moved to a different job or person after the fact.
revoke update on public.reviews from anon, authenticated;
grant update (rating, comment) on public.reviews to authenticated;
