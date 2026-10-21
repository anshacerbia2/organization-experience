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

import {
  betaTenant,
  invitationToken,
  me,
  tenantId,
  offboardingId,
  releasedOffboardingId,
  type Persona,
} from './fixtures.ts';

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
  // commands, when set, are what the page's commands are answered with. The stand-in takes no command
  // (serve.ts), so a screen that shows a command's outcome answers it here, in the browser.
  readonly commands?: readonly Command[];
  // reads, when set, answer the page's reads in place of the stand-in's fixtures, in the browser.
  readonly reads?: readonly Command[];
}

interface Command {
  readonly path: string;
  readonly status: number;
  readonly body: unknown;
}

// The acceptance of an invitation (TDD-organization-experience-002 1.8.0), as the API answers it.
const acceptPath = '/api/v1/invitations/accept';
const acceptedInvitation = {
  invitation: {
    invitation_id: '0192f0e0-eeee-7000-8000-00000000e009',
    tenant_id: betaTenant,
    subject_type: 'human',
    invited_by: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4bbb',
    state: 'accepted',
    correlation_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a77',
    principal_id: me,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    created_at: new Date().toISOString(),
    accepted_at: new Date().toISOString(),
  },
  membership: {
    membership: { membership_id: 'm-2', status: 'active' },
    accepted_at: new Date().toISOString(),
  },
};
const acceptance = (name: string, status: number, body: unknown, shows: string): Screen => ({
  name,
  persona: 'provider',
  path: `/invitations/accept#${invitationToken}`,
  ready: (page) => page.getByText('You have been invited to join a Tenant.'),
  commands: [{ path: acceptPath, status, body }],
  act: async (page) => {
    await page.getByRole('button', { name: 'Accept invitation' }).click();
    await page.getByText(shows, { exact: false }).waitFor();
  },
  tablet: status === 200,
});

// The person's own contexts, as the self read answers them (ADR-ORG-005 §5.2), for the picker after a
// sign-in without a Tenant (TDD-organization-experience-002 1.9.0) with one entry and with none. The
// fixtures' two entries are the picker with several.
const contextsPath = `/api/v1/principals/${me}/contexts`;
const oneContext: Command = {
  path: contextsPath,
  status: 200,
  body: {
    contexts: [
      {
        membership_id: 'm-1',
        tenant_id: tenantId,
        tenant_display_name: 'Acme Retail',
        tenant_status: 'active',
        workspace_id: null,
        administers: true,
      },
    ],
    next: null,
  },
};
const noContexts: Command = { path: contextsPath, status: 200, body: { contexts: [], next: null } };

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
  // TDD-organization-experience-002 1.8.0: the acceptance link, shown once as the invitation is issued.
  {
    name: 'tenant-invitations-issued-link',
    persona: 'tenant',
    path: '/invitations',
    ready: (page) => page.getByText('0192f0e0-eeee-7000-8000-00000000e004'),
    commands: [
      {
        path: '/api/v1/invitations',
        status: 201,
        body: {
          invitation: { invitation_id: '0192f0e0-eeee-7000-8000-00000000e009', state: 'pending' },
          token: invitationToken,
        },
      },
    ],
    act: async (page) => {
      await page.getByLabel('Invitee').fill('grace@example.com');
      await page.getByRole('button', { name: 'Send invitation' }).click();
      await page.getByRole('region', { name: 'The acceptance link, shown this once' }).waitFor();
    },
  },
  // The acceptance page, signed in with no Tenant, before acceptance and after each answer; and
  // signed out, where it asks for a sign-in first.
  {
    name: 'invitation-accept',
    persona: 'provider',
    path: `/invitations/accept#${invitationToken}`,
    ready: (page) => page.getByRole('button', { name: 'Accept invitation' }),
    tablet: true,
  },
  {
    name: 'invitation-accept-signed-out',
    persona: 'signed-out',
    path: `/invitations/accept#${invitationToken}`,
    ready: (page) => page.getByRole('button', { name: 'Sign in to accept' }),
  },
  acceptance('invitation-accepted', 200, acceptedInvitation, 'You joined Beta Logistics.'),
  acceptance(
    'invitation-refused',
    404,
    {
      type: 'https://problems.scnehaux.com/invitation-not-acceptable',
      title: 'The invitation cannot be accepted',
      status: 404,
      detail: 'The invitation cannot be accepted',
    },
    'This invitation cannot be accepted.',
  ),
  acceptance(
    'invitation-unavailable',
    503,
    { type: 'https://problems.scnehaux.com/dependency-unavailable', status: 503 },
    'Nothing changed. Try again later.',
  ),
  {
    name: 'tenant-provider-access',
    persona: 'tenant',
    path: '/provider-access',
    ready: (page) => page.getByText('Incident 4471', { exact: false }),
  },
  // TDD-organization-experience-001 1.11.0: signed in without a Tenant, the person's Tenants first, then
  // provider administration; with several, one and no contexts.
  {
    name: 'provider-overview',
    persona: 'provider',
    path: '/',
    ready: (page) => page.getByRole('link', { name: 'Beta Logistics' }),
    tablet: true,
  },
  {
    name: 'picker-one-tenant',
    persona: 'provider',
    path: '/',
    reads: [oneContext],
    ready: (page) => page.getByRole('link', { name: 'Acme Retail' }),
  },
  {
    name: 'picker-no-tenant',
    persona: 'provider',
    path: '/',
    reads: [noContexts],
    ready: (page) => page.getByText('You hold no active membership in an active Tenant.', { exact: false }),
    tablet: true,
  },
  // A Tenant surface reached without a Tenant: the notice, and the Tenants each returning to it.
  {
    name: 'picker-deep-link',
    persona: 'provider',
    path: '/memberships',
    ready: (page) => page.getByRole('link', { name: 'Beta Logistics' }),
  },
  // Where the provider sign-in returns: the provider mode form.
  {
    name: 'provider-mode-entry',
    persona: 'provider',
    path: '/provider-mode',
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
  // TDD-organization-experience-002 1.6.0: Start provisioning opened on a requested Tenant whose
  // request is `unresolved`, beside the sentence that says how that is resolved.
  {
    name: 'provider-mode-tenants-start-provisioning',
    persona: 'provider-mode',
    path: '/tenants',
    ready: (page) => page.getByText('Provisioning outcome unknown', { exact: false }),
    act: async (page) => {
      const row = page.getByRole('listitem').filter({ hasText: 'Eta Mobility' });
      await row.getByRole('button', { name: 'Start provisioning' }).click();
      await row.getByRole('form', { name: 'Start provisioning' }).waitFor();
    },
  },
  {
    name: 'provider-mode-tenants-retry-provisioning',
    persona: 'provider-mode',
    path: '/tenants',
    ready: (page) => page.getByText('the silo region is at capacity', { exact: false }),
    act: async (page) => {
      const row = page.getByRole('listitem').filter({ hasText: 'Epsilon Labs' });
      await row.getByRole('button', { name: 'Retry provisioning' }).click();
      await row.getByRole('form', { name: 'Retry provisioning' }).waitFor();
    },
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
  // TDD-organization-experience-002 1.10.0: the reporter registry, with Register reporter open; a
  // Tenant's Withdraw a Membership, read first and with Revoke membership open (1.12.0); and an issue
  // answered as a replay.
  // Projection health above shows a consumer past one interval, one past two, and a reconciliation a
  // restore requested.
  {
    name: 'provider-mode-reporters',
    persona: 'provider-mode',
    path: '/reporters',
    ready: (page) => page.getByText('The old ticketing integration', { exact: false }),
    tablet: true,
  },
  {
    name: 'provider-mode-reporters-register',
    persona: 'provider-mode',
    path: '/reporters',
    ready: (page) => page.getByText('The old ticketing integration', { exact: false }),
    act: async (page) => {
      const panel = page.getByRole('region', { name: 'Register reporter' });
      await panel.getByLabel('Workload Principal identifier').fill('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4ccc');
      await panel.getByLabel('Reports').selectOption('obligation');
      await panel.getByLabel('Domain').fill('hcm');
      await panel.getByLabel('Purpose').fill('HCM resolves its offboarding obligations');
      await panel.getByRole('button', { name: 'Register reporter' }).click();
      await panel.getByRole('form', { name: 'Register reporter' }).waitFor();
    },
  },
  {
    name: 'provider-mode-tenants-withdraw-membership',
    persona: 'provider-mode',
    path: '/tenants',
    ready: (page) => page.getByText('Zeta Freight'),
    act: async (page) => {
      const row = page.getByRole('listitem').filter({ hasText: 'Acme Retail' });
      await row.getByRole('button', { name: 'Withdraw a Membership' }).click();
      await row.getByLabel('Membership identifier').fill('0192f0e0-dddd-7000-8000-00000000d001');
      await row.getByLabel('Why you read it').fill('INC-4471 a compromised member');
      await row.getByRole('button', { name: 'Read the Membership' }).click();
      await row.getByText('version 3').waitFor();
      await row.getByRole('button', { name: 'Revoke membership' }).click();
      await row.getByRole('form', { name: 'Revoke membership' }).waitFor();
    },
  },
  {
    name: 'tenant-invitations-replayed',
    persona: 'tenant',
    path: '/invitations',
    ready: (page) => page.getByText('0192f0e0-eeee-7000-8000-00000000e004'),
    commands: [
      {
        path: '/api/v1/invitations',
        status: 201,
        body: { invitation: { invitation_id: '0192f0e0-eeee-7000-8000-00000000e009', state: 'pending' } },
      },
    ],
    act: async (page) => {
      await page.getByLabel('Invitee').fill('grace@example.com');
      await page.getByRole('button', { name: 'Send invitation' }).click();
      await page.getByText('This invitation was already issued', { exact: false }).waitFor();
    },
  },
  {
    name: 'provider-mode-access-review',
    persona: 'provider-mode',
    path: '/access-review?actor_id=0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4bbb',
    ready: (page) => page.getByText('Each access matched an incident ticket.', { exact: false }),
  },
  // TDD-organization-experience-002 1.7.0: the first administrator of an active Tenant, granted from
  // its row, with the confirmation open.
  {
    name: 'provider-mode-tenants-grant-administrator',
    persona: 'provider-mode',
    path: '/tenants',
    ready: (page) => page.getByText('Zeta Freight'),
    act: async (page) => {
      const row = page.getByRole('listitem').filter({ hasText: 'Acme Retail' });
      await row.getByRole('button', { name: 'Administrators' }).click();
      await row.getByText('Onboarding finished', { exact: false }).waitFor();
      await row.getByLabel('Principal identifier').fill('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4ccc');
      await row.getByRole('button', { name: 'Grant administrator' }).click();
      await row.getByRole('form', { name: 'Grant administrator' }).waitFor();
    },
  },
  // TDD-organization-experience-003 1.5.0: a failed deprovisioning, sent again.
  {
    name: 'provider-mode-offboarding-resend-deprovisioning',
    persona: 'provider-mode',
    path: `/offboardings/${releasedOffboardingId}`,
    ready: (page) => page.getByText('locked by a retention policy', { exact: false }),
    act: async (page) => {
      await page.getByRole('button', { name: 'Send deprovisioning again' }).click();
      await page.getByRole('form', { name: 'Send deprovisioning again' }).waitFor();
    },
  },
  // TDD-organization-experience-002 1.7.0: an active consumer's dead letters, and a retired one's
  // incident with Waive open; the pause a restore recorded, with Lift the pause open.
  {
    name: 'provider-mode-projections-dead-letters',
    persona: 'provider-mode',
    path: '/projections',
    ready: (page) => page.getByText('Stale: past its budget', { exact: false }),
    act: async (page) => {
      const row = page.getByRole('listitem').filter({ hasText: 'use with marker' });
      await row.getByRole('button', { name: 'Dead letters' }).click();
      await row.getByText('the consumer does not know the Tenant', { exact: false }).waitFor();
    },
  },
  {
    name: 'provider-mode-projections-waive',
    persona: 'provider-mode',
    path: '/projections',
    ready: (page) => page.getByText('Stale: past its budget', { exact: false }),
    act: async (page) => {
      const row = page.getByRole('listitem').filter({ hasText: 'legacy-search' }).first();
      await row.getByRole('button', { name: 'Dead letters' }).click();
      await row.getByRole('button', { name: 'Waive' }).click();
      await row.getByRole('form', { name: 'Waive' }).waitFor();
    },
  },
  {
    name: 'provider-mode-projections-lift-pause',
    persona: 'provider-mode',
    path: '/projections',
    ready: (page) => page.getByText('INC-12 restored', { exact: false }),
    act: async (page) => {
      await page.getByRole('button', { name: 'Lift the pause' }).click();
      await page.getByRole('form', { name: 'Lift the pause' }).waitFor();
    },
  },
  // TDD-organization-experience-002 1.7.0: provider grants in the Access review area, an emergency
  // grant being made.
  {
    name: 'provider-mode-access-review-grant-provider',
    persona: 'provider-mode',
    path: '/access-review',
    ready: (page) => page.getByText('On-call rotation', { exact: false }),
    act: async (page) => {
      const panel = page.getByRole('region', { name: 'Provider grants' });
      await panel.getByLabel('Principal identifier').fill('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4ccc');
      await panel.getByLabel('Kind').selectOption('emergency');
      await panel.getByRole('button', { name: 'Grant provider access' }).click();
      await panel.getByRole('form', { name: 'Grant provider access' }).waitFor();
    },
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
const overflowWidths = [1440, 1024, 820, 768, 390, 320] as const;

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
  for (const read of screen.reads ?? []) {
    await page.route(
      (url) => url.pathname === read.path,
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: read.status,
          contentType: 'application/json',
          body: JSON.stringify(read.body),
        });
      },
    );
  }
  for (const command of screen.commands ?? []) {
    await page.route(
      (url) => url.pathname === command.path,
      async (route) => {
        if (route.request().method() !== 'POST') {
          await route.fallback();
          return;
        }
        await route.fulfill({
          status: command.status,
          contentType: command.status >= 400 ? 'application/problem+json' : 'application/json',
          body: JSON.stringify(command.body),
        });
      },
    );
  }
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
        // The page never scrolls sideways: a wide table scrolls inside its own region. Checked at every
        // width layout.spec.ts lays pages out at, 320 CSS px included (STD-GLB-FE-005 2.1.0 §3.10, WCAG
        // 2.2 SC 1.4.10), then back at the screenshot's width for axe.
        for (const width of overflowWidths) {
          await page.setViewportSize({ width, height: viewports[viewport].height });
          await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
          const overflow = Number(
            await page.evaluate(
              'document.documentElement.scrollWidth - document.documentElement.clientWidth',
            ),
          );
          expect
            .soft(overflow, `horizontal page overflow in px at ${String(width)}px`)
            .toBeLessThanOrEqual(0);
        }
        await page.setViewportSize(viewports[viewport]);

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
