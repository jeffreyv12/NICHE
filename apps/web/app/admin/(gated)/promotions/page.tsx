// Phase 5.1.3 — Operator domain-approval page.
//
// Shows niches where the promotion agent returned result='ready'.
// For each, the operator can see candidate domains and click
// "Confirm registration" to start the 13-step migration state machine.
//
// CLAUDE.md #1: the button is the gate — no auto-registration ever.
// CLAUDE.md #10: promotion gate is lagging on purpose.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "../../../../lib/auth";
import { getServiceRoleSupabase } from "../../../../lib/supabase";
import { confirmRegistrationAction } from "./actions";

interface PromotionEval {
  id: string;
  niche_id: string;
  result: string;
  recommendation: string | null;
  candidate_domains: Array<{
    hostname: string;
    registrar: string;
    available: boolean;
    price_eur_year: number | null;
  }> | null;
  evaluated_at: string;
}

interface NichePromotion {
  niche_id: string;
  topic: string;
  topic_slug: string;
  tenant_id: string;
  tenant_slug: string;
  eval: PromotionEval;
  has_pending_migration: boolean;
}

async function load(): Promise<NichePromotion[]> {
  const supabase = getServiceRoleSupabase();

  // Latest promotion_evaluations where result='ready' and no migration yet started
  const { data: evals } = await supabase
    .from("promotion_evaluations")
    .select("id, niche_id, result, recommendation, candidate_domains, evaluated_at")
    .eq("result", "ready")
    .order("evaluated_at", { ascending: false });

  if (!evals || evals.length === 0) return [];

  // Deduplicate by niche_id (keep latest)
  const latestByNiche = new Map<string, PromotionEval>();
  for (const e of evals) {
    if (!latestByNiche.has(e.niche_id)) latestByNiche.set(e.niche_id, e as PromotionEval);
  }

  const nicheIds = Array.from(latestByNiche.keys());

  // Fetch niche + tenant info
  const { data: niches } = await supabase
    .from("niches")
    .select("id, topic, topic_slug, tenant_id, tenants!inner(slug)")
    .in("id", nicheIds)
    .in("state", ["building", "mature"]);

  if (!niches || niches.length === 0) return [];

  // Check for existing pending/running migrations
  const { data: migrations } = await supabase
    .from("promotion_migrations")
    .select("niche_id, status")
    .in("niche_id", nicheIds)
    .in("status", ["pending", "running"]);

  const runningNiches = new Set((migrations ?? []).map((m) => m.niche_id));

  return niches.map((n) => {
    const tenantRow = n.tenants as unknown as { slug: string };
    return {
      niche_id: n.id,
      topic: n.topic,
      topic_slug: n.topic_slug,
      tenant_id: n.tenant_id,
      tenant_slug: tenantRow.slug,
      eval: latestByNiche.get(n.id) as PromotionEval,
      has_pending_migration: runningNiches.has(n.id),
    };
  });
}

export default async function PromotionsPage() {
  const admin = await requireAdmin();
  const items = await load();

  return (
    <div>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>
        Promotion Approvals
      </h1>
      <p style={{ color: "#525252", marginBottom: "1.5rem", fontSize: "0.875rem" }}>
        Niches the promotion agent rated <strong>ready</strong>. Review candidate domains and
        confirm registration to start the 13-step migration. This action is irreversible — it
        triggers domain purchase.
      </p>

      {items.length === 0 && (
        <p style={{ color: "#737373" }}>No niches are currently ready for promotion.</p>
      )}

      {items.map((item) => (
        <PromotionCard key={item.niche_id} item={item} operatorEmail={admin.email ?? ""} />
      ))}
    </div>
  );
}

function PromotionCard({
  item,
  operatorEmail,
}: {
  item: NichePromotion;
  operatorEmail: string;
}) {
  const availableDomains = (item.eval.candidate_domains ?? []).filter((d) => d.available);

  return (
    <div
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: "0.5rem",
        padding: "1.25rem",
        marginBottom: "1rem",
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.25rem" }}>
            {item.topic}
          </h2>
          <p style={{ fontSize: "0.8125rem", color: "#737373" }}>
            Slug: <code>{item.topic_slug}</code> · Tenant: <code>{item.tenant_slug}</code>
          </p>
        </div>
        <span
          style={{
            fontSize: "0.75rem",
            background: "#dcfce7",
            color: "#166534",
            borderRadius: "9999px",
            padding: "0.2rem 0.6rem",
            fontWeight: 600,
          }}
        >
          READY
        </span>
      </div>

      {item.eval.recommendation && (
        <p style={{ marginTop: "0.75rem", fontSize: "0.875rem", color: "#404040" }}>
          {item.eval.recommendation}
        </p>
      )}

      <div style={{ marginTop: "1rem" }}>
        <p style={{ fontWeight: 600, fontSize: "0.8125rem", marginBottom: "0.5rem" }}>
          Candidate domains
        </p>
        {(item.eval.candidate_domains ?? []).length === 0 ? (
          <p style={{ color: "#737373", fontSize: "0.8125rem" }}>No candidates checked.</p>
        ) : (
          <table style={{ width: "100%", fontSize: "0.8125rem", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e5e5" }}>
                <th style={{ textAlign: "left", padding: "0.25rem 0.5rem" }}>Domain</th>
                <th style={{ textAlign: "left", padding: "0.25rem 0.5rem" }}>Registrar</th>
                <th style={{ textAlign: "left", padding: "0.25rem 0.5rem" }}>Available</th>
                <th style={{ textAlign: "left", padding: "0.25rem 0.5rem" }}>Price/yr</th>
                <th style={{ padding: "0.25rem 0.5rem" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {(item.eval.candidate_domains ?? []).map((d) => (
                <tr key={d.hostname} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={{ padding: "0.375rem 0.5rem", fontFamily: "monospace" }}>
                    {d.hostname}
                  </td>
                  <td style={{ padding: "0.375rem 0.5rem" }}>{d.registrar}</td>
                  <td style={{ padding: "0.375rem 0.5rem" }}>
                    {d.available ? (
                      <span style={{ color: "#166534" }}>✓ Yes</span>
                    ) : (
                      <span style={{ color: "#9ca3af" }}>✗ No</span>
                    )}
                  </td>
                  <td style={{ padding: "0.375rem 0.5rem" }}>
                    {d.price_eur_year != null ? `€${d.price_eur_year}` : "—"}
                  </td>
                  <td style={{ padding: "0.375rem 0.5rem" }}>
                    {d.available && !item.has_pending_migration ? (
                      <ConfirmButton
                        nicheId={item.niche_id}
                        hostname={d.hostname}
                        registrar={d.registrar as "cloudflare" | "transip"}
                        tenantId={item.tenant_id}
                        operatorEmail={operatorEmail}
                      />
                    ) : item.has_pending_migration ? (
                      <span style={{ color: "#f59e0b", fontSize: "0.75rem" }}>
                        Migration pending
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ConfirmButton({
  nicheId,
  hostname,
  registrar,
  tenantId,
  operatorEmail,
}: {
  nicheId: string;
  hostname: string;
  registrar: "cloudflare" | "transip";
  tenantId: string;
  operatorEmail: string;
}) {
  const action = confirmRegistrationAction.bind(
    null,
    nicheId,
    hostname,
    registrar,
    tenantId,
    operatorEmail,
  );

  return (
    <form action={action}>
      <button
        type="submit"
        style={{
          background: "#166534",
          color: "#fff",
          border: "none",
          borderRadius: "0.375rem",
          padding: "0.3rem 0.75rem",
          fontSize: "0.75rem",
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        Confirm registration
      </button>
    </form>
  );
}
