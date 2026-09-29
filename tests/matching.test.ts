import { describe, expect, it, vi } from 'vitest';
import { MovieMatcher, rankMatches } from '../src/matching/movie-matcher';
import type { MetadataProvider } from '../src/types';
import { BridgeError } from '../src/errors';
import { candidate, source } from './helpers';

function provider(): MetadataProvider {
  return {
    search: vi.fn(async () => [candidate()]),
    movie: vi.fn(async () => candidate()),
    find: vi.fn(async () => [candidate()]),
  };
}
describe('conservative matching', () => {
  it('does not assign HIGH to empty normalized titles', () => {
    expect(
      rankMatches({ ...source(), title: '!!!' }, [
        { ...candidate(), title: '???', originalTitle: '???' },
      ]).selected,
    ).toBeUndefined();
  });
  it('stops all analysis workers on a global outage', async () => {
    const p = provider();
    p.search = vi.fn(async () => {
      throw new BridgeError('RATE_LIMITED', true, 60000);
    });
    await expect(
      new MovieMatcher(p).analyze(
        Array.from({ length: 100 }, (_, i) => source(i + 1)),
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(p.search).toHaveBeenCalledTimes(3);
  });
  it('uses HIGH for a unique exact title and year', () =>
    expect(rankMatches(source(), [candidate()]).confidence).toBe('HIGH'));
  it('normalizes accents and punctuation', () =>
    expect(
      rankMatches({ ...source(), title: 'Amélie!' }, [{ ...candidate(), title: 'Amelie' }])
        .confidence,
    ).toBe('HIGH'));
  it('recognizes original-language titles', () =>
    expect(
      rankMatches({ ...source(), title: 'Le fabuleux destin' }, [
        { ...candidate(), originalTitle: 'Le fabuleux destin' },
      ]).confidence,
    ).toBe('HIGH'));
  it('requires confirmation for a one-year difference', () => {
    const match = rankMatches(source(), [{ ...candidate(), year: 2001 }]);
    expect(match.confidence).toBe('MEDIUM');
    expect(match.selected).toBeUndefined();
  });
  it('does not select a remake', () =>
    expect(rankMatches(source(), [{ ...candidate(), year: 2020 }]).selected).toBeUndefined());
  it('does not auto-select equal candidates', () => {
    const match = rankMatches(source(), [candidate(), { ...candidate(), tmdb: 2 }]);
    expect(match.confidence).toBe('MEDIUM');
    expect(match.selected).toBeUndefined();
  });
  it('does not auto-select without a release year', () =>
    expect(rankMatches({ ...source(), year: undefined }, [candidate()]).selected).toBeUndefined());
  it('returns LOW for no results', () => expect(rankMatches(source(), []).confidence).toBe('LOW'));
  it('does not auto-select from a potentially truncated result set', () =>
    expect(rankMatches(source(), [candidate()], false).selected).toBeUndefined());
  it('deduplicates identical candidate IDs', () =>
    expect(rankMatches(source(), [candidate(), candidate()]).confidence).toBe('HIGH'));
  it('uses supplied TMDB ID before title lookup and enriches IMDb', async () => {
    const p = provider();
    const result = await new MovieMatcher(p).match({ ...source(), ids: { tmdb: 1 } });
    expect(p.search).not.toHaveBeenCalled();
    expect(p.movie).toHaveBeenCalledWith(1, undefined);
    expect(result.selected?.imdb).toBe('tt0000001');
  });
  it('uses IMDb find instead of title lookup', async () => {
    const p = provider();
    const result = await new MovieMatcher(p).match({ ...source(), ids: { imdb: 'tt0000001' } });
    expect(p.find).toHaveBeenCalledWith('tt0000001', undefined);
    expect(p.search).not.toHaveBeenCalled();
    expect(result.confidence).toBe('HIGH');
  });
  it('refuses contradictory explicit identifiers', async () => {
    const result = await new MovieMatcher(provider()).match({
      ...source(),
      ids: { tmdb: 1, imdb: 'tt9999999' },
    });
    expect(result.selected).toBeUndefined();
    expect(result.reason).toContain('conflict');
  });
  it('rechecks hydrated movie details before assigning HIGH', async () => {
    const p = provider();
    p.movie = async () => ({
      ...candidate(),
      title: 'Another title',
      originalTitle: 'Another title',
      year: 1998,
    });
    expect((await new MovieMatcher(p).match(source())).selected).toBeUndefined();
  });
  it('stops on provider outages rather than flooding the API', async () => {
    const p = provider();
    p.search = async () => {
      throw new BridgeError('TMDB_UNAVAILABLE');
    };
    await expect(new MovieMatcher(p).match(source())).rejects.toMatchObject({
      code: 'TMDB_UNAVAILABLE',
    });
  });
  it('surfaces missing installation configuration globally', async () => {
    const p = provider();
    p.search = async () => {
      throw new BridgeError('METADATA_NOT_CONFIGURED');
    };
    await expect(new MovieMatcher(p).match(source())).rejects.toMatchObject({
      code: 'METADATA_NOT_CONFIGURED',
    });
  });
  it('cancels without consuming more metadata calls', async () => {
    const p = provider();
    const abort = new AbortController();
    abort.abort();
    await expect(
      new MovieMatcher(p).analyze([source()], () => undefined, abort.signal),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(p.search).not.toHaveBeenCalled();
  });
  it('reports progress and retains source ordering under concurrency', async () => {
    const p = provider();
    const progress = vi.fn();
    const result = await new MovieMatcher(p).analyze([source(1), source(2), source(3)], progress);
    expect(result.map((row) => row.source.key)).toEqual(['source:1', 'source:2', 'source:3']);
    expect(progress).toHaveBeenLastCalledWith(3, 3);
  });
});
