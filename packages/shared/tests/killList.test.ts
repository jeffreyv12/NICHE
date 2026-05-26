import { describe, expect, it } from "vitest";
import {
  ALL_KILL_CATEGORIES,
  AVOID_CATEGORIES,
  HARD_BLOCK_CATEGORIES,
  matchKillList,
} from "../src/killList";

describe("kill list — structural invariants", () => {
  it("every category has at least one stem", () => {
    for (const c of ALL_KILL_CATEGORIES) {
      expect(c.stems.length, `category ${c.id} has no stems`).toBeGreaterThan(0);
    }
  });

  it("category ids are globally unique", () => {
    const ids = ALL_KILL_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all hard-block categories carry severity=hard_block", () => {
    for (const c of HARD_BLOCK_CATEGORIES) {
      expect(c.severity).toBe("hard_block");
    }
  });

  it("all avoid categories carry severity=avoid", () => {
    for (const c of AVOID_CATEGORIES) {
      expect(c.severity).toBe("avoid");
    }
  });
});

describe("matchKillList — hard blocks fire on every category", () => {
  // For each hard-block category, the first stem must trigger a hard_block match.
  for (const cat of HARD_BLOCK_CATEGORIES) {
    it(`fires on category=${cat.id} via stem="${cat.stems[0]}"`, () => {
      const match = matchKillList({ topic: `something ${cat.stems[0]} something` });
      expect(match).not.toBeNull();
      expect(match?.category.severity).toBe("hard_block");
      expect(match?.category.id).toBe(cat.id);
    });
  }
});

describe("matchKillList — avoid categories", () => {
  for (const cat of AVOID_CATEGORIES) {
    it(`fires on avoid category=${cat.id}`, () => {
      const match = matchKillList({ topic: cat.stems[0] ?? "unreachable" });
      expect(match?.category.severity).toBe("avoid");
      expect(match?.category.id).toBe(cat.id);
    });
  }
});

describe("matchKillList — passes safe topics", () => {
  it.each([
    "specialty espresso gear",
    "ergonomic home office accessories",
    "indoor plant care for renters",
    "dutch cycling commuter gear",
  ])("passes safe topic: %s", (topic) => {
    expect(matchKillList({ topic })).toBeNull();
  });
});

describe("matchKillList — operator override only affects §B", () => {
  it("avoid match is suppressed when slug is in override list", () => {
    const m = matchKillList({
      topic: "best blender pro line",
      topicSlug: "best-blender-pro",
      avoidOverrideSlugs: ["best-blender-pro"],
    });
    expect(m).toBeNull();
  });

  it("hard block fires regardless of override list", () => {
    const m = matchKillList({
      topic: "best vape devices 2026",
      topicSlug: "best-vape-devices-2026",
      avoidOverrideSlugs: ["best-vape-devices-2026"],
    });
    expect(m?.category.severity).toBe("hard_block");
  });
});

describe("matchKillList — checks related keywords", () => {
  it("fires on a kill stem appearing only in relatedKeywords", () => {
    const m = matchKillList({
      topic: "wellness gear",
      relatedKeywords: ["CBD oil", "meditation"],
    });
    expect(m?.category.id).toBe("ymyl_medical");
    expect(m?.matchedAgainst).toBe("related_keyword");
  });
});
