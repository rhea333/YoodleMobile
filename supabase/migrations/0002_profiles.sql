-- 0002_profiles.sql
-- Yoodle — profiles, linked 1:1 to auth.users.
--
-- Columns are deliberately minimal (core identity only). No bio, city, phone or
-- role field: those were not specified, and a profile table is the wrong place
-- to accumulate speculative PII. Add them in a later migration when a screen
-- actually needs them.

create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint profiles_display_name_length
    check (display_name is null or char_length(display_name) between 1 and 80)
);

comment on table public.profiles is
  'Public-facing identity for an auth user. Contains no contact details by design.';

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create a profile when an auth user is created.
--
-- Without this, sign-up produces an auth.users row and no profile, and the
-- client cannot create one itself for a user that does not exist yet. This is
-- the standard Supabase linking pattern.
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    -- Whatever the client passed as options.data.display_name at sign-up, if any.
    nullif(new.raw_user_meta_data ->> 'display_name', '')
  )
  on conflict (id) do nothing;
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------------
-- RLS
--
-- Supabase tables are readable and writable by any anon/authenticated request
-- until RLS is enabled. Enabling it is the whole point of this block.
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_insert_self on public.profiles;
drop policy if exists profiles_update_self on public.profiles;

-- ASSUMPTION (not in the original spec, which only defined who may EDIT):
-- any signed-in user may read any profile, because a job or offer is
-- meaningless without a name attached. Anonymous users may NOT — browsing jobs
-- without an account does not require knowing who posted them.
create policy profiles_select_authenticated
  on public.profiles
  for select
  to authenticated
  using (true);

-- A user may only ever create their own row. The trigger above already does it;
-- this exists so a client-side upsert cannot forge someone else's profile.
create policy profiles_insert_self
  on public.profiles
  for insert
  to authenticated
  with check (id = auth.uid());

-- "A user can only edit their own profile."
create policy profiles_update_self
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No DELETE policy: profiles are removed by cascade when the auth user is
-- deleted, which is the only legitimate path.

-- `id` must never be reassigned, even by its owner.
--
-- A column-level REVOKE does NOT override a table-level grant, and Supabase
-- grants table-wide UPDATE to authenticated by default — so `revoke update (id)`
-- alone would be a silent no-op. The blanket grant has to go first, then the
-- allowed columns come back individually.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;
