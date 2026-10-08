// The identity experience's own BFF against the stack (TDD-identity-experience-001 §Revocation): a
// kernel session removed while a tab is open on it. A person is signed in on two devices, two browser
// contexts; from the second, the account application ends the first one's session, as its sessions
// page offers. The first device's tab stays in use, and its BFF session ends:
//
//   - by back-channel logout, when the kernel holds a back-channel logout URL for the BFF's client
//     (OpenID Connect Back-Channel Logout 1.0 §2.5), at once;
//   - otherwise by the refresh path, which needs no notification: the BFF's next refresh is refused,
//     no later than the expiry of the access token the session held.
//
// The evidence records which path the stack has, and the bound is asserted either way.
import { expect, test } from '@playwright/test';

import {
  ActiveTab,
  backChannelLogoutUrl,
  identityExperience as bff,
  iso,
  kernel,
  kernelEvents,
  kernelUserOf,
  Refreshes,
  l0LifetimeSeconds,
  l0RevocationTargetSeconds,
  seconds,
  seed,
  sessionCookieOf,
  sessionRow,
  signIn,
  summarize,
  waitUntil,
  writeEvidence,
} from './stack';

const schema = 'identity_experience';
const account = `${bff}/auth/login?return_to=${encodeURIComponent('/account/')}`;

test('a kernel session removed ends the identity BFF session within the remaining L0 lifetime', async ({
  browser,
}) => {
  const s = seed();
  const person = s.device;
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    // The first device: the account application asks for no level, so a password signs in.
    const page = await first.newPage();
    await page.goto(account);
    expect(await signIn(page, bff, { person, codes: null })).toEqual(['password']);
    await expect(
      page.getByText('Where you are signed in', { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    const cookie = await sessionCookieOf(first, bff);
    const signedIn = await sessionRow(schema, cookie);
    if (signedIn === null || signedIn.keycloakSessionId === null)
      throw new Error('no session row with a kernel sid');
    const signedInAt = Date.now();
    const kernelSession = signedIn.keycloakSessionId;
    const tab = new ActiveTab(page, '/api/v1/me/sessions');
    tab.start();
    const refreshes = new Refreshes(schema, cookie);
    refreshes.start();

    // The second device ends the first one's session from the sessions page.
    const other = await second.newPage();
    await other.goto(account);
    await signIn(other, bff, { person, codes: null });
    const rows = other.getByRole('row').filter({ has: other.getByRole('button', { name: 'End' }) });
    await expect(rows).toHaveCount(1);
    const user = await kernelUserOf(person.principalId);
    const listed = async (): Promise<boolean> =>
      (await kernel<{ id: string }[]>(`/users/${user}/sessions`)).some((x) => x.id === kernelSession);
    expect(await listed(), 'the kernel lists the first device’s session').toBe(true);

    const ended = other.waitForResponse(
      (r) => r.url().endsWith(':terminate') && r.request().method() === 'POST',
    );
    await rows.getByRole('button', { name: 'End' }).click();
    const response = await ended;
    const acceptedAt = Date.now();
    expect([200, 202]).toContain(response.status());
    const atAccept = await sessionRow(schema, cookie);
    if (atAccept === null)
      throw new Error('the first device’s session ended before the removal was accepted');
    await expect(
      other.getByText('Ended. That device signs in again to continue', { exact: false }),
    ).toBeVisible();

    const removedAt = await waitUntil(
      'the kernel removes the session',
      90_000,
      100,
      async () => !(await listed()),
    );
    const atRemoval = (await sessionRow(schema, cookie)) ?? atAccept;
    const backChannel = await backChannelLogoutUrl('identity-experience-bff');
    const bound = atRemoval.accessExpiresAt.getTime() - acceptedAt;

    // What is known before the wait, kept even if the session never ends.
    const known = {
      class: 'Session',
      subject:
        'a session of the identity-experience BFF, ended from another device in the account application',
      accepted_at: iso(acceptedAt),
      kernel_session_removed_at: iso(removedAt),
      access_token_lifetime_at_sign_in_seconds: seconds(signedIn.accessExpiresAt.getTime() - signedInAt),
      access_token_expires_at_acceptance: iso(atAccept.accessExpiresAt),
      access_token_expires_at_kernel_removal: iso(atRemoval.accessExpiresAt),
      propagation_seconds: seconds(removedAt - acceptedAt),
      bound_seconds: seconds(bound),
      bound_formula: 'access token expiry at kernel removal - acceptance (SAD-001 §7.7, Session class)',
      l0_lifetime_seconds: l0LifetimeSeconds,
      l0_revocation_target_seconds: l0RevocationTargetSeconds,
      back_channel: { registered: backChannel !== null, url: backChannel },
      poll_interval_seconds: 1,
    };
    await waitUntil(
      'the first device’s BFF session ends',
      Math.max(l0RevocationTargetSeconds * 1000, bound) + 60_000 - (Date.now() - acceptedAt),
      250,
      () => Promise.resolve(tab.firstAfter(acceptedAt, 401) !== undefined),
    ).catch((error: unknown) => {
      // What the kernel itself recorded, to say which side kept the session alive.
      return Promise.all([
        kernel<{ id: string }[]>(`/users/${user}/sessions`),
        kernelEvents(user, 'REFRESH_TOKEN'),
        kernelEvents(user, 'REFRESH_TOKEN_ERROR'),
      ]).then(([sessions, refreshed, refused]) => {
        writeEvidence('session-removal', {
          ...known,
          session_destroyed_at: null,
          refreshes_after_kernel_removal: refreshes.after(removedAt),
          refreshes_seen: refreshes.seen.map((x) => ({ at: iso(x.at), expires_at: iso(x.expiresAt) })),
          answers_after_acceptance: tab.statuses(acceptedAt),
          kernel_sessions_after: sessions.map((x) => x.id),
          ended_session: kernelSession,
          kernel_refresh_events: refreshed.map((e) => ({ at: iso(e.time), session: e.sessionId ?? null })),
          kernel_refresh_errors: refused.map((e) => ({
            at: iso(e.time),
            session: e.sessionId ?? null,
            error: e.error ?? null,
          })),
        });
        throw error;
      });
    });
    await tab.stop();
    await refreshes.stop();
    const destroyed = tab.firstAfter(acceptedAt, 401);
    if (destroyed === undefined) throw new Error('no 401 was recorded');
    expect(await sessionRow(schema, cookie), 'the session row is gone').toBeNull();
    const measured = destroyed.at - acceptedAt;
    const afterRemoval = destroyed.at - removedAt;
    const lifetime = l0LifetimeSeconds * 1000;

    await page.goto(`${bff}/account/`);
    await expect(page.getByText('Where you are signed in')).toHaveCount(0);

    const evidence = {
      ...known,
      session_destroyed_at: iso(destroyed.at),
      measured_seconds: seconds(measured),
      within_bound: measured <= bound,
      refreshes_after_kernel_removal: refreshes.after(removedAt),
      back_channel: { ...known.back_channel, ended_after_kernel_removal_seconds: seconds(afterRemoval) },
      mechanism:
        backChannel !== null && afterRemoval < 10_000
          ? 'back-channel logout'
          : 'refresh refused by the kernel',
    };
    writeEvidence('session-removal', evidence);
    summarize([
      '### Kernel session removed to identity BFF session destruction',
      '',
      '| Accepted | Kernel applied | Session ended | Measured | Bound | Back-channel URL | Mechanism |',
      '| :-- | --: | --: | --: | --: | :-- | :-- |',
      `| ${evidence.accepted_at} | +${evidence.propagation_seconds} s | +${evidence.measured_seconds} s | ${evidence.measured_seconds} s | ${evidence.bound_seconds} s | ${backChannel === null ? 'not registered' : 'registered'} | ${evidence.mechanism} |`,
      '',
    ]);

    expect(
      atAccept.accessExpiresAt.getTime() - acceptedAt,
      'the token held lives at most L0',
    ).toBeLessThanOrEqual(lifetime);
    expect(
      measured,
      `measured ${seconds(measured)} s against a bound of ${seconds(bound)} s`,
    ).toBeLessThanOrEqual(bound);
    if (backChannel !== null) {
      expect(afterRemoval, 'a registered back-channel logout ends the session at once').toBeLessThan(10_000);
    }
    expect(evidence.refreshes_after_kernel_removal, 'no refresh succeeds once the kernel removed it').toBe(0);
  } finally {
    await first.close();
    await second.close();
  }
});
