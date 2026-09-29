import { strToU8, zipSync } from 'fflate';
import type {
  Candidate,
  Match,
  SourceMovie,
  WatchHistoryDestination,
  WatchedItem,
} from '../src/types';

export function zip(files: Record<string, string>, level: 0 | 6 = 6): ArrayBuffer {
  const bytes = zipSync(
    Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strToU8(data)])),
    { level },
  );
  return Uint8Array.from(bytes).buffer;
}
export const header = 'Date,Name,Year,Letterboxd URI\n';
export const diaryHeader = 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n';
export function source(index = 1): SourceMovie {
  return {
    key: `source:${index}`,
    title: `Fictional movie ${index}`,
    year: 2000,
    ids: {},
    watchedDates: [],
  };
}
export function candidate(index = 1): Candidate {
  return {
    tmdb: index,
    imdb: `tt${String(index).padStart(7, '0')}`,
    title: `Fictional movie ${index}`,
    originalTitle: `Fictional movie ${index}`,
    year: 2000,
  };
}
export function match(index = 1): Match {
  return {
    source: source(index),
    selected: candidate(index),
    candidates: [candidate(index)],
    confidence: 'HIGH',
    reason: 'Verified ID',
    manual: false,
  };
}
export class MemoryDestination implements WatchHistoryDestination {
  readonly identity = 'test-account:1';
  items: WatchedItem[] = [];
  calls: WatchedItem[][] = [];
  async read() {
    return this.items.map((item) => ({ ...item }));
  }
  async write(items: WatchedItem[]) {
    this.calls.push(items);
    for (const item of items) {
      const index = this.items.findIndex((old) => old.content_id === item.content_id);
      if (index >= 0) this.items[index] = item;
      else this.items.push(item);
    }
  }
}
export const noWait = async () => undefined;
