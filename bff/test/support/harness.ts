import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

import { testClientKey } from './client-key.js';
import { createTestDatabase, type TestDatabase } from './database.js';
import { defaultUser, IdentityProvider, type User } from './identity-provider.js';
import { Upstream } from './upstream.js';
import type { Config } from '../../src/config.js';
import { buildServer } from '../../src/server.js';

// The injector sends Host: localhost:80, and the BFF answers only on its public origin's host, so the
// tests' origin is that host. Nothing here depends on the scheme: the cookie attributes are asserted
// as set, not as a browser would enforce them.
export const publicOrigin = 'http://localhost';

export const sessionKey = Buffer.alloc(32, 7);

// A moving clock: sessions expire by it, so a test reaches the idle and absolute expiries without
// waiting for them.
export class Clock {
  #offsetMs = 0;
  readonly now = (): Date => new Date(Date.now() + this.#offsetMs);
  advance(ms: number): void {
    this.#offsetMs += ms;
  }
}

export interface Harness {
  readonly app: FastifyInstance;
  readonly provider: IdentityProvider;
  readonly upstream: Upstream;
  readonly database: TestDatabase;
  readonly clock: Clock;
  close(): Promise<void>;
}

export const minutes = (count: number): number => count * 60_000;

// webRoot builds a stand-in application: an index.html titled `title`, and one hashed asset.
export function webRoot(title = 'shell'): string {
  const root = mkdtempSync(path.join(tmpdir(), 'bff-web-'));
  mkdirSync(path.join(root, 'assets'));
  writeFileSync(path.join(root, 'index.html'), `<!doctype html><title>${title}</title>`);
  writeFileSync(path.join(root, 'assets', 'app-3f9a.js'), 'export {};');
  return root;
}

export function testConfig(overrides: Partial<Config> & Pick<Config, 'oidc' | 'databaseUrl'>): Config {
  return {
    listenHost: '127.0.0.1',
    listenPort: 8080,
    webRoot: webRoot(),
    publicOrigin,
    logLevel: 'fatal',
    session: { idleMs: minutes(30), absoluteMs: minutes(8 * 60), refreshSkewMs: 30_000, key: sessionKey },
    organizationControlBaseUrl: 'http://127.0.0.1:9',
    upstreamTimeoutMs: 5_000,
    tenantSignIn: false,
    provider: { maxDurationMs: minutes(60), defaultDurationMs: minutes(15), stepUpAgeMs: minutes(5) },
    ...overrides,
  };
}

export async function startHarness(overrides: Partial<Config> = {}): Promise<Harness> {
  const provider = new IdentityProvider();
  const upstream = new Upstream();
  await Promise.all([provider.start(), upstream.start()]);
  const database = await createTestDatabase();
  const clock = new Clock();
  const app = await buildServer(
    testConfig({
      oidc: {
        issuer: provider.issuer,
        internalBaseUrl: provider.issuer,
        clientId: provider.clientId,
        clientKey: testClientKey().key,
        redirectUri: `${publicOrigin}/auth/callback`,
      },
      organizationControlBaseUrl: upstream.baseUrl,
      databaseUrl: database.url,
      ...overrides,
    }),
    { now: clock.now },
  );
  return {
    app,
    provider,
    upstream,
    database,
    clock,
    async close() {
      await app.close();
      await Promise.all([provider.stop(), upstream.stop(), database.drop()]);
    },
  };
}

export const cookieValue = (response: LightMyRequestResponse, name: string): string | undefined =>
  response.cookies.find((cookie) => cookie.name === name)?.value;

// signIn runs the whole authorization code flow the way a browser would, and returns the session
// cookie and the responses along the way.
export async function signIn(
  harness: Harness,
  options: { user?: User; returnTo?: string; tenant?: string; query?: Record<string, string> } = {},
): Promise<{ session: string; login: LightMyRequestResponse; callback: LightMyRequestResponse }> {
  const params = new URLSearchParams(options.query);
  if (options.returnTo !== undefined) {
    params.set('return_to', options.returnTo);
  }
  if (options.tenant !== undefined) {
    params.set('tenant', options.tenant);
  }
  const login = await harness.app.inject({
    method: 'GET',
    url: `/auth/login${params.size === 0 ? '' : `?${params.toString()}`}`,
  });
  const binding = cookieValue(login, '__Host-ident_login');
  const location = login.headers.location;
  if (binding === undefined || typeof location !== 'string') {
    throw new Error(`login did not start: ${login.statusCode}`);
  }
  const query = harness.provider.authorize(location, options.user ?? defaultUser);
  const callback = await harness.app.inject({
    method: 'GET',
    url: `/auth/callback${query}`,
    cookies: { '__Host-ident_login': binding },
  });
  const session = cookieValue(callback, '__Host-ident_session');
  if (session === undefined) {
    throw new Error(`callback did not sign in: ${callback.statusCode} ${String(callback.headers.location)}`);
  }
  return { session, login, callback };
}

export interface SessionView {
  readonly authenticated: boolean;
  readonly csrfToken?: string;
  readonly principalId?: string;
  readonly displayName?: string;
  readonly tenantId?: string | null;
}

export async function sessionOf(harness: Harness, session: string): Promise<SessionView> {
  const response = await harness.app.inject({
    method: 'GET',
    url: '/auth/session',
    cookies: { '__Host-ident_session': session },
  });
  return response.json<SessionView>();
}
