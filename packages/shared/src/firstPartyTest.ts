// Phase 4.3 — first-party test → schema.org Review JSON-LD (4.3.4).
//
// When an operator logs a hands-on test and a page cites it, the page emits a
// Review with author = Person(operator) and reviewBody = the test summary, so
// the first-hand experience is machine-readable. Pure + framework-free.

export interface ReviewJsonLdInput {
  productName: string;
  summary: string;
  authorName: string;
  /** 1..5; values outside the range are clamped. Omitted → no reviewRating. */
  rating?: number;
  /** ISO date (yyyy-mm-dd). Omitted → no datePublished. */
  datePublished?: string;
  pros?: string[];
  cons?: string[];
}

const BEST_RATING = 5;
const WORST_RATING = 1;

function itemList(items: string[]): { "@type": "ItemList"; itemListElement: object[] } {
  return {
    "@type": "ItemList",
    itemListElement: items.map((name, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
    })),
  };
}

/** Build a schema.org Review object for a first-party test. */
export function buildReviewJsonLd(input: ReviewJsonLdInput): Record<string, unknown> {
  const review: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Review",
    itemReviewed: { "@type": "Product", name: input.productName },
    author: { "@type": "Person", name: input.authorName },
    reviewBody: input.summary,
  };

  if (typeof input.rating === "number") {
    review.reviewRating = {
      "@type": "Rating",
      ratingValue: Math.max(WORST_RATING, Math.min(BEST_RATING, input.rating)),
      bestRating: BEST_RATING,
      worstRating: WORST_RATING,
    };
  }
  if (input.datePublished) review.datePublished = input.datePublished;
  if (input.pros && input.pros.length > 0) review.positiveNotes = itemList(input.pros);
  if (input.cons && input.cons.length > 0) review.negativeNotes = itemList(input.cons);

  return review;
}
