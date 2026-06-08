import { fetchGscAccessToken } from "./auth.js";
import {
  GscError,
  type GscQueryRequest,
  type GscQueryResponse,
  type ServiceAccountJson,
  gscQueryResponse,
} from "./types.js";

const GSC_BASE = "https://searchconsole.googleapis.com/webmasters/v3";
const USER_AGENT = "NicheFinder/1.0 (+https://expertgids.nl/about-bot)";

export interface GscClientOptions {
  serviceAccount: ServiceAccountJson;
  fetchImpl?: typeof fetch;
}

export class GscClient {
  private readonly account: ServiceAccountJson;
  private readonly fetchImpl: typeof fetch;
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(opts: GscClientOptions) {
    this.account = opts.serviceAccount;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async token(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.token;
    }
    const access = await fetchGscAccessToken(this.account, this.fetchImpl);
    this.tokenCache = { token: access, expiresAt: now + 3_600_000 };
    return access;
  }

  /**
   * Run a Search Analytics query for a specific GSC property.
   *
   * @param siteUrl - The site as registered in GSC, e.g. "sc-domain:example.com"
   *                  or "https://example.com/" (URL-prefix property).
   */
  async querySearchAnalytics(siteUrl: string, request: GscQueryRequest): Promise<GscQueryResponse> {
    const tok = await this.token();
    const encoded = encodeURIComponent(siteUrl);
    const url = `${GSC_BASE}/sites/${encoded}/searchAnalytics/query`;

    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({
        startDate: request.startDate,
        endDate: request.endDate,
        dimensions: request.dimensions ?? ["date"],
        rowLimit: request.rowLimit ?? 1000,
        startRow: request.startRow ?? 0,
        ...(request.dimensionFilterGroups
          ? { dimensionFilterGroups: request.dimensionFilterGroups }
          : {}),
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new GscError(res.status, siteUrl, text.slice(0, 200));
    }

    const raw = await res.json();
    return gscQueryResponse.parse(raw);
  }
}
