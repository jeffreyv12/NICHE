import { describe, expect, it, vi } from "vitest";
import { SearchStatusClient, SearchStatusError } from "../google-search-status/index.js";

function jsonFetch(status: number, body: unknown): typeof fetch {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  ) as typeof fetch;
}

const RANKING_INCIDENT = {
  id: "incident-1",
  external_desc: "March 2026 core update",
  service_name: "Ranking",
  begin: "2026-03-27T00:00:00.000Z",
  end: "2026-04-08T00:00:00.000Z",
  affected_products: [{ title: "Ranking", id: "rank1" }],
};

const SERVING_OUTAGE = {
  id: "incident-2",
  external_desc: "Serving latency",
  service_name: "Serving",
  begin: "2026-05-01T00:00:00.000Z",
  end: "2026-05-01T03:00:00.000Z",
  affected_products: [{ title: "Serving", id: "serv1" }],
};

describe("SearchStatusClient.fetchIncidents", () => {
  it("GETs incidents.json with the project User-Agent and returns the parsed feed", async () => {
    let calledUrl = "";
    let calledHeaders: Record<string, string> = {};
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      calledUrl = typeof input === "string" ? input : (input as Request).url;
      calledHeaders = Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      );
      return new Response(JSON.stringify([RANKING_INCIDENT]), { status: 200 });
    }) as typeof fetch;

    const client = new SearchStatusClient({ fetchImpl });
    const feed = await client.fetchIncidents();

    expect(calledUrl).toBe("https://status.search.google.com/incidents.json");
    expect(calledHeaders["User-Agent"]).toContain("NicheFinder/1.0");
    expect(feed).toHaveLength(1);
    expect(feed[0]?.id).toBe("incident-1");
  });

  it("throws SearchStatusError on a non-2xx response", async () => {
    const client = new SearchStatusClient({ fetchImpl: jsonFetch(503, "unavailable") });
    await expect(client.fetchIncidents()).rejects.toBeInstanceOf(SearchStatusError);
  });

  it("throws SearchStatusError on invalid JSON", async () => {
    const client = new SearchStatusClient({ fetchImpl: jsonFetch(200, "<<not json>>") });
    await expect(client.fetchIncidents()).rejects.toBeInstanceOf(SearchStatusError);
  });

  it("tolerates unknown extra fields (passthrough schema)", async () => {
    const withExtra = { ...RANKING_INCIDENT, number: 42, severity: "low", unexpected: true };
    const client = new SearchStatusClient({ fetchImpl: jsonFetch(200, [withExtra]) });
    const feed = await client.fetchIncidents();
    expect(feed[0]?.id).toBe("incident-1");
  });
});

describe("SearchStatusClient.fetchRankingEvents", () => {
  it("maps the feed to ranking-only algorithm_events inserts", async () => {
    const client = new SearchStatusClient({
      fetchImpl: jsonFetch(200, [RANKING_INCIDENT, SERVING_OUTAGE]),
    });
    const events = await client.fetchRankingEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      externalId: "incident-1",
      kind: "core_update",
      source: "google_search_status",
      endedAt: "2026-04-08T00:00:00.000Z",
    });
  });
});
