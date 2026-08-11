// SCRATCH — not part of the app. Mounts the real InboxBell in a real .topbar,
// beside a real Refresh and Import, so the three can be compared without a
// Supabase session -- the whole point of the redesign was that the bell had a
// frame the other two had shed. Delete with the other preview-* files.
//
// The panel is not open on load: the Popover only mounts its children on
// click, so the screenshot script has to press the bell. That is also what
// fires MarkReadOnOpen, which is worth seeing happen.
import {Upload} from 'lucide-react';
import {createRoot} from 'react-dom/client';
import {InboxBell} from './src/components/InboxBell';
import {RefreshButton} from './src/components/ui/RefreshButton';
import {WorkspaceProvider} from './src/workspace/WorkspaceProvider';
import './src/styles.css';

function Preview() {
  return (
    <main className="app-shell">
      <section className="content">
        <header className="topbar">
          <h1>Automations</h1>
          <div className="actions">
            <InboxBell onViewAll={() => {}} onOpenAutomationHistory={() => {}} />
            <RefreshButton />
            <button className="filter-trigger">
              <span className="filter-trigger-label">
                <Upload size={16} strokeWidth={1.9} /> Import
              </span>
            </button>
            <button>Add profile</button>
          </div>
        </header>
      </section>
    </main>
  );
}

document.documentElement.dataset.theme =
  new URLSearchParams(window.location.search).get('theme') || 'light';
createRoot(document.getElementById('root')!).render(
    <WorkspaceProvider><Preview /></WorkspaceProvider>);
