import {useState} from 'react';
import {
  Activity, AtSign, Cookie, Fingerprint, Folder, Globe, KeyRound, Link2, Network, Palette,
  Tag, Terminal, Trash2, UserCheck, UserRound, UserRoundCog, Workflow,
} from 'lucide-react';
import {AssigneeSelect} from '../ui/AssigneeSelect';
import {AvatarPicker} from '../ui/AvatarPicker';
import {BookmarkFavicon} from '../ui/BookmarkFavicon';
import {BusyButton} from '../ui/BusyButton';
import {ColorPicker} from '../ui/ColorPicker';
import {Field} from '../ui/Field';
import {FormGroup} from '../ui/FormGroup';
import {NotesPanel} from '../ui/NotesPanel';
import {InfoHint} from '../ui/InfoHint';
import {Modal} from '../ui/Modal';
import {RotateButton} from '../ui/RotateButton';
import {StatusPicker} from '../ui/StatusChip';
import {TagInput} from '../ui/TagInput';
import {FingerprintDatalists, FingerprintFields} from './FingerprintFields';
import {ProfileSummary} from './ProfileSummary';
import {randomFingerprintPatch} from '../../lib/fingerprintPresets';
import {normalizeBookmarkUrl} from '../../lib/bookmarks';
import {proxyOptionLabel, parseProxyLink} from '../../lib/proxies';
import {MAX_PROFILE_TAGS} from '../../lib/tags';
import {profileFromDraft, tagsFromDraft} from '../../drafts';
import {useAsyncAction} from '../../useAsyncAction';
import {useOrg} from '../../org';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {SummaryTarget} from './ProfileSummary';
import type {ProfileDraft, ProxyDraft} from '../../drafts';

// Stable ids so the Summary panel's per-group Edit actions can put the caret in
// the field they describe. The proxy field already needed one for its datalist.
const NAME_FIELD_ID = 'profile-name-input';
const PROXY_FIELD_ID = 'profile-proxy-input';

export type ProfileModalProps = {
  draft: ProfileDraft;
  onChange: (draft: ProfileDraft) => void;
  onClose: () => void;
  onNewStatus: () => void;
  onPickCookies: () => void;
  // Opens the proxy dialog seeded from the profile's "create new proxy" field,
  // so the new proxy comes back assigned to this draft.
  onCreateProxy: (seed: ProxyDraft) => void;
  onRequestDelete: (profileIds: string[], label: string) => void;
  // Open with the fingerprint section already expanded. Set when the dialog was
  // raised from the Profiles table's Browser or Screen cell, which show those
  // values but deliberately do not set them -- a screen chosen on its own would
  // contradict the platform preset that re-rolls it alongside the GPU and CPU.
  openFingerprint?: boolean;
};

export function ProfileModal({
  draft,
  onChange,
  onClose,
  onNewStatus,
  onPickCookies,
  onCreateProxy,
  onRequestDelete,
  openFingerprint = false,
}: ProfileModalProps) {
  const {data, toast, profiles, shared, statusOptions, tagOptions, reload} = useWorkspace();
  const org = useOrg();
  const orgId = org.orgId;
  const state = data.state;
  const automations = state.automations;
  const {run, isPending} = useAsyncAction();
  // An initialiser, not an effect: the dialog is unmounted between opens, so
  // there is never a mounted instance whose prop changes under it.
  const [fingerprintOpen, setFingerprintOpen] = useState(openFingerprint);
  // While the proxy combobox has focus it shows what the user is typing; when
  // it does not, it shows the assigned proxy's label.
  const [proxyPickerFocused, setProxyPickerFocused] = useState(false);

  const set = (patch: Partial<ProfileDraft>) => onChange({...draft, ...patch});
  const rotate = () => set(randomFingerprintPatch(draft.fingerprint_os));

  function proxyFieldValue() {
    if (proxyPickerFocused || draft.proxy_search) {
      return draft.proxy_search;
    }
    const proxy = state.proxies.find((item) => item.id === draft.proxy_id);
    return proxy ? proxyOptionLabel(proxy) : 'Proxy required';
  }

  function matchProxy(value: string) {
    return state.proxies.find((proxy) =>
      proxyOptionLabel(proxy) === value ||
      proxy.id === value ||
      `${proxy.host}:${proxy.port}` === value);
  }

  function filteredProxies() {
    const query = draft.proxy_search.trim().toLowerCase();
    if (!query) {
      return state.proxies;
    }
    return state.proxies.filter((proxy) =>
      [proxy.name, proxy.host, proxy.type, String(proxy.port), proxy.username]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query));
  }

  function createProxyFromLink() {
    const value = draft.proxy_link.trim();
    if (!value) {
      onCreateProxy({name: '', type: 'socks5', host: '', port: '', username: '', password: ''});
      return;
    }
    const parsed = parseProxyLink(value);
    if (!parsed) {
      toast.setMessage('Proxy link is invalid. Use http://user:pass@host:port, socks5://user:pass@host:port, or http:host:port:user:pass');
      return;
    }
    onCreateProxy({
      name: '',
      type: parsed.type || 'http',
      host: parsed.host,
      port: String(parsed.port),
      username: parsed.username || '',
      password: parsed.password || '',
    });
  }

  function cookieLabel(cookieId: string) {
    const cookie = state.cookies.find((item) => item.id === cookieId);
    if (!cookie) {
      return cookieId;
    }
    return cookie.count ? `${cookie.name} (${cookie.count} cookies)` : cookie.name;
  }

  // Where a Summary group's Edit button lands. The fingerprint group opens the
  // dialog that owns those values; the other two put the caret in the first
  // field of the block they summarize.
  function editSummaryGroup(target: SummaryTarget) {
    if (target === 'fingerprint') {
      setFingerprintOpen(true);
      return;
    }
    const field = document.getElementById(
        target === 'proxy' ? PROXY_FIELD_ID : NAME_FIELD_ID);
    field?.scrollIntoView({block: 'center', behavior: 'smooth'});
    field?.focus();
  }

  async function save() {
    const name = draft.name.trim();
    if (!name) {
      toast.setMessage('Profile name is required');
      return;
    }
    if (draft.proxy_mode === 'assigned' &&
        (!draft.proxy_id || !state.proxies.some((proxy) => proxy.id === draft.proxy_id))) {
      toast.setMessage('Proxy is required, or pick Direct / Free Proxy instead.');
      return;
    }
    const createdAt = draft.saved ?
      state.profiles.find((item) => item.id === draft.id)?.created_at :
      new Date().toISOString();
    const profile = profileFromDraft(draft, createdAt);
    // A row written before the cap existed -- by an import or the API -- can
    // arrive here with more tags than the editor will keep. profileFromDraft
    // trims it either way; saying so is the difference between a rule and a
    // tag quietly going missing.
    const dropped = tagsFromDraft(draft.tags).length - (profile.tags?.length || 0);
    // What the row holds now, read before the save: for an existing profile the
    // stored value, for a new one the auth.uid() default the insert is about to
    // apply. Both are "where assignment will land if we do nothing".
    const assignedNow = draft.saved ?
      state.profiles.find((item) => item.id === draft.id)?.assigned_to || '' :
      org.userId || '';
    // On failure withDb has already surfaced the real error; don't overwrite it
    // with a false "saved" toast, and keep the dialog open so edits aren't lost.
    if (!await profiles.save(profile)) {
      return;
    }
    // A second call rather than a field on the save, because profileToRow omits
    // assigned_to on purpose -- it is owned by set_assignee so a stale edit
    // cannot silently unassign a row somebody else just claimed. Only when it
    // actually changed: an unrelated rename should not rewrite the assignment,
    // and for a new profile the column default has already done this job.
    //
    // After the save, never before: set_assignee is an UPDATE, and on a profile
    // being created for the first time there is no row yet to update.
    if (draft.assigned_to !== assignedNow && orgId) {
      await shared.setAssignee(
          orgId, 'profile', profile.id, draft.assigned_to || null, reload);
    }
    onClose();
    toast.setMessage(dropped > 0 ?
      `${profile.name} saved — kept the first ${MAX_PROFILE_TAGS} tags` :
      `${profile.name} saved`);
  }

  return (
    <>
      <Modal
        className=""
        onClose={onClose}
        title={draft.saved ? 'Edit profile' : 'Create profile'}
        subtitle="Cloud-backed profile settings used when Argys Browser launches anonymously."
        footer={
          <>
            {draft.saved && (
              <button
                className="danger ghost"
                onClick={() => onRequestDelete([draft.id], draft.name)}
              >
                <Trash2 size={16} /> Delete
              </button>
            )}
            <BusyButton
              busy={isPending('save-profile')}
              busyLabel="Saving…"
              onClick={() => void run('save-profile', save)}
            >
              {draft.saved ? 'Save changes' : 'Create profile'}
            </BusyButton>
          </>
        }
      >
        <div className="profile-editor-layout">
          <div className="profile-form profile-editor-main">
            {/* Six titled sections rather than seventeen fields in a row.
              * Unsectioned, this form gave no answer to "where do I change the
              * proxy" short of reading every label top to bottom -- and the two
              * things people actually come here to change, the proxy and the
              * cookies, were separated by nine fields that have nothing to do
              * with either. The order is the order the questions get asked:
              * who is this, how does it connect, what does it look like, what
              * is it carrying, what happens on launch, and what should the next
              * person know. */}
            <FormGroup
              hint="What this profile is called and how you find it again in a table of forty."
              title="Account"
            >
              <Field label="Name" icon={<UserRound size={14} />} wide>
                <input
                  type="text"
                  autoFocus
                  id={NAME_FIELD_ID}
                  value={draft.name}
                  onChange={(event) => set({name: event.target.value})}
                />
              </Field>
              <Field label="Status" icon={<Activity size={14} />} wide group>
                <StatusPicker
                  status={statusOptions.includes(draft.status) ? draft.status : 'Ready'}
                  options={statusOptions}
                  onChange={(status) => set({status})}
                  onNewStatus={onNewStatus}
                />
              </Field>
              {/* Above Colour, because they answer the same question -- how do I
                  find this row again in a table of forty -- and the colour plate
                  is what an empty avatar falls back to. */}
              <Field
                label="Avatar"
                icon={<UserRoundCog size={14} />}
                hint="A picture or a site's logo, shown beside the name in the profiles list."
                wide
                // Same reason as Status and Tags: the buttons and the popover
                // trigger sit inside this field, and a <label> wrapping them
                // would fire its implicit activation on the wrong control.
                group
              >
                <AvatarPicker
                  color={draft.color}
                  name={draft.name}
                  onChange={(avatar) => set({avatar})}
                  onError={(message) => toast.setMessage(message)}
                  onUpload={(file) => profiles.uploadAvatar(draft.id, file)}
                  value={draft.avatar}
                />
              </Field>
              <Field label="Colour" icon={<Palette size={14} />} wide group>
                <ColorPicker value={draft.color} onChange={(color) => set({color})} />
              </Field>
              <Field
                label="Tags"
                icon={<Tag size={14} />}
                hint={`Up to ${MAX_PROFILE_TAGS}. Click a suggestion, or type your own — Enter or ` +
                  'comma adds it. Tags filter and search the profiles list.'}
                wide
                // Same reason the Status field is a group: the suggestion row and
                // the chips' remove buttons sit inside this field, and a <label>
                // wrapping them fires its implicit activation of the text input
                // instead of the button that was actually clicked.
                group
              >
                <TagInput
                  options={tagOptions}
                  placeholder="warmup, client-a"
                  value={tagsFromDraft(draft.tags)}
                  onChange={(tags) => set({tags: tags.join(', ')})}
                />
              </Field>
              <Field label="Folder" icon={<Folder size={14} />} wide>
                <select
                  value={draft.folder_id}
                  onChange={(event) => set({folder_id: event.target.value})}
                >
                  <option value="">All profiles</option>
                  {state.folders.map((folder) => (
                    <option value={folder.id} key={folder.id}>{folder.name}</option>
                  ))}
                </select>
              </Field>
              {/* Only once there is somebody to assign to. A one-person workspace
                  gets a picker whose every option is "you", which is the same
                  reason the Assigned column is teamOnly. */}
              {state.members.length > 1 && (
                <Field
                  label="Assigned to"
                  icon={<UserCheck size={14} />}
                  hint="Who's looking after this profile. Everyone on the team can still open it — this is a label, not a lock."
                  wide
                >
                  <AssigneeSelect
                    members={state.members}
                    onChange={(assigned_to) => set({assigned_to})}
                    value={draft.assigned_to}
                  />
                </Field>
              )}
              <Field label="Account email" icon={<AtSign size={14} />} wide>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={draft.email}
                  onChange={(event) => set({email: event.target.value})}
                />
              </Field>
              <Field
                label="Account password"
                icon={<KeyRound size={14} />}
                info={
                  <InfoHint label="Account password">
                    <p>
                      The login this profile is signed into, kept beside it so whoever picks the
                      profile up has it.
                    </p>
                    <p>
                      Stored with your cloud data <strong>in plaintext</strong> — anyone with
                      access to the organization can read it.
                    </p>
                  </InfoHint>
                }
                wide
              >
                <input
                  type="password"
                  autoComplete="new-password"
                  value={draft.password}
                  onChange={(event) => set({password: event.target.value})}
                />
              </Field>
            </FormGroup>

            <FormGroup
              hint="How this profile reaches the internet. Everything it opens goes out this way."
              title="Proxy"
            >
              {/* The three modes each needed a sentence of explanation. They used
                * to be two conditional .field-hint paragraphs that appeared and
                * disappeared under the control, moving the rest of the form. */}
              <Field
                label="Proxy mode"
                icon={<Network size={14} />}
                info={
                  <InfoHint label="Proxy mode">
                    <p>
                      <strong>Assigned proxy</strong> routes this profile through one proxy from
                      your library. Saving or launching needs one picked.
                    </p>
                    <p>
                      <strong>Direct</strong> sends traffic straight out with no proxy and no
                      fallback extension — your own IP.
                    </p>
                    <p>
                      <strong>Free Proxy</strong> loads the bundled FoxyWall Proxy extension
                      instead of assigning one, and connects through it.
                    </p>
                  </InfoHint>
                }
                wide
                group
              >
                <div className="choice-chips" role="radiogroup" aria-label="Proxy mode">
                  {(['assigned', 'direct', 'free_proxy'] as const).map((mode) => (
                    <button
                      aria-checked={draft.proxy_mode === mode}
                      className={draft.proxy_mode === mode ? 'choice-chip active' : 'choice-chip'}
                      key={mode}
                      onClick={() => set({proxy_mode: mode})}
                      role="radio"
                      type="button"
                    >
                      {mode === 'assigned' ? 'Assigned proxy' : mode === 'direct' ? 'Direct' : 'Free Proxy'}
                    </button>
                  ))}
                </div>
              </Field>
              {/* One field per row rather than the two-up grid these used to share:
                * the search box and the connection-string box looked like one
                * control split in half, and Create new proxy was wedged in beside
                * the second of them. */}
              {draft.proxy_mode === 'assigned' && (
                <>
                  <Field label="Proxy" icon={<Network size={14} />} wide>
                    <input
                      type="text"
                      id={PROXY_FIELD_ID}
                      list="profile-proxy-options"
                      placeholder="Search and select proxy"
                      value={proxyFieldValue()}
                      onFocus={() => {
                        setProxyPickerFocused(true);
                        set({proxy_search: ''});
                      }}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (!value.trim() || value === 'Direct connection') {
                          set({proxy_search: ''});
                          return;
                        }
                        set({proxy_id: matchProxy(value)?.id || '', proxy_search: value});
                      }}
                      onBlur={() => {
                        setProxyPickerFocused(false);
                        const value = draft.proxy_search.trim();
                        if (!value || value === 'Direct connection') {
                          set({proxy_search: ''});
                          return;
                        }
                        const matched = matchProxy(value);
                        if (matched) {
                          set({proxy_id: matched.id, proxy_search: ''});
                        }
                      }}
                    />
                    <datalist id="profile-proxy-options">
                      {filteredProxies().map((proxy) => (
                        <option value={proxyOptionLabel(proxy)} key={proxy.id} />
                      ))}
                    </datalist>
                  </Field>
                  <Field
                    label="Or add a new proxy"
                    icon={<Link2 size={14} />}
                    info={
                      <InfoHint label="Adding a proxy">
                        <p>
                          Paste a connection string to create the proxy and assign it to this
                          profile in one step. It joins your proxy library, so other profiles can
                          pick it afterwards.
                        </p>
                        <p>
                          Both shapes are accepted: <code>socks5://user:pass@host:port</code> and
                          the vendor form <code>socks5://host:port:user:pass</code>.
                        </p>
                      </InfoHint>
                    }
                    wide
                  >
                    <div className="stacked-action">
                      <input
                        type="text"
                        placeholder="http://user:pass@host:port or socks5://host:port:user:pass"
                        value={draft.proxy_link}
                        onChange={(event) => set({proxy_link: event.target.value})}
                      />
                      <button className="ghost" type="button" onClick={createProxyFromLink}>
                        Create new proxy
                      </button>
                    </div>
                  </Field>
                </>
              )}
            </FormGroup>

            {/* Kept directly after Proxy, and above Cookies. This card is the
              * only way into the fingerprint editor, so the platform it names
              * has to stay visible near the top of the form. See AGENTS.md. */}
            <FormGroup
              hint="The identity this profile presents to the sites it opens."
              title="Fingerprint"
            >
              <div className="form-group-row">
                <p className="form-group-value">
                  {draft.fingerprint_os} · {draft.fingerprint_browser_version} ·{' '}
                  {draft.fingerprint_timezone} · {draft.fingerprint_webrtc}
                </p>
                <button className="ghost" type="button" onClick={() => setFingerprintOpen(true)}>
                  Edit fingerprint
                </button>
              </div>
            </FormGroup>

            <FormGroup
              hint="Upload a JSON or Netscape cookies.txt file to cloud sync and import it when this profile launches."
              info={
                <InfoHint label="Cookie import">
                  <p>
                    Takes a JSON export or a Netscape <code>cookies.txt</code>. Both are what
                    the usual browser cookie-export extensions produce.
                  </p>
                  <p>
                    The file is uploaded to cloud sync, so every machine in the organization
                    launches this profile with the same cookies.
                  </p>
                  <p>
                    They are seeded at launch through a temporary generated extension in the
                    profile directory, not written into the cookie database directly.
                  </p>
                </InfoHint>
              }
              title="Cookies"
            >
              <div className="file-row wide">
                <button className="ghost" type="button" onClick={onPickCookies}>
                  Select cookies…
                </button>
                {draft.cookie_mode === 'saved' && draft.cookie_id ? (
                  <>
                    <span>{cookieLabel(draft.cookie_id)}</span>
                    <button
                      className="icon-button danger-icon"
                      type="button"
                      aria-label="Clear selected cookie-set"
                      onClick={() => set({cookie_mode: 'paste', cookie_id: ''})}
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : draft.cookie_import_path || draft.cookie_import_url ? (
                  <>
                    <span>
                      {draft.cookie_import_count || 0} cookies · {draft.cookie_import_name ||
                        (draft.cookie_import_url ? 'Cloud cookie file' : draft.cookie_import_path)}
                    </span>
                    <button
                      className="icon-button danger-icon"
                      type="button"
                      aria-label="Clear cookie import"
                      onClick={() => set({
                        cookie_import_path: '',
                        cookie_import_url: '',
                        cookie_import_name: '',
                        cookie_import_count: 0,
                      })}
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : (
                  <span>No cookie file selected</span>
                )}
              </div>
            </FormGroup>

            <FormGroup
              hint="What happens when you press Launch."
              title="Launch"
            >
              <Field label="Start page" icon={<Globe size={14} />} wide>
                <input
                  type="text"
                  placeholder="Leave empty for shared bookmarks home"
                  value={draft.start_url}
                  onChange={(event) => set({start_url: event.target.value})}
                />
                <StartPageChips value={draft.start_url} onPick={(start_url) => set({start_url})} />
              </Field>
              <Field
                label="Run on launch"
                icon={<Workflow size={14} />}
                hint={draft.automation_id ?
                  'Opens a DevTools port for this launch only, so the workflow can drive it.' :
                  'Runs an automation automatically once this profile is open.'}
                wide
              >
                <select
                  value={draft.automation_id}
                  onChange={(event) => set({automation_id: event.target.value})}
                >
                  <option value="">Nothing</option>
                  {automations.map((automation) => (
                    <option key={automation.id} value={automation.id}>{automation.name}</option>
                  ))}
                </select>
              </Field>
              <Field
                label="Command line switches"
                icon={<Terminal size={14} />}
                info={
                  <InfoHint label="Command line switches">
                    <p>
                      Extra Chromium flags, passed to the browser when this profile launches.
                      One per line.
                    </p>
                    <p>
                      Use the full <code>--flag</code> or <code>--flag=value</code> form, for
                      example <code>--lang=en-US</code> or{' '}
                      <code>--disable-features=ExampleFeature</code>.
                    </p>
                    <p>
                      A flag that contradicts the fingerprint above wins — the browser applies
                      what it is given, so a bad switch here can undo the identity settings.
                    </p>
                  </InfoHint>
                }
                wide
              >
                <textarea
                  placeholder="--disable-features=ExampleFeature&#10;--lang=en-US"
                  value={draft.command_line_switches}
                  onChange={(event) => set({command_line_switches: event.target.value})}
                />
              </Field>
            </FormGroup>

            {/* Saved profiles only: a note is a row keyed on a profile id, and
              * a profile being created does not have one in the database yet.
              * Last, because it is the section you come back to rather than the
              * one you fill in -- everything above is set once. */}
            {draft.saved && (
              <FormGroup
                hint="Why this profile exists, and anything worth knowing before using it. Everyone in the workspace can read and add; only the author can change their own."
                title="Notes"
              >
                <div className="form-group-full">
                  <NotesPanel profileId={draft.id} />
                </div>
              </FormGroup>
            )}
          </div>

          <ProfileSummary draft={draft} onRotate={rotate} onEdit={editSummaryGroup} />
        </div>

        <FingerprintDatalists />
      </Modal>

      {fingerprintOpen && (
        <Modal
          nested
          className="fingerprint-modal"
          onClose={() => setFingerprintOpen(false)}
          title="Edit fingerprint"
          subtitle="Profile-level browser identity settings stored with cloud data."
          footer={
            <>
              <RotateButton onRotate={rotate}>Rotate fingerprint</RotateButton>
              <button onClick={() => setFingerprintOpen(false)}>Done</button>
            </>
          }
        >
          <div className="profile-form">
            <FingerprintFields draft={draft} onChange={onChange} />
          </div>
        </Modal>
      )}
    </>
  );
}

// The shared bookmarks, as one-click values for the start page. Hidden when the
// workspace has none rather than rendering a lone "home" chip that explains
// nothing.
function StartPageChips({value, onPick}: {value: string; onPick: (url: string) => void}) {
  const {data} = useWorkspace();
  const bookmarks = data.state.shared_bookmarks;
  if (!bookmarks.length) {
    return null;
  }
  const current = normalizeBookmarkUrl(value);
  return (
    <div className="bookmark-chips">
      <button
        className={value.trim() ? 'bookmark-chip' : 'bookmark-chip active'}
        onClick={() => onPick('')}
        type="button"
      >
        <span>Shared bookmarks home</span>
      </button>
      {bookmarks.map((bookmark) => (
        <button
          className={current && current === normalizeBookmarkUrl(bookmark.url) ?
            'bookmark-chip active' :
            'bookmark-chip'}
          key={bookmark.id || bookmark.url}
          onClick={() => onPick(bookmark.url)}
          title={`${bookmark.title || bookmark.url} — ${bookmark.url}`}
          type="button"
        >
          <BookmarkFavicon bookmark={bookmark} />
          <span>{bookmark.title || bookmark.url}</span>
        </button>
      ))}
    </div>
  );
}
