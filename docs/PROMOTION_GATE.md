# Promotion Gate

The strict, objective check that fires before a niche can be promoted from a subfolder of the main authority domain to its own dedicated domain.

The gate is **deliberately lagging and conservative**. False positives (premature promotion) are far worse than slowness.

> **Hard rule for Claude Code:** the gate never auto-promotes. The Promotion Agent (Opus 4.7) outputs a recommendation; a human approves the domain registration.

---

## The seven criteria

All seven must hold simultaneously, across a 90-day rolling window, before the agent recommends promotion.

### 1. Sustained net affiliate revenue ≥€150/mo

- Rolling 90-day window of `conversions` rows where `status in ('approved','paid')`, summed and divided by 3.
- Must hold for the most recent 3 calendar months.
- Volatility check: no single month <€75 (i.e., the floor isn't a one-off €450 month inside two €0 months).

### 2. Sustained organic clicks ≥1,500/month

- From `gsc_metrics` for the subfolder URL pattern.
- Rolling 90-day window, averaged per 30 days.
- At least 30% of clicks come from non-brand long-tail queries (`gsc_metrics.non_brand_long_tail_clicks / clicks >= 0.30`). This proves the traffic is not one viral page.

### 3. Affiliate diversity — ≥2 sources contributing

- In the 90-day window, at least 2 distinct `affiliate_network` values appear in approved/paid conversions.
- No single network may exceed 65% of revenue.
- Single-product concentration: no single product may exceed 70% of revenue.

### 4. Branded search signal ≥20 queries/month

- From `gsc_metrics.branded_clicks`, queries containing the working brand name for the niche.
- Without branded search, the new domain has nothing to inherit. Promotion is wasted spend.
- Operator may add brand-name variants to the GSC query filter via `tenants.config.brand.queries[]`.

### 5. Engagement quality — passes

- Plausible/Tinybird: median time-on-page ≥90s on commercial pages, median scroll depth ≥60%.
- Cloudflare bot score: median <30 for the sessions attributed as human.
- Bounce on commercial pages: <70%.

### 6. No active Google update window

- Within the last 30 days, no Google broad core update or HCU rollout has been ongoing.
- Source: Google Search Status dashboard scraped daily, stored as `algorithm_events`.
- If a core update is currently rolling, the gate returns `blocked_by_update_window` regardless of all other criteria. Wait at least 30 days after rollout completion before retesting.

### 7. No GSC manual action or critical issue

- GSC API check for manual actions on the subfolder URL pattern.
- No "critical issues" reported in GSC for the past 30 days.

---

## How the agent evaluates the gate

Promotion Agent runs nightly (Sun 04:00 NL). For every niche in state `building` or `mature`:

1. Pull the 90-day data for criteria 1–4 from Supabase.
2. Pull engagement metrics for criterion 5.
3. Pull algorithm-event data for criterion 6.
4. Pull GSC manual-action state for criterion 7.
5. Apply the checks.
6. Write a row to `promotion_evaluations` with `result in ('not_ready','ready','blocked_by_update_window','blocked_by_single_source')` and per-criterion JSON.
7. If `result='ready'`, generate a recommendation text including:
   - Proposed domain name (top 3 candidates, screened against EUIPO TMview)
   - Estimated 5-year registrar cost
   - Migration plan summary
   - Pre-migration checklist
   - Risk notes
8. Surface in admin UI for operator decision.

---

## Promotion procedure (after operator approves)

The migration is a strict sequence — never let any step run in parallel.

1. **T-7 days: freeze edits.** Operator marks the niche as "frozen." No new pages publish.
2. **T-1 day: snapshot.** Export GSC + analytics, save to R2.
3. **T-0: register domain.** Operator-approved call to Cloudflare or TransIP API. Wait for registration confirmation.
4. **T-0+10min: DNS.** Cloudflare DNS zone created. Apex flattening + www CNAME to apex.
5. **T-0+20min: attach to Vercel.** Vercel Domains API attaches apex + www to the project.
6. **T-0+25min: SSL.** Vercel auto-provisions; poll until valid.
7. **T-0+30min: mirror.** All pages from `[main-domain]/[subfolder]/...` are also accessible at the new domain at matching paths. Canonical tags on both point to the new domain.
8. **T-0+30min: 301s.** For every page under the old subfolder, a Vercel rewrite/redirect sends 301 to the new domain. These 301s are permanent — never delete them.
9. **T-0+30min: hreflang.** Both old and new emit hreflang `nl-NL` (and `nl-BE` if applicable).
10. **T-0+1h: sitemap update.** New domain sitemap submitted to GSC. Old subfolder removed from main sitemap.
11. **T-0+1h: GSC.** Add the new domain as a property; verify via DNS TXT (Cloudflare-automatable).
12. **T+24h: monitor.** Daily GSC pull for 30 days; alert on any anomaly.
13. **T+90d: cross-link review.** Decide whether to keep linking from main domain's topic hub to the new domain (default: yes, in perpetuity for an evergreen recommendation block).

---

## When promotion is blocked

The agent's recommendation includes:

- `blocked_by_update_window` — wait at least 30 days, retest weekly.
- `blocked_by_single_source` — diversify affiliate sources before retrying; suggest specific advertisers.
- `not_ready` — itemised list of which criteria fail and by how much.

The agent **never** suggests workarounds that lower the bar. "Bump revenue with paid ads" is not a suggestion. "Adjust the 65% single-source cap" is not a suggestion.

---

## Kill criteria — the inverse

For niches that have been in `building` state for 180 days without progress:

- Net affiliate revenue (90-day rolling) <€30/mo
- Organic clicks <500/mo
- Operator has not edited a hero page in 60+ days
- No branded search signal

All four → Orchestrator flags for kill. Operator confirms; the kill writes a `kills` row, archives all pages, redirects the topic hub to a related niche (or 410 if none).

---

## Why these specific thresholds

| Threshold | Rationale |
|---|---|
| €150/mo | At Empire Flippers' current 25–34× multiple range for affiliate sites, €150/mo = €3,750–5,100 exit value, comfortably above the cost of a domain + migration time. Lower = not worth promoting. |
| 1,500 clicks/mo | Average affiliate-niche page converts in the 1–3% range; 1,500 clicks/mo at 2% CR with €5 EPC = ~€150/mo, the revenue floor. |
| 90 days | Shorter windows are vulnerable to single-spike artifacts and seasonal flukes. |
| 2 affiliate sources | Single-network failure (Bol cuts a category, Awin terminates a publisher) shouldn't kill a promoted niche. |
| 30% non-brand long-tail | Otherwise one viral page can carry the whole numerator. |
| 65% single-source cap | Industry standard for "diversified" portfolio. |
| 20 branded searches/mo | The minimum that proves *some* people know the brand by name. Without this, a new domain has no equity to inherit. |
| 30-day algorithm-event cooldown | Core updates often roll for 2–3 weeks; promoting during one is asking to be deranked into a new domain with no recovery handle. |

---

## What the agent's recommendation looks like

```
PROMOTION RECOMMENDED — "specialty coffee gear"
=================================================
Status: ready (all 7 criteria passed)
Confidence: high

Last 90 days:
  Revenue: €189/mo avg (months: €178, €201, €188)
  Organic clicks: 1,820/mo avg
  Non-brand long-tail: 38% of clicks
  Affiliate sources: Bol 54%, Awin 31%, Daisycon 15%
  Branded queries: "koffie expert" 28/mo, "koffie expert kompas" 4/mo
  Time-on-page (commercial): 112s median
  Algorithm events: none in last 30 days

Proposed domains (operator picks one):
  1. koffie-kompas.nl — TMview clear; available; €8.50/yr (TransIP)
  2. espresso-expert.nl — TMview clear; available; €8.50/yr (TransIP)
  3. koffiegids.nl — TMview clear; available; €8.50/yr (TransIP)

Migration plan: standard 13-step (see docs/PROMOTION_GATE.md)
Estimated downtime: <5min
Estimated traffic impact: -10 to -15% week 1, recovery by week 4-8
Cross-link plan: keep main-domain topic hub linking to new domain for 12+ months

Risks:
  - Bol commission rate for koffie subcategory is at the lower end (3.5%); 
    if Bol shifts further, single-source risk rises
  - Domain authority transfer to fresh .nl is the standard 4-8 week dip

Recommendation: approve. Click "Promote" in admin to begin.
```

---

## Post-promotion monitoring

For 90 days after promotion:

- Daily GSC pull for new domain
- Daily revenue check (any single network drops >50% MoM → alert)
- Weekly cross-domain canonical check (lint test in CI)
- Day 30 retrospective auto-generated by Orchestrator
- Day 90 promotion-success determination: if traffic on the new domain has recovered to ≥85% of pre-migration subfolder traffic, mark as `promotion_success`. Otherwise `promotion_partial` and escalate to operator.
