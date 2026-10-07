import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { testClientKey } from './support/client-key.js';
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
import { safeReturnTo, stepUpMaxAge, withActionOutcome } from '../src/auth/routes.js';
import { digest } from '../src/session/seal.js';

// TDD-identity-experience-001 §Testing Strategy, against a real PostgreSQL session store and a
// PS256-signing stand-in for the identity kernel.

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
}, 60_000);

afterAll(async () => {
  await harness.close();
});

beforeEach(() => {
  harness.provider.refreshBehaviour = 'rotate';
  harness.provider.codeExchangeUnavailable = false;
  harness.provider.tamper = null;
  harness.upstream.answer = {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: '{"ok":true}',
  };
});

const sessionCookie = (session: string): Record<string, string> => ({ '__Host-ident_session': session });

// mutate sends a state-changing request the way the application does: same origin, CSRF header.
async function mutate(
  session: string,
  url: string,
  overrides: { origin?: string | null; csrf?: string | null } = {},
) {
  const { csrfToken } = await sessionOf(harness, session);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const origin = overrides.origin === undefined ? publicOrigin : overrides.origin;
  const csrf = overrides.csrf === undefined ? csrfToken : overrides.csrf;
  if (origin !== null) {
    headers.origin = origin;
  }
  if (csrf !== null && csrf !== undefined) {
    headers['x-csrf-token'] = csrf;
  }
  return harness.app.inject({
    method: 'POST',
    url,
    headers,
    cookies: sessionCookie(session),
    payload: '{"display_name":"x"}',
  });
}

describe('sign-in', () => {
  it('uses PKCE S256 and sends state and nonce', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/auth/login' });
    expect(response.statusCode).toBe(302);
    const location = new URL(String(response.headers.location));
    expect(`${location.origin}${location.pathname}`).toBe(
      `${harness.provider.issuer}/protocol/openid-connect/auth`,
    );
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(location.searchParams.get('nonce')).toBeTruthy();
    expect(location.searchParams.get('scope')).toBe('openid scnehaux-provider scnehaux-profile');
    expect(location.searchParams.get('redirect_uri')).toBe(`${publicOrigin}/auth/callback`);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('creates a session and returns to where the user was going', async () => {
    const { session, callback } = await signIn(harness, { returnTo: '/registrations?page=2' });
    expect(callback.headers.location).toBe('/registrations?page=2');
    const view = await sessionOf(harness, session);
    expect(view).toMatchObject({
      authenticated: true,
      principalId: defaultUser.principalId,
      displayName: defaultUser.name,
    });
  });

  it('refuses a return address off this origin', () => {
    for (const hostile of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/auth/logout',
    ]) {
      expect(safeReturnTo(hostile, publicOrigin), hostile).toBe('/');
    }
    expect(safeReturnTo('/principals/prn_1#top', publicOrigin)).toBe('/principals/prn_1#top');
  });

  it('sets the session cookie HttpOnly, Secure, SameSite=Lax, __Host-, with no lifetime and no state', async () => {
    const { callback, session } = await signIn(harness);
    const cookie = callback.cookies.find((candidate) => candidate.name === '__Host-ident_session');
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
    expect(cookie?.domain).toBeUndefined();
    expect(cookie?.maxAge).toBeUndefined();
    expect(cookie?.expires).toBeUndefined();
    // 256 bits, base64url, and nothing else: no claim, no signature, no structure.
    expect(session).toMatch(/^[\w-]{43}$/);
  });

  it('issues a new session identifier at sign-in and ends one planted before it', async () => {
    const planted = (await signIn(harness)).session;
    const login = await harness.app.inject({ method: 'GET', url: '/auth/login' });
    const query = harness.provider.authorize(String(login.headers.location));
    const callback = await harness.app.inject({
      method: 'GET',
      url: `/auth/callback${query}`,
      cookies: {
        '__Host-ident_login': cookieValue(login, '__Host-ident_login') ?? '',
        ...sessionCookie(planted),
      },
    });
    const fresh = cookieValue(callback, '__Host-ident_session');
    expect(fresh).toBeDefined();
    expect(fresh).not.toBe(planted);
    expect((await sessionOf(harness, planted)).authenticated).toBe(false);
  });

  describe('refuses', () => {
    async function callbackWith(
      mutateQuery: (query: URLSearchParams) => void,
      loginCookie?: string,
      loginUrl = '/auth/login',
    ) {
      const login = await harness.app.inject({ method: 'GET', url: loginUrl });
      const query = new URLSearchParams(harness.provider.authorize(String(login.headers.location)));
      mutateQuery(query);
      const binding = loginCookie ?? cookieValue(login, '__Host-ident_login') ?? '';
      return harness.app.inject({
        method: 'GET',
        url: `/auth/callback?${query.toString()}`,
        cookies: binding === '' ? {} : { '__Host-ident_login': binding },
      });
    }

    const refused = (response: Awaited<ReturnType<typeof callbackWith>>): void => {
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/?sign-in=failed');
      expect(cookieValue(response, '__Host-ident_session')).toBeUndefined();
    };

    // Not a refusal: the kernel did not answer, so the user is told to try again, and the log says
    // outage rather than refused.
    it('nothing, and says so differently, when the kernel is unavailable at the code exchange', async () => {
      harness.provider.codeExchangeUnavailable = true;
      const response = await callbackWith(() => undefined);
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/?sign-in=unavailable');
      expect(cookieValue(response, '__Host-ident_session')).toBeUndefined();
    });

    // The notice is shown at the root of the application the sign-in started from. There is one
    // application, so a sign-in started from any page, one under /developer/ included, lands at the root.
    it('and lands at the root of the one application, wherever the sign-in started', async () => {
      const fromConsole = `/auth/login?return_to=${encodeURIComponent('/developer/?tab=keys')}`;
      const forged = await callbackWith(
        (query) => {
          query.set('state', 'forged');
        },
        undefined,
        fromConsole,
      );
      expect(forged.headers.location).toBe('/?sign-in=failed');

      harness.provider.codeExchangeUnavailable = true;
      const unavailable = await callbackWith(() => undefined, undefined, fromConsole);
      expect(unavailable.headers.location).toBe('/?sign-in=unavailable');
      harness.provider.codeExchangeUnavailable = false;

      // No record of it in this browser: nothing says where it started.
      const unbound = await callbackWith(() => undefined, 'not-a-binding', fromConsole);
      expect(unbound.headers.location).toBe('/?sign-in=failed');
    });

    it('a mismatched state', async () => {
      refused(
        await callbackWith((query) => {
          query.set('state', 'forged');
        }),
      );
    });

    it('a callback in a browser that did not start the sign-in', async () => {
      refused(await callbackWith(() => undefined, 'another-browsers-binding'));
      refused(await callbackWith(() => undefined, ''));
    });

    it('an authorization response from another issuer', async () => {
      refused(
        await callbackWith((query) => {
          query.set('iss', 'https://evil.example/realms/test');
        }),
      );
    });

    it('a replayed callback', async () => {
      const login = await harness.app.inject({ method: 'GET', url: '/auth/login' });
      const query = harness.provider.authorize(String(login.headers.location));
      const cookies = { '__Host-ident_login': cookieValue(login, '__Host-ident_login') ?? '' };
      const first = await harness.app.inject({ method: 'GET', url: `/auth/callback${query}`, cookies });
      expect(cookieValue(first, '__Host-ident_session')).toBeDefined();
      refused(await harness.app.inject({ method: 'GET', url: `/auth/callback${query}`, cookies }));
    });

    it('an expired sign-in', async () => {
      const login = await harness.app.inject({ method: 'GET', url: '/auth/login' });
      const query = harness.provider.authorize(String(login.headers.location));
      harness.clock.advance(minutes(11));
      try {
        refused(
          await harness.app.inject({
            method: 'GET',
            url: `/auth/callback${query}`,
            cookies: { '__Host-ident_login': cookieValue(login, '__Host-ident_login') ?? '' },
          }),
        );
      } finally {
        harness.clock.advance(-minutes(11));
      }
    });

    // A step-up asked for an authentication within max_age; an ID token whose auth_time is older
    // does not satisfy it (OpenID Connect Core §3.1.2.1, TDD-identity-experience-001 §Step-Up).
    it('a step-up whose authentication is older than its max_age', async () => {
      harness.provider.tamper = { claims: { auth_time: Math.floor(Date.now() / 1000) - 600 } };
      refused(await callbackWith(() => undefined, undefined, '/auth/login?max_age=60'));
    });

    for (const [name, tamper] of [
      ['a mismatched nonce', { claims: { nonce: 'forged' } }],
      ['a wrong issuer', { claims: { iss: 'https://evil.example/realms/test' } }],
      ['a wrong audience', { claims: { aud: 'another-client' } }],
      ['an expired ID token', { claims: { exp: Math.floor(Date.now() / 1000) - 600 } }],
      ['a signature by a key the realm does not publish', { signer: 'foreign' }],
      ['an RS256 signature', { signer: 'rs256' }],
    ] as const) {
      it(`an ID token with ${name}`, async () => {
        harness.provider.tamper = tamper;
        refused(await callbackWith(() => undefined));
      });
    }
  });
});

describe('step-up', () => {
  it('sends max_age, and signs in when the authentication is recent', async () => {
    const login = await harness.app.inject({
      method: 'GET',
      url: '/auth/login?max_age=300&return_to=/principals',
    });
    expect(new URL(String(login.headers.location)).searchParams.get('max_age')).toBe('300');
    const { callback } = await signIn(harness, { returnTo: '/principals' });
    expect(callback.headers.location).toBe('/principals');
  });

  it('ignores a malformed max_age and signs in as usual', async () => {
    for (const value of ['-1', '1.5', 'abc', '86401', '999999']) {
      const login = await harness.app.inject({ method: 'GET', url: `/auth/login?max_age=${value}` });
      expect(new URL(String(login.headers.location)).searchParams.has('max_age')).toBe(false);
    }
    expect(stepUpMaxAge('0')).toBe(0);
    expect(stepUpMaxAge('86400')).toBe(86_400);
    expect(stepUpMaxAge(undefined)).toBeNull();
  });

  // One application, at the root: every sign-in returns to it, so every one asks for aal2.
  it('signs the application in at aal2 wherever the sign-in returns to', async () => {
    const level = async (url: string) =>
      new URL(String((await harness.app.inject({ method: 'GET', url })).headers.location)).searchParams.get(
        'acr_values',
      );
    expect(await level('/auth/login?return_to=/principals')).toBe('aal2');
    expect(await level('/auth/login')).toBe('aal2');
    expect(await level('/auth/login?return_to=/developer/')).toBe('aal2');
    expect(await level('/auth/login?return_to=/account/')).toBe('aal2');
    expect(await level('/auth/login?return_to=/account/&acr_values=aal2')).toBe('aal2');
    expect(await level('/auth/login?return_to=/account/&acr_values=phr')).toBe('aal2');
  });

  it('refuses a callback whose acr is below the level asked for', async () => {
    harness.provider.tamper = { claims: { acr: 'aal1' } };
    const { login } = await (async () => {
      const response = await harness.app.inject({ method: 'GET', url: '/auth/login?return_to=/principals' });
      return { login: response };
    })();
    const query = harness.provider.authorize(String(login.headers.location));
    const callback = await harness.app.inject({
      method: 'GET',
      url: `/auth/callback${query}`,
      cookies: { '__Host-ident_login': cookieValue(login, '__Host-ident_login') ?? '' },
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe('/?sign-in=failed');
    expect(cookieValue(callback, '__Host-ident_session')).toBeUndefined();
  });

  it('passes an allowlisted kernel action, and no other', async () => {
    const action = async (value: string) =>
      new URL(
        String(
          (
            await harness.app.inject({
              method: 'GET',
              url: `/auth/login?return_to=/account/&kc_action=${value}`,
            })
          ).headers.location,
        ),
      ).searchParams.get('kc_action');
    expect(await action('CONFIGURE_TOTP')).toBe('CONFIGURE_TOTP');
    expect(await action('webauthn-register')).toBe('webauthn-register');
    expect(await action('webauthn-register-passwordless')).toBeNull();
    expect(await action('CONFIGURE_RECOVERY_AUTHN_CODES')).toBe('CONFIGURE_RECOVERY_AUTHN_CODES');
    expect(await action('UPDATE_PASSWORD')).toBeNull();
    expect(await action('delete_account')).toBeNull();
  });

  it('carries the action outcome back, and nothing else', async () => {
    expect(withActionOutcome('/account/', 'success')).toBe('/account/?kc_action_status=success');
    expect(withActionOutcome('/account/?x=1', 'cancelled')).toBe('/account/?x=1&kc_action_status=cancelled');
    expect(withActionOutcome('/account/', 'error')).toBe('/account/');
    expect(withActionOutcome('/account/', null)).toBe('/account/');

    const login = await harness.app.inject({
      method: 'GET',
      url: '/auth/login?return_to=/account/&kc_action=CONFIGURE_TOTP',
    });
    const query = harness.provider.authorize(String(login.headers.location));
    const callback = await harness.app.inject({
      method: 'GET',
      url: `/auth/callback${query}&kc_action_status=success`,
      cookies: { '__Host-ident_login': cookieValue(login, '__Host-ident_login') ?? '' },
    });
    expect(callback.headers.location).toBe('/account/?kc_action_status=success');
  });

  it('a step-up challenge from the API keeps the session and reaches the browser', async () => {
    const { session } = await signIn(harness);
    const challenge = 'Bearer error="insufficient_user_authentication", max_age=300';
    harness.upstream.answer = {
      status: 401,
      headers: { 'content-type': 'application/problem+json', 'www-authenticate': challenge },
      body: '{"type":"https://problems.scnehaux.com/authentication-required","status":401}',
    };
    const response = await mutate(session, '/api/v1/principals/p1:suspend');
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe(challenge);
    expect(response.headers['content-type']).toBe('application/problem+json');
    expect((await sessionOf(harness, session)).authenticated).toBe(true);
  });
});

describe('token containment', () => {
  // The BFF authenticates with its own key (private_key_jwt), so the stand-in kernel refuses any
  // request that carries a secret or a replayed assertion. A completed sign-in and logout therefore
  // prove both calls were signed, each with an assertion of its own.
  it('authenticates the code exchange and the logout with a fresh signed assertion each', async () => {
    const before = harness.provider.assertionIds.size;
    const { session } = await signIn(harness);
    const logout = await mutate(session, '/auth/logout');
    expect(logout.statusCode).toBe(204);
    expect(harness.provider.assertionIds.size - before).toBe(2);
  });

  it('no response carries a token or the client private key', async () => {
    const { session, login, callback } = await signIn(harness);
    const responses = [
      login,
      callback,
      await harness.app.inject({ method: 'GET', url: '/auth/session', cookies: sessionCookie(session) }),
      await harness.app.inject({
        method: 'GET',
        url: '/api/v1/registrations',
        cookies: sessionCookie(session),
      }),
      await mutate(session, '/api/v1/registrations'),
      await mutate(session, '/auth/logout'),
    ];
    // The private key's own members, as they would appear in a JWK or a PEM that leaked.
    const privateJwk = testClientKey().key.privateKey.export({ format: 'jwk' });
    const pemBody = testClientKey()
      .pem.split('\n')
      .filter((line) => line !== '' && !line.startsWith('-----'))
      .slice(1, 3);
    const secrets = [...harness.provider.issuedSecrets, String(privateJwk.d), ...pemBody];
    for (const response of responses) {
      const surface = `${JSON.stringify(response.headers)}\n${response.body}`;
      for (const secret of secrets) {
        expect(surface.includes(secret)).toBe(false);
      }
    }
  });

  it('the session store holds the tokens sealed and no cookie value', async () => {
    const { session } = await signIn(harness);
    const { rows } = await harness.database.pool.query<{ id_hash: Buffer; tokens: Buffer }>(
      'SELECT id_hash, tokens FROM sessions WHERE id_hash = $1',
      [digest(session)],
    );
    expect(rows).toHaveLength(1);
    const stored = rows
      .map((row) => `${row.id_hash.toString('latin1')}${row.tokens.toString('latin1')}`)
      .join('');
    for (const secret of [...harness.provider.issuedSecrets, session]) {
      expect(stored.includes(secret)).toBe(false);
    }
  });
});

describe('cross-site request forgery', () => {
  it('passes a same-origin request with the token', async () => {
    const { session } = await signIn(harness);
    expect((await mutate(session, '/api/v1/registrations')).statusCode).toBe(200);
  });

  it('refuses a foreign Origin', async () => {
    const { session } = await signIn(harness);
    const response = await mutate(session, '/api/v1/registrations', { origin: 'https://evil.example' });
    expect(response.statusCode).toBe(403);
  });

  it('refuses a missing Origin', async () => {
    const { session } = await signIn(harness);
    expect((await mutate(session, '/api/v1/registrations', { origin: null })).statusCode).toBe(403);
  });

  it('refuses a missing or wrong token', async () => {
    const { session } = await signIn(harness);
    expect((await mutate(session, '/api/v1/registrations', { csrf: null })).statusCode).toBe(403);
    expect((await mutate(session, '/api/v1/registrations', { csrf: 'guess' })).statusCode).toBe(403);
    // Another session's token is not this one's.
    const other = await sessionOf(harness, (await signIn(harness)).session);
    expect((await mutate(session, '/api/v1/registrations', { csrf: other.csrfToken ?? '' })).statusCode).toBe(
      403,
    );
  });

  it('refuses a cross-site form post carrying the session cookie', async () => {
    const { session } = await signIn(harness);
    const before = harness.upstream.received.length;
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/registrations',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' },
      cookies: sessionCookie(session),
      payload: 'display_name=x',
    });
    expect(response.statusCode).toBe(403);
    expect(harness.upstream.received.length).toBe(before);
  });

  it('guards sign-out too', async () => {
    const { session } = await signIn(harness);
    expect((await mutate(session, '/auth/logout', { csrf: null })).statusCode).toBe(403);
    expect((await sessionOf(harness, session)).authenticated).toBe(true);
  });
});

describe('the API proxy', () => {
  it('attaches the session access token and forwards only allowed headers', async () => {
    const { session } = await signIn(harness);
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/principals/prn_1?view=full',
      headers: {
        authorization: 'Bearer caller-supplied',
        'x-forwarded-for': '10.0.0.1',
        accept: 'application/json',
      },
      cookies: sessionCookie(session),
    });
    expect(response.statusCode).toBe(200);
    const received = harness.upstream.last();
    expect(received.url).toBe('/v1/principals/prn_1?view=full');
    expect(received.headers.authorization).toMatch(/^Bearer ey/);
    expect(received.headers.authorization).not.toContain('caller-supplied');
    expect(harness.provider.issuedSecrets.has(String(received.headers.authorization).slice(7))).toBe(true);
    expect(received.headers.cookie).toBeUndefined();
    expect(received.headers['x-forwarded-for']).toBeUndefined();
  });

  it('passes a mutation body and its idempotency key through', async () => {
    const { session } = await signIn(harness);
    const { csrfToken } = await sessionOf(harness, session);
    await harness.app.inject({
      method: 'POST',
      url: '/api/v1/registrations',
      headers: {
        origin: publicOrigin,
        'x-csrf-token': csrfToken ?? '',
        'content-type': 'application/json',
        'idempotency-key': 'key-1',
      },
      cookies: sessionCookie(session),
      payload: '{"display_name":"Acme"}',
    });
    const received = harness.upstream.last();
    expect(received.method).toBe('POST');
    expect(received.body).toBe('{"display_name":"Acme"}');
    expect(received.headers['idempotency-key']).toBe('key-1');
    expect(received.headers['x-csrf-token']).toBeUndefined();
  });

  it('never returns an upstream cookie', async () => {
    const { session } = await signIn(harness);
    harness.upstream.answer = { status: 200, headers: { 'set-cookie': 'planted=1; Path=/' }, body: '{}' };
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/x',
      cookies: sessionCookie(session),
    });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('answers 401 without a session, and never reaches the upstream', async () => {
    const before = harness.upstream.received.length;
    const response = await harness.app.inject({ method: 'GET', url: '/api/v1/registrations' });
    expect(response.statusCode).toBe(401);
    expect(response.json<{ type: string }>().type).toBe(
      'https://problems.scnehaux.com/authentication-required',
    );
    expect(harness.upstream.received.length).toBe(before);
  });
});

describe('refresh', () => {
  it('refreshes server-side ahead of expiry, invisibly', async () => {
    const { session } = await signIn(harness);
    const calls = harness.provider.refreshCalls;
    harness.clock.advance((harness.provider.accessTokenLifetimeSeconds - 20) * 1000);
    try {
      const response = await harness.app.inject({
        method: 'GET',
        url: '/api/v1/x',
        cookies: sessionCookie(session),
      });
      expect(response.statusCode).toBe(200);
      expect(harness.provider.refreshCalls).toBe(calls + 1);
      expect(response.headers['set-cookie']).toBeUndefined();
    } finally {
      harness.clock.advance(-(harness.provider.accessTokenLifetimeSeconds - 20) * 1000);
    }
  });

  it('refreshes once when concurrent requests find the token near expiry', async () => {
    const { session } = await signIn(harness);
    const calls = harness.provider.refreshCalls;
    harness.provider.refreshDelayMs = 200;
    harness.clock.advance((harness.provider.accessTokenLifetimeSeconds - 20) * 1000);
    try {
      const responses = await Promise.all(
        [1, 2, 3].map(() =>
          harness.app.inject({ method: 'GET', url: '/api/v1/x', cookies: sessionCookie(session) }),
        ),
      );
      // With rotation, a second refresh would present a spent token and end the session.
      expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200]);
      expect(harness.provider.refreshCalls).toBe(calls + 1);
    } finally {
      harness.provider.refreshDelayMs = 0;
      harness.clock.advance(-(harness.provider.accessTokenLifetimeSeconds - 20) * 1000);
    }
  });

  it('destroys the session when the identity kernel refuses the refresh', async () => {
    const { session } = await signIn(harness);
    harness.provider.refreshBehaviour = 'invalid_grant';
    harness.clock.advance(harness.provider.accessTokenLifetimeSeconds * 1000);
    try {
      const response = await harness.app.inject({
        method: 'GET',
        url: '/api/v1/x',
        cookies: sessionCookie(session),
      });
      expect(response.statusCode).toBe(401);
      expect(cookieValue(response, '__Host-ident_session')).toBe('');
      expect((await sessionOf(harness, session)).authenticated).toBe(false);
    } finally {
      harness.clock.advance(-harness.provider.accessTokenLifetimeSeconds * 1000);
    }
  });

  it('keeps the session through an identity kernel outage', async () => {
    const { session } = await signIn(harness);
    harness.provider.refreshBehaviour = 'unavailable';
    harness.clock.advance(harness.provider.accessTokenLifetimeSeconds * 1000);
    try {
      const response = await harness.app.inject({
        method: 'GET',
        url: '/api/v1/x',
        cookies: sessionCookie(session),
      });
      expect(response.statusCode).toBe(503);
      expect((await sessionOf(harness, session)).authenticated).toBe(true);
    } finally {
      harness.clock.advance(-harness.provider.accessTokenLifetimeSeconds * 1000);
    }
  });
});

describe('revocation', () => {
  it('a 401 from the Identity Control API destroys the session', async () => {
    const { session } = await signIn(harness);
    harness.upstream.answer = {
      status: 401,
      body: '{"type":"https://problems.scnehaux.com/authentication-required"}',
    };
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/x',
      cookies: sessionCookie(session),
    });
    expect(response.statusCode).toBe(401);
    expect((await sessionOf(harness, session)).authenticated).toBe(false);
  });

  it('back-channel logout destroys the matching session and no other', async () => {
    const first = await signIn(harness);
    const firstSid = harness.provider.sessionOfLatest().sid;
    const second = await signIn(harness);
    const token = await harness.provider.logoutToken({ sub: defaultUser.sub, sid: firstSid });
    const response = await harness.app.inject({
      method: 'POST',
      url: '/auth/back-channel-logout',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `logout_token=${token}`,
    });
    expect(response.statusCode).toBe(200);
    expect((await sessionOf(harness, first.session)).authenticated).toBe(false);
    expect((await sessionOf(harness, second.session)).authenticated).toBe(true);
  });

  for (const [name, claims, signer] of [
    ['a foreign signature', {}, 'foreign'],
    ['no logout event', { events: {} }, 'realm'],
    ['a nonce', { nonce: 'n' }, 'realm'],
    ['another audience', { aud: 'another-client' }, 'realm'],
    ['a stale iat', { iat: Math.floor(Date.now() / 1000) - 600 }, 'realm'],
  ] as const) {
    it(`back-channel logout refuses a token with ${name}`, async () => {
      const { session } = await signIn(harness);
      const token = await harness.provider.logoutToken(
        { sub: defaultUser.sub, sid: harness.provider.sessionOfLatest().sid, ...claims },
        signer,
      );
      const response = await harness.app.inject({
        method: 'POST',
        url: '/auth/back-channel-logout',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: `logout_token=${token}`,
      });
      expect(response.statusCode).toBe(400);
      expect((await sessionOf(harness, session)).authenticated).toBe(true);
    });
  }
});

describe('session lifetime', () => {
  it('ends a session idle beyond SESSION_IDLE', async () => {
    const { session } = await signIn(harness);
    harness.clock.advance(minutes(31));
    try {
      expect((await sessionOf(harness, session)).authenticated).toBe(false);
    } finally {
      harness.clock.advance(-minutes(31));
    }
  });

  it('ends a continuously active session at SESSION_ABSOLUTE', async () => {
    const { session } = await signIn(harness);
    let elapsed = 0;
    try {
      // Active every 20 minutes, so never idle; refused once eight hours have passed.
      while (elapsed < minutes(8 * 60 - 20)) {
        harness.clock.advance(minutes(20));
        elapsed += minutes(20);
        const response = await harness.app.inject({
          method: 'GET',
          url: '/api/v1/x',
          cookies: sessionCookie(session),
        });
        expect(response.statusCode, `after ${elapsed / 60_000} minutes`).toBe(200);
      }
      harness.clock.advance(minutes(21));
      elapsed += minutes(21);
      const response = await harness.app.inject({
        method: 'GET',
        url: '/api/v1/x',
        cookies: sessionCookie(session),
      });
      expect(response.statusCode).toBe(401);
    } finally {
      harness.clock.advance(-elapsed);
    }
  });

  it('reading the session is not activity', async () => {
    const { session } = await signIn(harness);
    let elapsed = 0;
    try {
      for (const step of [minutes(20), minutes(11)]) {
        harness.clock.advance(step);
        elapsed += step;
        await sessionOf(harness, session);
      }
      expect((await sessionOf(harness, session)).authenticated).toBe(false);
    } finally {
      harness.clock.advance(-elapsed);
    }
  });
});

describe('sign-out', () => {
  it('ends the BFF session and the identity kernel’s, server-side', async () => {
    const { session } = await signIn(harness);
    const { sid } = harness.provider.sessionOfLatest();
    const response = await mutate(session, '/auth/logout');
    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(cookieValue(response, '__Host-ident_session')).toBe('');
    expect((await sessionOf(harness, session)).authenticated).toBe(false);
    expect(harness.provider.endedSessions.has(sid)).toBe(true);
  });
});
