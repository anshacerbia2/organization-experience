import pg, { type Pool, type PoolClient } from 'pg';

import type { Sealer } from './seal.js';

// SessionStoreUnavailable is the session store not answering: no connection, a connection lost, or
// the server refusing work for want of resources or by an operator's hand. It is an outage, not a
// fault in the request, and the BFF answers it 503 (TDD-identity-experience-001 §Session-Store
// Outage). The driver's own error is its cause, for the log.
export class SessionStoreUnavailable extends Error {
  override readonly name = 'SessionStoreUnavailable';

  constructor(cause: unknown) {
    super('the session store is unavailable', { cause });
  }
}

// UnreadableSession is a row whose sealed tokens do not open under the current session key: the key
// was changed, or the row was altered. Nothing it holds can be used, so the session is treated as
// signed out (TDD-identity-experience-001 §Server-Side Session).
export class UnreadableSession extends Error {
  override readonly name = 'UnreadableSession';

  constructor(cause: unknown) {
    super('the session row does not open under the session key', { cause });
  }
}

// The SQLSTATE classes that say the server cannot do the work now, whatever the statement: 08
// connection exception, 53 insufficient resources, 57 operator intervention (a shutdown, a
// cancelled query), 58 system error (PostgreSQL Appendix A). Any other server error is a fault in
// what was asked, and stays one.
const outageClasses = new Set(['08', '53', '57', '58']);

// isStoreOutage classifies what the driver threw. An error the server did not write, such as a
// refused or dropped connection or a pool timeout, is the store not answering.
export function isStoreOutage(error: unknown): boolean {
  if (error instanceof pg.DatabaseError) {
    return outageClasses.has((error.code ?? '').slice(0, 2));
  }
  return error instanceof Error;
}

// reached runs one call to the store and names an outage as one.
async function reached<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw isStoreOutage(error) ? new SessionStoreUnavailable(error) : error;
  }
}

// TokenSet is what the BFF holds for a session and the browser never sees.
export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
}

export interface SessionRecord {
  readonly idHash: Buffer;
  readonly subject: string;
  readonly principalId: string | null;
  readonly displayName: string | null;
  readonly keycloakSessionId: string | null;
  readonly acr: string | null;
  readonly authTime: Date | null;
  // tenantId is the Tenant the session's tokens were issued for; null for the provider-scope form.
  readonly tenantId: string | null;
  readonly tokens: TokenSet;
  readonly accessExpiresAt: Date;
  readonly csrfToken: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export interface LoginState {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly returnTo: string;
  readonly expiresAt: Date;
  // maxAge is a step-up's allowable time since the last authentication, in seconds; null for a
  // plain sign-in (TDD-identity-experience-001 §Step-Up).
  readonly maxAge: number | null;
  // acrValues is the level the sign-in asked for (ADR-IAM-004); null for none.
  readonly acrValues: string | null;
  // tenantId is the Tenant the sign-in asked for (ADR-IAM-008); null for the provider-scope form.
  readonly tenantId: string | null;
}

// TokenUpdate is what a refresh writes back: the new tokens and what they assert.
export interface TokenUpdate {
  readonly tokens: TokenSet;
  readonly accessExpiresAt: Date;
  readonly acr: string | null;
  readonly authTime: Date | null;
}

interface SessionRow {
  id_hash: Buffer;
  subject: string;
  principal_id: string | null;
  display_name: string | null;
  keycloak_session_id: string | null;
  acr: string | null;
  auth_time: Date | null;
  tenant_id: string | null;
  tokens: Buffer;
  access_expires_at: Date;
  csrf_token: string;
  created_at: Date;
  last_seen_at: Date;
  idle_expires_at: Date;
  absolute_expires_at: Date;
}

interface LoginStateRow {
  state: string;
  nonce: string;
  code_verifier: Buffer;
  return_to: string;
  expires_at: Date;
  max_age: number | null;
  acr_values: string | null;
  tenant_id: string | null;
}

const sessionColumns =
  'id_hash, subject, principal_id, display_name, keycloak_session_id, acr, auth_time, tenant_id, tokens, access_expires_at, csrf_token, created_at, last_seen_at, idle_expires_at, absolute_expires_at';

// SessionStore is the PostgreSQL session store. It knows rows and sealing; what makes a session
// valid, and when it is refreshed, is Sessions' business. Every method throws
// SessionStoreUnavailable when the store does not answer, and a read of a session row throws
// UnreadableSession when the row does not open.
export class SessionStore {
  readonly #pool: Pool;
  readonly #sealer: Sealer;

  constructor(pool: Pool, sealer: Sealer) {
    this.#pool = pool;
    this.#sealer = sealer;
  }

  async putLoginState(bindingHash: Buffer, login: LoginState): Promise<void> {
    await this.#query(
      `INSERT INTO login_states (binding_hash, state, nonce, code_verifier, return_to, expires_at, max_age, acr_values, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (binding_hash) DO UPDATE SET state = EXCLUDED.state, nonce = EXCLUDED.nonce,
         code_verifier = EXCLUDED.code_verifier, return_to = EXCLUDED.return_to, expires_at = EXCLUDED.expires_at,
         max_age = EXCLUDED.max_age, acr_values = EXCLUDED.acr_values, tenant_id = EXCLUDED.tenant_id`,
      [
        bindingHash,
        login.state,
        login.nonce,
        this.#sealer.seal(login.codeVerifier, bindingHash),
        login.returnTo,
        login.expiresAt,
        login.maxAge,
        login.acrValues,
        login.tenantId,
      ],
    );
  }

  // takeLoginState consumes the row: a callback is answered once, and a replayed one finds nothing.
  async takeLoginState(bindingHash: Buffer): Promise<LoginState | null> {
    const { rows } = await this.#query<LoginStateRow>(
      'DELETE FROM login_states WHERE binding_hash = $1 RETURNING state, nonce, code_verifier, return_to, expires_at, max_age, acr_values, tenant_id',
      [bindingHash],
    );
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    // A verifier sealed under a session key since changed does not open. The row is already
    // consumed, so the sign-in is one that cannot complete, as an expired one.
    let codeVerifier: string;
    try {
      codeVerifier = this.#sealer.open(row.code_verifier, bindingHash);
    } catch {
      return null;
    }
    return {
      state: row.state,
      nonce: row.nonce,
      codeVerifier,
      returnTo: row.return_to,
      expiresAt: row.expires_at,
      maxAge: row.max_age,
      acrValues: row.acr_values,
      tenantId: row.tenant_id,
    };
  }

  async create(session: SessionRecord): Promise<void> {
    await this.#query(
      `INSERT INTO sessions (${sessionColumns}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        session.idHash,
        session.subject,
        session.principalId,
        session.displayName,
        session.keycloakSessionId,
        session.acr,
        session.authTime,
        session.tenantId,
        this.#sealTokens(session.tokens, session.idHash),
        session.accessExpiresAt,
        session.csrfToken,
        session.createdAt,
        session.lastSeenAt,
        session.idleExpiresAt,
        session.absoluteExpiresAt,
      ],
    );
  }

  async find(idHash: Buffer): Promise<SessionRecord | null> {
    const { rows } = await this.#query<SessionRow>(
      `SELECT ${sessionColumns} FROM sessions WHERE id_hash = $1`,
      [idHash],
    );
    return rows[0] === undefined ? null : this.#record(rows[0]);
  }

  async touch(idHash: Buffer, lastSeenAt: Date, idleExpiresAt: Date): Promise<void> {
    await this.#query('UPDATE sessions SET last_seen_at = $2, idle_expires_at = $3 WHERE id_hash = $1', [
      idHash,
      lastSeenAt,
      idleExpiresAt,
    ]);
  }

  // updateTokensLocked runs update against the row under a row lock and writes back what it
  // returns. Two requests that find the same access token near expiry would otherwise both refresh,
  // and with refresh-token rotation the second would present a spent token and end the session.
  // Under the lock the second sees the first one's tokens and returns null: nothing to do.
  //
  // It resolves to the record as it stands afterwards, or null when the row is gone.
  async updateTokensLocked(
    idHash: Buffer,
    update: (current: SessionRecord) => Promise<TokenUpdate | null>,
  ): Promise<SessionRecord | null> {
    return this.#transaction(async (client) => {
      const { rows } = await reached(() =>
        client.query<SessionRow>(`SELECT ${sessionColumns} FROM sessions WHERE id_hash = $1 FOR UPDATE`, [
          idHash,
        ]),
      );
      if (rows[0] === undefined) {
        return null;
      }
      const current = this.#record(rows[0]);
      const next = await update(current);
      if (next === null) {
        return current;
      }
      await reached(() =>
        client.query(
          'UPDATE sessions SET tokens = $2, access_expires_at = $3, acr = $4, auth_time = $5 WHERE id_hash = $1',
          [idHash, this.#sealTokens(next.tokens, idHash), next.accessExpiresAt, next.acr, next.authTime],
        ),
      );
      return { ...current, ...next };
    });
  }

  async destroy(idHash: Buffer): Promise<void> {
    await this.#query('DELETE FROM sessions WHERE id_hash = $1', [idHash]);
  }

  // destroyForLogout ends the sessions a back-channel logout token names: the Keycloak session when
  // it carries one, and otherwise every session of the subject, as OpenID Connect Back-Channel
  // Logout 1.0 §2.6 requires of a token with no `sid`.
  async destroyForLogout(subject: string | null, keycloakSessionId: string | null): Promise<number> {
    const result =
      keycloakSessionId === null
        ? await this.#query('DELETE FROM sessions WHERE subject = $1', [subject])
        : subject === null
          ? await this.#query('DELETE FROM sessions WHERE keycloak_session_id = $1', [keycloakSessionId])
          : await this.#query('DELETE FROM sessions WHERE keycloak_session_id = $1 AND subject = $2', [
              keycloakSessionId,
              subject,
            ]);
    return result.rowCount ?? 0;
  }

  // purgeExpired removes what can no longer be used. A row past its expiry is already refused when
  // presented; this keeps the tables sized to the live population.
  async purgeExpired(now: Date): Promise<void> {
    await this.#query('DELETE FROM sessions WHERE idle_expires_at <= $1 OR absolute_expires_at <= $1', [now]);
    await this.#query('DELETE FROM login_states WHERE expires_at <= $1', [now]);
  }

  #query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>> {
    return reached(() => this.#pool.query<R>(text, values));
  }

  #sealTokens(tokens: TokenSet, idHash: Buffer): Buffer {
    return this.#sealer.seal(JSON.stringify(tokens), idHash);
  }

  #record(row: SessionRow): SessionRecord {
    let tokens: TokenSet;
    try {
      tokens = JSON.parse(this.#sealer.open(row.tokens, row.id_hash)) as TokenSet;
    } catch (error) {
      throw new UnreadableSession(error);
    }
    return {
      idHash: row.id_hash,
      subject: row.subject,
      principalId: row.principal_id,
      displayName: row.display_name,
      keycloakSessionId: row.keycloak_session_id,
      acr: row.acr,
      authTime: row.auth_time,
      tenantId: row.tenant_id,
      tokens,
      accessExpiresAt: row.access_expires_at,
      csrfToken: row.csrf_token,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      idleExpiresAt: row.idle_expires_at,
      absoluteExpiresAt: row.absolute_expires_at,
    };
  }

  async #transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await reached(() => this.#pool.connect());
    // A connection that failed is discarded, not returned to the pool for the next request.
    let lost = false;
    try {
      await reached(() => client.query('BEGIN'));
      const result = await work(client);
      await reached(() => client.query('COMMIT'));
      return result;
    } catch (error) {
      lost = error instanceof SessionStoreUnavailable;
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release(lost);
    }
  }
}
