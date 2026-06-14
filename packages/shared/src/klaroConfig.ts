// Phase 6.4.4 — Klaro! CMP config builder (per-tenant).
//
// Pure logic lives here (the web app has no test harness) so it can be unit
// tested. The layout renders the returned object into `window.klaroConfig`
// before klaro.js loads.
//
// Design: Plausible is cookieless and always-on (required, no consent needed),
// so a tenant that adds nothing gets a CMP that never nags. Optional, consent-
// gated services (PostHog, embedded YouTube, etc.) are declared per-tenant in
// `tenants.config.cmp` and appended — these default to OFF and are toggleable.

const BASE_PURPOSE_LABELS = {
  nl: { analytics: "Analyse (anoniem)" },
  en: { analytics: "Analytics (anonymous)" },
} as const;

/** One optional, consent-gated service a tenant can enable. */
export interface KlaroServiceConfig {
  /** Machine name, e.g. "posthog". Must be unique; "plausible" is reserved. */
  name: string;
  /** Human title shown in the consent dialog. */
  title: string;
  /** Klaro purposes this service belongs to, e.g. ["analytics"]. */
  purposes: string[];
  /** Localised one-liner shown under the service. */
  description?: { nl?: string; en?: string };
  /** Initial opt-in state. Optional services default to false (off). */
  default?: boolean;
  /** Required services cannot be toggled; only true for cookieless ones. */
  required?: boolean;
  /** Cookie name patterns Klaro should clear when consent is withdrawn. */
  cookies?: string[];
}

/** Per-tenant CMP overrides, read from `tenants.config.cmp`. */
export interface TenantCmpConfig {
  /** Extra services beyond the always-on cookieless Plausible base. */
  services?: KlaroServiceConfig[];
  /** Consent-cookie lifetime in days (defaults to 365). */
  cookieExpiresAfterDays?: number;
  /** Per-purpose display labels, merged over the analytics default. */
  purposeLabels?: { nl?: Record<string, string>; en?: Record<string, string> };
}

export interface KlaroConfig {
  version: number;
  elementID: string;
  storageMethod: string;
  storageName: string;
  cookieExpiresAfterDays: number;
  htmlTexts: boolean;
  lang: "nl" | "en";
  translations: Record<string, unknown>;
  services: Array<Record<string, unknown>>;
}

const RESERVED_BASE_NAME = "plausible";

function translationBlock(
  langKey: "nl" | "en",
  extraPurposeLabels: Record<string, string> | undefined,
): Record<string, unknown> {
  const isNl = langKey === "nl";
  return {
    consentModal: {
      title: isNl ? "Cookievoorkeuren" : "Cookie preferences",
      description: isNl
        ? "We gebruiken standaard alleen cookieloze statistieken (Plausible). Aanvullende diensten worden pas geladen na uw toestemming."
        : "By default we only use cookieless analytics (Plausible). Any additional services load only after your consent.",
    },
    acceptAll: isNl ? "Accepteer alles" : "Accept all",
    declineAll: isNl ? "Weiger alles" : "Decline all",
    close: isNl ? "Sluiten" : "Close",
    save: isNl ? "Opslaan" : "Save",
    purposes: { ...BASE_PURPOSE_LABELS[langKey], ...(extraPurposeLabels ?? {}) },
  };
}

function baseService(isNl: boolean): Record<string, unknown> {
  return {
    name: RESERVED_BASE_NAME,
    title: "Plausible Analytics",
    description: isNl
      ? "Cookieloze bezoekersstatistieken. Geen persoonlijke gegevens."
      : "Cookieless visitor statistics. No personal data collected.",
    purposes: ["analytics"],
    // Plausible is cookieless; always allowed, so default=true and required.
    default: true,
    required: true,
  };
}

function mapTenantService(svc: KlaroServiceConfig, isNl: boolean): Record<string, unknown> {
  const description = isNl ? svc.description?.nl : svc.description?.en;
  const mapped: Record<string, unknown> = {
    name: svc.name,
    title: svc.title,
    purposes: svc.purposes,
    // Consent-gated services start OFF and stay toggleable unless declared otherwise.
    default: svc.default ?? false,
    required: svc.required ?? false,
  };
  if (description) mapped.description = description;
  if (svc.cookies && svc.cookies.length > 0) mapped.cookies = svc.cookies;
  return mapped;
}

/**
 * Build the Klaro CMP config for a tenant. `cmp` is the tenant's
 * `config.cmp` block (may be undefined). The cookieless Plausible service is
 * always present and required; tenant services are appended, deduped against
 * the reserved base name so a tenant can never weaken the base.
 */
export function buildKlaroConfig(lang: string, cmp?: TenantCmpConfig): KlaroConfig {
  const isNl = lang.startsWith("nl");
  const langKey: "nl" | "en" = isNl ? "nl" : "en";

  const tenantServices = (cmp?.services ?? [])
    .filter((s) => s.name !== RESERVED_BASE_NAME)
    .map((s) => mapTenantService(s, isNl));

  return {
    version: 1,
    elementID: "klaro",
    storageMethod: "localStorage",
    storageName: "klaro",
    cookieExpiresAfterDays: cmp?.cookieExpiresAfterDays ?? 365,
    htmlTexts: true,
    lang: langKey,
    translations: {
      nl: translationBlock("nl", cmp?.purposeLabels?.nl),
      en: translationBlock("en", cmp?.purposeLabels?.en),
    },
    services: [baseService(isNl), ...tenantServices],
  };
}
