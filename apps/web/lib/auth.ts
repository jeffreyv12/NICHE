// Admin auth helpers. The admin app is gated by:
//   1. Supabase magic-link auth → JWT with email
//   2. Email must appear in ADMIN_ALLOWED_EMAILS env (parsed at boot)
//
// The allowed_admins table mirrors that env for RLS-driven SELECT policies; we
// check the env here for the app-layer gate (defense in depth).

import { redirect } from "next/navigation";
import { getServerSupabase } from "./supabase";

let allowedCache: Set<string> | undefined;

function getAllowedEmails(): Set<string> {
  if (allowedCache) return allowedCache;
  const raw = process.env.ADMIN_ALLOWED_EMAILS ?? "";
  const list = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s.includes("@"));
  allowedCache = new Set(list);
  return allowedCache;
}

export interface AdminUser {
  id: string;
  email: string;
}

/**
 * Returns the authenticated admin user, or redirects to /admin/login.
 * Call from admin Server Components / route handlers.
 */
export async function requireAdmin(): Promise<AdminUser> {
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user || !data.user.email) {
    redirect("/admin/login");
  }

  const email = data.user.email.toLowerCase();
  const allowed = getAllowedEmails();

  if (allowed.size === 0) {
    throw new Error(
      "ADMIN_ALLOWED_EMAILS is empty. Admin would be wide-open; refusing to authenticate.",
    );
  }

  if (!allowed.has(email)) {
    // Log out + redirect. Treat unknown emails as hostile.
    await supabase.auth.signOut();
    redirect("/admin/login?error=not_allowed");
  }

  return { id: data.user.id, email };
}

/** Test/debug only. */
export function _resetAllowedCache(): void {
  allowedCache = undefined;
}
