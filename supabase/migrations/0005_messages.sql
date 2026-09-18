-- 0005_messages.sql
-- Yoodle — direct messages about a job.
--
-- WHY recipient_id EXISTS (it was not in the original spec):
--   The brief said "only the job's poster and the offering worker can see that
--   job's messages". But a job takes offers from MANY workers, and with only
--   (job_id, sender_id) there is no way to tell one thread from another — so
--   worker B could read worker A's entire negotiation with the poster.
--   recipient_id makes each message addressed, and the policies below scope
--   visibility to the two people actually in the conversation.

create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.jobs (id) on delete cascade,
  sender_id    uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  body         text not null,
  created_at   timestamptz not null default now(),

  constraint messages_body_length check (char_length(body) between 1 and 4000),
  constraint messages_no_self_send check (sender_id <> recipient_id)
);

-- Thread reads are always "this job, these two people, newest last".
create index if not exists messages_job_participants_idx
  on public.messages (job_id, sender_id, recipient_id, created_at);

alter table public.messages enable row level security;

drop policy if exists messages_select_own_thread on public.messages;
drop policy if exists messages_insert_own_thread on public.messages;
drop policy if exists messages_delete_own on public.messages;

-- Two conditions, both required:
--   1. you are one of the two people on the message, and
--   2. you are actually a party to the job (its poster, or a worker who offered).
-- (1) alone would let a stranger be messaged into a thread; (2) alone is the
-- leak described in the header.
create policy messages_select_own_thread
  on public.messages
  for select
  to authenticated
  using (
    (sender_id = auth.uid() or recipient_id = auth.uid())
    and app.is_job_participant(job_id)
  );

-- You may only send as yourself, only about a job you are party to, and only to
-- the counterparty: poster -> a worker who offered, or worker -> the poster.
create policy messages_insert_own_thread
  on public.messages
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and (
      (app.is_job_poster(job_id) and app.has_offer_on_job_as(job_id, recipient_id))
      or (app.has_offer_on_job(job_id) and app.is_job_poster_id(job_id, recipient_id))
    )
  );

-- A sender may retract their own message. No UPDATE policy at all: an edited
-- message history is worse than none for dispute resolution.
create policy messages_delete_own
  on public.messages
  for delete
  to authenticated
  using (sender_id = auth.uid());

revoke update on public.messages from anon, authenticated;
