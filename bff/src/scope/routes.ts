import { randomUUID } from 'node:crypto';

import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  ControlRefused,
  ControlUnavailable,
  organizationControlScope,
  type Call,
  type OrganizationControl,
} from './control.js';
import { windowState, type ProviderWindow, type ProviderWindows } from './windows.js';
import { meets } from '../auth/levels.js';
import type { ProviderModeConfig } from '../config.js';
import { authenticate } from '../http/authenticate.js';
import { clearSessionCookie, readCookie, sessionCookie } from '../http/cookies.js';
import { csrfTokenValid, originAllowed } from '../http/csrf.js';
import { sendProblem } from '../http/problem.js';
import type { Sessions } from '../session/sessions.js';
import type { SessionRecord } from '../session/store.js';

// The scope endpoints (TDD-organization-experience-001 1.2.0 §The Scope Guard and the BFF's Scope
// Endpoints). The scope itself is the session's: a Tenant the ID token confirmed, or the provider
// form. What these add is provider mode: a window opened with a reason, a duration and the Tenants
// it is for, resting on an activation the Organization Control API records and enforces.

export interface ScopeRoutesOptions {
  readonly publicOrigin: string;
  readonly sessions: Sessions;
  readonly windows: ProviderWindows;
  readonly control: OrganizationControl;
  readonly provider: ProviderModeConfig;
  readonly now: () => Date;
}

// A reason travels in X-Administrative-Reason, which the API accepts as visible US-ASCII only. Line
// breaks typed in the form become spaces; anything else outside it is refused with a message.
export const minReasonLength = 10;
export const maxReasonLength = 500;
const headerSafe = /^[\x20-\x7E]*$/;
export const normalizeReason = (value: string): string => value.replace(/\s+/g, ' ').trim();

const tenantPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const maxTenants = 50;

// What the BFF writes as the reason when it ends an activation itself: what happened, not why the
// operator acted, which the activation already records.
const leftReason = 'Provider mode left in Organization Experience';
const signedOutReason = 'Signed out of Organization Experience with provider mode open';

export interface WindowRequest {
  readonly reason: string;
  readonly durationSeconds: number;
  readonly tenants: readonly string[] | null;
}

// readWindowRequest validates a window request, and names the first rule it breaks.
export function readWindowRequest(
  body: unknown,
  provider: ProviderModeConfig,
): { request: WindowRequest } | { problem: string } {
  if (typeof body !== 'object' || body === null) {
    return { problem: 'The request must be a JSON object' };
  }
  const { reason, duration_minutes: minutes, tenants } = body as Record<string, unknown>;
  if (typeof reason !== 'string') {
    return { problem: 'A reason is required before provider mode opens' };
  }
  const normalized = normalizeReason(reason);
  if (normalized.length < minReasonLength || normalized.length > maxReasonLength) {
    return {
      problem: `The reason must be ${String(minReasonLength)} to ${String(maxReasonLength)} characters`,
    };
  }
  if (!headerSafe.test(normalized)) {
    return { problem: 'The reason may use letters, digits, spaces and ASCII punctuation only' };
  }
  const maxMinutes = provider.maxDurationMs / 60_000;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > maxMinutes) {
    return { problem: `The duration must be a whole number of minutes from 1 to ${String(maxMinutes)}` };
  }
  let targets: readonly string[] | null;
  if (tenants === 'all') {
    targets = null;
  } else if (
    Array.isArray(tenants) &&
    tenants.length > 0 &&
    tenants.length <= maxTenants &&
    tenants.every((tenant) => typeof tenant === 'string' && tenantPattern.test(tenant))
  ) {
    targets = [...new Set(tenants as string[])];
  } else {
    return {
      problem: `Name the Tenants provider mode is for, 1 to ${String(maxTenants)} identifiers, or all of them`,
    };
  }
  return { request: { reason: normalized, durationSeconds: minutes * 60, tenants: targets } };
}

// The scope as the application renders it.
interface WindowView {
  readonly state: 'pending' | 'in-force';
  readonly emergency: boolean;
  readonly reason: string;
  readonly correlationId: string;
  readonly tenants: 'all' | readonly string[];
  readonly durationMinutes: number;
  readonly requestedAt: string;
  readonly endsAt: string | null;
}

const windowView = (window: ProviderWindow, state: 'pending' | 'in-force'): WindowView => ({
  state,
  emergency: window.grantKind === 'emergency',
  reason: window.reason,
  correlationId: window.correlationId,
  tenants: window.tenants ?? 'all',
  durationMinutes: window.durationSeconds / 60,
  requestedAt: window.requestedAt.toISOString(),
  endsAt: window.endsAt?.toISOString() ?? null,
});

// A window that closed without the operator leaving it says why, once: the approver denied it, the
// request lapsed, or its time ran out or someone ended it.
type Closed = 'denied' | 'lapsed' | 'ended';

const callOf = (session: SessionRecord, window: { reason: string; correlationId: string }): Call => ({
  accessToken: session.tokens.accessToken,
  reason: window.reason,
  correlationId: window.correlationId,
});

const noStore = (reply: FastifyReply): FastifyReply => reply.header('cache-control', 'no-store');

// ask runs one call to the API and keeps its failure as a value, so the route decides how to answer
// outside the call.
async function ask<T>(
  call: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    return { ok: false, error };
  }
}

// failed answers a call that did not succeed: the API's refusal as it wrote it, an outage as one.
async function failed(
  request: FastifyRequest,
  reply: FastifyReply,
  sessions: Sessions,
  session: SessionRecord,
  error: unknown,
): Promise<FastifyReply> {
  if (error instanceof ControlRefused) {
    return passRefusal(request, reply, sessions, session, error);
  }
  if (error instanceof ControlUnavailable) {
    request.log.error({ err: error }, 'organization-control unreachable');
    return sendProblem(request, reply, 'dependencyUnavailable');
  }
  throw error;
}

// passRefusal answers with the API's own refusal. A 401 means the API refused the token: the
// session ends, as the proxy ends it.
async function passRefusal(
  request: FastifyRequest,
  reply: FastifyReply,
  sessions: Sessions,
  session: SessionRecord,
  error: ControlRefused,
): Promise<FastifyReply> {
  if (error.status === 401) {
    await sessions.destroy(session);
    clearSessionCookie(reply);
    return sendProblem(request, reply, 'authenticationRequired');
  }
  noStore(reply).code(error.status);
  if (error.contentType !== null) {
    reply.header('content-type', error.contentType);
  }
  return reply.send(error.body);
}

export function scopeRoutes(app: FastifyInstance, options: ScopeRoutesOptions, done: () => void): void {
  const { publicOrigin, sessions, windows, control, provider, now } = options;

  // GET /auth/scope: the active scope. Reading it is not activity, as reading the session is not,
  // so a tab polling a pending window still goes idle.
  app.get('/auth/scope', async (request, reply) => {
    noStore(reply);
    const presented = readCookie(request, sessionCookie);
    const session = await sessions.resolve(presented, false);
    if (session === null) {
      if (presented !== undefined) {
        clearSessionCookie(reply);
      }
      return sendProblem(request, reply, 'authenticationRequired');
    }
    if (session.tenantId !== null) {
      return reply.send({ scope: 'tenant', tenantId: session.tenantId });
    }
    const limits = {
      maxDurationMinutes: provider.maxDurationMs / 60_000,
      defaultDurationMinutes: provider.defaultDurationMs / 60_000,
    };
    const providerForm = {
      scope: 'provider',
      acr: session.acr,
      authTime: session.authTime?.toISOString() ?? null,
      limits,
    };
    const window = await windows.find(session.idHash);
    if (window === null) {
      return reply.send({ ...providerForm, window: null });
    }

    const state = windowState(window, now());
    let closed: Closed | null = state === 'ended' ? 'ended' : null;
    // A pending activation is read again from the API: approved, it is in force until the end the
    // API set; denied or lapsed, the window closes.
    const activationId = window.activationId;
    if (state === 'pending' && activationId !== null) {
      let fresh: SessionRecord | null;
      try {
        fresh = await sessions.fresh(session, request.log);
      } catch {
        return sendProblem(request, reply, 'dependencyUnavailable');
      }
      if (fresh === null) {
        clearSessionCookie(reply);
        return sendProblem(request, reply, 'authenticationRequired');
      }
      const read = await ask(() => control.activation(callOf(fresh, window), activationId));
      if (!read.ok) {
        return failed(request, reply, sessions, fresh, read.error);
      }
      const activation = read.value;
      if (activation?.decision === 'approved' && activation.endsAt !== null) {
        await windows.approved(window.sessionHash, activation.endsAt);
        if (activation.inForce && activation.endedAt === null) {
          return reply.send({
            ...providerForm,
            window: windowView({ ...window, endsAt: activation.endsAt }, 'in-force'),
          });
        }
        closed = 'ended';
      } else if (
        activation === null ||
        activation.decision === 'denied' ||
        activation.decision === 'lapsed'
      ) {
        closed = activation?.decision === 'denied' ? 'denied' : 'lapsed';
      }
    }
    if (closed !== null) {
      await windows.close(window.sessionHash);
      return reply.send({ ...providerForm, window: null, closed });
    }
    return reply.send({
      ...providerForm,
      window: windowView(window, state === 'in-force' ? 'in-force' : 'pending'),
    });
  });

  // POST /auth/scope/provider opens a window: the step-up first, the reason before anything opens.
  app.post('/auth/scope/provider', async (request, reply) => {
    noStore(reply);
    const session = await authenticate(request, reply, { sessions, publicOrigin, fresh: true });
    if (session === null) {
      return reply;
    }
    if (session.tenantId !== null) {
      return sendProblem(
        request,
        reply,
        'forbidden',
        'Provider mode is entered from a provider sign-in, not from a Tenant scope',
      );
    }
    // The provider sign-in must be at aal2 and recent: the authentication that opens provider mode
    // happens when it opens (ADR-IAM-008 §5.4). Otherwise the application signs in again, as a
    // step-up challenge asks it to (RFC 9470).
    const authAge = session.authTime === null ? Infinity : now().getTime() - session.authTime.getTime();
    if (!meets(session.acr, 'aal2') || authAge > provider.stepUpAgeMs) {
      reply.header(
        'www-authenticate',
        'Bearer error="insufficient_user_authentication", acr_values="aal2", max_age="0"',
      );
      return sendProblem(
        request,
        reply,
        'authenticationRequired',
        'Provider mode needs a fresh sign-in at aal2',
      );
    }
    const read = readWindowRequest(request.body, provider);
    if ('problem' in read) {
      return sendProblem(request, reply, 'validationFailed', read.problem);
    }
    const existing = await windows.find(session.idHash);
    if (existing !== null && windowState(existing, now()) !== 'ended') {
      return sendProblem(request, reply, 'forbidden', 'Provider mode is already open; leave it first');
    }

    const correlationId = randomUUID();
    const call = callOf(session, { reason: read.request.reason, correlationId });
    const grants = await ask(() => control.ownGrants(call));
    if (!grants.ok) {
      return failed(request, reply, sessions, session, grants.error);
    }
    const grant = grants.value.find((candidate) => candidate.scope === organizationControlScope);
    if (grant === undefined) {
      return sendProblem(
        request,
        reply,
        'forbidden',
        'This operator holds no provider grant for Organization Control',
      );
    }
    const requestedAt = now();
    const base = {
      sessionHash: session.idHash,
      reason: read.request.reason,
      correlationId,
      tenants: read.request.tenants,
      durationSeconds: read.request.durationSeconds,
      requestedAt,
    };
    let window: ProviderWindow;
    if (grant.kind === 'emergency') {
      // Standing authority, with no activation to ask for (ADR-ORG-002 §5.2). The window still
      // carries the reason and the Tenants, and closes at the duration stated.
      window = {
        ...base,
        grantKind: 'emergency',
        activationId: null,
        endsAt: new Date(requestedAt.getTime() + read.request.durationSeconds * 1_000),
      };
    } else {
      const requested = await ask(() =>
        control.requestActivation(
          { ...call, idempotencyKey: correlationId },
          grant.grantId,
          read.request.durationSeconds,
        ),
      );
      if (!requested.ok) {
        return failed(request, reply, sessions, session, requested.error);
      }
      window = {
        ...base,
        grantKind: 'eligible',
        activationId: requested.value.activationId,
        // Approved at once only where the API allows approval to be optional, outside production.
        endsAt: requested.value.decision === 'approved' ? requested.value.endsAt : null,
      };
    }
    await windows.open(window);
    request.log.info(
      {
        correlation_id: correlationId,
        grant_kind: window.grantKind,
        tenants: window.tenants?.length ?? 'all',
      },
      'provider window opened',
    );
    const state = windowState(window, now()) === 'in-force' ? 'in-force' : 'pending';
    return reply.code(201).send({ scope: 'provider', window: windowView(window, state) });
  });

  // POST /auth/scope/provider/end leaves provider mode, and ends the activation with it.
  app.post('/auth/scope/provider/end', async (request, reply) => {
    noStore(reply);
    const session = await authenticate(request, reply, { sessions, publicOrigin, fresh: true });
    if (session === null) {
      return reply;
    }
    const window = await windows.find(session.idHash);
    if (window === null) {
      return reply.code(204).send();
    }
    const confirmed = await endActivation(control, session, window, leftReason, request.log);
    await windows.close(window.sessionHash);
    if (!confirmed) {
      return sendProblem(
        request,
        reply,
        'dependencyUnavailable',
        'Provider mode is closed here; the API did not confirm the activation ended, and it ends at its own time',
      );
    }
    return reply.code(204).send();
  });

  done();
}

// endActivation ends a window's activation at the API. It resolves to whether the activation is
// known to have ended: an emergency window has none, and one the API says is not in force has
// already ended.
async function endActivation(
  control: OrganizationControl,
  session: SessionRecord,
  window: ProviderWindow,
  reason: string,
  log: FastifyBaseLogger,
): Promise<boolean> {
  if (window.activationId === null) {
    return true;
  }
  try {
    await control.endActivation(
      callOf(session, { reason, correlationId: window.correlationId }),
      window.activationId,
    );
    return true;
  } catch (error) {
    if (error instanceof ControlRefused && error.status === 409) {
      return true;
    }
    log.warn({ err: error, correlation_id: window.correlationId }, 'the activation could not be ended');
    return false;
  }
}

export interface SignOutHookOptions {
  readonly publicOrigin: string;
  readonly sessions: Sessions;
  readonly windows: ProviderWindows;
  readonly control: OrganizationControl;
}

// endWindowOnSignOut ends an open window's activation when its session signs out, so authority
// never outlives the session that asked for it. It runs before the pattern's own sign-out, only for
// a request that passes the same forgery checks, and never stands in its way: the sign-out goes
// ahead whatever the API answers.
export function endWindowOnSignOut(options: SignOutHookOptions) {
  return async (request: FastifyRequest): Promise<void> => {
    if (request.method !== 'POST' || request.url.split('?')[0] !== '/auth/logout') {
      return;
    }
    if (!originAllowed(request, options.publicOrigin)) {
      return;
    }
    try {
      const session = await options.sessions.resolve(readCookie(request, sessionCookie), false);
      if (session === null || !csrfTokenValid(request, session)) {
        return;
      }
      const window = await options.windows.find(session.idHash);
      if (window === null) {
        return;
      }
      const fresh = await options.sessions.fresh(session, request.log);
      if (fresh !== null) {
        await endActivation(options.control, fresh, window, signedOutReason, request.log);
      }
    } catch (error) {
      request.log.warn({ err: error }, 'provider window not ended at sign-out');
    }
  };
}
