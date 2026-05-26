// @nichefinder/agent-sdk — public surface.

export { getAnthropicClient } from "./client";
export { computeCost, computeCostEur, type TokenUsage, type CostBreakdown } from "./cost";
export {
  assertBudgetAvailable,
  assertPerCallCap,
  getMonthlyBudgetState,
  BudgetExceededError,
  PerCallCapExceededError,
  type BudgetState,
} from "./guards/budget";
export {
  allowedModelsForAgent,
  assertAgentModel,
  ALLOWED_MODELS_PER_AGENT,
  TierRoutingError,
  type AgentSlug,
} from "./guards/tier-routing";
export {
  runAgent,
  AgentOutputSchemaError,
  type RunAgentConfig,
  type RunAgentRuntime,
  type RunAgentResult,
} from "./runAgent";
export * as echoAgent from "./agents/echo";
export * as discoveryAgent from "./agents/discovery";
