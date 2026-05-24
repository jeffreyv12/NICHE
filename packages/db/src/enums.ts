// Single source of truth for Postgres enum *values*.
// SQL definitions live in migrations/0001_init.sql; these arrays mirror them
// for use both in Drizzle pgEnum() and in app code that needs to enumerate
// allowed values (e.g. dropdowns, validation, kill-list lookups).

export const NICHE_STATES = [
  'candidate',
  'approved_for_validation',
  'validating',
  'go',
  'pivot',
  'building',
  'mature',
  'promoted',
  'killed',
  'archived',
] as const;
export type NicheState = (typeof NICHE_STATES)[number];

export const PAGE_STATES = [
  'draft',
  'pending_review',
  'approved',
  'published',
  'rejected',
  'archived',
] as const;
export type PageState = (typeof PAGE_STATES)[number];

export const APPROVAL_DECISIONS = ['approved', 'rejected', 'changes_requested'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const PAGE_KINDS = [
  'homepage',
  'category',
  'product_review',
  'comparison',
  'buying_guide',
  'how_to',
  'informational',
  'legal',
  'test_page',
  'about',
] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export const AGENT_NAMES = [
  'discovery',
  'scoring',
  'validation',
  'content',
  'promotion',
  'orchestrator',
] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export const CLAUDE_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  'claude-opus-4-7',
] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];

export const AFFILIATE_NETWORKS = [
  'bol',
  'awin',
  'daisycon',
  'digistore24',
  'impact',
  'other',
] as const;
export type AffiliateNetwork = (typeof AFFILIATE_NETWORKS)[number];

export const TENANT_KINDS = ['main_authority', 'subfolder_niche', 'promoted_niche'] as const;
export type TenantKind = (typeof TENANT_KINDS)[number];

export const CLICK_OUTCOMES = ['pending', 'converted', 'rejected', 'expired'] as const;
export type ClickOutcome = (typeof CLICK_OUTCOMES)[number];

export const KILL_REASONS = [
  'low_revenue_month_6',
  'low_traffic_month_6',
  'manual_operator_kill',
  'kill_list_match',
  'duplicate_topic',
  'google_penalty',
  'other',
] as const;
export type KillReason = (typeof KILL_REASONS)[number];

export const PROMOTION_EVALUATION_RESULTS = [
  'not_ready',
  'ready',
  'blocked_by_update_window',
  'blocked_by_single_source',
] as const;
export type PromotionEvaluationResult = (typeof PROMOTION_EVALUATION_RESULTS)[number];
