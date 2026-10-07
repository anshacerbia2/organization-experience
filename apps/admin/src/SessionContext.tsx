import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

import { sessionQueryKey } from './api/query';
import { fetchSession, type Session } from './session';

export type SignedIn = Extract<Session, { authenticated: true }>;

// useSessionQuery reads the display context. Reading it is not activity: the BFF does not extend the
// idle expiry for it.
export const useSessionQuery = () => useQuery({ queryKey: sessionQueryKey, queryFn: fetchSession });

const Context = createContext<SignedIn | null>(null);

// SignedInProvider gives the signed-in session, and its CSRF token, to every view under it.
export function SignedInProvider({
  session,
  children,
}: {
  readonly session: SignedIn;
  readonly children: ReactNode;
}): ReactElement {
  return <Context.Provider value={session}>{children}</Context.Provider>;
}

export function useSignedIn(): SignedIn {
  const session = useContext(Context);
  if (session === null) {
    throw new Error('useSignedIn is used outside a SignedInProvider');
  }
  return session;
}
