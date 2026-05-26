# DataForSEO source wrapper

Phase 2.1 — covers `keyword_overview`, `related_keywords`, and Google Organic
SERPs via Standard Queue. See `docs/DATA_SOURCES.md` for endpoint reference
and rate-limit notes.

## Usage

```ts
import {
  DataForSeoClient,
  MemoryCache,
  keywordOverview,
  serpOrganic,
} from "@nichefinder/scrapers/sources/dataforseo";

const client = new DataForSeoClient({
  credentials: {
    login: process.env.DATAFORSEO_LOGIN!,
    password: process.env.DATAFORSEO_PASSWORD!,
  },
});
const cache = new MemoryCache();

const kws = await keywordOverview(client, cache, {
  keywords: ["elektrische deken", "infrarood paneel"],
  location_code: 2528, // NL
  language_code: "nl",
});

const serps = await serpOrganic(client, cache, {
  keyword: "beste warmtepomp",
  location_code: 2528,
  language_code: "nl",
  depth: 10,
  mode: "standard",
});
```

## Design notes

- **Cache key** is a SHA-256 over a stable JSON serialization of the request
  body, prefixed with the endpoint. Same call within 7 days is a cache hit.
- **Standard Queue** posts a task then polls `task_get` every 30 s, up to 10
  min. Throws `DataForSeoTimeoutError` if the task never finishes.
- **Live queue** (`mode: "live"`) costs 15× — only use for operator-triggered
  debug calls, never for nightly batches.
- **Retry policy** is caller-supplied. See `client.ts → defaultRetryPolicy()`.
- **Auth errors (401/403)** are never retried — those are configuration bugs,
  not transient flakes.

## Future work (PR 2.1b)

- Trends (`/v3/keywords_data/google_trends/explore/live`)
- Autocomplete
- KGR helper (allintitle SERP)
- DB-backed cache (replace `MemoryCache` with a Postgres-backed implementation)
