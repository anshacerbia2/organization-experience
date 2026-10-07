import { csrfHeader } from '../session';

// The browser's only door to the Organization Control API: the BFF's /api proxy, same origin, with
// the session cookie (TDD-identity-experience-001). No token is handled here; the BFF attaches it,
// and its scope guard decides first whether the request may leave (TDD-organization-experience-001
// 1.2.0).

// ApiError is a refusal or a failure, carrying what the problem document says. `detail` is the
// API's own sentence about a refusal, shown attributed to it. The correlation identifier is what an
// operator quotes to find the request.
export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly type: string | null,
    readonly detail: string | null,
    readonly correlationId: string | null,
    // stepUp is set when the BFF or the API asked for a fresher sign-in (RFC 9470).
    readonly stepUp: boolean,
  ) {
    super(`${String(status)}${detail === null ? '' : ` ${detail}`}`);
  }

  // A 4xx is the request's fault, or the session's: the same request gets the same answer.
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  // A version conflict: the record changed since the operator was shown it. It is shown, never
  // retried (TDD-organization-experience-002 1.2.0).
  get isVersionConflict(): boolean {
    return this.status === 409 && (this.type ?? '').endsWith('/version-conflict');
  }
}

interface ProblemDocument {
  readonly type?: unknown;
  readonly detail?: unknown;
  readonly correlation_id?: unknown;
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

async function toError(response: Response): Promise<ApiError> {
  let problem: ProblemDocument = {};
  if ((response.headers.get('content-type') ?? '').includes('json')) {
    try {
      problem = (await response.json()) as ProblemDocument;
    } catch {
      problem = {};
    }
  }
  return new ApiError(
    response.status,
    text(problem.type),
    text(problem.detail),
    text(problem.correlation_id),
    response.status === 401 &&
      /insufficient_user_authentication/.test(response.headers.get('www-authenticate') ?? ''),
  );
}

type ApiPath = `/v1/${string}`;

export interface ReadOptions {
  readonly signal?: AbortSignal;
  // reason is the operator's, for a provider read that needs one and has no window to supply it.
  readonly reason?: string;
}

export async function apiGet<T>(path: ApiPath, options: ReadOptions = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(options.reason === undefined || options.reason === ''
        ? {}
        : { 'x-administrative-reason': options.reason }),
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!response.ok) {
    throw await toError(response);
  }
  return (await response.json()) as T;
}

export interface CommandOptions {
  // csrfToken is the session's. The BFF refuses a state-changing request without it.
  readonly csrfToken: string;
  // idempotencyKey makes a resubmission after an outage answer with what the first attempt did.
  readonly idempotencyKey: string;
  // reason is the operator's own, for this action. Without one in provider mode the BFF sends the
  // window's.
  readonly reason?: string;
}

// apiCommand sends a command. It is never retried here: a command that may have been applied is
// not repeated behind the operator's back (STD-GLB-FE-010 §3.4).
export async function apiCommand<T>(path: ApiPath, body: unknown, options: CommandOptions): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      [csrfHeader]: options.csrfToken,
      'idempotency-key': options.idempotencyKey,
      ...(options.reason === undefined || options.reason === ''
        ? {}
        : { 'x-administrative-reason': options.reason }),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await toError(response);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

// Page is one page of a list in the estate's list form (STD-GLB-001 1.3.0 §Pagination): the items
// under their own name, and the cursor of the next page, null on the last.
export interface Page {
  readonly next: string | null;
}

// listPath builds a list request: the filters that are set, and the cursor.
export function listPath(
  base: ApiPath,
  filters: Readonly<Record<string, string>>,
  after: string | null,
): ApiPath {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value !== '') {
      query.set(name, value);
    }
  }
  if (after !== null) {
    query.set('after', after);
  }
  const rendered = query.toString();
  return rendered === '' ? base : `${base}?${rendered}`;
}
