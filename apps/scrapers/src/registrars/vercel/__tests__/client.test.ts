import { afterEach, describe, expect, it, vi } from "vitest";
import { VercelClient } from "../client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const OPTS = { apiToken: "vc_token", teamId: "team_1", projectId: "prj_1" };

afterEach(() => {
  vi.useRealTimers();
});

describe("VercelClient", () => {
  it("attaches a domain to the project, scoped by teamId, with Bearer auth", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ name: "example.com", verified: false }),
    );
    const client = new VercelClient({ ...OPTS, fetch: fetchImpl });

    const out = await client.attachDomain("example.com");

    expect(out).toEqual({ name: "example.com", verified: false });
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://api.vercel.com/v9/projects/prj_1/domains?teamId=team_1");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ name: "example.com" });
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer vc_token");
  });

  describe("getDomainStatus", () => {
    it("maps verified=true to active", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        jsonResponse({ name: "example.com", verified: true }),
      );
      const client = new VercelClient({ ...OPTS, fetch: fetchImpl });

      expect(await client.getDomainStatus("example.com")).toEqual({
        hostname: "example.com",
        status: "active",
      });
    });

    it("maps verified=false/absent to pending", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ name: "example.com" }));
      const client = new VercelClient({ ...OPTS, fetch: fetchImpl });

      expect((await client.getDomainStatus("example.com")).status).toBe("pending");
    });
  });

  describe("pollSslUntilActive", () => {
    it("returns true immediately when already active (no waiting)", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        jsonResponse({ name: "example.com", verified: true }),
      );
      const client = new VercelClient({ ...OPTS, fetch: fetchImpl });

      expect(await client.pollSslUntilActive("example.com")).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("polls again after the interval and resolves true once active", async () => {
      vi.useFakeTimers();
      let calls = 0;
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        calls += 1;
        return jsonResponse({ name: "example.com", verified: calls >= 2 });
      });
      const client = new VercelClient({ ...OPTS, fetch: fetchImpl });

      const pending = client.pollSslUntilActive("example.com", 60_000, 10_000);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(await pending).toBe(true);
      expect(calls).toBe(2);
    });

    it("returns false when the timeout has already elapsed", async () => {
      const fetchImpl = vi.fn<typeof fetch>(async () =>
        jsonResponse({ name: "example.com", verified: false }),
      );
      const client = new VercelClient({ ...OPTS, fetch: fetchImpl });

      // timeoutMs=0 => the deadline is now, so the loop body never runs.
      expect(await client.pollSslUntilActive("example.com", 0)).toBe(false);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  it("removeDomain issues a DELETE and tolerates an empty body", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("", { status: 200 }));
    const client = new VercelClient({ ...OPTS, fetch: fetchImpl });

    await expect(client.removeDomain("example.com")).resolves.toBeUndefined();
    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe("DELETE");
  });

  it("throws a descriptive error on a non-2xx response", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("forbidden", { status: 403 }));
    const client = new VercelClient({ ...OPTS, fetch: fetchImpl });

    await expect(client.attachDomain("example.com")).rejects.toThrow(/403 forbidden/);
  });
});
