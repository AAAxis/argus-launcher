# Argus Launcher

Standalone manager app for Argus cloud data.

This app owns:

- Supabase login/session
- cloud-backed profiles, proxies, folders, statuses, bookmarks, shared extensions
- API tokens for each signed-in email
- launching Argus Browser with an anonymous runtime payload

This app does not embed Chromium browser UI. It only starts Argus Browser as a
separate process.

Argus Browser owns:

- profile runtime
- proxy application
- extension loading
- fingerprint flags
- cookies for the launched profile only

Argus Browser must not own Supabase login or cloud state.
