# Yoodle — Testing Log

A running, append-only record. Each phase adds a dated section; earlier sections
are never rewritten.

---

## 2026-09-10 — Phase 1: project scaffold & design system

No automated test runner is installed yet (no Jest, no RNTL) — that is deliberate
for a skeleton phase and should be revisited once there is logic worth unit
testing. Verification below is split into what was actually run and what still
needs a human with a simulator.

### Verified automatically

| Check                                 | Command                              | Result                                                                                                                         |
| ------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript, strict, no `any`          | `npm run typecheck`                  | passes, 0 errors                                                                                                               |
| ESLint (flat config, expo + prettier) | `npm run lint`                       | passes, 0 errors **and 0 warnings**                                                                                            |
| Prettier formatting                   | `npm run format:check`               | all files formatted                                                                                                            |
| iOS bundle                            | `npx expo export --platform ios`     | 1231 modules, Hermes bytecode produced                                                                                         |
| Android bundle                        | `npx expo export --platform android` | 1226 modules, Hermes bytecode produced                                                                                         |
| Token pipeline                        | `npx tailwindcss -i global.css -o …` | token values reach the CSS, e.g. `bg-primary-dark` → `rgb(224 138 82)` (`#E08A52`), `p-xl` → `24px`, `text-body` → `15px/22px` |
| Press + dark variants                 | same build, selector grep            | all 6 `active:` and all 5 `dark:active:` selectors generated                                                                   |
| WCAG contrast, 13 pairs × 2 schemes   | computed from `tokens.ts`            | 26/26 pass after the token corrections below                                                                                   |

The bundle checks matter more than they look: they are what proves the Babel
chain (including `react-native-worklets/plugin`, required by Reanimated 4), the
Metro + NativeWind CSS transform, and every import path actually resolve
together. A missing worklets plugin or a bad `global.css` wiring fails here.

Four real type errors were found and fixed during this phase rather than
suppressed: a union-type leak in `useTheme` (the dark palette was not assignable
to the light palette's literal types — now both widen to `ThemeColors`, which
also forces the dark theme to define every role), Tailwind's string-valued
spacing/radius maps receiving numeric tokens, and a missing `*.css` module
declaration.

### Still needs manual verification — please run these

`npm install` first, then:

1. **iOS simulator boots clean**
   `npm run ios` (or `npm start` then press `i`). Expect the Home screen with a
   "Yoodle" header, no red box, no yellow warning box.
2. **Android emulator boots clean**
   `npm run android` (or `npm start` then press `a`). Same expectation.
   Note: this machine has the Android SDK and `adb` but **no AVD created**, so
   the Android run has never been executed here — create an emulator in Android
   Studio first.
3. **Light mode look** — check `Button` and `Card` specifically:
   - all five button variants (primary, accent, secondary, ghost, danger)
   - `sm` / `lg` sizes, the loading spinner, the disabled state at 50% opacity
   - three card variants: elevated (shadow), outlined (border), filled (muted
     surface)
   - the filled card is pressable — tapping it should dim to 80% opacity
4. **Dark mode look** — tap **"Switch to dark mode"** at the top of the Home
   screen. This toggles at runtime via `useColorScheme().toggleColorScheme()`, so
   you do **not** need to restart the simulator or change the OS setting. Confirm
   every surface, border and text colour moves, and that nothing becomes
   low-contrast — especially the `ghost` and `secondary` buttons and the badge
   row.
   Then separately flip the **OS** appearance setting to confirm the app follows
   the system too (`app.json` → `userInterfaceStyle: "automatic"`; the template
   shipped `"light"`, which would have pinned the app to light mode forever).
5. **Text input behaviour** — focus the "Job title" field and confirm the border
   changes to the focus-ring token; confirm the "Postal code" field shows its
   error text in the danger colour; confirm the disabled field is dimmed and not
   editable.
6. **Fresh-clone sanity** — the real test of the lint/type-check claim:
   ```
   git clone <repo> fresh && cd fresh && npm install
   npm run typecheck && npm run lint
   ```
   Both must exit 0.

### Known gaps

- No unit or component tests, and no CI workflow. Worth adding Jest +
  `@testing-library/react-native` before the first screen with real logic.
- The design system has only been inspected as generated CSS and as a web
  preview, **not** as pixels on a device — item 3 and 4 above are the first real
  look.
- **No screen-reader pass yet.** Components do carry `accessibilityRole`,
  `accessibilityLabel` and `accessibilityState`, and contrast is now measured
  (below), but nothing has been driven with VoiceOver or TalkBack.
- No dynamic-type / font-scaling check. The type scale is fixed px; large OS
  font settings have not been tried.

### Contrast audit and the token corrections it forced

Every foreground/background pair the components actually compose was measured
against its own background. Six pairs failed on first pass, all in **light**
mode, all fixed in `tokens.ts`:

| Pair                                     | Before | After  | Change                                   |
| ---------------------------------------- | ------ | ------ | ---------------------------------------- |
| `warning` on `warningSubtle`             | 3.66:1 | 4.54:1 | amber base `#A9741A` → `#956617`         |
| `textMuted` on `surface`                 | 3.75:1 | 4.50:1 | new `sand[550]` `#807568` for light only |
| `primary` on `background` (ghost button) | 4.41:1 | 4.58:1 | clay 600 `#B85C2A` → `#B45A29`           |
| `success` on `successSubtle`             | 4.42:1 | 4.54:1 | green base → `#2D7B59`                   |
| `danger` on `dangerSubtle`               | 4.41:1 | 4.55:1 | red base → `#BD412D`                     |
| `borderStrong` on `surface`              | 1.51:1 | 3.75:1 | `sand[300]` → `sand[500]`                |

Most are 2% nudges you will not notice. **One is a visible design change worth
your opinion:** `borderStrong` drives the secondary button's outline, and the
secondary button sits on a near-white background, so that border was the only
thing defining the control — at 1.51:1 it failed WCAG 1.4.11 (3:1 for
identifying UI components). It is now a clearly visible warm grey. If that reads
as too heavy, the honest alternatives are a tinted secondary fill or a slightly
lighter border plus a stronger shadow — not simply reverting. Plain `border`
(dividers and card outlines) was left subtle on purpose; decorative separators
are not held to 3:1.

`sand[550]` exists because darkening `textMuted` for light mode would have _hurt_
dark mode, where the same value sits on a dark surface. Light uses `sand[550]`,
dark keeps `sand[500]` — both now clear 4.5:1.

---

## 2026-09-14 — Phase 1 follow-up: dependency bump & device-testing route

Closing out the two loose ends the phase 1 audit left open. Earlier sections
above are unchanged.

### Dependency bump

`expo` was a patch behind what SDK 57 expects (`57.0.21`, expected `~57.0.22`).
Fixed with `npx expo install --fix`, which changed 12 packages.

| Check                        | Command                              | Result                                                                              |
| ---------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| Expo SDK consistency         | `npx expo-doctor`                    | **21/21 checks pass**                                                               |
| TypeScript, strict, no `any` | `npm run typecheck`                  | passes, 0 errors                                                                    |
| ESLint                       | `npm run lint`                       | passes, 0 errors/warnings                                                           |
| Prettier                     | `npm run format:check`               | all files formatted                                                                 |
| Android bundle               | `npx expo export --platform android` | Hermes output, bundle hash `index-40a3fa17…hbc` **identical** to the pre-bump build |

Re-running the bundle after the bump matters: it is the check that would catch a
patch bump breaking the Babel/Metro/NativeWind chain. Module count is unchanged.

### Android emulator — AVD created, but the boot check is STILL NOT VERIFIED

This machine has the Android SDK, `adb`, the emulator binary and two system
images (`android-34`, `android-VanillaIceCream`) but **no `cmdline-tools`, so no
`avdmanager`**. An AVD was therefore defined by hand rather than downloading more
tooling. For reproducibility, `Yoodle_API34` consists of two files:

- `%USERPROFILE%\.android\avd\Yoodle_API34.ini` — `path`, `path.rel`, `target=android-34`
- `%USERPROFILE%\.android\avd\Yoodle_API34.avd\config.ini` — pixel_5 profile, x86_64,
  `image.sysdir.1=system-images\android-34\google_apis\x86_64\`

It boots: Android 14, `sys.boot_completed=1` in ~50s, `adb devices` shows
`emulator-5554`. Expo Go (`host.exp.exponent`) downloaded and installed cleanly.

**But the app never rendered.** Expo Go bounced straight back to the launcher,
and `logcat` showed repeated ANRs in `system` and `com.google.android.gms.persistent`
plus long `system_server` monitor contention. Cause is the emulator, not Yoodle:
2 GB RAM on a `swiftshader_indirect` software GPU is not enough to run Expo Go.
The emulator was shut down rather than tuned further, because a physical device
is the better surface anyway (see below).

So: **"app boots clean on an Android emulator" remains unverified.** The bundle
export proves the code compiles and resolves; it does not prove first paint.

### iOS simulator — permanently blocked on this machine

This is a Windows machine. An iOS simulator requires macOS + Xcode, so this
check cannot be run here at all, now or later. The options are a Mac, or a
physical iPhone via Expo Go / an EAS build. **Not a configuration gap — a
platform one.** Recording it so no later phase logs it as "pending setup".

### Chosen route: physical device via Expo Go

One device closes both platform gaps. `npx expo start`, then scan the QR with
Expo Go (Android) or the Camera app (iOS). Phone and this machine must be on the
same Wi-Fi; the Wi-Fi adapter here is `172.17.247.102`, and note the machine also
has virtual adapters (`192.168.56.1`, `192.168.178.1`) that Expo could pick
incorrectly — if the QR does not connect, `npx expo start --tunnel` bypasses
network topology entirely.

The manual checklist is unchanged — items 1–6 in the phase 1 section above, with
"simulator" read as "device".

### Known constraint for later phases: no local dev-build toolchain

There is **no JDK and no Gradle** on this machine (no Android Studio JBR either),
so `npx expo run:android` cannot produce a development build locally. Expo Go is
currently the only way to run Yoodle on a device here.

This will become blocking, because Expo Go only includes the native modules
bundled into it. The Stripe React Native SDK in particular does **not** work in
Expo Go, so the payments phase will require either a JDK installed locally or
EAS Build. Worth deciding before that phase starts, not during it.

---

## 2026-09-14 — Real brand palette: dark-first rewrite & contrast re-audit

The placeholder clay/teal palette was replaced with Yoodle's real brand colours,
sampled from the live site. The brand is **dark-first** — near-black is the
primary surface, not a dark-mode alternate — so the app is now single-theme.
Earlier sections are unchanged.

### What the dark-first decision changed

Route A (dark-only) was chosen over keeping a light/dark pair. The obstacle was
never the tokens: in NativeWind the **unprefixed class is the default**, so
"dark is default" cannot be expressed by swapping token values. There were 67
`dark:` classes across 8 files; all are gone.

| File                           | Change                                                      |
| ------------------------------ | ----------------------------------------------------------- |
| `theme/tokens.ts`              | one palette, not a light/dark pair; brand vs derived marked |
| `tailwind.config.ts`           | one emission per role, no `-dark` twin; `darkMode` unset    |
| `hooks/useTheme.ts`            | no scheme branch; now only serves literal colour props      |
| `navigation/RootNavigator.tsx` | always `DarkTheme`, `StatusBar style="light"`               |
| 5 components + `HomeScreen`    | all 67 `dark:` classes stripped                             |
| `app.json`                     | `userInterfaceStyle` `"automatic"` → `"dark"`               |

`darkMode` is deliberately left unset in the Tailwind config so a stray `dark:`
class cannot silently reintroduce a second theme.

### Verified automatically

| Check                | Command                              | Result                                           |
| -------------------- | ------------------------------------ | ------------------------------------------------ |
| TypeScript, strict   | `npm run typecheck`                  | passes, 0 errors                                 |
| ESLint               | `npm run lint`                       | passes, 0 errors/warnings                        |
| Prettier             | `npm run format:check`               | all files formatted                              |
| Expo SDK consistency | `npx expo-doctor`                    | 21/21 pass                                       |
| Android bundle       | `npx expo export --platform android` | 1223 modules, Hermes output                      |
| Token pipeline       | `npx tailwindcss -i global.css -o …` | all 11 brand values reach the CSS                |
| No theme leakage     | selector grep on generated CSS       | zero `dark:` variant selectors emitted           |
| WCAG, 30 pairs       | computed from `tokens.ts`            | **27 pass, 3 fail** — all 3 are plane separation |

### Contrast re-audit against the real values

The brand palette is strong. `textPrimary` on `background` is **16.04:1**,
`textSecondary` **6.89:1**, the CTA as text **8.70:1**. Every text pair in all
five components passes.

Two of my own **derived** values failed on first pass and were corrected (these
were mine, not brand, so correcting them is not a brand change):

| Token           | Was     | Now     | Why                                                                                                                    |
| --------------- | ------- | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| `accentPressed` | #4E7D5F | #6BA37F | 3.99 → 6.46. Pressed had to go _lighter_, not darker: the accent carries a dark label, so darkening it loses contrast. |
| `textMuted`     | #74857B | #7A8C82 | 4.40 → 4.82 on `surface`. Still clearly dimmer than `textSecondary` (6.25).                                            |

Also corrected, as a role mapping rather than a colour change: the CTA and
accent are **light** greens, so their labels are `#0C1210`, not `textPrimary`.
Mapped that way they measure 8.70:1 and 5.23:1; mapped the other way they were
1.84:1 and 3.07:1.

### Three failures NOT adjusted — they need a brand decision

All three are the same problem: **on a #0C1210 ground, nothing in the palette
separates one plane from another.** None is a WCAG violation, but all three are
real legibility questions.

| Pair                            | Ratio      | Note                               |
| ------------------------------- | ---------- | ---------------------------------- |
| `surfaceMuted` vs `background`  | **1.23:1** | the filled secondary button's fill |
| `surface` vs `background`       | **1.10:1** | every Card against the page        |
| `successSubtle` vs `background` | **1.51:1** | all subtle Badge fills             |

Why they are not violations: WCAG 1.4.11 wants 3:1 for whatever _identifies_ a
control, and each of these controls is identified by its label instead — the
secondary button's text measures 13.02:1, the success badge's 7.60:1. Card edges
are decorative, which 1.4.11 exempts.

Why they still matter, and what it would cost to "fix": clearing 3:1 above
#0C1210 needs a surface around `#4A5A50`, which is no longer a dark-first
surface. I walked the brand border up too — `#33403A` → 1.58, `#3C4A42` → 1.84,
`#4C5D53` → 2.45, `#55685C` → 2.88 — you do not clear 3:1 until roughly
`#586B5F`, which reads grey rather than green. **There is no in-palette fix.**

The practical consequence to look at on a device: **`Card`'s `elevated` variant
has lost its only cue.** It relied on a shadow, and a black shadow on near-black
is nearly invisible. Left as-is on purpose — raising `surface` or giving
`elevated` a border is a brand call, not a contrast fix.

### Still open

- **Status colours are carried over, not designed.** The brand set defines no
  success/warning/danger/info. The previous ramps were re-measured against the
  new ground and all four pass (7.60 / 7.96 / 6.44 / 6.73), but they were not
  chosen for this palette.
- **`success` is green and so is the CTA.** A green "Open" badge reads as brand
  chrome rather than as a status. Contrast cannot fix this; it needs a hue
  decision.
- **The accent gradient does not render.** `#5C9270 → #94D0A5` is stored as
  stops in `gradients.accent` and shown on HomeScreen as two solid swatches. A
  real gradient needs `expo-linear-gradient`, deliberately not installed.
- **`borderStrong` is now unused** by any component, since `secondary` became a
  filled variant. Kept as part of the role contract.

### Manual check, on a device

The light/dark toggle is gone, so items 3–4 of the phase 1 checklist collapse
into one pass. Priority order:

1. App boots to the near-black ground, no red box, "Yoodle" header.
2. **Do the Cards read as cards?** This is the real question — see the 1.10:1
   finding. Compare `elevated`, `outlined` and `filled` side by side.
3. The secondary button is now **filled**, not outlined. Does it read as a
   button, and is it clearly subordinate to the CTA?
4. The two gradient swatches at the top — confirm those are the right brand
   greens before a real gradient gets wired in.
5. Badges: does the green "Success" badge read as a status, or as brand chrome?

---

## 2026-09-14 — Phase 2: Supabase client, schema, RLS and auth services

No UI this phase, so there is nothing to look at on a device. Verification is
split into what ran here and what needs a live Supabase project — which is most
of it, because **the migrations were deliberately not applied**.

### Verified automatically

| Check                        | Command                                         | Result                                        |
| ---------------------------- | ----------------------------------------------- | --------------------------------------------- |
| TypeScript, strict, no `any` | `npm run typecheck`                             | passes, 0 errors                              |
| ESLint                       | `npm run lint`                                  | passes, 0 errors/warnings                     |
| Prettier                     | `npm run format:check`                          | all files formatted                           |
| Metro resolution of new deps | `npx expo export` with a temporary import probe | **1281 modules vs 1223** — see the note below |
| Tables / RLS cross-check     | grep over `supabase/migrations/*.sql`           | 5 tables created, 5 with RLS on, 21 policies  |
| Helper references            | defined-vs-referenced diff                      | every `app.*` helper used by a policy exists  |

**The module-probe note matters.** A plain `expo export` bundled 1223 modules —
_identical_ to phase 1 — because nothing in the app imports `src/services` yet.
That bundle proved nothing about the new code. A temporary file importing the
client and auth functions was added to force the modules into the graph; the
count rose to 1281 with no resolution errors, which is what actually proves
`@supabase/supabase-js`, `aes-js`, AsyncStorage, SecureStore and
`react-native-get-random-values` all resolve under Metro. The probe was removed
afterwards and `index.ts` restored.

### Five real bugs found and fixed in my own migrations before handing them over

Written down because each would have failed at a different, confusing moment:

1. **Helper functions could not be created.** `language sql` bodies are
   name-resolved at CREATE time, and the helpers reference `public.jobs` /
   `public.offers`, which do not exist until 0003/0004. Migration 0001 would
   have failed immediately. Converted to `plpgsql`, whose bodies resolve on
   first execution. No performance cost — SECURITY DEFINER functions are never
   inlined anyway.
2. **`force row level security` would have broken sign-up.** It subjects the
   table owner to RLS, and the profile-creation trigger is SECURITY DEFINER
   running as the owner against policies granted `to authenticated`. Every
   sign-up would have failed on the profile insert, and `job_exact_location`
   would have returned nothing for anyone. Removed from all five tables.
3. **A column REVOKE that was silently a no-op.** `revoke update (id) on
profiles` does nothing while a table-level UPDATE grant exists, and Supabase
   grants that by default, so `id` would have stayed rewritable by its owner.
   Fixed to revoke the table-level grant first, then re-grant `display_name`
   and `avatar_url` individually.
4. **Every radius search would have failed.** `nearby_jobs` is SECURITY INVOKER
   (deliberately, so RLS still filters drafts), so it reads `location_coarse`
   with the _caller's_ privileges — and that column was excluded from the SELECT
   grant. "permission denied for table jobs" on every call. Granted.
5. **A migration-halting grant.** `grant usage on schema extensions` raises if
   you do not own the schema. Wrapped so it warns instead of aborting 0001.

### Still needs a live project — the real tests

Do all of this against a **throwaway project**, never production.

**Step 0 — create the project.** Region `ca-central-1`. This cannot be changed
later, and the throwaway should mirror production.

**Step 1 — PostGIS.** Database → Extensions → `postgis` → **"Create a new
schema"**. The migrations schema-qualify everything as `extensions.*`. PostGIS
2.3+ is not relocatable, so getting this wrong means a backup/drop/restore.

**Step 2 — auth settings.** Authentication → Providers → enable Email. Turn
**"Confirm email" OFF** on the throwaway so two test accounts can be made
without inbox round-trips. Leave it **ON** for production.

**Step 3 — run the migrations in order**, in the SQL editor:

```
supabase/migrations/0001_extensions_and_helpers.sql
supabase/migrations/0002_profiles.sql
supabase/migrations/0003_jobs.sql
supabase/migrations/0004_offers.sql
supabase/migrations/0005_messages.sql
supabase/migrations/0006_reviews.sql
supabase/migrations/0007_location_rpcs.sql
```

0001 raises if PostGIS is missing and warns if it is in the wrong schema, so a
misconfigured project fails loudly on the first file rather than halfway.

**Step 4 — assert RLS.** Run `supabase/tests/verify_rls.sql`. Expect four
`PASS` notices and a summary table listing all five tables with
`rls_enabled = true` and a non-zero policy count. Any raised exception here is
a real hole — stop and fix it before going further.

**Step 5 — seed.** Create two accounts (A and B), paste their UUIDs into the
top of `supabase/tests/seed_test_data.sql`, and run it. It refuses to run until
you replace the placeholder UUIDs.

**Step 6 — the isolation tests.** These are the point of the phase. Sign in as
**A**, then attempt each of these _through the client SDK_ — not the SQL editor,
which runs as service_role and bypasses RLS, so it would tell you nothing:

| Attempt as A                                    | Expected                               |
| ----------------------------------------------- | -------------------------------------- |
| update B's profile row                          | 0 rows affected                        |
| select B's profile row                          | visible — names are readable by design |
| select messages on a job A is not party to      | **0 rows**                             |
| select the `location` column on any job         | error — column not selectable          |
| `rpc('job_exact_location')` on a job A isn't on | **0 rows**                             |
| select offers belonging to B's job              | 0 rows — rival bids stay hidden        |
| insert a message with `sender_id` set to B      | rejected                               |
| insert a review on a job that isn't `completed` | rejected                               |

Then sign in as **B**, who _did_ offer on A's job, and confirm B **can** read
that job's thread. A policy that denies everyone is not a passing test.

**Step 7 — PostGIS radius.** `seed_test_data.sql` ends with four queries whose
answers are stated inline. Expected, measured from Toronto City Hall:

- coarse rounding turns `43.6532,-79.3832` into `43.65,-79.38`
- 500 m → 2 rows; 5 km → 3 rows; 20 km → all 4, Scarborough last at ~11 km
- those counts are as **service_role**. Re-run `nearby_jobs` as a signed-in
  client and the draft job must **disappear** — that difference is the proof
  that RLS is filtering inside the RPC.

**Step 8 — auth round-trip.** With `.env` filled in, call `signUpWithEmail`
then `signInWithEmail` from a scratch script or the next phase's screens.
Confirm a profile row appears automatically (the `on_auth_user_created`
trigger), and that signing out and back in restores the session from encrypted
storage.

### Known gaps

- **None of the SQL has been executed anywhere.** It is reviewed and
  cross-checked, not run. Expect at least one thing to need adjusting on first
  application — most likely a grant.
- Still no automated test runner. The step 6 matrix is exactly what should
  become the first integration suite; done by hand it will not be re-run every
  time a policy changes.
- `src/services` has no data-access functions yet — only the client and auth.
  Jobs/offers/messages queries arrive with the screens that need them.
- `.env` is not populated here, so `supabase.ts` throws on import by design,
  with a message naming the two variables and the `--clear` restart.

---

## 2026-09-15 — Phase 2 migrations APPLIED and verified against a live database

The migrations are no longer unexecuted. All seven were applied to the Yoodle
prototype project `aovsfxypbdoppezlyjus` (`ca-central-1`) and every claim in the
previous section has now been checked behaviourally rather than by reading SQL.
Earlier sections unchanged.

### Getting connected — the MCP was pointed at the wrong database

Worth recording, because it nearly caused real damage. Claude Code reads MCP
servers from `~/.claude.json`, **not** from the `mcpServers` block in
`~/.claude/settings.json`. That second block existed, looked authoritative, and
was inert. Three window reloads changed nothing because the edits were going to
the file nothing reads.

The diagnosis came from inspecting the running process: the live server was
`node …/mcp-server-supabase/dist/transports/stdio.js` with **no arguments**,
taking its token from a `SUPABASE_ACCESS_TOKEN` env var — which could not have
come from the file being edited.

Two things made this dangerous rather than merely annoying:

1. The stale config had **no `--project-ref`**, so the server was unscoped and
   could address any project the token could reach.
2. The token it held reached a **different, live project** holding real user
   data, Stripe records and password history.

Had the migrations been applied while in that state, `0002_profiles.sql`'s
`create table if not exists public.profiles` would have silently no-op'd against
that project's existing `profiles` table and then applied Yoodle's triggers,
policies and column revokes to it.

Now fixed: correct token in `~/.claude.json`, plus
`--project-ref aovsfxypbdoppezlyjus` so the server is confined to Yoodle. The
scoping is visible in the tool surface — account-level tools (`list_projects`,
`create_project`, `pause_project`) are no longer advertised at all.

**Confirmed identity before writing anything:** `public_tables: 0`,
`auth_users: 0`. An empty database, not the 12-table one.

### Migrations applied

| Migration                     | Result   |
| ----------------------------- | -------- |
| PostGIS → `extensions` schema | 3.3.7 ✅ |
| `0001_extensions_and_helpers` | ✅       |
| `0002_profiles`               | ✅       |
| `0003_jobs`                   | ✅       |
| `0004_offers`                 | ✅       |
| `0005_messages`               | ✅       |
| `0006_reviews`                | ✅       |
| `0007_location_rpcs`          | ✅       |

**All seven applied on the first attempt with zero failures.** The previous
section predicted "expect a grant or two to need adjusting" — that turned out to
be wrong, because the five bugs found by reading the SQL were the ones that
would have failed. Code review caught them; the live run found nothing new.

### Structural verification

| Check                         | Result                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| RLS enabled                   | all 5 tables ✅                                                                                                                                      |
| Policy count                  | **21** — jobs 5, offers 6, reviews 4, profiles 3, messages 3                                                                                         |
| `jobs.location` client-select | **not granted** to anon or authenticated ✅                                                                                                          |
| `jobs` client-selectable cols | 12, `location` absent: id, poster_id, title, description, category, budget, location_coarse, coarse_lat, coarse_long, status, created_at, updated_at |
| `profiles` client-updatable   | only `display_name`, `avatar_url` — `id` locked ✅                                                                                                   |
| Grants to `PUBLIC`            | none ✅                                                                                                                                              |

The `profiles` result confirms the column-revoke fix worked. Before it, the
table-level UPDATE grant would have left `id` rewritable.

### Behavioural verification

**Profile trigger.** Two users inserted into `auth.users`; both profiles
appeared automatically with `display_name` lifted from `raw_user_meta_data`.

**Coarse-location trigger.** Exact → rounded, as intended:

| Exact             | Coarse        |
| ----------------- | ------------- |
| 43.6532, -79.3832 | 43.65, -79.38 |
| 43.6658, -79.3832 | 43.67, -79.38 |
| 43.7000, -79.2600 | 43.70, -79.26 |

**PostGIS radius — and the proof RLS filters inside the RPC.** Same query, two
roles:

| Radius | as `service_role` | as `anon` |
| ------ | ----------------- | --------- |
| 500 m  | 2                 | **1**     |
| 5 km   | 3                 | **2**     |
| 20 km  | 4                 | **3**     |

The difference is the seeded **draft** job, which sits at the same coordinates
as a published one. It appears for `service_role` (which bypasses RLS) and
**disappears for `anon`** at every radius. That gap is the evidence that
`nearby_jobs` being `SECURITY INVOKER` actually matters — as `SECURITY DEFINER`
it would have leaked drafts.

**Isolation, using a third account (C) party to nothing:**

| Probe as C                      | Expected | Actual |
| ------------------------------- | -------- | ------ |
| messages visible                | 0        | **0**  |
| offers visible                  | 0        | **0**  |
| published jobs visible          | 3        | **3**  |
| draft jobs visible              | 0        | **0**  |
| `job_exact_location` on A's job | 0        | **0**  |
| profiles visible                | 3        | **3**  |

**Write attempts as C:**

| Attempt              | Result                                             |
| -------------------- | -------------------------------------------------- |
| forge a message as A | **rejected** — `42501 new row violates RLS policy` |
| update A's profile   | 0 rows                                             |
| update A's job       | 0 rows                                             |
| delete A's job       | 0 rows                                             |
| update B's offer     | 0 rows                                             |

Note the two failure modes: a bad INSERT raises, while a bad UPDATE/DELETE
silently affects zero rows. Client code must treat "0 rows affected" as a
permission failure, not as success.

**Counter-test — legitimate parties can still work.** A policy that denies
everyone would pass every test above, so:

| Probe                            | Expected | Actual |
| -------------------------------- | -------- | ------ |
| B sees own thread                | 1        | **1**  |
| B sees own offer                 | 1        | **1**  |
| A sees own thread                | 1        | **1**  |
| A sees offers on own job         | 1        | **1**  |
| A sees own draft                 | 1        | **1**  |
| A sees all own jobs              | 4        | **4**  |
| A gets exact location of own job | 1        | **1**  |

**The exact-location gate, end to end** — the privacy mechanism that matters
most:

1. B's offer `pending` → `job_exact_location` returns **0 rows**
2. A accepts B's offer
3. B → **1 row, 43.6532 / -79.3832** (the true point)
4. C, after that acceptance → still **0 rows**

So the exact address is released only to the accepted worker, and only once
accepted.

### Test data currently in the database

3 auth users, 4 jobs, 1 accepted offer, 1 message, 0 reviews. Left in place as
fixtures for the phase 3 screens.

Two caveats:

- The users were inserted **directly via SQL**, so they have no `auth.identities`
  rows and may not sign in through the auth API. Create real accounts through
  the app for auth testing.
- They have **known passwords** (`test-password-a` / `-b` / `-c`). Acceptable in
  a prototype; they must not survive into anything real.

`supabase/tests/seed_test_data.sql` can recreate equivalent fixtures after a
reset — update the UUIDs at the top first.

### Not verified

- **`get_advisors`** (Supabase's own security linter) is refused by the current
  token — it needs a Project-level scope this PAT lacks. An independent
  second opinion on the schema is therefore still outstanding; add the scope and
  re-run if you want it.
- **Auth round-trip through the client SDK** — `signUpWithEmail` /
  `signInWithEmail` have still never been called. `.env` is now populated, so
  this is doable, but it needs UI or a scratch script and belongs with phase 3.
- **Realtime** is not enabled on any table.
- The MCP token used for all of this is in the session transcript and should be
  rotated when prototype work ends.

---

## 2026-09-15 — Phase 3: auth & onboarding screens

First phase with screens a person can actually use, so most of what matters is
manual. Earlier sections unchanged.

### Verified automatically

| Check                        | Command                              | Result                                          |
| ---------------------------- | ------------------------------------ | ----------------------------------------------- |
| TypeScript, strict, no `any` | `npm run typecheck`                  | passes, 0 errors                                |
| ESLint                       | `npm run lint`                       | passes, 0 errors/warnings                       |
| Prettier                     | `npm run format:check`               | all files formatted                             |
| Android bundle               | `npx expo export --platform android` | **1340 modules** (was 1223)                     |
| Migrations 0008, 0009        | `apply_migration`                    | both applied, first attempt                     |
| Sign-up trigger path         | live SQL                             | name + postal code carried, FSA derived         |
| Postal code privacy          | live SQL, impersonated               | FSA readable, full code `42501` denied          |
| Avatar storage RLS           | live SQL, impersonated               | cross-folder write rejected, own-folder allowed |
| FSA derivation               | live SQL                             | `M5V 2T6` → `M5V`, `M4K1N2` → `M4K`             |

**The module count is meaningful this time.** In phase 2 the bundle stayed at
1223 because nothing imported `src/services` — that run proved nothing. Now
`RootNavigator` imports the screens, which import the hooks and services, so
1340 modules means TanStack Query, `expo-image-picker`, `supabase-js`, `aes-js`
and SecureStore all resolve and are reachable from the entry point.

### A type-system bug worth recording

`updateMyProfile` would not compile: `Argument of type 'ProfileUpdate' is not
assignable to parameter of type 'never'`. Two causes, stacked, and both produce
the same unhelpful `never`:

1. **`messages: { Update: never }`.** supabase-js's `GenericTable` requires
   `Update: Record<string, unknown>`. `never` fails that constraint, which
   invalidates the whole schema and collapses `Update` to `never` for **every
   table** — the error surfaced on `profiles`, which was fine. Changed to
   `Record<string, never>`: still permits no properties, but satisfies the
   constraint.
2. **The row types were `interface`, not `type`.** TypeScript gives implicit
   index signatures to type aliases but **not** to interfaces, so no `interface`
   satisfies `Record<string, unknown>`. This is exactly why Supabase's generated
   types use `type`. All 17 declarations in `database.ts` were converted.

Diagnosed with a throwaway type probe asserting each table against a local copy
of `GenericTable` — all seven assertions failed, which pointed at the shared
cause rather than at `profiles`. Guessing at `Relationships: []` first did not
help and was a wasted step.

**For later phases:** keep `src/types/database.ts` using `type`, never
`interface`, or `.update()` silently becomes uncallable across the app.

### Manual testing — please run these

`.env` is populated and the schema is live, so this should work end to end.
Start with `npx expo start --clear` (env vars inline at build time) and open on
your phone.

**1. Sign up end to end, and confirm the row.**

Welcome → Sign up. Enter a name, a real-format email, a password of 8+
characters, and a postal code like `M5V 2T6`. Then verify in the dashboard
(Table Editor → `profiles`, or SQL editor):

```sql
select id, display_name, postal_code, postal_fsa, bio, avatar_url, created_at
from public.profiles order by created_at desc limit 1;
```

Expect `display_name` to match what you typed, `postal_code` stored as you
entered it, and **`postal_fsa` to be the first three characters**. `bio` and
`avatar_url` will be null until you complete onboarding.

Note: nothing in the app writes that row — the database trigger does, from the
sign-up metadata. If `display_name` is null, the metadata did not arrive; if
`postal_fsa` is null but `postal_code` is set, the FSA trigger did not fire.
Those are two different failures.

**2. Postal code validation.** Try `12345`, `ZZZ 999`, and `D1A 1A1` (D is never
used by Canada Post). All three should be rejected inline before submission,
with the field showing an error rather than the form failing.

**3. Wrong password.** Log in with a correct email and a wrong password. Expect
_"That email and password combination does not match an account."_ — no crash,
no red box.

**4. Unknown email.** Log in with an address that has no account. Expect **the
same message, word for word.** That is deliberate: a different message would let
anyone test whether an address is registered. If you see a distinct "no such
user" error, that is a regression.

**5. Complete your profile.** After sign-up you should land on "Complete your
profile", not Home.

- **Add a photo** → permission prompt → pick an image. Confirm the avatar
  updates. Then check Storage → `avatars`: the file must be at
  `{your-user-id}/avatar.{ext}`, not at the bucket root.
- Type a bio, **Save and continue** → lands on Home. Re-query `profiles` and
  confirm both `bio` and `avatar_url` are set.
- **Try a large image** (over 5 MB — a screenshot of a long page, or a burst
  photo). Expect _"That image is N.N MB. Please choose one under 5 MB."_
  **before** any upload progress appears.
- **Skip for now** should also reach Home, leaving both fields null.

**6. Force-quit and reopen — session persistence.** The stated test for this
phase.

- While signed in, fully force-quit the app (swipe away from the app switcher;
  do **not** just background it).
- Reopen. Expect a brief spinner, then **Home directly** — no welcome screen,
  no re-login. The spinner is the session being decrypted from SecureStore +
  AsyncStorage.
- **Watch specifically for a flash of the Welcome screen.** `RootNavigator`
  holds the spinner until the session resolves precisely to prevent that; if you
  see the auth stack appear and then vanish, that guard has regressed.
- Now sign out and force-quit again. Reopening should show **Welcome**, not
  Home.

**7. Onboarding is not re-shown.** Force-quit and reopen after completing a
profile. You should land on Home, because `needsOnboarding` is derived from the
profile row (photo or bio present) rather than a local flag — so it survives a
reinstall too.

### Known gaps

- **No screen has been run on a device by me.** All screen verification above is
  yours; what I verified is that it compiles, bundles, lints, and that the
  database half behaves correctly under impersonation.
- **The auth API round-trip has never executed.** Every database test used
  direct SQL inserts into `auth.users`. `signUpWithEmail` and `signInWithEmail`
  have still never been called against GoTrue, so the metadata hand-off is
  verified at the _trigger_ end but not at the _client_ end. Step 1 is the first
  real test of that.
- **Email confirmation state is unknown.** I could not read the project's auth
  settings with this token. If "Confirm email" is ON, sign-up will show _"Check
  your email for a confirmation link"_ and will not enter the app — that is
  handled, not a bug. Turn it off in the dashboard for smoother testing.
- **Still no automated test runner.** Steps 3, 4 and 6 are exactly the
  regression tests that should be automated first.
- **No HEIC test.** The MIME allow-list includes it, but iOS HEIC uploads have
  not been exercised — worth checking on an iPhone with HEIC capture enabled.
- **The 3 SQL-created test users cannot sign in** through the auth API (no
  `auth.identities` rows). Use a freshly signed-up account for steps 3–7.

---

## 2026-09-18 — Phase 3 audit: three fixes, and corrections to the tests above

A verification pass over phase 3. The manual steps in the previous section are
still the right ones to run, but **two of them asserted the wrong thing** — see
"Corrections" below before using them.

### Verified automatically

- `npx tsc --noEmit` — clean.
- `npx eslint .` — clean.
- `npx prettier --check .` — clean.
- `grep` over `/src` for `console.*`, Sentry and analytics calls — no hits.
- `grep` over `/src` for `: any` / `as any` — no hits.
- Git hygiene before the first commit: 68 files staged, confirmed to exclude
  `node_modules/`, `.env` and `.expo/`.

### Verified against the live database

- **All ten migrations are applied**, including `0009_avatars_storage_bucket`,
  whose file was missing from the repo and has been restored. See SECURITY.md.
- **The `avatars` bucket** is public with `file_size_limit = 5242880` and the
  four-MIME allow-list, and carries four owner-scoped policies on
  `storage.objects`.
- **All three triggers are live**: `on_auth_user_created` on `auth.users`,
  `profiles_derive_postal_fsa` and `profiles_touch_updated_at` on
  `public.profiles`. The deployed body of `app.handle_new_user` matches the
  migration rather than an older version.
- **Column grants match `PROFILE_COLUMNS`** in `/src/services/profiles.ts`, and
  `postal_code` is genuinely not SELECT-able by `authenticated`.
- **The canonicalisation trigger was exercised, not just read.** Wrote
  `m4k1n2` to a test row; it came back `M4K 1N2` with `postal_fsa = M4K`. The
  row was restored to its previous value afterwards.
- **The backfill worked.** Every non-null `postal_code` in the table is now in
  the spaced form; before this pass, sign-up-created rows were `M5V2T6` and
  seeded rows were `M5V 2T6`.

### A real bug the previous section's own tests would have caught

Step 5 said _"Skip for now should also reach Home, leaving both fields null"_,
and step 7 said onboarding is not re-shown after a restart. **Both could not be
true at once.** Onboarding was inferred from "no photo and no bio", so a user
who skipped left no trace and was returned to the screen on every cold start,
forever. Fixed in migration 0010 with an `onboarded_at` column that both Save
and Skip now write.

Worth noting how it slipped through: each step was individually plausible, and
the contradiction only appears when you run step 5 and step 7 _in sequence with
the same account_. Test steps that share state need to be read as a sequence.

### Corrections to the phase 3 manual tests

Use these in place of what the previous section says:

- **Step 1 — `postal_code`.** It said to expect the code "stored as you entered
  it". That was never true and is now deliberately not true: the trigger
  canonicalises to `M5V 2T6` regardless of spacing or case. Enter `m5v2t6` and
  expect `M5V 2T6` back. `postal_fsa` should be `M5V`.
- **Step 5 — Skip for now.** It should reach Home _and_ set `onboarded_at`.
  Re-query and confirm the column is non-null while `bio` and `avatar_url` stay
  null. That combination is the whole point of the column.
- **Step 6 — signing out.** It said "now sign out and force-quit again". **There
  is no sign-out in the app yet** (see the interim method below).

### Interim sign-out, until phase 4

`signOut()` exists in `/src/services/auth.ts` but nothing calls it, because the
only signed-in screen is the phase-1 placeholder Home, which was out of scope.
A sign-out control lands in phase 4. Until then, to get back to the auth stack
you must clear the app's stored session from outside the app:

- **Expo Go, either platform:** long-press the Yoodle entry in Expo Go's
  project list and clear its data, or delete and re-add the project. Simplest
  reliable option: delete Expo Go's app data entirely.
- **Android (Expo Go or a dev build):** Settings → Apps → _Expo Go_ (or
  _Yoodle_) → Storage → **Clear storage**. Not "Clear cache" — the session lives
  in AsyncStorage and the Keychain/Keystore, which only "Clear storage" removes.
- **iOS:** delete the app and reinstall. iOS has no per-app storage reset, and
  note that **Keychain entries can survive a reinstall**, so if you still land
  on Home after reinstalling, that is the SecureStore half persisting — expected,
  not a bug.

This clears the ciphertext and the AES key together, so the next launch reads no
session and shows Welcome.

### New manual tests for this pass

**A. Skip persists.** Sign up a fresh account → land on "Complete your profile"
→ **Skip for now** → Home. Force-quit, reopen. **Expect Home, not onboarding.**
This is the fix; before it you would have seen the onboarding screen again.

**B. Skip survives a failed write.** Harder to stage, but worth knowing the
intent: if the `onboarded_at` write fails (turn off wifi just before tapping
Skip), you should **still reach Home**. The cost is being asked again next
launch. Nobody should ever be trapped in onboarding.

**C. Photo with no metadata.** The case that motivated the validation change.
On iOS, grant Yoodle **limited** photo access rather than full ("Select
Photos…" → pick a couple). Then add a photo. It should **upload normally**.
Previously this could fail with "Could not read that file's size. Please pick
another." — advice that no other photo would have satisfied.

**D. Oversized photo, still rejected.** Unchanged behaviour, but re-test it
after the validation change: pick an image over 5 MB and expect the "That image
is N.N MB" message _before_ any upload progress. If the picker gave no file
size, the rejection instead arrives a moment later, from the byte-length check
after the file is read — either is correct, and Storage would reject it anyway.

**E. Mixed-case postal code.** Sign up with `m5v2t6` (no space, lowercase).
Expect `M5V 2T6` in the row.

### Known gaps

Carried forward, plus changes:

- **No screen has still been run on a device by me.** Everything above is either
  a static check or a live SQL check. All screen behaviour is yours to verify.
- **The auth API round-trip has still never executed from the app.** There are
  now two sign-up-created rows in `profiles` (`display_name = 'yoodle'`) that
  did not come from SQL, which suggests sign-up has been exercised at least
  once — but not by me, and not observed end to end.
- **`get_advisors` is still unavailable.** Run it first once the PAT scope is
  widened, before phase 4 adds tables.
- **Still no automated test runner.** Now more pressing: this pass found a
  contradiction between two written test steps, which a runner would have
  surfaced the first time both were run in sequence.
- **No HEIC test.** Unchanged.
- **Test C needs a real iPhone** with limited photo permission; it cannot be
  staged in a simulator or on Android in the same way.
- **The 3 SQL-created test users still cannot sign in** through the auth API.
  Use a freshly signed-up account.

---

## 2026-09-18 — Phase 4: job browsing

### Verified automatically

- `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .` — all exit 0.
- **`npx expo export --platform ios` succeeds**, 1394 modules. This is the check
  that matters for a phase that adds two native modules: it proves
  `react-native-maps` and `expo-location` actually resolve in the bundle, not
  just in the type checker.

### Verified against the live database

All of the following ran as SQL against the real project, most of it while
impersonating a signed-in user rather than as an admin.

**Radius filtering is exact.** With a 10 km radius from 43.65,−79.38 the
returned set stops at the job seeded at 8.89 km. The jobs at 11.11 km, 16.68 km
and 38.9 km are absent, as is `Dog walking in Scarborough` at ~11.2 km.

**Pagination neither duplicates nor skips.** Three pages of 20 over 52 in-range
jobs: 20 + 20 + 12 = 52 returned, 52 distinct, 0 in-range rows missing from the
pages, 0 rows returned from outside the radius, and page 4 empty. This ran
against a deliberately hostile fixture — 45 jobs at one identical coarse point,
so every page boundary falls inside a group of tied distances.

**The caps bind.** `p_limit` 9 999 → 50 rows; 0 and −5 → 1 row. `p_offset`
99 999 → 0 rows. `p_radius_meters` 9 999 999 → clamped to 50 km; 1 → clamped to
500 m. The limit ceiling only becomes meaningful once the fixture exceeds 50
in-range rows, which is why the tie cluster is 45 rather than 5.

**Wildcards are escaped.** Searching `%` → 0 rows. Searching `_` → 0 rows. A
normal search still works and is case-insensitive (`SHOVEL` → 1).

**Drafts do not leak.** Impersonating the poster who owns the drafts:
`nearby_jobs` → 2 drafts, `browse_jobs` → 0. See SECURITY.md.

**The exact location is unreachable.** Impersonating a signed-in
non-participant: `select location from public.jobs` → _permission denied for
table jobs_; `job_exact_location(...)` → 0 rows; `browse_jobs(...)` → 50 rows.
Browsing works while the address stays shut.

### Test data

`supabase/tests/seed_browse_jobs.sql` — idempotent, re-runnable, and it only
touches rows whose title starts with `Seed `. It has already been applied.

Every seeded point sits exactly on the 2-decimal-place grid, so the coarse
rounding is a no-op and the distances below are the distances the app will
show. Seeding at an arbitrary coordinate would round it and move the job by up
to ~800 m, which would make a radius test unreadable.

| Seeded job                       | Distance from 43.65,−79.38 | In the default 10 km radius? |
| -------------------------------- | -------------------------- | ---------------------------- |
| `Seed 000m - same block`         | ~0 m                       | yes                          |
| `Seed tie 01` … `Seed tie 45`    | 1.11 km (all identical)    | yes                          |
| `Seed 1.1km - one grid north`    | 1.11 km                    | yes                          |
| `Seed 2.2km - two grids`         | 2.22 km                    | yes                          |
| `Seed 5.6km - five grids`        | 5.56 km                    | yes                          |
| `Seed 8.9km - inside 10km`       | 8.89 km                    | yes — the last one in        |
| `Seed 11.1km - outside 10km`     | 11.11 km                   | **no**                       |
| `Seed 16.7km - well outside`     | 16.68 km                   | **no**                       |
| `Seed 38.9km - far outside`      | 38.9 km                    | **no**                       |
| `Seed DRAFT - must never appear` | 1.11 km                    | **no** — unpublished         |

Totals: 56 published jobs, 52 of them within 10 km of the reference point.

### READ THIS FIRST: the seeded jobs are in Toronto

The browse radius is centred on **your device's GPS position**, not on your
profile's postal code. If you are not physically near 43.65,−79.38 then **every
test below will show an empty list** — correctly, because there genuinely are
no jobs near you.

If you are not in downtown Toronto, move the fixture to you first. Get your own
coordinates from any maps app, round them to 2 decimal places, and edit only
the first line of this:

```sql
with me as (select 43.65::float as lat, -79.38::float as long)  -- <-- YOUR rounded lat/long
update public.jobs j
   set location = extensions.st_setsrid(
         extensions.st_point(
           extensions.st_x(j.location::extensions.geometry) + (me.long - (-79.38)),
           extensions.st_y(j.location::extensions.geometry) + (me.lat  -   43.65)
         ), 4326)::extensions.geography
  from me
 where j.title like 'Seed %';
```

It shifts the whole fixture by the offset between the Toronto centre and yours,
so every relative distance in the table above stays intact. Re-running
`seed_browse_jobs.sql` puts the Toronto originals back.

### Manual testing — please run these

Start with `npx expo start --clear` and open on your phone.

**1. Location permission.** First launch of the new Home screen prompts for
location. Expect the prompt to mention that your position is rounded to about a
kilometre — that string lives in `app.json`, so a generic "Allow Yoodle to use
your location" instead means the plugin config did not apply.

- **Deny it.** Expect an explanation and a **Try again** button — not an empty
  list, not a crash. There is deliberately no manual-entry fallback yet.
- **Grant it**, then tap Try again. The list should populate.

**2. Radius.** With the fixture centred on you, scroll the whole list. Expect
`Seed 8.9km - inside 10km` to be present and the 11.1 km, 16.7 km and 38.9 km
jobs to be absent. The footer should read _"That's everything within 10 km."_

**3. Pagination.** The one worth doing carefully.

- Scroll to the bottom. A spinner should appear and ~20 more jobs load.
- Keep going until the footer message appears. You should reach **52 jobs**.
- **Watch the `Seed tie NN` numbers as you cross each page boundary.** They all
  sit at an identical distance, which is exactly where offset pagination breaks
  if the ordering is not a total order. Every number 01–45 should appear
  **once**. A repeat, or a gap, is the bug the ordering exists to prevent.

**4. Empty state.** The list is empty when nothing is near _the phone_, so a new
account alone will not produce it — the account is not what the radius keys on.
The reliable way is to hide the jobs:

```sql
-- Hide everything, check the app, then put it back.
update public.jobs set status = 'draft' where status = 'published';
```

```sql
-- Restore afterwards.
update public.jobs set status = 'published'
 where title like 'Seed %' and title not like '%DRAFT%';
```

Pull to refresh in the app between the two. Expect **"No jobs near you yet"**
with the _"Nobody within 10 km has posted an open job"_ subtitle, and **no Clear
filters button** — that belongs only on the filtered empty state.

Then check the other empty: with jobs restored, search for `zzzzz`. Expect
**"Nothing matches those filters"** _with_ a Clear filters button. Getting these
two the wrong way round would send someone hunting for a control that cannot
help them.

**5. Search and categories.**

- Type `shovel`. The list should narrow when you stop typing, not on every
  keystroke — there is a 300 ms debounce.
- Type `%`. Expect **no results**, not every job. This is the wildcard escaping.
- Tap a category chip, then tap it again to deselect. The counts on the chips
  should match what the filtered list actually contains.
- Combine a category with a search term; both should apply.

**6. Map view.** Tap **Map**.

- Expect pins at neighbourhood positions. The 45-job cluster should be a single
  pin reading **"45 jobs in this area"**, not 45 stacked pins — locations are
  rounded to ~1 km, so many jobs genuinely share a coordinate.
- Tap that pin's callout → it should switch back to the list.
- Tap a single-job pin's callout → it should open that job's detail screen.
- Sanity-check the privacy claim: no pin should sit on a plausible street
  address. They should all land on a rounded grid.

**7. Job detail.** Tap any job.

- Expect title, category, budget, description, and the poster's name, photo,
  bio and FSA ("M5V area").
- **There should be no map and no address anywhere on this screen.**
- The **Apply** button is disabled by design.

**8. Sign out.** The control is on Home, top right. This closes the interim
storage-clearing workaround documented last phase.

- Tap it → you should land back on Welcome.
- Sign in as a different account → you should **not** see a flash of the
  previous account's job list or profile, because the query cache is cleared on
  sign-out.

### Known gaps

- **Still no screen run on a device by me.** Everything above is a static check,
  a bundle check, or a live SQL check.
- **The map is untested on Android**, which needs a Google Maps API key for any
  build outside Expo Go. On iOS it uses Apple Maps and needs nothing.
- **`npm run web` will not render the map.** `react-native-maps` ships no web
  entry point, so importing it under the web bundler is expected to fail. Web
  was never part of the verified testing route; noted so the failure is not
  mistaken for a regression.
- **The empty state cannot be tested by account**, only by moving the phone or
  unpublishing the fixture. That follows from keying the radius on GPS.
- **`get_advisors` still unavailable.** Two new functions this phase, still
  unlinted.
- **Still no automated test runner.** Step 3 is a hand-run version of something
  that should be a query-level regression test — it is exactly the kind of
  ordering bug that comes back silently.
- **The >500 offset behaviour is untested in the app.** The cap is verified in
  SQL, but reaching it through the UI needs more than 500 in-range jobs.

---

## 2026-09-19 — Phase 4 follow-up: cleanup, and a fixture purge you must not skip

### Purging fixture data — REQUIRED before any real signup

**Read this before you invite anyone, build for store review, or demo the app.**

The project database currently contains **56 published fixture jobs**, all
owned by test accounts, all clustered on downtown Toronto, plus test profiles
with known passwords created by raw SQL in phase 2. In the UI a fixture job is
indistinguishable from a real one. A first real user would open Yoodle and find
a neighbourhood full of listings nobody will ever respond to.

This is tracked in SECURITY.md as a **release blocker**, not a tidiness item.

**Step 1 — see what is fixture.** Everything seeded by this project is
identifiable:

```sql
select
  count(*) filter (where title like 'Seed %')                    as browse_fixtures,
  count(*) filter (where title in (
    'Shovel my driveway','Assemble a bookshelf',
    'Dog walking in Scarborough','Draft job - should stay hidden'))as phase2_fixtures,
  count(*)                                                        as all_jobs
from public.jobs;
```

If `browse_fixtures + phase2_fixtures` is less than `all_jobs`, **stop** —
something real is in there and the blanket delete below is wrong.

**Step 2 — remove fixture jobs.**

```sql
delete from public.jobs
 where title like 'Seed %'
    or title in ('Shovel my driveway','Assemble a bookshelf',
                 'Dog walking in Scarborough','Draft job - should stay hidden');
```

**Step 3 — remove the test accounts.** Deleting from `auth.users` cascades to
`public.profiles` via the foreign key, and on to their jobs, offers, messages
and reviews.

```sql
-- Check the list first. Do NOT run the delete without reading this output.
select id, email, created_at from auth.users order by created_at;
```

```sql
delete from auth.users where email in ( /* ...the test addresses from above... */ );
```

The three phase-2 accounts (`Account A`, `Account B`, `Account C (outsider)`)
and `Dana Onboard` were created by SQL and have known passwords. The two
`yoodle` profiles came from real sign-ups through the app. All of them are test
data.

**Step 4 — confirm empty.** `select count(*) from public.jobs;` should be 0, and
the app should show **"No jobs near you yet"**, which doubles as a live check of
the unfiltered empty state.

**Step 5 — rotate the MCP PAT** (SECURITY.md), since it has been in transcripts.

### `nearby_jobs` removed — what changed for testing

Migration `0012` drops `public.nearby_jobs`. Nothing in the app used it.

Three ground-truth queries at the bottom of `supabase/tests/seed_test_data.sql`
did, and they have been rewritten to query `public.jobs` directly with
`ST_DWithin`/`ST_Distance`. That is deliberate rather than switching them to
`browse_jobs`: those checks exist to prove the draft row _is_ present for the
service role, and `browse_jobs` filters drafts by design, so running them
through it would have quietly defeated the test.

Verified after the drop: the 500 m ground-truth query still returns exactly the
two expected rows (`Shovel my driveway` and `Draft job - should stay hidden`, both
439 m), and `public` now exposes exactly three functions — `browse_jobs`,
`nearby_job_categories`, `job_exact_location`.

### The design system gallery is back, on a dev-only route

Phase 4 replaced the phase-1 placeholder Home with the real job browser, which
removed the only screen where every component is rendered together against the
real palette. That gallery is the thing that makes a contrast or spacing
regression visible, so it has been restored as
`src/screens/DesignSystemScreen.tsx` — the phase-1 body carried over unchanged.

**How to reach it:** in a dev build, a small `▦` button sits to the left of
**Sign out** in the Home header. Tap it.

**Why it is not a shipped feature:** both the route registration in
`MainNavigator` and the button in `HomeScreen` are wrapped in `__DEV__`. In a
release bundle the route does not exist, so there is nothing to deep-link or
guess into — it is absent rather than merely unlinked. If you want to confirm
that, the check is that `__DEV__` appears in both files.

When you run the contrast re-audit from the 2026-09-14 section, this is the
screen to run it against.

### Verified automatically after these changes

- `npx tsc --noEmit` — exit 0. This also confirms nothing still references the
  deleted `NearbyJobRow` type or the `nearby_jobs` entry in `Database`.
- `npx eslint .` — exit 0.
- `npx prettier --check .` — exit 0.

### Security audit run as SQL

`get_advisors` is still refused, but the underlying lint rules were run
directly against the catalog — RLS coverage, function `search_path`, definer
views, extension placement, primary keys, and what `anon` can reach. Results and
the one finding are in SECURITY.md under the 2026-09-19 entry. Summary: RLS,
search_path, views and extensions are all clean; `anon` retains Supabase's
default blanket table grants, of which **TRUNCATE is not covered by RLS**.

Re-run that audit when phase 5 adds tables — new tables inherit the same
defaults.

### Still to do by hand (unchanged from the phase 4 entry)

The phase 4 manual tests have not been superseded and still need running:
the Toronto fixture setup, the pagination tie-break, location-permission denial,
wildcard search, and map clustering. Nothing in this follow-up changes how any
of them behave — the only user-visible difference is the extra dev-only `▦`
button in the Home header.

---

## 2026-09-19 — `anon` grants revoked: what to re-check

Migration `0013` revoked Supabase's default table grants from `anon`. Full
detail in SECURITY.md; what matters for testing is that it touches the
privileges `browse_jobs` depends on, so a mistake here would break browsing for
signed-out visitors rather than fail loudly at migration time.

**Already verified as the `anon` role**, after applying: `browse_jobs(...)` →
50 rows, `nearby_job_categories(...)` → 5, published jobs readable → 56, and
TRUNCATE/DELETE/INSERT/TRIGGER/REFERENCES all denied on all five tables.

**Nothing changes for the app's own manual tests.** Yoodle always has a session
on the main stack, so every screen runs as `authenticated`, which this migration
did not touch. The phase 4 manual tests stand exactly as written.

**Re-run the audit query after phase 5 adds tables.** New tables created by
`postgres` will no longer inherit `anon` grants, but this is worth confirming
rather than assuming:

```sql
select t.table_name,
       has_table_privilege('anon', 'public.'||t.table_name, 'TRUNCATE') as anon_truncate,
       has_table_privilege('anon', 'public.'||t.table_name, 'INSERT')   as anon_insert,
       has_table_privilege('anon', 'public.'||t.table_name, 'DELETE')   as anon_delete
from information_schema.tables t
where t.table_schema='public' and t.table_type='BASE TABLE'
order by t.table_name;
```

Every column should read `false`. Any `true` means a table was created by a
role whose default privileges still grant `anon` — see the limitation noted in
SECURITY.md.

---

## 2026-09-19 — Phase 5: posting, editing and cancelling

### Verified automatically

- `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .` — all exit 0.
- `npx expo export --platform ios` — 1411 modules, so `expo-image-manipulator`
  resolves in the bundle.
- **13 assertions against the real sanitiser.** `src/services/sanitize.ts` was
  compiled and executed, not eyeballed: bidi override stripping, zero-width
  stripping, C0 controls, newlines kept in descriptions and collapsed in titles,
  blank-line collapsing, space collapsing, trimming, NFC normalisation,
  truncation at 140, an all-invisible title collapsing to empty, and HTML
  surviving untouched. All pass.

### Verified against the live database

Each of these ran inside a transaction and was rolled back, so none of it is
still in the data.

- **Rate limit.** 10 jobs inserted for one poster succeed; the 11th within the
  hour is rejected by `app.enforce_job_post_rate_limit`.
- **Photo path ownership.** A `photo_paths` entry under another user's uid is
  rejected; the poster's own is accepted.
- **Photo count.** A fourth photo is rejected by `jobs_photo_paths_max`.
- **Description ceiling.** 4001 characters is rejected by
  `jobs_description_length`.
- **Cancel semantics — the phase's headline test.** A published job in browse
  results, set to `cancelled`, disappears from `browse_jobs` while the row
  remains with `status = 'cancelled'`. Nothing is deleted.

### Heads-up: the seed script and the new rate limit

`supabase/tests/seed_browse_jobs.sql` inserts 54 rows for one poster, which the
10-per-hour trigger would now block. The script disables `jobs_rate_limit` for
its own transaction and re-enables it before commit. If you ever interrupt that
script mid-run, **check the trigger is back on**:

```sql
select tgname, tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid
where c.relname = 'jobs' and t.tgname = 'jobs_rate_limit';
```

`tgenabled` should be `O`. If it is `D`, re-enable it:
`alter table public.jobs enable trigger jobs_rate_limit;`

### Manual testing — please run these

**1. Inline validation, the spec's case.** Post a job → tap **Continue** with
everything blank.

- Expect inline errors under **Title** and **Category**. No alert, no crash, and
  the step does not advance.
- Fill the title, continue, then enter **0** as the budget → expect _"Please
  enter an amount greater than zero."_ under the field. Try `-5` and an empty
  budget too; all three should be caught inline.
- Now the case worth checking specifically: put a valid title in, advance to
  step 2, go **Back**, clear the title, then go forward and submit from step 3.
  You should be **returned to step 1** with the title error showing — the final
  submit validates the whole form, not just the visible step.

**2. Post a job end to end.** Complete all three steps with a real title,
category, budget, and the pin dragged somewhere recognisable. Add 1–3 photos.

- On submit you should land on the new job's **detail screen**, with your
  photos, title, budget and category.
- Confirm the row:

```sql
select id, title, category, budget, status, coarse_lat, coarse_long, photo_paths, created_at
from public.jobs order by created_at desc limit 1;
```

Expect `status = 'published'`, `photo_paths` holding 1–3 paths each starting
with your user id, and `coarse_lat`/`coarse_long` rounded to 2 decimal places —
**not** the exact spot you dropped the pin.

**3. It appears in Browse (P04) and My Jobs.** Go back to Home and pull to
refresh. The new job should be in the list, provided it is inside the 10 km
radius of where your phone is. Then open **My jobs** — it should be there with
an **Open** badge.

**4. Cancel it.** In My Jobs, tap **Cancel** → an inline confirmation appears on
that row (not an alert). Confirm.

- The badge becomes **Cancelled** and Edit/Cancel disappear for that row.
- Go to Home, pull to refresh: **the job is gone from Browse.**
- The row is still there:

```sql
select id, title, status from public.jobs where title = '<your title>';
```

Expect exactly one row, `status = 'cancelled'`. If it returns nothing, the job
was deleted and that is a bug.

**5. EXIF — the important one, and the only way to confirm the fix.**

Take a photo **outdoors with location services on** so the camera writes GPS
into it, then post a job using it. Find the stored path from step 2, download
it, and look for metadata:

```sh
curl -s -o photo.jpg "<the public URL from Storage → job-photos>"
# Any one of these:
exiftool photo.jpg                 # expect no GPS tags, minimal output
python -c "from PIL import Image; print(Image.open('photo.jpg')._getexif())"   # expect None
grep -c Exif photo.jpg             # expect 0
```

**Expect no GPS tags.** If GPS coordinates are present, the re-encode is not
stripping them and SECURITY.md's claim is still wrong — tell me and stop using
job photos until it is fixed.

Worth repeating the same check on an **avatar** uploaded today, since that path
was corrected in this phase too.

**6. Sanitised text survives a round trip.** In a description, paste something
with awkward characters — emoji, accented characters typed as combining marks,
and a few blank lines. Save, reopen the detail screen.

- Text should read the same, with runs of blank lines collapsed.
- Typing `<b>bold</b>` should display **literally as typed**, not as bold and
  not as `&lt;b&gt;`. That is deliberate; see SECURITY.md.

**7. Edit.** My Jobs → Edit. Change the title and budget, save. The detail
screen and Browse should both show the new values. Adding photos here
**replaces** the whole set — the screen says so before you save.

**8. Rate limit (optional, and it locks you out for an hour).** Post 10 jobs in
quick succession; the 11th should fail with _"You have posted a lot of jobs in
the last hour."_ Only do this on a throwaway account — there is no way to reset
it except waiting.

### Known gaps

- **EXIF stripping is inferred, not proven.** Test 5 is the check. Until it has
  been run, treat the claim as unverified.
- **Location is not editable when editing a job.** `SELECT` on `jobs.location`
  is revoked from clients, so the edit screen cannot read the current pin back
  to show it — and showing the coarse point instead would overwrite a real
  address with a rounded one on save. The screen says to cancel and repost to
  move a job.
- **Editing photos replaces all of them.** There is no per-photo delete, and the
  old objects are left in the bucket.
- **No photo cleanup anywhere.** Cancelled jobs keep their photos; replaced
  photos are orphaned. Storage only grows.
- **Description is optional.** Only title, category, budget and location are
  required. Say if it should be mandatory.
- **Still no screen run on a device by me**, and no automated test runner — the
  sanitiser assertions are a throwaway script, not a suite that runs in CI.
- **Fixture data still present.** The purge procedure from 2026-09-19 is still a
  release blocker, and now also covers `job-photos`.

---

## 2026-09-19 — Phase 5 review fixes: what to re-test

Six defects from the phase 5 review are fixed. Details and the security
reasoning are in SECURITY.md; these are the checks that changed.

### Re-test these

**A. Editing a job that cannot be fetched.** Open My Jobs, then kill your
network, then tap **Edit**. Expect an error message and a **Try again** button.
Previously this was a spinner that never resolved — the error branch below the
loading guard was unreachable.

**B. Replacing photos actually replaces them.** Edit a job that has photos, add
different ones, save, and reopen the detail screen.

- The NEW photos should show. If you still see the old ones, the cache fix has
  regressed.
- Check Storage → `job-photos` → `{your-uid}/{jobId}/`. Only the current batch
  should remain; the previous one should be gone.
- Then paste the URL of a removed photo into a browser. It should **404**.
  **This is the point of the fix** — a public bucket serves an orphaned file
  forever, so taking a photo off a listing has to delete the object, or the
  photo was never actually withdrawn.

**C. Posting when photos fail.** Turn airplane mode on immediately after tapping
**Post this job** (or pick a file that fails to process). Expect to STAY on the
form, with a visible warning and a **Continue to your job** button. Previously
the screen navigated away and the warning was set on an unmounting screen, so it
was never rendered and photos silently went missing.

**D. Small images are not upscaled.** Post a job using a small image (say
300×300). The stored file should stay about that size rather than being blown up
to 1600×1600. A portrait photo should come back with its LONGER side at 1600,
not its width.

Worth re-running the EXIF check from the phase 5 entry afterwards: the resize is
now conditional, and it is the re-encode that strips metadata. The re-encode
still runs for every image, including ones too small to resize — but that is
exactly the kind of thing worth confirming rather than assuming.

**E. A job with no budget can be edited.** Most test jobs have one, so make one
without:

```sql
update public.jobs set budget = null where title = '<one of your test jobs>';
```

Open it in Edit, change the title, save. It should save. Previously validation
rejected it on a field the user had never touched, making the job permanently
uneditable. An empty budget field is now accepted and clears the value.

**F. Duplicate photo selection.** In the photo picker, add the same image twice.
It should appear once, and removing it should remove it cleanly.

### Deferred, not fixed

- **`usePostingLocation` reports failure too early.** With GPS denied and the
  profile query still in flight it briefly says it could not find your
  location. Transient and self-correcting once the profile loads.
- **Over-long titles are silently truncated** at 140 characters rather than
  flagged, because sanitising runs before validation — so the over-length branch
  in `validateJobForm` is unreachable.

---

## 2026-09-19 — Phase 6: offers, chat and notifications

### Verified automatically

- `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .` — all exit 0.
- `npx expo export --platform ios` — 1424 modules.

### The realtime RLS test — an actual automated test, at last

`supabase/tests/realtime_rls_test.mjs`. Run it from the project root:

```sh
node supabase/tests/realtime_rls_test.mjs
```

It signs in three real accounts, creates a probe job, has two of them bid,
subscribes all three to the **whole** `messages` and `offers` tables with no
filter, then runs a private conversation past them. 13 assertions, all passing.
It cleans up its probe job afterwards (offers and messages cascade), so it is
safe to re-run.

**It found a real bug**, which is the point of writing it rather than reasoning:
`makeOffer` used a PostgREST upsert, which fails with _"permission denied for
table offers"_ even on a first bid, because an upsert needs UPDATE on `job_id`
and `worker_id` and migration 0004 revokes exactly those. Details in
SECURITY.md.

**It also had a bug of its own, worth knowing about if you extend it.** The
first version inserted the offers BEFORE subscribing, and the offer assertions
passed anyway — replication lag delivered them a moment late, so the test was
measuring timing, not authorisation. It now writes every asserted row after all
three subscriptions report `SUBSCRIBED`. If you add a case, keep it after that
barrier; a green test that passes by race is worse than no test.

### Test accounts for this phase

Created directly in `auth` because the signup email rate limit blocks the normal
path. All three are confirmed and can sign in:

| Email                     | Password           | Role in the tests                    |
| ------------------------- | ------------------ | ------------------------------------ |
| `p6-poster@yoodle.test`   | `Phase6Test!pass1` | posts the job, accepts/declines      |
| `p6-worker@yoodle.test`   | `Phase6Test!pass2` | bids and chats                       |
| `p6-outsider@yoodle.test` | `Phase6Test!pass3` | the third party who must see nothing |

These are now part of the purge procedure. Nothing with a known password should
survive into a build real people use.

### Manual testing — please run these

You need **two devices, or one device and one simulator**, signed in as the
poster and the worker. Expo Go on a phone plus a second Expo Go session works.

**1. Make an offer.** As the worker, open a job the poster owns → **Apply** →
enter an amount and an optional note → send.

- On your own job, the button should instead read **This is your job** and be
  disabled. That is not cosmetic: `offers_insert_own` refuses a bid on your own
  job, so the button would fail rather than do nothing.
- Try amount `0` — expect an inline error, not an alert.
- Send a second offer on the same job with a different amount. It should
  **amend** the existing offer rather than create a second one. Check:

```sql
select job_id, worker_id, amount, status from public.offers order by created_at desc limit 5;
```

One row per worker per job, with the new amount and `status = 'pending'`.

**2. Real-time messages, both directions — the headline test.** Put poster and
worker on the **Chat** screen for the same job, side by side.

- Send from the worker. It should appear on the poster's screen **without any
  refresh, pull-to-refresh, or navigation**. A second or two is realtime; ten
  seconds means something fell back to a refetch.
- Send from the poster. Same, in reverse.
- Background one device, send from the other, then foreground it. The message
  should be there — the thread refetches on mount, so realtime gaps heal.
- Watch the sender's own screen: their message should appear immediately on
  send, and must **not** appear twice when the realtime echo arrives.

**3. A third account cannot read the conversation.** The automated test proves
this at the SDK level; this is the version you can do by hand.

Sign in as `p6-outsider@yoodle.test` on a third session, bid on the same job so
they are a genuine party to it, then:

```sql
-- Confirm the messages exist at all.
select id, body from public.messages where job_id = '<the job id>';
```

The outsider's app must show **no trace** of the poster/worker conversation —
not in Notifications, not anywhere. To check it at the API level rather than the
UI level, run the automated test, which asserts exactly this with an unfiltered
subscription.

**4. Accept and decline.** As the poster, go to **Offers**.

- The worker's offer appears under _Offers on your jobs_.
- Tap **Accept**. The badge becomes **Accepted**.
- On the worker's device, their _Your offers_ entry should flip to **Accepted**,
  and a notification should arrive. If the worker's screen is open, the
  invalidation should update it without a manual refresh.
- Repeat with **Decline** on a second offer, and confirm the row still exists:

```sql
select id, amount, status from public.offers where job_id = '<the job id>';
```

Nothing should be deleted — declined offers stay so the worker can see what
happened.

- **Accepting takes no money.** Confirm nothing in the UI implies otherwise. If
  any copy reads like a payment was made, that is a bug worth fixing before
  payments land and make it ambiguous.

**5. Notification badge.** With the worker's app open on Home, send a message
from the poster.

- A count should appear next to **Alerts** without navigating.
- Open **Alerts** → the item is listed, and the badge clears.
- Force-quit and reopen: the list should be **empty**. That is by design — the
  feed is in memory only, so "since last opened" means since this launch.
- Sign out and back in as a different account: no notifications from the
  previous account should survive.

### Known gaps

- **Notifications do not survive a quit**, and there are no push notifications.
  Both are deliberate for this phase.
- **No block or report.** See SECURITY.md — logged as a launch blocker.
- **The worker's side of "Offers" is a list, not an inbox.** There is no
  conversation list; you reach a chat through an offer.
- **No typing indicators, read receipts or delivery state.** A message either
  appears or it does not.
- **The automated test needs the three `p6-*` accounts.** It fails at sign-in if
  they have been purged; recreate them with the SQL in this section's history or
  adapt it to your own accounts.
- **Still nothing run on a device by me.** The realtime test exercises the same
  client library the app uses, but not the app.
- **Fixture data and known-password accounts still present.** Release blocker.

---

## 2026-09-19 — Phase 6 review fixes: a second automated suite

Nine defects from the phase 6 review are fixed. The security reasoning is in
SECURITY.md; this covers the tests and what to re-check by hand.

### New: `offer_mutation_rules_test.mjs`

```sh
node supabase/tests/offer_mutation_rules_test.mjs
```

13 assertions against the live database as two real users, guarding migration 0016. It exists because three real holes were found — a worker re-pricing an
accepted offer, a poster rewriting the worker's note, and a poster changing the
worker's price — and because **payments will read `offers.amount` as the number
to charge.** If this suite fails, that number is not trustworthy.

What it asserts:

|                                                     |     |
| --------------------------------------------------- | --- |
| worker CAN amend a pending offer                    | ✓   |
| worker CANNOT re-price an accepted offer            | ✓   |
| worker CANNOT reopen an accepted offer              | ✓   |
| worker CANNOT accept or decline their own offer     | ✓   |
| worker CAN withdraw a pending offer                 | ✓   |
| worker CANNOT amend a withdrawn offer               | ✓   |
| poster CANNOT change the worker's price             | ✓   |
| poster CANNOT change the worker's note              | ✓   |
| poster CANNOT smuggle a price change into an accept | ✓   |
| poster CAN accept, with amount and note untouched   | ✓   |
| poster CANNOT decline an already-accepted offer     | ✓   |

It creates and deletes its own jobs, so it is safe to re-run.

### The realtime suite was flaky, and is not any more

`realtime_rls_test.mjs` failed once out of several runs — on timing, not on
authorisation. It used fixed 3-second sleeps, which are usually enough for a
Realtime round trip and occasionally are not.

**A security test that fails at random is one people learn to ignore**, so it
now polls for a condition with a deadline instead. It waits for the events that
are _supposed_ to arrive, then asserts the outsider received nothing — by which
point the outsider has had at least as long to receive anything they were going
to. Three consecutive clean runs after the change.

### Watch the posting rate limit when running these

Between them the two suites create four jobs per full cycle, all as
`p6-poster@yoodle.test`, and migration 0014 caps a poster at **10 jobs per
rolling hour**. Run both suites three times in quick succession and the next run
fails at job creation with _"Too many jobs posted in the last hour."_

That is the rate limit working, not a broken test. Wait, or use a different
poster account.

### Re-test by hand

**A. Amending an offer.** As the worker, offer on a job, then Apply again with a
different amount — it should amend. Then have the poster **accept**, and try to
amend again. Expect: _"You already have an offer on this job and it can no
longer be changed — it has been accepted, declined or withdrawn."_ Before this
fix the amend silently succeeded and reset the offer to pending.

**B. The poster is told when a bid changes.** Poster on the Offers screen,
worker amends their price from another device. The poster's list should update
and a notification should arrive, without a manual refresh. Previously the
poster saw the old amount indefinitely.

**C. No self-notifications.** Withdraw your own offer. You should get **no**
notification about it — only the poster should. Likewise, a poster accepting an
offer should not notify themselves.

**D. Repeated transitions each notify.** Have the poster decline an offer, the
worker re-bid, and the poster decline again. **Two** decline notifications
should appear. Previously the second was swallowed, because the notification id
was keyed on offer id plus status rather than on the write.

**E. The badge clears and stays cleared.** Open Alerts (badge clears) → tap into
a Chat → go back. With a message arriving in between, the badge should clear
again on return. Previously it stuck, because the screen stays mounted under a
pushed Chat and the mark-seen only ran on mount.

**F. Offer context failure is visible.** Hard to stage deliberately; the
behaviour to know is that a failed job/profile lookup on the Offers screen now
shows an error instead of silently rendering "A job" / "A neighbour" and hiding
the Message button.

### Known gaps carried forward

- Chat headers still read "The poster" / "Your neighbour"; only worker profiles
  are loaded into the offer context.
- `MakeOfferScreen` swallows a submit with no feedback in the brief window
  before the session resolves.
- Both automated suites need the three `p6-*` accounts, and both are covered by
  the purge procedure — which will break them. That is the right trade: nothing
  with a known password should survive into a build real people use.

---

## 2026-09-20 — Phase 7: payments

**Nothing in this phase has been run.** The Edge Functions are written but not
deployed, because the Supabase account's role returns 403 on the Management API
(the same block as `get_advisors`). Setup comes first, and it is all yours.

### Verified automatically

- `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .` — all exit 0.
- `npx expo export --platform ios` — 1493 modules, so `@stripe/stripe-react-native`
  and `expo-web-browser` resolve in the bundle.
- Migration 0017 applied, and the grants checked directly: `payments` grants
  SELECT and nothing else; the four Stripe id columns and `last_error` are
  ungranted; `has_column_privilege` on `profiles.stripe_account_id` is **false**
  for both `anon` and `authenticated`.

**Not** verified: the Deno functions are not typechecked (`deno` is not
installed here, and `supabase/functions` is excluded from the app's `tsc` — it
is a different runtime). `deno check supabase/functions/**/*.ts` before deploying
is worth the thirty seconds.

---

### Setup — do this first, in order

**1. Unblock the Supabase account.** Edge Function deploy and secrets need
Owner or Administrator on org `vkdjxnmgxfckctdlqrfn`. Until that is fixed
nothing below works.

**2. Turn on Stripe Connect.** Stripe dashboard → Connect → get started, in
**test mode**. Express accounts must be enabled.

**3. Set the secret key.**

```sh
supabase secrets set STRIPE_SECRET_KEY=sk_test_... --project-ref aovsfxypbdoppezlyjus
```

**4. Deploy the functions.** The webhook must have JWT verification OFF —
Stripe has no Supabase credentials and authenticates by signature instead.

```sh
supabase functions deploy stripe-connect-onboarding --project-ref aovsfxypbdoppezlyjus
supabase functions deploy stripe-authorize-payment  --project-ref aovsfxypbdoppezlyjus
supabase functions deploy stripe-release-payment    --project-ref aovsfxypbdoppezlyjus
supabase functions deploy stripe-webhook --no-verify-jwt --project-ref aovsfxypbdoppezlyjus
```

**5. Create the webhook endpoint.** Stripe dashboard → Developers → Webhooks →
Add endpoint:

```
https://aovsfxypbdoppezlyjus.supabase.co/functions/v1/stripe-webhook
```

Subscribe to: `payment_intent.amount_capturable_updated`,
`payment_intent.succeeded`, `payment_intent.payment_failed`,
`payment_intent.canceled`, `account.updated`.

**6. Set the signing secret** (shown once, when the endpoint is created):

```sh
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_... --project-ref aovsfxypbdoppezlyjus
```

Without it the webhook **fails closed** and returns 500 on every event. That is
deliberate, not a bug.

**7. Restart Expo** with `npx expo start --clear` — `EXPO_PUBLIC_*` values are
inlined at build time.

---

### Test cards

Any future expiry date, any 3-digit CVC, any postal code.

| Card                  | What it does                                           |
| --------------------- | ------------------------------------------------------ |
| `4242 4242 4242 4242` | succeeds                                               |
| `4000 0025 0000 3155` | **requires authentication** (3D Secure), then succeeds |
| `4000 0000 0000 0002` | declined — generic                                     |
| `4000 0000 0000 9995` | declined — insufficient funds                          |
| `4000 0000 0000 9987` | declined — lost card                                   |

For Connect onboarding in test mode, Stripe accepts placeholder data. Canada:

- SIN `000000000`
- phone `000 000 0000`
- any address; use a real-format postal code
- bank: transit `11000`, institution `000`, account `000123456789`
- Stripe's test onboarding also offers a "skip this step" shortcut on most pages

---

### The walkthrough

You need **two accounts** — the `p6-poster` and `p6-worker` accounts from phase 6
work. Poster and worker on separate devices or sessions.

**A. Worker sets up payouts.** As the worker: Home → **Payouts** → **Set up
payouts**. Stripe's hosted page opens in a browser. Complete it with the test
data above and return to the app.

- Status should become **Ready**. If it says _In review_, tap **Refresh status**
  — the flip depends on the `account.updated` webhook arriving.
- Confirm in the database that the worker's flag moved and that the app never
  saw the account id:

```sql
select display_name, stripe_payouts_enabled, stripe_details_submitted
from public.profiles where display_name like 'P6 %';
```

**B. Successful payment — the happy path.** Poster posts a job; worker offers on
it. As the poster: **Offers** → **Accept & pay** → Stripe's sheet opens →
`4242 4242 4242 4242`.

- The offer becomes **Accepted** and a **Held** badge appears.
- **Confirm the money is held, not taken.** In Stripe → Payments, the intent
  should read _Uncaptured_. The poster's card shows a pending authorisation, not
  a charge. This is the distinction the whole phase turns on.

```sql
select status, amount_cents, authorized_at, released_at
from public.payments order by created_at desc limit 1;
```

Expect `authorized`, with `authorized_at` set and `released_at` null.

**C. Release on completion.** As the poster: **My jobs** → **Mark complete &
pay**.

- Badge becomes **Released to worker**; the job becomes **Completed**.
- In Stripe: the payment is now _Captured_, and Connect → the worker's account
  shows a transfer for the full amount.

```sql
select status, released_at from public.payments order by created_at desc limit 1;
```

Expect `released` with `released_at` set. **Check the ordering held:** there
should be no window where the job reads completed while the payment is still
`captured` — the job is only marked complete after the transfer lands.

**D. Declined card.** New job, new offer, accept with `4000 0000 0000 0002`.

- Expect Stripe's own decline message inline, not a crash.
- The payment row should be `failed` or still `requires_payment_method`.
- **Tap Accept & pay again with a good card.** It must recover — the Edge
  Function reuses the existing PaymentIntent rather than creating a second hold.
  Check Stripe shows **one** intent for that offer, not two.

**E. Card requiring authentication.** Accept with `4000 0025 0000 3155`. Stripe
shows a 3D Secure challenge; complete it. The payment should end `authorized`
exactly as in B. Then **cancel** the challenge on another attempt and confirm the
app reports it cleanly and leaves no extra hold.

**F. Double-tap — no double charge.** The spec's case, and the one worth being
fussy about.

- Tap **Accept & pay** twice in rapid succession on a pending offer.
- Better: put the device in airplane mode after the first tap so the response is
  lost, then retry.
- **Expect exactly one PaymentIntent** in Stripe for that offer, and exactly one
  row:

```sql
select offer_id, count(*) from public.payments group by offer_id having count(*) > 1;
```

Must return **no rows**. Any row here is a double-charge bug and payments should
not ship.

**G. A worker without completed onboarding cannot be paid.** Use a third account
that has NOT done payout setup (`p6-outsider` works).

- Have them offer on a job; accept and pay with a good card. The hold should
  succeed — this is deliberate, so a poster is not blocked by the worker's
  paperwork.
- Then tap **Mark complete & pay**. Expect a refusal naming the reason, and
  critically: **nothing captured.** In Stripe the intent must still read
  _Uncaptured_, and the payment row still `authorized`.
- Have that worker finish onboarding, then release again. It should now succeed.

This is the test that proves the ordering in SECURITY.md §5: the payout check
runs before the capture, so a worker who cannot be paid never leaves the payer
charged with the money stuck on the platform.

**H. Webhook signature.** Prove the endpoint rejects unsigned traffic:

```sh
curl -i -X POST https://aovsfxypbdoppezlyjus.supabase.co/functions/v1/stripe-webhook \
  -H 'Content-Type: application/json' \
  -d '{"type":"payment_intent.succeeded","data":{"object":{"id":"pi_fake"}}}'
```

Expect **400 Invalid signature**. If this ever returns 200, anyone can mark any
job paid — stop and fix it before doing anything else.

Then replay a real event from Stripe → Webhooks → an event → **Resend**. Expect
200 with `duplicate: true`, and no change to the payment row.

---

### Known gaps

- **Nothing here has been run by me.** Every claim in this section is the
  intended behaviour of code that has never executed.
- **The Deno functions are untypechecked.** Run `deno check` before deploying.
- **No automated test covers payments.** Phases 5 and 6 each ended with a
  runnable suite; this one cannot have one until the functions are deployable.
  Once they are, the double-charge case (F) and the not-onboarded case (G) are
  the two worth automating first.
- **Authorisations expire after ~7 days** and nothing detects it.
- **No refund or cancellation path.** Cancelling a job after acceptance leaves a
  hold that simply lapses.
- **Apple Pay and Google Pay are not enabled**; they need a development build
  and a merchant identifier. Card payments work in Expo Go.
- **Fixture data and known-password accounts still present.** Still a release
  blocker, and now the accounts have Stripe test accounts attached.


---

## 2026-09-21 — Phase 7 review fixes: what to re-test

Ten of twelve review findings are fixed. **Four of them blocked the walkthrough
below from ever passing**, so the phase 7 test plan should be run from the top
rather than spot-checked — none of it has executed yet.

### Before anything else

The Stripe integration gained a function, so the deploy list has changed:

```
supabase functions deploy stripe-connect-onboarding --project-ref aovsfxypbdoppezlyjus
supabase functions deploy stripe-connect-return --no-verify-jwt --project-ref aovsfxypbdoppezlyjus
supabase functions deploy stripe-authorize-payment --project-ref aovsfxypbdoppezlyjus
supabase functions deploy stripe-release-payment --project-ref aovsfxypbdoppezlyjus
supabase functions deploy stripe-cancel-payment --project-ref aovsfxypbdoppezlyjus
supabase functions deploy stripe-webhook --no-verify-jwt --project-ref aovsfxypbdoppezlyjus
```

`stripe-connect-return` **must** be deployed with `--no-verify-jwt`. Stripe
redirects a browser to it and that browser has no Supabase session; with JWT
verification on it returns 401 and onboarding dead-ends in the browser.

Run `deno check supabase/functions/**/index.ts` first. The functions have never
been typechecked and two of them are new.

### A. Payouts onboarding now completes (was: 500 on every attempt)

1. Sign in as a worker, open **Set up payouts**, tap **Set up payouts**.
2. **Stripe's hosted form should open.** Before this fix the call failed with a
   500 and the browser never opened — if you see that, check that
   `stripe-connect-return` deployed and that `SUPABASE_URL` is set.
3. Complete onboarding with Stripe's test values (`000-000-0000` for the phone,
   `0000` for the SMS code, and the test bank routing `11000-000`).
4. At the end, Stripe redirects to `.../functions/v1/stripe-connect-return`,
   which bounces to `yoodle://payouts` and the app comes back to the front.
5. Payout status should read **Ready**. If it reads **In review**, tap
   **Refresh status** — `account.updated` may still be in flight.

**Also test the abandon path:** start onboarding and close the browser without
finishing. The app should return and show **Not set up** or **In review**, not
an error, and tapping again should resume rather than create a second account.

### B. A card can actually be entered (was: no card UI existed at all)

This is the big one. Accepting an offer should now open **Stripe's PaymentSheet**.

| Card | Expected |
| --- | --- |
| `4242 4242 4242 4242` | Succeeds. Payment badge becomes **Held**. |
| `4000 0000 0000 0002` | Declined. Sheet shows Stripe's decline message. |
| `4000 0025 0000 3155` | 3D Secure prompt, then succeeds once authenticated. |

Any future expiry, any CVC, any postal code.

Confirm for the successful card that **nothing has been charged**: in the Stripe
dashboard the PaymentIntent is `requires_capture`, and the payment row is
`authorized`. That is the held-not-charged state the whole design rests on.

**Dismiss the sheet without paying.** This should be silent — no error banner —
and the offer should show **Retry payment** (see D).

### C. 3D Secure returns to the app

Using `4000 0025 0000 3155`, complete the authentication. The app must come back
to the front by itself. If it hangs in the browser, `returnURL` in
`initPaymentSheet` (`yoodle://stripe-redirect`) does not match `scheme` in
app.json or `urlScheme` on `StripeProvider`.

### D. A failed payment is recoverable (was: unrecoverable)

The Edge Function accepts the offer **before** the card is confirmed, so a
decline leaves an accepted offer with no hold. Previously the action disappeared
at that point and there was no way back.

1. Accept an offer with the declining card `4000 0000 0000 0002`.
2. The offer row should now show **Retry payment** and the line *"You accepted
   this offer but the payment did not go through."*
3. Tap **Retry payment** with `4242 4242 4242 4242`. It should succeed.
4. Confirm in the Stripe dashboard that **only one PaymentIntent exists** for
   that offer — the retry reuses it rather than creating a second hold.

### E. Cancelling a job releases the hold (was: hold abandoned)

1. Accept an offer and pay with `4242 4242 4242 4242`. Confirm **Held**.
2. Cancel the job from My Jobs. The confirmation should mention the hold.
3. In the Stripe dashboard the PaymentIntent must be **`canceled`**, and the
   payment row `canceled`. Nothing charged.
4. **Then try the refusal path:** on another job, mark complete (releasing the
   payment), then attempt to cancel. It must refuse with *"already been paid
   out"* and **must not** cancel the job.

### F. Release still works, and now survives a missed webhook

Run the original release walkthrough. Then test the reconciliation:

1. Accept and pay so the hold exists, but **disable the webhook endpoint in the
   Stripe dashboard first** so `amount_capturable_updated` never arrives.
2. The payment row will still read `requires_payment_method` — the mirror never
   caught up.
3. Mark the job complete. **It should now succeed**, healing the row on the way.
   Before this fix it refused, and the hold was stranded until expiry.
4. Re-enable the webhook endpoint afterwards.

### G. Error messages are the real ones (was: generic filler)

Every Edge Function message was being replaced by generic text. Re-check that
the specific copy now appears:

- Release a payment to a worker who has **not** completed onboarding. Expect
  *"This worker has not finished setting up payouts yet…"* — not *"Could not
  release the payment. Please try again."*
- Accept an offer on a job you then cancel from another device. Expect *"This
  job has been cancelled, so it cannot be paid for."*

If you see the generic wording, `readEdgeFailure` is not reading the response
body and the rest of the error assertions here are meaningless.

### H. Double-tap, again

The original double-charge test still applies and is unchanged in intent: tap
**Accept & pay** twice in rapid succession, and fire two concurrent `curl`s at
`stripe-authorize-payment` with the same `offerId`. Exactly one PaymentIntent,
exactly one payment row.

Worth repeating now that the sheet exists: the second tap should find the sheet
already open rather than starting a second authorisation.

### I. A job with two payment rows

The case that used to break the screen outright. Reaching it takes some setup:

1. Accept offer A, let the card decline, leaving a `failed` row.
2. Decline offer A and accept offer B instead, paying successfully.
3. The job now has two payment rows. **Job detail must still show a payment
   section** (previously it vanished), showing offer B's **Held**.
4. **Mark complete must work** (previously: permanently *"There is no payment on
   this job yet"*).

### Known gaps

- **Still nothing here has been run.** Every claim is intended behaviour of code
  that has not executed. The fixes are read-correct and unverified.
- **The Deno functions are still untypechecked.** No Deno toolchain available on
  this machine.
- **No automated test covers payments.** Cases D, E, F and I are now the ones
  most worth automating — each is a silent, unrecoverable failure.
- **My Jobs error banner** still prefers a stale release error over a fresh
  cancel error (review finding 11, deliberately deferred). If an error looks
  wrong during test E, this is why.
- **Refunds and disputes remain unhandled**; cancellation voids a hold but
  cannot undo a capture.
- **Authorisations still expire after ~7 days** and nothing detects it.
- **Fixture data and known-password accounts still present.** Still a release
  blocker.


---

## 2026-09-21 — Phase 8: reviews and profiles

**Nothing here has been run.** Migration 0018 is written and not applied; the
screens have not been opened. Note also that `list_migrations` shows **0017 is
already applied** to the remote project even though phase 7's functions were
never deployed — so the database is a phase ahead of the Edge Functions.

### Setup

```
supabase db push --project-ref aovsfxypbdoppezlyjus
```

Phase 8 reads a **completed** job, and a job only reaches `completed` when
`stripe-release-payment` transfers successfully. So the phase 7 walkthrough is a
prerequisite, not an optional predecessor: deploy the functions from that
section first, or you will have nothing to review.

If `supabase db push` fails on `reviews_one_per_job_per_reviewer` with a 23505,
the table already holds a reviewer with two reviews on one job. That is
pre-0018 data and needs a human decision about which to keep — the migration
deliberately will not pick for you.

### A. The prompt appears once for each side

1. Run a job end to end: post, offer, accept & pay, mark complete. Both
   accounts now have a completed job.
2. **As the poster**, open the job from My Jobs → View. A "How did it go?" card
   should sit above the title, naming the worker.
3. **As the worker**, open Offers → Your offers → **View job**. The same card
   should appear, naming the poster.
   - *This button is new.* Before 0018 a worker could not read a job that had
     left `published`, so if the job title shows as "A job" here, 0018 did not
     apply.
4. Leave a review from one side. Reopen the job: **the prompt is gone**, and it
   stays gone on relaunch.

### B. Dismissing does not block anything, and sticks

1. On the other account, tap the **×** on the prompt.
2. The card disappears; the screen stays where it is and everything else on it
   still works. Navigate away and back — still gone.
3. **Force-quit and reopen.** Still gone. (This is the AsyncStorage path; if it
   returns, the write failed, which is the intended failure direction.)
4. The review itself is still available — the prompt is gone, not the ability.
   There is deliberately no other entry point, so dismissing means "not now"
   until a future phase adds one.

### C. A second review is blocked — in the database, not the UI

The UI check is easy to confirm and is **not the test that matters**:

1. After reviewing, navigating to the review screen for that job shows "You
   have already reviewed this job" instead of a form.

Now bypass the UI entirely. With the reviewer's own access token:

```sh
curl -i -X POST 'https://aovsfxypbdoppezlyjus.supabase.co/rest/v1/reviews' \
  -H "apikey: $PUBLISHABLE_KEY" \
  -H "Authorization: Bearer $REVIEWER_ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"job_id":"<JOB>","reviewer_id":"<ME>","reviewee_id":"<THEM>","rating":1}'
```

**Expected: 409, code `23505`,** naming
`reviews_one_per_job_per_reviewer`. Run it twice more — same answer every time.
A 201 here means the constraint did not apply and the migration needs checking.

### D. The counterparty rule (the phase's main security fix)

This is the one that was actually broken. You need a **third** account that bid
on the job and lost.

1. Have account C make an offer on the job, and decline it. Complete the job
   with account B as before.
2. **As C, try to review the poster:**

```sh
curl -i -X POST '.../rest/v1/reviews' \
  -H "Authorization: Bearer $LOSING_BIDDER_TOKEN" ... \
  -d '{"job_id":"<JOB>","reviewer_id":"<C>","reviewee_id":"<POSTER>","rating":1}'
```

   **Expected: 403 / `42501` row-level security violation.** Before 0018 this
   *succeeded* — that is the hole.

3. **As the poster, try to review C** (the losing bidder):
   same call, reviewer = poster, reviewee = C. **Expected: 403.** This also
   succeeded before 0018.
4. **As an account with no connection to the job at all:** 403.
5. **Self-review**, reviewer = reviewee: expect a CHECK violation on
   `reviews_no_self_review`, not an RLS error — the table refuses it regardless
   of policy.

### E. Reviewing an incomplete job

1. Set up a job that is accepted and paid but **not** marked complete.
2. Open it as either party: **no prompt**.
3. Force the insert with curl anyway. **Expected: 403** —
   `app.job_has_status(job_id, 'completed')` fails.

### F. The average recalculates

1. Note the worker's rating on their profile (Offers → Profile, or Home →
   Profile for your own). A fresh account shows **"No reviews yet"**, not zero
   stars — confirm that specifically, since an unrated person rendering as a
   zero-star person is the failure worth catching.
2. Leave a **5**. The profile should show **5.0 (1 review)**.
3. Complete a second job with the same worker and leave a **4**.
4. The profile should now read **4.5 (2 reviews)**. Pull to refresh if you are
   looking at a screen that was already open.
5. Check the view directly:

```sql
select * from public.profile_ratings where profile_id = '<WORKER>';
```

   `rating_avg` should be `4.50` and `rating_count` `2`. Because this is a view
   and not a stored column, these cannot disagree — if they ever do, the bug is
   in the app's caching, not the data.

### G. The profile screen

1. **About tab**: name, FSA area, bio, rating summary. Confirm there is **no
   full postal code, no email, and no job history** — the 0008 column grants are
   what stop that, so nothing here should be able to show them.
2. **Reviews tab**: individual reviews, newest first, each with the reviewer's
   name, photo, stars and date. A review left without a comment should render as
   stars and a date with **no empty quote block**.
3. The reviews list is lazy — it should not fetch until the tab is opened.
4. Open **someone else's** profile (Offers → Profile) and **your own** (Home →
   Profile). Empty states should read "X has no reviews yet" vs "You have no
   reviews yet".

### H. Accessibility

1. With a screen reader on, the read-only rating announces once — "Rated 4.5 out
   of 5 from 2 reviews" — rather than five separate star nodes.
2. The star **input** exposes five radio buttons, each labelled "1 star" … "5
   stars", with the chosen one selected.
3. Confirm filled and empty stars differ by **glyph** (★ vs ☆) and not only by
   colour.

### Known gaps

- **Nothing in this section has been executed.** Every claim is the intended
  behaviour of unrun code, and 0018 has not been applied.
- **No automated test covers reviews.** Case D is the one to automate first —
  it is the actual security fix, it needs three accounts, and it is tedious
  enough by hand that it will quietly stop being run.
- **No moderation.** Reviews cannot be reported, hidden or replied to. See
  SECURITY.md; this belongs with the phase 6 block-and-report blocker.
- **The prompt has one entry point.** Dismiss it and the only way back to
  reviewing that job is the job detail screen; there is no "jobs awaiting your
  review" list.
- **The reviews list is unpaginated.** Fine at this size, not at a thousand.
- **Fixture data and known-password accounts still present.** Still a release
  blocker.


---

## 2026-09-21 — One accepted offer per job: how to verify it

**Not yet run.** The procedure below is written against unapplied migration
0019 and an undeployed `stripe-authorize-payment`. Every expected result is
what the code should do, not what it was observed doing.

### Before you start: check for existing violations

Run this BEFORE `db push`, because the migration will fail on a dirty table and
it is better to know why first:

```sql
select job_id, count(*) as accepted_offers
from public.offers
where status = 'accepted'
group by job_id
having count(*) > 1;
```

Empty is the happy path. Any rows mean phase 6/7 already let a job be
double-accepted, and **each of those jobs may have more than one Stripe hold
against it.** Before deciding which offer stands, check the Stripe dashboard for
PaymentIntents in `requires_capture` on that job and cancel the ones that lose.

```
supabase db push --project-ref aovsfxypbdoppezlyjus
supabase functions deploy stripe-authorize-payment --project-ref aovsfxypbdoppezlyjus
```

### A. The ordinary case — two taps, seconds apart

1. Post a job and get **two different workers** to bid on it.
2. Accept the first: **Accept & pay**, card `4242 4242 4242 4242`. Confirm the
   payment badge reads **Held**.
3. Now tap **Accept & pay** on the second offer.
4. **Expected:** the error banner reads *"You have already accepted another
   offer on this job. Cancel the job if you want to start again."*
5. **Stripe's PaymentSheet must not open.** This is the specific thing to watch
   for — path (1) returns before any Stripe call, so if a card sheet appears at
   all, the early check did not run.
6. In the Stripe dashboard, confirm there is **exactly one** PaymentIntent for
   this job. Not two, and not one plus a cancelled one.

### B. The concurrent case — the one the index exists for

Check A cannot catch a true race, so this test deliberately bypasses the app.
Get the poster's access token and both offer ids, then fire both at once:

```sh
JWT="<POSTER_ACCESS_TOKEN>"
URL="https://aovsfxypbdoppezlyjus.supabase.co/functions/v1/stripe-authorize-payment"

for OFFER in "<OFFER_A>" "<OFFER_B>"; do
  curl -s -o "/tmp/resp-$OFFER.json" -w "%{http_code}\n" -X POST "$URL" \
    -H "Authorization: Bearer $JWT" \
    -H 'Content-Type: application/json' \
    -d "{\"offerId\":\"$OFFER\"}" &
done
wait
cat /tmp/resp-*.json
```

`&` and `wait` matter — sequential curls just re-test case A.

**Expected: one 200 with a `clientSecret`, one 409 with
`"code":"offer_already_accepted"`.** Which one wins is not deterministic and
does not matter; that exactly one wins is the whole assertion.

Two 200s means the index is not present — re-check that `db push` applied 0019.

Then confirm the database agrees:

```sql
select id, worker_id, status from public.offers where job_id = '<JOB>';
```

**Exactly one `accepted`.**

### C. The loser leaves no hold

This is the assertion that actually protects the cardholder, and it is separate
from B passing.

1. After B, open the Stripe dashboard → Payments, filtered to this job.
2. **Expected:** one PaymentIntent from the winner, in `requires_payment_method`
   (the client secret was returned but the sheet was never completed). The
   loser's intent is either absent or `canceled` — never `requires_capture`.
3. **On the poster's actual card statement / test-mode customer: no pending
   authorisation from the losing request.** A manual-capture intent authorises
   nothing until it is confirmed client-side, and the losing request fails
   server-side before its client secret is ever returned.
4. Check the payment rows:

```sql
select p.id, p.offer_id, p.status from public.payments p where p.job_id = '<JOB>';
```

   The loser's row, if one exists, is `canceled`.

### D. Reviews survive a job that already has two accepted offers

Belt-and-suspenders, for pre-0019 data. You cannot create this state any more,
so force it — on a **test project only**, and drop the index first:

```sql
drop index public.offers_one_accepted_per_job;
update public.offers set status = 'accepted' where id = '<SECOND_OFFER>';
```

1. Complete the job and open it as the **poster**. Expected: no review prompt,
   and opening the review screen says *"This job has more than one accepted
   offer, so we cannot tell who to review."* — **not** a crash, and **not** a
   review silently attached to one of the two workers.
2. Open it as **either accepted worker**. Expected: the prompt appears
   normally, because the person they review is the poster either way.
3. Recreate the index afterwards.

Before this change, step 1 threw PGRST116 and both parties were permanently
locked out of reviewing with no explanation.

### Known gaps

- **None of this has been executed.** 0019 is unapplied and the function is
  undeployed.
- **Case B needs real concurrency**, and a loopback `curl` on one machine is a
  weak approximation of it. It is good enough to prove the index fires; it is
  not a load test.
- **No automated coverage.** Case B is the one worth automating first — it needs
  two accounts, two offers and genuine parallelism, which is exactly the kind of
  test that stops being run by hand.


---

## 2026-09-21 — Phase 8 review fixes: what to re-check

Six fixes, none of which change the database. **Not run** — the app has still
not been opened against a deployed stack.

Most of these are only visible in states that are awkward to reach on purpose,
so the throttling and offline notes below matter more than usual.

### A. A slow rating never reads as "no reviews"

The bug was a claim about a person made from not having asked yet, so the test
is about what appears *during* the request, not after it.

1. Throttle the network hard (Charles, or iOS Settings → Developer → Network
   Link Conditioner → "Edge").
2. Open a job posted by a **well-reviewed** account.
3. Watch the "Posted by" card as it loads. **Expected: a muted `★ …`
   placeholder**, then the real rating.
4. **It must never read "No reviews yet" at any point.** That is the whole
   assertion; if you blink and miss it, throttle harder rather than assuming.
5. Repeat on Offers and on a profile screen.

### B. A failed rating read stays silent

The Offers case was the serious one — one failed query described everyone on
the page as unrated.

1. Open Offers with several offers visible from rated people.
2. Put the device in airplane mode and pull to refresh, **or** block
   `*/rest/v1/profile_ratings*` in a proxy and reload.
3. **Expected: the rating line disappears entirely** from each card.
4. **Expected NOT: "No reviews yet" on anybody.** Before this fix, that is what
   every card showed, and it persisted until a successful refetch.
5. Restore the network, pull to refresh, confirm ratings return.

### C. A new review updates the average on Offers

This is the case that silently broke documented test F in the phase 8 section.

1. Note a worker's rating on the **Offers** screen — say `★ 5.0 · 1 review`.
2. Complete another job with them and leave a **4**, without force-quitting.
3. Go back to Offers. **Expected: `★ 4.5 · 2 reviews`, without a manual pull to
   refresh.** Before the fix it kept 5.0 for the rest of the session, because
   the mutation invalidated the per-profile key and not the batched one.
4. Also confirm the profile screen and Job Detail updated.

### D. Dismissals survive a sign-out

1. Complete a job and **dismiss** the review prompt with the ×.
2. Sign out. Sign back in **as the same account**.
3. Open that job. **Expected: the prompt stays dismissed.** Before this fix,
   signing out wiped your own dismissals and every one of them came back.
4. Now confirm the isolation that the removed code was wrongly credited with:
   sign out, sign in as a **different** account that also has a completed job,
   and confirm that account sees its own prompt normally and has no dismissals
   inherited from the first.

### E. "View job" is not a dead end

1. As a worker, bid on a job and have the poster **decline** it.
2. Have the poster take the job to `assigned` or `completed` with someone else,
   so it leaves `published`.
3. Open Offers → Your offers and find the declined bid. **Expected: no "View
   job" button** — the job is not readable by you, and the button would only
   lead to "This job is no longer available."
4. On an **accepted** offer for a completed job, the button **is** present and
   opens the job with the review prompt on it.

### F. One read, not two

Cheap to check and it confirms the query is gated correctly:

1. With the network inspector open, load the Offers screen.
2. **Expected: a single request to `profile_ratings`.** Two means the id list
   is being built before `context` has settled and the query key is changing
   mid-flight.

### Known gaps

- **None of this has been run.** As with everything since phase 7, these are
  intended behaviours of code that has not executed.
- **Cases A and B need deliberate network interference** and will not happen by
  accident during ordinary testing — which is exactly why both bugs survived
  review of the working app.
- **No automated coverage.** C is the most automatable (it is a cache
  invalidation assertion, not a UI timing one) and the most likely to regress
  silently, since nothing about the screen looks wrong when it is stale.

---

## 2026-09-21 — Migrations 0018 and 0019 applied and verified

**This supersedes the "not applied / not run" notes in the three sections above,
for the database half only.** The Edge Functions remain undeployed and no app
walkthrough has been performed.

### Applied

Both migrations were applied to `aovsfxypbdoppezlyjus` via the Supabase MCP
`apply_migration`, not `supabase db push` — the CLI is not installed locally.
They are recorded in `supabase_migrations` under their file names.

Pre-flight first, because both migrations tighten a constraint and either could
have failed on existing data:

| Check | Result |
| --- | --- |
| jobs / offers / accepted offers | 58 / 1 / 1 |
| payments | **0** |
| reviews | **0** |
| profiles with a Stripe Connect account | **0** |
| jobs with >1 accepted offer | 0 |
| (job, reviewer) pairs with >1 review | 0 |

Nothing had ever reached Stripe — no payments, no Connect accounts — which is
consistent with the functions never having been deployed, and means neither
migration was tightening a rule that live data already violated.

### Verified present after applying

`profile_ratings` view (with `security_invoker = true` confirmed on
`reloptions`), `offers_one_accepted_per_job`, `reviews_one_per_job_per_reviewer`,
`reviews_insert_counterparty`, `jobs_select_accepted_worker`, and
`app.is_accepted_worker_as`. The two objects 0018 replaces —
`reviews_one_per_pair_per_job` and `reviews_insert_participant` — are confirmed
**gone**, not merely shadowed.

### Both constraints exercised against the live database

Each test ran inside a `DO` block ending in `raise exception`, so the
transaction unwound and nothing was left behind. The second test asserts the
first one's cleanup (`offers_before=1`) rather than assuming it.

**One accepted offer per job.** Inserted a second `accepted` offer, different
worker, same job as the existing accepted one:

```
PASS: second accepted offer refused by unique_violation
```

**One review per job per reviewer.** Inserted a review, then a second by the
**same reviewer on the same job against a different reviewee** — the case the
old `(job_id, reviewer_id, reviewee_id)` constraint permitted and the new
`(job_id, reviewer_id)` one must not:

```
PASS: second review by same reviewer refused by unique_violation
```

That second test is the one that matters, because it distinguishes the new
constraint from the old rather than just re-confirming something 0006 already
did.

### NOT done, and why

- **Edge Functions are still not deployed.** Both
  `mcp__supabase__deploy_edge_function` and `list_edge_functions` return *"Your
  account does not have the necessary privileges to access this endpoint."* The
  configured access token has database access but not platform access. This is
  the same limitation that has made `get_advisors` unavailable since phase 4 —
  now with a known cause rather than a shrug.
- **The Stripe secret's mode is unverified.** No MCP tool exposes Edge Function
  secrets, and Supabase does not return a secret's value once set — the
  dashboard shows a digest. It must be checked by a human under Edge Functions →
  Secrets.
- **Neither walkthrough has been run.** Both need the app on a device, a native
  PaymentSheet, and the Stripe dashboard.
- **The concurrent-accept test (case B in the section above) has NOT been run.**
  What is verified here is that the *constraint* refuses a second accepted
  offer. That the *Edge Function* converts the resulting 23505 into a clean 409
  is still unverified, because the function is not deployed.

### What a human needs to do next

```
npx supabase@latest login                     # interactive; cannot be scripted here
npx supabase@latest link --project-ref aovsfxypbdoppezlyjus
npx supabase@latest functions deploy stripe-connect-onboarding
npx supabase@latest functions deploy stripe-connect-return   --no-verify-jwt
npx supabase@latest functions deploy stripe-authorize-payment
npx supabase@latest functions deploy stripe-release-payment
npx supabase@latest functions deploy stripe-cancel-payment
npx supabase@latest functions deploy stripe-webhook          --no-verify-jwt
```

`npx supabase@latest --version` reports 2.117.0 on this machine, so the CLI
runs without a global install. Do **not** run these until the secret's mode has
been confirmed.

---

## 2026-10-03 — The project was paused, restored, and came back EMPTY

**This supersedes the "applied and verified" claims in the 2026-09-21 section
above.** Those verifications were real when written. They describe a database
that no longer exists.

### What happened

The Supabase free tier pauses a project after seven days without activity. The
last activity was 2026-09-23; by 2026-10-03 the project `aovsfxypbdoppezlyjus`
was paused, its DNS record withdrawn, and every request from the app failed.

The symptom in the app was **"Something went wrong. Please try again."** — not
the "Could not reach Yoodle" copy that was written for exactly this case. See
the error-mapping note at the end of this section.

Restoring from the dashboard brought the project back reachable **but blank**:

| Check | Before (2026-09-21) | After restore |
| --- | --- | --- |
| `auth.users` | 10 | **0** |
| tables in `public` | 15+ | **0** |
| `supabase_migrations` schema | present, 20 rows | **absent** |
| `postgis` extension | installed (0001) | **absent** |
| `storage` / `auth` schemas | project's own | stock, empty |

This is a freshly initialised Postgres, not a partial restore: a restore still
in flight would not present clean stock `auth` tables with zero rows.

### What was lost, and what was not

Lost: 10 test accounts, ~58 seeded jobs, 1 offer, and any uploaded avatars or
job photos in storage.

**Not lost, and worth being precise about:** on 2026-09-21 this project had 0
payments, 0 reviews, 0 Connect accounts and 0 completed jobs. Nothing that had
ever touched Stripe existed, so nothing irrecoverable went with it. The schema
is entirely in `supabase/migrations/0001`–`0019`, and test data regenerates
from `supabase/tests/seed_test_data.sql` and `seed_browse_jobs.sql`.

### Still outstanding after this

- Migrations `0001`–`0019` need re-applying in order. **Not yet done.**
- Test data needs re-seeding. **Not yet done.**
- The **Confirm email** toggle needs re-checking. Auth config lives outside the
  database and should have survived, but given how this restore behaved it is
  not worth assuming.
- The Edge Functions were never deployed, so phase 7 is unaffected — there is
  nothing to redeploy that was not already pending.

### The error message was wrong, and that is a real bug

`describeError` in `src/services/auth.ts` routes to its `network` branch only
when `status === undefined`. supabase-js does not do that: a fetch failure
throws `AuthRetryableFetchError` with **`status = 0`**. Zero is not `undefined`,
so every connectivity failure falls through to the `unknown` branch and reports
as a generic app fault.

The `network` branch is therefore dead code for actual network errors. Had it
worked, the app would have said "Could not reach Yoodle" and the paused project
would have been obvious immediately instead of looking like a sign-up bug.

Fix is one condition — `status === undefined || status === 0` — and it affects
sign-in and sign-up together, since both share `describeError`. **Not yet
applied.**

### Known gaps

- **Nothing here has been re-verified against a live database**, because the
  database is empty as of this writing. Every row in the table above is a
  measurement of the blank project, not of a restored one.
- **No automated guard against this recurring.** The pause will happen again
  after seven idle days, and the only thing that would make it legible from
  inside the app is the error-mapping fix above.
