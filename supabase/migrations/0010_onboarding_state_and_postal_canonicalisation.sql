-- 0010_onboarding_state_and_postal_canonicalisation.sql
-- Yoodle — two phase-3 corrections.
--
-- 1. `onboarded_at` records that the user has been THROUGH the onboarding
--    screen, which is not the same question as whether they filled it in.
--    Onboarding was previously inferred from "no avatar and no bio", so
--    "Skip for now" persisted nothing and the screen returned on every cold
--    start. Both fields are genuinely optional, so their absence cannot carry
--    this meaning; it needs its own column.
--
-- 2. `postal_code` is canonicalised to the Canada Post form ("M5V 2T6").
--    The sign-up path (app.handle_new_user) stripped the space while a client
--    UPDATE kept it, so one column held two spellings of the same code. The
--    CHECK constraint permits both, so nothing broke — but equality tests and
--    anything grouping by postal code silently disagreed.

alter table public.profiles
  add column if not exists onboarded_at timestamptz;

comment on column public.profiles.onboarded_at is
  'When the user last completed or skipped onboarding. Only null-vs-not is read; '
  'the client supplies the value, so the exact instant is device-clock accurate only.';

-- ---------------------------------------------------------------------------
-- Canonicalise on the way in, in the SAME trigger that derives the FSA, so
-- every write path converges regardless of which one it came from. Doing it
-- here rather than in app.handle_new_user means a direct client UPDATE is
-- normalised too.
-- ---------------------------------------------------------------------------
create or replace function app.derive_postal_fsa()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_compact text;
begin
  if new.postal_code is null then
    new.postal_code := null;
    new.postal_fsa  := null;
    return new;
  end if;

  v_compact := upper(replace(new.postal_code, ' ', ''));

  -- Only reshape a well-formed 6-character code. Anything else is left as it
  -- arrived so the CHECK constraint rejects it loudly rather than this
  -- function quietly reformatting a bad value into a different bad value.
  if length(v_compact) = 6 then
    new.postal_code := substring(v_compact from 1 for 3) || ' ' || substring(v_compact from 4 for 3);
  end if;

  new.postal_fsa := substring(v_compact from 1 for 3);
  return new;
end
$$;

-- Backfill through the trigger itself rather than repeating the formatting
-- expression here, so there is exactly one definition of "canonical".
update public.profiles
   set postal_code = postal_code
 where postal_code is not null
   and postal_code !~ '^[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z] [0-9][ABCEGHJ-NPRSTV-Z][0-9]$';

-- Anyone who already has a photo or a bio has demonstrably been through the
-- screen; do not re-prompt them just because this column is new.
update public.profiles
   set onboarded_at = coalesce(updated_at, created_at)
 where onboarded_at is null
   and (avatar_url is not null or bio is not null);

-- ---------------------------------------------------------------------------
-- Column privileges, following the pattern established in 0008: additive
-- grants on top of the revoked table-level default.
-- ---------------------------------------------------------------------------
grant select (onboarded_at) on public.profiles to authenticated;
grant update (onboarded_at) on public.profiles to authenticated;
