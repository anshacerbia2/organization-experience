import { csrfHeader } from './session';

// The browser side of the active scope (TDD-organization-experience-001 1.2.0). The scope is the
// session's: the BFF reads it from the ID token the session was issued with and from the provider
// window it opened. The browser renders it and asks to change it; it never asserts it.

export interface ProviderWindow {
  readonly state: 'pending' | 'in-force';
  readonly emergency: boolean;
  readonly reason: string;
  readonly correlationId: string;
  readonly tenants: 'all' | readonly string[];
  readonly durationMinutes: number;
  readonly requestedAt: string;
  readonly endsAt: string | null;
}

export type Scope =
  | { readonly scope: 'tenant'; readonly tenantId: string }
  | {
      readonly scope: 'provider';
      readonly acr: string | null;
      readonly authTime: string | null;
      readonly limits: { readonly maxDurationMinutes: number; readonly defaultDurationMinutes: number };
      readonly window: ProviderWindow | null;
      // closed says why a window closed without the operator leaving it, once.
      readonly closed?: 'denied' | 'lapsed' | 'ended';
    };

export async function fetchScope(): Promise<Scope> {
  const response = await fetch('/auth/scope', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`the scope could not be read: ${String(response.status)}`);
  }
  return (await response.json()) as Scope;
}

export interface WindowRequest {
  readonly reason: string;
  readonly durationMinutes: number;
  readonly tenants: 'all' | readonly string[];
}

// Refusal is why a window did not open: the BFF's or the API's own sentence, or a sign-in to do
// first.
export type Refusal =
  | { readonly kind: 'step-up' }
  | { readonly kind: 'refused'; readonly detail: string | null; readonly correlationId: string | null }
  | { readonly kind: 'unavailable' };

interface ProblemDocument {
  readonly detail?: unknown;
  readonly correlation_id?: unknown;
}

async function refusalOf(response: Response): Promise<Refusal> {
  if (
    response.status === 401 &&
    /insufficient_user_authentication/.test(response.headers.get('www-authenticate') ?? '')
  ) {
    return { kind: 'step-up' };
  }
  if (response.status >= 500) {
    return { kind: 'unavailable' };
  }
  let problem: ProblemDocument = {};
  try {
    problem = (await response.json()) as ProblemDocument;
  } catch {
    problem = {};
  }
  return {
    kind: 'refused',
    detail: typeof problem.detail === 'string' ? problem.detail : null,
    correlationId: typeof problem.correlation_id === 'string' ? problem.correlation_id : null,
  };
}

// openProviderMode asks for a window. The reason goes first: the BFF and the API both refuse a
// window without one.
export async function openProviderMode(csrfToken: string, request: WindowRequest): Promise<Refusal | null> {
  const response = await fetch('/auth/scope/provider', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json', [csrfHeader]: csrfToken },
    body: JSON.stringify({
      reason: request.reason,
      duration_minutes: request.durationMinutes,
      tenants: request.tenants,
    }),
  });
  return response.ok ? null : refusalOf(response);
}

// leaveProviderMode closes the window, and the BFF ends its activation.
export async function leaveProviderMode(csrfToken: string): Promise<Refusal | null> {
  const response = await fetch('/auth/scope/provider/end', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { [csrfHeader]: csrfToken },
  });
  return response.ok ? null : refusalOf(response);
}

// The reason rules the BFF applies, so the form says what is wrong before it is sent.
export const minReasonLength = 10;
export const maxReasonLength = 500;
export const normalizeReason = (reason: string): string => reason.replace(/\s+/g, ' ').trim();
export function reasonProblem(reason: string): 'short' | 'long' | 'characters' | null {
  const normalized = normalizeReason(reason);
  if (normalized.length < minReasonLength) {
    return 'short';
  }
  if (normalized.length > maxReasonLength) {
    return 'long';
  }
  return /^[\x20-\x7E]*$/.test(normalized) ? null : 'characters';
}

// remaining formats the time left until an instant: h:mm:ss, or m:ss under an hour.
export function remaining(until: string, now: number): string {
  const seconds = Math.max(0, Math.floor((Date.parse(until) - now) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${s}` : `${String(m)}:${s}`;
}
