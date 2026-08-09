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
import {
  CreditCard, PackageOpen, Palette, SlidersHorizontal, User, X,
} from 'lucide-react';
import * as db from '../db';
import type {ReleaseNotes, ResourceState, UpdateState} from '../native';
import {useOrg} from '../org';
import {useWorkspace} from '../workspace/WorkspaceProvider';
import {AccountSection} from './sections/AccountSection';
import {AppearanceSection} from './sections/AppearanceSection';
import {GeneralSection} from './sections/GeneralSection';
import {PlanUsageSection} from './sections/PlanUsageSection';
import {UpdatesSection} from './sections/UpdatesSection';

export type SettingsSectionId =
  'account' | 'plan' | 'appearance' | 'general' | 'updates';

type SectionDef = {
  id: SettingsSectionId;
  label: string;
  group: string;
  icon: typeof User;
};

const SECTIONS: SectionDef[] = [
  {id: 'account', label: 'Account', group: 'Account', icon: User},
  {id: 'plan', label: 'Plan & usage', group: 'Account', icon: CreditCard},
  // AI providers used to live here as its own Workspace group. They became
  // connectors -- one kind among several, only ever used from automations --
  // and moved to Automations → Connectors, taking the group with them.
  {id: 'appearance', label: 'Appearance', group: 'App', icon: Palette},
  {id: 'general', label: 'General', group: 'App', icon: SlidersHorizontal},
  // Both programs live here now -- the launcher and the browser it starts --
  // so the label names the job rather than one of the two things it covers.
  {id: 'updates', label: 'Updates', group: 'App', icon: PackageOpen},
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
  // Closes this dialog and lands on the Plans tab, for the same reason.
  onOpenPlans: () => void;
  // Both halves of the Updates page. The launcher's state machine stays in
  // App's updater hook -- this passes it through rather than owning it, the
  // way the old updateControl node did.
  updateState: UpdateState | null;
  updaterBusy: boolean;
  onUpdaterAction: (action: 'check' | 'download' | 'install') => void;
  resourceState: ResourceState | null;
  onCheckBrowser: () => void;
  onInstallBrowser: () => void;
  releaseNotes: ReleaseNotes | null;
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

  // RLS restricts UPDATE on organizations to is_org_member, so anyone in the
  // workspace may rename it -- the entitlement columns are withheld by the
  // column grant, not by the policy. A failure still surfaces through withDb the
  // way every other write in the app does.
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
                onOpenPlans={props.onOpenPlans}
                onOpenSite={props.onOpenSite}
                profileCount={profileCount}
                automationCount={automationCount}
              />
            )}
            {active === 'appearance' && <AppearanceSection />}
            {active === 'general' && (
              <GeneralSection onMessage={toast.setMessage} onOpenIntro={props.onOpenIntro} />
            )}
            {active === 'updates' && (
              <UpdatesSection
                onCheckBrowser={props.onCheckBrowser}
                onInstallBrowser={props.onInstallBrowser}
                onOpenChangelog={props.onOpenChangelog}
                onUpdaterAction={props.onUpdaterAction}
                releaseNotes={props.releaseNotes}
                resourceState={props.resourceState}
                updateState={props.updateState}
                updaterBusy={props.updaterBusy}
              />
            )}
          </div>

          {org.error && <p className="settings-error" role="alert">{org.error}</p>}
        </div>
      </section>
    </div>
  );
}
