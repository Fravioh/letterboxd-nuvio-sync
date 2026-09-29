import { expect, it } from 'vitest';
import { parseExport } from '../src/letterboxd/export-parser';
import { MovieMatcher } from '../src/matching/movie-matcher';
import { buildPlan, sync } from '../src/sync/sync-engine';
import { candidate, header, MemoryDestination, noWait, zip } from './helpers';
import type { MetadataProvider } from '../src/types';

it.each([10, 100, 1000, 5000, 10000])(
  'parses, matches, previews, dry-runs and syncs %i synthetic movies twice',
  async (count) => {
    const started = performance.now();
    const csv =
      header.trimEnd() +
      ',TMDB ID\n' +
      Array.from(
        { length: count },
        (_, index) =>
          `2024-01-01,Fictional movie ${index + 1},2000,https://letterboxd.com/film/synthetic-${index + 1}/,${index + 1}`,
      ).join('\n');
    const imported = parseExport(zip({ 'watched.csv': csv }));
    const metadata: MetadataProvider = {
      movie: async (id) => candidate(id),
      search: async () => [],
      find: async () => [],
    };
    const matches = await new MovieMatcher(metadata).analyze(imported.movies, () => undefined);
    const destination = new MemoryDestination();
    const plan = buildPlan(matches, [], destination.identity);
    const dry = await sync(plan, destination, { dryRun: true, confirmed: false });
    expect(dry.remaining).toBe(count);
    expect(destination.calls).toHaveLength(0);
    const first = await sync(plan, destination, { dryRun: false, confirmed: true, sleep: noWait });
    const second = await sync(
      buildPlan(matches, await destination.read(), destination.identity),
      destination,
      { dryRun: false, confirmed: true, sleep: noWait },
    );
    expect(first.added).toBe(count);
    expect(second.added).toBe(0);
    expect(destination.items).toHaveLength(count);
    expect(destination.calls).toHaveLength(Math.ceil(count / 100));
    console.info(
      JSON.stringify({
        event: 'synthetic_scale_test',
        movies: count,
        elapsedMs: Math.round(performance.now() - started),
        batches: destination.calls.length,
      }),
    );
  },
);
