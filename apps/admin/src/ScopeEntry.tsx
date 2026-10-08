import { useId, type ReactElement } from 'react';

import { messages } from './messages';
import { navigation, providerSignInHref, tenantPattern, tenantSignInHref } from './session';

// ScopeEntry moves between scopes. Each move is a sign-in, which replaces the session
// (ADR-IAM-008 §5.4): the Tenant form navigates to the BFF's /auth/login with the Tenant named, by
// script rather than by submitting itself, because the BFF's `form-action 'self'` refuses the
// redirect to the kernel that follows a submission in Chrome (STD-GLB-FE-003 §3.5). Provider
// administration is a sign-in with a fresh authentication. The identifier only
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
    <form
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        const tenant = new FormData(event.currentTarget).get('tenant');
        if (typeof tenant === 'string') {
          navigation.assign(tenantSignInHref(tenant.trim(), returnTo));
        }
      }}
    >
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
