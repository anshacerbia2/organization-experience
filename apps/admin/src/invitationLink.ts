// The invitation link (ADR-ORG-007 §5.5, TDD-organization-experience-002 1.8.0):
// https://<this origin>/invitations/accept#<token>. The token is in the fragment alone, which a
// browser separates from the URL before it asks a server for anything (RFC 3986 §3.5), so no server,
// this BFF included, receives it when the link is opened. The page's script sends it to the BFF in
// the body of a command, and nowhere else.

export const acceptancePath = '/invitations/accept';

// The key the token waits under in this tab's session storage while the person signs in. Session
// storage is this origin's and this tab's, and closing the tab clears it (MDN, sessionStorage).
const storageKey = 'scnx-org-invitation';

// invitationLink builds the link an administrator relays, for this origin.
export const invitationLink = (origin: string, token: string): string =>
  `${origin}${acceptancePath}#${encodeURIComponent(token)}`;

// identity-experience's enrolment page, for a person without an account (ADR-IAM-011 §5.1;
// TDD-identity-experience-001 1.24.0 §Enrolment From an Invitation; TDD-organization-experience-002
// 1.13.0 §Invitation). The token goes in the fragment alone, as it came here, never the query: a
// browser keeps the fragment from every server, identity-experience's BFF included (RFC 3986 §3.5).
// The origin is the deployment's, which the BFF answers at GET /auth/identity-experience.
export const enrolmentPath = '/account/enrol';

export const enrolmentLink = (identityExperienceOrigin: string, token: string): string =>
  `${identityExperienceOrigin}${enrolmentPath}#${encodeURIComponent(token)}`;

function decoded(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    // Not percent-encoding after all: the API refuses a malformed token on its own terms.
    return fragment;
  }
}

// takeInvitationToken reads the token from the address bar, moves it to session storage, and removes
// the fragment from the address bar without loading anything (history.replaceState). With no
// fragment, it is the token already waiting in this tab, if any. It is called before anything else
// on the page reads the location, so no later link, reload or sign-in return_to carries the token.
export function takeInvitationToken(
  location: Pick<Location, 'hash' | 'pathname' | 'search'> = window.location,
  history: Pick<History, 'replaceState' | 'state'> = window.history,
): string | null {
  const fragment = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  if (fragment !== '') {
    const token = decoded(fragment);
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    try {
      window.sessionStorage.setItem(storageKey, token);
    } catch {
      // Storage refused (a private window, blocked site data): the token is held by this page alone,
      // and a sign-in would need the link opened again.
    }
    return token;
  }
  return waitingInvitationToken();
}

// waitingInvitationToken is the token waiting in this tab, if any.
export function waitingInvitationToken(): string | null {
  try {
    const token = window.sessionStorage.getItem(storageKey);
    return token === null || token === '' ? null : token;
  } catch {
    return null;
  }
}

// forgetInvitationToken drops the waiting token: after an acceptance, and after a refusal that the
// same token would get again.
export function forgetInvitationToken(): void {
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // Nothing was stored.
  }
}
