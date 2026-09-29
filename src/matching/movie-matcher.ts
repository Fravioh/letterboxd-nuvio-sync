import { checkAbort, safeError } from '../errors';
import { normalizeTitle } from '../letterboxd/csv';
import type { Candidate, Match, MetadataProvider, SourceMovie } from '../types';

export function scoreCandidate(source: SourceMovie, movie: Candidate): number {
  const title = normalizeTitle(source.title);
  if (!title) return 0;
  const exact = [movie.title, movie.originalTitle].some((value) => normalizeTitle(value) === title);
  const year =
    source.year !== undefined && movie.year !== undefined
      ? Math.abs(source.year - movie.year)
      : undefined;
  if (exact && year === 0) return 1;
  if (exact && year === 1) return 0.8;
  if (exact && year === undefined) return 0.65;
  if (exact) return 0.35;
  const tokens = new Set(title.split(' '));
  const other = new Set(normalizeTitle(movie.title).split(' '));
  const overlap =
    [...tokens].filter((token) => other.has(token)).length /
    Math.max(1, new Set([...tokens, ...other]).size);
  return overlap * 0.5 + (year === 0 ? 0.3 : 0);
}
export function rankMatches(source: SourceMovie, candidates: Candidate[], complete = true): Match {
  const ranked = [...new Map(candidates.map((movie) => [movie.tmdb, movie])).values()]
    .map((movie) => ({ movie, score: scoreCandidate(source, movie) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const gap = (best?.score ?? 0) - (ranked[1]?.score ?? 0);
  const high = complete && best?.score === 1 && gap >= 0.2;
  const confidence = high ? 'HIGH' : best && best.score >= 0.65 ? 'MEDIUM' : 'LOW';
  return {
    source,
    candidates: ranked.slice(0, 20).map((row) => row.movie),
    selected: high ? best?.movie : undefined,
    confidence,
    manual: false,
    reason: high
      ? 'Unique exact title and year match'
      : best
        ? 'Confirm the film before syncing'
        : 'Movie not found',
  };
}
export class MovieMatcher {
  constructor(private readonly provider: MetadataProvider) {}
  async match(source: SourceMovie, signal?: AbortSignal): Promise<Match> {
    checkAbort(signal);
    try {
      if (source.ids.tmdb || source.ids.imdb) {
        const results = source.ids.tmdb
          ? [await this.provider.movie(source.ids.tmdb, signal)]
          : await this.provider.find(source.ids.imdb ?? '', signal);
        const movie = results.length === 1 ? results[0] : undefined;
        if (!movie || (source.ids.imdb && movie.imdb !== source.ids.imdb))
          return {
            source,
            candidates: results,
            confidence: 'LOW',
            manual: false,
            reason: 'Provided IDs conflict or could not be verified',
          };
        return {
          source,
          candidates: results,
          selected: movie,
          confidence: 'HIGH',
          manual: false,
          reason: 'Verified provider ID',
        };
      }
      let candidates = await this.provider.search(source.title, source.year, signal);
      if (!candidates.length && source.year)
        candidates = await this.provider.search(source.title, undefined, signal);
      const match = rankMatches(source, candidates, candidates.length < 20);
      if (match.selected) {
        const verified = await this.provider.movie(match.selected.tmdb, signal);
        const checked = rankMatches(source, [verified]);
        if (checked.confidence !== 'HIGH')
          return {
            ...match,
            selected: undefined,
            confidence: 'MEDIUM',
            reason: 'Movie details changed; confirm this match',
          };
        match.selected = verified;
        match.candidates = match.candidates.map((movie) =>
          movie.tmdb === verified.tmdb ? verified : movie,
        );
      }
      return match;
    } catch (error) {
      const safe = safeError(error);
      // Service-wide failures must stop the queue, not turn 10,000 rows into requests that will also fail.
      if (safe.code !== 'NOT_FOUND') throw safe;
      return {
        source,
        candidates: [],
        confidence: 'LOW',
        manual: false,
        reason: safe.message,
        errorCode: safe.code,
      };
    }
  }
  async analyze(
    movies: SourceMovie[],
    onProgress: (done: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<Match[]> {
    const local = new AbortController();
    const abort = () => local.abort();
    if (signal?.aborted) local.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const results: Match[] = new Array(movies.length);
    let cursor = 0;
    let completed = 0;
    try {
      await Promise.all(
        Array.from({ length: Math.min(3, movies.length) }, async () => {
          while (cursor < movies.length) {
            checkAbort(local.signal);
            const index = cursor++;
            const movie = movies[index];
            if (!movie) continue;
            results[index] = await this.match(movie, local.signal);
            onProgress(++completed, movies.length);
            if (completed % 50 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }),
      );
    } catch (error) {
      local.abort();
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
    return results;
  }
}
