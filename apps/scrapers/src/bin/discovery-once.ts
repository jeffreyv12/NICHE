#!/usr/bin/env node
// On-demand / cron entrypoint for the discovery job (Phase 2.2).
//
// Triggered by the nightly cron (Sun 02:00 NL) on Hetzner, or manually:
//   node dist/bin/discovery-once.js
//
// Each source gatherer is built from env vars; missing creds → that source
// is skipped (non-fatal). At least one source must produce signals for the
// agent call to proceed.
//
// Exits 0 on success (including "0 signals" no-op), 1 on unhandled error.
// JSON result summary written to stdout.

import { getServiceDb } from "@nichefinder/db";
import { runDiscoveryJob } from "../jobs/discovery.js";
import type { DiscoverySignal, SignalGatherer } from "../jobs/discovery.js";
import { EuipoClient } from "../sources/euipo/index.js";

// ---------------------------------------------------------------------------
// Signal gatherers — one per source. Individual failures are caught; the job
// itself also wraps each gatherer in Promise.allSettled.
// ---------------------------------------------------------------------------

function makeDataForSeoGatherer(): SignalGatherer | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;

  return async (): Promise<DiscoverySignal[]> => {
    const { DataForSeoClient } = await import("../sources/dataforseo/client.js");
    const { keywordOverview } = await import("../sources/dataforseo/keywords.js");
    const { MemoryCache } = await import("../sources/dataforseo/cache.js");

    const client = new DataForSeoClient({ credentials: { login, password } });
    const cache = new MemoryCache();
    const seeds = ["beste producten", "goedkoop kopen", "vergelijken", "review", "kopen Nederland"];
    const result = await keywordOverview(client, cache, {
      keywords: seeds,
      location_code: 2528, // Netherlands
      language_code: "nl",
    });

    return result.map((item) => ({
      source: "dataforseo" as const,
      summary: `${item.keyword} — vol ${item.search_volume ?? "?"}/mo`,
      raw: item as Record<string, unknown>,
    }));
  };
}

function makeBolGatherer(): SignalGatherer | null {
  const clientId = process.env.BOL_PARTNER_CLIENT_ID;
  const clientSecret = process.env.BOL_PARTNER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  return async (): Promise<DiscoverySignal[]> => {
    const { BolClient } = await import("../sources/bol/client.js");
    const { searchCatalog } = await import("../sources/bol/catalog.js");

    const client = new BolClient({ credentials: { clientId, clientSecret } });

    // Sample popular search terms to surface trending categories.
    const searches = ["beste", "kopen", "review"];
    const results = await Promise.allSettled(
      searches.map((t) => searchCatalog(client, { searchTerm: t, limit: 10, countryCode: "NL" })),
    );

    return results
      .flatMap((r) => (r.status === "fulfilled" ? (r.value.products ?? []) : []))
      .map((p) => ({
        source: "bol_trends" as const,
        summary: `Bol product: ${(p as Record<string, unknown>).title ?? "?"} — EAN ${(p as Record<string, unknown>).ean ?? "?"}`,
        raw: p as Record<string, unknown>,
      }))
      .slice(0, 30);
  };
}

function makeAwinGatherer(): SignalGatherer | null {
  const apiToken = process.env.AWIN_API_TOKEN;
  const publisherId = process.env.AWIN_PUBLISHER_ID;
  if (!apiToken || !publisherId) return null;

  return async (): Promise<DiscoverySignal[]> => {
    const { AwinClient } = await import("../sources/awin/client.js");
    const { listProgrammes } = await import("../sources/awin/programmes.js");

    const client = new AwinClient({ credentials: { apiToken, publisherId } });
    const result = await listProgrammes(client, {
      relationship: "joined",
      countryCode: "NL",
    });

    return result.map((p) => ({
      source: "awin_programmes" as const,
      summary: `Awin programma: ${p.name ?? "?"}`,
      raw: p as unknown as Record<string, unknown>,
    }));
  };
}

function makeDaisyconGatherer(): SignalGatherer | null {
  const clientId = process.env.DAISYCON_CLIENT_ID;
  const clientSecret = process.env.DAISYCON_CLIENT_SECRET;
  const publisherId = process.env.DAISYCON_PUBLISHER_ID;
  if (!clientId || !clientSecret || !publisherId) return null;

  return async (): Promise<DiscoverySignal[]> => {
    const { DaisyconClient } = await import("../sources/daisycon/client.js");
    const { listPrograms } = await import("../sources/daisycon/programs.js");

    const client = new DaisyconClient({
      credentials: { clientId, clientSecret, publisherId },
    });
    const programs = await listPrograms(client, { country_code: "NL", per_page: 50 });

    return programs.map((p) => ({
      source: "daisycon_programs" as const,
      summary: `Daisycon programma: ${p.name ?? "?"}`,
      raw: p as unknown as Record<string, unknown>,
    }));
  };
}

function makeWikipediaGatherer(): SignalGatherer {
  // No credentials required — public Wikimedia API.
  return async (): Promise<DiscoverySignal[]> => {
    const { WikipediaClient } = await import("../sources/wikipedia/index.js");
    const wiki = new WikipediaClient();
    const articles = await wiki.topPages({ project: "nl.wikipedia" });

    // Skip meta-pages (Main_Page, Speciale, etc.) and surface the top 40.
    const interesting = articles
      .filter((a) => !a.article.includes("Speciale:") && a.article !== "Hoofdpagina")
      .slice(0, 40);

    return interesting.map((a) => ({
      source: "wiki_pageviews" as const,
      summary: `Wikipedia NL trending: ${a.article.replace(/_/g, " ")} — ${a.views} views/dag`,
      raw: a as Record<string, unknown>,
    }));
  };
}

function makeYouTubeGatherer(): SignalGatherer | null {
  const apiKey = process.env.YOUTUBE_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  return async (): Promise<DiscoverySignal[]> => {
    const { YouTubeClient } = await import("../sources/youtube/index.js");
    const yt = new YouTubeClient({ apiKey });

    const searches = ["beste producten", "goedkoop kopen", "review Nederland"];
    const results = await Promise.allSettled(
      searches.map((q) =>
        yt.search({ q, regionCode: "NL", relevanceLanguage: "nl", maxResults: 15 }),
      ),
    );

    return results
      .flatMap((r) => (r.status === "fulfilled" ? r.value.items : []))
      .map((item) => ({
        source: "yt_trending" as const,
        summary: `YouTube: ${item.snippet?.title ?? "?"} (${item.snippet?.channelTitle ?? "?"})`,
        raw: item as Record<string, unknown>,
      }));
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const db = getServiceDb();

  const gathererCandidates: Array<SignalGatherer | null> = [
    makeDataForSeoGatherer(),
    makeBolGatherer(),
    makeAwinGatherer(),
    makeDaisyconGatherer(),
    makeYouTubeGatherer(),
    makeWikipediaGatherer(), // no creds needed
  ];
  const gatherers = gathererCandidates.filter((g): g is SignalGatherer => g !== null);

  if (gatherers.length === 0) {
    process.stderr.write(
      "discovery-once: no source credentials configured — set at least one of " +
        "DATAFORSEO_LOGIN, BOL_PARTNER_CLIENT_ID, AWIN_API_TOKEN, DAISYCON_CLIENT_ID, YOUTUBE_API_KEY\n",
    );
    process.exit(1);
  }

  const euipo = new EuipoClient();

  const runtime = {
    db,
    monthlyBudgetEur: Number(process.env.CLAUDE_MONTHLY_BUDGET_EUR ?? 200),
    perCallCapEur: Number(process.env.CLAUDE_PER_CALL_CAP_EUR ?? 2.5),
    promptCache: process.env.FEATURE_PROMPT_CACHE !== "false",
  };

  const result = await runDiscoveryJob({ db, runtime, gatherers, euipo });

  process.stdout.write(`${JSON.stringify({ event: "discovery.done", ...result }, null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(
    `discovery-once failed: ${err instanceof Error ? err.stack : String(err)}\n`,
  );
  process.exit(1);
});
