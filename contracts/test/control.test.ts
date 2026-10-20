import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrganizationControl } from '../../bff/src/scope/control.ts';
import { organizationControl as contract } from '../src/load.ts';

// The BFF's own calls to Organization Control, bff/src/scope/control.ts, against the published
// specification (ADR-GLB-010 §5.1, TDD-organization-experience-001 1.12.0 §API / Interface). A stand-in
// records each request and answers with a body the specification's response schema accepts; the test
// fails when a request is not an operation the specification declares as sent, or when the client reads
// a spec-valid answer as something other than what it says.

const grantId = '0192f0e0-baba-7000-8000-00000000ba01';
const activationId = '0192f0e0-9999-7000-8000-000000009001';
const me = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4aaa';
const now = '2026-10-21T10:00:00Z';
const later = '2026-10-21T10:30:00Z';

const activation = (overrides: Record<string, unknown> = {}) => ({
  activation_id: activationId,
  grant_id: grantId,
  principal_id: me,
  scope: 'provider:organization-control',
  reason: 'Investigating a stuck offboarding',
  duration_seconds: 1800,
  approval_required: true,
  requested_at: now,
  decision: 'approved',
  decided_by: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4bbb',
  decision_reason: 'Ticket 4471',
  decided_at: now,
  ends_at: later,
  in_force: true,
  ended_by: null,
  ended_at: null,
  ...overrides,
});

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

// stand answers each request from the table, after checking the answer against the specification, so
// a test cannot pass on an answer Organization Control would never give.
function stand(answers: Readonly<Record<string, { status: number; body: unknown }>>) {
  const recorded: Recorded[] = [];
  const problems: string[] = [];
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    const path = `${url.pathname}${url.search}`;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    recorded.push({ method, path, headers, body });
    problems.push(...contract.checkRequest({ method, path, headers, body }));
    const answer = answers[`${method} ${url.pathname}`];
    if (answer === undefined) {
      return Promise.resolve(new Response('{}', { status: 404 }));
    }
    problems.push(...contract.checkResponse(method, url.pathname, answer.status, answer.body));
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  return { recorded, problems };
}

const call = {
  accessToken: 'access-token',
  reason: 'Investigating a stuck offboarding',
  correlationId: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4aff',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bff/src/scope/control.ts against organization-control’s specification', () => {
  const control = new OrganizationControl('https://organization-control.test', 5_000);

  it('reads the operator’s own grants as served', async () => {
    const { problems } = stand({
      'GET /v1/provider-activations/grants': {
        status: 200,
        body: {
          grants: [
            { grant_id: grantId, scope: 'provider:organization-control', kind: 'eligible', granted_at: now },
          ],
        },
      },
    });
    expect(await control.ownGrants(call)).toEqual([
      { grantId, scope: 'provider:organization-control', kind: 'eligible' },
    ]);
    expect(problems).toEqual([]);
  });

  it('requests an activation with the declared body and key, and reads the answer', async () => {
    const { problems, recorded } = stand({
      'POST /v1/provider-activations': {
        status: 201,
        body: activation({
          decision: undefined,
          decided_by: null,
          decided_at: null,
          ends_at: null,
          in_force: false,
        }),
      },
    });
    const answered = await control.requestActivation(
      { ...call, idempotencyKey: call.correlationId },
      grantId,
      1800,
    );
    expect(answered).toEqual({
      activationId,
      decision: null,
      endsAt: null,
      inForce: false,
      endedAt: null,
    });
    expect(recorded[0]?.headers['idempotency-key']).toBe(call.correlationId);
    expect(problems).toEqual([]);
  });

  it('reads one activation from the list, and ends it', async () => {
    const { problems } = stand({
      'GET /v1/provider-activations': { status: 200, body: { activations: [activation()] } },
      [`POST /v1/provider-activations/${activationId}/end`]: {
        status: 200,
        body: activation({ in_force: false, ended_by: me, ended_at: later }),
      },
    });
    expect(await control.activation(call, activationId)).toEqual({
      activationId,
      decision: 'approved',
      endsAt: new Date(later),
      inForce: true,
      endedAt: null,
    });
    await control.endActivation(call, activationId);
    expect(problems).toEqual([]);
  });

  it('every path it writes under /v1/ is one the specification serves', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../../bff/src/scope/control.ts', import.meta.url), 'utf8');
    const written = [...source.matchAll(/[`'](\/[a-z-]+(?:\/[^`'\s]*)?)[`']/g)]
      .map((found) => found[1] ?? '')
      .filter((path) => path.startsWith('/provider-'))
      .map((path) => `/v1${path.replace(/\$\{[^}]+\}/g, 'x')}`);
    expect(written.length).toBeGreaterThanOrEqual(3);
    expect(written.filter((path) => !contract.pathExists(path))).toEqual([]);
  });
});
