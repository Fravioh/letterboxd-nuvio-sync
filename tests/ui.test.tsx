// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/ui/App';
import { candidate, header, zip } from './helpers';
import { toWatchedItem } from '../src/nuvio/watched';
import { source } from './helpers';
import type { WatchedItem } from '../src/types';

// jsdom lacks Worker. Use the SAME parser, with FileReader as the transport.
// Native Worker integration is separately exercised in the browser QA.
vi.mock('../src/letterboxd/worker-client', async () => {
  const { parseExport } = await import('../src/letterboxd/export-parser');
  return {
    readExport: async (file: File) => {
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.readAsArrayBuffer(file);
      });
      return parseExport(buffer);
    },
  };
});
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('user journeys', () => {
  it('completes demo review, explicit confirmation, sync, report and an idempotent rerun', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Start demo/ }));
    await user.click(screen.getByRole('button', { name: /Analyze my history/ }));
    const syncButton = await screen.findByRole('button', { name: 'Sync 7 movies' });
    await user.click(screen.getByRole('tab', { name: /Needs review 1/ }));
    await user.click(
      screen.getByText('A Map of Every Summer', { exact: true, selector: 'summary strong' }),
    );
    await user.click(screen.getByRole('button', { name: /Use this match/ }));
    expect(syncButton).toHaveTextContent('Sync 8 movies');
    await user.click(screen.getByRole('button', { name: 'Dry run' }));
    await screen.findByRole('heading', { name: 'Dry run complete.' });
    await user.click(screen.getByRole('button', { name: 'Sync 8 movies' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /Confirm sync/ });
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole('checkbox', { name: /unknown date/ }));
    await user.click(confirm);
    await screen.findByRole('heading', { name: 'Sync complete.' }, { timeout: 5000 });
    expect(screen.getByText(/8 synchronized · 4 already watched/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Analyze again/ }));
    await screen.findByRole('button', { name: 'Sync 0 movies' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('imports a ZIP and exercises actual Nuvio/TMDB adapters against mocked APIs, without writes before confirmation', async () => {
    let history: WatchedItem[] = [toWatchedItem(source(1), candidate(1))];
    const writes: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (url.includes('/auth/v1/token'))
        return new Response(
          JSON.stringify({
            access_token: 'synthetic-token',
            refresh_token: 'discard',
            expires_in: 3600,
            user: { id: 'test' },
          }),
        );
      if (url.includes('sync_pull_profiles'))
        return new Response(
          JSON.stringify([
            { profile_index: 1, name: 'Movie night', pin_enabled: false },
            { profile_index: 2, name: 'Locked', pin_enabled: true },
          ]),
        );
      if (url.includes('sync_pull_watched_items')) return new Response(JSON.stringify(history));
      if (url.includes('sync_push_watched_items')) {
        writes.push(body);
        history = [...history, ...(body.p_items as WatchedItem[])];
        return new Response(null, { status: 204 });
      }
      if (url === '/api/config') return new Response(JSON.stringify({ ok: true }));
      if (url === '/api/metadata') {
        const id =
          body.operation === 'movie'
            ? Number(body.id)
            : Number(String(body.title).split(' ').at(-1));
        return new Response(JSON.stringify([candidate(id)]));
      }
      throw new Error('Unexpected test endpoint');
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);
    const file = new File(
      [
        zip({
          'watched.csv':
            header + '2024-01-01,Fictional movie 1,2000,\n2024-01-01,Fictional movie 2,2000,',
        }),
      ],
      'letterboxd-export.zip',
      { type: 'application/zip' },
    );
    await user.upload(screen.getByLabelText('Choose Letterboxd export ZIP'), file);
    await screen.findByRole('heading', { name: 'Connect Nuvio' });
    await user.type(screen.getByLabelText('Email'), 'test@example.invalid');
    await user.type(screen.getByLabelText('Password'), 'fake-password');
    await user.click(screen.getByRole('button', { name: /Connect Nuvio/ }));
    const profiles = await screen.findByLabelText('Choose the profile to update');
    expect(screen.getByRole('option', { name: /Locked/ })).toBeDisabled();
    await user.selectOptions(profiles, '1');
    expect(screen.queryByRole('button', { name: /Analyze my history/ })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('TMDB API credential'), 'synthetic-tmdb-token');
    await user.click(screen.getByRole('button', { name: 'Verify token and analyze' }));
    await screen.findByRole('button', { name: 'Sync 1 movies' });
    expect(writes).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Dry run' }));
    await screen.findByRole('heading', { name: 'Dry run complete.' });
    expect(writes).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Sync 1 movies' }));
    expect(writes).toHaveLength(0);
    await user.click(screen.getByRole('checkbox', { name: /unknown date/ }));
    await user.click(screen.getByRole('button', { name: /Confirm sync/ }));
    await screen.findByRole('heading', { name: 'Sync complete.' });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      p_profile_id: 1,
      p_items: [{ content_id: 'tt0000002', watched_at: 0 }],
    });
    expect(
      fetchMock.mock.calls
        .filter(([url]) => url === '/api/metadata')
        .every(
          ([, init]) =>
            !String(init.body).includes('password') &&
            !JSON.stringify(init.headers).includes('synthetic-token') &&
            JSON.stringify(init.headers).includes('synthetic-tmdb-token'),
        ),
    ).toBe(true);
  });
  it('reports malformed ZIPs without connecting or issuing any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<App />);
    await user.upload(
      screen.getByLabelText('Choose Letterboxd export ZIP'),
      new File(['bad data'], 'bad.zip', { type: 'application/zip' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid Letterboxd export');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('cancelling confirmation sends no writes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Start demo/ }));
    await user.click(screen.getByRole('button', { name: /Analyze my history/ }));
    await user.click(await screen.findByRole('button', { name: 'Sync 7 movies' }));
    await user.click(screen.getByRole('button', { name: 'Back to review' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Sync complete.' })).not.toBeInTheDocument();
  });
});
