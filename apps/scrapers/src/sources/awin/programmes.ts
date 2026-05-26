import type { AwinClient } from "./client.js";
import { AwinError, type AwinProgrammesResponse, awinProgrammesResponse } from "./types.js";

export interface ListProgrammesArgs {
  /** Awin programme join status: joined | pending | suspended | declined. */
  relationship?: "joined" | "pending" | "suspended" | "declined";
  /** ISO country code filter, e.g. "NL", "BE". */
  countryCode?: string;
}

/** List programmes the publisher has a relationship with. */
export async function listProgrammes(
  client: AwinClient,
  args: ListProgrammesArgs = {},
): Promise<AwinProgrammesResponse> {
  const raw = await client.get(`/publishers/${client.publisherId}/programmes`, {
    relationship: args.relationship,
    countryCode: args.countryCode,
  });
  const parsed = awinProgrammesResponse.safeParse(raw);
  if (!parsed.success) {
    throw new AwinError(-1, "/publishers/{id}/programmes", parsed.error.message.slice(0, 200));
  }
  return parsed.data;
}
