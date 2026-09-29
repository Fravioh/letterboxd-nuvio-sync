# Protocol notes

Reviewed on 2026-09-28 and 2026-09-29.

## Sources

| Source                                                               | Revision or page                           | Used for                                              |
| -------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| [Nuvio Cloud API](https://nuvio.tv/docs)                             | Public API guide                           | Authentication, profiles, watched reads and writes    |
| [NuvioTV](https://github.com/NuvioMedia/NuvioTV)                     | `fd7973d91dd75d790c5f9b3d68dae652655e92c4` | Current watched sync calls                            |
| [Nuvio self-host backend](https://github.com/NuvioMedia/self-host)   | `39ea2bd1bc71636127f9d797599c23b4236960c4` | SQL schema and timestamp behavior                     |
| [Scrob](https://github.com/ellite/scrob)                             | `57c4be4e018a0475bda42b872b7efda43f888af8` | Pagination and identifier conventions                 |
| [Trakt-Nuvio-Bridge](https://github.com/haaihond/Trakt-Nuvio-Bridge) | `58af7c37a8e371e2ccc6e369627d650536372ba5` | Browser auth and watched writes                       |
| [Letterboxd export](https://letterboxd.com/user/exportdata/)         | Current export page                        | ZIP/CSV import                                        |
| [TMDB API](https://developer.themoviedb.org/docs/getting-started)    | Current documentation                      | Search, find, details, authentication and attribution |

## Nuvio API

Base URL: `https://api.nuvio.tv`.

The public client key used by the official documentation is stored in `src/nuvio/auth.ts`. It is a publishable key, not a service-role credential.

The application uses these routes:

- `POST /auth/v1/token?grant_type=password`
- `POST /rest/v1/rpc/sync_pull_profiles`
- `POST /rest/v1/rpc/sync_pull_watched_items`
- `POST /rest/v1/rpc/sync_push_watched_items`

The access token, user ID, and expiry remain in browser memory. Refresh tokens are discarded. PIN-protected profiles are disabled because no public third-party PIN flow was found.

History reads use pages of 500 rows. Only movie rows with null season and episode values count as watched films. Repeated entries across pages are treated as an unstable snapshot.

Writes use batches of 100 items:

```json
{
  "p_profile_id": 1,
  "p_items": [
    {
      "content_id": "tt0084787",
      "content_type": "movie",
      "title": "The Thing",
      "season": null,
      "episode": null,
      "watched_at": 1720872000000
    }
  ]
}
```

The app reads history before writing and skips existing films. If a write response is lost, it reads history again before retrying.

## Identifiers and dates

TMDB IDs are preferred for metadata resolution. Nuvio writes use a verified IMDb ID when available and `tmdb:<id>` otherwise. Title-only comparison is not used to decide that a remote item already exists.

`watched.csv` establishes watched state. `diary.csv` may add watch dates. Letterboxd's generic `Date` column is not treated as a watch date.

Nuvio requires an integer `watched_at`. Unknown dates use `0` after user acknowledgement. Some clients may display this as 1970. Known date-only values are encoded at noon UTC.

## TMDB authentication

`POST /api/config` validates a user credential through TMDB's `GET /3/authentication` endpoint. Both a v3 API key and a Read Access Token are accepted. The server forwards credentials per request and does not retain them.
