import type {
  Candidate,
  ImportResult,
  MetadataProvider,
  WatchHistoryDestination,
  WatchedItem,
} from '../types';
import { delay } from '../sync/retry';

const titles = [
  'The Last Observatory',
  'Letters from the Moon',
  'The Quiet Orchard',
  'Paper Satellites',
  'A Season in Amber',
  'Midnight on Platform Nine',
  'The Glass Coast',
  'Small Hours',
  'Across the Violet Sea',
  'Somewhere, Tomorrow',
  'The Long Way Home',
  'A Map of Every Summer',
];
const posterGradients = [
  ['#1e1b4b', '#4338ca'],
  ['#311042', '#701a75'],
  ['#064e3b', '#047857'],
  ['#1c1917', '#44403c'],
  ['#451a03', '#b45309'],
  ['#0c4a6e', '#0284c7'],
  ['#4a044e', '#c026d3'],
  ['#18181b', '#3f3f46'],
  ['#172554', '#2563eb'],
  ['#3b0764', '#9333ea'],
  ['#14532d', '#16a34a'],
  ['#701a75', '#db2777'],
];

function createDemoPoster(title: string, index: number): string {
  const [c1, c2] = posterGradients[index % posterGradients.length]!;
  const initials = title
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 90"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="60" height="90" fill="url(#g)"/><circle cx="30" cy="36" r="16" fill="white" opacity="0.15"/><text x="30" y="42" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="13" font-weight="700" fill="white" text-anchor="middle" letter-spacing="-0.5">${initials}</text><rect x="12" y="62" width="36" height="3" rx="1.5" fill="white" opacity="0.45"/><rect x="18" y="69" width="24" height="2" rx="1" fill="white" opacity="0.3"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const demoMovies: Candidate[] = titles.map((title, index) => ({
  tmdb: 90000000 + index,
  imdb: `tt99000${String(index).padStart(4, '0')}`,
  title,
  originalTitle: title,
  year: 1990 + index * 3,
  posterPath: createDemoPoster(title, index),
}));
export function demoImport(): ImportResult {
  return {
    watchedRows: 13,
    diaryRows: 4,
    duplicates: 1,
    warnings: ['Demo only: all titles, identifiers and account data are fictional.'],
    movies: demoMovies.map((movie, index) => ({
      key: `demo:${index}`,
      title: movie.title,
      year: movie.year,
      ids: {},
      watchedDates: index < 4 ? ['2024-07-13'] : [],
    })),
  };
}
export class DemoMetadata implements MetadataProvider {
  async search(title: string, _year?: number, signal?: AbortSignal) {
    await delay(60, signal);
    const found = demoMovies.filter((movie) =>
      movie.title.toLowerCase().includes(title.toLowerCase()),
    );
    return found.map((movie) => (movie === demoMovies[11] ? { ...movie, year: 2022 } : movie));
  }
  async movie(id: number) {
    const movie = demoMovies.find((item) => item.tmdb === id);
    if (!movie) throw new Error('Demo movie not found');
    return movie === demoMovies[11] ? { ...movie, year: 2022 } : movie;
  }
  async find(imdb: string) {
    return demoMovies.filter((movie) => movie.imdb === imdb);
  }
}
export class DemoDestination implements WatchHistoryDestination {
  readonly identity = 'demo:1';
  private items: WatchedItem[] = demoMovies.slice(0, 4).map((movie) => ({
    content_id: movie.imdb ?? '',
    content_type: 'movie',
    title: movie.title,
    season: null,
    episode: null,
    watched_at: 0,
  }));
  async read() {
    await delay(100);
    return [...this.items];
  }
  async write(items: WatchedItem[]) {
    await delay(400);
    this.items = [
      ...this.items.filter((old) => !items.some((item) => item.content_id === old.content_id)),
      ...items,
    ];
  }
}
