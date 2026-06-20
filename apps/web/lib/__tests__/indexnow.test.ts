import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCanonicalUrl } from "../indexnow.js";

// vi.stubEnv handles set + restore cleanly; vi.unstubAllEnvs in afterEach resets.
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildCanonicalUrl", () => {
  it("returns the fullPath unchanged when NEXT_PUBLIC_ROOT_DOMAIN is not set", () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "");
    const url = buildCanonicalUrl("expertgids", "/test/koffie/beste-machine");
    expect(url).toBe("/test/koffie/beste-machine");
  });

  it("builds a full https URL when NEXT_PUBLIC_ROOT_DOMAIN is set", () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "expertgids.nl");
    const url = buildCanonicalUrl("expertgids", "/test/koffie/beste-machine");
    expect(url).toBe("https://expertgids.nl/sites/expertgids/test/koffie/beste-machine");
  });

  it("includes tenant slug in the /sites/ path segment", () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "nichefinder.nl");
    const url = buildCanonicalUrl("ander-merk", "/test/niche/page");
    expect(url).toContain("/sites/ander-merk/");
  });

  it("URL starts with https:// (never http)", () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "expertgids.nl");
    expect(buildCanonicalUrl("expertgids", "/test/x")).toMatch(/^https:\/\//);
  });

  it("preserves fullPath including nested segments", () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "expertgids.nl");
    const url = buildCanonicalUrl("expertgids", "/test/segment-a/segment-b/page");
    expect(url.endsWith("/test/segment-a/segment-b/page")).toBe(true);
  });
});
