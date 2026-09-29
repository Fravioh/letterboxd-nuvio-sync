import { z } from 'zod';
import { BridgeError, checkAbort } from '../errors';
import { requestJson, retry } from '../sync/retry';
import type { WatchHistoryDestination, WatchedItem } from '../types';
import { authHeaders, NUVIO_URL, type Session } from './auth';
import { watchedSchema } from './watched';

export class NuvioWatchHistoryDestination implements WatchHistoryDestination {
  readonly identity: string;
  constructor(
    private readonly session: Session,
    private readonly profileId: number,
  ) {
    if (!Number.isInteger(profileId) || profileId < 1 || profileId > 6)
      throw new BridgeError('PROFILE_CHANGED');
    this.identity = `${session.userId}:${profileId}`;
  }
  private async rpc(name: string, body: Record<string, unknown>, signal?: AbortSignal) {
    if (Date.now() >= this.session.expiresAt - 5000) throw new BridgeError('AUTH_EXPIRED');
    return requestJson(
      `${NUVIO_URL}/rest/v1/rpc/${name}`,
      { method: 'POST', headers: authHeaders(this.session), body: JSON.stringify(body), signal },
      'nuvio',
    );
  }
  async read(signal?: AbortSignal): Promise<WatchedItem[]> {
    const all: WatchedItem[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= 400; page++) {
      checkAbort(signal);
      const raw = await retry(
        () =>
          this.rpc(
            'sync_pull_watched_items',
            { p_profile_id: this.profileId, p_page: page, p_page_size: 500 },
            signal,
          ),
        { signal },
      );
      const result = z.array(watchedSchema).max(500).safeParse(raw);
      if (!result.success) throw new BridgeError('INVALID_RESPONSE');
      for (const item of result.data) {
        const key = `${item.content_id}|${item.season}|${item.episode}`;
        if (seen.has(key)) throw new BridgeError('SNAPSHOT_CHANGED');
        seen.add(key);
        all.push(item);
      }
      if (result.data.length < 500) return all;
    }
    throw new BridgeError('INVALID_RESPONSE'); // Never claim a truncated history is complete.
  }
  async write(items: WatchedItem[]) {
    if (!items.length || items.length > 100) throw new BridgeError('INVALID_RESPONSE');
    const parsed = z
      .array(
        watchedSchema.extend({
          content_type: z.literal('movie'),
          season: z.null(),
          episode: z.null(),
          content_id: z.string().regex(/^(?:tt\d{7,12}|tmdb:[1-9]\d*)$/),
        }),
      )
      .safeParse(items);
    if (!parsed.success) throw new BridgeError('INVALID_RESPONSE');
    const response = await this.rpc('sync_push_watched_items', {
      p_profile_id: this.profileId,
      p_items: parsed.data,
    });
    if (response !== null) throw new BridgeError('INVALID_RESPONSE');
  }
}
