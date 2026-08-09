// SCRATCH — throwaway. The real ProfileModal, mounted with fixture providers so
// the redesigned editor can be screenshotted without a Supabase session (the
// sign-in OTP cannot be automated).
//
// What it exists to prove, and what only a screenshot can: the section cards and
// the summary groups are drawn with --frame / --frame-card, and those two tokens
// SWAP between light and dark. A frame that reads correctly in light can vanish
// into the page in dark, and the controls inside it fill with --frame-card for
// the same reason. Both themes have to be looked at.
//
//   npx vite --config vite.preview.config.ts
//   open http://127.0.0.1:5199/preview-profile.html
//   open http://127.0.0.1:5199/preview-profile.html?theme=dark
//
// Delete with the other preview-* files.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ProfileModal} from './components/modals/ProfileModal';
import {WorkspaceProvider} from './workspace/WorkspaceProvider';
import {newProfileDraft} from './drafts';
import type {ProfileDraft} from './drafts';
import './styles.css';
import './styles/automations.css';

// A saved profile, because that is the state with the most in it: Delete only
// appears for one, and Notes is the seventh card only when the row exists.
function seed(): ProfileDraft {
  return {
    ...newProfileDraft('u'),
    id: 'p1',
    saved: true,
    name: 'Renter DE-1',
    status: 'Active',
    color: 'blue',
    tags: 'warmup, client-a',
    folder_id: 'f-social',
    assigned_to: 'v',
    email: 'renter.de1@example.com',
    password: 'hunter2',
    login_url: 'https://www.immobilienscout24.de/login',
    proxy_mode: 'direct',
    start_url: 'https://www.immobilienscout24.de',
    automation_id: 'a1',
    cookie_mode: 'saved',
    cookie_id: 'c1',
  };
}

function Preview() {
  const [draft, setDraft] = useState<ProfileDraft>(seed);
  return (
    <ProfileModal
      draft={draft}
      onChange={setDraft}
      onClose={() => {}}
      onCreateProxy={() => {}}
      onNewStatus={() => {}}
      onPickCookies={() => {}}
      onRequestDelete={() => {}}
    />
  );
}

const theme = new URLSearchParams(location.search).get('theme');
document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';

createRoot(document.getElementById('root') as HTMLElement).render(
    <WorkspaceProvider><Preview /></WorkspaceProvider>,
);
