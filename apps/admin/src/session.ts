// The browser side of the BFF session (TDD-identity-experience-001). The browser never sees a
// token: it knows whether it is signed in, what to display, and the CSRF token it echoes on a
// state-changing request. The cookie itself is HttpOnly and out of reach.

export type Session =
  | { readonly authenticated: false }
  | {
      readonly authenticated: true;
      readonly principalId: string | null;
      readonly displayName: string | null;
      readonly acr: string | null;
      readonly authTime: string | null;
      readonly idleExpiresAt: string;
      readonly absoluteExpiresAt: string;
      readonly csrfToken: string;
    };

// The header the BFF compares against the session's token (bff/src/http/csrf.ts).
export const csrfHeader = 'x-csrf-token';

// fetchSession reads the display context. Reading it is not activity: the BFF does not extend the
// idle expiry for it.
export async function fetchSession(): Promise<Session> {
  const response = await fetch('/auth/session', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`the session could not be read: ${String(response.status)}`);
  }
  return (await response.json()) as Session;
}

// signInHref starts a sign-in that returns here. It is a full navigation to the BFF, never a
// fetch: the identity kernel's hosted page is where credentials are entered. The BFF accepts only a
// path on its own origin.
export const signInHref = (returnTo: string): string =>
  `/auth/login?return_to=${encodeURIComponent(returnTo)}`;

// signOut ends the session. The BFF ends the identity kernel's session server-side, so there is
// nowhere to redirect. The browser sends its Origin on the POST, and the CSRF token goes in the
// header: the BFF refuses a state-changing request without both.
export async function signOut(csrfToken: string): Promise<void> {
  const response = await fetch('/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { [csrfHeader]: csrfToken },
  });
  // 401: the session had already ended, which is the outcome asked for.
  if (!response.ok && response.status !== 401) {
    throw new Error(`sign-out failed: ${String(response.status)}`);
  }
}

// signInOutcome reads the marker the BFF lands a sign-in that did not complete with: `failed` when
// it was refused, `unavailable` when the identity kernel did not answer. Anything else is none.
export function signInOutcome(search: string): 'failed' | 'unavailable' | null {
  const value = new URLSearchParams(search).get('sign-in');
  return value === 'failed' || value === 'unavailable' ? value : null;
}
