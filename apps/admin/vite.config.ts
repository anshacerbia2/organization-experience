/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The build emits files only. Nothing is inlined: the BFF's content security policy allows
// scripts, styles and fonts from 'self' and nothing inline (TDD-identity-experience-001), so an
// inlined asset would be refused in production and pass in development.
export default defineConfig({
  plugins: [react()],
  build: {
    assetsInlineLimit: 0,
    sourcemap: true,
    target: 'es2023',
  },
  server: {
    // The BFF serves the built application in every environment that matters. Locally, Vite
    // serves it and forwards the BFF's routes, so the browser still sees one origin.
    proxy: {
      '/api': 'http://127.0.0.1:8091',
      '/auth': 'http://127.0.0.1:8091',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
