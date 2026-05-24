# HANDOVER README — Read this first (you, the human)

This package is the **first input you give to Claude Code** to start the autonomous niche-discovery and validation engine project.

You are **not** Claude Code right now. This file is for you, the human operator. Once you've read it, you delete this file before handing the rest to Claude Code.

---

## What this project is

A system that **autonomously discovers, scores, validates, and promotes affiliate niches** in the Dutch/Belgian market.

Not "an affiliate site for one niche." A **pipeline** that finds niches for you, tests them on subfolders of one main domain, kills the losers, and graduates the winners to their own dedicated domain when they hit objective revenue and traffic thresholds.

The core components:

1. **Discovery Agent** — scans DataForSEO, Bol.com Partner, Awin, Daisycon, YouTube, Wikipedia for candidate niches
2. **Scoring Agent** — applies a weighted rubric to rank candidates
3. **Validation Agent** — spins up test pages, drives small paid traffic, measures real conversions
4. **Content Agent** — drafts pages with human-in-the-loop editing
5. **Promotion Agent** — fires only when a niche passes the gate (≥€150/mo + 1,500 organic clicks/mo + branded search + ≥2 affiliate sources, 90 consecutive days)
6. **Orchestrator** — Opus 4.7, weekly review, kill/keep/promote decisions

The architecture is **hybrid multi-tenant**: all niches start as subfolders of one main authority domain. Only validated winners graduate to their own domain via automated registration (Cloudflare API for .com/.eu, TransIP API for .nl/.be).

---

## What's in this package

```
nichefinder-handover/
├── HANDOVER_README.md           ← this file, you delete it before handing off
├── CLAUDE.md                    ← first thing Claude Code reads, every session
├── README.md                    ← project overview
├── .env.example                 ← every env var documented
└── docs/
    ├── PROJECT_SPEC.md          ← what we're building and why
    ├── ARCHITECTURE.md          ← multi-tenant + multi-agent design
    ├── DATABASE_SCHEMA.sql      ← Supabase migration 0001
    ├── AGENT_PROMPTS.md         ← canonical system prompts for all 6 agents
    ├── NICHE_SCORING_RUBRIC.md  ← the weighted scoring methodology
    ├── PROMOTION_GATE.md        ← objective criteria for graduating a niche
    ├── DATA_SOURCES.md          ← all API integrations and their quirks
    ├── PHASE_PLAN.md            ← step-based build plan (no timeline)
    ├── LEGAL_COMPLIANCE_NL.md   ← KvK, BTW, EU AI Act Art. 50, DAC7
    ├── KILL_LIST.md             ← niches the discovery agent must reject
    └── FOLDER_STRUCTURE.md      ← monorepo layout
```

---

## Order of operations — what you do before Claude Code touches code

### 1. Read everything in order

1. This file (you're doing it now)
2. `README.md` — orientation
3. `docs/PROJECT_SPEC.md` — the what
4. `docs/ARCHITECTURE.md` — the how
5. `docs/PHASE_PLAN.md` — the steps
6. The rest as you need them

You should be able to summarise the project back to yourself in 5 sentences before Claude Code starts coding. If you can't, re-read.

### 2. Complete the sprint-zero work (no code yet)

These cannot be done by Claude Code. They are blockers for everything else.

- [ ] **KvK registration** — eenmanszaak with SBI codes 63.12 (Webportalen), 73.11 (Reclamebureaus), 58.19 (Overige uitgeverijen). One-time ~€80. See `docs/LEGAL_COMPLIANCE_NL.md`.
- [ ] **Business banking** — Bunq Business (~€10/mo) or Wise Business. KvK number required.
- [ ] **Affiliate network applications** — Bol.com Partner, Awin (€1 refundable deposit), Daisycon, Digistore24, Impact.com. Each takes 1–5 days to approve. Do all in parallel.
- [ ] **Anthropic API account** — add €50 credit minimum. Generate API key, store securely.
- [ ] **Supabase project** — create new project on Pro tier ($25/mo) for region `eu-central-1` (Frankfurt) — closest to NL/BE users. Save URL + service_role key + anon key.
- [ ] **Vercel team account** — Pro tier ($20/mo per seat). Connect GitHub.
- [ ] **GitHub organisation** — create org, create private repo `nichefinder` (or whatever you name it).
- [ ] **Cloudflare account** — verify, add a payment method, request Registrar API beta access.
- [ ] **TransIP account** — for .nl/.be registration. Generate API key.
- [ ] **DataForSEO account** — add $50 credit (Standard Queue is cheap; credits don't expire).
- [ ] **Main authority domain** — pick a working Dutch brand name for your main domain. This is the domain that hosts every niche as a subfolder until it graduates. Examples: `expertgids.nl`, `niche-radar.nl`, `kompasreview.nl`. **Do not over-think this** — you can rebrand later, but you cannot un-register the wrong .nl. Pick something generic enough to host any niche. Trademark-check on EUIPO TMview before registering.

### 3. Test the agent prompts in the Anthropic Console

Open `docs/AGENT_PROMPTS.md`. For each agent, paste the system prompt into the Anthropic Console (or `claude.ai/console`), give it the example inputs, verify the output shape matches what's specified.

**Why before code:** debugging a bad prompt is 10× easier in the Console than via Claude Code's agent runner. If a prompt is broken, every code session that uses it will fail confusingly.

### 4. Hand the package to Claude Code

When everything above is done:

1. `git init`, `git add .`, first commit.
2. Delete `HANDOVER_README.md` (this file).
3. Push to the GitHub repo.
4. Open Claude Code in the repo.
5. First message to Claude Code:
   > Read `CLAUDE.md` first. Then read `docs/PROJECT_SPEC.md` and `docs/ARCHITECTURE.md`. After that, open `docs/PHASE_PLAN.md` and start with Phase 1, step 1.1. Tell me your plan before running any commands. Do not write any code until I approve the plan.

---

## What's deliberately NOT in this package

- **No tribunal-level legal advice.** The compliance doc tells you what to do; a Dutch belastingadviseur and `ICTRecht` (or similar) handle the legal templates (AV, Privacyverklaring, etc.).
- **No specific niche.** The whole point is that the system discovers them. You configure the *kill list* and the *avoid list*; the discovery agent does the rest.
- **No marketing or growth playbook.** That belongs in operator docs, not the codebase.
- **No timeline.** Phases are ordered steps; you move at your speed. Real-world pace for a solo operator: foundation in 2–3 weeks, first niche validated in 6–10 weeks, first promotion at month 5–9.
- **No mobile app.** Web-first. A mobile companion is Phase 2+ territory; not relevant for v1.

---

## Things you should know that might surprise you

1. **Most niches will fail.** 50–70% kill rate is normal and built into the design. The system is optimised for *cheap failure*, not zero failure.
2. **Pure AI content does not rank.** The Helpful Content updates of 2024–2025 punished thin AI sites severely. Every commercial page in this system needs human editing (~25% by word count), original photography, and first-person testing. The agents handle drafts and structure; you handle the experience markers. This is not negotiable.
3. **First revenue is 3–6 months out per niche.** Plan cashflow accordingly.
4. **EU AI Act Article 50 disclosure** takes effect August 2026. Every page that used AI in drafting gets a visible "AI-assisted" badge plus JSON-LD declaration. Bake this in from day one; don't retrofit.
5. **The Reddit API is effectively closed** to commercial use. The discovery pipeline must work without it.
6. **Claude API costs scale with discipline, not luck.** Stick to the tier-routing in `docs/AGENT_PROMPTS.md` (Haiku 4.5 for ~60% of calls, Sonnet 4.6 for 35%, Opus 4.7 for 5%). Use prompt caching and Batch API where specified. Realistic monthly Claude bill at one-niche-per-month cadence: €70–150.
7. **You will hand-edit hero pages.** Plan for ~4 hours of operator editing per validated niche, mostly on the top 5 commercial pages.

---

## Once you're done with this README

Delete it. The rest of the package is for Claude Code.

```bash
rm HANDOVER_README.md
git add -A && git commit -m "Remove handover README, ready for Claude Code"
```

Then talk to Claude Code.
