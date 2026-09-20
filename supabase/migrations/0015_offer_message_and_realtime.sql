-- 0015_offer_message_and_realtime.sql
-- Yoodle — an optional note on an offer, and turning Realtime on.

-- ---------------------------------------------------------------------------
-- 1. The note a worker sends with their bid.
--
-- Capped at 1000 rather than the 4000 a job description gets: this is a pitch
-- attached to a number, not a listing. The client sanitises it through the same
-- path as every other free-text field (see /src/services/sanitize.ts), and this
-- constraint is the boundary that holds when the client is not the caller.
-- ---------------------------------------------------------------------------
alter table public.offers
  add column if not exists message text;

comment on column public.offers.message is
  'Optional note from the worker. Sanitised client-side; length enforced here.';

alter table public.offers drop constraint if exists offers_message_length;
alter table public.offers add constraint offers_message_length
  check (message is null or char_length(message) <= 1000);

-- 0004 revoked table-level UPDATE and granted only (amount, status), so the new
-- column is unwritable until named. A worker amending their bid should be able
-- to amend the note with it.
grant update (message) on public.offers to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Realtime.
--
-- The `supabase_realtime` publication existed but had NO tables in it, so
-- subscriptions would have connected successfully and then silently delivered
-- nothing — the worst kind of failure, because it looks like "no new messages".
-- ---------------------------------------------------------------------------
-- Guarded, because `alter publication ... add table` is NOT idempotent: it
-- raises 42710 ("relation is already member of publication") on a second run.
-- That matters more than it looks. Enabling Realtime from the Supabase
-- dashboard adds the table to this same publication, so on any project where
-- someone clicked that toggle first, an unguarded statement aborts THIS ENTIRE
-- MIGRATION — and `offers.message` above never lands, while the client writes
-- it on every offer. A replay of this file on a fresh environment would hit the
-- same wall.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'offers'
  ) then
    alter publication supabase_realtime add table public.offers;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. REPLICA IDENTITY IS DELIBERATELY LEFT AT DEFAULT. Do not set it to FULL.
--
-- Realtime applies RLS to INSERT and UPDATE events, but NOT to DELETE — the
-- Supabase docs are explicit: "RLS policies are not applied to DELETE
-- statements, because there is no way for Postgres to verify that a user has
-- access to a deleted record."
--
-- With the default replica identity, a DELETE is replicated with only the
-- table's primary key, so the payload that escapes RLS is a bare `id` — a
-- subscriber learns that some row disappeared and nothing else.
--
-- Setting REPLICA IDENTITY FULL would put every column of the deleted row into
-- that same unfiltered payload. For `messages` that means `body` — the entire
-- private message — broadcast to anyone subscribed to the table, regardless of
-- whether they were party to the conversation. `messages_delete_own` lets any
-- sender retract a message, so this is reachable, not theoretical.
--
-- The client compensates by subscribing to INSERT and UPDATE only. Both halves
-- are needed: this keeps the payload empty, the client keeps the event unasked
-- for.
-- ---------------------------------------------------------------------------
