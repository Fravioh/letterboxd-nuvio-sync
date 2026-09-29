import { parseExport } from './export-parser';
import { safeError } from '../errors';
self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try {
    self.postMessage({ result: parseExport(event.data) });
  } catch (error) {
    self.postMessage({ error: safeError(error).code });
  }
};
