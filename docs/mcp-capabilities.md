# What an AI agent can do through the Argus MCP server

Scope: the 23 tools in `electron/mcp/tools.cjs`, the loopback automation API in
`electron/main.cjs` they call, and the renderer handlers in
`src/hooks/useAutomationBridge.ts` that actually answer.

Everything below is marked either **[verified]** — actually executed against the
running launcher over stdio JSON-RPC, exactly as an agent client would — or
**[read]** — inferred from the source, not run. Nothing that opens a browser
window or mutates state was executed.

Verification harness: the server was spawned with the same command, args and env
an agent client uses (`process.execPath` with `ELECTRON_RUN_AS_NODE=1` and the
user's own key), then driven with newline-delimited JSON-RPC. Launcher version
reported by the server: `1.0.55`.

---

## 1. The surface

**[verified]** `tools/list` returns exactly 23 tools:

| Tool | Backed by | Verified? |
|---|---|---|
| `argus_list_profiles` | `GET /v1/profiles` | verified |
| `argus_get_profile` | `POST /v1/profiles/get` | verified |
| `argus_profile_session` | `POST /v1/profiles/cdp` | verified |
| `argus_launch_profile` | `POST /v1/profiles/launch-automation` | read only |
| `argus_close_profile` | `POST /v1/profiles/close-automation` | read only |
| `argus_update_profile` | `POST /v1/profiles/update` | read only |
| `argus_list_proxies` | `GET /v1/proxies` | verified |
| `argus_assign_proxy` | `POST /v1/profiles/assign-proxy` | read only |
| `argus_check_proxy` | `POST /v1/proxies/check` | verified |
| `argus_list_tabs` | CDP `/json/list` | error path verified |
| `argus_navigate` | CDP `Page.navigate` | error path verified |
| `argus_read_page` | CDP `Runtime.evaluate` | read only |
| `argus_screenshot` | CDP `Page.captureScreenshot` | read only |
| `argus_eval` | CDP `Runtime.evaluate` | read only |
| `argus_list_automations` | `GET /v1/automations` | read only |
| `argus_automation_schema` | `GET /v1/automations/schema` | read only |
| `argus_get_automation` | `POST /v1/automations/get` | read only |
| `argus_create_automation` | `POST /v1/automations/create` | read only |
| `argus_update_automation` | `POST /v1/automations/update` | read only |
| `argus_delete_automation` | `POST /v1/automations/delete` | read only |
| `argus_run_automation` | `POST /v1/automations/run` | read only |
| `argus_table_columns` | `GET /v1/tables/columns` | read only |
| `argus_set_table_columns` | `POST /v1/tables/columns` | read only |

Eighteen tools are thin wrappers over loopback HTTP routes; five need a running
browser and speak CDP directly (`electron/mcp/cdp.cjs`).

The seven automations tools and the two table-column tools are **generated**
from `electron/api/routes.json` rather than written out, so their names,
descriptions and input schemas cannot drift from the routes they call. `scripts/verify-api-routes.mjs` checks the rest
of the table the same way. The nine profile/proxy wrappers above them are still
hand-written.

Two things about that surface worth stating plainly, because they are the
answers to the questions an agent asks first:

- **Automations are org-wide and have no folder.** A folder-scoped key may list,
  read and run them; only an unscoped key may create, change or delete one.
  Anything else would let a key granted one folder rewrite a workflow every
  other folder runs. Refusals are `403`.
- **Steps are validated in the main process before anything is stored**, by the
  same `validateSteps` the runner uses (`electron/automation/steps.cjs`). An
  agent cannot persist a workflow the runner would then refuse, and the error
  names the failing path (`steps[2].then[0].selector is required`).

**[verified]** The server is dual-era: it answers both `initialize` (returning
`protocolVersion: 2025-06-18`) and `server/discover` (returning
`supportedVersions: ["2026-07-28","2025-11-25","2025-06-18","2025-03-26","2024-11-05"]`).
`ping` works. `resources/list` returns `-32601 Method not found` — there are no
resources and no prompts, only tools (`electron/mcp/server.cjs:151-192`).

---

## 2. What an agent CAN do — verified by execution

### Enumerate profiles
`argus_list_profiles` returned five real profiles. The payload is deliberately
minimal — **`id` and `name` only**:

```json
{"status": true, "profiles": [
  {"id": "d77190bb-e59b-41bc-8286-e021c62fd6a1", "name": "Profile 10:31 PM"},
  {"id": "f8078410-9be3-40b6-a742-e73b1ecd81ea", "name": "mosley.caterina"},
  {"id": "69880ec5-5250-4e5d-b885-ab2590a2a025", "name": "ponce_shill"},
  {"id": "1792d3f2-0b3e-4a81-a486-2d04438aa930", "name": "kunze_elson"},
  {"id": "47868305-551f-4df9-ae1d-304064055849", "name": "adeshinayomi.alatalo.4097"}
]}
```

Shape fixed at `src/hooks/useAutomationBridge.ts:375-381`. Trashed profiles
(`deleted_at`) are filtered out. The optional `folder` argument works but is an
exact id match — passing an unknown folder returned `{"profiles": []}`, not an
error.

### Read one profile in full
`argus_get_profile` returns the whole row, including the complete fingerprint:

```
id, name, status ("Ready"), color, tags[], folder_id, proxy_id, proxy_mode,
start_url, cookie_import_path/url/name/count, cookie_mode ("saved"), cookie_id,
command_line_switches, created_at, deleted_at,
fingerprint: { os, audio, webgl, canvas, screen, webgpu, webrtc, language,
  timezone, cpu_cores, cpu_model, memory_gb, user_agent, geolocation,
  client_rects, do_not_track, webgl_vendor, media_devices, webgl_renderer,
  browser_version, rotate_on_launch }
```

### Enumerate proxies — **including plaintext credentials**
`argus_list_proxies` returned 11 proxies. Each row carries
`id, name, type, host, port, username, password, folder_id, country,
country_code, egress_ip, ping_ms, checked_at, assignedProfileIds[]`.

`username` and `password` are returned **in clear text**. This is the raw
`ArgusProxy` row spread wholesale (`src/hooks/useAutomationBridge.ts:229-237`).
Any agent connected to this MCP server has the user's full proxy credential set
in its context after one tool call.

### Check whether a profile is running
`argus_profile_session` answered entirely in the main process, no renderer round
trip (`electron/main.cjs:3736-3753`):
`{"status":true,"profileId":"…","running":false,"cdpUrl":null,"pid":null}`.

### Test a proxy
`argus_check_proxy` returned `{"ok":true,"ip":"206.251.200.232","country":"US","countryCode":"US","pingMs":497}`.
It runs `curl` in the main process against three geo-IP endpoints
(`electron/main.cjs:1663-1686`) and needs neither the renderer nor a signed-in
session (`electron/main.cjs:3865-3879`).

### Error handling that a model can actually recover from
Tool failures come back as `isError: true` content, not JSON-RPC errors
(`electron/mcp/server.cjs:91-97`) — verified:

- unknown profile → `"Profile not found"`, `isError: true`
- CDP tool on a closed profile → `"Profile <id> is not open. Call argus_launch_profile first."`
- unknown tool name → JSON-RPC `-32602`
- bogus bearer token → `"Missing or invalid Authorization bearer token"`
- missing token → same, plus a stderr warning at startup
  (`electron/mcp/server.cjs:250-253`)

---

## 3. What an agent can do in principle — read from code, NOT executed

These were deliberately not run (they open real windows, kill sessions, or write
to the user's account).

- **`argus_launch_profile`** — `POST /v1/profiles/launch-automation`
  (`electron/main.cjs:3843-3914`, `4008-4014`). Allocates a free loopback port,
  forwards to the renderer, which calls `spawnProfile` with
  `--remote-debugging-port=<port> --remote-allow-origins=*`
  (`src/hooks/useAutomationBridge.ts:389-413`). Main waits up to 15 s for
  `/json/version` to answer, then records the session in `automationLaunches`
  keyed by profile id with the launching key's id, and returns
  `{profileId, cdpUrl, pid}` (`electron/main.cjs:3447-3473`). If the profile is
  already open it returns `{reused: true}` instead of restarting, unless
  `relaunch: true`. The automation path deliberately skips the interactive
  proxy-retry UI **and skips fingerprint rotate-on-launch**
  (`src/hooks/useAutomationBridge.ts:384-388`) — automated runs get a stable
  fingerprint, unlike the Launch button.
- **`argus_close_profile`** — kills only sessions this process tracks; a window
  a human opened by hand is never reachable (`electron/main.cjs:3116-3120`,
  `3237-3261`).
- **`argus_update_profile`** — sets `name`, `tags` (capped at 5 by
  `normalizeTags`), `status`, `color`, `folderId`
  (`electron/main.cjs:3977-3994`, `src/hooks/useAutomationBridge.ts:294-313`).
- **`argus_assign_proxy`** — resolves a proxy by id (or host/port) and writes
  `proxy_id` + `proxy_mode: 'assigned'` (`src/hooks/useAutomationBridge.ts:190-212`).
- **CDP tools** (`electron/mcp/cdp.cjs`):
  - `argus_list_tabs` — `GET <cdpUrl>/json/list`, filtered to `type === 'page'`,
    returning `{id, title, url}` (`cdp.cjs:295-299`).
  - `argus_navigate` — `Page.navigate` + wait for `Page.frameStoppedLoading`,
    30 s cap; returns `{loaded, url, title}` and reports `loaded: false` rather
    than failing if the page never settles (`cdp.cjs:207-231`).
  - `argus_read_page` — `el.innerText` of `document.body` or a CSS selector,
    truncated to 20 000 chars by default (`cdp.cjs:233-254`, `tools.cjs:17`).
  - `argus_screenshot` — JPEG q70 by default, PNG on request, optional
    `captureBeyondViewport`; returns a text caption plus an image block
    (`cdp.cjs:273-293`, `tools.cjs:222-235`).
  - `argus_eval` — **arbitrary JavaScript** with `returnByValue` and
    `awaitPromise` (`cdp.cjs:256-269`). This is the only way to interact with a
    page; see §6.

---

## 4. What an agent CANNOT do

### 4a. Deliberately omitted

`electron/mcp/tools.cjs:9-13` states the rule: destructive and bulk-import
routes are not exposed, and can be added behind an explicit opt-in. These routes
exist and work over HTTP but have **no MCP tool**:

| Route | Effect withheld from agents |
|---|---|
| `POST /v1/profiles/delete` | soft-delete or permanent purge of a profile |
| `POST /v1/profiles/update-fingerprint` | merge arbitrary fingerprint fields |
| `POST /v1/proxies/create` | add a proxy to the library |
| `POST /v1/proxies/update` | edit a proxy |
| `POST /v1/proxies/delete` | delete a proxy (unassigns profiles) |
| `POST /v1/proxies/reimport` | bulk proxy import |
| `POST /v1/cookies/bulk-match` | match a cookies folder onto profiles |
| `POST /v1/cookies/push-local` | write a cookie snapshot into a profile |
| `POST /v1/monitoring/report` | write a monitoring result to Supabase |

Note the header comment names `proxies/create` but not `proxies/update` or
`proxies/delete`; all three are in fact omitted, which is consistent with the
stated intent.

### 4b. Not built — no route exists at all

**[verified]** `POST /v1/profiles/create`, `POST /v1/folders/list` and
`GET /v1/cookies` all return `404 {"status":false,"msg":"Not found"}` with a
valid token. The route allow-list is the pathname chain at
`electron/main.cjs:3687-3706`; anything not on it 404s.

Compared against what the app itself can do, an agent has **no** way to:

- **Create a profile.** No create route exists. Agents can only drive profiles a
  human already made (`src/components/modals/ProfileModal.tsx:44`,
  `src/workspace/useProfileActions.ts:56`).
- **Duplicate, restore from Trash, or purge.** (`useProfileActions.ts:117,126`)
- **Import or export profiles as CSV.** (`useProfileActions.ts:242,319`)
- **See or manage folders.** No route lists folders — yet
  `argus_list_profiles.folder` and `argus_update_profile.folderId` both take a
  folder id. The only way an agent can learn a folder id is by reading
  `folder_id` off a profile it can already see. Creating, renaming and deleting
  folders (`src/workspace/useLibraryActions.ts:64,74,90`) are all unreachable.
- **See or create statuses.** `argus_update_profile.status` is a free string;
  custom statuses live in `custom_statuses` (`useLibraryActions.ts:115`) and are
  never listed. An agent can write a status the UI does not offer.
- **Touch cookies at all.** The whole cookie library — upload a set, edit
  entries, duplicate, trash, assign a set to profiles, export JSON/Netscape
  (`src/workspace/useCookieActions.ts:100,131,168,249,358`) — has no MCP
  surface. `cookie_id` is readable via `argus_get_profile` and nothing more.
- **Manage extensions.** Install from the Web Store or a folder, enable/disable
  (`useLibraryActions.ts:197,242,261,273,291`). Not exposed.
- **Manage bookmarks / the start page.** (`useLibraryActions.ts:136,164,183`)
- **Edit fingerprints.** The route exists but is deliberately withheld (§4a).
  Agents can read a fingerprint and not change it.
- **Set `proxy_mode`.** `argus_update_profile` does not accept it and
  `argus_assign_proxy` always forces `'assigned'`. An agent can never move a
  profile to Direct or Free Proxy, nor back.
- **Set the start URL, command-line switches, or the profile's account
  email/password** through a declared tool parameter (all editable in the UI at
  `ProfileModal.tsx:382,392,400,488`). See the caveat in §4c.
- **Manage account, org, plan, API keys or integrations.** Nothing under
  `src/settings/` is reachable.
- **Control tabs.** `argus_list_tabs` returns tab ids, but no tool accepts one.
  There is no open-tab, close-tab or switch-tab. Every CDP tool silently targets
  whatever `pageTarget()` picks — the first `http(s)` page in `/json/list`, else
  the first page (`electron/mcp/cdp.cjs:67-76`). "Active page" in the tool
  descriptions is a fiction; it is "first page found".
- **Interact with a page.** There is no click, type, hover, scroll, select,
  upload, wait-for-selector or cookie-jar tool. The only lever is `argus_eval`.

### 4c. Looks like an oversight, not intent

1. **`argus_update_profile` declares a `notes` parameter that does nothing.**
   `tools.cjs:124` advertises `notes`; the route maps only `name`, `tags`,
   `status`, `color`, `folder_id`, `email`, `password`
   (`electron/main.cjs:3982-3989`). There is no notes field on `ArgusProfile` at
   all. An agent writing notes gets a silent success.
2. **`argus_update_profile` forwards every argument it is given.** Its `run` is
   `api.post('/v1/profiles/update', args)` (`tools.cjs:129`) — the whole
   arguments object, unfiltered. The schema does not set
   `additionalProperties: false`, so a model that passes `email` or `password`
   will have them written to the profile even though neither is a documented
   parameter.
3. **`argus_check_proxy` declares `type` and the route drops it.**
   `tools.cjs:162` documents `type: 'http or socks5'`; the handler passes only
   `{host, port, username, password}` to `checkProxy`
   (`electron/main.cjs:3871-3876`), so `proxyUrl` always builds `http://…`
   (`electron/main.cjs:1602-1605`). **[verified]** identical results with
   `type: "socks5"` and with no type at all. A socks5-only proxy will be
   reported dead.
4. **`argus_assign_proxy`'s description is wrong.** It says "direct connection
   is not allowed" (`tools.cjs:140-141`). `ProxyMode` is
   `'assigned' | 'direct' | 'free_proxy'` (`src/types.ts:59`), all three are
   selectable in the UI (`ProfileModal.tsx:239-251`), and the launch path only
   requires a proxy when the mode is `'assigned'`
   (`src/hooks/useAutomationBridge.ts:402-407`). The accurate statement is: *a
   profile in the default `assigned` mode needs a valid, reachable proxy, and
   MCP cannot change the mode.*
5. **The server instructions claim launched sessions are anonymous.**
   `electron/mcp/server.cjs:52-53` and `tools.cjs:83` both tell the model "the
   browser session is anonymous — never pass it credentials." A profile's
   assigned cookie set is seeded into the launch payload
   (`src/lib/launch.ts:23-25,62-69`), so a launched profile is frequently
   **logged into real accounts**. The profile read above carries
   `cookie_mode: "saved"` and a live `cookie_id`. The instruction is true about
   *not sending new* credentials and misleading about what is already there.
6. **Folder scoping is not enforced on the write routes.** See §5a — this is the
   most serious of the six.

---

## 5. Limits, scoping and failure modes

### 5a. Folder scoping — enforced on reads, missing on writes

A key is either full-access (`folderScope: null`) or restricted to an explicit
list of folder ids (`electron/main.cjs:3037-3067`). Main forwards
`allowedFolders: key.folderScope` to the renderer, and the renderer enforces it.

Enforced:

| Route | Where |
|---|---|
| `GET /v1/profiles` | `main.cjs:3669` → `useAutomationBridge.ts:379` |
| `POST /v1/profiles/get` | `main.cjs:3975` → `useAutomationBridge.ts:219` |
| `POST /v1/profiles/delete` | `main.cjs:4000` → `useAutomationBridge.ts:328` (re-reads from the DB rather than the render cache, because it is an authorization gate) |
| `POST /v1/profiles/launch-automation` | `main.cjs:4013` → `useAutomationBridge.ts:398-400` |

**Not enforced — `allowedFolders` is never sent and never checked:**

| Route | Where |
|---|---|
| `POST /v1/profiles/update` | `main.cjs:3990-3994`, `useAutomationBridge.ts:294-313` |
| `POST /v1/profiles/assign-proxy` | `main.cjs:3963-3970`, `useAutomationBridge.ts:190-212` |
| `POST /v1/profiles/update-fingerprint` | `main.cjs:4002-4007`, `useAutomationBridge.ts:355-370` |
| `GET /v1/proxies` | `main.cjs:3673-3686` — the full library, credentials included, regardless of scope |
| all `/v1/proxies/*` writes | no scope plumbing at all |

Two consequences, both **[read]**, not executed:

- A folder-scoped key can rename, retag, restatus, recolour and **re-folder any
  profile in the account**, including ones it cannot see. `folderId` is a
  settable field.
- That is a scope escape: move an out-of-scope profile into an in-scope folder
  with `argus_update_profile`, then `argus_get_profile` and
  `argus_launch_profile` it legitimately.

Scoping is also not a secret-hiding boundary: `argus_list_proxies` hands every
key the whole proxy library in clear text.

**[verified]** When a scoped key does hit an enforced check, the MCP layer
rewrites the 403 into a message that names the cause:
`"…. This connection's key is scoped to specific folders."`
(`electron/mcp/server.cjs:121-126`).

### 5b. Session ownership and launcher restarts

`resolveProfileCdp` (`electron/main.cjs:3187-3216`) resolves a running session in
two tiers:

1. `automationLaunches`, an in-process map, liveness-checked with
   `GET /json/version`. A stale entry is dropped so `close-automation` cannot
   later kill a recycled pid.
2. Failing that, Chromium's `DevToolsActivePort` file inside the profile's own
   user-data-dir — which survives a launcher restart. A session re-adopted this
   way is recorded with `pid: null` and **`launchedByKeyId: null`**.

`maySeeAutomationSession` (`electron/main.cjs:3230-3235`): a full-access key sees
everything; a folder-scoped key sees only sessions carrying its own
`launchedByKeyId`.

The consequence, documented in the source and worth restating: **after the
launcher restarts, a folder-scoped key can no longer see, drive or close even
its own still-running session** — the re-adopted entry has no owner, so the
scoped check denies it. It must relaunch. Full-access keys are unaffected.

Closing is guarded separately at `electron/main.cjs:3722-3729`: a scoped key
gets 403 if the tracked session was launched by a different key. Killing an
untracked session falls back to `killStaleProfileProcess` rather than signalling
pid `null`, which on POSIX would signal the launcher's own process group
(`electron/main.cjs:3243-3250`).

Sessions a **human** opened with the Launch button are not in
`automationLaunches` at all — but they still write `DevToolsActivePort`… without
`--remote-debugging-port`, so no port is bound and the file resolves to nothing
drivable. In practice CDP tools only reach automation-launched windows.

### 5c. Hard dependencies

| Condition | What the agent sees |
|---|---|
| Launcher not running | `"Argus Launcher is not running, or its local API is not ready yet"` — `ECONNREFUSED` is translated (`electron/mcp/api.cjs:62-66`) |
| Launcher window closed (`mainWindow === null`, `main.cjs:923-928`) | HTTP 503 `"Argus Launcher window is not open"` on every renderer-backed route (`main.cjs:3656,3674,3755`). On macOS the app survives window close, so the API stays up and returns 503 for reads/writes. |
| Window busy / renderer wedged | HTTP 504 `"Timed out waiting for Argus Launcher to respond"` after **`AUTOMATION_REQUEST_TIMEOUT_MS = 20000`** (`main.cjs:2976`), surfaced verbatim as an `isError` tool result. The MCP HTTP client's own cap is 30 s (`electron/mcp/api.cjs:11`), so the server-side 504 normally wins. |
| **Signed out** | **Silent empty results.** See below. |

Two routes are answered entirely in the main process and keep working while the
window is closed or the renderer is wedged: `POST /v1/profiles/cdp`
(`main.cjs:3736`) and `POST /v1/proxies/check` (`main.cjs:3865`). The five CDP
tools also keep working, since they only need the port.

**Signed-out behaviour — [verified], and the worst failure mode here.**
`useAutomationBridge` is mounted unconditionally at `src/App.tsx:87`, above the
sign-in early return at `src/App.tsx:140-141`. When there is no session, cloud
state stays `defaultCloudState` — every array empty
(`src/data/statuses.ts:23-34`). The bridge therefore answers, successfully, with
nothing. During this investigation the app moved from signed-in to signed-out
between probe runs and the difference was directly observable:

```
10:01  argus_list_profiles → 5 profiles;  argus_list_proxies → 11 proxies
10:06  argus_list_profiles → {"status": true, "profiles": []}
       argus_list_proxies  → {"status": true, "proxies": []}
       argus_get_profile("d77190bb-…")  → isError "Profile not found"
```

HTTP 200, `status: true`, `isError: false`. An agent cannot distinguish
"signed out" from "this account has no profiles", and a profile it read
successfully five minutes earlier now reports as not found. Nothing in the
response mentions authentication.

### 5d. Profile launch preconditions

**[read]** In order, a launch needs:

1. The profile to exist and not be trashed (`useAutomationBridge.ts:394-397`).
2. The key's folder scope to allow it (`useAutomationBridge.ts:398-400`).
3. **If `proxy_mode` is `'assigned'` (the default when unset): a proxy with both
   host and port**, or the launch fails with
   `"Proxy for <name> is invalid"` (`useAutomationBridge.ts:401-407`).
   Modes `'direct'` and `'free_proxy'` launch with no proxy — so the blanket
   claim that direct connection is disabled is **not** accurate; what is
   accurate is that MCP cannot set the mode, so from an agent's point of view a
   profile is whatever mode a human left it in.
4. A resolvable browser binary. If Argys Browser is still downloading the error
   is explicit (`electron/main.cjs:2033-2046`).
5. **The proxy to actually answer.** `spawnProfileUnchecked` runs a live
   `checkProxy` before spawning and fails closed:
   `"Proxy <host>:<port> did not respond … Fix the proxy in Argus Launcher and
   try again."` (`electron/main.cjs:2047-2064`). Budget: 6 s connect, 10 s total
   per endpoint, three endpoints in parallel.
6. CDP to come up within 15 s of the renderer reporting success
   (`electron/main.cjs:3461`).

**Timeout arithmetic worth knowing [read]:** the renderer round trip may take up
to 20 s and the CDP wait a further 15 s, for a worst case near 35 s — beyond the
MCP client's 30 s HTTP cap (`electron/mcp/api.cjs:11`). A slow launch can be
reported to the agent as a timeout while the browser is in fact coming up. The
agent's correct recovery is `argus_profile_session`, not a retry.

### 5e. CDP-layer limits

- One WebSocket per tool call, opened and closed each time
  (`electron/mcp/cdp.cjs:14-17`) — no state, no cursors, no handles.
- Command timeout 30 s, connect timeout 10 s, navigation settle 30 s
  (`cdp.cjs:22-26`).
- `argus_read_page` truncates at 20 000 characters and returns `innerText`, so
  it sees no `<title>`-less SPA shells, no shadow DOM, no iframes, and nothing
  the layout hides.
- `argus_screenshot` defaults to JPEG q70 explicitly to keep bytes out of the
  agent's context (`cdp.cjs:271-272`).
- If the profile has no page at all: `"That profile has no open page to drive"`
  (`cdp.cjs:73`).

---

## 6. Security notes an operator might not expect

1. **Proxy credentials leave the machine with the agent.** One
   `argus_list_proxies` call puts every proxy username and password into the
   agent's context, and therefore into whatever the agent's transcript is
   uploaded to. **[verified]**
2. **`argus_eval` is unrestricted JavaScript in a session that is often logged
   in.** Combined with the cookie seeding in `src/lib/launch.ts:62-69`, an agent
   that can launch a profile can act as the account that profile belongs to —
   read mail, post, transfer, exfiltrate — and the server's own instructions
   tell the model the session is anonymous. There is no allow-list of origins,
   no confirmation step, and no audit trail beyond `lastUsedAt` on the key.
3. **The token lives in plaintext, world-readable.** The key store itself is
   written `0600` (`electron/main.cjs:3034`), but the token is copied into the
   agent's own config — on this machine `~/.claude.json`, mode `-rw-r--r--`.
   Any local process, or any other agent, can read it and drive the API.
4. **CORS preflight is fully permissive.** `OPTIONS` is answered before
   authentication with `Access-Control-Allow-Origin: *`,
   `Access-Control-Allow-Methods: GET, POST, OPTIONS` and
   `Access-Control-Allow-Headers: Content-Type, Authorization`
   (`electron/main.cjs:3626-3633`) — **[verified]** including from
   `Origin: https://evil.example`. Actual responses carry **no**
   `Access-Control-Allow-Origin`, so a cross-origin page cannot *read* replies;
   but the preflight succeeds, so a page holding a leaked token can still fire
   side-effecting `POST`s blind. `/health` is likewise unauthenticated and
   confirms the app is installed and running to any web page. **[verified]**
5. **No key expiry, no rate limit, no scope beyond folders.** `createAutomationKey`
   (`electron/main.cjs:3048-3067`) records no TTL and no read/write distinction.
   Revocation is manual, from the API tab.
6. **`argus_check_proxy` is an outbound-connection primitive.** It takes an
   arbitrary host and port from the agent and runs `curl --proxy` against three
   external endpoints (`electron/main.cjs:1614-1686`), needing neither the
   renderer nor a signed-in session. Timing differences make it usable as a
   crude port prober, and it will happily attempt credentials the agent supplies
   against a host the user never configured.

---

## 7. Recommendations, ranked

1. **Enforce `folderScope` on `profiles/update`, `profiles/assign-proxy` and
   `profiles/update-fingerprint`.** Today a scoped key can re-folder any profile
   in the account and thereby escalate into full access — the scope is a read
   filter, not an authorization boundary. (`main.cjs:3963-4007`)
2. **Stop returning proxy passwords from `GET /v1/proxies`.** Redact
   `username`/`password`, or return a `hasCredentials` boolean. Nothing an agent
   does with the current tool set needs them — `argus_assign_proxy` takes a
   `proxyId`. (`useAutomationBridge.ts:229-237`)
3. **Distinguish "signed out" from "empty".** Have the bridge return an explicit
   error (or main return 503) when `orgId` is null, instead of a successful empty
   array. An agent silently told "you have no profiles" will confidently report
   the wrong thing. (`src/App.tsx:87,140`; `src/data/statuses.ts:23`)
4. **Fix the two descriptions that mislead the model.** Drop "direct connection
   is not allowed" (`tools.cjs:140-141`) and replace "the browser session is
   anonymous" with the truth — the profile may carry a live cookie set
   (`server.cjs:52`, `tools.cjs:83`). A model that believes a session is
   anonymous will treat it as safe to point at anything.
5. **Add page-interaction tools: click, type, wait-for-selector.** Right now
   every interaction has to go through `argus_eval` and `element.click()`, which
   produces untrusted DOM events — precisely the signature an anti-detect
   browser exists to avoid. Synthesising real input via
   `Input.dispatchMouseEvent`/`dispatchKeyEvent` would make the integration fit
   the product.
6. **Make tabs addressable.** `argus_list_tabs` returns ids no other tool
   accepts, and every CDP tool silently drives the first `http(s)` page it finds
   (`cdp.cjs:67-76`). Either accept a `tabId` argument or stop advertising the
   list.
7. **Add a read-only folder/status listing tool.** `folder` and `folderId`
   arguments exist with no way to discover valid values, and `status` is a free
   string that can be set to something the UI never offers.
8. **Drop the dead `notes` parameter, honour `type` in `proxies/check`, and set
   `additionalProperties: false` on `argus_update_profile`.** Three small
   correctness fixes: a parameter that silently does nothing
   (`tools.cjs:124`), a parameter silently discarded so socks5-only proxies
   read as dead (`main.cjs:3871-3876`), and an unfiltered passthrough that lets
   undeclared `email`/`password` reach the account row (`tools.cjs:129`).
9. **Consider exposing profile creation behind an opt-in.** It is the single
   largest "the app can, the agent cannot" gap — an agent can drive a fleet but
   cannot grow one — and unlike deletion it is not destructive.
