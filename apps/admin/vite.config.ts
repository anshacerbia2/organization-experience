/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The build emits files only. Nothing is inlined: the BFF's content security policy allows
// scripts, styles and fonts from 'self' and nothing inline (TDD-identity-experience-001), so an
// inlined asset would be refused in production and pass in development.
//
// The styles are identity-experience's (TDD-organization-experience-001 §Visual Language): SCSS
// Modules beside their components, inside cascade layers, as its Vite config builds them.
export default defineConfig({
  plugins: [react()],
  css: {
    modules: { localsConvention: 'camelCaseOnly' },
    preprocessorOptions: {
      scss: {
        // Cascade layers take their order from the first stylesheet that names them. A component's
        // chunk can load before the global stylesheet that states the order, and the reset's button
        // rules would then beat every Button's own. Stating the order at the top of every stylesheet
        // makes it the same whichever loads first. A file with @use states it through _layers.scss,
        // and Sass allows nothing before an @use.
        additionalData: (source: string): string =>
          source.includes('@use')
            ? source
            : `@layer reset, tokens, base, components, utilities, overrides;\n${source}`,
      },
    },
  },
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
    css: { modules: { classNameStrategy: 'non-scoped' } },
    restoreMocks: true,
  },
});
