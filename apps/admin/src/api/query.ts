import { QueryCache, QueryClient } from '@tanstack/react-query';

import { ApiError } from './client';

// Server state lives in TanStack Query and nowhere else (STD-GLB-FE-001 §Technology Stack). A failed
// read is retried, because a read is idempotent, but never a refusal: a 4xx answers the same the
// second time. Mutations are never retried (STD-GLB-FE-010 §3.4).
//
// A 401 that is not a step-up means the BFF ended the session, so the session is read again and the
// shell shows the operator signed out rather than a page of errors.
export const sessionQueryKey = ['session'] as const;
export const scopeQueryKey = ['scope'] as const;

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (error instanceof ApiError && error.status === 401 && !error.stepUp) {
          void client.invalidateQueries({ queryKey: sessionQueryKey });
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        retry: (failures, error) => !(error instanceof ApiError && error.isClientError) && failures < 2,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
  return client;
}
