import type { FastifyRequest } from 'fastify';

import { equalSecrets } from '../session/seal.js';
import type { SessionRecord } from '../session/store.js';

// The request header the browser application echoes the session's CSRF token in.
export const csrfHeader = 'x-csrf-token';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export const isStateChanging = (request: FastifyRequest): boolean => !safeMethods.has(request.method);

// originAllowed is the second of the three checks (TDD-identity-experience-001 §Cross-Site Request
// Forgery Defence). A state-changing request with no Origin is refused rather than allowed: every
// browser this application supports sends one on a non-GET fetch, so its absence is the anomaly.
export const originAllowed = (request: FastifyRequest, publicOrigin: string): boolean =>
  request.headers.origin === publicOrigin;

// csrfTokenValid is the third: the token /auth/session delivered, echoed in a header a cross-site
// page cannot set, compared in constant time.
export const csrfTokenValid = (request: FastifyRequest, session: SessionRecord): boolean => {
  const presented = request.headers[csrfHeader];
  return typeof presented === 'string' && presented !== '' && equalSecrets(presented, session.csrfToken);
};
