# Contributing

Use Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

Before opening a pull request:

```sh
npx prettier --write .
npm run check
```

Use synthetic fixtures. Do not commit credentials, personal exports, watch history, or network captures.

Keep API changes consistent with current upstream documentation. Record the relevant source or revision in [docs/RESEARCH.md](docs/RESEARCH.md) when a Nuvio or TMDB contract changes.

Include tests for changes to parsing, matching, writes, retries, and API validation. Exercise user-facing changes at desktop and mobile widths.
