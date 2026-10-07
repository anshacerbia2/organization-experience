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

  // Bulk actions and enforcement (ADR-ORG-004).
  selectMembership: (principal: string): string => `Select the membership of ${principal}`,
  bulkActOn: (count: number): string => `Act on ${String(count)} selected memberships`,
  bulkAction: 'Bulk action',
  bulkActionLabel: 'Action',
  bulkSelected: (count: number): string => `${String(count)} memberships selected`,
  bulkContinues: 'Resubmitting the failed memberships of the previous batch, under its correlation.',
  bulkPreviewAction: 'Preview',
  bulkPreview: 'Preview',
  bulkPreviewCaption: (change: number, unchanged: number): string =>
    `${String(change)} would change; ${String(unchanged)} would not.`,
  currentState: 'Now',
  resultingState: 'After',
  bulkConfirm: (action: string, count: number, tenantId: string): string =>
    `This will ${action} ${String(count)} memberships in Tenant ${tenantId}, exactly as previewed. A membership that changed since the preview is not touched.`,
  bulkExecute: (action: string, count: number): string => `${action} ${String(count)} memberships`,
  bulkOutcome: 'Outcome',
  bulkCounts: (succeeded: number, failed: number, notAttempted: number): string =>
    `${String(succeeded)} succeeded, ${String(failed)} failed, ${String(notAttempted)} not attempted.`,
  outcomeHeading: (status: string): string =>
    ({ succeeded: 'Succeeded', failed: 'Failed', not_attempted: 'Not attempted' })[status] ?? status,
  notAttempted: (reason: string): string =>
    ({
      refused_at_preview: 'refused at the preview',
      error_allowance: 'stopped after the allowed failures',
      expired: 'the preview expired before it was executed',
    })[reason] ?? reason,
  resubmitFailed: (count: number): string => `Preview the ${String(count)} failed again`,
  close: 'Close',
  enforcementState: (state: string): string =>
    ({
      accepted: 'Accepted',
      propagating: 'Propagating',
      enforced: 'Enforced',
      over_budget: 'Enforcement delayed',
    })[state] ?? state,
  enforcementTiming: (transition: string, at: string, elapsed: number, budget: number): string =>
    `${transition} accepted ${at}; ${String(elapsed)} s of a ${String(budget)} s budget.`,
  pendingConsumers: 'Services not yet applying it',
  consumerEvidence: (consumer: string, evidence: string): string => `${consumer}: ${evidence}`,
  evidence: (evidence: string): string =>
    ({
      transport_accepted: 'delivered, not yet applied',
      pending: 'not yet delivered',
      dead_lettered: 'delivery failed',
      consumer_applied: 'applied',
    })[evidence] ?? evidence,
  overBudgetEscalation:
    'Enforcement is past its budget. Raise it with the platform on-call, quoting the event and the services above.',

  offboardings: 'Offboardings',
  noOffboardings: 'No offboardings match.',
  stage: 'Stage',
  stages: 'Stages',
  stageName: (stage: string): string =>
    ({ freeze: 'Freeze', obligations: 'Obligations', release: 'Release', retired: 'Retired' })[stage] ??
    stage,
  stageStops: (stage: string): string =>
    ({
      freeze: 'stops access for every membership in the Tenant. Nothing is deleted.',
      obligations: 'keeps access stopped. Data remains while domains export, retain and report.',
      release: 'keeps access stopped. Infrastructure is being released.',
      retired: 'stops everything.',
    })[stage] ?? '',
  inStageSince: (stage: string, since: string, elapsed: number): string =>
    `In ${stage} since ${since}, ${String(elapsed)} days.`,
  stalled: 'This offboarding has been in its stage for more than 30 days.',
  startedAt: (at: string): string => `Started ${at}`,
  offboardingOf: (name: string): string => `Offboarding of ${name}`,
  legalHoldSet: 'Legal hold is set',
  holdProceeds: (what: string): string => `${what} proceeds`,
  holdBlocks: (what: string): string => `${what} is blocked`,
  setHold: 'Set legal hold',
  liftHold: 'Lift legal hold',
  retirement: 'Retirement',
  obligations: 'Obligations',
  obligation: 'Obligation',
  domain: 'Domain',
  due: 'Due',
  detail: 'Detail',
  overdue: 'overdue',
  obligationState: (state: string): string => (state === 'waived' ? 'waived: decided not to be done' : state),
  resolvedByDomain: (domain: string): string => `Resolved by the ${domain} domain, not here.`,
  resolvedBy: (who: string, at: string, detail: string): string =>
    [`by ${who}`, at, detail].filter((part) => part !== '').join(', '),
  raiseObligation: 'Raise obligation',
  activeRemaining: (count: number): string => `${String(count)} memberships are still active in this Tenant.`,
  freezeNext: (size: number): string => `Suspend the next ${String(size)}`,
  completeFreeze: 'Complete the freeze',
  release: 'Release',
  releaseIrreversible: 'Release begins removing the Tenant’s infrastructure. It cannot be undone.',
  blockedByHold: (what: string): string => `${what} is blocked by the legal hold.`,
  blockedByObligations: 'Release waits on these obligations:',
  deprovisioningNone: 'Deprovisioning has not been requested.',
  deprovisioningRealized: (at: string): string => `Deprovisioning is complete, ${at}.`,
  deprovisioningFailed: (detail: string): string => `Deprovisioning failed: ${detail}`,
  deprovisioningAwaiting: (at: string): string =>
    `Deprovisioning was requested ${at} and has no outcome yet. Retirement waits; nothing is retried here.`,
  offboard: 'Offboarding',
  beginOffboarding: 'Begin offboarding',
  resumeOffboarding: 'Resume its offboarding',
  beginWill: (count: number): string =>
    `This suspends ${String(count)} memberships now and stops access. Nothing is deleted.`,

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
