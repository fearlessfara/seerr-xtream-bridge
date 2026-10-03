import { desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { JobState } from '../domain/state-machine/states.js';
import { TERMINAL_STATES } from '../domain/state-machine/states.js';
import type { Db } from './client.js';
import {
  acquisitionJobs,
  events,
  operations,
  requestScopes,
  requests,
  xtreamItems,
  type JobRow,
  type RequestRow,
} from './schema.js';

export function nowIso(): string {
  return new Date().toISOString();
}

export class BridgeRepository {
  constructor(private readonly db: Db) {}

  findRequestBySeerrId(seerrRequestId: number): RequestRow | undefined {
    return this.db.select().from(requests).where(eq(requests.seerrRequestId, seerrRequestId)).get();
  }

  createRequestWithJob(input: {
    seerrRequestId: number;
    mediaType: string;
    tmdbId: number;
    tvdbId?: number | null;
    is4k: boolean;
    requester?: string;
    seasons: number[];
    rawWebhook: unknown;
  }): { request: RequestRow; job: JobRow; created: boolean } {
    const existing = this.findRequestBySeerrId(input.seerrRequestId);
    if (existing) {
      const job = this.db
        .select()
        .from(acquisitionJobs)
        .where(eq(acquisitionJobs.requestId, existing.id))
        .orderBy(desc(acquisitionJobs.id))
        .get();
      if (!job) throw new Error('Request exists without job');
      return { request: existing, job, created: false };
    }

    const ts = nowIso();
    return this.db.transaction((tx) => {
      const request = tx
        .insert(requests)
        .values({
          seerrRequestId: input.seerrRequestId,
          mediaType: input.mediaType,
          tmdbId: input.tmdbId,
          tvdbId: input.tvdbId ?? null,
          is4k: input.is4k,
          requester: input.requester ?? null,
          seasonsJson: JSON.stringify(input.seasons),
          rawWebhookJson: JSON.stringify(input.rawWebhook),
          createdAt: ts,
          updatedAt: ts,
        })
        .returning()
        .get();

      for (const season of input.seasons) {
        tx.insert(requestScopes)
          .values({
            requestId: request.id,
            idempotencyKey: `seerr:${input.seerrRequestId}:tv:${input.tmdbId}:season:${season}`,
            scopeType: 'season',
            seasonNumber: season,
            createdAt: ts,
          })
          .run();
      }
      if (input.mediaType === 'movie') {
        tx.insert(requestScopes)
          .values({
            requestId: request.id,
            idempotencyKey: `seerr:${input.seerrRequestId}:movie:${input.tmdbId}`,
            scopeType: 'movie',
            seasonNumber: null,
            createdAt: ts,
          })
          .run();
      }

      const job = tx
        .insert(acquisitionJobs)
        .values({
          requestId: request.id,
          state: 'RECEIVED',
          mediaType: input.mediaType,
          tmdbId: input.tmdbId,
          createdAt: ts,
          updatedAt: ts,
        })
        .returning()
        .get();

      tx.insert(events)
        .values({
          jobId: job.id,
          fromState: null,
          toState: 'RECEIVED',
          reason: 'webhook_received',
          metaJson: null,
          createdAt: ts,
        })
        .run();

      return { request, job, created: true };
    });
  }

  getJob(jobId: number): JobRow | undefined {
    return this.db.select().from(acquisitionJobs).where(eq(acquisitionJobs.id, jobId)).get();
  }

  getRequest(requestId: number): RequestRow | undefined {
    return this.db.select().from(requests).where(eq(requests.id, requestId)).get();
  }

  updateRequestSeasons(requestId: number, seasons: number[], is4k?: boolean): void {
    this.db
      .update(requests)
      .set({
        seasonsJson: JSON.stringify(seasons),
        ...(is4k !== undefined ? { is4k } : {}),
        updatedAt: nowIso(),
      })
      .where(eq(requests.id, requestId))
      .run();

    const request = this.getRequest(requestId);
    if (!request) return;
    for (const season of seasons) {
      try {
        this.db
          .insert(requestScopes)
          .values({
            requestId,
            idempotencyKey: `seerr:${request.seerrRequestId}:tv:${request.tmdbId}:season:${season}`,
            scopeType: 'season',
            seasonNumber: season,
            createdAt: nowIso(),
          })
          .run();
      } catch {
        // unique — already present
      }
    }
  }

  listJobs(limit = 100): JobRow[] {
    return this.db
      .select()
      .from(acquisitionJobs)
      .orderBy(desc(acquisitionJobs.id))
      .limit(limit)
      .all();
  }

  listActiveJobs(): JobRow[] {
    return this.db
      .select()
      .from(acquisitionJobs)
      .all()
      .filter((j) => !TERMINAL_STATES.has(j.state as JobState));
  }

  transitionJob(
    jobId: number,
    toState: JobState,
    opts?: {
      reason?: string;
      meta?: unknown;
      patch?: Partial<typeof acquisitionJobs.$inferInsert>;
    },
  ): JobRow {
    const ts = nowIso();
    return this.db.transaction((tx) => {
      const current = tx.select().from(acquisitionJobs).where(eq(acquisitionJobs.id, jobId)).get();
      if (!current) throw new Error(`Job ${jobId} not found`);

      const updated = tx
        .update(acquisitionJobs)
        .set({
          state: toState,
          updatedAt: ts,
          ...opts?.patch,
        })
        .where(eq(acquisitionJobs.id, jobId))
        .returning()
        .get();

      tx.insert(events)
        .values({
          jobId,
          fromState: current.state,
          toState,
          reason: opts?.reason ?? null,
          metaJson: opts?.meta ? JSON.stringify(opts.meta) : null,
          createdAt: ts,
        })
        .run();

      return updated;
    });
  }

  listEvents(jobId: number) {
    return this.db.select().from(events).where(eq(events.jobId, jobId)).orderBy(events.id).all();
  }

  getOperation(operationKey: string) {
    return this.db.select().from(operations).where(eq(operations.operationKey, operationKey)).get();
  }

  beginOperation(operationKey: string, jobId: number, request: unknown) {
    const ts = nowIso();
    try {
      return this.db
        .insert(operations)
        .values({
          operationKey,
          jobId,
          status: 'intent',
          requestJson: JSON.stringify(request),
          resultJson: null,
          createdAt: ts,
          updatedAt: ts,
        })
        .returning()
        .get();
    } catch {
      return this.getOperation(operationKey);
    }
  }

  completeOperation(operationKey: string, status: 'succeeded' | 'failed', result?: unknown) {
    const ts = nowIso();
    return this.db
      .update(operations)
      .set({
        status,
        resultJson: result ? JSON.stringify(result) : null,
        updatedAt: ts,
      })
      .where(eq(operations.operationKey, operationKey))
      .returning()
      .get();
  }

  upsertXtreamItem(input: {
    jobId: number;
    sourceId: string;
    streamId?: string | null;
    seriesId?: string | null;
    seasonNumber?: number | null;
    name?: string;
    status: string;
    cartItemIds?: Array<string | number>;
  }) {
    const ts = nowIso();
    return this.db
      .insert(xtreamItems)
      .values({
        jobId: input.jobId,
        sourceId: input.sourceId,
        streamId: input.streamId ?? null,
        seriesId: input.seriesId ?? null,
        seasonNumber: input.seasonNumber ?? null,
        name: input.name ?? null,
        status: input.status,
        cartItemIdsJson: JSON.stringify(input.cartItemIds ?? []),
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()
      .get();
  }

  listXtreamItems(jobId: number) {
    return this.db.select().from(xtreamItems).where(eq(xtreamItems.jobId, jobId)).all();
  }

  updateXtreamItemStatus(id: number, status: string) {
    return this.db
      .update(xtreamItems)
      .set({ status, updatedAt: nowIso() })
      .where(eq(xtreamItems.id, id))
      .run();
  }

  jobsByStates(states: JobState[]): JobRow[] {
    if (!states.length) return [];
    return this.db
      .select()
      .from(acquisitionJobs)
      .where(inArray(acquisitionJobs.state, states))
      .all();
  }

  markRetry(jobId: number, message: string, delaySeconds: number) {
    const attempt = (this.getJob(jobId)?.attemptCount ?? 0) + 1;
    const next = new Date(Date.now() + delaySeconds * 1000).toISOString();
    return this.transitionJob(jobId, 'FAILED_RETRYABLE', {
      reason: 'retryable_error',
      meta: { message },
      patch: {
        errorClass: 'retryable',
        errorMessage: message,
        attemptCount: attempt,
        nextAttemptAt: next,
      },
    });
  }

  clearRetry(jobId: number, toState: JobState, reason: string) {
    return this.transitionJob(jobId, toState, {
      reason,
      patch: {
        errorClass: null,
        errorMessage: null,
        nextAttemptAt: null,
      },
    });
  }

  countJobsNotIn(states: JobState[]): number {
    return (
      this.db
        .select({ c: sql<number>`count(*)` })
        .from(acquisitionJobs)
        .where(ne(acquisitionJobs.state, states[0] ?? 'COMPLETED'))
        .get()?.c ?? 0
    );
  }
}
