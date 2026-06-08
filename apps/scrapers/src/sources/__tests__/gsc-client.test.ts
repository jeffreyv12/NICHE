import { describe, expect, it, vi } from "vitest";
import { GscClient } from "../gsc/client.js";
import { GscError } from "../gsc/types.js";

// Mock auth so unit tests don't need a real RSA private key.
vi.mock("../gsc/auth.js", () => ({
  fetchGscAccessToken: vi.fn(async () => "tok_test"),
}));

import { fetchGscAccessToken } from "../gsc/auth.js";

const FAKE_ACCOUNT = {
  type: "service_account" as const,
  project_id: "test",
  private_key_id: "k1",
  private_key: "-----BEGIN RSA PRIVATE KEY-----\nFAKE\n-----END RSA PRIVATE KEY-----",
  client_email: "test@test.iam.gserviceaccount.com",
  token_uri: "https://oauth2.googleapis.com/token",
};

function jsonFetch(status: number, body: unknown): typeof fetch {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  ) as typeof fetch;
}

describe("GscClient.querySearchAnalytics", () => {
  it("calls searchAnalytics endpoint with Bearer token and correct URL-encoded siteUrl", async () => {
    let calledUrl = "";
    let calledHeaders: Record<string, string> = {};
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      calledUrl = typeof input === "string" ? input : (input as Request).url;
      calledHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      );
      return new Response(JSON.stringify({ rows: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const client = new GscClient({ serviceAccount: FAKE_ACCOUNT, fetchImpl: fetchMock });
    await client.querySearchAnalytics("sc-domain:example.com", {
      startDate: "2026-06-01",
      endDate: "2026-06-02",
    });

    expect(calledUrl).toContain("sc-domain%3Aexample.com");
    expect(calledUrl).toContain("searchAnalytics/query");
    expect(calledHeaders.Authorization).toBe("Bearer tok_test");
  });

  it("URL-encodes URL-prefix siteUrl (https://...)", async () => {
    let calledUrl = "";
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      calledUrl = typeof input === "string" ? input : (input as Request).url;
      return new Response(JSON.stringify({ rows: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const client = new GscClient({ serviceAccount: FAKE_ACCOUNT, fetchImpl: fetchMock });
    await client.querySearchAnalytics("https://example.com/", {
      startDate: "2026-06-01",
      endDate: "2026-06-01",
    });
    expect(calledUrl).toContain("https%3A%2F%2Fexample.com%2F");
  });

  it("parses and returns rows from the response", async () => {
    const analyticsBody = {
      rows: [
        { keys: ["2026-06-01"], clicks: 120, impressions: 1800, ctr: 0.067, position: 4.2 },
        { keys: ["2026-06-02"], clicks: 95, impressions: 1500, ctr: 0.063, position: 4.5 },
      ],
    };
    const client = new GscClient({
      serviceAccount: FAKE_ACCOUNT,
      fetchImpl: jsonFetch(200, analyticsBody),
    });
    const result = await client.querySearchAnalytics("sc-domain:example.com", {
      startDate: "2026-06-01",
      endDate: "2026-06-02",
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.clicks).toBe(120);
  });

  it("throws GscError on non-200 response", async () => {
    const client = new GscClient({
      serviceAccount: FAKE_ACCOUNT,
      fetchImpl: jsonFetch(403, { error: "Forbidden" }),
    });
    await expect(
      client.querySearchAnalytics("sc-domain:example.com", {
        startDate: "2026-06-01",
        endDate: "2026-06-01",
      }),
    ).rejects.toBeInstanceOf(GscError);
  });

  it("reuses cached token — fetchGscAccessToken called only once for multiple queries", async () => {
    const mockAuth = vi.mocked(fetchGscAccessToken);
    mockAuth.mockClear();

    const client = new GscClient({
      serviceAccount: FAKE_ACCOUNT,
      fetchImpl: jsonFetch(200, { rows: [] }),
    });
    await client.querySearchAnalytics("sc-domain:a.com", {
      startDate: "2026-06-01",
      endDate: "2026-06-01",
    });
    await client.querySearchAnalytics("sc-domain:a.com", {
      startDate: "2026-06-02",
      endDate: "2026-06-02",
    });
    expect(mockAuth).toHaveBeenCalledTimes(1);
  });
});
