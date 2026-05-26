import type { BolClient } from "./client.js";
import { type BolCatalogSearchResponse, BolError, bolCatalogSearchResponse } from "./types.js";

// Marketing Catalog API v10. Accept header pins the version.
const ACCEPT = "application/vnd.advertiser.v10+json";

export interface CatalogSearchArgs {
  searchTerm: string;
  /** 1-based page index per Bol convention. */
  page?: number;
  /** Bol caps this at 50 in v10. */
  limit?: number;
  /** Category ID to constrain the search. */
  categoryId?: string | number;
  countryCode?: "NL" | "BE";
}

/**
 * Search the Bol catalog by free-text term. Used by Discovery to estimate
 * commercial intent for a niche (number of offers, price spread, top-listed
 * categories) without spending DataForSEO quota on the same lookup.
 */
export async function searchCatalog(
  client: BolClient,
  args: CatalogSearchArgs,
): Promise<BolCatalogSearchResponse> {
  const raw = await client.request("GET", "/marketing/v10/products/search", {
    accept: ACCEPT,
    query: {
      "search-term": args.searchTerm,
      page: args.page ?? 1,
      limit: args.limit ?? 25,
      "category-id": args.categoryId,
      "country-code": args.countryCode ?? "NL",
    },
  });
  const parsed = bolCatalogSearchResponse.safeParse(raw);
  if (!parsed.success) {
    throw new BolError(-1, "/marketing/v10/products/search", {
      detail: parsed.error.message.slice(0, 200),
    });
  }
  return parsed.data;
}
