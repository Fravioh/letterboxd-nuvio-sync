import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseExport } from '../src/letterboxd/export-parser';
import { parseCsv, validDate } from '../src/letterboxd/csv';
import { parseHistory } from '../src/letterboxd/history';
import { diaryHeader, header, zip } from './helpers';

const watched = readFileSync(new URL('./fixtures/watched.csv', import.meta.url), 'utf8');
const diary = readFileSync(new URL('./fixtures/diary.csv', import.meta.url), 'utf8');
describe('official-shaped export parser (synthetic history)', () => {
  it('rejects watched and diary taken from different folders', () => {
    expect(() => parseExport(zip({ 'watched.csv': watched, 'other/diary.csv': diary }))).toThrow();
  });
  it('reads watched and diary directly from a ZIP and deduplicates', () => {
    const result = parseExport(zip({ 'watched.csv': watched, 'diary.csv': diary }));
    expect(result.movies).toHaveLength(3);
    expect(result.duplicates).toBe(1);
    expect(result.diaryRows).toBe(3);
  });
  it('preserves multiple real diary dates but never the watched Date field', () => {
    const result = parseHistory(watched, diary);
    expect(result.movies[1]?.watchedDates).toEqual(['2022-08-12', '2024-09-14']);
    expect(result.movies[2]?.watchedDates).toEqual([]);
  });
  it('accepts an export folder and ignores unrelated private files', () => {
    const result = parseExport(
      zip({
        'export/watched.csv': watched,
        'export/diary.csv': diary,
        'export/profile.csv': 'private account fields',
        'export/reviews.csv': '<script>private</script>',
      }),
    );
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('accepts official data nested under multiple export directories', () => {
    const result = parseExport(
      zip({
        'letterboxd-user-2026/export/watched.csv': watched,
        'letterboxd-user-2026/export/diary.csv': diary,
      }),
    );
    expect(result.movies).toHaveLength(3);
  });
  it('ignores extras whose names are not portable filesystem paths', () => {
    const result = parseExport(
      zip({
        'watched.csv': watched,
        'diary.csv': diary,
        'lists/Ficção: favoritos.csv': 'Name,Year\nCentral Station,1998',
      }),
    );
    expect(result.movies).toHaveLength(3);
  });
  it('accepts a watched-only archive', () =>
    expect(parseExport(zip({ 'watched.csv': watched })).movies).toHaveLength(3));
  it('accepts a valid empty watched CSV', () =>
    expect(parseExport(zip({ 'watched.csv': header })).movies).toEqual([]));
  it('rejects a diary-only archive', () =>
    expect(() => parseExport(zip({ 'diary.csv': diary }))).toThrow(/Invalid Letterboxd/));
  it.each([
    '../watched.csv',
    '/watched.csv',
    'C:/watched.csv',
    'dir/../watched.csv',
    'dir\\watched.csv',
  ])('rejects unsafe archive path %s', (name) =>
    expect(() => parseExport(zip({ 'watched.csv': watched, [name]: watched }))).toThrow(),
  );
  it('rejects duplicate CSV filenames in competing folders', () =>
    expect(() =>
      parseExport(zip({ 'watched.csv': watched, 'export/watched.csv': watched })),
    ).toThrow());
  it('does not import deleted watched data', () =>
    expect(
      parseExport(zip({ 'watched.csv': watched, 'deleted/watched.csv': 'not csv' })).movies,
    ).toHaveLength(3));
  it('accepts official export containing orphaned, deleted, and likes auxiliary files', () => {
    const result = parseExport(
      zip({
        'watched.csv': watched,
        'diary.csv': diary,
        'profile.csv': 'Username\nfravioh',
        'deleted/diary.csv': 'Date,Name,Year\n2026-01-01,Deleted,2020',
        'orphaned/diary.csv': 'Date,Name,Year\n',
        'likes/films.csv': 'Date,Name,Year\n2026-01-01,Liked,2021',
      }),
    );
    expect(result.movies).toHaveLength(3);
  });
  it('rejects malformed bytes', () =>
    expect(() => parseExport(new Uint8Array(100).buffer)).toThrow());
  it('rejects a truncated ZIP', () => {
    const buffer = zip({ 'watched.csv': watched });
    expect(() => parseExport(buffer.slice(0, -5))).toThrow();
  });
  it('rejects a compression bomb before inflation', () =>
    expect(() => parseExport(zip({ 'watched.csv': 'A'.repeat(2 * 1024 * 1024) }))).toThrow(
      /size limits/,
    ));
  it('rejects CRC corruption', () => {
    const buffer = zip({ 'watched.csv': watched }, 0);
    const bytes = new Uint8Array(buffer);
    bytes[50] = (bytes[50] ?? 0) ^ 1;
    expect(() => parseExport(buffer)).toThrow();
  });
  it('handles quoted commas, escaped quotes, Unicode and BOM', () => {
    const rows = parseCsv('\uFEFF' + header + '2024-01-01,"A, ""quoted"" café",2000,\r\n');
    expect(rows[0]?.Name).toBe('A, "quoted" café');
  });
  it('handles quoted multiline titles', () =>
    expect(parseCsv(header + '2024-01-01,"Two\nLines",2000,').at(0)?.Name).toBe('Two\nLines'));
  it.each([
    'Date,Name,Year\n',
    'Date,Name,Year,Letterboxd URI,Name\n',
    header + '2024-01-01,"Broken,2000,',
    header + '2024-01-01,Too,many,fields,here',
  ])('rejects invalid CSV structure', (csv) => expect(() => parseCsv(csv)).toThrow());
  it.each([
    'javascript:alert(1)',
    'https://evil.example/film/a/',
    'https://me:pw@letterboxd.com/film/a/',
  ])('rejects unsafe URI %s', (uri) =>
    expect(() => parseHistory(header + `2024-01-01,Film,2000,${uri}`)).toThrow(),
  );
  it('keeps formulas and HTML as plain text for escaped rendering', () => {
    const parsed = parseHistory(
      header + '2024-01-01,=1+2,2000,\n2024-01-01,<script>alert(1)</script>,2000,',
    );
    expect(parsed.movies[0]?.title).toBe('=1+2');
    expect(parsed.movies[1]?.title).toContain('<script>');
  });
  it('does not merge distinct film URLs with the same title and year', () => {
    const data =
      header +
      '2024-01-01,Film,2000,https://letterboxd.com/film/a/\n2024-01-01,Film,2000,https://letterboxd.com/film/b/';
    const result = parseHistory(
      data,
      diaryHeader + '2024-01-01,Film,2000,https://letterboxd.com/user/film/a/,,,,2023-01-01',
    );
    expect(result.movies).toHaveLength(2);
    expect(result.movies.every((movie) => movie.watchedDates.length === 0)).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });
  it('validates optional IDs rather than assuming the standard export provides them', () => {
    const result = parseHistory(
      header.trimEnd() + ',TMDB ID,IMDb ID\n2024-01-01,Film,2000,,550,tt0137523',
    );
    expect(result.movies[0]?.ids).toEqual({ tmdb: 550, imdb: 'tt0137523' });
  });
  it('rejects malformed optional IMDb IDs', () =>
    expect(() => parseHistory(header.trimEnd() + ',IMDb ID\n2024-01-01,Film,2000,,123')).toThrow());
  it('ignores invalid diary dates with a visible warning', () => {
    const result = parseHistory(watched, diary.replace('2024-07-13', '2024-02-31'));
    expect(result.movies[0]?.watchedDates).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
  it.each(['2023-02-29', '2024-02-31', '2024-1-1', '2050-01-01', 'not-a-date'])(
    'rejects unreliable date %s',
    (date) => expect(validDate(date)).toBe(false),
  );
  it('accepts leap day', () => expect(validDate('2024-02-29')).toBe(true));
  it('does not import diary-only films into the authoritative watched state', () => {
    const result = parseHistory(header, diary);
    expect(result.movies).toHaveLength(0);
    expect(result.warnings[0]).toContain('3 diary entries');
  });
});

describe('CSV and normalized ZIP imports', () => {
  it('reads standalone watched CSV without inventing watch dates', () => {
    const result = parseExport(new TextEncoder().encode(watched).buffer);
    expect(result.movies).toHaveLength(3);
    expect(result.movies.every((movie) => movie.watchedDates.length === 0)).toBe(true);
  });
  it('accepts a leading dot folder', () => {
    expect(
      parseExport(zip({ './watched.csv': watched, './diary.csv': diary })).movies,
    ).toHaveLength(3);
  });
  it('rejects normalized duplicate entries', () => {
    expect(() => parseExport(zip({ './watched.csv': watched, 'watched.csv': watched }))).toThrow();
  });
  it('rejects oversized standalone CSV before parsing', () => {
    expect(() => parseExport(new Uint8Array(16 * 1024 * 1024 + 1).buffer)).toThrow(/size limits/);
  });
  it('rejects invalid UTF-8 in standalone CSV', () => {
    const bytes = new TextEncoder().encode(watched);
    bytes[bytes.length - 2] = 255;
    expect(() => parseExport(bytes.buffer)).toThrow();
  });
  it('rejects mismatched central directory size', () => {
    const buffer = zip({ 'watched.csv': watched });
    const view = new DataView(buffer);
    view.setUint32(buffer.byteLength - 10, 0, true);
    expect(() => parseExport(buffer)).toThrow();
  });
  it.each(['n/a', '1870', '2201'])('rejects invalid year %s instead of dropping it', (year) => {
    expect(() => parseHistory(header + `2024-01-01,Film,${year},`)).toThrow();
  });
});
