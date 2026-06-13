# Google Search Status — source wrapper

Official, public feed of Google Search incidents and confirmed ranking updates.
Feeds **promotion-gate criterion 6** ("no active Google update window",
`docs/PROMOTION_GATE.md` #6) and the weekly orchestrator review.

| | |
|---|---|
| **Endpoint** | `https://status.search.google.com/incidents.json` |
| **Auth** | None (public) |
| **robots.txt** | `User-agent: * / Allow: /` — fetch permitted (verified 2026-06) |
| **User-Agent** | `NicheFinder/1.0 (+https://expertgids.nl/about-bot)` |
| **Cadence** | Daily, before `promotion-once` (see RUNBOOK) |
| **Provenance tag** | `algorithm_events.source = 'google_search_status'` |

## What it returns

`fetchIncidents()` validates the raw feed (array of incident objects) at the
boundary with Zod (`searchStatusFeed`), passthrough so Google can evolve the
shape. `fetchRankingEvents()` then maps it via the pure shared helper
`mapSearchStatusIncidents` to `AlgorithmEventInsert[]`:

- keeps only **Ranking**-affecting incidents (drops Serving / Crawling / Indexing
  outages),
- classifies `kind` from the label (`core_update` / `spam_update` /
  `reviews_update` / `helpful_content_update` / `other`),
- maps `begin` → `startedAt`, `end` → `endedAt` (absent ⇒ `null` ⇒ rollout still
  ongoing),
- dedupes by incident id, sorts by start ascending.

The ingestion job (`apps/scrapers/src/jobs/algorithmEventsIngest.ts`) upserts
these into `algorithm_events` keyed on `(source, external_id)` (migration 0012),
so re-running is idempotent and an ongoing update gets its `ended_at` filled in
once Google closes it.

## Why a ranking *disruption* is kept too

Criterion 6 is deliberately conservative (CLAUDE.md #10: a false "ready" is worse
than waiting). A ranking systems disruption is as good a reason to delay a
promotion as an announced core update, so any Ranking-affecting incident counts —
not just the informational announcements.
