// Per-tenant layout — Trust & Authority design system
// Phase 6.4.4: Klaro! CMP loaded per-tenant with a base config.

import { type TenantCmpConfig, buildKlaroConfig } from "@nichefinder/shared";
import { notFound } from "next/navigation";
import Script from "next/script";
import type { ReactNode } from "react";
import { AffiliateDisclosure } from "../../../components/AffiliateDisclosure";
import { getServiceRoleSupabase } from "../../../lib/supabase";

interface TenantConfig {
  brand?: {
    name?: string;
    primaryColor?: string;
    accentColor?: string;
    backgroundColor?: string;
    textColor?: string;
  };
  locale?: { primary?: string };
  affiliate?: { disclosureText?: { nl?: string; en?: string } };
  cmp?: TenantCmpConfig;
}

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  config: TenantConfig;
}

async function loadTenant(slug: string): Promise<TenantRow | null> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from("tenants")
    .select("id, slug, name, config")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;
  return data as TenantRow;
}

export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenant_slug: string }>;
}) {
  const { tenant_slug } = await params;
  const tenant = await loadTenant(tenant_slug);
  if (!tenant) notFound();

  const brand = tenant.config?.brand ?? {};
  const lang = tenant.config?.locale?.primary ?? "nl-NL";
  const siteName = brand.name ?? tenant.name ?? "NicheFinder";

  const cssVars: Record<string, string> = {};
  if (brand.primaryColor) cssVars["--brand-primary"] = brand.primaryColor;
  if (brand.accentColor) cssVars["--brand-accent"] = brand.accentColor;
  if (brand.backgroundColor) cssVars["--brand-bg"] = brand.backgroundColor;
  if (brand.textColor) cssVars["--brand-text"] = brand.textColor;

  const klaroConfig = buildKlaroConfig(lang, tenant.config?.cmp);

  return (
    <div lang={lang} style={cssVars}>
      <Script id="klaro-config" strategy="beforeInteractive">
        {`window.klaroConfig = ${JSON.stringify(klaroConfig)};`}
      </Script>
      <Script src="https://cdn.kiprotect.com/klaro/latest/klaro.js" strategy="afterInteractive" />

      {/* Site Header */}
      <header
        style={{
          background: "var(--brand-surface, #fff)",
          borderBottom: "1px solid var(--brand-border, #e2e8f0)",
          position: "sticky",
          top: 0,
          zIndex: 40,
          backdropFilter: "blur(8px)",
          backgroundColor: "rgba(255,255,255,0.95)",
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            padding: "0 1.25rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 56,
          }}
        >
          <a
            href="/"
            style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: "0.375rem",
                background: "var(--brand-primary, #2563eb)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                fontWeight: 700,
                color: "#fff",
                fontFamily: "var(--font-heading, Rubik, sans-serif)",
                flexShrink: 0,
              }}
            >
              N
            </span>
            <span
              style={{
                fontFamily: "var(--font-heading, Rubik, sans-serif)",
                fontWeight: 600,
                fontSize: "1.0625rem",
                color: "#0f172a",
              }}
            >
              {siteName}
            </span>
          </a>
          <nav style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
            <a href="/" className="site-nav-link">
              Home
            </a>
          </nav>
        </div>
      </header>

      {/* Affiliate Disclosure */}
      <div style={{ maxWidth: 1100, margin: "1rem auto 0", padding: "0 1.25rem" }}>
        <AffiliateDisclosure
          textNl={tenant.config?.affiliate?.disclosureText?.nl}
          textEn={tenant.config?.affiliate?.disclosureText?.en}
        />
      </div>

      {/* Page Content */}
      <main style={{ maxWidth: 1100, margin: "2rem auto 3rem", padding: "0 1.25rem" }}>
        {children}
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: "1px solid var(--brand-border, #e2e8f0)",
          background: "#f8fafc",
          padding: "2rem 1.25rem",
          marginTop: "auto",
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2rem", marginBottom: "1.5rem" }}>
            <div style={{ flex: "1 1 200px" }}>
              <div
                style={{
                  fontFamily: "var(--font-heading, Rubik, sans-serif)",
                  fontWeight: 600,
                  fontSize: "0.9375rem",
                  color: "#0f172a",
                  marginBottom: "0.5rem",
                }}
              >
                {siteName}
              </div>
              <p
                style={{
                  fontSize: "0.8125rem",
                  color: "#64748b",
                  lineHeight: 1.6,
                  margin: 0,
                  maxWidth: 260,
                }}
              >
                Onafhankelijke productgidsen voor de Nederlandse en Belgische consument.
              </p>
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <div
                style={{
                  fontFamily: "var(--font-heading, Rubik, sans-serif)",
                  fontWeight: 600,
                  fontSize: "0.8125rem",
                  color: "#334155",
                  marginBottom: "0.625rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Beleid
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                {[
                  ["AI-disclosure", "/ai-disclosure"],
                  ["Privacy", "/privacy"],
                  ["Colofon", "/colofon"],
                ].map(([label, href]) => (
                  <a
                    key={href}
                    href={href}
                    style={{ fontSize: "0.875rem", color: "#64748b", textDecoration: "none" }}
                  >
                    {label}
                  </a>
                ))}
              </div>
            </div>
          </div>
          <div
            style={{
              borderTop: "1px solid #e2e8f0",
              paddingTop: "1rem",
              fontSize: "0.75rem",
              color: "#94a3b8",
            }}
          >
            © {new Date().getFullYear()} {siteName} · Alle rechten voorbehouden
          </div>
        </div>
      </footer>
    </div>
  );
}
