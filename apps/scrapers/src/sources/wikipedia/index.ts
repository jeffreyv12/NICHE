import { z } from "zod";

// Wikimedia Pageviews API — public, no auth required. Required to identify
// trending NL topics (organic interest as a leading indicator). Their ToS
// requires a descriptive User-Agent identifying the project + contact.
// See: https://wikitech.wikimedia.org/wiki/Robot_policy

const USER_AGENT = "NicheFinder/1.0 (+https://expertgids.nl/about-bot)";
const DEFAULT_BASE = "https://wikimedia.org/api/rest_v1";

export class WikipediaError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly endpoint: string,
    public readonly detail?: string,
  ) {
    super(`Wikipedia ${httpStatus} on ${endpoint}: ${detail ?? ""}`);
    this.name = "WikipediaError";
  }
}

export const pageviewItem = z
  .object({
    project: z.string(),
    article: z.string(),
    granularity: z.string(),
    timestamp: z.string(),
    access: z.string().optional(),
    agent: z.string().optional(),
    views: z.number(),
  })
  .passthrough();

export const pageviewsResponse = z
  .object({ items: z.array(pageviewItem).default([]) })
  .passthrough();
export type PageviewsResponse = z.infer<typeof pageviewsResponse>;

export interface PageviewsArgs {
  /** Wikipedia project, e.g. "nl.wikipedia". */
  project?: string;
  /** Article title; spaces will be URL-encoded automatically. */
  article: string;
  access?: "all-access" | "desktop" | "mobile-web" | "mobile-app";
  agent?: "all-agents" | "user" | "spider" | "automated";
  granularity?: "daily" | "monthly";
  /** YYYYMMDD or YYYYMMDDHH. */
  start: string;
  end: string;
}

export interface WikipediaClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class WikipediaClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: WikipediaClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async pageviews(args: PageviewsArgs): Promise<PageviewsResponse> {
    const project = args.project ?? "nl.wikipedia";
    const access = args.access ?? "all-access";
    const agent = args.agent ?? "user";
    const granularity = args.granularity ?? "daily";
    const article = encodeURIComponent(args.article.replace(/ /g, "_"));
    const path = `/metrics/pageviews/per-article/${project}/${access}/${agent}/${article}/${granularity}/${args.start}/${args.end}`;
    const url = `${this.baseUrl}${path}`;

    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new WikipediaError(res.status, path, text.slice(0, 200));
    }
    const parsed = pageviewsResponse.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new WikipediaError(-1, path, parsed.error.message.slice(0, 200));
    }
    return parsed.data;
  }
}
