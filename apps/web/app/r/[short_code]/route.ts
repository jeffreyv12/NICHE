// Affiliate-link redirect: GET /r/[short_code]
//
// 1. Lookup affiliate_links by short_code
// 2. Write a clicks row (cohort, hashed-IP, UA, referrer, simple bot score)
// 3. 302 to affiliate_links.tracking_url
//
// Per ARCHITECTURE.md data flow: clicks are the top-of-funnel signal that
// feeds the Validation Agent's GO/PIVOT/KILL decision.

import { createHash } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "../../../lib/supabase";

interface AffiliateLinkRow {
  id: string;
  tenant_id: string;
  tracking_url: string;
  retired_at: string | null;
}

function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  // Daily-rotating salt so the hash isn't a permanent identifier.
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${ip}|${day}|nichefinder`).digest("hex").slice(0, 32);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only trust a `?p=` value that is a real UUID; otherwise attribute to no page. */
function parsePageId(raw: string | null): string | null {
  return raw && UUID_RE.test(raw) ? raw : null;
}

function simpleBotScore(userAgent: string | null): number {
  if (!userAgent) return 80;
  const ua = userAgent.toLowerCase();
  if (/bot|crawl|spider|wget|curl|python-requests|java\//.test(ua)) return 95;
  if (/headless|phantom|selenium|puppeteer|playwright/.test(ua)) return 90;
  if (/preview|prefetch|fetch/.test(ua)) return 60;
  return 10;
}

interface RouteContext {
  params: Promise<{ short_code: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { short_code } = await context.params;
  if (!short_code) {
    return NextResponse.json({ error: "missing short_code" }, { status: 400 });
  }

  const supabase = getServiceRoleSupabase();

  // 1. Lookup
  const { data: link, error: linkError } = (await supabase
    .from("affiliate_links")
    .select("id, tenant_id, tracking_url, retired_at")
    .eq("short_code", short_code)
    .maybeSingle()) as { data: AffiliateLinkRow | null; error: unknown };

  if (linkError || !link) {
    return NextResponse.json({ error: "unknown short_code" }, { status: 404 });
  }
  if (link.retired_at) {
    // Retired: take the user back to the tenant homepage rather than a dead URL.
    return NextResponse.redirect(new URL("/", request.url), 302);
  }

  // 2. Click logging — non-blocking on failure (a click should redirect even if logging fails)
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    null;
  const userAgent = request.headers.get("user-agent");
  const referrer = request.headers.get("referer");
  const url = new URL(request.url);
  const cohort = url.searchParams.get("c") ?? "organic";
  // The test page links to /r/<code>?c=<cohort>&p=<page_id> so the click — and
  // any conversion later attributed to it — can be tied back to the page that
  // drove it. This is what the Validation Agent's per-page metrics rely on.
  const pageId = parsePageId(url.searchParams.get("p"));
  const botScore = simpleBotScore(userAgent);

  try {
    await supabase.from("clicks").insert({
      tenant_id: link.tenant_id,
      affiliate_link_id: link.id,
      page_id: pageId,
      ip_hash: hashIp(ip),
      user_agent: userAgent,
      referrer,
      is_bot: botScore >= 70,
      bot_score: botScore,
      cohort,
      outcome: "pending",
    });
  } catch (err) {
    console.error("[clicks] insert failed", err);
  }

  // 3. Redirect
  return NextResponse.redirect(link.tracking_url, 302);
}
