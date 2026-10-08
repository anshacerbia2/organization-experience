import { createConnection, createServer, type Server, type Socket } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, testDatabaseUrl, type TestDatabase } from './support/database.js';
import {
  cookieValue,
  minutes,
  publicOrigin,
  sessionOf,
  signIn,
  startHarness,
  type Harness,
} from './support/harness.js';
import { defaultUser } from './support/identity-provider.js';

// TDD-identity-experience-001 §Session-Store Outage and §Server-Side Session: a session store that
// does not answer is an outage, answered 503 or with the sign-in page's `unavailable`, and a session
// that no longer opens under the session key is a signed-out one. Neither is a 500.

const sessionCookieName = '__Host-ident_session';
const loginCookieName = '__Host-ident_login';
const dependencyUnavailable = 'https://problems.scnehaux.com/dependency-unavailable';

// StoreLink stands between the BFF and PostgreSQL, so a test can cut the store off and bring it
// back: a refused connection and a dropped one, as a real outage gives the driver.
class StoreLink {
  readonly #target: { host: string; port: number };
  readonly #sockets = new Set<Socket>();
  #server: Server | null = null;
  port = 0;

  constructor(target: { host: string; port: number }) {
    this.#target = target;
  }

  async open(): Promise<void> {
    const server = createServer((inbound) => {
      const outbound = createConnection(this.#target);
      for (const socket of [inbound, outbound]) {
        this.#sockets.add(socket);
        socket.on('close', () => this.#sockets.delete(socket));
        socket.on('error', () => socket.destroy());
      }
      inbound.pipe(outbound).pipe(inbound);
    });
    await new Promise<void>((resolve) => server.listen(this.port, '127.0.0.1', resolve));
    const address = server.address();
    if (address !== null && typeof address === 'object') {
      this.port = address.port;
    }
    this.#server = server;
  }

  async cut(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    for (const socket of this.#sockets) {
      socket.destroy();
    }
    if (server !== null) {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  }
}

let database: TestDatabase;
let link: StoreLink;
let harness: Harness;

beforeAll(async () => {
  database = await createTestDatabase();
  const target = new URL(testDatabaseUrl);
  link = new StoreLink({ host: target.hostname, port: Number(target.port || '5432') });
  await link.open();
  const through = new URL(database.url);
  through.hostname = '127.0.0.1';
  through.port = String(link.port);
  harness = await startHarness({ databaseUrl: through.href });
}, 60_000);

afterAll(async () => {
  await harness.close();
  await link.cut();
  await database.drop();
});

// during runs work with the store cut off, and brings it back whatever happens.
async function during<T>(work: () => Promise<T>): Promise<T> {
  await link.cut();
  try {
    return await work();
  } finally {
    await link.open();
  }
}

const cookieCleared = (response: { cookies: { name: string; value: string }[] }): boolean =>
  response.cookies.some((cookie) => cookie.name === sessionCookieName && cookie.value === '');

async function csrfOf(session: string): Promise<string> {
  const view = await sessionOf(harness, session);
  if (view.csrfToken === undefined) {
    throw new Error('no CSRF token for a session expected to be live');
  }
  return view.csrfToken;
}

describe('a session store that does not answer', () => {
  it('answers an API call 503, reaches nothing upstream, and keeps the session for after', async () => {
    const { session } = await signIn(harness);
    const before = harness.upstream.received.length;
    const response = await during(() =>
      harness.app.inject({ method: 'GET', url: '/api/v1/x', cookies: { [sessionCookieName]: session } }),
    );
    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json<{ type: string }>().type).toBe(dependencyUnavailable);
    expect(cookieCleared(response)).toBe(false);
    expect(harness.upstream.received.length).toBe(before);

    const after = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/x',
      cookies: { [sessionCookieName]: session },
    });
    expect(after.statusCode).toBe(200);
  });

  it('answers a state-changing API call 503 too', async () => {
    const { session } = await signIn(harness);
    const csrf = await csrfOf(session);
    const response = await during(() =>
      harness.app.inject({
        method: 'POST',
        url: '/api/v1/x',
        headers: { origin: publicOrigin, 'x-csrf-token': csrf, 'content-type': 'application/json' },
        cookies: { [sessionCookieName]: session },
        payload: '{}',
      }),
    );
    expect(response.statusCode).toBe(503);
    expect(response.json<{ type: string }>().type).toBe(dependencyUnavailable);
  });

  it('answers the session read 503, not signed out', async () => {
    const { session } = await signIn(harness);
    const response = await during(() =>
      harness.app.inject({ method: 'GET', url: '/auth/session', cookies: { [sessionCookieName]: session } }),
    );
    expect(response.statusCode).toBe(503);
    expect(response.json<{ type: string }>().type).toBe(dependencyUnavailable);
    expect(cookieCleared(response)).toBe(false);
    expect((await sessionOf(harness, session)).authenticated).toBe(true);
  });

  it('lands a sign-in that cannot start where trying again is offered', async () => {
    const response = await during(() =>
      harness.app.inject({ method: 'GET', url: '/auth/login?return_to=/developer/x' }),
    );
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toMatch(/\?sign-in=unavailable$/);
    expect(cookieValue(response, loginCookieName)).toBeUndefined();
  });

  it('lands a callback that cannot be completed where trying again is offered', async () => {
    const login = await harness.app.inject({ method: 'GET', url: '/auth/login' });
    const binding = cookieValue(login, loginCookieName);
    const location = login.headers.location;
    if (binding === undefined || typeof location !== 'string') {
      throw new Error('login did not start');
    }
    const query = harness.provider.authorize(location, defaultUser);
    const response = await during(() =>
      harness.app.inject({
        method: 'GET',
        url: `/auth/callback${query}`,
        cookies: { [loginCookieName]: binding },
      }),
    );
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/?sign-in=unavailable');
    expect(cookieValue(response, sessionCookieName)).toBeUndefined();
  });

  it('answers a sign-out 503 and keeps the cookie, so it can be repeated', async () => {
    const { session } = await signIn(harness);
    const csrf = await csrfOf(session);
    const signOut = () =>
      harness.app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { origin: publicOrigin, 'x-csrf-token': csrf },
        cookies: { [sessionCookieName]: session },
      });
    const refused = await during(signOut);
    expect(refused.statusCode).toBe(503);
    expect(cookieCleared(refused)).toBe(false);

    const repeated = await signOut();
    expect(repeated.statusCode).toBe(204);
    expect((await sessionOf(harness, session)).authenticated).toBe(false);
  });

  it('answers a back-channel logout it could not record 400, as the specification requires', async () => {
    const { session } = await signIn(harness);
    const token = await harness.provider.logoutToken({
      sub: defaultUser.sub,
      sid: harness.provider.sessionOfLatest().sid,
    });
    const response = await during(() =>
      harness.app.inject({
        method: 'POST',
        url: '/auth/back-channel-logout',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `logout_token=${token}`,
      }),
    );
    expect(response.statusCode).toBe(400);
    // The session outlives the lost notice; the refresh path ends it (back-channel-logout-failure).
    expect((await sessionOf(harness, session)).authenticated).toBe(true);
  });
});

describe('a session that no longer opens under the session key', () => {
  let rotated: Harness;

  beforeAll(async () => {
    // The same store, served under another key, as after IDENTITY_EXPERIENCE_SESSION_KEY changes.
    rotated = await startHarness({
      databaseUrl: database.url,
      session: {
        idleMs: minutes(30),
        absoluteMs: minutes(8 * 60),
        refreshSkewMs: 30_000,
        key: Buffer.alloc(32, 9),
      },
    });
  }, 60_000);

  afterAll(async () => {
    await rotated.close();
  });

  it('is signed out: an API call answers 401 and clears the cookie, and reaches nothing', async () => {
    const { session } = await signIn(harness);
    const before = rotated.upstream.received.length;
    const response = await rotated.app.inject({
      method: 'GET',
      url: '/api/v1/x',
      cookies: { [sessionCookieName]: session },
    });
    expect(response.statusCode).toBe(401);
    expect(cookieCleared(response)).toBe(true);
    expect(rotated.upstream.received.length).toBe(before);
  });

  it('reads as not authenticated', async () => {
    const { session } = await signIn(harness);
    const response = await rotated.app.inject({
      method: 'GET',
      url: '/auth/session',
      cookies: { [sessionCookieName]: session },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ authenticated: false });
    expect(cookieCleared(response)).toBe(true);
  });

  it('answers a sign-out 401', async () => {
    const { session } = await signIn(harness);
    const response = await rotated.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { origin: publicOrigin, 'x-csrf-token': 'any' },
      cookies: { [sessionCookieName]: session },
    });
    expect(response.statusCode).toBe(401);
  });

  it('signs in again under the new key, with the old cookie still presented', async () => {
    const old = await signIn(harness);
    const login = await rotated.app.inject({ method: 'GET', url: '/auth/login' });
    const binding = cookieValue(login, loginCookieName);
    const location = login.headers.location;
    if (binding === undefined || typeof location !== 'string') {
      throw new Error('login did not start');
    }
    const callback = await rotated.app.inject({
      method: 'GET',
      url: `/auth/callback${rotated.provider.authorize(location, defaultUser)}`,
      cookies: { [loginCookieName]: binding, [sessionCookieName]: old.session },
    });
    const fresh = cookieValue(callback, sessionCookieName);
    expect(callback.statusCode).toBe(302);
    expect(fresh).toBeDefined();
    expect((await sessionOf(rotated, fresh ?? '')).authenticated).toBe(true);
  });

  it('refuses a sign-in started under the old key as one that cannot complete', async () => {
    const login = await harness.app.inject({ method: 'GET', url: '/auth/login' });
    const binding = cookieValue(login, loginCookieName);
    const location = login.headers.location;
    if (binding === undefined || typeof location !== 'string') {
      throw new Error('login did not start');
    }
    const callback = await rotated.app.inject({
      method: 'GET',
      url: `/auth/callback${harness.provider.authorize(location, defaultUser)}`,
      cookies: { [loginCookieName]: binding },
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/?sign-in=failed');
  });
});
