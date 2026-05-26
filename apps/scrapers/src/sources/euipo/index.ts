import { z } from "zod";

// EUIPO TMview — public trademark search across EU/EEA registries.
// We screen niche names BEFORE registering a domain (CLAUDE.md non-negotiable
// #2: kill-list includes trademark matches). The hard gate is in the
// Discovery agent; this client just returns the raw search hits.

const USER_AGENT = "NicheFinder/1.0 (+https://expertgids.nl/about-bot)";
const DEFAULT_BASE = "https://www.tmdn.org/tmview/api";

export class EuipoError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly endpoint: string,
    public readonly detail?: string,
  ) {
    super(`EUIPO ${httpStatus} on ${endpoint}: ${detail ?? ""}`);
    this.name = "EuipoError";
  }
}

// TMview returns a non-trivial nested shape; we keep it forgiving and only
// surface the fields the trademark-check gate actually compares against.
export const trademarkHit = z
  .object({
    applicationNumber: z.string().optional(),
    markVerbalElement: z.string().optional(),
    applicantName: z.string().optional(),
    status: z.string().optional(),
    niceClass: z.array(z.union([z.string(), z.number()])).optional(),
    office: z.string().optional(),
    territory: z.string().optional(),
  })
  .passthrough();
export type TrademarkHit = z.infer<typeof trademarkHit>;

export const trademarkSearchResponse = z
  .object({
    total: z.number().int().optional(),
    tradeMarks: z.array(trademarkHit).default([]),
  })
  .passthrough();
export type TrademarkSearchResponse = z.infer<typeof trademarkSearchResponse>;

export interface TrademarkSearchArgs {
  /** The verbal element to screen. Case-insensitive on TMview's side. */
  basicSearch: string;
  /** Comma-separated office codes, e.g. "EM" (EUIPO), "BX" (Benelux), "NL". */
  offices?: string;
  /** Comma-separated status codes; default: registered + filed. */
  statuses?: string;
  page?: number;
  pageSize?: number;
}

export interface EuipoClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class EuipoClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: EuipoClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async searchTrademarks(args: TrademarkSearchArgs): Promise<TrademarkSearchResponse> {
    const params = new URLSearchParams({
      basicSearch: args.basicSearch,
      offices: args.offices ?? "EM,BX,NL",
      statuses: args.statuses ?? "Registered,Filed",
      page: String(args.page ?? 1),
      pageSize: String(args.pageSize ?? 25),
    });
    const path = `/trademarks/results?${params.toString()}`;
    const url = `${this.baseUrl}${path}`;

    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new EuipoError(res.status, "/trademarks/results", text.slice(0, 200));
    }
    const parsed = trademarkSearchResponse.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new EuipoError(-1, "/trademarks/results", parsed.error.message.slice(0, 200));
    }
    return parsed.data;
  }

  /**
   * Convenience: returns true if a verbal element has any active hit on the
   * default EUIPO+Benelux+NL offices. Used by the Discovery agent's hard gate.
   */
  async hasActiveMatch(term: string): Promise<{ hit: boolean; total: number }> {
    const r = await this.searchTrademarks({ basicSearch: term, pageSize: 1 });
    const total = r.total ?? r.tradeMarks.length;
    return { hit: total > 0, total };
  }
}
