// Promotion Gate criterion 6 INGEST side — pure + I/O-free mapping of Google
// Search Status incidents into algorithm_events insert records (migration 0011 +
// 0012). The source wrapper (apps/scrapers .../google-search-status) fetches and
// Zod-validates the feed; this maps the validated incidents to rows the ingest
// job upserts, and `selectAlgorithmEvents30d` later reads. Mirrors the other
// shared rollups (gscPageMetrics, nicheMonthlyMetrics) — all DB/HTTP-free so it
// is unit-testable without a live feed or DB.
//
// We keep ANY incident affecting the "Ranking" product, regardless of whether
// Google labels it informational (an announced core/spam update) or a
// disruption (a ranking bug). Both are reasons not to promote into volatility —
// criterion 6 errs toward blocking on purpose (CLAUDE.md #10: a false "ready" is
// worse than waiting). Serving/Crawling/Indexing-only incidents are dropped.

export const ALGORITHM_EVENT_SOURCE = "google_search_status" as const;

/** The product whose incidents are ranking-update windows. */
const RANKING_PRODUCT = "ranking";

/**
 * One incident as needed from status.search.google.com/incidents.json. Forgiving
 * by design — the source's Zod schema passes through the full payload; we read
 * only these fields. `end` is absent/empty while a rollout is still ongoing.
 */
export interface SearchStatusIncident {
  id?: string | null;
  external_desc?: string | null;
  service_name?: string | null;
  begin?: string | null;
  end?: string | null;
  affected_products?: ReadonlyArray<{ title?: string | null; id?: string | null }> | null;
}

/** An algorithm_events row ready to upsert (job adds nothing else). */
export interface AlgorithmEventInsert {
  externalId: string;
  kind: string;
  name: string | null;
  /** ISO 8601. */
  startedAt: string;
  /** ISO 8601, or null while the rollout is ongoing. */
  endedAt: string | null;
  source: typeof ALGORITHM_EVENT_SOURCE;
}

/**
 * Classify the Google update label into the kind vocabulary the promotion gate
 * and orchestrator use. Order matters: "helpful content update" and "reviews
 * update" are checked before the generic buckets. Unknown labels → "other" (the
 * gate treats every kind the same — kind is for the operator-facing report).
 */
export function classifyAlgorithmEventKind(label: string | null | undefined): string {
  const s = (label ?? "").toLowerCase();
  if (s.includes("helpful content")) return "helpful_content_update";
  if (s.includes("review")) return "reviews_update";
  if (s.includes("spam")) return "spam_update";
  if (s.includes("core update") || s.includes("core ranking")) return "core_update";
  return "other";
}

function affectsRanking(incident: SearchStatusIncident): boolean {
  if ((incident.service_name ?? "").toLowerCase() === RANKING_PRODUCT) return true;
  return (incident.affected_products ?? []).some(
    (p) => (p?.title ?? "").toLowerCase() === RANKING_PRODUCT,
  );
}

function isoOrNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Map a Search Status feed to algorithm_events insert records:
 *  - keep only Ranking-affecting incidents,
 *  - drop rows with no id or an unparseable `begin` (a bad row must not silently
 *    create a phantom update window),
 *  - normalize `begin`/`end` to ISO (unparseable/absent `end` → null = ongoing),
 *  - dedup by id (last occurrence wins — the feed shouldn't repeat ids, but a
 *    revised incident should not double-insert),
 *  - sort by startedAt ascending for stable output.
 */
export function mapSearchStatusIncidents(
  incidents: readonly SearchStatusIncident[],
): AlgorithmEventInsert[] {
  const byId = new Map<string, AlgorithmEventInsert>();

  for (const incident of incidents) {
    if (!affectsRanking(incident)) continue;

    const externalId = incident.id ?? "";
    if (externalId === "") continue;

    const startedAt = isoOrNull(incident.begin);
    if (startedAt === null) continue;

    const name = incident.external_desc?.trim() || null;
    byId.set(externalId, {
      externalId,
      kind: classifyAlgorithmEventKind(name),
      name,
      startedAt,
      endedAt: isoOrNull(incident.end),
      source: ALGORITHM_EVENT_SOURCE,
    });
  }

  return [...byId.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
