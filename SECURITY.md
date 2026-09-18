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
