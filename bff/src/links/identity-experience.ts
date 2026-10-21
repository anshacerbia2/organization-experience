// GET /auth/identity-experience: identity-experience's public origin, for the invitation acceptance
// page's "I do not have an account", which links to <origin>/account/enrol#<token> (ADR-IAM-011 §5.1;
// TDD-organization-experience-001 1.15.0 §API / Interface). The origin is configuration, because it
// differs per deployment and the build is one artifact for all of them.
//
// Anonymous: it reads no session and no cookie, and answers the same to everyone. The token never
// reaches it: the page holds the token and builds the link itself.
import type { FastifyInstance } from 'fastify';

export interface IdentityExperienceRouteOptions {
  readonly origin: string;
}

export function identityExperienceRoute(
  app: FastifyInstance,
  options: IdentityExperienceRouteOptions,
  done: () => void,
): void {
  const body = { origin: options.origin };
  app.get('/auth/identity-experience', async (_request, reply) =>
    reply.header('cache-control', 'no-store').send(body),
  );
  done();
}
