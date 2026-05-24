# Project Specification — NicheFinder

> Read this after `CLAUDE.md`, before anything else.

---

## What we're building

An autonomous engine that **discovers, scores, validates, builds, promotes, and kills affiliate niches** in the Dutch/Belgian market — with a single operator (you, the user) in the loop only at the approval gates.

It is not "an affiliate website." It is a *pipeline* of agents and infrastructure that produces niches as outputs. Each niche starts life as a subfolder of one main authority domain (e.g. `expertgids.nl/koffie`). The pipeline measures its real-world performance for at least 90 days. If it passes a strict gate, the system spins up a dedicated domain (e.g. `koffie-expert.nl`) and migrates the content. If it fails by month 6, it gets archived and redirected.

The system runs on Claude Agent SDK with tier-routed models (Haiku 4.5 / Sonnet 4.6 / Opus 4.7) and is hosted on Vercel (web) + Hetzner (long-running agents) + Supabase (data).

---

## Goals

**Primary goals:**

1. Produce 1 validated niche every 4–6 weeks (operator-time-limited, not engine-time-limited).
2. Achieve ≥30% niche survival rate to month 6 (against industry baseline of 30–50%).
3. Hit one promoted niche (own domain, ≥€150/mo net affiliate revenue, 90-day sustained) within 9 months of operation.
4. Stay inside €300/mo all-in operating cost during pre-revenue phases.
5. Build a portfolio that — at maturity — could exit via Empire Flippers at the current 25–34× monthly multiple range, OR provide €2,000–€5,000/mo of stable affiliate income.

**Secondary goals:**

6. The agent pipeline is *the* product. Even if a particular niche fails, the engine improves with every cycle.
7. Operator time spent on a niche should decline by 50% from first niche to fifth (compounding playbooks).
8. Every page on every tenant complies with EU AI Act Article 50 (effective August 2026) from day one.

---

## Non-goals

These are out of scope for v1. They may become Phase 2+ work. **Claude Code does not implement these:**

- Mobile app
- Newsletter / email marketing automation beyond transactional
- Paid-ads campaigns automation (operator runs validation traffic manually)
- A user-facing SaaS where third parties pay to use the engine
- Dropshipping or first-party e-commerce
- Multilingual beyond NL (NL-NL + NL-BE). FR-BE optional in Phase 7+.
- A public-facing API for the engine itself
- Custom CMS — content lives in the database and is rendered by Next.js; no rich-text editor more elaborate than what's needed
- Real-time chat with site visitors
- A/B testing framework (use existing tools when needed)
- A "discovery marketplace" or social features

---

## Anti-goals

These are things the system is **deliberately built to prevent**:

- **Auto-publishing AI content** — every commercial page is human-approved.
- **Auto-registering domains** — every domain registration requires explicit operator confirmation.
- **Promoting on false positives** — the gate is intentionally slow and strict; a viral 24-hour spike does not promote anything.
- **Scaling niche count over niche quality** — the operator should never have 20+ active subfolders if the kill rate suggests they can't maintain them.
- **Bypassing the kill list** — even if an agent argues a forbidden niche is "different," the kill list overrides.
- **Hiding AI assistance** — full disclosure on every page, sitewide AI-disclosure page, JSON-LD declaration.
- **Producing thin/templated content** — the Helpful Content System killed this model; the engine refuses to publish pages without sourced claims, original images (or operator-approved stock), and a named author.

---

## System architecture (high level)

```
┌──────────────────────────────────────────────────────────────────────┐
│                         OPERATOR (you)                                │
│  approves promotions, edits hero pages, makes kill decisions          │
└────────────────────────────────┬─────────────────────────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────┐
              │         ADMIN UI (Next.js)        │
              │  /admin on main authority domain  │
              └────────┬─────────────────┬───────┘
                       │                 │
                       ▼                 ▼
        ┌──────────────────────┐  ┌──────────────────┐
        │   SUPABASE (Postgres) │  │  CLAUDE AGENTS   │
        │   - tenants           │  │   (Hetzner cron) │
        │   - niche candidates  │◀─┤                  │
        │   - scores            │  │  Orchestrator    │
        │   - test pages        │  │       │          │
        │   - approvals         │  │   ┌───┴────┐     │
        │   - claims + sources  │  │   ▼        ▼     │
        │   - first-party tests │  │ Discovery  ...   │
        │   - agent runs        │  │ Scoring          │
        │   - cost ledger       │  │ Validation       │
        └──────────┬───────────┘  │ Content          │
                   │              │ Promotion        │
                   │              └────────┬─────────┘
                   │                       │
                   ▼                       ▼
        ┌─────────────────┐    ┌──────────────────────┐
        │  PUBLIC WEB     │    │  EXTERNAL APIs       │
        │  (Vercel)       │    │  - DataForSEO        │
        │                 │    │  - Bol Partner       │
        │  main domain    │    │  - Awin/Daisycon     │
        │  + N subfolders │    │  - Digistore/Impact  │
        │  + M promoted   │    │  - YouTube/Wiki      │
        │    domains      │    │  - Cloudflare/TransIP│
        └─────────────────┘    │  - Vercel Domains    │
                               │  - GSC / Plausible   │
                               └──────────────────────┘
```

See `docs/ARCHITECTURE.md` for the detailed diagram, data flow, and component breakdown.

---

## Data flow — what happens in a week

A typical week of the engine running:

1. **Sun 02:00 NL — Discovery batch.** Discovery Agent (Haiku 4.5, Batch API) scans configured data sources for candidate niches: Bol Partner search-trend export, DataForSEO related-keywords, YouTube trending tags, Wikipedia pageview deltas, EUIPO TMview cross-check. Writes ~50–200 candidates to `niche_candidates`.
2. **Sun 03:30 — Scoring batch.** Scoring Agent (Haiku 4.5 → Sonnet 4.6 escalation, Batch API) computes the weighted score for each new candidate per the rubric in `docs/NICHE_SCORING_RUBRIC.md`. Borderline candidates (score 55–70) re-scored by Sonnet for a second opinion.
3. **Mon 09:00 — Operator triage.** Admin UI shows the top 20 candidates ranked by score, with the rubric breakdown, kill-list cross-check, and a "promote to validation" button. Operator approves 1–3 to enter validation.
4. **Mon–Fri — Validation in progress.** For each approved candidate, the Validation Agent (Sonnet 4.6) coordinates: Content Agent drafts 3–5 test pages, operator reviews and edits, page is published under `[main-domain]/test/[niche-slug]/...`. Tracking SubIDs are wired through Bol/Awin/Daisycon. Operator runs €30–60 paid traffic test via Google Ads + Pinterest.
5. **Fri 18:00 — Validation review.** Validation Agent reports: clicks, affiliate clicks, conversions, signup rate, time-on-page. Decision rule from `docs/PROMOTION_GATE.md` applied. Outputs: GO (move to full build), PIVOT (try different angle), KILL (archive).
6. **Sun 04:00 — Promotion-gate evaluation.** For every niche currently in "Build" or "Mature" state, the Orchestrator (Opus 4.7) checks the promotion gate criteria (90-day rolling window). If a niche passes, it appears in the admin UI as "ready to promote" with the full recommendation. **No auto-promote.**
7. **Sun 04:30 — Kill-list sweep.** For every niche in any state, check kill criteria. If a niche has been in "Build" for >180 days with <€30/mo revenue and <500 organic clicks/mo, flag for kill. Operator confirms.
8. **Continuously — Content drafts.** Content Agent runs on-demand when operator selects a niche and a target keyword cluster. Outputs a draft + claim-source bundle + AI-disclosure metadata.

---

## Technology decisions

| Concern | Choice | Reason |
|---|---|---|
| Web framework | Next.js 15 (App Router) | Multi-tenant via middleware, ISR per tenant, Vercel native |
| UI | shadcn/ui + Tailwind 4 | Owned components, no per-tenant license, easy to fork per brand |
| Database | Supabase Postgres + RLS | Auth + Storage + RLS in one product; strong NL/EU data residency (Frankfurt) |
| ORM | Drizzle | Type-safe, migrations as TS, plays well with Supabase |
| Validation | Zod | Used at every agent boundary, env validation, request validation |
| Hosting (web) | Vercel Pro | Domains API, multi-tenant proven pattern, EU regions |
| Hosting (agents) | Hetzner CX22 (€4/mo) | Long-running cron, scrapers, agent runners; cheap; EU |
| LLM | Anthropic Claude Agent SDK | Tier-routing, sub-agents, memory, caching, batch |
| Primary affiliate | Bol.com Partner | Largest NL marketplace; proper API; 2.5–7% commission |
| Trend / SERP data | DataForSEO Standard Queue | $0.60/1k SERPs; no subscription; community MCP |
| Registrar (.com/.eu) | Cloudflare Registrar API | At-cost, MCP-ready, beta but stable enough |
| Registrar (.nl/.be) | TransIP API | SIDN-accredited; Dutch trust |
| CMP (cookies) | Klaro! (self-hosted) | Free, configurable per tenant, no per-domain SaaS fee |
| Analytics | Plausible + PostHog | Cookieless; GDPR-friendly; per-niche funnel |
| Email | Resend | Transactional only at MVP |
| Errors | Sentry | Per-tenant tags |
| Image hosting | Cloudflare R2 | Cheap egress, S3 API |

**Locked unless explicit user change.** Adding a new core dependency requires explicit user approval. Utility libs (date-fns, ky, zod-validation-error, etc.) are fine.

---

## The six agents

Full prompts in `docs/AGENT_PROMPTS.md`. Summary:

| Agent | Model | Schedule | Purpose |
|---|---|---|---|
| **Discovery** | Haiku 4.5 (Batch) | Nightly Sun 02:00 | Scan data sources, surface 50–200 candidate niches |
| **Scoring** | Haiku 4.5 → Sonnet 4.6 escalation | Nightly Sun 03:30 | Apply weighted rubric, output 0–100 scores with breakdown |
| **Validation** | Sonnet 4.6 | On-demand + Fri 18:00 review | Coordinate test pages, analyse traffic test, decide GO/PIVOT/KILL |
| **Content** | Sonnet 4.6 draft + Opus 4.7 polish | On-demand | Draft pages with sourced claims, AI-disclosure, ready for operator edit |
| **Promotion** | Opus 4.7 | Nightly Sun 04:00 | Evaluate promotion gate, generate recommendation (never auto-act) |
| **Orchestrator** | Opus 4.7 | Weekly Mon 06:00 | Cross-niche review, kill-list sweep, cost telemetry, alerts |

Cost discipline: prompt caching on shared system prompts (rubric, brand voice, EU AI disclosure boilerplate), Batch API for nightly scoring, per-call token caps, per-month budget alert at 80%.

---

## Security & compliance

- **RLS-first.** Every multi-tenant table has `tenant_id` and an RLS policy. Service-role key is server-side only, never in client bundles.
- **Magic-link admin auth.** No passwords for the admin UI. Allowed email list in env.
- **Secrets in Vercel env + .env.local** (gitignored). Pre-commit hook checks staging.
- **EU AI Act Article 50 compliance from day one** — visible AI-assistance badge, JSON-LD `aiContentDeclaration`, sitewide `/ai-disclosure` page.
- **Affiliate disclosure server-rendered above the fold** on every monetised page (NL + EN).
- **GDPR**: Klaro! CMP, Plausible cookieless analytics, PostHog with EU-only data residency, DPA with Anthropic and Supabase, retention policy in `docs/LEGAL_COMPLIANCE_NL.md`.
- **No PII to LLM**. Email addresses, names, financial data redacted before any agent call.
- **Robots.txt compliance** in all scrapers. User-Agent identifies the project. Per-host RPS limit.
- **KvK as eenmanszaak.** No BV for v1; revisit when consistent €5k+/mo for 12 months.
- **DAC7**: as a pure affiliate publisher (referrer, not platform operator), likely out of scope. Operator confirms with adviser.

---

## Observability and KPIs

Per-niche metrics tracked in Supabase, surfaced in admin dashboard:

- Organic clicks (GSC, daily roll-up)
- Affiliate clicks per source (Bol/Awin/Daisycon/Digistore/Impact)
- Affiliate conversions and revenue per source
- Branded search volume (GSC, "[niche] [brand]" type queries)
- Average time on page, scroll depth (Plausible/Tinybird)
- Page count by approval state
- Last operator-edit date per hero page
- Claim coverage (% of factual claims with sources)

Engine-wide metrics:

- Claude API spend MTD vs. budget
- Per-agent call count, latency, success rate
- Cache hit ratio
- Batch API discount earned
- Number of niches in each state (Candidate / Validating / Building / Mature / Promoted / Killed)
- Niche kill rate (rolling 12 months)
- Promotion success rate

---

## Deployment

| Layer | How | Notes |
|---|---|---|
| Web (Next.js) | Vercel via GitHub | `main` → production, PR → preview |
| Database migrations | Drizzle CLI + Supabase Postgres | `pnpm db:migrate` locally, GitHub Action on `main` |
| Agents (Hetzner) | systemd + node | `pnpm scrapers:deploy` provisions, then systemd timers |
| Cron schedules | systemd timers (preferred) or Vercel Cron (fallback for short jobs) | Long agent runs always Hetzner |
| Secrets | Vercel env + Hetzner `/etc/nichefinder/env` | rotated quarterly |
| Backups | Supabase nightly snapshots + weekly export to R2 | 30-day retention |

---

## Glossary

- **Tenant** — a niche, either still on a subfolder of the main domain or promoted to its own domain. Each tenant has a `tenant_id`, hostname or path-prefix, brand config, and isolated data via RLS.
- **Niche candidate** — a topic surfaced by Discovery, not yet validated.
- **Validating** — a candidate that has test pages live and is accumulating real traffic and conversion data.
- **Building** — a validated niche being expanded with full content. Lives on the main domain subfolder.
- **Mature** — a niche on the main domain that has hit 60+ days of consistent revenue but hasn't fully passed the promotion gate yet.
- **Promoted** — a niche that has been migrated to its own dedicated domain.
- **Killed** — a niche that failed the kill-list check at month 6.
- **Hero page** — a top-of-funnel commercial page (e.g. "Beste [product] 2026"). Always operator-edited.
- **Claim** — a factual statement on a page (price, spec, rating, test result). Every claim must have a source URL or first-party test reference.
- **Promotion gate** — the strict 7-criterion check that fires before a niche can be recommended for promotion. See `docs/PROMOTION_GATE.md`.
- **Kill list** — the hard-coded set of forbidden niche categories (YMYL regulated, supplements, gambling, weight-loss, etc.). See `docs/KILL_LIST.md`.

---

## What's next

- `docs/ARCHITECTURE.md` — multi-tenant routing, agent runtime, data flow
- `docs/PHASE_PLAN.md` — the step-based build plan
- `docs/AGENT_PROMPTS.md` — canonical system prompts you can paste into Console
- `docs/NICHE_SCORING_RUBRIC.md` — the methodology
- `docs/PROMOTION_GATE.md` — the criteria
- `docs/DATA_SOURCES.md` — API integration details
- `docs/DATABASE_SCHEMA.sql` — the schema
- `docs/LEGAL_COMPLIANCE_NL.md` — KvK, BTW, AI Act, DAC7
- `docs/KILL_LIST.md` — forbidden niches
- `docs/FOLDER_STRUCTURE.md` — monorepo layout
