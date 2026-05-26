// Cross-package constants. Pure data — no I/O.

/**
 * Locked model strings. These are the only Claude models the engine calls.
 * Updating these means CLAUDE.md, the rubric, and per-agent allowlists all
 * need an audit pass.
 */
export const CLAUDE_MODEL_STRINGS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-7",
} as const;

export type ClaudeModelKey = keyof typeof CLAUDE_MODEL_STRINGS;
export type ClaudeModelString = (typeof CLAUDE_MODEL_STRINGS)[ClaudeModelKey];

/**
 * Anthropic published prices in USD per million tokens.
 * VERIFY against https://www.anthropic.com/pricing at install time and on
 * every Anthropic model release. If a price is wrong, the cost guard is wrong.
 *
 * Cache writes are billed at 1.25× the input rate; cache reads at 0.1× the input rate.
 */
export const CLAUDE_PRICES_USD_PER_MTOK = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-4-7": { input: 15, output: 75 },
} as const;

/** Standing rate used when computing EUR cost from USD price. */
export const USD_TO_EUR_DEFAULT = 0.92;

/**
 * Cache pricing multipliers. From Anthropic prompt caching docs.
 */
export const CACHE_PRICE_MULTIPLIERS = {
  cacheWrite: 1.25, // 25% premium over input price
  cacheRead: 0.1, // 90% discount on input price
} as const;

/**
 * Default per-host RPS limit for scrapers. Overridable per source.
 * Set conservatively; pushed higher only after documenting the source's limit.
 */
export const DEFAULT_SCRAPER_RPS = 1;

/**
 * Public user-agent the scrapers identify as. Real value from env.
 */
export const SCRAPER_UA_DEFAULT = "NicheFinder/1.0 (+https://example.com/about-bot)";

/**
 * Per-source overrides on rate limits and conventions. Hard-coded for sources
 * we know the limits of.
 */
export const SOURCE_LIMITS = {
  dataforseo: { maxRpm: 2000 },
  awin: { maxRpm: 20 }, // 20/min global
  daisycon: { maxRpm: 60 },
  bol: { maxRpm: 60 }, // conservative; per-endpoint varies
  digistore24: { maxRpm: 60 },
  impact: { maxRpm: 60 },
  youtube: { quotaUnitsPerDay: 10_000 },
  wikipedia: { maxRps: 5 }, // documented 100/sec; be polite
  euipo: { maxRps: 1 },
} as const;

/**
 * Money helpers — keep everything in EUR cents (integer) to avoid float drift.
 */
export const eurosToCents = (eur: number): number => Math.round(eur * 100);
export const centsToEuros = (cents: number): number => cents / 100;
