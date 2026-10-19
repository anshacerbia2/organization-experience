import { messages } from '../messages';

// Each transition of organization-control's Tenant state machine (TDD-organization-control-003
// §Tenant State Machine) and what this console offers for it (TDD-organization-experience-002 1.6.0
// §Operator Transitions). A transition an operator drives names the action that sends it; one the
// provisioning system drives names why the console offers none.
//
// The table exists because a Tenant requested here could not leave `requested`: the states were
// rendered, and nothing checked that each operator-driven transition had an action
// (ROADMAP §Week 3). tenantTransitions.test.ts fails when a transition of the machine has no row
// here, when an operator row has no action, and when the design's table disagrees with this list.

export type TenantStatus =
  'requested' | 'provisioning' | 'active' | 'failed' | 'suspended' | 'offboarding' | 'retired';

export interface TenantTransition {
  // `new` is the creation of the record.
  readonly from: TenantStatus | 'new';
  readonly to: TenantStatus;
  readonly driver: 'operator' | 'provisioning system';
  readonly route: string;
  // The action's label, for an operator transition.
  readonly action?: string;
  // Why the console offers no action, for a transition it does not drive.
  readonly none?: string;
}

export const tenantTransitions: readonly TenantTransition[] = [
  {
    from: 'new',
    to: 'requested',
    driver: 'operator',
    route: 'POST /v1/tenants',
    action: messages.requestTenant,
  },
  {
    from: 'requested',
    to: 'provisioning',
    driver: 'operator',
    route: 'POST /v1/tenants/{id}/provisioning',
    action: messages.startProvisioning,
  },
  {
    from: 'provisioning',
    to: 'failed',
    driver: 'provisioning system',
    route: 'POST /v1/provisioning/failed',
    none: 'The provisioning system reports it; on a development server, organization-control’s scripts/dev-provisioning.ps1',
  },
  {
    from: 'failed',
    to: 'provisioning',
    driver: 'operator',
    route: 'POST /v1/tenants/{id}/provisioning',
    action: messages.retryProvisioning,
  },
  {
    from: 'provisioning',
    to: 'active',
    driver: 'operator',
    route: 'POST /v1/tenants/{id}/activate',
    action: messages.activate,
  },
  {
    from: 'active',
    to: 'suspended',
    driver: 'operator',
    route: 'POST /v1/tenants/{id}/suspend',
    action: messages.suspend,
  },
  {
    from: 'suspended',
    to: 'active',
    driver: 'operator',
    route: 'POST /v1/tenants/{id}/restore',
    action: messages.restore,
  },
  {
    from: 'active',
    to: 'offboarding',
    driver: 'operator',
    route: 'POST /v1/offboardings',
    action: messages.beginOffboarding,
  },
  {
    from: 'suspended',
    to: 'offboarding',
    driver: 'operator',
    route: 'POST /v1/offboardings',
    action: messages.beginOffboarding,
  },
  {
    from: 'offboarding',
    to: 'active',
    driver: 'operator',
    route: 'POST /v1/offboardings/{id}/cancel',
    action: messages.cancelOffboarding,
  },
  {
    from: 'offboarding',
    to: 'suspended',
    driver: 'operator',
    route: 'POST /v1/offboardings/{id}/cancel',
    action: messages.cancelOffboarding,
  },
  {
    from: 'offboarding',
    to: 'retired',
    driver: 'operator',
    route: 'POST /v1/offboardings/{id}/retire',
    action: messages.retire,
  },
];
