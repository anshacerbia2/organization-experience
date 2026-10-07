import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import { fetchScope, type Scope } from './scope';

// ScopeContext holds the active scope and gives it to every view (TDD-organization-experience-001
// §Component Design). It refuses an ambiguous state rather than guessing one: a session and a scope
// that disagree about the Tenant render no administration at all.

export type ScopeState =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ambiguous' }
  | { readonly status: 'ready'; readonly scope: Scope };

interface ScopeContextValue {
  readonly state: ScopeState;
  readonly reload: () => void;
}

const Context = createContext<ScopeContextValue | null>(null);

// How often a window awaiting approval is read again. The approver acts elsewhere, so the page only
// learns of the decision by asking.
const pendingPollMs = 10_000;

export function ScopeProvider({
  sessionTenantId,
  children,
}: {
  // sessionTenantId is the Tenant /auth/session reported, which the scope must agree with.
  readonly sessionTenantId: string | null;
  readonly children: ReactNode;
}): ReactElement {
  const [state, setState] = useState<ScopeState>({ status: 'loading' });
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => {
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    let current = true;
    fetchScope().then(
      (scope) => {
        if (!current) {
          return;
        }
        const scopeTenant = scope.scope === 'tenant' ? scope.tenantId : null;
        setState(scopeTenant === sessionTenantId ? { status: 'ready', scope } : { status: 'ambiguous' });
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
  }, [generation, sessionTenantId]);

  // A pending window is read again until it is decided; an open one is read again the moment it
  // ends, so the scope changes on screen when it changes at the BFF.
  const window = state.status === 'ready' && state.scope.scope === 'provider' ? state.scope.window : null;
  useEffect(() => {
    if (window === null) {
      return undefined;
    }
    const delay =
      window.state === 'pending' || window.endsAt === null
        ? pendingPollMs
        : Math.max(0, Date.parse(window.endsAt) - Date.now()) + 500;
    const timer = setTimeout(reload, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [window, reload]);

  return <Context.Provider value={{ state, reload }}>{children}</Context.Provider>;
}

export function useScope(): ScopeContextValue {
  const value = useContext(Context);
  if (value === null) {
    throw new Error('useScope is used outside a ScopeProvider');
  }
  return value;
}
