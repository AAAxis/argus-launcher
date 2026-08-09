// SCRATCH — not part of the app. The three surfaces automation parameters
// added, mounted for real against the fixture workspace so they can be looked
// at without a Supabase session or a browser install.
//
//   npx vite --config vite.preview.config.ts
//   open 'http://127.0.0.1:5199/preview-parameters.html?view=editor'
//        …?view=run   …?view=profile
//
// One view at a time, chosen by query string, because two of the three are
// full-screen modals and stacking them would only show the top one.
import {StrictMode, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AutomationModal} from './components/modals/AutomationModal';
import {RunAutomationModal} from './components/modals/RunAutomationModal';
import {ProfileAutomationValues} from './components/automations/ProfileAutomationValues';
import {WorkspaceProvider, useWorkspace} from './workspace/WorkspaceProvider';
import './styles.css';
import './styles/automations.css';

const view = new URLSearchParams(location.search).get('view') || 'editor';

function Editor() {
  const {data} = useWorkspace();
  const [draft, setDraft] = useState(data.state.automations[0]);
  return (
    <AutomationModal
      automation={draft}
      exists
      profiles={data.state.profiles}
      automations={data.state.automations}
      members={data.state.members}
      onClose={() => {}}
      onSave={async (next) => {
        setDraft(next);
        return null;
      }}
    />
  );
}

function Run() {
  const {data} = useWorkspace();
  return (
    <RunAutomationModal
      automation={data.state.automations[0]}
      onFixProxy={() => {}}
      onClose={() => {}}
    />
  );
}

// The profile editor's block on its own, rather than the whole ProfileModal:
// that dialog needs a full ProfileDraft and half the workspace, and none of it
// is what changed here.
function ProfileValues() {
  const {data} = useWorkspace();
  const [value, setValue] = useState<Record<string, Record<string, string>>>({
    a1: {city_name: 'Dortmund', number_of_rooms: '2'},
  });
  return (
    <main style={{padding: 24, maxWidth: 560}}>
      <h2 style={{fontSize: 15, marginTop: 0}}>Automation values</h2>
      <ProfileAutomationValues
        automations={data.state.automations}
        attachedId="a1"
        value={value}
        onChange={setValue}
      />
    </main>
  );
}

function Preview() {
  return (
    <WorkspaceProvider>
      {view === 'run' ? <Run /> : view === 'profile' ? <ProfileValues /> : <Editor />}
    </WorkspaceProvider>
  );
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Preview />
    </StrictMode>,
);
