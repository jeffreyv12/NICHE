import { describe, expect, it } from "vitest";
import {
  type PageClicksRow,
  normalizeGscPagePath,
  rollupNicheMonthlyOrganicClicks,
  tenantPathKey,
} from "../src/gscPageMetrics";

describe("normalizeGscPagePath", () => {
  it("strips scheme + host from an absolute URL, leaving the path", () => {
    expect(normalizeGscPagePath("https://example.com/test/koffie/beste-machine")).toBe(
      "/test/koffie/beste-machine",
    );
  });

  it("strips the query string and fragment", () => {
    expect(normalizeGscPagePath("https://example.com/test/koffie?utm_source=x#top")).toBe(
      "/test/koffie",
    );
    expect(normalizeGscPagePath("/test/koffie?a=1")).toBe("/test/koffie");
    expect(normalizeGscPagePath("/test/koffie#frag")).toBe("/test/koffie");
  });

  it("removes a trailing slash but keeps the root path", () => {
    expect(normalizeGscPagePath("https://example.com/test/koffie/")).toBe("/test/koffie");
    expect(normalizeGscPagePath("/test/koffie/")).toBe("/test/koffie");
    expect(normalizeGscPagePath("https://example.com/")).toBe("/");
    expect(normalizeGscPagePath("/")).toBe("/");
  });

  it("treats a URL with no path as root", () => {
    expect(normalizeGscPagePath("https://example.com")).toBe("/");
  });

  it("accepts a bare path and ensures a leading slash", () => {
    expect(normalizeGscPagePath("test/koffie")).toBe("/test/koffie");
  });

  it("decodes percent-encoding so it matches a stored decoded full_path", () => {
    expect(normalizeGscPagePath("https://example.com/test/koffie%2Dgear")).toBe(
      "/test/koffie-gear",
    );
  });

  it("is idempotent — normalizing an already-normalized path is a no-op", () => {
    const once = normalizeGscPagePath("https://example.com/test/koffie/");
    expect(normalizeGscPagePath(once)).toBe(once);
  });
});

describe("tenantPathKey", () => {
  it("is deterministic and distinguishes tenants on the same path", () => {
    expect(tenantPathKey("t1", "/x")).toBe(tenantPathKey("t1", "/x"));
    expect(tenantPathKey("t1", "/x")).not.toBe(tenantPathKey("t2", "/x"));
  });
});

describe("rollupNicheMonthlyOrganicClicks", () => {
  const map = new Map<string, string>([
    [tenantPathKey("t1", "/test/koffie/beste-machine"), "n1"],
    [tenantPathKey("t1", "/test/koffie/melkopschuimer"), "n1"],
    [tenantPathKey("t1", "/test/thee/beste-thee"), "n2"],
  ]);

  function row(over: Partial<PageClicksRow> = {}): PageClicksRow {
    return {
      tenantId: "t1",
      pagePath: "/test/koffie/beste-machine",
      date: "2026-05-15",
      clicks: 10,
      ...over,
    };
  }

  it("sums clicks per niche per month across that niche's pages", () => {
    const out = rollupNicheMonthlyOrganicClicks(
      [
        row({ pagePath: "/test/koffie/beste-machine", clicks: 10 }),
        row({ pagePath: "/test/koffie/melkopschuimer", clicks: 5 }),
      ],
      map,
    );
    expect(out).toEqual([{ nicheId: "n1", month: "2026-05-01", organicClicks: 15 }]);
  });

  it("splits buckets by niche and by month", () => {
    const out = rollupNicheMonthlyOrganicClicks(
      [
        row({ pagePath: "/test/koffie/beste-machine", date: "2026-04-30", clicks: 4 }),
        row({ pagePath: "/test/koffie/beste-machine", date: "2026-05-01", clicks: 6 }),
        row({ pagePath: "/test/thee/beste-thee", date: "2026-05-20", clicks: 9 }),
      ],
      map,
    );
    expect(out).toHaveLength(3);
    expect(out).toContainEqual({ nicheId: "n1", month: "2026-04-01", organicClicks: 4 });
    expect(out).toContainEqual({ nicheId: "n1", month: "2026-05-01", organicClicks: 6 });
    expect(out).toContainEqual({ nicheId: "n2", month: "2026-05-01", organicClicks: 9 });
  });

  it("matches despite trailing-slash / query differences between GSC and full_path", () => {
    const out = rollupNicheMonthlyOrganicClicks(
      [row({ pagePath: "https://example.com/test/koffie/beste-machine/?utm=1", clicks: 7 })],
      map,
    );
    expect(out).toEqual([{ nicheId: "n1", month: "2026-05-01", organicClicks: 7 }]);
  });

  it("drops clicks on a page that maps to no niche (unattributable)", () => {
    const out = rollupNicheMonthlyOrganicClicks(
      [row({ pagePath: "/test/unknown/page", clicks: 99 })],
      map,
    );
    expect(out).toEqual([]);
  });

  it("does not cross-attribute a path that belongs to a different tenant", () => {
    // Same path, but click came from tenant t2 — t2 has no entry in the map.
    const out = rollupNicheMonthlyOrganicClicks(
      [row({ tenantId: "t2", pagePath: "/test/koffie/beste-machine", clicks: 50 })],
      map,
    );
    expect(out).toEqual([]);
  });

  it("skips rows with an unparseable date instead of throwing", () => {
    const out = rollupNicheMonthlyOrganicClicks([row({ date: "not-a-date" })], map);
    expect(out).toEqual([]);
  });

  it("returns an empty array for no input", () => {
    expect(rollupNicheMonthlyOrganicClicks([], map)).toEqual([]);
  });
});
