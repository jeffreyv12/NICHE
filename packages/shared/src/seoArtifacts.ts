// Phase 6.4.5 / 4.4.3 — robots.txt + sitemap.xml builders (per-tenant).
//
// Pure string builders, extracted from the web route handlers so the
// compliance-critical output can be unit tested (the web app has no test
// harness). The route handlers keep the DB reads and HTTP wrapping; they call
// these to produce the bytes.
//
// Non-negotiable #3 (robots/ToS) + #6.4.5 depend on this output being correct:
// the validation test pages (/test/) and the affiliate redirector (/r/) must
// never be advertised to crawlers, and only PUBLISHED, non-test pages belong in
// the sitemap.

/** Paths every tenant's robots.txt must keep crawlers out of. */
export const ROBOTS_DISALLOWED_PATHS = ["/test/", "/r/"] as const;

/**
 * Build a tenant's robots.txt body. Disallows the validation test pages and the
 * affiliate redirector, allows everything else, and points crawlers at the
 * tenant sitemap. `origin` is the request origin, e.g. "https://example.com".
 */
export function buildRobotsTxt(origin: string): string {
  return [
    "User-agent: *",
    ...ROBOTS_DISALLOWED_PATHS.map((p) => `Disallow: ${p}`),
    "Allow: /",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

/** One entry in a sitemap. */
export interface SitemapEntry {
  /** Absolute path beginning with "/", e.g. "/gids/koffie". */
  path: string;
  /** Optional last-modified timestamp; only the YYYY-MM-DD prefix is emitted. */
  lastmod?: string | null;
}

/** Escape the five XML-significant characters relevant to URLs in text nodes. */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build a sitemap.xml body for the given absolute `origin` and entries. Each
 * entry's `<loc>` is `origin + path` (XML-escaped); a `<lastmod>` is emitted
 * only when a timestamp is present, truncated to the date.
 */
export function buildSitemapXml(origin: string, entries: SitemapEntry[]): string {
  const urls = entries
    .map((entry) => {
      const loc = xmlEscape(`${origin}${entry.path}`);
      const lastmod = entry.lastmod ? `\n    <lastmod>${entry.lastmod.slice(0, 10)}</lastmod>` : "";
      return `  <url>\n    <loc>${loc}</loc>${lastmod}\n  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
