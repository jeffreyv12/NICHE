import { describe, expect, it } from "vitest";
import { BOT_SCORE_THRESHOLD, scoreClickBot } from "../src/botScore";

describe("scoreClickBot — user-agent heuristic", () => {
  it("flags obvious crawler/tool agents", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1)",
      "python-requests/2.31",
      "curl/8.4.0",
    ]) {
      expect(scoreClickBot({ userAgent: ua }).isBot).toBe(true);
    }
  });

  it("flags headless/automation agents", () => {
    expect(scoreClickBot({ userAgent: "HeadlessChrome/120" }).isBot).toBe(true);
  });

  it("treats a missing user-agent as likely bot", () => {
    const r = scoreClickBot({ userAgent: null });
    expect(r.score).toBeGreaterThanOrEqual(BOT_SCORE_THRESHOLD);
    expect(r.isBot).toBe(true);
  });

  it("passes a normal browser agent as human", () => {
    const r = scoreClickBot({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    });
    expect(r.isBot).toBe(false);
    expect(r.score).toBeLessThan(BOT_SCORE_THRESHOLD);
  });
});

describe("scoreClickBot — Cloudflare bot-management score (inverted scale)", () => {
  const humanUa = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/124 Safari/537.36";

  it("treats a low CF score (bot-like) as a bot even with a clean UA", () => {
    // CF: 1 = definitely bot … 99 = definitely human.
    const r = scoreClickBot({ userAgent: humanUa, cfBotScore: 3 });
    expect(r.score).toBe(97);
    expect(r.isBot).toBe(true);
  });

  it("keeps a high CF score (human) as human", () => {
    const r = scoreClickBot({ userAgent: humanUa, cfBotScore: 95 });
    expect(r.isBot).toBe(false);
  });

  it("takes the most bot-like of UA and CF signals", () => {
    // Clean CF (human) but tool UA → still bot.
    const r = scoreClickBot({ userAgent: "curl/8.4.0", cfBotScore: 99 });
    expect(r.isBot).toBe(true);
  });

  it("ignores an out-of-range CF score", () => {
    const r = scoreClickBot({ userAgent: humanUa, cfBotScore: 0 });
    expect(r.isBot).toBe(false);
    const r2 = scoreClickBot({ userAgent: humanUa, cfBotScore: 250 });
    expect(r2.isBot).toBe(false);
  });
});

describe("scoreClickBot — verified bots", () => {
  it("flags a Cloudflare-verified bot as a bot regardless of UA", () => {
    const r = scoreClickBot({ userAgent: "Mozilla/5.0 Chrome/124", verifiedBot: true });
    expect(r.isBot).toBe(true);
  });
});
