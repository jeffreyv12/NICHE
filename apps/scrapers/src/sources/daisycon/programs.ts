import type { DaisyconClient } from "./client.js";
import { DaisyconError, type DaisyconProgram, daisyconProgramsResponse } from "./types.js";

export interface ListProgramsArgs {
  /** ISO country code: "NL" | "BE" | ... */
  country_code?: string;
  page?: number;
  per_page?: number;
}

export async function listPrograms(
  client: DaisyconClient,
  args: ListProgramsArgs = {},
): Promise<DaisyconProgram[]> {
  const raw = await client.get(`/publishers/${client.publisherId}/programs`, {
    country_code: args.country_code,
    page: args.page,
    per_page: args.per_page ?? 50,
  });
  const parsed = daisyconProgramsResponse.safeParse(raw);
  if (!parsed.success) {
    throw new DaisyconError(-1, "/publishers/{id}/programs", parsed.error.message.slice(0, 200));
  }
  return parsed.data;
}
