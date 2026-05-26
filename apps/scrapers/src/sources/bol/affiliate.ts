import type { BolClient } from "./client.js";
import {
  type BolAffiliateTransactionsResponse,
  BolError,
  bolAffiliateTransactionsResponse,
} from "./types.js";

// Affiliate Reporting API v2.
const ACCEPT = "application/vnd.affiliate.v2+json";

export interface ListTransactionsArgs {
  /** ISO date (yyyy-mm-dd). Inclusive lower bound. */
  startDate: string;
  /** ISO date (yyyy-mm-dd). Inclusive upper bound. */
  endDate: string;
  /** Filter by SubID — matches our `[tenant]:[page]:[cohort]` convention. */
  subId?: string;
  page?: number;
}

/**
 * Pull affiliate transactions for the daily reconciliation job. The result
 * gets merged into the `conversions` table via SubID → `affiliate_links` lookup.
 */
export async function listTransactions(
  client: BolClient,
  args: ListTransactionsArgs,
): Promise<BolAffiliateTransactionsResponse> {
  const raw = await client.request("GET", "/affiliate/reporting/v2/transactions", {
    accept: ACCEPT,
    query: {
      "start-date": args.startDate,
      "end-date": args.endDate,
      "sub-id": args.subId,
      page: args.page ?? 1,
    },
  });
  const parsed = bolAffiliateTransactionsResponse.safeParse(raw);
  if (!parsed.success) {
    throw new BolError(-1, "/affiliate/reporting/v2/transactions", {
      detail: parsed.error.message.slice(0, 200),
    });
  }
  return parsed.data;
}
