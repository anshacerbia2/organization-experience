import type { FastifyInstance } from 'fastify';

import { sendProblem } from './problem.js';

// Paths reached on an internal address rather than the public origin: an orchestrator's probe, and
// the identity kernel's back-channel logout. Redirecting either would break it, and neither is a
// browser that could carry a session to the wrong host.
const internalPaths = new Set(['/healthz', '/auth/back-channel-logout']);

// registerCanonicalHost answers only on the public origin's host. The session and login cookies
// are __Host- cookies, bound to the exact host that set them, and the Origin check compares
// against the exact origin. So a browser that arrives on another name for the same process —
// localhost where the origin says 127.0.0.1 — is signed out there, and a sign-in started there
// fails at the callback. A page request is sent to the public origin before anything else runs;
// any other request is refused.
export function registerCanonicalHost(app: FastifyInstance, publicOrigin: string): void {
  const origin = new URL(publicOrigin);
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '/';
    if (internalPaths.has(path)) {
      return;
    }
    // Parsed with the public origin's scheme, so a default port written out (`localhost:80`) and
    // one left implicit compare equal.
    let host: string | null = null;
    try {
      host = new URL(`${origin.protocol}//${request.headers.host ?? ''}`).host;
    } catch {
      host = null;
    }
    if (host === origin.host) {
      return;
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      return reply.header('cache-control', 'no-store').redirect(`${origin.origin}${request.url}`, 308);
    }
    return sendProblem(request, reply, 'validationFailed', `This service answers on ${origin.origin} only`);
  });
}
