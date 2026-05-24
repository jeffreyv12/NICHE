// Drizzle table definitions — mirror of migrations/0001_init.sql.
//
// IMPORTANT: SQL migrations are the canonical schema. This TS file is the
// type-safe query surface for app code. If you change the SQL, update this
// file in the same PR. CI lints for drift via `pnpm db:check` (Phase 1.6).

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  AFFILIATE_NETWORKS,
  AGENT_NAMES,
  CLAUDE_MODELS,
  CLICK_OUTCOMES,
  KILL_REASONS,
  NICHE_STATES,
  PAGE_KINDS,
  PAGE_STATES,
  PROMOTION_EVALUATION_RESULTS,
  TENANT_KINDS,
} from './enums';

// PG ENUMS ----------------------------------------------------------------

export const nicheStateEnum = pgEnum('niche_state', NICHE_STATES);
export const pageStateEnum = pgEnum('page_state', PAGE_STATES);
export const pageKindEnum = pgEnum('page_kind', PAGE_KINDS);
export const agentNameEnum = pgEnum('agent_name', AGENT_NAMES);
export const claudeModelEnum = pgEnum('claude_model', CLAUDE_MODELS);
export const affiliateNetworkEnum = pgEnum('affiliate_network', AFFILIATE_NETWORKS);
export const tenantKindEnum = pgEnum('tenant_kind', TENANT_KINDS);
export const clickOutcomeEnum = pgEnum('click_outcome', CLICK_OUTCOMES);
export const killReasonEnum = pgEnum('kill_reason', KILL_REASONS);
export const promotionEvaluationResultEnum = pgEnum(
  'promotion_evaluation_result',
  PROMOTION_EVALUATION_RESULTS,
);

// TENANTS -----------------------------------------------------------------

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    kind: tenantKindEnum('kind').notNull(),
    hostname: text('hostname'),
    pathPrefix: text('path_prefix'),
    isActive: boolean('is_active').notNull().default(true),
    isPromoted: boolean('is_promoted').notNull().default(false),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    previousPathPrefix: text('previous_path_prefix'),
    nicheId: uuid('niche_id'),
    config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hostnameOrPath: check(
      'hostname_or_path',
      sql`${t.hostname} is not null or ${t.pathPrefix} is not null`,
    ),
    hostnameUniqueIdx: uniqueIndex('tenants_hostname_unique')
      .on(t.hostname)
      .where(sql`${t.hostname} is not null`),
    pathPrefixUniqueIdx: uniqueIndex('tenants_path_prefix_unique')
      .on(t.pathPrefix)
      .where(sql`${t.pathPrefix} is not null`),
  }),
);

// ADMIN -------------------------------------------------------------------

export const allowedAdmins = pgTable('allowed_admins', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
});

// NICHE CANDIDATES --------------------------------------------------------

export const nicheCandidates = pgTable(
  'niche_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    surfacedAt: timestamp('surfaced_at', { withTimezone: true }).notNull().defaultNow(),
    source: text('source').notNull(),
    raw: jsonb('raw').notNull(),
    topic: text('topic').notNull(),
    topicSlug: text('topic_slug').notNull(),
    relatedKeywords: text('related_keywords').array().notNull().default(sql`'{}'`),
    trademarkCheckState: text('trademark_check_state').notNull().default('pending'),
    trademarkCheckAt: timestamp('trademark_check_at', { withTimezone: true }),
    trademarkConflicts: jsonb('trademark_conflicts'),
    killListMatch: jsonb('kill_list_match'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    topicSlugIdx: index('niche_candidates_topic_slug_idx').on(t.topicSlug),
    sourceSurfacedIdx: index('niche_candidates_source_surfaced_idx').on(
      t.source,
      t.surfacedAt,
    ),
  }),
);

// NICHE SCORES ------------------------------------------------------------

export const nicheScores = pgTable(
  'niche_scores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: uuid('candidate_id')
      .notNull()
      .references(() => nicheCandidates.id, { onDelete: 'cascade' }),
    scoredAt: timestamp('scored_at', { withTimezone: true }).notNull().defaultNow(),
    model: claudeModelEnum('model').notNull(),
    totalScore: integer('total_score').notNull(),
    breakdown: jsonb('breakdown').notNull(),
    rubricVersion: text('rubric_version').notNull(),
    agentRunId: uuid('agent_run_id'),
    notes: text('notes'),
  },
  (t) => ({
    totalScoreCheck: check('niche_scores_total_score_check', sql`${t.totalScore} between 0 and 100`),
    candidateIdx: index('niche_scores_candidate_idx').on(t.candidateId, t.scoredAt),
    totalIdx: index('niche_scores_total_idx').on(t.totalScore, t.scoredAt),
  }),
);

// NICHES ------------------------------------------------------------------

export const niches = pgTable(
  'niches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: uuid('candidate_id').references(() => nicheCandidates.id),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'set null' }),
    topic: text('topic').notNull(),
    topicSlug: text('topic_slug').notNull().unique(),
    state: nicheStateEnum('state').notNull().default('candidate'),
    approvedForValidationAt: timestamp('approved_for_validation_at', { withTimezone: true }),
    validationStartedAt: timestamp('validation_started_at', { withTimezone: true }),
    validationDecidedAt: timestamp('validation_decided_at', { withTimezone: true }),
    buildingStartedAt: timestamp('building_started_at', { withTimezone: true }),
    matureAt: timestamp('mature_at', { withTimezone: true }),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    killedAt: timestamp('killed_at', { withTimezone: true }),
    killReason: killReasonEnum('kill_reason'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    stateIdx: index('niches_state_idx').on(t.state),
    tenantIdx: index('niches_tenant_idx').on(t.tenantId),
  }),
);

// PAGES -------------------------------------------------------------------

export const pages = pgTable(
  'pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    nicheId: uuid('niche_id').references(() => niches.id, { onDelete: 'set null' }),
    slug: text('slug').notNull(),
    fullPath: text('full_path').notNull(),
    kind: pageKindEnum('kind').notNull(),
    title: text('title').notNull(),
    metaDescription: text('meta_description'),
    bodyMd: text('body_md').notNull(),
    bodyHtml: text('body_html'),
    schemaJsonld: jsonb('schema_jsonld'),
    authorName: text('author_name').notNull().default(''),
    authorBylineJsonld: jsonb('author_byline_jsonld'),
    aiAssisted: boolean('ai_assisted').notNull().default(true),
    aiDisclosureJsonld: jsonb('ai_disclosure_jsonld'),
    state: pageStateEnum('state').notNull().default('draft'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedByEmail: text('approved_by_email'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    lastEditedAt: timestamp('last_edited_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    redirectToFullPath: text('redirect_to_full_path'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantSlugUnique: unique().on(t.tenantId, t.slug),
    tenantStateIdx: index('pages_tenant_state_idx').on(t.tenantId, t.state),
    fullPathIdx: index('pages_full_path_idx').on(t.fullPath),
    nicheIdx: index('pages_niche_idx').on(t.nicheId),
  }),
);

// CLAIMS + SOURCES + FIRST-PARTY TESTS -----------------------------------

export const claims = pgTable(
  'claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    claimText: text('claim_text').notNull(),
    claimType: text('claim_type').notNull(),
    isSourced: boolean('is_sourced').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pageIdx: index('claims_page_idx').on(t.pageId),
  }),
);

export const firstPartyTests = pgTable('first_party_tests', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  nicheId: uuid('niche_id').references(() => niches.id),
  productName: text('product_name').notNull(),
  testStartedAt: date('test_started_at'),
  testFinishedAt: date('test_finished_at'),
  testSummaryMd: text('test_summary_md'),
  photos: jsonb('photos'),
  rating: integer('rating'),
  pros: text('pros').array(),
  cons: text('cons').array(),
  affiliateLinks: jsonb('affiliate_links'),
  createdByEmail: text('created_by_email'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const claimSources = pgTable(
  'claim_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
    sourceKind: text('source_kind').notNull(),
    sourceUrl: text('source_url'),
    firstPartyTestId: uuid('first_party_test_id').references(() => firstPartyTests.id),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    excerpt: text('excerpt'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    claimIdx: index('claim_sources_claim_idx').on(t.claimId),
  }),
);

// PRODUCTS ----------------------------------------------------------------

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    nicheId: uuid('niche_id').references(() => niches.id),
    externalId: text('external_id'),
    source: affiliateNetworkEnum('source'),
    name: text('name').notNull(),
    brand: text('brand'),
    category: text('category'),
    description: text('description'),
    imageUrl: text('image_url'),
    priceCents: integer('price_cents'),
    currency: text('currency').notNull().default('EUR'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('products_tenant_idx').on(t.tenantId),
    externalIdx: index('products_external_idx').on(t.source, t.externalId),
  }),
);

// AFFILIATE LINKS ---------------------------------------------------------

export const affiliateLinks = pgTable(
  'affiliate_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    nicheId: uuid('niche_id').references(() => niches.id),
    productId: uuid('product_id').references(() => products.id),
    network: affiliateNetworkEnum('network').notNull(),
    destinationUrl: text('destination_url').notNull(),
    trackingUrl: text('tracking_url').notNull(),
    subid: text('subid').notNull(),
    shortCode: text('short_code').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('affiliate_links_tenant_idx').on(t.tenantId),
    shortCodeIdx: index('affiliate_links_short_code_idx').on(t.shortCode),
  }),
);

// CLICKS ------------------------------------------------------------------

export const clicks = pgTable(
  'clicks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    affiliateLinkId: uuid('affiliate_link_id')
      .notNull()
      .references(() => affiliateLinks.id, { onDelete: 'cascade' }),
    pageId: uuid('page_id').references(() => pages.id),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    referrer: text('referrer'),
    isBot: boolean('is_bot').notNull().default(false),
    botScore: integer('bot_score'),
    cohort: text('cohort'),
    outcome: clickOutcomeEnum('outcome').notNull().default('pending'),
    outcomeSetAt: timestamp('outcome_set_at', { withTimezone: true }),
  },
  (t) => ({
    tenantOccurredIdx: index('clicks_tenant_occurred_idx').on(t.tenantId, t.occurredAt),
    linkIdx: index('clicks_link_idx').on(t.affiliateLinkId),
  }),
);

// CONVERSIONS -------------------------------------------------------------

export const conversions = pgTable(
  'conversions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    network: affiliateNetworkEnum('network').notNull(),
    networkTransactionId: text('network_transaction_id').notNull(),
    affiliateLinkId: uuid('affiliate_link_id').references(() => affiliateLinks.id),
    clickId: uuid('click_id').references(() => clicks.id),
    pageId: uuid('page_id').references(() => pages.id),
    productExternalId: text('product_external_id'),
    amountCents: integer('amount_cents').notNull(),
    commissionCents: integer('commission_cents').notNull(),
    currency: text('currency').notNull().default('EUR'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    status: text('status').notNull(),
    statusSetAt: timestamp('status_set_at', { withTimezone: true }),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    networkTxnUnique: unique().on(t.network, t.networkTransactionId),
    tenantOccurredIdx: index('conversions_tenant_occurred_idx').on(t.tenantId, t.occurredAt),
    statusIdx: index('conversions_status_idx').on(t.status),
  }),
);

// GSC METRICS -------------------------------------------------------------

export const gscMetrics = pgTable(
  'gsc_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    clicks: integer('clicks').notNull().default(0),
    impressions: integer('impressions').notNull().default(0),
    ctr: numeric('ctr', { precision: 6, scale: 4 }),
    avgPosition: numeric('avg_position', { precision: 6, scale: 2 }),
    brandedClicks: integer('branded_clicks').notNull().default(0),
    nonBrandLongTailClicks: integer('non_brand_long_tail_clicks').notNull().default(0),
    byQuery: jsonb('by_query'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantDateUnique: unique().on(t.tenantId, t.date),
    tenantDateIdx: index('gsc_metrics_tenant_date_idx').on(t.tenantId, t.date),
  }),
);

// PROMOTION EVALUATIONS ---------------------------------------------------

export const promotionEvaluations = pgTable(
  'promotion_evaluations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nicheId: uuid('niche_id')
      .notNull()
      .references(() => niches.id, { onDelete: 'cascade' }),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull().defaultNow(),
    result: promotionEvaluationResultEnum('result').notNull(),
    criteria: jsonb('criteria').notNull(),
    recommendation: text('recommendation'),
    agentRunId: uuid('agent_run_id'),
  },
  (t) => ({
    nicheEvalIdx: index('promotion_evaluations_niche_eval_idx').on(t.nicheId, t.evaluatedAt),
  }),
);

// DOMAIN REGISTRATIONS ----------------------------------------------------

export const domainRegistrations = pgTable('domain_registrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  nicheId: uuid('niche_id').references(() => niches.id),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  hostname: text('hostname').notNull().unique(),
  registrar: text('registrar').notNull(),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  autoRenew: boolean('auto_renew').notNull().default(true),
  registrationCostCents: integer('registration_cost_cents'),
  sslProvisionedAt: timestamp('ssl_provisioned_at', { withTimezone: true }),
  dnsPropagatedAt: timestamp('dns_propagated_at', { withTimezone: true }),
  vercelAttachedAt: timestamp('vercel_attached_at', { withTimezone: true }),
  status: text('status').notNull().default('pending'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// AGENT RUNS --------------------------------------------------------------

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agent: agentNameEnum('agent').notNull(),
    model: claudeModelEnum('model').notNull(),
    parentRunId: uuid('parent_run_id'),
    nicheId: uuid('niche_id').references(() => niches.id),
    pageId: uuid('page_id').references(() => pages.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: text('status').notNull().default('running'),
    error: text('error'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    costEur: numeric('cost_eur', { precision: 10, scale: 4 }),
    isBatch: boolean('is_batch').notNull().default(false),
    batchId: text('batch_id'),
    inputHash: text('input_hash'),
    outputHash: text('output_hash'),
  },
  (t) => ({
    agentStartedIdx: index('agent_runs_agent_started_idx').on(t.agent, t.startedAt),
    nicheIdx: index('agent_runs_niche_idx').on(t.nicheId),
    costIdx: index('agent_runs_cost_idx').on(t.startedAt, t.costEur),
  }),
);

// KILLS -------------------------------------------------------------------

export const kills = pgTable('kills', {
  id: uuid('id').primaryKey().defaultRandom(),
  nicheId: uuid('niche_id')
    .notNull()
    .references(() => niches.id),
  killedAt: timestamp('killed_at', { withTimezone: true }).notNull().defaultNow(),
  reason: killReasonEnum('reason').notNull(),
  details: text('details'),
  redirectToNicheId: uuid('redirect_to_niche_id').references(() => niches.id),
  decidedBy: text('decided_by'),
});

// COST LEDGER -------------------------------------------------------------

export const costLedger = pgTable(
  'cost_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    occurredOn: date('occurred_on').notNull(),
    category: text('category').notNull(),
    description: text('description'),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('EUR'),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    nicheId: uuid('niche_id').references(() => niches.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    occurredIdx: index('cost_ledger_occurred_idx').on(t.occurredOn),
  }),
);
