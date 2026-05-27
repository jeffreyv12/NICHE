import { z } from "zod";

// Page kinds mirror PAGE_KINDS in @nichefinder/db/enums; we redeclare a
// narrower content-relevant subset (no legal/about/test_page) so the agent
// can't be asked to draft something that isn't a real content surface.
export const CONTENT_PAGE_KINDS = [
  "homepage",
  "category",
  "product_review",
  "comparison",
  "buying_guide",
  "how_to",
  "informational",
] as const;
export type ContentPageKind = (typeof CONTENT_PAGE_KINDS)[number];

export const CONTENT_CLAIM_TYPES = ["price", "spec", "rating", "fact", "test_result"] as const;
export type ContentClaimType = (typeof CONTENT_CLAIM_TYPES)[number];

// ---------------------------------------------------------------------------
// Inputs — what the operator/agent runtime hands to the content draft pass.
// ---------------------------------------------------------------------------

const ProductInputSchema = z.object({
  external_id: z.string().min(1),
  ean: z.string().optional(),
  name: z.string().min(1),
  price_eur: z.number().nonnegative().optional(),
  url: z.string().url().optional(),
  network: z.string().optional(),
});

const FirstPartyTestSchema = z.object({
  product_external_id: z.string(),
  summary: z.string().min(1).max(2000),
  tested_at: z.string().optional(),
});

const ClaimSourceInputSchema = z.object({
  source_url: z.string().url(),
  excerpt: z.string().min(1).max(1000),
});

const ExistingClaimSchema = z.object({
  claim_text: z.string().min(1).max(500),
  claim_type: z.enum(CONTENT_CLAIM_TYPES),
  sources: z.array(ClaimSourceInputSchema).default([]),
});

export const ContentDraftInputSchema = z.object({
  niche: z.object({
    topic: z.string().min(2).max(80),
    topic_slug: z.string().min(2).max(80),
    language: z.enum(["nl", "en"]).default("nl"),
  }),
  page: z.object({
    kind: z.enum(CONTENT_PAGE_KINDS),
    primary_keyword: z.string().min(1).max(120),
    secondary_keywords: z.array(z.string().min(1)).max(8).default([]),
    target_word_count: z.number().int().positive().max(5_000).optional(),
    author_display_name: z.string().min(1).max(120),
  }),
  products: z.array(ProductInputSchema).max(20).default([]),
  first_party_tests: z.array(FirstPartyTestSchema).max(20).default([]),
  existing_claims: z.array(ExistingClaimSchema).max(50).default([]),
  brand_voice_notes: z.string().max(4_000).optional(),
});
export type ContentDraftInput = z.infer<typeof ContentDraftInputSchema>;

// Polish-pass input extends draft with the operator-edited body + a list of
// peer pages on the same tenant for internal-link suggestions.
export const ContentPolishInputSchema = ContentDraftInputSchema.extend({
  draft: z.object({
    body_md: z.string().min(1),
    title: z.string().min(1),
    meta_description: z.string().min(1),
  }),
  operator_edited_body_md: z.string().min(1),
  peer_pages: z
    .array(
      z.object({
        url: z.string(),
        title: z.string(),
        kind: z.enum(CONTENT_PAGE_KINDS),
      }),
    )
    .max(50)
    .default([]),
});
export type ContentPolishInput = z.infer<typeof ContentPolishInputSchema>;

// ---------------------------------------------------------------------------
// Output — what both passes return.
// ---------------------------------------------------------------------------

const SchemaJsonLdItem = z.record(z.string(), z.unknown());

const ClaimOutputSchema = z.object({
  claim_text: z.string().min(1).max(500),
  claim_type: z.enum(CONTENT_CLAIM_TYPES),
  suggested_sources: z.array(ClaimSourceInputSchema).default([]),
});

const PageOutputSchema = z.object({
  title: z.string().min(1).max(120),
  meta_description: z.string().min(1).max(280),
  h1: z.string().min(1).max(160),
  body_md: z.string().min(1).max(50_000),
  schema_jsonld: z.array(SchemaJsonLdItem).default([]),
  ai_disclosure_jsonld: SchemaJsonLdItem,
});

export const ContentOutputSchema = z.object({
  page: PageOutputSchema,
  claims: z.array(ClaimOutputSchema).default([]),
  operator_todos: z.array(z.string().min(1)).default([]),
  needs_polish_pass: z.boolean(),
  /** Populated only by the Opus polish pass. */
  polish_notes: z.string().max(4_000).optional(),
});
export type ContentOutput = z.infer<typeof ContentOutputSchema>;
