import { FunctionsHttpError } from '@supabase/supabase-js';

import type { PaymentRow, Uuid } from '../types/database';
import { supabase } from './supabase';

/**
 * Payments, from the app's side of the wall.
 *
 * NOTHING IN THIS FILE TALKS TO STRIPE'S API. Every call here either invokes a
 * Supabase Edge Function or reads a row the Edge Functions wrote. The Stripe
 * SECRET key exists only in those functions' environment — it is not in `.env`,
 * not in the bundle, and not reachable from a device.
 *
 * The app does hold the PUBLISHABLE key, which is designed to be public. It
 * lets Stripe's SDK collect a card and confirm a PaymentIntent whose client
 * secret we hand it. It cannot capture, transfer, refund, or read anything.
 *
 * PCI: raw card numbers never reach this code. The PaymentSheet is Stripe's own
 * native UI; the card goes from it straight to Stripe. Yoodle sees a
 * `clientSecret` and, afterwards, a status — never a PAN, CVC or expiry. That
 * is what keeps this project out of PCI scope, and it is why no screen in this
 * app has a card number field.
 */

const PAYMENT_COLUMNS =
  'id, job_id, offer_id, payer_id, payee_id, amount_cents, currency, status, authorized_at, released_at, created_at, updated_at';

export interface ServiceFailure {
  ok: false;
  message: string;
  /** Machine-readable hint from the Edge Function, e.g. `payee_not_onboarded`. */
  code?: string;
}

/** The shape every Edge Function in this phase uses for a failure. */
interface EdgeFailureBody {
  error?: unknown;
  code?: unknown;
}

/**
 * Turn a failed `functions.invoke` into the message the function actually sent.
 *
 * THIS IS NOT DECORATION. `functions.invoke` resolves with `data: null` for ANY
 * non-2xx response and puts the response itself on the error — so reading
 * `data.error` finds `undefined` every time and replaces every deliberate
 * message ("This worker has not finished setting up payouts yet…") and every
 * machine-readable `code` with generic filler. The body has to be read off
 * `FunctionsHttpError.context`, which is the raw `Response`.
 */
const readEdgeFailure = async (error: unknown, fallback: string): Promise<ServiceFailure> => {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await (error.context as Response).json()) as EdgeFailureBody;
      if (typeof body.error === 'string' && body.error.length > 0) {
        return {
          ok: false,
          message: body.error,
          code: typeof body.code === 'string' ? body.code : undefined,
        };
      }
    } catch {
      // A non-JSON body (a platform-level 502, say) is not worth surfacing
      // verbatim; fall through to the caller's wording.
    }
  }
  return { ok: false, message: fallback };
};

/** The statuses the UI cares about, in the order they happen. */
export type PaymentStatus = PaymentRow['status'];

/**
 * How far along a payment is. Higher wins when a job has more than one.
 *
 * A job CAN have several payment rows: `payments_one_per_offer` is unique on
 * `offer_id`, not `job_id`, so an offer that was accepted and failed, then
 * withdrawn in favour of another, leaves a row behind. Ordering by time alone
 * is not enough — the interesting row is the one furthest along, not the newest
 * — and picking arbitrarily lets a dead `failed` row hide a live `authorized`
 * one.
 */
const STATUS_PRECEDENCE: Record<PaymentStatus, number> = {
  released: 6,
  captured: 5,
  authorized: 4,
  requires_action: 3,
  requires_payment_method: 2,
  failed: 1,
  canceled: 0,
};

/**
 * The one payment that represents a job, out of however many rows exist.
 *
 * Furthest along wins; ties break to the most recent. Deterministic either way,
 * which is the point — two callers must never disagree about which payment a
 * job has.
 */
export const pickLivePayment = (payments: readonly PaymentRow[]): PaymentRow | null => {
  let best: PaymentRow | null = null;

  for (const payment of payments) {
    if (!best) {
      best = payment;
      continue;
    }
    const rank = STATUS_PRECEDENCE[payment.status] - STATUS_PRECEDENCE[best.status];
    if (rank > 0 || (rank === 0 && payment.created_at > best.created_at)) {
      best = payment;
    }
  }

  return best;
};

export interface PayoutStatus {
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}

export type OnboardingLinkResult =
  { ok: true; onboardingUrl: string; status: PayoutStatus } | ServiceFailure;

/**
 * Start (or resume) Stripe Connect onboarding for the signed-in user.
 *
 * Returns a single-use hosted URL. Stripe collects the identity and banking
 * details on their own page — deliberately, so those details never touch
 * Yoodle.
 */
export const startPayoutOnboarding = async (): Promise<OnboardingLinkResult> => {
  const { data, error } = await supabase.functions.invoke('stripe-connect-onboarding', {
    body: {},
  });

  if (error) {
    return readEdgeFailure(error, 'Could not start payouts setup. Please try again.');
  }

  if (!data?.onboardingUrl) {
    return { ok: false, message: 'Could not start payouts setup. Please try again.' };
  }

  return {
    ok: true,
    onboardingUrl: data.onboardingUrl as string,
    status: {
      payoutsEnabled: Boolean(data.payoutsEnabled),
      detailsSubmitted: Boolean(data.detailsSubmitted),
    },
  };
};

export type PayoutStatusResult = { ok: true; status: PayoutStatus } | ServiceFailure;

/**
 * The signed-in user's payout readiness, read from their own profile row.
 *
 * `stripe_account_id` is deliberately NOT selected — the client has no SELECT
 * privilege on it (migration 0017), so naming it would fail the whole query.
 */
export const getMyPayoutStatus = async (userId: Uuid): Promise<PayoutStatusResult> => {
  const { data, error } = await supabase
    .from('profiles')
    .select('stripe_payouts_enabled, stripe_details_submitted')
    .eq('id', userId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, message: 'Could not load your payout status.' };
  }

  return {
    ok: true,
    status: {
      payoutsEnabled: Boolean(data.stripe_payouts_enabled),
      detailsSubmitted: Boolean(data.stripe_details_submitted),
    },
  };
};

export interface AuthorizedPayment {
  paymentId: Uuid;
  /** Handed to Stripe's SDK. Useless without the publishable key and short-lived. */
  clientSecret: string;
  amountCents: number;
  currency: string;
  reused: boolean;
}

export type AuthorizeResult = { ok: true; payment: AuthorizedPayment } | ServiceFailure;

/**
 * Accept an offer and place a hold on the poster's card, in one call.
 *
 * Safe to call twice. The Edge Function is idempotent three ways over — a
 * unique constraint on `offer_id`, reuse of an existing PaymentIntent, and a
 * Stripe idempotency key — so a double tap yields one hold, not two.
 */
export const authorizePaymentForOffer = async (offerId: Uuid): Promise<AuthorizeResult> => {
  const { data, error } = await supabase.functions.invoke('stripe-authorize-payment', {
    body: { offerId },
  });

  if (error) {
    return readEdgeFailure(error, 'Could not start the payment. Please try again.');
  }

  if (!data?.clientSecret) {
    return { ok: false, message: 'Could not start the payment. Please try again.' };
  }

  return {
    ok: true,
    payment: {
      paymentId: data.paymentId as Uuid,
      clientSecret: data.clientSecret as string,
      amountCents: data.amountCents as number,
      currency: data.currency as string,
      reused: Boolean(data.reused),
    },
  };
};

export type ReleaseResult = { ok: true; alreadyReleased: boolean } | ServiceFailure;

/**
 * Mark the job complete: capture the hold and transfer to the worker.
 *
 * The Edge Function checks the worker can actually be paid BEFORE capturing, so
 * a worker who has not finished onboarding leaves the hold untouched rather
 * than stranding captured money in the platform balance.
 */
export const releasePaymentForJob = async (jobId: Uuid): Promise<ReleaseResult> => {
  const { data, error } = await supabase.functions.invoke('stripe-release-payment', {
    body: { jobId },
  });

  if (error) {
    return readEdgeFailure(error, 'Could not release the payment. Please try again.');
  }

  if (!data) {
    return { ok: false, message: 'Could not release the payment. Please try again.' };
  }

  return { ok: true, alreadyReleased: Boolean(data.alreadyReleased) };
};

export type CancelPaymentResult = { ok: true; cancelled: boolean } | ServiceFailure;

/**
 * Release the hold on a job's card before the job is cancelled.
 *
 * A manual-capture PaymentIntent is a REAL authorisation on a real card. The
 * money is not taken, but it is unavailable to the poster until Stripe lets the
 * authorisation expire — up to about a week. Cancelling a job without doing
 * this leaves that hold standing with nothing in the app able to lift it.
 *
 * Succeeds when there is no payment at all, so a cancel on an unpaid job is not
 * blocked by a call that had nothing to do. Refuses when the money has already
 * been captured or released: that needs a refund, which is a different decision
 * and not one a "cancel job" button should be making.
 */
export const cancelPaymentForJob = async (jobId: Uuid): Promise<CancelPaymentResult> => {
  const { data, error } = await supabase.functions.invoke('stripe-cancel-payment', {
    body: { jobId },
  });

  if (error) {
    return readEdgeFailure(error, 'Could not release the hold on this job. Please try again.');
  }

  if (!data) {
    return { ok: false, message: 'Could not release the hold on this job. Please try again.' };
  }

  return { ok: true, cancelled: Boolean(data.cancelled) };
};

export type PaymentResult = { ok: true; payment: PaymentRow | null } | ServiceFailure;

/**
 * The payment on a job, if there is one and the caller is a party to it.
 *
 * RLS restricts this to the payer and the payee, so a third party reading a
 * job's payment gets nothing rather than an error.
 *
 * NOT `.maybeSingle()`: uniqueness is on `offer_id`, so a job with a second
 * payment row would make that throw and the payment section would silently
 * vanish from the screen. All rows are read and `pickLivePayment` decides.
 */
export const getPaymentForJob = async (jobId: Uuid): Promise<PaymentResult> => {
  const { data, error } = await supabase
    .from('payments')
    .select(PAYMENT_COLUMNS)
    .eq('job_id', jobId);

  if (error) {
    return { ok: false, message: 'Could not load the payment for this job.' };
  }

  return { ok: true, payment: pickLivePayment(data ?? []) };
};

export type PaymentsResult = { ok: true; payments: PaymentRow[] } | ServiceFailure;

/**
 * Every payment this user is party to, as payer or payee.
 *
 * No filter is needed and none is applied: RLS already restricts the table to
 * rows where the caller is the payer or the payee, so an unfiltered select IS
 * the correct query. Lists index the result by job id rather than issuing one
 * read per row.
 */
export const listMyPayments = async (): Promise<PaymentsResult> => {
  const { data, error } = await supabase
    .from('payments')
    .select(PAYMENT_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) {
    return { ok: false, message: 'Could not load your payments.' };
  }

  return { ok: true, payments: data ?? [] };
};

/** Cents to a displayable amount. Stripe speaks cents; people do not. */
export const formatMoney = (cents: number, currency = 'cad'): string =>
  `$${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;

/** What the user is told a status means. */
export const paymentStatusLabel = (status: PaymentStatus): string => {
  switch (status) {
    case 'requires_payment_method':
      return 'Awaiting payment';
    case 'requires_action':
      return 'Confirm with your bank';
    case 'authorized':
      return 'Held';
    case 'captured':
      return 'Charged';
    case 'released':
      return 'Released to worker';
    case 'failed':
      return 'Payment failed';
    case 'canceled':
      return 'Payment cancelled';
  }
};

/** A one-line explanation, because "Held" alone invites the wrong reading. */
export const paymentStatusHelp = (status: PaymentStatus): string => {
  switch (status) {
    case 'requires_payment_method':
      return 'The poster has not completed payment yet.';
    case 'requires_action':
      return 'The bank asked for extra confirmation.';
    case 'authorized':
      return 'Funds are held on the poster’s card. Nothing has been charged yet, and nothing is sent until the job is marked complete.';
    case 'captured':
      return 'The card has been charged. The transfer to the worker is in progress.';
    case 'released':
      return 'The payment has been sent to the worker’s account.';
    case 'failed':
      return 'The payment did not go through. The poster can try again.';
    case 'canceled':
      return 'The hold was cancelled and nothing was charged.';
  }
};
