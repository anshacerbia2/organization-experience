import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  calculateJwkThumbprint,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  jwtVerify,
  SignJWT,
  type CryptoKey,
  type JWTPayload,
} from 'jose';

import { testClientKey } from './client-key.js';

// A stand-in for the identity kernel's realm: the Keycloak endpoints the BFF calls, signing with
// PS256 as STD-IAM-002 requires. It is a test double of the protocol, not of Keycloak: it enforces
// what the BFF must get right (client authentication, PKCE, the exact redirect URI) and lets a
// test bend what the BFF must refuse (a wrong nonce, issuer, audience, key or algorithm).

export interface User {
  readonly sub: string;
  readonly principalId: string;
  readonly name: string;
}

export const defaultUser: User = { sub: 'kc-user-1', principalId: 'prn_01TESTPRINCIPAL', name: 'Ada Admin' };

type Signer = 'realm' | 'foreign' | 'rs256';

// IdTokenTamper changes the next ID token the token endpoint issues.
export interface IdTokenTamper {
  readonly claims?: JWTPayload;
  readonly signer?: Signer;
}

export type RefreshBehaviour = 'rotate' | 'invalid_grant' | 'unavailable';

interface PendingCode {
  readonly user: User;
  readonly sid: string;
  // acr is the level the request asked for, which the kernel's flow reaches; aal1 otherwise.
  readonly acr: string;
  readonly nonce: string;
  readonly challenge: string;
  readonly redirectUri: string;
}

interface Grant {
  readonly user: User;
  readonly sid: string;
  readonly acr: string;
}

const base64url = (buffer: Buffer): string => buffer.toString('base64url');

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

export class IdentityProvider {
  // lastAuthorization is the query of the latest authorization request, for asserting what it asked.
  lastAuthorization: URLSearchParams | null = null;
  readonly clientId = 'identity-experience';
  // Every client assertion the BFF presented, so a test can see it never repeats one.
  readonly assertionIds = new Set<string>();
  readonly accessTokenLifetimeSeconds = 240;

  issuer = '';
  refreshBehaviour: RefreshBehaviour = 'rotate';
  refreshCalls = 0;
  // codeExchangeUnavailable answers the code exchange with a 503, as a kernel mid-restart does.
  codeExchangeUnavailable = false;
  // refreshDelayMs holds a refresh open, so concurrent requests overlap on it.
  refreshDelayMs = 0;
  tamper: IdTokenTamper | null = null;
  readonly endedSessions = new Set<string>();

  #server: Server | null = null;
  #keys = new Map<
    Signer,
    { kid: string; alg: 'PS256' | 'RS256'; privateKey: CryptoKey; publicJwk: object }
  >();
  #codes = new Map<string, PendingCode>();
  #refreshTokens = new Map<string, Grant>();
  // The access tokens issued, so a test can scan every response for them.
  readonly issuedSecrets = new Set<string>();

  async start(): Promise<void> {
    for (const [signer, alg] of [
      ['realm', 'PS256'],
      ['foreign', 'PS256'],
      ['rs256', 'RS256'],
    ] as const) {
      const { privateKey, publicKey } = await generateKeyPair(alg, { modulusLength: 3072 });
      // The foreign key reuses the realm's kid: the BFF must refuse it on the signature, not on a
      // key it cannot find.
      const kid = signer === 'foreign' ? 'realm-key' : `${signer}-key`;
      this.#keys.set(signer, {
        kid,
        alg,
        privateKey,
        publicJwk: { ...(await exportJWK(publicKey)), kid, alg, use: 'sig' },
      });
    }
    this.#server = createServer((request, response) => {
      this.#handle(request)
        .then(({ status, body }) => {
          if (status === 204) {
            response.writeHead(204).end();
            return;
          }
          response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          response.end(JSON.stringify(body));
        })
        .catch((error: unknown) => {
          response.writeHead(500);
          response.end(String(error));
        });
    });
    await new Promise<void>((resolve) => this.#server?.listen(0, '127.0.0.1', resolve));
    const { port } = this.#server.address() as AddressInfo;
    this.issuer = `http://127.0.0.1:${port}/realms/test`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.#server === null) {
        resolve();
        return;
      }
      this.#server.close(() => {
        resolve();
      });
    });
  }

  // authorize plays the user signing in on the hosted page: it checks the authorization request
  // and returns the query the browser brings back to the callback.
  authorize(authorizationUrl: string, user: User = defaultUser): string {
    const url = new URL(authorizationUrl);
    const params = url.searchParams;
    if (`${url.origin}${url.pathname}` !== `${this.issuer}/protocol/openid-connect/auth`) {
      throw new Error(`authorization request sent to ${url.origin}${url.pathname}`);
    }
    if (
      params.get('client_id') !== this.clientId ||
      params.get('response_type') !== 'code' ||
      params.get('code_challenge_method') !== 'S256' ||
      !(params.get('scope') ?? '').split(' ').includes('openid')
    ) {
      throw new Error(`authorization request refused: ${params.toString()}`);
    }
    const code = randomUUID();
    this.lastAuthorization = params;
    this.#codes.set(code, {
      user,
      sid: randomUUID(),
      acr: params.get('acr_values') ?? 'aal1',
      nonce: params.get('nonce') ?? '',
      challenge: params.get('code_challenge') ?? '',
      redirectUri: params.get('redirect_uri') ?? '',
    });
    return `?${new URLSearchParams({ code, state: params.get('state') ?? '', iss: this.issuer }).toString()}`;
  }

  // sessionOf is the Keycloak session a refresh token belongs to, for building a logout token.
  sessionOfLatest(): Grant {
    const grants = [...this.#refreshTokens.values()];
    const latest = grants.at(-1);
    if (latest === undefined) {
      throw new Error('no session issued');
    }
    return latest;
  }

  async logoutToken(claims: JWTPayload, signer: Signer = 'realm'): Promise<string> {
    return this.#sign(
      {
        iss: this.issuer,
        aud: this.clientId,
        iat: Math.floor(Date.now() / 1000),
        jti: randomUUID(),
        events: { 'http://schemas.openid.net/event/backchannel-logout': {} },
        ...claims,
      },
      signer,
    );
  }

  async #handle(request: IncomingMessage): Promise<{ status: number; body: unknown }> {
    const path = new URL(request.url ?? '/', 'http://provider').pathname;
    if (request.method === 'GET' && path === '/realms/test/protocol/openid-connect/certs') {
      // The foreign key is never published: it is the attacker's.
      const published = [...this.#keys.entries()].filter(([signer]) => signer !== 'foreign');
      return { status: 200, body: { keys: published.map(([, key]) => key.publicJwk) } };
    }
    if (request.method === 'POST' && path === '/realms/test/protocol/openid-connect/token') {
      return this.#token(request);
    }
    if (request.method === 'POST' && path === '/realms/test/protocol/openid-connect/logout') {
      return this.#logout(request);
    }
    return { status: 404, body: { error: 'not_found' } };
  }

  // #authenticated checks the client the way the kernel checks a private_key_jwt client: a PS256
  // assertion signed by the key registered on the client, whose kid is that key's thumbprint, naming
  // the client as iss and sub and this realm's issuer as aud, never seen before. A request that
  // also carries a secret, in the body or as Basic, is refused: this client has none.
  async #authenticated(request: IncomingMessage, form: URLSearchParams): Promise<boolean> {
    if (request.headers.authorization !== undefined || form.has('client_secret')) {
      return false;
    }
    const assertion = form.get('client_assertion') ?? '';
    if (
      form.get('client_assertion_type') !== 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer' ||
      assertion === ''
    ) {
      return false;
    }
    try {
      const { publicKey } = testClientKey();
      const header = decodeProtectedHeader(assertion);
      const registeredKid = await calculateJwkThumbprint(publicKey.export({ format: 'jwk' }));
      const { payload } = await jwtVerify(assertion, publicKey, {
        algorithms: ['PS256'],
        issuer: this.clientId,
        subject: this.clientId,
        audience: this.issuer,
      });
      if (
        header.kid !== registeredKid ||
        typeof payload.jti !== 'string' ||
        this.assertionIds.has(payload.jti)
      ) {
        return false;
      }
      this.assertionIds.add(payload.jti);
      return true;
    } catch {
      return false;
    }
  }

  // Keycloak's logout endpoint, called by a confidential client with a refresh token: the user
  // session it belongs to ends, and every refresh token of it with it.
  async #logout(request: IncomingMessage): Promise<{ status: number; body: unknown }> {
    const form = new URLSearchParams(await readBody(request));
    if (!(await this.#authenticated(request, form))) {
      return { status: 401, body: { error: 'invalid_client' } };
    }
    const grant = this.#refreshTokens.get(form.get('refresh_token') ?? '');
    if (grant === undefined) {
      return { status: 400, body: { error: 'invalid_grant' } };
    }
    this.endedSessions.add(grant.sid);
    for (const [token, candidate] of this.#refreshTokens) {
      if (candidate.sid === grant.sid) {
        this.#refreshTokens.delete(token);
      }
    }
    return { status: 204, body: null };
  }

  async #token(request: IncomingMessage): Promise<{ status: number; body: unknown }> {
    const form = new URLSearchParams(await readBody(request));
    if (!(await this.#authenticated(request, form))) {
      return { status: 401, body: { error: 'invalid_client' } };
    }

    if (form.get('grant_type') === 'authorization_code' && this.codeExchangeUnavailable) {
      return { status: 503, body: { error: 'temporarily_unavailable' } };
    }
    if (form.get('grant_type') === 'authorization_code') {
      const pending = this.#codes.get(form.get('code') ?? '');
      this.#codes.delete(form.get('code') ?? '');
      const verifier = form.get('code_verifier') ?? '';
      if (
        pending === undefined ||
        base64url(createHash('sha256').update(verifier).digest()) !== pending.challenge ||
        form.get('redirect_uri') !== pending.redirectUri
      ) {
        return { status: 400, body: { error: 'invalid_grant' } };
      }
      return {
        status: 200,
        body: await this.#tokens({ user: pending.user, sid: pending.sid, acr: pending.acr }, pending.nonce),
      };
    }

    if (form.get('grant_type') === 'refresh_token') {
      this.refreshCalls += 1;
      if (this.refreshDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.refreshDelayMs));
      }
      const presented = form.get('refresh_token') ?? '';
      const grant = this.#refreshTokens.get(presented);
      if (this.refreshBehaviour === 'unavailable') {
        return { status: 503, body: { error: 'temporarily_unavailable' } };
      }
      if (grant === undefined || this.refreshBehaviour === 'invalid_grant') {
        return { status: 400, body: { error: 'invalid_grant', error_description: 'Session not active' } };
      }
      // Rotation: the presented refresh token is spent.
      this.#refreshTokens.delete(presented);
      return { status: 200, body: await this.#tokens(grant, null) };
    }
    return { status: 400, body: { error: 'unsupported_grant_type' } };
  }

  async #tokens(grant: Grant, nonce: string | null): Promise<object> {
    const now = Math.floor(Date.now() / 1000);
    const tamper = this.tamper;
    this.tamper = null;
    const idToken = await this.#sign(
      {
        iss: this.issuer,
        aud: this.clientId,
        azp: this.clientId,
        sub: grant.user.sub,
        iat: now,
        exp: now + 300,
        auth_time: now,
        acr: grant.acr,
        sid: grant.sid,
        principal_id: grant.user.principalId,
        provider_scope: 'platform',
        name: grant.user.name,
        ...(nonce === null ? {} : { nonce }),
        ...tamper?.claims,
      },
      tamper?.signer ?? 'realm',
    );
    const accessToken = await this.#sign(
      {
        iss: this.issuer,
        aud: 'identity-control',
        sub: grant.user.sub,
        iat: now,
        exp: now + this.accessTokenLifetimeSeconds,
        principal_id: grant.user.principalId,
        provider_scope: 'platform',
        sid: grant.sid,
      },
      'realm',
    );
    const refreshToken = randomBytes(32).toString('base64url');
    this.#refreshTokens.set(refreshToken, grant);
    for (const secret of [idToken, accessToken, refreshToken]) {
      this.issuedSecrets.add(secret);
    }
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.accessTokenLifetimeSeconds,
      refresh_token: refreshToken,
      id_token: idToken,
      scope: 'openid scnehaux-provider',
    };
  }

  async #sign(claims: JWTPayload, signer: Signer): Promise<string> {
    const key = this.#keys.get(signer);
    if (key === undefined) {
      throw new Error(`no ${signer} key`);
    }
    return new SignJWT(claims)
      .setProtectedHeader({ alg: key.alg, kid: key.kid, typ: 'JWT' })
      .sign(key.privateKey);
  }
}
