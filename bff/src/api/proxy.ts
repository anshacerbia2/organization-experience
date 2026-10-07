import type { FastifyInstance } from 'fastify';

import { authenticate } from '../http/authenticate.js';
import { clearSessionCookie } from '../http/cookies.js';
import { sendProblem } from '../http/problem.js';
import type { Sessions } from '../session/sessions.js';

export interface ProxyOptions {
  readonly publicOrigin: string;
  readonly sessions: Sessions;
  readonly organizationControlBaseUrl: string;
  readonly timeoutMs: number;
}

// The request headers forwarded upstream. Everything else is dropped, and above all anything the
// browser could present as authority: the Authorization header is the session's, never the
// caller's, and the cookie never leaves this process.
const forwardedRequestHeaders = [
  'accept',
  'content-type',
  'idempotency-key',
  'x-administrative-reason',
  'if-match',
  'if-none-match',
];

// The response headers returned. Set-Cookie from upstream is never among them: the only cookies on
// this origin are this BFF's.
const forwardedResponseHeaders = ['content-type', 'content-language', 'etag', 'retry-after'];

const bodyLimit = 1024 * 1024;

// plainSegments refuses a path whose segments decode to a dot-segment or carry a slash or
// backslash. The URL parser resolves `..` but keeps `..%2f` literal, and an upstream that decodes
// before routing would read it as a traversal; no API path needs either.
function plainSegments(pathAndQuery: string): boolean {
  const path = pathAndQuery.split('?')[0] ?? '';
  return path.split('/').every((segment) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return false;
    }
    return decoded !== '.' && decoded !== '..' && !decoded.includes('/') && !decoded.includes('\\');
  });
}

// apiProxy forwards /api/v1/* to the Organization Control API with the session's access token
// (TDD-identity-experience-001 §BFF Endpoints). It makes no authorization decision: every command
// is reauthorized upstream.
export function apiProxy(app: FastifyInstance, options: ProxyOptions, done: () => void): void {
  const apiRoot = new URL(`${options.organizationControlBaseUrl}/v1/`).href;

  // The body passes through as bytes. The parsers are replaced in this plugin's scope only.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit }, (_request, body, parsed) => {
    parsed(null, body);
  });

  app.all('/api/*', async (request, reply) => {
    const rest = request.url.slice('/api'.length);
    // Only the versioned API is reachable. The target is built by concatenation and checked after
    // the URL parser has resolved it, so no path — `//host`, `..` or an encoded variant — can point
    // the proxy anywhere but under /v1/.
    const target = new URL(`${options.organizationControlBaseUrl}${rest}`);
    if (!target.href.startsWith(apiRoot) || !plainSegments(rest)) {
      return sendProblem(request, reply, 'notFound');
    }

    const session = await authenticate(request, reply, {
      sessions: options.sessions,
      publicOrigin: options.publicOrigin,
      fresh: true,
    });
    if (session === null) {
      return reply;
    }

    const headers = new Headers({ authorization: `Bearer ${session.tokens.accessToken}` });
    for (const name of forwardedRequestHeaders) {
      const value = request.headers[name];
      if (typeof value === 'string') {
        headers.set(name, value);
      }
    }
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && Buffer.isBuffer(request.body);

    let response: Response;
    try {
      response = await fetch(target, {
        method: request.method,
        headers,
        ...(hasBody ? { body: request.body as Buffer } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      request.log.error({ err: error }, 'organization-control unreachable');
      return sendProblem(request, reply, 'dependencyUnavailable');
    }

    // A step-up challenge says the authentication is too old for this command, not that the token
    // is refused: the session is kept, and the challenge reaches the application, which offers a
    // sign-in with its max_age (TDD-identity-experience-001 §Step-Up, RFC 9470).
    const challenge = response.headers.get('www-authenticate') ?? '';
    if (response.status === 401 && /error="insufficient_user_authentication"/.test(challenge)) {
      reply.code(401).header('cache-control', 'no-store').header('www-authenticate', challenge);
      const contentType = response.headers.get('content-type');
      if (contentType !== null) {
        reply.header('content-type', contentType);
      }
      return reply.send(Buffer.from(await response.arrayBuffer()));
    }

    // The API refused the token: the third path by which a revocation reaches an open tab. The
    // session is ended, not retried.
    if (response.status === 401) {
      await response.body?.cancel();
      await options.sessions.destroy(session);
      clearSessionCookie(reply);
      return sendProblem(request, reply, 'authenticationRequired');
    }

    reply.code(response.status).header('cache-control', 'no-store');
    for (const name of forwardedResponseHeaders) {
      const value = response.headers.get(name);
      if (value !== null) {
        reply.header(name, value);
      }
    }
    return reply.send(Buffer.from(await response.arrayBuffer()));
  });

  done();
}
