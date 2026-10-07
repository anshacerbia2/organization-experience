import { describe, expect, it } from 'vitest';

import { guard, namedTenants, type ActiveScope, type GuardRequest } from '../src/scope/guard.js';
import { readWindowRequest } from '../src/scope/routes.js';
import type { ProviderWindow } from '../src/scope/windows.js';

// TDD-organization-experience-001 1.2.0 §The Scope Guard: what each scope reaches, decided before a
// request leaves the BFF.

const tenantA = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const tenantB = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const now = new Date('2026-10-07T10:00:00Z');
const me = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4aaa';

const request = (path: string, overrides: Partial<GuardRequest> = {}): GuardRequest => ({
  method: 'GET',
  path,
  contentType: undefined,
  body: undefined,
  reason: undefined,
  principalId: me,
  ...overrides,
});

const post = (path: string, body: unknown): GuardRequest =>
  request(path, {
    method: 'POST',
    contentType: 'application/json',
    body: Buffer.from(JSON.stringify(body)),
  });

const window = (overrides: Partial<ProviderWindow> = {}): ProviderWindow => ({
  sessionHash: Buffer.alloc(32),
  grantKind: 'eligible',
  activationId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a00',
  reason: 'Investigating a stuck offboarding for a customer',
  correlationId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4aff',
  tenants: [tenantA],
  durationSeconds: 900,
  requestedAt: new Date(now.getTime() - 60_000),
  endsAt: new Date(now.getTime() + 600_000),
  ...overrides,
});

const tenantScope: ActiveScope = { kind: 'tenant', tenantId: tenantA };
const providerScope = (open: ProviderWindow | null): ActiveScope => ({ kind: 'provider', window: open });

describe('Tenant scope', () => {
  it('reaches the Tenant administration routes, which name no Tenant', () => {
    for (const path of [
      '/v1/memberships',
      '/v1/memberships/x/suspend',
      '/v1/workspaces/w',
      '/v1/invitations',
    ]) {
      expect(guard(tenantScope, request(path), now)).toEqual({ allowed: true, headers: {} });
    }
  });

  it('refuses a provider route before it leaves the BFF, naming the scope', () => {
    for (const path of [
      `/v1/tenants/${tenantB}`,
      `/v1/tenants/${tenantA}/suspend`,
      '/v1/organizations',
      '/v1/provider-activations',
      '/v1/invitations/verify-identity',
      '/v1/invitations/expire-lapsed',
      '/v1/membershipsx',
    ]) {
      const decision = guard(tenantScope, request(path), now);
      expect(decision.allowed).toBe(false);
      expect(decision).toMatchObject({ detail: expect.stringContaining('Tenant scope') as unknown });
    }
  });

  it('refuses a body naming another Tenant', () => {
    expect(guard(tenantScope, post('/v1/memberships', { tenant_id: tenantB }), now).allowed).toBe(false);
    expect(guard(tenantScope, post('/v1/memberships', { tenant_id: tenantA }), now).allowed).toBe(true);
  });

  it('sets no reason and no correlation: a Tenant request is not a privileged access', () => {
    expect(guard(tenantScope, request('/v1/workspaces'), now)).toEqual({ allowed: true, headers: {} });
  });
});

describe('provider scope', () => {
  it('reaches only the activation routes with no window', () => {
    expect(guard(providerScope(null), request('/v1/provider-activations'), now).allowed).toBe(true);
    expect(guard(providerScope(null), request('/v1/provider-activations/a/approve'), now).allowed).toBe(true);
    expect(guard(providerScope(null), request(`/v1/tenants/${tenantA}`), now)).toMatchObject({
      allowed: false,
      detail: expect.stringContaining('not active') as unknown,
    });
  });

  it('reaches only the activation routes while the window awaits approval', () => {
    const pending = window({ endsAt: null });
    expect(guard(providerScope(pending), request(`/v1/tenants/${tenantA}`), now)).toMatchObject({
      allowed: false,
      detail: expect.stringContaining('awaiting approval') as unknown,
    });
  });

  it('reaches nothing past the activation routes once the window has ended', () => {
    const ended = window({ endsAt: new Date(now.getTime() - 1) });
    expect(guard(providerScope(ended), request(`/v1/tenants/${tenantA}`), now)).toMatchObject({
      allowed: false,
      detail: expect.stringContaining('ended') as unknown,
    });
    expect(guard(providerScope(window({ endsAt: now })), request('/v1/organizations'), now).allowed).toBe(
      false,
    );
  });

  it('reaches every route in force, except a Tenant outside the targets', () => {
    const open = providerScope(window());
    expect(guard(open, request(`/v1/tenants/${tenantA}/suspend`, { method: 'POST' }), now).allowed).toBe(
      true,
    );
    expect(guard(open, request('/v1/organizations/o'), now).allowed).toBe(true);
    expect(guard(open, request(`/v1/tenants/${tenantB}`), now)).toMatchObject({
      allowed: false,
      detail: expect.stringContaining('outside') as unknown,
    });
    expect(guard(open, post('/v1/offboardings', { tenant_id: tenantB }), now).allowed).toBe(false);
    expect(guard(open, post('/v1/offboardings', { tenant_id: tenantA }), now).allowed).toBe(true);
  });

  it('reaches every Tenant when entered for all of them', () => {
    const all = providerScope(window({ tenants: null }));
    expect(guard(all, request(`/v1/tenants/${tenantB}`), now).allowed).toBe(true);
  });

  it('carries the window reason and correlation, and the operator’s own reason when given', () => {
    const open = window();
    expect(guard(providerScope(open), request('/v1/organizations'), now)).toEqual({
      allowed: true,
      headers: { 'x-correlation-id': open.correlationId, 'x-administrative-reason': open.reason },
    });
    expect(
      guard(
        providerScope(open),
        request('/v1/organizations', { reason: 'Suspending for a confirmed breach' }),
        now,
      ),
    ).toEqual({ allowed: true, headers: { 'x-correlation-id': open.correlationId } });
  });

  it('an emergency window closes at its stated end as well', () => {
    const emergency = window({
      grantKind: 'emergency',
      activationId: null,
      endsAt: new Date(now.getTime() - 1),
    });
    expect(guard(providerScope(emergency), request('/v1/organizations'), now).allowed).toBe(false);
  });
});

describe('namedTenants', () => {
  it('reads the path after /v1/tenants/ and a top-level tenant_id, and nothing else', () => {
    expect(namedTenants(request(`/v1/tenants/${tenantA}/administrators`))).toEqual([tenantA]);
    expect(namedTenants(request('/v1/tenants'))).toEqual([]);
    expect(namedTenants(post('/v1/offboardings', { tenant_id: tenantB }))).toEqual([tenantB]);
    expect(namedTenants(post('/v1/offboardings', { nested: { tenant_id: tenantB } }))).toEqual([]);
    expect(namedTenants(post('/v1/offboardings', { tenant_id: 7 }))).toEqual(['7']);
  });
});

describe('readWindowRequest', () => {
  const provider = { maxDurationMs: 3_600_000, defaultDurationMs: 900_000, stepUpAgeMs: 300_000 };
  const valid = { reason: 'Investigating a stuck offboarding', duration_minutes: 15, tenants: [tenantA] };

  it('accepts a reason, a duration and the Tenants, normalizing the reason', () => {
    expect(
      readWindowRequest({ ...valid, reason: '  Investigating\na stuck   offboarding ' }, provider),
    ).toEqual({
      request: { reason: 'Investigating a stuck offboarding', durationSeconds: 900, tenants: [tenantA] },
    });
    expect(readWindowRequest({ ...valid, tenants: 'all' }, provider)).toMatchObject({
      request: { tenants: null },
    });
  });

  it('refuses a window without a reason, before anything opens', () => {
    for (const reason of [undefined, '', 'too short', 'é'.repeat(20), 'x'.repeat(501)]) {
      expect(readWindowRequest({ ...valid, reason }, provider)).toHaveProperty('problem');
    }
  });

  it('refuses a duration outside 1 to the maximum, in whole minutes', () => {
    for (const duration of [0, 61, 1.5, '15', undefined]) {
      expect(readWindowRequest({ ...valid, duration_minutes: duration }, provider)).toHaveProperty('problem');
    }
  });

  it('refuses targets that are neither Tenants nor all of them', () => {
    for (const tenants of [[], ['*'], [tenantA.toUpperCase()], 'some', undefined, Array(51).fill(tenantA)]) {
      expect(readWindowRequest({ ...valid, tenants }, provider)).toHaveProperty('problem');
    }
  });
});

describe('own contexts (ADR-ORG-005)', () => {
  const own = request(`/v1/principals/${me}/contexts`);
  it('reaches the operator’s own contexts in every scope, carrying nothing of a window', () => {
    for (const scope of [
      tenantScope,
      providerScope(null),
      providerScope(window({ endsAt: null })),
      providerScope(window()),
    ]) {
      expect(guard(scope, own, now)).toEqual({ allowed: true, headers: {} });
    }
    expect(
      guard(providerScope(null), request(`/v1/principals/${me}/contexts?after=x&limit=10`), now).allowed,
    ).toBe(true);
  });

  it('reaches no other Principal’s contexts, and only reads', () => {
    expect(guard(tenantScope, request('/v1/principals/someone-else/contexts'), now).allowed).toBe(false);
    expect(guard(providerScope(null), request('/v1/principals/someone-else/contexts'), now).allowed).toBe(
      false,
    );
    expect(
      guard(tenantScope, request(`/v1/principals/${me}/contexts`, { method: 'POST' }), now).allowed,
    ).toBe(false);
    expect(
      guard(tenantScope, request(`/v1/principals/${me}/contexts`, { principalId: null }), now).allowed,
    ).toBe(false);
  });
});
