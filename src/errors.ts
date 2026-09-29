export type ErrorCode =
  | 'INVALID_EXPORT'
  | 'FILE_TOO_LARGE'
  | 'AUTH_EXPIRED'
  | 'AUTH_FAILED'
  | 'NUVIO_API'
  | 'TMDB_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'CANCELLED'
  | 'CONFIRM_REQUIRED'
  | 'PROFILE_CHANGED'
  | 'METADATA_NOT_CONFIGURED'
  | 'SNAPSHOT_CHANGED';
const messages: Record<ErrorCode, string> = {
  INVALID_EXPORT: 'Invalid Letterboxd export. Choose the original ZIP containing watched.csv.',
  FILE_TOO_LARGE: 'This export exceeds the safe size limits. See the import guide.',
  AUTH_EXPIRED:
    'Your Nuvio session expired. Reconnect and analyze again; completed movies will be skipped.',
  AUTH_FAILED:
    'Nuvio sign-in failed. Check your email and password, and confirm your account email.',
  NUVIO_API: 'Nuvio could not complete this request. Check its service status and try again.',
  TMDB_UNAVAILABLE: 'Movie information is temporarily unavailable. Try analysis again.',
  NOT_FOUND: 'Movie not found. Search for another title or a TMDB movie ID.',
  RATE_LIMITED: 'The service is rate limiting requests. Wait a moment and try again.',
  NETWORK:
    'Network request failed. Check your connection; browser CORS restrictions may also block the service.',
  TIMEOUT: 'The request timed out. Analyze again before retrying any unconfirmed writes.',
  INVALID_RESPONSE: 'The service returned an unexpected response. No unsafe fallback was used.',
  CANCELLED: 'Operation cancelled.',
  CONFIRM_REQUIRED: 'Review and explicitly confirm this sync before writing.',
  PROFILE_CHANGED: 'The destination changed. Analyze again before syncing.',
  METADATA_NOT_CONFIGURED:
    'Movie lookup needs your TMDB API Read Access Token or v3 API key. Add it before analysis.',
  SNAPSHOT_CHANGED:
    'Nuvio history changed during pagination. Pause other sync tools and analyze again.',
};
export class BridgeError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly retryable = false,
    public readonly retryAfterMs = 0,
  ) {
    super(messages[code]);
    this.name = 'BridgeError';
  }
}
export function safeError(error: unknown): BridgeError {
  if (error instanceof BridgeError) return error;
  if (error instanceof Error && error.name === 'AbortError') return new BridgeError('CANCELLED');
  return new BridgeError('NETWORK', true);
}
export function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new BridgeError('CANCELLED');
}
