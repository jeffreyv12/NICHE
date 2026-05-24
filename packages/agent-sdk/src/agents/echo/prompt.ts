// echo@1.0.0 — smoke-test agent.
// Used by Phase 1.5 acceptance: prove the runAgent wrapper end-to-end with a
// trivial round-trip. Returns the input verbatim as JSON.

export const ECHO_AGENT_VERSION = '1.0.0';

export const ECHO_SYSTEM_PROMPT = `You are an echo agent. The user message contains arbitrary text.

Return strict JSON of the shape:
{"echoed": "<the user message exactly>", "received_chars": <integer length>}

No prose. No markdown fences. JSON only.`;
