import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet } from '@tanstack/react-router';
import { useState, type ReactElement, type ReactNode } from 'react';

import { sessionQueryKey } from './api/query';
import { ContextSwitcher } from './features/contexts';
import { messages } from './messages';
import { ProviderModeGate } from './ProviderMode';
import { ScopeBanner } from './ScopeBanner';
import { ScopeProvider, useScope, useWindowInForce } from './ScopeContext';
import { ProviderSignIn, TenantSignIn } from './ScopeEntry';
import { signInOutcome, signOut } from './session';
import { SignedInProvider, useSessionQuery, useSignedIn } from './SessionContext';

// here is the path a sign-in returns to: where the browser is, on this origin.
export const here = (): string =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;

// Shell frames every view: the session, the scope banner, the navigation the active scope allows,
// and the view itself. It makes no authorization decision; the BFF's scope guard and the
// Organization Control API decide every request.
export function Shell(): ReactElement {
  const client = useQueryClient();
  const session = useSessionQuery();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const outcome = signInOutcome(window.location.search);

  const header = (
    <>
      <h1>{messages.title}</h1>
      {outcome === null ? null : (
        <p role="alert">{outcome === 'failed' ? messages.signInFailed : messages.signInUnavailable}</p>
      )}
      {session.isPending ? <p>{messages.checking}</p> : null}
      {session.isError ? <p>{messages.unavailable}</p> : null}
    </>
  );

  if (session.data?.authenticated !== true) {
    return (
      <main>
        {header}
        {session.data === undefined ? null : (
          <>
            <p>{messages.signedOut}</p>
            <TenantSignIn returnTo={here()} label={messages.signInTenant} />
            <p>
              <ProviderSignIn returnTo={here()} label={messages.signInProvider} />
            </p>
          </>
        )}
      </main>
    );
  }

  const signedIn = session.data;
  const onSignOut = (): void => {
    setSigningOut(true);
    setSignOutFailed(false);
    signOut(signedIn.csrfToken)
      .catch(() => {
        setSignOutFailed(true);
      })
      .finally(() => {
        setSigningOut(false);
        // Every view's data belonged to the session that ended.
        client.removeQueries({ predicate: (query) => query.queryKey[0] !== sessionQueryKey[0] });
        void client.invalidateQueries({ queryKey: sessionQueryKey });
      });
  };

  return (
    <SignedInProvider session={signedIn}>
      <ScopeProvider sessionTenantId={signedIn.tenantId}>
        <ScopeBanner />
        <main>
          {header}
          <p>
            <span>{signedIn.displayName ?? signedIn.principalId ?? messages.signedIn}</span>{' '}
            <button type="button" disabled={signingOut} onClick={onSignOut}>
              {messages.signOut}
            </button>
          </p>
          {signOutFailed ? <p role="alert">{messages.signOutFailed}</p> : null}
          <Navigation />
          <Outlet />
        </main>
      </ScopeProvider>
    </SignedInProvider>
  );
}

function Navigation(): ReactElement | null {
  const { state } = useScope();
  const inForce = useWindowInForce();
  if (state.status !== 'ready') {
    return null;
  }
  const links: { to: string; label: string }[] = [{ to: '/', label: messages.overview }];
  if (state.scope.scope === 'tenant') {
    links.push(
      { to: '/workspaces', label: messages.workspaces },
      { to: '/memberships', label: messages.memberships },
      { to: '/invitations', label: messages.invitations },
    );
  } else {
    if (inForce) {
      links.push(
        { to: '/organizations', label: messages.organizations },
        { to: '/tenants', label: messages.tenants },
        { to: '/offboardings', label: messages.offboardings },
        { to: '/projections', label: messages.projectionHealth },
      );
    }
    links.push({ to: '/approvals', label: messages.approvals });
  }
  return (
    <nav aria-label={messages.navigation}>
      <ul>
        {links.map((link) => (
          <li key={link.to}>
            <Link to={link.to}>{link.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// Home offers what the active scope allows: moving to another scope, and in provider scope the
// provider mode ceremony.
export function Home(): ReactElement | null {
  const session = useSignedIn();
  const { state, reload } = useScope();
  if (state.status === 'loading') {
    return null;
  }
  if (state.status !== 'ready') {
    return (
      <p>
        <button type="button" onClick={reload}>
          {messages.scopeRetry}
        </button>
      </p>
    );
  }
  const scope = state.scope;
  if (scope.scope === 'tenant') {
    return (
      <>
        <ContextSwitcher returnTo={here()} current={scope.tenantId} />
        <TenantSignIn returnTo={here()} label={messages.switchTenant} />
        <p>
          <ProviderSignIn returnTo={here()} label={messages.switchToProvider} />
        </p>
      </>
    );
  }
  return (
    <>
      <ProviderModeGate scope={scope} csrfToken={session.csrfToken} returnTo={here()} />
      {/* Switching to a Tenant replaces the session; an open window is left first, so its
          activation ends rather than outliving the session that asked for it. */}
      {scope.window === null ? (
        <>
          <ContextSwitcher returnTo={here()} current={null} />
          <TenantSignIn returnTo={here()} label={messages.signInTenant} />
        </>
      ) : null}
    </>
  );
}

// RequireScope renders a surface only in the scope it belongs to, and otherwise says which scope it
// needs. The BFF refuses the requests anyway; this keeps the operator from making them.
export function RequireScope({
  scope,
  children,
}: {
  readonly scope: 'tenant' | 'provider-mode' | 'provider';
  readonly children: (tenantId: string) => ReactNode;
}): ReactElement | null {
  const { state } = useScope();
  const inForce = useWindowInForce();
  if (state.status !== 'ready') {
    return null;
  }
  const active = state.scope;
  if (scope === 'tenant' && active.scope === 'tenant') {
    return <>{children(active.tenantId)}</>;
  }
  if (scope === 'provider' && active.scope === 'provider') {
    return <>{children('')}</>;
  }
  if (scope === 'provider-mode' && inForce) {
    return <>{children('')}</>;
  }
  return (
    <p role="status">
      {scope === 'tenant'
        ? messages.needsTenantScope
        : scope === 'provider'
          ? messages.needsProvider
          : messages.needsProviderMode}
    </p>
  );
}
