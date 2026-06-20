import { contentAgent } from "@nichefinder/agent-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runContentPolishJob } from "../content-polish.js";

// Mock only the Opus pass; keep the real CONTENT_* constants the job reads.
vi.mock("@nichefinder/agent-sdk", async () => {
  const actual =
    await vi.importActual<typeof import("@nichefinder/agent-sdk")>("@nichefinder/agent-sdk");
  return {
    ...actual,
    contentAgent: { ...actual.contentAgent, runContentPolish: vi.fn() },
  };
});

const mockedPolish = vi.mocked(contentAgent.runContentPolish);

interface RecordedInsert {
  label: string;
  values: unknown;
}

function inferLabel(values: unknown): string {
  const v = Array.isArray(values) ? values[0] : values;
  if (v && typeof v === "object") {
    if ("sourceKind" in v) return "claim_sources";
    if ("claimText" in v) return "claims";
  }
  return "unknown";
}

function makeFakeDb(selectResults: unknown[][]) {
  let i = 0;
  const inserts: RecordedInsert[] = [];
  const updates: Record<string, unknown>[] = [];
  let deletes = 0;

  function makeSelectChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.limit = () => Promise.resolve(rows);
    // biome-ignore lint/suspicious/noThenProperty: drizzle PromiseLike shim
    chain.then = (resolve: (rows: unknown[]) => unknown) => resolve(rows);
    return chain;
  }

  const db = {
    select: () => makeSelectChain(selectResults[i++] ?? []),
    insert: () => ({
      values: (values: unknown) => {
        inserts.push({ label: inferLabel(values), values });
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          updates.push(set);
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({
      where: () => {
        deletes += 1;
        return Promise.resolve();
      },
    }),
  };

  return {
    inserts,
    updates,
    getDeletes: () => deletes,
    db: db as unknown as Parameters<typeof runContentPolishJob>[0]["db"],
  };
}

const PAGE = {
  id: "page-1",
  tenantId: "tenant-1",
  nicheId: "niche-1",
  kind: "comparison",
  title: "Oude titel",
  metaDescription: "oude meta",
  bodyMd: "oude body met affiliate links en AI-melding",
  authorName: "Jeffrey",
};
const NICHE = { id: "niche-1", topic: "koffiemolens", topicSlug: "koffiemolens" };
const TENANT = { slug: "main", config: { brand: { author: "Jeffrey", voice: "concise NL" } } };

// Select order in polishOne: targets, niche, tenant, products, firstPartyTests,
// claims, claimSources, peerPages.
function selectQueue(over: Partial<Record<string, unknown[]>> = {}) {
  return [
    over.targets ?? [PAGE],
    over.niche ?? [NICHE],
    over.tenant ?? [TENANT],
    over.products ?? [],
    over.firstPartyTests ?? [],
    over.claims ?? [{ id: "c1", claimText: "Maalt snel.", claimType: "spec" }],
    over.claimSources ?? [
      { claimId: "c1", sourceUrl: "https://brand.nl/x", excerpt: "snel volgens merk" },
    ],
    over.peerPages ?? [],
  ];
}

function mockPolish(over: Partial<contentAgent.ContentOutput> = {}) {
  mockedPolish.mockImplementation(async (_runtime, _input) => ({
    output: {
      page: {
        title: "Nieuwe titel",
        meta_description: "nieuwe meta",
        h1: "H1",
        body_md: "gepolijste body met affiliate links en met hulp van AI",
        schema_jsonld: [],
        ai_disclosure_jsonld: { "@type": "CreativeWork" },
      },
      claims: [
        {
          claim_text: "Maalt 30g in 20s.",
          claim_type: "spec" as const,
          suggested_sources: [{ source_url: "https://brand.nl/spec", excerpt: "30g/20s" }],
        },
      ],
      operator_todos: [],
      needs_polish_pass: false,
      polish_notes: "tightened intro",
      ...over,
    },
    disclosuresAmended: false,
    agentRunId: "polish-run-1",
    costEur: 0.08,
  }));
}

beforeEach(() => {
  mockedPolish.mockReset();
});

describe("runContentPolishJob", () => {
  it("polishes a page, writes back body + polish fields, replaces claims", async () => {
    mockPolish();
    const { db, inserts, updates, getDeletes } = makeFakeDb(selectQueue());

    const result = await runContentPolishJob({
      db,
      runtime: {} as Parameters<typeof runContentPolishJob>[0]["runtime"],
      pageId: "page-1",
    });

    expect(result.considered).toBe(1);
    expect(result.polished).toHaveLength(1);
    expect(result.failures).toEqual([]);
    expect(result.totalCostEur).toBeCloseTo(0.08, 5);
    expect(result.polished[0]).toMatchObject({
      pageId: "page-1",
      kind: "comparison",
      claimsPersisted: 1,
      needsPolishPass: false,
      operatorTodoCount: 0,
    });

    // Page updated with polished content + polish bookkeeping.
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      title: "Nieuwe titel",
      bodyMd: "gepolijste body met affiliate links en met hulp van AI",
      needsPolishPass: false,
      polishNotes: "tightened intro",
    });
    expect(updates[0]?.polishedAt).toBeInstanceOf(Date);

    // Claims replaced: one delete, then a fresh claims insert.
    expect(getDeletes()).toBe(1);
    expect(inserts.filter((x) => x.label === "claims")).toHaveLength(1);
    expect(inserts.filter((x) => x.label === "claim_sources")).toHaveLength(1);
  });

  it("feeds the polish input the synthesised keyword + URL claim sources (D1/D2)", async () => {
    mockPolish();
    const { db } = makeFakeDb(selectQueue());
    await runContentPolishJob({
      db,
      runtime: {} as Parameters<typeof runContentPolishJob>[0]["runtime"],
      pageId: "page-1",
    });

    const input = mockedPolish.mock.calls[0]?.[1] as contentAgent.ContentPolishInput;
    expect(input.page.primary_keyword).toBe("koffiemolens"); // D1: from niche.topic
    expect(input.draft.body_md).toBe(PAGE.bodyMd);
    expect(input.existing_claims).toEqual([
      {
        claim_text: "Maalt snel.",
        claim_type: "spec",
        sources: [{ source_url: "https://brand.nl/x", excerpt: "snel volgens merk" }],
      },
    ]);
  });

  it("drops a first-party-test (non-URL) source from existing_claims (D2)", async () => {
    mockPolish();
    const { db } = makeFakeDb(
      selectQueue({
        claims: [{ id: "c1", claimText: "Getest.", claimType: "test_result" }],
        claimSources: [{ claimId: "c1", sourceUrl: null, excerpt: "eigen test" }],
      }),
    );
    await runContentPolishJob({
      db,
      runtime: {} as Parameters<typeof runContentPolishJob>[0]["runtime"],
      pageId: "page-1",
    });
    const input = mockedPolish.mock.calls[0]?.[1] as contentAgent.ContentPolishInput;
    expect(input.existing_claims[0]?.sources).toEqual([]);
  });

  it("forwards peer pages to the agent for internal-link suggestions (4.1.3)", async () => {
    mockPolish();
    const { db } = makeFakeDb(
      selectQueue({
        peerPages: [
          {
            fullPath: "/koffiemolens/beste-burr-molens",
            title: "Beste burr molens 2026",
            kind: "comparison",
          },
          {
            fullPath: "/koffiemolens/handmatige-molens",
            title: "Handmatige molens vergelijken",
            kind: "buying_guide",
          },
        ],
      }),
    );
    await runContentPolishJob({
      db,
      runtime: {} as Parameters<typeof runContentPolishJob>[0]["runtime"],
      pageId: "page-1",
    });

    const input = mockedPolish.mock.calls[0]?.[1] as contentAgent.ContentPolishInput;
    expect(input.peer_pages).toHaveLength(2);
    expect(input.peer_pages[0]).toMatchObject({
      url: "/koffiemolens/beste-burr-molens",
      title: "Beste burr molens 2026",
      kind: "comparison",
    });
  });

  it("isolates a per-page failure (missing niche) without throwing", async () => {
    mockPolish();
    const { db } = makeFakeDb(selectQueue({ niche: [] }));
    const result = await runContentPolishJob({
      db,
      runtime: {} as Parameters<typeof runContentPolishJob>[0]["runtime"],
      pageId: "page-1",
    });
    expect(result.polished).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ pageId: "page-1" });
    expect(mockedPolish).not.toHaveBeenCalled();
  });
});
