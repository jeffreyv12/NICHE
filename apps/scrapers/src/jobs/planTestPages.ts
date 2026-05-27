// Phase 3.1 — Test-page planner.
//
// Decides WHICH content pages to draft for a niche that has just entered
// validation. The Validation Agent will later read traffic/conversion data
// across these pages to recommend GO / PIVOT / KILL. So the mix of kinds and
// keywords here directly shapes the validation signal.
//
// This is a deliberate business-logic surface — the operator (you) decides
// the test-page recipe based on the affiliate market you know best.
//
// Contract:
//   Input  — a niche row (topic, topicSlug, relatedKeywords from candidate)
//   Output — 3 to 5 plan items, each producing one drafted page
//
// Each plan item drives one `runContentDraft` call.

import type { contentAgent } from "@nichefinder/agent-sdk";

type ContentPageKind = contentAgent.ContentPageKind;

export interface NicheForPlanning {
  topic: string;
  topicSlug: string;
  language: "nl" | "en";
  relatedKeywords: string[];
}

export interface TestPagePlanItem {
  /** Slug appended to /test/[niche_slug]/ — must be unique within the niche. */
  pageSlug: string;
  /** Content-agent kind. Drives prompt + target word count. */
  kind: ContentPageKind;
  /** Primary keyword the page targets. */
  primaryKeyword: string;
  /** 0-8 secondary keywords. */
  secondaryKeywords: string[];
  /** Cohort tag written to clicks.cohort and into the SubID. */
  cohort: string;
  /** Optional word-count override (else agent default per kind). */
  targetWordCount?: number;
}

// -----------------------------------------------------------------------------
// USER CONTRIBUTION SLOT — fill in the body of planTestPages below.
//
// You're choosing the validation recipe: 3–5 page kinds + the keyword angle
// each one tests. Think about what mix would give you the cleanest GO/KILL
// signal for the NL/BE affiliate market.
//
// Trade-offs to consider:
//   - comparison + buying_guide pages test purchase intent (conversion signal)
//   - informational + how_to pages test top-of-funnel (traffic signal, lower CR)
//   - product_review pages need real products in the niche (skip if products
//     are empty)
//   - more pages = more validation cost, but more signal; PHASE_PLAN.md says 3-5
//
// Cohort naming convention: use short tags like "compare", "guide", "info"
// so they show up cleanly in clicks.cohort dashboards.
//
// Example for the topic "koffiemolens":
//   { pageSlug: "vergelijking",    kind: "comparison",   primaryKeyword: "beste koffiemolen 2026", cohort: "compare" }
//   { pageSlug: "koopgids",        kind: "buying_guide", primaryKeyword: "koffiemolen kopen",      cohort: "guide"   }
//   { pageSlug: "handmatig-elektrisch", kind: "informational", primaryKeyword: "handmatige vs elektrische koffiemolen", cohort: "info" }
// -----------------------------------------------------------------------------

export function planTestPages(niche: NicheForPlanning): TestPagePlanItem[] {
  // Balanced 4-pager: two purchase-intent (comparison + buying_guide) and two
  // top-of-funnel (informational + how_to). Operator-chosen recipe — see the
  // doc block above for the trade-off rationale.
  const t = niche.topic;
  return [
    {
      pageSlug: "vergelijking",
      kind: "comparison",
      primaryKeyword: `beste ${t}`,
      secondaryKeywords: niche.relatedKeywords.slice(0, 4),
      cohort: "compare",
    },
    {
      pageSlug: "koopgids",
      kind: "buying_guide",
      primaryKeyword: `${t} kopen`,
      secondaryKeywords: [`${t} aanschaffen`, `${t} prijs`],
      cohort: "guide",
    },
    {
      pageSlug: "wat-is",
      kind: "informational",
      primaryKeyword: `wat is een ${t}`,
      secondaryKeywords: [`${t} uitleg`, `${t} betekenis`],
      cohort: "info",
    },
    {
      pageSlug: "hoe-kies-je",
      kind: "how_to",
      primaryKeyword: `hoe kies je een ${t}`,
      secondaryKeywords: [`${t} keuzehulp`],
      cohort: "howto",
    },
  ];
}
