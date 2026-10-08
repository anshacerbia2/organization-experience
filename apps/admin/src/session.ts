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
      // tenantId is the Tenant the sign-in asked for and the ID token confirmed; null for a
      // provider sign-in (ADR-IAM-008).
      readonly tenantId: string | null;
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

// providerSignInHref signs in to the provider form with a fresh authentication at aal2, as entering
// provider mode requires (ADR-IAM-008 §5.4). Any Tenant scope the browser held is replaced.
export const providerSignInHref = (returnTo: string): string =>
  `/auth/login?acr_values=aal2&max_age=0&return_to=${encodeURIComponent(returnTo)}`;

// tenantSignInHref signs in to one Tenant, chosen from the operator's contexts or a deep link. The
// kernel admits a member alone, and the BFF holds the ID token to the Tenant asked for.
export const tenantSignInHref = (tenantId: string, returnTo: string): string =>
  `/auth/login?tenant=${encodeURIComponent(tenantId)}&return_to=${encodeURIComponent(returnTo)}`;

// tenantPattern is the form a Tenant identifier takes. The BFF refuses anything else, and the
// kernel admits only a member of the Tenant named (ADR-IAM-006 §5.2).
export const tenantPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

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

// navigation leaves the application for a sign-in. A sign-in is a navigation the script makes, never a
// form submitted to /auth/login: that route redirects to the identity kernel, and Chrome checks a form
// submission's redirect against the BFF's `form-action 'self'` and refuses it (STD-GLB-FE-003 §3.5).
// An object, so a test can replace the one call jsdom does not implement.
export const navigation = {
  assign(href: string): void {
    window.location.assign(href);
  },
};
