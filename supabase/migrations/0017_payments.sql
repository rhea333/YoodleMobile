-- 0017_payments.sql
-- Yoodle — Stripe Connect state, payment records, and webhook replay protection.
--
-- THE RULE THIS FILE ENFORCES: no client ever writes payment state.
--
-- Every column here that decides whether money moves — the connected account
-- id, whether payouts are enabled, a payment's status, the Stripe object ids —
-- is written ONLY by an Edge Function using the service role. The client has
-- SELECT on a narrow subset and no INSERT, UPDATE or DELETE at all.
--
-- That is deliberate and it is the whole design. If a client could write
-- `payments.status`, "paid" would mean "the app said so" rather than "Stripe
-- said so", and the only thing standing between a user and a free job would be
-- the app they are running.

-- ---------------------------------------------------------------------------
-- 1. Connect state on the worker's profile.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists stripe_account_id        text,
  add column if not exists stripe_payouts_enabled   boolean not null default false,
  add column if not exists stripe_details_submitted boolean not null default false;

comment on column public.profiles.stripe_account_id is
  'Stripe Connect Express account (acct_...). Written only by Edge Functions; NOT readable by clients.';
comment on column public.profiles.stripe_payouts_enabled is
  'Mirror of Stripe''s payouts_enabled, refreshed by webhook. Readable, so a poster can see a worker cannot yet be paid.';

-- 0008 revoked the blanket SELECT and re-granted column by column, so anything
-- added here is invisible until named. Only the boolean is named:
-- `stripe_account_id` has no reason to leave the server, and a Stripe account
-- id is a useful thing for an attacker to have when probing an API.
grant select (stripe_payouts_enabled, stripe_details_submitted)
  on public.profiles to authenticated;

-- No UPDATE grant for any of the three. 0008/0010 grant UPDATE on a fixed list
-- of profile columns and these are absent from it, so a client cannot mark
-- itself payout-enabled.

-- ---------------------------------------------------------------------------
-- 2. Payments.
--
-- One payment per offer. `amount_cents` is an INTEGER, in cents, because that
-- is what Stripe speaks and because `offers.amount` is numeric(10,2) dollars —
-- the conversion happens once, in the Edge Function, and the result is stored
-- rather than recomputed on every read.
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id                       uuid primary key default gen_random_uuid(),
  job_id                   uuid not null references public.jobs (id)     on delete cascade,
  offer_id                 uuid not null references public.offers (id)   on delete cascade,
  payer_id                 uuid not null references public.profiles (id) on delete restrict,
  payee_id                 uuid not null references public.profiles (id) on delete restrict,
  amount_cents             integer not null,
  currency                 text not null default 'cad',
  status                   text not null default 'requires_payment_method',
  stripe_payment_intent_id text,
  stripe_charge_id         text,
  stripe_transfer_id       text,
  last_error               text,
  authorized_at            timestamptz,
  released_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint payments_amount_positive check (amount_cents > 0),
  constraint payments_currency_valid  check (currency = lower(currency)),
  constraint payments_status_valid check (status in (
    'requires_payment_method',  -- created, no card attached yet
    'requires_action',          -- 3DS or similar pending
    'authorized',               -- card authorised, funds HELD, nothing captured
    'captured',                 -- money taken from the payer
    'released',                 -- captured AND transferred to the worker
    'failed',
    'canceled'
  )),

  -- The database half of "accepting twice must not charge twice". The Edge
  -- Function uses a Stripe idempotency key as well; this makes a second row
  -- impossible even if that were bypassed or the key were regenerated.
  constraint payments_one_per_offer unique (offer_id)
);

-- A PaymentIntent belongs to exactly one payment row, always.
create unique index if not exists payments_payment_intent_key
  on public.payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create index if not exists payments_job_idx   on public.payments (job_id);
create index if not exists payments_payer_idx on public.payments (payer_id);
create index if not exists payments_payee_idx on public.payments (payee_id);

drop trigger if exists payments_touch_updated_at on public.payments;
create trigger payments_touch_updated_at
  before update on public.payments
  for each row execute function app.touch_updated_at();

alter table public.payments enable row level security;

drop policy if exists payments_select_participants on public.payments;

-- The two people in the transaction may read it. Nobody may write it.
create policy payments_select_participants
  on public.payments
  for select
  to authenticated
  using (payer_id = auth.uid() or payee_id = auth.uid());

-- There is deliberately NO insert/update/delete policy. Edge Functions use the
-- service role, which bypasses RLS; every other caller is refused by default.

revoke all on public.payments from anon, authenticated;

-- Note what is NOT granted: stripe_payment_intent_id, stripe_charge_id,
-- stripe_transfer_id and last_error. The app shows a status, not Stripe's
-- internal ids, and `last_error` can carry detail that belongs in logs rather
-- than on a phone screen.
grant select (
  id, job_id, offer_id, payer_id, payee_id,
  amount_cents, currency, status, authorized_at, released_at,
  created_at, updated_at
) on public.payments to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Webhook replay protection.
--
-- Stripe retries a webhook until it gets a 2xx, and will happily deliver the
-- same event more than once. Recording every event id and refusing to process
-- a repeat is what stops a retried `payment_intent.succeeded` from being
-- treated as a second payment.
--
-- Inserting the id FIRST, and letting the primary key reject a duplicate, is
-- what makes this a lock rather than a check — two concurrent deliveries of the
-- same event cannot both pass a "have I seen this?" test.
-- ---------------------------------------------------------------------------
create table if not exists public.stripe_events (
  id           text primary key,
  type         text not null,
  payment_id   uuid references public.payments (id) on delete set null,
  received_at  timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
-- No policies at all: only the service role touches this table.
revoke all on public.stripe_events from anon, authenticated;
