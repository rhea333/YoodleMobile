// stripe-connect-onboarding
//
// Creates (or reuses) a Stripe Connect Express account for the signed-in user
// and returns a one-time onboarding link for them to finish it.
//
// Express, not Custom: Stripe hosts the onboarding form, collects the identity
// and banking details, and handles the KYC. Those details never reach Yoodle's
// servers, which is the point — collecting them would make us responsible for
// storing them.
//
// The caller is always the account's owner. There is no path here to create or
// modify an account for anyone else.

import { json, preflight, requireUser, stripe, supabaseAdmin } from '../_shared/stripe.ts';

/**
 * Where Stripe sends the user when onboarding ends or needs restarting.
 *
 * THESE MUST BE http(s). `accountLinks.create` rejects a custom scheme, so
 * `yoodle://payouts` cannot go here — it fails the call and onboarding never
 * starts. The app is reached via stripe-connect-return, an https function whose
 * only job is to bounce the browser back to `yoodle://payouts`.
 */
const RETURN_BASE = `${Deno.env.get('SUPABASE_URL')}/functions/v1/stripe-connect-return`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const user = await requireUser(req);
  if (!user) return json({ error: 'Not signed in.' }, 401);

  try {
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, stripe_account_id')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return json({ error: 'Could not load your profile.' }, 404);
    }

    let accountId: string | null = profile.stripe_account_id;

    if (!accountId) {
      // Idempotency key derived from the user id, so a double-tap — or a retry
      // after a timeout where the first call actually succeeded — returns the
      // SAME account instead of leaving the user with two.
      const account = await stripe.accounts.create(
        {
          type: 'express',
          country: 'CA',
          capabilities: { transfers: { requested: true } },
          business_type: 'individual',
          metadata: { yoodle_user_id: user.id },
        },
        { idempotencyKey: `connect-account:${user.id}` },
      );

      accountId = account.id;

      const { error: saveError } = await supabaseAdmin
        .from('profiles')
        .update({ stripe_account_id: accountId })
        .eq('id', user.id);

      if (saveError) {
        // The account exists at Stripe but we failed to record it. Say so
        // plainly rather than silently creating a second one next time — the
        // idempotency key above means the retry will return this same account.
        return json({ error: 'Created your payouts account but could not save it.' }, 500);
      }
    }

    // Account links are single-use and short-lived, so this is created fresh on
    // every call rather than stored.
    const link = await stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      refresh_url: `${RETURN_BASE}?state=refresh`,
      return_url: `${RETURN_BASE}?state=done`,
    });

    // Read the live state back rather than trusting whatever was last written:
    // a user may have finished onboarding in a browser we never heard about.
    const account = await stripe.accounts.retrieve(accountId);

    await supabaseAdmin
      .from('profiles')
      .update({
        stripe_payouts_enabled: account.payouts_enabled ?? false,
        stripe_details_submitted: account.details_submitted ?? false,
      })
      .eq('id', user.id);

    return json({
      // Deliberately no account id in the response. The client has no use for
      // it and it is one more thing to leak.
      onboardingUrl: link.url,
      payoutsEnabled: account.payouts_enabled ?? false,
      detailsSubmitted: account.details_submitted ?? false,
    });
  } catch (error) {
    console.error('stripe-connect-onboarding failed', error);
    return json({ error: 'Could not start payouts setup. Please try again.' }, 500);
  }
});
