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
} as const;
