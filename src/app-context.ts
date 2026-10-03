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
import { XtreamMediaProbe, type FfprobeExecutor } from './services/xtream-media-probe.js';
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
  mediaProbe: XtreamMediaProbe;
  closed: boolean;
  close: () => void;
}

export interface AppContextDeps {
  fetchImpl?: typeof fetch;
  mediaProbe?: XtreamMediaProbe;
  ffprobeExecutor?: FfprobeExecutor;
}

export function createAppContext(
  config: AppConfig,
  log: Logger,
  fetchOrDeps?: typeof fetch | AppContextDeps,
): AppContext {
  const deps: AppContextDeps =
    typeof fetchOrDeps === 'function' || fetchOrDeps === undefined
      ? { fetchImpl: fetchOrDeps }
      : fetchOrDeps;

  const { db, close: closeDb } = openDatabase(config.DATABASE_PATH);
  const repo = new BridgeRepository(db);
  const metrics = new Metrics();
  const seerr = new SeerrClient(config, deps.fetchImpl);
  const xtream = new XtreamFilterClient(config, deps.fetchImpl);
  const jellyfin = new JellyfinClient(config, deps.fetchImpl);
  const qualityResolver = new QualityProfileResolverService(config, seerr, deps.fetchImpl);
  const providerActivity = new AlwaysAllowProviderActivity();
  const mediaProbe = deps.mediaProbe ?? new XtreamMediaProbe(config, deps.ffprobeExecutor);
  const engine = new AcquisitionEngine(
    config,
    repo,
    seerr,
    xtream,
    jellyfin,
    qualityResolver,
    providerActivity,
    mediaProbe,
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
    mediaProbe,
    closed: false,
    close: () => {
      if (ctx.closed) return;
      ctx.closed = true;
      worker.stop();
      closeDb();
    },
  };
  return ctx;
}
