# Data Sources

Every external API the engine touches. For each: auth pattern, rate limits, endpoints used, quirks, and what to read before integrating.

> **Rule:** every integration lives in `apps/scrapers/src/sources/[name]/` with its own README, types, and Zod schemas at the boundary. Never call an external API outside of these modules.

---

## Quick reference

| Source | Auth | Cost | Rate limit | Used for |
|---|---|---|---|---|
| DataForSEO | Basic Auth (login + password) | $0.60/1k SERPs (Standard Queue), $0.0023/keyword (Trends) | ~2k req/min | Keyword volume, SERPs, trends, autocomplete, KGR |
| Bol.com Partner Marketing API | OAuth2 client_credentials → JWT | Free | per-endpoint, see below | Product catalog, search trends (dashboard), affiliate reporting |
| Awin | API token | Free (€1 refundable deposit) | 20 calls/min/user global | Programmes, transactions, product feeds (Google format) |
| Daisycon | OAuth2 PKCE (since April 2023) | Free | Conservative | Programs, transactions, statistics, news/coupons |
| Digistore24 | API key (readonly/full/developer) | Free | Conservative | Orders, products, commissions (digital products) |
| Impact.com | Basic Auth (AccountSID + AuthToken) | Free | 45-day query window max | Actions (conversions), reports |
| YouTube Data API v3 | API key (Google Cloud) | Free | 10k units/day | Trending search, channel velocity |
| Wikipedia REST | None | Free | 100 req/sec/IP (be polite) | Pageview deltas as demand proxy |
| EUIPO TMview | None for read | Free | Throttle to 1 req/sec | Trademark screening before domain registration |
| Cloudflare Registrar | API token (scoped) | At-cost | Generous | Register .com/.eu/.dev domains |
| TransIP API | Login + private key (JWT exchange) | Per-domain cost | Generous | Register .nl/.be domains |
| Vercel Domains | API token | Per project | Generous | Attach domains to multi-tenant project |
| Cloudflare DNS | API token | Free | Generous | Create zones, records, DNSSEC |
| Google Search Console | Service account JSON | Free | 1,200 req/min global | Branded search detection, organic clicks, manual actions |
| Plausible | Site API key | Per stats plan | Generous | Cookieless analytics per tenant |
| PostHog (EU) | Project API key | Free tier 1M events/mo | Generous | Funnel + cohort |
| Resend | API key | Free tier 100/day | Generous | Transactional email only |
| Sentry | DSN + auth token | Free dev tier | Generous | Errors with per-tenant tags |

---

## DataForSEO — the keyword backbone

**Why it's primary:** SerpApi is ~42× more expensive at scale; DataForSEO Standard Queue at $0.60/1k SERPs is the only sustainable price for an autonomous engine running nightly batches. Credits don't expire. No subscription.

**Auth:** HTTP Basic Auth with login (your email) + password (from dashboard).

**Endpoints we use:**

| Use case | Endpoint | Cost reference |
|---|---|---|
| Keyword search volume + KD | `/v3/dataforseo_labs/google/keyword_overview/live` | $0.0006 / keyword |
| Related keywords | `/v3/dataforseo_labs/google/related_keywords/live` | $0.001 / keyword |
| Keyword suggestions | `/v3/dataforseo_labs/google/keyword_suggestions/live` | $0.001 / keyword |
| Search intent | bundled in keyword_overview | n/a |
| SERP top-10 | `/v3/serp/google/organic/task_post` (Standard Queue, async) | $0.0006 / SERP |
| Autocomplete | `/v3/serp/google/autocomplete/task_post` | $0.0006 / SERP |
| Google Trends | `/v3/keywords_data/google_trends/explore/live` | $0.0023 / call |
| KGR helper (allintitle) | use SERP endpoint with `allintitle:` operator | $0.0006 / SERP |

**Queue choice:**

- **Standard Queue** (default) — async, results ready in ~5min, costs 1×. Use for nightly batches.
- **Live** — sub-second, costs 15×. Use only for operator-triggered checks.

**Implementation notes:**
- Always pass `location_code: 2528` (Netherlands) and `language_code: 'nl'` for NL keywords; `2056` (Belgium) for BE-specific.
- DataForSEO Live queue returns results inline; Standard Queue returns a `task_id` to poll with `/task_get`. Poll every 30s, max 10min, then time out.
- Cache responses by query hash for 7 days. Re-running the same SERP within a week is wasted money.
- Use the community MCP if available (`mcp-server-dataforseo` or your own thin OpenAPI wrapper). Direct REST calls work fine too.

**Reading list:**
- https://docs.dataforseo.com/v3/
- https://docs.dataforseo.com/v3/dataforseo_labs/google/

---

## Bol.com Partner — the killer NL/BE data source

**Why it's critical:** Bol.com is the dominant NL marketplace. Their Marketing Catalog API + Affiliate Reporting API v2 expose product data + conversion attribution that no third-party tool replicates.

**Auth (Marketing API):**
- Get Client ID + Secret from affiliate dashboard → "API toegang" → "Reporting API"
- POST to `https://login.bol.com/token?grant_type=client_credentials` with Basic Auth header
- Response: JWT bearer with `expires_in` typically 300s
- Refresh proactively at 80% of lifetime

**Endpoints:**

| Endpoint | Purpose |
|---|---|
| `GET https://api.bol.com/marketing/v10/catalog/...` | Marketing Catalog (products) |
| `GET https://api.bol.com/marketing/v2/affiliate/reports/...` | Affiliate Reporting v2 (orders, EPC, AOV) |
| Product feed (CSV, every 2h) | Bulk product data; download URL provided in dashboard |

**Affiliate Reporting API v2 — the key fields:**
- `siteCode` — pass this in deeplinks so each tenant's traffic is separately attributable. Stored in `BOL_SITE_CODE` env, suffixed per tenant in code.
- `subid` — encodes tenant + page + cohort. Max 64 chars. Bol truncates silently if longer.
- `orderItemId` — Bol's transaction ID; primary key for our `conversions` table.
- `approvedForPayment` and `statusFinal` — booleans; only count `statusFinal=true AND approvedForPayment=true` as confirmed revenue for the promotion gate.

**Product feed (2h refresh):**
- Pulls at every odd hour:30 (`:30, 03:30 skipped, 05:30, 07:30, ...`). 03:30 is consistently skipped — known Bol behaviour. Plan agent cron around this.
- Format: CSV with EAN, title, price, category path, image URLs, deeplink template.

**Commission tiers (verify per category — they change):**
| Category | Tier | Commission |
|---|---|---|
| Books, music, films | Brons | ~2.5% |
| Electronics | Brons | ~2.5% |
| Home & living | Platinum | up to 7% |
| Toys | Goud | ~4-5% |
| Fashion | Zilver | ~3-4% |

These rates shift. Pull current rates from the partner dashboard at the start of each scoring run; don't hardcode.

**Reading list:**
- https://api.bol.com/marketing/docs/affiliate-reports-api/v2-api-documentation.html
- https://api.bol.com/marketing/docs/catalog-api/api-documentation.html
- https://partnerplatform.bol.com/en/need-help/offer/view-bol-search-trends-in-your-seller-account/

---

## Awin — publisher API

**Auth:** Single API token from `ui.awin.com/awin-api`. Header: `Authorization: Bearer {token}`.

**Pre-requisite:** Publisher signup includes a €1 refundable security deposit. Approval typically 24–72h.

**Rate limit:** Global 20 calls/min/user; product-feed endpoint 5 req/min per advertiser.

**Endpoints used:**

| Endpoint | Purpose |
|---|---|
| `GET /publishers/{pid}/programmes` | List joined programmes |
| `GET /publishers/{pid}/transactions/` | Conversions with `startDate`, `endDate`, `dateType` (`transaction`/`validation`) |
| Enhanced Product Feed (Google format) | Per-advertiser product catalog |
| Proof of Purchase Publisher Transaction API | Higher rate (6 req/sec) for POP-eligible publishers |

**Implementation notes:**
- Awin's `transactionDate` is when the transaction occurred; `validationDate` is when it was approved/rejected. For our promotion gate, count by `validationDate` and `status='approved'`.
- `clickRefs` (SubID) are passed as `awc=...` parameter. Use the format `tenant:page:cohort` (e.g., `koffie:aeropress-review:organic`).
- Product feeds are big (10k–100k+ rows). Stream-parse; never load into memory.

**Reading list:**
- https://help.awin.com/apidocs/introduction-1
- https://help.awin.com/apidocs/retail-publisher-productapidocumentation-1

---

## Daisycon — publisher API

**Auth:** OAuth2 with PKCE (mandatory since April 3, 2023; old basic-auth is deprecated).

**Flow:**
1. Generate code_verifier + code_challenge (PKCE).
2. Send user to `https://login.daisycon.com/oauth/authorize?response_type=code&client_id=...&redirect_uri=...&code_challenge=...&code_challenge_method=S256`.
3. Exchange `code` for `access_token` + `refresh_token` at `/oauth/access-token`.
4. Refresh proactively.

**Endpoints used:**

| Endpoint | Purpose |
|---|---|
| `GET /publishers/{publisherId}/programs` | List programs |
| `GET /publishers/{publisherId}/transactions` | Conversions |
| `GET /publishers/{publisherId}/statistics` | Daily aggregate stats |
| `GET /publishers/{publisherId}/material/news` | Coupons/news feed |
| `GET /publishers/{publisherId}/material/products` | Product feed |

**Payout:**
- Default threshold €25 (range €25–€500 per publisher config).
- Monthly cycle, payout ~75 days after transaction.
- For cashflow planning, treat Daisycon revenue as available ~3 months later.

**Reading list:**
- https://developers.daisycon.com/ (OAuth + REST docs)
- See also `docs/DATA_SOURCES.md` in your own repo for the OpenAPI dump you generate

---

## Digistore24 — digital products

**Auth:** API key from vendor/affiliate dashboard. Three permission scopes: `readonly`, `full`, `developer`. Use `readonly` for the engine. Pin to your IPs.

**Endpoints used:**
- `GET /api/call/listPurchases` — orders
- `GET /api/call/listProducts` — products you can promote
- `GET /api/call/listCommissions` — commission report
- IPN webhook — real-time order events (set up at `https://[main-domain]/webhooks/digistore`)

**Cookie window:** up to 180 days (per product config). Longer than most networks; valuable for nurture/email-driven niches.

**Reading list:**
- https://dev.digistore24.com/

---

## Impact.com — premium brands

**Auth:** Basic Auth with AccountSID + AuthToken from publisher dashboard.

**Endpoints used:**

| Endpoint | Purpose |
|---|---|
| `GET /Mediapartners/{accountSid}/Actions` | List conversions (with SubId1-3, payout, state) |
| `GET /Mediapartners/{accountSid}/ActionUpdates` | Incremental updates |
| `GET /Mediapartners/{accountSid}/Reports/{reportId}` | Run a report |
| `GET /Mediapartners/{accountSid}/ReportExport/{reportId}` | Export to CSV/JSON |

**Quirks:**
- Default query window 7 days; max 45 days. To pull older history, paginate.
- Default page size 20,000.
- State values: `PENDING`, `APPROVED`, `REVERSED`.
- For revenue calculations, count `state='APPROVED'`.

**Reading list:**
- https://integrations.impact.com/impact-publisher/

---

## YouTube Data API v3

**Auth:** API key (Google Cloud).

**Quota:** 10,000 units/day free. Each call costs 1–100 units depending on endpoint.

**Endpoints used:**
- `videos.list` (chart=mostPopular, regionCode=NL) — trending videos
- `search.list` (q=, regionCode=NL, order=viewCount, publishedAfter=) — keyword-based discovery

**Use sparingly:** YouTube is signal-supplementary, not primary. One nightly batch is plenty.

---

## Wikipedia REST API

**Auth:** None.

**Endpoints used:**
- `GET /api/rest_v1/metrics/pageviews/per-article/nl.wikipedia/all-access/user/{title}/daily/{start}/{end}` — pageview history for an article
- `GET /api/rest_v1/metrics/pageviews/aggregate/nl.wikipedia/all-access/user/daily/{start}/{end}` — site-wide aggregates for baseline

**Etiquette:**
- 100 req/sec/IP is the documented limit; we cap at 5 req/sec to be polite.
- `User-Agent` must identify the project (Wikipedia ban patterns of generic UAs).

**Use case:** pageview delta as an independent demand-signal. A Dutch Wikipedia article whose pageviews are up 40% YoY is a strong signal for downstream commercial demand.

---

## EUIPO TMview — trademark screening

**Auth:** None for the public search; throttle to 1 req/sec.

**Endpoint:** `https://www.tmdn.org/tmview/api/...` (the public-facing search behind the TMview UI; treat as a public API and respect ToS).

**Use case:** before registering any domain or accepting any brand candidate, screen against EUIPO + BOIP trademark registers. The Scoring Agent calls this; a hit on Nice classes 9 / 35 / 41 / 42 (most affiliate-relevant) returns a hard block.

**Implementation note:** since the API is the search backing the UI rather than a documented public API, build the wrapper defensively. Cache hits aggressively; revisit only when registering a domain (months later).

---

## Cloudflare Registrar API (beta, April 2025)

**Auth:** Cloudflare API token with scope `Account:Domains:Edit`.

**Endpoints:**
- `GET /accounts/{account_id}/registrar/domains` — list owned domains
- `POST /accounts/{account_id}/registrar/domains/check` — search availability
- `POST /accounts/{account_id}/registrar/domains` — register

**Coverage:** 390+ TLDs including .com, .eu, .dev, .ai, .io. **Not .nl. Not .be.** Use TransIP for those.

**Pricing:** at-cost. Free WHOIS redaction.

**MCP:** Cloudflare's official MCP server exposes the registrar API as agent-callable tools.

**Reading list:**
- https://blog.cloudflare.com/registrar-api-beta/
- https://developers.cloudflare.com/registrar/

---

## TransIP API — .nl and .be

**Auth:** Generate a private key in TransIP control panel → API. Sign a JWT with the key + your login; exchange for a short-lived bearer.

**Endpoints:**
- `GET /v6/domains/{domain}` — query
- `POST /v6/domains` — register
- `GET /v6/domain-availability/{domain}` — availability
- `POST /v6/dns` — manage DNS (we don't; we delegate to Cloudflare)

**Implementation notes:**
- Private key is multi-line; store as a single base64-encoded line in env, decode in code.
- JWT must include the right `iat`, `exp` (≤30min), `aud`, and a one-time `nonce`.
- After registration, set nameservers to Cloudflare's (e.g. `ns1.cloudflare.com`, `ns2.cloudflare.com`) so DNS lives in Cloudflare.

**Reading list:**
- https://api.transip.nl/v6/docs

---

## Vercel Domains API

**Auth:** Vercel API token.

**Endpoints:**
- `POST /v10/projects/{projectId}/domains` — attach apex (e.g., `koffie-expert.nl`)
- `POST /v10/projects/{projectId}/domains` — attach www (separate call)
- `GET /v9/projects/{projectId}/domains/{domain}` — check SSL/verification state
- `DELETE /v9/projects/{projectId}/domains/{domain}` — detach (rare)

**SSL:** Vercel auto-provisions Let's Encrypt; typically valid within 60s of DNS resolution.

**Reading list:**
- https://vercel.com/docs/rest-api/endpoints/domains

---

## Cloudflare DNS

**Auth:** Same API token as Registrar (additional scope `Zone:DNS:Edit`).

**Used for:**
- Creating a zone for each promoted-niche domain
- Adding apex flattening + www CNAME
- DNSSEC enablement
- TXT record for GSC verification
- MX records (skip — no email at MVP per domain)

**Implementation:** Cloudflare's MCP exposes DNS operations. Use the MCP from agents; direct REST elsewhere.

---

## Google Search Console

**Auth:** Service account JSON, base64-encoded in env. Each tenant property is verified via DNS TXT during the promotion step.

**Endpoints:**
- `POST https://searchconsole.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query` — query (the workhorse)
- `GET .../sites` — list properties
- `GET .../sites/{siteUrl}/sitemaps` — sitemap status

**Search Analytics query:**
- Dimensions: `query`, `page`, `date`
- Filters: page-prefix per subfolder/tenant
- Rolling 90-day default for the promotion gate
- Limit 25,000 rows; paginate

**Branded vs non-brand classification:** in code, classify each query row as `branded` if it contains the brand name (or any string in `tenants.config.brand.queries`); else `non_brand`. Long-tail = `non_brand AND query word count ≥ 4`.

**Reading list:**
- https://developers.google.com/webmaster-tools/v1/searchanalytics/query

---

## Plausible Analytics

**Auth:** Site API key (per tenant or shared, per Plausible plan).

**Endpoints:**
- `GET /api/v2/query` — aggregate metrics
- `GET /api/v2/query` with dimensions — breakdowns

**Use case:** cookieless analytics; the promotion-gate engagement metrics (time on page, scroll depth, bounce rate). Stored in `gsc_metrics` table is misleading — we'll also pull Plausible separately into `engagement_metrics` (add to schema in Phase 3).

---

## Resend — transactional email

**Auth:** API key.

**Endpoints:**
- `POST /emails` — send

**At MVP:** Only operator alerts (promotion ready, budget alarm, niche-kill recommendation). No marketing email. No newsletter.

---

## Sentry

**Auth:** DSN + auth token.

**Per-tenant tag:** every captured exception sets `scope.setTag('tenant_id', tenant_id)` so signal/noise per tenant is separable.

---

## Source-integration template

For every new source, the directory structure is:

```
apps/scrapers/src/sources/[source-name]/
  ├── README.md              # this template, filled in
  ├── client.ts              # the raw HTTP/MCP client
  ├── auth.ts                # token refresh, JWT signing, etc.
  ├── schemas.ts             # Zod schemas for every payload at the boundary
  ├── endpoints/             # one file per logical operation
  │   ├── list-programs.ts
  │   └── ...
  ├── cache.ts               # response caching policy
  └── tests/                 # unit tests for parsers + auth
```

Every endpoint function:
1. Validates input with Zod
2. Calls the API with proper retries + backoff
3. Validates response with Zod
4. Returns typed result OR throws a typed error

No external API call exists outside this pattern.
