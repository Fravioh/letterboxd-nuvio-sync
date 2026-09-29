# Deployment

Run the frontend and metadata API from the same HTTPS origin. The service is stateless and does not require a database or persistent volume.

## Configuration

| Variable      | Required           | Description                                          |
| ------------- | ------------------ | ---------------------------------------------------- |
| `NODE_ENV`    | Yes                | Set to `production`.                                 |
| `APP_ORIGIN`  | Yes                | Exact public HTTPS origin, without a trailing slash. |
| `HOST`        | Usually            | Use `0.0.0.0` on container platforms.                |
| `PORT`        | Platform dependent | Defaults to `3001`.                                  |
| `TRUST_PROXY` | No                 | Comma-separated trusted proxy IPs or CIDRs.          |

There is no server TMDB token. Each user enters their own credential in the application.

## Vercel

The checked-in `api/` entry points reuse the Express application for the API, while `vercel.json` builds the Vite frontend into `dist/`. Vercel serves the static build and runs the API routes as Functions on the same origin.

```sh
vercel link
vercel deploy --prod
```

`APP_ORIGIN` is optional on Vercel. When it is absent, the server uses `VERCEL_PROJECT_PRODUCTION_URL`, which Vercel provides automatically. Set `APP_ORIGIN` only when you want to pin a particular custom HTTPS domain. The deployment requires no TMDB secret because every user supplies a personal credential in the browser.

After deployment, verify `/api/health`, the demo, TMDB credential validation, and one small import before sharing the URL.

## Node

```sh
npm ci
npm run check
npm start
```

The build output is created by `npm run check`. The server serves `dist/` and the API routes.

## Docker

```sh
docker build -t letterboxd-nuvio-sync .
docker run --rm -p 127.0.0.1:3001:3001 \
  -e APP_ORIGIN=https://example.com \
  letterboxd-nuvio-sync
```

The image runs as the Node user and includes a health check.

## Reverse proxy

- Redirect HTTP to HTTPS.
- Route `/` and `/api/*` to the same service.
- Do not cache `/api/*`.
- Do not log request bodies or `Authorization` headers.
- Allow at least 60 seconds for upstream metadata requests.
- Set `TRUST_PROXY` only when the proxy address is known.
- Add an edge rate limit when using more than one application instance.

## Health check

`GET /api/health` returns:

```json
{ "ok": true, "credentialMode": "per-user" }
```

After deployment, run the demo, import a small test export, validate a personal TMDB credential, and confirm that the export contents do not appear in server requests. Use [MANUAL_TEST.md](MANUAL_TEST.md) before testing Nuvio writes.

## Rollback

Deploy immutable commits or image digests. Roll back by restoring the previous artifact. There is no database migration to reverse; users only need to reload the page and reconnect.
