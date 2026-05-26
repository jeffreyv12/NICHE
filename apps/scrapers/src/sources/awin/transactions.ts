import type { AwinClient } from "./client.js";
import { AwinError, type AwinTransactionsResponse, awinTransactionsResponse } from "./types.js";

export interface ListTransactionsArgs {
  /** ISO datetime; Awin requires the trailing "T00:00:00" or similar. */
  startDate: string;
  endDate: string;
  /** "transaction" (default) | "click" | "pending". */
  timezone?: string;
  dateType?: "transaction" | "validation";
  status?: "pending" | "approved" | "declined" | "deleted";
}

export async function listTransactions(
  client: AwinClient,
  args: ListTransactionsArgs,
): Promise<AwinTransactionsResponse> {
  const raw = await client.get(`/publishers/${client.publisherId}/transactions/`, {
    startDate: args.startDate,
    endDate: args.endDate,
    timezone: args.timezone ?? "Europe/Amsterdam",
    dateType: args.dateType ?? "transaction",
    status: args.status,
  });
  const parsed = awinTransactionsResponse.safeParse(raw);
  if (!parsed.success) {
    throw new AwinError(-1, "/publishers/{id}/transactions/", parsed.error.message.slice(0, 200));
  }
  return parsed.data;
}
