import { describe, expect, it, vi } from "vitest";
import { DaisyconClient } from "../client.js";
import { listPrograms } from "../programs.js";
import { listTransactions } from "../transactions.js";
import { DaisyconAuthError, DaisyconError } from "../types.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(opts: {
  fetchImpl: typeof fetch;
  maxAttempts?: number;
  now?: () => number;
}): DaisyconClient {
  return new DaisyconClient({
    credentials: { clientId: "cid", clientSecret: "sec", publisherId: 7 },
    fetchImpl: opts.fetchImpl,
    now: opts.now,
    retry: {
      maxAttempts: opts.maxAttempts ?? 2,
      decide: () => ({ retry: true, delayMs: 0 }),
    },
  });
}

describe("DaisyconClient", () => {
  it("posts client_credentials to /oauth/access-token and reuses the token", async () => {
    let tokenCalls = 0;
    let bearerSeen = "";
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/oauth/access-token")) {
        tokenCalls++;
        const body = init?.body as string;
        expect(body).toContain("grant_type=client_credentials");
        expect(body).toContain("client_id=cid");
        expect(body).toContain("client_secret=sec");
        return jsonResponse(200, {
          access_token: "tkn",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      bearerSeen = (init?.headers as Record<string, string>).Authorization ?? "";
      return jsonResponse(200, [{ id: 1, name: "Coolblue" }]);
    });
    const client = makeClient({ fetchImpl });
    await listPrograms(client);
    await listPrograms(client);
    expect(tokenCalls).toBe(1);
    expect(bearerSeen).toBe("Bearer tkn");
  });

  it("returns DaisyconAuthError when the token endpoint refuses creds", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(401, "no"));
    const client = makeClient({ fetchImpl, maxAttempts: 1 });
    await expect(listPrograms(client)).rejects.toBeInstanceOf(DaisyconAuthError);
  });

  it("drops cached token on resource-endpoint 401 and re-auths", async () => {
    let tokenCalls = 0;
    let resourceCalls = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/oauth/access-token")) {
        tokenCalls++;
        return jsonResponse(200, {
          access_token: `t_${tokenCalls}`,
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      resourceCalls++;
      if (resourceCalls === 1) return jsonResponse(401, "stale");
      return jsonResponse(200, [{ id: "txn", status: "approved" }]);
    });
    const client = makeClient({ fetchImpl, maxAttempts: 3 });
    const tx = await listTransactions(client, {
      start_date: "2026-05-01",
      end_date: "2026-05-02",
    });
    expect(tx).toHaveLength(1);
    expect(tokenCalls).toBe(2);
  });

  it("Zod-rejects malformed programs response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.endsWith("/oauth/access-token")) {
        return jsonResponse(200, {
          access_token: "t",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      return jsonResponse(200, { not: "array" });
    });
    const client = makeClient({ fetchImpl, maxAttempts: 1 });
    await expect(listPrograms(client)).rejects.toBeInstanceOf(DaisyconError);
  });
});
