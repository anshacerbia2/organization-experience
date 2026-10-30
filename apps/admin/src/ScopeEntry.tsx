import { type ReactElement } from 'react';

import { messages } from './messages';
import { providerSignInHref, signInHref } from './session';
import { Button, Icon } from './ui';

// ScopeEntry holds the sign-ins the entry and the overview offer (TDD-organization-experience-001
// 1.11.0 §The Sign-In Entry). Each is a navigation to the BFF's /auth/login, never a form submitted to
// it, because the BFF's `form-action 'self'` refuses the redirect to the kernel that follows a
// submission in Chrome (STD-GLB-FE-003 §3.5). Each sign-in replaces the session (ADR-IAM-008 §5.4).
//
// No sign-in here takes a Tenant identifier. The person signs in without a Tenant and chooses one of
// their own contexts (features/contexts.tsx); provider mode alone names Tenants by identifier, as its
// targets.

// SignIn is the neutral sign-in: no Tenant, so the provider form, which grants nothing
// (ADR-IAM-008 §5.5). It lets the person read their own contexts and accept an invitation, and choose
// a Tenant after it.
export function SignIn({ returnTo }: { readonly returnTo: string }): ReactElement {
  return (
    <Button href={signInHref(returnTo)}>
      <Icon name="arrow" />
      {messages.signIn}
    </Button>
  );
}

// ProviderSignIn is the provider form's step-up: aal2 with a fresh authentication.
export function ProviderSignIn({
  returnTo,
  label,
}: {
  readonly returnTo: string;
  readonly label: string;
}): ReactElement {
  return (
    <Button variant="secondary" href={providerSignInHref(returnTo)}>
      <Icon name="key" />
      {label}
    </Button>
  );
}
