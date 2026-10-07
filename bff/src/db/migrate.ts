import { readdir, readFile } from 'node:fs/promises';

import type { Pool } from 'pg';

// The migrations directory sits beside src/ and dist/, so the same relative path finds it from the
// TypeScript source under tsx and from the compiled output.
const migrationsDirectory = new URL('../../migrations/', import.meta.url);

// An arbitrary constant: two migrators started together serialize on it instead of racing.
const advisoryLock = 7_311_402_117;

const roleName = /^[a-z_][a-z0-9_]{0,62}$/;

export interface MigrateOptions {
  // runtimeRole is granted DML on the session tables and nothing else. The BFF connects as that
  // role; the migrator connects as the owner, and the two never share a credential.
  readonly runtimeRole?: string;
}

// migrate applies every migration not yet recorded, each in its own transaction, in file-name
// order. It is a separate step from serving (`pnpm migrate`): the serving role cannot run DDL.
export async function migrate(pool: Pool, options: MigrateOptions = {}): Promise<string[]> {
  if (options.runtimeRole !== undefined && !roleName.test(options.runtimeRole)) {
    throw new Error(`${options.runtimeRole} is not a PostgreSQL role name this migrator accepts`);
  }
  const files = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [advisoryLock]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
        (row) => row.name,
      ),
    );
    for (const name of files) {
      if (done.has(name)) {
        continue;
      }
      const sql = await readFile(new URL(name, migrationsDirectory), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${name} failed`, { cause: error });
      }
      applied.push(name);
    }
    if (options.runtimeRole !== undefined) {
      await client.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON login_states, sessions TO "${options.runtimeRole}"`,
      );
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [advisoryLock]).catch(() => undefined);
    client.release();
  }
  return applied;
}
