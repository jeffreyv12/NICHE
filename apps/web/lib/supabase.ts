// Supabase clients via @supabase/ssr (the current pattern; replaces auth-helpers-nextjs).
//
// Three client kinds:
//  - browser: client-side anon (cookies handled by the browser)
//  - server:  server-side anon, RLS-respecting, cookies via next/headers
//  - service: server-side service-role, BYPASSES RLS — admin actions only

import { type CookieOptions, createBrowserClient, createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function readEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error(
      "Supabase env missing: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY required.",
    );
  }
  return { url, anon };
}

export function getBrowserSupabase() {
  const { url, anon } = readEnv();
  return createBrowserClient(url, anon);
}

export async function getServerSupabase() {
  const { url, anon } = readEnv();
  const cookieStore = await cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet: { name: string; value: string; options: CookieOptions }[]) => {
        try {
          for (const { name, value, options } of toSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component where setting cookies is forbidden;
          // safe to ignore — auth refresh will retry on the next route handler call.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS. Use only after the caller has already
 * verified admin auth (see lib/auth.ts). NEVER expose to the browser.
 */
export function getServiceRoleSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY required for service-role client.");
  }
  return createPlainClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
