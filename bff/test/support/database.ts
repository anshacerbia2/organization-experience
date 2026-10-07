import { randomBytes } from 'node:crypto';

import pg from 'pg';

import { migrate } from '../../src/db/migrate.js';

// The session store is tested against PostgreSQL, not a double: the row lock, the expiry queries
// and the migrations are what is under test. IDENTITY_EXPERIENCE_TEST_DATABASE_URL names a database
// the tests may create schemas in; each test file gets its own schema and drops it afterwards.
export const testDatabaseUrl = process.env.IDENTITY_EXPERIENCE_TEST_DATABASE_URL?.trim() ?? '';

export interface TestDatabase {
  // url connects with the schema on the search path, as the server under test does.
  readonly url: string;
  readonly pool: pg.Pool;
  drop(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  if (testDatabaseUrl === '') {
    throw new Error(
      'IDENTITY_EXPERIENCE_TEST_DATABASE_URL is required: the session store is tested against PostgreSQL',
    );
  }
  const schema = `bff_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: testDatabaseUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(testDatabaseUrl);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = new pg.Pool({ connectionString: url.href, max: 2 });
  await migrate(pool);
  return {
    url: url.href,
    pool,
    async drop() {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}
