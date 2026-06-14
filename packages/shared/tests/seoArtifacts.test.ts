import { describe, expect, it } from "vitest";
import {
  ROBOTS_DISALLOWED_PATHS,
  type SitemapEntry,
  buildRobotsTxt,
  buildSitemapXml,
  xmlEscape,
} from "../src/seoArtifacts";

describe("buildRobotsTxt", () => {
  const robots = buildRobotsTxt("https://example.com");

  it("disallows the validation pages and the affiliate redirector", () => {
    // Compliance guarantee (non-negotiable #3): these must never be crawlable.
    expect(robots).toContain("Disallow: /test/");
    expect(robots).toContain("Disallow: /r/");
    for (const p of ROBOTS_DISALLOWED_PATHS) {
      expect(robots).toContain(`Disallow: ${p}`);
    }
  });

  it("allows everything else and advertises the tenant sitemap at the origin", () => {
    expect(robots).toContain("Allow: /");
    expect(robots).toContain("Sitemap: https://example.com/sitemap.xml");
  });

  it("targets all user agents", () => {
    expect(robots.startsWith("User-agent: *")).toBe(true);
  });

  it("uses the given origin verbatim in the sitemap line", () => {
    expect(buildRobotsTxt("https://koffiegids.nl")).toContain(
      "Sitemap: https://koffiegids.nl/sitemap.xml",
    );
  });
});

describe("xmlEscape", () => {
  it("escapes ampersand, angle brackets and double quotes", () => {
    expect(xmlEscape(`a&b<c>d"e`)).toBe("a&amp;b&lt;c&gt;d&quot;e");
  });

  it("escapes ampersands before they can form entities (no double-escaping)", () => {
    expect(xmlEscape("&lt;")).toBe("&amp;lt;");
  });
});

describe("buildSitemapXml", () => {
  it("wraps entries in a valid urlset with the sitemap namespace", () => {
    const xml = buildSitemapXml("https://example.com", [{ path: "/", lastmod: "2026-06-14" }]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  it("emits loc as origin + path", () => {
    const xml = buildSitemapXml("https://example.com", [{ path: "/gids/koffie" }]);
    expect(xml).toContain("<loc>https://example.com/gids/koffie</loc>");
  });

  it("emits lastmod truncated to the date when present", () => {
    const xml = buildSitemapXml("https://example.com", [
      { path: "/a", lastmod: "2026-06-14T09:30:00.000Z" },
    ]);
    expect(xml).toContain("<lastmod>2026-06-14</lastmod>");
  });

  it("omits lastmod entirely when null or absent", () => {
    const xml = buildSitemapXml("https://example.com", [
      { path: "/a", lastmod: null },
      { path: "/b" },
    ]);
    expect(xml).not.toContain("<lastmod>");
  });

  it("XML-escapes ampersands in query-string paths", () => {
    const xml = buildSitemapXml("https://example.com", [{ path: "/s?a=1&b=2" }]);
    expect(xml).toContain("<loc>https://example.com/s?a=1&amp;b=2</loc>");
    expect(xml).not.toContain("a=1&b=2");
  });

  it("produces one <url> block per entry", () => {
    const entries: SitemapEntry[] = [{ path: "/a" }, { path: "/b" }, { path: "/c" }];
    const xml = buildSitemapXml("https://example.com", entries);
    expect(xml.match(/<url>/g)).toHaveLength(3);
  });

  it("produces a well-formed (if empty) urlset for zero entries", () => {
    const xml = buildSitemapXml("https://example.com", []);
    expect(xml).toContain("<urlset");
    expect(xml).toContain("</urlset>");
    expect(xml).not.toContain("<url>");
  });
});
