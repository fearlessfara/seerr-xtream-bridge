import { loadConfig } from './config.js';
import { createAppContext } from './app-context.js';
import { buildApp } from './app.js';
import { createLogger } from './logging/logger.js';

async function main() {
  const config = loadConfig();
  const log = createLogger(config);
  const ctx = createAppContext(config, log);

  // Startup reconciliation
  ctx.worker.start();
  void ctx.engine.reconcileAll().catch((err) => {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      'startup reconcile failed',
    );
  });

  const app = await buildApp(ctx);
  await app.listen({ host: config.HOST, port: config.PORT });
  log.info({ host: config.HOST, port: config.PORT }, 'seerr-xtream-bridge listening');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    ctx.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
