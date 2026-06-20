import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock Supabase — hoisted above imports by Vitest.
// ---------------------------------------------------------------------------

vi.mock("../supabase.js", () => ({
  getServiceRoleSupabase: () => mockSupabase,
}));

// Each `from()` call returns a fresh chain that resolves to `{ data, error }`.
// The select().in() chain is non-mutating so a single chain object suffices.
function buildChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    in: () => Promise.resolve(result),
  };
  return chain;
}

const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };

// ---------------------------------------------------------------------------

import { loadClaimsByPage, loadPageClaims } from "../claims.js";

const CLAIM_ROWS = [
  { id: "c-1", page_id: "p-1", claim_text: "Dit product heeft 5 sterren", claim_type: "rating" },
  { id: "c-2", page_id: "p-1", claim_text: "Levertijd is 2 dagen", claim_type: "logistics" },
  { id: "c-3", page_id: "p-2", claim_text: "Getest door redactie", claim_type: "editorial" },
];

const SOURCE_ROWS = [
  { claim_id: "c-1", source_url: "https://bol.com/product/123", first_party_test_id: null },
  { claim_id: "c-1", source_url: "https://tweakers.net/review/x", first_party_test_id: null },
  { claim_id: "c-3", source_url: null, first_party_test_id: "fpt-007" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadClaimsByPage", () => {
  it("returns an empty map when pageIds is empty", async () => {
    const result = await loadClaimsByPage([]);
    expect(result.size).toBe(0);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns an empty map when the claims table has no matching rows", async () => {
    mockFrom.mockReturnValue(buildChain({ data: null, error: null }));
    const result = await loadClaimsByPage(["p-999"]);
    expect(result.size).toBe(0);
  });

  it("groups claims by page_id", async () => {
    mockFrom
      .mockReturnValueOnce(buildChain({ data: CLAIM_ROWS, error: null }))
      .mockReturnValueOnce(buildChain({ data: SOURCE_ROWS, error: null }));

    const result = await loadClaimsByPage(["p-1", "p-2"]);
    expect(result.size).toBe(2);
    expect(result.get("p-1")).toHaveLength(2);
    expect(result.get("p-2")).toHaveLength(1);
  });

  it("maps camelCase fields correctly from snake_case DB columns", async () => {
    mockFrom
      .mockReturnValueOnce(buildChain({ data: [CLAIM_ROWS[0]], error: null }))
      .mockReturnValueOnce(buildChain({ data: [SOURCE_ROWS[0]], error: null }));

    const result = await loadClaimsByPage(["p-1"]);
    const claims = result.get("p-1") ?? [];
    expect(claims[0]?.claimText).toBe("Dit product heeft 5 sterren");
    expect(claims[0]?.claimType).toBe("rating");
  });

  it("attaches multiple sources to the same claim", async () => {
    mockFrom
      .mockReturnValueOnce(buildChain({ data: [CLAIM_ROWS[0]], error: null }))
      .mockReturnValueOnce(buildChain({ data: [SOURCE_ROWS[0], SOURCE_ROWS[1]], error: null }));

    const result = await loadClaimsByPage(["p-1"]);
    const claim = (result.get("p-1") ?? [])[0];
    expect(claim?.sources).toHaveLength(2);
    expect(claim?.sources[0]?.sourceUrl).toBe("https://bol.com/product/123");
  });

  it("supports first_party_test_id sources (null source_url)", async () => {
    mockFrom
      .mockReturnValueOnce(buildChain({ data: [CLAIM_ROWS[2]], error: null }))
      .mockReturnValueOnce(buildChain({ data: [SOURCE_ROWS[2]], error: null }));

    const result = await loadClaimsByPage(["p-2"]);
    const claim = (result.get("p-2") ?? [])[0];
    expect(claim?.sources[0]?.firstPartyTestId).toBe("fpt-007");
    expect(claim?.sources[0]?.sourceUrl).toBeNull();
  });

  it("returns an empty sources array for claims with no source rows", async () => {
    mockFrom
      .mockReturnValueOnce(buildChain({ data: [CLAIM_ROWS[1]], error: null }))
      .mockReturnValueOnce(buildChain({ data: [], error: null }));

    const result = await loadClaimsByPage(["p-1"]);
    const claim = (result.get("p-1") ?? [])[0];
    expect(claim?.sources).toEqual([]);
  });
});

describe("loadPageClaims", () => {
  it("returns an empty array for a page with no claims", async () => {
    mockFrom.mockReturnValue(buildChain({ data: null, error: null }));
    const claims = await loadPageClaims("p-missing");
    expect(claims).toEqual([]);
  });

  it("returns the claim list for a matching page", async () => {
    mockFrom
      .mockReturnValueOnce(buildChain({ data: [CLAIM_ROWS[0]], error: null }))
      .mockReturnValueOnce(buildChain({ data: [], error: null }));

    const claims = await loadPageClaims("p-1");
    expect(claims).toHaveLength(1);
    expect(claims[0]?.id).toBe("c-1");
  });
});
