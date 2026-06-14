import { describe, expect, it } from "vitest";
import { type TenantCmpConfig, buildKlaroConfig } from "../src/klaroConfig";

describe("buildKlaroConfig", () => {
  describe("base (no tenant cmp)", () => {
    it("ships only the cookieless Plausible service, required and on by default", () => {
      const cfg = buildKlaroConfig("nl-NL");

      expect(cfg.services).toHaveLength(1);
      expect(cfg.services[0]).toMatchObject({
        name: "plausible",
        required: true,
        default: true,
        purposes: ["analytics"],
      });
    });

    it("defaults the consent cookie to 365 days", () => {
      expect(buildKlaroConfig("nl-NL").cookieExpiresAfterDays).toBe(365);
    });

    it("selects nl for nl-* locales and en otherwise", () => {
      expect(buildKlaroConfig("nl-BE").lang).toBe("nl");
      expect(buildKlaroConfig("en-US").lang).toBe("en");
      expect(buildKlaroConfig("fr-BE").lang).toBe("en");
    });

    it("always provides both nl and en translation blocks", () => {
      const cfg = buildKlaroConfig("en-US");
      expect(cfg.translations.nl).toBeDefined();
      expect(cfg.translations.en).toBeDefined();
    });

    it("localises the base service description by language", () => {
      expect(buildKlaroConfig("nl-NL").services[0].description as string).toMatch(/Cookieloze/);
      expect(buildKlaroConfig("en-US").services[0].description as string).toMatch(/Cookieless/);
    });
  });

  describe("tenant services", () => {
    const cmp: TenantCmpConfig = {
      services: [
        {
          name: "posthog",
          title: "PostHog",
          purposes: ["analytics"],
          description: { nl: "Productanalyse", en: "Product analytics" },
        },
      ],
    };

    it("appends tenant services after the base, off and toggleable by default", () => {
      const cfg = buildKlaroConfig("nl-NL", cmp);

      expect(cfg.services.map((s) => s.name)).toEqual(["plausible", "posthog"]);
      expect(cfg.services[1]).toMatchObject({
        name: "posthog",
        default: false,
        required: false,
        description: "Productanalyse",
      });
    });

    it("picks the description matching the active language", () => {
      const cfg = buildKlaroConfig("en-US", cmp);
      expect(cfg.services[1].description).toBe("Product analytics");
    });

    it("omits the description key when none is provided for the language", () => {
      const cfg = buildKlaroConfig("nl-NL", {
        services: [{ name: "yt", title: "YouTube", purposes: ["functional"] }],
      });
      expect(cfg.services[1]).not.toHaveProperty("description");
    });

    it("forwards cookie-clear patterns only when present", () => {
      const cfg = buildKlaroConfig("nl-NL", {
        services: [
          { name: "ph", title: "PH", purposes: ["analytics"], cookies: ["ph_*"] },
          { name: "yt", title: "YT", purposes: ["functional"] },
        ],
      });
      expect(cfg.services[1].cookies).toEqual(["ph_*"]);
      expect(cfg.services[2]).not.toHaveProperty("cookies");
    });

    it("honours explicit default/required overrides", () => {
      const cfg = buildKlaroConfig("nl-NL", {
        services: [
          {
            name: "essential",
            title: "Essential",
            purposes: ["functional"],
            required: true,
            default: true,
          },
        ],
      });
      expect(cfg.services[1]).toMatchObject({ required: true, default: true });
    });

    it("never lets a tenant redefine the reserved cookieless base", () => {
      const cfg = buildKlaroConfig("nl-NL", {
        services: [{ name: "plausible", title: "Evil", purposes: ["analytics"], required: false }],
      });
      // The injected "plausible" is dropped; the required base survives untouched.
      expect(cfg.services).toHaveLength(1);
      expect(cfg.services[0]).toMatchObject({ name: "plausible", required: true });
    });
  });

  describe("overrides", () => {
    it("applies a custom cookie lifetime", () => {
      expect(buildKlaroConfig("nl-NL", { cookieExpiresAfterDays: 90 }).cookieExpiresAfterDays).toBe(
        90,
      );
    });

    it("merges per-purpose labels over the analytics default", () => {
      const cfg = buildKlaroConfig("nl-NL", {
        purposeLabels: { nl: { functional: "Functioneel" } },
      });
      const nl = cfg.translations.nl as { purposes: Record<string, string> };
      expect(nl.purposes.analytics).toBe("Analyse (anoniem)"); // base kept
      expect(nl.purposes.functional).toBe("Functioneel"); // tenant added
    });
  });
});
