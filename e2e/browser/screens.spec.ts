// Every main route in Chromium, signed in, with data, in the scope that serves it, in the light and
// the dark theme, at desktop and tablet width (TDD-organization-experience-001 §Visual Language). Each
// is kept as a screenshot, the CI artifact `browser-screens`, and checked with axe-core's WCAG 2.0,
// 2.1 and 2.2 A and AA rules, which here run with layout and computed style, as jsdom cannot.
//
// This is automated evidence only. Playwright's guide: "automated testing cannot detect all types of
// WCAG violations". What axe cannot decide is recorded on the test as "needs review", never passed.
import { appendFileSync } from 'node:fs';
import path from 'node:path';

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { offboardingId, type Persona } from './fixtures.ts';

const wcagTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

interface Screen {
  readonly name: string;
  readonly persona: Persona;
  readonly path: string;
  // ready is something the page shows once its reads have answered.
  readonly ready: (page: Page) => ReturnType<Page['getByText']>;
  // act, when set, opens what the page shows only on request: a confirmation, a review.
  readonly act?: (page: Page) => Promise<void>;
  readonly tablet?: boolean;
}

const screens: readonly Screen[] = [
  {
    name: 'signed-out',
    persona: 'signed-out',
    path: '/',
    ready: (page) => page.getByText('Not signed in'),
    tablet: true,
  },
  {
    name: 'tenant-overview',
    persona: 'tenant',
    path: '/',
    ready: (page) => page.getByText('Beta Logistics'),
    tablet: true,
  },
  {
    name: 'tenant-workspaces',
    persona: 'tenant',
    path: '/workspaces',
    ready: (page) => page.getByText('Legacy ERP'),
  },
  {
    name: 'tenant-memberships',
    persona: 'tenant',
    path: '/memberships',
    ready: (page) => page.getByText('0199a1b2-1111-7e5f-8a9b-000000000004'),
    tablet: true,
  },
  {
    name: 'tenant-memberships-revoke',
    persona: 'tenant',
    path: '/memberships',
    ready: (page) => page.getByText('0199a1b2-1111-7e5f-8a9b-000000000004'),
    act: async (page) => {
      const row = page.getByRole('listitem').filter({ hasText: '0199a1b2-1111-7e5f-8a9b-000000000001' });
      await row.getByRole('button', { name: 'Revoke' }).click();
      await row.getByRole('form', { name: 'Revoke' }).waitFor();
    },
  },
  {
    name: 'tenant-memberships-bulk',
    persona: 'tenant',
    path: '/memberships',
    ready: (page) => page.getByText('0199a1b2-1111-7e5f-8a9b-000000000004'),
    act: async (page) => {
      await page.getByRole('checkbox').first().check();
      await page.getByRole('checkbox').nth(1).check();
      await page.getByRole('button', { name: /Act on 2 selected/ }).click();
      await page.getByRole('form', { name: 'Bulk action' }).waitFor();
    },
  },
  {
    name: 'tenant-invitations',
    persona: 'tenant',
    path: '/invitations',
    ready: (page) => page.getByText('0192f0e0-eeee-7000-8000-00000000e004'),
  },
  {
    name: 'tenant-provider-access',
    persona: 'tenant',
    path: '/provider-access',
    ready: (page) => page.getByText('Incident 4471', { exact: false }),
  },
  {
    name: 'provider-overview',
    persona: 'provider',
    path: '/',
    ready: (page) => page.getByRole('form', { name: 'Enter provider mode' }),
    tablet: true,
  },
  {
    name: 'provider-pending',
    persona: 'provider-pending',
    path: '/',
    ready: (page) => page.getByRole('button', { name: 'Withdraw the request' }),
  },
  {
    name: 'provider-approvals-reason',
    persona: 'provider',
    path: '/approvals',
    ready: (page) => page.getByRole('form', { name: 'Review requests' }),
  },
  {
    name: 'provider-mode-overview',
    persona: 'provider-mode',
    path: '/',
    ready: (page) => page.getByRole('button', { name: 'Leave provider mode' }),
  },
  {
    name: 'provider-mode-organizations',
    persona: 'provider-mode',
    path: '/organizations',
    ready: (page) => page.getByText('Contoso Publishing'),
  },
  {
    name: 'provider-mode-tenants',
    persona: 'provider-mode',
    path: '/tenants',
    ready: (page) => page.getByText('the silo region is at capacity', { exact: false }),
    tablet: true,
  },
  {
    name: 'provider-mode-offboardings',
    persona: 'provider-mode',
    path: '/offboardings',
    ready: (page) => page.getByRole('link', { name: '0192f0e0-aaaa-7000-8000-00000000a002' }),
  },
  {
    name: 'provider-mode-offboarding',
    persona: 'provider-mode',
    path: `/offboardings/${offboardingId}`,
    ready: (page) => page.getByText('ticket system refused', { exact: false }),
  },
  {
    name: 'provider-mode-projections',
    persona: 'provider-mode',
    path: '/projections',
    ready: (page) => page.getByText('Stale: past its budget', { exact: false }),
  },
  {
    name: 'provider-mode-access-review',
    persona: 'provider-mode',
    path: '/access-review?actor_id=0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4bbb',
    ready: (page) => page.getByText('Each access matched an incident ticket.', { exact: false }),
  },
  {
    name: 'provider-mode-approvals',
    persona: 'provider-mode',
    path: '/approvals',
    ready: (page) => page.getByText('Restore the memberships', { exact: false }),
  },
];

const themes = ['light', 'dark'] as const;
const viewports = {
  desktop: { width: 1440, height: 960 },
  tablet: { width: 820, height: 1180 },
} as const;

// The theme is the viewer's stored choice, and without one the system's (apps/admin/src/ui/theme.ts).
// Both are set, so the page opens in the theme under test whichever it reads.
async function open(
  page: Page,
  origin: string,
  screen: Screen,
  theme: (typeof themes)[number],
): Promise<void> {
  await page.context().addCookies([{ name: 'persona', value: screen.persona, url: origin }]);
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript({
    content: `try { window.localStorage.setItem('scnx-org-preferences', ${JSON.stringify(
      JSON.stringify({ theme }),
    )}); } catch {}`,
  });
  await page.goto(screen.path);
  await expect(screen.ready(page).first()).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  if (screen.act !== undefined) {
    await screen.act(page);
  }
}

for (const theme of themes) {
  for (const screen of screens) {
    for (const viewport of screen.tablet === true
      ? (['desktop', 'tablet'] as const)
      : (['desktop'] as const)) {
      test(`${screen.name}, ${theme}, ${viewport}`, async ({ page, baseURL }) => {
        await page.setViewportSize(viewports[viewport]);
        await open(page, baseURL ?? '', screen, theme);
        await page.screenshot({
          path: path.join(
            test.info().project.outputDir,
            '..',
            'screens',
            `${viewport}-${theme}-${screen.name}.png`,
          ),
          fullPage: true,
          animations: 'disabled',
        });
        // The page never scrolls sideways: a wide table scrolls inside its own region.
        const overflow = Number(
          await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth'),
        );
        expect.soft(overflow, 'horizontal page overflow in px').toBeLessThanOrEqual(0);

        const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
        const violations = results.violations.map((violation) => ({
          rule: violation.id,
          impact: violation.impact,
          nodes: violation.nodes.map((node) => node.target.join(' ')),
        }));
        expect(violations).toEqual([]);
        // What axe could not decide is left for the manual audit: on the test, and in needs-review.txt
        // beside the screenshots, never counted as passed.
        for (const undecided of results.incomplete) {
          const description = `${theme} ${viewport}: ${undecided.id}: ${String(undecided.nodes.length)} node(s)`;
          test.info().annotations.push({ type: 'needs review', description });
          appendFileSync(
            path.join(test.info().project.outputDir, '..', 'screens', 'needs-review.txt'),
            `${screen.name} ${description}\n`,
          );
        }
      });
    }
  }
}
