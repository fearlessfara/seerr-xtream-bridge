import client from 'prom-client';

export class Metrics {
  readonly registry = new client.Registry();
  readonly requests: client.Counter<string>;
  readonly xtreamMatches: client.Counter<string>;
  readonly xtreamMisses: client.Counter<string>;
  readonly fallbacks: client.Counter<string>;
  readonly downloadsQueued: client.Counter<string>;
  readonly jobsFailed: client.Counter<string>;
  readonly jobDuration: client.Histogram<string>;

  constructor() {
    client.collectDefaultMetrics({ register: this.registry });

    this.requests = new client.Counter({
      name: 'bridge_requests_total',
      help: 'Total bridge acquisition outcomes',
      labelNames: ['result'],
      registers: [this.registry],
    });
    this.xtreamMatches = new client.Counter({
      name: 'bridge_xtream_matches_total',
      help: 'Xtream identity+quality matches',
      registers: [this.registry],
    });
    this.xtreamMisses = new client.Counter({
      name: 'bridge_xtream_misses_total',
      help: 'Xtream misses by reason',
      labelNames: ['reason'],
      registers: [this.registry],
    });
    this.fallbacks = new client.Counter({
      name: 'bridge_fallbacks_total',
      help: 'Fallbacks to Radarr/Sonarr',
      registers: [this.registry],
    });
    this.downloadsQueued = new client.Counter({
      name: 'bridge_downloads_queued_total',
      help: 'XtreamFilter cart queue operations',
      registers: [this.registry],
    });
    this.jobsFailed = new client.Counter({
      name: 'bridge_jobs_failed_total',
      help: 'Jobs that entered failure handling',
      registers: [this.registry],
    });
    this.jobDuration = new client.Histogram({
      name: 'bridge_job_duration_seconds',
      help: 'Job processing step duration',
      buckets: [0.05, 0.1, 0.5, 1, 2, 5, 10, 30],
      registers: [this.registry],
    });
  }

  async metricsText(): Promise<string> {
    return this.registry.metrics();
  }
}
