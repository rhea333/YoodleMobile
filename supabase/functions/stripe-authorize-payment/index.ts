// stripe-authorize-payment
//
// The poster accepts an offer. This accepts it AND places a hold on their card
// for the offer amount — `capture_method: 'manual'`, so the money is authorised
// but NOT taken. It is captured and transferred only when the job is marked
// complete (see stripe-release-payment).
//
// Accepting and authorising are one call on purpose. Two calls would leave a
// window where an offer is accepted but unpaid, and a poster who closed the app
// in that window would have committed to a job with no payment attached.
//
// IDEMPOTENCY, which is the whole reason this is careful:
//   1. `payments.offer_id` is UNIQUE — the database makes a second payment row
//      for one offer impossible.
//   2. An existing row's PaymentIntent is REUSED, not replaced.
//   3. The Stripe call carries an idempotency key derived from the offer id, so
//      even a retry that got past (1) and (2) returns the same PaymentIntent
//      rather than creating a second one.
// Two rapid taps therefore produce one hold, not two.
//
// NOTE ON WORKER ONBOARDING: a worker who has not finished Stripe onboarding
// does NOT block the hold. It blocks the RELEASE. Refusing here would be worse
// for both parties — the poster could not accept at all — and refusing at
// release means nothing is ever captured that cannot be paid out.
//
// ONE ACCEPTED OFFER PER JOB (migration 0019). The idempotency above is all
// per-OFFER, and that is not the only way to end up with two holds on one job:
// accepting two DIFFERENT offers produces two legitimately distinct offer ids,
// two distinct idempotency keys and two distinct payment rows, and every check
// above passes. This function now refuses that in two places:
//
//   1. Before touching Stripe, by looking for a rival accepted offer. This is
//      the ordinary path and it costs one query.
//   2. On the `offers` update, where `offers_one_accepted_per_job` rejects the
//      loser of a concurrent accept with 23505. Check (1) CANNOT catch this —
//      two requests can both read "no accepted offer yet" before either
//      writes, so only the index can decide it.
//
// In both cases NO HOLD IS PLACED. Path (1) returns before any Stripe call at
// all. Path (2) has created a PaymentIntent but never confirmed it, and an
// unconfirmed intent has no authorisation on any card — it is cancelled on the
// way out regardless.

import {
  CURRENCY,
  describeStripeError,
  json,
  preflight,
  requireUser,
  stripe,
  supabaseAdmin,
  toCents,
} from '../_shared/stripe.ts';

/** Postgres unique-violation. Here: somebody else was accepted first. */
const UNIQUE_VIOLATION = '23505';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const user = await requireUser(req);
  if (!user) return json({ error: 'Not signed in.' }, 401);

  let offerId: string;
  try {
    ({ offerId } = await req.json());
    if (!offerId || typeof offerId !== 'string') throw new Error('offerId required');
  } catch {
    return json({ error: 'offerId is required.' }, 400);
  }

  try {
    // Load the offer and its job together so the authorisation check below sees
    // the real poster, not one supplied by the caller.
    const { data: offer, error: offerError } = await supabaseAdmin
      .from('offers')
      .select('id, job_id, worker_id, amount, status, jobs!inner(id, poster_id, title, status)')
      .eq('id', offerId)
      .single();

    if (offerError || !offer) return json({ error: 'That offer no longer exists.' }, 404);

    const job = offer.jobs as unknown as {
      id: string;
      poster_id: string;
      title: string;
      status: string;
    };

    // THE authorisation check. A valid session for the wrong user stops here.
    if (job.poster_id !== user.id) {
      return json({ error: 'Only the job poster can accept an offer.' }, 403);
    }

    if (offer.worker_id === user.id) {
      return json({ error: 'You cannot accept your own offer.' }, 400);
    }

    if (!['pending', 'accepted'].includes(offer.status)) {
      return json({ error: `This offer is ${offer.status} and cannot be accepted.` }, 409);
    }

    // The JOB has to be payable too, not just the offer. Cancelling a job does
    // not settle the offers sitting on it, so without this a poster can cancel
    // and then accept a still-`pending` offer — putting a hold on a card for
    // work nobody expects to happen. `completed` is refused for the same
    // reason in reverse: the money for that job has already moved.
    if (job.status === 'cancelled' || job.status === 'completed') {
      return json(
        {
          error:
            job.status === 'cancelled'
              ? 'This job has been cancelled, so it cannot be paid for.'
              : 'This job is already complete.',
        },
        409,
      );
    }

    // Has this poster already accepted somebody else for this job?
    //
    // `.limit(1)` on an array rather than `.maybeSingle()`: this query runs on
    // data that predates 0019, where a job CAN still have two accepted offers,
    // and `.maybeSingle()` would throw on exactly the broken rows this check
    // exists to notice.
    const { data: rivals, error: rivalError } = await supabaseAdmin
      .from('offers')
      .select('id, worker_id')
      .eq('job_id', job.id)
      .eq('status', 'accepted')
      .neq('id', offerId)
      .limit(1);

    if (rivalError) {
      console.error('stripe-authorize-payment could not check rival offers', rivalError);
      return json({ error: 'Could not check this job. Please try again.' }, 500);
    }

    if (rivals && rivals.length > 0) {
      // Deliberately BEFORE any Stripe call: nothing is created, so there is
      // nothing to cancel and no possibility of a stray hold.
      return json(
        {
          error:
            'You have already accepted another offer on this job. Cancel the job if you want to start again.',
          code: 'offer_already_accepted',
        },
        409,
      );
    }

    const amountCents = toCents(offer.amount);

    // --- reuse an existing payment if there is one --------------------------
    const { data: existing } = await supabaseAdmin
      .from('payments')
      .select('id, status, amount_cents, stripe_payment_intent_id')
      .eq('offer_id', offerId)
      .maybeSingle();

    if (existing?.stripe_payment_intent_id) {
      if (['captured', 'released'].includes(existing.status)) {
        return json({ error: 'This job has already been paid.' }, 409);
      }

      const intent = await stripe.paymentIntents.retrieve(existing.stripe_payment_intent_id);

      // A reused intent must be for the same money. If the offer amount moved
      // underneath us, refuse rather than quietly charging the old figure.
      if (intent.amount !== amountCents) {
        return json(
          { error: 'The offer amount changed. Ask the worker to resubmit their offer.' },
          409,
        );
      }

      return json({
        paymentId: existing.id,
        clientSecret: intent.client_secret,
        amountCents: intent.amount,
        currency: intent.currency,
        status: existing.status,
        reused: true,
      });
    }

    // --- otherwise create one ----------------------------------------------
    const intent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: CURRENCY,
        // The hold. Nothing is taken from the card until capture.
        capture_method: 'manual',
        automatic_payment_methods: { enabled: true },
        metadata: {
          yoodle_offer_id: offerId,
          yoodle_job_id: job.id,
          yoodle_payer_id: user.id,
          yoodle_payee_id: offer.worker_id,
        },
        description: `Yoodle: ${job.title}`,
      },
      { idempotencyKey: `authorize:${offerId}` },
    );

    // Insert BEFORE returning the client secret. If this fails we must not hand
    // the app a usable intent we have no record of.
    const { data: payment, error: insertError } = await supabaseAdmin
      .from('payments')
      .insert({
        job_id: job.id,
        offer_id: offerId,
        payer_id: user.id,
        payee_id: offer.worker_id,
        amount_cents: amountCents,
        currency: CURRENCY,
        status: 'requires_payment_method',
        stripe_payment_intent_id: intent.id,
      })
      .select('id, status')
      .single();

    if (insertError || !payment) {
      // Lost the race with a concurrent call: the unique constraint on offer_id
      // fired. Cancel the intent we just made and hand back the winner's, so
      // two taps never leave two holds on the card.
      await stripe.paymentIntents.cancel(intent.id).catch(() => undefined);

      const { data: winner } = await supabaseAdmin
        .from('payments')
        .select('id, status, stripe_payment_intent_id')
        .eq('offer_id', offerId)
        .maybeSingle();

      if (winner?.stripe_payment_intent_id) {
        const winning = await stripe.paymentIntents.retrieve(winner.stripe_payment_intent_id);
        return json({
          paymentId: winner.id,
          clientSecret: winning.client_secret,
          amountCents: winning.amount,
          currency: winning.currency,
          status: winner.status,
          reused: true,
        });
      }

      return json({ error: 'Could not start the payment. Please try again.' }, 500);
    }

    // Accept the offer only once the payment record exists.
    //
    // THIS ERROR IS NOT IGNORABLE. Returning a client secret for an offer that
    // is still `pending` means the poster's card can be charged for an offer
    // the worker is never told was accepted. Cancel the intent and fail instead
    // — nothing has been confirmed yet, so nothing is lost by stopping here.
    const { error: acceptError } = await supabaseAdmin
      .from('offers')
      .update({ status: 'accepted' })
      .eq('id', offerId);

    if (acceptError) {
      console.error('stripe-authorize-payment could not accept the offer', acceptError);

      // Unwind Stripe first, before deciding what to say. The intent was
      // created but NEVER CONFIRMED — no card has been attached to it and no
      // authorisation exists — so cancelling it leaves the poster's card
      // untouched. Doing this on every failure path, not just the expected
      // one, is what keeps a stray intent from lingering.
      await stripe.paymentIntents.cancel(intent.id).catch(() => undefined);
      await supabaseAdmin
        .from('payments')
        .update({ status: 'canceled', last_error: `accept failed: ${acceptError.message}` })
        .eq('id', payment.id);

      // 23505 on `offers_one_accepted_per_job` means we lost a concurrent
      // accept: another offer on this job became accepted between our check
      // above and this write. That is the index doing its job, not a fault, so
      // it gets a 409 and a sentence a person can act on rather than a 500 and
      // a raw constraint name.
      if (acceptError.code === UNIQUE_VIOLATION) {
        return json(
          {
            error:
              'Another offer on this job was accepted first. Only one offer per job can be accepted.',
            code: 'offer_already_accepted',
          },
          409,
        );
      }

      return json({ error: 'Could not accept that offer. Please try again.' }, 500);
    }

    return json({
      paymentId: payment.id,
      clientSecret: intent.client_secret,
      amountCents,
      currency: CURRENCY,
      status: payment.status,
      reused: false,
    });
  } catch (error) {
    const { message, detail } = describeStripeError(error);
    console.error('stripe-authorize-payment failed', detail);
    await supabaseAdmin.from('payments').update({ last_error: detail }).eq('offer_id', offerId);
    return json({ error: message }, 500);
  }
});
