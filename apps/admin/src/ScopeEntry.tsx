import { useId, type ReactElement } from 'react';

import { messages } from './messages';
import { navigation, providerSignInHref, tenantPattern, tenantSignInHref } from './session';
import { Button, fieldClasses, Icon, layout } from './ui';

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
  const headingId = useId();
  return (
    <form
      aria-labelledby={headingId}
      className={layout.stack}
      onSubmit={(event) => {
        event.preventDefault();
        const tenant = new FormData(event.currentTarget).get('tenant');
        if (typeof tenant === 'string') {
          navigation.assign(tenantSignInHref(tenant.trim(), returnTo));
        }
      }}
    >
      <h2 id={headingId} className={layout.subtitle}>
        {label}
      </h2>
      <div className={fieldClasses.field}>
        <label htmlFor={inputId} className={fieldClasses.label}>
          {messages.tenantIdentifier}
        </label>
        <input
          id={inputId}
          name="tenant"
          className={fieldClasses.input}
          required
          pattern={tenantPattern}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={hintId}
        />
        <p id={hintId} className={fieldClasses.hint}>
          {messages.tenantIdentifierHint}
        </p>
      </div>
      <div className={layout.actions}>
        <Button type="submit" icon={<Icon name="arrow" />}>
          {messages.continueToTenant}
        </Button>
      </div>
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
  return (
    <Button variant="secondary" href={providerSignInHref(returnTo)} icon={<Icon name="key" />}>
      {label}
    </Button>
  );
}
