// Phase 3.2 — drizzle-backed ConversionStore for the reconciliation job.
//
// The mirror of apps/web/lib/webhooks/store.ts (supabase) for the scraper side,
// implementing the @nichefinder/shared ConversionStore interface against
// ServiceDb. Cross-network ingestion logic lives in shared (ingestConversion).

import { type ServiceDb, affiliateLinks, clicks, conversions } from "@nichefinder/db";
import type {
  AffiliateNetwork,
  ConversionLinks,
  ConversionStore,
  ConversionUpsert,
} from "@nichefinder/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

type AffiliateNetworkColumn = (typeof affiliateLinks.network)["_"]["data"];

export function createDrizzleConversionStore(db: ServiceDb): ConversionStore {
  return {
    async resolveLinks(network: AffiliateNetwork, subid: string): Promise<ConversionLinks | null> {
      // All product links on a page share one subid (across networks); tenant +
      // page are identical regardless of which link the network reports.
      const links = await db
        .select({
          id: affiliateLinks.id,
          tenantId: affiliateLinks.tenantId,
          network: affiliateLinks.network,
        })
        .from(affiliateLinks)
        .where(eq(affiliateLinks.subid, subid));

      const fallback = links[0];
      if (!fallback) return null;

      const forNetwork = links.find((l) => l.network === network) ?? fallback;
      const linkIds = links.map((l) => l.id);

      const clickRows = await db
        .select({ id: clicks.id, pageId: clicks.pageId })
        .from(clicks)
        .where(and(inArray(clicks.affiliateLinkId, linkIds), sql`${clicks.pageId} is not null`))
        .orderBy(desc(clicks.occurredAt))
        .limit(1);
      const click = clickRows[0];

      return {
        tenantId: forNetwork.tenantId,
        affiliateLinkId: forNetwork.id,
        clickId: click?.id ?? null,
        pageId: click?.pageId ?? null,
      };
    },

    async upsertConversion(row: ConversionUpsert): Promise<{ action: "inserted" | "updated" }> {
      const existing = await db
        .select({ id: conversions.id })
        .from(conversions)
        .where(
          and(
            eq(conversions.network, row.network as AffiliateNetworkColumn),
            eq(conversions.networkTransactionId, row.networkTransactionId),
          ),
        )
        .limit(1);

      if (existing[0]) {
        // Update mutable fields; never null out an already-resolved link.
        const set: Record<string, unknown> = {
          status: row.status,
          statusSetAt: new Date(),
          amountCents: row.amountCents,
          commissionCents: row.commissionCents,
          currency: row.currency,
          raw: row.raw,
        };
        if (row.affiliateLinkId) set.affiliateLinkId = row.affiliateLinkId;
        if (row.clickId) set.clickId = row.clickId;
        if (row.pageId) set.pageId = row.pageId;
        await db.update(conversions).set(set).where(eq(conversions.id, existing[0].id));
        return { action: "updated" };
      }

      await db.insert(conversions).values({
        tenantId: row.tenantId,
        network: row.network as AffiliateNetworkColumn,
        networkTransactionId: row.networkTransactionId,
        affiliateLinkId: row.affiliateLinkId,
        clickId: row.clickId,
        pageId: row.pageId,
        productExternalId: row.productExternalId,
        amountCents: row.amountCents,
        commissionCents: row.commissionCents,
        currency: row.currency,
        occurredAt: new Date(row.occurredAt),
        status: row.status,
        statusSetAt: new Date(),
        raw: row.raw,
      });
      return { action: "inserted" };
    },
  };
}
