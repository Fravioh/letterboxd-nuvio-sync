import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { resolve } from 'node:path';
import { metadataRequestSchema } from '../src/metadata/schema.js';
import { safeError } from '../src/errors.js';
import { TmdbGateway } from './tmdb.js';
import { requestJson } from '../src/sync/retry.js';
import type { Candidate } from '../src/types/index.js';
import type { MetadataRequest } from '../src/metadata/schema.js';

export interface ServerOptions {
  origin?: string;
  trustProxy?: string;
  staticDirectory?: string;
  gateway?: {
    query(request: MetadataRequest, credential: string): Promise<Candidate[]>;
  };
  allowLoopbackOrigins?: boolean;
  rateLimitMax?: number;
}

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

function allowedOrigin(requestOrigin: string | undefined, options: ServerOptions): boolean {
  if (!requestOrigin || requestOrigin === options.origin) return true;
  if (!options.allowLoopbackOrigins || !options.origin) return false;
  try {
    const requestUrl = new URL(requestOrigin);
    const configuredUrl = new URL(options.origin);
    return (
      requestUrl.protocol === 'http:' &&
      configuredUrl.protocol === 'http:' &&
      requestUrl.port === configuredUrl.port &&
      loopbackHosts.has(requestUrl.hostname) &&
      loopbackHosts.has(configuredUrl.hostname)
    );
  } catch {
    return false;
  }
}

export function createApp(options: ServerOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (options.trustProxy)
    app.set(
      'trust proxy',
      options.trustProxy.split(',').map((value) => value.trim()),
    );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https://image.tmdb.org'],
          connectSrc: ["'self'", 'https://api.nuvio.tv'],
          workerSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Access-Control-Expose-Headers', 'X-Metadata-Configured, Retry-After');
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true, credentialMode: 'per-user' }));
  app.use(['/api/metadata', '/api/config'], (req, res, next) => {
    const origin = req.get('origin');
    if (!allowedOrigin(origin, options) || req.get('sec-fetch-site') === 'cross-site') {
      res.status(403).json({ code: 'ORIGIN_NOT_ALLOWED' });
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ code: 'METHOD_NOT_ALLOWED' });
      return;
    }
    if (!req.is('application/json')) {
      res.status(415).json({ code: 'JSON_REQUIRED' });
      return;
    }
    next();
  });
  app.use(
    ['/api/metadata', '/api/config'],
    rateLimit({
      windowMs: 60000,
      limit: options.rateLimitMax ?? 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { code: 'RATE_LIMITED' },
    }),
  );
  app.use(express.json({ limit: '2kb', strict: true }));
  const gateway = options.gateway ?? new TmdbGateway();
  app.post('/api/metadata', async (req, res) => {
    const parsed = metadataRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ code: 'INVALID_QUERY' });
      return;
    }
    const credential = cleanCredential(req.get('authorization'));
    if (!credential) {
      res.set('X-Metadata-Configured', 'false');
      res.status(503).json({ code: 'METADATA_NOT_CONFIGURED' });
      return;
    }
    try {
      res.json(await gateway.query(parsed.data, credential));
    } catch (error) {
      const safe = safeError(error);
      if (safe.code === 'METADATA_NOT_CONFIGURED') res.set('X-Metadata-Configured', 'false');
      if (safe.code === 'RATE_LIMITED')
        res.set('Retry-After', String(Math.max(1, Math.ceil(safe.retryAfterMs / 1000))));
      res
        .status(safe.code === 'NOT_FOUND' ? 404 : safe.code === 'RATE_LIMITED' ? 429 : 503)
        .json({ code: safe.code });
    }
  });
  app.post('/api/config', async (req, res) => {
    if (!req.get('origin') || !allowedOrigin(req.get('origin'), options) || !options.origin) {
      res.status(403).json({ code: 'ORIGIN_NOT_ALLOWED' });
      return;
    }
    const cleanToken = cleanCredential(
      typeof req.body?.token === 'string' ? req.body.token : undefined,
    );
    if (!cleanToken) {
      res.status(400).json({ error: 'Enter a valid TMDB API key or read access token.' });
      return;
    }
    const isV3 = /^[a-f0-9]{32}$/i.test(cleanToken);
    try {
      const url = isV3
        ? `https://api.themoviedb.org/3/authentication?api_key=${cleanToken}`
        : 'https://api.themoviedb.org/3/authentication';
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (!isV3) headers.Authorization = `Bearer ${cleanToken}`;
      const data = await requestJson(url, { headers }, 'tmdb');
      if (!data || typeof data !== 'object' || !('success' in data) || data.success !== true) {
        res.status(400).json({ error: 'TMDB could not validate these credentials.' });
        return;
      }
    } catch (error) {
      const safe = safeError(error);
      res
        .status(safe.retryable ? 502 : 400)
        .json({ error: 'TMDB verification failed. Check your credentials and try again.' });
      return;
    }
    res.json({ ok: true });
  });
  app.use('/api', (_req, res) => {
    res.status(404).json({ code: 'NOT_FOUND' });
  });
  app.use(
    express.static(options.staticDirectory ?? resolve('dist'), { index: 'index.html', maxAge: 0 }),
  );
  const errorHandler: ErrorRequestHandler = (_error, _req, res, _next) => {
    res.status(400).json({ code: 'INVALID_REQUEST' });
  };
  app.use(errorHandler);
  return app;
}

function cleanCredential(raw: string | undefined): string | undefined {
  const value = (raw ?? '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  return /^[A-Za-z0-9._-]{16,1500}$/.test(value) ? value : undefined;
}
