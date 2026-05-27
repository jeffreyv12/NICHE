// content@1.0.0 — draft + polish passes for tenant content pages.
//
// Phase 4 surface; on-demand operator-triggered. Tier-routing per CLAUDE.md
// non-negotiable #7:
//   - draft pass  → Sonnet 4.6 (most pages stop here)
//   - polish pass → Opus  4.7 (hero/commercial pages only)
//
// Trust model:
//   - The agent is told to never invent facts and to flag uncertainty as an
//     operator_todo. The host doesn't try to fact-check — only checks
//     structural invariants (affiliate + AI disclosure present in body).
//   - Host invariants run AFTER the model; failure marks needs_polish_pass=
//     true and adds a synthetic operator_todo rather than overwriting the
//     body. The operator approves before publishing (CLAUDE.md gate #1).

import { CLAUDE_MODEL_STRINGS } from "@nichefinder/shared";
import { type RunAgentRuntime, runAgent } from "../../runAgent";
import {
  CONTENT_AGENT_VERSION,
  CONTENT_DRAFT_SYSTEM_PROMPT,
  CONTENT_POLISH_SYSTEM_PROMPT,
} from "./prompt";
import {
  CONTENT_CLAIM_TYPES,
  CONTENT_PAGE_KINDS,
  type ContentClaimType,
  type ContentDraftInput,
  ContentDraftInputSchema,
  type ContentOutput,
  ContentOutputSchema,
  type ContentPageKind,
  type ContentPolishInput,
  ContentPolishInputSchema,
} from "./schema";

export {
  CONTENT_AGENT_VERSION,
  CONTENT_DRAFT_SYSTEM_PROMPT,
  CONTENT_POLISH_SYSTEM_PROMPT,
  CONTENT_CLAIM_TYPES,
  CONTENT_PAGE_KINDS,
  ContentDraftInputSchema,
  ContentPolishInputSchema,
  ContentOutputSchema,
};
export type {
  ContentClaimType,
  ContentDraftInput,
  ContentOutput,
  ContentPageKind,
  ContentPolishInput,
};

// ---------------------------------------------------------------------------
// Host structural invariants — Disclosure required, AI assistance required.
// CLAUDE.md non-negotiables #4 (AI disclosure) and #5 (affiliate disclosure).
// ---------------------------------------------------------------------------

const AFFILIATE_DISCLOSURE_NEEDLE = /affiliate links?/i;
// The prompt mandates: "Dit artikel is geschreven met hulp van AI en geredigeerd door …".
// Anchor on that phrase so a stray "ai-melding" or "AI-iets" doesn't pass.
const AI_DISCLOSURE_NEEDLE =
  /(met hulp van AI|kunstmatige intelligentie|AI-(?:assisted|geassisteerd|gestuurd))/i;

export interface DisclosureCheckResult {
  hasAffiliateDisclosure: boolean;
  hasAiDisclosure: boolean;
  ok: boolean;
}

export function checkDisclosures(bodyMd: string): DisclosureCheckResult {
  const hasAffiliateDisclosure = AFFILIATE_DISCLOSURE_NEEDLE.test(bodyMd);
  const hasAiDisclosure = AI_DISCLOSURE_NEEDLE.test(bodyMd);
  return {
    hasAffiliateDisclosure,
    hasAiDisclosure,
    ok: hasAffiliateDisclosure && hasAiDisclosure,
  };
}

/**
 * Append synthetic operator_todos and force needs_polish_pass=true if the body
 * is missing a disclosure. Pure; no I/O.
 */
export function enforceDisclosures(output: ContentOutput): ContentOutput {
  const check = checkDisclosures(output.page.body_md);
  if (check.ok) return output;
  const todos = [...output.operator_todos];
  if (!check.hasAffiliateDisclosure) {
    todos.push("[BLOCKER] Affiliate-disclosure ontbreekt in body — voeg toe vóór publiceren.");
  }
  if (!check.hasAiDisclosure) {
    todos.push("[BLOCKER] AI-disclosure ontbreekt in body — voeg toe vóór publiceren.");
  }
  return { ...output, operator_todos: todos, needs_polish_pass: true };
}

// ---------------------------------------------------------------------------
// User-turn builders.
// ---------------------------------------------------------------------------

function buildDraftUserMessage(input: ContentDraftInput): string {
  return JSON.stringify(
    {
      task: "draft_one_page",
      niche: input.niche,
      page: input.page,
      products: input.products,
      first_party_tests: input.first_party_tests,
      existing_claims: input.existing_claims,
      brand_voice_notes: input.brand_voice_notes ?? null,
    },
    null,
    2,
  );
}

function buildPolishUserMessage(input: ContentPolishInput): string {
  return JSON.stringify(
    {
      task: "polish_hero_page",
      niche: input.niche,
      page: input.page,
      products: input.products,
      first_party_tests: input.first_party_tests,
      existing_claims: input.existing_claims,
      brand_voice_notes: input.brand_voice_notes ?? null,
      draft: input.draft,
      operator_edited_body_md: input.operator_edited_body_md,
      peer_pages: input.peer_pages,
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

export interface RunContentResult {
  output: ContentOutput;
  /** Did the host insert disclosure-missing BLOCKER todos? */
  disclosuresAmended: boolean;
  agentRunId: string;
  costEur: number;
}

export async function runContentDraft(
  runtime: RunAgentRuntime,
  input: ContentDraftInput,
): Promise<RunContentResult> {
  const { output, agentRunId, costEur } = await runAgent<ContentDraftInput, ContentOutput>(
    {
      agent: "content",
      model: CLAUDE_MODEL_STRINGS.sonnet,
      systemPrompt: CONTENT_DRAFT_SYSTEM_PROMPT,
      inputSchema: ContentDraftInputSchema,
      outputSchema: ContentOutputSchema,
      buildUserMessage: buildDraftUserMessage,
      // Long body markdown → generous cap.
      maxTokens: 16_000,
    },
    runtime,
    input,
  );

  const enforced = enforceDisclosures(output);
  return {
    output: enforced,
    disclosuresAmended: enforced !== output,
    agentRunId,
    costEur,
  };
}

export async function runContentPolish(
  runtime: RunAgentRuntime,
  input: ContentPolishInput,
): Promise<RunContentResult> {
  const { output, agentRunId, costEur } = await runAgent<ContentPolishInput, ContentOutput>(
    {
      agent: "content",
      model: CLAUDE_MODEL_STRINGS.opus,
      systemPrompt: CONTENT_POLISH_SYSTEM_PROMPT,
      inputSchema: ContentPolishInputSchema,
      outputSchema: ContentOutputSchema,
      buildUserMessage: buildPolishUserMessage,
      maxTokens: 16_000,
    },
    runtime,
    input,
  );

  const enforced = enforceDisclosures(output);
  return {
    output: enforced,
    disclosuresAmended: enforced !== output,
    agentRunId,
    costEur,
  };
}
