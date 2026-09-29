import { describe, expect, it, vi } from 'vitest';
import { BridgeError } from '../src/errors';
import { toWatchedItem } from '../src/nuvio/watched';
import { batches } from '../src/sync/batcher';
import { buildPlan, sync } from '../src/sync/sync-engine';
import { match, MemoryDestination, noWait, source, candidate } from './helpers';

const options = { dryRun: false, confirmed: true, sleep: noWait };
describe('watched payload and sync engine', () => {
  it('retains the latest diary date across rows mapped to the same film', () => {
    const first = match();
    const second = { ...match(), source: { ...source(2), watchedDates: ['2024-07-13'] } };
    const plan = buildPlan([first, second], [], 'test-account:1');
    expect(plan.pending).toHaveLength(1);
    expect(plan.pending[0]?.payload.watched_at).toBe(Date.parse('2024-07-13T12:00:00Z'));
  });
  it('does not start a retry when cancellation arrives during backoff', async () => {
    const dest = new MemoryDestination();
    const abort = new AbortController();
    dest.write = vi.fn(async () => {
      throw new BridgeError('NETWORK', true);
    });
    const result = await sync(buildPlan([match()], [], dest.identity), dest, {
      ...options,
      signal: abort.signal,
      sleep: async () => {
        abort.abort();
      },
    });
    expect(dest.write).toHaveBeenCalledTimes(1);
    expect(result.cancelled).toBe(true);
    expect(result.remaining).toBe(1);
  });
  it('matches the documented Nuvio movie payload', () =>
    expect(toWatchedItem(source(), candidate())).toEqual({
      content_id: 'tt0000001',
      content_type: 'movie',
      title: 'Fictional movie 1',
      season: null,
      episode: null,
      watched_at: 0,
    }));
  it('falls back to a TMDB content ID when IMDb is absent', () =>
    expect(toWatchedItem(source(), { ...candidate(), imdb: undefined }).content_id).toBe('tmdb:1'));
  it('preserves latest diary date at noon UTC', () =>
    expect(
      toWatchedItem({ ...source(), watchedDates: ['2022-01-01', '2024-07-13'] }, candidate())
        .watched_at,
    ).toBe(Date.parse('2024-07-13T12:00:00Z')));
  it('compares IMDb and TMDB aliases', () => {
    const existing = { ...toWatchedItem(source(), candidate()), content_id: 'tmdb:1' };
    expect(buildPlan([match()], [existing], 'test-account:1').already).toHaveLength(1);
  });
  it('does not treat an episode as a watched movie', () => {
    const existing = {
      ...toWatchedItem(source(), candidate()),
      content_type: 'series',
      season: 1,
      episode: 2,
    };
    expect(buildPlan([match()], [existing], 'test-account:1').pending).toHaveLength(1);
  });
  it('keeps unconfirmed MEDIUM/LOW matches out of writes', () =>
    expect(
      buildPlan(
        [
          { ...match(), confidence: 'MEDIUM' },
          { ...match(2), confidence: 'LOW' },
        ],
        [],
        'test-account:1',
      ).pending,
    ).toHaveLength(0));
  it('allows an explicit manual selection', () =>
    expect(
      buildPlan([{ ...match(), confidence: 'LOW', manual: true }], [], 'test-account:1').pending,
    ).toHaveLength(1));
  it('deduplicates source entries that resolve to the same movie', () => {
    const plan = buildPlan([match(), { ...match(), source: source(2) }], [], 'test-account:1');
    expect(plan.pending).toHaveLength(1);
    expect(plan.duplicates).toBe(1);
  });
  it('requires explicit confirmation before any write', async () => {
    const dest = new MemoryDestination();
    await expect(
      sync(buildPlan([match()], [], dest.identity), dest, { ...options, confirmed: false }),
    ).rejects.toMatchObject({ code: 'CONFIRM_REQUIRED' });
    expect(dest.calls).toHaveLength(0);
  });
  it('prevents sending a plan to a different account/profile', async () => {
    const dest = new MemoryDestination();
    await expect(sync(buildPlan([match()], [], 'another:2'), dest, options)).rejects.toMatchObject({
      code: 'PROFILE_CHANGED',
    });
  });
  it('dry run reads and validates without writing', async () => {
    const dest = new MemoryDestination();
    const result = await sync(buildPlan([match()], [], dest.identity), dest, {
      ...options,
      dryRun: true,
      confirmed: false,
    });
    expect(result.remaining).toBe(1);
    expect(result.added).toBe(0);
    expect(dest.calls).toHaveLength(0);
  });
  it('is idempotent on consecutive runs without changing existing timestamps', async () => {
    const dest = new MemoryDestination();
    const plan = buildPlan([match(), match(2)], [], dest.identity);
    const first = await sync(plan, dest, options);
    const second = await sync(plan, dest, options);
    expect(first.added).toBe(2);
    expect(second.added).toBe(0);
    expect(second.already).toBe(2);
    expect(dest.calls).toHaveLength(1);
    expect(dest.items.every((item) => item.watched_at === 0)).toBe(true);
  });
  it('splits writes into bounded batches and reports monotonic progress', async () => {
    const dest = new MemoryDestination();
    const progress = vi.fn();
    const plan = buildPlan(
      Array.from({ length: 250 }, (_, i) => match(i + 1)),
      [],
      dest.identity,
    );
    const report = await sync(plan, dest, { ...options, onProgress: progress });
    expect(dest.calls.map((call) => call.length)).toEqual([100, 100, 50]);
    expect(report.added).toBe(250);
    expect(progress.mock.calls.map(([p]) => p.completed)).toEqual([0, 100, 200, 250, 250]);
  });
  it('rechecks history after preview so newly watched films are skipped', async () => {
    const dest = new MemoryDestination();
    const plan = buildPlan([match()], [], dest.identity);
    dest.items.push(toWatchedItem({ ...source(), watchedDates: ['2024-01-01'] }, candidate()));
    const report = await sync(plan, dest, options);
    expect(report.already).toBe(1);
    expect(dest.calls).toHaveLength(0);
    expect(dest.items[0]?.watched_at).toBe(Date.parse('2024-01-01T12:00:00Z'));
  });
  it('waits for the current batch then honors cancellation', async () => {
    const dest = new MemoryDestination();
    const abort = new AbortController();
    const write = dest.write.bind(dest);
    dest.write = async (items) => {
      await write(items);
      abort.abort();
    };
    const plan = buildPlan([match(), match(2), match(3)], [], dest.identity);
    const report = await sync(plan, dest, { ...options, signal: abort.signal, batchSize: 2 });
    expect(report).toMatchObject({ added: 2, remaining: 1, cancelled: true });
    expect(dest.calls).toHaveLength(1);
  });
  it('does not write if already cancelled', async () => {
    const dest = new MemoryDestination();
    const abort = new AbortController();
    abort.abort();
    const report = await sync(buildPlan([match()], [], dest.identity), dest, {
      ...options,
      signal: abort.signal,
    });
    expect(report.cancelled).toBe(true);
    expect(dest.calls).toHaveLength(0);
  });
  it('reconciles a committed batch after a lost response without resending', async () => {
    const dest = new MemoryDestination();
    const write = dest.write.bind(dest);
    dest.write = async (items) => {
      await write(items);
      throw new BridgeError('TIMEOUT', true);
    };
    const result = await sync(buildPlan([match()], [], dest.identity), dest, options);
    expect(result.added).toBe(1);
    expect(result.failed).toBe(0);
    expect(dest.calls).toHaveLength(1);
  });
  it('retries only the failed batch', async () => {
    const dest = new MemoryDestination();
    const write = dest.write.bind(dest);
    let calls = 0;
    dest.write = async (items) => {
      calls++;
      if (calls === 2) throw new BridgeError('NETWORK', true);
      await write(items);
    };
    const result = await sync(buildPlan([match(), match(2), match(3)], [], dest.identity), dest, {
      ...options,
      batchSize: 1,
    });
    expect(result.added).toBe(3);
    expect(calls).toBe(4);
    expect(dest.calls.map((call) => call[0]?.content_id)).toEqual([
      'tt0000001',
      'tt0000002',
      'tt0000003',
    ]);
  });
  it('stops on expired authentication and retains a report', async () => {
    const dest = new MemoryDestination();
    dest.write = async () => {
      throw new BridgeError('AUTH_EXPIRED');
    };
    const report = await sync(buildPlan([match(), match(2)], [], dest.identity), dest, {
      ...options,
      batchSize: 1,
    });
    expect(report.failed).toBe(1);
    expect(report.remaining).toBe(1);
    expect(report.failures[0]?.code).toBe('AUTH_EXPIRED');
  });
  it('reports uncertain writes when read-back also fails', async () => {
    const dest = new MemoryDestination();
    let reads = 0;
    dest.read = async () => {
      if (++reads > 1) throw new BridgeError('NETWORK', true);
      return [];
    };
    dest.write = async () => {
      throw new BridgeError('TIMEOUT', true);
    };
    const report = await sync(buildPlan([match()], [], dest.identity), dest, options);
    expect(report).toMatchObject({ added: 0, failed: 1, uncertain: 1 });
  });
  it('bounds repeated transient failures to three writes', async () => {
    const dest = new MemoryDestination();
    dest.write = vi.fn(async () => {
      throw new BridgeError('NUVIO_API', true);
    });
    const report = await sync(buildPlan([match()], [], dest.identity), dest, options);
    expect(dest.write).toHaveBeenCalledTimes(3);
    expect(report.failed).toBe(1);
  });
  it('does not retry permanent payload failures', async () => {
    const dest = new MemoryDestination();
    dest.write = vi.fn(async () => {
      throw new BridgeError('NUVIO_API');
    });
    const report = await sync(buildPlan([match()], [], dest.identity), dest, options);
    expect(dest.write).toHaveBeenCalledTimes(1);
    expect(report.failed).toBe(1);
  });
  it('rejects invalid batch sizes', () => expect(() => [...batches([1], 0)]).toThrow(RangeError));
});
