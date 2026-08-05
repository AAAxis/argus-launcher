// The Automations library.
//
// Cards rather than table rows: there are few of these and each carries more
// than a row's worth -- name, description, step count, where it is wired in,
// and how its last run went. The same call the Extensions tab made.
//
// And now the same shell, the same card and the same toolbar as that tab, not
// just the same call. This page was written before Extensions settled the house
// style for a card grid and had drifted a long way from it: no width cap, so at
// 1600px its cards fanned out to six columns while every neighbouring tab
// stopped at 1080; 20px padding and no shadow against Extensions' 14 and
// --shadow-xs; no mark, so a grid of automations was a grid of headings; and
// ragged card feet, because nothing made the description take the slack.
//
// What moved rather than changed: the New automation button is in this tab's
// own toolbar instead of the app Topbar, which is where Extensions puts its Add
// action and why that tab has no `case` in renderTopActions() at all. One place
// per action.
import {useState} from 'react';
import {
  BookOpen, History, Layers, MonitorSmartphone, Play, Plus, Rocket, Share2, Sparkles,
  Workflow,
} from 'lucide-react';
import {Assignee} from '../ui/Assignee';
import {Badge} from '../ui/Badge';
import {BusyButton} from '../ui/BusyButton';
import {TagChip} from '../ui/TagChip';
import {useOrg} from '../../org';
import {useWorkspace} from '../../workspace/WorkspaceProvider';
import {SITE_LINKS} from '../../data/links';
import {automationCap} from '../../automations/limit';
import {describeRunBlock} from '../../automations/runReadiness';
import {RUN_LABEL, RUN_TONE} from '../../automations/runStatus';
import type {ShareRequest} from '../modals/ShareModal';
import type {ArgusAutomation, AutomationRun} from '../../types';

// All, or the ones the browser start pages show. Two chips rather than a
// filter dropdown, on the control Extensions and the proxy-mode selector
// already use. `pinned` earns the second chip because it is the one property of
// an automation with a consequence outside this tab: a pinned workflow is a
// button inside every profile's session.
type View = 'all' | 'pinned' | 'mine';

export function AutomationsTab({
  onEdit, onNew, onLoadExample, onCreateDemoProfile, onRun, onHistory, onShare, onOpenSite,
}: {
  onEdit: (automation: ArgusAutomation) => void;
  onNew: () => void;
  // Inserts the pre-written example and opens it. Unlike onNew it writes a row
  // before the editor opens, which is what makes it a normal automation from
  // the first moment rather than a draft with special provenance.
  onLoadExample: () => void;
  // Only offered when the org has no profiles at all: an automation with
  // nothing to run against is a dead end, and Direct mode is the one setup that
  // needs no proxy credentials to demonstrate.
  onCreateDemoProfile: () => void;
  // Opens the profile picker. Running never starts from this button any more:
  // it used to resolve a target with runTarget() and go, which is how a run
  // ended up on a profile nobody chose, failing on that profile's dead proxy.
  onRun: (automation: ArgusAutomation) => void;
  onHistory: (automation: ArgusAutomation) => void;
  // Raises the share sheet. One automation at a time, unlike the table tabs --
  // this grid has no selection model to batch with.
  onShare: (request: ShareRequest) => void;
  // Opens a page on the marketing site in the user's own browser, never in a
  // profile window -- those stay anonymous.
  onOpenSite: (pathname: string) => void;
}) {
  const {data, automations} = useWorkspace();
  const org = useOrg();
  const [view, setView] = useState<View>('all');
  const {state} = data;
  const list = state.automations;
  // UX only, never security: trg_automation_limit is the real gate and
  // describeDbError turns its exception into the same sentence. This just says
  // it before the click rather than after.
  const {atCap} = automationCap(org.org, list.length);
  // Trashed profiles still exist and can be restored, so they are not "no
  // profiles" -- offering to mint a Demo one on top of them would be the app
  // failing to see what the user already has.
  const hasNoProfiles = !state.profiles.some((profile) => !profile.deleted_at);
  // Why no run can start, or null. One decision for every card on the tab: it
  // is a property of the workspace, not of any one automation, so computing it
  // per card would be the same answer worked out N times.
  //
  // Shared with RunAutomationModal through runReadiness, which is the point of
  // that file -- the button and the dialog have to agree about which profiles
  // are usable, or the button opens a dialog that refuses everything.
  const block = describeRunBlock(state.profiles, state.proxies);

  // The newest run per automation, from whatever this session has seen. Older
  // history lives in the database and is opened explicitly -- see onHistory.
  //
  // `live` counts alongside it because one automation can now be running on
  // several profiles at once. The newest run alone would report a batch of five
  // as one run, and its status would flip to whichever finished last while four
  // were still going.
  const latest = new Map<string, AutomationRun>();
  const live = new Map<string, number>();
  for (const run of Object.values(automations.runs)) {
    if (!run.automation_id) {
      continue;
    }
    const seen = latest.get(run.automation_id);
    if (!seen || run.started_at > seen.started_at) {
      latest.set(run.automation_id, run);
    }
    if (run.status === 'running') {
      live.set(run.automation_id, (live.get(run.automation_id) || 0) + 1);
    }
  }

  if (list.length === 0) {
    return (
      // .tab-empty, the shape an empty Profiles, Proxies, Cookies or Start tab
      // takes: a centred column under the topbar with the mark at a fixed 56px,
      // so the glyph lands on the same line whichever of them you arrive at.
      // This used to centre itself in 60vh instead, which put it lower than all
      // four and moved as the window resized.
      //
      // The block survives the restyle -- Extensions has no empty state and says
      // so, but its add-tile stands in for four words of encouragement, and this
      // one carries four distinct offers (create, load the example, mint a Demo
      // profile, read the docs) that no tile can hold.
      <section className="tab-empty">
        <span className="tab-empty-mark">
          <Workflow size={26} strokeWidth={1.5} />
        </span>
        <h2>No automations yet</h2>
        <p>
          {atCap ?
            'Your plan doesn\'t include automations yet. They run a list of steps ' +
              'against a profile — open a page, fill a form, read something back — ' +
              'on launch, on a schedule, or from an agent.' :
            'An automation is a list of steps run against a profile: open a page, ' +
              'fill a form, read something back. Attach one to a profile and it runs ' +
              'when that profile launches.'}
        </p>
        <div className="tab-empty-actions">
          {atCap ? (
            <button className="primary" onClick={() => onOpenSite(SITE_LINKS.pricing)}>
              See plans
            </button>
          ) : (
            <>
              <button className="primary" onClick={onNew}>
                <Plus size={18} /> Create your first automation
              </button>
              {/* Inside the !atCap branch with the primary button, and for the
                  same reason: loading the example is an INSERT, so an org with
                  no automation slots left must not be offered it only to be
                  refused by trg_automation_limit after the click. */}
              <button className="ghost" onClick={onLoadExample}>
                <Sparkles size={18} /> Load the example
              </button>
            </>
          )}
          {/* A first automation is useless without something to run it on, and
              the Run button stays disabled until one exists. Direct mode needs
              no proxy, so this is the one profile we can offer to make outright
              rather than sending the user to another tab. */}
          {hasNoProfiles && (
            <button className="ghost" onClick={onCreateDemoProfile}>
              <MonitorSmartphone size={18} /> Create a Demo profile
            </button>
          )}
          <button className="ghost" onClick={() => onOpenSite(SITE_LINKS.docs)}>
            <BookOpen size={18} /> See the documentation
          </button>
        </div>
      </section>
    );
  }

  const shown = view === 'pinned' ?
    list.filter((automation) => automation.pinned) :
    view === 'mine' ?
      list.filter((automation) => automation.assigned_to === org.userId) :
      list;
  // The third chip only earns its place once there is somebody to tell apart.
  const showAssignee = state.members.length > 1;

  return (
    <section className="automations-tab">
      {/* The tab's frame, on the paper surface the Extensions and Integrations
          bars use: what you are looking at on the left, how many there are and
          how to make another on the right. */}
      <section className="integration-bar">
        <div className="choice-chips" role="radiogroup" aria-label="Automations view">
          {(['all', 'pinned', 'mine'] as const)
              .filter((option) => option !== 'mine' || showAssignee)
              .map((option) => (
                <button
                  aria-checked={view === option}
                  className={view === option ? 'choice-chip active' : 'choice-chip'}
                  key={option}
                  onClick={() => setView(option)}
                  role="radio"
                  type="button"
                >
                  {option === 'all' ? 'All' :
                    option === 'pinned' ? 'On start pages' : 'Assigned to me'}
                </button>
              ))}
        </div>
        <div className="integration-bar-side">
          <span className="integration-bar-count">
            <strong>{shown.length}</strong> {shown.length === 1 ? 'automation' : 'automations'}
          </span>
          <button
            className="ghost"
            disabled={atCap}
            onClick={onNew}
            title={atCap ?
              'Your plan doesn\'t include any more automations.' :
              'Create an automation'}
          >
            <Plus size={16} /> New automation
          </button>
        </div>
      </section>

      {/* Repeated from the empty state on purpose. That copy of the offer goes
          away the instant the first automation is saved, so someone who loads
          the example before making a profile would otherwise be left with a Run
          button that is disabled and nothing on this tab explaining how to
          un-disable it.
          Shaped like the Extensions tab's admin note rather than as its own
          box: it is a standing fact about the screen, not a message about
          something that just happened. */}
      {hasNoProfiles && (
        <section className="api-note automation-profile-note">
          <MonitorSmartphone size={18} />
          <span>An automation needs a profile to run against.</span>
          <button className="ghost" onClick={onCreateDemoProfile}>
            <MonitorSmartphone size={16} /> Create a Demo profile
          </button>
        </section>
      )}

      <div className="automation-grid">
        {shown.map((automation) => {
          const attachedTo = state.profiles.filter(
              (profile) => !profile.deleted_at && profile.automation_id === automation.id);
          const run = latest.get(automation.id);
          const runningCount = live.get(automation.id) || 0;
          const busy = runningCount > 0;
          return (
            <article className="automation-card" key={automation.id}>
              {/* One flex-wrap row -- mark, name, step count -- like
                  .extension-card-head. The step count leads the badges because
                  it is the one fact every automation has; the rest are wiring,
                  and wiring belongs under the description.
                  Delete used to sit here, at the end of the row. It was the one
                  destructive action in the app reachable in a single click from
                  a grid, on a card whose other three buttons are all safe, and
                  it guarded itself with a window.confirm(). It now lives in the
                  editor's footer beside Cancel and Save -- you open the thing
                  before you throw it away. */}
              <div className="automation-card-head">
                <span aria-hidden="true" className="extension-mark is-fallback">
                  <Workflow size={20} strokeWidth={1.75} />
                </span>
                <h3>{automation.name}</h3>
                <Badge icon={<Layers size={12} />}>
                  {automation.steps.length} step{automation.steps.length === 1 ? '' : 's'}
                </Badge>
              </div>

              {/* Always rendered, empty or not: this is the element carrying
                  flex: 1, and it is what makes every card's foot land on the
                  same line across a row. A card without one would pull its
                  buttons up to meet its badges. */}
              <p>{automation.description}</p>

              {/* These were .status-pill -- green text, no fill, no border, no
                  radius, despite the name. Three of them in a row read as one
                  green sentence. Every tab that used it has since moved to
                  <Badge>, and the class is gone. */}
              {(attachedTo.length > 0 || automation.pinned || automation.assigned_to ||
                (automation.tags || []).length > 0) && (
                <div className="automation-card-meta">
                  {/* First, because "whose is this" is the question a team asks
                      of a card before any of the others. Only rendered when
                      somebody holds it -- an "Unassigned" badge on every card
                      would be a grid of noise. */}
                  {automation.assigned_to && (
                    <Assignee userId={automation.assigned_to} />
                  )}
                  {attachedTo.length > 0 && (
                    <Badge
                      icon={<Rocket size={12} />}
                      title={attachedTo.map((p) => p.name).join(', ')}
                    >On launch · {attachedTo.length}</Badge>
                  )}
                  {automation.pinned && (
                    <Badge icon={<Workflow size={12} />}>Start page</Badge>
                  )}
                  {/* Tags last, and in the tag chip rather than a Badge, so they
                      read as labels the user chose rather than as more facts the
                      app is reporting about this row. */}
                  {(automation.tags || []).map((tag) => <TagChip key={tag} tag={tag} />)}
                </div>
              )}

              {run && (
                <p className="automation-card-run">
                  <Badge tone={RUN_TONE[run.status]}>
                    {/* "Running · 3" rather than "Running": one automation can
                        be in flight on several profiles now, and a single label
                        would report a batch of five as one run. */}
                    {RUN_LABEL[run.status]}
                    {runningCount > 1 ? ` · ${runningCount}` : ''}
                  </Badge>
                  {!busy && run.duration_ms ?
                    ` in ${(run.duration_ms / 1000).toFixed(1)}s` :
                    ''}
                  {run.error ? ` — ${run.error}` : ''}
                </p>
              )}

              <div className="extension-card-foot">
                {/* Opens the picker; it never starts a run itself. It used to
                    resolve a target with runTarget() and go, which is how a run
                    landed on a profile nobody chose and died on that profile's
                    dead proxy. Disabled when nothing in the workspace could
                    accept a run -- but never for "which profile", which is a
                    question the dialog asks.
                    The title is on the wrapper, not on the button. Chromium
                    suppresses pointer events on a disabled control, tooltips
                    included, so the one moment the explanation is needed is the
                    one moment a title on the button itself never appears. */}
                <span title={block || 'Pick profiles and run'}>
                  <BusyButton
                    busy={busy}
                    busyLabel={runningCount > 1 ? `Running ${runningCount}` : 'Running'}
                    icon={<Play size={14} />}
                    onClick={() => onRun(automation)}
                    disabled={Boolean(block)}
                    // A disabled button is not tabbable, so the reason has to
                    // travel with its name to be readable at all.
                    aria-label={block ? `Run — ${block}` : undefined}
                  >Run</BusyButton>
                </span>
                <button className="ghost" onClick={() => onEdit(automation)}>Edit</button>
                {/* Per-card rather than on a selection toolbar, because this tab
                    has no selection model at all -- no checkboxes, no
                    useSelection. Adding one just to reach parity with the three
                    table tabs would be a larger change than the button. */}
                <button
                  className="ghost"
                  onClick={() => onShare({kind: 'automation', ids: [automation.id]})}
                  aria-label={`Share ${automation.name}`}
                  title="Share with another workspace"
                ><Share2 size={14} /></button>
                <button
                  className="ghost automation-card-history"
                  onClick={() => onHistory(automation)}
                  aria-label={`History for ${automation.name}`}
                  title="Run history"
                ><History size={14} /></button>
              </div>
            </article>
          );
        })}

        {/* Last tile rather than a button somewhere else, the pattern the
          * Extensions grid and the start page's bookmark grid both use: the way
          * to get another one of these sits where the next one would go. Not
          * shown while the Pinned filter is on -- a new automation is not
          * pinned, so it would land outside the list it was added to. */}
        {view === 'all' && !atCap && (
          <button className="automation-card extension-add-tile" onClick={onNew} type="button">
            <span className="extension-add-icon"><Plus size={20} strokeWidth={1.75} /></span>
            <span className="extension-add-label">New automation</span>
            <span className="extension-add-hint">A list of steps run against a profile</span>
          </button>
        )}
      </div>

      {/* The Pinned view can be legitimately empty -- nothing is pinned by
        * default -- and an empty grid under a chip that is clearly on reads as
        * a page that failed rather than as an answer. */}
      {shown.length === 0 && (
        <p className="automation-view-empty">
          No automations are on your start pages yet. Open one and pin it, or pin it
          from the Start page tab.
        </p>
      )}
    </section>
  );
}
