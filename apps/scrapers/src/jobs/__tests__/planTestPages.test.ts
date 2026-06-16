import { describe, expect, it } from "vitest";
import { planTestPages } from "../planTestPages.js";

const NICHE = {
  topic: "koffiemolen",
  topicSlug: "koffiemolen",
  language: "nl" as const,
  relatedKeywords: ["espressomolen", "handmatige molen", "burrmolen", "koffiemaler", "grinder"],
};

describe("planTestPages", () => {
  it("returns exactly 4 plan items", () => {
    expect(planTestPages(NICHE)).toHaveLength(4);
  });

  it("slugs are unique within the plan", () => {
    const items = planTestPages(NICHE);
    const slugs = items.map((i) => i.pageSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("each item has a non-empty cohort tag", () => {
    for (const item of planTestPages(NICHE)) {
      expect(item.cohort.length).toBeGreaterThan(0);
    }
  });

  it("primary keywords reference the niche topic", () => {
    for (const item of planTestPages(NICHE)) {
      expect(item.primaryKeyword.toLowerCase()).toContain("koffiemolen");
    }
  });

  it("comparison page targets 'beste [topic]' keyword", () => {
    const items = planTestPages(NICHE);
    const comparison = items.find((i) => i.kind === "comparison");
    expect(comparison).toBeDefined();
    expect(comparison?.primaryKeyword).toContain("beste koffiemolen");
  });

  it("buying_guide page targets '[topic] kopen' keyword", () => {
    const items = planTestPages(NICHE);
    const guide = items.find((i) => i.kind === "buying_guide");
    expect(guide?.primaryKeyword).toContain("koffiemolen kopen");
  });

  it("informational page uses 'wat is' pattern", () => {
    const items = planTestPages(NICHE);
    const info = items.find((i) => i.kind === "informational");
    expect(info?.primaryKeyword).toContain("wat is");
  });

  it("how_to page uses 'hoe kies je' pattern", () => {
    const items = planTestPages(NICHE);
    const howto = items.find((i) => i.kind === "how_to");
    expect(howto?.primaryKeyword).toContain("hoe kies je");
  });

  it("comparison page populates secondary keywords from relatedKeywords", () => {
    const items = planTestPages(NICHE);
    const comparison = items.find((i) => i.kind === "comparison");
    expect(comparison?.secondaryKeywords.length).toBeGreaterThan(0);
    expect(comparison?.secondaryKeywords[0]).toBe(NICHE.relatedKeywords[0]);
  });

  it("works with an empty relatedKeywords array (no crash)", () => {
    const items = planTestPages({ ...NICHE, relatedKeywords: [] });
    expect(items).toHaveLength(4);
    const comparison = items.find((i) => i.kind === "comparison");
    expect(comparison?.secondaryKeywords).toEqual([]);
  });
});
