import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import {
  acceptOffer,
  declineOffer,
  listMyOffers,
  listOffersOnMyJobs,
  loadOfferContext,
  makeOffer,
  withdrawOffer,
  type MakeOfferInput,
  type OfferContext,
} from '../services';
import type { OfferRow, Uuid } from '../types/database';

/**
 * Server state for offers.
 *
 * Both lists and the job/profile context they need are invalidated together on
 * every mutation. An accept changes what the poster's list shows AND what the
 * worker's list shows, and the two are different queries.
 */

export const offerKeys = {
  all: ['offers'] as const,
  mine: (userId: Uuid) => ['offers', 'mine', userId] as const,
  onMyJobs: (userId: Uuid) => ['offers', 'onMyJobs', userId] as const,
  context: (jobIds: string[], profileIds: string[]) =>
    ['offers', 'context', jobIds.join(','), profileIds.join(',')] as const,
};

export const useMyOffersQuery = (userId: Uuid | undefined): UseQueryResult<OfferRow[], Error> =>
  useQuery({
    queryKey: offerKeys.mine(userId ?? 'anonymous'),
    enabled: Boolean(userId),
    queryFn: async (): Promise<OfferRow[]> => {
      if (!userId) {
        throw new Error('No signed-in user.');
      }
      const result = await listMyOffers(userId);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.offers;
    },
  });

export const useOffersOnMyJobsQuery = (
  userId: Uuid | undefined,
): UseQueryResult<OfferRow[], Error> =>
  useQuery({
    queryKey: offerKeys.onMyJobs(userId ?? 'anonymous'),
    enabled: Boolean(userId),
    queryFn: async (): Promise<OfferRow[]> => {
      if (!userId) {
        throw new Error('No signed-in user.');
      }
      const result = await listOffersOnMyJobs(userId);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.offers;
    },
  });

/** Job titles and counterparty names for a set of offers, batched. */
export const useOfferContextQuery = (
  jobIds: string[],
  profileIds: string[],
): UseQueryResult<OfferContext, Error> =>
  useQuery({
    queryKey: offerKeys.context(jobIds, profileIds),
    enabled: jobIds.length > 0 || profileIds.length > 0,
    queryFn: async (): Promise<OfferContext> => {
      const result = await loadOfferContext(jobIds, profileIds);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.context;
    },
  });

export interface UseMakeOfferOptions {
  onSuccess?: (offer: OfferRow) => void;
}

export const useMakeOfferMutation = (options?: UseMakeOfferOptions) => {
  const queryClient = useQueryClient();

  return useMutation<OfferRow, Error, MakeOfferInput>({
    mutationFn: async (input) => {
      const result = await makeOffer(input);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.offer;
    },
    onSuccess: (offer) => {
      void queryClient.invalidateQueries({ queryKey: offerKeys.all });
      options?.onSuccess?.(offer);
    },
  });
};

export type OfferAction = 'accept' | 'decline' | 'withdraw';

export interface UseOfferActionOptions {
  onSuccess?: (offer: OfferRow) => void;
}

/**
 * Accept, decline or withdraw.
 *
 * One mutation for all three because they differ only in the status written
 * and in which RLS policy permits them — and the policy, not this hook, is what
 * decides whether the caller is allowed.
 */
export const useOfferActionMutation = (options?: UseOfferActionOptions) => {
  const queryClient = useQueryClient();

  return useMutation<OfferRow, Error, { offerId: Uuid; action: OfferAction }>({
    mutationFn: async ({ offerId, action }) => {
      const run =
        action === 'accept' ? acceptOffer : action === 'decline' ? declineOffer : withdrawOffer;
      const result = await run(offerId);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.offer;
    },
    onSuccess: (offer) => {
      void queryClient.invalidateQueries({ queryKey: offerKeys.all });
      options?.onSuccess?.(offer);
    },
  });
};
