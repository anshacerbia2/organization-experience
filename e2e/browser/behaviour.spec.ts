// What the screenshots cannot show, held in Chromium in both themes (TDD-organization-experience-001
// §Visual Language): the scope banner stays in view whatever the page scrolls to, focus is an outline,
// a link is underlined at rest, and a destructive action is drawn apart from the others.
import { expect, test, type Page } from '@playwright/test';

import { invitationToken, type Persona } from './fixtures.ts';

const themes = ['light', 'dark'] as const;

async function open(
  page: Page,
  origin: string,
  persona: Persona,
  theme: string,
  path: string,
): Promise<void> {
  await page.context().addCookies([{ name: 'persona', value: persona, url: origin }]);
  await page.emulateMedia({ colorScheme: theme === 'light' ? 'light' : 'dark' });
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

for (const theme of themes) {
  test(`the scope banner stays in view when the page scrolls, ${theme}`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    await open(page, baseURL ?? '', 'provider-mode', theme, '/tenants');
    await expect(page.getByText('Zeta Freight')).toBeVisible();
    await page.mouse.wheel(0, 5_000);
    await expect.poll(() => page.evaluate('window.scrollY')).toBeGreaterThan(200);
    const banner = page.getByRole('region', { name: 'Active scope' });
    await expect(banner).toBeInViewport({ ratio: 1 });
    await expect(banner).toContainText('ends in');
  });

  // The rail's surface and edge run the full height of a long page, and what it holds stays in view.
  for (const [persona, path, ready] of [
    ['provider-mode', '/tenants', 'Zeta Freight'],
    ['provider-mode', `/offboardings/0192f0e0-bbbb-7000-8000-00000000b001`, 'ticket system refused'],
    ['tenant', '/memberships', '0199a1b2-1111-7e5f-8a9b-000000000004'],
  ] as const) {
    test(`the rail spans a long page and stays in view, ${path}, ${theme}`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width: 1440, height: 600 });
      await open(page, baseURL ?? '', persona, theme, path);
      await expect(page.getByText(ready, { exact: false }).first()).toBeVisible();
      const height = Number(await page.evaluate('document.documentElement.scrollHeight'));
      expect(height).toBeGreaterThan(900);
      const rail = page.locator('aside');
      await expect
        .poll(async () => (await rail.boundingBox())?.height ?? 0)
        .toBeGreaterThanOrEqual(height - 1);
      await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)');
      await expect.poll(() => page.evaluate('window.scrollY')).toBeGreaterThan(200);
      // At the bottom of the page, the rail's surface and its edge still reach the viewport's bottom.
      await expect
        .poll(async () => {
          const box = await rail.boundingBox();
          return box === null ? 0 : box.y + box.height;
        })
        .toBeGreaterThanOrEqual(600);
      await expect(rail).toHaveCSS('border-inline-end-style', 'solid');
      await expect(rail).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(page.getByRole('navigation', { name: 'Sections' })).toBeInViewport();
      await expect(page.getByRole('link', { name: 'Scnehaux Organization' })).toBeInViewport();
    });
  }

  for (const forcedColors of ['none', 'active'] as const) {
    test(`a field and a button show focus as an outline, ${theme}, forced colours ${forcedColors}`, async ({
      page,
      baseURL,
    }) => {
      await page.emulateMedia({ forcedColors });
      await open(page, baseURL ?? '', 'tenant', theme, '/workspaces');
      const field = page.getByLabel('Display name');
      await expect(field).toBeVisible();
      const ring = async (focused: ReturnType<Page['locator']>): Promise<void> => {
        await expect(focused).toHaveCount(1);
        await expect(focused).toHaveCSS('outline-style', 'solid');
        await expect(focused).toHaveCSS('outline-width', '2px');
        await expect(focused).toHaveCSS('outline-offset', '2px');
      };
      await field.focus();
      await ring(page.locator('input:focus-visible'));
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await ring(page.locator('button[data-variant]:focus-visible'));
    });
  }

  test(`a link is underlined at rest, ${theme}`, async ({ page, baseURL }) => {
    await open(page, baseURL ?? '', 'tenant', theme, '/');
    await expect(page.getByRole('link', { name: 'Beta Logistics' })).toHaveCSS(
      'text-decoration-line',
      'underline',
    );
    await open(page, baseURL ?? '', 'provider-mode', theme, '/offboardings');
    await expect(page.getByRole('link', { name: '0192f0e0-aaaa-7000-8000-00000000a002' })).toHaveCSS(
      'text-decoration-line',
      'underline',
    );
  });

  // TDD-organization-experience-002 1.6.0: starting and retrying provisioning are forward steps, drawn
  // as primary like Activate, and each asks in its row, naming the Tenant, before it acts.
  test(`provisioning is started and retried as a primary action that asks first, ${theme}`, async ({
    page,
    baseURL,
  }) => {
    await open(page, baseURL ?? '', 'provider-mode', theme, '/tenants');
    for (const [name, label] of [
      ['Eta Mobility', 'Start provisioning'],
      ['Epsilon Labs', 'Retry provisioning'],
    ] as const) {
      const row = page.getByRole('listitem').filter({ hasText: name });
      await expect(row.getByRole('button', { name: label })).toHaveAttribute('data-variant', 'primary');
      await row.getByRole('button', { name: label }).click();
      const confirm = row.getByRole('form', { name: label });
      await expect(confirm).toContainText(`In Tenant ${name}`);
      await expect(confirm.getByLabel('Reason (optional)')).toBeVisible();
    }
    const unresolved = page.getByRole('listitem').filter({ hasText: 'Eta Mobility' });
    await expect(unresolved).toContainText('Do not retry');
    await expect(unresolved.getByRole('button', { name: 'Retry provisioning' })).toHaveCount(0);
  });

  // TDD-organization-experience-002 1.7.0 and -003 1.5.0: the first administrator is the forward step
  // after Activate, drawn as primary; sending a failed deprovisioning again removes infrastructure, and
  // is drawn as danger. Each asks in place, naming its Tenant.
  test(`a Tenant's first administrator is granted, and a failed deprovisioning sent again, each asking first, ${theme}`, async ({
    page,
    baseURL,
  }) => {
    await open(page, baseURL ?? '', 'provider-mode', theme, '/tenants');
    const row = page.getByRole('listitem').filter({ hasText: 'Acme Retail' });
    await row.getByRole('button', { name: 'Administrators' }).click();
    await expect(row.getByRole('button', { name: 'Grant administrator' })).toHaveAttribute(
      'data-variant',
      'primary',
    );
    await row.getByRole('button', { name: 'Grant administrator' }).click();
    await expect(row.getByRole('form', { name: 'Grant administrator' })).toContainText('Tenant Acme Retail');
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: 'Eta Mobility' })
        .getByRole('button', { name: 'Administrators' }),
    ).toHaveCount(0);

    await open(
      page,
      baseURL ?? '',
      'provider-mode',
      theme,
      '/offboardings/0192f0e0-bbbb-7000-8000-00000000b003',
    );
    const resend = page.getByRole('button', { name: 'Send deprovisioning again' });
    await expect(resend).toHaveAttribute('data-variant', 'danger');
    await resend.click();
    const confirm = page.getByRole('form', { name: 'Send deprovisioning again' });
    await expect(confirm).toHaveAttribute('data-tone', 'danger');
    await expect(confirm).toContainText('In Tenant Theta Media');
  });

  test(`a destructive action is drawn apart, and asks before it acts, ${theme}`, async ({
    page,
    baseURL,
  }) => {
    await open(page, baseURL ?? '', 'tenant', theme, '/memberships');
    const row = page.getByRole('listitem').filter({ hasText: '0199a1b2-1111-7e5f-8a9b-000000000003' });
    await expect(row.getByRole('button', { name: 'Revoke' })).toHaveAttribute('data-variant', 'danger');
    await expect(row.getByRole('button', { name: 'Restore' })).toHaveAttribute('data-variant', 'secondary');
    await row.getByRole('button', { name: 'Revoke' }).click();
    const confirm = row.getByRole('form', { name: 'Revoke' });
    await expect(confirm).toHaveAttribute('data-tone', 'danger');
    await expect(confirm).toContainText(
      'This cannot be undone. In Tenant 0192f0e0-aaaa-7000-8000-00000000a001.',
    );
  });
}

// TDD-organization-experience-002 1.8.0 (ADR-ORG-007 §5.5, §5.6): in Chromium, the invitation token
// leaves the address bar before anything is read, reaches no server in a URL, is sent only in the
// body of the acceptance command, and the page is served with no referrer.
test('the invitation token is sent only in the acceptance body, never in a URL', async ({
  page,
  baseURL,
}) => {
  await page.context().addCookies([{ name: 'persona', value: 'provider', url: baseURL ?? '' }]);
  const urls: string[] = [];
  page.on('request', (request) => {
    urls.push(request.url());
  });
  const bodies: string[] = [];
  await page.route(
    (url) => url.pathname === '/api/v1/invitations/accept',
    async (route) => {
      bodies.push(route.request().postData() ?? '');
      expect(route.request().headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      await route.fulfill({
        status: 404,
        contentType: 'application/problem+json',
        body: JSON.stringify({ type: 'https://problems.scnehaux.com/not-found', status: 404 }),
      });
    },
  );
  const response = await page.goto(`/invitations/accept#${invitationToken}`);
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(page.getByRole('button', { name: 'Accept invitation' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  expect(await page.evaluate("window.sessionStorage.getItem('scnx-org-invitation')")).toBe(invitationToken);

  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page.getByRole('alert')).toContainText('This invitation cannot be accepted.');
  expect(bodies).toEqual([JSON.stringify({ token: invitationToken })]);
  for (const url of urls) {
    expect(url).not.toContain(invitationToken);
  }
  // A refusal the same token would get again leaves nothing waiting in the tab.
  expect(Number(await page.evaluate('window.sessionStorage.length'))).toBe(0);
});
