import { describe, expect, it } from "vitest";
import {
  AI_CONTENT_GENERATOR,
  DEFAULT_AFFILIATE_DISCLOSURE_EN,
  DEFAULT_AFFILIATE_DISCLOSURE_NL,
  buildAiContentDeclaration,
  resolveAffiliateDisclosure,
} from "../src/disclosures";

describe("buildAiContentDeclaration (#4 EU AI Act Article 50)", () => {
  it("always declares partial generation, human-in-the-loop, and the generator", () => {
    const ld = buildAiContentDeclaration();
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("CreativeWork");
    expect(ld.aiContentDeclaration).toEqual({
      isPartiallyGenerated: true,
      generator: AI_CONTENT_GENERATOR,
      humanInTheLoop: true,
    });
  });

  it("adds an author node only when an author name is supplied", () => {
    expect(buildAiContentDeclaration()).not.toHaveProperty("author");
    expect(buildAiContentDeclaration({ authorName: "Jeffrey" }).author).toEqual({
      "@type": "Person",
      name: "Jeffrey",
    });
  });

  it("allows overriding the generator label", () => {
    const ld = buildAiContentDeclaration({ generator: "Anthropic Claude (Opus)" });
    expect((ld.aiContentDeclaration as { generator: string }).generator).toBe(
      "Anthropic Claude (Opus)",
    );
  });

  it("serialises to valid JSON with no undefined keys when author is absent", () => {
    const json = JSON.stringify(buildAiContentDeclaration());
    expect(json).not.toContain("author");
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe("resolveAffiliateDisclosure (#5)", () => {
  it("uses the mandated defaults when no override is given", () => {
    expect(resolveAffiliateDisclosure()).toEqual({
      nl: DEFAULT_AFFILIATE_DISCLOSURE_NL,
      en: DEFAULT_AFFILIATE_DISCLOSURE_EN,
    });
  });

  it("pins the exact NL wording required by CLAUDE.md non-negotiable #5", () => {
    expect(DEFAULT_AFFILIATE_DISCLOSURE_NL).toBe(
      "Deze pagina bevat affiliate links. Als je via een link iets koopt ontvangen wij een commissie, zonder extra kosten voor jou.",
    );
  });

  it("applies per-tenant overrides per locale, independently", () => {
    expect(resolveAffiliateDisclosure({ nl: "Eigen tekst" })).toEqual({
      nl: "Eigen tekst",
      en: DEFAULT_AFFILIATE_DISCLOSURE_EN,
    });
    expect(resolveAffiliateDisclosure({ en: "Custom text" }).en).toBe("Custom text");
  });

  it("always returns a non-empty disclosure in both locales", () => {
    const out = resolveAffiliateDisclosure({});
    expect(out.nl.length).toBeGreaterThan(0);
    expect(out.en.length).toBeGreaterThan(0);
  });
});
