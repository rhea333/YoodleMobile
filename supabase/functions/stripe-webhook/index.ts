// stripe-webhook
//
// The only thing Yoodle trusts as proof that money moved.
//
// SIGNATURE VERIFICATION IS NOT OPTIONAL AND IS NOT A FORMALITY.
//
// This endpoint is public — it has to be, because Stripe calls it and Stripe
// has no Supabase credentials. `verify_jwt` is therefore FALSE for this
// function, which means anyone on the internet can POST to it. The ONLY thing
// distinguishing a genuine Stripe event from a forged one is the
// `stripe-signature` header, computed by Stripe over the raw body with a shared
// secret.
//
// Without that check, `{"type":"payment_intent.succeeded", ...}` from any
// stranger with curl would mark a job paid and release a transfer. With it, a
// forged body fails HMAC and is rejected before a single row is read.
//
// Two details that are easy to get wrong:
//
//   * The signature is computed over the RAW body. `await req.text()` must come
//     before any parsing — re-serialising parsed JSON changes the bytes and
//     every signature fails.
//   * Deno's crypto is async, so `constructEventAsync` with the SubtleCrypto
//     provider is required. The sync `constructEvent` throws here.
//
// REPLAY PROTECTION: Stripe retries until it gets a 2xx and can deliver the
// same event more than once. Every event id is inserted into `stripe_events`
// first, and a primary-key collision means "already handled" — a lock rather
// than a check, so two concurrent deliveries of one event cannot both proceed.

import { cryptoProvider, json, stripe, supabaseAdmin } from '../_shared/stripe.ts';

const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (!webhookSecret) {
    // Fail closed. An unverifiable webhook is worth less than no webhook.
    console.error('STRIPE_WEBHOOK_SECRET is not set; refusing to process events.');
    return json({ error: 'Webhook not configured.' }, 500);
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) return json({ error: 'Missing signature.' }, 400);

  // RAW body, before anything parses it.
  const rawBody = await req.text();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
      undefined,
      cryptoProvider,
    );
  } catch (error) {
    console.error('Rejected a webhook with a bad signature', error);
    return json({ error: 'Invalid signature.' }, 400);
  }

  // --- replay protection ----------------------------------------------------
  const { error: seenError } = await supabaseAdmin
    .from('stripe_events')
    .insert({ id: event.id, type: event.type });

  if (seenError) {
    // 23505 = we have processed this event already. Anything else is a real
    // failure, and returning non-2xx asks Stripe to retry.
    if (seenError.code === '23505') {
      return json({ received: true, duplicate: true });
    }
    console.error('Could not record webhook event', seenError);
    return json({ error: 'Could not record event.' }, 500);
  }

  try {
    switch (event.type) {
      // The hold succeeded: the card is authorised, nothing captured yet. This
      // is what "funds held" means, and it is the state the app shows between
      // accepting an offer and completing the job.
      case 'payment_intent.amount_capturable_updated': {
        const intent = event.data.object;
        await supabaseAdmin
          .from('payments')
          .update({ status: 'authorized', authorized_at: new Date().toISOString() })
          .eq('stripe_payment_intent_id', intent.id)
          .in('status', ['requires_payment_method', 'requires_action', 'failed']);
        break;
      }

      // Captured. With manual capture this arrives after stripe-release-payment
      // captures, so it confirms rather than initiates. Deliberately does NOT
      // move the row to `released`: released means the TRANSFER landed, and
      // only the release function knows that.
      case 'payment_intent.succeeded': {
        const intent = event.data.object;
        const chargeId =
          typeof intent.latest_charge === 'string'
            ? intent.latest_charge
            : intent.latest_charge?.id;

        await supabaseAdmin
          .from('payments')
          .update({ status: 'captured', stripe_charge_id: chargeId ?? null })
          .eq('stripe_payment_intent_id', intent.id)
          .in('status', ['requires_payment_method', 'requires_action', 'authorized']);
        break;
      }

      case 'payment_intent.payment_failed': {
        const intent = event.data.object;
        await supabaseAdmin
          .from('payments')
          .update({
            status: 'failed',
            last_error: intent.last_payment_error?.message ?? 'payment failed',
          })
          .eq('stripe_payment_intent_id', intent.id)
          .not('status', 'in', '("captured","released")');
        break;
      }

      case 'payment_intent.canceled': {
        const intent = event.data.object;
        await supabaseAdmin
          .from('payments')
          .update({ status: 'canceled' })
          .eq('stripe_payment_intent_id', intent.id)
          .not('status', 'in', '("captured","released")');
        break;
      }

      // A worker finished (or lost) Connect onboarding. This is the only thing
      // that flips `stripe_payouts_enabled`, and stripe-release-payment
      // re-checks it against Stripe anyway before paying anyone.
      case 'account.updated': {
        const account = event.data.object;
        await supabaseAdmin
          .from('profiles')
          .update({
            stripe_payouts_enabled: account.payouts_enabled ?? false,
            stripe_details_submitted: account.details_submitted ?? false,
          })
          .eq('stripe_account_id', account.id);
        break;
      }

      default:
        // Unhandled types are fine; acknowledge so Stripe stops retrying.
        break;
    }

    return json({ received: true });
  } catch (error) {
    console.error(`Failed handling ${event.type}`, error);
    // Non-2xx so Stripe retries. The event id row is left in place, which would
    // make the retry a no-op — so remove it and let the retry do real work.
    await supabaseAdmin.from('stripe_events').delete().eq('id', event.id);
    return json({ error: 'Handler failed.' }, 500);
  }
});
