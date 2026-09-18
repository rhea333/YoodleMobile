-- 0008_profiles_onboarding.sql
-- Yoodle — the columns the onboarding flow needs, plus the avatars bucket.
--
-- POSTAL CODE PRIVACY, mirroring the jobs.location model from 0003:
--   `postal_code` full code ("M5V 2T6"). SELECT revoked from clients.
--   `postal_fsa`  first 3 chars ("M5V"), derived by trigger. Readable.
--
-- A full Canadian postal code identifies roughly a dozen urban households, so
-- exposing it would undercut the coarse-location work done for jobs. The FSA is
-- neighbourhood-level and is what other users see.

alter table public.profiles
  add column if not exists postal_code text,
  add column if not exists postal_fsa  text,
  add column if not exists bio         text;

comment on column public.profiles.postal_code is
  'FULL postal code. SELECT revoked from anon/authenticated. Derived FSA is the public form.';
comment on column public.profiles.postal_fsa is
  'Forward Sortation Area, first 3 chars. Neighbourhood-level and safe to expose.';

-- Canada Post excludes D, F, I, O, Q, U everywhere, and W, Z from the first
-- position. Enforced here as well as in the client so a bad value cannot be
-- written by any path.
alter table public.profiles drop constraint if exists profiles_postal_code_format;
alter table public.profiles add constraint profiles_postal_code_format
  check (
    postal_code is null
    or postal_code ~ '^[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z] ?[0-9][ABCEGHJ-NPRSTV-Z][0-9]$'
  );

alter table public.profiles drop constraint if exists profiles_postal_fsa_format;
alter table public.profiles add constraint profiles_postal_fsa_format
  check (postal_fsa is null or postal_fsa ~ '^[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z]$');

alter table public.profiles drop constraint if exists profiles_bio_length;
alter table public.profiles add constraint profiles_bio_length
  check (bio is null or char_length(bio) <= 500);

create index if not exists profiles_postal_fsa_idx on public.profiles (postal_fsa);

-- ---------------------------------------------------------------------------
-- Derive the FSA. In a trigger rather than a generated column so a client
-- cannot write postal_fsa directly and desync it from postal_code.
-- ---------------------------------------------------------------------------
create or replace function app.derive_postal_fsa()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.postal_code is null then
    new.postal_fsa := null;
  else
    new.postal_fsa := upper(substring(replace(new.postal_code, ' ', '') from 1 for 3));
  end if;
  return new;
end
$$;

drop trigger if exists profiles_derive_postal_fsa on public.profiles;
create trigger profiles_derive_postal_fsa
  before insert or update of postal_code on public.profiles
  for each row execute function app.derive_postal_fsa();

-- ---------------------------------------------------------------------------
-- Extend the sign-up trigger to carry name AND postal code.
--
-- The client passes these as signUp options.data, so they land in
-- raw_user_meta_data and are materialised here. This works whether or not
-- email confirmation is enabled: it needs no client session, whereas a
-- client-side write would be denied by RLS until the user confirms.
--
-- raw_user_meta_data is USER-CONTROLLED, so everything read from it is treated
-- as untrusted input: length-capped, normalised, and validated against the same
-- CHECK constraints above. An invalid postal code is dropped rather than
-- failing the sign-up, because a failed trigger would abort account creation.
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name     text;
  v_postal   text;
begin
  v_name := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
  if v_name is not null then
    v_name := left(v_name, 80);
  end if;

  v_postal := upper(replace(coalesce(new.raw_user_meta_data ->> 'postal_code', ''), ' ', ''));
  if v_postal !~ '^[ABCEGHJ-NPRSTVXY][0-9][ABCEGHJ-NPRSTV-Z][0-9][ABCEGHJ-NPRSTV-Z][0-9]$' then
    v_postal := null;
  end if;

  insert into public.profiles (id, display_name, postal_code)
  values (new.id, v_name, v_postal)
  on conflict (id) do nothing;

  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Column privileges. As in 0003, a column REVOKE cannot override a table-level
-- grant, so the blanket grant goes first and the allowed columns come back
-- individually. `postal_code` is omitted from SELECT on purpose.
-- ---------------------------------------------------------------------------
revoke select on public.profiles from anon, authenticated;

grant select (
  id, display_name, avatar_url, postal_fsa, bio, created_at, updated_at
) on public.profiles to authenticated;

-- The owner must be able to WRITE their full postal code without reading it
-- back in bulk. postal_fsa stays trigger-derived and client-unwritable.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url, postal_code, bio)
  on public.profiles to authenticated;
