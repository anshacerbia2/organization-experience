import { describe, expect, it } from 'vitest';

import { organizationControl as contract } from '../src/load.ts';

// The checker itself: it finds the operations, and it refuses what Organization Control refuses.
describe('the Organization Control contract', () => {
  it('reads the pinned specification', () => {
    expect(contract.version).toBe('1.0.0');
    expect(contract.paths).toContain('/v1/reporters');
  });

  it('prefers a literal path to a template that also matches it', () => {
    expect(contract.match('POST', '/v1/invitations/accept')?.template).toBe('/v1/invitations/accept');
    expect(contract.match('GET', '/v1/privileged-access:unreviewed')?.template).toBe(
      '/v1/privileged-access:unreviewed',
    );
  });

  it('accepts a command as the specification declares it', () => {
    expect(
      contract.checkRequest({
        method: 'POST',
        path: '/v1/reporters',
        headers: { 'Idempotency-Key': 'k' },
        body: {
          principal_id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4aaa',
          reports: 'obligation:billing',
          purpose: 'Bills',
        },
      }),
    ).toEqual([]);
  });

  it('refuses an unknown field, a missing key, an unknown query parameter and an unserved route', () => {
    const problems = [
      ...contract.checkRequest({
        method: 'POST',
        path: '/v1/reporters',
        headers: {},
        body: { principal_id: 'not-a-uuid', reports: 'obligation:Billing', purpose: 'x', extra: 1 },
      }),
      ...contract.checkRequest({
        method: 'GET',
        path: '/v1/reporters?colour=red',
        headers: {},
        body: undefined,
      }),
      ...contract.checkRequest({ method: 'GET', path: '/v1/nowhere', headers: {}, body: undefined }),
      ...contract.checkRequest({
        method: 'GET',
        path: '/v1/reporters',
        headers: { 'idempotency-key': 'k' },
        body: undefined,
      }),
    ];
    expect(problems.join('\n')).toMatch(/must NOT have additional properties/);
    expect(problems.join('\n')).toMatch(/must match format "uuid"/);
    expect(problems.join('\n')).toMatch(/must match pattern/);
    expect(problems.join('\n')).toMatch(/sends no Idempotency-Key/);
    expect(problems.join('\n')).toMatch(/query parameter colour is not declared/);
    expect(problems.join('\n')).toMatch(/GET \/v1\/nowhere: no operation/);
    expect(problems.join('\n')).toMatch(/sends an Idempotency-Key the operation does not take/);
  });

  it('checks an answer against the response schema of its status', () => {
    expect(contract.checkResponse('GET', '/v1/reporters', 200, { reporters: [], next: null })).toEqual([]);
    expect(contract.checkResponse('GET', '/v1/reporters', 200, { reporters: [{}] }).join('\n')).toMatch(
      /must have required property/,
    );
    expect(contract.checkResponse('GET', '/v1/reporters', 418, {}).join('\n')).toMatch(/declares no 418/);
  });
});
