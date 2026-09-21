// _shared/stripe.ts
//
// Shared setup for every Stripe Edge Function.
//
// THE ONE RULE: STRIPE_SECRET_KEY is read here and nowhere else, and this file
// only ever runs on Supabase's servers. It is not imported by the app, it is
// not bundled into the app, and nothing it returns to a client contains the
// key, a connected account id, or any other Stripe credential.
//
// If you find yourself wanting the secret key in /src, stop: the answer is a
// new Edge Function, not a new environment variable.

import Stripe from 'npm:stripe@^17.5.0';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@^2.47.0';

const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
if (!stripeSecretKey) {
  throw new Error(
    'STRIPE_SECRET_KEY is not set. Set it with `supabase secrets set` or in the ' +
      'dashboard under Edge Functions > Secrets. See SECURITY.md.',
  );
}

/**
 * Deno has no Node HTTP stack, so Stripe needs its fetch client explicitly.
 * `apiVersion` is pinned: letting Stripe pick means a silent behaviour change
 * the day they ship a new default, which is not something a payments path
 * should discover in production.
 */
export const stripe = new Stripe(stripeSecretKey, {
  apiVersion: '2024-12-18.acacia',
  httpClient: Stripe.createFetchHttpClient(),
});

/** Deno's crypto is async-only, so webhook verification must use this. */
export const cryptoProvider = Stripe.createSubtleCryptoProvider();

/**
 * Service-role client. Bypasses RLS, which is exactly why it lives only here:
 * these functions are the only writer of payment state, and RLS grants no
 * client the ability to write it at all (migration 0017).
 */
export const supabaseAdmin: SupabaseClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export const CURRENCY = 'cad';

/** JSON response with the CORS headers an Expo client needs. */
export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });

export const preflight = (): Response => json({ ok: true });

/**
 * Identify the caller from their JWT.
 *
 * `verify_jwt` on the platform already rejects an invalid token, but it does
 * not tell the handler WHO called. Every function needs that, because "is this
 * person the poster of this job" is the authorisation question that actually
 * matters here — a valid session belonging to the wrong user must not be able
 * to release someone else's payment.
 */
export const requireUser = async (req: Request): Promise<{ id: string } | null> => {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id };
};

/** `offers.amount` is numeric dollars; Stripe wants integer cents. */
export const toCents = (amount: number | string): number => {
  const dollars = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(dollars) || dollars <= 0) {
    throw new Error(`Refusing to charge a non-positive amount: ${amount}`);
  }
  // Round rather than truncate: 40.955 must not become $40.95 on one path and
  // $40.96 on another.
  return Math.round(dollars * 100);
};

/**
 * Stripe's PaymentIntent status -> the value mirrored in `payments.status`.
 *
 * Only the states meaning "no hold" are listed; `requires_capture` and
 * `succeeded` are handled directly by the functions that act on them, because
 * they are the states that let money move. `processing` is deliberately absent
 * — it is transient, and writing it would overwrite a truer value with a guess.
 */
export const MIRRORED_STATUS: Record<string, string | undefined> = {
  requires_payment_method: 'requires_payment_method',
  requires_confirmation: 'requires_payment_method',
  requires_action: 'requires_action',
  canceled: 'canceled',
};

/** How far along a payment is. Higher wins when a job has more than one row. */
const STATUS_PRECEDENCE: Record<string, number> = {
  released: 6,
  captured: 5,
  authorized: 4,
  requires_action: 3,
  requires_payment_method: 2,
  failed: 1,
  canceled: 0,
};

/** The columns every function here needs to reason about a payment. */
export const PAYMENT_RECORD_COLUMNS =
  'id, job_id, offer_id, status, amount_cents, currency, payee_id, stripe_payment_intent_id, authorized_at, created_at';

export interface PaymentRecord {
  id: string;
  job_id: string;
  offer_id: string;
  status: string;
  amount_cents: number;
  currency: string;
  payee_id: string;
  stripe_payment_intent_id: string | null;
  authorized_at: string | null;
  created_at: string;
}

/**
 * The one payment that represents a job, out of however many rows exist.
 *
 * A job CAN have several: `payments_one_per_offer` is unique on `offer_id`, not
 * `job_id`, so an offer that was accepted and failed, then replaced, leaves a
 * row behind. Selecting with `.maybeSingle()` on `job_id` therefore THROWS on
 * exactly the jobs that have had trouble — the ones most in need of attention.
 *
 * Furthest along wins; ties break to the most recent. This mirrors
 * `pickLivePayment` in src/services/payments.ts on purpose: the app and these
 * functions must never disagree about which payment a job has, or the app shows
 * a row the server refuses to act on.
 */
export const pickLivePayment = (rows: readonly PaymentRecord[]): PaymentRecord | null => {
  let best: PaymentRecord | null = null;

  for (const row of rows) {
    if (!best) {
      best = row;
      continue;
    }
    const rank = (STATUS_PRECEDENCE[row.status] ?? 0) - (STATUS_PRECEDENCE[best.status] ?? 0);
    if (rank > 0 || (rank === 0 && row.created_at > best.created_at)) {
      best = row;
    }
  }

  return best;
};

/**
 * Stripe errors carry detail that is useful in a log and wrong on a phone
 * screen — it can name internal ids and account state. Callers get a short
 * message; the detail goes to `payments.last_error`, which no client can read.
 */
export const describeStripeError = (error: unknown): { message: string; detail: string } => {
  if (error instanceof Stripe.errors.StripeError) {
    return {
      message:
        error.type === 'StripeCardError'
          ? (error.message ?? 'That card was declined.')
          : 'The payment provider rejected that request. Please try again.',
      detail: `${error.type}: ${error.code ?? 'no_code'}: ${error.message ?? ''}`,
    };
  }
  return {
    message: 'Something went wrong talking to the payment provider.',
    detail: error instanceof Error ? error.message : String(error),
  };
};
