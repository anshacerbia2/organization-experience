import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App';
import { checkWcag } from '../test/a11y';
import { inForce, json, providerScope, signedInto, stub, visit, type Handler } from '../test/bff';

// TDD-organization-experience-001 1.4.0 §Accessibility: every route, in the scope that serves it and
// with a row of data, passes axe-core's WCAG 2.2 A and AA rules. The manual evidence the production
// gate also asks for (keyboard, screen reader, contrast, target size) is not replaced by this.

const tenantA = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const offboardingId = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4d02';

afterEach(() => {
  vi.unstubAllGlobals();
  visit('/');
});

const tenantScope = signedInto(tenantA, { scope: 'tenant', tenantId: tenantA });
const providerInForce = signedInto(null, providerScope(inForce));
const providerIdle = signedInto(null, providerScope(null));

// answers maps a BFF path to its body; each call builds a fresh Response, as a body is read once.
const answers =
  (bodies: Record<string, unknown>): Handler =>
  (url) =>
    url in bodies ? json(bodies[url]) : undefined;

const tenantRow = {
  tenant_id: tenantA,
  organization_id: 'org-1',
  display_name: 'Acme',
  status: 'active',
  isolation_profile: 'pooled',
  version: 6,
  security_version: 2,
  created_at: '2026-01-01T00:00:00Z',
};

const offboarding = {
  offboarding_id: offboardingId,
  tenant_id: tenantA,
  stage: 'obligations',
  reason: 'Contract ended',
  legal_hold: true,
  started_at: '2026-09-01T00:00:00Z',
  obligations_at: '2026-09-02T00:00:00Z',
  released_at: null,
  deprovisioning: null,
  active_memberships: 0,
};

const cases: readonly {
  readonly path: string;
  readonly scope: Handler;
  readonly bodies: Record<string, unknown>;
  readonly shows: string;
}[] = [
  { path: '/', scope: tenantScope, bodies: {}, shows: 'Organization administration' },
  {
    path: '/memberships',
    scope: tenantScope,
    bodies: {
      '/api/v1/memberships': {
        memberships: [
          {
            membership_id: 'm-1',
            principal_id: 'p-1',
            subject_type: 'human',
            status: 'active',
            version: 3,
            valid_from: '2026-10-01T00:00:00Z',
            provenance: 'request',
          },
        ],
        next: null,
      },
    },
    shows: 'p-1',
  },
  {
    path: '/invitations',
    scope: tenantScope,
    bodies: {
      '/api/v1/invitations': {
        invitations: [
          {
            invitation_id: 'inv-1',
            subject_type: 'human',
            state: 'pending',
            expires_at: '2099-01-01T00:00:00Z',
            created_at: '2026-10-01T00:00:00Z',
          },
        ],
        next: null,
      },
    },
    shows: 'inv-1',
  },
  {
    path: '/organizations',
    scope: providerInForce,
    bodies: {
      '/api/v1/organizations': {
        organizations: [
          {
            organization_id: 'org-1',
            display_name: 'Acme Holdings',
            classification: 'customer',
            status: 'active',
            version: 4,
          },
        ],
        next: null,
      },
    },
    shows: 'Acme Holdings',
  },
  {
    path: '/tenants',
    scope: providerInForce,
    bodies: { '/api/v1/tenants': { tenants: [tenantRow], next: null } },
    shows: 'Acme',
  },
  {
    path: '/offboardings',
    scope: providerInForce,
    bodies: { '/api/v1/offboardings': { offboardings: [offboarding], next: null } },
    shows: 'Legal hold is set',
  },
  {
    path: `/offboardings/${offboardingId}`,
    scope: providerInForce,
    bodies: {
      [`/api/v1/offboardings/${offboardingId}`]: offboarding,
      [`/api/v1/offboardings/${offboardingId}/obligations`]: {
        obligations: [
          {
            obligation_id: 'ob-1',
            offboarding_id: offboardingId,
            tenant_id: tenantA,
            domain: 'HCM',
            type: 'workforce export',
            state: 'open',
            due_at: '2026-09-15T00:00:00Z',
          },
        ],
        outstanding: [],
      },
      [`/api/v1/tenants/${tenantA}`]: {
        ...tenantRow,
        status: 'offboarding',
        offboarding_id: offboardingId,
        active_memberships: 0,
      },
    },
    shows: 'workforce export',
  },
  {
    path: '/projections',
    scope: providerInForce,
    bodies: {
      '/api/v1/projections/consumers': {
        consumers: [
          {
            consumer_id: 'billing',
            state: 'active',
            max_accepted_age_seconds: 30,
            stale_behavior: 'use_with_marker',
            last_reported_at: '2026-10-07T10:00:00Z',
            stale: true,
          },
        ],
        next: null,
      },
    },
    shows: 'billing',
  },
  {
    path: '/approvals',
    scope: providerInForce,
    bodies: {
      '/api/v1/provider-activations': {
        activations: [
          {
            activation_id: 'a-1',
            principal_id: 'someone-else',
            scope: 'provider:organization-control',
            reason: 'Investigating an incident',
            duration_seconds: 900,
            requested_at: '2026-10-07T10:00:00Z',
            decision: '',
          },
        ],
      },
    },
    shows: 'someone-else',
  },
  {
    path: '/access-review',
    scope: providerInForce,
    bodies: {
      '/api/v1/privileged-access:unreviewed': {
        review_due_days: 7,
        actors: [
          {
            actor_id: 'provider-b',
            unreviewed: 3,
            emergency: 1,
            oldest_at: '2026-09-28T09:00:00Z',
            due_at: '2026-10-05T09:00:00Z',
            overdue: true,
          },
        ],
      },
    },
    shows: 'provider-b',
  },
  {
    path: '/provider-access',
    scope: tenantScope,
    bodies: {
      '/api/v1/provider-access': {
        accesses: [
          {
            access_id: 'acc-1',
            actor_id: 'provider-b',
            authority: 'activation',
            activation_id: 'act-1',
            tenant_id: tenantA,
            operation: 'POST /v1/tenants/{tenant_id}/suspend',
            correlation_id: 'corr-1',
            reason: 'Suspending after the contract lapsed',
            occurred_at: '2026-10-01T10:00:00Z',
          },
        ],
        next: null,
      },
    },
    shows: 'Suspending after the contract lapsed',
  },
  // The provider mode form, offered to a provider sign-in with no window.
  { path: '/', scope: providerIdle, bodies: {}, shows: 'Enter provider mode' },
];

describe('accessibility', () => {
  it.each(cases)(
    '$path passes the WCAG 2.2 A and AA rules ($shows)',
    async ({ path, scope, bodies, shows }) => {
      visit(path);
      stub(scope, answers(bodies), (url) =>
        url.startsWith('/api/v1/principals/') ? json({ contexts: [], next: null }) : undefined,
      );
      const { container } = render(<App />);
      expect((await screen.findAllByText(shows, { exact: false }))[0]).toBeInTheDocument();
      expect(await checkWcag(container)).toHaveNoViolations();
    },
  );
});
