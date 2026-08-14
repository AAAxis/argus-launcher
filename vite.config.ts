import {defineConfig, type Plugin} from 'vitest/config';
import react from '@vitejs/plugin-react';

// The renderer shares a few pure electron-side .cjs modules (see
// useAutomationActions.ts). `vite build` converts CommonJS itself and vitest
// runs them natively in node, but the dev server hands the raw file to the
// browser, where `module` does not exist and the whole renderer whitescreens
// at load. Serve-only: wrap the (dependency-free) body and hand its exports
// back as the default export, which the namespace-import interop at the call
// site resolves. `apply: 'serve'` keeps it out of builds; the mode guard in
// the config function keeps it away from vitest.
const electronCjsForRenderer: Plugin = {
  name: 'electron-cjs-for-renderer',
  apply: 'serve',
  transform(code, id) {
    if (!/\/electron\/[^?]*\.cjs$/.test(id)) return null;
    if (/\brequire\s*\(/.test(code)) {
      throw new Error(
          `${id} uses require(); only dependency-free electron .cjs modules can be served to the renderer.`);
    }
    return {
      code: `const module = {exports: {}}; const exports = module.exports;\n${code}\nexport default module.exports;`,
      map: null,
    };
  },
};

export default defineConfig(({mode}) => ({
  base: './',
  plugins: [react(), ...(mode === 'test' ? [] : [electronCjsForRenderer])],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  // No environment set: everything under test here is pure -- CSV parsing,
  // proxy parsing, and the import planner -- so it runs in plain node. A
  // component test would need jsdom adding to this block first.
  test: {
    include: ['src/**/*.test.ts'],
    // Tests must not read the developer's .env: with real Supabase values
    // present, src/supabase.ts builds a live client at import time, and
    // supabase-js's realtime half throws on Node < 22 (no native WebSocket).
    // Env-less, the client is null and every suite behaves the same on every
    // machine -- which is what these tests were written against.
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    },
  },
}));
