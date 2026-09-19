-- 0013_revoke_anon_default_grants.sql
-- Yoodle — strip Supabase's blanket table grants from `anon`, and stop new
-- tables inheriting them.
--
-- WHY, given RLS is on everywhere:
--
-- Supabase projects ship with `grant all on all tables in schema public to
-- anon, authenticated`. Earlier migrations revoked what they needed to
-- (SELECT/INSERT/UPDATE per table), which left `anon` holding DELETE, TRUNCATE,
-- TRIGGER and REFERENCES on all five tables.
--
-- For SELECT/INSERT/UPDATE/DELETE that was harmless: RLS is enabled and `anon`
-- has no policy permitting them, so every such statement is denied.
--
-- TRUNCATE IS THE EXCEPTION AND IS THE REASON THIS MIGRATION EXISTS.
-- Row-level security filters ROWS. TRUNCATE does not operate on rows, and
-- PostgreSQL does not apply RLS policies to it at all. For TRUNCATE the grant
-- is the ONLY control, and `anon` had it on every table. There is no known path
-- to exploit it today — PostgREST exposes no TRUNCATE verb, and the publishable
-- key is a PostgREST JWT rather than database credentials — but "RLS will catch
-- it" is simply not true here, so the grant should not exist.
--
-- Scope note: this migration deliberately touches `anon` only. `authenticated`
-- carries the same defaults and the same TRUNCATE caveat; see SECURITY.md.

-- ---------------------------------------------------------------------------
-- 1. Clear everything, then put back only what is deliberate.
--
-- Revoke-then-regrant rather than revoking named privileges, so this does not
-- have to track which of the defaults each earlier migration happened to
-- remove. Whatever `anon` ends up with below is the complete list.
-- ---------------------------------------------------------------------------
revoke all privileges on all tables in schema public from anon;

-- Signed-out visitors may browse PUBLISHED jobs. This is intentional and has a
-- policy behind it (`jobs_select_published`, 0003). The column list is 0003's
-- verbatim — `location` is absent, which is what keeps the exact address
-- unreadable, and `browse_jobs` is SECURITY INVOKER so it reads these columns
-- with the caller's own privileges and would fail without them.
grant select (
  id, poster_id, title, description, category, budget,
  location_coarse, coarse_lat, coarse_long, status, created_at, updated_at
) on public.jobs to anon;

-- Reviews are public by design (`reviews_select_all`, 0006).
grant select on public.reviews to anon;

-- Nothing is restored for profiles, offers or messages. `anon` has no policy on
-- any of them, so it could never read or write them anyway; the grants were
-- pure default residue.

-- ---------------------------------------------------------------------------
-- 2. Stop the next table inheriting the same thing.
--
-- Without this, phase 5's tables arrive with the full default grant again and
-- the problem returns silently.
--
-- LIMITATION, recorded because it is not obvious: default privileges attach to
-- the role that CREATES the object. This statement covers tables created by
-- `postgres`, which is what runs migrations and the dashboard SQL editor — so
-- it covers how tables actually get made here. The project also carries a
-- matching default for `supabase_admin`, which cannot be altered from this role
-- (`postgres` is not a superuser and not a member of it). A table created by
-- `supabase_admin` would still inherit the old grants.
-- ---------------------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon;
