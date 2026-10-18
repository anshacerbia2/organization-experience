// What the screenshots cannot show, held in Chromium in both themes (TDD-organization-experience-001
// §Visual Language): the scope banner stays in view whatever the page scrolls to, focus is an outline,
// a link is underlined at rest, and a destructive action is drawn apart from the others.
import { expect, test, type Page } from '@playwright/test';

import type { Persona } from './fixtures.ts';

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
