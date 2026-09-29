import { z } from 'zod';
import { BridgeError } from '../errors';
import type { Candidate, SourceMovie, WatchedItem } from '../types';
export const watchedSchema = z.object({
  content_id: z.string().min(1).max(200),
  content_type: z.string().min(1),
  title: z.string().max(2000).default(''),
  season: z.number().int().nullable().default(null),
  episode: z.number().int().nullable().default(null),
  watched_at: z.number().int().safe(),
});
export function movieAliases(movie: Candidate): string[] {
  return [`tmdb:${movie.tmdb}`, ...(movie.imdb ? [movie.imdb, `imdb:${movie.imdb}`] : [])];
}
export function watchedMovieIds(items: WatchedItem[]): Set<string> {
  return new Set(
    items
      .filter(
        (item) => item.content_type === 'movie' && item.season === null && item.episode === null,
      )
      .map((item) => item.content_id),
  );
}
export function isWatched(movie: Candidate, ids: Set<string>): boolean {
  return movieAliases(movie).some((id) => ids.has(id));
}
export function toWatchedItem(source: SourceMovie, movie: Candidate): WatchedItem {
  const lastDate = source.watchedDates.at(-1);
  const payload = {
    content_id: movie.imdb ?? `tmdb:${movie.tmdb}`,
    content_type: 'movie',
    title: movie.title,
    season: null,
    episode: null,
    watched_at: lastDate ? Date.parse(`${lastDate}T12:00:00Z`) : 0,
  };
  if (
    !/^tt\d{7,12}$|^tmdb:[1-9]\d*$/.test(payload.content_id) ||
    !Number.isSafeInteger(payload.watched_at)
  )
    throw new BridgeError('INVALID_RESPONSE');
  return watchedSchema.parse(payload);
}
