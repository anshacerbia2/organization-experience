import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { minutes, publicOrigin, sessionOf, signIn, startHarness, type Harness } from './support/harness.js';
import { defaultUser, type User } from './support/identity-provider.js';
import type { Answer } from './support/upstream.js';

// TDD-organization-experience-001 1.2.0 §Testing Strategy, Scope: the scope guard and provider mode,
// against a real PostgreSQL session store and a stand-in Organization Control API.

const tenantA = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const tenantB = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const grantId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a01';
const activationId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a02';
const reason = 'Investigating a stuck offboarding for a customer';
const member: User = { ...defaultUser, tenants: [tenantA, tenantB] };

let harness: Harness;
// What the stand-in API answers, by method and path. Anything else is a 404.
const routes = new Map<string, Answer>();

const json = (status: number, body: unknown): Answer => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  harness = await startHarness({ tenantSignIn: true });
  Object.defineProperty(harness.upstream, 'answer', {
    get: (): Answer => {
      const last = harness.upstream.last();
      return routes.get(`${last.method} ${last.url}`) ?? json(404, { title: 'not found' });
    },
  });
}, 60_000);

afterAll(async () => {
  await harness.close();
});

beforeEach(() => {
  routes.clear();
  routes.set('GET /v1/memberships', json(200, { ok: true }));
  routes.set('GET /v1/organizations', json(200, { ok: true }));
  routes.set(`GET /v1/tenants/${tenantA}`, json(200, { tenant_id: tenantA }));
  routes.set(`GET /v1/tenants/${tenantB}`, json(200, { tenant_id: tenantB }));
  routes.set('GET /v1/provider-activations/grants', json(200, { grants: [eligible] }));
});

const eligible = { grant_id: grantId, scope: 'provider:organization-control', kind: 'eligible' };

const activation = (overrides: Record<string, unknown> = {}) => ({
  activation_id: activationId,
  grant_id: grantId,
  decision: '',
  ends_at: null,
  in_force: false,
  ended_at: null,
  ...overrides,
});

const inMinutes = (count: number): string =>
  new Date(harness.clock.now().getTime() + minutes(count)).toISOString();

const cookies = (session: string) => ({ '__Host-ident_session': session });

const get = (session: string, url: string) =>
  harness.app.inject({ method: 'GET', url, cookies: cookies(session) });

// post sends a state-changing request the way the application does: same origin, CSRF header.
async function post(session: string, url: string, body?: unknown) {
  const { csrfToken } = await sessionOf(harness, session);
  return harness.app.inject({
    method: 'POST',
    url,
    cookies: cookies(session),
    headers: {
      origin: publicOrigin,
      'x-csrf-token': csrfToken ?? '',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
}

const reached = (method: string, url: string): boolean =>
  harness.upstream.received.some((received) => received.method === method && received.url === url);

const window = { reason, duration_minutes: 15, tenants: [tenantA] };

describe('Tenant scope', () => {
  it('is the Tenant the sign-in asked for and the ID token confirmed', async () => {
    const { session } = await signIn(harness, { user: member, tenant: tenantA });
    expect((await get(session, '/auth/scope')).json()).toEqual({ scope: 'tenant', tenantId: tenantA });
  });

  it('refuses a request naming another Tenant before it leaves the BFF', async () => {
    const { session } = await signIn(harness, { user: member, tenant: tenantA });
    const before = harness.upstream.received.length;
    for (const url of [`/api/v1/tenants/${tenantB}`, `/api/v1/tenants/${tenantA}`, '/api/v1/organizations']) {
      const response = await get(session, url);
      expect(response.statusCode).toBe(403);
      expect(response.json<{ detail: string }>().detail).toContain('Tenant scope');
    }
    expect(harness.upstream.received.length).toBe(before);
  });

  it('passes a Tenant administration request with no reason or correlation of the BFF’s', async () => {
    const { session } = await signIn(harness, { user: member, tenant: tenantA });
    expect((await get(session, '/api/v1/memberships')).statusCode).toBe(200);
    const forwarded = harness.upstream.last();
    expect(forwarded.headers['x-administrative-reason']).toBeUndefined();
    expect(forwarded.headers['x-correlation-id']).toBeUndefined();
  });

  it('cannot open provider mode', async () => {
    const { session } = await signIn(harness, { user: member, tenant: tenantA });
    expect((await post(session, '/auth/scope/provider', window)).statusCode).toBe(403);
  });
});

describe('provider mode', () => {
  it('a provider session without a window reaches only the activation routes', async () => {
    const { session } = await signIn(harness);
    expect((await get(session, '/auth/scope')).json()).toMatchObject({ scope: 'provider', window: null });
    const refused = await get(session, '/api/v1/organizations');
    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ detail: string }>().detail).toContain('not active');
    expect(reached('GET', '/v1/organizations')).toBe(false);
  });

  it('cannot be entered without a reason, and the API is never asked', async () => {
    const { session } = await signIn(harness);
    const before = harness.upstream.received.length;
    for (const body of [{ ...window, reason: undefined }, { ...window, reason: 'short' }, {}]) {
      expect((await post(session, '/auth/scope/provider', body)).statusCode).toBe(400);
    }
    expect(harness.upstream.received.length).toBe(before);
  });

  it('cannot be entered above the maximum duration', async () => {
    const { session } = await signIn(harness);
    expect(
      (await post(session, '/auth/scope/provider', { ...window, duration_minutes: 61 })).statusCode,
    ).toBe(400);
  });

  it('asks for a fresh aal2 sign-in when the provider sign-in is not recent', async () => {
    const { session } = await signIn(harness);
    harness.clock.advance(minutes(6));
    try {
      const response = await post(session, '/auth/scope/provider', window);
      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toContain('insufficient_user_authentication');
      expect(response.headers['www-authenticate']).toContain('max_age="0"');
    } finally {
      harness.clock.advance(-minutes(6));
    }
  });

  it('requests the activation with the reason and a correlation, and waits for approval', async () => {
    routes.set('POST /v1/provider-activations', json(201, activation()));
    const { session } = await signIn(harness);
    const opened = await post(session, '/auth/scope/provider', window);
    expect(opened.statusCode).toBe(201);
    expect(opened.json()).toMatchObject({
      window: { state: 'pending', reason, tenants: [tenantA], durationMinutes: 15 },
    });

    const requested = harness.upstream.received.find(
      (received) => received.method === 'POST' && received.url === '/v1/provider-activations',
    );
    expect(JSON.parse(requested?.body ?? '{}')).toEqual({ grant_id: grantId, duration_seconds: 900 });
    expect(requested?.headers['x-administrative-reason']).toBe(reason);
    expect(requested?.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);

    const refused = await get(session, `/api/v1/tenants/${tenantA}`);
    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ detail: string }>().detail).toContain('awaiting approval');
  });

  it('is in force once approved, carries the window on every request, and refuses other Tenants', async () => {
    routes.set('POST /v1/provider-activations', json(201, activation()));
    const { session } = await signIn(harness);
    const opened = (await post(session, '/auth/scope/provider', window)).json<{
      window: { correlationId: string };
    }>();
    routes.set(
      'GET /v1/provider-activations',
      json(200, {
        activations: [activation({ decision: 'approved', ends_at: inMinutes(15), in_force: true })],
      }),
    );
    expect((await get(session, '/auth/scope')).json()).toMatchObject({ window: { state: 'in-force' } });

    expect((await get(session, `/api/v1/tenants/${tenantA}`)).statusCode).toBe(200);
    const forwarded = harness.upstream.last();
    expect(forwarded.headers['x-correlation-id']).toBe(opened.window.correlationId);
    expect(forwarded.headers['x-administrative-reason']).toBe(reason);

    const elsewhere = await get(session, `/api/v1/tenants/${tenantB}`);
    expect(elsewhere.statusCode).toBe(403);
    expect(reached('GET', `/v1/tenants/${tenantB}`)).toBe(false);
  });

  it('ends on its own at the end the API set', async () => {
    routes.set(
      'POST /v1/provider-activations',
      json(201, activation({ decision: 'approved', ends_at: inMinutes(15), in_force: true })),
    );
    const { session } = await signIn(harness);
    expect((await post(session, '/auth/scope/provider', window)).json()).toMatchObject({
      window: { state: 'in-force' },
    });
    harness.clock.advance(minutes(16));
    try {
      const response = await get(session, `/api/v1/tenants/${tenantA}`);
      expect(response.statusCode).toBe(403);
      expect(response.json<{ detail: string }>().detail).toContain('ended');
      expect((await get(session, '/auth/scope')).json()).toMatchObject({ window: null, closed: 'ended' });
    } finally {
      harness.clock.advance(-minutes(16));
    }
  });

  it('closes, and says so, when the approver denies it', async () => {
    routes.set('POST /v1/provider-activations', json(201, activation()));
    const { session } = await signIn(harness);
    await post(session, '/auth/scope/provider', window);
    routes.set(
      'GET /v1/provider-activations',
      json(200, { activations: [activation({ decision: 'denied' })] }),
    );
    expect((await get(session, '/auth/scope')).json()).toMatchObject({ window: null, closed: 'denied' });
  });

  it('leaving it ends the activation', async () => {
    routes.set(
      'POST /v1/provider-activations',
      json(201, activation({ decision: 'approved', ends_at: inMinutes(15), in_force: true })),
    );
    routes.set(
      `POST /v1/provider-activations/${activationId}/end`,
      json(200, activation({ ended_at: inMinutes(0) })),
    );
    const { session } = await signIn(harness);
    await post(session, '/auth/scope/provider', window);
    expect((await post(session, '/auth/scope/provider/end')).statusCode).toBe(204);
    expect(reached('POST', `/v1/provider-activations/${activationId}/end`)).toBe(true);
    expect((await get(session, '/auth/scope')).json()).toMatchObject({ window: null });
  });

  it('signing out ends the activation', async () => {
    routes.set(
      'POST /v1/provider-activations',
      json(201, activation({ decision: 'approved', ends_at: inMinutes(15), in_force: true })),
    );
    routes.set(
      `POST /v1/provider-activations/${activationId}/end`,
      json(200, activation({ ended_at: inMinutes(0) })),
    );
    const { session } = await signIn(harness);
    await post(session, '/auth/scope/provider', window);
    harness.upstream.received.length = 0;
    expect((await post(session, '/auth/logout')).statusCode).toBe(204);
    expect(reached('POST', `/v1/provider-activations/${activationId}/end`)).toBe(true);
  });

  it('an emergency grant opens at once, with no activation, and still ends at the duration stated', async () => {
    routes.set(
      'GET /v1/provider-activations/grants',
      json(200, { grants: [{ ...eligible, kind: 'emergency' }] }),
    );
    const { session } = await signIn(harness);
    const opened = await post(session, '/auth/scope/provider', { ...window, tenants: 'all' });
    expect(opened.json()).toMatchObject({ window: { state: 'in-force', emergency: true, tenants: 'all' } });
    expect(reached('POST', '/v1/provider-activations')).toBe(false);
    expect((await get(session, `/api/v1/tenants/${tenantB}`)).statusCode).toBe(200);
    harness.clock.advance(minutes(16));
    try {
      expect((await get(session, `/api/v1/tenants/${tenantB}`)).statusCode).toBe(403);
    } finally {
      harness.clock.advance(-minutes(16));
    }
  });

  it('passes the API’s refusal on as it wrote it', async () => {
    routes.set('POST /v1/provider-activations', {
      status: 409,
      headers: { 'content-type': 'application/problem+json' },
      body: JSON.stringify({ title: 'conflict', detail: 'another request for the grant is pending' }),
    });
    const { session } = await signIn(harness);
    const refused = await post(session, '/auth/scope/provider', window);
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ detail: 'another request for the grant is pending' });
    expect((await get(session, '/auth/scope')).json()).toMatchObject({ window: null });
  });

  it('refuses an operator holding no provider grant', async () => {
    routes.set('GET /v1/provider-activations/grants', json(200, { grants: [] }));
    const { session } = await signIn(harness);
    expect((await post(session, '/auth/scope/provider', window)).statusCode).toBe(403);
  });
});
