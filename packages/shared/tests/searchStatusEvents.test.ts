import { describe, expect, it } from "vitest";
import {
  ALGORITHM_EVENT_SOURCE,
  type SearchStatusIncident,
  classifyAlgorithmEventKind,
  mapSearchStatusIncidents,
} from "../src/searchStatusEvents";

function incident(over: Partial<SearchStatusIncident> = {}): SearchStatusIncident {
  return {
    id: "ABC123",
    external_desc: "March 2026 core update",
    service_name: "Ranking",
    begin: "2026-03-27T00:00:00.000Z",
    end: "2026-04-08T00:00:00.000Z",
    affected_products: [{ title: "Ranking", id: "rank1" }],
    ...over,
  };
}

describe("classifyAlgorithmEventKind", () => {
  it.each([
    ["March 2026 core update", "core_update"],
    ["August 2025 spam update", "spam_update"],
    ["Product reviews update", "reviews_update"],
    ["Helpful content update", "helpful_content_update"],
    ["Some unannounced ranking change", "other"],
    ["", "other"],
  ])("classifies %j as %s", (label, expected) => {
    expect(classifyAlgorithmEventKind(label)).toBe(expected);
  });

  it("prefers helpful-content over the generic 'update' wording", () => {
    expect(classifyAlgorithmEventKind("September 2025 helpful content update")).toBe(
      "helpful_content_update",
    );
  });

  it("treats null/undefined as other", () => {
    expect(classifyAlgorithmEventKind(null)).toBe("other");
    expect(classifyAlgorithmEventKind(undefined)).toBe("other");
  });
});

describe("mapSearchStatusIncidents", () => {
  it("maps a ranking incident to an insert record with ISO timestamps", () => {
    const out = mapSearchStatusIncidents([incident()]);
    expect(out).toEqual([
      {
        externalId: "ABC123",
        kind: "core_update",
        name: "March 2026 core update",
        startedAt: "2026-03-27T00:00:00.000Z",
        endedAt: "2026-04-08T00:00:00.000Z",
        source: ALGORITHM_EVENT_SOURCE,
      },
    ]);
  });

  it("treats a missing/empty end as an ongoing rollout (endedAt null)", () => {
    expect(mapSearchStatusIncidents([incident({ end: null })])[0]?.endedAt).toBeNull();
    expect(mapSearchStatusIncidents([incident({ end: "" })])[0]?.endedAt).toBeNull();
    const { end: _drop, ...noEnd } = incident();
    expect(mapSearchStatusIncidents([noEnd])[0]?.endedAt).toBeNull();
  });

  it("keeps incidents whose Ranking membership is only in affected_products", () => {
    const out = mapSearchStatusIncidents([
      incident({ service_name: "Serving", affected_products: [{ title: "Ranking", id: "r" }] }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("drops incidents that do not affect Ranking (e.g. Serving/Crawling outages)", () => {
    const out = mapSearchStatusIncidents([
      incident({
        id: "X1",
        service_name: "Serving",
        affected_products: [{ title: "Serving", id: "s" }],
      }),
    ]);
    expect(out).toEqual([]);
  });

  it("keeps a ranking DISRUPTION, not just informational updates (errs toward blocking)", () => {
    const out = mapSearchStatusIncidents([
      incident({ external_desc: "Ranking systems issue", end: null }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("other");
    expect(out[0]?.endedAt).toBeNull();
  });

  it("drops rows with no id or an unparseable begin", () => {
    expect(mapSearchStatusIncidents([incident({ id: null })])).toEqual([]);
    expect(mapSearchStatusIncidents([incident({ id: "" })])).toEqual([]);
    expect(mapSearchStatusIncidents([incident({ begin: "not-a-date" })])).toEqual([]);
    expect(mapSearchStatusIncidents([incident({ begin: null })])).toEqual([]);
  });

  it("dedupes by id (last occurrence wins) and sorts by startedAt ascending", () => {
    const out = mapSearchStatusIncidents([
      incident({ id: "B", begin: "2026-05-01T00:00:00.000Z", external_desc: "May core update" }),
      incident({ id: "A", begin: "2026-03-01T00:00:00.000Z", external_desc: "March spam update" }),
      // duplicate id "B" with a corrected end → should overwrite, not duplicate
      incident({
        id: "B",
        begin: "2026-05-01T00:00:00.000Z",
        end: "2026-05-20T00:00:00.000Z",
        external_desc: "May core update",
      }),
    ]);
    expect(out.map((e) => e.externalId)).toEqual(["A", "B"]);
    expect(out[1]?.endedAt).toBe("2026-05-20T00:00:00.000Z");
  });

  it("returns an empty array for an empty feed", () => {
    expect(mapSearchStatusIncidents([])).toEqual([]);
  });
});
