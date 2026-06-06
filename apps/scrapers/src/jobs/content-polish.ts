// Phase 4.1 — Content Agent polish pass (Opus 4.7).
//
// Re-edits commercial/hero pages with the Opus polish pass and writes the
// result back to the page, keeping it pre-approval (the operator still approves
// — CLAUDE.md gate #1). Mirrors test-page-draft.ts's DI/mocked-agent shape so
// it is unit-testable without a live DB or LLM.
//
// Decisions (see docs/PHASE_4.1_POLISH_PLAN.md):
//   D1 primary_keyword is synthesised from niche.topic (the body is the real
//      content; the keyword is only framing context for the pass).
//   D2 URL-backed claim sources → existing_claims[].sources; first-party tests
//      → the first_party_tests input (which carries first-hand backing without
//      a URL).
//   D3 operator_todos / polish_notes / needs_polish_pass persist on the page
//      (migration 0004) and surface at review.

import { randomUUID } from "node:crypto";
import { contentAgent } from "@nichefinder/agent-sdk";
import type { RunAgentRuntime } from "@nichefinder/agent-sdk";
import {
  type ServiceDb,
  claimSources,
  claims,
  firstPartyTests,
  niches,
  pages,
  products,
  tenants,
} from "@nichefinder/db";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

type ContentPolishInput = contentAgent.ContentPolishInput;
type ContentOutput = contentAgent.ContentOutput;
type ContentPageKind = contentAgent.ContentPageKind;
type ContentClaimType = contentAgent.ContentClaimType;

// Commercial/hero kinds that get the automatic Opus polish (4.1.2).
const HERO_PAGE_KINDS = ["product_review", "comparison", "buying_guide"] as const;
const CONTENT_CLAIM_TYPE_SET = new Set<string>(contentAgent.CONTENT_CLAIM_TYPES);
const CONTENT_PAGE_KIND_SET = new Set<string>(contentAgent.CONTENT_PAGE_KINDS);

export interface RunContentPolishJobOptions {
  db: ServiceDb;
  runtime: RunAgentRuntime;
  /** Polish only this page (operator on-demand), regardless of polished_at. */
  pageId?: string;
  /** Max pages per run when scanning. Default 10. */
  limit?: number;
}

export interface PolishedPage {
  pageId: string;
  kind: string;
  agentRunId: string;
  costEur: number;
  disclosuresAmended: boolean;
  needsPolishPass: boolean;
  operatorTodoCount: number;
  claimsPersisted: number;
}

export interface RunContentPolishJobResult {
  considered: number;
  polished: PolishedPage[];
  totalCostEur: number;
  failures: Array<{ pageId: string; error: string }>;
}

// -----------------------------------------------------------------------------
// Row shapes
// -----------------------------------------------------------------------------

interface PageRow {
  id: string;
  tenantId: string;
  nicheId: string | null;
  kind: string;
  title: string;
  metaDescription: string | null;
  bodyMd: string;
  authorName: string;
}

interface NicheRow {
  id: string;
  topic: string;
  topicSlug: string;
}

// -----------------------------------------------------------------------------
// Job
// -----------------------------------------------------------------------------

export async function runContentPolishJob(
  opts: RunContentPolishJobOptions,
): Promise<RunContentPolishJobResult> {
  const limit = opts.limit ?? 10;
  const targets = await selectPages(opts.db, opts.pageId, limit);

  const result: RunContentPolishJobResult = {
    considered: targets.length,
    polished: [],
    totalCostEur: 0,
    failures: [],
  };

  for (const page of targets) {
    try {
      const polished = await polishOne(opts.db, opts.runtime, page);
      result.polished.push(polished);
      result.totalCostEur += polished.costEur;
    } catch (err) {
      result.failures.push({
        pageId: page.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

async function polishOne(
  db: ServiceDb,
  runtime: RunAgentRuntime,
  page: PageRow,
): Promise<PolishedPage> {
  if (!page.nicheId) throw new Error(`page ${page.id} has no niche_id`);
  if (!CONTENT_PAGE_KIND_SET.has(page.kind)) {
    throw new Error(`page ${page.id} kind=${page.kind} is not a polishable content kind`);
  }

  const niche = await loadNiche(db, page.nicheId);
  if (!niche) throw new Error(`niche ${page.nicheId} not found`);
  const tenant = await loadTenant(db, page.tenantId);

  const input: ContentPolishInput = {
    niche: {
      topic: niche.topic,
      topic_slug: niche.topicSlug,
      language: inferLanguage(niche.topic),
    },
    page: {
      kind: page.kind as ContentPageKind,
      // D1: keyword is framing context only; synthesise from the niche topic.
      primary_keyword: niche.topic,
      secondary_keywords: [],
      author_display_name: page.authorName || tenant.author || tenant.slug,
    },
    products: await loadProducts(db, niche.id),
    first_party_tests: await loadFirstPartyTests(db, niche.id),
    existing_claims: await loadExistingClaims(db, page.id),
    brand_voice_notes: tenant.brandVoice,
    draft: {
      body_md: page.bodyMd,
      title: page.title,
      meta_description: page.metaDescription ?? page.title,
    },
    // Operator edits land in the page body before a re-polish.
    operator_edited_body_md: page.bodyMd,
    peer_pages: await loadPeerPages(db, page.tenantId, page.id),
  };

  const run = await contentAgent.runContentPolish(runtime, input);
  const out = run.output;

  await db
    .update(pages)
    .set({
      title: out.page.title,
      metaDescription: out.page.meta_description,
      bodyMd: out.page.body_md,
      schemaJsonld: out.page.schema_jsonld,
      aiDisclosureJsonld: out.page.ai_disclosure_jsonld,
      operatorTodos: out.operator_todos,
      polishNotes: out.polish_notes ?? null,
      needsPolishPass: out.needs_polish_pass,
      polishedAt: new Date(),
    })
    .where(eq(pages.id, page.id));

  const claimsPersisted = await replacePageClaims(db, page.id, out.claims);

  return {
    pageId: page.id,
    kind: page.kind,
    agentRunId: run.agentRunId,
    costEur: run.costEur,
    disclosuresAmended: run.disclosuresAmended,
    needsPolishPass: out.needs_polish_pass,
    operatorTodoCount: out.operator_todos.length,
    claimsPersisted,
  };
}

// -----------------------------------------------------------------------------
// Selection
// -----------------------------------------------------------------------------

async function selectPages(
  db: ServiceDb,
  pageId: string | undefined,
  limit: number,
): Promise<PageRow[]> {
  const cols = {
    id: pages.id,
    tenantId: pages.tenantId,
    nicheId: pages.nicheId,
    kind: pages.kind,
    title: pages.title,
    metaDescription: pages.metaDescription,
    bodyMd: pages.bodyMd,
    authorName: pages.authorName,
  };

  if (pageId) {
    return db.select(cols).from(pages).where(eq(pages.id, pageId)).limit(1) as Promise<PageRow[]>;
  }

  // Auto: hero/commercial kinds still pre-approval that haven't been polished
  // yet (or were flagged for another pass).
  return db
    .select(cols)
    .from(pages)
    .where(
      and(
        inArray(pages.kind, [...HERO_PAGE_KINDS]),
        inArray(pages.state, ["draft", "pending_review"]),
        sql`(${pages.polishedAt} is null or ${pages.needsPolishPass} = true)`,
      ),
    )
    .limit(limit) as Promise<PageRow[]>;
}

// -----------------------------------------------------------------------------
// Loaders
// -----------------------------------------------------------------------------

async function loadNiche(db: ServiceDb, nicheId: string): Promise<NicheRow | null> {
  const rows = await db
    .select({ id: niches.id, topic: niches.topic, topicSlug: niches.topicSlug })
    .from(niches)
    .where(eq(niches.id, nicheId))
    .limit(1);
  return rows[0] ?? null;
}

interface TenantInfo {
  slug: string;
  author?: string;
  brandVoice?: string;
}

async function loadTenant(db: ServiceDb, tenantId: string): Promise<TenantInfo> {
  const rows = await db
    .select({ slug: tenants.slug, config: tenants.config })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const row = rows[0];
  if (!row) return { slug: tenantId };
  const config = (row.config ?? {}) as { brand?: { author?: unknown; voice?: unknown } };
  return {
    slug: row.slug,
    author: typeof config.brand?.author === "string" ? config.brand.author : undefined,
    brandVoice: typeof config.brand?.voice === "string" ? config.brand.voice : undefined,
  };
}

async function loadProducts(
  db: ServiceDb,
  nicheId: string,
): Promise<ContentPolishInput["products"]> {
  const rows = await db
    .select({
      externalId: products.externalId,
      name: products.name,
      priceCents: products.priceCents,
      source: products.source,
      raw: products.raw,
    })
    .from(products)
    .where(eq(products.nicheId, nicheId));

  const out: ContentPolishInput["products"] = [];
  for (const r of rows) {
    if (!r.externalId) continue;
    const raw = (r.raw ?? {}) as { url?: unknown; deepLink?: unknown };
    const url = typeof raw.url === "string" ? raw.url : undefined;
    out.push({
      external_id: r.externalId,
      name: r.name,
      ...(typeof r.priceCents === "number" ? { price_eur: r.priceCents / 100 } : {}),
      ...(url ? { url } : {}),
      ...(r.source ? { network: r.source } : {}),
    });
    if (out.length >= 20) break;
  }
  return out;
}

async function loadFirstPartyTests(
  db: ServiceDb,
  nicheId: string,
): Promise<ContentPolishInput["first_party_tests"]> {
  const rows = await db
    .select({
      productName: firstPartyTests.productName,
      testSummaryMd: firstPartyTests.testSummaryMd,
      testFinishedAt: firstPartyTests.testFinishedAt,
    })
    .from(firstPartyTests)
    .where(eq(firstPartyTests.nicheId, nicheId));

  const out: ContentPolishInput["first_party_tests"] = [];
  for (const r of rows) {
    if (!r.testSummaryMd) continue;
    out.push({
      // D2: the table keys tests by product name, not an external id; the agent
      // uses this as a label for first-hand backing.
      product_external_id: r.productName,
      summary: r.testSummaryMd.slice(0, 2000),
      ...(r.testFinishedAt ? { tested_at: r.testFinishedAt } : {}),
    });
    if (out.length >= 20) break;
  }
  return out;
}

async function loadExistingClaims(
  db: ServiceDb,
  pageId: string,
): Promise<ContentPolishInput["existing_claims"]> {
  const claimRows = await db
    .select({ id: claims.id, claimText: claims.claimText, claimType: claims.claimType })
    .from(claims)
    .where(eq(claims.pageId, pageId));
  if (claimRows.length === 0) return [];

  const sourceRows = await db
    .select({
      claimId: claimSources.claimId,
      sourceUrl: claimSources.sourceUrl,
      excerpt: claimSources.excerpt,
    })
    .from(claimSources)
    .where(
      inArray(
        claimSources.claimId,
        claimRows.map((c) => c.id),
      ),
    );

  const urlSourcesByClaim = new Map<string, Array<{ source_url: string; excerpt: string }>>();
  for (const s of sourceRows) {
    // D2: only URL-backed sources fit the input; first-party-test sources are
    // surfaced via first_party_tests instead.
    if (!s.sourceUrl || !/^https?:\/\/\S+/i.test(s.sourceUrl)) continue;
    if (!s.excerpt) continue;
    const arr = urlSourcesByClaim.get(s.claimId) ?? [];
    arr.push({ source_url: s.sourceUrl, excerpt: s.excerpt.slice(0, 1000) });
    urlSourcesByClaim.set(s.claimId, arr);
  }

  return claimRows.slice(0, 50).map((c) => ({
    claim_text: c.claimText.slice(0, 500),
    claim_type: coerceClaimType(c.claimType),
    sources: urlSourcesByClaim.get(c.id) ?? [],
  }));
}

async function loadPeerPages(
  db: ServiceDb,
  tenantId: string,
  excludePageId: string,
): Promise<ContentPolishInput["peer_pages"]> {
  const rows = await db
    .select({ fullPath: pages.fullPath, title: pages.title, kind: pages.kind })
    .from(pages)
    .where(
      and(eq(pages.tenantId, tenantId), eq(pages.state, "published"), ne(pages.id, excludePageId)),
    );

  const out: ContentPolishInput["peer_pages"] = [];
  for (const r of rows) {
    if (!CONTENT_PAGE_KIND_SET.has(r.kind)) continue;
    out.push({ url: r.fullPath, title: r.title, kind: r.kind as ContentPageKind });
    if (out.length >= 50) break;
  }
  return out;
}

// -----------------------------------------------------------------------------
// Writes
// -----------------------------------------------------------------------------

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

/** Replace the page's claims with the polished set (delete cascades sources). */
async function replacePageClaims(
  db: ServiceDb,
  pageId: string,
  claimOutputs: ContentOutput["claims"],
): Promise<number> {
  await db.delete(claims).where(eq(claims.pageId, pageId));
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

function coerceClaimType(t: string): ContentClaimType {
  return (CONTENT_CLAIM_TYPE_SET.has(t) ? t : "fact") as ContentClaimType;
}

function inferLanguage(topic: string): "nl" | "en" {
  return /\b(for|with|best|the|of|and)\b/i.test(topic) ? "en" : "nl";
}
