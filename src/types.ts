import type {
  AutomationStep,
  AutomationVars,
  RunLogEntry,
  RunStatus,
  RunTrigger,
} from './automations/types';

// Mirrors argus::Fingerprint's JSON dict keys (chrome/browser/argus/
// argus_fingerprint.cc ToDict/FromDict) so it can be dropped straight into
// --argus-fingerprint-json for the browser to apply verbatim. timezone,
// languages, latitude, and longitude are left undefined when the profile is
// set to derive them from the assigned proxy's country -- electron/main.cjs
// fills those in (reusing its existing COUNTRY_DEFAULTS resolution) right
// before the payload is serialized, so that logic stays in exactly one place.
export type RuntimeFingerprint = {
  platform?: string;
  ua_string?: string;
  preset?: string;
  seed: number;
  webrtc_mode?: string;
  canvas_mode?: string;
  webgl_mode?: string;
  webgpu_mode?: string;
  client_rects_mode?: string;
  audio_mode?: string;
  webgl_vendor?: string;
  webgl_renderer?: string;
  timezone?: string;
  languages?: string[];
  geolocation_mode?: string;
  latitude?: number;
  longitude?: number;
  cpu_cores?: number;
  memory_gb?: number;
  // Real, engine-level (not JS-shimmed) mobile signals -- see the matching
  // Fingerprint::touch_points/sensor_mode/battery_* fields in
  // chrome/browser/argus/argus_fingerprint.h for what each one actually
  // does browser-side. Derived automatically from platform in
  // buildRuntimeFingerprint() below, same as webrtc_mode/canvas_mode etc --
  // not user-editable fields of their own.
  touch_points?: number;
  sensor_mode?: string;
  battery_spoof?: boolean;
  battery_level?: number;
  battery_charging?: boolean;
  screen?: string;
  media_devices?: string;
  ports_to_protect?: string;
  do_not_track?: boolean;
  rotate_on_launch?: boolean;
};

// How this profile connects: 'assigned' requires a real proxy_id (the
// existing, default behavior); 'direct' explicitly opts out of any proxy
// (no fallback extension either); 'free_proxy' explicitly opts into the
// bundled FoxyWall Proxy extension as a fallback. Undefined means 'assigned'
// for backward compatibility with profiles saved before this field existed.
export type ProxyMode = 'assigned' | 'direct' | 'free_proxy';

export type ArgusProfile = {
  id: string;
  name: string;
  status?: string;
  color?: string;
  // What the profiles table draws in the Name column instead of the initials
  // plate. One text column carrying a tagged union, the same shape folders.icon
  // uses for `flag:US` alongside its FOLDER_ICONS keys:
  //
  //   'brand:<slug>'  one of the TAG_PRESETS slugs (src/data/tagPresets.ts),
  //                   drawn as that brand's own mark
  //   'https://…'     a picture, uploaded to the `global` bucket or pasted
  //   undefined       the initials plate, which is what every profile had
  //                   before this field existed
  //
  // Anything else downgrades to the initials plate client-side, so removing a
  // brand from the catalog costs a profile its logo rather than breaking it.
  // Parsed in exactly one place: src/lib/profileAvatar.ts.
  avatar?: string;
  tags?: string[];
  // Login credentials for whatever account this profile is logged into.
  // Stored in plaintext the same way ArgusProxy.password already is -- no
  // separate encrypted store, consistent with the rest of this app's model.
  email?: string;
  password?: string;
  folder_id?: string | null;
  proxy_id?: string | null;
  proxy_mode?: ProxyMode;
  start_url?: string | null;
  cookie_import_path?: string | null;
  cookie_import_url?: string | null;
  cookie_import_name?: string | null;
  cookie_import_count?: number | null;
  // 'saved' resolves cookie_id against CloudState.cookies at launch time
  // (see ArgusCookie); undefined/'paste' uses the cookie_import_* fields
  // above instead.
  cookie_mode?: 'paste' | 'saved';
  cookie_id?: string | null;
  // The automation that runs when this profile launches, or null for none.
  // One per profile on purpose: the on-launch trigger fires exactly once, so
  // "what runs when I click Launch" must have exactly one answer -- the same
  // argument cookie_id above is built on, and why neither has a join table.
  //
  // Attaching one is also what opens --remote-debugging-port for that launch.
  // A profile with no automation gets no port, because an always-open debug
  // port is connectable by any local process and CDP attachment is observable
  // from the page.
  automation_id?: string | null;
  command_line_switches?: string | null;
  fingerprint?: {
    os?: string;
    browser_version?: string;
    user_agent?: string;
    language?: string;
    timezone?: string;
    geolocation?: string;
    webrtc?: string;
    canvas?: string;
    webgl?: string;
    webgpu?: string;
    client_rects?: string;
    audio?: string;
    webgl_vendor?: string;
    webgl_renderer?: string;
    screen?: string;
    cpu_model?: string;
    cpu_cores?: number | null;
    memory_gb?: number | null;
    media_devices?: string;
    do_not_track?: boolean;
    rotate_on_launch?: boolean;
  };
  created_at?: string;
  // Who made this profile, as an auth user id. Resolved to a name through
  // CloudState.members, which is why the Profiles table only shows the column
  // once there is more than one member to tell apart.
  //
  // Null on every row created before 2026-08-05-teams.sql set the column's
  // default to auth.uid(): the column existed and was selected all along, but
  // nothing ever wrote it. Those rows render "—" rather than being backfilled
  // to the owner, because guessing an author is worse than admitting to none.
  created_by?: string | null;
  // Who is on the hook for this row, as an auth user id. Distinct from
  // created_by, which never changes: authorship is history, an assignment is a
  // current fact and moves when work is handed over. Null means unclaimed.
  //
  // NOT a permission. Everyone in the org sees every profile either way -- see
  // the note on Handoff.
  assigned_to?: string | null;
  // Soft-delete timestamp (ISO 8601). Set when a profile is moved to Trash;
  // the profile is hidden from the normal profiles list but kept for 30 days
  // (auto-purged on the next app launch after that) so an accidental delete
  // can be restored.
  deleted_at?: string | null;
};

export type ArgusFolder = {
  id: string;
  name: string;
  // Which library this folder belongs to. Profile, proxy and cookie-set folders
  // all share one `folders` table -- the column exists so they stay separate
  // namespaces rather than one pile the user has to read twice. Undefined
  // means 'profile', the column's default and what every row predating proxy
  // folders is.
  //
  // There is no CHECK on the column, so a fourth library needs no migration --
  // only a wider union here and a matching branch in the load-time split.
  kind?: 'profile' | 'proxy' | 'cookie';
  // A key into FOLDER_ICONS (src/data/folderIcons.ts), or a "flag:<ISO>" key
  // for a country flag -- never a URL or markup, so an unknown value can only
  // ever downgrade to the plain folder glyph.
  icon?: string;
  // A PROFILE_COLORS key or a custom #rrggbb, read through profileColorStyle()
  // exactly like ArgusProfile.color. Tints the folder's glyph in the rail and
  // in the profiles table; the card itself stays neutral.
  color?: string;
  created_at?: string;
};

export type ArgusProxy = {
  id: string;
  name: string;
  type?: 'http' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
  // The proxy-kind folder this proxy is filed under, or null for "All proxies".
  // Same shape and same ON DELETE SET NULL as ArgusProfile.folder_id.
  folder_id?: string | null;
  country?: string;
  country_code?: string;
  egress_ip?: string;
  ping_ms?: number;
  checked_at?: string;
  check_error?: string;
  // Who is on the hook for this proxy. See ArgusProfile.assigned_to.
  assigned_to?: string | null;
};

// A shared, reusable cookie-set in the Cookies tab library. A set is attached
// to a profile through ArgusProfile.cookie_id (profiles.cookie_set_id): a
// profile carries at most one set, a set may be used by any number of
// profiles. The FK is the whole model -- there is no join table and there must
// not be one, or "which cookies does this profile launch with" stops having a
// single answer.
//
// `url` is a Supabase Storage public URL (or a data: URL fallback), produced by
// the exact same upload path as the per-profile cookie_import_url flow (see
// cloudCookieFromSelection) -- so the launch payload consumes it identically,
// no separate backend handling needed. It stays the source of truth for a
// launch: electron/main.cjs fetches it and holds no Supabase credentials.
//
// The cookies themselves are deliberately NOT on this type. They live in the
// cookie_sets.cookies jsonb column and are loaded on demand by the inspector --
// a workspace with 200 sets would otherwise pull every payload on every load,
// and useCloudData reloads on window focus.
export type ArgusCookie = {
  id: string;
  name: string;
  url: string;
  count?: number | null;
  // The cookie-kind folder this set is filed under, or null for
  // "All cookie-sets". Same shape and same ON DELETE SET NULL as
  // ArgusProfile.folder_id.
  folder_id?: string | null;
  // Free text, capped at MAX_PROFILE_TAGS and read through the same tag catalog
  // profiles use -- a set tagged "instagram" and a profile tagged "Instagram"
  // are the same idea and render alike.
  tags?: string[];
  created_at?: string;
  updated_at?: string;
  // Who is on the hook for this set. See ArgusProfile.assigned_to. Distinct
  // from "assigned to profiles", which is what cookie_set_id does -- that says
  // which profiles USE it, this says which person looks after it.
  assigned_to?: string | null;
  // Soft-delete timestamp, the same 30-day contract as ArgusProfile.deleted_at.
  // Trashing a set also unassigns every profile using it, because a trashed set
  // that could still seed a launch would be a lie.
  deleted_at?: string | null;
};

export type SharedExtension = {
  // Stable id (generated at add-time) used as the local cache-directory name
  // every team member materializes this extension into -- the actual files
  // are never stored directly in cloud state, only enough to fetch/rebuild
  // them locally on any machine.
  id: string;
  name?: string;
  source: 'local' | 'webstore';
  // source === 'webstore': downloaded/unpacked fresh from Google's own CDN
  // by each team member, so it's always the current published version and
  // never re-hosted by us.
  webstoreId?: string;
  // source === 'local': a public Supabase Storage URL for the zipped
  // folder, uploaded once by whoever added it; every other team member
  // downloads+unpacks it into their own local cache the first time they
  // launch a profile that uses it.
  storageUrl?: string;
  // Whether profiles actually launch with it. Undefined/missing means enabled,
  // the same convention BuiltInExtensionToggles uses below, so rows written
  // before the column existed keep loading. Installed-but-off is a real state:
  // it keeps the extension in the org's library (and out of every profile)
  // without anyone having to re-find it in the store to turn it back on.
  enabled?: boolean;
};

export type SharedBookmark = {
  // Row id (uuid) once the bookmark has been persisted. The UI still
  // identifies a bookmark by its normalized url -- id only exists so an edit
  // or delete can address the exact row instead of matching on url server-side.
  id?: string;
  title: string;
  url: string;
  icon?: string;
  // Display order, written from the array index. Rows are read back ordered by
  // it so the list is stable across machines.
  position?: number;
};

// Per-extension on/off switches for the bundled (non-removable) "stock"
// extensions -- these ship with every install (cookie-manager, SMS-Activate)
// or are conditionally bundled per profile (foxywall_free_proxy, gated on a
// profile's proxy_mode === 'free_proxy'). Undefined/missing means enabled,
// for backward compatibility with cloud state saved before this existed.
export type BuiltInExtensionToggles = {
  cookie_manager?: boolean;
  sms_activate?: boolean;
  foxywall_free_proxy?: boolean;
};

// A workflow: an ordered list of steps driven against one profile's browser
// over CDP. The steps themselves are typed in src/automations/types.ts.
//
// Saved automations are documents, not assets -- nothing on disk belongs to
// one, so there is no deleted_at and no Trash. Deleting one detaches the
// profiles pointing at it (ON DELETE SET NULL) and leaves its runs readable,
// which is what automation_name on AutomationRun is for.
export type ArgusAutomation = {
  id: string;
  name: string;
  description?: string | null;
  steps: AutomationStep[];
  // Seed values every run starts with, before any setVar or extract.
  variables?: AutomationVars;
  // Free text, at most 5, normalized through normalizeTags on every write --
  // the same contract profiles.tags has, and the same catalog behind the
  // suggestions, so "facebook" means the same thing on both.
  tags?: string[];
  // Shows as a tile on every profile's generated start page. Org-wide: the
  // per-profile slot is ArgusProfile.automation_id, and pins are the
  // many-to-many case that would otherwise need a join table.
  pinned?: boolean;
  // Whole-run ceiling. The runner also caps every individual step.
  timeout_ms?: number;
  // Whether to close the browser when the run ends. Defaults false for runs a
  // human is watching (on-launch, start-page) and true for MCP and API runs,
  // where nobody is looking at the window.
  close_on_finish?: boolean;
  created_at?: string;
  updated_at?: string;
  // Who is on the hook for this automation. See ArgusProfile.assigned_to.
  assigned_to?: string | null;
};

// One execution. Written when the run starts, not when it finishes, so a crash
// still leaves a record -- a run that vanishes without one is the worst
// outcome. The runner mirrors this to <userData>/AutomationRuns/<id>/run.json
// on every status change and flushes it here on next launch, which is what
// makes history honest when the window was closed mid-run.
export type AutomationRun = {
  id: string;
  automation_id?: string | null;
  // Denormalized at write time so a run still reads after its automation is
  // deleted.
  automation_name: string;
  profile_id?: string | null;
  profile_name: string;
  trigger: RunTrigger;
  status: RunStatus;
  started_at: string;
  finished_at?: string | null;
  duration_ms?: number | null;
  step_count: number;
  failed_step_id?: string | null;
  error?: string | null;
  vars: AutomationVars;
  log: RunLogEntry[];
};

// The tenant. One client firm is one org; its workers are org_members. Every
// row in every table below hangs off organizations.id, and RLS keys on it --
// see docs/data-model.md. profile_limit null means unlimited (Enterprise).
export type ArgusOrg = {
  id: string;
  name: string;
  plan: string;
  profile_limit: number | null;
  seat_limit: number;
  billing_status: string;
  current_period_end?: string | null;
  built_in_extensions?: BuiltInExtensionToggles;
  // How many automations this org may save. null is unlimited, the same
  // convention profile_limit uses; the database default is 0, so an org on a
  // plan without automations cannot create one and every automation route
  // refuses it. A column rather than a lookup on `plan` on purpose -- the site
  // and the database disagree about plan keys (landing/LANDING.md:96-128), and
  // an integer means the launcher never has to know which spelling is live.
  automation_limit?: number | null;
  // Who the workspace belongs to, answered once at onboarding and editable in
  // Settings. Descriptive only -- nothing above this line is derived from it.
  //
  // `legal_name` is deliberately not `name`. `name` is what this workspace is
  // called and an owner may rename it to "Client accounts" whenever they like;
  // `legal_name` is the business behind it and stays put. Collapsing them would
  // make "which company is this" unanswerable the first time somebody tidies up
  // their workspace names.
  org_type?: OrgType | null;
  legal_name?: string | null;
  // ISO 3166-1 alpha-2, uppercase, constrained in the database.
  country?: string | null;
  website?: string | null;
  logo_url?: string | null;
  // The gate the setup prompt reads. A timestamp rather than a boolean so
  // "never asked" and "asked, answered the first question, skipped the rest"
  // stay distinguishable -- a solo workspace legitimately has null in every
  // other column here.
  onboarded_at?: string | null;
};

// Solo or business. The only question onboarding asks that everyone answers.
export type OrgType = 'solo' | 'business';

// Two roles, not three. The owner is the account holder -- whoever ran
// bootstrap_org -- and is the only person who can invite, remove, or mint an API
// token. Everyone else is a member with full access to the work: every profile,
// proxy, cookie set and automation, plus the workspace's own name and branding.
//
// 'admin' was removed in 2026-08-10-owner-member-roles.sql. Nothing writes it and
// the check constraint on org_members now refuses it.
export type OrgRole = 'owner' | 'member';

// One row of org_members joined to its organization. `role` no longer decides
// whether the org-wide settings are writable -- the UPDATE policy on
// organizations is is_org_member, and the entitlement columns are held back by
// column grants rather than by any role. It decides who manages people.
export type OrgMembership = {
  org: ArgusOrg;
  role: OrgRole;
};

// One person on the team, as the roster needs them.
//
// This is NOT a row of org_members: that table holds ids and nothing else, and
// Supabase does not expose auth.users to clients, so a member list built by a
// join from here would render a column of uuids. The identity fields come from
// the org_members_with_identity function, which reads auth.users on the
// server for orgs the caller already belongs to.
//
// `display_name` and `avatar_url` are empty strings rather than null when the
// person has set neither -- the callers fall back to the address and to an
// initials plate, and one shape means no call site has to handle both.
export type OrgMember = {
  user_id: string;
  email: string;
  display_name: string;
  avatar_url: string;
  role: OrgRole;
  // When they joined this org, not when the account was created.
  created_at: string;
  // Who invited them. Null for the founding owner, who invited nobody.
  invited_by: string | null;
};

export type OrgInviteStatus = 'pending' | 'accepted' | 'revoked';

// An offer of a seat that has not been taken yet.
//
// Only the owner can read these -- every policy on org_invites is is_org_owner,
// including select -- so this is Team-tab-local state rather than part of
// CloudState. A member reading the table gets an empty list, not an error, which
// is exactly the kind of silent nothing that does not belong in the shared
// workspace cache.
//
// `role` is a constant rather than an OrgRole: an invite can only ever offer
// membership. The column keeps its check constraint (`role = 'member'`) and
// create_org_invite refuses anything else, so this is the type saying what the
// database already enforces.
export type OrgInvite = {
  id: string;
  email: string;
  role: 'member';
  status: OrgInviteStatus;
  // The credential. Minted server-side by create_org_invite and shown once, in
  // the link the owner copies -- there is no email delivery.
  token: string;
  expires_at: string;
  created_at: string;
  invited_by: string | null;
};

// What one teammate can hand to another. Deliberately not every table: a folder
// is a filing decision that belongs to the workspace rather than to a person,
// and extensions/bookmarks are org-wide settings nobody owns individually.
export type HandoffKind = 'profile' | 'proxy' | 'cookie_set' | 'automation';

export type HandoffStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

// An offer to take something over.
//
// Read the word "share" carefully here, because it does NOT mean access.
// Profiles, proxies, cookie sets and automations are scoped by org_id and by
// nothing else, so every member of the workspace can already see all of them --
// there is no permission left to grant. What a hand-off moves is
// responsibility: accepting sets the item's `assigned_to` to you.
//
// So the approve step is not a gate on data. It is consent: work does not
// silently land on your plate because a colleague decided it should.
export type Handoff = {
  id: string;
  kind: HandoffKind;
  status: HandoffStatus;
  item_id: string;
  // The name the item had when it was offered, denormalised server-side. The
  // four tables share no shape to join to, so rendering an inbox from live rows
  // would mean a union per notification for one string.
  item_name: string;
  // Both are auth user ids. Names are resolved from CloudState.members, which
  // the launcher already holds -- unlike the cross-org design this replaced,
  // both parties are in one org, so no server-side identity join is needed.
  from_user: string | null;
  to_user: string;
  note: string;
  created_at: string;
};

export type CloudState = {
  profiles: ArgusProfile[];
  // Profile folders only. The proxy ones are held apart rather than mixed in
  // behind a `kind` check because half a dozen call sites read this list and
  // every one of them means profile folders -- the folder row, the assign
  // dropdown, the move dialog, the tag suggestions, the API-key folder scope.
  // Splitting once, on load, is what makes a proxy folder unable to leak into
  // any of them.
  folders: ArgusFolder[];
  proxy_folders: ArgusFolder[];
  cookie_folders: ArgusFolder[];
  proxies: ArgusProxy[];
  // Every set in the library, trashed ones included -- the Cookies tab filters
  // on deleted_at the same way the Profiles tab does, so Trash is a view rather
  // than a second read.
  cookies: ArgusCookie[];
  shared_extensions: SharedExtension[];
  shared_bookmarks: SharedBookmark[];
  custom_statuses: string[];
  // Saved workflows. Runs are deliberately NOT here: they are unbounded and
  // only the history view wants them, so they are read on demand -- the same
  // reason cookie_sets.list() leaves the `cookies` column out.
  automations: ArgusAutomation[];
  // Everyone in this org. Here rather than local to the Team tab because the
  // Profiles table needs it too -- it is what turns profiles.created_by from a
  // uuid into a name -- and reading it twice for two surfaces would be two
  // round trips for one small list.
  //
  // Pending invites are deliberately NOT here; see OrgInvite.
  members: OrgMember[];
  built_in_extensions?: BuiltInExtensionToggles;
};
