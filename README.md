# NicheFinder

Autonomous niche-discovery and validation engine for the Dutch/Belgian affiliate market.

> This is a working codename. Pick a real brand later, after the first niche validates.

---

## What it does

A pipeline that:

1. **Scans** DataForSEO, Bol.com Partner, Awin, Daisycon, YouTube, Wikipedia for candidate niches in NL/BE
2. **Scores** each candidate against a weighted rubric (affiliate availability, intent volume, KGR, AI-saturation, trend slope, YMYL risk, etc.)
3. **Validates** the top candidates by spinning up test pages on subfolders of a main authority domain, driving small paid traffic, and measuring real affiliate conversions
4. **Builds out** validated niches with human-edited content, original photography, first-person testing
5. **Promotes** winners to their own dedicated domain only when they hit objective gates (≥€150/mo net affiliate revenue + ≥1,500 organic clicks/mo + ≥2 affiliate sources + branded search signal, sustained for 90 consecutive days)
6. **Kills** losers at month 6 if they haven't shown traction — archives the content, redirects to a related sub-section

The whole thing is driven by Claude agents (Haiku 4.5 / Sonnet 4.6 / Opus 4.7) running on a tier-routed cost discipline.

---

## Project status

- [ ] **Phase 0** — Operator sprint zero (KvK, banking, affiliate apps, accounts, main domain registered)
- [ ] **Phase 1** — Foundation (repo, Next.js 15 multi-tenant, Supabase schema, Agent SDK wrapper, admin auth)
- [ ] **Phase 2** — Discovery & Scoring agents (DataForSEO, Bol, Awin, Daisycon MCPs; nightly scoring batch)
- [ ] **Phase 3** — Validation pipeline (test-page generator, paid-traffic tracking, decision agent)
- [ ] **Phase 4** — Content engine (Sonnet drafts + Opus polish + Claim Verifier + AI disclosure)
- [ ] **Phase 5** — Promotion automation (Cloudflare + TransIP registrar APIs, Vercel Domains API, 301 migration)
- [ ] **Phase 6** — Orchestrator weekly review, kill-list automation, cost telemetry, MVP launch

See `docs/PHASE_PLAN.md` for the detailed step-by-step plan.

---

## Read these in order

1. `CLAUDE.md` — operating contract for Claude Code (must be read every session)
2. `docs/PROJECT_SPEC.md` — what we're building and why
3. `docs/ARCHITECTURE.md` — multi-tenant + multi-agent design
4. `docs/PHASE_PLAN.md` — the step plan
5. `docs/NICHE_SCORING_RUBRIC.md` — the core methodology
6. `docs/PROMOTION_GATE.md` — when a niche graduates
7. `docs/AGENT_PROMPTS.md` — canonical system prompts
8. `docs/DATA_SOURCES.md` — API integrations and quirks
9. `docs/DATABASE_SCHEMA.sql` — Supabase migration 0001
10. `docs/LEGAL_COMPLIANCE_NL.md` — KvK, BTW, EU AI Act, DAC7
11. `docs/KILL_LIST.md` — forbidden niches
12. `docs/FOLDER_STRUCTURE.md` — monorepo layout

---

## Quick start (after Phase 1 is built)

```bash
pnpm install
cp .env.example .env.local        # fill in real values
pnpm db:migrate                   # apply Supabase migrations
pnpm db:seed                      # seed main tenant + admin user
pnpm dev                          # run web app
# in a second terminal:
pnpm scrapers:dev                 # run agents locally
```

---

## Cost targets (verify against actual)

| Layer | Monthly target | Notes |
|---|---|---|
| Vercel Pro | $20 | 1 seat, multi-tenant app |
| Supabase Pro | $25 | EU Frankfurt region |
| Hetzner CX22 | €4 | Scrapers + cron |
| Cloudflare | €0 | At-cost registrar + DNS |
| TransIP | €1–2 | Prorated .nl/.be renewals |
| DataForSEO | €50 | ~80k SERPs/mo Standard Queue |
| Anthropic Claude API | €70–150 | Tier-routed + cached + batched |
| Resend | €0 (free tier) | Transactional email |
| Plausible | €9–19 | Cookieless analytics |
| Sentry | €0 (developer tier) | Errors |
| PostHog | €0 (free tier) | Product analytics |
| **Total** | **€180–230/mo** | At one-validated-niche-per-month cadence |

Plus per-niche validation paid traffic (€30–80/test) — operator pays out of revenue when possible.

---

## License

Private. All rights reserved by the operator until further notice.
