// The stack-level proof's browser journeys (TDD-organization-experience-001 §End to End,
// TDD-identity-experience-001 §Revocation), against the stack .github/workflows/stack-proof.yml
// brings up. Chromium alone, one worker and no retry (STD-GLB-FE-008 §3.4): a journey here proves the
// services, a second engine would only lengthen it, and a failure is triaged rather than retried away.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  // A journey waits out real lifetimes: a one-minute provider window, and an access token of class
  // L0, four minutes, before the refresh path ends a session.
  timeout: 15 * 60_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
  },
});
