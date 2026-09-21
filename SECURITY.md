# Yoodle — Security Log

A running, append-only record. Each phase adds a dated section; earlier sections
are never rewritten.

---

## 2026-09-10 — Phase 1: project scaffold & design system

### Secrets must never reach git

`.env` is ignored **before the first commit**. The Expo `blank-typescript`
template only ignores `.env*.local`, which would have let a plain `.env` through,
so `.gitignore` was widened and the result verified with `git check-ignore`:

| Path              | Status                                                |
| ----------------- | ----------------------------------------------------- |
| `.env`            | ignored                                               |
| `.env.local`      | ignored                                               |
| `.env.production` | ignored                                               |
| `.env.example`    | tracked (intentional — template only, no real values) |

Also ignored, so store/push credentials cannot be committed later:
`*.keystore`, `*.jks`, `*.p8`, `*.p12`, `*.key`, `*.mobileprovision`, `*.pem`,
`google-services.json`, `GoogleService-Info.plist`.

**History is clean.** This repo had zero commits when the scaffold was created,
so no key has ever existed in git history. Nothing needed purging.

### Convention for every later phase

**All secrets load from environment variables. Nothing is ever hardcoded in
source.** `.env.example` documents each variable with an empty value; the real
`.env` stays local and gitignored. This applies to Supabase, Stripe Connect, EAS
and anything added later.

One caveat that will matter as soon as Supabase and Stripe are wired in:

> **`EXPO_PUBLIC_*` variables are compiled into the app bundle and are readable
> by anyone who downloads the app.** They are not secrets — they are public
> configuration.
>
> - Safe as `EXPO_PUBLIC_*`: Supabase project URL, Supabase **anon** key (it is
>   designed to be public and must be backed by Row Level Security), Stripe
>   **publishable** key.
> - Never in the app bundle under any name: Supabase **service role** key,
>   Stripe **secret** key, webhook signing secrets. These belong on a server
>   (Supabase Edge Function) or in EAS secrets.

Because the anon key's safety depends entirely on Row Level Security, RLS must
be enabled on every table from the moment the first table exists. Logged here
now so the Supabase phase does not treat it as optional.

### Dependency audit

`npm audit` reported 14 moderate advisories after install. They came from two
chains:

1. **`decode-uri-component` — denial of service via malformed percent-encoded
   input.** Reached at **runtime** through
   `@react-navigation/native` → `@react-navigation/core` → `query-string`.
   `@react-navigation/native@7.3.18` is the latest published version and is
   still affected, so there was no upstream version to move to. Resolved with a
   targeted `overrides` entry in `package.json` pinning
   `decode-uri-component@^0.5.0` (the patched line). Verified afterwards: the
   Android bundle still builds, type-check and lint stay clean, and the advisory
   count drops 14 → 10. This is the one dependency decision worth revisiting if
   deep-link parsing ever misbehaves — removing the override restores the
   vulnerable version.
2. **`xcode` / `uuid` under `@expo/*` (10 remaining, all moderate).** These sit
   in `@expo/cli`, `@expo/config-plugins` and `@expo/prebuild-config` — build and
   prebuild tooling that runs on a developer machine and is **not shipped in the
   app bundle**. The advisory range is `*`, so no patched version exists.
   Accepted for now; re-check on each Expo SDK upgrade.

### Package integrity

The machine's npm was configured to use the registry over **plaintext HTTP**
(`http://registry.npmjs.org`), which leaves package downloads open to
interception and tampering. A project-level `.npmrc` now forces
`https://registry.npmjs.org/` for anyone installing this repo.

The global setting is still HTTP and is worth fixing outside this repo:

```
npm config set registry https://registry.npmjs.org/
```

### Not yet addressed (tracked for later phases)

- No auth, database, storage or payments code exists yet, so there is no RLS
  policy, token storage or PCI surface to review.
- Session token storage (`expo-secure-store` vs `AsyncStorage`) to be decided in
  the Supabase auth phase — refresh tokens must not land in plain AsyncStorage.
- Stripe Connect onboarding and payouts must keep all secret-key calls
  server-side; the client only ever sees a publishable key and ephemeral keys.

---

## 2026-09-14 — Phase 1 follow-up: posture re-checked after dependency bump

`expo` was bumped `57.0.21` → `57.0.22` (`npx expo install --fix`, 12 packages
changed). Re-verified that nothing regressed. Earlier sections are unchanged.

| Control                           | Result after bump                                    |
| --------------------------------- | ---------------------------------------------------- |
| `.env` gitignored                 | still ignored (`git check-ignore`)                   |
| Keys in git history               | none — repo still has **zero commits**               |
| `decode-uri-component` override   | still resolves to `0.5.0 overridden`                 |
| Runtime advisories (`--omit=dev`) | 10 moderate, unchanged — all `@expo/*` build tooling |

The 10 remaining advisories are still confined to `xcode`/`uuid` under
`@expo/cli`, `@expo/config-plugins` and `@expo/prebuild-config` — developer-machine
tooling that is not shipped in the app bundle. Advisory range is `*`, so there is
still no patched version. Accepted; re-check on the next SDK upgrade.

### New: Expo Go serves the JS bundle unencrypted over the LAN

Device testing this phase runs through Expo Go, which means Metro serves the
bundle over **plain HTTP to any host on the local network** (`exp://172.17.247.102:8081`).

Harmless right now — the skeleton contains no keys and no user data. It stops
being harmless the moment `.env` holds real values, because `EXPO_PUBLIC_*`
variables are inlined into the bundle at build time and would therefore be
readable by anything sniffing that Wi-Fi.

Practical rules from here:

- Do not run `expo start` with a populated `.env` on untrusted Wi-Fi (cafés,
  co-working, conference networks). Use `--tunnel` (HTTPS) or a trusted network.
- This is one more reason the anon key must be the _only_ Supabase credential in
  the client, and why Row Level Security is what actually protects the data —
  restated from the phase 1 section because LAN exposure makes it concrete.
- Never put a Stripe secret key or Supabase service role key in `.env` for the
  mobile app, even temporarily during local debugging.

### Noted for the payments phase

There is no local dev-build toolchain on this machine (no JDK, no Gradle), so
Expo Go is currently the only way to run on a device. The Stripe React Native
SDK does not work in Expo Go, so payments will need a development build via a
local JDK or EAS Build. Security-relevant because that is also the point where
signing keys and EAS secrets enter the picture — `*.keystore`, `*.jks`, `*.p8`
and `*.p12` are already gitignored in anticipation.

---

## 2026-09-14 — Real brand palette: new dependency & an accessibility exception

A palette change is mostly not a security event, but three things belong on the
record. Earlier sections are unchanged.

### New dependency: `expo-system-ui`

The brand is dark-first, so `app.json` now pins `userInterfaceStyle: "dark"`.
The SDK 57 config docs state that **on Android this property requires
`expo-system-ui` to be installed**, and that the property defaults to `light`
when absent — so without this package the app would have silently rendered in
light mode on Android regardless of the setting.

Installed via `npx expo install expo-system-ui` → `~57.0.4` (SDK-matched, and
bundled in Expo Go, so device testing is unaffected). Post-install posture:

| Control                           | Result                                               |
| --------------------------------- | ---------------------------------------------------- |
| `.env` gitignored                 | still ignored                                        |
| Keys in git history               | none — repo still has **zero commits**               |
| `decode-uri-component` override   | still resolves to `0.5.0 overridden`                 |
| Runtime advisories (`--omit=dev`) | 10 moderate, unchanged — all `@expo/*` build tooling |
| `npx expo-doctor`                 | 21/21 pass                                           |

### Logged accessibility exception (WCAG 1.4.11)

Recorded here rather than quietly absorbed into the tokens, because it is a
deliberate decision that a later phase should not "discover" and undo.

On the #0C1210 brand ground, **no value in the palette separates one plane from
another at 3:1**. Three measured cases: `surfaceMuted` vs `background` 1.23:1
(the filled secondary button), `surface` vs `background` 1.10:1 (all Cards),
`successSubtle` vs `background` 1.51:1 (subtle badges).

These are accepted, not fixed, on the grounds that WCAG 1.4.11 requires 3:1 for
whatever _identifies_ a control, and in each case that is the label, not the
fill — the secondary button's label measures 13.02:1 and the success badge's
7.60:1. Card edges are decorative and exempt.

What was explicitly rejected: clearing 3:1 would require a surface near
`#4A5A50` or a control border near `#586B5F`, neither of which is a dark-first
brand colour. The full ladder of rejected candidates is in TESTING.md.

**This exception covers plane separation only.** Every text pair in all five
components clears AA — 27 of 30 measured pairs pass, and the three that do not
are exactly the three above. No later phase should read this as licence to ship
low-contrast text.

### Note for the auth and payments phases

`userInterfaceStyle: "dark"` plus `expo-system-ui` means the app now writes a
system UI appearance at startup. Harmless on its own, but `expo-system-ui` can
also set the root view background colour — if a later phase uses it to flash a
splash or brand colour, that runs before auth state is known, so it must not be
driven by any value read from a user session.

---

## 2026-09-14 — Phase 2: Supabase, RLS and the location privacy question

Schema, RLS and auth service functions. No UI. Migrations are written but
**not applied** — they are yours to run. Earlier sections unchanged.

### RLS is ON for every table

Supabase tables accept reads and writes from any anon or authenticated request
until RLS is explicitly enabled, and the failure is silent: the app works, the
data is just public. Enabled on all five:

| Table      | RLS | Policies | Shape                                                               |
| ---------- | --- | -------- | ------------------------------------------------------------------- |
| `profiles` | ON  | 3        | any signed-in user reads; only you insert/update your own row       |
| `jobs`     | ON  | 5        | anyone reads `published`; poster reads/edits/deletes own            |
| `offers`   | ON  | 6        | worker sees only own offers; poster sees all offers on own job      |
| `messages` | ON  | 3        | only the two people on the message, and only if party to the job    |
| `reviews`  | ON  | 4        | public read; write only by a participant, only once job `completed` |

**21 policies total.** `supabase/tests/verify_rls.sql` asserts this mechanically
rather than by eye: it raises if any `public` table has RLS off, if any table
has RLS on but zero policies (safe, but means the app is broken), if
`jobs.location` is selectable by anon/authenticated, or if anything is granted
to `PUBLIC`. Run it after every future migration.

Note on what was deliberately NOT used: `force row level security`. FORCE
subjects the table _owner_ to RLS, which breaks both SECURITY DEFINER paths —
the profile-creation trigger and `job_exact_location` — because their policies
are granted `to authenticated`, not to the owner. Clients connect as non-owners,
so plain ENABLE already constrains them. Logged so a later phase does not "fix"
this by turning FORCE on and silently breaking sign-up.

### The service_role key does not exist in this app

Only `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is read, in exactly one place
(`src/services/supabase.ts`). `.env.example` now carries an explicit warning
against adding the service_role/secret key, which bypasses RLS entirely and
belongs only in Edge Functions and the dashboard. The publishable key is safe in
the bundle _only because_ the RLS above exists — those two facts are load-bearing
together, not separately.

### Session tokens are encrypted at rest

Phase 1 deferred this: "refresh tokens must not land in plain AsyncStorage."
Resolved with Supabase's documented `LargeSecureStore` pattern — a fresh AES-256
key per write held in SecureStore (Keychain/Keystore), ciphertext in
AsyncStorage. SecureStore alone cannot hold a session: it rejects values over
2048 bytes and a Supabase session exceeds that.

Do not "optimise" that class. Reusing one key across writes, or dropping the
SecureStore round-trip, reintroduces exactly the CTR key/counter reuse that
destroys the encryption. The upstream docs carry the same warning.

### Auth surface hardening

- `signInWithEmail` never reports _which_ half of the credential was wrong.
  Distinguishing "no such user" from "wrong password" is an account-enumeration
  oracle.
- `sendPasswordReset` always reports success, even on error, for the same reason.
- Raw Supabase error objects are never returned to callers; errors are mapped to
  a closed `AuthErrorCode` union with copy written for end users.

### OPEN QUESTION — job location precision

**This is a privacy decision, not a schema one, and it is not settled.**

The schema now stores two locations per job:

- `location` — the exact point. `SELECT` is **revoked** from `anon` and
  `authenticated` at the column level, because RLS is row-level and cannot hide
  a column from someone allowed to read the row. Reaching it requires the
  `job_exact_location(job_id)` RPC, which returns rows only for the poster or
  the worker whose offer was **accepted**.
- `location_coarse` + `coarse_lat`/`coarse_long` — derived by trigger, rounded
  to 2 decimal places (~1.1 km at the equator, ~0.8 km at Canadian latitudes).
  This is the only location any client can read in bulk, and the only one the
  radius search touches.

What remains open:

1. **Is ~0.8 km the right granularity?** Coarse enough to not identify a house,
   fine enough to be useful. It is one constant in
   `app.derive_coarse_location()` — but changing it later does **not**
   retroactively protect already-published jobs, because the exact point is
   still stored.
2. **Rounding is not jitter.** Rounding snaps every address in a grid cell to
   the same point, so it leaks which cell you are in and is trivially
   invertible to "somewhere in this ~1 km square". That is the intent, but if
   two jobs from the same poster share a cell, repeat observation narrows it.
3. **Should the exact point be stored at all before a worker is accepted?** The
   safest posture is collecting it only at acceptance. Currently it is stored at
   post time, so a future RLS or column-grant mistake exposes home addresses of
   people who never hired anyone.
4. **Anonymous users can read published jobs**, including coarse location and
   `category` — enough to build a map of "where people want work done" without
   an account. Fine for job discovery, worth a second look before launch.
5. **PIPEDA:** a home address is personal information. If exact locations are
   retained, there should be a retention/deletion story. Cascade deletes handle
   account deletion; nothing yet handles "job completed six months ago".

No decision is needed to keep building, but item 3 gets harder to change the
more code assumes an exact point exists.

### Data residency

The project should live in `ca-central-1`. **A Supabase project's region cannot
be changed after creation**, so this is decided once, at creation, including for
the throwaway project used to validate these migrations.

### Not yet addressed

- No storage buckets yet, so no bucket policies. `avatar_url` is a bare text
  column; when avatars get uploaded, that bucket needs its own RLS.
- Realtime is not enabled on any table. Realtime respects RLS only when
  explicitly configured — revisit when messages go live.
- No rate limiting beyond Supabase's defaults; `messages` has no per-user insert
  throttle, so spam is currently only bounded by the 4000-character CHECK.

---

## 2026-09-15 — Phase 2 applied: RLS verified live, and an MCP misconfiguration

The migrations are applied to the prototype project `aovsfxypbdoppezlyjus`
(`ca-central-1`). RLS is no longer asserted from reading SQL — it is measured.
Earlier sections unchanged.

### RLS confirmed ON for every table, against a live database

All 5 tables, **21 policies** (jobs 5, offers 6, reviews 4, profiles 3,
messages 3). Verified behaviourally with three accounts, not just structurally:

- A third account party to nothing sees **0 messages, 0 offers, 0 drafts** and
  gets **0 rows** from `job_exact_location`.
- Its attempt to forge a message as another user was **rejected** with
  `42501 new row violates row-level security policy`.
- Its attempts to update or delete another user's profile, job and offer all
  affected **0 rows**.
- Legitimate parties still work — both sides of a real thread can read it, and
  the poster sees their own drafts. A deny-everything policy set would have
  passed the negative tests alone, which is why this counter-test matters.

**Note for client code:** the two failure modes differ. A forbidden INSERT
raises; a forbidden UPDATE or DELETE silently reports **0 rows affected**.
Treating "0 rows" as success would mask an authorisation failure.

### The exact-address gate works, end to end

Measured, in sequence: worker with a `pending` offer → **0 rows**; poster
accepts the offer → worker gets **1 row with the true coordinates**; the
unrelated third account → **still 0 rows**. Column-level `SELECT` on
`jobs.location` is confirmed absent for both `anon` and `authenticated`; only 12
columns are client-selectable and the exact point is not among them.

Also confirmed: `nearby_jobs` filters drafts for `anon` (1/2/3 rows at
500 m/5 km/20 km) where `service_role` sees them (2/3/4). That gap is what
proves the function's `SECURITY INVOKER` setting is load-bearing — as
`SECURITY DEFINER` it would have leaked unpublished jobs.

### service_role still absent from the app

Unchanged and re-confirmed: the app reads only
`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. `.env` now holds real values and is
verified gitignored (`.gitignore:34`), invisible to `git status`.

### INCIDENT — the MCP was writing-capable against the wrong project

Recorded because it is the most serious thing that happened this phase, and it
was a configuration trap rather than a mistake in the schema.

Claude Code reads MCP server definitions from `~/.claude.json`. A `mcpServers`
block also existed in `~/.claude/settings.json`, looked authoritative, and was
**inert**. Edits to it had no effect across three window reloads.

The live server turned out to be running with **no `--project-ref` at all**, and
with a token that reached **a different, live project** containing real user
profiles, Stripe records and password history. Applying Yoodle's migrations in
that state would have hit that database: `create table if not exists
public.profiles` would have silently matched its existing `profiles` table and
then attached Yoodle's triggers, policies and column revokes to it.

What prevented it: the original phase 2 instruction was "migrations are not to
be applied by you." That single constraint is the only reason nothing was
written during the window when the only reachable database was the wrong one.

Now remediated:

- correct project-scoped token in `~/.claude.json`
- `--project-ref aovsfxypbdoppezlyjus` added, confining the server to Yoodle —
  confirmed by the account-level tools (`list_projects`, `create_project`,
  `pause_project`) no longer being offered at all
- identity checked before any write: `public_tables: 0`, `auth_users: 0`

Lessons worth carrying:

1. **Verify which database you are connected to before the first write**, not
   after. One `select current_database(), count(*) from public tables` would
   have exposed this at any point.
2. **Config that looks authoritative may be dead.** Confirm against the running
   process, not the file you believe is read.
3. **Scope credentials per project.** An unscoped token plus a known project ref
   is enough to cross a boundary.

### Outstanding security items

- **`get_advisors` is unavailable** — Supabase's own security linter is refused
  by this token (needs a Project-level scope). There is therefore still no
  independent second opinion on the schema. Worth adding the scope and running
  it.
- **Test accounts have known passwords** (`test-password-a/-b/-c`) and were
  inserted directly via SQL. Fine for a prototype, must never reach production.
- **The MCP PAT is in this session's transcript.** Rotate it when prototype work
  ends.
- Storage buckets, Realtime and rate limiting remain untouched, as in the
  previous section.

---

## 2026-09-15 — Phase 3: auth & onboarding screens, avatar storage

Auth/onboarding UI, the avatars bucket, and two new profile columns. Migrations
0008 and 0009 are applied and verified against the prototype project. Earlier
sections unchanged.

### Session tokens: encrypted at rest, but NOT purely in SecureStore

The phase 3 brief asked for session tokens in `expo-secure-store` and "not
AsyncStorage." The intent is met; the letter is not achievable, and the
difference is worth stating plainly rather than ticking the box.

**SecureStore rejects values over 2048 bytes, and a Supabase session (access
token + refresh token + user object) exceeds that.** A pure-SecureStore adapter
would fail at the first write. What phase 2 implemented instead is Supabase's
documented `LargeSecureStore`:

- a fresh AES-256 key per write, held in **SecureStore** (iOS Keychain /
  Android Keystore)
- the session **ciphertext** in AsyncStorage

So AsyncStorage never holds a readable token. Reading one requires extracting
the Keychain/Keystore entry, which is the same barrier a direct SecureStore
write would give. The stated risk — "AsyncStorage isn't encrypted at rest" — is
answered by encrypting the payload rather than by relocating it.

The class carries a warning against "optimising" it. Reusing one key across
writes, or dropping the SecureStore round-trip, reintroduces CTR key/counter
reuse and silently destroys the encryption.

### The password never reaches a log, crash report, or analytics event

Verified by construction and by grep:

- **There are zero `console.*` calls anywhere in `src/`.** Nothing is written to
  a log at all, so no log can contain a password.
- **No analytics or crash-reporting SDK is installed.** There is no Sentry,
  Crashlytics, or telemetry package in `package.json`, so there is no sink that
  could capture form state.
- The password lives only in `LogInScreen` / `SignUpScreen` component state and
  is passed directly to the auth service. It is **never put in navigation
  params** — navigation state is serialised into crash reports and dev tools by
  React Navigation, so a password in a route param is a genuine leak. Both
  screens navigate with no arguments.
- `TextInput` uses `secureTextEntry` for password fields, which also excludes
  them from OS-level screenshot/autofill capture.

**Standing rule for later phases:** if a crash reporter or analytics SDK is
added, form state must be excluded from its automatic breadcrumb capture. Most
such SDKs record text-input values by default.

### Uploaded photos are validated twice, in two different trust domains

The client-side check alone is worthless against a modified client, so the same
limits exist server-side:

| Layer                     | Enforcement                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| Client (`validateAvatar`) | MIME must be one of jpeg/png/webp/heic; size > 0 and ≤ 5 MB; runs **before any bytes leave the device** |
| Client (post-read)        | re-checks `ArrayBuffer.byteLength`, not just the picker's claimed `fileSize`                            |
| Storage bucket (0009)     | `file_size_limit = 5242880`, `allowed_mime_types` set to the same four                                  |
| Storage RLS (0009)        | insert/update/delete confined to a folder named for `auth.uid()`                                        |

Three details that matter:

- **The file extension in the URI is never trusted.** A `.jpg` suffix says
  nothing about the bytes. The stored extension is derived from the picker's
  MIME type, not from the incoming filename.
- **`fileSize` is re-verified after reading.** The picker's number is a claim;
  `byteLength` is the actual payload.
- **`exif: false`** on the picker. EXIF can carry the GPS coordinates of where a
  photo was taken, which would quietly undo the coarse-location work in the
  schema — a profile photo taken at home would ship the home address.

Verified live: writing into another user's avatar folder is **rejected**
(`42501 new row violates row-level security policy for table "objects"`), and
writing into one's own folder **succeeds**.

### The full postal code is stored but not readable

Same two-tier model as `jobs.location`, now applied to profiles:

- `postal_code` — full code. Column-level `SELECT` **revoked** from `anon` and
  `authenticated`.
- `postal_fsa` — first three characters, trigger-derived. This is what other
  users see.

A full Canadian postal code identifies roughly a dozen urban households, so
exposing it would have undercut the coarse job locations. Verified live as a
signed-in user: selecting `postal_fsa` returns `M5V, M4K`; selecting
`postal_code` fails with `42501: permission denied for table profiles` — **even
for one's own row**. Writes are permitted (the column is in the UPDATE grant),
so it is genuinely write-only from the client's perspective.

`postal_fsa` is trigger-derived and not client-writable, so it cannot be
desynced from `postal_code` by a crafted request.

### Sign-up metadata is treated as untrusted input

Name and postal code travel as `signUp` `options.data` and land in
`auth.users.raw_user_meta_data`, which is **entirely user-controlled**. The
`on_auth_user_created` trigger therefore:

- trims and caps the display name at 80 characters
- normalises the postal code and validates it against the full Canada Post
  character rules (D, F, I, O, Q, U excluded everywhere; W, Z also excluded from
  the first position)
- **drops** an invalid postal code rather than raising, because a failing trigger
  would abort account creation entirely

This path was chosen over a client-side write specifically because it needs no
session: with email confirmation enabled, `signUp` returns no session, and an
RLS-protected client write would be denied — silently losing the name and
postal code.

### Auth surface unchanged and re-confirmed

`signInWithEmail` still refuses to distinguish "unknown email" from "wrong
password", and `sendPasswordReset` still always reports success. Both are
account-enumeration defences. The login screen surfaces the service's generic
message rather than inventing a more specific one.

### Outstanding

- **`get_advisors` is still unavailable** — the PAT lacks the Project-level
  scope, so Supabase's own security linter has still never run against this
  schema. Now covers two phases' worth of DDL.
- **The avatars bucket is public.** Avatar URLs are permanent and world-readable
  by design; a deleted photo's URL keeps working until the object is replaced.
  Acceptable for a prototype, worth revisiting before launch.
- **A phantom storage row exists.** The RLS policy test inserted a metadata row
  (`.../avatar.jpg`) with no file behind it, and Supabase blocks direct deletes
  from `storage.objects`. Remove it via the Storage UI if it bothers you.
- **Test accounts still have known passwords** and were created via raw SQL.
- **The MCP PAT is in this session's transcript** and should be rotated when
  prototype work ends.

---

## 2026-09-18 — Phase 3 audit: a lost migration, and two corrections

A verification pass over phase 3 before starting phase 4. Nothing here is a
breach; one finding is a real gap in what the repository could rebuild.

### FINDING — the storage policies existed only in the live database

`supabase/migrations/` ended at `0008`, but the project database had
`0009_avatars_storage_bucket` applied. `/src/services/profiles.ts` referred to
"migration 0009" twice and `0008`'s own header claimed it created the bucket, so
the file had clearly been written and then lost before it was ever committed.

Why this mattered, given the database itself was fine:

- The `avatars` bucket, its 5 MB ceiling, its MIME allow-list and all four
  owner-scoped RLS policies were reproducible from **nothing but the live
  project**. A `supabase db reset`, a second environment, or a rebuild from the
  repo would have produced a storage layer with no bucket and no policies.
- That is precisely the half of the avatar defence that is supposed to survive a
  modified client. The client-side checks in `profiles.ts` are a convenience;
  the bucket constraints are the boundary. The boundary was undocumented.
- It also means the security posture recorded in this file could not have been
  re-derived from the repository — the claim and its enforcement had drifted
  apart.

Recovered verbatim from `supabase_migrations.schema_migrations` and restored as
`0009_avatars_storage_bucket.sql`. Verified against the live project: bucket
public with `file_size_limit = 5242880` and the four-MIME allow-list, and four
policies on `storage.objects` scoping every write to
`(storage.foldername(name))[1] = auth.uid()::text`. Not re-applied — the
database was already correct.

Worth generalising: a migration that is applied but uncommitted is invisible to
every future reader, and this one carried an access-control rule.

### Client-side photo validation relaxed — deliberately, and not a weakening

`validateAvatar` previously rejected any picked image whose `mimeType` or
`fileSize` the picker had not supplied. Both are optional in expo-image-picker's
SDK 57 result, and are commonly absent under iOS's _limited_ photo-library
permission. The failure text — "please pick another" — was unactionable in that
state: no other photo would have helped either.

It now falls back to the URI extension for the MIME type, and skips the size
check when no size was given. The security reasoning for why that is acceptable:

- **The client check was never the trust boundary.** Storage enforces the same
  5 MB ceiling and the same MIME allow-list itself (migration 0009), on every
  upload, regardless of what the app believes. A modified client could always
  have lied about either field.
- **A declared type outside the allow-list is still rejected outright.** The
  extension is consulted only when nothing was declared; it can never override a
  declaration. So the change cannot be used to smuggle a `image/gif` through by
  renaming it.
- **Size is now checked on the real bytes, not a claim.** `uploadMyAvatar`
  measures `ArrayBuffer.byteLength` after reading the file and rejects both
  oversized and zero-length payloads. That check is stronger than the one it
  partially replaced, because the picker's `fileSize` was only ever a claim.

Net effect: identical enforcement, fewer users stranded.

### New column `onboarded_at` — user-controlled, and not an audit field

Added in migration 0010 so that "Skip for now" persists. Two properties to
record, because it is client-written:

- **The value comes from the device clock** and the client may set it to
  anything. Only _null vs not-null_ is ever read. It must not later be reused as
  an audit timestamp, a rate-limiting input, or evidence of anything.
- **Write access is scoped as usual.** `grant update (onboarded_at) ... to
authenticated`, on top of the existing `profiles_update_self` RLS policy
  (`id = auth.uid()`), so one user can only set it on their own row. Confirmed
  in `information_schema.column_privileges`: `authenticated` has SELECT and
  UPDATE on the column and nothing more.

`anon` has no policy on `public.profiles` at all, so the vestigial table-level
INSERT grant it holds on this column is unreachable.

### Postal code canonicalisation changed no exposure

Migration 0010 moved canonicalisation into `app.derive_postal_fsa`, so every
write path now stores the Canada Post form (`M5V 2T6`). Previously the sign-up
trigger stripped the space and a client UPDATE kept it, leaving two spellings in
one column.

No change to what is readable: `postal_code` still has SELECT revoked from
`anon` and `authenticated`, `postal_fsa` is still the only public form, and the
FSA is still trigger-derived rather than client-writable. The backfill rewrote
existing rows in place through the same trigger, so there is one definition of
"canonical" rather than two.

### Confirmed unchanged from the phase 3 entry

Re-verified rather than assumed:

- **No logging surface exists at all.** `grep` over `/src` finds no
  `console.*`, no Sentry, no analytics call of any kind. The claim that the
  password never reaches a log holds structurally, not by discipline.
- **No `any` anywhere in `/src`**, and `tsc --noEmit` is clean.
- **`.env` is gitignored** (`.gitignore:34`), and the first commit was checked
  file-by-file before it was made: no `.env`, no keys, no PAT. `.claude/`
  contains only a plugin toggle.
- **Session storage is still the `LargeSecureStore`** described in the phase 2
  entry — AES-256 key per write in SecureStore, ciphertext in AsyncStorage.

### Outstanding

Carried forward, plus one closed:

- **`get_advisors` is still unavailable** — the PAT lacks Project-level scope,
  so Supabase's own security linter has never run against this schema, now
  across three phases of DDL. **You are widening the PAT scope before phase 4**;
  this should be the first thing run once it is, and before more tables land.
- **No sign-out exists in the UI.** `signOut()` is implemented and exported but
  nothing calls it, because the only signed-in screen is the phase-1 placeholder
  Home. Deferred to phase 4. Until then the interim method is clearing the app's
  storage — see TESTING.md. Note what this means for a shared or lost device
  during testing: a session cannot currently be ended from inside the app.
- **The avatars bucket is public.** Unchanged and still by design.
- **A phantom storage row exists** from the phase 2 RLS test. Unchanged.
- **Test accounts still have known passwords** and were created via raw SQL.
- **The MCP PAT is in this session's transcript** and should be rotated when
  prototype work ends — more pressing once its scope is widened.

---

## 2026-09-18 — Phase 4: browsing, and what a browser can work out

Phase 4 is the first screen that shows OTHER people's data to a stranger, so
the questions here are different from phases 1–3: not "can this account be
broken into" but "what can someone learn by scrolling".

### A browser sees a neighbourhood, never an address

The requirement was to confirm the list and map expose only neighbourhood-level
location until an offer is accepted. Confirmed at four independent layers, and
tested rather than reasoned about:

1. **The function does not select it.** `browse_jobs` (migration 0011) returns
   `coarse_lat`/`coarse_long` — the ~1 km rounded point from 0003 — and has no
   parameter or column that could return the exact one.
2. **The column is not readable.** SELECT on `jobs.location` is revoked from
   `anon` and `authenticated`. Verified live: impersonating an ordinary signed-in
   user, `select location from public.jobs` fails with _permission denied for
   table jobs_. Not filtered — refused.
3. **The escape hatch checks authorisation.** `job_exact_location()` returned
   **0 rows** for a signed-in user who is neither the poster nor an accepted
   worker, while `browse_jobs` returned 50 for the same user. Browsing works;
   the exact point does not come with it.
4. **The type system will not carry it.** `BrowseJobRow` has `lat`/`long` and no
   field for an exact point, so a component cannot render one by mistake.

The detail screen deliberately has **no map and no address at all** — only the
poster's FSA ("M5V area"), which is already the public form.

**A trilateration angle, considered and dismissed.** A client can call
`browse_jobs` with any centre it likes and read `distance_meters`, so it can
solve for a job's exact position by varying the centre. That is fine here: the
position it solves for is the COARSE point, which the same response already
hands over as `lat`/`long`. Nothing is gained. This would stop being true if
`distance_meters` were ever computed from `location` instead of
`location_coarse` — a one-word change in 0011 that would silently turn the
browse endpoint into an address oracle. Worth a comment if that code is touched.

**`formatDistance` rounds sub-kilometre distances to the nearest 50 m.** Partly
presentational, partly not: "437 m away" states a precision the underlying data
does not have and invites a user to treat it as a fix on the address.

### The user's own location is protected too, which was not asked for

The radius centre comes from device GPS. That makes the browsing user's
position a new piece of sensitive data the app did not previously handle, so
`useBrowseLocation` constrains it at the source:

- **Accuracy is requested as `Accuracy.Low` (~1 km), not `High`.** The feature
  needs a neighbourhood, so collecting a street-level fix would mean holding
  more precision than anything uses. The cheapest way not to leak data is not to
  collect it.
- **The fix is rounded to 2 decimal places (~1 km) before it leaves the hook**,
  onto the same grid job locations are snapped to. The server therefore never
  receives a precise user position — only a neighbourhood. Nothing downstream
  can leak what it was never sent.
- **It is never persisted.** The coordinates live in component state for the
  session and are not written to the database, to storage, or to the profile.

Permission copy is explicit about the rounding rather than generic, in
`app.json`'s `expo-location` plugin config.

### Anti-scraping: pagination caps, and their honest limits

`browse_jobs` clamps all three of its size parameters **server-side**, so a
caller that sends whatever it likes gains nothing:

| Parameter         | Clamped to     | Verified                                     |
| ----------------- | -------------- | -------------------------------------------- |
| `p_radius_meters` | 500 m .. 50 km | 9 999 999 → 50 km results; 1 → 500 m results |
| `p_limit`         | 1 .. 50        | 9 999 → 50 rows; 0 and −5 → 1 row            |
| `p_offset`        | 0 .. 500       | 99 999 → 0 rows                              |

The offset ceiling is the load-bearing one. A limit alone only changes how many
requests a scraper makes, not what it can ultimately reach; the offset cap means
roughly 550 rows is the most any single (centre, radius, filter) combination can
yield.

**What this does NOT do, stated plainly:** it is not rate limiting. A determined
scraper can still walk the map by moving the centre and re-querying, and nothing
here counts requests or throttles them. What the caps prevent is casual bulk
extraction — one call that returns the city. Real rate limiting belongs at the
edge (Supabase/PostgREST or a gateway) and is not something an RPC can do well.
Logged as outstanding rather than claimed as solved.

The client cooperates rather than enforcing: `useBrowseJobs` stops paging at the
cap. That is a correctness fix as much as a policy one — because the server
_clamps_ rather than errors, asking for offset 520 returns the offset-500 page
again, which would have appended duplicate rows to the list forever.

### Search input is escaped, not interpolated

Text search runs through `ilike`, and the pattern is built by escaping `\`, `%`
and `_` in the user's input first. Without that, a search for `%` matches every
row in the radius — a one-character way to defeat the filter and pull the
maximum page every time. Verified: searching `%` and `_` each return **0** rows
rather than everything. (Values are passed as RPC parameters throughout, so this
is about wildcard semantics, not SQL injection.)

### A real leak found and fixed: drafts in browse results

`nearby_jobs` (0007) has no status filter — it relies entirely on RLS, and
`jobs_select_own` lets a poster read their own unpublished drafts. Any screen
built on it would have shown a poster their own drafts mixed in with live
listings, indistinguishable from published work.

Confirmed live by impersonating the poster who owns the seeded drafts:
`nearby_jobs` returned **2 drafts**, `browse_jobs` returned **0**. Fixed by
filtering `status = 'published'` explicitly in 0011 rather than inheriting
visibility from RLS.

The general lesson is worth keeping: **RLS answers "may this user read this
row", which is not the same question as "does this row belong in this list".**
Leaning on RLS for the second one will keep producing bugs like this.

### Sign-out now clears the query cache

Added to the new Home screen (carried over from the phase 3 audit). `signOut()`
is followed by `queryClient.clear()`, because otherwise the next account to sign
in on the same device would briefly render the previous account's profile and
job list from cache before the refetch landed.

### Outstanding

- **`get_advisors` is STILL unavailable** — retried this phase, same privilege
  error. Four phases of DDL have now never been linted, and 0011 added two more
  functions. This is the longest-standing item in this file.
- **No rate limiting anywhere.** See above; the caps are not a substitute.
- **The map needs a Google Maps key before any Android build.** Not a
  vulnerability, but it means the map is untested outside Expo Go. Documented in
  `.env.example`.
- **Location permission denial is a dead end.** If the user denies location,
  browsing shows an explanation and a retry and nothing else — there is no
  manual neighbourhood entry to fall back on. Acceptable for a prototype;
  revisit when the FSA question is settled.
- **The avatars bucket is public**, **a phantom storage row exists**, **test
  accounts have known passwords**, and **the MCP PAT is in transcripts** — all
  unchanged from earlier phases.

---

## 2026-09-19 — Phase 4 follow-up: the audit that `get_advisors` could not do

### `get_advisors` is blocked by ACCOUNT role, not by token scope

Four phases of this file have recorded "the PAT lacks scope". That was the wrong
diagnosis. Calling the Management API directly with the configured token:

```
GET /v1/projects/{ref}                     -> HTTP 200   (full project detail)
GET /v1/projects/{ref}/advisors/security   -> HTTP 403
GET /v1/projects/{ref}/advisors/performance-> HTTP 403
```

The token authenticates and reads the project fine. Only the advisors endpoints
refuse, and the message is _"Your **account** does not have the necessary
privileges"_ — an account/organization role check, not a token scope check.

**Widening or re-minting the PAT will therefore probably not fix it.** The
account needs a higher role in organization `vkdjxnmgxfckctdlqrfn`, or the
project needs to be on a plan where advisors are exposed. That is a dashboard
action, not something that can be changed from here.

Recording this because "the PAT lacks scope" has been carried forward
unexamined for four phases and has been sending the fix in the wrong direction.

### The audit ran anyway, as SQL

The point of `get_advisors` was never the tool, it was the coverage. Supabase's
security linter rules are reproducible against the catalog, so they were. Every
result below is from the live project.

**RLS coverage — clean.** All five public tables have RLS enabled, at least one
policy, and a primary key.

| Table    | RLS | Policies | PK  |
| -------- | --- | -------- | --- |
| jobs     | on  | 5        | yes |
| messages | on  | 3        | yes |
| offers   | on  | 6        | yes |
| profiles | on  | 3        | yes |
| reviews  | on  | 4        | yes |

No table has policies while RLS is off, and none has RLS on with zero policies.

**Function `search_path` — clean.** All 15 functions across `public` and `app`
set `search_path=""`, including all 9 `SECURITY DEFINER` ones. A definer
function with a mutable search_path is the classic privilege-escalation path in
Postgres, and there are none.

**Views and extensions — clean.** No views or materialized views in `public` at
all, so there is no `SECURITY DEFINER` view and nothing exposing `auth.users`.
No foreign tables. Every extension (postgis, pgcrypto, uuid-ossp,
pg_stat_statements) lives in `extensions`, not `public`.

### FINDING — `anon` holds blanket table privileges that RLS does not fully cover

The one thing the audit turned up. Supabase's project defaults include
`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated`, and the
migrations only ever revoked what they needed to (SELECT/INSERT/UPDATE on
specific tables). What is left for `anon`:

| Table    | `anon` still holds                                    | `anon` policies      |
| -------- | ----------------------------------------------------- | -------------------- |
| jobs     | DELETE, TRUNCATE, TRIGGER, REFERENCES                 | 1 (select published) |
| messages | SELECT, INSERT, DELETE, TRUNCATE, TRIGGER, REFERENCES | 0                    |
| offers   | SELECT, INSERT, DELETE, TRUNCATE, TRIGGER, REFERENCES | 0                    |
| profiles | INSERT, DELETE, TRUNCATE, TRIGGER, REFERENCES         | 0                    |
| reviews  | SELECT, INSERT, DELETE, TRUNCATE, TRIGGER, REFERENCES | 0                    |

For SELECT, INSERT, UPDATE and DELETE this is survivable: RLS is enabled and
`anon` has no policy granting any of them, so every such statement is denied.
The grants are redundant, not exploitable.

**TRUNCATE is the exception, and it is worth understanding why.** Row-level
security filters _rows_; TRUNCATE does not operate on rows, and PostgreSQL does
not apply RLS policies to it at all. So for TRUNCATE the grant is the _only_
control, and `anon` has it on all five tables. RLS is not a backstop here.

**How bad is it, honestly:** latent rather than live. PostgREST exposes no way
to issue TRUNCATE, and the publishable key is a JWT for PostgREST rather than
database credentials, so there is no known path from "holds the anon key" to
"truncates a table". The exposure would become real the moment anything else
can execute arbitrary SQL as `anon` — a direct connection, a misconfigured
pooler, or a future `SECURITY INVOKER` function that takes SQL text.

**Recommended fix**, not applied because it was outside what this change was
asked to do:

```sql
revoke truncate, trigger, references, delete on all tables in schema public
  from anon;
-- and the same for `authenticated` on the tables it has no business deleting,
-- checked case by case against the delete policies in 0003-0006.
```

This is a default that every Supabase project carries, not something these
migrations introduced. It is still worth closing before phase 5 adds tables that
inherit the same defaults.

### `nearby_jobs` dropped (migration 0012)

Retired rather than left dormant. It had no caller left — nothing in `/src`
referenced it, and the only uses were three ground-truth queries in
`seed_test_data.sql`, rewritten to hit `public.jobs` directly.

The security reason for dropping rather than ignoring: it was a live,
`EXECUTE`-granted endpoint reachable by anyone holding the publishable key,
independent of whether the app called it. It had no status filter (so it
returned a poster's own drafts, verified: 2 vs 0 from `browse_jobs`) and no
pagination or caps (so it returned every job in the radius in one response).
Leaving it live would have meant the anti-scrape caps added in 0011 could be
sidestepped by calling the older function instead. Confirmed gone: `public` now
exposes exactly `browse_jobs`, `nearby_job_categories` and `job_exact_location`.

### Test fixtures must be purged before real signups

Logged here as well as in TESTING.md because it is a data-exposure issue, not
just a tidiness one. The database currently holds **56 published fixture jobs**,
all owned by test accounts, all clustered on downtown Toronto, plus test
profiles with known passwords created via raw SQL.

If real users sign up against this project, they will browse a marketplace
mostly made of fake listings attached to accounts nobody controls, and the
fixture rows are indistinguishable from real ones in the UI. The known-password
test accounts are the sharper end of it: they are real, signable-in accounts in
the same auth table as real users.

**Before any real signup — whether a beta tester, a store review build, or a
demo — purge fixtures and test accounts.** The procedure is in TESTING.md under
"Purging fixture data". This is a release blocker, not a nice-to-have.

### Outstanding

- **`get_advisors` still unavailable**, now correctly attributed to account role
  rather than token scope. The SQL audit above is the interim substitute and
  should be re-run when phase 5 adds schema.
- **`anon` blanket grants**, above. Recommended fix written, not applied.
- **Fixture data and known-password test accounts are still in the database.**
  Release blocker.
- **The MCP PAT is in this session's transcript** and in two config files on
  this machine (`~/.claude.json` and `~/.claude/settings.json`). Rotate when
  prototype work ends; if the account role is changed to unblock advisors, that
  is a natural moment to re-mint it.
- **No rate limiting.** Unchanged from the phase 4 entry; the caps are not a
  substitute.
- **The avatars bucket is public** and **a phantom storage row exists** —
  unchanged.

---

## 2026-09-19 — `anon` blanket grants revoked (migration 0013)

Closes the finding from the SQL audit earlier today.

### What changed

`revoke all privileges on all tables in schema public from anon`, then a
re-grant of only the two reads that are deliberate and have policies behind
them:

- `select` on the twelve non-`location` columns of `jobs` (0003's list verbatim),
  backing `jobs_select_published`.
- `select` on `reviews`, backing `reviews_select_all`.

`profiles`, `offers` and `messages` got nothing back. `anon` has no policy on
any of them, so it could never read or write them; the grants were pure default
residue.

Revoke-then-regrant rather than revoking named privileges, so the result does
not depend on which defaults each earlier migration happened to remove. What
`anon` holds now is exactly the list above.

### Verified after applying

| Privilege  | jobs | profiles | offers | messages | reviews |
| ---------- | ---- | -------- | ------ | -------- | ------- |
| TRUNCATE   | no   | no       | no     | no       | no      |
| DELETE     | no   | no       | no     | no       | no      |
| INSERT     | no   | no       | no     | no       | no      |
| TRIGGER    | no   | no       | no     | no       | no      |
| REFERENCES | no   | no       | no     | no       | no      |

Checked with `has_table_privilege` rather than by attempting the operations —
attempting a TRUNCATE to confirm it fails is only safe if it fails.

**No regression to anonymous browsing**, checked as the `anon` role:
`browse_jobs(...)` → 50 rows, `nearby_job_categories(...)` → 5, published jobs
readable → 56. `browse_jobs` is SECURITY INVOKER, so it reads `jobs` with the
caller's own privileges and would have broken immediately had the re-grant been
wrong.

Note that `has_table_privilege('anon','public.jobs','SELECT')` now reports
**false**. That is correct, not a regression: it tests _table-level_ SELECT,
and `anon`'s access is column-level. Narrower is the point — the exact
`location` column is excluded, and a table-level grant would have re-included it.

### Future tables

`alter default privileges in schema public revoke all on tables from anon`, so
phase 5's tables do not arrive with the defaults again. Confirmed: the
`postgres` default ACL for `public` tables no longer lists `anon`.

**Limitation, recorded because it is invisible otherwise.** Default privileges
attach to the role that CREATES the object. This covers tables created by
`postgres` — migrations and the dashboard SQL editor, i.e. how tables actually
get made here. The project also carries a `supabase_admin` default that still
grants `anon` everything, and it cannot be altered from `postgres` (not a
superuser, not a member). A table created _as `supabase_admin`_ would still
inherit the old grants. Nothing creates tables that way today; worth
re-checking with the audit query if that ever changes.

### Still open: `authenticated` has the same defaults

Deliberately out of scope for this change, which was scoped to `anon`.
`authenticated` still holds TRUNCATE, DELETE, TRIGGER and REFERENCES on all five
tables — verified `has_table_privilege('authenticated', ..., 'TRUNCATE')` is
**true** everywhere.

The same reasoning applies: RLS does not mediate TRUNCATE, so the grant is the
only control. The difference is who holds it — any signed-in user rather than
any visitor — which is a smaller population but not a trusted one. Same
mitigation as before: PostgREST exposes no TRUNCATE verb, so it is latent.

Doing it needs more care than the `anon` case, because `authenticated`
legitimately needs INSERT/UPDATE/DELETE on several tables and the delete
policies in 0003–0006 have to be read first to work out the correct re-grant
list. Worth folding into phase 5 alongside its new tables rather than rushing.

---

## 2026-09-19 — Phase 5: posting, and a correction to the phase 3 EXIF claim

Phase 5 is the first time users put content INTO the app that other users see.
That inverts the threat model from phase 4: the question is no longer what a
browser can extract, but what a poster can inject.

### CORRECTION — `exif: false` never stripped anything

**The phase 3 entry in this file is wrong.** It recorded, under the avatar
upload:

> **`exif: false`** on the picker. EXIF can carry the GPS coordinates of where a
> photo was taken…

listing that option as the defence. It is not one. The SDK 57 docs describe
`exif` as _"whether to also include the EXIF data for the image"_, and the
asset's `exif` field as _"included if the `exif` option is truthy"_. The option
controls whether EXIF is handed to **JavaScript**. It does not touch the file.
Setting it to `false` means the app cannot see the metadata — not that the
metadata is gone — and the upload carries the original bytes either way.

So since phase 3, avatars have been uploaded with whatever EXIF the camera
wrote, into a **public** bucket. For a photo taken at home, that includes
`GPSLatitude`/`GPSLongitude`.

The irony is worth recording: the comment in the code said this was to avoid
undoing the location-privacy work in the schema, and it was the one thing in
that chain that did nothing.

**What actually strips EXIF is re-encoding.** `prepareImageForUpload`
(`/src/services/images.ts`) decodes the image and writes a new JPEG from the
pixels via `expo-image-manipulator`; source metadata is not part of that
pipeline and does not survive it. Both upload paths now go through it:

- job photos, in `uploadJobPhotos`;
- avatars, in `uploadMyAvatar` — the phase 3 path, corrected here.

`PhotoPicker` still passes `exif: false`, now with a comment saying plainly that
it is not the protection, so nobody re-derives the wrong conclusion from it.

**What is NOT verified.** The SDK docs do not state that re-encoding drops
metadata — it follows from how the native decode/encode works, but it is
inference, not a documented guarantee, and nothing here has run on a device.
TESTING.md carries a manual check that downloads an uploaded photo and looks for
an `Exif` marker in the bytes. **Treat this as unconfirmed until that check has
been run.** Existing avatars uploaded before today were never re-encoded and
should be assumed to carry EXIF; they are replaced on next upload.

### Free-text sanitisation, and the escaping that is deliberately absent

`/src/services/sanitize.ts` runs over every title and description, on the way
in, in the service rather than only the screen — so a future non-form caller
gets it too.

**It does not escape HTML, on purpose.** Storing `&lt;b&gt;` in place of `<b>`
is the usual reflex and it is wrong here. React Native's `<Text>` does not parse
markup, so there is nothing to escape for any screen that exists; and escaping
at write time corrupts the value for every later reader, which then
double-escapes it or has to guess how to undo it. Escaping belongs at whatever
render boundary actually interprets markup — a WebView, an email, a web
dashboard — applied by that renderer against the text as typed. If chat or a
web surface lands in a later phase, **that** is where escaping goes.

What is removed is the class of characters that misbehave in any renderer:

| Removed                                   | Why                                                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| C0/C1 controls (not `\n`, `\t`)           | Break log lines and CSV exports; no legitimate use in a listing                                                                           |
| Zero-width (U+200B–200D, U+2060, U+FEFF)  | Invisible, so two different strings look identical — evades word filters and fakes duplicates                                             |
| Bidi overrides (U+202A–202E, U+2066–2069) | Reorder how text DISPLAYS without changing it, so a listing reads one way on screen and another in the database — the Trojan Source trick |

Plus NFC normalisation, whitespace collapsing, and truncation. Validation runs
on the sanitised value, not the raw one — otherwise a title of nothing but
zero-width characters passes "is it empty" and then fails a CHECK constraint
with an error no user can act on.

Verified by compiling the module and running 13 assertions against it: bidi
stripping, zero-width stripping, control characters, newline handling, blank
line collapsing, NFC, truncation, an all-invisible title collapsing to empty,
and HTML surviving untouched. All pass.

Ceilings are mirrored server-side: `char_length(description) <= 4000` (0014) and
the existing title constraint from 0003. Verified: a 4001-character description
is rejected by the database.

### Spam and abuse limits — implemented, not deferred

The spec allowed logging this as an open item. It was cheap enough to enforce.

`app.enforce_job_post_rate_limit` (0014) is a BEFORE INSERT trigger capping a
poster at **10 jobs per rolling hour**, counting every status so deleting or
cancelling does not refund the budget. In a trigger rather than the client for
the obvious reason: a scripted poster does not run the client. Verified — the
11th insert inside an hour is rejected.

The client maps the error to _"You have posted a lot of jobs in the last hour"_
rather than a generic failure, since it is a state the user can actually wait out.

**What it does not stop, plainly:** it is per-account. Someone willing to
register accounts can still flood a neighbourhood. That is a signup-side
control — email verification, device or phone checks, or a global rate limit at
the edge — and none of those exist yet. **Still open.**

### Photo paths cannot be pointed at someone else's files

Two independent checks, because the bucket is public and a listing renders
whatever path its row holds:

1. **Storage policies** (0014) confine writes to `{auth.uid()}/…`, so a user
   cannot upload into another user's folder.
2. **`app.validate_job_photo_paths`** rejects an INSERT or UPDATE whose
   `photo_paths` do not all start with the row's own `poster_id`. Without this,
   the policies would stop you writing someone else's file but not stop you
   _recording_ their path against your listing — displaying their image as
   yours.

A trigger rather than a CHECK constraint because verifying "every element
matches" needs to unnest the array, and PostgreSQL does not allow a subquery in
a CHECK. Verified: a path under another user's uid is rejected, the poster's own
is accepted, and a fourth photo is rejected by the count constraint.

### The one place an exact location is captured

`LocationPicker` is the only screen that captures a precise point, which is the
intended design: `jobs.location` is exact, the ~1 km coarse point every browser
sees is derived from it by trigger, and the exact value is released only through
`job_exact_location()`. The screen says so to the poster rather than collecting
it silently.

The device GPS fix used to POSITION the map is still the rounded one from
`useBrowseLocation` — it is a starting point, not the answer, so there was no
reason to loosen that.

### Outstanding

- **EXIF stripping is unverified on a device.** The highest-priority item in
  this entry. See TESTING.md.
- **Existing avatars may carry EXIF** from before today's fix.
- **Rate limiting is per-account only**; nothing stops multi-account abuse.
- **No moderation or reporting.** Nothing lets a user flag a listing, and
  nothing scans text or photos for abusive content. A public marketplace needs
  both before real users.
- **Orphaned photos are never cleaned up.** Replacing a job's photos uploads new
  objects; the old ones stay in the bucket, and cancelling a job leaves its
  photos entirely. Storage grows without bound.
- **`get_advisors` still unavailable** — account role, not token scope. Two more
  functions and a new bucket added this phase, still unlinted. Revisit before
  phase 7 per the current plan; the SQL audit from 2026-09-19 is the substitute
  and should be re-run.
- **`authenticated` still holds TRUNCATE** and the other default grants.
- **Fixture data and known-password test accounts** are still in the database.
  Release blocker; see TESTING.md.

---

## 2026-09-19 — Phase 5 review: orphaned photos stay public

A review of the phase 5 diff found eight defects. Six are fixed; two are
deferred and logged below. One has a security consequence worth its own entry.

### CORRECTION — and the exposure the earlier wording missed

The phase 5 entry above says, of replaced photos, that "the old ones stay in the
bucket". That was both imprecise and, more importantly, understated.

**Imprecise:** photo paths were index-based (`{uid}/{jobId}/0.jpg`) and uploaded
with `upsert: true`, so replacing photo 1 with photo 1 _overwrote_ the old
object rather than leaving it. Old files only accumulated when a replacement set
was SMALLER than the one before it.

**Understated, and this is the part that matters:** `job-photos` is a **public**
bucket. An object in it is fetchable by anyone with the URL, and that does not
change when the `jobs` row stops pointing at it. So a poster who removes a photo
from their listing has not withdrawn the photo. It remains retrievable by:

- anyone who loaded the listing while that photo was on it, since the app
  rendered the URL directly;
- anyone who ever saw a shared or cached copy of that URL;
- and permanently, because nothing expires it — the bucket is public, not
  signed.

Someone who posts a photo, realises it shows their house number or their car
plate, and swaps it out would reasonably believe they had taken it down. Before
this fix, they had not. That is a privacy failure of the same kind as the EXIF
one: the user takes an action they believe protects them, and it does nothing.

### What was changed

**Fresh paths per save.** Photos now upload to `{uid}/{jobId}/{batch}-{n}.jpg`
where `batch` is the save timestamp. This fixes the other half of the problem:
stable paths plus `upsert` meant a replaced photo kept its public URL, so the
image cache and the CDN carried on serving the previous picture — a poster would
swap a photo and still see the old one. New path, new URL, no cache to defeat.
It is the same reasoning behind the `?v=` on avatar URLs.

**Explicit deletion of what is no longer referenced.** `deleteJobPhotos` removes
the objects a save has stopped pointing at, called after the row update
succeeds. The previous paths are captured BEFORE the mutation, because the
mutation's `onSuccess` writes the new row into the query cache — reading them
afterwards would find the new paths and conclude there was nothing to clean up.

Deletion is deliberately **best-effort and non-fatal**: the row is already
saved, so failing the whole edit over a failed storage delete would be worse.
The cost of that choice is that a failed delete leaves an exposed orphan
silently. See below.

### Still open

- **Cancelling a job does not remove its photos.** They stay in the public
  bucket and stay fetchable. A poster who cancels a listing has not withdrawn
  its images. This is the largest remaining case and it should be closed before
  real users — most plausibly with a scheduled sweep that deletes objects under
  `{uid}/{jobId}/` for jobs that are cancelled or deleted, since doing it
  client-side depends on the client being there to do it.
- **A failed delete is invisible.** `deleteJobPhotos` returns its outcome and
  the caller ignores it. Nothing retries and nothing records it, so an orphan
  created this way is never noticed.
- **URLs already handed out stay valid until the object is deleted.** Deletion
  is the only revocation available on a public bucket. If withdrawal needs to be
  reliable, the bucket has to become private with signed URLs — a bigger change,
  and the right one if listings ever carry sensitive images.
- **No per-photo delete in the UI.** Editing replaces the whole set.

### The other five fixes, briefly

Not security-relevant, recorded so the diff is explicable:

- The edit screen showed a spinner forever when the job fetch failed — the
  `!values` guard ran before the error check, and `values` is derived from the
  query data. Error branch now comes first and offers a retry.
- Posting with a photo-upload failure navigated away and _then_ set the warning,
  so it was set on an unmounting screen and never shown; the user reached their
  job believing the photos had attached. It now stays put and offers a way
  through.
- The image re-encode resized unconditionally, upscaling small images and
  letting portrait photos exceed the intended cap because it constrained width
  rather than the longest edge. It now only downscales, and caps the longer
  side. The re-encode still runs when no resize is needed — that re-encode is
  what strips EXIF, so skipping it for small images would have quietly
  reintroduced the phase 3 bug.
- `jobs.budget` is nullable, but the edit form required a positive number, so a
  job without a budget could never be edited at all.
- Duplicate picked photos collided on React keys, making one delete remove both.

### Deferred, with reasons

- **`usePostingLocation` reports "unavailable" too early.** With GPS denied and
  the profile query still in flight, `postalFsa` is `undefined`, so the hook
  concludes it cannot guess before it has anything to guess from. Cosmetic and
  transient — it corrects itself as soon as the profile loads.
- **The over-long title branch in `validateJobForm` is unreachable**, because
  `sanitizeJobTitle` truncates first. Over-long titles are silently truncated
  rather than flagged. Harmless, but the dead branch is misleading and should
  either validate before sanitising or be removed.

---

## 2026-09-19 — Phase 6: offers, live messaging, and what Realtime does with RLS

The first phase where two strangers talk to each other in private. The central
question was whether Realtime enforces the same rules as a query, and it was
answered by measurement rather than by reading.

### Realtime and RLS — tested with three accounts, not asserted

Three real accounts were created, signed in through the client SDK, and pointed
at one private conversation. The third account subscribed to the **entire
`messages` table with no filter** — the strongest form of the question, not a
polite one — and was also given a legitimate reason to be there: they had placed
their own offer on the same job, so they are a party to the job, just not to the
conversation.

Results, all from `supabase/tests/realtime_rls_test.mjs`:

| Check                                        | Result           |
| -------------------------------------------- | ---------------- |
| Poster receives both messages over Realtime  | 2 of 2           |
| Worker receives both messages over Realtime  | 2 of 2           |
| **Outsider receives messages over Realtime** | **0**            |
| Outsider `SELECT` on the conversation        | 0 rows           |
| Outsider tries to insert into the thread     | refused by RLS   |
| Poster sees both offers on their own job     | `[30, 99]`       |
| Worker sees rival's bid                      | no — only `[30]` |
| Outsider sees rival's bid                    | no — only `[99]` |

So: **Realtime applies the same policies as a query, for INSERT and UPDATE.**
An unfiltered subscription is not a way around `messages_select_own_thread`, and
it is not a way around `offers_select_own` either — competing bids stay hidden
live, exactly as they are on a read.

This also settles a detail the Supabase docs raise: they say to call `setAuth()`
with the user's token before subscribing. supabase-js v2 does that itself when
the session changes — if it did not, the two participants would have received
nothing either, and they received everything.

### DELETE is the exception, and it is handled in two places

The docs are explicit: _"RLS policies are not applied to DELETE statements,
because there is no way for Postgres to verify that a user has access to a
deleted record."_ `messages_delete_own` lets any sender retract a message, so
this is a reachable path, not a hypothetical.

Two independent decisions keep it harmless:

1. **`messages` is left at the DEFAULT replica identity** (migration 0015 says
   so in a comment, at length, because the temptation to "fix" it is real).
   Logical replication then sends only the primary key for a DELETE, so the
   payload that escapes RLS is a bare `id`. **Setting `REPLICA IDENTITY FULL`
   would put the whole row — including `body` — into that unfiltered payload**,
   broadcasting private message text to every subscriber on the table. Several
   Realtime guides recommend `FULL` casually, for the unrelated reason that it
   enables filtering on DELETE. Do not follow that advice here.
2. **Nothing subscribes to DELETE.** `subscribeToThread` and `subscribeToInbox`
   register INSERT and UPDATE handlers only.

Either alone would be sufficient. Both together mean a future change has to undo
two separate decisions, in two files, to create a leak.

### Message text is sanitised on the same path as job descriptions

`sanitizeMessageBody` is the phase 5 sanitiser with a 4000-character ceiling,
applied in `sendMessage` before the insert — so it runs for any caller, not just
the chat screen. Control characters, zero-width characters and bidi overrides
are stripped; HTML is deliberately left alone, for the reasons in the phase 5
entry.

Bidi overrides matter more here than in a listing. A message is the record of
what two people agreed before meeting in person, and U+202E lets a message
render one way on the recipient's screen and store another way in the database.
That is a useful property if you intend to dispute what you said. Offer notes go
through the same treatment with a 1000-character ceiling (`offers.message`,
constrained in 0015).

### A privilege restriction caught an implementation that would have undermined it

Worth recording because the control worked exactly as intended, against me.

`makeOffer` was first written as a PostgREST `upsert`, which reads naturally
given `offers_one_per_worker_per_job`. It failed with _"permission denied for
table offers"_ — on a first bid, where nothing conflicts.

The cause: an upsert compiles to `INSERT ... ON CONFLICT DO UPDATE SET` over
every column sent, including `job_id` and `worker_id`. Migration 0004 revokes
UPDATE on exactly those two columns, with the comment _"Neither party may move
an offer to a different job or a different worker."_ Postgres checks column
privileges for the `DO UPDATE` clause statically, whether or not a conflict
occurs — so the statement is refused every time.

Rewritten as insert-then-update-on-23505, where the amend path writes only
`amount`, `message` and `status`. The restriction stands, and the column-level
grant was what surfaced the problem rather than letting a convenient-looking
statement quietly widen what a worker can change.

### OPEN ITEM — block and report, before launch

Logging this as the spec asked, with a recommendation rather than a shrug.

**Yoodle introduces strangers and then sends one of them to the other's home.**
That is a materially different risk profile from a marketplace that ships
parcels. As of this phase a user can be messaged by anyone who bids on their
job, or who posts a job they bid on, and there is:

- no way to block a user;
- no way to report a message, an offer, a listing or a person;
- no record that would support a report — messages cannot be edited, which is
  good, but nothing is retained on the moderation side because there is no
  moderation side;
- no way to stop a blocked person simply bidding again, since `offers` has no
  notion of a blocked pair.

**Recommendation: this is a launch blocker, not a nice-to-have.** The minimum
that seems defensible before real users:

1. A `blocks` table (blocker, blocked), enforced in the `messages` and `offers`
   insert policies so a block actually prevents contact rather than only hiding
   it client-side.
2. A `reports` table capturing reporter, subject, reason and a snapshot of the
   reported content, since a reported message can be deleted by its sender.
3. Somewhere for reports to go. A table nobody reads is not moderation.

Sizing and scheduling that is your call; recording that it is unbuilt is mine.

### Test accounts added for this phase

Three accounts were created directly in `auth` (the signup email rate limit
blocks the normal path), with password hashes and identity rows so they can sign
in: `p6-poster@yoodle.test`, `p6-worker@yoodle.test`, `p6-outsider@yoodle.test`.
They have known passwords, they are listed in TESTING.md, and they are covered
by the existing purge procedure — which is now more pressing, not less.

### Outstanding

- **Block and report do not exist.** See above. Launch blocker.
- **Notifications are in-memory only** and cleared on sign-out and on quit. That
  is deliberate — message previews would otherwise be written to unencrypted
  storage — but it means "since last opened" is literally since this launch.
- **`get_advisors` still unavailable**; two more tables are now in the Realtime
  publication and neither has been linted.
- **`authenticated` still holds TRUNCATE** and the other Supabase defaults.
- **Fixture data and test accounts still present.** Release blocker, now three
  accounts larger.
- **Photo orphans on job cancellation** remain from phase 5.

---

## 2026-09-19 — Phase 6 review: an offer's amount was not trustworthy

A review of the phase 6 diff turned up ten defects. Three of them let one party
rewrite the other's side of a deal. All three are fixed in migration 0016 and
guarded by a permanent test.

This entry matters more than most because **payments reads `offers.amount` as
the number to charge.** Until now that number could be changed after agreement,
by either side.

### The three holes, demonstrated rather than argued

Each was reproduced against the live database, signed in through the normal
client SDK as ordinary users — no admin key, nothing exotic.

**1. A worker could re-price an already-accepted offer.** `offers_update_own`
checks only `worker_id = auth.uid()`; it never looks at status. And accepting an
offer does not change the job's status — the job stays `published` — so the
Apply button remained live and the path was reachable straight from the UI.

```
after accept:  {"amount":40,"status":"accepted"}
CONFIRMED:     worker re-priced it -> {"amount":999,"status":"pending"}
```

**2. A poster could rewrite the worker's offer note.** `"original worker note"`
became `"POSTER REWROTE THIS"`. Dispute-relevant text that the rest of the
design treats as immutable — messages deliberately have no UPDATE path at all,
for exactly this reason.

**3. A poster could change the worker's price.** `$40` became `$1`. This one was
NOT found by the review; it turned up while verifying (2), by asking whether the
same reasoning extended to the neighbouring column. It does, and it is worse:
combined with accept, a poster could have "accepted" a price the worker never
offered.

**This third one PREDATES PHASE 6.** `grant update (amount, status)` in
migration 0004 has always been role-wide, so `offers_update_as_poster` has
always carried the amount with it. Phase 6 did not introduce it; phase 6 built
the screens that made it reachable. Recording that plainly because the fix ships
in a phase 6 commit and the blame does not belong there.

### Why neither RLS nor grants could have caught this

Worth stating, because the instinct is to reach for a policy:

- **RLS decides which ROWS** a statement may touch. Both parties legitimately
  have an UPDATE policy on the same row.
- **Column grants decide which COLUMNS a ROLE may write.** Poster and worker are
  both `authenticated`. A grant cannot distinguish them.

The rule that was needed — _this party may write this column on this row_ — sits
in the gap between the two. A `BEFORE UPDATE` trigger is the only place in
Postgres that can see the actor, the old row and the new row at once.

### What migration 0016 enforces

| Party                | May change                                                   | May NOT                                                        |
| -------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| Worker (offer owner) | `amount`, `message` while `pending`; withdraw from `pending` | accept, decline, reopen a settled offer, amend a settled offer |
| Poster (job owner)   | `status`: `pending` → `accepted` or `declined`               | `amount`, `message`, ever; re-decide a settled offer           |
| Anyone else          | —                                                            | everything (RLS already refuses; the trigger is a backstop)    |

Callers with no JWT (`auth.uid() is null` — migrations, seeds, service role) pass
through, as they already do for RLS.

Also added: `offers.updated_at`, set by trigger and not granted for UPDATE. It
gives each status transition a distinct identity, which fixes a notification bug
where declined → re-bid → declined collapsed into one entry.

### Permanent regression test

`supabase/tests/offer_mutation_rules_test.mjs` — 13 assertions, run against the
live database as two real users. It covers the three holes above plus the
adjacent cases: a worker cannot accept their own offer, cannot amend a withdrawn
one, and a poster cannot **smuggle a price change into an accept** by sending
both columns in one statement.

The file says in its header that if any assertion fails, `offers.amount` is not
trustworthy and payments must not ship. That is the point of it existing rather
than the finding simply being verified once and written up.

### Also fixed, non-security

- **Migration 0015 was not idempotent.** `alter publication ... add table`
  raises 42710 on a second run, and enabling Realtime from the Supabase
  dashboard adds the table to the same publication — so on a project where that
  toggle had been clicked, the whole migration would abort and `offers.message`
  would never land while the client wrote it on every offer. Now guarded. Same
  class of reproducibility failure as the phase 3 lost migration.
- **The poster was never told when a worker amended a bid**, and their offer
  queries were never invalidated, so a stale amount could sit on screen
  indefinitely. The inbox subscription now forwards every offer UPDATE that RLS
  delivers, and the hook decides who to tell.
- **Users were notified about their own actions** ("Your offer was withdrawn",
  to the person who withdrew it). Suppressed by reading the direction of the
  transition, which 0016 makes unambiguous: only a poster can accept or decline,
  only a worker can move an offer to pending or withdrawn.
- **`loadOfferContext` ignored its errors**, rendering every job as "A job" and
  silently removing the worker's only Message button with nothing on screen to
  explain it.
- **The notification badge could stick**, because `markAllSeen` ran on mount and
  React Navigation keeps the screen mounted under a pushed Chat. Now on focus.

### Deferred

- Chat headers still read "The poster" / "Your neighbour" — only `worker_id`s
  are loaded into the profile context, so the poster's name is never fetched.
- `MakeOfferScreen` swallows a submit with no feedback in the brief window
  before `useSession` resolves.

### Unchanged and still outstanding

Block and report remain unbuilt, and remain the launch blocker described in the
phase 6 entry. Nothing here touches that.

---

## 2026-09-20 — Phase 7: payments

The most detailed entry in this file, deliberately. Everything else here
protects data; this protects money, and it is the part a handoff engineer is
most likely to change without understanding why it is shaped this way.

**Status: WRITTEN BUT NOT DEPLOYED OR EXERCISED.** See "What is not verified"
at the end before trusting any of it.

---

### 1. The trust boundary, in one picture

```
  APP (untrusted — anyone can read the bundle and tamper with the client)
    - EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY   pk_test_...
    - Stripe SDK collects the card
    - calls Edge Functions with the user's JWT
    - READS payments.status. Writes NOTHING.
                    |
                    | supabase.functions.invoke (JWT verified by the platform)
                    v
  EDGE FUNCTIONS (trusted — Supabase servers, never shipped to a device)
    - STRIPE_SECRET_KEY      sk_test_...   full control of the Stripe account
    - STRIPE_WEBHOOK_SECRET  whsec_...     proves an event came from Stripe
    - SUPABASE_SERVICE_ROLE_KEY            bypasses RLS
    - the ONLY writer of payment state
                    |
                    v
  STRIPE  <--- webhook (signature-verified) ---
```

The single rule that everything else follows from: **the app can ask for money
to move, and can observe that it moved, but cannot assert that it moved.**

---

### 2. Webhook signature verification

`supabase/functions/stripe-webhook/index.ts` is deployed with
`verify_jwt = false`. It has to be: Stripe calls it and Stripe has no Supabase
credentials. **That means anyone on the internet can POST to this URL.**

The only thing separating a real Stripe event from a forged one is the
`stripe-signature` header — an HMAC Stripe computes over the raw request body
with the shared `whsec_` secret. Every request is verified with
`constructEventAsync` before a single row is read or written.

**What happens without it:** this, from any laptop, marks a job paid —

```
POST /functions/v1/stripe-webhook
{"type":"payment_intent.succeeded","data":{"object":{"id":"pi_..."}}}
```

— and with the release path keyed off payment state, that is a free job. The
check is not a formality; it is the whole authentication mechanism for this
endpoint.

**Three implementation details that silently break it:**

1. **The signature covers the RAW bytes.** `await req.text()` must come before
   any parsing. Reading the body as JSON and re-serialising changes whitespace
   and key order, and every signature then fails. The handler reads raw text
   first and hands that exact string to the verifier.
2. **Deno's crypto is async.** `constructEvent` (sync) throws in this runtime;
   `constructEventAsync` with `Stripe.createSubtleCryptoProvider()` is required.
   A handler that "works locally on Node" will fail here.
3. **It fails CLOSED.** If `STRIPE_WEBHOOK_SECRET` is unset the function returns
   500 and processes nothing. An unverifiable webhook is worth less than no
   webhook, because it looks like it is working.

**Replay protection** is separate from signature checking and equally
necessary. Stripe retries until it gets a 2xx and can deliver the same event
more than once. Every event id is INSERTed into `stripe_events` before handling;
a primary-key collision (23505) means "already processed" and returns 200
immediately. Inserting first makes this a lock rather than a check — two
concurrent deliveries of one event cannot both pass a "have I seen this?" test,
because one of them loses the insert.

If a handler throws after that insert, the event row is deleted before
returning 500, so Stripe's retry does real work instead of being swallowed as a
duplicate.

---

### 3. Idempotency: why a double tap cannot double charge

The spec asked for Stripe idempotency keys. There are three independent layers,
because any one of them can be defeated by a change that looks harmless.

**Layer 1 — the database.** `payments.offer_id` is `UNIQUE`
(`payments_one_per_offer`). Two payment rows for one offer are not
representable. There is also a partial unique index on
`stripe_payment_intent_id`, so one PaymentIntent cannot be attached to two rows.

**Layer 2 — reuse before create.** `stripe-authorize-payment` looks for an
existing payment on the offer and, if it finds one, retrieves and returns that
PaymentIntent rather than making another. It also refuses if the offer amount
has changed underneath it, instead of quietly charging the old figure.

**Layer 3 — Stripe idempotency keys**, derived from stable ids, never from a
timestamp or a random value:

| Operation              | Key                        |
| ---------------------- | -------------------------- |
| create Connect account | `connect-account:{userId}` |
| create PaymentIntent   | `authorize:{offerId}`      |
| capture                | `capture:{paymentId}`      |
| transfer               | `transfer:{paymentId}`     |

A retried request with the same key returns the ORIGINAL object. This is what
protects against the case the other two layers cannot see: a request that timed
out client-side but actually succeeded at Stripe.

**The race that layers 1 and 3 alone would miss.** Two simultaneous taps can
both pass the "does a payment exist?" read before either inserts. Both then
create a PaymentIntent — with the same idempotency key, so Stripe returns the
same intent to both — and both try to insert. One insert wins; the loser
**cancels the intent it created and returns the winner's**. Without that
cancel, a rejected insert would leave an orphaned hold on the payer's card.

---

### 4. PCI scope: raw card data never reaches us

**No screen in this app has a card number field, and that is not an oversight.**

The card is collected by **PaymentSheet** from `@stripe/stripe-react-native` —
`initPaymentSheet` then `presentPaymentSheet`, in `useAcceptAndPayMutation`.
That is Stripe's own native UI, rendered by Stripe's SDK, posting directly to
Stripe. What Yoodle handles is:

- a `client_secret` (a scoped, short-lived handle to one PaymentIntent), and
- afterwards, a status string.

It never sees a PAN, CVC, expiry or cardholder name. Nothing card-related is
logged, stored or forwarded. This keeps the project in the lightest PCI category
(SAQ A) — the one where a merchant fully outsources card handling — and it is
worth stating that this is a property of the architecture, not of a policy. The
moment somebody adds a `TextInput` for a card number "just for testing", the
scope changes and the audit obligations change with it.

Bank details are the same story: Connect **Express** onboarding is hosted by
Stripe. Legal name, date of birth, address, SIN and bank account go to Stripe's
page, not ours. `profiles.stripe_account_id` is the only trace, and no client
role can read it.

---

### 5. The ORDER money moves in

`stripe-release-payment` does three things, and the order is the point:

```
1. check the worker can actually be paid out   <-- BEFORE anything irreversible
2. capture   (money leaves the payer's card)
3. transfer  (money reaches the worker)
```

The naive ordering — capture, then try to transfer — produces the worst
available failure: the payer is charged, the worker is unpaid, and the money
sits in the platform balance with no automatic way out. It is also the ordering
you get by accident if you treat "mark complete" as a status change with a
payment side effect.

So the payout check comes first, and it is done **twice**: against the mirrored
`stripe_payouts_enabled` flag, and then against Stripe directly, because the
mirror is only as fresh as the last `account.updated` webhook. If either says
no, **nothing is captured** — the hold stays in place, the payer is not charged,
and the release can be retried once the worker finishes onboarding.

`source_transaction` on the transfer ties it to the specific charge, which lets
it succeed before funds settle into the platform balance. Without it a new
platform account has no available balance and every transfer fails
`balance_insufficient` — a failure that looks like a code bug and is not.

The job is marked `completed` **last**, after the transfer lands. A completed
job with an unpaid worker would be a worse lie than an incomplete job with a
paid one.

---

### 6. Authorisation: who may move whose money

Platform `verify_jwt` proves the caller holds a valid session. It does not say
**whose**. Every function re-derives the user from the token and checks the
relationship itself:

| Function                    | Check                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------- |
| `stripe-connect-onboarding` | acts only on the caller's own account; no parameter names another user             |
| `stripe-authorize-payment`  | caller must be `jobs.poster_id` for the offer's job; cannot accept their own offer |
| `stripe-release-payment`    | caller must be `jobs.poster_id` for the job                                        |

A valid session for the wrong user gets 403, not a payment.

---

### 7. What a client can touch

From migration 0017:

| Object                                                                                         | Client SELECT                                                                  | Client write |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------ |
| `payments` (id, job, offer, payer, payee, amount, currency, status, timestamps)                | payer or payee only, via RLS                                                   | **none**     |
| `payments.stripe_payment_intent_id` / `stripe_charge_id` / `stripe_transfer_id` / `last_error` | **no**                                                                         | none         |
| `profiles.stripe_payouts_enabled` / `stripe_details_submitted`                                 | yes                                                                            | **none**     |
| `profiles.stripe_account_id`                                                                   | **no** (verified: `has_column_privilege` false for `anon` and `authenticated`) | none         |
| `stripe_events`                                                                                | **no**                                                                         | none         |

`payments` has a SELECT policy and no INSERT, UPDATE or DELETE policy at all.
Edge Functions write it with the service role, which bypasses RLS. So "paid"
means Stripe said so, not that a client claimed it.

Stripe's internal ids are withheld from clients on the principle that an
attacker probing an API is meaningfully helped by knowing real object ids.
`last_error` is withheld because it can carry account state that belongs in logs.

---

### 8. Key handling, and one key that needs rotating

| Key                         | Lives                          | Reaches the app? |
| --------------------------- | ------------------------------ | ---------------- |
| `pk_test_...` publishable   | `.env` → app bundle            | yes, by design   |
| `sk_test_...` secret        | Supabase Edge Function secrets | **never**        |
| `whsec_...` webhook         | Supabase Edge Function secrets | **never**        |
| `SUPABASE_SERVICE_ROLE_KEY` | injected by the platform       | **never**        |

`.env` and `supabase/functions/.env` are both gitignored (`.gitignore:34`,
verified with `git check-ignore` for both paths).

**ACTION REQUIRED — rotate the Stripe secret key.** It was pasted into a chat
transcript to reach me. It is a TEST-mode key, so it cannot move real money, but
it can create and read test data on the account and it now exists in at least
one place it should not. Roll it in the Stripe dashboard once this phase is
working, and set the new value as an Edge Function secret. The same applies, as
it has since phase 2, to the Supabase MCP PAT.

---

### 9. What is NOT verified

Stated plainly because this is the file where over-claiming does the most harm.

**Nothing in this phase has been run.** The account's Supabase role returns 403
on the Management API endpoints for Edge Functions and secrets — the same
limitation that has blocked `get_advisors` since phase 2 — so:

- the three functions and the webhook handler are **written and committed but
  never deployed**;
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are **not set**;
- no PaymentIntent, capture, transfer or webhook has ever executed;
- the Deno code has not been typechecked (`deno` is not installed locally, and
  `supabase/functions` is excluded from the app's `tsc` because its globals and
  module specifiers are a different runtime).

What HAS been verified is the database half: the migration is applied, and the
grants were checked directly — `payments` exposes SELECT only, the four Stripe
id columns are ungranted, and `stripe_account_id` is unreadable by both client
roles.

Treat every claim in sections 2 through 6 as **a description of the code's
intent, confirmed by reading it, not by running it**, until the walkthrough in
TESTING.md has been completed.

---

### 10. Outstanding

- **Deploy and exercise everything.** Until then this phase is untested code on
  the money path.
- **Rotate the Stripe secret key** (above) and the Supabase PAT.
- **No platform fee is taken.** The transfer is the full offer amount. If Yoodle
  ever takes a cut, that is an `application_fee_amount` change and a tax
  question, not just a number.
- **Authorisations expire after about 7 days.** A job accepted and not completed
  within a week will have its hold lapse, and nothing currently detects that or
  asks the poster to re-authorise.
- **No refund or dispute path.** A cancelled job after acceptance leaves a hold
  that is never explicitly voided; it simply expires. Disputes are unhandled.
- **`get_advisors` still unavailable**, now across five phases and a payments
  schema.
- **Block and report still unbuilt** — the phase 6 launch blocker is unchanged,
  and money raises the stakes rather than lowering them.


---

## 2026-09-21 — Phase 7 review fixes: the payment path could not complete

A code review of the phase 7 payments work found twelve issues. Ten are fixed
here. The four that mattered most had the same shape: **code that read as
correct and had never been run**, which is exactly the risk section 9 warned
about and then did not act on.

### The one that invalidated the PCI claim

`useAcceptAndPayMutation` called `confirmPayment(clientSecret, {
paymentMethodType: 'Card' })` with no payment-method data, and **no `CardField`,
`CardForm` or PaymentSheet existed anywhere in the app**. The React Native SDK
reads card details from a mounted `CardField`; with none mounted, confirmation
could never succeed. Every payment would have failed at the last step.

Section 4 of the phase 7 entry described `confirmPayment` as "Stripe's own
native UI". That was not true of the code as written — `confirmPayment` renders
nothing. The claim has been corrected in place, and the code now does what the
claim says: `initPaymentSheet` + `presentPaymentSheet`, which IS Stripe's own
native sheet.

**The PCI position is unchanged and now actually holds.** The card is collected
by Stripe's sheet, in Stripe's SDK, posted directly to Stripe. Yoodle still sees
only a `client_secret` and a status. The point worth keeping: *the architecture
was right and the implementation did not exist*, and nothing in the repository
distinguished the two until someone looked.

### Onboarding could never start

`accountLinks.create` was given `yoodle://payouts` for `refresh_url` and
`return_url`. **Stripe rejects a custom scheme** — those fields must be http(s)
— so every onboarding attempt would have failed with a 500.

Fixed by adding `stripe-connect-return`, an https function whose only job is to
302 the browser back to `yoodle://payouts`, which is what
`WebBrowser.openAuthSessionAsync` is waiting for.

**It is deliberately not an open redirect.** The destination is a constant in
the file. The query string can select between two fixed suffixes and nothing
more; no part of the request ever becomes part of the target URL. A redirector
that echoed a caller-supplied `url` would be a phishing primitive hosted on our
own Supabase domain, and it would be trusted precisely because it is ours.

It is deployed with `--no-verify-jwt`, for the same reason as the webhook:
Stripe redirects a browser here and that browser carries no Supabase session.
Unlike the webhook, there is nothing to verify — it reads no data, writes no
data, holds no secret, and no onboarding state is ever taken from the redirect.
Onboarding status is still read back from Stripe.

### Authorisation gaps closed

- **A hold could be placed on a cancelled job.** `stripe-authorize-payment`
  selected `job.status` and never read it, and cancelling a job does not settle
  the offers sitting on it. A poster could cancel, then accept a still-`pending`
  offer, putting a real hold on a card for work nobody expected to happen.
  `cancelled` and `completed` are now refused.
- **A cancelled job could be marked complete.** `stripe-release-payment` had the
  same gap in reverse — it would have captured the card and flipped the job back
  to `completed`. Now refused.
- **A card could be charged for an offer that was never accepted.** The
  `offers` status update after a successful PaymentIntent discarded its error.
  If it failed, the poster got a working client secret for an offer still
  showing as `pending` to the worker. The error is now checked, the intent
  cancelled, and the request failed.

### Stripe is the authority, not `payments.status`

Release was gated on the mirrored `payments.status === 'authorized'`, which only
the webhook writes. **One dropped or delayed `amount_capturable_updated` would
strand a real hold until it expired** — the payer's money tied up, the worker
owed, and nothing in the app able to move it.

The function now retrieves the PaymentIntent and decides from that, healing the
mirror as it goes. The security property is unchanged and worth restating: the
*client* still cannot write payment state, and the app is still not trusted for
anything. What changed is which **server-side** source is treated as
authoritative — Stripe, rather than our cache of Stripe.

### Holds are now released when a job is cancelled

Previously listed under "Outstanding" as a known gap; it was worse than it
looked. A manual-capture PaymentIntent is a **real authorisation on a real
card**: the money is not taken, but it is unavailable to the poster until it
expires, up to about a week. Cancelling a job left that standing with nothing in
the app able to lift it.

`stripe-cancel-payment` now voids the hold, and `useCancelJobMutation` calls it
**before** cancelling the job. The order is the point: fail after the hold is
lifted and the job is merely still live (the poster can cancel again); fail the
other way round and the money is stranded on a job that no longer exists.

It refuses `captured` and `released` payments rather than pretending. Reversing
those is a refund plus a transfer reversal — a different decision, with a
dispute behind it, and not something a "cancel job" button should perform.

### Two rows, one job

`payments_one_per_offer` is unique on `offer_id`, **not `job_id`**. Both the app
and `stripe-release-payment` looked up payments with `.maybeSingle()` keyed on
`job_id`, which throws the moment a job has a second payment row — a job whose
first offer failed and was replaced. The failure mode was silent in the app (the
payment section vanished) and permanent on the server ("There is no payment on
this job yet"). In other words it broke **exactly the jobs that had already had
trouble**.

A shared `pickLivePayment` rule now decides: furthest along wins, ties break to
most recent. It is deliberately duplicated in `_shared/stripe.ts` and
`src/services/payments.ts` rather than shared across the Deno/RN boundary — if
those two ever disagree, the app shows a row the server refuses to act on.

### Edge Function messages now reach the user

`functions.invoke` resolves with `data: null` for **any** non-2xx, so every
`data.error` read was `undefined`. Every deliberately-worded message and every
machine-readable `code` — including `payee_not_onboarded` — was being replaced
by generic filler. The body is now read off `FunctionsHttpError.context`.

No new disclosure: the Edge Functions already pass user-facing copy through
`describeStripeError`, which keeps Stripe's internal ids and account state in
`payments.last_error` (unreadable by any client role) rather than on a phone
screen. This change surfaces the messages that were always intended to be seen.

### Still outstanding

- **Still not deployed, still not exercised.** These fixes are read-correct and
  unrun. The walkthrough in TESTING.md remains the gate.
- **The Deno functions are still untypechecked** — no Deno toolchain on this
  machine. Run `deno check` before deploying; `stripe-cancel-payment` and the
  reconciliation branch in `stripe-release-payment` are new and unverified.
- **Banner precedence on My Jobs** (review finding 11) is deliberately deferred:
  a retained release error outranks a fresh cancel error. Cosmetic, no money
  consequence.
- **Refunds and disputes remain unhandled.** Cancellation now voids a hold; it
  cannot undo a capture.
- **Authorisations still expire after ~7 days** and nothing detects it.
- **Rotate the Stripe secret key** and the Supabase PAT.
- **`get_advisors` still unavailable.**
- **Block and report still unbuilt** — unchanged since phase 6.
