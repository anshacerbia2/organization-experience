// What the stand-in BFF answers in the browser tests (serve.ts): a session and a scope per persona, and
// enough of each Organization Control read for every route to render its rows, states and actions, in
// the shapes the application reads (apps/admin/src/features). The values are invented.

export type Persona = 'signed-out' | 'tenant' | 'provider' | 'provider-pending' | 'provider-mode';

const personas: readonly Persona[] = [
  'signed-out',
  'tenant',
  'provider',
  'provider-pending',
  'provider-mode',
];

export function personaOf(cookie: string): Persona {
  const value = /(?:^|;\s*)persona=([a-z-]+)/.exec(cookie)?.[1] ?? 'signed-out';
  return personas.find((persona) => persona === value) ?? 'signed-out';
}

const minutes = (count: number): string => new Date(Date.now() + count * 60_000).toISOString();
const days = (count: number): string => new Date(Date.now() + count * 86_400_000).toISOString();

export const me = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4aaa';
const other = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4bbb';
export const tenantId = '0192f0e0-aaaa-7000-8000-00000000a001';
export const betaTenant = '0192f0e0-aaaa-7000-8000-00000000a002';
// An invitation token as Organization Control returns one on issue (TDD-organization-experience-002
// 1.8.0). Invented: the stand-in takes no command, so a test answers the acceptance itself.
export const invitationToken = 'Gm9xQ2R0c1p4b1h3a2ZlTmVwV3l5UjZ2dE1qYkF1Q0k';
const correlation = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4aff';
export const offboardingId = '0192f0e0-bbbb-7000-8000-00000000b001';
const etaTenant = '0192f0e0-aaaa-7000-8000-00000000a007';
// An offboarding in release whose deprovisioning failed (TDD-organization-experience-003 1.5.0).
const thetaTenant = '0192f0e0-aaaa-7000-8000-00000000a008';
export const releasedOffboardingId = '0192f0e0-bbbb-7000-8000-00000000b003';
const eventId = '0192f0e0-cccc-7000-8000-00000000c001';

export function sessionOf(persona: Persona): unknown {
  if (persona === 'signed-out') {
    return { authenticated: false };
  }
  return {
    authenticated: true,
    principalId: me,
    displayName: 'Ada Admin',
    acr: 'aal2',
    authTime: minutes(-2),
    tenantId: persona === 'tenant' ? tenantId : null,
    idleExpiresAt: minutes(30),
    absoluteExpiresAt: minutes(480),
    csrfToken: 'csrf-token',
  };
}

export function scopeOf(persona: Persona): unknown {
  if (persona === 'signed-out') {
    return null;
  }
  if (persona === 'tenant') {
    return { scope: 'tenant', tenantId };
  }
  const window =
    persona === 'provider'
      ? null
      : {
          state: persona === 'provider-mode' ? 'in-force' : 'pending',
          emergency: false,
          reason: 'Investigating a stuck offboarding for Beta Logistics',
          correlationId: correlation,
          tenants: persona === 'provider-mode' ? [tenantId, betaTenant] : [betaTenant],
          durationMinutes: 45,
          requestedAt: minutes(-3),
          endsAt: persona === 'provider-mode' ? minutes(42) : null,
        };
  return {
    scope: 'provider',
    acr: 'aal2',
    authTime: minutes(-2),
    limits: { maxDurationMinutes: 60, defaultDurationMinutes: 15 },
    window,
  };
}

const workspaces = [
  ['ws-01', 'Storefront', 'retail', 'active', 4],
  ['ws-02', 'Warehouse operations', 'logistics', 'active', 12],
  ['ws-03', 'Spring campaign 2026', 'marketing', 'archived', 7],
  ['ws-04', 'Legacy ERP', 'finance', 'retired', 21],
].map(([id, name, type, status, version]) => ({
  workspace_id: String(id),
  display_name: name,
  type,
  status,
  version,
  created_at: days(-90),
}));

const memberships = [
  ['0199a1b2-1111-7e5f-8a9b-000000000001', 'human', 'active', 3, 'ws-01'],
  ['0199a1b2-1111-7e5f-8a9b-000000000002', 'workload', 'active', 1, null],
  ['0199a1b2-1111-7e5f-8a9b-000000000003', 'human', 'suspended', 5, 'ws-02'],
  ['0199a1b2-1111-7e5f-8a9b-000000000004', 'human', 'revoked', 8, null],
].map(([principal, subject, status, version, workspace], index) => ({
  membership_id: `0192f0e0-dddd-7000-8000-00000000d00${String(index + 1)}`,
  principal_id: principal,
  workspace_id: workspace,
  subject_type: subject,
  status,
  version,
  valid_from: days(-30),
  valid_until: null,
  provenance: 'HR-1042',
}));

const invitations = [
  ['pending', 3],
  ['revoked', 1],
  ['accepted', -2],
  ['expired', -5],
].map(([state, expires], index) => ({
  invitation_id: `0192f0e0-eeee-7000-8000-00000000e00${String(index + 1)}`,
  workspace_id: null,
  subject_type: 'human',
  state,
  expires_at: days(Number(expires)),
  created_at: days(-6),
  accepted_at: state === 'accepted' ? days(-3) : null,
}));

const accesses = [
  ['activation', 'tenant.suspend', tenantId, 'Contained a compromised administrator account'],
  ['emergency', 'membership.revoke', tenantId, 'Incident 4471: revoke a leaked workload credential'],
  ['activation', 'organization.read', null, 'Quarterly registry reconciliation'],
].map(([authority, operation, tenant, reason], index) => ({
  access_id: `0192f0e0-ffff-7000-8000-00000000f00${String(index + 1)}`,
  actor_id: other,
  authority,
  activation_id: authority === 'activation' ? `0192f0e0-9999-7000-8000-00000000900${String(index)}` : null,
  tenant_id: tenant,
  operation,
  correlation_id: correlation,
  reason,
  occurred_at: days(-index - 1),
}));

const organizations = [
  ['Acme Holdings', 'customer', 'active', 6],
  ['Northwind Partners', 'partner', 'suspended', 3],
  ['Contoso Publishing', 'publisher', 'retired', 9],
].map(([name, classification, status, version], index) => ({
  organization_id: `0192f0e0-1212-7000-8000-00000000120${String(index + 1)}`,
  display_name: name,
  classification,
  status,
  version,
  parent_id: null,
}));

const tenants = [
  [tenantId, 'Acme Retail', 'active', 'pooled'],
  [betaTenant, 'Beta Logistics', 'offboarding', 'silo'],
  ['0192f0e0-aaaa-7000-8000-00000000a003', 'Gamma Studio', 'provisioning', 'pooled'],
  ['0192f0e0-aaaa-7000-8000-00000000a004', 'Delta Health', 'requested', 'regional'],
  ['0192f0e0-aaaa-7000-8000-00000000a005', 'Epsilon Labs', 'failed', 'bridge'],
  ['0192f0e0-aaaa-7000-8000-00000000a006', 'Zeta Freight', 'suspended', 'pooled'],
  // Requested and never dispatched within the timeout: its request reads `unresolved`
  // (TDD-organization-control-003 1.15.0 §Resolving an `unresolved` Request).
  [etaTenant, 'Eta Mobility', 'requested', 'pooled'],
  [thetaTenant, 'Theta Media', 'offboarding', 'pooled'],
].map(([id, name, status, profile], index) => ({
  tenant_id: id,
  organization_id: organizations[0]?.organization_id,
  display_name: name,
  status,
  isolation_profile: profile,
  version: index + 2,
}));

const provisioning: Readonly<Record<string, string>> = {
  provisioning: 'realized',
  requested: 'requested',
  failed: 'failed',
};

const requestState = (tenant: (typeof tenants)[number]): string | undefined =>
  tenant.tenant_id === etaTenant ? 'unresolved' : provisioning[String(tenant.status)];

const tenantDetail = (tenant: (typeof tenants)[number]) => ({
  ...tenant,
  offboarding_id:
    tenant.tenant_id === thetaTenant
      ? releasedOffboardingId
      : tenant.status === 'offboarding'
        ? offboardingId
        : null,
  active_memberships: 14,
  provisioning:
    requestState(tenant) === undefined
      ? null
      : {
          request_id: `${tenant.tenant_id}-p`,
          correlation_id: correlation,
          state: requestState(tenant),
          detail:
            tenant.status === 'failed'
              ? 'the silo region is at capacity'
              : requestState(tenant) === 'unresolved'
                ? 'no outcome within 30m0s'
                : null,
        },
});

const offboarding = {
  offboarding_id: offboardingId,
  tenant_id: betaTenant,
  stage: 'obligations',
  reason: 'Contract ended 2026-09-30',
  legal_hold: true,
  started_at: days(-12),
  frozen_at: days(-11),
  obligations_at: days(-9),
  released_at: null,
  retired_at: null,
  deprovisioning: null,
  active_memberships: 0,
};

const releasedOffboarding = {
  ...offboarding,
  offboarding_id: releasedOffboardingId,
  tenant_id: thetaTenant,
  stage: 'release',
  reason: 'Customer moved to another platform',
  legal_hold: false,
  released_at: days(-1),
  deprovisioning: {
    state: 'failed',
    detail: 'the storage account is locked by a retention policy',
    requested_at: days(-1),
    resolved_at: minutes(-90),
  },
};

const obligations = [
  ['billing', 'final-invoice', 'completed', -3],
  ['audit', 'export-retention', 'open', -1],
  ['identity-control', 'remove-principals', 'open', 6],
  ['analytics', 'delete-warehouse', 'waived', 2],
  ['support', 'close-tickets', 'failed', 4],
].map(([domain, type, state, due], index) => ({
  obligation_id: `0192f0e0-abab-7000-8000-00000000ab0${String(index + 1)}`,
  domain,
  type,
  state,
  due_at: days(Number(due)),
  completed_at: state === 'completed' ? days(-4) : null,
  detail:
    state === 'waived' ? 'no warehouse was provisioned' : state === 'failed' ? 'ticket system refused' : '',
  resolved_by: state === 'open' ? null : `${String(domain)}-service`,
  resolved_at: state === 'open' ? null : days(-2),
}));

const consumers = [
  ['identity-control', 'active', 10, 'fail_closed', false, 0],
  ['billing', 'active', 60, 'use_with_marker', true, 2],
  ['audit', 'active', 300, 'revalidate', false, undefined],
  ['legacy-search', 'retired', 120, 'fail_closed', false, undefined],
].map(([id, state, budget, behavior, stale, findings]) => ({
  consumer_id: id,
  state,
  max_accepted_age_seconds: budget,
  stale_behavior: behavior,
  last_reported_mark: 4217,
  last_reported_at: minutes(stale === true ? -9 : -0.2),
  event_types: ['membership.changed'],
  stale,
  ...(findings === undefined
    ? {}
    : {
        last_reconciled_at: minutes(-14),
        last_reconciled_mark: 4200,
        last_reconciled_findings: findings,
        reconciliation_age_seconds: 840,
      }),
}));

const deadLetter = (consumer: string, overrides: Record<string, unknown> = {}) => ({
  event_id: eventId,
  consumer,
  event_type: 'com.scnehaux.organization.membership.security.revoked',
  authority_bearing: true,
  aggregate_id: memberships[3]?.membership_id,
  version: 8,
  lane: 'priority',
  failure_class: 'rejected',
  failure_detail: 'the consumer does not know the Tenant',
  attempts: 12,
  first_failed_at: days(-2),
  dead_lettered_at: days(-1),
  resolved_at: null,
  resolution_type: null,
  resolved_by: null,
  resolution_reference: null,
  waived_at: null,
  waived_until: null,
  waived_by: null,
  waiver_reason: null,
  ...overrides,
});

const administratorGrant = (principal: string, active: boolean, index: number) => ({
  grant_id: `0192f0e0-adad-7000-8000-00000000ad0${String(index)}`,
  tenant_id: tenantId,
  principal_id: principal,
  granted_by: me,
  reason: active ? 'First administrator after activation' : 'Interim administrator during onboarding',
  granted_at: days(-20 + index),
  active,
  revoked_at: active ? null : days(-5),
  revoked_by: active ? null : me,
  ...(active ? {} : { revoke_reason: 'Onboarding finished' }),
});

const providerGrants = [
  ['provider:organization-control', 'emergency', me, true, 'the first provider of Organization Control'],
  ['provider:organization-control', 'eligible', other, true, 'On-call rotation'],
  ['provider:identity-control', 'emergency', me, true, 'Break glass for identity-control'],
  ['provider:organization-control', 'eligible', '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4ddd', false, 'Contractor'],
].map(([scope, kind, principal, active, reason], index) => ({
  grant_id: `0192f0e0-baba-7000-8000-00000000ba0${String(index + 1)}`,
  principal_id: principal,
  scope,
  kind,
  granted_by: index === 0 ? null : me,
  ...(index === 0 ? { bootstrap_operator: 'ops@scnehaux.local' } : {}),
  reason,
  granted_at: days(-60 + index),
  active,
  revoked_at: active === true ? null : days(-3),
  revoked_by: active === true ? null : me,
  ...(active === true ? {} : { revoke_reason: 'Contract ended' }),
}));

const answers: Readonly<Record<string, () => unknown>> = {
  [`/v1/principals/${me}/contexts`]: () => ({
    contexts: [
      {
        membership_id: 'm-1',
        tenant_id: tenantId,
        tenant_display_name: 'Acme Retail',
        tenant_status: 'active',
        workspace_id: null,
        administers: true,
      },
      {
        membership_id: 'm-2',
        tenant_id: betaTenant,
        tenant_display_name: 'Beta Logistics',
        tenant_status: 'active',
        workspace_id: workspaces[1]?.workspace_id,
        administers: false,
      },
    ],
    next: null,
  }),
  '/v1/workspaces': () => ({ workspaces, next: null }),
  '/v1/memberships': () => ({ memberships, next: 'cursor-2' }),
  '/v1/invitations': () => ({ invitations, next: null }),
  '/v1/provider-access': () => ({ accesses, next: null }),
  '/v1/organizations': () => ({ organizations, next: null }),
  '/v1/tenants': () => ({ tenants, next: null }),
  '/v1/offboardings': () => ({
    offboardings: [
      offboarding,
      {
        ...offboarding,
        offboarding_id: `${offboardingId}-2`,
        tenant_id: tenants[5]?.tenant_id,
        stage: 'freeze',
        legal_hold: false,
      },
      releasedOffboarding,
    ],
    next: null,
  }),
  [`/v1/offboardings/${offboardingId}`]: () => offboarding,
  [`/v1/offboardings/${offboardingId}/obligations`]: () => ({
    obligations,
    outstanding: ['audit', 'identity-control', 'support'],
  }),
  '/v1/projections/consumers': () => ({ consumers, next: null }),
  '/v1/projections/consumers/billing/dead-letters': () => ({
    dead_letters: [deadLetter('billing')],
    next: null,
  }),
  '/v1/projections/consumers/legacy-search/dead-letters': () => ({
    dead_letters: [deadLetter('legacy-search', { lane: 'standard', authority_bearing: false })],
    next: null,
  }),
  '/v1/projections/consumers/identity-control/dead-letters': () => ({ dead_letters: [], next: null }),
  '/v1/projections/consumers/audit/dead-letters': () => ({ dead_letters: [], next: null }),
  // A restore recorded this pause before the service served (ADR-ORG-003 §5.5).
  '/v1/tenant-administration-pause': () => ({
    paused: true,
    pause_id: '0192f0e0-1313-7000-8000-000000001301',
    reason: 'INC-12 restored from the 2026-10-18 backup',
    actor_id: null,
    correlation_id: null,
    recorded_at: minutes(-50),
  }),
  [`/v1/tenants/${tenantId}/administrators`]: () => ({
    grants: [administratorGrant(other, true, 2), administratorGrant(me, false, 1)],
  }),
  '/v1/provider-grants': () => ({ grants: providerGrants }),
  [`/v1/offboardings/${releasedOffboardingId}`]: () => releasedOffboarding,
  [`/v1/offboardings/${releasedOffboardingId}/obligations`]: () => ({
    obligations: obligations
      .filter((obligation) => obligation.state === 'completed' || obligation.state === 'waived')
      .map((obligation) => ({ ...obligation, offboarding_id: releasedOffboardingId })),
    outstanding: [],
  }),
  '/v1/privileged-access:unreviewed': () => ({
    review_due_days: 7,
    actors: [
      { actor_id: other, unreviewed: 3, emergency: 1, oldest_at: days(-9), due_at: days(-2), overdue: true },
      { actor_id: me, unreviewed: 1, emergency: 0, oldest_at: days(-1), due_at: days(6), overdue: false },
    ],
  }),
  '/v1/privileged-access': () => ({ accesses, next: null }),
  '/v1/privileged-access/reviews': () => ({
    reviews: [
      {
        review_id: 'r-1',
        actor_id: other,
        from: days(-21),
        to: days(-14),
        outcome: 'appropriate',
        statement: 'Each access matched an incident ticket.',
        accesses: 4,
        emergency_accesses: 0,
        reviewed_by: me,
        reviewed_at: days(-13),
      },
    ],
    next: null,
  }),
  '/v1/provider-activations': () => ({
    activations: [
      {
        activation_id: 'a-other',
        principal_id: other,
        scope: 'provider:organization-control',
        reason: 'Restore the memberships a mistaken freeze suspended',
        duration_seconds: 1_800,
        requested_at: minutes(-4),
      },
      {
        activation_id: 'a-mine',
        principal_id: me,
        scope: 'provider:organization-control',
        reason: 'Investigating a stuck offboarding for Beta Logistics',
        duration_seconds: 2_700,
        requested_at: minutes(-3),
      },
    ],
  }),
};

for (const tenant of tenants) {
  (answers as Record<string, () => unknown>)[`/v1/tenants/${tenant.tenant_id}`] = () => tenantDetail(tenant);
}

// answer is the body for an API path, or undefined: the stand-in answers 404 then, as the API does for
// a path it does not serve.
export function answer(path: string): unknown {
  return answers[path]?.();
}
