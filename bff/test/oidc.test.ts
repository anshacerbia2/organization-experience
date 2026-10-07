import { createServer } from 'node:net';

import { describe, expect, it } from 'vitest';

import { testClientKey } from './support/client-key.js';
import { IdentityProviderUnavailable, isOutage, Oidc, OidcError } from '../src/auth/oidc.js';

describe('isOutage', () => {
  it('is an outage when no answer came: a refused, stalled or unresolved connection, or a timeout', () => {
    for (const code of ['ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'ENOTFOUND', 'ECONNRESET']) {
      const cause = Object.assign(new Error(code), { code });
      expect(isOutage(new TypeError('fetch failed', { cause })), code).toBe(true);
    }
    expect(isOutage(new DOMException('timed out', 'TimeoutError'))).toBe(true);
    // As openid-client wraps a failed key fetch: a processing error, its cause the fetch error.
    expect(isOutage(new Error('processing', { cause: new TypeError('fetch failed') }))).toBe(true);
  });

  it('is an outage when the kernel answered with a 5xx', () => {
    expect(isOutage(new Error('unexpected status', { cause: new Response(null, { status: 503 }) }))).toBe(
      true,
    );
  });

  it('is a refusal otherwise, a failed validation above all', () => {
    expect(isOutage(new Error('unexpected ID Token "nonce" claim value'))).toBe(false);
    expect(isOutage(new Error('unexpected status', { cause: new Response(null, { status: 400 }) }))).toBe(
      false,
    );
    expect(isOutage('not even an error')).toBe(false);
  });
});

// The sign-in on 2026-09-29 that failed: the tunnel dropped the connection mid-exchange. Here the
// kernel's address is a port nothing listens on.
it('reports a kernel that cannot be reached at the code exchange as unavailable, not as a refusal', async () => {
  const port = await new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        resolve(typeof address === 'object' && address !== null ? address.port : 0);
      });
    });
  });
  const issuer = `http://127.0.0.1:${String(port)}/realms/test`;
  const oidc = new Oidc(
    {
      issuer,
      internalBaseUrl: issuer,
      clientId: 'identity-experience',
      clientKey: testClientKey().key,
      redirectUri: 'http://localhost/auth/callback',
    },
    () => new Date(),
  );
  const query = `?${new URLSearchParams({ code: 'c', state: 's', iss: issuer }).toString()}`;
  const outcome = await oidc.exchange(query, { state: 's', nonce: 'n', codeVerifier: 'v'.repeat(43) }).then(
    () => null,
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(IdentityProviderUnavailable);
  expect(outcome).not.toBeInstanceOf(OidcError);
});
