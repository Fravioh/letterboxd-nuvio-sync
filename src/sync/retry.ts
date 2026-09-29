import { BridgeError, checkAbort, safeError } from '../errors.js';

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new BridgeError('CANCELLED'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
export async function retry<T>(
  operation: () => Promise<T>,
  options: { signal?: AbortSignal; attempts?: number; sleep?: typeof delay } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    checkAbort(options.signal);
    try {
      return await operation();
    } catch (error) {
      const safe = safeError(error);
      if (!safe.retryable || attempt === attempts - 1 || safe.retryAfterMs > 30000) throw safe;
      await (options.sleep ?? delay)(
        Math.max(safe.retryAfterMs, 400 * 2 ** attempt + Math.random() * 150),
        options.signal,
      );
    }
  }
  throw new BridgeError('NETWORK');
}
export async function requestJson(
  url: string,
  init: RequestInit,
  service: 'nuvio' | 'tmdb',
  timeoutMs = 15000,
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    if (init.signal?.aborted) throw new BridgeError('CANCELLED');
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) {
      const status = response.status;
      const retryHeader = response.headers.get('Retry-After');
      const wait = retryHeader
        ? /^\d+$/.test(retryHeader)
          ? Number(retryHeader) * 1000
          : Math.max(0, Date.parse(retryHeader) - Date.now())
        : 0;
      if (status === 401 || status === 403)
        throw new BridgeError(service === 'nuvio' ? 'AUTH_EXPIRED' : 'TMDB_UNAVAILABLE');
      if (status === 429)
        throw new BridgeError('RATE_LIMITED', true, Number.isFinite(wait) ? wait : 0);
      if (status === 404) throw new BridgeError('NOT_FOUND');
      if (status === 503 && service === 'tmdb') {
        if (response.headers.get('X-Metadata-Configured') === 'false')
          throw new BridgeError('METADATA_NOT_CONFIGURED');
        const body: unknown = await response.json().catch(() => null);
        if (
          body &&
          typeof body === 'object' &&
          'code' in body &&
          body.code === 'METADATA_NOT_CONFIGURED'
        )
          throw new BridgeError('METADATA_NOT_CONFIGURED');
      }
      throw new BridgeError(service === 'nuvio' ? 'NUVIO_API' : 'TMDB_UNAVAILABLE', status >= 500);
    }
    if (response.status === 204) return null;
    const body = await response.text();
    if (!body.trim()) return null;
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new BridgeError('INVALID_RESPONSE');
    }
  } catch (error) {
    if (init.signal?.aborted) throw new BridgeError('CANCELLED');
    if (controller.signal.aborted) throw new BridgeError('TIMEOUT', true);
    throw safeError(error);
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
  }
}
