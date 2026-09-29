import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/app';
import { TmdbGateway } from '../server/tmdb';
import { candidate } from './helpers';

afterEach(() => vi.unstubAllGlobals());
describe('metadata proxy security', () => {
  const gateway = { query: vi.fn(async () => [candidate()]) };
  it('reports per-user credential mode without exposing configuration', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.body).toEqual({ ok: true, credentialMode: 'per-user' });
  });
  it('accepts validated same-origin movie queries', async () => {
    const res = await request(createApp({ gateway, origin: 'https://bridge.example' }))
      .post('/api/metadata')
      .set('Origin', 'https://bridge.example')
      .set('Authorization', 'Bearer user-owned-token')
      .send({ operation: 'movie', id: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([candidate()]);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(gateway.query).toHaveBeenLastCalledWith(
      { operation: 'movie', id: 1 },
      'user-owned-token',
    );
  });
  it('accepts equivalent loopback origins during local development', async () => {
    const res = await request(
      createApp({
        gateway,
        origin: 'http://127.0.0.1:5173',
        allowLoopbackOrigins: true,
      }),
    )
      .post('/api/metadata')
      .set('Origin', 'http://localhost:5173')
      .set('Authorization', 'Bearer user-owned-token')
      .send({ operation: 'movie', id: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([candidate()]);
  });
  it('keeps loopback aliases strict outside local development', async () => {
    const res = await request(createApp({ gateway, origin: 'http://127.0.0.1:5173' }))
      .post('/api/metadata')
      .set('Origin', 'http://localhost:5173')
      .set('Authorization', 'Bearer user-owned-token')
      .send({ operation: 'movie', id: 1 });
    expect(res.status).toBe(403);
  });
  it('refuses cross-origin browser use', async () => {
    const res = await request(createApp({ gateway, origin: 'https://bridge.example' }))
      .post('/api/metadata')
      .set('Origin', 'https://evil.example')
      .send({ operation: 'movie', id: 1 });
    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('refuses arbitrary URL proxying and credential fields', async () => {
    const res = await request(createApp({ gateway })).post('/api/metadata').send({
      operation: 'movie',
      id: 1,
      url: 'http://localhost/internal',
      access_token: 'private',
    });
    expect(res.status).toBe(400);
  });
  it('does not accept uploaded ZIP files', async () => {
    const res = await request(createApp())
      .post('/api/metadata')
      .set('Content-Type', 'application/zip')
      .send(Buffer.from('PK'));
    expect(res.status).toBe(415);
  });
  it('rejects oversized JSON requests', async () => {
    const res = await request(createApp({ gateway }))
      .post('/api/metadata')
      .send({ operation: 'search', title: 'x'.repeat(5000) });
    expect(res.status).toBe(400);
  });
  it('does not reflect malformed JSON or credentials in errors', async () => {
    const res = await request(createApp())
      .post('/api/metadata')
      .set('Content-Type', 'application/json')
      .send('{"password":"do-not-echo"');
    expect(res.status).toBe(400);
    expect(res.text).not.toContain('do-not-echo');
  });
  it('rate limits a caller with Retry-After', async () => {
    const app = createApp({ gateway, rateLimitMax: 1 });
    await request(app).post('/api/metadata').send({ operation: 'movie', id: 1 });
    const res = await request(app).post('/api/metadata').send({ operation: 'movie', id: 2 });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
  it('fails explicitly when TMDB is not configured', async () => {
    const res = await request(createApp())
      .post('/api/metadata')
      .send({ operation: 'movie', id: 1 });
    expect(res.status).toBe(503);
    expect(res.headers['x-metadata-configured']).toBe('false');
  });
  it('sets a restrictive CSP and anti-framing headers', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.headers['content-security-policy']).toContain(
      "connect-src 'self' https://api.nuvio.tv",
    );
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).not.toContain('unsafe-inline');
  });
});
describe('TMDB official mapping', () => {
  const raw = {
    id: 1,
    title: 'Fictional movie 1',
    original_title: 'Fictional movie 1',
    release_date: '2000-06-20',
    imdb_id: 'tt0000001',
  };
  it('maps movie details using the current user bearer credential', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(raw)));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new TmdbGateway().query({ operation: 'movie', id: 1 }, 'user-token')).toEqual([
      candidate(),
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.themoviedb.org/3/movie/1?language=en-US');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer user-token' });
  });
  it('finds an IMDb ID through /find then verifies the movie', async () => {
    const fetchMock = vi.fn(
      async (url: string) =>
        new Response(JSON.stringify(url.includes('/find/') ? { movie_results: [raw] } : raw)),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await new TmdbGateway().query(
      { operation: 'find', imdb: 'tt0000001' },
      'user-token',
    );
    expect(result[0]?.imdb).toBe('tt0000001');
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/find/tt0000001?external_source=imdb_id');
  });
  it('maps search results without inventing an IMDb ID', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ results: [{ ...raw, imdb_id: undefined }] })),
      ),
    );
    const result = await new TmdbGateway().query(
      {
        operation: 'search',
        title: 'Fictional movie 1',
        year: 2000,
      },
      'user-token',
    );
    expect(result[0]?.imdb).toBeUndefined();
    expect(result[0]?.year).toBe(2000);
  });
  it('validates external responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: 'wrong type' }))),
    );
    await expect(
      new TmdbGateway().query({ operation: 'movie', id: 1 }, 'user-token'),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('coalesces simultaneous identical requests and caches results', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(raw)));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new TmdbGateway();
    await Promise.all([
      gateway.query({ operation: 'movie', id: 1 }, 'first-user-token'),
      gateway.query({ operation: 'movie', id: 1 }, 'second-user-token'),
    ]);
    await gateway.query({ operation: 'movie', id: 1 }, 'third-user-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('per-user TMDB credentials', () => {
  const origin = 'https://bridge.example';
  const token = 'synthetic-read-token';
  it.each([undefined, 'https://evil.example'])(
    'rejects missing or foreign Origin: %s',
    async (caller) => {
      const req = request(createApp({ origin })).post('/api/config');
      if (caller) req.set('Origin', caller);
      expect((await req.send({ token })).status).toBe(403);
    },
  );
  it('rejects newline injection before contacting TMDB', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await request(createApp({ origin }))
      .post('/api/config')
      .set('Origin', origin)
      .send({ token: token + '\nHOST=0.0.0.0' });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([token, 'a'.repeat(32)])(
    'validates a user credential without retaining it on the server: %s',
    async (credential) => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true })));
      vi.stubGlobal('fetch', fetchMock);
      const gateway = { query: vi.fn(async () => []) };
      const app = createApp({ origin, gateway });
      const res = await request(app)
        .post('/api/config')
        .set('Origin', origin)
        .send({ token: credential });
      expect(res.status).toBe(200);
      expect((await request(app).get('/api/health')).body).toEqual({
        ok: true,
        credentialMode: 'per-user',
      });
      expect(
        (await request(app).post('/api/metadata').send({ operation: 'movie', id: 1 })).status,
      ).toBe(503);
      expect(res.text).not.toContain(credential);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(
        'https://api.themoviedb.org/3/authentication' +
          (credential.length === 32 ? '?api_key=' + credential : ''),
      );
      expect(init.redirect).toBe('error');
      expect(init.signal).toBeDefined();
    },
  );
  it('accepts localhost as an alias for the configured local origin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true }))),
    );
    const res = await request(
      createApp({ origin: 'http://127.0.0.1:5173', allowLoopbackOrigins: true }),
    )
      .post('/api/config')
      .set('Origin', 'http://localhost:5173')
      .send({ token });
    expect(res.status).toBe(200);
  });
  it('does not apply rejected credentials or reflect upstream details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status_message: token }), { status: 401 })),
    );
    const res = await request(createApp({ origin }))
      .post('/api/config')
      .set('Origin', origin)
      .send({ token });
    expect(res.status).toBe(400);
    expect(res.text).not.toContain(token);
  });
  it('passes each request credential independently to the gateway', async () => {
    const gateway = {
      query: vi.fn(async (_request: unknown, _credential: string) => [candidate()]),
    };
    const app = createApp({ origin, gateway });
    for (const credential of ['first-user-token', 'second-user-token']) {
      expect(
        (
          await request(app)
            .post('/api/metadata')
            .set('Origin', origin)
            .set('Authorization', `Bearer ${credential}`)
            .send({ operation: 'movie', id: 1 })
        ).status,
      ).toBe(200);
    }
    expect(gateway.query.mock.calls.map(([, credential]) => credential)).toEqual([
      'first-user-token',
      'second-user-token',
    ]);
  });
  it('rate limits credential verification', async () => {
    const app = createApp({ origin, rateLimitMax: 1 });
    await request(app).post('/api/config').set('Origin', origin).send({ token: '' });
    expect(
      (await request(app).post('/api/config').set('Origin', origin).send({ token: '' })).status,
    ).toBe(429);
  });
});
