/// <reference lib="dom" />
// Layout in Chromium at the widths a person uses, in both themes (TDD-organization-experience-001
// 1.11.0 §Visual Language, as TDD-identity-experience-003 1.29.0 §Layout holds it for identity-experience):
// no panel collapses to a sliver, no text is laid out one character per line, and the page does not
// scroll sideways. jsdom has no layout, so this is checked here. Each page is measured with what it
// opens only on request, the forms and confirmations, open. A full-page screenshot of each width is kept
// with the test's output.
import { expect, test, type Page } from '@playwright/test';

import { invitationToken, type Persona } from './fixtures.ts';

// STD-GLB-FE-005 2.1.0 §3.10: 320 CSS px included, the width WCAG 2.2 SC 1.4.10 names.
const widths = [1440, 1024, 768, 390, 320] as const;
const themes = ['light', 'dark'] as const;

// 16rem, at the 16px root size: a panel narrower than this, with room for more, is collapsed.
const panelFloor = 256;

interface Main {
  readonly name: string;
  readonly persona: Persona;
  readonly path: string;
  readonly ready: (page: Page) => ReturnType<Page['getByText']>;
  readonly open?: (page: Page) => Promise<void>;
}

// Every route, in the scope that serves it, as it loads; then the pages whose forms and confirmations
// open inside a panel, with them open (below).
const route = (persona: Persona, path: string, ready: string): Main => ({
  name: `${persona}${path.replace(/[^a-z0-9]+/gi, '-')}`,
  persona,
  path,
  ready: (page) => page.getByText(ready, { exact: false }),
});

const routes: readonly Main[] = [
  route('signed-out', `/invitations/accept#${invitationToken}`, 'You have been invited to join a Tenant.'),
  route('tenant', '/workspaces', 'Legacy ERP'),
  route('tenant', '/invitations', '0192f0e0-eeee-7000-8000-00000000e004'),
  route('tenant', '/provider-access', 'Incident 4471'),
  route('tenant', '/provider-mode', 'This section belongs to a provider sign-in.'),
  route('provider', '/memberships', 'Beta Logistics'),
  route('provider', '/approvals', 'Review requests'),
  route('provider-pending', '/', 'Withdraw the request'),
  route('provider-mode', '/', 'Leave provider mode'),
  route('provider-mode', '/organizations', 'Contoso Publishing'),
  route('provider-mode', '/offboardings', '0192f0e0-aaaa-7000-8000-00000000a002'),
  route(
    'provider-mode',
    '/access-review?actor_id=0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4bbb',
    'Each access matched',
  ),
  route('provider-mode', '/approvals', 'Restore the memberships'),
];

const pages: readonly Main[] = [
  ...routes,
  { name: 'signed-out', persona: 'signed-out', path: '/', ready: (page) => page.getByText('Not signed in') },
  {
    name: 'picker',
    persona: 'provider',
    path: '/',
    ready: (page) => page.getByRole('link', { name: 'Beta Logistics' }),
  },
  {
    name: 'provider-mode-entry',
    persona: 'provider',
    path: '/provider-mode',
    ready: (page) => page.getByRole('form', { name: 'Enter provider mode' }),
  },
  {
    name: 'tenant-overview',
    persona: 'tenant',
    path: '/',
    ready: (page) => page.getByRole('link', { name: 'Beta Logistics' }),
  },
  {
    name: 'tenant-memberships-revoke',
    persona: 'tenant',
    path: '/memberships',
    ready: (page) => page.getByText('0199a1b2-1111-7e5f-8a9b-000000000004'),
    open: async (page) => {
      const row = page.getByRole('listitem').filter({ hasText: '0199a1b2-1111-7e5f-8a9b-000000000001' });
      await row.getByRole('button', { name: 'Revoke' }).click();
      await row.getByRole('form', { name: 'Revoke' }).waitFor();
    },
  },
  {
    name: 'invitation-accept',
    persona: 'provider',
    path: `/invitations/accept#${invitationToken}`,
    ready: (page) => page.getByRole('button', { name: 'Accept invitation' }),
  },
  {
    name: 'provider-mode-tenants-grant-administrator',
    persona: 'provider-mode',
    path: '/tenants',
    ready: (page) => page.getByText('Zeta Freight'),
    open: async (page) => {
      const row = page.getByRole('listitem').filter({ hasText: 'Acme Retail' });
      await row.getByRole('button', { name: 'Administrators' }).click();
      await row.getByText('Onboarding finished', { exact: false }).waitFor();
      await row.getByLabel('Principal identifier').fill('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4ccc');
      await row.getByRole('button', { name: 'Grant administrator' }).click();
      await row.getByRole('form', { name: 'Grant administrator' }).waitFor();
    },
  },
  {
    name: 'provider-mode-offboarding',
    persona: 'provider-mode',
    path: '/offboardings/0192f0e0-bbbb-7000-8000-00000000b001',
    ready: (page) => page.getByText('ticket system refused', { exact: false }),
  },
  {
    name: 'provider-mode-projections-waive',
    persona: 'provider-mode',
    path: '/projections',
    ready: (page) => page.getByText('Stale: past its budget', { exact: false }),
    open: async (page) => {
      const row = page.getByRole('listitem').filter({ hasText: 'legacy-search' }).first();
      await row.getByRole('button', { name: 'Dead letters' }).click();
      await row.getByRole('button', { name: 'Waive' }).click();
      await row.getByRole('form', { name: 'Waive' }).waitFor();
    },
  },
  {
    name: 'provider-mode-access-review-grant-provider',
    persona: 'provider-mode',
    path: '/access-review',
    ready: (page) => page.getByText('On-call rotation', { exact: false }),
    open: async (page) => {
      const panel = page.getByRole('region', { name: 'Provider grants' });
      await panel.getByLabel('Principal identifier').fill('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4ccc');
      await panel.getByLabel('Kind').selectOption('emergency');
      await panel.getByRole('button', { name: 'Grant provider access' }).click();
      await panel.getByRole('form', { name: 'Grant provider access' }).waitFor();
    },
  },
];

interface Finding {
  readonly what: string;
  readonly where: string;
  readonly detail: string;
}

// measure lays the page out at the viewport's width and returns what is wrong with it.
async function measure(page: Page): Promise<Finding[]> {
  return page.evaluate((floor) => {
    const findings: { what: string; where: string; detail: string }[] = [];
    const describe = (element: Element): string => {
      const heading = element.querySelector('h2, h3');
      const label = heading?.textContent.trim() ?? element.textContent.trim().slice(0, 40);
      return `${element.tagName.toLowerCase()} "${label}"`;
    };
    const contentWidth = (element: Element): number => {
      const style = getComputedStyle(element);
      return (
        element.getBoundingClientRect().width -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) -
        parseFloat(style.borderLeftWidth) -
        parseFloat(style.borderRightWidth)
      );
    };
    // Every panel is at least 16rem wide, or as wide as the box it is in when that is narrower.
    for (const panel of document.querySelectorAll('section[data-elevation]')) {
      const parent = panel.parentElement;
      if (parent === null) {
        continue;
      }
      const width = panel.getBoundingClientRect().width;
      const room = contentWidth(parent);
      if (width + 1 < Math.min(floor, room)) {
        findings.push({
          what: 'panel narrower than 16rem or its container',
          where: describe(panel),
          detail: `${width.toFixed(1)}px wide in ${room.toFixed(1)}px`,
        });
      }
    }
    // No text is laid out one character per line: a text node of four characters or more on three
    // lines or more, every line narrower than one and a half of its font size.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent?.trim() ?? '';
      const element = node.parentElement;
      if (text.length < 4 || element === null || element.closest('.scnx-org-visually-hidden') !== null) {
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      const lines = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
      const em = parseFloat(getComputedStyle(element).fontSize);
      if (lines.length >= 3 && lines.every((rect) => rect.width <= 1.5 * em)) {
        findings.push({
          what: 'text laid out one character per line',
          where: describe(element.closest('section') ?? element),
          detail: `"${text.slice(0, 40)}" on ${String(lines.length)} lines`,
        });
      }
    }
    // The page does not scroll sideways; a wide table scrolls in its own region (WCAG 2.2 SC 1.4.10).
    // Each element that reaches past the viewport is named, innermost first, so the failure says what
    // to fix: an element counts when its right edge is past the viewport and no child of it is, and
    // no box between it and the page scrolls or clips it (as identity-experience#58 measures it).
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    if (overflow > 1) {
      const past = new Set<Element>();
      for (const element of document.body.querySelectorAll('*')) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.right <= window.innerWidth + 1) {
          continue;
        }
        let clipped = false;
        for (let up = element.parentElement; up !== null && up !== document.body; up = up.parentElement) {
          if (
            getComputedStyle(up).overflowX !== 'visible' &&
            up.getBoundingClientRect().right <= window.innerWidth + 1
          ) {
            clipped = true;
            break;
          }
        }
        if (!clipped) {
          past.add(element);
        }
      }
      const name = (element: Element): string => {
        const classes = [...element.classList]
          .slice(0, 2)
          .map((value) => `.${value}`)
          .join('');
        const text = element.textContent.trim().replace(/\s+/g, ' ').slice(0, 40);
        return `${element.tagName.toLowerCase()}${classes}${text === '' ? '' : ` "${text}"`}`;
      };
      const innermost = [...past]
        .filter((element) => ![...element.children].some((child) => past.has(child)))
        .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)
        .slice(0, 3);
      findings.push({ what: 'page scrolls sideways', where: 'document', detail: `${String(overflow)}px` });
      for (const element of innermost) {
        const box = element.getBoundingClientRect();
        findings.push({
          what: 'element reaches past the viewport',
          where: name(element),
          detail: `${box.width.toFixed(1)}px wide, right edge at ${box.right.toFixed(1)}px of ${String(window.innerWidth)}px`,
        });
      }
    }
    return findings;
  }, panelFloor);
}

for (const theme of themes) {
  for (const main of pages) {
    test(`${main.name} keeps every panel and its text readable at every width, ${theme}`, async ({
      page,
      baseURL,
    }, testInfo) => {
      await page.context().addCookies([{ name: 'persona', value: main.persona, url: baseURL ?? '' }]);
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width: widths[0], height: 900 });
      await page.goto(main.path);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(main.ready(page).first()).toBeVisible();
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
      if (main.open !== undefined) {
        await main.open(page);
      }
      const found: Record<number, Finding[]> = {};
      for (const width of widths) {
        await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
        await page.screenshot({
          path: testInfo.outputPath(`layout-${main.name}-${theme}-${String(width)}.png`),
          fullPage: true,
          animations: 'disabled',
        });
        const findings = await measure(page);
        if (findings.length > 0) {
          found[width] = findings;
        }
      }
      expect(found).toEqual({});
    });
  }
}
