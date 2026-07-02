# Process Boundary

Argus is two apps.

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

Launcher starts browser sessions by spawning Argus Browser with explicit runtime
arguments. It never opens the dashboard inside a browser tab.

## Argus Browser

Browser is the anonymous data plane. It receives one profile launch payload and
opens a browser session.

Browser does not sign in to Supabase. Browser does not show the launcher table.
Browser does not manage cloud profiles.

## Launch Contract

Launcher passes:

- `--argus-profile-launch`
- `--argus-profile-id`
- `--argus-profile-name`
- `--user-data-dir`
- proxy flags
- shared extension paths
- per-profile command line switches

The Browser process should treat those values as runtime input only.
