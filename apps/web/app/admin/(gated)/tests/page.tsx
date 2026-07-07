// Phase 4.3.1 — first-party test log.
//
// Lists logged tests and a form to add one. A logged test can be attached to a
// claim on a niche-detail page to clear the Claim Verifier block (4.3.3).
// Photo upload (4.3.2) is deferred until the R2 bucket exists.

export const dynamic = "force-dynamic";

import { requireAdmin } from "../../../../lib/auth";
import { getServiceRoleSupabase } from "../../../../lib/supabase";
import { createFirstPartyTestAction } from "./actions";

interface TestRow {
  id: string;
  product_name: string;
  test_summary_md: string | null;
  rating: number | null;
  pros: string[] | null;
  cons: string[] | null;
  test_finished_at: string | null;
  created_by_email: string | null;
  created_at: string;
}

async function loadTests(): Promise<TestRow[]> {
  const supabase = getServiceRoleSupabase();
  const { data } = await supabase
    .from("first_party_tests")
    .select(
      "id, product_name, test_summary_md, rating, pros, cons, test_finished_at, created_by_email, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []) as TestRow[];
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("nl-NL", { dateStyle: "short" });
}

const label = { display: "block", fontSize: "0.8125rem", fontWeight: 600, marginBottom: "0.25rem" };
const field = {
  width: "100%",
  padding: "0.375rem 0.5rem",
  border: "1px solid #d4d4d4",
  borderRadius: "0.25rem",
  fontSize: "0.875rem",
} as const;

export default async function AdminTestsPage() {
  await requireAdmin();
  const tests = await loadTests();

  return (
    <article style={{ maxWidth: "56rem" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>Eigen producttests</h1>

      <section
        style={{
          border: "1px solid #e5e5e5",
          borderRadius: "0.5rem",
          padding: "1rem 1.25rem",
          marginBottom: "2rem",
        }}
      >
        <h2 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>Nieuwe test loggen</h2>
        <form action={createFirstPartyTestAction} style={{ display: "grid", gap: "0.75rem" }}>
          <div>
            <label htmlFor="product_name" style={label}>
              Product *
            </label>
            <input id="product_name" name="product_name" required style={field} />
          </div>
          <div>
            <label htmlFor="summary" style={label}>
              Samenvatting (markdown) *
            </label>
            <textarea id="summary" name="summary" required rows={4} style={field} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label htmlFor="rating" style={label}>
                Cijfer (1–5)
              </label>
              <input id="rating" name="rating" type="number" min={1} max={5} style={field} />
            </div>
            <div>
              <label htmlFor="test_started_at" style={label}>
                Gestart
              </label>
              <input id="test_started_at" name="test_started_at" type="date" style={field} />
            </div>
            <div>
              <label htmlFor="test_finished_at" style={label}>
                Afgerond
              </label>
              <input id="test_finished_at" name="test_finished_at" type="date" style={field} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div>
              <label htmlFor="pros" style={label}>
                Pluspunten (één per regel)
              </label>
              <textarea id="pros" name="pros" rows={3} style={field} />
            </div>
            <div>
              <label htmlFor="cons" style={label}>
                Minpunten (één per regel)
              </label>
              <textarea id="cons" name="cons" rows={3} style={field} />
            </div>
          </div>
          <div>
            <label htmlFor="niche_id" style={label}>
              Niche-id (optioneel)
            </label>
            <input id="niche_id" name="niche_id" placeholder="uuid" style={field} />
          </div>
          <p style={{ fontSize: "0.75rem", color: "#737373", margin: 0 }}>
            Foto-upload volgt zodra de R2-bucket is gekoppeld (4.3.2).
          </p>
          <div>
            <button
              type="submit"
              style={{
                background: "#10b981",
                color: "white",
                border: "1px solid #059669",
                borderRadius: "0.375rem",
                padding: "0.5rem 1rem",
                fontSize: "0.875rem",
                cursor: "pointer",
              }}
            >
              Test opslaan
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Gelogde tests ({tests.length})</h2>
        {tests.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "#525252" }}>Nog geen tests gelogd.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {tests.map((t) => (
              <li
                key={t.id}
                style={{
                  border: "1px solid #e5e5e5",
                  borderRadius: "0.375rem",
                  padding: "0.75rem 1rem",
                  marginBottom: "0.5rem",
                }}
              >
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
                  <strong>{t.product_name}</strong>
                  {t.rating ? (
                    <span style={{ fontSize: "0.8125rem", color: "#525252" }}>{t.rating}/5</span>
                  ) : null}
                  <span style={{ fontSize: "0.75rem", color: "#a3a3a3", marginLeft: "auto" }}>
                    {fmtDate(t.test_finished_at ?? t.created_at)} · {t.created_by_email ?? "?"}
                  </span>
                </div>
                {t.test_summary_md ? (
                  <p style={{ fontSize: "0.8125rem", color: "#525252", margin: "0.375rem 0 0" }}>
                    {t.test_summary_md.slice(0, 240)}
                    {t.test_summary_md.length > 240 ? "…" : ""}
                  </p>
                ) : null}
                <code style={{ fontSize: "0.6875rem", color: "#a3a3a3" }}>{t.id}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
