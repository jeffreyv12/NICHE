// Phase 6.4.5 — per-tenant robots.txt.
//
// Served at /robots.txt on each tenant host. Disallows the validation test
// pages (/test/, which are also noindex) and the affiliate redirector (/r/,
// no crawl value and keeps bots out of the click log), allows everything else,
// and points crawlers at the tenant sitemap.

import { buildRobotsTxt } from "@nichefinder/shared";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
// Static content; revalidate daily.
export const revalidate = 86_400;

export function GET(request: NextRequest) {
  const origin = new URL(request.url).origin;
  const body = buildRobotsTxt(origin);

  return new NextResponse(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=86400",
    },
  });
}
