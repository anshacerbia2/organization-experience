// Organization Experience in a real browser against the stack (TDD-organization-experience-001 §End to
// End, 1.6.0), and the measured Membership revocation of TDD-identity-experience-001 §Revocation:
//
//   1. a Tenant administrator signs in through the kernel's hosted login, enrolling a TOTP, and a
//      second session of theirs is left idle;
//   2. a second provider signs in for the provider form, at aal2 with a fresh authentication, is
//      refused provider mode without a reason, and requests it with one, for one Tenant and one minute;
//   3. the bootstrap operator, another provider, approves it, and the window opens in the first
//      provider's browser;
//   4. the operator, in the Tenant, grants a Membership and revokes the administrator's;
//   5. the window ends on its own at ends_at, in the browser that held it;
//   6. the revocation reaches the administrator's open tab within the remaining L0 lifetime, by the
//      refresh path, and their idle tab's first request after it is refused.
//
// The steps share their browsers, so they run in order and stop at the first failure.
import { readFileSync } from 'node:fs';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
  ActiveTab,
  backChannelLogoutUrl,
  fetchIn,
  FileCodes,
  iso,
  kernel,
  kernelUserOf,
  l0LifetimeSeconds,
  l0RevocationTargetSeconds,
  organizationExperience as bff,
  patternMatches,
  required,
  seconds,
  seed,
  sessionCookie,
  sessionCookieOf,
  sessionRow,
  signIn,
  submits,
  summarize,
  waitUntil,
  writeEvidence,
  type Credentials,
  type Seed,
} from './stack';

test.describe.configure({ mode: 'serial' });

const schema = 'organization_experience';

interface Actor {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly credentials: Credentials;
}

let s: Seed;
let administrator: Actor;
let idleAdministrator: Actor;
let provider: Actor;
let operator: Actor;
let activeTab: ActiveTab | undefined;
const actors: Actor[] = [];
let windowEndsAt = 0;
let providerJourney: Record<string, unknown> = {};
let revocation: {
  cookie: string;
  membershipId: string;
  acceptedAt: number;
  responseAt: number;
  expiresAtAccept: Date;
  kernelRemovedAt: number;
  expiresAtRemoval: Date;
} | null = null;

const banner = (page: Page) => page.getByRole('region', { name: 'Active scope' });

test.beforeAll(async ({ browser }) => {
  s = seed();
  const actor = async (person: Seed['operator'], codes: Credentials['codes']): Promise<Actor> => {
    const context = await browser.newContext();
    const made = { context, page: await context.newPage(), credentials: { person, codes } };
    actors.push(made);
    return made;
  };
  administrator = await actor(s.administrator, null);
  idleAdministrator = await actor(s.administrator, null);
  provider = await actor(s.provider, null);
  operator = await actor(s.operator, new FileCodes(required('IDENTITY_OPERATOR_TOTP_FILE')));
});

test.afterAll(async () => {
  await activeTab?.stop();
  for (const actor of actors) {
    await actor.context.close();
  }
});

// signInToTenant starts a Tenant sign-in from the page the application shows, as an operator does.
async function signInToTenant(actor: Actor): Promise<string[]> {
  const form = actor.page.getByRole('form', { name: /Sign in to a Tenant|Switch to another Tenant/ }).first();
  await form.getByLabel('Tenant identifier').fill(s.tenantId);
  await submits(actor.page, () => form.getByRole('button', { name: 'Continue to this Tenant' }).click());
  return signIn(actor.page, bff, actor.credentials);
}

test('a Tenant administrator signs in through the kernel’s hosted login', async () => {
  const { page, context } = administrator;
  await page.goto(`${bff}/`);
  await expect(page.getByText('Not signed in')).toBeVisible();
  const shown = await signInToTenant(administrator);
  // Every sign-in here asks for aal2, and this person has no second factor yet: the kernel enrolls one.
  expect(shown).toEqual(expect.arrayContaining(['password', 'configure-totp']));
  await expect(banner(page)).toContainText(`Tenant scope: ${s.tenantId}`);

  // The cookie the pattern sets (TDD-identity-experience-001 §Session Cookie), as the browser holds it.
  const cookie = (await context.cookies()).find((c) => c.name === sessionCookie);
  expect(cookie, 'the session cookie').toBeDefined();
  expect(cookie?.httpOnly, 'HttpOnly').toBe(true);
  expect(cookie?.secure, 'Secure').toBe(true);
  expect(cookie?.sameSite, 'SameSite').toBe('Lax');
  expect(cookie?.path, 'Path').toBe('/');
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
    'no browser storage',
  ).toEqual([0, 0]);

  await page.getByRole('link', { name: 'Memberships' }).click();
  await expect(page.getByRole('heading', { name: 'Memberships' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: s.administrator.principalId })).toBeVisible();

  // The tab stays in use from here on.
  activeTab = new ActiveTab(page, '/api/v1/memberships?limit=1');
  activeTab.start();

  // A second session of the same person, left idle: no request until step 6.
  idleAdministrator.credentials.codes = administrator.credentials.codes;
  await idleAdministrator.page.goto(`${bff}/`);
  await signInToTenant(idleAdministrator);
  await expect(banner(idleAdministrator.page)).toContainText(`Tenant scope: ${s.tenantId}`);
});

test('provider mode is entered with a step-up and a reason', async () => {
  const { page } = provider;
  await page.goto(`${bff}/`);
  await submits(page, () => page.getByRole('link', { name: 'Sign in as a provider' }).click());
  const shown = await signIn(page, bff, provider.credentials);
  expect(shown).toEqual(expect.arrayContaining(['password', 'configure-totp']));
  await expect(banner(page)).toContainText('Provider sign-in: provider mode is not active');

  // The session is a fresh aal2 provider sign-in: no Tenant, and an auth_time of just now.
  const scope = JSON.parse((await fetchIn(page, '/auth/scope')).body) as {
    scope: string;
    acr: string | null;
    authTime: string | null;
  };
  expect(scope.scope).toBe('provider');
  expect(scope.acr).toBe('aal2');
  expect(Date.now() - Date.parse(scope.authTime ?? '0')).toBeLessThan(5 * 60_000);

  // Without a reason, nothing is asked of the BFF.
  const asked: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/auth/scope/provider')) asked.push(request.method());
  });
  const form = page.getByRole('form', { name: 'Enter provider mode' });
  await form.getByLabel('Duration in minutes').fill('1');
  await form.getByLabel('Tenant identifiers, one per line').fill(s.tenantId);
  await form.getByRole('button', { name: 'Request provider mode' }).click();
  await expect(form.getByText('Write at least 10 characters.')).toBeVisible();
  expect(asked, 'a request without a reason never leaves the browser').toEqual([]);

  await form.getByLabel('Reason').fill(`Stack proof ${s.run}: provider mode for the end to end Tenant`);
  await form.getByRole('button', { name: 'Request provider mode' }).click();
  await expect(banner(page)).toContainText('Provider mode requested: awaiting approval by another provider');
  await expect(banner(page)).toContainText(s.tenantId);
  expect(asked).toEqual(['POST']);
});

test('a second provider approves it, and the window opens', async () => {
  const { page } = operator;
  await page.goto(`${bff}/`);
  await submits(page, () => page.getByRole('link', { name: 'Sign in as a provider' }).click());
  await signIn(page, bff, operator.credentials);
  await page.getByRole('link', { name: 'Activation requests' }).click();

  const review = page.getByRole('form', { name: 'Review requests' });
  await review.getByLabel('Reason').fill(`Stack proof ${s.run}: reviewing activation requests`);
  await review.getByRole('button', { name: 'Review requests' }).click();
  const request = page.getByRole('listitem').filter({ hasText: s.provider.principalId });
  await expect(request).toContainText('1 minutes');
  await request.getByRole('button', { name: 'Approve' }).click();
  const decision = request.getByRole('form', { name: 'Approve' });
  await decision.getByLabel('Reason').fill(`Stack proof ${s.run}: approved for the end to end journey`);
  const approved = page.waitForResponse(
    (r) => r.url().includes('/api/v1/provider-activations/') && r.url().endsWith('/approve'),
  );
  await decision.getByRole('button', { name: 'Approve' }).click();
  const approval = (await (await approved).json()) as { ends_at: string; decided_at: string };
  expect((await approved).status()).toBe(200);
  windowEndsAt = Date.parse(approval.ends_at);

  // In the first provider's browser, which polls a pending window, provider mode opens.
  const held = provider.page;
  await expect(banner(held)).toContainText('Provider mode.', { timeout: 30_000 });
  await expect(banner(held)).toContainText('ends in');
  const openedAt = Date.now();
  await held.getByRole('link', { name: 'Tenants' }).click();
  await expect(held.getByRole('heading', { name: 'Tenants' })).toBeVisible();
  await expect(held.getByRole('listitem').filter({ hasText: s.tenantId })).toContainText(s.tenantName);
  providerJourney = {
    approved_at: approval.decided_at,
    ends_at: approval.ends_at,
    opened_in_browser_after_approval_seconds: seconds(openedAt - Date.parse(approval.decided_at)),
  };
});

test('a Membership action: the operator grants one and revokes the administrator’s', async ({ browser }) => {
  // Moving to the Tenant on the same kernel session is a sign-in the kernel's session should let through
  // (TDD-identity-experience-001 §Context Switch). Its outcome is recorded; the journey goes on in a
  // browser of its own either way.
  await operator.page.getByRole('link', { name: 'Overview' }).click();
  let switched: string;
  try {
    await signInToTenant(operator);
    await expect(banner(operator.page)).toContainText(`Tenant scope: ${s.tenantId}`);
    switched = 'signed in to the Tenant on the provider sign-in’s kernel session';
  } catch (error) {
    const url = new URL(operator.page.url());
    switched = `refused at ${url.origin}${url.pathname}: ${error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)}`;
  }
  providerJourney = { ...providerJourney, switch_to_tenant_on_the_same_kernel_session: switched };

  const context = await browser.newContext();
  const page = await context.newPage();
  const tenantOperator: Actor = { context, page, credentials: operator.credentials };
  actors.push(tenantOperator);
  await page.goto(`${bff}/`);
  await signInToTenant(tenantOperator);
  await expect(banner(page)).toContainText(`Tenant scope: ${s.tenantId}`);
  await page.getByRole('link', { name: 'Memberships' }).click();

  const grant = page.getByRole('form', { name: 'Grant membership' });
  await grant.getByLabel('Principal identifier').fill(s.device.principalId);
  await grant.getByLabel('Provenance').fill(`stack proof ${s.run}`);
  const granted = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/memberships') && r.request().method() === 'POST',
  );
  await grant.getByRole('button', { name: 'Grant membership' }).click();
  expect((await granted).status()).toBe(201);
  await expect(page.getByRole('listitem').filter({ hasText: s.device.principalId })).toContainText('active');

  const row = page.getByRole('listitem').filter({ hasText: s.administrator.principalId });
  await row.getByRole('button', { name: 'Revoke' }).click();
  const confirm = row.getByRole('form', { name: 'Revoke' });
  await confirm.getByLabel('Reason').fill(`Stack proof ${s.run}: the administrator leaves the Tenant`);

  const cookie = await sessionCookieOf(administrator.context, bff);
  const user = await kernelUserOf(s.administrator.principalId);
  const organization = (
    await kernel<{ id: string; alias: string }[]>(`/organizations?search=${s.tenantId}&exact=true`)
  ).find((o) => o.alias === s.tenantId);
  if (organization === undefined) throw new Error('the kernel holds no Organization for the Tenant');
  const isMember = async (): Promise<boolean> =>
    (await kernel<{ id: string }[]>(`/organizations/${organization.id}/members?first=0&max=1000`)).some(
      (m) => m.id === user,
    );
  expect(await isMember(), 'the administrator is a member in the kernel').toBe(true);

  const revoked = page.waitForResponse((r) => r.url().endsWith('/revoke') && r.request().method() === 'POST');
  await confirm.getByRole('button', { name: 'Revoke' }).click();
  const response = await revoked;
  const responseAt = Date.now();
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { membership: { membership_id: string }; accepted_at: string };
  const acceptedAt = Date.parse(body.accepted_at);
  const atAccept = await sessionRow(schema, cookie);
  if (atAccept === null) throw new Error('the administrator’s session ended before the revocation');

  // The kernel applies it when identity-control's converger removes the member (ADR-IAM-006 §5.5).
  const kernelRemovedAt = await waitUntil(
    'the kernel removes the member',
    90_000,
    100,
    async () => !(await isMember()),
  );
  const atRemoval = await sessionRow(schema, cookie);
  revocation = {
    cookie,
    membershipId: body.membership.membership_id,
    acceptedAt,
    responseAt,
    expiresAtAccept: atAccept.accessExpiresAt,
    kernelRemovedAt,
    expiresAtRemoval: (atRemoval ?? atAccept).accessExpiresAt,
  };

  // The interface shows the revocation by its evidence, never as enforced on acceptance.
  await expect(row).toContainText('Revocation accepted at');
  await expect(row.locator('[data-enforcement="enforced"]')).toBeVisible({ timeout: 60_000 });

  // No session is removed (ADR-IAM-006 §5.5): the kernel still lists the person's sessions.
  const sessions = await kernel<unknown[]>(`/users/${user}/sessions`);
  expect(sessions.length, 'the person’s kernel sessions after the revocation').toBeGreaterThan(0);
});

test('provider mode ends on its own at ends_at, in the browser that held it', async () => {
  const held = provider.page;
  await expect(banner(held)).toContainText('Provider sign-in: provider mode is not active', {
    timeout: Math.max(0, windowEndsAt - Date.now()) + 30_000,
  });
  const closedSeenAt = Date.now();
  await expect(held.getByText('This section opens in provider mode.', { exact: false })).toBeVisible();
  await expect(held.getByRole('link', { name: 'Tenants' })).toHaveCount(0);
  // The API stops honouring the activation at ends_at whatever the browser does.
  const after = await fetchIn(held, '/api/v1/tenants?limit=1');
  expect(after.status, 'a provider read after ends_at').toBe(403);
  providerJourney = {
    ...providerJourney,
    closed_seen_in_browser_after_ends_at_seconds: seconds(closedSeenAt - windowEndsAt),
    read_after_ends_at_status: after.status,
  };
  writeEvidence('provider-mode', providerJourney);
});

test('the revocation reaches the administrator’s open tab within the remaining L0 lifetime', async () => {
  if (revocation === null || activeTab === undefined) throw new Error('no revocation was recorded');
  const r = revocation;
  const tab = activeTab;

  // The idle tab, asked once now that the kernel has applied it: the API refuses the token at once,
  // or the BFF's refresh is refused. Never served.
  const idleCookie = await sessionCookieOf(idleAdministrator.context, bff);
  const idleRow = await sessionRow(schema, idleCookie);
  const idleEarly = await fetchIn(idleAdministrator.page, '/api/v1/memberships?limit=1');
  expect([401, 403], 'the idle tab’s first request after the revocation').toContain(idleEarly.status);

  // The active tab: the session ends when the BFF's refresh is refused.
  const bound = r.expiresAtRemoval.getTime() - r.acceptedAt;
  await waitUntil(
    'the active tab’s session ends',
    Math.max(l0RevocationTargetSeconds * 1000, bound) + 60_000 - (Date.now() - r.acceptedAt),
    250,
    () => Promise.resolve(tab.firstAfter(r.responseAt, 401) !== undefined),
  ).catch((error: unknown) => {
    writeEvidence('membership-revocation', {
      accepted_at: iso(r.acceptedAt),
      kernel_member_removed_at: iso(r.kernelRemovedAt),
      access_token_expires_at_kernel_removal: iso(r.expiresAtRemoval),
      bound_seconds: seconds(bound),
      session_destroyed_at: null,
      answers_after_acceptance: tab.statuses(r.responseAt),
    });
    throw error;
  });
  const ended = tab.firstAfter(r.responseAt, 401);
  if (ended === undefined) throw new Error('no 401 was recorded');
  const measured = ended.at - r.acceptedAt;
  const served = tab.samples.filter((x) => x.sentAt >= r.responseAt && x.status === 200).length;
  expect(await sessionRow(schema, r.cookie), 'the session row is gone').toBeNull();

  // Which mechanism ended it: the BFF logs a refused refresh, and the response before was the API's
  // own refusal, not a 401 the API sent.
  const log = required('ORGANIZATION_EXPERIENCE_BFF_LOG');
  const refreshRefused = readFileSync(log, 'utf8').includes('refresh refused; the session is destroyed');
  const backChannel = await backChannelLogoutUrl('organization-experience-bff');

  // The idle tab, asked again after its token's expiry: the refresh is refused and the session ends.
  let idleLate = 0;
  if (idleRow !== null) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, idleRow.accessExpiresAt.getTime() - Date.now()) + 2_000),
    );
    idleLate = (await fetchIn(idleAdministrator.page, '/api/v1/memberships?limit=1')).status;
  }

  // And the browser shows it: the page asks for a sign-in.
  await administrator.page.reload();
  await expect(administrator.page.getByText('Not signed in')).toBeVisible();

  const evidence = {
    class: 'Contextual Membership',
    subject:
      'a Tenant session of the BFF pattern (TDD-identity-experience-001), served by organization-experience',
    pattern_identical_to_identity_experience: patternMatches(),
    membership_id: r.membershipId,
    accepted_at: iso(r.acceptedAt),
    kernel_member_removed_at: iso(r.kernelRemovedAt),
    access_token_expires_at_acceptance: iso(r.expiresAtAccept),
    access_token_expires_at_kernel_removal: iso(r.expiresAtRemoval),
    session_destroyed_at: iso(ended.at),
    propagation_seconds: seconds(r.kernelRemovedAt - r.acceptedAt),
    measured_seconds: seconds(measured),
    bound_seconds: seconds(bound),
    bound_formula:
      'kernel removal - acceptance + access token expiry at kernel removal - kernel removal (SAD-001 §7.7)',
    l0_lifetime_seconds: l0LifetimeSeconds,
    l0_revocation_target_seconds: l0RevocationTargetSeconds,
    within_bound: measured <= bound,
    within_l0_revocation_target: measured <= l0RevocationTargetSeconds * 1000,
    requests_served_after_acceptance: served,
    mechanism: refreshRefused ? 'refresh refused by the kernel (invalid_grant)' : 'not the refresh path',
    back_channel: {
      registered: backChannel !== null,
      applicable: false,
      why: 'A Membership revocation removes no kernel session (ADR-IAM-006 §5.5), so the kernel sends no logout token for it; the refresh path alone bounds it.',
    },
    idle_tab: {
      first_request_after_revocation_status: idleEarly.status,
      request_after_token_expiry_status: idleLate,
    },
    poll_interval_seconds: 1,
  };
  writeEvidence('membership-revocation', evidence);
  summarize([
    '### Membership revocation to session destruction (Tenant session, BFF pattern)',
    '',
    '| Accepted | Kernel applied | Session ended | Measured | Bound | L0 target | Mechanism |',
    '| :-- | --: | --: | --: | --: | --: | :-- |',
    `| ${evidence.accepted_at} | +${evidence.propagation_seconds} s | +${evidence.measured_seconds} s | ${evidence.measured_seconds} s | ${evidence.bound_seconds} s | ${l0RevocationTargetSeconds} s | ${evidence.mechanism} |`,
    '',
  ]);

  expect(served, 'no request served after the revocation was accepted').toBe(0);
  expect(refreshRefused, 'the refresh path ended the session').toBe(true);
  expect(
    measured,
    `measured ${seconds(measured)} s against a bound of ${seconds(bound)} s`,
  ).toBeLessThanOrEqual(bound);
  expect(measured).toBeLessThanOrEqual(l0RevocationTargetSeconds * 1000);
  expect(idleLate, 'the idle tab after its token expired').toBe(401);
});
