-- 0016_offer_mutation_rules.sql
-- Yoodle — who may change WHAT on an offer, enforced in the database.
--
-- WHY A TRIGGER AND NOT POLICIES OR GRANTS.
--
-- RLS decides which ROWS a statement may touch. Column grants decide which
-- COLUMNS a ROLE may write. Neither can express "this role may write this
-- column on this row" — and that is exactly the rule offers need, because the
-- poster and the worker are both `authenticated`, both have an UPDATE policy on
-- the same row, and a column grant applies to the role, not to the policy that
-- let them in.
--
-- The consequence was demonstrable, not theoretical. Against the live database,
-- signed in through the normal client:
--
--   * a worker re-priced an ALREADY-ACCEPTED offer from $40 to $999 and reset
--     it to 'pending' — `offers_update_own` only checks `worker_id = auth.uid()`
--     and never looks at status;
--   * a poster rewrote the worker's offer note;
--   * a poster changed the worker's price from $40 to $1, which would let them
--     "accept" at a number the worker never offered.
--
-- The last of those PREDATES phase 6: `grant update (amount, status)` in 0004
-- has always been role-wide, so `offers_update_as_poster` has always carried
-- the amount with it. Phase 6 only made it reachable by building the screens.
--
-- This matters for payments. An accepted offer's `amount` is about to become
-- the number somebody is charged, so it has to be the number the worker
-- actually named, and it has to stop moving once accepted.

-- ---------------------------------------------------------------------------
-- 1. `updated_at`, so a status change is identifiable.
--
-- Also fixes a client-side bug: notifications were keyed on offer id + status,
-- so declined -> re-bid -> declined collapsed into one entry and the second
-- decline was never shown. A per-write timestamp gives each transition its own
-- identity.
--
-- Deliberately NOT granted for UPDATE: the trigger owns it, clients do not.
-- ---------------------------------------------------------------------------
alter table public.offers
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists offers_touch_updated_at on public.offers;
create trigger offers_touch_updated_at
  before update on public.offers
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. The rules.
--
-- WORKER (the offer's owner) may:
--   - amend amount / message, ONLY while the offer is still 'pending'
--   - withdraw   (pending -> withdrawn)
--   may NOT accept or decline, and may NOT reopen a settled offer.
--
-- POSTER (owner of the job) may:
--   - accept or decline, ONLY from 'pending'
--   may NOT touch amount or message at all.
--
-- Anyone else is already stopped by RLS; the final raise is a backstop, not the
-- primary control.
-- ---------------------------------------------------------------------------
create or replace function app.enforce_offer_mutation_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor           uuid    := auth.uid();
  v_amount_changed  boolean := new.amount  is distinct from old.amount;
  v_message_changed boolean := new.message is distinct from old.message;
  v_status_changed  boolean := new.status  is distinct from old.status;
begin
  -- No JWT means this is a migration, a seed, or the service role — not a user
  -- acting through the app. RLS is not in play for those callers either.
  if v_actor is null then
    return new;
  end if;

  -- ---- the worker who owns the offer ----
  if v_actor = old.worker_id then
    if (v_amount_changed or v_message_changed) and old.status <> 'pending' then
      raise exception 'This offer is % and can no longer be changed.', old.status
        using errcode = 'check_violation';
    end if;

    if v_status_changed then
      if new.status not in ('pending', 'withdrawn') then
        raise exception 'Only the job poster can accept or decline an offer.'
          using errcode = 'check_violation';
      end if;

      -- A settled offer stays settled. Without this a worker could walk an
      -- accepted offer back to 'pending' and re-price it.
      if old.status <> 'pending' then
        raise exception 'This offer is % and cannot be reopened.', old.status
          using errcode = 'check_violation';
      end if;
    end if;

    return new;
  end if;

  -- ---- the poster of the job ----
  if app.is_job_poster(old.job_id) then
    if v_amount_changed then
      raise exception 'A job poster cannot change a worker''s price.'
        using errcode = 'check_violation';
    end if;

    if v_message_changed then
      raise exception 'A job poster cannot change a worker''s note.'
        using errcode = 'check_violation';
    end if;

    if v_status_changed then
      if new.status not in ('accepted', 'declined') then
        raise exception 'A job poster can only accept or decline an offer.'
          using errcode = 'check_violation';
      end if;

      if old.status <> 'pending' then
        raise exception 'This offer has already been %.', old.status
          using errcode = 'check_violation';
      end if;
    end if;

    return new;
  end if;

  raise exception 'You are not a party to this offer.'
    using errcode = 'check_violation';
end
$$;

drop trigger if exists offers_enforce_mutation_rules on public.offers;
create trigger offers_enforce_mutation_rules
  before update on public.offers
  for each row execute function app.enforce_offer_mutation_rules();
