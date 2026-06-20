import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetAllowedCache } from "../auth.js";

// ---------------------------------------------------------------------------
// Mock next/navigation — redirect() throws in Next.js; mirror that here
// ---------------------------------------------------------------------------
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error(`REDIRECT:${url}`), { url });
  }),
}));

// ---------------------------------------------------------------------------
// Mock Supabase server client
// ---------------------------------------------------------------------------
const mockGetUser = vi.fn();
const mockSignOut = vi.fn().mockResolvedValue({});

vi.mock("../supabase.js", () => ({
  getServerSupabase: () =>
    Promise.resolve({
      auth: { getUser: mockGetUser, signOut: mockSignOut },
    }),
}));

// ---------------------------------------------------------------------------

import { requireAdmin } from "../auth.js";

function userSession(email: string, id = "uid-1") {
  return { data: { user: { id, email } }, error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetAllowedCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetAllowedCache();
});

// ---------------------------------------------------------------------------
// ADMIN_ALLOWED_EMAILS parsing (exercised via requireAdmin)
// ---------------------------------------------------------------------------

describe("getAllowedEmails (via requireAdmin)", () => {
  it("parses a comma-separated list of emails case-insensitively", async () => {
    vi.stubEnv("ADMIN_ALLOWED_EMAILS", "ADMIN@Example.com, op@nichefinder.nl");
    mockGetUser.mockResolvedValue(userSession("admin@example.com"));

    const user = await requireAdmin();
    expect(user.email).toBe("admin@example.com");
  });

  it("filters out entries without an @ sign", async () => {
    vi.stubEnv("ADMIN_ALLOWED_EMAILS", "notanemail, admin@example.com");
    mockGetUser.mockResolvedValue(userSession("admin@example.com"));

    const user = await requireAdmin();
    expect(user.email).toBe("admin@example.com");
  });

  it("trims whitespace around each entry", async () => {
    vi.stubEnv("ADMIN_ALLOWED_EMAILS", "  admin@example.com  ");
    mockGetUser.mockResolvedValue(userSession("admin@example.com"));

    const user = await requireAdmin();
    expect(user).toBeTruthy();
  });

  it("caches the parsed set — env change after first call has no effect", async () => {
    vi.stubEnv("ADMIN_ALLOWED_EMAILS", "admin@example.com");
    mockGetUser.mockResolvedValue(userSession("admin@example.com"));
    await requireAdmin(); // warms the cache

    // Change env; cache should still hold the old set
    vi.stubEnv("ADMIN_ALLOWED_EMAILS", "other@example.com");
    mockGetUser.mockResolvedValue(userSession("admin@example.com"));
    const user = await requireAdmin();
    expect(user.email).toBe("admin@example.com");
  });

  it("_resetAllowedCache clears the cache so env is re-read", async () => {
    vi.stubEnv("ADMIN_ALLOWED_EMAILS", "admin@example.com");
    mockGetUser.mockResolvedValue(userSession("admin@example.com"));
    await requireAdmin(); // warms cache

    _resetAllowedCache();

    // Now change env — should be picked up after cache reset
    vi.stubEnv("ADMIN_ALLOWED_EMAILS", "other@example.com");
    mockGetUser.mockResolvedValue(userSession("admin@example.com"));

    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/admin/login?error=not_allowed");
  });
});

// ---------------------------------------------------------------------------
// requireAdmin — auth gate paths
// ---------------------------------------------------------------------------

describe("requireAdmin", () => {
  it("redirects to /admin/login when Supabase returns an error", async () => {
    vi.stubEnv("ADMIN_ALLOWED_EMAILS", "a@b.nl");
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "not authenticated" },
    });

    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/admin/login");
  });

  it("redirects to /admin/login when there is no user in the session", async () => {
    vi.stubEnv("ADMIN_ALLOWED_EMAILS", "a@b.nl");
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/admin/login");
  });

  it("redirects to /admin/login when user has no email on the JWT", async () => {
    vi.stubEnv("ADMIN_ALLOWED_EMAILS", "a@b.nl");
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1", email: null } }, error: null });

    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/admin/login");
  });

  it("throws when ADMIN_ALLOWED_EMAILS is empty (open admin guard)", async () => {
    vi.stubEnv("ADMIN_ALLOWED_EMAILS", "");
    mockGetUser.mockResolvedValue(userSession("admin@example.com"));

    await expect(requireAdmin()).rejects.toThrow(/ADMIN_ALLOWED_EMAILS/);
  });

  it("signs out and redirects when email is not in the allowed list", async () => {
    vi.stubEnv("ADMIN_ALLOWED_EMAILS", "trusted@example.com");
    mockGetUser.mockResolvedValue(userSession("intruder@example.com"));

    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/admin/login?error=not_allowed");
    expect(mockSignOut).toHaveBeenCalledOnce();
  });

  it("returns AdminUser when email matches (case-insensitive)", async () => {
    vi.stubEnv("ADMIN_ALLOWED_EMAILS", "Admin@Example.COM");
    mockGetUser.mockResolvedValue(userSession("ADMIN@EXAMPLE.COM", "uid-42"));

    const user = await requireAdmin();
    expect(user).toEqual({ id: "uid-42", email: "admin@example.com" });
  });
});
