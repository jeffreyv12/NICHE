import { z } from "zod";

export class AwinError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly endpoint: string,
    public readonly detail?: string,
  ) {
    super(`Awin ${httpStatus} on ${endpoint}: ${detail ?? ""}`);
    this.name = "AwinError";
  }
}

export class AwinAuthError extends AwinError {
  constructor(endpoint: string, status = 401) {
    super(status, endpoint);
    this.name = "AwinAuthError";
  }
}

// Programme = an advertiser's affiliate programme that a publisher is in.
// Awin returns programmes with mixed casing across endpoints; passthrough
// keeps unfamiliar fields available for downstream agents.
export const awinProgramme = z
  .object({
    id: z.union([z.string(), z.number()]),
    name: z.string().optional(),
    status: z.string().optional(),
    primaryRegion: z
      .object({ countryCode: z.string().optional(), name: z.string().optional() })
      .partial()
      .optional(),
    currencyCode: z.string().optional(),
    sectorIds: z.array(z.union([z.string(), z.number()])).optional(),
  })
  .passthrough();
export type AwinProgramme = z.infer<typeof awinProgramme>;

export const awinProgrammesResponse = z.array(awinProgramme);
export type AwinProgrammesResponse = z.infer<typeof awinProgrammesResponse>;

export const awinTransaction = z
  .object({
    id: z.union([z.string(), z.number()]),
    advertiserId: z.union([z.string(), z.number()]).optional(),
    publisherId: z.union([z.string(), z.number()]).optional(),
    commissionStatus: z.string().optional(),
    transactionDate: z.string().optional(),
    saleAmount: z
      .object({ amount: z.number().optional(), currency: z.string().optional() })
      .partial()
      .optional(),
    commissionAmount: z
      .object({ amount: z.number().optional(), currency: z.string().optional() })
      .partial()
      .optional(),
    clickRefs: z.record(z.string(), z.unknown()).optional(),
    // SubID lives under clickRefs.clickRef in current API.
  })
  .passthrough();
export type AwinTransaction = z.infer<typeof awinTransaction>;

export const awinTransactionsResponse = z.array(awinTransaction);
export type AwinTransactionsResponse = z.infer<typeof awinTransactionsResponse>;
