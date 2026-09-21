// stripe-release-payment
//
// The poster marks the job complete. This captures the held funds and transfers
// them to the worker's connected account, then marks the job `completed`.
//
// ORDER MATTERS, AND IT IS THE POINT OF THIS FILE:
//
//   1. check the worker can actually be paid out
//   2. capture   (money leaves the payer's card)
//   3. transfer  (money reaches the worker)
//
// Step 1 comes first so that step 2 never happens when step 3 cannot. Capturing
// a payment we are unable to transfer leaves the payer charged, the worker
// unpaid, and the money sitting in the platform's balance with no automatic
// way out — the worst of the available failure modes, and the one a naive
// "capture then try to transfer" ordering produces.
//
// IDEMPOTENCY: capture and transfer each carry an idempotency key derived from
// the payment id, and the status is re-read at each step. A double-tap, a retry
// after a timeout, or a webhook racing this function cannot pay the worker
// twice — Stripe returns the original transfer for a repeated key.
//
// STRIPE IS THE AUTHORITY, NOT `payments.status`. That column is a mirror kept
// up to date by the webhook, and a webhook can arrive late, be dropped, or be
// retried. Gating the release on the mirror alone means one missed
// `amount_capturable_updated` strands a REAL hold until it expires: the payer's
// money is tied up, the worker is owed, and nothing in the app can move it.
// This function therefore retrieves the PaymentIntent and decides from that,
// healing the mirror on the way through.

import {
  MIRRORED_STATUS,
  PAYMENT_RECORD_COLUMNS,
  type PaymentRecord,
  describeStripeError,
  json,
  pickLivePayment,
  preflight,
  requireUser,
  stripe,
  supabaseAdmin,
} from '../_shared/stripe.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const user = await requireUser(req);
  if (!user) return json({ error: 'Not signed in.' }, 401);

  let jobId: string;
  try {
    ({ jobId } = await req.json());
    if (!jobId || typeof jobId !== 'string') throw new Error('jobId required');
  } catch {
    return json({ error: 'jobId is required.' }, 400);
  }

  let paymentId: string | undefined;

  try {
    const { data: job, error: jobError } = await supabaseAdmin
      .from('jobs')
      .select('id, poster_id, status')
      .eq('id', jobId)
      .single();

    if (jobError || !job) return json({ error: 'That job no longer exists.' }, 404);

    if (job.poster_id !== user.id) {
      return json({ error: 'Only the job poster can mark it complete.' }, 403);
    }

    // A cancelled job must not be completable. Cancelling does not settle the
    // offers or payments on a job, so without this the poster could cancel and
    // then "mark complete", capturing the card and flipping the job back to
    // `completed` — paying out for work that was called off.
    if (job.status === 'cancelled') {
      return json(
        { error: 'This job was cancelled. Reopen or repost it before releasing a payment.' },
        409,
      );
    }

    // NOT `.maybeSingle()`: `payments_one_per_offer` is unique on `offer_id`,
    // not `job_id`. A job whose first offer failed and was replaced has two
    // rows, and `.maybeSingle()` would throw on it — permanently answering
    // "There is no payment on this job yet" for a job that plainly has one.
    const { data: paymentRows, error: paymentError } = await supabaseAdmin
      .from('payments')
      .select(PAYMENT_RECORD_COLUMNS)
      .eq('job_id', jobId);

    if (paymentError) {
      console.error('stripe-release-payment could not read payments', paymentError);
      return json({ error: 'Could not load the payment for this job.' }, 500);
    }

    const payment = pickLivePayment((paymentRows ?? []) as PaymentRecord[]);

    if (!payment) {
      return json({ error: 'There is no payment on this job yet.' }, 404);
    }

    paymentId = payment.id;

    if (payment.status === 'released') {
      // Already done. Succeed rather than erroring, so a retried request is a
      // no-op instead of a confusing failure.
      return json({ status: 'released', alreadyReleased: true });
    }

    if (!payment.stripe_payment_intent_id) {
      return json({ error: 'This payment is missing its Stripe record.' }, 500);
    }

    // --- 0. reconcile with Stripe ------------------------------------------
    let intent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id);

    if (intent.status !== 'requires_capture' && intent.status !== 'succeeded') {
      // There is genuinely no hold to release. Heal the mirror before saying
      // so, so the app stops showing a state Stripe has abandoned.
      const mirrored = MIRRORED_STATUS[intent.status];
      if (mirrored && mirrored !== payment.status) {
        await supabaseAdmin.from('payments').update({ status: mirrored }).eq('id', payment.id);
      }

      return json(
        {
          error:
            intent.status === 'requires_payment_method' || intent.status === 'requires_confirmation'
              ? 'The payment has not been completed yet. Ask the poster to finish paying, then try again.'
              : intent.status === 'requires_action'
                ? 'The payment is waiting on confirmation from the bank.'
                : intent.status === 'canceled'
                  ? 'This payment was cancelled, so there is nothing to release.'
                  : `This payment is ${intent.status} and cannot be released yet.`,
        },
        409,
      );
    }

    // Stripe has a hold (or a capture) our mirror does not know about — a
    // webhook that never landed. Heal it and carry on rather than refusing a
    // release the money fully supports.
    const trueStatus = intent.status === 'succeeded' ? 'captured' : 'authorized';
    if (payment.status !== trueStatus) {
      console.warn(
        `Healing payment ${payment.id}: mirror said ${payment.status}, Stripe says ${intent.status}`,
      );
      await supabaseAdmin
        .from('payments')
        .update({
          status: trueStatus,
          authorized_at: payment.authorized_at ?? new Date().toISOString(),
        })
        .eq('id', payment.id);
    }

    // --- 1. can the worker actually receive money? --------------------------
    const { data: payee } = await supabaseAdmin
      .from('profiles')
      .select('id, stripe_account_id, stripe_payouts_enabled')
      .eq('id', payment.payee_id)
      .single();

    if (!payee?.stripe_account_id || !payee.stripe_payouts_enabled) {
      // This check comes BEFORE the capture below, so in the ordinary case
      // nothing has been taken: the hold stays in place, the payer is not
      // charged, and the worker can finish onboarding and be paid on a later
      // attempt. In the one case where the intent arrived already `succeeded`
      // — an earlier release that captured and then failed to transfer — the
      // money IS captured, and refusing here is what leaves it recoverable by
      // a retry once the worker is onboarded.
      return json(
        {
          error:
            'This worker has not finished setting up payouts yet, so the payment cannot be released. Ask them to complete payouts setup, then try again.',
          code: 'payee_not_onboarded',
        },
        409,
      );
    }

    // Re-check against Stripe rather than trusting our mirrored copy, which is
    // only as fresh as the last `account.updated` webhook.
    const account = await stripe.accounts.retrieve(payee.stripe_account_id);
    if (!account.payouts_enabled) {
      await supabaseAdmin
        .from('profiles')
        .update({ stripe_payouts_enabled: false })
        .eq('id', payee.id);

      return json(
        {
          error:
            'Stripe reports this worker cannot receive payouts yet. Ask them to finish payouts setup.',
          code: 'payee_not_onboarded',
        },
        409,
      );
    }

    // --- 2. capture ---------------------------------------------------------
    // Already narrowed to `requires_capture` or `succeeded` above, so this is
    // the only branch left: capture if it has not happened, otherwise reuse.
    if (intent.status === 'requires_capture') {
      intent = await stripe.paymentIntents.capture(payment.stripe_payment_intent_id, undefined, {
        idempotencyKey: `capture:${payment.id}`,
      });
    }

    const chargeId =
      typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id;

    if (!chargeId) {
      await supabaseAdmin
        .from('payments')
        .update({ status: 'captured', last_error: 'captured but no charge id' })
        .eq('id', payment.id);
      return json({ error: 'Captured the payment but could not find the charge.' }, 500);
    }

    await supabaseAdmin
      .from('payments')
      .update({ status: 'captured', stripe_charge_id: chargeId })
      .eq('id', payment.id);

    // --- 3. transfer --------------------------------------------------------
    // `source_transaction` ties the transfer to this specific charge, which
    // lets it go through before the funds have settled into the platform
    // balance. Without it a fresh platform account has no available balance and
    // every transfer fails with `balance_insufficient`.
    const transfer = await stripe.transfers.create(
      {
        amount: payment.amount_cents,
        currency: payment.currency,
        destination: payee.stripe_account_id,
        source_transaction: chargeId,
        metadata: { yoodle_payment_id: payment.id, yoodle_job_id: jobId },
      },
      { idempotencyKey: `transfer:${payment.id}` },
    );

    await supabaseAdmin
      .from('payments')
      .update({
        status: 'released',
        stripe_transfer_id: transfer.id,
        released_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('id', payment.id);

    // Only now is the job complete. Doing this earlier would leave a completed
    // job with an unpaid worker if the transfer failed.
    await supabaseAdmin.from('jobs').update({ status: 'completed' }).eq('id', jobId);

    return json({ status: 'released', transferred: true, amountCents: payment.amount_cents });
  } catch (error) {
    const { message, detail } = describeStripeError(error);
    console.error('stripe-release-payment failed', detail);
    if (paymentId) {
      await supabaseAdmin.from('payments').update({ last_error: detail }).eq('id', paymentId);
    }
    return json({ error: message }, 500);
  }
});
