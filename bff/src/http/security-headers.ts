import type { FastifyInstance } from 'fastify';

// Every response carries these headers (TDD-identity-experience-001 §Security Headers). They are
// set in an onSend hook rather than per route, so a route added later, a 404, a static file and
// an error document all carry them without anyone remembering to.
//
// The policy has no 'unsafe-inline' and no 'unsafe-eval'. The browser application is built as
// files served from this origin, so every script, stylesheet and font is 'self'. default-src
// 'none' falls back for any directive not named here, which is why each one is named.
export const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const securityHeaders: Readonly<Record<string, string>> = {
  'content-security-policy': contentSecurityPolicy,
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(securityHeaders)) {
      reply.header(name, value);
    }
    return payload;
  });
}
