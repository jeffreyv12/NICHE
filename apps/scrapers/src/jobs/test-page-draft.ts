// Phase 3.1 — Test-page draft job.
//
// Given a niche that has just entered validation, draft N (3–5) test pages
// via the Content Agent (Sonnet 4.6, no Opus polish at this phase), insert
// them as `pages` rows in `state=draft`, and pre-create the affiliate_links
// each page will reference.
//
// Dependency injection mirrors `scoring.ts` so the job is unit-testable
// without a live DB or live LLM calls.
//
// Trust boundary: the Content Agent's structural invariants (affiliate +
// AI disclosure in body) are enforced inside runContentDraft — we don't
// re-check here. Operator approves before publish (CLAUDE.md gate #1).

import { randomUUID } from "node:crypto";
import { contentAgent } from "@nichefinder/agent-sdk";
import type { RunAgentRuntime } from "@nichefinder/agent-sdk";

type ContentDraftInput = contentAgent.ContentDraftInput;
type ContentOutput = contentAgent.ContentOutput;
import {
  type ServiceDb,
  affiliateLinks,
  claimSources,
  claims,
  niches,
  pages,
  products,
  tenants,
} from "@nichefinder/db";
import { eq } from "drizzle-orm";
import { type TestPagePlanItem, planTestPages } from "./planTestPages.js";

// -----------------------------------------------------------------------------
// Public surface
// -----------------------------------------------------------------------------

export interface RunTestPageDraftJobOptions {
  db: ServiceDb;
  runtime: RunAgentRuntime;
  nicheId: string;
  /** Override the default planner (tests pass a fixed plan). */
  planner?: (niche: NicheRow) => TestPagePlanItem[];
  /**
   * Build the network tracking URL from a destination + subid. Default just
   * appends ?subid= — real network adapters land in Phase 3.2.
   */
  buildTrackingUrl?: (destinationUrl: string, subid: string) => string;
  /**
   * Short-code generator (override for deterministic tests).
   */
  generateShortCode?: () => string;
}

export interface DraftedTestPage {
  pageId: string;
  pageSlug: string;
  kind: TestPagePlanItem["kind"];
  cohort: string;
  agentRunId: string;
  costEur: number;
  disclosuresAmended: boolean;
  affiliateLinkIds: string[];
  /** Claims persisted for the Claim Verifier gate (Phase 4.2). */
  claimsPersisted: number;
}

export interface RunTestPageDraftJobResult {
  nicheId: string;
  tenantId: string;
  drafted: DraftedTestPage[];
  totalCostEur: number;
  failures: Array<{ pageSlug: string; error: string }>;
}

// -----------------------------------------------------------------------------
// DB row shapes (narrow — only what the job needs)
// -----------------------------------------------------------------------------

interface NicheRow {
  id: string;
  tenantId: string | null;
  topic: string;
  topicSlug: string;
  /** Reconstructed from candidate.related_keywords when present, else []. */
  relatedKeywords: string[];
  language: "nl" | "en";
}

interface TenantRow {
  id: string;
  slug: string;
  config: Record<string, unknown>;
}

interface ProductRow {
  id: string;
  externalId: string | null;
  name: string;
  priceCents: number | null;
  source: string | null;
  raw: unknown;
}

// -----------------------------------------------------------------------------
// Job entry
// -----------------------------------------------------------------------------

export async function runTestPageDraftJob(
  opts: RunTestPageDraftJobOptions,
): Promise<RunTestPageDraftJobResult> {
  const niche = await loadNiche(opts.db, opts.nicheId);
  if (!niche) {
    throw new Error(`niche not found: ${opts.nicheId}`);
  }
  if (!niche.tenantId) {
    throw new Error(
      `niche ${niche.topicSlug} has no tenantId — assign tenant before drafting test pages`,
    );
  }

  const tenant = await loadTenant(opts.db, niche.tenantId);
  if (!tenant) {
    throw new Error(`tenant ${niche.tenantId} not found for niche ${niche.topicSlug}`);
  }

  const nicheProducts = await loadProducts(opts.db, niche.id);

  const plan = (opts.planner ?? planTestPages)(niche);
  if (plan.length < 3 || plan.length > 5) {
    throw new Error(
      `planTestPages returned ${plan.length} items — Phase 3.1 requires 3–5 per niche`,
    );
  }
  assertUniqueSlugs(plan);

  const brandVoiceNotes = readBrandVoiceNotes(tenant.config);
  const authorDisplayName = readAuthorName(tenant.config) ?? tenant.slug;
  const buildTrackingUrl = opts.buildTrackingUrl ?? defaultBuildTrackingUrl;
  const generateShortCode = opts.generateShortCode ?? defaultShortCode;

  const drafted: DraftedTestPage[] = [];
  const failures: RunTestPageDraftJobResult["failures"] = [];
  let totalCostEur = 0;

  for (const item of plan) {
    try {
      const result = await draftOne({
        db: opts.db,
        runtime: opts.runtime,
        niche,
        tenant,
        item,
        nicheProducts,
        brandVoiceNotes,
        authorDisplayName,
        buildTrackingUrl,
        generateShortCode,
      });
      drafted.push(result);
      totalCostEur += result.costEur;
    } catch (err) {
      failures.push({
        pageSlug: item.pageSlug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    nicheId: niche.id,
    tenantId: niche.tenantId,
    drafted,
    totalCostEur,
    failures,
  };
}

// -----------------------------------------------------------------------------
// Per-item flow:
//   1. Generate pageId client-side (UUID)
//   2. Build subid + short_code per product, insert affiliate_links rows
//   3. Substitute product.url → /r/<short_code> for the agent input
//   4. runContentDraft → enforced output
//   5. Insert pages row with state=draft, ai_assisted=true
// -----------------------------------------------------------------------------

async function draftOne(params: {
  db: ServiceDb;
  runtime: RunAgentRuntime;
  niche: NicheRow;
  tenant: TenantRow;
  item: TestPagePlanItem;
  nicheProducts: ProductRow[];
  brandVoiceNotes: string | undefined;
  authorDisplayName: string;
  buildTrackingUrl: (destinationUrl: string, subid: string) => string;
  generateShortCode: () => string;
}): Promise<DraftedTestPage> {
  const {
    db,
    runtime,
    niche,
    tenant,
    item,
    nicheProducts,
    brandVoiceNotes,
    authorDisplayName,
    buildTrackingUrl,
    generateShortCode,
  } = params;

  const pageId = randomUUID();
  const fullPath = `/test/${niche.topicSlug}/${item.pageSlug}`;

  // Affiliate links — one per product, subid = [tenant_slug]:[page_slug]:[cohort]
  // The redirect URL we hand to the agent points at /r/<short_code>?c=<cohort>.
  const subid = `${tenant.slug}:${item.pageSlug}:${item.cohort}`;
  const linkRows = nicheProducts
    .filter((p) => p.externalId && readProductUrl(p) !== null)
    .map((p) => {
      const destinationUrl = readProductUrl(p) as string;
      const shortCode = generateShortCode();
      return {
        id: randomUUID(),
        tenantId: tenant.id,
        nicheId: niche.id,
        productId: p.id,
        network:
          (p.source as "bol" | "awin" | "daisycon" | "digistore24" | "impact" | "other") ?? "other",
        destinationUrl,
        trackingUrl: buildTrackingUrl(destinationUrl, subid),
        subid,
        shortCode,
        product: p,
      };
    });

  if (linkRows.length > 0) {
    await db.insert(affiliateLinks).values(
      linkRows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        nicheId: r.nicheId,
        productId: r.productId,
        network: r.network,
        destinationUrl: r.destinationUrl,
        trackingUrl: r.trackingUrl,
        subid: r.subid,
        shortCode: r.shortCode,
      })),
    );
  }

  const agentInput: ContentDraftInput = {
    niche: {
      topic: niche.topic,
      topic_slug: niche.topicSlug,
      language: niche.language,
    },
    page: {
      kind: item.kind,
      primary_keyword: item.primaryKeyword,
      secondary_keywords: item.secondaryKeywords,
      target_word_count: item.targetWordCount,
      author_display_name: authorDisplayName,
    },
    products: linkRows.map((r) => ({
      external_id: r.product.externalId as string,
      name: r.product.name,
      price_eur: typeof r.product.priceCents === "number" ? r.product.priceCents / 100 : undefined,
      url: redirectUrlFor(tenant, r.shortCode, item.cohort, pageId),
      network: r.network,
    })),
    first_party_tests: [],
    existing_claims: [],
    brand_voice_notes: brandVoiceNotes,
  };

  const run = await contentAgent.runContentDraft(runtime, agentInput);

  await db.insert(pages).values({
    id: pageId,
    tenantId: tenant.id,
    nicheId: niche.id,
    slug: item.pageSlug,
    fullPath,
    kind: "test_page",
    title: run.output.page.title,
    metaDescription: run.output.page.meta_description,
    bodyMd: run.output.page.body_md,
    bodyHtml: null,
    schemaJsonld: run.output.page.schema_jsonld,
    authorName: authorDisplayName,
    authorBylineJsonld: null,
    aiAssisted: true,
    aiDisclosureJsonld: run.output.page.ai_disclosure_jsonld,
    state: "draft",
  });

  // Persist the claims the agent surfaced so the Claim Verifier (Phase 4.2) can
  // gate approval. Each suggested_source becomes a claim_sources row; a claim
  // with ≥1 source is marked is_sourced (the verifier still re-checks live).
  const claimsPersisted = await persistClaims(db, pageId, run.output.claims);

  return {
    pageId,
    pageSlug: item.pageSlug,
    kind: item.kind,
    cohort: item.cohort,
    agentRunId: run.agentRunId,
    costEur: run.costEur,
    disclosuresAmended: run.disclosuresAmended,
    affiliateLinkIds: linkRows.map((r) => r.id),
    claimsPersisted,
  };
}

interface ClaimInsert {
  id: string;
  pageId: string;
  claimText: string;
  claimType: string;
  isSourced: boolean;
}
interface ClaimSourceInsert {
  id: string;
  claimId: string;
  sourceKind: string;
  sourceUrl: string;
  excerpt: string;
}

/** Write the agent's claims + their suggested sources. Returns claim count. */
async function persistClaims(
  db: ServiceDb,
  pageId: string,
  claimOutputs: ContentOutput["claims"],
): Promise<number> {
  if (claimOutputs.length === 0) return 0;

  const claimRows: ClaimInsert[] = [];
  const sourceRows: ClaimSourceInsert[] = [];
  for (const c of claimOutputs) {
    const claimId = randomUUID();
    claimRows.push({
      id: claimId,
      pageId,
      claimText: c.claim_text,
      claimType: c.claim_type,
      isSourced: c.suggested_sources.length > 0,
    });
    for (const s of c.suggested_sources) {
      sourceRows.push({
        id: randomUUID(),
        claimId,
        sourceKind: "web",
        sourceUrl: s.source_url,
        excerpt: s.excerpt,
      });
    }
  }

  await db.insert(claims).values(claimRows);
  if (sourceRows.length > 0) await db.insert(claimSources).values(sourceRows);
  return claimRows.length;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function assertUniqueSlugs(plan: TestPagePlanItem[]): void {
  const seen = new Set<string>();
  for (const item of plan) {
    if (seen.has(item.pageSlug)) {
      throw new Error(`duplicate pageSlug in plan: ${item.pageSlug}`);
    }
    seen.add(item.pageSlug);
  }
}

function defaultBuildTrackingUrl(destinationUrl: string, subid: string): string {
  // Placeholder — Phase 3.2 will replace this with network-specific deep
  // links (Bol Partner subid param, Awin clickref, Daisycon ws/p, etc.).
  const sep = destinationUrl.includes("?") ? "&" : "?";
  return `${destinationUrl}${sep}subid=${encodeURIComponent(subid)}`;
}

function defaultShortCode(): string {
  // 8-char base62 — collision risk negligible at our scale; unique constraint
  // on affiliate_links.short_code will catch the astronomically rare clash.
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomUUID().replace(/-/g, "");
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[Number.parseInt(bytes.slice(i * 2, i * 2 + 2), 16) % alphabet.length];
  }
  return out;
}

function redirectUrlFor(
  tenant: TenantRow,
  shortCode: string,
  cohort: string,
  pageId: string,
): string {
  // For NL/BE we serve under the main authority hostname during validation.
  // The agent only needs a syntactically valid absolute URL; the real host
  // resolution happens at request time. `p` lets /r attribute the click (and
  // any later conversion) to this page — see apps/web/app/r/[short_code].
  const host = readHostname(tenant.config) ?? "https://example.test";
  return `${host}/r/${shortCode}?c=${encodeURIComponent(cohort)}&p=${pageId}`;
}

function readBrandVoiceNotes(config: Record<string, unknown>): string | undefined {
  const brand = (config.brand ?? {}) as { voice?: unknown };
  return typeof brand.voice === "string" ? brand.voice : undefined;
}

function readAuthorName(config: Record<string, unknown>): string | undefined {
  const brand = (config.brand ?? {}) as { author?: unknown };
  return typeof brand.author === "string" ? brand.author : undefined;
}

function readHostname(config: Record<string, unknown>): string | undefined {
  const site = (config.site ?? {}) as { canonicalHost?: unknown };
  return typeof site.canonicalHost === "string" ? site.canonicalHost : undefined;
}

function readProductUrl(p: ProductRow): string | null {
  const raw = (p.raw ?? {}) as { url?: unknown; deepLink?: unknown };
  if (typeof raw.url === "string") return raw.url;
  if (typeof raw.deepLink === "string") return raw.deepLink;
  return null;
}

// -----------------------------------------------------------------------------
// Loaders
// -----------------------------------------------------------------------------

async function loadNiche(db: ServiceDb, nicheId: string): Promise<NicheRow | null> {
  const rows = (await db
    .select({
      id: niches.id,
      tenantId: niches.tenantId,
      topic: niches.topic,
      topicSlug: niches.topicSlug,
    })
    .from(niches)
    .where(eq(niches.id, nicheId))
    .limit(1)) as Array<{
    id: string;
    tenantId: string | null;
    topic: string;
    topicSlug: string;
  }>;
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    relatedKeywords: [],
    language: inferLanguage(row.topic),
  };
}

async function loadTenant(db: ServiceDb, tenantId: string): Promise<TenantRow | null> {
  const rows = (await db
    .select({ id: tenants.id, slug: tenants.slug, config: tenants.config })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)) as Array<{ id: string; slug: string; config: unknown }>;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    config: (row.config ?? {}) as Record<string, unknown>,
  };
}

async function loadProducts(db: ServiceDb, nicheId: string): Promise<ProductRow[]> {
  const rows = (await db
    .select({
      id: products.id,
      externalId: products.externalId,
      name: products.name,
      priceCents: products.priceCents,
      source: products.source,
      raw: products.raw,
    })
    .from(products)
    .where(eq(products.nicheId, nicheId))) as ProductRow[];
  return rows;
}

function inferLanguage(topic: string): "nl" | "en" {
  // Same cheap heuristic as scoring.ts — NL is the default.
  return /\b(for|with|best|the|of|and)\b/i.test(topic) ? "en" : "nl";
}
