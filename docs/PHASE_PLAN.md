# Phase Plan

The step-by-step plan Claude Code follows. **No timelines** — phases are ordered steps; you move at the speed of operator-approval gates.

Every step has explicit acceptance criteria. A step is "done" only when its criteria pass.

---

## Phase 0 — Operator Sprint Zero

**Operator-only work; no code yet.** Items also listed in `HANDOVER_README.md` checklist.

- 0.1 KvK eenmanszaak registered with SBI 63.12 + 73.11 + 58.19
- 0.2 Business banking opened (Bunq Business or Wise Business)
- 0.3 Anthropic API account funded with ≥€50 credit
- 0.4 Supabase project created in eu-central-1 (Frankfurt), Pro tier
- 0.5 Vercel team account on Pro tier
- 0.6 GitHub private repo created
- 0.7 Cloudflare account verified, Registrar API beta requested
- 0.8 TransIP account with API key generated
- 0.9 DataForSEO account funded with ≥$50 credit
- 0.10 Affiliate networks applied for: Bol.com Partner, Awin (€1 deposit), Daisycon, Digistore24, Impact.com
- 0.11 Main authority domain selected and registered (TMview-screened first)
- 0.12 Boekhouder/accountant identified (e.g. Tellow, Moneybird + adviser)

**Done when:** all credentials are in a secure password manager and the operator can log into every account.

---

## Phase 1 — Foundation

Repo, scaffolding, auth, DB, agent SDK wrapper. **Output: a deployable empty multi-tenant skeleton.**

### 1.1 Repo bootstrap
- 1.1.1 `pnpm init` at root; `pnpm-workspace.yaml` lists `apps/*` and `packages/*`
- 1.1.2 Turborepo configured with `turbo.json` covering build/lint/test/dev pipelines
- 1.1.3 TypeScript `tsconfig.base.json` at root; per-package `tsconfig.json` extending it
- 1.1.4 Biome configured at root (lint + format)
- 1.1.5 `pnpm` scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `db:migrate`, `db:seed`
- 1.1.6 `.gitignore` covers `.env.local`, `.env.*.local`, `node_modules`, `.next`, `.turbo`, `dist`
- 1.1.7 Pre-commit hook (Husky + lint-staged) blocks `.env*` files from being staged

**Done when:** `pnpm install && pnpm typecheck && pnpm lint` passes on a fresh checkout.

### 1.2 Database schema + migrations
- 1.2.1 `packages/db` created with Drizzle
- 1.2.2 Migration 0001 ports the schema from `docs/DATABASE_SCHEMA.sql` exactly
- 1.2.3 RLS policies in migration 0002 (split for clarity)
- 1.2.4 Seed script in `apps/web/scripts/seed.ts`: inserts main authority tenant + admin emails
- 1.2.5 `pnpm db:migrate` applies cleanly against local Supabase + remote Supabase EU
- 1.2.6 Drizzle introspection generates typed query helpers in `packages/db/src/schema.ts`

**Done when:** `pnpm db:migrate && pnpm db:seed` succeeds locally and on Supabase production project.

### 1.3 Env validation
- 1.3.1 `packages/shared/env.ts` exports a Zod-validated env object
- 1.3.2 Every server entry point calls `parseEnv()` at startup; bad config fails fast
- 1.3.3 `.env.example` documents every key; CI checks parity between `.env.example` and actual usage

**Done when:** removing a required env var causes a deterministic startup failure with a clear message.

### 1.4 Web app skeleton
- 1.4.1 `apps/web` is Next.js 15 App Router (TypeScript strict)
- 1.4.2 `apps/web/middleware.ts` reads hostname, looks up `tenants` row (cached in Vercel KV with 60s TTL), rewrites to `/sites/[tenant_slug]/[...]`
- 1.4.3 `apps/web/app/sites/[tenant_slug]/layout.tsx` reads tenant config, sets brand CSS variables
- 1.4.4 `apps/web/app/sites/[tenant_slug]/page.tsx` renders a placeholder "Welcome to [brand]"
- 1.4.5 `apps/web/app/admin/layout.tsx` enforces auth (Supabase magic-link, email allowlist check)
- 1.4.6 `apps/web/app/admin/page.tsx` placeholder admin dashboard
- 1.4.7 `apps/web/app/r/[short_code]/route.ts` — affiliate-link redirect that records a `clicks` row and 302s to `affiliate_links.tracking_url`

**Done when:** locally, `expertgids.local:3000` shows the placeholder; `/admin` requires login; `/r/[short_code]` redirects + logs.

### 1.5 Agent SDK wrapper
- 1.5.1 `packages/agent-sdk` created
- 1.5.2 `runAgent(name, model, input, options)` wrapper enforces:
   - Zod input/output schemas
   - `agent_runs` row created with `started_at`, `model`, `agent`
   - Budget guard (per-call cap + monthly cap)
   - Prompt caching enabled on system prompt
   - Failure → `status='failed'` with error logged
- 1.5.3 Cost calculator: `computeCostEur(usage, model)` based on Anthropic published rates
- 1.5.4 Tier-routing helper: `allowedModelsForAgent('discovery')` returns only Haiku and (escalation) Sonnet; rejects Opus at compile time
- 1.5.5 Unit tests cover happy path, schema fail, budget breach, retry

**Done when:** a smoke test agent (`echo-agent`) runs via `runAgent`, writes a row to `agent_runs`, costs are ≥0.

### 1.6 Deployment + CI
- 1.6.1 GitHub Actions: PR → run lint + typecheck + test; main → deploy DB migrations to prod
- 1.6.2 Vercel project linked, env vars set, preview deploys on PR
- 1.6.3 Sentry SDK installed in `apps/web` and `apps/scrapers`; per-tenant tag on every error
- 1.6.4 Hetzner CX22 provisioned, Ubuntu 24, Node 22, pnpm 9
- 1.6.5 Hetzner systemd service for scrapers (stub, no jobs yet)

**Done when:** PR opened → green CI; merge → production migration applied; scrapers service running on Hetzner with no errors.

**Phase 1 acceptance:** all CLAUDE.md Phase 1 DoD items pass.

---

## Phase 2 — Discovery & Scoring

The first half of the engine: surface and rank niches. **Output: a nightly batch that produces a ranked candidate list in the admin UI.**

### 2.1 Source integrations
- 2.1.1 `apps/scrapers/src/sources/dataforseo/` — wrapper for Trends, Labs, SERP (Standard Queue + polling)
- 2.1.2 `apps/scrapers/src/sources/bol/` — OAuth2 client_credentials, Marketing Catalog read, search-trends export
- 2.1.3 `apps/scrapers/src/sources/awin/` — programmes list, transactions, product feed stream
- 2.1.4 `apps/scrapers/src/sources/daisycon/` — OAuth2 PKCE, programs, transactions, statistics
- 2.1.5 `apps/scrapers/src/sources/youtube/` — Data API v3 trending search
- 2.1.6 `apps/scrapers/src/sources/wikipedia/` — pageview deltas (NL)
- 2.1.7 `apps/scrapers/src/sources/euipo/` — TMview screening
- 2.1.8 Each source has Zod schemas at the boundary, retry+backoff, response caching, unit tests

**Done when:** each source has at least one happy-path test and one auth-refresh test passing.

### 2.2 Discovery Agent
- 2.2.1 Prompt `discovery@1.0.0` from `docs/AGENT_PROMPTS.md` wired in `packages/agent-sdk/src/agents/discovery/`
- 2.2.2 Console-tested with sample input; output matches schema
- 2.2.3 Runs via Anthropic Batch API (nightly job at Sun 02:00 NL Hetzner time)
- 2.2.4 Writes results to `niche_candidates`
- 2.2.5 Kill-list pre-filter before any candidate is written (defense in depth)
- 2.2.6 Trademark screening calls EUIPO; sets `niche_candidates.trademark_check_state`

**Done when:** running `pnpm scrapers discovery:once` writes ≥10 candidates to local DB.

### 2.3 Scoring Agent
- 2.3.1 Prompt `scoring@1.0.0` wired with Haiku first pass + Sonnet escalation
- 2.3.2 Per-candidate pre-fetch routine pulls affiliate, DataForSEO, Wikipedia, EUIPO data
- 2.3.3 Output validated against rubric Zod schema
- 2.3.4 Writes results to `niche_scores` with `rubric_version='1.0.0'`
- 2.3.5 Borderline (55-70) escalation to Sonnet implemented, includes Haiku's breakdown
- 2.3.6 Cron: Sun 03:30 NL, picks unscored candidates from last 24h
- 2.3.7 Cost telemetry shows ≥30% prompt-cache hit ratio

**Done when:** scoring run completes on 20+ candidates with cost <€2 total.

### 2.4 Admin triage UI
- 2.4.1 `/admin/niches` lists top-100 candidates by latest score, with score breakdown drawer
- 2.4.2 Filters: state, score range, source, search by topic
- 2.4.3 Per-row actions: Approve for Validation, Reject (with reason), View Breakdown, View Evidence
- 2.4.4 Approve → niche row created in `niches` with state `approved_for_validation`
- 2.4.5 Reject → kill-list entry created with reason

**Done when:** operator can triage 20 candidates in under 10 minutes.

**Phase 2 acceptance:** first nightly batch runs end-to-end; operator triages and approves at least 1 candidate for validation.

---

## Phase 3 — Validation Pipeline

Spin up test pages, drive traffic, decide go/pivot/kill. **Output: an approved niche moves through validation and the agent produces a decision.**

### 3.1 Test-page generator
- 3.1.1 Content Agent (Sonnet 4.6, no Opus polish at this phase) drafts 3–5 test pages per approved niche
- 3.1.2 Pages publish to `/test/[niche_slug]/...` paths under the main tenant
- 3.1.3 Each page has Bol/Awin/Daisycon tracked links with SubID `[tenant]:[page]:[cohort]`
- 3.1.4 Schema markup applied per page kind
- 3.1.5 Affiliate disclosure rendered server-side at top of body
- 3.1.6 AI disclosure (visible badge + JSON-LD) rendered server-side

**Done when:** approving a niche generates 5 draft pages; operator can review-edit-publish each in <15 min.

### 3.2 Click + conversion tracking
- 3.2.1 `/r/[short_code]` redirect writes `clicks` row with cohort, page_id, bot score, referrer
- 3.2.2 Bot scoring: Cloudflare Turnstile / bot-score header; reject obvious bots, log others
- 3.2.3 Conversion webhooks: Bol postback at `/webhooks/bol/{token}`, Awin postback at `/webhooks/awin/{token}`, etc.
- 3.2.4 Webhook handler validates HMAC, writes `conversions` row, links to `affiliate_link_id` via SubID
- 3.2.5 Daily reconciliation job pulls Bol/Awin/Daisycon/Digistore/Impact reporting APIs and merges into `conversions`

**Done when:** a real Bol click → conversion round-trips and appears in `conversions` within 24h.

### 3.3 Validation Agent
- 3.3.1 Prompt `validation@1.0.0` wired
- 3.3.2 On-demand runner (operator-triggered) + Friday 18:00 NL scheduled review
- 3.3.3 Inputs: niche, test-pages, 14-day aggregated metrics
- 3.3.4 Output: GO/PIVOT/KILL decision written to `niches.state`, with reasoning in `niches.notes`
- 3.3.5 Admin UI shows decision with rationale and operator confirm step
- 3.3.6 PIVOT decisions include specific next-keyword-cluster suggestions

**Done when:** running the agent on a niche with the sample input returns the expected decision shape.

**Phase 3 acceptance:** at least one niche has moved through `validating` → `go` and is ready for full build.

---

## Phase 4 — Content Engine

Build out validated niches. **Output: a niche has 20–40 pages live, including operator-edited heroes.**

### 4.1 Content Agent polish pass
- 4.1.1 Prompt `content@1.0.0` polish pass (Opus 4.7) wired
- 4.1.2 Hero/commercial pages trigger polish pass automatically
- 4.1.3 Internal-link suggestions generated against the tenant's published page list

**Done when:** a draft → review → polish → approve cycle takes <30 min for a hero page.

### 4.2 Claim Verifier
- 4.2.1 Every page entering `pending_review` runs the claim verifier
- 4.2.2 For each claim, check `claim_sources` exists with a `source_url` or `first_party_test_id`
- 4.2.3 Unsourced claims block publish; surfaced as "operator must add source" todos
- 4.2.4 Operator UI: per-claim inline source-attach widget

**Done when:** no page can transition to `published` with an unsourced claim. Tested by deliberately unsourcing one and verifying the block.

### 4.3 First-party test logging
- 4.3.1 `/admin/tests` lets operator log a first-party test with product, summary, photos, pros/cons, rating
- 4.3.2 Photos upload to Cloudflare R2
- 4.3.3 Linked to pages via `claim_sources.first_party_test_id`
- 4.3.4 Schema markup auto-includes `Review` with `author=Person(operator)` and `reviewBody=test_summary`

**Done when:** logging a test and attaching it to a claim removes the publish-block.

### 4.4 ISR + on-demand revalidation
- 4.4.1 Each public page uses ISR with `revalidate=86400` (24h) default
- 4.4.2 On publish or edit, server action calls `revalidateTag('page:[id]')` and `revalidateTag('tenant:[slug]')`
- 4.4.3 Sitemap regenerates on any publish; submitted to IndexNow (Bing) and listed in GSC

**Done when:** editing a page and saving causes the public version to update within 60s.

**Phase 4 acceptance:** first niche has 20+ live pages, all sourced, all AI-disclosed, all affiliate-disclosed.

---

## Phase 5 — Promotion Automation

Domain registration + migration. **Output: a niche graduates from subfolder to its own domain end-to-end.**

### 5.1 Cloudflare Registrar integration
- 5.1.1 `apps/scrapers/src/registrars/cloudflare/` — search, check, register endpoints
- 5.1.2 Pre-registration TMview re-check (the check at scoring time may be stale)
- 5.1.3 Operator approval UI: shows price, registrar, domain summary, "Confirm registration" button
- 5.1.4 Confirmation triggers registration + `domain_registrations` row

### 5.2 TransIP integration
- 5.2.1 `apps/scrapers/src/registrars/transip/` — availability, register for .nl/.be
- 5.2.2 JWT signing with private key (base64-decoded from env)
- 5.2.3 Same operator-approval flow as Cloudflare

### 5.3 DNS + Vercel attach
- 5.3.1 After registration: Cloudflare DNS zone created, apex+www records added
- 5.3.2 Vercel Domains API attaches apex + www to project
- 5.3.3 Poll SSL state until valid; alert on >5min wait
- 5.3.4 Add domain as GSC property via DNS TXT record (Cloudflare-automated)

### 5.4 Promotion Agent
- 5.4.1 Prompt `promotion@1.0.0` wired
- 5.4.2 Cron: Sun 04:00 NL, evaluates every `building`/`mature` niche
- 5.4.3 Writes `promotion_evaluations` row per niche
- 5.4.4 If `result='ready'`: admin UI shows "Ready to promote" card with full recommendation
- 5.4.5 Operator approves → migration procedure runs

### 5.5 Migration procedure
- 5.5.1 13-step migration from `docs/PROMOTION_GATE.md` implemented as a state machine
- 5.5.2 Each step writes progress; on failure, retry-from-step capability
- 5.5.3 301 rewrites added to `apps/web/next.config.js` (generated from `tenants` table at build time, or via middleware lookup)
- 5.5.4 Hreflang emitted on both old subfolder and new domain
- 5.5.5 Cross-domain canonical lint in CI

**Phase 5 acceptance:** dry-run migration of a test niche succeeds (Vercel preview deploy with a throwaway test domain).

---

## Phase 6 — Orchestrator & MVP Launch

Weekly portfolio review, cost telemetry, killing loop. **Output: the engine runs without operator handholding outside the approval gates.**

### 6.1 Orchestrator Agent
- 6.1.1 Prompt `orchestrator@1.0.0` wired
- 6.1.2 Cron: Mon 06:00 NL weekly
- 6.1.3 Output written to `agent_runs` + a structured report rendered in admin UI
- 6.1.4 Slack/Discord webhook posts the headline + action items
- 6.1.5 Per-niche kill recommendations include `redirect_to_niche_id` candidate

### 6.2 Kill-list automation
- 6.2.1 Daily Sun 04:30 NL: for every niche, check kill criteria
- 6.2.2 Auto-flag, never auto-kill — operator confirms
- 6.2.3 Confirmed kill: pages archived, redirects set, topic hub re-pointed

### 6.3 Cost telemetry
- 6.3.1 Daily aggregate of `agent_runs.cost_eur` into a `daily_costs` materialized view
- 6.3.2 Admin dashboard widget: MTD spend, projected month-end, cache hit ratio, batch discount earned
- 6.3.3 Alert at 80%, hard pause at 100% of `CLAUDE_MONTHLY_BUDGET_EUR`

### 6.4 Compliance final checks
- 6.4.1 Every public page renders the AI-assistance badge if `ai_assisted=true`
- 6.4.2 `/ai-disclosure` page live on every tenant
- 6.4.3 Affiliate disclosure visible above the fold on every monetised page
- 6.4.4 Klaro! CMP configured per tenant
- 6.4.5 robots.txt and sitemap.xml correct per tenant

### 6.5 Operator runbook
- 6.5.1 `docs/RUNBOOK.md` written: how to handle each common alert, restart procedure, secret rotation, Anthropic-outage fallback

**Phase 6 acceptance:** the engine runs for two full weeks with the operator only acting on approval prompts.

---

## After Phase 6 — what we don't do

The following are tempting but **out of scope until at least one niche is promoted and earning ≥€100/mo for 3 months:**

- Multiple language variants per niche
- A "newsletter agent" that drafts emails
- Paid-ads automation
- A user-facing API
- Mobile app
- Marketplace expansion (Amazon, Coolblue affiliate)
- Custom CMS features beyond what the engine itself uses

Resist scope creep. The whole point of the engine is to compound: do less, learn from each cycle, improve the rubric.
