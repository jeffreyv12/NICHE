import { contentAgent } from "@nichefinder/agent-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TestPagePlanItem } from "../planTestPages.js";
import { runTestPageDraftJob } from "../test-page-draft.js";

// Mock the Content Agent so we exercise orchestration, not the LLM.
vi.mock("@nichefinder/agent-sdk", async () => {
  const actual =
    await vi.importActual<typeof import("@nichefinder/agent-sdk")>("@nichefinder/agent-sdk");
  return {
    ...actual,
    contentAgent: {
      ...actual.contentAgent,
      runContentDraft: vi.fn(),
    },
  };
});

const mockedDraft = vi.mocked(contentAgent.runContentDraft);

interface RecordedInsert {
  table: string;
  values: unknown;
}

function makeFakeDb(opts: {
  niche: { id: string; tenantId: string | null; topic: string; topicSlug: string };
  tenant: { id: string; slug: string; config: unknown } | null;
  products: Array<{
    id: string;
    externalId: string | null;
    name: string;
    priceCents: number | null;
    source: string | null;
    raw: unknown;
  }>;
}) {
  const inserts: RecordedInsert[] = [];

  // Order of select calls inside the job: niche, tenant, products.
  const selectQueue: unknown[][] = [
    opts.niche ? [opts.niche] : [],
    opts.tenant ? [opts.tenant] : [],
    opts.products,
  ];

  function makeChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    chain.from = passthrough;
    chain.where = passthrough;
    chain.limit = () => Promise.resolve(rows);
    // Drizzle's query builder is itself PromiseLike — `await db.select()...where(...)`
    // works without a terminal method. The fake mirrors that so loadProducts (which
    // doesn't call .limit()) can await the chain directly.
    // biome-ignore lint/suspicious/noThenProperty: intentional drizzle PromiseLike shim
    chain.then = (resolve: (rows: unknown[]) => unknown) => resolve(rows);
    return chain;
  }

  return {
    inserts,
    db: {
      select: () => makeChain(selectQueue.shift() ?? []),
      insert: (table: { _: { name: string } } | Record<string, unknown>) => ({
        values: (values: unknown) => {
          // Drizzle tables expose Symbol-keyed metadata; the table object identity
          // is what matters in real code. For the fake we just stash whatever
          // came in along with a label inferred from the values keys.
          inserts.push({ table: inferTableLabel(table, values), values });
          return Promise.resolve();
        },
      }),
    } as unknown as Parameters<typeof runTestPageDraftJob>[0]["db"],
  };
}

function inferTableLabel(_table: unknown, values: unknown): string {
  const v = Array.isArray(values) ? values[0] : values;
  if (v && typeof v === "object") {
    if ("shortCode" in v) return "affiliate_links";
    if ("kind" in v && "fullPath" in v) return "pages";
    if ("sourceKind" in v) return "claim_sources";
    if ("claimText" in v) return "claims";
  }
  return "unknown";
}

const TENANT = {
  id: "tenant-1",
  slug: "main",
  config: {
    brand: { author: "Jeffrey", voice: "concise, sourced, NL-NL" },
    site: { canonicalHost: "https://main.example" },
  },
};

const NICHE = {
  id: "niche-1",
  tenantId: TENANT.id,
  topic: "koffiemolens",
  topicSlug: "koffiemolens",
};

const PRODUCTS = [
  {
    id: "prod-1",
    externalId: "BOL-9999",
    name: "Test Grinder",
    priceCents: 12999,
    source: "bol",
    raw: { url: "https://bol.com/p/9999" },
  },
];

const PLAN: TestPagePlanItem[] = [
  {
    pageSlug: "vergelijking",
    kind: "comparison",
    primaryKeyword: "beste koffiemolen",
    secondaryKeywords: ["koffiemolen test"],
    cohort: "compare",
  },
  {
    pageSlug: "koopgids",
    kind: "buying_guide",
    primaryKeyword: "koffiemolen kopen",
    secondaryKeywords: [],
    cohort: "guide",
  },
  {
    pageSlug: "handmatig-vs-elektrisch",
    kind: "informational",
    primaryKeyword: "handmatige koffiemolen",
    secondaryKeywords: [],
    cohort: "info",
  },
];

function mockGoodDraft() {
  mockedDraft.mockImplementation(async (_runtime, input) => ({
    output: {
      page: {
        title: `${input.page.kind} — ${input.niche.topic}`,
        meta_description: "Deze pagina bevat affiliate links. Geschreven met hulp van AI.",
        h1: input.niche.topic,
        body_md:
          "Deze pagina bevat affiliate links.\n\nDit artikel is geschreven met hulp van AI en geredigeerd door Jeffrey.",
        schema_jsonld: [],
        ai_disclosure_jsonld: { "@type": "CreativeWork" },
      },
      claims: [],
      operator_todos: [],
      needs_polish_pass: false,
    },
    disclosuresAmended: false,
    agentRunId: `run-${input.page.kind}`,
    costEur: 0.012,
  }));
}

describe("runTestPageDraftJob", () => {
  beforeEach(() => {
    mockedDraft.mockReset();
  });

  it("drafts one page per plan item, inserts pages + affiliate_links, sums cost", async () => {
    mockGoodDraft();
    const { db, inserts } = makeFakeDb({ niche: NICHE, tenant: TENANT, products: PRODUCTS });

    const runtime = {} as Parameters<typeof runTestPageDraftJob>[0]["runtime"];
    const result = await runTestPageDraftJob({
      db,
      runtime,
      nicheId: NICHE.id,
      planner: () => PLAN,
    });

    expect(result.drafted).toHaveLength(3);
    expect(result.failures).toEqual([]);
    expect(result.totalCostEur).toBeCloseTo(0.036, 5);

    // One affiliate_links insert + one pages insert per plan item = 6 total.
    const linkInserts = inserts.filter((i) => i.table === "affiliate_links");
    const pageInserts = inserts.filter((i) => i.table === "pages");
    expect(linkInserts).toHaveLength(3);
    expect(pageInserts).toHaveLength(3);

    // SubID convention: [tenant_slug]:[page_slug]:[cohort]
    const firstLink = (linkInserts[0]?.values as Array<{ subid: string }>)[0];
    expect(firstLink?.subid).toMatch(/^main:(vergelijking|koopgids|handmatig-vs-elektrisch):/);

    // Page rows are state=draft + kind=test_page + ai_assisted=true.
    for (const insert of pageInserts) {
      const v = insert.values as { state: string; kind: string; aiAssisted: boolean };
      expect(v.state).toBe("draft");
      expect(v.kind).toBe("test_page");
      expect(v.aiAssisted).toBe(true);
    }
  });

  it("persists the agent's claims + sources for the Claim Verifier gate", async () => {
    mockedDraft.mockImplementation(async (_runtime, input) => ({
      output: {
        page: {
          title: `${input.page.kind}`,
          meta_description: "Deze pagina bevat affiliate links. Met hulp van AI.",
          h1: input.niche.topic,
          body_md:
            "Deze pagina bevat affiliate links.\n\nGeschreven met hulp van AI en geredigeerd door Jeffrey.",
          schema_jsonld: [],
          ai_disclosure_jsonld: { "@type": "CreativeWork" },
        },
        claims: [
          {
            claim_text: "Maalt 30g in 20 seconden.",
            claim_type: "spec" as const,
            suggested_sources: [
              { source_url: "https://brand.nl/spec", excerpt: "30g / 20s volgens fabrikant" },
            ],
          },
          {
            claim_text: "Beste prijs-kwaliteit.",
            claim_type: "fact" as const,
            suggested_sources: [],
          },
        ],
        operator_todos: [],
        needs_polish_pass: false,
      },
      disclosuresAmended: false,
      agentRunId: `run-${input.page.kind}`,
      costEur: 0.01,
    }));
    const { db, inserts } = makeFakeDb({ niche: NICHE, tenant: TENANT, products: PRODUCTS });

    const result = await runTestPageDraftJob({
      db,
      runtime: {} as Parameters<typeof runTestPageDraftJob>[0]["runtime"],
      nicheId: NICHE.id,
      planner: () => PLAN,
    });

    // Two claims per page × 3 pages.
    expect(result.drafted.every((d) => d.claimsPersisted === 2)).toBe(true);
    const claimInserts = inserts.filter((i) => i.table === "claims");
    const sourceInserts = inserts.filter((i) => i.table === "claim_sources");
    expect(claimInserts).toHaveLength(3); // one batch insert per page
    expect(sourceInserts).toHaveLength(3); // only the sourced claim contributes a source

    const firstClaims = claimInserts[0]?.values as Array<{ claimText: string; isSourced: boolean }>;
    expect(firstClaims).toHaveLength(2);
    expect(firstClaims[0]).toMatchObject({ isSourced: true });
    expect(firstClaims[1]).toMatchObject({ isSourced: false });
  });

  it("rejects plans with fewer than 3 or more than 5 items", async () => {
    const { db } = makeFakeDb({ niche: NICHE, tenant: TENANT, products: [] });
    await expect(
      runTestPageDraftJob({
        db,
        runtime: {} as Parameters<typeof runTestPageDraftJob>[0]["runtime"],
        nicheId: NICHE.id,
        planner: () => PLAN.slice(0, 2),
      }),
    ).rejects.toThrow(/3.{0,2}5/);
  });

  it("rejects duplicate page slugs", async () => {
    const { db } = makeFakeDb({ niche: NICHE, tenant: TENANT, products: [] });
    const [first, second] = PLAN;
    if (!first || !second) throw new Error("PLAN fixture changed");
    const dupPlan = [first, first, second];
    await expect(
      runTestPageDraftJob({
        db,
        runtime: {} as Parameters<typeof runTestPageDraftJob>[0]["runtime"],
        nicheId: NICHE.id,
        planner: () => dupPlan,
      }),
    ).rejects.toThrow(/duplicate pageSlug/);
  });

  it("captures per-item failures without aborting the batch", async () => {
    mockedDraft
      .mockImplementationOnce(() => Promise.reject(new Error("agent boom")))
      .mockImplementation(async (_runtime, input) => ({
        output: {
          page: {
            title: "ok",
            meta_description: "Deze pagina bevat affiliate links. met hulp van AI",
            h1: "ok",
            body_md:
              "Deze pagina bevat affiliate links.\n\nDit artikel is geschreven met hulp van AI.",
            schema_jsonld: [],
            ai_disclosure_jsonld: {},
          },
          claims: [],
          operator_todos: [],
          needs_polish_pass: false,
        },
        disclosuresAmended: false,
        agentRunId: `run-${input.page.kind}`,
        costEur: 0.01,
      }));

    const { db } = makeFakeDb({ niche: NICHE, tenant: TENANT, products: [] });
    const result = await runTestPageDraftJob({
      db,
      runtime: {} as Parameters<typeof runTestPageDraftJob>[0]["runtime"],
      nicheId: NICHE.id,
      planner: () => PLAN,
    });

    expect(result.drafted).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.error).toMatch(/agent boom/);
  });
});
