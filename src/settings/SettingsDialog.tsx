// The settings dialog: a category rail on the left, one section at a time on
// the right.
//
// It lives outside main.tsx deliberately. The old version was five stacked rows
// inside that 7.5k-line file; this one is five sections with their own state and
// async actions, and putting it there would have made the file harder to work in
// for everyone. What it needs from the app is passed in as props; what it needs
// from the session it reads itself through useOrg()/useTheme(), which are
// mounted above App.
import {useEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {CreditCard, PackageOpen, Palette, SlidersHorizontal, User, X} from 'lucide-react';
import * as db from '../db';
import type {ResourceState} from '../native';
import {useOrg} from '../org';
import {useWorkspace} from '../workspace/WorkspaceProvider';
import {AccountSection} from './sections/AccountSection';
import {AppearanceSection} from './sections/AppearanceSection';
import {BrowserUpdatesSection} from './sections/BrowserUpdatesSection';
import {GeneralSection} from './sections/GeneralSection';
import {PlanUsageSection} from './sections/PlanUsageSection';

export type SettingsSectionId = 'account' | 'plan' | 'appearance' | 'general' | 'browser';

type SectionDef = {
  id: SettingsSectionId;
  label: string;
  group: string;
  icon: typeof User;
};

const SECTIONS: SectionDef[] = [
  {id: 'account', label: 'Account', group: 'Account', icon: User},
  {id: 'plan', label: 'Plan & usage', group: 'Account', icon: CreditCard},
  {id: 'appearance', label: 'Appearance', group: 'App', icon: Palette},
  {id: 'general', label: 'General', group: 'App', icon: SlidersHorizontal},
  {id: 'browser', label: 'Browser & updates', group: 'App', icon: PackageOpen},
];

export type SettingsDialogProps = {
  onClose: () => void;
  onSignOut: () => void | Promise<void>;
  // Opens a path on the website in the user's real browser.
  onOpenSite: (pathname: string) => void;
  onOpenChangelog: () => void;
  // Replays the profiles walkthrough. Closes this dialog on the way, so the two
  // are never stacked.
  onOpenIntro: () => void;
  // The launcher's own update panel, owned by App's updater hook.
  updateControl: ReactNode;
  resourceState: ResourceState | null;
  onDownloadBrowser: () => void;
};

export function SettingsDialog(props: SettingsDialogProps) {
  const org = useOrg();
  const {data, toast} = useWorkspace();
  const [active, setActive] = useState<SettingsSectionId>('account');
  const railRef = useRef<HTMLDivElement | null>(null);

  // Focus starts on the rail so the dialog is immediately keyboard-navigable and
  // Tab continues into the section rather than starting from the page behind.
  useEffect(() => {
    const first = railRef.current?.querySelector<HTMLButtonElement>('button[aria-selected="true"]');
    first?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        props.onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [props.onClose]);

  // ↑/↓ move between categories, the convention for a vertical tablist. Left to
  // the browser, arrow keys would scroll the panel instead.
  function onRailKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }
    event.preventDefault();
    const index = SECTIONS.findIndex((section) => section.id === active);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = SECTIONS[(index + step + SECTIONS.length) % SECTIONS.length];
    setActive(next.id);
    const button = railRef.current?.querySelector<HTMLButtonElement>(`button[data-section="${next.id}"]`);
    button?.focus();
  }

  // Trash is excluded because the limit trigger excludes it too: a soft-deleted
  // profile only counts against the plan again once it is restored.
  const profileCount = data.state.profiles.filter((profile) => !profile.deleted_at).length;
  // No deleted_at filter: automations are hard-deleted, so every row in state
  // is a live one counting against the cap.
  const automationCount = data.state.automations.length;

  // RLS restricts UPDATE on organizations to is_org_admin, and db.orgs.rename
  // asks for the row back so a member's attempt surfaces as an error instead of
  // a rename that reverts on the next load. withDb reports it the way every
  // other write in the app does.
  async function renameOrg(name: string): Promise<boolean> {
    const ok = await data.withDb((activeOrgId) => db.orgs.rename(activeOrgId, name));
    if (!ok) {
      return false;
    }
    await org.reload();
    toast.setMessage('Workspace renamed');
    return true;
  }

  const groups: string[] = [];
  for (const section of SECTIONS) {
    if (!groups.includes(section.group)) {
      groups.push(section.group);
    }
  }

  const activeSection = SECTIONS.find((section) => section.id === active) || SECTIONS[0];

  return (
    <div className="modal-backdrop" onMouseDown={props.onClose}>
      <section
        aria-labelledby="settings-title"
        aria-modal="true"
        className="settings-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="settings-rail" onKeyDown={onRailKeyDown} ref={railRef} role="tablist" aria-orientation="vertical" aria-label="Settings sections">
          {groups.map((group) => (
            <div className="settings-rail-group" key={group}>
              <h4>{group}</h4>
              {SECTIONS.filter((section) => section.group === group).map((section) => (
                <button
                  aria-controls="settings-panel"
                  aria-selected={section.id === active}
                  className={section.id === active ? 'active' : ''}
                  data-section={section.id}
                  key={section.id}
                  onClick={() => setActive(section.id)}
                  role="tab"
                  tabIndex={section.id === active ? 0 : -1}
                  type="button"
                >
                  <section.icon size={16} strokeWidth={1.75} />
                  {section.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="settings-panel" id="settings-panel" role="tabpanel" tabIndex={-1}>
          <header className="settings-panel-header">
            <h2 id="settings-title">{activeSection.label}</h2>
            <button className="icon-button" aria-label="Close settings" onClick={props.onClose} type="button">
              <X size={18} />
            </button>
          </header>

          <div className="settings-panel-body">
            {active === 'account' && (
              <AccountSection
                onMessage={toast.setMessage}
                onOpenSite={props.onOpenSite}
                onRenameOrg={renameOrg}
                onSignOut={props.onSignOut}
              />
            )}
            {active === 'plan' && (
              <PlanUsageSection
                onOpenSite={props.onOpenSite}
                profileCount={profileCount}
                automationCount={automationCount}
              />
            )}
            {active === 'appearance' && <AppearanceSection />}
            {active === 'general' && (
              <GeneralSection onMessage={toast.setMessage} onOpenIntro={props.onOpenIntro} />
            )}
            {active === 'browser' && (
              <BrowserUpdatesSection
                onDownloadBrowser={props.onDownloadBrowser}
                onOpenChangelog={props.onOpenChangelog}
                resourceState={props.resourceState}
                updateControl={props.updateControl}
              />
            )}
          </div>

          {org.error && <p className="settings-error" role="alert">{org.error}</p>}
        </div>
      </section>
    </div>
  );
}
