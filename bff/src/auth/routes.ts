import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as client from 'openid-client';

import { meets, requestedLevel } from './levels.js';
import { IdentityProviderUnavailable, OidcError, type Oidc } from './oidc.js';
import { applicationRoot } from '../http/applications.js';
import { authenticate } from '../http/authenticate.js';
import {
  clearLoginCookie,
  clearSessionCookie,
  loginCookie,
  loginLifetimeSeconds,
  readCookie,
  sessionCookie,
  setLoginCookie,
  setSessionCookie,
} from '../http/cookies.js';
import { sendProblem } from '../http/problem.js';
import { digest, equalSecrets, randomToken } from '../session/seal.js';
import type { Sessions } from '../session/sessions.js';
import { SessionStoreUnavailable, type SessionStore } from '../session/store.js';

export interface AuthRoutesOptions {
  readonly publicOrigin: string;
  readonly oidc: Oidc;
  readonly sessions: Sessions;
  readonly store: SessionStore;
  readonly now: () => Date;
  // tenantSignIn lets a sign-in ask for one Tenant with ?tenant= (ADR-IAM-008). An application whose
  // client is registered for one form leaves it off, and a sign-in naming a Tenant is refused.
  readonly tenantSignIn: boolean;
}

// Where a sign-in that did not complete lands: the root of the application it started from, with
// a marker. `failed` is a refusal; the application offers to try again, and the reason stays in
// the log, because it may describe what an attacker presented. `unavailable` is an identity kernel
// or a session store that did not answer, where trying again can work, so the application says so.
// Before the browser's own sign-in record is found, nothing says where it started, and it lands at
// the root.
export const signInLanding = (returnTo: string, outcome: 'failed' | 'unavailable'): string =>
  `${applicationRoot(returnTo)}?sign-in=${outcome}`;

const logoutTokenLimit = 16 * 1024;

// safeReturnTo accepts a path on this origin and nothing else, so /auth/login cannot be made into
// an open redirect. Anything else, and anything under /auth, returns to the root.
export function safeReturnTo(value: unknown, publicOrigin: string): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/';
  }
  try {
    const url = new URL(value, publicOrigin);
    if (url.origin !== publicOrigin || url.pathname === '/auth' || url.pathname.startsWith('/auth/')) {
      return '/';
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

const noStore = (reply: FastifyReply): FastifyReply => reply.header('cache-control', 'no-store');

// storeOutage answers a request the session store could not serve: 503, the session kept, and the
// browser's cookie left alone, so trying again works once the store answers (RFC 9110 §15.6.4,
// TDD-identity-experience-001 §Session-Store Outage). Anything else is rethrown.
function storeOutage(request: FastifyRequest, reply: FastifyReply, error: unknown): FastifyReply {
  if (!(error instanceof SessionStoreUnavailable)) {
    throw error;
  }
  request.log.error({ err: error }, 'session store unavailable');
  return sendProblem(request, reply, 'dependencyUnavailable');
}

// The application-initiated actions the BFF passes to the kernel, and the outcomes it carries back
// (TDD-identity-experience-001 §Step-Up). Anything else is ignored.
const kernelActions = new Set(['CONFIGURE_TOTP', 'webauthn-register', 'CONFIGURE_RECOVERY_AUTHN_CODES']);
const actionOutcomes = new Set(['success', 'cancelled']);

export const kernelAction = (value: unknown): string | null =>
  typeof value === 'string' && kernelActions.has(value) ? value : null;

// withActionOutcome carries an allowlisted kc_action_status onto the address a sign-in returns to.
export function withActionOutcome(returnTo: string, outcome: string | null): string {
  if (outcome === null || !actionOutcomes.has(outcome)) {
    return returnTo;
  }
  const url = new URL(returnTo, 'http://bff.invalid');
  url.searchParams.set('kc_action_status', outcome);
  return `${url.pathname}${url.search}${url.hash}`;
}

// stepUpMaxAge reads a step-up's max_age: whole seconds from 0 to a day. Anything else is ignored
// and the sign-in goes ahead as a plain one (TDD-identity-experience-001 §Step-Up).
export function stepUpMaxAge(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{1,5}$/.test(value)) {
    return null;
  }
  const seconds = Number(value);
  return seconds <= 86_400 ? seconds : null;
}

// A Tenant identifier as the Organization Control API issues it: a UUID, lowercase. It selects the
// Tenant a sign-in asks for and is never authority: the kernel issues it only for a member, and the
// callback holds the ID token to it (OWASP: client-supplied tenant identifiers are selectors only).
const tenantPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// tenantSelector reads a sign-in's ?tenant=: null when absent, the identifier when well formed, and
// undefined when present but unusable, which refuses the sign-in rather than signing in without it.
export function tenantSelector(value: unknown, enabled: boolean): string | null | undefined {
  if (value === undefined) {
    return null;
  }
  return enabled && typeof value === 'string' && tenantPattern.test(value) ? value : undefined;
}

const queryOf = (request: FastifyRequest): string => {
  const index = request.url.indexOf('?');
  return index === -1 ? '' : request.url.slice(index);
};

// authRoutes are the BFF's own endpoints (TDD-identity-experience-001 §BFF Endpoints). Step-up is a
// sign-in with max_age; the context switch arrives with the screen that needs it.
export function authRoutes(app: FastifyInstance, options: AuthRoutesOptions, done: () => void): void {
  const { publicOrigin, oidc, sessions, store, now, tenantSignIn } = options;

  // A back-channel logout is a form post from the identity kernel. The parser is registered in
  // this plugin's scope only, so no other route accepts a form body.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: logoutTokenLimit },
    (_request, body, done) => {
      done(null, new URLSearchParams(typeof body === 'string' ? body : body.toString('utf8')));
    },
  );

  app.get<{
    Querystring: {
      return_to?: string;
      max_age?: string;
      acr_values?: string;
      kc_action?: string;
      tenant?: string;
    };
  }>('/auth/login', async (request, reply) => {
    const binding = randomToken();
    const codeVerifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const maxAge = stepUpMaxAge(request.query.max_age);
    const returnTo = safeReturnTo(request.query.return_to, publicOrigin);
    // A Tenant the sign-in cannot ask for is refused, not dropped: dropping it would sign in to
    // the provider-scope form instead of the Tenant the operator chose (ADR-IAM-008 §5.2).
    const tenantId = tenantSelector(request.query.tenant, tenantSignIn);
    if (tenantId === undefined) {
      request.log.warn('sign-in refused: a Tenant this application cannot ask for');
      return noStore(reply).redirect(signInLanding(returnTo, 'failed'), 302);
    }
    // The Admin Portal signs in at aal2: every provider route requires it (ADR-IAM-004 §5.3). The
    // BFF decides that by where the sign-in returns; a level the request names is its own.
    const acrValues =
      requestedLevel(request.query.acr_values) ?? (applicationRoot(returnTo) === '/' ? 'aal2' : null);
    try {
      await store.putLoginState(digest(binding), {
        state,
        nonce,
        codeVerifier,
        returnTo,
        expiresAt: new Date(now().getTime() + loginLifetimeSeconds * 1_000),
        maxAge,
        acrValues,
        tenantId,
      });
    } catch (error) {
      // A navigation, so the answer is a page: the application says the sign-in service could not
      // be reached and offers to try again, as for an identity kernel that does not answer.
      if (!(error instanceof SessionStoreUnavailable)) {
        throw error;
      }
      request.log.error({ err: error }, 'sign-in could not reach the session store');
      return noStore(reply).redirect(signInLanding(returnTo, 'unavailable'), 302);
    }
    const location = oidc.authorizationUrl({
      state,
      nonce,
      codeChallenge: await client.calculatePKCECodeChallenge(codeVerifier),
      maxAge,
      acrValues,
      kcAction: kernelAction(request.query.kc_action),
      tenantId,
    });
    setLoginCookie(reply, binding);
    return noStore(reply).redirect(location.href, 302);
  });

  app.get('/auth/callback', async (request, reply) => {
    clearLoginCookie(reply);
    noStore(reply);
    // Where the sign-in started, once the browser's own record of it is found.
    let returnTo = '/';
    const fail = (reason: string, error?: unknown): FastifyReply => {
      request.log.warn({ reason, err: error }, 'sign-in refused');
      return reply.redirect(signInLanding(returnTo, 'failed'), 302);
    };
    // The store did not answer: no session was made, and the browser lands where trying again is
    // offered. A code already exchanged is spent; the next sign-in gets a new one.
    const unavailable = (error: unknown): FastifyReply => {
      if (!(error instanceof SessionStoreUnavailable)) {
        throw error;
      }
      request.log.error({ err: error }, 'sign-in could not reach the session store');
      return reply.redirect(signInLanding(returnTo, 'unavailable'), 302);
    };

    // The login cookie binds this callback to the browser that started the sign-in. Without it, a
    // code and state captured from one browser and delivered to another would sign the second in
    // as the first.
    const binding = readCookie(request, loginCookie);
    if (binding === undefined || binding === '') {
      return fail('no sign-in in flight in this browser');
    }
    let login;
    try {
      login = await store.takeLoginState(digest(binding));
    } catch (error) {
      return unavailable(error);
    }
    if (login !== null) {
      returnTo = login.returnTo;
    }
    if (login === null || now() >= login.expiresAt) {
      return fail('the sign-in expired or was already completed');
    }
    const callbackQuery = new URLSearchParams(queryOf(request));
    const returned = callbackQuery.get('state');
    if (returned === null || !equalSecrets(returned, login.state)) {
      return fail('state mismatch');
    }
    // An application-initiated action the person cancelled may come back with no code: the session
    // they had is unchanged, and the page is told the action did not happen.
    const actionOutcome = callbackQuery.get('kc_action_status');
    if (callbackQuery.get('code') === null && actionOutcome !== null) {
      return reply.redirect(withActionOutcome(login.returnTo, actionOutcome), 302);
    }

    let grant;
    try {
      grant = await oidc.exchange(queryOf(request), login);
    } catch (error) {
      if (error instanceof IdentityProviderUnavailable) {
        // The code is spent or will lapse unused either way; the user starts again, which is what
        // the landing page offers.
        request.log.error({ err: error }, 'sign-in could not reach the identity kernel');
        return reply.redirect(signInLanding(returnTo, 'unavailable'), 302);
      }
      if (error instanceof OidcError) {
        return fail('the authorization response or its tokens were refused', error);
      }
      throw error;
    }
    const { identity } = grant;
    if (identity === null) {
      return fail('the token response carried no identity');
    }
    // The kernel decides how a person reaches the level asked for; the BFF checks that it did.
    const asked = requestedLevel(login.acrValues);
    if (asked !== null && !meets(identity.acr, asked)) {
      return fail(`the authentication reached acr ${identity.acr ?? 'none'}, below the ${asked} asked for`);
    }
    // The form is checked like the level: a Tenant sign-in must return that Tenant, and a provider
    // sign-in none (ADR-IAM-008 §5.3, as Auth0 validates org_id on the callback).
    if (identity.tenantId !== login.tenantId) {
      return fail(
        login.tenantId === null
          ? 'a provider sign-in returned a Tenant'
          : 'the sign-in returned another Tenant than the one asked for, or none',
      );
    }

    // A sign-in always issues a new session identifier, and the one the browser held before, if
    // any, is ended: an identifier planted before sign-in never becomes an authenticated one.
    let cookie;
    try {
      const previous = await sessions.resolve(readCookie(request, sessionCookie), false, request.log);
      if (previous !== null) {
        await sessions.destroy(previous);
      }
      ({ cookie } = await sessions.start({ ...grant, identity }));
    } catch (error) {
      return unavailable(error);
    }
    setSessionCookie(reply, cookie);
    return reply.redirect(withActionOutcome(login.returnTo, actionOutcome), 302);
  });

  // The display context the application renders, and the CSRF token it echoes. No token material,
  // ever. Reading it is not activity: it does not extend the idle expiry.
  app.get('/auth/session', async (request, reply) => {
    noStore(reply);
    const presented = readCookie(request, sessionCookie);
    let session;
    try {
      session = await sessions.resolve(presented, false, request.log);
    } catch (error) {
      return storeOutage(request, reply, error);
    }
    if (session === null) {
      if (presented !== undefined) {
        clearSessionCookie(reply);
      }
      return reply.send({ authenticated: false });
    }
    return reply.send({
      authenticated: true,
      principalId: session.principalId,
      displayName: session.displayName,
      acr: session.acr,
      authTime: session.authTime?.toISOString() ?? null,
      tenantId: session.tenantId,
      idleExpiresAt: session.idleExpiresAt.toISOString(),
      absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
      csrfToken: session.csrfToken,
    });
  });

  // Sign-out ends the BFF session and the identity kernel's, both server-side: the browser is given
  // nothing to carry to Keycloak, so no token reaches it on the way out either.
  app.post('/auth/logout', async (request, reply) => {
    const session = await authenticate(request, reply, { sessions, publicOrigin, fresh: false });
    if (session === null) {
      return reply;
    }
    // The cookie is cleared only once the row is gone: a sign-out the store could not record is
    // answered 503 and can be repeated.
    try {
      await sessions.destroy(session);
    } catch (error) {
      return storeOutage(request, reply, error);
    }
    clearSessionCookie(reply);
    if (!(await oidc.endKeycloakSession(session.tokens))) {
      request.log.warn('the identity kernel did not confirm the end of its session');
    }
    return noStore(reply).code(204).send();
  });

  // The identity kernel's notice that a Keycloak session ended (OpenID Connect Back-Channel Logout
  // 1.0). Server to server, authenticated by the signed logout token, so no CSRF check applies: no
  // browser and no cookie is involved.
  app.post('/auth/back-channel-logout', async (request, reply) => {
    noStore(reply);
    const token = request.body instanceof URLSearchParams ? request.body.get('logout_token') : null;
    if (token === null || token === '') {
      return sendProblem(request, reply, 'validationFailed', 'A logout_token form parameter is required');
    }
    let target;
    try {
      target = await oidc.verifyLogoutToken(token);
    } catch (error) {
      if (!(error instanceof OidcError)) {
        throw error;
      }
      request.log.warn({ err: error }, 'back-channel logout refused');
      return sendProblem(request, reply, 'validationFailed', 'The logout token was refused');
    }
    let ended;
    try {
      ended = await store.destroyForLogout(target.subject, target.keycloakSessionId);
    } catch (error) {
      // A logout that could not be recorded failed, which the specification answers 400, never 5xx
      // (OpenID Connect Back-Channel Logout 1.0 §2.8). The refresh path still ends the session
      // within one access token's lifetime of the store answering again.
      if (!(error instanceof SessionStoreUnavailable)) {
        throw error;
      }
      request.log.error({ err: error }, 'back-channel logout could not reach the session store');
      return reply.code(400).send();
    }
    request.log.info({ ended }, 'back-channel logout');
    return reply.code(200).send();
  });

  done();
}
