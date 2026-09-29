import { createApp } from '../server/app.js';
import { TmdbGateway } from '../server/tmdb.js';

function deploymentOrigin(): string {
  const configured = process.env.APP_ORIGIN?.trim().replace(/\/$/, '');
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== 'https:') throw new Error('APP_ORIGIN must use HTTPS.');
    return url.origin;
  }

  const vercelHost = (
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL
  )?.trim();
  if (vercelHost && /^[A-Za-z0-9.-]+(?::\d+)?$/.test(vercelHost)) {
    return `https://${vercelHost}`;
  }

  if (process.env.NODE_ENV !== 'production') return 'http://127.0.0.1:3000';
  throw new Error('Set APP_ORIGIN or enable Vercel system environment variables.');
}

export default createApp({
  origin: deploymentOrigin(),
  trustProxy: process.env.TRUST_PROXY ?? 'loopback,linklocal,uniquelocal',
  gateway: new TmdbGateway(),
});
