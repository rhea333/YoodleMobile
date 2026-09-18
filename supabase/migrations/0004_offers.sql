-- 0004_offers.sql
-- Yoodle — a worker's bid on a job.

create table if not exists public.offers (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references public.jobs (id) on delete cascade,
  worker_id  uuid not null references public.profiles (id) on delete cascade,
  amount     numeric(10, 2) not null,
  status     text not null default 'pending',
  created_at timestamptz not null default now(),

  constraint offers_amount_positive check (amount >= 0),
  constraint offers_status_valid
    check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  -- One standing offer per worker per job; re-bidding updates the existing row.
  constraint offers_one_per_worker_per_job unique (job_id, worker_id)
);

create index if not exists offers_job_idx on public.offers (job_id);
create index if not exists offers_worker_idx on public.offers (worker_id);

alter table public.offers enable row level security;

drop policy if exists offers_select_own on public.offers;
drop policy if exists offers_select_as_poster on public.offers;
drop policy if exists offers_insert_own on public.offers;
drop policy if exists offers_update_own on public.offers;
drop policy if exists offers_update_as_poster on public.offers;
drop policy if exists offers_delete_own on public.offers;

-- A worker sees their own offers, and only their own: rival bids on the same
-- job stay hidden, or the marketplace leaks everyone's pricing.
create policy offers_select_own
  on public.offers
  for select
  to authenticated
  using (worker_id = auth.uid());

-- The job's poster sees every offer on their own job.
create policy offers_select_as_poster
  on public.offers
  for select
  to authenticated
  using (app.is_job_poster(job_id));

-- Offers may only be made on a published job, and never on your own job.
create policy offers_insert_own
  on public.offers
  for insert
  to authenticated
  with check (
    worker_id = auth.uid()
    and app.job_has_status(job_id, 'published')
    and not app.is_job_poster(job_id)
  );

-- A worker may amend or withdraw their own offer.
create policy offers_update_own
  on public.offers
  for update
  to authenticated
  using (worker_id = auth.uid())
  with check (worker_id = auth.uid());

-- The poster may accept or decline offers on their own job.
create policy offers_update_as_poster
  on public.offers
  for update
  to authenticated
  using (app.is_job_poster(job_id))
  with check (app.is_job_poster(job_id));

create policy offers_delete_own
  on public.offers
  for delete
  to authenticated
  using (worker_id = auth.uid());

-- Neither party may move an offer to a different job or a different worker.
revoke update on public.offers from anon, authenticated;
grant update (amount, status) on public.offers to authenticated;
