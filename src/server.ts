import { loadConfig } from './config.js';
import { createAppContext } from './app-context.js';
import { buildApp } from './app.js';
import { createLogger } from './logging/logger.js';
import { assertFfprobeAvailable } from './services/xtream-media-probe.js';

async function main() {
  const config = loadConfig();
  const log = createLogger(config);
  await assertFfprobeAvailable(config.FFPROBE_PATH);
  log.info({ ffprobe: config.FFPROBE_PATH }, 'ffprobe available');
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

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'shutting down');
    try {
      // Stop accepting traffic before tearing down SQLite / native addons.
      await app.close();
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'error while closing HTTP server',
      );
    }
    try {
      ctx.close();
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'error while closing app context / sqlite',
      );
    }
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
