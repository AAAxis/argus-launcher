# Argys Anty Agent Notes

Use this file as the handoff memory for future Codex/agent sessions.

## Project Split

There are two separate apps/processes:

- `Argys Anty`: Electron launcher/manager in `/Users/dima/argus-launcher`.
- `Argys Browser`: Chromium-based anonymous browser app, usually installed at `/Applications/Argys Browser.app`.

Do not run the launcher dashboard inside Argys Browser. Argys Anty owns Supabase login, profiles, proxies, folders, statuses, bookmarks, shared extensions, API docs/tokens, and launch payloads. Argys Browser must stay anonymous and should only receive a profile runtime payload from the launcher.

## Run And Build

From `/Users/dima/argus-launcher`:

```sh
PATH=/Users/dima/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin npm run typecheck
PATH=/Users/dima/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin npm run build
PATH=/Users/dima/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin npm start
```

The explicit `PATH` matters in Codex sessions because plain `node`, `curl`, or other commands may not be found otherwise. Node is available at `/Users/dima/.local/bin/node`.

To restart the app cleanly:

```sh
/usr/bin/pkill -f "Argys Anty" || true
/usr/bin/pkill -f "electron.*argus-launcher" || true
PATH=/Users/dima/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin npm start
```

To clear currently launched browser profile windows:

```sh
/usr/bin/pkill -f "argus-profile-id=" || true
```

## Current Important Behavior

- Direct connection is disabled for profiles. Saving or launching a profile requires a valid proxy.
- Fingerprint controls belong in the profile edit dialog under `Edit fingerprint`, not in the main profiles table/view.
- Argys Browser launch must open a launcher-provided local home file or a real profile start URL. It must not open Supabase login, `localhost`, `127.0.0.1`, `argus-launcher`, or `about:blank`.
- Proxy checks are automatic background checks. Do not add a manual check button back.
- Shared extensions and the built-in cookie manager are loaded into browser sessions via `--load-extension`.
- Cookie import is handled through a temporary generated `ArgysCookieSeed` extension in the profile user data dir.

## API Port Warning

Port `3001` is currently owned by Dolphin Anty on this machine:

```sh
/usr/sbin/lsof -nP -iTCP:3001 -sTCP:LISTEN
```

Argys API docs currently mention `http://127.0.0.1:3001`, but requests there hit Dolphin and return `invalid session token` for Argys tokens. Do not debug Argys token auth against Dolphin's port. If a real Argys local API is implemented later, use a different port and update the API tab.

A token for `holylabsltd@gmail.com` is available in the app's own API tab
(Settings → API) once signed in. Do not hardcode tokens in this file --
if one ever ends up here, treat it as compromised and rotate it immediately,
especially before this repo is made public.

## Verification Checklist

Before handing back UI/app changes:

```sh
PATH=/Users/dima/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin npm run typecheck
PATH=/Users/dima/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin npm run build
```

Then restart Argys Anty with `npm start` from `/Users/dima/argus-launcher`.

