import { windowState, type ProviderWindow } from './windows.js';

// The scope guard (TDD-organization-experience-001 1.2.0 §The Scope Guard): what a request may reach
// in the active scope, decided before it leaves the BFF. It is defence in depth. The Organization
// Control API refuses all of it again, and this exists so an operator acting on the wrong Tenant is
// stopped here, with the scope named, rather than by whatever the API happens to say.

// ActiveScope is the session's: a Tenant from the ID token the session was issued with, or the
// provider form with the window it opened, if any. It is never browser input.
export type ActiveScope =
  | { readonly kind: 'tenant'; readonly tenantId: string }
  | { readonly kind: 'provider'; readonly window: ProviderWindow | null };

export interface GuardRequest {
  readonly method: string;
  // path is under /v1/, already checked by the proxy to resolve nowhere else.
  readonly path: string;
  readonly contentType: string | undefined;
  readonly body: Buffer | undefined;
  // reason is the operator's own reason for this action, when the application sent one.
  readonly reason: string | undefined;
  // principalId is the session's Principal, from the ID token: the one whose own contexts it may read.
  readonly principalId: string | null;
}

export type GuardDecision =
  | { readonly allowed: true; readonly headers: Readonly<Record<string, string>> }
  | { readonly allowed: false; readonly detail: string };

// The routes a Tenant administrator reaches. None names a Tenant: the API takes it from the token.
// Two invitation routes are the provider's, and stay out.
const tenantRoutes = ['/v1/memberships', '/v1/workspaces', '/v1/invitations'];
const providerOnlyInvitationRoutes = ['/v1/invitations/verify-identity', '/v1/invitations/expire-lapsed'];

// The routes a provider reaches with no authority in force: the activation routes alone, as the API
// admits an eligible caller (TDD-organization-control-001 §Provider Activation).
const activationRoutes = '/v1/provider-activations';

const under = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);

// ownContexts is the one route every scope reaches: the operator's own contexts, read for themselves
// (ADR-ORG-005). Another Principal's are not reached through it, in any scope.
const ownContexts = (request: GuardRequest, path: string): boolean =>
  request.method === 'GET' &&
  request.principalId !== null &&
  path === `/v1/principals/${encodeURIComponent(request.principalId)}/contexts`;

// namedTenants are the Tenants a request names: the identifier after /v1/tenants/ in its path, and
// a tenant_id at the top of a JSON body. Those are the two places the API takes a Tenant from.
export function namedTenants(request: GuardRequest): string[] {
  const named: string[] = [];
  const segments = request.path.split('?')[0]?.split('/') ?? [];
  if (segments[1] === 'v1' && segments[2] === 'tenants' && segments[3] !== undefined && segments[3] !== '') {
    named.push(decodeURIComponent(segments[3]));
  }
  if (request.body !== undefined && request.body.length > 0 && (request.contentType ?? '').includes('json')) {
    try {
      const parsed: unknown = JSON.parse(request.body.toString('utf8'));
      if (typeof parsed === 'object' && parsed !== null && 'tenant_id' in parsed) {
        const value = parsed.tenant_id;
        named.push(typeof value === 'string' ? value : JSON.stringify(value));
      }
    } catch {
      // Not JSON after all: the API refuses it on its own terms.
    }
  }
  return named;
}

export function guard(scope: ActiveScope, request: GuardRequest, now: Date): GuardDecision {
  const path = request.path.split('?')[0] ?? '';

  // A self read is not a provider access: it carries no window reason or correlation.
  if (ownContexts(request, path)) {
    return { allowed: true, headers: {} };
  }

  if (scope.kind === 'tenant') {
    const reachable =
      tenantRoutes.some((prefix) => under(path, prefix)) &&
      !providerOnlyInvitationRoutes.some((prefix) => under(path, prefix));
    if (!reachable || namedTenants(request).some((tenant) => tenant !== scope.tenantId)) {
      return {
        allowed: false,
        detail: 'This request is outside the active Tenant scope. Enter provider mode to act across Tenants.',
      };
    }
    return { allowed: true, headers: {} };
  }

  const window = scope.window;
  // In provider scope every request carries a reason, the API's rule, and the window's correlation
  // identifier, so each privileged access record names the window it was made under.
  const headers: Record<string, string> = {};
  if (window !== null) {
    headers['x-correlation-id'] = window.correlationId;
    if (request.reason === undefined || request.reason.trim() === '') {
      headers['x-administrative-reason'] = window.reason;
    }
  }

  if (under(path, activationRoutes)) {
    return { allowed: true, headers };
  }
  if (window === null || windowState(window, now) !== 'in-force') {
    return {
      allowed: false,
      detail:
        window === null
          ? 'Provider mode is not active. Enter it, with a reason, before acting across Tenants.'
          : windowState(window, now) === 'pending'
            ? 'Provider mode is awaiting approval by another provider.'
            : 'Provider mode has ended. Enter it again to continue.',
    };
  }
  const tenants = window.tenants;
  if (tenants !== null && namedTenants(request).some((tenant) => !tenants.includes(tenant))) {
    return {
      allowed: false,
      detail: 'This request names a Tenant outside the ones provider mode was entered for.',
    };
  }
  return { allowed: true, headers };
}
