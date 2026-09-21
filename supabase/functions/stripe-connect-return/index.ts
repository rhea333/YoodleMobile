// stripe-connect-return
//
// The https landing pad Stripe needs at the end of Connect onboarding.
//
// WHY THIS FILE EXISTS: `accountLinks.create` rejects a custom scheme.
// `refresh_url` and `return_url` MUST be http(s), so `yoodle://payouts` cannot
// be given to Stripe directly — it fails the call outright. This function is
// the https URL Stripe will accept, and all it does is bounce the browser
// straight back into the app via the custom scheme, which
// `WebBrowser.openAuthSessionAsync` is waiting for.
//
// IT IS NOT AN OPEN REDIRECT, AND THAT IS DELIBERATE. The destination is a
// constant in this file. The only thing the query string can influence is which
// of two fixed suffixes is appended — nothing from the request ever becomes
// part of the target URL. A redirector that echoed a caller-supplied `url`
// would be a phishing primitive hosted on our own domain.
//
// PUBLIC BY NECESSITY: Stripe redirects the user's browser here, and that
// browser carries no Supabase session. Deploy with `--no-verify-jwt`. There is
// nothing to protect — it reads no data, writes no data, and holds no secret.
// Onboarding state is never taken from this redirect; it is read back from
// Stripe by stripe-connect-onboarding and by the `account.updated` webhook.

/** The app. A constant, never anything derived from the request. */
const APP_SCHEME_URL = 'yoodle://payouts';

Deno.serve((req: Request): Response => {
  // `state` is compared against a fixed set and then thrown away. An unexpected
  // value simply lands on the plain screen.
  const state = new URL(req.url).searchParams.get('state');
  const target = state === 'refresh' ? `${APP_SCHEME_URL}?refresh=1` : `${APP_SCHEME_URL}?done=1`;

  // A 302 to a custom scheme is what ASWebAuthenticationSession and Chrome
  // Custom Tabs intercept to hand control back to the app. The HTML body is the
  // fallback for the case where the browser will not follow a scheme it does
  // not recognise — a plain link the user can tap, and nothing else.
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Returning to Yoodle</title>
    <meta http-equiv="refresh" content="0; url=${target}" />
  </head>
  <body style="font-family: system-ui, sans-serif; background: #0C1210; color: #F0ECE2; padding: 24px">
    <p>Taking you back to Yoodle&hellip;</p>
    <p><a href="${target}" style="color: #7FBE8E">Tap here if nothing happens</a></p>
  </body>
</html>`,
    {
      status: 302,
      headers: {
        Location: target,
        'Content-Type': 'text/html; charset=utf-8',
        // Account links are single-use; there is nothing here worth caching.
        'Cache-Control': 'no-store',
      },
    },
  );
});
