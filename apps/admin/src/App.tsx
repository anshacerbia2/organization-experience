import { useEffect, useState, type ReactElement } from 'react';

import { messages } from './messages';
import { ProviderModeGate } from './ProviderMode';
import { ScopeBanner } from './ScopeBanner';
import { ScopeProvider, useScope } from './ScopeContext';
import { ProviderSignIn, TenantSignIn } from './ScopeEntry';
import { fetchSession, signInOutcome, signOut, type Session } from './session';

type SessionState =
  | { readonly status: 'checking' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly session: Session };

type SignedIn = Extract<Session, { authenticated: true }>;

// here is the path a sign-in returns to: where the browser is, on this origin.
const here = (): string => `${window.location.pathname}${window.location.search}${window.location.hash}`;

// ScopeView offers what the active scope allows: moving to another scope, and in provider scope the
// provider mode ceremony. It makes no authorization decision; the BFF's scope guard and the
// Organization Control API decide every request.
function ScopeView({ session }: { readonly session: SignedIn }): ReactElement | null {
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
      {scope.window === null ? <TenantSignIn returnTo={here()} label={messages.signInTenant} /> : null}
    </>
  );
}

// App states whether the operator is signed in, shows the active scope on every view, and offers
// the actions that apply.
export function App(): ReactElement {
  const [state, setState] = useState<SessionState>({ status: 'checking' });
  // Each sign-out reads the session again, which is how the page learns it is signed out.
  const [generation, setGeneration] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  useEffect(() => {
    let current = true;
    fetchSession().then(
      (session) => {
        if (current) {
          setState({ status: 'ready', session });
        }
      },
      () => {
        if (current) {
          setState({ status: 'unavailable' });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [generation]);

  const onSignOut = (csrfToken: string): void => {
    setSigningOut(true);
    setSignOutFailed(false);
    signOut(csrfToken)
      .catch(() => {
        setSignOutFailed(true);
      })
      .finally(() => {
        setSigningOut(false);
        setGeneration((value) => value + 1);
      });
  };

  const outcome = signInOutcome(window.location.search);
  const session = state.status === 'ready' ? state.session : null;

  const header = (
    <>
      <h1>{messages.title}</h1>
      {outcome === null ? null : (
        <p role="alert">{outcome === 'failed' ? messages.signInFailed : messages.signInUnavailable}</p>
      )}
      {state.status === 'checking' ? <p>{messages.checking}</p> : null}
      {state.status === 'unavailable' ? <p>{messages.unavailable}</p> : null}
    </>
  );

  if (session?.authenticated !== true) {
    return (
      <main>
        {header}
        {session === null ? null : (
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

  return (
    <ScopeProvider sessionTenantId={session.tenantId}>
      <ScopeBanner />
      <main>
        {header}
        <p>
          <span>{session.displayName ?? session.principalId ?? messages.signedIn}</span>{' '}
          <button
            type="button"
            disabled={signingOut}
            onClick={() => {
              onSignOut(session.csrfToken);
            }}
          >
            {messages.signOut}
          </button>
        </p>
        {signOutFailed ? <p role="alert">{messages.signOutFailed}</p> : null}
        <ScopeView session={session} />
      </main>
    </ScopeProvider>
  );
}
