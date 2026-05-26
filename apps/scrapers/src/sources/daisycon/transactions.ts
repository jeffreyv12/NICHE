import type { DaisyconClient } from "./client.js";
import { DaisyconError, type DaisyconTransaction, daisyconTransactionsResponse } from "./types.js";

export interface ListTransactionsArgs {
  /** ISO date yyyy-mm-dd. */
  start_date: string;
  end_date: string;
  status?: "open" | "pending" | "approved" | "disapproved";
  sub_id?: string;
  page?: number;
  per_page?: number;
}

export async function listTransactions(
  client: DaisyconClient,
  args: ListTransactionsArgs,
): Promise<DaisyconTransaction[]> {
  const raw = await client.get(`/publishers/${client.publisherId}/transactions`, {
    start_date: args.start_date,
    end_date: args.end_date,
    status: args.status,
    sub_id: args.sub_id,
    page: args.page,
    per_page: args.per_page ?? 100,
  });
  const parsed = daisyconTransactionsResponse.safeParse(raw);
  if (!parsed.success) {
    throw new DaisyconError(
      -1,
      "/publishers/{id}/transactions",
      parsed.error.message.slice(0, 200),
    );
  }
  return parsed.data;
}
