// discovery@1.0.0 — runs Haiku over a pre-fetched signal bundle and returns
// candidates filtered through the kill-list defense-in-depth gate.
//
// Phase 2.2 deliverable per PHASE_PLAN.md:
//   2.2.1 Prompt wired (see prompt.ts)
//   2.2.2 Schema-validated I/O (see schema.ts)
//   2.2.5 Kill-list pre-filter before any DB write (this file)
//
// 2.2.3 (Batch API nightly cron) and 2.2.4 (DB write to niche_candidates)
// belong to apps/scrapers; this module is the runtime-agnostic core.
//
// Kill-list source of truth: @nichefinder/shared/killList. The agent SDK is
// deliberately a thin caller — adding stems here would let drift in.

import {
  CLAUDE_MODEL_STRINGS,
  type KillListMatch,
  matchKillList as matchKillListShared,
} from "@nichefinder/shared";
import { type RunAgentRuntime, runAgent } from "../../runAgent";
import { DISCOVERY_AGENT_VERSION, DISCOVERY_SYSTEM_PROMPT } from "./prompt";
import {
  type DiscoveryInput,
  DiscoveryInputSchema,
  type DiscoveryOutput,
  DiscoveryOutputSchema,
  type NicheCandidate,
} from "./schema";

export {
  DISCOVERY_AGENT_VERSION,
  DISCOVERY_SYSTEM_PROMPT,
  DiscoveryInputSchema,
  DiscoveryOutputSchema,
};
export type { DiscoveryInput, DiscoveryOutput, NicheCandidate };

/**
 * Test a NicheCandidate against the shared kill-list. Adapter that maps the
 * candidate's snake_case fields onto the shared API's camelCase shape.
 * Returns the first match (or null) — once killed, always killed.
 */
export function matchKillList(candidate: NicheCandidate): KillListMatch | null {
  return matchKillListShared({
    topic: candidate.topic,
    topicSlug: candidate.topic_slug,
    relatedKeywords: candidate.related_keywords,
  });
}

export interface FilterResult {
  /** Candidates that passed the kill-list (both hard-block and avoid). */
  kept: NicheCandidate[];
  /** Candidates the gate rejected, with the matched category attached. */
  killed: { candidate: NicheCandidate; match: KillListMatch }[];
}

/** Splits a candidate list into kept + killed in one pass. */
export function applyKillList(candidates: readonly NicheCandidate[]): FilterResult {
  const kept: NicheCandidate[] = [];
  const killed: { candidate: NicheCandidate; match: KillListMatch }[] = [];
  for (const c of candidates) {
    const m = matchKillList(c);
    if (m) killed.push({ candidate: c, match: m });
    else kept.push(c);
  }
  return { kept, killed };
}

export interface RunDiscoveryResult {
  /** Candidates that survived BOTH the model's filter and the host kill-list. */
  candidates: NicheCandidate[];
  /** Candidates the model returned but the host killed (for the kills table). */
  killed: FilterResult["killed"];
  /** Raw agent_runs row id, so the caller can link niche_candidates rows back. */
  agentRunId: string;
  /** EUR cost of this run, for budget telemetry. */
  costEur: number;
}

/**
 * Build the user-turn message the agent reasons over.
 * The system prompt does most of the work; the user turn just dumps the
 * pre-fetched signal table in a stable, deterministic order so that
 * prompt caching stays effective across nights.
 */
function buildUserMessage(input: DiscoveryInput): string {
  const lines: string[] = [];
  lines.push(`Your tools have already produced this batch of signals at ${input.gatheredAt}.`);
  lines.push("Surface candidates.\n");

  // Group by source for readability and to keep token usage tight.
  const bySource = new Map<string, typeof input.signals>();
  for (const s of input.signals) {
    const arr = bySource.get(s.source) ?? [];
    arr.push(s);
    bySource.set(s.source, arr);
  }
  // Stable, alphabetised source order → cache-friendly.
  for (const source of [...bySource.keys()].sort()) {
    lines.push(`[${source}]`);
    for (const s of bySource.get(source) ?? []) {
      lines.push(`- ${s.summary}`);
    }
    lines.push("");
  }
  if (input.excludeSlugs.length > 0) {
    lines.push(`Do NOT resurface these topic_slugs: ${input.excludeSlugs.join(", ")}`);
  }
  lines.push('Return strict JSON: { "candidates": [ ... ] }.');
  return lines.join("\n");
}

/**
 * Run discovery on a batch of pre-fetched signals.
 * The Anthropic call is delegated to runAgent (Zod + budget guard + tier
 * routing + prompt caching). On return we apply the kill-list filter — the
 * model's filter is best-effort; this gate is load-bearing.
 */
export async function runDiscoveryAgent(
  runtime: RunAgentRuntime,
  input: DiscoveryInput,
): Promise<RunDiscoveryResult> {
  const { output, agentRunId, costEur } = await runAgent<DiscoveryInput, DiscoveryOutput>(
    {
      agent: "discovery",
      model: CLAUDE_MODEL_STRINGS.haiku,
      systemPrompt: DISCOVERY_SYSTEM_PROMPT,
      inputSchema: DiscoveryInputSchema,
      outputSchema: DiscoveryOutputSchema,
      buildUserMessage,
      // 50 candidates × ~250 tokens of JSON each ≈ 12.5k; cap at 16k for slack.
      maxTokens: 16_000,
    },
    runtime,
    input,
  );

  // Also drop candidates the operator told us to exclude. The prompt asks the
  // model to do this but we belt-and-braces it here.
  const excluded = new Set(input.excludeSlugs);
  const preExclude = output.candidates.filter((c) => !excluded.has(c.topic_slug));
  const filtered = applyKillList(preExclude);
  return { candidates: filtered.kept, killed: filtered.killed, agentRunId, costEur };
}
