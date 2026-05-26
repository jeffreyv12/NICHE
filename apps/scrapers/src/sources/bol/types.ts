import { z } from "zod";

// Bol.com API errors are returned as JSON with `type`, `title`, `status`,
// `detail` (RFC 7807-ish). We keep the shape forgiving — Bol has changed it
// before and we don't want a key rename to crash the whole nightly job.
export const bolErrorBody = z
  .object({
    type: z.string().optional(),
    title: z.string().optional(),
    status: z.number().optional(),
    detail: z.string().optional(),
    host: z.string().optional(),
  })
  .passthrough();
export type BolErrorBody = z.infer<typeof bolErrorBody>;

export class BolError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly endpoint: string,
    public readonly body?: BolErrorBody,
  ) {
    super(`Bol ${httpStatus} on ${endpoint}: ${body?.title ?? body?.detail ?? ""}`);
    this.name = "BolError";
  }
}

export class BolAuthError extends BolError {
  constructor(endpoint: string, status = 401) {
    super(status, endpoint);
    this.name = "BolAuthError";
  }
}

// OAuth2 client_credentials token response. Bol returns `expires_in` seconds.
export const bolTokenResponse = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
});
export type BolTokenResponse = z.infer<typeof bolTokenResponse>;

// Marketing Catalog API v10 — product search-by-term subset.
// We only validate the fields we actually consume downstream; the rest is
// kept via passthrough so future fields don't break old runs.
export const bolCatalogProduct = z
  .object({
    ean: z.string(),
    title: z.string().optional(),
    summary: z.string().optional(),
    rating: z.number().optional(),
    reviews: z.number().int().optional(),
    offerData: z
      .object({
        countOffers: z.number().int().optional(),
        fromPrice: z.number().optional(),
      })
      .partial()
      .optional(),
    categories: z
      .array(
        z
          .object({ id: z.union([z.string(), z.number()]).optional(), name: z.string().optional() })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
export type BolCatalogProduct = z.infer<typeof bolCatalogProduct>;

export const bolCatalogSearchResponse = z
  .object({
    products: z.array(bolCatalogProduct).default([]),
    totalResultSize: z.number().int().optional(),
  })
  .passthrough();
export type BolCatalogSearchResponse = z.infer<typeof bolCatalogSearchResponse>;

// Affiliate Reporting API v2 — transaction row.
export const bolAffiliateTransaction = z
  .object({
    id: z.union([z.string(), z.number()]),
    subId: z.string().optional(),
    clickDate: z.string().optional(),
    orderDate: z.string().optional(),
    status: z.string().optional(),
    commission: z.number().optional(),
    productEan: z.string().optional(),
  })
  .passthrough();
export type BolAffiliateTransaction = z.infer<typeof bolAffiliateTransaction>;

export const bolAffiliateTransactionsResponse = z
  .object({
    transactions: z.array(bolAffiliateTransaction).default([]),
  })
  .passthrough();
export type BolAffiliateTransactionsResponse = z.infer<typeof bolAffiliateTransactionsResponse>;
