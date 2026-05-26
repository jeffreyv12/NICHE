// Anthropic SDK client factory.
// One instance per process, lazy-init, beta headers applied uniformly.

import Anthropic from "@anthropic-ai/sdk";

let cached: Anthropic | undefined;

export interface GetClientOptions {
  /** Override API key (tests). Defaults to ANTHROPIC_API_KEY env. */
  apiKey?: string;
  /** Comma-separated beta headers. Defaults to ANTHROPIC_BETA_HEADERS env. */
  betaHeaders?: string;
}

export function getAnthropicClient(options: GetClientOptions = {}): Anthropic {
  if (cached && !options.apiKey) return cached;

  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required. See .env.example.");
  }

  const betaHeaders = options.betaHeaders ?? process.env.ANTHROPIC_BETA_HEADERS ?? "";

  const client = new Anthropic({
    apiKey,
    defaultHeaders: betaHeaders ? { "anthropic-beta": betaHeaders } : undefined,
  });

  if (!options.apiKey) cached = client;
  return client;
}

/** Test-only cache reset. */
export function _resetClientForTests(): void {
  cached = undefined;
}
