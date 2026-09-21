import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import {
  dismissReviewPrompt,
  getMyReviewForJob,
  getProfileRating,
  getReviewEligibility,
  isReviewPromptDismissed,
  listProfileRatings,
  listReviewsForProfile,
  submitReview,
  type ProfileRating,
  type ReviewEligibility,
  type ReviewWithReviewer,
  type SubmitReviewInput,
} from '../services';
import type { ReviewRow, Uuid } from '../types/database';

/**
 * Server state for reputation.
 *
 * Ratings are derived from `profile_ratings`, which aggregates on read — so
 * invalidating after a write is all it takes for an average to be correct.
 * There is no denormalised counter to keep in step and nothing to recompute.
 */

export const reviewKeys = {
  all: ['reviews'] as const,
  forProfile: (userId: Uuid) => ['reviews', 'profile', userId] as const,
  rating: (userId: Uuid) => ['reviews', 'rating', userId] as const,
  ratings: (userIds: readonly string[]) => ['reviews', 'ratings', [...userIds].sort()] as const,
  mineForJob: (jobId: Uuid, userId: Uuid) => ['reviews', 'mine', jobId, userId] as const,
  eligibility: (jobId: Uuid, userId: Uuid) => ['reviews', 'eligibility', jobId, userId] as const,
  dismissed: (jobId: Uuid, userId: Uuid) => ['reviews', 'dismissed', jobId, userId] as const,
};

export const useProfileRatingQuery = (
  userId: Uuid | undefined,
): UseQueryResult<ProfileRating, Error> =>
  useQuery({
    queryKey: reviewKeys.rating(userId ?? 'anonymous'),
    enabled: Boolean(userId),
    queryFn: async (): Promise<ProfileRating> => {
      if (!userId) throw new Error('No profile.');
      const result = await getProfileRating(userId);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.rating;
    },
  });

/**
 * Ratings for a list of people, indexed by id.
 *
 * One read for a whole screen. The key is the SORTED id list, so two renders
 * that ask for the same people in a different order share a cache entry instead
 * of refetching.
 */
export const useProfileRatingsQuery = (
  userIds: string[],
): UseQueryResult<Record<string, ProfileRating>, Error> =>
  useQuery({
    queryKey: reviewKeys.ratings(userIds),
    enabled: userIds.length > 0,
    queryFn: async (): Promise<Record<string, ProfileRating>> => {
      const result = await listProfileRatings(userIds);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.ratings;
    },
  });

export const useReviewsForProfileQuery = (
  userId: Uuid | undefined,
  enabled = true,
): UseQueryResult<ReviewWithReviewer[], Error> =>
  useQuery({
    queryKey: reviewKeys.forProfile(userId ?? 'anonymous'),
    // The Reviews tab is lazy: nothing is fetched until it is actually opened.
    enabled: Boolean(userId) && enabled,
    queryFn: async (): Promise<ReviewWithReviewer[]> => {
      if (!userId) throw new Error('No profile.');
      const result = await listReviewsForProfile(userId);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.reviews;
    },
  });

/** The review this user has already left on this job, or null. */
export const useMyReviewForJobQuery = (
  jobId: Uuid,
  userId: Uuid | undefined,
  enabled = true,
): UseQueryResult<ReviewRow | null, Error> =>
  useQuery({
    queryKey: reviewKeys.mineForJob(jobId, userId ?? 'anonymous'),
    // Callers pass `enabled: false` for jobs that are not complete: there is
    // nothing to have reviewed, and asking on every job detail view would be a
    // read per job for an answer that is always null.
    enabled: Boolean(userId) && enabled,
    queryFn: async (): Promise<ReviewRow | null> => {
      if (!userId) throw new Error('No signed-in user.');
      const result = await getMyReviewForJob(jobId, userId);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.review;
    },
  });

/** Who this user would review on this job, and whether they may at all. */
export const useReviewEligibilityQuery = (
  jobId: Uuid,
  userId: Uuid | undefined,
  enabled = true,
): UseQueryResult<ReviewEligibility, Error> =>
  useQuery({
    queryKey: reviewKeys.eligibility(jobId, userId ?? 'anonymous'),
    enabled: Boolean(userId) && enabled,
    queryFn: async (): Promise<ReviewEligibility> => {
      if (!userId) throw new Error('No signed-in user.');
      const result = await getReviewEligibility(jobId, userId);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.eligibility;
    },
  });

/**
 * Whether the prompt for this job has been dismissed on this device.
 *
 * A query over AsyncStorage rather than component state, so that dismissing on
 * one screen is reflected anywhere else the prompt could appear, without either
 * screen knowing about the other.
 */
export const useReviewPromptDismissedQuery = (
  jobId: Uuid,
  userId: Uuid | undefined,
  enabled = true,
): UseQueryResult<boolean, Error> =>
  useQuery({
    queryKey: reviewKeys.dismissed(jobId, userId ?? 'anonymous'),
    enabled: Boolean(userId) && enabled,
    // Device-local and only changed from inside this app, so there is no point
    // treating it as stale on a timer.
    staleTime: Infinity,
    queryFn: async (): Promise<boolean> => {
      if (!userId) return true;
      return isReviewPromptDismissed(userId, jobId);
    },
  });

export interface UseDismissReviewPromptOptions {
  onSuccess?: () => void;
}

export const useDismissReviewPromptMutation = (options?: UseDismissReviewPromptOptions) => {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { jobId: Uuid; userId: Uuid }>({
    mutationFn: async ({ jobId, userId }) => {
      await dismissReviewPrompt(userId, jobId);
    },
    // Set directly rather than invalidating: the prompt should vanish on the
    // tap, not after a storage round-trip. A failed write only means the
    // prompt returns next launch, which is the right way for this to fail.
    onSuccess: (_result, { jobId, userId }) => {
      queryClient.setQueryData(reviewKeys.dismissed(jobId, userId), true);
      options?.onSuccess?.();
    },
  });
};

export interface UseSubmitReviewOptions {
  onSuccess?: (review: ReviewRow) => void;
}

/**
 * Write a review, then make every view of the reviewee's reputation stale.
 *
 * INVALIDATES `reviewKeys.all`, NOT THE THREE SPECIFIC KEYS. Naming them
 * individually missed `reviewKeys.ratings([...])` — the BATCHED key OffersScreen
 * reads — so that screen kept showing the pre-review average for the rest of
 * the session. The batched key is a sorted id list, so it cannot be targeted
 * precisely from here anyway: this mutation knows one reviewee, not which
 * combinations of people some other screen happens to have asked about.
 *
 * The prefix covers all of it. Over-invalidating a handful of small queries
 * after an action the user just took is the cheap side of this trade.
 */
export const useSubmitReviewMutation = (options?: UseSubmitReviewOptions) => {
  const queryClient = useQueryClient();

  return useMutation<ReviewRow, Error, SubmitReviewInput>({
    mutationFn: async (input) => {
      const result = await submitReview(input);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.review;
    },
    onSuccess: (review) => {
      void queryClient.invalidateQueries({ queryKey: reviewKeys.all });
      options?.onSuccess?.(review);
    },
  });
};
