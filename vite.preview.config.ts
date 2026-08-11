// SCRATCH — not part of the app. Serves preview-sidebar.html and
// preview-updates.html with src/org.tsx swapped for a fixture, so the real
// components mount with no Supabase session. Delete with the other preview-*
// files.
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{
      find: /^(.*)\/src\/org$/,
      replacement: fileURLToPath(new URL('./preview-org', import.meta.url)),
    }, {
      find: /^(?:\.\.\/)+org$/,
      replacement: fileURLToPath(new URL('./preview-org', import.meta.url)),
    }, {
      // useAutomationActions imports named exports from a .cjs module. The
      // production build resolves that; `vite` in dev does not, and the whole
      // page dies on it -- which is true of index.html too, so it is not
      // something this harness introduced. Stubbed rather than fixed here:
      // nothing on the Updates page runs an automation.
      // Anchored at both ends: a RegExp alias replaces only the matched span,
      // so an unanchored pattern leaves the "../../" prefix glued to an
      // absolute path.
      find: /^.*electron\/automation\/notify\.cjs$/,
      replacement: fileURLToPath(new URL('./preview-notify-stub.ts', import.meta.url)),
    }, {
      // The import harness (preview-imports.tsx) hands the dialogs fixture
      // files. Without this each one raises a picker that is not there and
      // stops on its source step -- the one step that did not need looking at.
      // Anchored the same way the notify stub is, and for the same reason.
      find: /^(.*)\/src\/native$/,
      replacement: fileURLToPath(new URL('./preview-native', import.meta.url)),
    }, {
      find: /^(?:\.\.\/)+native$/,
      replacement: fileURLToPath(new URL('./preview-native', import.meta.url)),
    }, {
      // The Automations-tab harness swaps the whole workspace for a fixture --
      // the tab and its children (Assignee, the cards) read useWorkspace().
      find: /^(.*)\/workspace\/WorkspaceProvider$/,
      replacement: fileURLToPath(new URL('./preview-workspace', import.meta.url)),
    }],
  },
  server: {host: '127.0.0.1', port: 5199, strictPort: true},
});
