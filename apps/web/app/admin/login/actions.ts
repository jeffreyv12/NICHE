"use server";

// Server actions for the magic-link form.
// We don't pre-check the email against ADMIN_ALLOWED_EMAILS here because that
// would leak which emails are admins via timing. Instead, sendMagicLink
// always returns the same UX, and the post-auth /admin layout enforces the
// allowlist via requireAdmin().

import { redirect } from "next/navigation";
import { getServerSupabase } from "../../../lib/supabase";

export async function sendMagicLink(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email || !email.includes("@")) {
    redirect("/admin/login?error=send_failed");
  }

  const supabase = await getServerSupabase();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${appUrl}/auth/callback?next=/admin`,
      shouldCreateUser: true,
    },
  });

  if (error) {
    console.error("[auth] signInWithOtp failed", error);
    redirect("/admin/login?error=send_failed");
  }

  redirect("/admin/login?sent=1");
}
