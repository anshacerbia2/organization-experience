// `pnpm migrate`: applies the session store's migrations as the owning role, then grants the
// serving role its DML. Run before a deploy that needs a new migration, never by the server.

import pg from 'pg';

import { migrate } from './db/migrate.js';

// The tables this application adds to the pattern's session store. The pattern's migrator grants the
// serving role the session tables; these are granted here, in the same step.
const applicationTables = ['provider_windows'];

async function main(): Promise<void> {
  const url = process.env.ORGANIZATION_EXPERIENCE_MIGRATION_DATABASE_URL?.trim() ?? '';
  if (url === '') {
    throw new Error('ORGANIZATION_EXPERIENCE_MIGRATION_DATABASE_URL is required');
  }
  const runtimeRole = process.env.ORGANIZATION_EXPERIENCE_RUNTIME_ROLE?.trim() ?? '';
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const applied = await migrate(pool, runtimeRole === '' ? {} : { runtimeRole });
    if (runtimeRole !== '') {
      // migrate has checked the role name against its pattern before granting anything.
      await pool.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ${applicationTables.join(', ')} TO "${runtimeRole}"`,
      );
    }
    process.stdout.write(applied.length === 0 ? 'up to date\n' : `applied ${applied.join(', ')}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `organization-experience-migrate: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
