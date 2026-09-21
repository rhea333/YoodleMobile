-- 0019_one_accepted_offer_per_job.sql
-- Yoodle — a job can have at most ONE accepted offer.
--
-- THE GAP THIS CLOSES, which has been open since phase 6 and got expensive in
-- phase 7:
--
-- Nothing has ever stopped a poster accepting more than one offer on the same
-- job. Every layer checks something adjacent and none of them checks this:
--
--   * `offers_one_per_worker_per_job` (0004) is unique on (job_id, worker_id).
--     It stops one WORKER bidding twice. It says nothing about two different
--     workers both being accepted.
--   * The 0016 trigger guards a transition of ONE ROW — `old.status` must be
--     'pending' to become 'accepted'. Two rows that are both 'pending' both
--     pass it, independently and happily.
--   * `stripe-authorize-payment` refuses a cancelled or completed job and an
--     offer that is not pending/accepted. It never looked at the job's OTHER
--     offers.
--   * OffersScreen renders "Accept & pay" on every pending offer, so the UI
--     actively invites it.
--
-- The result: a poster with three bids could accept all three and, since phase
-- 7 wired accepting to paying, put THREE SEPARATE CARD HOLDS on one job. The
-- per-offer idempotency that phase 7 is so careful about does not help — these
-- are three different offers, so every key is legitimately distinct.
--
-- Phase 8 found it from the other end: `getReviewEligibility` asks "who is the
-- accepted worker on this job?" and a job with two answers made the question
-- unanswerable, so neither party could ever review it.
--
-- A PARTIAL UNIQUE INDEX, NOT AN APPLICATION CHECK. A read-then-write in the
-- Edge Function loses the race by construction: two requests can both read "no
-- accepted offer yet" before either writes. Only the database can make the
-- second one fail, and this is the object that does it.

-- If this CREATE fails with 23505, a job in this database already has two
-- accepted offers. That is real data created under the old rules and it needs a
-- person to decide which offer stands — and, because phase 7 may have placed a
-- hold for each, to check Stripe for holds that need cancelling. Deliberately
-- not resolved automatically here.
--
-- Find them with:
--   select job_id, count(*) from public.offers
--   where status = 'accepted' group by job_id having count(*) > 1;

create unique index if not exists offers_one_accepted_per_job
  on public.offers (job_id)
  where status = 'accepted';

comment on index public.offers_one_accepted_per_job is
  'At most one accepted offer per job. Partial so that any number of pending, declined or withdrawn offers may coexist — only the accepted one is exclusive. Enforced here rather than in the Edge Function because a read-then-write cannot win a concurrent accept.';

-- ---------------------------------------------------------------------------
-- A consequence worth stating, because it is a product decision and not an
-- oversight:
--
-- Accepting is now IRREVERSIBLE at the offer level. The 0016 trigger already
-- refuses to move an offer out of 'accepted' (`old.status <> 'pending'`), so
-- the accepted row cannot be declined to free this index. A poster who changes
-- their mind cancels the JOB — which, since phase 7's stripe-cancel-payment,
-- voids the hold properly.
--
-- That is the same answer as before this migration; the index does not take
-- anything away. It only stops the poster from ALSO accepting somebody else
-- while the first acceptance stands.
-- ---------------------------------------------------------------------------
