// A person who already holds an account accepts an invitation (ADR-ORG-007 §5.3 and §5.8;
// TDD-organization-experience-002 §Invitation; TDD-organization-experience-001 §End to End), against
// the stack. The enrolment journey covers a person with no account; this one covers the rest:
//
//   1. a Tenant administrator issues an invitation in this console to the address a seeded person
//      holds, e2e/seed.ps1 step 2;
//   2. the person signs in to the account application and proves that address with a code read from
//      the development mail catcher: Organization Control counts a proven address alone (ADR-ORG-007
//      §5.3, TDD-identity-control-008 §Proven addresses for Organization Control);
//   3. the same person opens the link and signs in to this console with no Tenant, and accepts on the
//      acceptance page, which names the Tenant joined;
//   4. the Tenant then appears in Your Tenants.
//
// Skipped, and said so, where the checked-out identity-control serves no enrolment: the inviter is a
// seeded administrator who has never signed in (e2e/seed.ps1 step 5).
import { expect, test } from '@playwright/test';

import {
  codeFor,
  identityExperience,
  iso,
  organizationExperience as bff,
  seed,
  signIn,
  submits,
  writeEvidence,
  type Credentials,
  type Seed,
} from './stack';

let s: Seed;

test.beforeAll(() => {
  s = seed();
});

test('a person who holds an account proves the address, accepts, and finds the Tenant', async ({
  browser,
}) => {
  test.skip(
    s.enrolment === null || s.acceptor === null,
    'the checked-out identity-control serves no POST /v1/enrolments, so the seed made no inviter (e2e/seed.ps1 step 5)',
  );
  const acceptor = s.acceptor;
  if (s.enrolment === null || acceptor === null) {
    return;
  }
  const address = `${s.invitee.username}@scnehaux.local`;
  const inviterContext = await browser.newContext();
  const personContext = await browser.newContext();
  try {
    // 1. The invitation, issued in this console by a Tenant administrator.
    const inviter = await inviterContext.newPage();
    const inviterCredentials: Credentials = { person: acceptor, codes: null };
    await inviter.goto(`${bff}/`);
    await submits(inviter, () => inviter.getByRole('link', { name: 'Sign in', exact: true }).click());
    await signIn(inviter, bff, inviterCredentials);
    const entry = inviter
      .getByRole('region', { name: 'Your Tenants' })
      .getByRole('link', { name: s.tenantName, exact: true });
    await submits(inviter, () => entry.click());
    await signIn(inviter, bff, inviterCredentials);
    await expect(inviter.getByRole('region', { name: 'Active scope' })).toContainText(
      `Tenant scope: ${s.tenantId}`,
    );
    await inviter.getByRole('link', { name: 'Invitations' }).click();
    await inviter.getByLabel('Invitee').fill(address);
    await inviter.getByRole('button', { name: 'Send invitation' }).click();
    const panel = inviter.getByRole('region', { name: 'The acceptance link, shown this once' });
    const link = ((await panel.locator('code').textContent()) ?? '').trim();
    expect(link.startsWith(`${bff}/invitations/accept#`), 'the acceptance link, on this origin').toBe(true);
    await panel.getByRole('button', { name: 'Done, I have sent it' }).click();

    // 2. The person proves the address in the account application.
    const person = await personContext.newPage();
    const credentials: Credentials = { person: s.invitee, codes: null };
    await person.goto(`${identityExperience}/auth/login?return_to=${encodeURIComponent('/account/')}`);
    await signIn(person, identityExperience, credentials);
    const row = person.getByRole('row').filter({ hasText: address });
    const sentAt = Date.now() - 5_000;
    await row.getByRole('button', { name: 'Send a code' }).click();
    await expect(person.getByText(/^A code was sent to that address/).first()).toBeVisible();
    const code = await codeFor(address, sentAt);
    await row.getByLabel('Code sent to it').fill(code);
    await row.getByRole('button', { name: 'Confirm' }).click();
    await expect(person.getByText(/^Proven\. That address can now be used/)).toBeVisible();

    // 3. The same person opens the link, signs in with no Tenant, and accepts.
    await person.goto(link);
    await submits(person, () => person.getByRole('button', { name: 'Sign in to accept' }).click());
    await signIn(person, bff, credentials);
    await person.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(person.getByText(/^You joined /)).toBeVisible();

    // 4. The Tenant appears in Your Tenants.
    await person.goto(`${bff}/`);
    await expect(
      person
        .getByRole('region', { name: 'Your Tenants' })
        .getByRole('link', { name: s.tenantName, exact: true }),
    ).toBeVisible();

    writeEvidence('acceptance', {
      decision: 'ADR-ORG-007 §5.3 and §5.8',
      invitation_issued_in_console: true,
      address_proven_in_account_application: true,
      code_read_from_mail_catcher: true,
      accepted_without_a_tenant: true,
      tenant_in_your_tenants: true,
      accepted_at: iso(Date.now()),
    });
  } finally {
    await inviterContext.close();
    await personContext.close();
  }
});
