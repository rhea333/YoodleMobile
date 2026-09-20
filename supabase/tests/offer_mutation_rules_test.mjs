// offer_mutation_rules_test.mjs
//
// Guards the rules in migration 0016: who may change what on an offer.
//
// This exists because all three of the holes below were REAL and reachable
// through the normal client, not hypothetical:
//
//   * a worker re-priced an already-accepted offer from $40 to $999;
//   * a poster rewrote the worker's note;
//   * a poster changed the worker's price from $40 to $1.
//
// The third predates phase 6 — `grant update (amount, status)` in 0004 is
// role-wide, so the poster's update policy has always carried the amount with
// it. None of this is caught by RLS or by column grants, because neither can
// say "this role may write this column on this row". A trigger can.
//
// Payments will read `offers.amount` as the number to charge. If any assertion
// here fails, that number is not trustworthy and payments must not ship.
//
// Run from the project root:  node supabase/tests/offer_mutation_rules_test.mjs
// Needs the p6-* accounts from TESTING.md. Creates and deletes its own job.

import { createRequire } from 'node:module';
import fs from 'node:fs';

const PROJECT = process.cwd();
const require = createRequire(`${PROJECT}/package.json`);
const { createClient } = require('@supabase/supabase-js');

const env = fs.readFileSync(`${PROJECT}/.env`, 'utf8');
const URL = /EXPO_PUBLIC_SUPABASE_URL=(.*)/.exec(env)[1].trim();
const KEY = /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=(.*)/.exec(env)[1].trim();

const ACCOUNTS = {
  poster: { email: 'p6-poster@yoodle.test', password: 'Phase6Test!pass1' },
  worker: { email: 'p6-worker@yoodle.test', password: 'Phase6Test!pass2' },
};

let failures = 0;
const check = (name, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
};

/** A write is "refused" if it errored OR silently matched no rows. */
const refused = (result) => Boolean(result.error) || (result.data ?? []).length === 0;

const clients = {};
const ids = {};
for (const [label, creds] of Object.entries(ACCOUNTS)) {
  const c = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword(creds);
  if (error) {
    console.log(`FATAL ${label}: ${error.message}`);
    process.exit(1);
  }
  clients[label] = c;
  ids[label] = data.user.id;
}

const newJob = async (title) => {
  const { data, error } = await clients.poster
    .from('jobs')
    .insert({
      poster_id: ids.poster,
      title,
      category: 'other',
      budget: 50,
      location: 'SRID=4326;POINT(-79.38 43.65)',
      status: 'published',
    })
    .select('id')
    .single();
  if (error) {
    console.log(`FATAL: job insert failed -> ${error.message}`);
    process.exit(1);
  }
  return data.id;
};

const newOffer = (jobId, amount = 40, message = 'original worker note') =>
  clients.worker
    .from('offers')
    .insert({ job_id: jobId, worker_id: ids.worker, amount, message, status: 'pending' })
    .select('id, amount, status, message')
    .single();

const createdJobs = [];

// ===========================================================================
// 1. A worker may amend only while the offer is pending.
// ===========================================================================
console.log('--- worker amending ---');
{
  const jobId = await newJob('P6R probe: worker amend');
  createdJobs.push(jobId);
  await newOffer(jobId);

  const amendPending = await clients.worker
    .from('offers')
    .update({ amount: 45, message: 'amended while pending' })
    .eq('job_id', jobId)
    .eq('worker_id', ids.worker)
    .select('amount, message');
  check(
    'worker CAN amend a pending offer',
    !refused(amendPending) && amendPending.data[0].amount === 45,
    amendPending.error?.message ?? JSON.stringify(amendPending.data),
  );

  // Poster accepts, which must freeze the offer.
  await clients.poster
    .from('offers')
    .update({ status: 'accepted' })
    .eq('job_id', jobId)
    .eq('worker_id', ids.worker);

  const rePrice = await clients.worker
    .from('offers')
    .update({ amount: 999, status: 'pending' })
    .eq('job_id', jobId)
    .eq('worker_id', ids.worker)
    .select('amount, status');
  check(
    'worker CANNOT re-price an ACCEPTED offer',
    refused(rePrice),
    rePrice.error?.message ?? `SUCCEEDED -> ${JSON.stringify(rePrice.data)}`,
  );

  const reopen = await clients.worker
    .from('offers')
    .update({ status: 'pending' })
    .eq('job_id', jobId)
    .eq('worker_id', ids.worker)
    .select('status');
  check(
    'worker CANNOT reopen an accepted offer to pending',
    refused(reopen),
    reopen.error?.message ?? `SUCCEEDED -> ${JSON.stringify(reopen.data)}`,
  );

  const { data: after } = await clients.worker
    .from('offers')
    .select('amount, status')
    .eq('job_id', jobId)
    .single();
  check(
    'the accepted offer still reads 45 / accepted',
    after.amount === 45 && after.status === 'accepted',
    JSON.stringify(after),
  );
}

// ===========================================================================
// 2. A worker may not accept or decline their own offer.
// ===========================================================================
console.log('\n--- worker self-accepting ---');
{
  const jobId = await newJob('P6R probe: worker self-accept');
  createdJobs.push(jobId);
  await newOffer(jobId);

  for (const status of ['accepted', 'declined']) {
    const attempt = await clients.worker
      .from('offers')
      .update({ status })
      .eq('job_id', jobId)
      .eq('worker_id', ids.worker)
      .select('status');
    check(
      `worker CANNOT set their own offer to ${status}`,
      refused(attempt),
      attempt.error?.message ?? `SUCCEEDED -> ${JSON.stringify(attempt.data)}`,
    );
  }

  const withdraw = await clients.worker
    .from('offers')
    .update({ status: 'withdrawn' })
    .eq('job_id', jobId)
    .eq('worker_id', ids.worker)
    .select('status');
  check(
    'worker CAN withdraw a pending offer',
    !refused(withdraw) && withdraw.data[0].status === 'withdrawn',
    withdraw.error?.message ?? JSON.stringify(withdraw.data),
  );

  const amendWithdrawn = await clients.worker
    .from('offers')
    .update({ amount: 77 })
    .eq('job_id', jobId)
    .eq('worker_id', ids.worker)
    .select('amount');
  check(
    'worker CANNOT amend a WITHDRAWN offer',
    refused(amendWithdrawn),
    amendWithdrawn.error?.message ?? `SUCCEEDED -> ${JSON.stringify(amendWithdrawn.data)}`,
  );
}

// ===========================================================================
// 3. A poster may change status and NOTHING else. This is the one payments
//    depends on.
// ===========================================================================
console.log('\n--- poster writing fields they must not own ---');
{
  const jobId = await newJob('P6R probe: poster writes');
  createdJobs.push(jobId);
  await newOffer(jobId, 40, 'original worker note');

  const priceEdit = await clients.poster
    .from('offers')
    .update({ amount: 1 })
    .eq('job_id', jobId)
    .select('amount');
  check(
    'poster CANNOT change the worker price',
    refused(priceEdit),
    priceEdit.error?.message ?? `SUCCEEDED -> ${JSON.stringify(priceEdit.data)}`,
  );

  const noteEdit = await clients.poster
    .from('offers')
    .update({ message: 'POSTER REWROTE THIS' })
    .eq('job_id', jobId)
    .select('message');
  check(
    'poster CANNOT change the worker note',
    refused(noteEdit),
    noteEdit.error?.message ?? `SUCCEEDED -> ${JSON.stringify(noteEdit.data)}`,
  );

  // The sneaky version: bundle a price change into a legitimate accept.
  const acceptWithPrice = await clients.poster
    .from('offers')
    .update({ status: 'accepted', amount: 5 })
    .eq('job_id', jobId)
    .select('status, amount');
  check(
    'poster CANNOT smuggle a price change into an accept',
    refused(acceptWithPrice),
    acceptWithPrice.error?.message ?? `SUCCEEDED -> ${JSON.stringify(acceptWithPrice.data)}`,
  );

  const accept = await clients.poster
    .from('offers')
    .update({ status: 'accepted' })
    .eq('job_id', jobId)
    .select('status, amount, message');
  check(
    'poster CAN accept, and amount/note survive untouched',
    !refused(accept) &&
      accept.data[0].status === 'accepted' &&
      accept.data[0].amount === 40 &&
      accept.data[0].message === 'original worker note',
    accept.error?.message ?? JSON.stringify(accept.data),
  );

  const acceptTwice = await clients.poster
    .from('offers')
    .update({ status: 'declined' })
    .eq('job_id', jobId)
    .select('status');
  check(
    'poster CANNOT decline an already-accepted offer',
    refused(acceptTwice),
    acceptTwice.error?.message ?? `SUCCEEDED -> ${JSON.stringify(acceptTwice.data)}`,
  );
}

// --- cleanup ----------------------------------------------------------------
for (const jobId of createdJobs) {
  await clients.poster.from('jobs').delete().eq('id', jobId);
}
console.log(`\ncleaned up ${createdJobs.length} probe jobs (offers cascade)`);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
