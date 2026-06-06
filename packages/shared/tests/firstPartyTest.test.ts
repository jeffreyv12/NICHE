import { describe, expect, it } from "vitest";
import { buildReviewJsonLd } from "../src/firstPartyTest";

describe("buildReviewJsonLd", () => {
  it("builds a schema.org Review with Person author + reviewBody", () => {
    const r = buildReviewJsonLd({
      productName: "Acme Airfryer 5L",
      summary: "Twee weken getest; haalt 200°C in 3 min.",
      authorName: "Jeffrey Viveen",
    });
    expect(r).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Review",
      itemReviewed: { "@type": "Product", name: "Acme Airfryer 5L" },
      author: { "@type": "Person", name: "Jeffrey Viveen" },
      reviewBody: "Twee weken getest; haalt 200°C in 3 min.",
    });
  });

  it("includes a clamped reviewRating when a rating is given", () => {
    const r = buildReviewJsonLd({
      productName: "X",
      summary: "s",
      authorName: "A",
      rating: 9,
    }) as Record<string, { ratingValue?: number; bestRating?: number }>;
    expect(r.reviewRating).toMatchObject({
      "@type": "Rating",
      ratingValue: 5, // clamped to bestRating
      bestRating: 5,
      worstRating: 1,
    });
  });

  it("omits reviewRating when no rating", () => {
    const r = buildReviewJsonLd({ productName: "X", summary: "s", authorName: "A" });
    expect("reviewRating" in r).toBe(false);
  });

  it("includes datePublished only when provided", () => {
    const without = buildReviewJsonLd({ productName: "X", summary: "s", authorName: "A" });
    expect("datePublished" in without).toBe(false);
    const withDate = buildReviewJsonLd({
      productName: "X",
      summary: "s",
      authorName: "A",
      datePublished: "2026-06-01",
    });
    expect(withDate).toMatchObject({ datePublished: "2026-06-01" });
  });

  it("maps non-empty pros/cons to positive/negativeNotes ItemLists", () => {
    const r = buildReviewJsonLd({
      productName: "X",
      summary: "s",
      authorName: "A",
      pros: ["stil", "snel"],
      cons: ["duur"],
    }) as Record<string, { itemListElement?: Array<{ position: number; name: string }> }>;
    expect(r.positiveNotes?.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "stil" },
      { "@type": "ListItem", position: 2, name: "snel" },
    ]);
    expect(r.negativeNotes?.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "duur" },
    ]);
  });

  it("omits pros/cons keys when empty", () => {
    const r = buildReviewJsonLd({
      productName: "X",
      summary: "s",
      authorName: "A",
      pros: [],
      cons: [],
    });
    expect("positiveNotes" in r).toBe(false);
    expect("negativeNotes" in r).toBe(false);
  });
});
