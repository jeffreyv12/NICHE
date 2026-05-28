// /admin/niches — operator triage UI for scored niche candidates.
//
// Phase 2.4 deliverable per PHASE_PLAN.md:
//   2.4.1 Top-100 candidates by latest score, breakdown drawer per row
//   2.4.2 Filters: state, score range, source, search
//   2.4.3 Per-row actions: Approve for Validation, Reject (with reason)
//   2.4.4 Approve → niches row with state=approved_for_validation
//   2.4.5 Reject → kills row + niche row with state=killed
//
// Server-rendered list; row actions and the breakdown drawer are client
// components in ./_components.

import { CRITERION_KEYS } from "@nichefinder/shared";
import Link from "next/link";
import { getServiceRoleSupabase } from "../../../../lib/supabase";
import { FilterBar, type NicheFilters } from "./_components/FilterBar";
import { type NicheRow, NicheTable } from "./_components/NicheTable";

interface NicheInValidation {
  id: string;
  topic: string;
  state: string;
  approved_for_validation_at: string | null;
  page_count: number;
}

async function loadNichesInValidation(): Promise<NicheInValidation[]> {
  const supabase = getServiceRoleSupabase();
  const { data: nichesData } = await supabase
    .from("niches")
    .select("id, topic, state, approved_for_validation_at")
    .in("state", ["approved_for_validation", "validating", "go", "pivot"])
    .order("approved_for_validation_at", { ascending: false })
    .limit(20);
  if (!nichesData?.length) return [];

  const nicheIds = nichesData.map((n) => n.id);
  const { data: pageRows } = await supabase
    .from("pages")
    .select("niche_id")
    .in("niche_id", nicheIds);
  const counts = new Map<string, number>();
  for (const p of pageRows ?? []) {
    if (p.niche_id) counts.set(p.niche_id, (counts.get(p.niche_id) ?? 0) + 1);
  }
  return nichesData.map((n) => ({ ...n, page_count: counts.get(n.id) ?? 0 }));
}

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NichesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = parseFilters(params);
  const [rows, inValidation] = await Promise.all([loadRows(filters), loadNichesInValidation()]);

  return (
    <div>
      <header style={{ marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>Niches</h1>
        <p style={{ color: "#525252", fontSize: "0.875rem" }}>
          Top-100 kandidaten gesorteerd op meest recente score. Approve, Reject of bekijk de
          breakdown.
        </p>
      </header>

      {inValidation.length > 0 ? (
        <section
          style={{
            background: "#fafafa",
            border: "1px solid #e5e5e5",
            borderRadius: "0.5rem",
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            fontSize: "0.875rem",
          }}
        >
          <h2 style={{ fontSize: "0.875rem", marginBottom: "0.5rem" }}>In validation</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {inValidation.map((n) => (
              <li key={n.id} style={{ padding: "0.125rem 0" }}>
                <Link href={`/admin/niches/${n.id}`}>{n.topic}</Link>{" "}
                <span style={{ color: "#737373" }}>
                  · {n.state} · {n.page_count} pagina&apos;s
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <FilterBar initial={filters} />

      <div style={{ marginTop: "1rem" }}>
        <NicheTable rows={rows} />
      </div>

      {rows.length === 0 && (
        <p style={{ color: "#737373", marginTop: "1rem", fontSize: "0.875rem" }}>
          Geen kandidaten met deze filters.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filters: parse → normalised shape; FilterBar mirrors via querystring.
// ---------------------------------------------------------------------------

function parseFilters(p: Record<string, string | string[] | undefined>): NicheFilters {
  const one = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;

  const min = Number.parseInt(one(p.min) ?? "0", 10);
  const max = Number.parseInt(one(p.max) ?? "100", 10);

  return {
    state: (one(p.state) ?? "all") as NicheFilters["state"],
    source: one(p.source) ?? "all",
    search: (one(p.q) ?? "").trim(),
    minScore: Number.isFinite(min) ? Math.max(0, Math.min(100, min)) : 0,
    maxScore: Number.isFinite(max) ? Math.max(0, Math.min(100, max)) : 100,
  };
}

// ---------------------------------------------------------------------------
// Data load — uses service-role to bypass RLS for the admin view. The auth
// gate in (gated)/layout.tsx is the access control here.
//
// Strategy: pull top-100 latest scores per candidate via a window function,
// then join the candidate row. Supabase JS doesn't expose window functions
// directly, so we fetch scored candidates ordered by scored_at desc, then
// deduplicate in JS (a 100-row cap keeps this trivial).
// ---------------------------------------------------------------------------

async function loadRows(filters: NicheFilters): Promise<NicheRow[]> {
  const supabase = getServiceRoleSupabase();

  // Pull a generous slice of recent scores; we dedupe in JS to "latest per candidate".
  const { data: scoreRows, error: scoreErr } = await supabase
    .from("niche_scores")
    .select("id, candidate_id, scored_at, model, total_score, breakdown, rubric_version, notes")
    .order("scored_at", { ascending: false })
    .limit(500);
  if (scoreErr) throw new Error(`load niche_scores failed: ${scoreErr.message}`);

  const latestPerCandidate = new Map<string, (typeof scoreRows)[number]>();
  for (const s of scoreRows ?? []) {
    if (!latestPerCandidate.has(s.candidate_id)) latestPerCandidate.set(s.candidate_id, s);
  }
  const candidateIds = [...latestPerCandidate.keys()];
  if (candidateIds.length === 0) return [];

  const { data: candRows, error: candErr } = await supabase
    .from("niche_candidates")
    .select(
      "id, topic, topic_slug, source, related_keywords, surfaced_at, trademark_check_state, kill_list_match",
    )
    .in("id", candidateIds);
  if (candErr) throw new Error(`load niche_candidates failed: ${candErr.message}`);

  // Niches table — candidates that already moved to a niches row are not
  // re-triageable from this screen.
  const { data: nicheRows } = await supabase
    .from("niches")
    .select("candidate_id, state")
    .in("candidate_id", candidateIds);
  const nicheByCandidate = new Map<string, string>();
  for (const n of nicheRows ?? []) {
    if (n.candidate_id) nicheByCandidate.set(n.candidate_id, n.state);
  }

  const merged: NicheRow[] = (candRows ?? []).map((c) => {
    const score = latestPerCandidate.get(c.id);
    const state = nicheByCandidate.get(c.id) ?? "candidate";
    return {
      candidateId: c.id,
      topic: c.topic,
      topicSlug: c.topic_slug,
      source: c.source,
      relatedKeywords: c.related_keywords ?? [],
      surfacedAt: c.surfaced_at,
      trademarkCheckState: c.trademark_check_state,
      killListMatch: c.kill_list_match as { category?: { id?: string } } | null,
      state,
      score: score
        ? {
            id: score.id,
            scoredAt: score.scored_at,
            model: score.model,
            totalScore: score.total_score,
            rubricVersion: score.rubric_version,
            breakdown: score.breakdown as Record<string, { score: number; evidence: unknown }>,
            notes: score.notes,
          }
        : null,
    };
  });

  return merged
    .filter((r) => {
      if (filters.state !== "all" && r.state !== filters.state) return false;
      if (filters.source !== "all" && r.source !== filters.source) return false;
      if (filters.search && !r.topic.toLowerCase().includes(filters.search.toLowerCase())) {
        return false;
      }
      const total = r.score?.totalScore ?? 0;
      if (total < filters.minScore || total > filters.maxScore) return false;
      return true;
    })
    .sort((a, b) => (b.score?.totalScore ?? -1) - (a.score?.totalScore ?? -1))
    .slice(0, 100);
}

// Re-export for the actions module to import the same shape.
export type { NicheRow };
export { CRITERION_KEYS };
