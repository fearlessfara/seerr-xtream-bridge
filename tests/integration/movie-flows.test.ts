import { describe, expect, it } from 'vitest';
import { createTestFfprobeExecutor, fixture, withTestApp, baseRoutes } from './helpers.js';

const webhook = fixture('seerr/webhook-movie-pending.json');

async function postWebhook(
  app: {
    inject: (opts: {
      method: string;
      url: string;
      headers?: Record<string, string>;
      payload?: unknown;
    }) => Promise<{ statusCode: number; json: () => Record<string, unknown> }>;
  },
  body = webhook,
) {
  return app.inject({
    method: 'POST',
    url: '/webhooks/seerr',
    headers: { authorization: 'hook-secret' },
    payload: body,
  });
}

describe('integration movie flows', () => {
  it('queues xtream movie once and completes via jellyfin', async () => {
    let jellyfinHas = false;
    const routes = baseRoutes({ cartStatus: 'completed' }).map((r) => {
      if (r.match('http://x/Items', 'GET')) {
        return {
          ...r,
          handler: () => ({
            status: 200,
            body: jellyfinHas
              ? fixture('jellyfin/movie-items.json')
              : { Items: [], TotalRecordCount: 0 },
          }),
        };
      }
      return r;
    });

    // patch Items matcher more reliably
    const itemRoute = routes.find((r) => r.match('http://jellyfin.test/Items', 'GET'));
    if (itemRoute) {
      itemRoute.handler = () => ({
        status: 200,
        body: jellyfinHas
          ? fixture('jellyfin/movie-items.json')
          : { Items: [], TotalRecordCount: 0 },
      });
    }

    await withTestApp(routes, async (ctx, app) => {
      const res = await postWebhook(app);
      expect(res.statusCode).toBe(202);
      const jobId = res.json().jobId as number;

      // drive machine until queued/downloading/waiting
      for (let i = 0; i < 8; i++) await ctx.engine.processJob(jobId);
      let job = ctx.repo.getJob(jobId)!;
      expect(['XTREAM_QUEUED', 'XTREAM_DOWNLOADING', 'WAITING_FOR_JELLYFIN']).toContain(job.state);

      jellyfinHas = true;
      // mark media available on next seerr fetch after mark
      for (let i = 0; i < 10; i++) await ctx.engine.processJob(jobId);
      job = ctx.repo.getJob(jobId)!;
      expect(['AVAILABLE', 'COMPLETING_SEERR', 'COMPLETED', 'WAITING_FOR_JELLYFIN']).toContain(
        job.state,
      );

      // force media available in mock by posting mark path already handled — process until terminal
      for (let i = 0; i < 10; i++) await ctx.engine.processJob(jobId);
      job = ctx.repo.getJob(jobId)!;
      expect(job.state).toBe('COMPLETED');
      expect(job.qualityDecision).toBeTruthy();
    });
  });

  it('falls back when only 2160p candidates for 1080p profile', async () => {
    const browse = {
      items: [
        {
          name: 'EN - Dune 2021 2160p HDR',
          id: '9002',
          source_id: 'abcd1234',
          source_name: 'Strong 8K',
          tmdb_id: '693134',
          content_type: 'vod',
          container_extension: 'mkv',
        },
      ],
    };
    await withTestApp(baseRoutes({ browse }), async (ctx, app) => {
      const res = await postWebhook(app);
      const jobId = res.json().jobId as number;
      for (let i = 0; i < 12; i++) await ctx.engine.processJob(jobId);
      const job = ctx.repo.getJob(jobId)!;
      expect(job.state).toBe('HANDED_TO_ARR');
      expect(ctx.repo.listEvents(jobId).some((e) => e.toState === 'XTREAM_QUEUED')).toBe(false);
    });
  });

  it('falls back when probes fail and does not queue Xtream cart', async () => {
    await withTestApp(
      baseRoutes(),
      async (ctx, app) => {
        const res = await postWebhook(app);
        const jobId = res.json().jobId as number;
        for (let i = 0; i < 12; i++) await ctx.engine.processJob(jobId);
        const job = ctx.repo.getJob(jobId)!;
        expect(job.state).toBe('HANDED_TO_ARR');
        expect(ctx.repo.listEvents(jobId).some((e) => e.toState === 'XTREAM_QUEUED')).toBe(false);
      },
      {},
      createTestFfprobeExecutor({ failStreamIds: ['9001', '9002'] }),
    );
  });

  it('dedupes duplicate webhooks into one job', async () => {
    await withTestApp(baseRoutes(), async (ctx, app) => {
      const a = await postWebhook(app);
      const b = await postWebhook(app);
      expect(a.json().jobId).toBe(b.json().jobId);
      expect(b.json().created).toBe(false);
      expect(ctx.repo.listJobs().length).toBe(1);
    });
  });

  it('short-circuits when jellyfin already has movie', async () => {
    await withTestApp(baseRoutes({ jellyfinHasMovie: true }), async (ctx, app) => {
      const res = await postWebhook(app);
      const jobId = res.json().jobId as number;
      for (let i = 0; i < 12; i++) await ctx.engine.processJob(jobId);
      const job = ctx.repo.getJob(jobId)!;
      expect(['WAITING_FOR_JELLYFIN', 'AVAILABLE', 'COMPLETING_SEERR', 'COMPLETED']).toContain(
        job.state,
      );
      // should not have queued xtream
      const ops = ctx.repo.listEvents(jobId);
      expect(ops.some((e) => e.toState === 'XTREAM_QUEUED')).toBe(false);
    });
  });

  it('marks EXTERNALLY_HANDLED when already approved', async () => {
    await withTestApp(baseRoutes({ requestOverrides: { status: 2 } }), async (ctx, app) => {
      const res = await postWebhook(app);
      const jobId = res.json().jobId as number;
      for (let i = 0; i < 8; i++) await ctx.engine.processJob(jobId);
      expect(ctx.repo.getJob(jobId)!.state).toBe('EXTERNALLY_HANDLED');
    });
  });

  it('retries profile API failure instead of fallback', async () => {
    await withTestApp(baseRoutes({ radarrProfileFail: true }), async (ctx, app) => {
      const res = await postWebhook(app);
      const jobId = res.json().jobId as number;
      for (let i = 0; i < 6; i++) await ctx.engine.processJob(jobId);
      const job = ctx.repo.getJob(jobId)!;
      expect(job.state).toBe('FAILED_RETRYABLE');
      expect(job.state).not.toBe('HANDED_TO_ARR');
    });
  });

  it('treats 409 as success only when cart tuple exists', async () => {
    const routes = baseRoutes();
    // Preseed cart via first queue then second job same media different request — simpler: force 409 without item
    const cartPost = routes.find((r) => r.match('http://xtream.test/api/cart', 'POST'));
    if (cartPost) {
      cartPost.handler = () => ({ status: 409, body: { error: 'Item already in cart' } });
    }
    await withTestApp(routes, async (ctx, app) => {
      const res = await postWebhook(app);
      const jobId = res.json().jobId as number;
      for (let i = 0; i < 10; i++) await ctx.engine.processJob(jobId);
      const job = ctx.repo.getJob(jobId)!;
      expect(job.state).toBe('FAILED_RETRYABLE');
    });
  });
});
