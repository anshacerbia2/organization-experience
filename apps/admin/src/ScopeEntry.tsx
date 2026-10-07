import { useId, type ReactElement } from 'react';

import { messages } from './messages';
import { providerSignInHref, tenantPattern } from './session';

// ScopeEntry moves between scopes. Each move is a sign-in, which replaces the session
// (ADR-IAM-008 §5.4): the Tenant form is a navigation to the BFF's /auth/login with the Tenant
// named, and provider administration is a sign-in with a fresh authentication. The identifier only
// selects; the kernel admits a member alone, and the BFF holds the ID token to it.

export function TenantSignIn({
  returnTo,
  label,
}: {
  readonly returnTo: string;
  readonly label: string;
}): ReactElement {
  const inputId = useId();
  const hintId = useId();
  return (
    <form method="get" action="/auth/login" aria-label={label}>
      <input type="hidden" name="return_to" value={returnTo} />
      <label htmlFor={inputId}>{messages.tenantIdentifier}</label>
      <input
        id={inputId}
        name="tenant"
        required
        pattern={tenantPattern}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={hintId}
      />
      <p id={hintId}>{messages.tenantIdentifierHint}</p>
      <button type="submit">{messages.continueToTenant}</button>
    </form>
  );
}

export function ProviderSignIn({
  returnTo,
  label,
}: {
  readonly returnTo: string;
  readonly label: string;
}): ReactElement {
  return <a href={providerSignInHref(returnTo)}>{label}</a>;
}
