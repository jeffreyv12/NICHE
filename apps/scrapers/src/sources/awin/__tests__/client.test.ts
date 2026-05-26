import { describe, expect, it, vi } from "vitest";
import { AwinClient } from "../client.js";
import { listProgrammes } from "../programmes.js";
import { listTransactions } from "../transactions.js";
import { AwinAuthError, AwinError } from "../types.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(opts: { fetchImpl: typeof fetch; maxAttempts?: number }): AwinClient {
  return new AwinClient({
    credentials: { apiToken: "tok", publisherId: 12345 },
    fetchImpl: opts.fetchImpl,
    retry: {
      maxAttempts: opts.maxAttempts ?? 2,
      decide: () => ({ retry: true, delayMs: 0 }),
    },
  });
}

describe("AwinClient", () => {
  it("sends bearer token + correct path for listProgrammes", async () => {
    let calledUrl = "";
    let authHeader = "";
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      calledUrl = typeof input === "string" ? input : (input as Request).url;
      authHeader = (init?.headers as Record<string, string>).Authorization ?? "";
      return jsonResponse(200, [{ id: 1, name: "Bol.com" }]);
    });
    const client = makeClient({ fetchImpl });
    const programmes = await listProgrammes(client, { relationship: "joined" });
    expect(programmes).toHaveLength(1);
    expect(programmes[0]?.id).toBe(1);
    expect(calledUrl).toContain("/publishers/12345/programmes");
    expect(calledUrl).toContain("relationship=joined");
    expect(authHeader).toBe("Bearer tok");
  });

  it("throws AwinAuthError on 401", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(401, { error: "unauthorized" }));
    const client = makeClient({ fetchImpl, maxAttempts: 1 });
    await expect(listProgrammes(client)).rejects.toBeInstanceOf(AwinAuthError);
  });

  it("retries 503 then succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      calls++;
      if (calls === 1) return jsonResponse(503, "unavailable");
      return jsonResponse(200, []);
    });
    const client = makeClient({ fetchImpl, maxAttempts: 3 });
    const out = await listProgrammes(client);
    expect(out).toEqual([]);
    expect(calls).toBe(2);
  });

  it("rejects non-array response from programmes endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, { not: "an array" }));
    const client = makeClient({ fetchImpl, maxAttempts: 1 });
    await expect(listProgrammes(client)).rejects.toBeInstanceOf(AwinError);
  });

  it("passes transactions query params correctly", async () => {
    let calledUrl = "";
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      calledUrl = typeof input === "string" ? input : (input as Request).url;
      return jsonResponse(200, [{ id: "txn_1", commissionStatus: "approved" }]);
    });
    const client = makeClient({ fetchImpl });
    const tx = await listTransactions(client, {
      startDate: "2026-05-01T00:00:00",
      endDate: "2026-05-02T00:00:00",
      status: "approved",
    });
    expect(tx).toHaveLength(1);
    expect(calledUrl).toContain("startDate=2026-05-01T00%3A00%3A00");
    expect(calledUrl).toContain("status=approved");
    expect(calledUrl).toContain("timezone=Europe%2FAmsterdam");
  });
});
