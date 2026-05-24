# Niche Scoring Rubric

The methodology the Scoring Agent applies to every candidate produced by Discovery.
Output is a single composite score 0–100, plus a per-criterion breakdown stored in `niche_scores.breakdown` JSONB.

> **Rubric version:** 1.0.0 — increment on any weight or criterion change.

---

## Composite score formula

```
total_score = round(
    0.20 * affiliate_availability_score
  + 0.15 * commercial_intent_score
  + 0.10 * kgr_supply_gap_score
  + 0.10 * ai_saturation_inverse_score
  + 0.10 * trend_slope_score
  + 0.10 * ymyl_safety_score
  + 0.10 * avoid_list_inverse_score
  + 0.05 * unit_economics_score
  + 0.05 * competition_diversity_score
  + 0.05 * operator_interest_score
)
```

All inputs are normalized to 0–100. Hard-block criteria (kill-list match, YMYL regulated, trademark conflict) override the composite and force `total_score=0` regardless.

---

## Criteria

### 1. Affiliate Availability (weight 20%)

**What it measures:** How many affiliate sources exist for this niche, and what their EPC looks like.

**Inputs:**
- Count of Bol.com Partner advertisers/products matching the niche
- Count of Awin advertisers in matching categories
- Count of Daisycon advertisers
- Count of Digistore24 + Impact.com relevant programs
- Median EPC (€) across those programs, where API exposes it

**Scoring:**
- 0–25: ≤1 affiliate source, no EPC data or median EPC <€0.20
- 26–50: 2 sources, median EPC €0.20–0.50
- 51–75: 3+ sources, median EPC €0.50–1.00
- 76–100: 4+ sources, median EPC ≥€1.00, Bol.com always present

### 2. Commercial Intent Keyword Volume (weight 15%)

**What it measures:** Latent buyer demand expressed as monthly search volume on intent=commercial/transactional keywords.

**Inputs (DataForSEO Labs):**
- Top 50 keywords for the niche topic, filtered to `search_intent in ('commercial','transactional')`
- Keyword difficulty filter: `keyword_difficulty < 35`

**Scoring:**
- 0–25: total volume <1,000/mo
- 26–50: 1,000–5,000/mo
- 51–75: 5,000–25,000/mo
- 76–100: >25,000/mo

### 3. KGR-Style Supply Gap (weight 10%)

**What it measures:** Doug Cunnington's Keyword Golden Ratio — `allintitle / volume` — as a proxy for under-served queries. Still useful as a filter despite Helpful Content updates; never relied on alone.

**Inputs:**
- For top 20 commercial-intent keywords: `allintitle:"keyword"` count via DataForSEO SERP, divided by monthly volume
- Average across the 20

**Scoring:**
- 0–25: avg KGR >0.75 (oversupplied)
- 26–50: 0.50–0.75
- 51–75: 0.25–0.50
- 76–100: <0.25 (under-served, classic green KGR)

### 4. AI Saturation Inverse (weight 10%)

**What it measures:** Whether SERPs are already polluted with thin AI affiliate sites Google is actively de-ranking.

**Inputs:**
- Top-10 SERP for each of top 5 commercial keywords
- Per result, check signals: word count <800, no schema, no author byline, image-light, suspicious freshness pattern, "as of [date]" template language, AI watermark indicators
- Compute % of top-10 results that exhibit ≥2 of these tells

**Scoring (inverse — lower saturation = higher score):**
- 0–25: >70% of top-10 look templated (avoid)
- 26–50: 40–70%
- 51–75: 20–40%
- 76–100: <20% (largely human-edited SERP, more defensible)

### 5. Trend Slope (weight 10%)

**What it measures:** Direction and consistency of search interest over multiple time windows.

**Inputs:**
- Google Trends 90-day slope (if API available; else proxy via Wikipedia pageview MoM)
- Wikipedia pageview 90-day and 365-day slopes
- DataForSEO historical search volume 12-month slope

**Scoring:**
- 0–25: declining across all three slopes
- 26–50: flat across all three, or mixed
- 51–75: rising on 1–2 slopes, flat elsewhere
- 76–100: rising consistently across all three slopes

### 6. YMYL Safety (weight 10%, hard-block at 0)

**What it measures:** Regulated-topic exposure under NL/EU law.

**Inputs (keyword-stem match against kill-list patterns):**
- Health/medical claims (Geneesmiddelenwet)
- Financial advice (Wft, AFM)
- Gambling (Kansspelautoriteit license required)
- Supplements (Warenwet/EFSA claims regime)
- Legal advice
- Children's products with safety claims
- Pharmaceutical, CBD, drugs of any kind

**Scoring:**
- **0 (hard block):** kill-list patterns matched
- 25: borderline (general wellness language, e.g. "ergonomics"); requires extra E-E-A-T effort, allowed but down-weighted
- 75: adjacent but safe (e.g., kitchen tools used in cooking, not "diet")
- 100: fully non-YMYL

### 7. Avoid-List Inverse (weight 10%)

**What it measures:** Whether the niche matches categories with documented affiliate-graveyard kill rates.

**Inputs (from `docs/KILL_LIST.md`):**
- Fast fashion
- Generic fitness ("workout gear," "yoga mats")
- Phone accessories (cases, chargers)
- Fidget toys
- Weight-loss products
- Generic dropship trinkets
- "AI tools" affiliate roundups (extreme commoditization)
- "Best VPN" / VPN affiliate ecosystem (entrenched incumbents)

**Scoring (inverse):**
- 0: explicit match
- 50: thematic overlap
- 100: no overlap

### 8. Unit Economics (weight 5%)

**What it measures:** Estimated revenue per converted visitor.

**Inputs:**
- Median product AOV from affiliate feeds
- Median commission rate
- Estimated repeat-purchase factor (1.0 for one-time; 1.3 for accessories; 2.0 for consumables)

**Scoring (computed via `AOV * commission_rate * repeat_factor`):**
- 0–25: <€1 per conversion
- 26–50: €1–3
- 51–75: €3–8
- 76–100: >€8

### 9. Competition Diversity (weight 5%)

**What it measures:** Whether top-10 SERP is dominated by 1–2 incumbents (bad) or distributed across many domains (good).

**Inputs:**
- For top 10 commercial-intent keywords, the unique-domain count in top-10
- Median DR of top-10 domains

**Scoring:**
- 0–25: top-10 dominated by ≤3 mega-domains (Amazon, Bol, Coolblue, Wikipedia)
- 26–50: 4–5 unique domains, median DR >80
- 51–75: 6–7 unique domains, median DR 60–80
- 76–100: 8+ unique domains, median DR <60

### 10. Operator Interest (weight 5%)

**What it measures:** Operator-provided override based on personal knowledge or interest. Defaults to 50 if not set.

**Inputs:**
- Operator-configurable boost per topic family in `tenants.config.operator_preferences`
- Defaults: 50

**Scoring:** Direct 0–100 from config.

---

## Hard blocks (override composite to 0)

The agent must return `total_score = 0` and add a `block_reason` field to `breakdown` if any of these hit:

| Block | Trigger |
|---|---|
| Kill-list match | Pattern in `docs/KILL_LIST.md` matched |
| YMYL regulated | Pattern matched a regulated-keyword stem |
| Trademark conflict | EUIPO TMview returned a registered match for the working brand or domain candidate |
| Duplicate topic | Already-killed niche slug matched |
| Already-running topic | Topic slug matches an active niche |

---

## Borderline escalation

If Haiku 4.5 produces a `total_score` in the 55–70 band, the same candidate is re-scored by Sonnet 4.6 with an "escalation" prompt that includes the Haiku breakdown and asks for a second opinion. The final stored `total_score` is the Sonnet result; the Haiku result is preserved as `breakdown.haiku_first_pass`.

This catches the cases where Haiku is close to the trigger line and a more reasoning-heavy model would push it clearly into "approve" or "reject."

---

## Output shape

```json
{
  "rubric_version": "1.0.0",
  "total_score": 72,
  "block_reason": null,
  "breakdown": {
    "affiliate_availability": { "score": 80, "evidence": { "bol_advertisers": 12, "awin_advertisers": 3, "median_epc_eur": 0.85 } },
    "commercial_intent": { "score": 70, "evidence": { "kw_count": 38, "total_volume": 12400 } },
    "kgr_supply_gap": { "score": 65, "evidence": { "avg_kgr": 0.31 } },
    "ai_saturation_inverse": { "score": 55, "evidence": { "pct_templated_top10": 0.35 } },
    "trend_slope": { "score": 75, "evidence": { "trends_90d_slope": 0.12, "wiki_90d_slope": 0.08, "dataforseo_12m_slope": 0.06 } },
    "ymyl_safety": { "score": 100, "evidence": { "regulated_match": false } },
    "avoid_list_inverse": { "score": 100, "evidence": { "match": null } },
    "unit_economics": { "score": 60, "evidence": { "aov_eur": 85, "commission_rate": 0.045, "repeat_factor": 1.3 } },
    "competition_diversity": { "score": 70, "evidence": { "unique_domains_avg": 7.2, "median_dr": 64 } },
    "operator_interest": { "score": 50, "evidence": null },
    "haiku_first_pass": null
  }
}
```

---

## Tuning policy

- The first 10 validated niches keep the rubric at 1.0.0.
- After 10 validations, run a retrospective: for each niche, compare its `total_score` at scoring time to its actual revenue at month 6.
- Adjust weights via PR. Bump rubric to 1.1.0. Old scores remain stored under their old rubric version.
- Never weight-tune mid-experiment; complete a full validation cohort before changing weights.

---

## What this rubric will *not* catch

Be honest:

- A niche where the *operator* is genuinely a top-3 expert and can write content no one else can. The rubric gives this only a 5% boost via Operator Interest. Override manually when this applies.
- A niche that is rising 90 days before Google Trends shows it. The rubric is partly lagging.
- A regional/cultural niche specific to NL/BE that doesn't appear in international SERPs. Bol.com presence partly compensates.
- A niche where the moat is video (YouTube) rather than text. The rubric is text-SEO-biased.

When you (operator) believe the rubric is wrong, override and document why in the niche notes. The retrospective will tell us if the override was right.
