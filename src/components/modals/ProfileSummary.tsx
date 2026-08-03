import {tagsFromDraft} from '../../drafts';
import {userAgentForFingerprint} from '../../lib/fingerprint';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import type {ProfileDraft} from '../../drafts';

// The read-only column beside the profile form: what the browser will actually
// report, resolved the same way the launch payload resolves it.
export function ProfileSummary({draft, onRotate}: {draft: ProfileDraft; onRotate: () => void}) {
  const {data} = useWorkspace();
  const proxy = data.state.proxies.find((item) => item.id === draft.proxy_id) || null;

  const rows: Array<readonly [string, string | string[]]> = [
    ['ID', draft.id || 'New profile'],
    ['Name', draft.name || '-'],
    ['Status', draft.status || 'Ready'],
    ['Tags', tagsFromDraft(draft.tags)],
    ['Platform', draft.fingerprint_os],
    ['UserAgent', draft.fingerprint_user_agent.trim() ||
      userAgentForFingerprint(draft.fingerprint_os, draft.fingerprint_browser_version)],
    ['Proxy', proxy?.name || (draft.proxy_id ? 'Selected proxy' : 'No proxy')],
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
        <button className="ghost" type="button" onClick={onRotate}>New fingerprint</button>
      </div>
      <div className="summary-list">
        {rows.map(([label, value]) => (
          <div className="summary-row" key={label}>
            <strong>{label}</strong>
            {Array.isArray(value) && label === 'Tags' ? (
              <span className="summary-tags">
                {value.length ? value.map((tag) => <em key={tag}>{tag}</em>) : '-'}
              </span>
            ) : Array.isArray(value) ? (
              <span className="summary-lines">
                {value.map((line) => <i key={line}>{line}</i>)}
              </span>
            ) : (
              <span>{String(value || '-')}</span>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
