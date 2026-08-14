import {
  Activity, AtSign, Blend, Boxes, Camera, Clock, Cookie, Cpu, Fingerprint, Folder, Gauge,
  Globe, Hash, Languages, MapPin, Mic, Monitor, Network, Pencil, Radio, ShieldOff, Signpost,
  Tag, UserCheck, UserRound, Wifi,
} from 'lucide-react';
import {Assignee} from '../ui/Assignee';
import {RotateButton} from '../ui/RotateButton';
import {StatusChip} from '../ui/StatusChip';
import {TagChip} from '../ui/TagChip';
import {tagsFromDraft} from '../../drafts';
import {userAgentForFingerprint} from '../../lib/fingerprint';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {ReactNode} from 'react';
import type {ProfileDraft} from '../../drafts';

// Which editor a Summary group's Edit button leads to. The panel knows what it
// is showing; the dialog knows where that lives.
export type SummaryTarget = 'profile' | 'proxy' | 'cookies' | 'fingerprint';

// A row is its glyph, its name and its value. The glyph is the one the field
// that SETS this value wears in the form -- a summary row and its control are
// the same thing seen twice, and using two different marks for them would be
// the panel disagreeing with the form about what it is describing.
type Row = {
  icon: ReactNode;
  label: string;
  value: ReactNode | string | string[];
};

// The read-only column beside the profile form: what the browser will actually
// report, resolved the same way the launch payload resolves it.
//
// Grouped rather than one flat list of twenty-odd rows. Two-thirds of them are
// fingerprint values that are only editable two clicks away, and there was no
// way to get from a value you disagreed with to the control that sets it.
export function ProfileSummary({draft, onRotate, onEdit}: {
  draft: ProfileDraft;
  onRotate: () => void;
  onEdit: (target: SummaryTarget) => void;
}) {
  const {data} = useWorkspace();
  const proxy = data.state.proxies.find((item) => item.id === draft.proxy_id) || null;
  const folder = data.state.folders.find((item) => item.id === draft.folder_id) || null;

  const profileRows: Row[] = [
    // Real from the moment the dialog opens: the id is minted with the draft,
    // and it is the name of the directory this profile will get on disk.
    {icon: <Hash size={14} />, label: 'ID', value: draft.id},
    {icon: <UserRound size={14} />, label: 'Name', value: draft.name || '-'},
    {icon: <Activity size={14} />, label: 'Status',
      value: <StatusChip status={draft.status || 'Ready'} />},
    {icon: <Folder size={14} />, label: 'Folder', value: folder?.name || 'All profiles'},
    {icon: <Tag size={14} />, label: 'Tags', value: tagsFromDraft(draft.tags)},
    // Only on a team. Same gate the form's own field carries, and the same one
    // that makes the Assigned column teamOnly: on a one-person workspace this
    // row can only ever say "You".
    ...(data.state.members.length > 1 ? [{
      icon: <UserCheck size={14} />,
      label: 'Assigned',
      value: <Assignee userId={draft.assigned_to || null} />,
    }] : []),
    // The login, so the panel accounts for the Credentials card. The email
    // only: a password belongs in the field that can hide it, never in a
    // read-only column somebody might be screen-sharing.
    {icon: <AtSign size={14} />, label: 'Account', value: draft.email || '-'},
  ];

  const proxyRows: Row[] = [
    {icon: <Blend size={14} />, label: 'Mode',
      value: draft.proxy_mode === 'assigned' ? 'Assigned proxy' :
        draft.proxy_mode === 'direct' ? 'Direct' : 'Free Proxy'},
    {icon: <Network size={14} />, label: 'Proxy',
      value: proxy?.name || (draft.proxy_id ? 'Selected proxy' : 'No proxy')},
    {icon: <Globe size={14} />, label: 'Start page',
      value: draft.start_url.trim() || 'Shared bookmarks home'},
    // Listed because it changes what Launch does -- and because it is the one
    // setting that makes a launch open a DevTools port, which someone auditing
    // a profile's footprint needs to be able to see without opening a dropdown.
    {icon: <Signpost size={14} />, label: 'On launch',
      value: data.state.automations.find(
          (item) => item.id === draft.automation_id)?.name || 'Nothing'},
  ];

  // What the profile launches with. One row: a set from the library, an
  // imported file, or nothing -- the same three states the Cookies editor has.
  const cookieSet = draft.cookie_mode === 'saved' ?
    data.state.cookies.find((item) => item.id === draft.cookie_id) || null : null;
  const cookieRows: Row[] = [
    {icon: <Cookie size={14} />, label: 'Cookies',
      value: cookieSet ?
        (cookieSet.count ? `${cookieSet.name} (${cookieSet.count} cookies)` : cookieSet.name) :
        (draft.cookie_import_path || draft.cookie_import_url) ?
          `${draft.cookie_import_count || 0} cookies · ${draft.cookie_import_name || 'Imported file'}` :
          'None'},
  ];

  const fingerprintRows: Row[] = [
    {icon: <Monitor size={14} />, label: 'Platform', value: draft.fingerprint_os},
    {icon: <Globe size={14} />, label: 'UserAgent',
      value: draft.fingerprint_user_agent.trim() ||
        userAgentForFingerprint(draft.fingerprint_os, draft.fingerprint_browser_version)},
    {icon: <Wifi size={14} />, label: 'WebRTC', value: draft.fingerprint_webrtc},
    {icon: <Camera size={14} />, label: 'Canvas', value: draft.fingerprint_canvas},
    {icon: <Boxes size={14} />, label: 'WebGL', value: draft.fingerprint_webgl},
    {icon: <Boxes size={14} />, label: 'WebGL Info', value: [
      draft.fingerprint_webgl_vendor || 'Google Inc. (Auto)',
      draft.fingerprint_webgl_renderer || 'ANGLE (Auto renderer)',
    ]},
    {icon: <Boxes size={14} />, label: 'WebGPU', value: draft.fingerprint_webgpu},
    {icon: <Blend size={14} />, label: 'Client Rects', value: draft.fingerprint_client_rects},
    {icon: <Clock size={14} />, label: 'Timezone', value: draft.fingerprint_timezone},
    {icon: <Languages size={14} />, label: 'Language', value: draft.fingerprint_language},
    {icon: <MapPin size={14} />, label: 'Geolocation', value: draft.fingerprint_geolocation},
    {icon: <Cpu size={14} />, label: 'CPU', value: draft.fingerprint_cpu_model ?
      `${draft.fingerprint_cpu_model} (${draft.fingerprint_cpu_cores || 'real'} threads)` :
      draft.fingerprint_cpu_cores ? `${draft.fingerprint_cpu_cores} threads` : 'Real'},
    {icon: <Gauge size={14} />, label: 'Memory',
      value: draft.fingerprint_memory_gb ? `${draft.fingerprint_memory_gb} GB` : 'Real'},
    {icon: <Network size={14} />, label: 'MAC address', value: 'OFF'},
    {icon: <Monitor size={14} />, label: 'DeviceName', value: 'OFF'},
    {icon: <Radio size={14} />, label: 'Audio', value: draft.fingerprint_audio},
    {icon: <Monitor size={14} />, label: 'Screen', value: draft.fingerprint_screen},
    {icon: <Mic size={14} />, label: 'Media devices', value: draft.fingerprint_media_devices},
    {icon: <ShieldOff size={14} />, label: 'Do not track',
      value: draft.fingerprint_do_not_track ? 'On' : 'Off'},
  ];

  return (
    <aside className="profile-summary">
      <div className="summary-heading">
        <h3>Summary</h3>
        <RotateButton onRotate={onRotate}>New fingerprint</RotateButton>
      </div>
      <SummaryGroup
        icon={<UserRound size={14} />}
        title="Profile"
        rows={profileRows}
        onEdit={() => onEdit('profile')}
      />
      <SummaryGroup
        icon={<Network size={14} />}
        title="Proxy"
        rows={proxyRows}
        onEdit={() => onEdit('proxy')}
      />
      <SummaryGroup
        icon={<Cookie size={14} />}
        title="Cookies"
        rows={cookieRows}
        onEdit={() => onEdit('cookies')}
      />
      <SummaryGroup
        icon={<Fingerprint size={14} />}
        title="Fingerprint"
        rows={fingerprintRows}
        onEdit={() => onEdit('fingerprint')}
      />
    </aside>
  );
}

function SummaryGroup({icon, title, rows, onEdit}: {
  icon: ReactNode;
  title: string;
  rows: Row[];
  onEdit: () => void;
}) {
  return (
    <section className="summary-group">
      <div className="summary-group-head">
        <h4>{icon}{title}</h4>
        {/* Icon only: the panel is a 320px column, and three "✎ Edit" buttons
          * down it took as much width as the values they sit above. Same
          * pencil as the status picker's, so the two read as one affordance. */}
        <button
          aria-label={`Edit ${title.toLowerCase()}`}
          className="summary-group-edit"
          onClick={onEdit}
          title={`Edit ${title.toLowerCase()}`}
          type="button"
        >
          <Pencil size={13} />
        </button>
      </div>
      {/* The values' own surface, inset in the frame the heading rides -- the
          same two objects .form-group draws in the column beside this one. */}
      <div className="summary-group-body summary-list">
        {rows.map(({icon: rowIcon, label, value}) => (
          <div className="summary-row" key={label}>
            <i className="summary-row-icon" aria-hidden="true">{rowIcon}</i>
            <strong>{label}</strong>
            {Array.isArray(value) && label === 'Tags' ? (
              <span className="summary-tags">
                {value.length ? value.map((tag) => <TagChip key={tag} tag={tag} />) : '-'}
              </span>
            ) : Array.isArray(value) ? (
              <span className="summary-lines">
                {value.map((line) => <i key={line}>{line}</i>)}
              </span>
            ) : typeof value === 'string' || typeof value === 'number' ? (
              <span>{String(value || '-')}</span>
            ) : (
              <span>{value}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
