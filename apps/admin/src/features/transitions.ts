import { messages } from '../messages';

// The operator transitions of every machine the console shows, other than the Tenant's
// (tenantTransitions.ts), and what the console offers for each: TDD-organization-experience-002 1.7.0
// §Operator Transitions of the Other Machines, and TDD-organization-experience-003 1.5.0 §Operator
// Transitions. A transition an operator drives names the action that sends it; one something else
// drives names why the console offers none.
//
// The tables exist because an audit on 2026-10-19 found operator transitions with no trigger: a
// Tenant's first administrator could not be granted, so an active Tenant stayed unusable; a failed
// deprovisioning could not be sent again; dead letters, the pause, provider grants and consumer
// retirement had no action. transitions.test.ts fails when a machine has an edge with no row here,
// when an operator row has no action, and when a design's table disagrees with this list.

export type Driver =
  | 'operator'
  | 'provisioning system'
  | 'owning domain'
  | 'service'
  | 'deployment procedure'
  | 'restore procedure';

export interface Transition {
  // `new` is the creation of the record.
  readonly from: string;
  readonly to: string;
  readonly driver: Driver;
  readonly route: string;
  // The action's label, for an operator transition.
  readonly action?: string;
  // Why the console offers no action, for a transition it does not drive.
  readonly none?: string;
}

export interface Machine {
  readonly name: string;
  // The design whose table this is, and the table's heading there.
  readonly design: 'TDD-organization-experience-002' | 'TDD-organization-experience-003';
  readonly heading: string;
  readonly transitions: readonly Transition[];
}

// From TDD-organization-experience-003 1.6.0 each reports as its registered reporter workload
// (ADR-ORG-001 §5.11), which a provider registers on the Reporters page.
const devDeprovisioning =
  'The provisioning system reports it, as its registered reporter workload, and the console reports no outcome; on a development server, organization-control’s scripts/dev-deprovisioning.ps1, as the development reporter';
const domainResolves =
  'The accountable domain resolves its own obligation, as the reporter workload registered for obligation:<domain>, and no provider can; the board offers no control to resolve another domain’s. On a development server, organization-control’s scripts/dev-obligation.ps1';
const resolveActions = `${messages.resolveReplayed}; ${messages.resolveSuperseded}`;
// A Tenant administrator's action on the Memberships page, then a provider's on the Tenants page.
const suspendActions = `${messages.suspend}; ${messages.suspendMembership}`;
const revokeActions = `${messages.revoke}; ${messages.revokeMembership}`;
const tenantRoute = (action: string): string =>
  `POST /v1/memberships/{id}/${action}; POST /v1/tenants/{tenant_id}/memberships/{id}/${action}`;

export const machines: readonly Machine[] = [
  {
    name: 'offboarding stage',
    design: 'TDD-organization-experience-003',
    heading: 'Offboarding Stage',
    transitions: [
      {
        from: 'new',
        to: 'freeze',
        driver: 'operator',
        route: 'POST /v1/offboardings',
        action: messages.beginOffboarding,
      },
      {
        from: 'freeze',
        to: 'obligations',
        driver: 'operator',
        route: 'POST /v1/offboardings/{id}/complete-freeze',
        action: messages.completeFreeze,
      },
      {
        from: 'obligations',
        to: 'release',
        driver: 'operator',
        route: 'POST /v1/offboardings/{id}/release',
        action: messages.release,
      },
      {
        from: 'release',
        to: 'retired',
        driver: 'operator',
        route: 'POST /v1/offboardings/{id}/retire',
        action: messages.retire,
      },
      {
        from: 'freeze',
        to: 'cancelled',
        driver: 'operator',
        route: 'POST /v1/offboardings/{id}/cancel',
        action: messages.cancelOffboarding,
      },
      {
        from: 'obligations',
        to: 'cancelled',
        driver: 'operator',
        route: 'POST /v1/offboardings/{id}/cancel',
        action: messages.cancelOffboarding,
      },
    ],
  },
  {
    name: 'deprovisioning request',
    design: 'TDD-organization-experience-003',
    heading: 'Deprovisioning Request',
    transitions: [
      {
        from: 'new',
        to: 'requested',
        driver: 'operator',
        route: 'POST /v1/offboardings/{id}/release',
        action: messages.release,
      },
      {
        from: 'requested',
        to: 'realized',
        driver: 'provisioning system',
        route: 'POST /v1/offboardings/{id}/deprovisioning',
        none: devDeprovisioning,
      },
      {
        from: 'requested',
        to: 'failed',
        driver: 'provisioning system',
        route: 'POST /v1/offboardings/{id}/deprovisioning',
        none: devDeprovisioning,
      },
      {
        from: 'requested',
        to: 'unresolved',
        driver: 'service',
        route: 'the scheduled sweep',
        none: 'The sweep ages a request with no outcome after ORGANIZATION_PROVISIONING_TIMEOUT',
      },
      {
        from: 'unresolved',
        to: 'realized',
        driver: 'provisioning system',
        route: 'POST /v1/offboardings/{id}/deprovisioning',
        none: `Reported with the provisioning system’s answer, never sent again. ${devDeprovisioning}`,
      },
      {
        from: 'unresolved',
        to: 'failed',
        driver: 'provisioning system',
        route: 'POST /v1/offboardings/{id}/deprovisioning',
        none: devDeprovisioning,
      },
      {
        from: 'failed',
        to: 'requested',
        driver: 'operator',
        route: 'POST /v1/offboardings/{id}/deprovisioning/resend',
        action: messages.resendDeprovisioning,
      },
    ],
  },
  {
    name: 'obligation',
    design: 'TDD-organization-experience-003',
    heading: 'Obligation',
    transitions: [
      {
        from: 'new',
        to: 'open',
        driver: 'operator',
        route: 'POST /v1/offboardings/{id}/obligations',
        action: messages.raiseObligation,
      },
      ...(['completed', 'waived', 'failed'] as const).map((to): Transition => ({
        from: 'open',
        to,
        driver: 'owning domain',
        route: 'POST /v1/obligations/{id}/resolve',
        none: domainResolves,
      })),
      ...(['completed', 'waived'] as const).map((to): Transition => ({
        from: 'failed',
        to,
        driver: 'owning domain',
        route: 'POST /v1/obligations/{id}/resolve',
        none: domainResolves,
      })),
      {
        from: 'open',
        to: 'cancelled',
        driver: 'operator',
        route: 'POST /v1/offboardings/{id}/cancel',
        action: messages.cancelOffboarding,
      },
    ],
  },
  {
    name: 'tenant administration grant',
    design: 'TDD-organization-experience-002',
    heading: 'Tenant Administration Grant',
    transitions: [
      {
        from: 'new',
        to: 'active',
        driver: 'operator',
        route: 'POST /v1/tenants/{id}/administrators',
        action: messages.grantAdministrator,
      },
      {
        from: 'active',
        to: 'revoked',
        driver: 'operator',
        route: 'POST /v1/tenants/{id}/administrators/{grant_id}/revoke',
        action: messages.revokeAdministrator,
      },
    ],
  },
  {
    name: 'provider grant',
    design: 'TDD-organization-experience-002',
    heading: 'Provider Grant',
    transitions: [
      ...(['eligible', 'emergency'] as const).map((to): Transition => ({
        from: 'new',
        to,
        driver: 'operator',
        route: 'POST /v1/provider-grants',
        action: messages.grantProvider,
      })),
      ...(['eligible', 'emergency'] as const).map((from): Transition => ({
        from,
        to: 'revoked',
        driver: 'operator',
        route: 'POST /v1/provider-grants/{grant_id}/revoke',
        action: messages.revokeGrant,
      })),
    ],
  },
  {
    name: 'projection consumer',
    design: 'TDD-organization-experience-002',
    heading: 'Projection Consumer',
    transitions: [
      {
        from: 'new',
        to: 'active',
        driver: 'deployment procedure',
        route: 'POST /v1/projections/consumers',
        none: 'Registered with its owner’s declaration by the procedure that deploys it (organization-control scripts/dev-wire.ps1); registering again replaces the subscription',
      },
      {
        from: 'active',
        to: 'retired',
        driver: 'operator',
        route: 'POST /v1/projections/consumers/{id}/retire',
        action: messages.retireConsumer,
      },
    ],
  },
  {
    name: 'dead letter',
    design: 'TDD-organization-experience-002',
    heading: 'Dead Letter',
    transitions: [
      {
        from: 'new',
        to: 'open',
        driver: 'service',
        route: 'the delivery dispatcher',
        none: 'Organization Control dead-letters a delivery its consumer kept refusing',
      },
      {
        from: 'open',
        to: 'open',
        driver: 'operator',
        route: 'POST /v1/dead-letters/{event_id}/consumers/{consumer}/replay',
        action: messages.replay,
      },
      {
        from: 'open',
        to: 'resolved',
        driver: 'operator',
        route: 'POST /v1/dead-letters/{event_id}/consumers/{consumer}/resolve',
        action: resolveActions,
      },
      {
        from: 'open',
        to: 'waived',
        driver: 'operator',
        route: 'POST /v1/dead-letters/{event_id}/consumers/{consumer}/waive',
        action: messages.waive,
      },
      {
        from: 'waived',
        to: 'resolved',
        driver: 'operator',
        route: 'POST /v1/dead-letters/{event_id}/consumers/{consumer}/resolve',
        action: resolveActions,
      },
      {
        from: 'waived',
        to: 'open',
        driver: 'service',
        route: 'waived_until passes',
        none: 'A waiver expires on its own, and the incident alerts again',
      },
    ],
  },
  {
    name: 'reporter',
    design: 'TDD-organization-experience-002',
    heading: 'Reporter',
    transitions: [
      {
        from: 'new',
        to: 'active',
        driver: 'operator',
        route: 'POST /v1/reporters',
        action: messages.registerReporter,
      },
      {
        from: 'active',
        to: 'retired',
        driver: 'operator',
        route: 'POST /v1/reporters/{reporter_id}/retire',
        action: messages.retireReporter,
      },
    ],
  },
  {
    name: 'membership',
    design: 'TDD-organization-experience-002',
    heading: 'Membership',
    transitions: [
      {
        from: 'new',
        to: 'active',
        driver: 'operator',
        route: 'POST /v1/memberships',
        action: messages.grantMembership,
      },
      {
        from: 'active',
        to: 'suspended',
        driver: 'operator',
        route: tenantRoute('suspend'),
        action: suspendActions,
      },
      {
        from: 'suspended',
        to: 'active',
        driver: 'operator',
        route: 'POST /v1/memberships/{id}/restore',
        action: messages.restore,
      },
      ...(['active', 'suspended'] as const).map((from): Transition => ({
        from,
        to: 'revoked',
        driver: 'operator',
        route: tenantRoute('revoke'),
        action: revokeActions,
      })),
    ],
  },
  {
    name: 'tenant-administration pause',
    design: 'TDD-organization-experience-002',
    heading: 'Tenant-Administration Pause',
    transitions: [
      {
        from: 'new',
        to: 'paused',
        driver: 'restore procedure',
        route: 'deploy/dev/restore.sh with PAUSE_REASON',
        none: 'Recorded in the restored database before the service serves, naming no actor',
      },
      {
        from: 'unpaused',
        to: 'paused',
        driver: 'operator',
        route: 'POST /v1/tenant-administration-pause',
        action: messages.pauseAdministration,
      },
      {
        from: 'paused',
        to: 'unpaused',
        driver: 'operator',
        route: 'POST /v1/tenant-administration-pause',
        action: messages.liftPause,
      },
    ],
  },
];
