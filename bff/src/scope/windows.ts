import type { Pool, QueryResult, QueryResultRow } from 'pg';

import { isStoreOutage, SessionStoreUnavailable } from '../session/store.js';

// A provider window (TDD-organization-experience-001 1.2.0 §Provider Mode Entry): what a provider
// session opened provider mode with. It is keyed by the session's digest and deleted with it.
export interface ProviderWindow {
  readonly sessionHash: Buffer;
  // grantKind is the grant the window rests on. An eligible grant needs an approved activation; an
  // emergency grant is standing and has none (ADR-ORG-002 §5.1, §5.2).
  readonly grantKind: 'eligible' | 'emergency';
  readonly activationId: string | null;
  readonly reason: string;
  readonly correlationId: string;
  // tenants are the Tenants the operator named; null is every Tenant.
  readonly tenants: readonly string[] | null;
  readonly durationSeconds: number;
  readonly requestedAt: Date;
  // endsAt is when the window closes: the activation's ends_at once approved, or for an emergency
  // grant the stated duration from opening. Null while an activation awaits its approval.
  readonly endsAt: Date | null;
}

export type WindowState = 'pending' | 'in-force' | 'ended';

// windowState is what the window allows now. Only an in-force window reaches past the activation
// routes; the Organization Control API decides again on every request.
export const windowState = (window: ProviderWindow, now: Date): WindowState =>
  window.endsAt === null ? 'pending' : now < window.endsAt ? 'in-force' : 'ended';

interface WindowRow {
  session_hash: Buffer;
  grant_kind: 'eligible' | 'emergency';
  activation_id: string | null;
  reason: string;
  correlation_id: string;
  tenants: string[] | null;
  duration_seconds: number;
  requested_at: Date;
  ends_at: Date | null;
}

const columns =
  'session_hash, grant_kind, activation_id, reason, correlation_id, tenants, duration_seconds, requested_at, ends_at';

// ProviderWindows lives in the session store's database, so a store that does not answer is the
// same outage, named the same way, and the BFF answers it 503 (TDD-identity-experience-001 1.17.0
// §Session-Store Outage).
export class ProviderWindows {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async #query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>> {
    try {
      return await this.#pool.query<R>(text, values);
    } catch (error) {
      throw isStoreOutage(error) ? new SessionStoreUnavailable(error) : error;
    }
  }

  async find(sessionHash: Buffer): Promise<ProviderWindow | null> {
    const { rows } = await this.#query<WindowRow>(
      `SELECT ${columns} FROM provider_windows WHERE session_hash = $1`,
      [sessionHash],
    );
    const row = rows[0];
    return row === undefined
      ? null
      : {
          sessionHash: row.session_hash,
          grantKind: row.grant_kind,
          activationId: row.activation_id,
          reason: row.reason,
          correlationId: row.correlation_id,
          tenants: row.tenants,
          durationSeconds: row.duration_seconds,
          requestedAt: row.requested_at,
          endsAt: row.ends_at,
        };
  }

  // open records a window, replacing one the session had left behind.
  async open(window: ProviderWindow): Promise<void> {
    await this.#query(
      `INSERT INTO provider_windows (${columns}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (session_hash) DO UPDATE SET grant_kind = EXCLUDED.grant_kind,
         activation_id = EXCLUDED.activation_id, reason = EXCLUDED.reason,
         correlation_id = EXCLUDED.correlation_id, tenants = EXCLUDED.tenants,
         duration_seconds = EXCLUDED.duration_seconds, requested_at = EXCLUDED.requested_at,
         ends_at = EXCLUDED.ends_at`,
      [
        window.sessionHash,
        window.grantKind,
        window.activationId,
        window.reason,
        window.correlationId,
        window.tenants,
        window.durationSeconds,
        window.requestedAt,
        window.endsAt,
      ],
    );
  }

  // approved records the end the API set when it approved the activation.
  async approved(sessionHash: Buffer, endsAt: Date): Promise<void> {
    await this.#query('UPDATE provider_windows SET ends_at = $2 WHERE session_hash = $1', [
      sessionHash,
      endsAt,
    ]);
  }

  async close(sessionHash: Buffer): Promise<void> {
    await this.#query('DELETE FROM provider_windows WHERE session_hash = $1', [sessionHash]);
  }
}
