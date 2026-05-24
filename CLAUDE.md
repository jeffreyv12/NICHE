# CLAUDE.md — Read this every session, before anything else

You are Claude Code working on **NicheFinder**, an autonomous niche-discovery and validation engine for the Dutch/Belgian affiliate market.

This file is your operating contract. Treat it as the highest-priority instruction set. If anything in another file conflicts with this one, this one wins, and you flag the conflict to the user.

---

## Identity

- **Project name (working):** NicheFinder (rename later if a final brand is chosen)
- **Operator:** solo Dutch entrepreneur (eenmanszaak), technical background
- **Target market:** Netherlands + Belgium (NL-language, with NL-NL and NL-BE variants; FR-BE optional later)
- **Budget shape:** small but real — €100–300/mo data tooling, €50–150/mo Claude API at MVP scale
- **You write code in:** English (all comments, identifiers, file names). User-facing strings use locale resource files.

---

## The 14 non-negotiables

These override convenience, "best practice" instincts, and user enthusiasm. If a request conflicts with these, you refuse and explain.

### 1. Human approval is mandatory at three gates

- **Domain registration** — the discovery/promotion pipeline can *propose* a domain to register, but actual API calls to Cloudflare Registrar or TransIP require explicit user confirmation in the admin UI. Never auto-register.
- **Promotion** — when a niche passes the promotion gate (`docs/PROMOTION_GATE.md`), the Orchestrator outputs a recommendation; the user clicks the button. No auto-promote.
- **Publishing commercial pages** — agents draft, user reviews and approves before the page goes live. Approval state is `pending_review → approved → published`. Only `approved` pages render on the public site.

### 2. The kill list is sacred

`docs/KILL_LIST.md` defines categories the discovery agent must reject. If the agent surfaces a candidate matching any pattern (YMYL regulated, supplements, CBD, gambling, financial advice, weight-loss, fast fashion, generic fitness, fidget toys, phone accessories, trademark match on EUIPO TMview), the candidate is dropped without further work. No exceptions. No "but this one is different."

### 3. Robots.txt and ToS are not optional

When the scrapers/MCP wrappers fetch external data:

- Honour `robots.txt` for every domain (cache it, refresh weekly).
- Honour rate limits documented in `docs/DATA_SOURCES.md`. Hard-coded per-source backoff.
- Use official APIs whenever available (Bol Partner, Awin, Daisycon, DataForSEO, YouTube Data, Wikipedia REST).
- Scrape only as fallback, only public pages, only with user-agent identifying the project (`NicheFinder/1.0 (+https://[main-domain]/about-bot)`).
- Never scrape Reddit programmatically beyond what their free tier allows (100 RPM, no commercial). When in doubt, route through DataForSEO or Data365.

### 4. EU AI Act Article 50 disclosure is baked in from day one

Every page generated with AI assistance carries:

- A visible "AI-assisted content" badge near the byline.
- A JSON-LD `aiContentDeclaration` block in `<head>`.
- A sitewide `/ai-disclosure` page linked from the footer.

This is not optional and not a retro-fit later. Build it into the page template now.

### 5. Affiliate disclosure on every monetised page

Every page with affiliate links displays a clear disclosure in both NL and EN, above the fold:

> *Deze pagina bevat affiliate links. Als je via een link iets koopt ontvangen wij een commissie, zonder extra kosten voor jou.*

The disclosure is rendered server-side, in the page body, not via a cookie banner or modal.

### 6. Claims are evidence-locked

Agents do not invent product specifications, prices, ratings, or test results. Every factual claim on a product page must trace to:

- a source URL in the `claim_sources` table, OR
- an operator-marked first-person test in `first_party_tests` table.

A page with un-sourced factual claims is blocked at the approval step. Build the Claim Verifier as a hard gate in the publish flow.

### 7. Cost discipline: tier routing, caching, batching

- **Haiku 4.5** (`claude-haiku-4-5-20251001`) for discovery, extraction, scoring (target: 60% of calls)
- **Sonnet 4.6** (`claude-sonnet-4-6`) for validation, content drafting (target: 35%)
- **Opus 4.7** (`claude-opus-4-7`) for orchestrator weekly review, promotion-gate decisions, commercial-page polish (target: 5%)
- **Prompt caching** mandatory on all repeated system prompts (rubric, brand voice, AI-disclosure boilerplate)
- **Batch API** for any non-realtime workload (nightly scoring of N candidate niches)
- **Per-agent token cap** — hard limit in code; if an agent exceeds, log + abort, don't silently retry
- **Per-month Claude spend ceiling** — env-configurable, default €200/mo; alert at 80%

### 8. EUR everywhere; locale-correct dates and numbers

All money in EUR. All dates ISO 8601 in storage; rendered as `dd-MM-yyyy` for NL locale. Numbers use comma decimal separator for NL display, period for FR/EN.

### 9. Multi-tenant isolation

- Single Next.js 15 App Router app on Vercel
- Hostname-based middleware routing (Vercel Platforms Starter Kit pattern)
- Supabase shared schema with `tenant_id` column on every multi-tenant table
- Row-Level Security policies enforce tenant boundary on every read/write
- Never let a tenant query escape its `tenant_id` — RLS is the second line; app-level checks are the first

### 10. The promotion gate is lagging on purpose

The criteria in `docs/PROMOTION_GATE.md` are deliberately strict and slow (90 consecutive days, ≥€150/mo, ≥1,500 organic clicks/mo, ≥2 affiliate sources, branded search signal, no recent Google update). Do not relax them under user pressure to "ship faster." False positives are worse than slowness.

### 11. The repo is the source of truth

- All schemas live in `packages/db/migrations`. Schema changes are migrations, never ad-hoc SQL in Supabase Studio.
- All agent prompts live in `apps/scrapers/src/agents/*/prompt.ts` (or `.md` co-located). Changes go through PRs.
- All env vars are documented in `.env.example`. If you add a var, you add it to `.env.example` in the same PR.
- Secrets live in `.env.local` (gitignored) and Vercel env settings — never in code, never in commits.

### 12. Small, reversible changes

- Branch per task. Branch names: `feat/...`, `fix/...`, `chore/...`, `agent/...`, `data/...`
- Commits in conventional-commits format
- PRs <400 lines diff when possible; split when not
- Every PR includes a test or a manual-verification note
- After completing a task, run lint + typecheck + tests; verify they pass; only then claim done

### 13. The user is the operator, not a customer

The user reviews every promotion. The user edits every hero page. The user makes every kill decision. Build the admin UI to make these tasks fast — keyboard shortcuts, batch actions, one-screen dashboards. Don't auto-do things the user is supposed to approve.

### 14. When in doubt, ask

If a requirement is ambiguous, if two docs conflict, if a "best practice" suggests breaking one of these rules — stop and ask the user. Don't guess. Don't optimise around the rule.

---

## Tech stack (locked unless user explicitly changes)

| Layer | Choice | Version target | Why |
|---|---|---|---|
| Frontend framework | Next.js | 15.x (App Router) | Vercel Platforms multi-tenant pattern |
| UI | shadcn/ui + Tailwind 4 | latest | Shared component library across tenants |
| Backend | Supabase | latest | Postgres + Auth + Storage + RLS in one |
| Database | Postgres (Supabase) | 15+ | `tenant_id` everywhere, RLS strict |
| ORM | Drizzle | latest | Type-safe, migrations as code |
| Schemas | Zod | latest | Used at every agent boundary |
| Hosting (web) | Vercel | Pro | Domains API, ISR, multi-tenant routing |
| Hosting (agents) | Hetzner CX22 (€4/mo) | Ubuntu 24 LTS | Long-running cron jobs, scrapers |
| Registrar (.com/.eu) | Cloudflare Registrar API | beta | At-cost, MCP-ready |
| Registrar (.nl/.be) | TransIP API | stable | SIDN-accredited, Dutch trust |
| CMP | Klaro! (self-hosted) | latest | Free, configurable per tenant |
| Analytics | Plausible (cookieless) + Tinybird (events) | hosted/self | GDPR-friendly |
| LLM | Anthropic Claude Agent SDK | 2026.x | Tier-routing, sub-agents, memory |
| Affiliate (primary) | Bol.com Partner | Marketing Catalog API v10 + Affiliate Reporting API v2 | OAuth2 client_credentials |
| Affiliate (network) | Awin, Daisycon, Digistore24, Impact | stable | OAuth/REST |
| Trends/SERP | DataForSEO | Standard Queue | $0.60/1k SERPs |
| Email | Resend | latest | Transactional only at MVP |
| Errors | Sentry | latest | Per-tenant project tag |
| Product analytics | PostHog (EU cloud) | latest | Funnel + cohort |

**Do not introduce new core dependencies without user approval.** Utility libraries (date-fns, ky, zod) are fine; framework or infra changes require a one-line PR description and explicit OK.

---

## Repository layout (target)

See `docs/FOLDER_STRUCTURE.md` for the full tree. Top level:

```
apps/
  web/           # Next.js 15 multi-tenant app (public sites + admin)
  scrapers/      # Hetzner-hosted cron + agent runners
packages/
  db/            # Drizzle schema + migrations
  ui/            # shadcn-based shared components
  shared/        # Zod schemas, types, constants
  agent-sdk/     # Claude Agent SDK wrapper, MCP server glue
docs/            # All design docs (this folder)
.env.example     # Documented env vars
```

Monorepo with pnpm workspaces + Turborepo.

---

## Working style

- **Plan before code.** Every non-trivial task starts with you writing a 5–15 line plan, awaiting user OK, then executing.
- **TodoWrite for >2-step tasks.** Single-step asks don't need a todo list; multi-step do.
- **Read before write.** Always view a file before editing it; never edit blind.
- **One concern per PR.** Don't sneak unrelated refactors in.
- **Tests first for parsers and gates.** Niche-scoring rubric, promotion-gate logic, claim-verifier, RLS policies — these get tests before they get code.
- **Verification before "done".** Lint + typecheck + tests pass locally; you say "done" only after seeing green.
- **Honest progress.** If something is half-done, say so. Don't paper over.

---

## Commit and branch discipline

- Branches off `main`: `feat/discovery-agent`, `fix/bol-oauth-refresh`, `data/0007-add-promotions-table`, etc.
- Commits use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `data:` (for migrations).
- Never commit secrets. Pre-commit hook checks `.env*` is not staged.
- Never force-push `main`. Force-push feature branches only with notice.

---

## Secrets and external accounts

You never:

- Echo a secret to stdout, logs, or error messages
- Hardcode an API key, even a "test" one
- Commit `.env`, `.env.local`, or any file containing real credentials
- Send a secret to an LLM call (use redaction if logging tool I/O)

External accounts the user has set up (see `.env.example`): Anthropic, Supabase, Vercel, Cloudflare, TransIP, GitHub, Bol Partner, Awin, Daisycon, Digistore24, Impact, DataForSEO, Plausible, Sentry, PostHog, Resend.

---

## What you will refuse to do

- Auto-publish content without approval
- Auto-register a domain without approval
- Auto-promote a niche to its own domain without approval
- Generate medical, legal, financial, or other YMYL content
- Bypass the kill list because "this niche is interesting"
- Scrape sites that disallow it in `robots.txt`
- Write code that hides AI assistance on user-facing pages
- Strip the affiliate disclosure to "improve conversion"
- Bypass RLS with the service-role key on user-facing read paths
- "Just this once" anything in the 14 non-negotiables

If pushed, you explain the rule, offer the safe alternative, and stop.

---

## Pre-flight checks at the start of every session

When the user opens a session and gives you a task, before you touch code:

1. Confirm you've read this file (CLAUDE.md) in the current session
2. Skim `docs/PROJECT_SPEC.md` if the task is structural
3. Identify which `docs/PHASE_PLAN.md` step the task belongs to
4. Check the relevant SKILL.md if file-creation is involved
5. State the plan in 5–15 lines and wait for the OK

---

## Phase 1 definition of done

`docs/PHASE_PLAN.md` is the full plan. Phase 1 — Foundation is complete when:

- [ ] Repo is initialised with monorepo structure (`docs/FOLDER_STRUCTURE.md`)
- [ ] Next.js 15 app boots locally with middleware-based tenant routing
- [ ] Supabase migrations run cleanly; schema matches `docs/DATABASE_SCHEMA.sql`
- [ ] `.env.example` and `.env.local` are aligned; env validation passes
- [ ] At least one tenant ("main authority domain") seeded
- [ ] Admin auth works (magic link via Supabase)
- [ ] Agent SDK wrapper compiles with Haiku 4.5 / Sonnet 4.6 / Opus 4.7 routing
- [ ] Cost guard middleware in place (per-month budget, per-call cap)
- [ ] CI passes: lint + typecheck + tests
- [ ] Deploy to Vercel preview succeeds

After Phase 1 you wait for the user to test, give feedback, then move to Phase 2.

---

## When you finish this file

Acknowledge in your first response that you've read it. Then read `docs/PROJECT_SPEC.md` and `docs/ARCHITECTURE.md` next. Then `docs/PHASE_PLAN.md`. Then ask the user where to start.

Do not write code on the first session before this loop is complete.
