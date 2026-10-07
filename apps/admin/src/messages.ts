// Every user-visible string, in one catalogue (STD-GLB-FE-009 §3.6). One locale until the
// application has more than one screen to translate.
export const messages = {
  title: 'Organization administration',
  checking: 'Checking session',
  unavailable: 'Session unavailable',
  signedOut: 'Not signed in',
  signedIn: 'Signed in',
  signIn: 'Sign in',
  signOut: 'Sign out',
  signOutFailed: 'Sign-out did not complete. Try again.',
  signInFailed: 'Sign-in did not complete. Try again; if it keeps failing, the reason is in the service log.',
  signInUnavailable:
    'Keycloak could not be reached, so sign-in did not complete. Nothing was refused: try again in a moment.',

  // The active scope (TDD-organization-experience-001 §Scope Visibility).
  scopeRegion: 'Active scope',
  scopeLoading: 'Reading the active scope',
  scopeUnavailable: 'The active scope could not be read. Nothing is offered until it can be.',
  scopeAmbiguous:
    'The session and the active scope disagree about the Tenant. Sign out and sign in again before acting.',
  scopeRetry: 'Read the scope again',
  tenantScope: 'Tenant scope',
  providerSignedIn: 'Provider sign-in: provider mode is not active',
  providerPending: 'Provider mode requested: awaiting approval by another provider',
  providerActive: 'Provider mode',
  providerTargets: 'Tenants',
  everyTenant: 'every Tenant',
  endsIn: 'ends in',
  emergencyGrant: 'on an emergency grant',
  providerClosed: {
    denied: 'Provider mode was denied by the approver.',
    lapsed: 'The provider mode request lapsed without a decision.',
    ended: 'Provider mode has ended.',
  },

  // Moving between scopes. Each is a sign-in, which replaces the session.
  signInTenant: 'Sign in to a Tenant',
  switchTenant: 'Switch to another Tenant',
  tenantIdentifier: 'Tenant identifier',
  tenantIdentifierHint: 'The Tenant’s identifier, as Organization Control issued it.',
  continueToTenant: 'Continue to this Tenant',
  signInProvider: 'Sign in as a provider',
  switchToProvider: 'Switch to provider administration',

  // Provider mode entry.
  enterProviderMode: 'Enter provider mode',
  providerModeExplained:
    'Provider mode reaches across Tenants. It opens only with a reason, for a bounded time, for the Tenants you name, and another provider approves it.',
  reason: 'Reason',
  reasonHint: (min: number, max: number): string =>
    `Why you need provider access, ${String(min)} to ${String(max)} characters. It is recorded before anything opens.`,
  reasonShort: (min: number): string => `Write at least ${String(min)} characters.`,
  reasonLong: (max: number): string => `Keep it to ${String(max)} characters.`,
  reasonCharacters: 'Use letters, digits, spaces and plain punctuation only.',
  duration: 'Duration in minutes',
  durationHint: (max: number): string =>
    `At most ${String(max)} minutes. Provider mode then ends on its own.`,
  durationInvalid: (max: number): string => `Choose a whole number of minutes from 1 to ${String(max)}.`,
  targets: 'Tenants',
  targetsNamed: 'The Tenants I name',
  targetsAll: 'Every Tenant',
  targetsList: 'Tenant identifiers, one per line',
  targetsInvalid: 'Each line must be one Tenant identifier, and name at least one.',
  requestProviderMode: 'Request provider mode',
  requesting: 'Requesting',
  stepUpNeeded: 'Provider mode needs a sign-in within the last few minutes.',
  stepUpAction: 'Sign in again',
  refusedWith: (detail: string): string => `Not opened. Organization Control said: ${detail}`,
  refused: 'Not opened. The request was refused.',
  dependencyUnavailable: 'Organization Control could not be reached. Nothing was opened; try again.',
  correlation: (id: string): string => `Reference ${id}`,
  leaveProviderMode: 'Leave provider mode',
  withdrawRequest: 'Withdraw the request',
  // The administration surfaces (TDD-organization-experience-002 1.2.0).
  navigation: 'Sections',
  separator: ' · ',
  subjectHuman: 'human',
  subjectWorkload: 'workload',
  overview: 'Overview',
  loading: 'Loading',
  loadMore: 'Show more',
  any: 'Any',
  cancel: 'Cancel',
  status: 'Status',
  state: (value: string): string => value.replace(/_/g, ' '),
  versionOf: (version: number): string => `version ${String(version)}`,
  irreversible: 'This cannot be undone.',
  inTenant: (tenantId: string): string => `In Tenant ${tenantId}.`,
  inTenantNamed: (name: string, tenantId: string): string =>
    `In Tenant ${name} (${tenantId}), in provider mode.`,
  inOrganization: (name: string): string => `In Organization ${name}, in provider mode.`,
  reasonOptional: 'Reason (optional)',
  typeToConfirm: (text: string): string => `Type ${text} to confirm`,
  versionConflict:
    'Not done: the record changed since it was shown. Its current state is shown now; decide again on what it is.',
  refusedBy: (detail: string): string => `Not done. Organization Control said: ${detail}`,
  needsTenantScope: 'This section belongs to a Tenant scope. Sign in to a Tenant to use it.',
  needsProvider: 'This section belongs to a provider sign-in.',
  needsProviderMode: 'This section opens in provider mode. Enter it, with a reason, from the overview.',

  workspaces: 'Workspaces',
  createWorkspace: 'Create workspace',
  displayName: 'Display name',
  workspaceType: 'Type',
  noWorkspaces: 'No workspaces match.',
  archive: 'Archive',
  restore: 'Restore',
  retire: 'Retire',

  memberships: 'Memberships',
  grantMembership: 'Grant membership',
  principalId: 'Principal identifier',
  workspaceIdOptional: 'Workspace identifier (optional)',
  workspaceRef: (id: string): string => `workspace ${id}`,
  subjectType: 'Subject type',
  provenance: 'Provenance',
  provenanceHint: 'How this membership came to exist, for example a request reference.',
  noMemberships: 'No memberships match.',
  suspend: 'Suspend',
  revoke: 'Revoke',
  revocationAccepted: (at: string): string =>
    `Revocation accepted at ${at}. Acceptance is not enforcement: access ends as each service applies it.`,

  invitations: 'Invitations',
  sendInvitation: 'Send invitation',
  invitee: 'Invitee',
  inviteeHint: 'The address the invitation is for. It is stored only as a digest.',
  validForDays: 'Valid for days',
  invitationToken:
    'The invitation token, shown this once. Deliver it to the invitee; it grants nothing until their identity is verified.',
  noInvitations: 'No invitations match.',
  invitationState: (state: string): string =>
    state === 'pending'
      ? 'pending: nothing is granted until the invitee is verified and accepts'
      : state === 'identity_verified'
        ? 'identity verified: awaiting acceptance'
        : state.replace(/_/g, ' '),
  expiresIn: 'expires in',

  organizations: 'Organizations',
  createOrganization: 'Register organization',
  classification: 'Classification',
  noOrganizations: 'No organizations match.',
  itsTenants: 'Its Tenants',

  tenants: 'Tenants',
  requestTenant: 'Request tenant',
  organizationId: 'Organization identifier',
  isolationProfile: 'Isolation profile',
  noTenants: 'No Tenants match.',
  activate: 'Activate',
  tenantRequested: 'Awaiting provisioning. Membership cannot be granted yet.',
  tenantProvisioning:
    'Provisioning in progress. Activation is a deliberate step, taken here once provisioning has been confirmed.',
  tenantActive: 'Usable.',
  tenantFailed: 'Provisioning was refused. Nothing in this Tenant is usable.',
  tenantSuspended: 'Access is stopped for every membership in this Tenant.',
  tenantOffboarding: 'Offboarding: staged, and resumable. It is not finished.',
  tenantRetired: 'Retired.',

  approvals: 'Activation requests',
  reviewRequests: 'Review requests',
  reviewReasonExplained:
    'Reading the requests is a provider access, recorded with a reason. Provider mode supplies its own; without it, state yours.',
  noPendingActivations: 'No activation awaits a decision.',
  minutes: (count: number): string => `${String(count)} minutes`,
  activationReason: (reason: string): string => `Reason given: ${reason}`,
  yourRequest: 'Your own request. Another provider decides it.',
  approve: 'Approve',
  deny: 'Deny',

  leaveUnconfirmed:
    'Provider mode is closed here, but Organization Control did not confirm the activation ended. It ends at its own time.',
} as const;
