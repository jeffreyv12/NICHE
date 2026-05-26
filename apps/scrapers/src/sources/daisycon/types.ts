import { z } from "zod";

export class DaisyconError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly endpoint: string,
    public readonly detail?: string,
  ) {
    super(`Daisycon ${httpStatus} on ${endpoint}: ${detail ?? ""}`);
    this.name = "DaisyconError";
  }
}

export class DaisyconAuthError extends DaisyconError {
  constructor(endpoint: string, status = 401) {
    super(status, endpoint);
    this.name = "DaisyconAuthError";
  }
}

export const daisyconTokenResponse = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
  refresh_token: z.string().optional(),
});
export type DaisyconTokenResponse = z.infer<typeof daisyconTokenResponse>;

export const daisyconProgram = z
  .object({
    id: z.union([z.string(), z.number()]),
    name: z.string().optional(),
    status: z.string().optional(),
    country_code: z.string().optional(),
    category_ids: z.array(z.union([z.string(), z.number()])).optional(),
    commission_groups: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();
export type DaisyconProgram = z.infer<typeof daisyconProgram>;

export const daisyconProgramsResponse = z.array(daisyconProgram);

export const daisyconTransaction = z
  .object({
    id: z.union([z.string(), z.number()]),
    program_id: z.union([z.string(), z.number()]).optional(),
    status: z.string().optional(),
    sub_id: z.string().optional(),
    sale_date: z.string().optional(),
    commission_total: z.number().optional(),
    revenue_total: z.number().optional(),
  })
  .passthrough();
export type DaisyconTransaction = z.infer<typeof daisyconTransaction>;
export const daisyconTransactionsResponse = z.array(daisyconTransaction);
