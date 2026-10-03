import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type AppConfig } from '../../src/config.js';
import { createAppContext, type AppContext } from '../../src/app-context.js';
import { createLogger } from '../../src/logging/logger.js';
import { buildApp } from '../../src/app.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

export function fixture<T = unknown>(rel: string): T {
  return JSON.parse(readFileSync(join(fixtures, rel), 'utf8')) as T;
}

export type MockRoute = {
  match: (url: string, method: string) => boolean;
  status?: number;
  body?: unknown;
  handler?: (url: string, method: string, body?: unknown) => { status: number; body: unknown };
};

export function createMockFetch(routes: MockRoute[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const route = routes.find((r) => r.match(url, method));
    if (!route) {
      return new Response(JSON.stringify({ error: `unmocked ${method} ${url}` }), { status: 599 });
    }
    if (route.handler) {
      const parsedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      const res = route.handler(url, method, parsedBody);
      return new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(route.body ?? {}), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

export async function withTestApp(
  routes: MockRoute[],
  run: (ctx: AppContext, app: Awaited<ReturnType<typeof buildApp>>) => Promise<void>,
  envOverrides: Partial<AppConfig> = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-int-'));
  const config = loadConfig({
    SEERR_URL: 'http://seerr.test',
    SEERR_API_KEY: 'seerr-key',
    SEERR_WEBHOOK_SECRET: 'hook-secret',
    XTREAMFILTER_URL: 'http://xtream.test',
    XTREAMFILTER_SOURCE_NAME: 'Strong 8K',
    JELLYFIN_URL: 'http://jellyfin.test',
    JELLYFIN_API_KEY: 'jf-key',
    RADARR_URL: 'http://radarr.test',
    RADARR_API_KEY: 'radarr-key',
    SONARR_URL: 'http://sonarr.test',
    SONARR_API_KEY: 'sonarr-key',
    DATABASE_PATH: join(dir, 'bridge.db'),
    BRIDGE_API_KEY: 'bridge-key',
    RECONCILE_INTERVAL_SECONDS: '3600',
    SEERR_AVAILABILITY_GRACE_SECONDS: '0',
    SEERR_REQUEST_COMPLETION_GRACE_SECONDS: '0',
    QUALITY_UNKNOWN_POLICY: 'allow',
    LOG_LEVEL: 'silent',
    ...Object.fromEntries(
      Object.entries(envOverrides).map(([k, v]) => [k, v == null ? '' : String(v)]),
    ),
  } as NodeJS.ProcessEnv);

  const fetchImpl = createMockFetch(routes);
  const log = createLogger(config);
  const ctx = createAppContext(config, log, fetchImpl);
  ctx.worker.stop();
  const app = await buildApp(ctx);
  try {
    await run(ctx, app);
  } finally {
    ctx.closed = true;
    await app.close();
    // Allow pending setImmediate callbacks to observe closed flag
    await new Promise((r) => setImmediate(r));
    ctx.close();
  }
}

export function baseRoutes(opts?: {
  jellyfinHasMovie?: boolean;
  cartStatus?: string;
  browse?: unknown;
  requestOverrides?: Record<string, unknown>;
  radarrProfileFail?: boolean;
}): MockRoute[] {
  let request = {
    ...fixture<Record<string, unknown>>('seerr/request-movie-pending.json'),
    ...(opts?.requestOverrides ?? {}),
  };
  const browse = opts?.browse ?? fixture('xtreamfilter/browse-movie.json');
  let cartItems: unknown[] = [];

  return [
    {
      match: (u, m) => m === 'GET' && u.includes('/api/v1/request/'),
      handler: () => ({ status: 200, body: request }),
    },
    {
      match: (u, m) => m === 'POST' && u.includes('/approve'),
      handler: () => {
        request = { ...request, status: 2 };
        // if media available, pretend completed
        const media = request.media as { status: number };
        if (media.status === 5) request = { ...request, status: 5 };
        return { status: 200, body: request };
      },
    },
    {
      match: (u, m) => m === 'POST' && u.includes('/api/v1/media/') && u.endsWith('/available'),
      handler: () => {
        const media = { ...(request.media as object), status: 5 } as { status: number };
        request = { ...request, media, status: 5 };
        return { status: 200, body: media };
      },
    },
    {
      match: (u, m) => m === 'GET' && u.includes('/api/v1/settings/radarr'),
      body: fixture('seerr/radarr-settings.json'),
    },
    {
      match: (u, m) => m === 'GET' && u.includes('/api/v1/settings/sonarr'),
      body: [],
    },
    {
      match: (u, m) => m === 'GET' && u.includes('/api/v3/qualityprofile/'),
      handler: () =>
        opts?.radarrProfileFail
          ? { status: 500, body: { message: 'boom' } }
          : { status: 200, body: fixture('radarr/qualityprofile-hd.json') },
    },
    {
      match: (u, m) => m === 'GET' && u.includes('/api/browse'),
      body: browse,
    },
    {
      match: (u, m) => m === 'GET' && u.endsWith('/api/cart'),
      handler: () => ({ status: 200, body: { items: cartItems } }),
    },
    {
      match: (u, m) => m === 'POST' && u.endsWith('/api/cart'),
      handler: (_u, _m, body) => {
        const b = body as Record<string, unknown>;
        const item = {
          id: 'c1',
          source_id: b.source_id,
          stream_id: b.stream_id,
          content_type: b.content_type,
          name: b.name,
          status: opts?.cartStatus ?? 'completed',
        };
        const exists = cartItems.some(
          (i) =>
            (i as { source_id: string; stream_id: string }).source_id === b.source_id &&
            String((i as { stream_id: string }).stream_id) === String(b.stream_id),
        );
        if (exists) return { status: 409, body: { error: 'Item already in cart' } };
        cartItems = [...cartItems, item];
        return { status: 200, body: { status: 'ok', added: 1, skipped: 0, items: [item] } };
      },
    },
    {
      match: (u, m) => m === 'POST' && u.includes('/api/cart/start'),
      status: 200,
      body: { ok: true },
    },
    {
      match: (u, m) => m === 'GET' && u.includes('/api/cart/status'),
      body: { is_running: false, queued: 0, downloading: 0, completed: 1 },
    },
    {
      match: (u, m) => m === 'GET' && u.includes('/System/Info'),
      body: { ServerName: 'JF', Version: '10' },
    },
    {
      match: (u, m) => m === 'POST' && u.includes('/Library/Refresh'),
      status: 204,
      body: {},
    },
    {
      match: (u, m) => m === 'GET' && u.includes('/Items'),
      handler: () => ({
        status: 200,
        body: opts?.jellyfinHasMovie
          ? fixture('jellyfin/movie-items.json')
          : { Items: [], TotalRecordCount: 0 },
      }),
    },
  ];
}
