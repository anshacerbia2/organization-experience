import type { FastifyReply, FastifyRequest } from 'fastify';

// RFC 7807 problem documents, with the types of foundation-platform's registry
// (httpapi/problem.go). foundation-platform is a Go module, so the same URIs, titles and statuses
// are written here rather than imported; a client reading a problem from this BFF or from the
// Identity Control API behind it reads the same vocabulary.
export const problemTypes = {
  validationFailed: {
    uri: 'https://problems.scnehaux.com/validation-failed',
    title: 'The request is invalid',
    status: 400,
  },
  authenticationRequired: {
    uri: 'https://problems.scnehaux.com/authentication-required',
    title: 'Authentication is required',
    status: 401,
  },
  forbidden: {
    uri: 'https://problems.scnehaux.com/forbidden',
    title: 'The operation is forbidden',
    status: 403,
  },
  notFound: {
    uri: 'https://problems.scnehaux.com/not-found',
    title: 'The requested resource was not found',
    status: 404,
  },
  dependencyUnavailable: {
    uri: 'https://problems.scnehaux.com/dependency-unavailable',
    title: 'A required dependency is unavailable',
    status: 503,
  },
  internal: {
    uri: 'https://problems.scnehaux.com/internal',
    title: 'An internal error occurred',
    status: 500,
  },
} as const;

export type ProblemType = keyof typeof problemTypes;

export interface ProblemDocument {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly instance: string;
  readonly correlation_id: string;
}

// sendProblem writes a problem document. detail never echoes request input: an error path is
// where a credential escapes, so a message names a rule, not a value.
export function sendProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  type: ProblemType,
  detail?: string,
): FastifyReply {
  const definition = problemTypes[type];
  const body: ProblemDocument = {
    type: definition.uri,
    title: definition.title,
    status: definition.status,
    ...(detail === undefined ? {} : { detail }),
    instance: request.url.split('?')[0] ?? '/',
    correlation_id: request.id,
  };
  return reply
    .code(definition.status)
    .header('content-type', 'application/problem+json; charset=utf-8')
    .header('cache-control', 'no-store')
    .send(body);
}
