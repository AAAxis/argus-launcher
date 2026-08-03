// Browser & updates: the two pieces of software this app is responsible for
// keeping current -- the bundled Argys Browser, and the launcher itself.
import type {ReactNode} from 'react';
import {Download, FileText} from 'lucide-react';
import type {ResourceState} from '../../native';
import {SettingsGroup, SettingsRow, SettingsValue} from '../rows';

type Props = {
  resourceState: ResourceState | null;
  onDownloadBrowser: () => void;
  onOpenChangelog: () => void;
  // renderUpdateControl() from main.tsx, passed through rather than rebuilt:
  // it owns the check/download/restart state machine and the progress bar.
  updateControl: ReactNode;
};

function browserStatusLabel(state: ResourceState | null): string {
  switch (state?.browserStatus) {
    case 'ready':
      return state.browserVersion ? `Installed · ${state.browserVersion}` : 'Installed';
    case 'downloading':
      return `Downloading ${state.progress?.percent || 0}%`;
    case 'installing':
      return 'Installing…';
    case 'checking':
      return 'Checking…';
    case 'error':
      return state.error || 'Not installed';
    default:
      return 'Not installed';
  }
}

export function BrowserUpdatesSection({
  resourceState,
  onDownloadBrowser,
  onOpenChangelog,
  updateControl,
}: Props) {
  const busy = resourceState?.browserStatus === 'downloading' ||
    resourceState?.browserStatus === 'installing' ||
    resourceState?.browserStatus === 'checking';

  return (
    <>
      <SettingsGroup title="Argys Browser">
        <SettingsRow
          label="Status"
          description="The browser profiles launch into. It updates separately from the launcher."
        >
          <SettingsValue>{browserStatusLabel(resourceState)}</SettingsValue>
          <button className="ghost" disabled={busy} onClick={onDownloadBrowser} type="button">
            <Download size={15} /> {resourceState?.browserStatus === 'ready' ? 'Re-download' : 'Download'}
          </button>
        </SettingsRow>

        {resourceState?.browserPath && (
          <SettingsRow label="Location" wide>
            <div className="settings-path">
              <code title={resourceState.browserPath}>{resourceState.browserPath}</code>
            </div>
          </SettingsRow>
        )}
      </SettingsGroup>

      <SettingsGroup title="Argus Launcher">
        <SettingsRow
          label="Updates"
          description="Check for a new release, download it, and restart when you are ready."
          wide
        >
          {updateControl}
        </SettingsRow>

        <SettingsRow label="Changelog" description="What changed in the current or latest available release.">
          <button className="ghost" onClick={onOpenChangelog} type="button">
            <FileText size={15} /> View changelog
          </button>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
