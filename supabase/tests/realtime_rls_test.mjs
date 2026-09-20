// realtime_rls_test.mjs
//
// Does Supabase Realtime apply the same RLS as a plain query? This answers it
// empirically rather than by reading docs: three signed-in accounts, one
// private conversation, and a third party subscribed to the WHOLE messages
// table trying to overhear it.
//
// Run from the project root:  node supabase/tests/realtime_rls_test.mjs
//
// Needs the three p6-* accounts from TESTING.md to exist. It creates a probe
// job, exercises offers and messages through the real client SDK, asserts, and
// deletes the job (offers and messages cascade). Safe to re-run.
//
// ORDERING MATTERS AND IS NOT INCIDENTAL. Every row that an assertion depends
// on is written AFTER all three subscriptions report SUBSCRIBED. An earlier
// version of this file inserted the offers before subscribing and still saw
// them arrive — replication lag, not authorisation — which made the offer
// assertions pass by race. If you add a case, write the row after the barrier.
//
// The passwords below are test-account passwords for a prototype project and
// are listed in TESTING.md's purge procedure. Do not reuse this pattern once
// there are real users.

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
  outsider: { email: 'p6-outsider@yoodle.test', password: 'Phase6Test!pass3' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until `predicate` holds, or give up after `timeoutMs`.
 *
 * Fixed sleeps made this file flaky: a 3-second wait is usually enough for a
 * Realtime round trip and occasionally is not, so the suite failed on timing
 * rather than on authorisation. A security test that fails at random is a
 * security test people learn to ignore.
 *
 * Note what this does NOT do: it never waits for the NEGATIVE assertions. It
 * waits for the events that are SUPPOSED to arrive, then checks that the
 * outsider got nothing — by which point the outsider has had at least as long
 * to receive anything they were going to receive.
 */
const waitUntil = async (predicate, timeoutMs = 15000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(250);
  }
  return predicate();
};

let failures = 0;
const check = (name, pass, detail = '') => {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
};

// --- sign in ----------------------------------------------------------------
const clients = {};
const ids = {};
for (const [label, creds] of Object.entries(ACCOUNTS)) {
  const client = createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword(creds);
  if (error) {
    console.log(`FATAL: ${label} could not sign in -> ${error.message}`);
    process.exit(1);
  }
  clients[label] = client;
  ids[label] = data.user.id;
  console.log(`signed in ${label} = ${data.user.id}`);
}

// --- a job to hang everything off -------------------------------------------
const { data: job, error: jobError } = await clients.poster
  .from('jobs')
  .insert({
    poster_id: ids.poster,
    title: 'P6 realtime probe job',
    category: 'other',
    budget: 25,
    location: 'SRID=4326;POINT(-79.38 43.65)',
    status: 'published',
  })
  .select('id')
  .single();

if (jobError) {
  console.log(`FATAL: job insert failed -> ${jobError.message}`);
  process.exit(1);
}
console.log(`job = ${job.id}`);

// --- subscribe BEFORE writing anything that is asserted on ------------------
const messagesSeen = { poster: [], worker: [], outsider: [] };
const offersSeen = { poster: [], worker: [], outsider: [] };
const channels = [];

const subscribeAll = (label) =>
  new Promise((resolve, reject) => {
    const channel = clients[label]
      .channel(`p6-probe-${label}`)
      // Deliberately UNFILTERED: the strongest version of the test is a third
      // party asking for every row on the table and seeing what arrives.
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) =>
        messagesSeen[label].push(payload.new),
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'offers' }, (payload) =>
        offersSeen[label].push(payload.new),
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') resolve(channel);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(err ?? new Error(status));
      });
    channels.push({ label, client: clients[label], channel });
  });

for (const label of ['poster', 'worker', 'outsider']) {
  await subscribeAll(label);
  console.log(`${label} subscribed`);
}

// Let the subscriptions settle before the first asserted write.
await sleep(2000);

// --- offers, now that everyone is listening ---------------------------------
const { error: offerError } = await clients.worker.from('offers').insert({
  job_id: job.id,
  worker_id: ids.worker,
  amount: 30,
  message: 'P6 probe offer',
  status: 'pending',
});
check('worker can make an offer on a published job', !offerError, offerError?.message ?? '');

// The outsider bids too — a real party to the job, just not to the conversation.
// That is the honest version of "unrelated third account": someone with every
// reason to be subscribed, who still must not see the other thread.
const { error: outsiderOfferError } = await clients.outsider.from('offers').insert({
  job_id: job.id,
  worker_id: ids.outsider,
  amount: 99,
  message: 'P6 outsider bid',
  status: 'pending',
});
check(
  'outsider can also bid (so they are a party to the job, not a stranger)',
  !outsiderOfferError,
  outsiderOfferError?.message ?? '',
);

// Wait for the two offers to reach the poster, who is entitled to both.
await waitUntil(() => offersSeen.poster.length >= 2);
// Then a short settle, so a late-arriving leak would still be caught below
// rather than being missed because we asserted too early.
await sleep(1000);

console.log('\n--- realtime offers: rival bids must not leak ---');
check(
  'poster saw both offers on their own job',
  offersSeen.poster.length === 2,
  `got ${offersSeen.poster.length}: ${JSON.stringify(offersSeen.poster.map((o) => o.amount))}`,
);
check(
  'worker saw ONLY their own bid, not the rival',
  offersSeen.worker.length === 1 && offersSeen.worker[0].worker_id === ids.worker,
  `got ${JSON.stringify(offersSeen.worker.map((o) => o.amount))}`,
);
check(
  'outsider saw ONLY their own bid, not the rival',
  offersSeen.outsider.length === 1 && offersSeen.outsider[0].worker_id === ids.outsider,
  `got ${JSON.stringify(offersSeen.outsider.map((o) => o.amount))}`,
);

// --- the private conversation ------------------------------------------------
const { error: sendError } = await clients.poster.from('messages').insert({
  job_id: job.id,
  sender_id: ids.poster,
  recipient_id: ids.worker,
  body: 'P6 PRIVATE: this must not reach the outsider',
});
check('poster can message the worker who offered', !sendError, sendError?.message ?? '');

const { error: replyError } = await clients.worker.from('messages').insert({
  job_id: job.id,
  sender_id: ids.worker,
  recipient_id: ids.poster,
  body: 'P6 PRIVATE: reply from worker',
});
check('worker can reply to the poster', !replyError, replyError?.message ?? '');

// Wait for both participants to have both messages.
await waitUntil(() => messagesSeen.poster.length >= 2 && messagesSeen.worker.length >= 2);
await sleep(1000);

console.log('\n--- realtime messages ---');
check(
  'poster received both messages over realtime',
  messagesSeen.poster.length === 2,
  `got ${messagesSeen.poster.length}`,
);
check(
  'worker received both messages over realtime',
  messagesSeen.worker.length === 2,
  `got ${messagesSeen.worker.length}`,
);
check(
  'OUTSIDER received ZERO messages over realtime',
  messagesSeen.outsider.length === 0,
  `got ${messagesSeen.outsider.length}: ${JSON.stringify(messagesSeen.outsider.map((m) => m.body))}`,
);

// --- the same question, asked over a plain SELECT ---------------------------
console.log('\n--- plain SELECT via the client SDK ---');
const { data: outsiderRead } = await clients.outsider
  .from('messages')
  .select('id, body')
  .eq('job_id', job.id);
check(
  'outsider SELECT on the conversation returns 0 rows',
  (outsiderRead ?? []).length === 0,
  `got ${JSON.stringify(outsiderRead)}`,
);

const { data: workerRead } = await clients.worker
  .from('messages')
  .select('id, body')
  .eq('job_id', job.id);
check(
  'worker SELECT returns their 2 messages',
  (workerRead ?? []).length === 2,
  `got ${(workerRead ?? []).length}`,
);

// --- can the outsider force their way into the thread? ----------------------
const { error: intrudeError } = await clients.outsider.from('messages').insert({
  job_id: job.id,
  sender_id: ids.outsider,
  recipient_id: ids.worker,
  body: 'P6 intrusion attempt',
});
check(
  'outsider CANNOT message the worker (not the counterparty)',
  Boolean(intrudeError),
  intrudeError ? `refused: ${intrudeError.message}` : 'INSERT SUCCEEDED — policy hole',
);

// --- cleanup ----------------------------------------------------------------
for (const { client, channel } of channels) {
  await client.removeChannel(channel);
}
await clients.poster.from('jobs').delete().eq('id', job.id);
console.log('\ncleaned up probe job (offers and messages cascade)');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
