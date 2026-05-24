// Per-call cost computation from Anthropic token usage.
// Prices live in @nichefinder/shared/constants and SHOULD be verified at
// install time against https://www.anthropic.com/pricing.

import {
  CACHE_PRICE_MULTIPLIERS,
  CLAUDE_PRICES_USD_PER_MTOK,
  USD_TO_EUR_DEFAULT,
  type ClaudeModelString,
} from '@nichefinder/shared';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface CostBreakdown {
  inputCostUsd: number;
  outputCostUsd: number;
  cacheWriteCostUsd: number;
  cacheReadCostUsd: number;
  totalUsd: number;
  totalEur: number;
}

/**
 * Compute EUR cost for a Claude call.
 *
 * Tokens charged as input that came from cache hits should be passed via
 * `cacheReadTokens` — they are billed at 0.1× the input rate, not at the input
 * rate. Tokens billed at the write-premium (1.25× input) are `cacheWriteTokens`.
 * `inputTokens` itself excludes cache reads/writes (matches Anthropic API shape).
 */
export function computeCost(
  model: ClaudeModelString,
  usage: TokenUsage,
  usdToEur: number = USD_TO_EUR_DEFAULT,
): CostBreakdown {
  const price = CLAUDE_PRICES_USD_PER_MTOK[model];
  if (!price) {
    throw new Error(`Unknown model for cost calculation: ${model}`);
  }

  // Prices are $ per million tokens; divide by 1e6 to get $/token.
  const inputCostUsd = (usage.inputTokens / 1_000_000) * price.input;
  const outputCostUsd = (usage.outputTokens / 1_000_000) * price.output;
  const cacheWriteCostUsd =
    ((usage.cacheWriteTokens ?? 0) / 1_000_000) *
    price.input *
    CACHE_PRICE_MULTIPLIERS.cacheWrite;
  const cacheReadCostUsd =
    ((usage.cacheReadTokens ?? 0) / 1_000_000) *
    price.input *
    CACHE_PRICE_MULTIPLIERS.cacheRead;

  const totalUsd = inputCostUsd + outputCostUsd + cacheWriteCostUsd + cacheReadCostUsd;

  return {
    inputCostUsd,
    outputCostUsd,
    cacheWriteCostUsd,
    cacheReadCostUsd,
    totalUsd,
    totalEur: totalUsd * usdToEur,
  };
}

/** Shortcut returning just the EUR total, rounded to 4 decimals (matches DB precision). */
export function computeCostEur(model: ClaudeModelString, usage: TokenUsage): number {
  return Math.round(computeCost(model, usage).totalEur * 10_000) / 10_000;
}
