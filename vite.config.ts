import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
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
  },
});
