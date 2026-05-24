# Architecture

System architecture for NicheFinder. Read after `PROJECT_SPEC.md`.

---

## Two-plane design

The system splits cleanly into two planes:

- **Web plane** — the public-facing Next.js 15 multi-tenant app + the operator admin UI. Hosted on Vercel.
- **Agent plane** — long-running Claude agents and cron jobs. Hosted on Hetzner. Talks to Supabase and external APIs.

Supabase Postgres sits between them as the single source of truth. Both planes write to it; only the web plane serves it to humans.

---

## Multi-tenant routing

### How a request is routed

```
Incoming request
    ↓
Vercel edge
    ↓
Next.js middleware (apps/web/middleware.ts)
    ↓
Look up hostname in `tenants` table (cached in middleware via KV)
    ↓
Three cases:
  1. Hostname is the main authority domain (e.g. expertgids.nl)
     → If path starts with /admin → admin app routes
     → If path starts with a subfolder matching a sub-tenant (e.g. /koffie)
       → rewrite to /sites/[tenant_slug]/[...rest]
     → else → main domain landing/about/etc
  2. Hostname is a promoted-niche dedicated domain (e.g. koffie-expert.nl)
     → rewrite to /sites/[tenant_slug]/[...rest]
  3. Hostname is unknown
     → 404
```

The `[tenant_slug]` segment is internal; the user sees the original URL.

### Why this works

- One Next.js app, one Vercel project, one build pipeline.
- Tenants share UI components, schemas, and infrastructure but render with per-tenant config (colours, fonts, logo, locale variants, schema markup).
- Database queries always filter by `tenant_id`, enforced by RLS.

### Custom domain attachment

When a niche is promoted:

1. Operator approves promotion in admin UI.
2. System calls Cloudflare or TransIP registrar API to register the domain (operator pays).
3. System calls Vercel Domains API to attach apex + www to the project.
4. System creates a Cloudflare DNS zone (CNAME apex flattening + www → apex).
5. Vercel auto-provisions SSL.
6. System adds row to `tenants` table with `is_promoted=true`, `hostname='koffie-expert.nl'`, `previous_path='/koffie'`.
7. Middleware now routes both `/koffie` and `koffie-expert.nl/*` to the same tenant — but the subfolder routes serve a 301 to the new domain.

The 301s remain forever. Don't delete them.

---

## Agent runtime

### Where agents run

- **Cron / scheduled** agents (Discovery, Scoring, Promotion-gate eval, Orchestrator weekly) run on **Hetzner via systemd timers**. They are Node.js scripts in `apps/scrapers/src/jobs/*`.
- **On-demand** agents (Validation, Content) run **wherever they're invoked from**. Operator-triggered runs (e.g. "draft this page") run as Vercel serverless functions for low latency; bulk runs invoke a Hetzner endpoint.

### Why Hetzner for batch agents

- Vercel functions have a 300s ceiling on Pro; many agent loops run longer.
- Hetzner CX22 (€4/mo) is cheaper than serverless egress for sustained workloads.
- systemd timers are reliable; no cold starts.
- We control the IP for any rate-limit-by-IP API quirks.

### Agent runtime pattern

Every agent follows the same shape:

```ts
async function runAgent(input: TInput): Promise<TOutput> {
  // 1. Validate input with Zod
  const parsed = InputSchema.parse(input);
  
  // 2. Open agent run record (Supabase) with status='running'
  const run = await db.agentRun.create({
    agent: 'discovery',
    model: env.CLAUDE_MODEL_HAIKU,
    input: parsed,
    started_at: new Date(),
  });
  
  try {
    // 3. Apply per-call budget check (kill if monthly budget breached)
    await assertBudgetAvailable();
    
    // 4. Build messages (system prompt cached via Anthropic prompt caching)
    const messages = buildMessages(parsed);
    
    // 5. Call Claude with the right model, beta headers, tools
    const response = await claude.messages.create({
      model: env.CLAUDE_MODEL_HAIKU,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages,
      tools: getToolsFor('discovery'),
      max_tokens: 4096,
    });
    
    // 6. Validate output with Zod
    const output = OutputSchema.parse(extractJson(response));
    
    // 7. Persist output + close run record
    await db.agentRun.update({ id: run.id, status: 'success', output, cost_eur: computeCost(response), finished_at: new Date() });
    
    return output;
  } catch (err) {
    await db.agentRun.update({ id: run.id, status: 'failed', error: String(err), finished_at: new Date() });
    throw err;
  }
}
```

Wrapped in `packages/agent-sdk/src/runAgent.ts` — every agent uses it.

### Tier routing

Hard rule in code: each agent has a `defaultModel` and an optional `escalationModel`. Sonnet 4.6 may escalate a Haiku 4.5 result if confidence is low (operator-defined threshold per agent). Opus 4.7 is reserved for Promotion and Orchestrator.

Never call Opus from Discovery or Scoring. Compile-time enforced via a wrapper that takes only allowed model strings per agent type.

### Cost-cap circuit breaker

`packages/agent-sdk/src/guards/budget.ts`:

- Reads month-to-date Claude spend from `agent_runs.cost_eur` aggregate.
- If MTD ≥ `CLAUDE_MONTHLY_BUDGET_EUR`, throws `BudgetExceededError` before any Claude call.
- If MTD ≥ 80% of budget, posts a Slack alert (once per day per agent).
- Per-call cap (`CLAUDE_PER_CALL_CAP_EUR`): post-call check; if a single call exceeded the cap, log loudly and pause that agent for 1 hour.

---

## Data flow — the canonical pipeline

```
[ External data sources ]
   ↓ Discovery Agent (Haiku, Batch, nightly)
[ niche_candidates ] (table)
   ↓ Scoring Agent (Haiku → Sonnet, Batch, nightly)
[ niche_scores ] (table)
   ↓ Operator triages in admin UI (top 20 by score)
[ niches ] (table, status='approved_for_validation')
   ↓ Operator clicks "Start validation"
[ Content Agent ] drafts 3-5 test pages
   ↓ Operator edits and approves
[ pages ] (table, status='published', path='/test/[slug]/...')
   ↓ Operator runs €30-60 paid traffic test
[ clicks, conversions, signups ] (tables, filled by tracking)
   ↓ Validation Agent (Sonnet, Friday cron) analyses
[ niches ] status → 'go' | 'pivot' | 'kill'
   ↓ if GO: operator approves full build
[ Content Agent ] expands to 20-40 pages
[ niches ] status → 'building'
   ↓ Promotion Agent (Opus, nightly) checks gate
[ promotion_recommendations ] (table) — when gate passes
   ↓ Operator approves promotion
[ Cloudflare/TransIP registrar API ] — domain registered
[ Vercel Domains API ] — domain attached
[ DNS + SSL ] — auto-provisioned
[ 301 redirects ] — subfolder → new domain
[ tenants ] row updated, is_promoted=true
   ↓ Continues running on new domain
[ Orchestrator (Opus, weekly) ] reviews kill list, budget, alerts
```

Every step writes to Supabase. Every agent call writes an `agent_runs` row with cost, model, latency, success/failure, input hash, output hash.

---

## Database

Single Supabase Postgres database. Shared schema with `tenant_id` on every tenant-scoped table.

Tables in `docs/DATABASE_SCHEMA.sql`. Key ones:

- `tenants` — main domain + each sub-folder niche + each promoted-domain niche
- `niche_candidates` — raw output of Discovery agent
- `niche_scores` — output of Scoring agent
- `niches` — promoted-from-candidate niches with state machine
- `pages` — pages on any tenant, with approval state and AI-disclosure metadata
- `claims` — every factual claim on every page
- `claim_sources` — URL evidence for each claim
- `first_party_tests` — operator-logged hands-on tests
- `clicks` — affiliate-link clicks
- `conversions` — affiliate-network postback events
- `gsc_metrics` — daily Google Search Console pull per tenant
- `promotion_evaluations` — daily output of Promotion Agent (audit trail)
- `agent_runs` — every Claude call, cost, model, latency
- `affiliate_links` — generated tracked links per tenant per product
- `kills` — niche kill decisions with reason

RLS:

- Public reads on `pages` filter by `status='published'` AND tenant matches host.
- All writes go through service-role key on the agent plane or admin app server-side.
- No client-side writes for content; admin actions go through Next.js Route Handlers.

---

## State machines

### Niche state machine

```
candidate
  ↓ operator approves
approved_for_validation
  ↓ validation pipeline runs
validating
  ↓ Validation agent decides
  ├─ go → building
  ├─ pivot → approved_for_validation (with notes)
  └─ kill → killed (terminal)
building
  ↓ time + traffic accumulate
  ├─ promotion gate passes → mature
  └─ kill rule fires (6 mo, <€30/mo, <500 clicks/mo) → killed
mature
  ↓ Promotion agent recommends
  └─ operator approves → promoted (terminal-ish, may still be killed)
promoted
  ↓ post-promotion monitor
  └─ if revenue collapses for 3 months → archived
```

### Page state machine

```
draft (Content agent output, never user-visible)
  ↓ operator review
pending_review (in admin UI queue)
  ↓ operator clicks Approve
  ├─ approved → publish job
  └─ rejected → back to draft with notes
approved
  ↓ publish job
published (live, ISR regenerated)
  ↓
  ├─ operator edit → pending_review again
  ├─ scheduled retire → archived (301 to a related page)
  └─ kill of parent niche → archived
```

Both state machines enforced in DB triggers + app code. No state transitions in raw SQL except by Drizzle migration.

---

## Multi-tenancy in practice

### Per-tenant config

Stored in `tenants.config` JSONB column, validated by Zod on read. Fields:

- `brand.name` — display name
- `brand.logoUrl` — R2 URL
- `brand.primaryColor`, `brand.font` — design tokens
- `seo.titleTemplate` — `%page% | %brand%`
- `seo.defaultDescription`
- `locale.primary` — `nl-NL` or `nl-BE`
- `locale.alternates` — extra hreflang
- `analytics.plausibleDomain`
- `analytics.posthogProjectKey` (optional, otherwise rolls up to main)
- `affiliate.preferredNetworks` — order to display
- `affiliate.disclosureText.nl` / `.en`
- `consent.klaroConfig` — Klaro! manager config

### Shared layout, per-tenant overrides

`apps/web/app/sites/[tenant_slug]/layout.tsx` reads the tenant from middleware-injected context, sets brand CSS variables, injects favicon + manifest. Component tree below it is generic.

### When to split a tenant

Default: keep on the main domain as subfolder. Migrate to own domain only when:

- Promotion gate passes (all 7 criteria for 90 days)
- Operator explicitly approves

There is no auto-migration. There is no "this tenant looks important, let's pre-emptively give it a domain."

---

## Why subfolder-first (not subdomain)

Despite Google's official "subfolders and subdomains are treated the same" line (John Mueller, repeated in Search Central videos), the practitioner case-study record strongly favours subfolders for inheriting authority from the main domain. Until proven otherwise, this system uses subfolders to validate niches under the main domain's umbrella, then promotes to a separate full domain only when ready to stand alone.

The reasoning is documented for posterity in `docs/PROMOTION_GATE.md`.

---

## Caching strategy

- **ISR** on every public page. `revalidateTag('niche:[slug]')` is called when a page is republished.
- **Edge cache** for static assets (Vercel default).
- **Anthropic prompt cache** on every system prompt for repeated agent calls (rubric, brand voice, AI disclosure boilerplate).
- **Tenant lookup cache** in middleware via Vercel KV (1-minute TTL) — protects against hot-path database hits on every request.
- **GSC cache** — pull once per day per tenant; never per-request.

---

## Observability

- **Sentry** for errors. Per-tenant tag on every exception so a misbehaving tenant doesn't drown signal from others.
- **Plausible** for traffic. Per-tenant view; cookieless.
- **PostHog** (EU cloud) for funnel and cohort. Per-tenant `project_id` derived from `tenant_id`.
- **Custom dashboard** in admin UI: Claude spend MTD, cache hit ratio, batch discount earned, niche state counts, kill rate (rolling 12 months), promotion success rate.

---

## Failure modes and how we handle them

| Failure | Handling |
|---|---|
| Claude API outage | Agent run marked failed; retry with exponential backoff; if down >1h, Slack alert |
| Anthropic returns non-JSON | One retry with explicit error context; if still bad, fail the run, log full output for inspection |
| External API rate limit | Per-host token bucket in scrapers/lib; backoff; never retry tighter than the documented limit |
| Bol OAuth token expired | Refresh inline; if refresh fails, fail run + Slack alert (token must be regenerated in dashboard) |
| Cloudflare Registrar quota | Fall back to TransIP if TLD supports it; otherwise mark "manual registration required" |
| Vercel domain attach fails | Retry up to 3 times with 30s spacing; on hard fail, notify operator, leave niche in pending state |
| Supabase outage | Web plane degrades to cached responses; agent plane pauses |
| Hetzner machine down | Vercel-side admin UI still works; agents pause; alert |
| Budget exceeded mid-month | Agents pause; admin still works; operator unblocks via env raise or new month |

---

## Local development

```bash
# Required: pnpm 9+, Node 22+, Supabase CLI
pnpm install
supabase start                    # local Postgres
cp .env.example .env.local        # fill in
pnpm db:migrate                   # apply migrations to local
pnpm db:seed                      # seed main tenant + admin
pnpm dev                          # Next.js on :3000
pnpm scrapers:dev                 # agents in watch mode
```

To simulate multi-tenant locally, edit `/etc/hosts`:

```
127.0.0.1   expertgids.local
127.0.0.1   koffie-expert.local
```

…and `NEXT_PUBLIC_APP_URL=http://expertgids.local:3000` in `.env.local`.

---

## Deployment

- `main` branch → Vercel production deploy
- PR branches → Vercel preview deploy (unique URL per PR)
- DB migrations → GitHub Action on push to `main` runs `pnpm db:migrate:prod`
- Agent code → GitHub Action on push to `main` SSH-deploys to Hetzner, restarts systemd units
- Secrets — Vercel env (web) + `/etc/nichefinder/env` on Hetzner (agents), rotated quarterly

Rollback: redeploy previous Vercel build (one-click); for DB, restore from Supabase snapshot.

---

## Next reading

- `docs/PHASE_PLAN.md` — what to build first, second, third
- `docs/AGENT_PROMPTS.md` — exact prompts
- `docs/DATABASE_SCHEMA.sql` — migration 0001
- `docs/DATA_SOURCES.md` — API integrations
