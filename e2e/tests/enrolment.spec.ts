// A person invited with no account enrols, then accepts (ADR-IAM-011 §5.1 to §5.4;
// TDD-organization-experience-002 1.13.0 §Invitation; TDD-organization-experience-001 1.15.0 §End to
// End, step 7), against the stack:
//
//   1. a Tenant administrator issues an invitation in this console to an address no account holds;
//   2. signed out, the acceptance page offers I do not have an account, a link to identity-experience's
//      enrolment page with the token in the fragment alone;
//   3. identity-control resolves the token through Organization Control: POST /v1/enrolments, called
//      as a registered enrolment caller with the client address in Forwarded, standing in for
//      identity-experience's BFF (ADR-IAM-011 §5.8; e2e/seed.ps1 step 5);
//   4. the code is read from the development mail catcher (ADR-IAM-011 §5.5);
//   5. :verify answers the temporary password, once;
//   6. the new person signs in through the kernel's hosted login, chooses a password and enrolls a
//      TOTP, and accepts the invitation on the acceptance page, which names the Tenant joined.
//
// Skipped, and said so, where the checked-out identity-control serves no enrolment.
import {
  constants,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  randomInt,
  sign,
} from 'node:crypto';
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import {
  codeFor,
  identityExperience,
  iso,
  organizationExperience as bff,
  required,
  seed,
  signIn,
  submits,
  writeEvidence,
  type Credentials,
  type Seed,
} from './stack';

const identityApi = (process.env['IDENTITY_API_URL'] ?? 'http://127.0.0.1:8082').replace(/\/+$/, '');
const kernel = required('KC_ADMIN_URL').replace(/\/+$/, '');
const realm = 'scnehaux';

let s: Seed;

test.beforeAll(() => {
  s = seed();
});

// callerToken is the enrolment caller's own token: client credentials, with an RFC 7523 assertion
// signed by its key as identity-control's scripts/client-assertion.ps1 signs one (PS256, the key's
// RFC 7638 thumbprint as kid, the realm's issuer as aud, one minute).
async function callerToken(clientId: string, keyFile: string): Promise<string> {
  const discovery = (await (
    await fetch(`${kernel}/realms/${realm}/.well-known/openid-configuration`)
  ).json()) as { issuer: string };
  const key = createPrivateKey(readFileSync(keyFile, 'utf8'));
  const jwk = createPublicKey(key).export({ format: 'jwk' });
  const kid = createHash('sha256')
    .update(`{"e":"${String(jwk.e)}","kty":"RSA","n":"${String(jwk.n)}"}`)
    .digest('base64url');
  const now = Math.floor(Date.now() / 1000);
  const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${part({ alg: 'PS256', typ: 'JWT', kid })}.${part({
    iss: clientId,
    sub: clientId,
    aud: discovery.issuer,
    jti: randomBytes(32).toString('base64url'),
    iat: now,
    exp: now + 60,
  })}`;
  const signature = sign('sha256', Buffer.from(input), {
    key,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  }).toString('base64url');
  const response = await fetch(`${kernel}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: `${input}.${signature}`,
    }),
  });
  if (!response.ok) {
    throw new Error(`the enrolment caller's token was refused: ${String(response.status)}`);
  }
  return ((await response.json()) as { access_token: string }).access_token;
}

test('a person invited with no account enrols, signs in and accepts', async ({ browser }) => {
  test.skip(
    s.enrolment === null,
    'the checked-out identity-control serves no POST /v1/enrolments (ADR-IAM-011); e2e/seed.ps1 step 5',
  );
  const enrolment = s.enrolment;
  if (enrolment === null) {
    return;
  }
  const address = `stack.enrolled.${s.run}@scnehaux.local`;
  const inviterContext = await browser.newContext();
  const personContext = await browser.newContext();
  try {
    // 1. The invitation, issued in this console by a Tenant administrator.
    const inviter = await inviterContext.newPage();
    const inviterCredentials: Credentials = { person: enrolment.inviter, codes: null };
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
    const token = decodeURIComponent(new URL(link).hash.slice(1));
    await panel.getByRole('button', { name: 'Done, I have sent it' }).click();

    // 2. Signed out, the acceptance page offers I do not have an account, with the token in the fragment
    // of identity-experience's enrolment page alone.
    const person = await personContext.newPage();
    await person.goto(link);
    await expect(person.getByRole('button', { name: 'Sign in to accept' })).toBeVisible();
    const noAccount = person.getByRole('link', { name: 'I do not have an account' });
    await expect(noAccount).toHaveAttribute(
      'href',
      `${identityExperience}/account/enrol#${encodeURIComponent(token)}`,
    );

    // 3. identity-control resolves it, from a registered enrolment caller with the client address.
    const bearer = await callerToken(enrolment.callerClientId, enrolment.callerKeyFile);
    const forwarded = `for=198.51.100.${String(randomInt(1, 255))}`;
    const sentAt = Date.now() - 5_000;
    const requested = await fetch(`${identityApi}/v1/enrolments`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', forwarded },
      body: JSON.stringify({ token }),
    });
    expect(requested.status, 'POST /v1/enrolments').toBe(202);
    expect(requested.headers.get('cache-control')).toContain('no-store');
    const { enrolment_id: enrolmentId } = (await requested.json()) as { enrolment_id: string };

    // 4. The code, from the mail catcher.
    const code = await codeFor(address, sentAt);

    // 5. :verify answers the temporary password, once.
    const verified = await fetch(`${identityApi}/v1/enrolments/${enrolmentId}:verify`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', forwarded },
      body: JSON.stringify({ code }),
    });
    expect(verified.status, ':verify').toBe(201);
    expect(verified.headers.get('cache-control')).toContain('no-store');
    const account = (await verified.json()) as {
      principal_id: string;
      username: string;
      temporary_password: string;
      lapses_at: string;
    };
    expect(account.username, 'the username is the invited address, lower-cased').toBe(address);
    const again = await fetch(`${identityApi}/v1/enrolments/${enrolmentId}:verify`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', forwarded },
      body: JSON.stringify({ code }),
    });
    expect(again.status, 'the code is good once').toBe(400);

    // 6. The new person signs in, chooses a password and enrolls a TOTP, and accepts.
    const credentials: Credentials = {
      person: {
        username: account.username,
        password: account.temporary_password,
        principalId: account.principal_id,
      },
      codes: null,
    };
    await person.goto(link);
    await submits(person, () => person.getByRole('button', { name: 'Sign in to accept' }).click());
    const shown = await signIn(person, bff, credentials);
    expect(shown, 'the kernel pages of the first sign-in').toEqual(
      expect.arrayContaining(['password', 'update-password', 'configure-totp']),
    );
    await person.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(person.getByText(/^You joined /)).toBeVisible();

    writeEvidence('enrolment', {
      decision: 'ADR-IAM-011 §5.1 to §5.4',
      invitation_issued_in_console: true,
      link_to_enrolment_page: `${identityExperience}/account/enrol#<token>`,
      enrolment_requested: { status: requested.status, forwarded_by_registered_caller: true },
      code_read_from_mail_catcher: true,
      verified: { status: verified.status, lapses_at: account.lapses_at, second_use_refused: again.status },
      kernel_pages_at_first_sign_in: shown,
      accepted_at: iso(Date.now()),
    });
  } finally {
    await inviterContext.close();
    await personContext.close();
  }
});
