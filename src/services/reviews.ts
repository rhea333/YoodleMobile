import { sanitizeReviewComment } from './sanitize';
import { supabase } from './supabase';
import type { ProfileRatingRow, ReviewRow, Uuid } from '../types/database';

/**
 * Reputation: who may review whom, what they said, and what it averages to.
 *
 * THE RULES LIVE IN THE DATABASE, NOT HERE. Migration 0018 enforces that a
 * review can only be written by a job's poster about its accepted worker or
 * vice versa, only once the job is `completed`, and only once per job per
 * reviewer. Everything in this file that checks the same things is there to
 * produce a decent message and to avoid rendering a prompt that would fail —
 * it is not the control. A replayed insert bypasses every line of this file and
 * still meets `reviews_insert_counterparty` and
 * `reviews_one_per_job_per_reviewer`.
 */

const REVIEW_COLUMNS = 'id, job_id, reviewer_id, reviewee_id, rating, comment, created_at';

export interface ServiceFailure {
  ok: false;
  message: string;
  /** Machine-readable hint, e.g. `already_reviewed`. */
  code?: string;
}

/** The lowest and highest a rating may be, mirrored by a CHECK in 0006. */
export const MIN_RATING = 1;
export const MAX_RATING = 5;

export interface ProfileRating {
  /** Null when this profile has no reviews yet — NOT zero. */
  average: number | null;
  count: number;
}

export type ProfileRatingResult = { ok: true; rating: ProfileRating } | ServiceFailure;

/**
 * A profile's average rating and review count.
 *
 * Reads `profile_ratings`, which aggregates on every read and therefore cannot
 * drift from the rows it summarises. A profile with no reviews has no row at
 * all, which is reported as `{ average: null, count: 0 }` rather than a zero
 * average — zero is not a rating anyone can give.
 */
export const getProfileRating = async (userId: Uuid): Promise<ProfileRatingResult> => {
  const { data, error } = await supabase
    .from('profile_ratings')
    .select('profile_id, rating_avg, rating_count')
    .eq('profile_id', userId)
    .maybeSingle();

  if (error) {
    return { ok: false, message: 'Could not load that rating.' };
  }

  return { ok: true, rating: toProfileRating(data) };
};

/**
 * Normalise the view's row into something the UI can render.
 *
 * `Number()` is kept even though `rating_avg` is already a number: it is one
 * coercion at the single point the value enters the app, and it turns a null,
 * a NaN or a surprise string into the same honest `average: null` rather than
 * into `"NaN"` on somebody's profile.
 */
const toProfileRating = (row: ProfileRatingRow | null): ProfileRating => {
  if (!row || row.rating_count === 0) {
    return { average: null, count: 0 };
  }

  const parsed = row.rating_avg === null ? Number.NaN : Number(row.rating_avg);

  return {
    average: Number.isFinite(parsed) ? parsed : null,
    count: row.rating_count,
  };
};

export type ProfileRatingsResult =
  { ok: true; ratings: Record<string, ProfileRating> } | ServiceFailure;

/**
 * Ratings for several profiles at once, indexed by profile id.
 *
 * What a LIST needs. A hook per row is not an option — React does not allow
 * hook calls in a loop — and a read per row would be a query per card. Ids
 * absent from the result simply have no reviews, and callers treat a missing
 * entry the same as `{ average: null, count: 0 }`.
 */
export const listProfileRatings = async (userIds: Uuid[]): Promise<ProfileRatingsResult> => {
  const unique = [...new Set(userIds)];

  if (unique.length === 0) {
    return { ok: true, ratings: {} };
  }

  const { data, error } = await supabase
    .from('profile_ratings')
    .select('profile_id, rating_avg, rating_count')
    .in('profile_id', unique);

  if (error) {
    return { ok: false, message: 'Could not load ratings.' };
  }

  const ratings: Record<string, ProfileRating> = {};
  for (const row of data ?? []) {
    ratings[row.profile_id] = toProfileRating(row);
  }

  return { ok: true, ratings };
};

/** A review as the profile screen shows it: the row, plus who wrote it. */
export interface ReviewWithReviewer {
  id: Uuid;
  jobId: Uuid;
  rating: number;
  comment: string | null;
  createdAt: string;
  reviewerId: Uuid;
  reviewerName: string | null;
  reviewerAvatarUrl: string | null;
}

export type ReviewListResult = { ok: true; reviews: ReviewWithReviewer[] } | ServiceFailure;

/**
 * Every review written ABOUT a profile, newest first.
 *
 * TWO QUERIES, NOT AN EMBED. `reviews` has two foreign keys into `profiles`
 * (`reviewer_id` and `reviewee_id`), so a PostgREST embed has to be
 * disambiguated by constraint name — and typing that requires hand-maintained
 * relationship metadata in `types/database.ts`, which this project deliberately
 * keeps empty. Reading the reviewers separately is the same shape
 * `loadOfferContext` already uses, and it is one extra round trip for a list
 * that is read far less often than it is written to.
 *
 * Backed by `reviews_reviewee_idx (reviewee_id, created_at desc)` from 0006,
 * which is exactly this ordering.
 */
export const listReviewsForProfile = async (userId: Uuid): Promise<ReviewListResult> => {
  const { data, error } = await supabase
    .from('reviews')
    .select(REVIEW_COLUMNS)
    .eq('reviewee_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    return { ok: false, message: 'Could not load reviews for this profile.' };
  }

  const rows = data ?? [];

  if (rows.length === 0) {
    return { ok: true, reviews: [] };
  }

  // One read for every reviewer on the page, deduplicated — the same person can
  // appear more than once if you have worked together more than once.
  const reviewerIds = [...new Set(rows.map((row) => row.reviewer_id))];

  const { data: reviewers, error: reviewerError } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url')
    .in('id', reviewerIds);

  // A failed reviewer lookup is NOT a failed read. The ratings and comments are
  // the substance; losing a name to an RLS or network hiccup should degrade to
  // "A neighbour" rather than blank the screen.
  if (reviewerError) {
    console.warn('Could not load reviewer profiles for a reviews list', reviewerError);
  }

  const byId = new Map((reviewers ?? []).map((row) => [row.id, row]));

  const reviews = rows.map((row): ReviewWithReviewer => {
    const reviewer = byId.get(row.reviewer_id);

    return {
      id: row.id,
      jobId: row.job_id,
      rating: row.rating,
      comment: row.comment,
      createdAt: row.created_at,
      reviewerId: row.reviewer_id,
      reviewerName: reviewer?.display_name ?? null,
      reviewerAvatarUrl: reviewer?.avatar_url ?? null,
    };
  });

  return { ok: true, reviews };
};

export type MyReviewResult = { ok: true; review: ReviewRow | null } | ServiceFailure;

/**
 * The review this user has already left on this job, if any.
 *
 * What the prompt checks before it renders. One row at most: 0018's
 * `reviews_one_per_job_per_reviewer` makes a second impossible, so
 * `.maybeSingle()` is safe on this key in a way it is not on `job_id` alone.
 */
export const getMyReviewForJob = async (jobId: Uuid, reviewerId: Uuid): Promise<MyReviewResult> => {
  const { data, error } = await supabase
    .from('reviews')
    .select(REVIEW_COLUMNS)
    .eq('job_id', jobId)
    .eq('reviewer_id', reviewerId)
    .maybeSingle();

  if (error) {
    return { ok: false, message: 'Could not check whether you have reviewed this job.' };
  }

  return { ok: true, review: data };
};

/**
 * Who this user would be reviewing on this job, and whether they may.
 *
 * `null` counterparty means "not reviewable", and `reason` says why in words
 * fit for a screen. Every branch here is mirrored by a database rule; this
 * exists so the app can stay quiet about jobs that cannot be reviewed rather
 * than offering a button that fails.
 */
export interface ReviewEligibility {
  /** The person to review, or null when this job is not reviewable by this user. */
  counterpartyId: Uuid | null;
  /** Their role, for the prompt's wording. */
  counterpartyRole: 'poster' | 'worker' | null;
  jobTitle: string | null;
  reason: string | null;
}

export type ReviewEligibilityResult = { ok: true; eligibility: ReviewEligibility } | ServiceFailure;

const NOT_ELIGIBLE = (reason: string): ReviewEligibility => ({
  counterpartyId: null,
  counterpartyRole: null,
  jobTitle: null,
  reason,
});

export const getReviewEligibility = async (
  jobId: Uuid,
  userId: Uuid,
): Promise<ReviewEligibilityResult> => {
  // A completed job is readable by its poster (`jobs_select_own`) and, since
  // 0018, by its accepted worker (`jobs_select_accepted_worker`). Anyone else
  // gets no row — which is itself the answer.
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, poster_id, title, status')
    .eq('id', jobId)
    .maybeSingle();

  if (jobError) {
    return { ok: false, message: 'Could not load that job.' };
  }

  if (!job) {
    return { ok: true, eligibility: NOT_ELIGIBLE('This job is not available to you.') };
  }

  if (job.status !== 'completed') {
    return {
      ok: true,
      eligibility: NOT_ELIGIBLE('This job is not complete yet, so there is nothing to review.'),
    };
  }

  const isPoster = job.poster_id === userId;

  // The accepted offer names the worker. A poster can read every offer on their
  // job; a worker can read only their own (`offers_select_own`), so this
  // returns at most their own row for them.
  //
  // NOT `.maybeSingle()`, EVEN THOUGH 0019 NOW MAKES TWO IMPOSSIBLE. A
  // `.maybeSingle()` here throws PGRST116 the moment the invariant is false,
  // which turns a data problem into "neither party can ever review this job"
  // with no way to tell why. That invariant was false for two whole phases
  // before anyone noticed, and rows created in that window still exist. Reading
  // the list and deciding explicitly costs nothing and degrades honestly.
  const { data: acceptedOffers, error: offerError } = await supabase
    .from('offers')
    .select('id, worker_id, created_at')
    .eq('job_id', jobId)
    .eq('status', 'accepted')
    .order('created_at', { ascending: true });

  if (offerError) {
    return { ok: false, message: 'Could not load the offer on that job.' };
  }

  const accepted = acceptedOffers ?? [];

  if (accepted.length === 0) {
    return {
      ok: true,
      eligibility: NOT_ELIGIBLE('There is no accepted offer on this job to review.'),
    };
  }

  // Checked FIRST, and before the count is considered at all: if the caller is
  // one of the accepted workers, the person they review is the poster. That
  // answer is the same whether there is one accepted offer or five, so this
  // path is never ambiguous and never needs to refuse.
  if (accepted.some((offer) => offer.worker_id === userId)) {
    return {
      ok: true,
      eligibility: {
        counterpartyId: job.poster_id,
        counterpartyRole: 'poster',
        jobTitle: job.title,
        reason: null,
      },
    };
  }

  if (isPoster) {
    if (accepted.length > 1) {
      // Pre-0019 data. There is no defensible way to choose which worker the
      // poster is reviewing, so REFUSE rather than pick — silently attaching a
      // rating to an arbitrary one of two people is the worse outcome by a
      // wide margin, and it is unfixable afterwards.
      console.warn(
        `Job ${jobId} has ${accepted.length} accepted offers; refusing to guess a review counterparty.`,
      );
      return {
        ok: true,
        eligibility: NOT_ELIGIBLE(
          'This job has more than one accepted offer, so we cannot tell who to review. Please get in touch.',
        ),
      };
    }

    return {
      ok: true,
      eligibility: {
        counterpartyId: accepted[0].worker_id,
        counterpartyRole: 'worker',
        jobTitle: job.title,
        reason: null,
      },
    };
  }

  // Bid and lost, or never involved. Both are "no", and deliberately get the
  // same wording — telling a losing bidder that a job went to someone else is
  // not this screen's job.
  return {
    ok: true,
    eligibility: NOT_ELIGIBLE('Only the poster and the worker who did this job can review it.'),
  };
};

export interface SubmitReviewInput {
  jobId: Uuid;
  reviewerId: Uuid;
  revieweeId: Uuid;
  rating: number;
  comment?: string | null;
}

export type SubmitReviewResult = { ok: true; review: ReviewRow } | ServiceFailure;

/** Postgres unique-violation. Here it means "you already reviewed this job". */
const UNIQUE_VIOLATION = '23505';

/**
 * Write a review.
 *
 * The rating is clamped and rounded before it leaves, so a malformed value
 * fails our own check rather than the database's. That is a nicety, not a
 * defence: `reviews_rating_range` is what actually holds the line.
 *
 * A duplicate is reported as a SUCCESSFUL no-op path rather than a crash — the
 * user's intent (leave one review) is already satisfied, and the honest answer
 * is "you have already reviewed this job", not a generic failure.
 */
export const submitReview = async (input: SubmitReviewInput): Promise<SubmitReviewResult> => {
  const rating = Math.round(input.rating);

  if (!Number.isFinite(rating) || rating < MIN_RATING || rating > MAX_RATING) {
    return { ok: false, message: `Choose a rating from ${MIN_RATING} to ${MAX_RATING}.` };
  }

  if (input.reviewerId === input.revieweeId) {
    return { ok: false, message: 'You cannot review yourself.' };
  }

  const comment = input.comment ? sanitizeReviewComment(input.comment) : '';

  const { data, error } = await supabase
    .from('reviews')
    .insert({
      job_id: input.jobId,
      reviewer_id: input.reviewerId,
      reviewee_id: input.revieweeId,
      rating,
      // An empty comment is stored as NULL rather than "", so "no comment" has
      // one representation instead of two.
      comment: comment.length > 0 ? comment : null,
    })
    .select(REVIEW_COLUMNS)
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        ok: false,
        message: 'You have already reviewed this job.',
        code: 'already_reviewed',
      };
    }

    // An RLS refusal is not distinguishable from a missing row here, and
    // deliberately so: the policy is the reason, and spelling out which clause
    // failed would describe the rules to someone probing them.
    return {
      ok: false,
      message: 'Could not save that review. You can only review a job you completed.',
    };
  }

  return { ok: true, review: data };
};

/** One decimal place, or a dash when there is nothing to average. */
export const formatRating = (average: number | null): string =>
  average === null ? '—' : average.toFixed(1);

/** "12 reviews" / "1 review" / "No reviews yet". */
export const formatReviewCount = (count: number): string => {
  if (count === 0) return 'No reviews yet';
  return count === 1 ? '1 review' : `${count} reviews`;
};
