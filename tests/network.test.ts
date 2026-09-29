import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeError } from '../src/errors';
import { getProfiles, signIn, type Session } from '../src/nuvio/auth';
import { NuvioWatchHistoryDestination } from '../src/nuvio/client';
import { toWatchedItem } from '../src/nuvio/watched';
import { requestJson, retry } from '../src/sync/retry';
import { candidate, noWait, source } from './helpers';
import { TemporaryCache } from '../src/storage/temporary-cache';
import { TmdbProvider } from '../src/metadata/tmdb';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const session: Session = {
  accessToken: 'test-only-token',
  expiresAt: Date.now() + 3600000,
  userId: 'synthetic-user',
};
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
describe('Nuvio authentication and real HTTP contracts with mocked transport', () => {
  it('signs in directly to documented Nuvio auth and drops refresh tokens', async () => {
    const fetchMock = vi.fn(async () =>
      json({
        access_token: 'short-lived',
        refresh_token: 'must-not-retain',
        expires_in: 3600,
        user: { id: 'synthetic-user' },
        email: 'private',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await signIn('test@example.invalid', 'test-password');
    expect(result).toEqual({
      accessToken: 'short-lived',
      expiresAt: expect.any(Number),
      userId: 'synthetic-user',
    });
    expect(JSON.stringify(result)).not.toContain('must-not-retain');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.nuvio.tv/auth/v1/token?grant_type=password');
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'test@example.invalid',
      password: 'test-password',
    });
  });
  it('validates profiles including locked profiles', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json([{ profile_index: 2, name: 'Test', pin_enabled: true }])),
    );
    expect(await getProfiles(session)).toEqual([
      { profile_index: 2, name: 'Test', pin_enabled: true },
    ]);
  });
  it('rejects duplicate profile indexes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json([
          { profile_index: 1, name: 'A' },
          { profile_index: 1, name: 'B' },
        ]),
      ),
    );
    await expect(getProfiles(session)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('rejects malformed authentication response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ refresh_token: 'no-access' })),
    );
    await expect(signIn('x', 'x')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('classifies invalid login without exposing upstream error text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ message: 'secret token test-password' }, 400)),
    );
    await expect(signIn('x', 'x')).rejects.toMatchObject({ code: 'AUTH_FAILED' });
  });
  it('uses 1-indexed pagination and stops on a short page', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const params = JSON.parse(String(init.body)) as { p_page: number };
      return json(
        params.p_page === 1
          ? Array.from({ length: 500 }, (_, i) => toWatchedItem(source(i + 1), candidate(i + 1)))
          : [toWatchedItem(source(501), candidate(501))],
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await new NuvioWatchHistoryDestination(session, 2).read();
    expect(result).toHaveLength(501);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1].body))).toEqual({
      p_profile_id: 2,
      p_page: 2,
      p_page_size: 500,
    });
  });
  it('rejects repeated rows across pages instead of silently truncating', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(Array.from({ length: 500 }, (_, i) => toWatchedItem(source(i + 1), candidate(i + 1)))),
      ),
    );
    await expect(new NuvioWatchHistoryDestination(session, 1).read()).rejects.toMatchObject({
      code: 'SNAPSHOT_CHANGED',
    });
  });
  it('validates malformed history rather than using an empty fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'unexpected' })),
    );
    await expect(new NuvioWatchHistoryDestination(session, 1).read()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('sends profile-scoped arrays and accepts 204', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const payload = toWatchedItem(source(), candidate());
    await new NuvioWatchHistoryDestination(session, 3).write([payload]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.nuvio.tv/rest/v1/rpc/sync_push_watched_items');
    expect(JSON.parse(String(init.body))).toEqual({ p_profile_id: 3, p_items: [payload] });
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-only-token' });
  });
  it('rejects expired sessions before a network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      new NuvioWatchHistoryDestination({ ...session, expiresAt: 0 }, 1).read(),
    ).rejects.toMatchObject({ code: 'AUTH_EXPIRED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('never allows series payloads into this destination', async () => {
    await expect(
      new NuvioWatchHistoryDestination(session, 1).write([
        { ...toWatchedItem(source(), candidate()), content_type: 'series' },
      ]),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
describe('timeouts, retries and caching', () => {
  it('honors Retry-After on a transient response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '2' } })),
    );
    await expect(requestJson('https://example.invalid', {}, 'tmdb')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterMs: 2000,
    });
  });
  it('classifies network and CORS failures without leaking raw errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('private request body');
      }),
    );
    await expect(requestJson('https://example.invalid', {}, 'tmdb')).rejects.toMatchObject({
      code: 'NETWORK',
    });
  });
  it('times out and aborts the fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            ),
          ),
      ),
    );
    await expect(requestJson('https://example.invalid', {}, 'tmdb', 10)).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });
  it('classifies a cancelled request separately from timeout', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      requestJson('https://example.invalid', { signal: controller.signal }, 'tmdb'),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });
  it('retries transient failures a bounded number of times', async () => {
    const fn = vi.fn(async () => {
      throw new BridgeError('NETWORK', true);
    });
    await expect(retry(fn, { sleep: noWait })).rejects.toMatchObject({ code: 'NETWORK' });
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it('does not retry expired authentication', async () => {
    const fn = vi.fn(async () => {
      throw new BridgeError('AUTH_EXPIRED');
    });
    await expect(retry(fn, { sleep: noWait })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('does not retry earlier than a very long Retry-After', async () => {
    const fn = vi.fn(async () => {
      throw new BridgeError('RATE_LIMITED', true, 120000);
    });
    await expect(retry(fn, { sleep: noWait })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('expires and bounds the temporary cache', () => {
    let now = 0;
    const cache = new TemporaryCache<number>(2, 10, () => now);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
    now = 11;
    expect(cache.get('c')).toBeUndefined();
  });
  it('sends the current user TMDB credential to the same-origin gateway and caches results', async () => {
    const fetchMock = vi.fn(async () => json([candidate()]));
    vi.stubGlobal('fetch', fetchMock);
    const tmdb = new TmdbProvider('browser-owned-token');
    await tmdb.movie(1);
    await tmdb.movie(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/metadata');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer browser-owned-token',
    });
  });
  it('refuses metadata lookup before the user supplies a credential', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new TmdbProvider().movie(1)).rejects.toMatchObject({
      code: 'METADATA_NOT_CONFIGURED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('metadata configuration errors', () => {
  it('recognizes the structured error even without the custom header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ code: 'METADATA_NOT_CONFIGURED' }, 503)),
    );
    await expect(requestJson('/api/metadata', {}, 'tmdb')).rejects.toMatchObject({
      code: 'METADATA_NOT_CONFIGURED',
      retryable: false,
    });
  });
  it('keeps generic malformed 503 responses retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unavailable', { status: 503 })),
    );
    await expect(requestJson('/api/metadata', {}, 'tmdb')).rejects.toMatchObject({
      code: 'TMDB_UNAVAILABLE',
      retryable: true,
    });
  });
});
