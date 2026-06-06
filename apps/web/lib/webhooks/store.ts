// Phase 3.2 — supabase-backed ConversionStore for the conversion webhook.
//
// Implements the @nichefinder/shared ConversionStore interface against the
// service-role supabase client. The cross-network ingestion logic lives in
// shared (ingestConversion); this file is only the DB plumbing.

import type {
  AffiliateNetwork,
  ConversionLinks,
  ConversionStore,
  ConversionUpsert,
} from "@nichefinder/shared";
import type { getServiceRoleSupabase } from "../supabase";

type Supabase = ReturnType<typeof getServiceRoleSupabase>;

interface LinkRow {
  id: string;
  tenant_id: string;
  network: string;
}

export function createSupabaseConversionStore(supabase: Supabase): ConversionStore {
  return {
    async resolveLinks(network: AffiliateNetwork, subid: string): Promise<ConversionLinks | null> {
      // A subid (tenant:page:cohort) is shared by every product link on a page,
      // across networks. Load them all: tenant + the page (via a click) are the
      // same regardless of which link the network reports.
      const { data: links } = (await supabase
        .from("affiliate_links")
        .select("id, tenant_id, network")
        .eq("subid", subid)) as { data: LinkRow[] | null };

      const fallback = links?.[0];
      if (!fallback) return null;

      const forNetwork = links.find((l) => l.network === network) ?? fallback;
      const linkIds = links.map((l) => l.id);

      // Best-effort page/click attribution: the most recent non-bot click that
      // carried a page id on any of this page's links.
      const { data: click } = (await supabase
        .from("clicks")
        .select("id, page_id")
        .in("affiliate_link_id", linkIds)
        .not("page_id", "is", null)
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle()) as { data: { id: string; page_id: string | null } | null };

      return {
        tenantId: forNetwork.tenant_id,
        affiliateLinkId: forNetwork.id,
        clickId: click?.id ?? null,
        pageId: click?.page_id ?? null,
      };
    },

    async upsertConversion(row: ConversionUpsert): Promise<{ action: "inserted" | "updated" }> {
      // Idempotency key: (network, network_transaction_id) — unique in schema.
      const { data: existing } = (await supabase
        .from("conversions")
        .select("id")
        .eq("network", row.network)
        .eq("network_transaction_id", row.networkTransactionId)
        .maybeSingle()) as { data: { id: string } | null };

      if (existing) {
        // Update mutable fields; never null out a link we already resolved.
        const patch: Record<string, unknown> = {
          status: row.status,
          status_set_at: new Date().toISOString(),
          amount_cents: row.amountCents,
          commission_cents: row.commissionCents,
          currency: row.currency,
          raw: row.raw,
        };
        if (row.affiliateLinkId) patch.affiliate_link_id = row.affiliateLinkId;
        if (row.clickId) patch.click_id = row.clickId;
        if (row.pageId) patch.page_id = row.pageId;
        const { error } = await supabase.from("conversions").update(patch).eq("id", existing.id);
        if (error) throw new Error(`conversion update failed: ${error.message}`);
        return { action: "updated" };
      }

      const { error } = await supabase.from("conversions").insert({
        tenant_id: row.tenantId,
        network: row.network,
        network_transaction_id: row.networkTransactionId,
        affiliate_link_id: row.affiliateLinkId,
        click_id: row.clickId,
        page_id: row.pageId,
        product_external_id: row.productExternalId,
        amount_cents: row.amountCents,
        commission_cents: row.commissionCents,
        currency: row.currency,
        occurred_at: row.occurredAt,
        status: row.status,
        raw: row.raw,
      });
      if (error) throw new Error(`conversion insert failed: ${error.message}`);
      return { action: "inserted" };
    },
  };
}
