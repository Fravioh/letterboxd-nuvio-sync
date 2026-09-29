import { Unzip, UnzipInflate } from 'fflate';
import { BridgeError } from '../errors';
import type { ImportResult, WatchHistorySource } from '../types';
import { parseHistory } from './history';

export const MAX_ZIP = 50 * 1024 * 1024;
const MAX_CSV = 16 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
interface Entry {
  name: string;
  size: number;
  crc: number;
}
function relevantCsv(name: string): 'watched' | 'diary' | undefined {
  const clean = name.replace(/^\.\//, '');
  const segments = clean.split('/');
  const basename = segments.at(-1)?.toLowerCase();
  if (
    segments.some((segment) =>
      ['deleted', 'orphaned', 'lists', 'likes', '__macosx'].includes(segment.toLowerCase()),
    )
  )
    return undefined;
  if (basename === 'watched.csv') return 'watched';
  if (basename === 'diary.csv') return 'diary';
  return undefined;
}
function folderOf(name: string) {
  const clean = name.replace(/^\.\//, '');
  return clean.slice(0, clean.lastIndexOf('/') + 1).toLowerCase();
}
function inspectZip(bytes: Uint8Array): Entry[] {
  if (bytes.length > MAX_ZIP) throw new BridgeError('FILE_TOO_LARGE');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const invalid = () => {
    throw new BridgeError('INVALID_EXPORT');
  };
  if (bytes.length < 22) return invalid();
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50)
    end--;
  if (
    end < 0 ||
    view.getUint32(end, true) !== 0x06054b50 ||
    end + 22 + view.getUint16(end + 20, true) !== bytes.length
  )
    return invalid();
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  if (
    view.getUint32(end + 4, true) !== 0 ||
    count !== view.getUint16(end + 8, true) ||
    count > 5000 ||
    count === 0 ||
    offset + centralSize !== end
  )
    return invalid();
  const entries: Entry[] = [];
  const names = new Set<string>();
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) return invalid();
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extra = view.getUint16(offset + 30, true);
    const comment = view.getUint16(offset + 32, true);
    if (
      flags & 1 ||
      ![0, 8].includes(method) ||
      offset + 46 + nameLength + extra + comment > end ||
      view.getUint16(offset + 34, true) !== 0
    )
      return invalid();
    let rawName: string;
    try {
      rawName = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    } catch {
      rawName = new TextDecoder('latin1').decode(
        bytes.subarray(offset + 46, offset + 46 + nameLength),
      );
    }
    const cleanName = rawName.replace(/^\.\//, '');
    if (
      !cleanName ||
      cleanName.includes('\\') ||
      cleanName.includes('\0') ||
      cleanName.startsWith('/') ||
      /^[a-z]:/i.test(cleanName) ||
      cleanName.split('/').some((segment) => segment === '..' || segment === '.') ||
      names.has(cleanName.toLowerCase())
    )
      return invalid();
    names.add(cleanName.toLowerCase());
    total += size;
    if (
      size > 32 * 1024 * 1024 ||
      total > 128 * 1024 * 1024 ||
      (size > 1024 * 1024 && size / Math.max(1, compressed) > 200)
    )
      throw new BridgeError('FILE_TOO_LARGE');
    if (relevantCsv(cleanName)) {
      if (size > MAX_CSV) throw new BridgeError('FILE_TOO_LARGE');
      entries.push({ name: cleanName, size, crc: view.getUint32(offset + 16, true) });
    }
    offset += 46 + nameLength + extra + comment;
  }
  if (
    offset !== end ||
    entries.filter((e) => relevantCsv(e.name) === 'watched').length !== 1 ||
    entries.filter((e) => relevantCsv(e.name) === 'diary').length > 1
  )
    return invalid();
  const folders = new Set(entries.map((entry) => folderOf(entry.name)));
  if (folders.size !== 1) return invalid();
  return entries;
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = -1;
  for (const byte of bytes) crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 255] ?? 0);
  return (crc ^ -1) >>> 0;
}
export function parseExport(buffer: ArrayBuffer): ImportResult {
  try {
    const bytes = new Uint8Array(buffer);
    const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
    if (!isZip) {
      if (bytes.length > MAX_CSV) throw new BridgeError('FILE_TOO_LARGE');
      const text = decoder.decode(bytes);
      return parseHistory(text);
    }
    const entries = inspectZip(bytes);
    const selected = new Map(entries.map((e) => [e.name, e]));
    const files = new Map<string, string>();
    const unzip = new Unzip((file) => {
      const cleanFileName = file.name.replace(/^\.\//, '');
      const entry = selected.get(cleanFileName) ?? selected.get(file.name);
      if (!entry) return;
      if (files.has(cleanFileName)) throw new BridgeError('INVALID_EXPORT');
      let size = 0;
      const chunks: Uint8Array[] = [];
      file.ondata = (error, chunk, final) => {
        if (error) throw new BridgeError('INVALID_EXPORT');
        size += chunk.length;
        if (size > MAX_CSV || size > entry.size) {
          file.terminate();
          throw new BridgeError('FILE_TOO_LARGE');
        }
        chunks.push(chunk);
        if (final) {
          if (size !== entry.size) throw new BridgeError('INVALID_EXPORT');
          const joined = new Uint8Array(size);
          let position = 0;
          for (const part of chunks) {
            joined.set(part, position);
            position += part.length;
          }
          if (crc32(joined) !== entry.crc) throw new BridgeError('INVALID_EXPORT');
          files.set(cleanFileName, decoder.decode(joined));
        }
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    for (let offset = 0; offset < bytes.length; offset += 4096)
      unzip.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
    if (files.size !== entries.length) throw new BridgeError('INVALID_EXPORT');
    const watched = [...files].find(([name]) => relevantCsv(name) === 'watched')?.[1];
    if (watched === undefined) throw new BridgeError('INVALID_EXPORT');
    return parseHistory(watched, [...files].find(([name]) => relevantCsv(name) === 'diary')?.[1]);
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    throw new BridgeError('INVALID_EXPORT');
  }
}
export class LetterboxdWatchHistorySource implements WatchHistorySource {
  async read(buffer: ArrayBuffer) {
    return parseExport(buffer);
  }
}
