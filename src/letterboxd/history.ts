import { BridgeError } from '../errors';
import type { ImportResult, MovieIds, SourceMovie } from '../types';
import { normalizeTitle, parseCsv, validDate } from './csv';

function idsOf(row: Record<string, string>): MovieIds {
  const tmdb = row['TMDB ID'];
  const imdb = row['IMDb ID'];
  if (
    (tmdb && (!/^\d+$/.test(tmdb) || !Number.isSafeInteger(Number(tmdb)) || Number(tmdb) <= 0)) ||
    (imdb && !/^tt\d{7,12}$/.test(imdb))
  )
    throw new BridgeError('INVALID_EXPORT');
  return { ...(tmdb ? { tmdb: Number(tmdb) } : {}), ...(imdb ? { imdb } : {}) };
}
function filmUri(raw: string): string | undefined {
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BridgeError('INVALID_EXPORT');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    !['letterboxd.com', 'www.letterboxd.com', 'boxd.it'].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new BridgeError('INVALID_EXPORT');
  // Diary links point to a user's entry, not necessarily to the film. Never fetch them.
  if (url.hostname === 'boxd.it' || !/^\/film\/[^/]+\/?$/.test(url.pathname)) return undefined;
  return `https://letterboxd.com${url.pathname.replace(/\/$/, '')}`;
}
function titleYear(row: Record<string, string>) {
  const title = (row.Name ?? '').trim();
  if (!title || title.length > 500) throw new BridgeError('INVALID_EXPORT');
  const yearRaw = (row.Year ?? '').trim();
  const year = yearRaw ? Number(yearRaw) : undefined;
  if (year !== undefined && (!/^\d{4}$/.test(yearRaw) || year < 1880 || year > 2200))
    throw new BridgeError('INVALID_EXPORT');
  return { title, year, join: `${normalizeTitle(title)}|${year ?? ''}` };
}
export function parseHistory(watched: string, diary?: string): ImportResult {
  const rows = parseCsv(watched);
  const diaryRows = diary ? parseCsv(diary, true) : [];
  const movies = new Map<string, SourceMovie>();
  const joins = new Map<string, SourceMovie[]>();
  let duplicates = 0;
  let ignoredDates = 0;
  let unmatchedDiary = 0;
  for (const row of rows) {
    const { title, year, join } = titleYear(row);
    const ids = idsOf(row);
    const uri = filmUri(row['Letterboxd URI'] ?? '');
    const rawUri = row['Letterboxd URI'];
    const key =
      uri ??
      (rawUri ? rawUri.replace(/\/$/, '') : ids.tmdb ? `tmdb:${ids.tmdb}` : (ids.imdb ?? join));
    const existing = movies.get(key);
    if (existing) {
      if (
        (ids.tmdb && existing.ids.tmdb && ids.tmdb !== existing.ids.tmdb) ||
        (ids.imdb && existing.ids.imdb && ids.imdb !== existing.ids.imdb)
      )
        throw new BridgeError('INVALID_EXPORT');
      existing.ids = { ...existing.ids, ...ids };
      duplicates++;
      continue;
    }
    const movie: SourceMovie = { key, title, year, ids, watchedDates: [] };
    movies.set(key, movie);
    const group = joins.get(join) ?? [];
    group.push(movie);
    joins.set(join, group);
  }
  for (const row of diaryRows) {
    const { join } = titleYear(row);
    const uri = filmUri(row['Letterboxd URI'] ?? '');
    const group = joins.get(join);
    const movie =
      (uri ? movies.get(uri) : undefined) ?? (group?.length === 1 ? group[0] : undefined);
    if (!movie) {
      unmatchedDiary++;
      continue;
    }
    const date = row['Watched Date'] ?? '';
    if (!validDate(date)) {
      ignoredDates++;
      continue;
    }
    movie.watchedDates.push(date);
  }
  for (const movie of movies.values()) movie.watchedDates = [...new Set(movie.watchedDates)].sort();
  const warnings: string[] = [];
  if (ignoredDates)
    warnings.push(`${ignoredDates} diary dates were empty or invalid and were not used.`);
  if (unmatchedDiary)
    warnings.push(
      `${unmatchedDiary} diary entries could not be linked unambiguously to watched.csv and were not imported.`,
    );
  return {
    movies: [...movies.values()],
    watchedRows: rows.length,
    diaryRows: diaryRows.length,
    duplicates,
    warnings,
  };
}
