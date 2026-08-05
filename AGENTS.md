# Argus Launcher Agent Notes

Handoff memory for agent sessions working on the launcher.

Start with `../ARGUS.md` (the tree map) and `LAUNCHER.md` (this folder in detail).
`../CLAUDE.md` holds the invariants. This file is the accumulated behavioral gotchas.

## Project Split

Two separate apps/processes:

- **Argus Launcher** — Electron launcher/manager, this folder (`E:\argus\launcher`).
- **Argys Browser** — Chromium-based anonymous browser (`E:\argus\browser\src`), built
  and installed separately.

Do not run the launcher dashboard inside Argys Browser. Argus Launcher owns Supabase login,
profiles, proxies, folders, statuses, bookmarks, shared extensions, API docs/tokens,
billing, and launch payloads. Argys Browser must stay anonymous and should only receive a
profile runtime payload from the launcher.

## Run And Build

From `E:\argus\launcher` (PowerShell):

```powershell
npm run typecheck
npm run build
```

`npm run dev` and `npm start` **do not work on Windows** — they use the Unix `env -u`
and then call `scripts/start-macos-app.cjs`. Run the two halves directly instead:

```powershell
npx vite --host 127.0.0.1
# second shell:
$env:ARGUS_LAUNCHER_DEV = "1"; npx electron .
```

Node is at `C:\Program Files\nodejs` (v24.18.0, npm 11.16.0). Git is at
`C:\Program Files\Git\cmd` and may not be on PATH in a fresh shell.

To restart the app cleanly:

```powershell
Get-Process | Where-Object { $_.Name -match 'electron|Argys' } | Stop-Process -Force
```

To close currently launched browser profile windows:

```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match 'argus-profile-id=' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## Current Important Behavior

- A profile has three proxy modes (`ProxyMode` in `src/types.ts`): `assigned`, `direct`
  and `free_proxy`. **Only `assigned` requires a proxy.** `ProfileModal`'s validation
  refuses a save without one in that mode alone ("Proxy is required, or pick Direct /
  Free Proxy instead"), and `resolveLaunchProxy` returns `null` — launch, no proxy, no
  block — for the other two. An undefined `proxy_mode` means `assigned`, for profiles
  saved before the field existed. (This entry used to claim direct was disabled
  entirely. It has not been for some time.)
- **Switching a profile to Direct must clear Chromium's own `proxy` pref, not just the
  `argus.profile_data` block.** They are separate keys in the same Preferences file, and
  the second is the one that routes traffic: a proxied launch leaves
  `socks5://127.0.0.1:<bridge port>` in it, pointing at a SOCKS bridge that dies with the
  session. Nothing on the browser side clears it on a direct launch — the startup
  fail-safe is skipped for `--argus-profile-launch`, and `InitializeAsync` returns early
  on the empty `assigned_proxy_id`, so `RevertToDirect` never runs. So
  `writeProfileProxyAssignment` writes `prefs.proxy = {mode: 'direct'}` itself. Drop that
  line and the *second* launch of any profile that once had a proxy fails every
  navigation, loopback included (the applicator sets no bypass rules), while the first
  launch and the whole UI look correct.
- A profile carries at most **5 tags** (`MAX_PROFILE_TAGS`). `normalizeTags()` in
  `src/lib/tags.ts` is the only enforcement point and all three write paths call it —
  `profileFromDraft`, the CSV importer and the automation bridge's profile patch. Do not
  add a fourth that skips it. `profiles.tags` stays a plain `text[]` of whatever the user
  typed; the catalog in `src/data/tagPresets.ts` is matched through `tagKey()` (case and
  punctuation stripped) plus aliases, so nothing ever rewrites a stored tag.
- Tag brand marks live in `src/assets/brands/<slug>.svg` and are picked up by
  `import.meta.glob` — never imported by name. A missing file falls back to the preset's
  lucide glyph, so the folder may be empty and the build still passes. They are the
  full-colour cuts rendered through `<img>` (`.tag-logo`), height-fixed with the width
  left to the artwork because several are wordmarks or non-square. Five need a theme fix,
  declared per-preset as `adapt` — see `src/assets/brands/README.md` before swapping a
  file for a different cut.
- Fingerprint controls belong in the profile edit dialog under `Edit fingerprint`, not in
  the main profiles table/view. `<PlatformPicker>` renders exactly once, at the top of the
  `Identity` group inside `Edit fingerprint` — it is the only control writing
  `fingerprint_os`, and picking a platform re-rolls the GPU, CPU, screen and media-device
  set via `fingerprintPatchForOs`. Because that used to leave every profile silently
  shipping as Windows 11, the `Fingerprint` card on the main form sits directly under
  Proxy — not at the bottom of the form — and its summary line names the current platform,
  browser version, timezone and WebRTC mode. Keep it there.
- Only `windows`, `macos` and `linux` are fully implemented browser-side
  (`argus_ua.cc` `LookupPreset`). `Android` and `iOS` get a user-agent string but no
  UA-Client-Hints override, so they still report a desktop platform and `Sec-CH-UA-Mobile:
  ?0`; the picker says so under those two cards. `Windows 11` and `Windows 10` are the same
  `windows` preset and the same `Windows NT 10.0` UA — the distinction is presentational.
- Argys Browser launch must open a launcher-provided local home file or a real profile
  start URL. It must not open Supabase login, `localhost`, `127.0.0.1`,
  `argus-launcher`, or `about:blank`.
- Proxy checks are automatic background checks **in the launcher**. Do not add a manual
  check button back to the Proxies tab. There are two exceptions, both surfaces the
  background sweep cannot serve:
  - The generated browser start page has a Re-check button on its proxy panel: that page
    shows a country and a latency measured once at launch, a session outlives that by
    hours, and you cannot reach the launcher from inside an anonymous window — so it is
    the only surface with no other way to ask. It goes through
    `POST /v1/proxies/recheck-from-page` (see the Automations section below), which
    answers in the renderer so the result is recorded against the proxy row exactly as
    the background sweep would have recorded it.
  - The profile import review step has a **Check proxies** button
    (`components/modals/ImportProfilesModal.tsx`). The sweep only ever sees saved rows,
    and the whole point of that screen is to decide *before* saving — a file of proxies
    that cannot connect should be found there, not discovered profile by profile at
    launch. It is explicit and never blocks the import, checks at most
    `CHECK_CONCURRENCY` (5) at a time through `lib/concurrency.ts` rather than one curl
    per row, and routes a row already matched to a stored proxy through
    `testConnectionAndRecord` so that result lands exactly as the sweep would write it.
    A row whose proxy is not saved yet is only tested.
- **`assigned_to` is a label, not a permission, and it is never written by an ordinary
  save.** Every member of an org already sees, launches and edits every profile, proxy,
  cookie set and automation — `org_id` is the only scope on any of them, and the RLS
  policies are `is_org_member` for select *and* update. Assigning changes who a row
  *names*; it grants and revokes nothing. So do not add an access check keyed off it, and
  do not describe it to a user as private.
  The column is deliberately omitted from `profileToRow`/`profilePatchToRow`
  (`src/db/mappers.ts`) and is owned by the `set_assignee` / `set_assignees` /
  `accept_handoff` RPCs alone — otherwise an edit from a session that had not seen a
  reassignment would carry its stale value back and silently unassign the row. That is
  why `ProfileModal` keeps the picker in the draft and applies it in a *second* call
  after `profiles.save()` succeeds, never as a field on the save.
  Note `docs/schema-changes/2026-08-06-handoffs.sql` describes a model that no longer
  holds: it made assigning to anybody but yourself impossible, requiring an offer the
  recipient accepted. **`2026-08-07-assign-directly.sql` replaced that** — assignment to
  any teammate is now direct, and `ShareModal`'s offer flow is the deliberate alternative
  for when you want them to agree first. Read the newer file before reasoning about it.
  New profiles claim their creator through the column's `default auth.uid()`, which is
  why the insert path sets nothing and the CSV importer only writes assignments when the
  import dialog's picker names somebody other than the importer — and then only for rows
  it *created*, never rows it updated.
- Profile folders and proxy folders share one `public.folders` table, told apart by
  `folders.kind` (`'profile'` / `'proxy'`). `useCloudData` splits the single read into
  `state.folders` and `state.proxy_folders` — that split is the only thing keeping a proxy
  folder out of the profiles folder row, the assign dropdown, the move dialog and the
  API-key folder scope, so do not "simplify" the two lists back into one filtered at each
  call site. `library.createFolder`/`saveFolder` require an explicit `kind`;
  `removeFolder` reads it back off state.
- A folder icon may be `flag:<ISO>` (e.g. `flag:US`) instead of a `FOLDER_ICONS` key —
  same contract, still a short key and never markup. `FolderGlyph` is the one place that
  resolves it, and a flag folder ignores its colour (the mark carries its own), which is
  why the folder dialog hides the colour picker once a flag is chosen.
- `useProxyActions.save()` rebuilds the whole proxy row, so it must keep carrying
  `folder_id` off the existing row. Drop that line and editing a proxy's password silently
  files it back under All proxies.
- Shared extensions and the built-in cookie manager are loaded into browser sessions via
  `--load-extension`.
- Cookie import is handled through a temporary generated `ArgysCookieSeed` extension in
  the profile user data dir.
- **`cookie_sets.source_url` is the source of truth for a launch; `cookie_sets.cookies` is
  only a read cache for the inspector.** `electron/main.cjs` fetches that URL and holds no
  Supabase credentials by design, so any write that changes a set's cookies must upload a
  fresh file and rewrite `source_url` alongside the jsonb — see
  `useCookieActions.saveEntries`. A jsonb-only save looks correct in every screen of the
  app and still seeds the browser with the pre-edit cookies.
- `cookieSets.list()` deliberately omits the `cookies` column: `useCloudData` reloads on
  every window focus, and pulling every payload each time would not scale. Payloads load
  one set at a time through `loadPayload`.
- `src/lib/cookieFile.ts` is a hand-maintained TypeScript port of the cookie parsing in
  `electron/main.cjs` (~lines 1326-1423). Nothing compiles `electron/`, so the two cannot
  be one module. The contract that must not drift is the object shape `normalizeCookie()`
  returns — the inspector writes it into the database and re-uploads it as the file
  main.cjs parses back. Change one, change the other.
- **Unassigning cookies means clearing `cookie_import_path/_url/_name/_count` as well as
  `cookie_id`** — `NO_COOKIES` in `useCookieActions`. Nulling the FK alone does nothing
  visible and everything wrong: `buildLaunchPayload` used to fall back to the legacy
  fields, `drafts.ts` preserves them through every save, and `ProfileModal` hides them
  whenever `cookie_mode === 'saved'`. So a profile that was once imported into directly
  and later put on a library set keeps a live second copy of that file, and trashing the
  set would report "N profiles unassigned" while the next launch signed straight back in.
  It is also what stops `migrateLegacyCookieImports` re-minting a purged set from the same
  stale URL on the next window focus.
- `buildLaunchPayload` treats `cookie_mode === 'saved'` as authoritative: the set resolves
  or the profile launches with no cookies. It must never fall through to the legacy
  fields, for the reason above.
- Trashing a cookie-set unassigns every profile using it, and `buildLaunchPayload` /
  `migrateLegacyCookieImports` both refuse to resolve a set with `deleted_at`. All of
  these are needed together: without the self-heal guard the delete undoes itself on the
  next window focus.
- `useProfileActions.matchCookies` (Profiles tab → bulk "Import cookies") still writes
  per-profile `cookie_import_*` rather than library entries, and should stay that way:
  one library set per profile turns 40 profiles into 40 single-use sets, which is the
  opposite of a library. Same for the automation bridge's push-local.
- Profile ids double as on-disk directory names under `E:\ArgysProfiles\<id>`. Never
  renumber them.

## Windows Porting Debt

`electron/main.cjs` still shells out to macOS binaries in several places — these
silently no-op or throw on Windows:

- `killExistingProfileProcess()` uses `/usr/bin/pgrep` (~line 1533)
- other `pkill`-based cleanup paths
- `resolveBrowserExecutable()` (~line 801) and the `ARGUS_BROWSER_APP` default expect a
  `.app` bundle

`scripts/start-macos-app.cjs` and `scripts/ensure-macos-app.cjs` are macOS-only by name
and by content. Audit before shipping a Windows build.

## API Port Warning

Port `3001` was owned by Dolphin Anty on the previous (macOS) machine. The Argys API tab
mentions `http://127.0.0.1:3001`. Confirm what actually holds that port here before
debugging token auth against it:

```powershell
Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue |
  Select-Object OwningProcess |
  ForEach-Object { Get-Process -Id $_.OwningProcess }
```

If a real Argys local API is implemented, use a different port and update the API tab.

**API tokens are currently fake.** `tokenForEmail()` in `src/main.tsx` (~line 2168) is a
client-side FNV-1a hash of the email address — anyone who knows a user's email can
compute their "token", and nothing server-side ever validates it. Do not build anything
on top of it; `../prompts/07-api-tokens.md` replaces it with real hashed tokens.

Never hardcode a token in this file. If one ever ends up here, treat it as compromised
and rotate it immediately.

## Automations

**Never `upsert` an automation.** `trg_automation_limit` is BEFORE INSERT, and
Postgres fires those for `insert ... on conflict do update` even down the
conflict path — so an upsert used to *edit* a workflow fails whenever the org
sits at its cap. `src/db/automations.ts` splits create/replace for this reason,
exactly as `src/db/profiles.ts` does.

**The step catalogue is `electron/automation/step-schema.json`, not TypeScript.**
Nothing compiles `electron/`, so a TS catalogue would be maintained twice by
hand. `src/automations/schema.ts` pins the JSON to the `StepType` union in both
directions; adding a step means a JSON entry, a union member and an executor,
and the editor needs no change at all. Do not "simplify" that binding into a
cast — a cast on the right-hand side satisfies the annotation and checks
nothing.

**`evaluate.script` is never interpolated.** Splicing user data into source is
injection, and a `{{ }}` inside real JavaScript would be silently rewritten.
Values reach a script through `args`, which are interpolated and passed as a
JSON-encoded argument.

**The local API's routes live in `electron/api/routes.json`.** `main.cjs` builds
its pathname allow-list from it, `mcp/tools.cjs` generates the automations tools
from it, and the API tab renders it. Before that table there were three
hand-written copies of one list and they had already drifted — the API tab
documented `POST /v1/proxies`, `POST /v1/profiles` and
`POST /v1/profiles/{id}/launch`, none of which were ever routed, so every agent
handed the brief burned its first turns on 404s. Add a route to the table, not
to the allow-list, and run `scripts/verify-api-routes.mjs`.

**A table's columns are a registry, and the ids are stored.** `src/tables/`
holds one registry per configurable table (Profiles, Proxies, Cookies); the tabs
render their headers, their cells and their empty-state colSpan from it, and
`useTableSort` is fed the whole registry rather than the visible slice so hiding
a column cannot strand the active sort key. What a user has hidden is stored in
Supabase auth `user_metadata` under `argus_table_columns`, keyed by column id —
so **never rename an id**. Renaming one silently hides that column for everyone
who had saved a layout naming it; retire a column by dropping it from the
registry and never reusing the id. The stored value is the user's *deviations*
from the defaults, not the list of visible columns: a list cannot tell "I hid
this" from "this did not exist when I saved", and it would permanently lose the
Assigned column for anyone who configured their tables while working alone.

**The automations tools are generated, and the filter is `channel || local`, not
`mcp`.** Nine profile/proxy routes also carry an `mcp` name so the agent brief
can list every tool from one file; filtering the generator on `mcp` alone builds
a second, field-less copy of each of those nine. `tools/list` then answers with
thirty tools and `argus_update_profile` resolves to the copy that forwards no
fields. `verify-api-routes` checks for exactly this.

**A folder-scoped key may not author automations.** They are org-wide with no
folder of their own, so scope cannot be applied to them the way it is applied to
a profile — a key granted one folder could otherwise rewrite a workflow every
other folder runs. List, read and run are allowed; create, update and delete are
`403`. Enforced in `main.cjs` off the route's `scope` field.

**The showcase example is an ordinary automation.** `src/data/showcaseAutomation.ts`
is a plain template with **no `id`** — `exampleAutomation()` mints one with
`newId()` at insert, because the id becomes a directory name under
`<userData>/AutomationRuns/` and has to satisfy `automations_id_fs_safe`; a
constant would also collide on the primary key the second time anyone loaded
it. Once inserted it is a row like any other. Nothing reads it at runtime,
nothing keys off its name, and no code path asks "is this the example?" —
keep it that way, or the first user who renames it finds a feature that
stopped working. Its `else` branch is currently the one that always runs: we do
not rank for "argus browser" and the site is not indexed.

**Do not add `--remote-allow-origins`.** It used to be `*` on every automation
launch, which let any web page reach the CDP socket. Our clients send no
`Origin` and Chromium accepts that.

**The Run button never picks a profile.** It opens `RunAutomationModal`. It used
to call `runTarget()` — the single attached profile, else whatever row happened
to be highlighted on the Profiles tab — and the first sign that the guess was
wrong was the main process refusing the spawn seconds later with "Proxy
1.2.3.4:5678 did not respond … Fix the proxy in Argus Launcher and try again",
a sentence about a profile the user never chose. The dialog shows each profile's
proxy health before the commit and a profile whose proxy failed its check cannot
be ticked. `runTarget` still exists for the editor's Check button alone, and now
prefers `automations.lastRunProfileId()` so Check tests against the page the
last run actually used — the two agreeing is the reason that file exists.

**`RUN_CONCURRENCY` (`src/automations/limit.ts`) must equal
`MAX_CONCURRENT_RUNS` (`electron/automation/runner.cjs`).** The runner's cap
does not queue — over it, `start()` throws `Too many runs at once (3 is the
limit)` with `status = 429`. `runMany` is the renderer-side queue that stops
that being reached, and it paces on **completion**, not on `startRun` returning:
`execute()` is deliberately not awaited over there, so a queue built on the
start alone launches every profile at once and trips the cap. `waitForRun` in
`useAutomationRuns` is what turns the cap into a queue. Nothing compiles
`electron/` and no IPC reports the runner's cap, so the pair is hand-kept.

**The automation run path goes through `proxies.resolveForLaunch`, like every
other launch.** It used to read `state.proxies` directly and hand the result to
`buildLaunchPayload`, which is why a dead proxy surfaced as a dead run rather
than as a blocked launch with a reason. That function was `resolveLaunchProxy`
in `useProfileActions`; it moved to `useProxyActions` so the Launch button and
the runner share one gate. It resolves through `matchedProxyForProfile`, not a
find on `proxy_id` — as does `automations/runReadiness.ts`, or the dialog would
offer a profile the gate then refuses.

**The debugging port is opened when a launch has start-page tiles, not on every
launch.** `useProfileActions.launch` reserves one when the profile has an
automation attached *or* any automation is pinned — `startPageAutomations()` in
`src/lib/startPageAutomations.ts` is the single answer to "what tiles does this
launch have", and `buildLaunchPayload` renders the tiles from the same call, so
the port and the tiles cannot disagree. Pinning is the opt-in: a workspace that
pins nothing and attaches nothing still launches with no extra switches at all.
Do not widen this to every launch — an always-on `--remote-debugging-port` is
connectable by any local process and CDP attachment is observable from the page.

**The two page routes are not part of the keyed API surface.**
`POST /v1/automations/run-from-page` and `POST /v1/proxies/recheck-from-page` sit
*above* the bearer gate in `main.cjs` and authenticate with the per-launch run
token instead, because the caller is a `file://` document that has no key and
must never be given one. They are deliberately absent from
`electron/api/routes.json`; `verify-api-routes.mjs` skips them by name. Both take
their id off the token's entry rather than the request body, which is what makes
them safe to open at all — the run route names an automation from a list minted
with the token, and the re-check route names nothing. Every refusal on both is
the same 403 with the same body, so neither is an oracle. If you add a third,
extend `scripts/verify-run-token.mjs` with its refusal paths.

**A run token is minted on every launch**, including one with nothing pinned and
nothing attached — the proxy panel needs it. Those carry `cdpPort: null` and an
empty automations list, and `authorize()` looks every requested id up in that
list, so such a token can re-check and nothing else.

## Verification Checklist

Before handing back UI/app changes:

```powershell
cd E:\argus\launcher
npm run typecheck
npm run build
```

Both must be clean. There is no test suite, but there are three end-to-end
verification scripts, and anything touching the runner, the start-page token or
the local API should run them:

```
node scripts/verify-automation.mjs   # drives a real browser through a workflow
node scripts/verify-run-token.mjs    # the start-page endpoint's refusal paths
node scripts/verify-api-routes.mjs   # the route table vs what main.cjs serves
```

`verify-api-routes` needs nothing running — no Electron, no browser, no
Supabase — so there is no excuse for skipping it. Then restart the app and click through the
path you changed.
