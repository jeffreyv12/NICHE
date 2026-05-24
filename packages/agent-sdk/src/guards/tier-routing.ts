// Compile-time + runtime tier-routing per agent.
//
// CLAUDE.md non-negotiable #7: Haiku for discovery/scoring/extraction (60%),
// Sonnet for validation/content (35%), Opus for promotion/orchestrator (5%).
//
// "Compile-time enforced via a wrapper that takes only allowed model strings
// per agent type" — we declare allowed sets and assertAgentModel() throws.

import { CLAUDE_MODEL_STRINGS, type ClaudeModelString } from '@nichefinder/shared';

const { haiku, sonnet, opus } = CLAUDE_MODEL_STRINGS;

export const ALLOWED_MODELS_PER_AGENT = {
  discovery: [haiku] as const,
  scoring: [haiku, sonnet] as const, // sonnet on 55–70 escalation
  validation: [sonnet] as const,
  content: [sonnet, opus] as const, // opus on hero polish pass
  promotion: [opus] as const,
  orchestrator: [opus] as const,
} satisfies Record<string, readonly ClaudeModelString[]>;

export type AgentSlug = keyof typeof ALLOWED_MODELS_PER_AGENT;

export function allowedModelsForAgent(agent: AgentSlug): readonly ClaudeModelString[] {
  return ALLOWED_MODELS_PER_AGENT[agent];
}

export class TierRoutingError extends Error {
  constructor(
    public agent: AgentSlug,
    public model: string,
    allowed: readonly string[],
  ) {
    super(
      `Tier-routing violation: agent="${agent}" tried to call model="${model}". ` +
        `Allowed: ${allowed.join(', ')}. See CLAUDE.md non-negotiable #7.`,
    );
    this.name = 'TierRoutingError';
  }
}

export function assertAgentModel(agent: AgentSlug, model: string): asserts model is ClaudeModelString {
  const allowed = ALLOWED_MODELS_PER_AGENT[agent];
  if (!(allowed as readonly string[]).includes(model)) {
    throw new TierRoutingError(agent, model, allowed);
  }
}
