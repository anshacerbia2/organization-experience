// The fixture-backed browser tests (TDD-organization-experience-001 §Visual Language): Chromium
// against the built application, served with the BFF's security headers by browser/serve.ts, every
// read answered by browser/fixtures.ts. They need the application built (pnpm build). The stack's own
// journeys are playwright.config.ts's, in the stack-proof workflow.
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env['E2E_BROWSER_PORT'] ?? '18491');

export default defineConfig({
  testDir: 'browser',
  outputDir: 'browser-results/tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env['CI'] !== undefined,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'browser-results/report' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${String(port)}`,
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node browser/serve.ts',
    url: `http://127.0.0.1:${String(port)}/healthz`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
