# Process Boundary

Argys is two apps.

## Argus Launcher

Launcher is the control plane. It talks to Supabase and stores cloud-backed
manager data:

- profiles
- proxies
- folders
- statuses
- shared bookmarks
- shared extensions
- per-profile command line switches
- API tokens

Argus Launcher starts browser sessions by spawning Argys Browser with explicit runtime
arguments. It never opens the dashboard inside a browser tab.

## Argys Browser

Browser is the anonymous data plane. It receives one profile launch payload and
opens a browser session.

Browser does not sign in to Supabase. Browser does not show the Argus Launcher table.
Browser does not manage cloud profiles.

## Launch Contract

Launcher passes:

- `--argus-profile-launch`
- `--argus-profile-id`
- `--argus-profile-name`
- `--argus-profile-icon` — absolute path to a PNG the launcher generated for
  this profile's colour and the user's current theme. The browser retints its
  own Dock tile from it (macOS only). It has to be passed rather than derived,
  because the artwork and the theme both live on the launcher side; and it has
  to be the browser that applies it, because all sessions share one bundle and
  the only per-session handle on a Dock tile is the running process.
- `--user-data-dir`
- proxy flags
- shared extension paths
- per-profile command line switches

The Browser process should treat those values as runtime input only.
