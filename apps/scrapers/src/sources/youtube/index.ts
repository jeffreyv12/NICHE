import { z } from "zod";

// YouTube Data API v3 — search.list. We only need the search endpoint for
// surfacing trending topics relevant to Dutch/Belgian niches.

const USER_AGENT = "NicheFinder/1.0 (+https://expertgids.nl/about-bot)";
const DEFAULT_BASE = "https://www.googleapis.com/youtube/v3";

export class YouTubeError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly endpoint: string,
    public readonly detail?: string,
  ) {
    super(`YouTube ${httpStatus} on ${endpoint}: ${detail ?? ""}`);
    this.name = "YouTubeError";
  }
}

export const youTubeSearchItem = z
  .object({
    id: z
      .object({ kind: z.string().optional(), videoId: z.string().optional() })
      .passthrough()
      .optional(),
    snippet: z
      .object({
        title: z.string().optional(),
        channelTitle: z.string().optional(),
        publishedAt: z.string().optional(),
        description: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const youTubeSearchResponse = z
  .object({
    items: z.array(youTubeSearchItem).default([]),
    pageInfo: z.object({ totalResults: z.number().int().optional() }).partial().optional(),
    nextPageToken: z.string().optional(),
  })
  .passthrough();
export type YouTubeSearchResponse = z.infer<typeof youTubeSearchResponse>;

export interface YouTubeSearchArgs {
  q: string;
  /** ISO country code restricting results, e.g. "NL", "BE". */
  regionCode?: string;
  /** ISO language hint, e.g. "nl". */
  relevanceLanguage?: string;
  maxResults?: number;
  order?: "date" | "rating" | "relevance" | "title" | "viewCount";
}

export interface YouTubeClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class YouTubeClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: YouTubeClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async search(args: YouTubeSearchArgs): Promise<YouTubeSearchResponse> {
    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      q: args.q,
      maxResults: String(args.maxResults ?? 25),
      order: args.order ?? "viewCount",
      key: this.apiKey,
    });
    if (args.regionCode) params.set("regionCode", args.regionCode);
    if (args.relevanceLanguage) params.set("relevanceLanguage", args.relevanceLanguage);

    const url = `${this.baseUrl}/search?${params.toString()}`;
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new YouTubeError(res.status, "/search", text.slice(0, 200));
    }
    const parsed = youTubeSearchResponse.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new YouTubeError(-1, "/search", parsed.error.message.slice(0, 200));
    }
    return parsed.data;
  }
}
