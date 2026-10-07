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
  leaveUnconfirmed:
    'Provider mode is closed here, but Organization Control did not confirm the activation ended. It ends at its own time.',
} as const;
