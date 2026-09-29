import { z } from 'zod';
import { BridgeError } from '../src/errors.js';
import { requestJson, retry } from '../src/sync/retry.js';
import { TemporaryCache } from '../src/storage/temporary-cache.js';
import type { Candidate } from '../src/types/index.js';
import type { MetadataRequest } from '../src/metadata/schema.js';

const movieSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1).max(500),
  original_title: z.string().max(500),
  release_date: z.string().optional().default(''),
  imdb_id: z.string().nullable().optional(),
  poster_path: z.string().nullable().optional(),
});
function convert(raw: z.infer<typeof movieSchema>): Candidate {
  const year = Number(raw.release_date.slice(0, 4));
  return {
    tmdb: raw.id,
    title: raw.title,
    originalTitle: raw.original_title,
    ...(year >= 1880 && year <= 2200 ? { year } : {}),
    ...(raw.imdb_id && /^tt\d{7,12}$/.test(raw.imdb_id) ? { imdb: raw.imdb_id } : {}),
    ...(raw.poster_path ? { posterPath: raw.poster_path } : {}),
  };
}
// One queue per server process. Starts at most 4 upstream requests/second.
export class TmdbGateway {
  private readonly cache = new TemporaryCache<Candidate[]>(20000, 3600000);
  private readonly inflight = new Map<string, Promise<Candidate[]>>();
  private tail: Promise<void> = Promise.resolve();
  private queued = 0;
  purgeExpired() {
    this.cache.purgeExpired();
  }
  private async upstream(path: string, token: string): Promise<unknown> {
    if (this.queued >= 100) throw new BridgeError('RATE_LIMITED', true, 2000);
    this.queued++;
    const slot = this.tail;
    this.tail = slot.then(() => new Promise((resolve) => setTimeout(resolve, 250)));
    try {
      await slot;
      const isV3 = token.length === 32 && /^[a-f0-9]{32}$/i.test(token);
      const url = isV3
        ? `https://api.themoviedb.org/3${path}${path.includes('?') ? '&' : '?'}api_key=${token}`
        : `https://api.themoviedb.org/3${path}`;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (!isV3) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      return await requestJson(url, { headers }, 'tmdb');
    } finally {
      this.queued--;
    }
  }
  async query(request: MetadataRequest, token: string): Promise<Candidate[]> {
    if (!token) throw new BridgeError('METADATA_NOT_CONFIGURED');
    const key = JSON.stringify(request);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const promise = this.resolve(request, token)
      .then((result) => {
        this.cache.set(key, result);
        return result;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }
  private async resolve(request: MetadataRequest, token: string): Promise<Candidate[]> {
    if (request.operation === 'movie') {
      const raw = await retry(() => this.upstream(`/movie/${request.id}?language=en-US`, token));
      const parsed = movieSchema.safeParse(raw);
      if (!parsed.success) throw new BridgeError('INVALID_RESPONSE');
      return [convert(parsed.data)];
    }
    if (request.operation === 'find') {
      const raw = await retry(() =>
        this.upstream(`/find/${request.imdb}?external_source=imdb_id`, token),
      );
      const parsed = z.object({ movie_results: z.array(movieSchema).max(100) }).safeParse(raw);
      if (!parsed.success) throw new BridgeError('INVALID_RESPONSE');
      return Promise.all(
        parsed.data.movie_results.map(async (row) => {
          const full = (await this.query({ operation: 'movie', id: row.id }, token))[0];
          if (!full || full.imdb !== request.imdb) throw new BridgeError('INVALID_RESPONSE');
          return full;
        }),
      );
    }
    const params = new URLSearchParams({
      query: request.title,
      include_adult: 'true',
      language: 'en-US',
      page: '1',
    });
    if (request.year) params.set('primary_release_year', String(request.year));
    const raw = await retry(() => this.upstream(`/search/movie?${params}`, token));
    const parsed = z.object({ results: z.array(movieSchema).max(20) }).safeParse(raw);
    if (!parsed.success) throw new BridgeError('INVALID_RESPONSE');
    return parsed.data.results.map(convert);
  }
}
