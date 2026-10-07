import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, type ReactElement, type ReactNode } from 'react';

import { scopeQueryKey } from './api/query';
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

const pendingWindow = (scope: Scope | undefined): boolean =>
  scope?.scope === 'provider' && scope.window?.state === 'pending';

export function ScopeProvider({
  sessionTenantId,
  children,
}: {
  // sessionTenantId is the Tenant /auth/session reported, which the scope must agree with.
  readonly sessionTenantId: string | null;
  readonly children: ReactNode;
}): ReactElement {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: scopeQueryKey,
    queryFn: fetchScope,
    // A window's state is read again on every view: it changes at the API, not here.
    staleTime: 0,
    refetchInterval: (current) => (pendingWindow(current.state.data) ? pendingPollMs : false),
  });
  const reload = useCallback(() => {
    void client.invalidateQueries({ queryKey: scopeQueryKey });
  }, [client]);

  let state: ScopeState;
  if (query.isPending) {
    state = { status: 'loading' };
  } else if (query.isError) {
    state = { status: 'unavailable' };
  } else {
    const scopeTenant = query.data.scope === 'tenant' ? query.data.tenantId : null;
    state =
      scopeTenant === sessionTenantId ? { status: 'ready', scope: query.data } : { status: 'ambiguous' };
  }

  // An open window is read again the moment it ends, so the scope changes on screen when it
  // changes at the BFF.
  const endsAt =
    state.status === 'ready' && state.scope.scope === 'provider' && state.scope.window?.state === 'in-force'
      ? state.scope.window.endsAt
      : null;
  useEffect(() => {
    if (endsAt === null) {
      return undefined;
    }
    const timer = setTimeout(reload, Math.max(0, Date.parse(endsAt) - Date.now()) + 500);
    return () => {
      clearTimeout(timer);
    };
  }, [endsAt, reload]);

  return <Context.Provider value={{ state, reload }}>{children}</Context.Provider>;
}

export function useScope(): ScopeContextValue {
  const value = useContext(Context);
  if (value === null) {
    throw new Error('useScope is used outside a ScopeProvider');
  }
  return value;
}

// useWindowInForce reports whether provider mode is open now: what the provider surfaces need.
export function useWindowInForce(): boolean {
  const { state } = useScope();
  return (
    state.status === 'ready' && state.scope.scope === 'provider' && state.scope.window?.state === 'in-force'
  );
}
