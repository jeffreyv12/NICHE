// echo@1.0.0 — smoke-test agent. Runs on Haiku (cheapest model in the discovery tier).

import { CLAUDE_MODEL_STRINGS } from "@nichefinder/shared";
import { type RunAgentRuntime, runAgent } from "../../runAgent";
import { ECHO_SYSTEM_PROMPT } from "./prompt";
import { type EchoInput, EchoInputSchema, type EchoOutput, EchoOutputSchema } from "./schema";

export { ECHO_AGENT_VERSION, ECHO_SYSTEM_PROMPT } from "./prompt";
export { EchoInputSchema, EchoOutputSchema, type EchoInput, type EchoOutput } from "./schema";

export async function runEchoAgent(
  runtime: RunAgentRuntime,
  input: EchoInput,
): Promise<EchoOutput> {
  const { output } = await runAgent<EchoInput, EchoOutput>(
    {
      // Echo uses the discovery agent slot for tier-routing purposes (Haiku only).
      agent: "discovery",
      model: CLAUDE_MODEL_STRINGS.haiku,
      systemPrompt: ECHO_SYSTEM_PROMPT,
      inputSchema: EchoInputSchema,
      outputSchema: EchoOutputSchema,
      buildUserMessage: (i) => i.text,
      maxTokens: 512,
    },
    runtime,
    input,
  );
  return output;
}
