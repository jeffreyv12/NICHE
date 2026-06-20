// Phase 2.3 — Production-grade signal adapters for the scoring job.
//
// Replaces placeholder adapters in scoring-once.ts with real network calls:
//   - DataForSEO: keyword overview + SERP organic (commercial intent, difficulty)
//   - Bol + Awin: product count + advertiser count (affiliate availability)
//
// Every adapter degrades gracefully on per-source failure — a thrown error
// returns an empty signal bundle rather than aborting the scoring run.

import type { AwinClient } from "../../sources/awin/client.js";
import { listProgrammes } from "../../sources/awin/programmes.js";
import { searchCatalog } from "../../sources/bol/catalog.js";
import type { BolClient } from "../../sources/bol/client.js";
import type { CacheBackend } from "../../sources/dataforseo/cache.js";
import type { DataForSeoClient } from "../../sources/dataforseo/client.js";
import { keywordOverview } from "../../sources/dataforseo/keywords.js";
import { serpOrganic } from "../../sources/dataforseo/serp.js";
import type { AffiliateSignalAdapter, KeywordSignalAdapter, PrefetchContext } from "../prefetch.js";

// Titles containing these terms are treated as "templated" content in the NL
// affiliate SERPs (comparison listicles, review aggregators, etc.).
const NL_TEMPLATED_TITLE_RE = /beste|vergelijking|kopen|koop|aanbieding|review|test/i;

// ---------------------------------------------------------------------------
// DataForSEO keyword + SERP adapter
// ---------------------------------------------------------------------------

export function buildDataForSeoKeywordAdapter(
  client: DataForSeoClient,
  cache: CacheBackend,
): KeywordSignalAdapter {
  return {
    async fetch(ctx: PrefetchContext) {
      const keywords = [ctx.candidate.topic, ...(ctx.candidate.related_keywords ?? [])].slice(
        0,
        50,
      );

      let totalVolumeCommercial = 0;
      let competitionSum = 0;
      let competitionCount = 0;
      let topKeyword: string | undefined;
      let topVolume = -1;
      let keywordCount = 0;

      try {
        const items = await keywordOverview(client, cache, {
          keywords,
          location_code: 2528,
          language_code: "nl",
        });

        for (const item of items) {
          const vol = item.search_volume ?? item.keyword_info?.search_volume ?? 0;
          const comp = item.competition ?? item.keyword_info?.competition;
          const intent = item.search_intent_info?.main_intent;

          keywordCount++;
          if (vol > 0 && (intent === "commercial" || intent === "transactional")) {
            totalVolumeCommercial += vol;
          }
          if (comp != null) {
            competitionSum += comp * 100;
            competitionCount++;
          }
          if ((vol ?? 0) > topVolume) {
            topVolume = vol ?? 0;
            topKeyword = item.keyword;
          }
        }
      } catch {
        // Non-fatal — scoring agent gets empty keyword signal and reasons over
        // whatever other signals are available (Wikipedia, EUIPO, affiliate).
      }

      let pctTemplated: number | undefined;
      let uniqueDomains: number | undefined;
      const queryKeyword = topKeyword ?? ctx.candidate.topic;

      try {
        const serpItems = await serpOrganic(client, cache, {
          keyword: queryKeyword,
          location_code: 2528,
          language_code: "nl",
          depth: 10,
          // Standard Queue costs ~$0.0006 vs $0.009 for live — use it for nightly batch.
          mode: "standard",
        });

        const top10 = serpItems.filter((i) => (i.rank_absolute ?? 99) <= 10);
        if (top10.length > 0) {
          const templated = top10.filter((i) => NL_TEMPLATED_TITLE_RE.test(i.title ?? "")).length;
          pctTemplated = templated / top10.length;
          const domains = new Set(top10.map((i) => i.domain).filter(Boolean));
          uniqueDomains = domains.size;
        }
      } catch {
        // Non-fatal.
      }

      return {
        keywords: {
          total_volume_intent_commercial: totalVolumeCommercial,
          avg_keyword_difficulty:
            competitionCount > 0 ? competitionSum / competitionCount : undefined,
          top_keyword: topKeyword,
          keyword_count: keywordCount,
        },
        serp: {
          pct_top10_templated: pctTemplated,
          unique_domains_avg: uniqueDomains,
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Bol + Awin affiliate availability adapter
// ---------------------------------------------------------------------------

export function buildBolAwinAffiliateAdapter(
  bolClient: BolClient | null,
  awinClient: AwinClient | null,
): AffiliateSignalAdapter {
  return {
    async fetch(ctx: PrefetchContext) {
      const topic = ctx.candidate.topic;

      let bolProducts: number | undefined;
      let awinAdvertisers: number | undefined;
      let awinProgramNames: string[] = [];

      if (bolClient) {
        try {
          const resp = await searchCatalog(bolClient, {
            searchTerm: topic,
            // page=1 limit=1 — we only need totalResultSize, not actual products.
            limit: 1,
            countryCode: "NL",
          });
          bolProducts = resp.totalResultSize;
        } catch {
          // Non-fatal.
        }
      }

      if (awinClient) {
        try {
          // Joined NL programmes — gives the actual advertisers we can link to,
          // not the full marketplace. A niche with 0 joined advertisers scores low.
          const programmes = await listProgrammes(awinClient, {
            relationship: "joined",
            countryCode: "NL",
          });
          awinAdvertisers = programmes.length;
          awinProgramNames = programmes
            .map((p) => p.name)
            .filter((n): n is string => typeof n === "string")
            .slice(0, 10);
        } catch {
          // Non-fatal.
        }
      }

      return {
        bol: bolProducts != null ? { products: bolProducts } : undefined,
        awin:
          awinAdvertisers != null
            ? {
                advertisers: awinAdvertisers,
                programs_with_offer: awinProgramNames,
              }
            : undefined,
        // EPC is available from transaction history (reconciliation job) but not
        // from the catalogue / programmes endpoints — left null here intentionally.
        median_epc_eur_overall: null,
      };
    },
  };
}
