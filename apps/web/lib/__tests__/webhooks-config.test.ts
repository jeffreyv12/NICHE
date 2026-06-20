import { afterEach, describe, expect, it, vi } from "vitest";
import { getNetworkWebhookConfig } from "../webhooks/config.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getNetworkWebhookConfig — token resolution", () => {
  it("returns falsy token when env var is not set", () => {
    vi.stubEnv("WEBHOOK_BOL_TOKEN", "");
    expect(getNetworkWebhookConfig("bol").token).toBeFalsy();
  });

  it("bol: returns WEBHOOK_BOL_TOKEN, no signing secret", () => {
    vi.stubEnv("WEBHOOK_BOL_TOKEN", "bol-secret-token");
    const cfg = getNetworkWebhookConfig("bol");
    expect(cfg.token).toBe("bol-secret-token");
    expect(cfg.signingSecret).toBeUndefined();
  });

  it("awin: returns WEBHOOK_AWIN_TOKEN and WEBHOOK_AWIN_SIGNING_SECRET", () => {
    vi.stubEnv("WEBHOOK_AWIN_TOKEN", "awin-tok");
    vi.stubEnv("WEBHOOK_AWIN_SIGNING_SECRET", "awin-sig");
    const cfg = getNetworkWebhookConfig("awin");
    expect(cfg.token).toBe("awin-tok");
    expect(cfg.signingSecret).toBe("awin-sig");
  });

  it("daisycon: returns WEBHOOK_DAISYCON_TOKEN, no signing secret", () => {
    vi.stubEnv("WEBHOOK_DAISYCON_TOKEN", "daisy-tok");
    const cfg = getNetworkWebhookConfig("daisycon");
    expect(cfg.token).toBe("daisy-tok");
    expect(cfg.signingSecret).toBeUndefined();
  });

  it("digistore24: returns WEBHOOK_DIGISTORE_TOKEN and DIGISTORE_IPN_PASSPHRASE", () => {
    vi.stubEnv("WEBHOOK_DIGISTORE_TOKEN", "digi-tok");
    vi.stubEnv("DIGISTORE_IPN_PASSPHRASE", "digi-pass");
    const cfg = getNetworkWebhookConfig("digistore24");
    expect(cfg.token).toBe("digi-tok");
    expect(cfg.signingSecret).toBe("digi-pass");
  });

  it("impact: returns WEBHOOK_IMPACT_TOKEN and WEBHOOK_IMPACT_SIGNING_SECRET", () => {
    vi.stubEnv("WEBHOOK_IMPACT_TOKEN", "impact-tok");
    vi.stubEnv("WEBHOOK_IMPACT_SIGNING_SECRET", "impact-sig");
    const cfg = getNetworkWebhookConfig("impact");
    expect(cfg.token).toBe("impact-tok");
    expect(cfg.signingSecret).toBe("impact-sig");
  });
});

describe("getNetworkWebhookConfig — unknown network fallback", () => {
  it("returns both undefined for an unknown network", () => {
    // TypeScript would normally prevent this, but guard the runtime path.
    const cfg = getNetworkWebhookConfig("unknown" as never);
    expect(cfg.token).toBeUndefined();
    expect(cfg.signingSecret).toBeUndefined();
  });
});
