// tutor-handoff
//
// "Become a Tutor" on yoodle.ca signs the person into tutor.yoodle.ca with the
// same account, without asking them to sign in again.
//
// yoodle.ca calls this with the person's own access token. We make a one-time
// magic-link token for THAT user (no email is sent) and return its hash.
// yoodle.ca opens https://tutor.yoodle.ca/?start=tutor#th=<hash>, and the tutor
// site calls verifyOtp({ token_hash, type: 'magiclink' }) to get a session of its own.
//
// Why not just pass the yoodle.ca session tokens across? Refresh tokens rotate:
// once the tutor site refreshed, yoodle.ca's copy would be revoked and the
// person signed out there. A separate session on each site avoids that.
//
// The token is single-use and expires with the project's OTP expiry. It is only
// ever made for the caller. There is no way to ask for anyone else's.
// Standalone on purpose: _shared/stripe.ts needs the Stripe secret to load.

import { createClient } from 'npm:@supabase/supabase-js@^2.47.0';

const ALLOWED_ORIGINS = new Set(['https://yoodle.ca', 'https://www.yoodle.ca']);

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const reply = (req: Request, body: unknown, status = 200): Response => {
  const origin = req.headers.get('origin') ?? '';
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://yoodle.ca',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
      'Cache-Control': 'no-store',
    },
  });
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return reply(req, { ok: true });
  if (req.method !== 'POST') return reply(req, { error: 'Method not allowed' }, 405);

  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return reply(req, { error: 'Not signed in.' }, 401);

  const { data: { user }, error: userError } = await admin.auth.getUser(jwt);
  if (userError || !user) return reply(req, { error: 'Not signed in.' }, 401);
  if (!user.email) return reply(req, { error: 'This account has no email address.' }, 400);

  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    console.error('tutor-handoff generateLink', error?.message);
    return reply(req, { error: 'Could not sign you in to Yoodle Tutors.' }, 500);
  }

  return reply(req, { token_hash: tokenHash });
});
