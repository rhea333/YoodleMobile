import type { JobRow, OfferRow, OfferStatus, ProfileRow, Uuid } from '../types/database';
import { sanitizeOfferMessage } from './sanitize';
import { supabase } from './supabase';

/**
 * Offers: a worker's bid on a job, and the poster's response.
 *
 * NOTHING HERE TOUCHES MONEY. Accepting an offer changes a status column and
 * that is all it does — no charge, no hold, no payout. Payments are a later
 * phase, and "accepted" must not be read as "paid" by anything built on top of
 * this.
 *
 * Visibility is entirely RLS's job (migration 0004) and is worth restating
 * because it is unusual: a worker can see ONLY their own offer on a job, never
 * a rival's. A marketplace that leaks competing bids is one where nobody bids
 * honestly. The poster sees all offers on their own jobs.
 */

const OFFER_COLUMNS = 'id, job_id, worker_id, amount, status, message, created_at, updated_at';

export interface ServiceFailure {
  ok: false;
  message: string;
}

export type OfferResult = { ok: true; offer: OfferRow } | ServiceFailure;
export type OffersResult = { ok: true; offers: OfferRow[] } | ServiceFailure;

export interface MakeOfferInput {
  jobId: Uuid;
  workerId: Uuid;
  amount: number;
  /** Optional note. Sanitised here before it goes anywhere. */
  message?: string;
}

/**
 * Create or amend this worker's offer on a job.
 *
 * INSERT FIRST, THEN UPDATE ON CONFLICT — deliberately NOT a PostgREST upsert.
 *
 * `offers_one_per_worker_per_job` means one standing offer per worker per job,
 * which looks like precisely what upsert is for. But an upsert compiles to
 * `INSERT ... ON CONFLICT DO UPDATE SET` across every column sent, including
 * `job_id` and `worker_id` — and 0004 revokes UPDATE on those two on purpose,
 * so that neither party can move an offer onto a different job or a different
 * worker. Postgres checks column privileges for the DO UPDATE clause
 * statically, whether or not a conflict actually occurs, so the upsert fails
 * with "permission denied for table offers" every time, including on a first
 * bid where nothing conflicts at all.
 *
 * Two steps keep that restriction intact: the amend path writes only the three
 * columns a worker is allowed to change.
 *
 * ONLY A PENDING OFFER CAN BE AMENDED. The `.eq('status', 'pending')` below is
 * the client half of that; migration 0016 enforces it in a trigger, which is
 * the half that actually holds. Before 0016 a worker could walk an ALREADY
 * ACCEPTED offer back to `pending` and re-price it — verified against the live
 * database, $40 to $999. Accepting a job does not change the job's status, so
 * the Apply button stayed live and this was reachable from the UI.
 */
export const makeOffer = async (input: MakeOfferInput): Promise<OfferResult> => {
  const note = input.message ? sanitizeOfferMessage(input.message) : '';
  const message = note.length > 0 ? note : null;

  const inserted = await supabase
    .from('offers')
    .insert({
      job_id: input.jobId,
      worker_id: input.workerId,
      amount: input.amount,
      message,
      status: 'pending',
    })
    .select(OFFER_COLUMNS)
    .single();

  if (!inserted.error && inserted.data) {
    return { ok: true, offer: inserted.data };
  }

  // 23505 = unique_violation: this worker already has an offer on this job, so
  // this is an amendment rather than a new bid.
  if (inserted.error?.code === '23505') {
    const { data, error } = await supabase
      .from('offers')
      .update({ amount: input.amount, message, status: 'pending' })
      .eq('job_id', input.jobId)
      .eq('worker_id', input.workerId)
      // Settled offers are frozen. Matching on status means an attempt on one
      // returns zero rows instead of tripping the trigger's exception, which
      // lets us say something useful rather than surfacing a database error.
      .eq('status', 'pending')
      .select(OFFER_COLUMNS);

    if (error) {
      return { ok: false, message: 'Could not update your offer. Please try again.' };
    }

    const row = data?.[0];
    if (!row) {
      return {
        ok: false,
        message:
          'You already have an offer on this job and it can no longer be changed — it has been accepted, declined or withdrawn.',
      };
    }

    return { ok: true, offer: row };
  }

  // Anything else is the insert policy refusing: an offer on your own job, on
  // an unpublished job, or as someone else.
  return {
    ok: false,
    message: 'Could not send that offer. The job may no longer be open to offers.',
  };
};

/** Every offer this worker has made, newest first. */
export const listMyOffers = async (workerId: Uuid): Promise<OffersResult> => {
  const { data, error } = await supabase
    .from('offers')
    .select(OFFER_COLUMNS)
    .eq('worker_id', workerId)
    .order('created_at', { ascending: false });

  if (error) {
    return { ok: false, message: 'Could not load your offers. Please try again.' };
  }

  return { ok: true, offers: data ?? [] };
};

/**
 * Every offer on jobs this user posted.
 *
 * Filtered by `job_id IN (my jobs)` rather than trusting RLS to do the
 * narrowing: `offers_select_own` would otherwise also return this user's own
 * bids on OTHER people's jobs, which belong on the other list.
 */
export const listOffersOnMyJobs = async (posterId: Uuid): Promise<OffersResult> => {
  const { data: jobs, error: jobsError } = await supabase
    .from('jobs')
    .select('id')
    .eq('poster_id', posterId);

  if (jobsError) {
    return { ok: false, message: 'Could not load offers on your jobs. Please try again.' };
  }

  const jobIds = (jobs ?? []).map((job) => job.id);
  if (jobIds.length === 0) {
    return { ok: true, offers: [] };
  }

  const { data, error } = await supabase
    .from('offers')
    .select(OFFER_COLUMNS)
    .in('job_id', jobIds)
    .order('created_at', { ascending: false });

  if (error) {
    return { ok: false, message: 'Could not load offers on your jobs. Please try again.' };
  }

  return { ok: true, offers: data ?? [] };
};

/**
 * Set an offer's status.
 *
 * Who may do what is RLS's call, not this function's: `offers_update_as_poster`
 * lets the job's poster accept or decline, `offers_update_own` lets the worker
 * withdraw. A zero-row result means the policy refused, which PostgREST reports
 * as success with no rows rather than as an error.
 */
const setOfferStatus = async (offerId: Uuid, status: OfferStatus): Promise<OfferResult> => {
  const { data, error } = await supabase
    .from('offers')
    .update({ status })
    .eq('id', offerId)
    .select(OFFER_COLUMNS);

  if (error) {
    return { ok: false, message: 'Could not update that offer. Please try again.' };
  }

  const row = data?.[0];
  if (!row) {
    return { ok: false, message: 'That offer is not yours to change.' };
  }

  return { ok: true, offer: row };
};

/** Poster accepts. Status only — no payment is taken, now or later in this phase. */
export const acceptOffer = (offerId: Uuid): Promise<OfferResult> =>
  setOfferStatus(offerId, 'accepted');

/** Poster declines. The row stays, so the worker can see what happened. */
export const declineOffer = (offerId: Uuid): Promise<OfferResult> =>
  setOfferStatus(offerId, 'declined');

/** Worker withdraws their own bid. */
export const withdrawOffer = (offerId: Uuid): Promise<OfferResult> =>
  setOfferStatus(offerId, 'withdrawn');

export const offerStatusLabel = (status: OfferStatus): string => {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'accepted':
      return 'Accepted';
    case 'declined':
      return 'Declined';
    case 'withdrawn':
      return 'Withdrawn';
  }
};

/**
 * The jobs and profiles an offer list refers to, fetched in two batched reads
 * rather than one per row.
 *
 * Not a PostgREST embed: the hand-written `Database` type declares
 * `Relationships: []` on every table, so embedded resources would fall back to
 * loose typing. Two typed reads keep the types and cost the same round trips.
 */
export interface OfferContext {
  jobsById: Record<string, JobRow>;
  profilesById: Record<string, ProfileRow>;
}

export type OfferContextResult = { ok: true; context: OfferContext } | ServiceFailure;

export const loadOfferContext = async (
  jobIds: Uuid[],
  profileIds: Uuid[],
): Promise<OfferContextResult> => {
  const uniqueJobs = Array.from(new Set(jobIds));
  const uniqueProfiles = Array.from(new Set(profileIds));

  const [jobsResponse, profilesResponse] = await Promise.all([
    uniqueJobs.length > 0
      ? supabase
          .from('jobs')
          .select(
            'id, poster_id, title, description, category, budget, coarse_lat, coarse_long, status, photo_paths, created_at, updated_at',
          )
          .in('id', uniqueJobs)
      : Promise.resolve({ data: [], error: null }),
    uniqueProfiles.length > 0
      ? supabase
          .from('profiles')
          .select(
            'id, display_name, avatar_url, postal_fsa, bio, onboarded_at, stripe_payouts_enabled, stripe_details_submitted, created_at, updated_at',
          )
          .in('id', uniqueProfiles)
      : Promise.resolve({ data: [], error: null }),
  ]);

  // Errors were previously ignored here, which failed in the least helpful way
  // available: every job became "A job", every counterparty "A neighbour", and
  // the worker's only Message button vanished (it needs the poster id from the
  // job) — with nothing on screen to say anything had gone wrong.
  if (jobsResponse.error || profilesResponse.error) {
    return { ok: false, message: 'Could not load the details for these offers.' };
  }

  const jobsById: Record<string, JobRow> = {};
  for (const job of jobsResponse.data ?? []) {
    jobsById[job.id] = job;
  }

  const profilesById: Record<string, ProfileRow> = {};
  for (const profile of profilesResponse.data ?? []) {
    profilesById[profile.id] = profile;
  }

  return { ok: true, context: { jobsById, profilesById } };
};
