import type { AppConfig } from './config.js';
import { JellyfinClient } from './clients/jellyfin.js';
import { SeerrClient } from './clients/seerr.js';
import { XtreamFilterClient } from './clients/xtreamfilter.js';
import { openDatabase, type Db } from './db/client.js';
import { BridgeRepository } from './db/repository.js';
import type { Logger } from './logging/logger.js';
import { Metrics } from './metrics/metrics.js';
import { AcquisitionEngine } from './services/acquisition/engine.js';
import { AlwaysAllowProviderActivity } from './services/provider-activity.js';
import { QualityProfileResolverService } from './services/quality-profile-resolver.js';
import { ReconcileWorker } from './workers/reconcile.js';

export interface AppContext {
  config: AppConfig;
  log: Logger;
  db: Db;
  repo: BridgeRepository;
  seerr: SeerrClient;
  engine: AcquisitionEngine;
  worker: ReconcileWorker;
  metrics: Metrics;
  closed: boolean;
  close: () => void;
}

export function createAppContext(
  config: AppConfig,
  log: Logger,
  fetchImpl?: typeof fetch,
): AppContext {
  const { db, sqlite } = openDatabase(config.DATABASE_PATH);
  const repo = new BridgeRepository(db);
  const metrics = new Metrics();
  const seerr = new SeerrClient(config, fetchImpl);
  const xtream = new XtreamFilterClient(config, fetchImpl);
  const jellyfin = new JellyfinClient(config, fetchImpl);
  const qualityResolver = new QualityProfileResolverService(config, seerr, fetchImpl);
  const providerActivity = new AlwaysAllowProviderActivity();
  const engine = new AcquisitionEngine(
    config,
    repo,
    seerr,
    xtream,
    jellyfin,
    qualityResolver,
    providerActivity,
    log,
    metrics,
  );
  const worker = new ReconcileWorker(engine, config.RECONCILE_INTERVAL_SECONDS, log);

  const ctx: AppContext = {
    config,
    log,
    db,
    repo,
    seerr,
    engine,
    worker,
    metrics,
    closed: false,
    close: () => {
      ctx.closed = true;
      worker.stop();
      sqlite.close();
    },
  };
  return ctx;
}
