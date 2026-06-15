import { describe, expect, it } from "vitest";
import { buildPromotedRedirectTarget } from "../src/promotedRedirect";

describe("buildPromotedRedirectTarget", () => {
  it("strips the prefix and preserves the remainder of the path", () => {
    expect(
      buildPromotedRedirectTarget({
        hostname: "koffie.nl",
        pathname: "/koffie/best",
        prefix: "/koffie",
      }),
    ).toBe("https://koffie.nl/best");
  });

  it("preserves the query string (the bug this fix exists for)", () => {
    // A 308 is cached by the browser, so dropping ?utm_source would lose
    // affiliate/attribution params permanently on every promoted niche.
    expect(
      buildPromotedRedirectTarget({
        hostname: "koffie.nl",
        pathname: "/koffie/best",
        prefix: "/koffie",
        search: "?utm_source=newsletter&ref=abc",
      }),
    ).toBe("https://koffie.nl/best?utm_source=newsletter&ref=abc");
  });

  it("collapses a bare prefix hit to the apex", () => {
    expect(
      buildPromotedRedirectTarget({
        hostname: "koffie.nl",
        pathname: "/koffie",
        prefix: "/koffie",
      }),
    ).toBe("https://koffie.nl/");
  });

  it("collapses a bare prefix with a trailing slash to the apex", () => {
    expect(
      buildPromotedRedirectTarget({
        hostname: "koffie.nl",
        pathname: "/koffie/",
        prefix: "/koffie",
      }),
    ).toBe("https://koffie.nl/");
  });

  it("preserves a query string on a bare prefix hit", () => {
    expect(
      buildPromotedRedirectTarget({
        hostname: "koffie.nl",
        pathname: "/koffie",
        prefix: "/koffie",
        search: "?ref=x",
      }),
    ).toBe("https://koffie.nl/?ref=x");
  });

  it("preserves deep multi-segment paths", () => {
    expect(
      buildPromotedRedirectTarget({
        hostname: "koffie.nl",
        pathname: "/koffie/gids/beste-bonen",
        prefix: "/koffie",
        search: "?page=2",
      }),
    ).toBe("https://koffie.nl/gids/beste-bonen?page=2");
  });

  it("emits no trailing '?' when the query is empty", () => {
    expect(
      buildPromotedRedirectTarget({
        hostname: "koffie.nl",
        pathname: "/koffie/best",
        prefix: "/koffie",
        search: "",
      }),
    ).toBe("https://koffie.nl/best");
  });

  it("treats a lone '?' as no query string", () => {
    expect(
      buildPromotedRedirectTarget({
        hostname: "koffie.nl",
        pathname: "/koffie/best",
        prefix: "/koffie",
        search: "?",
      }),
    ).toBe("https://koffie.nl/best");
  });

  it("tolerates a query string passed without its leading '?'", () => {
    expect(
      buildPromotedRedirectTarget({
        hostname: "koffie.nl",
        pathname: "/koffie/best",
        prefix: "/koffie",
        search: "utm=x",
      }),
    ).toBe("https://koffie.nl/best?utm=x");
  });
});
