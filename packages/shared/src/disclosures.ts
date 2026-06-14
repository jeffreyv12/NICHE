// Compliance disclosures — pure helpers behind the web components.
//
// #4 (EU AI Act Article 50): the JSON-LD aiContentDeclaration shape.
// #5: the affiliate-disclosure text + per-tenant override resolution.
//
// Extracted so the exact, legally-required wording and JSON-LD shape are
// pinned by unit tests (the web app has no test harness). Changing the
// mandated NL disclosure text or dropping the AI declaration fields will
// fail a test rather than ship silently.

// ---------------------------------------------------------------------------
// #4 — EU AI Act Article 50 content declaration
// ---------------------------------------------------------------------------

export const AI_BADGE_DEFAULT_TEXT = "AI-assisted — geredigeerd door redactie";
export const AI_CONTENT_GENERATOR = "Anthropic Claude";

export interface AiContentDeclarationOptions {
  /** Human author to credit; when set, an author node is added. */
  authorName?: string;
  /** Override the generator label (defaults to "Anthropic Claude"). */
  generator?: string;
}

/**
 * Build the schema.org JSON-LD object embedded near an AI-assisted byline.
 * `isPartiallyGenerated` and `humanInTheLoop` are always present and true —
 * the disclosure is non-negotiable. An `author` node is included only when an
 * author name is supplied.
 */
export function buildAiContentDeclaration(
  opts: AiContentDeclarationOptions = {},
): Record<string, unknown> {
  const jsonld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    aiContentDeclaration: {
      isPartiallyGenerated: true,
      generator: opts.generator ?? AI_CONTENT_GENERATOR,
      humanInTheLoop: true,
    },
  };
  if (opts.authorName) {
    jsonld.author = { "@type": "Person", name: opts.authorName };
  }
  return jsonld;
}

// ---------------------------------------------------------------------------
// #5 — affiliate disclosure
// ---------------------------------------------------------------------------

/** Mandated NL affiliate-disclosure wording (CLAUDE.md non-negotiable #5). */
export const DEFAULT_AFFILIATE_DISCLOSURE_NL =
  "Deze pagina bevat affiliate links. Als je via een link iets koopt ontvangen wij een commissie, zonder extra kosten voor jou.";
export const DEFAULT_AFFILIATE_DISCLOSURE_EN =
  "This page contains affiliate links. If you buy something through them we earn a small commission at no extra cost to you.";

export interface AffiliateDisclosureText {
  nl: string;
  en: string;
}

/**
 * Resolve the affiliate-disclosure text for a tenant. Per-tenant overrides
 * (`tenants.config.affiliate.disclosureText`) win; otherwise the mandated
 * defaults are used. There is always a non-empty disclosure in both locales.
 */
export function resolveAffiliateDisclosure(override?: {
  nl?: string;
  en?: string;
}): AffiliateDisclosureText {
  return {
    nl: override?.nl ?? DEFAULT_AFFILIATE_DISCLOSURE_NL,
    en: override?.en ?? DEFAULT_AFFILIATE_DISCLOSURE_EN,
  };
}
