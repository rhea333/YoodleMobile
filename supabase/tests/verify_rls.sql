-- verify_rls.sql
-- Run LAST, after every migration. Read-only: it asserts, it does not change.
--
-- Supabase tables are wide open to any anon/authenticated request until RLS is
-- explicitly enabled. Forgetting it on ONE table is the most common real-world
-- Supabase vulnerability, and it fails silently — the app keeps working, the
-- data is just public. This script makes that failure loud.

-- 1. Every table in `public` must have RLS enabled.
--
-- Note: `force row level security` is deliberately NOT asserted. FORCE subjects
-- the table OWNER to RLS too, which breaks our SECURITY DEFINER paths (the
-- profile-creation trigger and job_exact_location) because their policies are
-- granted `to authenticated`, not to the owner. Clients connect as anon or
-- authenticated and are non-owners, so plain ENABLE already constrains them.
do $$
declare
  v_bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relrowsecurity = false;

  if v_bad is not null then
    raise exception 'RLS NOT enabled on: %', v_bad;
  end if;

  raise notice 'PASS: RLS enabled on every table in public.';
end
$$;

-- 2. Every table must actually have at least one policy. RLS enabled with zero
--    policies denies everything, which is safe but means the app is broken —
--    worth knowing about now rather than from a bug report.
do $$
declare
  v_bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not exists (select 1 from pg_policy p where p.polrelid = c.oid);

  if v_bad is not null then
    raise exception 'RLS enabled but NO policies on: %', v_bad;
  end if;

  raise notice 'PASS: every table in public has at least one policy.';
end
$$;

-- 3. The exact location column must not be selectable by anon or authenticated.
do $$
declare
  v_leak text;
begin
  select string_agg(grantee, ', ')
    into v_leak
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'jobs'
    and column_name = 'location'
    and privilege_type = 'SELECT'
    and grantee in ('anon', 'authenticated');

  if v_leak is not null then
    raise exception 'jobs.location is SELECTable by: % — the exact address is exposed.', v_leak;
  end if;

  raise notice 'PASS: jobs.location is not selectable by anon or authenticated.';
end
$$;

-- 4. No table should be granted to the `public` pseudo-role.
do $$
declare
  v_bad text;
begin
  select string_agg(distinct table_name, ', ')
    into v_bad
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'PUBLIC';

  if v_bad is not null then
    raise exception 'Tables granted to PUBLIC: %', v_bad;
  end if;

  raise notice 'PASS: no public-role grants.';
end
$$;

-- 5. Summary for eyeballing.
select
  c.relname                                as table_name,
  c.relrowsecurity                         as rls_enabled,
  count(p.polname)                         as policy_count,
  string_agg(p.polname, ', ' order by p.polname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
group by c.relname, c.relrowsecurity
order by c.relname;
