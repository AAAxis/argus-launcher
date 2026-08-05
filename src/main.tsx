import {createRoot} from 'react-dom/client';
import {App} from './App';
import {OrgProvider} from './org';
import {ThemeProvider} from './theme';
import {WorkspaceProvider} from './workspace/WorkspaceProvider';
import './styles.css';
// After styles.css, not before: these rules used to be the last 340 lines of
// that file, and several of them lean on winning a tie against an earlier rule
// of equal specificity. Import order is cascade order.
import './styles/automations.css';

// OrgProvider owns the auth subscription and resolves which organization's data
// App should show, so it has to sit above App rather than inside it.
// WorkspaceProvider hangs the org's data off that id. ThemeProvider wraps all of
// it so the sign-in screen is themed too, not just the app shell.
createRoot(document.getElementById('root')!).render(
    <ThemeProvider>
      <OrgProvider>
        <WorkspaceProvider>
          <App />
        </WorkspaceProvider>
      </OrgProvider>
    </ThemeProvider>,
);
