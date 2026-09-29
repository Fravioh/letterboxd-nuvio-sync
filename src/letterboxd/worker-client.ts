import { BridgeError, type ErrorCode } from '../errors';
import { MAX_ZIP } from './export-parser';
import type { ImportResult } from '../types';

export async function readExport(file: File): Promise<ImportResult> {
  const name = file.name.toLowerCase();
  if (!name.endsWith('.zip') && !name.endsWith('.csv')) throw new BridgeError('INVALID_EXPORT');
  if (file.size > MAX_ZIP) throw new BridgeError('FILE_TOO_LARGE');
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new BridgeError('TIMEOUT'));
    }, 20000);
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<{ result?: ImportResult; error?: ErrorCode }>) => {
      finish();
      if (event.data.result) resolve(event.data.result);
      else reject(new BridgeError(event.data.error ?? 'INVALID_EXPORT'));
    };
    worker.onerror = () => {
      finish();
      reject(new BridgeError('INVALID_EXPORT'));
    };
    worker.postMessage(buffer, [buffer]);
  });
}
