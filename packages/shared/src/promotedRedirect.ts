// Phase 5.5.3 — promoted-subfolder redirect target builder.
//
// When a niche is promoted to its own domain, the main-authority middleware
// issues a permanent (308) redirect from the old subfolder URL to the niche's
// new hostname. This pure builder computes the absolute redirect target so the
// edge middleware (apps/web/middleware.ts, no test harness) stays a thin caller
// and the path/query arithmetic can be unit tested here.
//
// Correctness guarantees this function exists to pin:
//   - the subfolder prefix is stripped, the remainder of the path is preserved;
//   - the query string is PRESERVED (a promoted niche's
//     /koffie/best?utm_source=x must land on https://koffie.nl/best?utm_source=x
//     — dropping it would lose affiliate/attribution params on every permanent
//     redirect, which a 308 then caches in the browser);
//   - a bare prefix hit (/koffie or /koffie/) collapses to the apex "/".
//
// Fragments (#…) are never sent to the server, so the browser carries them
// across the redirect on its own — nothing to do here.

export interface BuildPromotedRedirectTargetArgs {
  /** The promoted niche's own hostname, e.g. "koffie.nl" (no scheme). */
  hostname: string;
  /** The full incoming request path, e.g. "/koffie/best". */
  pathname: string;
  /** The matched subfolder prefix to strip, e.g. "/koffie". */
  prefix: string;
  /**
   * The raw query string including the leading "?" (Next's `nextUrl.search`
   * convention), or "" when there is none. A bare "?" is treated as empty.
   */
  search?: string;
}

/**
 * Build the absolute `https://` redirect target for a promoted subfolder.
 *
 * @example
 * buildPromotedRedirectTarget({ hostname: "koffie.nl", pathname: "/koffie/best", prefix: "/koffie", search: "?utm=x" })
 * // => "https://koffie.nl/best?utm=x"
 */
export function buildPromotedRedirectTarget(args: BuildPromotedRedirectTargetArgs): string {
  const { hostname, pathname, prefix, search } = args;

  // Strip the subfolder prefix; an empty remainder collapses to the apex.
  const remainder = pathname.slice(prefix.length) || "/";

  // Normalise the query string: drop a lone "?" and tolerate a caller that
  // passes the query without its leading "?".
  let query = search ?? "";
  if (query === "?") query = "";
  if (query && !query.startsWith("?")) query = `?${query}`;

  return `https://${hostname}${remainder}${query}`;
}
