// Phase 3.2.2 — click bot scoring.
//
// Produces a 0–100 bot likelihood (0 = human, 100 = bot) and an isBot flag for
// the /r redirect to stamp on each `clicks` row. The Validation Agent counts
// only non-bot clicks, so this guards the top of the funnel.
//
// Signals, strongest-wins (max):
//   - user-agent heuristic (always available)
//   - Cloudflare Bot Management score, when the edge injects it (see note)
//   - Cloudflare "verified bot" flag (Googlebot etc.)
//
// Pure + framework-free so it is unit-tested here and reused by the route.

/** A click with score ≥ this is treated as a bot and excluded from human clicks. */
export const BOT_SCORE_THRESHOLD = 70;

export interface ClickBotSignals {
  userAgent: string | null | undefined;
  /**
   * Cloudflare Bot Management score (1 = definitely bot … 99 = definitely
   * human) when the edge forwards it (e.g. via a Transform Rule adding the
   * `cf-bot-management-score` header). Inverted to our scale internally.
   * Out-of-range / absent values are ignored.
   */
  cfBotScore?: number | null;
  /** Cloudflare flagged this as a known/verified bot (Googlebot, etc.). */
  verifiedBot?: boolean;
}

export interface ClickBotResult {
  score: number;
  isBot: boolean;
}

/** User-agent only heuristic, 0–100. Mirrors the original /r scoring. */
function userAgentScore(userAgent: string | null | undefined): number {
  if (!userAgent) return 80;
  const ua = userAgent.toLowerCase();
  if (/bot|crawl|spider|wget|curl|python-requests|java\//.test(ua)) return 95;
  if (/headless|phantom|selenium|puppeteer|playwright/.test(ua)) return 90;
  if (/preview|prefetch|fetch/.test(ua)) return 60;
  return 10;
}

export function scoreClickBot(signals: ClickBotSignals): ClickBotResult {
  let score = userAgentScore(signals.userAgent);

  // CF score is human-on-the-high-end; invert to our bot-on-the-high-end scale.
  if (
    typeof signals.cfBotScore === "number" &&
    signals.cfBotScore >= 1 &&
    signals.cfBotScore <= 99
  ) {
    score = Math.max(score, 100 - signals.cfBotScore);
  }

  if (signals.verifiedBot) score = Math.max(score, 95);

  return { score, isBot: score >= BOT_SCORE_THRESHOLD };
}
