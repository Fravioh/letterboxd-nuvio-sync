import { z } from 'zod';
import { BridgeError } from '../errors';
import { TemporaryCache } from '../storage/temporary-cache';
import { requestJson } from '../sync/retry';
import type { Candidate, MetadataProvider } from '../types';
import { candidateSchema, type MetadataRequest } from './schema';

export class TmdbProvider implements MetadataProvider {
  private readonly cache = new TemporaryCache<Candidate[]>();
  constructor(private readonly credential = '') {}
  async query(request: MetadataRequest, signal?: AbortSignal): Promise<Candidate[]> {
    if (!this.credential) throw new BridgeError('METADATA_NOT_CONFIGURED');
    const key = JSON.stringify(request);
    const cached = this.cache.get(key);
    if (cached) return cached;
    // The server already retries upstream requests. Avoid multiplying retries here.
    const raw = await requestJson(
      '/api/metadata',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.credential}`,
        },
        body: key,
        signal,
      },
      'tmdb',
      45000,
    );
    const parsed = z.array(candidateSchema).max(100).safeParse(raw);
    if (!parsed.success) throw new BridgeError('INVALID_RESPONSE');
    this.cache.set(key, parsed.data);
    return parsed.data;
  }
  search(title: string, year?: number, signal?: AbortSignal) {
    return this.query({ operation: 'search', title, year }, signal);
  }
  async movie(id: number, signal?: AbortSignal) {
    const result = (await this.query({ operation: 'movie', id }, signal))[0];
    if (!result) throw new BridgeError('NOT_FOUND');
    return result;
  }
  find(imdb: string, signal?: AbortSignal) {
    return this.query({ operation: 'find', imdb }, signal);
  }
}
