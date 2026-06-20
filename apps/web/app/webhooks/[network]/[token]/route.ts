// Phase 3.2 — affiliate conversion postback handler.
//
// POST /webhooks/<network>/<token>
//
//   1. validate network + the {token} path segment (per-network, from env)
//   2. HMAC-verify the raw body when the network signs (e.g. Awin)
//   3. parse the postback → NormalizedConversion (shared)
//   4. ingestConversion: resolve subid → affiliate_link → click/page, then
//      idempotent upsert on (network, network_transaction_id)
//
// All ingestion logic is in @nichefinder/shared and unit-tested there; this
// route is the HTTP + auth + body-parsing adapter.

import { ingestConversion, isAffiliateNetwork, parsePostback } from "@nichefinder/shared";
import { verifyHmacSignature, verifyWebhookToken } from "@nichefinder/shared/webhooks";
import { type NextRequest, NextResponse } from "next/server";
import { getServiceRoleSupabase } from "../../../../lib/supabase";
import { getNetworkWebhookConfig } from "../../../../lib/webhooks/config";
import { createSupabaseConversionStore } from "../../../../lib/webhooks/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Candidate headers networks use to carry an HMAC signature.
const SIGNATURE_HEADERS = [
  "x-signature",
  "x-webhook-signature",
  "x-hub-signature-256",
  "signature",
];

function readSignature(req: NextRequest): string | null {
  for (const h of SIGNATURE_HEADERS) {
    const v = req.headers.get(h);
    if (v) return v;
  }
  return null;
}

function parseBody(raw: string, contentType: string | null): Record<string, unknown> | null {
  const ct = (contentType ?? "").toLowerCase();
  try {
    if (ct.includes("application/json")) {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    }
    // Default to form-urlencoded (the common postback encoding).
    const params = new URLSearchParams(raw);
    return Object.fromEntries(params.entries());
  } catch {
    return null;
  }
}

interface RouteContext {
  params: Promise<{ network: string; token: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { network, token } = await context.params;

  if (!isAffiliateNetwork(network)) {
    return NextResponse.json({ ok: false, error: "unknown network" }, { status: 404 });
  }

  const config = getNetworkWebhookConfig(network);
  // No token configured ⇒ this network's webhook is off. 404, not 401, so we
  // don't confirm the path exists.
  if (!config.token) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  if (!verifyWebhookToken(token, config.token)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const raw = await request.text();

  // If the network signs its postbacks, the signature is mandatory.
  if (config.signingSecret) {
    const signature = readSignature(request);
    if (!verifyHmacSignature({ payload: raw, signature, secret: config.signingSecret })) {
      return NextResponse.json({ ok: false, error: "bad signature" }, { status: 401 });
    }
  }

  const body = parseBody(raw, request.headers.get("content-type"));
  if (!body) {
    return NextResponse.json({ ok: false, error: "unparseable body" }, { status: 400 });
  }

  const normalized = parsePostback(network, body);
  if (!normalized) {
    return NextResponse.json({ ok: false, error: "missing transaction id" }, { status: 400 });
  }

  try {
    const store = createSupabaseConversionStore(getServiceRoleSupabase());
    const result = await ingestConversion({
      store,
      network,
      normalized,
      receivedAt: new Date().toISOString(),
    });

    if (result.status === "unlinked") {
      // Accepted but not attributable (no/unknown subid). Log and 202 so the
      // network stops retrying; the daily reconciliation may still match it.
      console.warn(
        `[webhook] ${network} txn ${normalized.networkTransactionId} unlinked: ${result.reason}`,
      );
      return NextResponse.json({ ok: false, reason: result.reason }, { status: 202 });
    }

    return NextResponse.json({ ok: true, action: result.action }, { status: 200 });
  } catch (err) {
    console.error(`[webhook] ${network} ingestion failed`, err);
    return NextResponse.json({ ok: false, error: "ingestion failed" }, { status: 500 });
  }
}
