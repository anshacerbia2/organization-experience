// The Organization Experience BFF deployable. The composition root: configuration is read once and
// every dependency is built here.

import { ConfigError, loadConfig } from './config.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer(config);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutdown signalled');
    await app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.listenHost, port: config.listenPort });
}

main().catch((error: unknown) => {
  // The logger may not exist when configuration fails, so this one write goes to stderr.
  const message = error instanceof ConfigError ? error.message : String(error);
  process.stderr.write(`organization-experience-bff: ${message}\n`);
  process.exit(1);
});
