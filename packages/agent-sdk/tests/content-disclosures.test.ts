import { describe, expect, it } from "vitest";
import {
  ContentDraftInputSchema,
  type ContentOutput,
  ContentOutputSchema,
  checkDisclosures,
  enforceDisclosures,
} from "../src/agents/content";

const goodBody = `
Deze pagina bevat affiliate links — als je via een link iets koopt ontvangen wij een commissie.

Dit artikel is geschreven met hulp van AI en geredigeerd door Jeffrey.

## Wat is dit
...
`;

function output(bodyMd: string): ContentOutput {
  return {
    page: {
      title: "Beste aeropress 2026",
      meta_description: "Een gids voor de beste aeropress in NL.",
      h1: "Beste aeropress 2026",
      body_md: bodyMd,
      schema_jsonld: [],
      ai_disclosure_jsonld: { "@context": "https://schema.org" },
    },
    claims: [],
    operator_todos: [],
    needs_polish_pass: false,
  };
}

describe("checkDisclosures", () => {
  it("passes when both disclosures are present", () => {
    const r = checkDisclosures(goodBody);
    expect(r.ok).toBe(true);
  });

  it("fails when affiliate disclosure is missing", () => {
    const body = "Dit artikel is geschreven met hulp van AI.\n\nGeen disclosure hier.";
    expect(checkDisclosures(body).hasAffiliateDisclosure).toBe(false);
  });

  it("fails when AI disclosure is missing", () => {
    const body = "Deze pagina bevat affiliate links.\n\nGeen ai-melding hier.";
    expect(checkDisclosures(body).hasAiDisclosure).toBe(false);
  });
});

describe("enforceDisclosures", () => {
  it("returns the output unchanged when both disclosures are present", () => {
    const o = output(goodBody);
    expect(enforceDisclosures(o)).toBe(o);
  });

  it("adds a blocker todo and forces polish when affiliate disclosure is missing", () => {
    const o = output("Dit artikel is geschreven met hulp van AI.\n\nGeen aff-melding.");
    const fixed = enforceDisclosures(o);
    expect(fixed.needs_polish_pass).toBe(true);
    expect(fixed.operator_todos.some((t) => t.includes("Affiliate-disclosure"))).toBe(true);
  });

  it("adds a blocker todo when AI disclosure is missing", () => {
    const o = output("Deze pagina bevat affiliate links.\n\nGeen ai-melding.");
    const fixed = enforceDisclosures(o);
    expect(fixed.needs_polish_pass).toBe(true);
    expect(fixed.operator_todos.some((t) => t.includes("AI-disclosure"))).toBe(true);
  });

  it("adds both blocker todos when neither disclosure is present", () => {
    const o = output("Hier staat helemaal niets verplichts.");
    const fixed = enforceDisclosures(o);
    expect(fixed.operator_todos.length).toBeGreaterThanOrEqual(2);
  });
});

describe("ContentDraftInputSchema", () => {
  it("accepts a minimal valid draft input", () => {
    const valid = ContentDraftInputSchema.parse({
      niche: { topic: "Aeropress", topic_slug: "aeropress" },
      page: {
        kind: "buying_guide",
        primary_keyword: "beste aeropress 2026",
        secondary_keywords: ["draagbare koffie"],
        author_display_name: "Jeffrey",
      },
    });
    expect(valid.niche.language).toBe("nl");
    expect(valid.products).toEqual([]);
  });

  it("rejects an unknown page kind", () => {
    expect(() =>
      ContentDraftInputSchema.parse({
        niche: { topic: "X", topic_slug: "x" },
        page: { kind: "tweetstorm", primary_keyword: "k", author_display_name: "Jeffrey" },
      }),
    ).toThrow();
  });
});

describe("ContentOutputSchema", () => {
  it("rejects an output missing the ai_disclosure_jsonld block", () => {
    const o = output(goodBody);
    const bad = { ...o, page: { ...o.page, ai_disclosure_jsonld: undefined } };
    expect(() => ContentOutputSchema.parse(bad)).toThrow();
  });
});
