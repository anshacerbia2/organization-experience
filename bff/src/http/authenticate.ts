import type { FastifyReply, FastifyRequest } from 'fastify';

import { clearSessionCookie, readCookie, sessionCookie } from './cookies.js';
import { csrfTokenValid, isStateChanging, originAllowed } from './csrf.js';
import { sendProblem } from './problem.js';
import { IdentityProviderUnavailable } from '../auth/oidc.js';
import type { Sessions } from '../session/sessions.js';
import { SessionStoreUnavailable, type SessionRecord } from '../session/store.js';

export interface AuthenticateOptions {
  readonly sessions: Sessions;
  readonly publicOrigin: string;
  // fresh refreshes the access token when it is near expiry: what a request that will present it
  // upstream needs, and one that only ends the session does not.
  readonly fresh: boolean;
}

// authenticate resolves the session a request carries and applies the CSRF checks to a
// state-changing one. It answers the request itself when it refuses, and returns null; the caller
// returns the reply.
//
// The Origin check comes first because it needs no session: a cross-site request is refused
// before the store is read.
//
// A session store that does not answer is an outage, answered 503 like an identity kernel that does
// not: the session is not ended, and the browser keeps its cookie to try again (RFC 9110 §15.6.4,
// TDD-identity-experience-001 §Session-Store Outage).
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  options: AuthenticateOptions,
): Promise<SessionRecord | null> {
  try {
    return await resolveSession(request, reply, options);
  } catch (error) {
    if (error instanceof SessionStoreUnavailable) {
      request.log.error({ err: error }, 'session store unavailable');
      sendProblem(request, reply, 'dependencyUnavailable');
      return null;
    }
    throw error;
  }
}

async function resolveSession(
  request: FastifyRequest,
  reply: FastifyReply,
  options: AuthenticateOptions,
): Promise<SessionRecord | null> {
  const stateChanging = isStateChanging(request);
  if (stateChanging && !originAllowed(request, options.publicOrigin)) {
    request.log.warn({ origin: request.headers.origin ?? null }, 'csrf rejection: origin');
    sendProblem(request, reply, 'forbidden', 'A state-changing request must come from this origin');
    return null;
  }

  const presented = readCookie(request, sessionCookie);
  let session = await options.sessions.resolve(presented, true, request.log);
  if (session === null) {
    if (presented !== undefined) {
      clearSessionCookie(reply);
    }
    sendProblem(request, reply, 'authenticationRequired');
    return null;
  }

  if (stateChanging && !csrfTokenValid(request, session)) {
    request.log.warn('csrf rejection: token');
    sendProblem(request, reply, 'forbidden', 'A state-changing request must carry the session CSRF token');
    return null;
  }

  if (options.fresh) {
    try {
      session = await options.sessions.fresh(session, request.log);
    } catch (error) {
      if (error instanceof IdentityProviderUnavailable) {
        request.log.error({ err: error }, 'refresh could not reach the identity kernel');
        sendProblem(request, reply, 'dependencyUnavailable');
        return null;
      }
      throw error;
    }
    if (session === null) {
      clearSessionCookie(reply);
      sendProblem(request, reply, 'authenticationRequired');
      return null;
    }
  }
  return session;
}
