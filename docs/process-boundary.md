# Process Boundary

Argys is two apps.

## Argys Anty

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

Argys Anty starts browser sessions by spawning Argys Browser with explicit runtime
arguments. It never opens the dashboard inside a browser tab.

## Argys Browser

Browser is the anonymous data plane. It receives one profile launch payload and
opens a browser session.

Browser does not sign in to Supabase. Browser does not show the Argys Anty table.
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
