import { useEffect, useState, type ReactElement } from 'react';

import { messages } from './messages';
import { fetchSession, signInHref, signInOutcome, signOut, type Session } from './session';

type SessionState =
  | { readonly status: 'checking' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly session: Session };

// here is the path a sign-in returns to: where the browser is, on this origin.
const here = (): string => `${window.location.pathname}${window.location.search}${window.location.hash}`;

// App states whether the operator is signed in and offers the one action that applies: sign in, or
// sign out. It makes no authorization decision; the Organization Control API reauthorizes every
// command.
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

  return (
    <main>
      <h1>{messages.title}</h1>
      {outcome === null ? null : (
        <p role="alert">{outcome === 'failed' ? messages.signInFailed : messages.signInUnavailable}</p>
      )}
      {state.status === 'checking' ? <p>{messages.checking}</p> : null}
      {state.status === 'unavailable' ? <p>{messages.unavailable}</p> : null}
      {session !== null && !session.authenticated ? (
        <p>
          <span>{messages.signedOut}</span> <a href={signInHref(here())}>{messages.signIn}</a>
        </p>
      ) : null}
      {session?.authenticated === true ? (
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
      ) : null}
      {signOutFailed ? <p role="alert">{messages.signOutFailed}</p> : null}
    </main>
  );
}
