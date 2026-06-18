// Gated admin layout. Wraps the dashboard at /admin. /admin/login lives
// outside this route group so it isn't gated (avoids redirect loop).

import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "../../../lib/auth";

export const metadata = { title: "Admin" };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();

  return (
    <div style={{ fontFamily: "var(--font-sans)" }}>
      <header
        style={{
          borderBottom: "1px solid #e5e5e5",
          padding: "0.75rem 1.5rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "#fafafa",
        }}
      >
        <nav style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <Link href="/admin" style={{ fontWeight: 600 }}>
            NicheFinder Admin
          </Link>
          <Link href="/admin/niches">Niches</Link>
          <Link href="/admin/tests">Tests</Link>
          <Link href="/admin/content">Content</Link>
          <Link href="/admin/promotions">Promotions</Link>
          <Link href="/admin/migrations">Migrations</Link>
          <Link href="/admin/orchestrator">Orchestrator</Link>
          <Link href="/admin/costs">Costs</Link>
        </nav>
        <span style={{ fontSize: "0.875rem", color: "#525252" }}>{admin.email}</span>
      </header>
      <main style={{ padding: "1.5rem" }}>{children}</main>
    </div>
  );
}
