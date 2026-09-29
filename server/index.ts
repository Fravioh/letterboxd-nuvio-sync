import { createApp } from './app.js';
import { TmdbGateway } from './tmdb.js';

const port = Number(process.env.PORT ?? 3001);
const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173';
if (
  process.env.NODE_ENV === 'production' &&
  (!process.env.APP_ORIGIN || !origin.startsWith('https://'))
)
  throw new Error('Production requires APP_ORIGIN with HTTPS.');
const gateway = new TmdbGateway();
const app = createApp({
  origin,
  allowLoopbackOrigins:
    process.env.NODE_ENV !== 'production' &&
    ['127.0.0.1', '::1'].includes(process.env.HOST ?? '127.0.0.1'),
  trustProxy: process.env.TRUST_PROXY,
  gateway,
});
const cleanup = setInterval(() => gateway.purgeExpired(), 60000);
cleanup.unref();
const server = app.listen(port, process.env.HOST ?? '127.0.0.1', () => {
  // Allowlisted fields only. Never log requests, errors, credentials or movie data.
  console.info(
    JSON.stringify({
      event: 'server_started',
      port,
      credentialMode: 'per-user',
    }),
  );
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    clearInterval(cleanup);
    server.close(() => process.exit(0));
  });
