import { afterEach, describe, expect, it } from "vitest";
import { buildCanonicalUrl } from "../indexnow.js";

describe("buildCanonicalUrl", () => {
  const origEnv = process.env.NEXT_PUBLIC_ROOT_DOMAIN;

  afterEach(() => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = origEnv;
  });

  it("returns the fullPath unchanged when NEXT_PUBLIC_ROOT_DOMAIN is not set", () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = undefined;
    const url = buildCanonicalUrl("expertgids", "/test/koffie/beste-machine");
    expect(url).toBe("/test/koffie/beste-machine");
  });

  it("builds a full https URL when NEXT_PUBLIC_ROOT_DOMAIN is set", () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "expertgids.nl";
    const url = buildCanonicalUrl("expertgids", "/test/koffie/beste-machine");
    expect(url).toBe("https://expertgids.nl/sites/expertgids/test/koffie/beste-machine");
  });

  it("includes tenant slug in the /sites/ path segment", () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "nichefinder.nl";
    const url = buildCanonicalUrl("ander-merk", "/test/niche/page");
    expect(url).toContain("/sites/ander-merk/");
  });

  it("URL starts with https:// (never http)", () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "expertgids.nl";
    expect(buildCanonicalUrl("expertgids", "/test/x")).toMatch(/^https:\/\//);
  });

  it("preserves fullPath including nested segments", () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "expertgids.nl";
    const url = buildCanonicalUrl("expertgids", "/test/segment-a/segment-b/page");
    expect(url.endsWith("/test/segment-a/segment-b/page")).toBe(true);
  });
});
