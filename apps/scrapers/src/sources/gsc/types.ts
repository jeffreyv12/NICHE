import { z } from "zod";

// ---------------------------------------------------------------------------
// Service-account credential shape (from GSC_SERVICE_ACCOUNT_JSON env var).
// ---------------------------------------------------------------------------

export const serviceAccountJson = z.object({
  type: z.literal("service_account"),
  project_id: z.string(),
  private_key_id: z.string(),
  private_key: z.string(),
  client_email: z.string().email(),
  token_uri: z.string().url().default("https://oauth2.googleapis.com/token"),
});
export type ServiceAccountJson = z.infer<typeof serviceAccountJson>;

// ---------------------------------------------------------------------------
// GSC Search Analytics — request / response Zod schemas.
// API ref: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
// ---------------------------------------------------------------------------

export type GscDimension = "date" | "query" | "page" | "country" | "device";

export const gscApiRow = z.object({
  keys: z.array(z.string()),
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number(),
  position: z.number(),
});
export type GscApiRow = z.infer<typeof gscApiRow>;

export const gscQueryResponse = z.object({
  rows: z.array(gscApiRow).optional().default([]),
  responseAggregationType: z.string().optional(),
});
export type GscQueryResponse = z.infer<typeof gscQueryResponse>;

export interface GscQueryRequest {
  startDate: string; // YYYY-MM-DD
  endDate: string;
  dimensions?: GscDimension[];
  rowLimit?: number;
  startRow?: number;
  dimensionFilterGroups?: unknown[];
}

// ---------------------------------------------------------------------------
// GscError
// ---------------------------------------------------------------------------

export class GscError extends Error {
  constructor(
    public readonly status: number,
    public readonly siteUrl: string,
    detail: string,
  ) {
    super(`GSC ${status} for ${siteUrl}: ${detail}`);
    this.name = "GscError";
  }
}
