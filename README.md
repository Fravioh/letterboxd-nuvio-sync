# Letterboxd to Nuvio

Imports watched films from a Letterboxd export into a Nuvio Sync profile.

The app reads the Letterboxd ZIP or `watched.csv` in the browser, matches films through TMDB, compares them with the selected Nuvio profile, and shows a preview before writing anything.

This is an independent project. It is not affiliated with Letterboxd or Nuvio. TMDB provides movie metadata and does not endorse this application.

## Requirements

- Node.js 22.12 or newer
- A Nuvio account
- A personal TMDB API Read Access Token or v3 API key

The TMDB credential is required before analysis. It remains in the current browser tab and is sent through the same-origin metadata endpoint for each request. It is not stored on the server.

## Local setup

```sh
git clone https://github.com/Fravioh/letterboxd-nuvio-sync.git
cd letterboxd-nuvio-sync
npm ci
cp .env.example .env
npm run dev
```

Open <http://127.0.0.1:5173>.

## Usage

1. Download the official export from [Letterboxd settings](https://letterboxd.com/user/exportdata/).
2. Import the ZIP or `watched.csv`.
3. Connect to Nuvio and select an unlocked profile.
4. Enter and validate your TMDB credential.
5. Analyze the history and review uncertain matches.
6. Run a dry run if desired.
7. Confirm the sync.

The import only adds films that are missing from the selected Nuvio profile. It does not sync ratings, reviews, lists, playback progress, or deletions.

## Data handling

- ZIP and CSV contents are parsed in the browser.
- Film titles, years, and identifiers are sent to TMDB through the metadata endpoint.
- Nuvio credentials and access tokens remain in browser memory.
- Confirmed watched items are sent directly from the browser to Nuvio.
- No analytics, application database, cookies, or persistent browser storage are used.

See [SECURITY.md](SECURITY.md) for the security boundaries.

## Development

```sh
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npm run check
```

The main components are:

```text
server/              same-origin TMDB gateway
src/letterboxd/      ZIP and CSV parsing
src/matching/        TMDB/IMDb matching
src/nuvio/           authentication and watched-history API
src/sync/            preview, batching, retry, and reconciliation
src/ui/              React interface
tests/               parser, API, matching, sync, and UI tests
```

## Deployment

The repository is ready for Vercel. Link it to a Vercel project and deploy from `main`; the platform builds the Vite frontend, runs the Express API routes as Functions, and derives the allowed origin from the production URL. No shared TMDB credential is configured.

For another Node hosting platform, serve both the frontend and `/api/*` from one HTTPS origin and set:

```dotenv
NODE_ENV=production
APP_ORIGIN=https://example.com
HOST=0.0.0.0
PORT=3001
```

Users supply their own TMDB credentials. See [docs/DEPLOY.md](docs/DEPLOY.md) for Vercel, Node, and Docker instructions.

## Current limitations

- PIN-protected Nuvio profiles are not supported.
- The Nuvio session is not refreshed; reconnect after expiration.
- Unknown Letterboxd watch dates are sent as `0`, which some clients may display as 1970.
- Process-local caches and rate limits need an edge-level counterpart when running multiple instances.
- The Nuvio integration is based on the public protocol documented in [docs/RESEARCH.md](docs/RESEARCH.md). Test with a dedicated account before a public deployment.

## License

[MIT](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party names, assets, and libraries.
