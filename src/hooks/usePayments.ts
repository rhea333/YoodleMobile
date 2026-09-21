import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { PaymentSheetError, useStripe } from '@stripe/stripe-react-native';

import {
  authorizePaymentForOffer,
  getMyPayoutStatus,
  getPaymentForJob,
  listMyPayments,
  pickLivePayment,
  releasePaymentForJob,
  startPayoutOnboarding,
  type PayoutStatus,
} from '../services';
import { colors } from '../theme';
import type { PaymentRow, Uuid } from '../types/database';
import { jobKeys } from './useBrowseJobs';
import { offerKeys } from './useOffers';

/**
 * Payment state for the app.
 *
 * Everything here is a thin wrapper over an Edge Function call or an
 * RLS-protected read. No Stripe secret is involved on this side of the wall;
 * see the header of `services/payments.ts`.
 */

export const paymentKeys = {
  all: ['payments'] as const,
  forJob: (jobId: Uuid) => ['payments', 'job', jobId] as const,
  payoutStatus: (userId: Uuid) => ['payments', 'payout-status', userId] as const,
};

export const usePaymentForJobQuery = (
  jobId: Uuid,
  enabled = true,
): UseQueryResult<PaymentRow | null, Error> =>
  useQuery({
    queryKey: paymentKeys.forJob(jobId),
    enabled,
    queryFn: async (): Promise<PaymentRow | null> => {
      const result = await getPaymentForJob(jobId);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.payment;
    },
  });

/**
 * All of this user's payments, indexed by job id.
 *
 * One read for a whole list, rather than a hook per row — which React would not
 * allow anyway, since hook calls cannot go in a loop.
 *
 * A job can have MORE THAN ONE payment row (uniqueness is per offer, not per
 * job), so the index cannot be built by assignment — last write would win, and
 * since the read is newest-first that means the OLDEST row wins, letting a dead
 * `failed` payment hide the live `authorized` one. `pickLivePayment` picks the
 * row furthest along instead, the same rule `getPaymentForJob` uses.
 */
export const useMyPaymentsQuery = (
  enabled = true,
): UseQueryResult<Record<string, PaymentRow>, Error> =>
  useQuery({
    queryKey: [...paymentKeys.all, 'mine'],
    enabled,
    queryFn: async (): Promise<Record<string, PaymentRow>> => {
      const result = await listMyPayments();
      if (!result.ok) {
        throw new Error(result.message);
      }
      const grouped = new Map<string, PaymentRow[]>();
      for (const payment of result.payments) {
        const forJob = grouped.get(payment.job_id);
        if (forJob) {
          forJob.push(payment);
        } else {
          grouped.set(payment.job_id, [payment]);
        }
      }

      const byJob: Record<string, PaymentRow> = {};
      for (const [jobId, forJob] of grouped) {
        const live = pickLivePayment(forJob);
        if (live) {
          byJob[jobId] = live;
        }
      }
      return byJob;
    },
  });

export const usePayoutStatusQuery = (
  userId: Uuid | undefined,
): UseQueryResult<PayoutStatus, Error> =>
  useQuery({
    queryKey: paymentKeys.payoutStatus(userId ?? 'anonymous'),
    enabled: Boolean(userId),
    queryFn: async (): Promise<PayoutStatus> => {
      if (!userId) throw new Error('No signed-in user.');
      const result = await getMyPayoutStatus(userId);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.status;
    },
  });

export interface UseStartOnboardingOptions {
  onSuccess?: (url: string) => void;
}

export const useStartPayoutOnboardingMutation = (options?: UseStartOnboardingOptions) =>
  useMutation<string, Error, void>({
    mutationFn: async () => {
      const result = await startPayoutOnboarding();
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.onboardingUrl;
    },
    onSuccess: (url) => options?.onSuccess?.(url),
  });

export interface UseAcceptAndPayOptions {
  onSuccess?: (outcome: AcceptAndPayOutcome) => void;
}

/**
 * What happened, from the poster's point of view.
 *
 * `cancelled` is NOT a failure: the poster dismissed Stripe's sheet without
 * paying. It is reported separately so the UI can stay quiet rather than
 * showing an error banner for a deliberate act.
 */
export interface AcceptAndPayOutcome {
  cancelled: boolean;
}

/**
 * Where Stripe sends the customer back to after a 3D Secure challenge, which
 * happens in a browser or a bank app rather than in-process.
 *
 * Must match `scheme` in app.json and `urlScheme` on StripeProvider.
 */
const STRIPE_RETURN_URL = 'yoodle://stripe-redirect';

/**
 * Accept an offer and pay the hold, in the order the money requires.
 *
 * 1. The Edge Function accepts the offer and creates a manual-capture
 *    PaymentIntent, returning its client secret.
 * 2. `initPaymentSheet` + `presentPaymentSheet` show Stripe's own native sheet,
 *    which collects the card and confirms that intent.
 *
 * THE CARD NEVER REACHES THIS CODE. The sheet is rendered by Stripe's SDK and
 * the PAN, CVC and expiry go from it straight to Stripe; this hook sees a
 * client secret going in and a success or an error coming out. That is what
 * keeps Yoodle out of PCI scope, and it is why no screen in this app has a card
 * number field.
 *
 * A failure at step 2 leaves the offer accepted with an unpaid payment. That is
 * recoverable: OffersScreen keeps the action visible for an accepted offer
 * whose payment has not been authorised, and step 1 reuses the same intent
 * rather than creating a second hold.
 */
export const useAcceptAndPayMutation = (options?: UseAcceptAndPayOptions) => {
  const queryClient = useQueryClient();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  return useMutation<AcceptAndPayOutcome, Error, { offerId: Uuid }>({
    mutationFn: async ({ offerId }) => {
      const authorized = await authorizePaymentForOffer(offerId);
      if (!authorized.ok) {
        throw new Error(authorized.message);
      }

      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'Yoodle',
        paymentIntentClientSecret: authorized.payment.clientSecret,
        // Without this, a card that needs 3D Secure completes in the browser
        // and never returns to the app.
        returnURL: STRIPE_RETURN_URL,
        // Every accepted offer must produce a hold we can capture later. A
        // delayed method that settles days afterwards cannot do that.
        allowsDelayedPaymentMethods: false,
        style: 'alwaysDark',
        appearance: {
          colors: {
            primary: colors.primary,
            background: colors.surface,
            componentBackground: colors.surfaceMuted,
            componentBorder: colors.border,
            componentDivider: colors.border,
            primaryText: colors.textPrimary,
            secondaryText: colors.textSecondary,
            componentText: colors.textPrimary,
            placeholderText: colors.textMuted,
            icon: colors.textSecondary,
            error: colors.danger,
          },
        },
      });

      if (initError) {
        throw new Error(initError.message ?? 'Could not open the payment sheet.');
      }

      const { error: presentError } = await presentPaymentSheet();

      if (presentError) {
        if (presentError.code === PaymentSheetError.Canceled) {
          // The poster backed out. The offer is accepted and the hold is
          // unconfirmed; they can tap again from the same row.
          return { cancelled: true };
        }
        // Stripe's own copy is better than anything generic we would write —
        // it distinguishes a decline from an expired card from a 3DS failure.
        throw new Error(presentError.message ?? 'That payment could not be completed.');
      }

      return { cancelled: false };
    },
    onSuccess: (outcome) => {
      void queryClient.invalidateQueries({ queryKey: paymentKeys.all });
      void queryClient.invalidateQueries({ queryKey: offerKeys.all });
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      options?.onSuccess?.(outcome);
    },
  });
};

export interface UseReleasePaymentOptions {
  onSuccess?: (alreadyReleased: boolean) => void;
}

/** Mark the job complete: capture the hold and transfer to the worker. */
export const useReleasePaymentMutation = (options?: UseReleasePaymentOptions) => {
  const queryClient = useQueryClient();

  return useMutation<boolean, Error, Uuid>({
    mutationFn: async (jobId) => {
      const result = await releasePaymentForJob(jobId);
      if (!result.ok) {
        throw new Error(result.message);
      }
      return result.alreadyReleased;
    },
    onSuccess: (alreadyReleased) => {
      void queryClient.invalidateQueries({ queryKey: paymentKeys.all });
      void queryClient.invalidateQueries({ queryKey: jobKeys.all });
      void queryClient.invalidateQueries({ queryKey: offerKeys.all });
      options?.onSuccess?.(alreadyReleased);
    },
  });
};
