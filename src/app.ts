import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import type { AppContext } from './app-context.js';
import { registerRoutes } from './routes/index.js';

export async function buildApp(ctx: AppContext) {
  const app = Fastify({
    logger: false,
    bodyLimit: ctx.config.BODY_LIMIT_BYTES,
    trustProxy: true,
  });

  await app.register(sensible);
  await registerRoutes(app, ctx);
  return app;
}
