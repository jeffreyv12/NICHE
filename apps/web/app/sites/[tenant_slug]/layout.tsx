// Per-tenant layout. Reads the tenant config (brand colours, locale) and
// injects CSS variables + lang attr.
// Phase 6.4.4: Klaro! CMP loaded per-tenant with a base config.

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
  locale?: {
    primary?: string;
  };
  affiliate?: {
    disclosureText?: { nl?: string; en?: string };
  };
}

interface TenantRow {
  id: string;
  slug: string;
  config: TenantConfig;
}

async function loadTenant(slug: string): Promise<TenantRow | null> {
  const supabase = getServiceRoleSupabase();
  const { data, error } = await supabase
    .from("tenants")
    .select("id, slug, config")
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

  const cssVars: Record<string, string> = {};
  if (brand.primaryColor) cssVars["--brand-primary"] = brand.primaryColor;
  if (brand.accentColor) cssVars["--brand-accent"] = brand.accentColor;
  if (brand.backgroundColor) cssVars["--brand-bg"] = brand.backgroundColor;
  if (brand.textColor) cssVars["--brand-text"] = brand.textColor;

  // Klaro config must be defined before klaro.js is loaded. We use an inline
  // script + afterInteractive strategy so it runs client-side only.
  const klaroConfig = buildKlaroConfig(lang);

  return (
    <div lang={lang} style={cssVars}>
      {/* Klaro CMP — GDPR/ePrivacy consent (Phase 6.4.4) */}
      <Script id="klaro-config" strategy="beforeInteractive">
        {`window.klaroConfig = ${JSON.stringify(klaroConfig)};`}
      </Script>
      <Script src="https://cdn.kiprotect.com/klaro/latest/klaro.js" strategy="afterInteractive" />
      <AffiliateDisclosure
        textNl={tenant.config?.affiliate?.disclosureText?.nl}
        textEn={tenant.config?.affiliate?.disclosureText?.en}
      />
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "1.5rem 1rem" }}>{children}</main>
      <footer
        style={{
          maxWidth: 960,
          margin: "3rem auto 1rem",
          padding: "1rem",
          fontSize: "0.875rem",
          color: "var(--brand-secondary)",
        }}
      >
        <p>
          <a href="/ai-disclosure">AI-disclosure</a> · <a href="/privacy">Privacy</a> ·{" "}
          <a href="/colofon">Colofon</a>
        </p>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Klaro! base config (self-hosted, configurable per tenant via tenant.config in
// a later iteration). We only load Plausible (cookieless, no consent needed) so
// the consent dialog only fires when optional services are added.
// ---------------------------------------------------------------------------

function buildKlaroConfig(lang: string): object {
  const isNl = lang.startsWith("nl");
  return {
    version: 1,
    elementID: "klaro",
    storageMethod: "localStorage",
    storageName: "klaro",
    cookieExpiresAfterDays: 365,
    htmlTexts: true,
    lang: isNl ? "nl" : "en",
    translations: {
      nl: {
        consentModal: {
          title: "Cookievoorkeuren",
          description:
            "We gebruiken alleen cookieloze statistieken (Plausible). Er worden geen tracking-cookies geplaatst zonder uw toestemming.",
        },
        acceptAll: "Accepteer alles",
        declineAll: "Weiger alles",
        close: "Sluiten",
        save: "Opslaan",
        purposes: {
          analytics: "Analyse (anoniem)",
        },
      },
      en: {
        consentModal: {
          title: "Cookie preferences",
          description:
            "We use cookieless analytics (Plausible). No tracking cookies are set without your consent.",
        },
        acceptAll: "Accept all",
        declineAll: "Decline all",
        close: "Close",
        save: "Save",
        purposes: {
          analytics: "Analytics (anonymous)",
        },
      },
    },
    services: [
      {
        name: "plausible",
        title: "Plausible Analytics",
        description: isNl
          ? "Cookieloze bezoekersstatistieken. Geen persoonlijke gegevens."
          : "Cookieless visitor statistics. No personal data collected.",
        purposes: ["analytics"],
        // Plausible is cookieless; always allowed, so default=true.
        default: true,
        required: true,
      },
    ],
  };
}
