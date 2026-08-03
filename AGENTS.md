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
- Fingerprint controls belong in the profile edit dialog under `Edit fingerprint`, not in
  the main profiles table/view.
- Argys Browser launch must open a launcher-provided local home file or a real profile
  start URL. It must not open Supabase login, `localhost`, `127.0.0.1`,
  `argus-launcher`, or `about:blank`.
- Proxy checks are automatic background checks. Do not add a manual check button back.
- Shared extensions and the built-in cookie manager are loaded into browser sessions via
  `--load-extension`.
- Cookie import is handled through a temporary generated `ArgysCookieSeed` extension in
  the profile user data dir.
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
