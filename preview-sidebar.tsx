// SCRATCH — not part of the app. Mounts the real Sidebar in both rail states so
// the collapse toggle and the workspace logo plate can be screenshotted without
// a Supabase session. Delete with the other preview-* files.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Sidebar} from './src/components/Shell';
import './src/styles.css';

function Preview() {
  const [collapsed, setCollapsed] = useState(
      new URLSearchParams(window.location.search).has('collapsed'));
  return (
    <main className={collapsed ? 'app-shell rail-collapsed' : 'app-shell'}>
      <Sidebar
        activeTab="profiles"
        collapsed={collapsed}
        onCreateWorkspace={() => {}}
        onLeaveWorkspace={() => {}}
        onSettings={() => {}}
        onSignOut={() => {}}
        onTab={() => {}}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        // Fixed rather than derived: the app reads these off a localStorage
        // watermark, and a harness whose badges depended on that would
        // screenshot differently on every machine. One single digit, one
        // double so the 9+ cap is visible, and one tab with none.
        newCounts={{profiles: 3, cookies: 12, automations: 1}}
      />
      <section className="content">
        <header className="topbar"><h1>Profiles</h1></header>
      </section>
    </main>
  );
}

document.documentElement.dataset.theme =
  new URLSearchParams(window.location.search).get('theme') || 'dark';
createRoot(document.getElementById('root')!).render(<Preview />);
