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

- Direct connection is disabled for profiles. Saving or launching a profile requires a
  valid proxy.
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
- Proxy checks are automatic background checks. Do not add a manual check button back.
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

## Verification Checklist

Before handing back UI/app changes:

```powershell
cd E:\argus\launcher
npm run typecheck
npm run build
```

Both must be clean. There is no test suite. Then restart the app and click through the
path you changed.
