// Phase 2.1.2 — Bol product-feed sync (runs every 2h via systemd timer).
//
// Refreshes product metadata (price, name, brand, category, rating) for all
// active Bol products in the `products` table. Keeps the Content Agent's
// product-data context current without per-request catalog API calls.
//
// Strategy:
//   1. Load all `products` with source='bol' and a non-null external_id (EAN).
//   2. Search the Bol Marketing Catalog by EAN, picking the exact-match row.
//   3. Upsert updated fields into `products` using the (source, external_id) index.
//   4. Batch in groups of 10 with a configurable inter-batch delay to honour
//      the rate limit documented in docs/DATA_SOURCES.md.

import type { ServiceDb } from "@nichefinder/db";
import { products } from "@nichefinder/db";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { searchCatalog } from "../sources/bol/catalog.js";
import type { BolClient } from "../sources/bol/client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunBolFeedSyncOptions {
  db: ServiceDb;
  /** Injectable Bol client. */
  bolClient: BolClient;
  /** Products per API call batch (default 10; keep low for rate limits). */
  batchSize?: number;
  /** Delay in ms between batches (default 600 — Bol allows ~100 RPM). */
  batchDelayMs?: number;
  /** Max products to refresh per run (default 500 — safety cap). */
  maxProducts?: number;
}

export interface BolFeedSyncProductResult {
  productId: string;
  ean: string;
  status: "updated" | "not_found" | "error";
  error?: string;
}

export interface RunBolFeedSyncResult {
  productsScanned: number;
  updated: number;
  notFound: number;
  errors: number;
  items: BolFeedSyncProductResult[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function eurosToCents(price: number | undefined): number | null {
  if (price == null) return null;
  return Math.round(price * 100);
}

// ---------------------------------------------------------------------------
// Core job
// ---------------------------------------------------------------------------

export async function runBolFeedSyncJob(
  opts: RunBolFeedSyncOptions,
): Promise<RunBolFeedSyncResult> {
  const batchSize = opts.batchSize ?? 10;
  const batchDelayMs = opts.batchDelayMs ?? 600;
  const maxProducts = opts.maxProducts ?? 500;

  // Load all Bol products with a known EAN.
  const allProducts = await opts.db
    .select({ id: products.id, ean: products.externalId, tenantId: products.tenantId })
    .from(products)
    .where(and(eq(products.source, "bol"), isNotNull(products.externalId)));

  const toSync = allProducts.slice(0, maxProducts);

  const result: RunBolFeedSyncResult = {
    productsScanned: toSync.length,
    updated: 0,
    notFound: 0,
    errors: 0,
    items: [],
  };

  // Process in batches.
  for (let i = 0; i < toSync.length; i += batchSize) {
    const batch = toSync.slice(i, i + batchSize);

    for (const product of batch) {
      if (!product.ean) continue;

      try {
        const searchResult = await searchCatalog(opts.bolClient, {
          searchTerm: product.ean,
          limit: 5,
          countryCode: "NL",
        });

        // Find the exact EAN match in the search results.
        const match = searchResult.products.find((p) => p.ean === product.ean);

        if (!match) {
          result.notFound++;
          result.items.push({ productId: product.id, ean: product.ean, status: "not_found" });
          continue;
        }

        const priceCents = eurosToCents(match.offerData?.fromPrice);
        const category =
          match.categories && match.categories.length > 0
            ? (match.categories[0]?.name ?? null)
            : null;

        await opts.db
          .update(products)
          .set({
            name: match.title ?? product.ean,
            brand: (match as Record<string, unknown>).brand as string | undefined,
            category,
            priceCents: priceCents ?? undefined,
            fetchedAt: new Date(),
            updatedAt: new Date(),
            raw: match as Record<string, unknown>,
          })
          .where(eq(products.id, product.id));

        result.updated++;
        result.items.push({ productId: product.id, ean: product.ean, status: "updated" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors++;
        result.items.push({ productId: product.id, ean: product.ean, status: "error", error: msg });
      }
    }

    // Inter-batch delay to avoid rate-limit spikes (skip after the last batch).
    if (i + batchSize < toSync.length) {
      await sleep(batchDelayMs);
    }
  }

  return result;
}
