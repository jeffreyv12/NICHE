import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { TransipClient } from "../client";

// A real RSA key is required because the client signs the auth body with
// RSA-SHA512. Generate one per test run and feed it in base64-encoded,
// exactly as TRANSIP_PRIVATE_KEY would be supplied in production.
function makePrivateKeyBase64(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  return Buffer.from(pem, "utf-8").toString("base64");
}

const LOGIN = "operator";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A mock fetch that answers /auth then delegates other paths to `handler`. */
function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.endsWith("/auth")) {
      return jsonResponse({ token: "jwt_token_xyz" });
    }
    return handler(url, init ?? undefined);
  });
}

function newClient(fetchImpl: ReturnType<typeof mockFetch>): TransipClient {
  return new TransipClient({
    login: LOGIN,
    privateKeyBase64: makePrivateKeyBase64(),
    fetch: fetchImpl,
  });
}

describe("TransipClient", () => {
  it("authenticates once and reuses the cached token across requests", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ status: "free" }));
    const client = newClient(fetchImpl);

    await client.checkAvailability("voorbeeld.nl");
    await client.checkAvailability("ander.nl");

    const authCalls = fetchImpl.mock.calls.filter(([input]) =>
      (typeof input === "string" ? input : (input as Request).url).endsWith("/auth"),
    );
    expect(authCalls).toHaveLength(1);
  });

  it("attaches the cached Bearer token to API requests", async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ status: "free" }));
    const client = newClient(fetchImpl);

    await client.checkAvailability("voorbeeld.nl");

    const apiCall = fetchImpl.mock.calls.find(([input]) =>
      (typeof input === "string" ? input : (input as Request).url).includes("/domains/whois"),
    );
    expect((apiCall?.[1]?.headers as Record<string, string>).Authorization).toBe(
      "Bearer jwt_token_xyz",
    );
  });

  describe("checkAvailability", () => {
    it("treats status 'free' as available", async () => {
      const client = newClient(mockFetch(() => jsonResponse({ status: "free" })));
      expect(await client.checkAvailability("vrij.nl")).toEqual({
        hostname: "vrij.nl",
        available: true,
        price_eur_year: null,
      });
    });

    it("treats a registered domain as unavailable", async () => {
      const client = newClient(mockFetch(() => jsonResponse({ status: "registered" })));
      expect((await client.checkAvailability("bezet.nl")).available).toBe(false);
    });

    it("swallows errors (e.g. 404 whois) and reports unavailable", async () => {
      const client = newClient(mockFetch(() => jsonResponse({ message: "not found" }, 404)));
      expect((await client.checkAvailability("kapot.nl")).available).toBe(false);
    });
  });

  describe("registerDomain", () => {
    it("POSTs the domain envelope and tolerates a 201 empty-body success", async () => {
      // TransIP answers POST /domains with 201 Created and NO body.
      // The client must not choke on JSON.parse("").
      const fetchImpl = mockFetch((url, init) => {
        expect(url).toBe("https://api.transip.nl/v6/domains");
        expect(init?.method).toBe("POST");
        expect(JSON.parse(init?.body as string)).toEqual({
          domain: { name: "nieuw.nl", contacts: [], nameservers: [], dnsEntries: [] },
        });
        return new Response("", { status: 201 });
      });
      const client = newClient(fetchImpl);

      await expect(client.registerDomain("nieuw.nl")).resolves.toBeUndefined();
    });

    it("throws on a non-2xx registration failure", async () => {
      const client = newClient(mockFetch(() => jsonResponse({ error: "taken" }, 409)));
      await expect(client.registerDomain("bezet.nl")).rejects.toThrow(
        /TransIP POST \/domains failed/,
      );
    });
  });

  describe("addDnsEntry", () => {
    it("POSTs a dnsEntry with expire mapped from ttl, tolerating a 201 empty body", async () => {
      const fetchImpl = mockFetch((url, init) => {
        expect(url).toBe("https://api.transip.nl/v6/domains/voorbeeld.nl/dns");
        expect(JSON.parse(init?.body as string)).toEqual({
          dnsEntry: { name: "@", type: "A", expire: 3600, content: "1.2.3.4" },
        });
        return new Response("", { status: 201 });
      });
      const client = newClient(fetchImpl);

      await expect(
        client.addDnsEntry("voorbeeld.nl", "A", "@", "1.2.3.4", 3600),
      ).resolves.toBeUndefined();
    });

    it("defaults TTL to 300 when omitted", async () => {
      let seen: Record<string, unknown> = {};
      const fetchImpl = mockFetch((_url, init) => {
        seen = JSON.parse(init?.body as string) as Record<string, unknown>;
        return new Response("", { status: 201 });
      });
      const client = newClient(fetchImpl);

      await client.addDnsEntry("voorbeeld.nl", "CNAME", "www", "voorbeeld.nl");

      expect((seen.dnsEntry as { expire: number }).expire).toBe(300);
    });
  });

  it("handles a 204 No Content response", async () => {
    const fetchImpl = mockFetch(() => new Response(null, { status: 204 }));
    const client = newClient(fetchImpl);
    await expect(client.registerDomain("leeg.nl")).resolves.toBeUndefined();
  });
});
