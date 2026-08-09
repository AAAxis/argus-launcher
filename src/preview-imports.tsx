// SCRATCH — throwaway. The three real import dialogs, mounted with fixture
// providers and a fixture file picker so the redesign can be screenshotted
// without a Supabase session (the sign-in OTP cannot be automated).
//
// What it exists to prove, and what only a screenshot can: all three now wear
// the editor's sticky header and framed FormGroup cards, and those cards are
// drawn with --frame / --frame-card, which SWAP between light and dark. A frame
// that reads correctly in light can vanish into the page in dark. Both themes
// have to be looked at, in every dialog, on every step.
//
//   npx vite --config vite.preview.config.ts
//   open 'http://127.0.0.1:5199/preview-imports.html?which=proxies'
//   open 'http://127.0.0.1:5199/preview-imports.html?which=cookies&theme=dark'
//   open 'http://127.0.0.1:5199/preview-imports.html?which=profiles'
//
// Delete with the other preview-* files.
import {createRoot} from 'react-dom/client';
import {ImportCookiesModal} from './components/modals/ImportCookiesModal';
import {ImportProfilesModal} from './components/modals/ImportProfilesModal';
import {ImportProxiesModal} from './components/modals/ImportProxiesModal';
import {WorkspaceProvider} from './workspace/WorkspaceProvider';
import './styles.css';
import './styles/automations.css';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme =
  params.get('theme') === 'dark' ? 'dark' : 'light';

const which = params.get('which') || 'proxies';

function Preview() {
  if (which === 'cookies') {
    return <ImportCookiesModal folderId={null} onClose={() => {}} />;
  }
  if (which === 'profiles') {
    return <ImportProfilesModal onClose={() => {}} />;
  }
  return <ImportProxiesModal folderId={null} onClose={() => {}} />;
}

createRoot(document.getElementById('root') as HTMLElement).render(
    <WorkspaceProvider><Preview /></WorkspaceProvider>,
);
