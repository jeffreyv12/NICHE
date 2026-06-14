import { describe, expect, it, vi } from "vitest";
import { CloudflareClient } from "../client";

// Cloudflare always answers with a {success, result, errors} envelope.
function cfResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  return init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
}

const ACCOUNT = "acct_123";
const TOKEN = "cf_token_abc";

describe("CloudflareClient", () => {
  it("sends Bearer auth on every request", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      cfResponse({ success: true, result: { id: "z1", name: "example.com" } }),
    );
    const client = new CloudflareClient({ accountId: ACCOUNT, apiToken: TOKEN, fetch: fetchImpl });

    await client.createZone("example.com");

    const init = fetchImpl.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  describe("checkDomainAvailability", () => {
    it("reports available + price when supported and unregistered", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        cfResponse({ success: true, result: { supported: true, price: 9.5 } }),
      );
      const client = new CloudflareClient({
        accountId: ACCOUNT,
        apiToken: TOKEN,
        fetch: fetchImpl,
      });

      const out = await client.checkDomainAvailability("example.com");

      expect(out).toEqual({ hostname: "example.com", available: true, price_eur_year: 9.5 });
      const url = fetchImpl.mock.calls[0]?.[0] as string;
      expect(url).toContain(`/accounts/${ACCOUNT}/registrar/domains/example.com`);
    });

    it("swallows API errors and reports unavailable", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        cfResponse({ success: false, errors: [{ code: 1001 }] }),
      );
      const client = new CloudflareClient({
        accountId: ACCOUNT,
        apiToken: TOKEN,
        fetch: fetchImpl,
      });

      const out = await client.checkDomainAvailability("taken.com");

      expect(out).toEqual({ hostname: "taken.com", available: false, price_eur_year: null });
    });
  });

  describe("registerDomain", () => {
    it("POSTs with auto_renew and maps the result", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        cfResponse({
          success: true,
          result: { id: "dom_1", name: "example.com", expires_at: "2027-06-14T00:00:00Z" },
        }),
      );
      const client = new CloudflareClient({
        accountId: ACCOUNT,
        apiToken: TOKEN,
        fetch: fetchImpl,
      });

      const out = await client.registerDomain("example.com");

      expect(out).toEqual({
        id: "dom_1",
        hostname: "example.com",
        expires_at: "2027-06-14T00:00:00Z",
      });
      const [, init] = fetchImpl.mock.calls[0] ?? [];
      expect(init?.method).toBe("POST");
      expect(bodyOf(init)).toEqual({ auto_renew: true });
    });

    it("honours autoRenew=false", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        cfResponse({ success: true, result: { id: "d", name: "x.com", expires_at: "2027" } }),
      );
      const client = new CloudflareClient({
        accountId: ACCOUNT,
        apiToken: TOKEN,
        fetch: fetchImpl,
      });

      await client.registerDomain("x.com", false);

      expect(bodyOf(fetchImpl.mock.calls[0]?.[1])).toEqual({ auto_renew: false });
    });

    it("throws when the API envelope reports failure", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        cfResponse({ success: false, errors: [{ code: 1004, message: "boom" }] }),
      );
      const client = new CloudflareClient({
        accountId: ACCOUNT,
        apiToken: TOKEN,
        fetch: fetchImpl,
      });

      await expect(client.registerDomain("x.com")).rejects.toThrow(/Cloudflare API error/);
    });
  });

  describe("DNS records", () => {
    it("createZone posts a full, non-jump-start zone tied to the account", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        cfResponse({ success: true, result: { id: "z9", name: "example.com" } }),
      );
      const client = new CloudflareClient({
        accountId: ACCOUNT,
        apiToken: TOKEN,
        fetch: fetchImpl,
      });

      const zone = await client.createZone("example.com");

      expect(zone).toEqual({ id: "z9", name: "example.com" });
      expect(bodyOf(fetchImpl.mock.calls[0]?.[1])).toEqual({
        name: "example.com",
        account: { id: ACCOUNT },
        jump_start: false,
        type: "full",
      });
    });

    it("getZone returns the first match or null", async () => {
      const withMatch = vi.fn<typeof fetch>(async () =>
        cfResponse({ success: true, result: [{ id: "z1", name: "example.com" }] }),
      );
      const empty = vi.fn<typeof fetch>(async () => cfResponse({ success: true, result: [] }));

      const c1 = new CloudflareClient({ accountId: ACCOUNT, apiToken: TOKEN, fetch: withMatch });
      const c2 = new CloudflareClient({ accountId: ACCOUNT, apiToken: TOKEN, fetch: empty });

      expect(await c1.getZone("example.com")).toEqual({ id: "z1", name: "example.com" });
      expect(await c2.getZone("nope.com")).toBeNull();
    });

    it("createARecord proxies a TTL-auto A record", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        cfResponse({
          success: true,
          result: { id: "r1", type: "A", name: "@", content: "1.2.3.4" },
        }),
      );
      const client = new CloudflareClient({
        accountId: ACCOUNT,
        apiToken: TOKEN,
        fetch: fetchImpl,
      });

      await client.createARecord("z1", "@", "1.2.3.4");

      const [url, init] = fetchImpl.mock.calls[0] ?? [];
      expect(url).toContain("/zones/z1/dns_records");
      expect(bodyOf(init)).toEqual({
        type: "A",
        name: "@",
        content: "1.2.3.4",
        ttl: 1,
        proxied: true,
      });
    });

    it("createTxtRecord is unproxied with a 300s TTL (verification records must resolve)", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        cfResponse({
          success: true,
          result: { id: "r2", type: "TXT", name: "_acme", content: "v=1" },
        }),
      );
      const client = new CloudflareClient({
        accountId: ACCOUNT,
        apiToken: TOKEN,
        fetch: fetchImpl,
      });

      await client.createTxtRecord("z1", "_acme", "v=1");

      expect(bodyOf(fetchImpl.mock.calls[0]?.[1])).toEqual({
        type: "TXT",
        name: "_acme",
        content: "v=1",
        ttl: 300,
        proxied: false,
      });
    });
  });
});
