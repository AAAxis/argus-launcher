// SCRATCH — not part of the app. Serves preview-sidebar.html with src/org.tsx
// swapped for a fixture, so the real chrome mounts with no Supabase session.
// Delete with the other preview-* files.
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
      find: /^\.\.\/org$/,
      replacement: fileURLToPath(new URL('./preview-org', import.meta.url)),
    }],
  },
  server: {host: '127.0.0.1', port: 5199, strictPort: true},
});
