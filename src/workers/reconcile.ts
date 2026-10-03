import type { AcquisitionEngine } from '../services/acquisition/engine.js';
import type { Logger } from '../logging/logger.js';

export class ReconcileWorker {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly engine: AcquisitionEngine,
    private readonly intervalSeconds: number,
    private readonly log: Logger,
  ) {}

  start(): void {
    if (this.timer) return;
    this.log.info({ intervalSeconds: this.intervalSeconds }, 'reconcile worker starting');
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalSeconds * 1000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.engine.reconcileAll();
      this.log.debug({ activeJobs: n }, 'reconcile tick');
    } catch (err) {
      this.log.error({ err: err instanceof Error ? err.message : String(err) }, 'reconcile failed');
    } finally {
      this.running = false;
    }
  }
}
