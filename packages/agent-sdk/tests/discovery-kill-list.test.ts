import { describe, expect, it } from "vitest";
import { type NicheCandidate, applyKillList, matchKillList } from "../src/agents/discovery";

function cand(partial: Partial<NicheCandidate>): NicheCandidate {
  return {
    topic: partial.topic ?? "specialty espresso gear",
    topic_slug: partial.topic_slug ?? "specialty-espresso-gear",
    language: partial.language ?? "nl",
    related_keywords: partial.related_keywords ?? ["espressomachine", "aeropress"],
    evidence: partial.evidence ?? {
      source: "dataforseo",
      signal_summary: "test",
      raw_signal: {},
    },
    preliminary_red_flags: partial.preliminary_red_flags ?? [],
  };
}

describe("discovery kill-list adapter (defense-in-depth)", () => {
  it("hard-blocks YMYL medical when topic contains 'supplement'", () => {
    const m = matchKillList(cand({ topic: "best supplements for sleep" }));
    expect(m?.category.id).toBe("ymyl_medical");
    expect(m?.category.severity).toBe("hard_block");
    expect(m?.matchedAgainst).toBe("topic");
  });

  it("hard-blocks financial when a related keyword contains 'crypto'", () => {
    const m = matchKillList(
      cand({
        topic: "investing guides for beginners",
        related_keywords: ["beleggen", "crypto wallet", "indexfondsen"],
      }),
    );
    expect(m?.category.id).toBe("financial_regulated");
    expect(m?.category.severity).toBe("hard_block");
  });

  it("hard-blocks gambling when slug contains 'casino'", () => {
    const m = matchKillList(
      cand({ topic: "Online entertainment NL", topic_slug: "online-casino-nl" }),
    );
    expect(m?.category.id).toBe("gambling");
    expect(m?.matchedAgainst).toBe("topic_slug");
  });

  it("hard-blocks tobacco_vape on 'vape'", () => {
    const m = matchKillList(cand({ topic: "best vape mods 2026" }));
    expect(m?.category.id).toBe("tobacco_vape");
  });

  it("allows the canonical good example (specialty espresso gear)", () => {
    expect(matchKillList(cand({}))).toBeNull();
  });

  it("matches stems case-insensitively", () => {
    const m = matchKillList(cand({ topic: "BITCOIN trading academy" }));
    expect(m?.category.id).toBe("financial_regulated");
  });

  it("flags avoid-tier 'phone case' (not a hard block — operator decides)", () => {
    const m = matchKillList(
      cand({ topic: "best phone case for iPhone", topic_slug: "best-phone-case-iphone" }),
    );
    expect(m?.category.severity).toBe("avoid");
    expect(m?.category.id).toBe("phone_accessories");
  });

  it("applyKillList partitions input into kept and killed in one pass", () => {
    const candidates = [
      cand({ topic: "specialty espresso gear", topic_slug: "specialty-espresso-gear" }),
      cand({ topic: "online casino NL", topic_slug: "online-casino-nl" }),
      cand({
        topic: "ergonomic desk setup",
        topic_slug: "ergonomic-desk-setup",
        related_keywords: ["bureau", "monitor arm"],
      }),
      cand({
        topic: "weight loss supplements",
        topic_slug: "weight-loss-supplements",
      }),
    ];
    const out = applyKillList(candidates);
    expect(out.kept.map((c) => c.topic_slug)).toEqual([
      "specialty-espresso-gear",
      "ergonomic-desk-setup",
    ]);
    expect(out.killed).toHaveLength(2);
    expect(out.killed[0]?.match.category.id).toBe("gambling");
    expect(out.killed[1]?.match.category.id).toBe("ymyl_medical");
  });
});
