// stripe-cancel-payment
//
// The poster cancels a job. This releases the hold on their card.
//
// WITHOUT THIS THERE IS NO WAY BACK. `capture_method: 'manual'` places a real
// authorisation on a real card: the money is not taken, but it is unavailable
// to the cardholder until Stripe lets the authorisation expire, which can take
// a week. Cancelling a job while a hold stands would quietly do that to the
// poster with nothing in the app able to undo it.
//
// WHAT THIS DOES NOT DO: refund. Once a payment is `captured` or `released` the
// money has left the card and, for `released`, reached the worker. Reversing
// that is a refund and a transfer reversal — a different decision, with a
// dispute behind it, and not something a "cancel job" button should perform.
// Those states are refused here and say why.
//
// IDEMPOTENCY: `paymentIntents.cancel` on an already-cancelled intent is
// treated as success, and the Stripe call carries a key derived from the
// payment id. Two taps cancel one hold and report the same result.

import {
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

/**
 * PaymentIntent states that can still be cancelled.
 *
 * `requires_capture` is the important one — that is a standing hold. The rest
 * are intents that never got that far, cancelled so they cannot later be
 * confirmed by a client still holding the secret.
 */
const CANCELABLE = [
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing',
  'requires_capture',
];

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

    // The same authorisation question as everywhere else: a valid session for
    // the wrong user must not be able to cancel someone else's hold.
    if (job.poster_id !== user.id) {
      return json({ error: 'Only the job poster can cancel this job.' }, 403);
    }

    const { data: paymentRows, error: paymentError } = await supabaseAdmin
      .from('payments')
      .select(PAYMENT_RECORD_COLUMNS)
      .eq('job_id', jobId);

    if (paymentError) {
      console.error('stripe-cancel-payment could not read payments', paymentError);
      return json({ error: 'Could not check the payment on this job.' }, 500);
    }

    const payment = pickLivePayment((paymentRows ?? []) as PaymentRecord[]);

    // Nothing was ever paid on this job. Succeed: the caller's next step is to
    // cancel the job itself, and there is no reason to block that.
    if (!payment) {
      return json({ status: 'no_payment', cancelled: false });
    }

    paymentId = payment.id;

    if (payment.status === 'released' || payment.status === 'captured') {
      return json(
        {
          error:
            payment.status === 'released'
              ? 'This job has already been paid out to the worker, so it cannot be cancelled here.'
              : 'This payment has already been charged. It needs a refund rather than a cancellation.',
          code: 'payment_already_settled',
        },
        409,
      );
    }

    if (payment.status === 'canceled' || !payment.stripe_payment_intent_id) {
      return json({ status: 'canceled', cancelled: false, alreadyCanceled: true });
    }

    const intent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id);

    if (intent.status === 'succeeded') {
      // Captured behind our back — a release that raced this call, or a webhook
      // we have not seen. Refuse rather than pretending the hold is still ours
      // to drop, and heal the mirror so the app stops offering to cancel it.
      await supabaseAdmin.from('payments').update({ status: 'captured' }).eq('id', payment.id);

      return json(
        {
          error:
            'This payment has already been charged. It needs a refund rather than a cancellation.',
          code: 'payment_already_settled',
        },
        409,
      );
    }

    if (CANCELABLE.includes(intent.status)) {
      await stripe.paymentIntents.cancel(
        payment.stripe_payment_intent_id,
        {
          cancellation_reason: 'abandoned',
        },
        { idempotencyKey: `cancel:${payment.id}` },
      );
    }
    // An intent already `canceled` at Stripe falls through: there is nothing to
    // cancel, and the row below still needs to catch up.

    const { error: updateError } = await supabaseAdmin
      .from('payments')
      .update({ status: 'canceled', last_error: null })
      .eq('id', payment.id);

    if (updateError) {
      // The hold IS gone — that is what matters and it is not reversible from
      // here. Report the bookkeeping failure rather than claiming success; the
      // `payment_intent.canceled` webhook will correct the row shortly.
      console.error(
        'stripe-cancel-payment cancelled the hold but could not record it',
        updateError,
      );
      return json({ error: 'Released the hold but could not update the payment record.' }, 500);
    }

    return json({ status: 'canceled', cancelled: true });
  } catch (error) {
    const { message, detail } = describeStripeError(error);
    console.error('stripe-cancel-payment failed', detail);
    if (paymentId) {
      await supabaseAdmin.from('payments').update({ last_error: detail }).eq('id', paymentId);
    }
    return json({ error: message }, 500);
  }
});
