// SCRATCH — not part of the app. The Automations tab with fixture state: a
// starred brand card, a failed run, an agent-created card marked new, schedule
// badges. Mounts the REAL AutomationsTab; only the workspace behind it is
// invented (preview-workspace.tsx via vite.preview.config.ts).
//
//   npx vite --config vite.preview.config.ts
//   open http://127.0.0.1:5199/preview-automations.html
import {StrictMode, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AutomationsTab} from './components/tabs/AutomationsTab';
import {WorkspaceProvider} from './workspace/WorkspaceProvider';
import './styles.css';
import './styles/automations.css';

function Preview() {
  // Real state, not a constant: the folder rail and Trash are the whole point
  // of looking at this tab, and both are unreachable if clicking a card does
  // nothing.
  const [folderId, setFolderId] = useState('');
  return (
    <WorkspaceProvider>
      <main style={{padding: 24}}>
        <AutomationsTab
          folderId={folderId}
          onFolderId={setFolderId}
          onNewFolder={() => {}}
          onEditFolder={() => {}}
          onEdit={() => {}}
          onNew={() => {}}
          onLoadExample={() => {}}
          onCreateDemoProfile={() => {}}
          onRun={() => {}}
          onHistory={() => {}}
          onShare={() => {}}
          onOpenSite={() => {}}
          onNewConnector={() => {}}
          onEditConnector={() => {}}
          // Named outright, where the app derives it from a watermark: a3 is
          // the MCP-authored fixture in preview-workspace.tsx, and a harness
          // whose green depended on what localStorage happened to hold would
          // show something different on every machine that opened it.
          newIds={new Set(['a3'])}
        />
      </main>
    </WorkspaceProvider>
  );
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Preview />
    </StrictMode>,
);
