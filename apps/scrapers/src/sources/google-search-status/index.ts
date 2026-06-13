import { type SearchStatusIncident, mapSearchStatusIncidents } from "@nichefinder/shared";
import { z } from "zod";

// Google Search Status Dashboard — the official, public source of confirmed
// Google ranking-update windows (core / spam / reviews / helpful-content
// updates) used by promotion-gate criterion 6 (docs/PROMOTION_GATE.md #6).
//
// CLAUDE.md non-negotiable #3: this is an official Google endpoint (an
// `incidents.json` feed, not HTML scraping), and status.search.google.com's
// robots.txt is `User-agent: * / Allow: /` (verified). We still send the
// project-identifying User-Agent. No auth required.
//
// See: https://status.search.google.com/  (incidents.json)

const USER_AGENT = "NicheFinder/1.0 (+https://expertgids.nl/about-bot)";
const DEFAULT_BASE = "https://status.search.google.com";

export class SearchStatusError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly endpoint: string,
    public readonly detail?: string,
  ) {
    super(`SearchStatus ${httpStatus} on ${endpoint}: ${detail ?? ""}`);
    this.name = "SearchStatusError";
  }
}

// The feed is a non-trivial nested shape that Google evolves; keep it forgiving
// (passthrough) and only read the fields the mapper compares against. Validation
// here is the boundary guard (CLAUDE.md #11 / source template): the response is
// an array of incident objects.
const affectedProduct = z
  .object({ title: z.string().nullish(), id: z.string().nullish() })
  .passthrough();

export const searchStatusIncident = z
  .object({
    id: z.string().nullish(),
    external_desc: z.string().nullish(),
    service_name: z.string().nullish(),
    begin: z.string().nullish(),
    end: z.string().nullish(),
    affected_products: z.array(affectedProduct).nullish(),
  })
  .passthrough();

export const searchStatusFeed = z.array(searchStatusIncident);
export type SearchStatusFeed = z.infer<typeof searchStatusFeed>;

export interface SearchStatusClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class SearchStatusClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: SearchStatusClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Fetch + validate the raw incidents feed (all products, all severities). */
  async fetchIncidents(): Promise<SearchStatusFeed> {
    const path = "/incidents.json";
    const url = `${this.baseUrl}${path}`;

    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new SearchStatusError(res.status, path, text.slice(0, 200));
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new SearchStatusError(
        -1,
        path,
        `invalid JSON: ${(err as Error).message.slice(0, 120)}`,
      );
    }

    const parsed = searchStatusFeed.safeParse(json);
    if (!parsed.success) {
      throw new SearchStatusError(-1, path, parsed.error.message.slice(0, 200));
    }
    return parsed.data;
  }

  /**
   * Fetch the feed and map it to algorithm_events insert records (Ranking-only,
   * classified, deduped, sorted). The mapping is the pure shared helper so it is
   * tested independently; this just wires fetch → map.
   */
  async fetchRankingEvents() {
    const incidents = (await this.fetchIncidents()) as SearchStatusIncident[];
    return mapSearchStatusIncidents(incidents);
  }
}
