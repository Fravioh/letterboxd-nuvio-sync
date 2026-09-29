import Papa from 'papaparse';
import { BridgeError } from '../errors';

export function parseCsv(text: string, diary = false): Record<string, string>[] {
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), {
    skipEmptyLines: 'greedy',
  });
  const header = result.data.shift()?.map((value) => value.trim());
  if (
    result.errors.length ||
    !header ||
    !['Date', 'Name', 'Year', 'Letterboxd URI', ...(diary ? ['Watched Date'] : [])].every((key) =>
      header.includes(key),
    ) ||
    new Set(header).size !== header.length ||
    header.length > 50 ||
    result.data.length > 50000
  )
    throw new BridgeError('INVALID_EXPORT');
  return result.data.map((row) => {
    if (row.length !== header.length || row.some((value) => value.length > 8192))
      throw new BridgeError('INVALID_EXPORT');
    return Object.fromEntries(header.map((key, index) => [key, row[index]?.trim() ?? '']));
  });
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value <= new Date().toISOString().slice(0, 10) &&
    value >= '1880-01-01'
  );
}
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
