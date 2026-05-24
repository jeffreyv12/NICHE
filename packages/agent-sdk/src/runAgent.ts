// The runAgent wrapper every agent uses. Implements the runtime pattern from
// docs/ARCHITECTURE.md "Agent runtime pattern" (lines 82-128):
//
//   1. Validate input with Zod
//   2. Open agent_runs row (status='running')
//   3. Budget guard
//   4. Build messages (system prompt with cache_control if enabled)
//   5. Call Claude with the right model
//   6. Validate output with Zod
//   7. Persist output + close run record
//   8. On failure → status='failed' + error logged

import type Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { ZodTypeAny, z } from 'zod';
import { agentRuns, type AgentName, type ClaudeModel, type ServiceDb } from '@nichefinder/db';
import type { ClaudeModelString } from '@nichefinder/shared';
import { getAnthropicClient } from './client';
import { computeCostEur, type TokenUsage } from './cost';
import {
  assertBudgetAvailable,
  assertPerCallCap,
  PerCallCapExceededError,
} from './guards/budget';
import { assertAgentModel, type AgentSlug } from './guards/tier-routing';

export interface RunAgentConfig<TInput, TOutput> {
  /** Agent name; matches the agent_name enum and is used for tier-routing checks. */
  agent: AgentSlug & AgentName;
  /** Model to call. Must be in allowedModelsForAgent(agent). */
  model: ClaudeModelString & ClaudeModel;
  /** System prompt. Cached with cache_control=ephemeral when promptCache=true. */
  systemPrompt: string;
  /** Zod schema for input — validated before any Claude call. */
  inputSchema: ZodTypeAny;
  /** Zod schema for the JSON Claude returns. */
  outputSchema: ZodTypeAny;
  /** Builder for the user-turn content from validated input. */
  buildUserMessage: (input: TInput) => string;
  /** Optional tool defs forwarded to Anthropic. */
  tools?: Anthropic.Tool[];
  /** Hard cap on output tokens. Default 4096. */
  maxTokens?: number;
  /** Optional foreign-key niche_id for this run. */
  nicheId?: string;
  /** Optional foreign-key page_id for this run. */
  pageId?: string;
  /** Optional parent_run_id for sub-agent runs. */
  parentRunId?: string;
}

export interface RunAgentRuntime {
  db: ServiceDb;
  /** Monthly Claude budget in EUR. Pull from env at boot. */
  monthlyBudgetEur: number;
  /** Per-call cap in EUR. Pull from env at boot. */
  perCallCapEur: number;
  /** Toggle prompt caching on the system prompt. Default true. */
  promptCache?: boolean;
  /** Anthropic client. Defaults to the singleton from getAnthropicClient(). */
  client?: Anthropic;
  /** TInput → JSON-string serializer for hashing (default JSON.stringify). */
  serializeForHash?: (value: unknown) => string;
}

export interface RunAgentResult<TOutput> {
  output: TOutput;
  agentRunId: string;
  costEur: number;
  usage: TokenUsage;
  raw: Anthropic.Message;
}

export class AgentOutputSchemaError extends Error {
  constructor(
    public agent: string,
    public issues: z.ZodIssue[],
    public rawText: string,
  ) {
    super(`Agent ${agent} returned output that failed schema validation`);
    this.name = 'AgentOutputSchemaError';
  }
}

/**
 * Run one agent call end-to-end with all guards, persistence, and validation.
 */
export async function runAgent<TInput, TOutput>(
  config: RunAgentConfig<TInput, TOutput>,
  runtime: RunAgentRuntime,
  input: TInput,
): Promise<RunAgentResult<TOutput>> {
  // 1. Validate input
  const parsedInput = config.inputSchema.parse(input) as TInput;

  // 2. Tier-routing compile-time check (also enforced at type level)
  assertAgentModel(config.agent, config.model);

  // 3. Budget guard (pre-call)
  await assertBudgetAvailable(runtime.db, runtime.monthlyBudgetEur);

  // 4. Open agent_runs row
  const serialize = runtime.serializeForHash ?? JSON.stringify;
  const inputHash = hashString(serialize(parsedInput));

  const [run] = await runtime.db
    .insert(agentRuns)
    .values({
      agent: config.agent,
      model: config.model,
      parentRunId: config.parentRunId,
      nicheId: config.nicheId,
      pageId: config.pageId,
      status: 'running',
      inputHash,
    })
    .returning({ id: agentRuns.id });

  if (!run) throw new Error('failed to insert agent_runs row');
  const runId = run.id;

  // 5. Build messages
  const promptCache = runtime.promptCache ?? true;
  const system: Anthropic.MessageParam['content'] = promptCache
    ? [
        {
          type: 'text',
          text: config.systemPrompt,
          cache_control: { type: 'ephemeral' },
        } as Anthropic.TextBlockParam,
      ]
    : [{ type: 'text', text: config.systemPrompt }];

  const client = runtime.client ?? getAnthropicClient();

  // 6. Call Claude
  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens ?? 4096,
      system,
      messages: [{ role: 'user', content: config.buildUserMessage(parsedInput) }],
      tools: config.tools,
    });
  } catch (err) {
    await markFailed(runtime.db, runId, err);
    throw err;
  }

  // 7. Compute cost + apply per-call cap
  const usage: TokenUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  };
  const costEur = computeCostEur(config.model, usage);

  try {
    assertPerCallCap(costEur, runtime.perCallCapEur);
  } catch (err) {
    if (err instanceof PerCallCapExceededError) {
      await markFailed(runtime.db, runId, err, { usage, costEur });
    }
    throw err;
  }

  // 8. Extract and validate output
  const rawText = extractTextOutput(response);
  let outputJson: unknown;
  try {
    outputJson = JSON.parse(rawText);
  } catch {
    await markFailed(
      runtime.db,
      runId,
      new Error(`Agent ${config.agent} returned non-JSON output`),
      { usage, costEur, rawText },
    );
    throw new AgentOutputSchemaError(config.agent, [], rawText);
  }

  const validated = config.outputSchema.safeParse(outputJson);
  if (!validated.success) {
    const err = new AgentOutputSchemaError(
      config.agent,
      validated.error.issues,
      rawText,
    );
    await markFailed(runtime.db, runId, err, { usage, costEur, rawText });
    throw err;
  }

  const output = validated.data as TOutput;

  // 9. Persist success
  const outputHash = hashString(JSON.stringify(output));
  await runtime.db
    .update(agentRuns)
    .set({
      finishedAt: new Date(),
      status: 'success',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      costEur: costEur.toString(),
      outputHash,
    })
    .where(eq(agentRuns.id, runId));

  return { output, agentRunId: runId, costEur, usage, raw: response };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function extractTextOutput(response: Anthropic.Message): string {
  const parts: string[] = [];
  for (const block of response.content) {
    if (block.type === 'text') parts.push(block.text);
  }
  return parts.join('').trim();
}

function hashString(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

async function markFailed(
  db: ServiceDb,
  runId: string,
  err: unknown,
  extras?: { usage?: TokenUsage; costEur?: number; rawText?: string },
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await db
    .update(agentRuns)
    .set({
      finishedAt: new Date(),
      status: 'failed',
      error: message + (extras?.rawText ? `\n---\nRAW: ${extras.rawText.slice(0, 2000)}` : ''),
      inputTokens: extras?.usage?.inputTokens,
      outputTokens: extras?.usage?.outputTokens,
      cacheReadTokens: extras?.usage?.cacheReadTokens,
      cacheWriteTokens: extras?.usage?.cacheWriteTokens,
      costEur: extras?.costEur?.toString(),
    })
    .where(eq(agentRuns.id, runId));
}
