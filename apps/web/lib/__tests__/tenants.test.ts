import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _clearMemoryKv } from "../kv.js";

// ---------------------------------------------------------------------------
// Mock Supabase — hoisted above imports by Vitest.
// ---------------------------------------------------------------------------

vi.mock("../supabase.js", () => ({
  getServiceRoleSupabase: () => mockSupabase,
}));

const mockSelect = vi.fn();
const mockSupabase = {
  from: () => ({ select: mockSelect }),
};

// Chain: .select(...).eq(...).eq(...).maybeSingle()
function chainResult(value: unknown) {
  const chain = {
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: value, error: null }),
  };
  return chain;
}

function chainError(msg: string) {
  const chain = {
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: null, error: { message: msg } }),
  };
  return chain;
}

// ---------------------------------------------------------------------------

import { getSubfolderTenantForPath, getTenantByHostname } from "../tenants.js";

const TENANT = {
  id: "t-001",
  slug: "main",
  kind: "main_authority",
  hostname: "expertgids.nl",
  path_prefix: null,
  is_active: true,
  is_promoted: false,
  config: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  _clearMemoryKv();
});

afterEach(() => {
  _clearMemoryKv();
});

describe("getTenantByHostname", () => {
  it("returns null for an empty hostname", async () => {
    expect(await getTenantByHostname("")).toBeNull();
  });

  it("queries Supabase and returns the tenant on a cache miss", async () => {
    mockSelect.mockReturnValue(chainResult(TENANT));
    const result = await getTenantByHostname("expertgids.nl");
    expect(result).toMatchObject({ id: "t-001", slug: "main" });
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("serves the second call from KV cache (Supabase called only once)", async () => {
    mockSelect.mockReturnValue(chainResult(TENANT));
    await getTenantByHostname("expertgids.nl");
    const second = await getTenantByHostname("expertgids.nl");
    expect(second).toMatchObject({ slug: "main" });
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("normalises hostname to lowercase", async () => {
    mockSelect.mockReturnValue(chainResult(TENANT));
    await getTenantByHostname("EXPERTGIDS.NL");
    await getTenantByHostname("expertgids.nl");
    // Both resolve via the same cache key — only one DB call.
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("strips port from host header before lookup", async () => {
    mockSelect.mockReturnValue(chainResult(TENANT));
    const result = await getTenantByHostname("expertgids.nl:3000");
    expect(result).toMatchObject({ id: "t-001" });
  });

  it("returns null and caches miss when Supabase returns no row", async () => {
    mockSelect.mockReturnValue(chainResult(null));
    const result = await getTenantByHostname("unknown.nl");
    expect(result).toBeNull();
    // Second call should hit cache, not Supabase.
    await getTenantByHostname("unknown.nl");
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("returns null on a Supabase error", async () => {
    mockSelect.mockReturnValue(chainError("connection refused"));
    const result = await getTenantByHostname("error.nl");
    expect(result).toBeNull();
  });
});

describe("getSubfolderTenantForPath", () => {
  const SUBFOLDER_TENANT = {
    ...TENANT,
    id: "t-002",
    kind: "subfolder_niche",
    hostname: null,
    path_prefix: "/koffie",
  };

  it("returns null for a root path", async () => {
    expect(await getSubfolderTenantForPath("/")).toBeNull();
  });

  it("matches the first path segment as prefix", async () => {
    mockSelect.mockReturnValue(chainResult(SUBFOLDER_TENANT));
    const result = await getSubfolderTenantForPath("/koffie/beste-espressomachines");
    expect(result).toMatchObject({ path_prefix: "/koffie" });
  });

  it("caches the result for the same prefix", async () => {
    mockSelect.mockReturnValue(chainResult(SUBFOLDER_TENANT));
    await getSubfolderTenantForPath("/koffie/page-a");
    await getSubfolderTenantForPath("/koffie/page-b");
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("returns null when no matching subfolder exists", async () => {
    mockSelect.mockReturnValue(chainResult(null));
    expect(await getSubfolderTenantForPath("/onbekend/pad")).toBeNull();
  });
});
