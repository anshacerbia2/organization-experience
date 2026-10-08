import type { FastifyBaseLogger } from 'fastify';

import { OidcError, type Grant, type Identity, type Oidc } from '../auth/oidc.js';
import type { SessionConfig } from '../config.js';
import { digest, randomToken } from './seal.js';
import { UnreadableSession, type SessionRecord, type SessionStore } from './store.js';

// Sessions decides what a session is: when it starts, when it is still valid, when its access
// token is refreshed, and that a refused refresh ends it (TDD-identity-experience-001 §Refresh).
export class Sessions {
  readonly #store: SessionStore;
  readonly #config: SessionConfig;
  readonly #oidc: Oidc;
  readonly #now: () => Date;

  constructor(store: SessionStore, config: SessionConfig, oidc: Oidc, now: () => Date) {
    this.#store = store;
    this.#config = config;
    this.#oidc = oidc;
    this.#now = now;
  }

  // start creates a session for a completed sign-in and returns the cookie value. The value exists
  // only in the response that sets it; the store keeps its digest.
  async start(grant: Grant & { identity: Identity }): Promise<{ cookie: string; session: SessionRecord }> {
    const cookie = randomToken();
    const now = this.#now();
    const absoluteExpiresAt = new Date(now.getTime() + this.#config.absoluteMs);
    const session: SessionRecord = {
      idHash: digest(cookie),
      ...grant.identity,
      tokens: grant.tokens,
      accessExpiresAt: grant.accessExpiresAt,
      csrfToken: randomToken(),
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: this.#idleExpiry(now, absoluteExpiresAt),
      absoluteExpiresAt,
    };
    await this.#store.create(session);
    return { cookie, session };
  }

  // resolve finds the session a cookie names, or null. An expired session is destroyed on the way
  // out, so it is refused once and then gone. `activity` extends the idle expiry; reading the
  // session's display context is not activity, or a tab left open would never go idle.
  //
  // A row that does not open under the session key is no session: its holder is signed out and
  // signs in again. The row is left for the purge, because a replica holding the wrong key would
  // otherwise delete sessions every other replica can read (TDD-identity-experience-001
  // §Server-Side Session). A store that does not answer throws SessionStoreUnavailable.
  async resolve(
    cookie: string | undefined,
    activity: boolean,
    log?: FastifyBaseLogger,
  ): Promise<SessionRecord | null> {
    if (cookie === undefined || cookie === '') {
      return null;
    }
    let session: SessionRecord | null;
    try {
      session = await this.#store.find(digest(cookie));
    } catch (error) {
      if (!(error instanceof UnreadableSession)) {
        throw error;
      }
      log?.warn({ err: error }, 'session unreadable under the session key; treated as signed out');
      return null;
    }
    if (session === null) {
      return null;
    }
    const now = this.#now();
    if (now >= session.idleExpiresAt || now >= session.absoluteExpiresAt) {
      await this.#store.destroy(session.idHash);
      return null;
    }
    if (!activity) {
      return session;
    }
    const idleExpiresAt = this.#idleExpiry(now, session.absoluteExpiresAt);
    await this.#store.touch(session.idHash, now, idleExpiresAt);
    return { ...session, lastSeenAt: now, idleExpiresAt };
  }

  // fresh returns the session with an access token that outlives the skew window, refreshing it
  // server-side when it does not. A refused refresh destroys the session and returns null: it is
  // how a revoked Membership or a removed Keycloak session reaches an open tab.
  async fresh(session: SessionRecord, log: FastifyBaseLogger): Promise<SessionRecord | null> {
    if (!this.#nearExpiry(session)) {
      return session;
    }
    try {
      return await this.#store.updateTokensLocked(session.idHash, async (current) => {
        // Another request refreshed while this one waited for the lock.
        if (!this.#nearExpiry(current)) {
          return null;
        }
        const grant = await this.#oidc.refresh(current.tokens);
        // A refresh keeps the Tenant it was issued for, or drops it (ADR-IAM-006 §5.2). One that
        // returns another, or none, is not the session that signed in, and ends it (ADR-IAM-008).
        if (grant.identity !== null && grant.identity.tenantId !== current.tenantId) {
          throw new OidcError('the refresh returned a token for another Tenant than the session holds');
        }
        return {
          tokens: grant.tokens,
          accessExpiresAt: grant.accessExpiresAt,
          acr: grant.identity?.acr ?? current.acr,
          authTime: grant.identity?.authTime ?? current.authTime,
        };
      });
    } catch (error) {
      // A row that stopped opening under the key between the read and the lock is no session.
      if (error instanceof UnreadableSession) {
        log.warn({ err: error }, 'session unreadable under the session key; treated as signed out');
        return null;
      }
      // Only a refusal by the identity kernel ends the session. A store failure is an outage, not
      // a revocation, and answers as one.
      if (!(error instanceof OidcError)) {
        throw error;
      }
      log.warn({ err: error }, 'refresh refused; the session is destroyed');
      await this.#store.destroy(session.idHash);
      return null;
    }
  }

  async destroy(session: SessionRecord): Promise<void> {
    await this.#store.destroy(session.idHash);
  }

  #nearExpiry(session: SessionRecord): boolean {
    return session.accessExpiresAt.getTime() - this.#now().getTime() <= this.#config.refreshSkewMs;
  }

  #idleExpiry(now: Date, absoluteExpiresAt: Date): Date {
    return new Date(Math.min(now.getTime() + this.#config.idleMs, absoluteExpiresAt.getTime()));
  }
}
