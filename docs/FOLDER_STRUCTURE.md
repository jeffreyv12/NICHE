# Folder Structure

The pnpm + Turborepo monorepo layout. **Locked unless explicit user change.**

---

## Top level

```
nichefinder/
├── apps/
│   ├── web/                       # Next.js 15 multi-tenant app (public sites + admin)
│   └── scrapers/                  # Hetzner-hosted cron + agent runners
├── packages/
│   ├── db/                        # Drizzle schema + migrations
│   ├── ui/                        # shadcn-based shared components
│   ├── shared/                    # Zod schemas, kill-list, types, constants
│   └── agent-sdk/                 # Claude Agent SDK wrapper, MCP glue, budget guards
├── docs/                          # All design docs (this folder is canonical)
├── infra/                         # Hetzner provisioning, systemd units, deployment scripts
├── .github/
│   └── workflows/                 # CI for lint, test, deploy
├── .env.example                   # Documented env vars
├── .env.local                     # Real values (gitignored)
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── package.json
├── biome.json
└── README.md
```

---

## `apps/web/` — Next.js 15 App Router

```
apps/web/
├── app/
│   ├── (public)/                  # Public-facing routes; tenant-scoped via middleware rewrite
│   │   ├── layout.tsx             # Loads tenant config, sets brand CSS vars
│   │   ├── page.tsx               # Tenant homepage
│   │   ├── [...slug]/             # Catch-all for tenant pages (rendered from DB)
│   │   │   └── page.tsx
│   │   ├── ai-disclosure/         # Sitewide AI disclosure page
│   │   │   └── page.tsx
│   │   ├── privacy/
│   │   ├── colofon/
│   │   └── sitemap.xml/route.ts   # Per-tenant sitemap
│   ├── sites/[tenant_slug]/       # Internal route the middleware rewrites to
│   │   └── ...
│   ├── admin/                     # Operator admin UI
│   │   ├── layout.tsx             # Auth check (Supabase magic-link + allowlist)
│   │   ├── page.tsx               # Dashboard
│   │   ├── niches/                # Candidate triage, niche state management
│   │   ├── content/               # Page review queue
│   │   ├── tests/                 # First-party test logging
│   │   ├── promotions/            # Promotion-ready niches + migration trigger
│   │   ├── costs/                 # Claude spend + infra ledger
│   │   └── settings/              # Tenant configs, env overrides
│   ├── r/[short_code]/route.ts    # Affiliate-link redirect + click logging
│   ├── webhooks/
│   │   ├── bol/[token]/route.ts
│   │   ├── awin/[token]/route.ts
│   │   ├── daisycon/[token]/route.ts
│   │   ├── digistore/[token]/route.ts
│   │   └── impact/[token]/route.ts
│   ├── api/
│   │   ├── auth/                  # Supabase auth callbacks
│   │   ├── revalidate/            # ISR revalidation endpoint (admin-protected)
│   │   └── health/route.ts
│   └── globals.css                # Tailwind + base
├── middleware.ts                  # Hostname → tenant rewrite
├── lib/
│   ├── tenants.ts                 # Tenant lookup + KV cache
│   ├── auth.ts                    # Supabase auth helpers, allowlist check
│   ├── render/                    # Page rendering helpers (Markdown→HTML, schema, hreflang)
│   └── analytics.ts               # Plausible + PostHog client wrappers
├── components/
│   ├── tenant/                    # Public-facing components per tenant brand
│   ├── admin/                     # Admin UI components
│   └── shared/                    # Cross-context (header, footer, badges)
├── scripts/
│   ├── seed.ts                    # Seed main authority tenant + admin emails
│   └── revalidate-all.ts          # Maintenance: revalidate every tenant
├── public/
│   ├── favicons/                  # Per-tenant favicons under subdirs
│   └── robots.txt                 # Template; per-tenant served dynamically
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

**Notes:**
- `middleware.ts` is the single source of truth for hostname routing. Edge runtime; reads tenant from Vercel KV (60s TTL).
- Public pages render under `(public)` group. Admin under `/admin`. Webhooks separate so they bypass tenant rewrite.
- `app/sites/[tenant_slug]/` is internal; never user-visible.
- Tenant-scoped resources (sitemap.xml, robots.txt, manifest.json) are dynamic routes per tenant.

---

## `apps/scrapers/` — Hetzner cron + agent runners

```
apps/scrapers/
├── src/
│   ├── jobs/                      # Scheduled jobs invoked by systemd timers
│   │   ├── discovery.ts           # Sun 02:00 NL — nightly discovery batch
│   │   ├── scoring.ts             # Sun 03:30 NL — nightly scoring batch
│   │   ├── validation-review.ts   # Fri 18:00 NL — weekly validation decisions
│   │   ├── promotion-eval.ts      # Sun 04:00 NL — nightly promotion-gate check
│   │   ├── orchestrator.ts        # Mon 06:00 NL — weekly portfolio review
│   │   ├── kill-sweep.ts          # Sun 04:30 NL — kill-list flag job
│   │   ├── retention.ts           # Daily — data retention pruning
│   │   ├── gsc-pull.ts            # Daily — GSC metrics ingest per tenant
│   │   ├── conversions-reconcile.ts # Daily — reconcile affiliate networks
│   │   └── bol-feed-sync.ts       # Every 2h — Bol product feed
│   ├── sources/                   # External-API integrations (see docs/DATA_SOURCES.md)
│   │   ├── dataforseo/
│   │   ├── bol/
│   │   ├── awin/
│   │   ├── daisycon/
│   │   ├── digistore/
│   │   ├── impact/
│   │   ├── youtube/
│   │   ├── wikipedia/
│   │   ├── euipo/
│   │   └── gsc/
│   ├── registrars/                # Domain registration
│   │   ├── cloudflare/
│   │   └── transip/
│   ├── infra/                     # Vercel Domains, Cloudflare DNS
│   │   ├── vercel/
│   │   └── cf-dns/
│   ├── webhooks/                  # Outbound notifiers
│   │   ├── slack.ts
│   │   └── discord.ts
│   ├── lib/
│   │   ├── budget.ts              # Per-call + monthly budget guard
│   │   ├── cron.ts                # systemd timer invocation helpers
│   │   └── logger.ts              # Pino + Sentry
│   └── index.ts                   # CLI entry: `pnpm scrapers <job>`
├── systemd/                       # Unit + timer files (deployed to /etc/systemd/system)
│   ├── nichefinder-discovery.service
│   ├── nichefinder-discovery.timer
│   └── ...
├── tsconfig.json
└── package.json
```

**Job invocation:**
- Each systemd unit is `ExecStart=/usr/bin/node /opt/nichefinder/scrapers/dist/index.js <job-name>`
- Timers are persistent and run on next boot if missed
- Logs go to journald + Sentry

---

## `packages/db/` — Drizzle schema + migrations

```
packages/db/
├── src/
│   ├── schema.ts                  # Drizzle table definitions (mirrors docs/DATABASE_SCHEMA.sql)
│   ├── enums.ts                   # All enums
│   ├── relations.ts               # Drizzle relations
│   ├── client.ts                  # Drizzle client factory (Postgres pool)
│   ├── service-client.ts          # Service-role client (bypasses RLS — server-only)
│   └── index.ts                   # Re-exports
├── migrations/
│   ├── 0001_init.sql              # The schema in docs/DATABASE_SCHEMA.sql
│   ├── 0002_rls.sql               # RLS policies (split for clarity)
│   ├── 0003_*.sql                 # Future migrations
│   └── meta/                      # Drizzle journal
├── drizzle.config.ts
├── tsconfig.json
└── package.json
```

**Migration rules:**
- Migrations are append-only. Never edit a committed migration.
- Schema changes go through `pnpm db:generate` (Drizzle generates diff), reviewed in PR.
- Apply to local first; smoke-test; then `pnpm db:migrate:prod` via CI.

---

## `packages/ui/` — Shared shadcn components

```
packages/ui/
├── src/
│   ├── components/
│   │   ├── ui/                    # shadcn primitives (button, card, dialog, ...)
│   │   ├── public/                # Cross-tenant public-facing (HeroBlock, ReviewCard, ...)
│   │   ├── admin/                 # Admin-specific (NicheBoard, ScoreBreakdown, ...)
│   │   ├── disclosures/           # AIAssistedBadge, AffiliateDisclosure (rendered everywhere)
│   │   └── analytics/             # Per-tenant Plausible + PostHog wrappers
│   ├── lib/
│   │   ├── cn.ts                  # className helper
│   │   └── theme.ts               # Brand-token application
│   └── index.ts
├── tailwind.config.ts             # Re-exported base config
├── components.json                # shadcn config
└── package.json
```

---

## `packages/shared/` — Zod schemas + constants

```
packages/shared/
├── src/
│   ├── env.ts                     # Zod-validated env parser
│   ├── schemas/
│   │   ├── agent-io/              # Input/output shapes for every agent
│   │   ├── api/                   # API request/response shapes
│   │   ├── tenant-config.ts       # tenants.config JSONB shape
│   │   └── ...
│   ├── killList.ts                # Source of truth for docs/KILL_LIST.md
│   ├── rubric.ts                  # Source of truth for docs/NICHE_SCORING_RUBRIC.md
│   ├── promotionGate.ts           # Source of truth for docs/PROMOTION_GATE.md thresholds
│   ├── constants.ts               # Shared constants (UA strings, rate limits, model strings)
│   └── types.ts                   # Cross-package types
├── tests/                         # Vitest unit tests
└── package.json
```

**Why `shared`:** the kill list, rubric, and promotion gate are referenced from both `apps/web` (admin display + page-publish gates) and `apps/scrapers` (agent runtime). Single source of truth lives here.

---

## `packages/agent-sdk/` — Claude Agent SDK wrapper

```
packages/agent-sdk/
├── src/
│   ├── client.ts                  # Anthropic client factory with beta headers
│   ├── runAgent.ts                # The wrapper every agent uses (see docs/ARCHITECTURE.md)
│   ├── cost.ts                    # computeCostEur per model
│   ├── guards/
│   │   ├── budget.ts              # Per-call + monthly budget
│   │   └── tier-routing.ts        # Compile-time allowed-model checks
│   ├── agents/
│   │   ├── discovery/
│   │   │   ├── prompt.ts          # System prompt (versioned: discovery@1.0.0)
│   │   │   ├── input.ts           # Zod input schema
│   │   │   ├── output.ts          # Zod output schema
│   │   │   └── index.ts           # runDiscoveryAgent()
│   │   ├── scoring/
│   │   ├── validation/
│   │   ├── content/
│   │   ├── promotion/
│   │   └── orchestrator/
│   ├── mcp/                       # MCP server glue
│   │   ├── supabase.ts
│   │   ├── cloudflare.ts
│   │   ├── dataforseo.ts
│   │   └── ...
│   ├── tools/                     # Anthropic tool definitions for each agent's tool list
│   │   ├── discovery-tools.ts
│   │   ├── scoring-tools.ts
│   │   └── ...
│   └── batch.ts                   # Batch API helpers
├── tests/
└── package.json
```

---

## `infra/` — Hetzner provisioning + deploy

```
infra/
├── hetzner/
│   ├── provision.sh               # One-shot Ubuntu 24 setup (Node 22, pnpm, systemd, Caddy)
│   ├── deploy.sh                  # rsync dist + restart systemd units
│   ├── env.example                # /etc/nichefinder/env template
│   └── systemd/                   # Source of truth for unit files (rsync'd to /etc/)
├── github-actions/
│   └── deploy-hetzner.yml         # Triggered on push to main
└── README.md
```

---

## Workspace dependencies

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`turbo.json` pipeline:

```json
{
  "pipeline": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] },
    "db:migrate": { "cache": false }
  }
}
```

---

## Import aliases

Configured in `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@nichefinder/db": ["packages/db/src/index.ts"],
      "@nichefinder/db/*": ["packages/db/src/*"],
      "@nichefinder/ui": ["packages/ui/src/index.ts"],
      "@nichefinder/ui/*": ["packages/ui/src/*"],
      "@nichefinder/shared": ["packages/shared/src/index.ts"],
      "@nichefinder/shared/*": ["packages/shared/src/*"],
      "@nichefinder/agent-sdk": ["packages/agent-sdk/src/index.ts"],
      "@nichefinder/agent-sdk/*": ["packages/agent-sdk/src/*"]
    }
  }
}
```

---

## Dependency direction rules

- `apps/*` may depend on any `packages/*`
- `packages/db` is a leaf — may not depend on other workspace packages
- `packages/shared` is a leaf — may not depend on other workspace packages
- `packages/ui` may depend on `packages/shared`
- `packages/agent-sdk` may depend on `packages/shared` + `packages/db`
- **No circular deps. Enforced by ESLint rule.**
- External deps installed at the package level when scoped (e.g. Drizzle in `packages/db`), at root only for tooling (Biome, Turborepo)

---

## Test layout

Per package: `src/**` for code, `tests/**` for tests. Vitest. Coverage threshold per package; CI fails below threshold.

Critical paths with mandatory tests:
- `packages/shared/killList.ts` — every category
- `packages/shared/rubric.ts` — weighted-sum, hard-blocks, escalation triggers
- `packages/shared/promotionGate.ts` — each of the 7 criteria
- `apps/web/middleware.ts` — hostname routing, tenant resolution
- `apps/web/app/r/[short_code]/route.ts` — click logging, redirect correctness
- `packages/agent-sdk/runAgent.ts` — budget guards, retry, schema validation
- Webhook handlers — HMAC verification, idempotency
