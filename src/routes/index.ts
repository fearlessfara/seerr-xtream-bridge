import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context.js';
import { SeerrWebhookSchema } from '../clients/schemas/seerr.js';

function parseRequestedSeasons(
  extra: Array<{ name: string; value: string }> | null | undefined,
): number[] {
  const row = extra?.find((e) => /requested seasons/i.test(e.name));
  if (!row) return [];
  return row.value
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function unauthorized(reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
  return reply.code(401).send({ error: 'unauthorized' });
}

function requireBridgeKey(ctx: AppContext, header?: string): boolean {
  if (!ctx.config.BRIDGE_API_KEY) return true;
  return header === ctx.config.BRIDGE_API_KEY || header === `Bearer ${ctx.config.BRIDGE_API_KEY}`;
}

export async function registerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async (_req, reply) => {
    try {
      ctx.repo.listJobs(1);
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    }
  });

  app.post('/webhooks/seerr', async (req, reply) => {
    const secret = ctx.config.SEERR_WEBHOOK_SECRET;
    if (secret) {
      const auth = String(req.headers.authorization ?? '');
      const apiKey = String(req.headers['x-api-key'] ?? '');
      const ok = auth === secret || auth === `Bearer ${secret}` || apiKey === secret;
      if (!ok) return unauthorized(reply);
    }

    const parsed = SeerrWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', issues: parsed.error.issues });
    }

    const payload = parsed.data;
    if (payload.notification_type !== 'MEDIA_PENDING') {
      return reply.code(202).send({ accepted: true, ignored: true, reason: 'not_media_pending' });
    }

    const requestId = Number(payload.request?.request_id);
    const tmdbId = Number(payload.media?.tmdbId);
    const mediaType = String(payload.media?.media_type ?? '');
    if (!Number.isFinite(requestId) || !Number.isFinite(tmdbId) || !mediaType) {
      return reply.code(400).send({ error: 'missing_request_fields' });
    }

    const seasons = parseRequestedSeasons(payload.extra);

    const { job, created } = ctx.repo.createRequestWithJob({
      seerrRequestId: requestId,
      mediaType,
      tmdbId,
      tvdbId: payload.media?.tvdbId ? Number(payload.media.tvdbId) : null,
      is4k: false,
      requester: payload.request?.requestedBy_username,
      seasons,
      rawWebhook: payload,
    });

    ctx.metrics.requests.inc({ result: created ? 'received' : 'deduped' });
    // Kick async processing without blocking response
    setImmediate(() => {
      if (ctx.closed) return;
      void ctx.engine.processJob(job.id).catch((err) => {
        if (ctx.closed) return;
        ctx.log.error(
          { err: err instanceof Error ? err.message : String(err), jobId: job.id },
          'async webhook processing failed',
        );
      });
    });

    return reply.code(202).send({ accepted: true, jobId: job.id, created });
  });

  app.get('/api/jobs', async (req, reply) => {
    if (
      !requireBridgeKey(ctx, String(req.headers['x-api-key'] ?? req.headers.authorization ?? ''))
    ) {
      return unauthorized(reply);
    }
    return { jobs: ctx.repo.listJobs(200) };
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req, reply) => {
    if (
      !requireBridgeKey(ctx, String(req.headers['x-api-key'] ?? req.headers.authorization ?? ''))
    ) {
      return unauthorized(reply);
    }
    const job = ctx.repo.getJob(Number(req.params.id));
    if (!job) return reply.code(404).send({ error: 'not_found' });
    return {
      job,
      request: ctx.repo.getRequest(job.requestId),
      events: ctx.repo.listEvents(job.id),
      xtreamItems: ctx.repo.listXtreamItems(job.id),
    };
  });

  app.post<{ Params: { id: string } }>('/api/jobs/:id/retry', async (req, reply) => {
    if (
      !requireBridgeKey(ctx, String(req.headers['x-api-key'] ?? req.headers.authorization ?? ''))
    ) {
      return unauthorized(reply);
    }
    const job = ctx.repo.getJob(Number(req.params.id));
    if (!job) return reply.code(404).send({ error: 'not_found' });
    ctx.repo.clearRetry(job.id, 'VALIDATING', 'manual_retry');
    setImmediate(() => {
      if (ctx.closed) return;
      void ctx.engine.processJob(job.id).catch(() => undefined);
    });
    return { ok: true, jobId: job.id };
  });

  app.post('/api/reconcile', async (req, reply) => {
    if (
      !requireBridgeKey(ctx, String(req.headers['x-api-key'] ?? req.headers.authorization ?? ''))
    ) {
      return unauthorized(reply);
    }
    const n = await ctx.engine.reconcileAll();
    return { ok: true, processed: n };
  });

  app.get('/metrics', async (req, reply) => {
    if (ctx.config.METRICS_REQUIRE_AUTH || ctx.config.BRIDGE_API_KEY) {
      if (ctx.config.METRICS_REQUIRE_AUTH) {
        if (
          !requireBridgeKey(
            ctx,
            String(req.headers['x-api-key'] ?? req.headers.authorization ?? ''),
          )
        ) {
          return unauthorized(reply);
        }
      }
    }
    reply.header('Content-Type', ctx.metrics.registry.contentType);
    return ctx.metrics.metricsText();
  });
}
