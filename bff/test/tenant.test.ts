import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { cookieValue, sessionOf, signIn, startHarness, type Harness } from './support/harness.js';
import { defaultUser, type User } from './support/identity-provider.js';
import { tenantSelector } from '../src/auth/routes.js';

// TDD-identity-experience-001 §Context Switch: a sign-in asks for one Tenant, or for none, and the
// callback holds the ID token to what it asked (ADR-IAM-008 §5.2, §5.3). An application whose client
// is registered for one form leaves tenant sign-in off.

const tenantA = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const tenantB = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const member: User = { ...defaultUser, tenants: [tenantA, tenantB] };

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness({ tenantSignIn: true });
}, 60_000);

afterAll(async () => {
  await harness.close();
});

beforeEach(() => {
  harness.provider.refreshBehaviour = 'rotate';
  harness.provider.tamper = null;
});

const scopeAsked = (): string[] => (harness.provider.lastAuthorization?.get('scope') ?? '').split(' ');

// callback completes a sign-in started at loginUrl, after tamper has had its say.
async function callback(loginUrl: string, user: User = member) {
  const login = await harness.app.inject({ method: 'GET', url: loginUrl });
  const query = harness.provider.authorize(String(login.headers.location), user);
  return harness.app.inject({
    method: 'GET',
    url: `/auth/callback${query}`,
    cookies: { '__Host-ident_login': cookieValue(login, '__Host-ident_login') ?? '' },
  });
}

const refused = (response: Awaited<ReturnType<typeof callback>>): void => {
  expect(response.statusCode).toBe(302);
  expect(response.headers.location).toBe('/?sign-in=failed');
  expect(cookieValue(response, '__Host-ident_session')).toBeUndefined();
};

describe('tenant sign-in', () => {
  it('asks for the one Tenant named, and the session holds it', async () => {
    const { session } = await signIn(harness, { user: member, tenant: tenantA });
    expect(scopeAsked()).toEqual([
      'openid',
      'scnehaux-privileged',
      `organization:${tenantA}`,
      'scnehaux-profile',
    ]);
    expect(await sessionOf(harness, session)).toMatchObject({ authenticated: true, tenantId: tenantA });
  });

  it('asks for the provider-scope form when no Tenant is named, and the session holds none', async () => {
    const { session } = await signIn(harness, { user: member });
    expect(scopeAsked()).toEqual(['openid', 'scnehaux-provider', 'scnehaux-profile']);
    expect(await sessionOf(harness, session)).toMatchObject({ authenticated: true, tenantId: null });
  });

  it('switching Tenant is a new sign-in that replaces the session', async () => {
    const first = await signIn(harness, { user: member, tenant: tenantA });
    const login = await harness.app.inject({ method: 'GET', url: `/auth/login?tenant=${tenantB}` });
    const query = harness.provider.authorize(String(login.headers.location), member);
    const switched = await harness.app.inject({
      method: 'GET',
      url: `/auth/callback${query}`,
      cookies: {
        '__Host-ident_login': cookieValue(login, '__Host-ident_login') ?? '',
        '__Host-ident_session': first.session,
      },
    });
    const second = cookieValue(switched, '__Host-ident_session') ?? '';
    expect(await sessionOf(harness, second)).toMatchObject({ authenticated: true, tenantId: tenantB });
    expect((await sessionOf(harness, first.session)).authenticated).toBe(false);
  });

  describe('refuses', () => {
    it('a Tenant identifier that is not one, before anything is asked of the kernel', async () => {
      for (const tenant of [
        '',
        'all',
        '*',
        tenantA.toUpperCase(),
        `${tenantA} ${tenantB}`,
        `${tenantA}%20x`,
      ]) {
        const login = await harness.app.inject({
          method: 'GET',
          url: `/auth/login?tenant=${encodeURIComponent(tenant)}`,
        });
        expect(login.statusCode).toBe(302);
        expect(login.headers.location).toBe('/?sign-in=failed');
        expect(cookieValue(login, '__Host-ident_login')).toBeUndefined();
      }
    });

    it('a Tenant sign-in whose ID token names another Tenant', async () => {
      harness.provider.tamper = { claims: { tenant_id: tenantB } };
      refused(await callback(`/auth/login?tenant=${tenantA}`));
    });

    it('a Tenant sign-in whose ID token names no Tenant', async () => {
      harness.provider.tamper = { claims: { tenant_id: undefined } };
      refused(await callback(`/auth/login?tenant=${tenantA}`));
    });

    it('a provider sign-in whose ID token names a Tenant', async () => {
      harness.provider.tamper = { claims: { tenant_id: tenantA } };
      refused(await callback('/auth/login'));
    });
  });

  it('ends the session when a refresh returns another Tenant', async () => {
    const { session } = await signIn(harness, { user: member, tenant: tenantA });
    harness.provider.tamper = { claims: { tenant_id: tenantB } };
    harness.clock.advance(harness.provider.accessTokenLifetimeSeconds * 1000);
    try {
      const response = await harness.app.inject({
        method: 'GET',
        url: '/api/v1/x',
        cookies: { '__Host-ident_session': session },
      });
      expect(response.statusCode).toBe(401);
      expect((await sessionOf(harness, session)).authenticated).toBe(false);
    } finally {
      harness.clock.advance(-harness.provider.accessTokenLifetimeSeconds * 1000);
    }
  });

  it('keeps the session when a refresh keeps the Tenant', async () => {
    const { session } = await signIn(harness, { user: member, tenant: tenantA });
    harness.clock.advance(harness.provider.accessTokenLifetimeSeconds * 1000);
    try {
      const response = await harness.app.inject({
        method: 'GET',
        url: '/api/v1/x',
        cookies: { '__Host-ident_session': session },
      });
      expect(response.statusCode).toBe(200);
      expect(await sessionOf(harness, session)).toMatchObject({ authenticated: true, tenantId: tenantA });
    } finally {
      harness.clock.advance(-harness.provider.accessTokenLifetimeSeconds * 1000);
    }
  });
});

describe('tenantSelector', () => {
  it('reads a lowercase UUID, and refuses anything else rather than dropping it', () => {
    expect(tenantSelector(undefined, true)).toBeNull();
    expect(tenantSelector(tenantA, true)).toBe(tenantA);
    expect(tenantSelector(tenantA.toUpperCase(), true)).toBeUndefined();
    expect(tenantSelector([tenantA, tenantB], true)).toBeUndefined();
  });

  it('refuses any Tenant where tenant sign-in is off', () => {
    expect(tenantSelector(undefined, false)).toBeNull();
    expect(tenantSelector(tenantA, false)).toBeUndefined();
  });
});
