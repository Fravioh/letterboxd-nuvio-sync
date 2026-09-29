import { BridgeError, safeError } from '../errors';
import { isWatched, movieAliases, toWatchedItem, watchedMovieIds } from '../nuvio/watched';
import type {
  Match,
  PlanEntry,
  SyncPlan,
  SyncProgress,
  SyncReport,
  WatchHistoryDestination,
  WatchedItem,
} from '../types';
import { batches } from './batcher';
import { delay } from './retry';

export function buildPlan(matches: Match[], remote: WatchedItem[], identity: string): SyncPlan {
  const ids = watchedMovieIds(remote);
  const seen = new Map<string, PlanEntry>();
  const plan: SyncPlan = {
    identity,
    sourceTotal: matches.length,
    remoteTotal: ids.size,
    matched: 0,
    already: [],
    pending: [],
    review: [],
    duplicates: 0,
  };
  for (const match of matches) {
    if (!match.selected || (match.confidence !== 'HIGH' && !match.manual)) {
      plan.review.push(match);
      continue;
    }
    const movie = match.selected;
    plan.matched++;
    const prior = movieAliases(movie)
      .map((id) => seen.get(id))
      .find((entry) => entry !== undefined);
    if (prior) {
      prior.source = {
        ...prior.source,
        watchedDates: [
          ...new Set([...prior.source.watchedDates, ...match.source.watchedDates]),
        ].sort(),
      };
      prior.payload = toWatchedItem(prior.source, prior.movie);
      plan.duplicates++;
      continue;
    }
    const entry = { source: match.source, movie, payload: toWatchedItem(match.source, movie) };
    movieAliases(movie).forEach((id) => seen.set(id, entry));
    (isWatched(movie, ids) ? plan.already : plan.pending).push(entry);
  }
  return plan;
}
export async function sync(
  plan: SyncPlan,
  destination: WatchHistoryDestination,
  options: {
    dryRun: boolean;
    confirmed: boolean;
    signal?: AbortSignal;
    onProgress?: (progress: SyncProgress) => void;
    batchSize?: number;
    sleep?: typeof delay;
  },
): Promise<SyncReport> {
  if (destination.identity !== plan.identity) throw new BridgeError('PROFILE_CHANGED');
  if (!options.dryRun && !options.confirmed) throw new BridgeError('CONFIRM_REQUIRED');
  const report: SyncReport = {
    total: plan.pending.length,
    completed: 0,
    added: 0,
    already: 0,
    failed: 0,
    dryRun: options.dryRun,
    cancelled: false,
    remaining: plan.pending.length,
    addedEntries: [],
    failures: [],
    uncertain: 0,
  };
  const emit = () => {
    report.completed = report.added + report.already + report.failed;
    report.remaining = report.total - report.completed;
    options.onProgress?.({
      total: report.total,
      completed: report.completed,
      added: report.added,
      already: report.already,
      failed: report.failed,
    });
  };
  if (options.signal?.aborted) {
    report.cancelled = true;
    return report;
  }
  const remote = watchedMovieIds(await destination.read(options.signal));
  const pending = plan.pending.filter((entry) => {
    if (isWatched(entry.movie, remote)) {
      report.already++;
      return false;
    }
    return true;
  });
  emit();
  if (options.dryRun) return report;
  for (const batch of batches(pending, options.batchSize)) {
    if (options.signal?.aborted) {
      report.cancelled = true;
      break;
    }
    let outstanding: PlanEntry[] = batch;
    let finished = false;
    for (let attempt = 0; attempt < 3 && !finished; attempt++) {
      if (options.signal?.aborted) {
        report.cancelled = true;
        break;
      }
      try {
        // Do not abort an in-flight write: await its acknowledgement before stopping.
        await destination.write(outstanding.map((entry) => entry.payload));
        report.addedEntries.push(...outstanding);
        report.added += outstanding.length;
        finished = true;
      } catch (error) {
        const safe = safeError(error);
        // A timeout can follow a committed transaction. Read back before any retry.
        if (safe.retryable || safe.code === 'INVALID_RESPONSE') {
          try {
            const actual = watchedMovieIds(await destination.read());
            const committed = outstanding.filter((entry) => isWatched(entry.movie, actual));
            report.addedEntries.push(...committed);
            report.added += committed.length;
            outstanding = outstanding.filter((entry) => !isWatched(entry.movie, actual));
            if (!outstanding.length) {
              finished = true;
              continue;
            }
          } catch {
            report.uncertain += outstanding.length;
            report.failures.push(
              ...outstanding.map((entry) => ({ entry, code: 'UNCONFIRMED_WRITE' })),
            );
            report.failed += outstanding.length;
            emit();
            return report;
          }
        }
        if (
          !safe.retryable ||
          attempt === 2 ||
          safe.retryAfterMs > 30000 ||
          options.signal?.aborted
        ) {
          report.failures.push(...outstanding.map((entry) => ({ entry, code: safe.code })));
          report.failed += outstanding.length;
          finished = true;
          if (safe.code === 'AUTH_EXPIRED' || safe.code === 'RATE_LIMITED') {
            emit();
            return report;
          }
        } else await (options.sleep ?? delay)(Math.max(safe.retryAfterMs, 500 * 2 ** attempt));
      }
    }
    emit();
    if (options.signal?.aborted) {
      report.cancelled = true;
      break;
    }
    await (options.sleep ?? delay)(150);
  }
  emit();
  return report;
}
