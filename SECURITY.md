# Security

Report vulnerabilities through GitHub private vulnerability reporting. Do not include credentials, exports, tokens, or private watch history in a public issue.

## Data boundaries

- Letterboxd ZIP and CSV contents are parsed in a browser Worker.
- The metadata server receives TMDB credentials and movie lookup fields.
- Nuvio authentication and history requests go directly from the browser to `api.nuvio.tv`.
- Credentials and imported history are kept in memory and cleared on reload.
- The application uses no analytics, cookies, persistent browser storage, or database.

The browser must trust the deployed JavaScript. Use HTTPS and deploy reviewed builds.

## Import limits

ZIP imports are limited to:

- 50 MiB compressed
- 5,000 entries
- 128 MiB declared expanded size
- 32 MiB per entry
- 16 MiB per relevant CSV
- 50,000 rows per CSV

ZIP64, encrypted archives, split archives, duplicate names, unsafe paths, CRC mismatches, and high compression ratios are rejected. Only `watched.csv` and `diary.csv` are inflated.

## Hosting

- Set `APP_ORIGIN` to the exact public HTTPS origin.
- Set `TRUST_PROXY` only to known proxy addresses or CIDRs.
- Do not cache `/api/*` responses.
- Do not log request bodies or `Authorization` headers.
- Add edge rate limits for public or multi-instance deployments.
- Keep the frontend and metadata API on the same origin.

TMDB credentials are validated by `POST /api/config` and forwarded in the `Authorization` header for metadata requests. The server does not save them. The metadata cache contains public movie results only.

The Nuvio write API is an upsert. Avoid simultaneous writers to the same profile. A lost write response is reconciled with a new history read before retrying.
