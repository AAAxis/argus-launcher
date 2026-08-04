import {Pencil} from 'lucide-react';
import {RotateButton} from '../ui/RotateButton';
import {StatusChip} from '../ui/StatusChip';
import {TagChip} from '../ui/TagChip';
import {tagsFromDraft} from '../../drafts';
import {userAgentForFingerprint} from '../../lib/fingerprint';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {ReactNode} from 'react';
import type {ProfileDraft} from '../../drafts';

// Which block of the form a Summary group's Edit button leads back to. The
// panel knows what it is showing; the dialog knows where that lives.
export type SummaryTarget = 'profile' | 'proxy' | 'fingerprint';

type Row = readonly [string, ReactNode | string | string[]];

// The read-only column beside the profile form: what the browser will actually
// report, resolved the same way the launch payload resolves it.
//
// Grouped rather than one flat list of twenty-four rows. Two-thirds of them are
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
    ['ID', draft.id],
    ['Name', draft.name || '-'],
    ['Status', <StatusChip status={draft.status || 'Ready'} key="status" />],
    ['Folder', folder?.name || 'All profiles'],
    ['Tags', tagsFromDraft(draft.tags)],
  ];

  const proxyRows: Row[] = [
    ['Mode', draft.proxy_mode === 'assigned' ? 'Assigned proxy' :
      draft.proxy_mode === 'direct' ? 'Direct' : 'Free Proxy'],
    ['Proxy', proxy?.name || (draft.proxy_id ? 'Selected proxy' : 'No proxy')],
    ['Start page', draft.start_url.trim() || 'Shared bookmarks home'],
    // Listed because it changes what Launch does -- and because it is the one
    // setting that makes a launch open a DevTools port, which someone auditing
    // a profile's footprint needs to be able to see without opening a dropdown.
    ['On launch', data.state.automations.find(
        (item) => item.id === draft.automation_id)?.name || 'Nothing'],
  ];

  const fingerprintRows: Row[] = [
    ['Platform', draft.fingerprint_os],
    ['UserAgent', draft.fingerprint_user_agent.trim() ||
      userAgentForFingerprint(draft.fingerprint_os, draft.fingerprint_browser_version)],
    ['WebRTC', draft.fingerprint_webrtc],
    ['Canvas', draft.fingerprint_canvas],
    ['WebGL', draft.fingerprint_webgl],
    ['WebGL Info', [
      draft.fingerprint_webgl_vendor || 'Google Inc. (Auto)',
      draft.fingerprint_webgl_renderer || 'ANGLE (Auto renderer)',
    ]],
    ['WebGPU', draft.fingerprint_webgpu],
    ['Client Rects', draft.fingerprint_client_rects],
    ['Timezone', draft.fingerprint_timezone],
    ['Language', draft.fingerprint_language],
    ['Geolocation', draft.fingerprint_geolocation],
    ['CPU', draft.fingerprint_cpu_model ?
      `${draft.fingerprint_cpu_model} (${draft.fingerprint_cpu_cores || 'real'} threads)` :
      draft.fingerprint_cpu_cores ? `${draft.fingerprint_cpu_cores} threads` : 'Real'],
    ['Memory', draft.fingerprint_memory_gb ? `${draft.fingerprint_memory_gb} GB` : 'Real'],
    ['MAC address', 'OFF'],
    ['DeviceName', 'OFF'],
    ['Audio', draft.fingerprint_audio],
    ['Screen', draft.fingerprint_screen],
    ['Media devices', draft.fingerprint_media_devices],
    ['Do not track', draft.fingerprint_do_not_track ? 'On' : 'Off'],
  ];

  return (
    <aside className="profile-summary">
      <div className="summary-heading">
        <h3>Summary</h3>
        <RotateButton onRotate={onRotate}>New fingerprint</RotateButton>
      </div>
      <SummaryGroup title="Profile" rows={profileRows} onEdit={() => onEdit('profile')} />
      <SummaryGroup title="Proxy" rows={proxyRows} onEdit={() => onEdit('proxy')} />
      <SummaryGroup
        title="Fingerprint"
        rows={fingerprintRows}
        onEdit={() => onEdit('fingerprint')}
      />
    </aside>
  );
}

function SummaryGroup({title, rows, onEdit}: {
  title: string;
  rows: Row[];
  onEdit: () => void;
}) {
  return (
    <section className="summary-group">
      <div className="summary-group-head">
        <h4>{title}</h4>
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
      <div className="summary-list">
        {rows.map(([label, value]) => (
          <div className="summary-row" key={label}>
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
