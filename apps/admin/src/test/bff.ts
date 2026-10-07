import { vi } from 'vitest';

// A stand-in BFF for the application's tests: the session, the scope, and whatever API answers a
// test needs. Each handler may answer a request; the first that does wins.

export const me = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4aaa';

export const session = (tenantId: string | null) => ({
  authenticated: true,
  principalId: me,
  displayName: 'Ada Admin',
  acr: 'aal2',
  authTime: new Date().toISOString(),
  tenantId,
  idleExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  absoluteExpiresAt: new Date(Date.now() + 8 * 3_600_000).toISOString(),
  csrfToken: 'csrf-token',
});

export const providerScope = (window: unknown) => ({
  scope: 'provider',
  acr: 'aal2',
  authTime: new Date().toISOString(),
  limits: { maxDurationMinutes: 60, defaultDurationMinutes: 15 },
  window,
});

export const inForce = {
  state: 'in-force',
  emergency: false,
  reason: 'Investigating a stuck offboarding',
  correlationId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4aff',
  tenants: 'all',
  durationMinutes: 15,
  requestedAt: new Date().toISOString(),
  endsAt: new Date(Date.now() + 15 * 60_000).toISOString(),
};

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

export type Handler = (url: string, init: RequestInit | undefined) => Response | undefined;

export function stub(...handlers: Handler[]) {
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    for (const handler of handlers) {
      const answer = handler(input, init);
      if (answer !== undefined) {
        return Promise.resolve(answer);
      }
    }
    return Promise.resolve(json({ detail: `unexpected ${input}` }, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const signedInto =
  (tenantId: string | null, scope: unknown): Handler =>
  (url) =>
    url === '/auth/session' ? json(session(tenantId)) : url === '/auth/scope' ? json(scope) : undefined;

export const sent = (fetchMock: ReturnType<typeof stub>, path: string) =>
  fetchMock.mock.calls.filter(([url]) => url === path).map(([, init]) => init);

export const headersOf = (init: RequestInit | undefined): Record<string, string> =>
  (init?.headers ?? {}) as Record<string, string>;

export const visit = (path: string): void => {
  window.history.replaceState(null, '', path);
};
