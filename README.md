# Argys Anty

Standalone manager app for Argys cloud data.

Agent handoff notes live in `AGENTS.md`. Read that file before changing,
building, or running the app.

This app owns:

- Supabase login/session
- cloud-backed profiles, proxies, folders, statuses, bookmarks, shared extensions
- API tokens for each signed-in email
- launching Argys Browser with an anonymous runtime payload

This app does not embed Chromium browser UI. It only starts Argys Browser as a
separate process.

Argys Browser owns:

- profile runtime
- proxy application
- extension loading
- fingerprint flags
- cookies for the launched profile only

Argys Browser must not own Supabase login or cloud state.
