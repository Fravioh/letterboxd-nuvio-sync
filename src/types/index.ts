export interface MovieIds {
  tmdb?: number;
  imdb?: string;
}
export interface SourceMovie {
  key: string;
  title: string;
  year?: number;
  ids: MovieIds;
  watchedDates: string[];
}
export interface ImportResult {
  movies: SourceMovie[];
  watchedRows: number;
  diaryRows: number;
  duplicates: number;
  warnings: string[];
}
export interface Candidate {
  tmdb: number;
  imdb?: string;
  title: string;
  originalTitle: string;
  year?: number;
  posterPath?: string;
}
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
export interface Match {
  source: SourceMovie;
  candidates: Candidate[];
  selected?: Candidate;
  confidence: Confidence;
  reason: string;
  manual: boolean;
  errorCode?: string;
}
export interface WatchedItem {
  content_id: string;
  content_type: string;
  title: string;
  season: number | null;
  episode: number | null;
  watched_at: number;
}
export interface WatchHistorySource {
  read(buffer: ArrayBuffer): Promise<ImportResult>;
}
export interface WatchHistoryDestination {
  readonly identity: string;
  read(signal?: AbortSignal): Promise<WatchedItem[]>;
  write(items: WatchedItem[]): Promise<void>;
}
export interface MetadataProvider {
  search(title: string, year?: number, signal?: AbortSignal): Promise<Candidate[]>;
  movie(id: number, signal?: AbortSignal): Promise<Candidate>;
  find(imdb: string, signal?: AbortSignal): Promise<Candidate[]>;
}
export interface PlanEntry {
  source: SourceMovie;
  movie: Candidate;
  payload: WatchedItem;
}
export interface SyncPlan {
  identity: string;
  sourceTotal: number;
  remoteTotal: number;
  matched: number;
  already: PlanEntry[];
  pending: PlanEntry[];
  review: Match[];
  duplicates: number;
}
export interface SyncProgress {
  total: number;
  completed: number;
  added: number;
  already: number;
  failed: number;
}
export interface SyncReport extends SyncProgress {
  dryRun: boolean;
  cancelled: boolean;
  remaining: number;
  addedEntries: PlanEntry[];
  failures: { entry: PlanEntry; code: string }[];
  uncertain: number;
}
