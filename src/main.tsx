import {createRoot} from 'react-dom/client';
import {App} from './App';
import {OrgProvider} from './org';
import {ThemeProvider} from './theme';
import {WorkspaceProvider} from './workspace/WorkspaceProvider';
import './styles.css';

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
