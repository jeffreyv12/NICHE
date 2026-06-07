// Zod-validated env parser. Every server entry point MUST call parseEnv() at
// startup so misconfiguration fails fast and deterministically.
//
// Source of truth for what's expected: .env.example at repo root.
// If you add a variable, add it to BOTH .env.example AND this schema in the same PR.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const url = z.string().url();
const optionalUrl = url.optional();
const optionalNonEmpty = z.string().min(1).optional();

const booleanFromEnv = z
  .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
  .transform((v) => v === "true" || v === "1");

const positiveFloat = z.coerce.number().positive();
const positiveInt = z.coerce.number().int().positive();

// ---------------------------------------------------------------------------
// Main schema
// ---------------------------------------------------------------------------

export const envSchema = z.object({
  // Core
  NODE_ENV: z.enum(["development", "preview", "production", "test"]).default("development"),
  APP_ENV: z.enum(["local", "preview", "staging", "production", "test"]).default("local"),
  PRIMARY_TENANT_HOSTNAME: z.string().min(3),
  NEXT_PUBLIC_APP_URL: url,
  CLAUDE_MONTHLY_BUDGET_EUR: positiveFloat.default(200),
  CLAUDE_PER_CALL_CAP_EUR: positiveFloat.default(2.5),

  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  DATABASE_URL: z.string().min(10),
  DATABASE_POOL_URL: z.string().min(10),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(10),
  ANTHROPIC_BETA_HEADERS: z.string().default("managed-agents-2026-04-01"),
  CLAUDE_MODEL_HAIKU: z.string().default("claude-haiku-4-5-20251001"),
  CLAUDE_MODEL_SONNET: z.string().default("claude-sonnet-4-6"),
  CLAUDE_MODEL_OPUS: z.string().default("claude-opus-4-7"),

  // DataForSEO
  DATAFORSEO_LOGIN: optionalNonEmpty,
  DATAFORSEO_PASSWORD: optionalNonEmpty,
  DATAFORSEO_QUEUE: z.enum(["standard", "live"]).default("standard"),

  // Bol Partner
  BOL_PARTNER_CLIENT_ID: optionalNonEmpty,
  BOL_PARTNER_CLIENT_SECRET: optionalNonEmpty,
  BOL_SUBID_PREFIX: z.string().max(16).default("nf"),
  BOL_SITE_CODE: z.string().max(32).default("nichefinder"),

  // Awin
  AWIN_API_TOKEN: optionalNonEmpty,
  AWIN_PUBLISHER_ID: optionalNonEmpty,

  // Daisycon
  DAISYCON_CLIENT_ID: optionalNonEmpty,
  DAISYCON_CLIENT_SECRET: optionalNonEmpty,
  DAISYCON_PUBLISHER_ID: optionalNonEmpty,

  // Digistore
  DIGISTORE_API_KEY: optionalNonEmpty,
  DIGISTORE_VENDOR: optionalNonEmpty,
  DIGISTORE_IPN_PASSPHRASE: optionalNonEmpty,

  // Impact
  IMPACT_ACCOUNT_SID: optionalNonEmpty,
  IMPACT_AUTH_TOKEN: optionalNonEmpty,

  // Conversion webhooks (Phase 3.2) — the {token} path segment per network.
  // A postback for a network with no configured token is rejected (401).
  // *_SIGNING_SECRET enables HMAC body verification where the network supports
  // it; Digistore reuses DIGISTORE_IPN_PASSPHRASE.
  WEBHOOK_BOL_TOKEN: optionalNonEmpty,
  WEBHOOK_AWIN_TOKEN: optionalNonEmpty,
  WEBHOOK_AWIN_SIGNING_SECRET: optionalNonEmpty,
  WEBHOOK_DAISYCON_TOKEN: optionalNonEmpty,
  WEBHOOK_DIGISTORE_TOKEN: optionalNonEmpty,
  WEBHOOK_IMPACT_TOKEN: optionalNonEmpty,
  WEBHOOK_IMPACT_SIGNING_SECRET: optionalNonEmpty,

  // Cloudflare
  CLOUDFLARE_ACCOUNT_ID: optionalNonEmpty,
  CLOUDFLARE_API_TOKEN: optionalNonEmpty,

  // TransIP
  TRANSIP_LOGIN: optionalNonEmpty,
  TRANSIP_PRIVATE_KEY: optionalNonEmpty,

  // Vercel
  VERCEL_API_TOKEN: optionalNonEmpty,
  VERCEL_TEAM_ID: optionalNonEmpty,
  VERCEL_PROJECT_ID: optionalNonEmpty,

  // SerpAPI (optional fallback)
  SERPAPI_KEY: optionalNonEmpty,

  // Email
  RESEND_API_KEY: optionalNonEmpty,
  EMAIL_FROM: z.string().default("NicheFinder <noreply@example.com>"),

  // Analytics
  NEXT_PUBLIC_POSTHOG_KEY: optionalNonEmpty,
  NEXT_PUBLIC_POSTHOG_HOST: url.default("https://eu.i.posthog.com"),

  // Error tracking
  SENTRY_DSN: optionalUrl,
  SENTRY_AUTH_TOKEN: optionalNonEmpty,
  SENTRY_ORG: optionalNonEmpty,
  SENTRY_PROJECT: optionalNonEmpty,

  // GSC
  GSC_SERVICE_ACCOUNT_JSON: optionalNonEmpty,

  // Notifications
  SLACK_WEBHOOK_URL: optionalUrl,
  DISCORD_WEBHOOK_URL: optionalUrl,

  // IndexNow (Phase 4.4.3) — Bing URL indexing ping. Optional; no-op if unset.
  BING_INDEXNOW_KEY: optionalNonEmpty,

  // Scraper infra
  SCRAPER_USER_AGENT: z.string().default("NicheFinder/1.0 (+https://example.com/about-bot)"),
  SCRAPER_RATE_LIMIT_PER_HOST_RPS: positiveInt.default(1),
  SCRAPER_PROXY_URL: optionalUrl,

  // R2
  CLOUDFLARE_R2_ACCOUNT_ID: optionalNonEmpty,
  CLOUDFLARE_R2_ACCESS_KEY: optionalNonEmpty,
  CLOUDFLARE_R2_SECRET_KEY: optionalNonEmpty,
  CLOUDFLARE_R2_BUCKET_MEDIA: z.string().default("nichefinder-media"),
  CLOUDFLARE_R2_BUCKET_TRACES: z.string().default("nichefinder-agent-traces"),

  // Feature flags
  FEATURE_AUTO_DOMAIN_REGISTRATION: booleanFromEnv.default("false"),
  FEATURE_BATCH_API: booleanFromEnv.default("true"),
  FEATURE_PROMPT_CACHE: booleanFromEnv.default("true"),
  FEATURE_FAKE_TIMERS: booleanFromEnv.default("false"),

  // Admin
  ADMIN_ALLOWED_EMAILS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0 && e.includes("@")),
    ),
});

export type Env = z.infer<typeof envSchema>;

// ---------------------------------------------------------------------------
// parseEnv()
// ---------------------------------------------------------------------------

let cached: Env | undefined;

/**
 * Parses + validates process.env. Caches the result.
 *
 * On validation failure, prints a clear list of missing/invalid keys and exits
 * with code 1. We want this to be loud, deterministic, and unmistakable.
 */
export function parseEnv(): Env {
  if (cached) return cached;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    console.error(
      `\nEnv validation failed (${result.error.issues.length} issue(s)):\n${issues}\n\nCheck .env.local against .env.example.\n`,
    );
    process.exit(1);
  }

  cached = result.data;
  return cached;
}

/** Reset the cached env. Tests only. */
export function _resetEnvCacheForTests(): void {
  cached = undefined;
}
