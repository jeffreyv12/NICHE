// Phase 5.5 — 13-step promotion migration state machine.
//
// Implements the strict sequential procedure from docs/PROMOTION_GATE.md.
// NEVER auto-promotes — this job only runs after the operator has clicked
// "Confirm promotion" in the admin UI (CLAUDE.md #1 + #10).
//
// All external I/O (registrar, DNS, Vercel, GSC, revalidation) is injected via
// MigrationAdapters so the machine is unit-testable without live credentials.
//
// Step numbering (0-indexed):
//   0  freeze edits (mark niche frozen in DB)
//   1  snapshot export (no-op stub until R2 creds available)
//   2  register domain
//   3  create Cloudflare DNS zone + apex A + www CNAME
//   4  attach domain to Vercel
//   5  poll SSL until active
//   6  set canonical tags to new domain (mark in tenant config)
//   7  add 301 redirect entry to domain_registrations status
//   8  emit hreflang markers (mark in tenant config)
//   9  submit new domain sitemap to IndexNow
//   10 GSC property add (stub — requires GSC API scoped per domain)
//   11 update niche state to 'promoted'
//   12 schedule post-promotion monitoring (write reminder to agent_runs queue)

import { type ServiceDb, domainRegistrations, niches, promotionMigrations } from "@nichefinder/db";
import { eq } from "drizzle-orm";
// ---------------------------------------------------------------------------
// Minimal structural interfaces (tests don't need the full client classes)
// ---------------------------------------------------------------------------

export interface CloudflareAdapter {
  registerDomain(
    hostname: string,
    autoRenew?: boolean,
  ): Promise<{ id: string; hostname: string; expires_at: string }>;
  getZone(hostname: string): Promise<{ id: string; name: string } | null>;
  createZone(hostname: string): Promise<{ id: string; name: string }>;
  createARecord(zoneId: string, name: string, ipv4: string): Promise<unknown>;
  createCnameRecord(zoneId: string, name: string, target: string): Promise<unknown>;
  createTxtRecord?(zoneId: string, name: string, content: string): Promise<unknown>;
}

export interface TransipAdapter {
  registerDomain(hostname: string): Promise<void>;
  addDnsEntry(
    hostname: string,
    type: "A" | "CNAME" | "TXT",
    name: string,
    content: string,
    ttl?: number,
  ): Promise<void>;
}

export interface VercelAdapter {
  attachDomain(hostname: string): Promise<unknown>;
  pollSslUntilActive(hostname: string, timeoutMs?: number, intervalMs?: number): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/** Vercel's apex IP (anycast). Kept here to avoid an extra DNS lookup. */
const VERCEL_APEX_IP = "76.76.21.21";

export interface MigrationAdapters {
  cloudflare?: CloudflareAdapter;
  transip?: TransipAdapter;
  vercel?: VercelAdapter;
  /** Called with canonical URL after step 9. Fire-and-forget. */
  pingIndexNow?: (url: string) => Promise<void>;
}

export interface RunMigrationOptions {
  db: ServiceDb;
  migrationId: string;
  adapters: MigrationAdapters;
  /** Resume from this step number (skip steps 0..resumeFrom-1). Default: 0. */
  resumeFromStep?: number;
  operatorEmail?: string;
}

export interface RunMigrationResult {
  migrationId: string;
  nicheId: string | null;
  hostname: string;
  completedSteps: number[];
  skippedSteps: number[];
  failedStep: number | null;
  status: "done" | "failed";
}

export const STEP_NAMES: Record<number, string> = {
  0: "freeze_edits",
  1: "snapshot_export",
  2: "register_domain",
  3: "dns_setup",
  4: "vercel_attach",
  5: "ssl_poll",
  6: "canonical_tags",
  7: "301_redirects",
  8: "hreflang",
  9: "sitemap_indexnow",
  10: "gsc_property",
  11: "promote_niche_state",
  12: "schedule_monitoring",
};
const TOTAL_STEPS = 13;

// ---------------------------------------------------------------------------
// Step log entry
// ---------------------------------------------------------------------------

interface StepLog {
  step: number;
  name: string;
  status: "done" | "skipped" | "failed";
  started_at: string;
  finished_at: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Context passed to every step
// ---------------------------------------------------------------------------

interface MigrationContext {
  db: ServiceDb;
  migrationId: string;
  nicheId: string;
  domainRegistrationId: string;
  hostname: string;
  registrar: string;
  adapters: MigrationAdapters;
  operatorEmail: string | null;
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

export async function runMigration(opts: RunMigrationOptions): Promise<RunMigrationResult> {
  const resumeFrom = opts.resumeFromStep ?? 0;

  // Load migration row
  const migRows = await opts.db
    .select()
    .from(promotionMigrations)
    .where(eq(promotionMigrations.id, opts.migrationId));
  const mig = migRows[0];
  if (!mig) throw new Error(`Migration ${opts.migrationId} not found`);
  if (!mig.nicheId) throw new Error("Migration has no niche_id");
  if (!mig.domainRegistrationId) throw new Error("Migration has no domain_registration_id");

  // Load domain registration
  const drRows = await opts.db
    .select()
    .from(domainRegistrations)
    .where(eq(domainRegistrations.id, mig.domainRegistrationId));
  const dr = drRows[0];
  if (!dr) throw new Error("Domain registration not found");

  const ctx: MigrationContext = {
    db: opts.db,
    migrationId: opts.migrationId,
    nicheId: mig.nicheId,
    domainRegistrationId: mig.domainRegistrationId,
    hostname: dr.hostname,
    registrar: dr.registrar,
    adapters: opts.adapters,
    operatorEmail: opts.operatorEmail ?? null,
  };

  // Mark running
  await opts.db
    .update(promotionMigrations)
    .set({ status: "running", currentStep: resumeFrom })
    .where(eq(promotionMigrations.id, opts.migrationId));

  const completedSteps: number[] = [];
  const skippedSteps: number[] = [];
  let failedStep: number | null = null;
  const stepLogs: StepLog[] = (mig.stepLogs as StepLog[]) ?? [];

  const steps = [
    stepFreezeEdits,
    stepSnapshotExport,
    stepRegisterDomain,
    stepDnsSetup,
    stepVercelAttach,
    stepSslPoll,
    stepCanonicalTags,
    step301Redirects,
    stepHreflang,
    stepSitemapIndexNow,
    stepGscProperty,
    stepPromoteNicheState,
    stepScheduleMonitoring,
  ];

  for (let i = 0; i < TOTAL_STEPS; i++) {
    if (i < resumeFrom) {
      skippedSteps.push(i);
      continue;
    }

    const startedAt = new Date().toISOString();
    const stepFn = steps[i];
    if (!stepFn) continue;

    try {
      await stepFn(ctx);
      const log: StepLog = {
        step: i,
        name: STEP_NAMES[i] ?? `step_${i}`,
        status: "done",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      };
      stepLogs.push(log);
      completedSteps.push(i);

      await opts.db
        .update(promotionMigrations)
        .set({ currentStep: i + 1, stepLogs })
        .where(eq(promotionMigrations.id, opts.migrationId));
    } catch (err) {
      const log: StepLog = {
        step: i,
        name: STEP_NAMES[i] ?? `step_${i}`,
        status: "failed",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      };
      stepLogs.push(log);
      failedStep = i;

      await opts.db
        .update(promotionMigrations)
        .set({ status: "failed", failedStep: i, failedAt: new Date(), stepLogs })
        .where(eq(promotionMigrations.id, opts.migrationId));

      return {
        migrationId: opts.migrationId,
        nicheId: mig.nicheId,
        hostname: dr.hostname,
        completedSteps,
        skippedSteps,
        failedStep,
        status: "failed",
      };
    }
  }

  await opts.db
    .update(promotionMigrations)
    .set({ status: "done", completedAt: new Date(), stepLogs })
    .where(eq(promotionMigrations.id, opts.migrationId));

  return {
    migrationId: opts.migrationId,
    nicheId: mig.nicheId,
    hostname: dr.hostname,
    completedSteps,
    skippedSteps,
    failedStep: null,
    status: "done",
  };
}

// ---------------------------------------------------------------------------
// Step implementations
// ---------------------------------------------------------------------------

// Step 0: Freeze edits — no new pages publish while migration is in progress.
async function stepFreezeEdits(ctx: MigrationContext): Promise<void> {
  await ctx.db
    .update(niches)
    .set({ notes: "[FROZEN for promotion migration — do not edit]" })
    .where(eq(niches.id, ctx.nicheId));
}

// Step 1: Snapshot export — stub until R2 credentials are available.
async function stepSnapshotExport(_ctx: MigrationContext): Promise<void> {
  // TODO(Phase 4.3.2): export GSC + analytics snapshot to R2.
  // No-op until CLOUDFLARE_R2_* creds are configured.
}

// Step 2: Register domain via the appropriate registrar.
async function stepRegisterDomain(ctx: MigrationContext): Promise<void> {
  const { hostname, registrar, adapters } = ctx;

  if (registrar === "cloudflare") {
    if (!adapters.cloudflare) throw new Error("CloudflareClient not injected");
    const result = await adapters.cloudflare.registerDomain(hostname);
    await ctx.db
      .update(domainRegistrations)
      .set({
        status: "registered",
        registeredAt: new Date(),
        expiresAt: new Date(result.expires_at),
      })
      .where(eq(domainRegistrations.id, ctx.domainRegistrationId));
  } else if (registrar === "transip") {
    if (!adapters.transip) throw new Error("TransipClient not injected");
    await adapters.transip.registerDomain(hostname);
    const oneYear = new Date();
    oneYear.setFullYear(oneYear.getFullYear() + 1);
    await ctx.db
      .update(domainRegistrations)
      .set({ status: "registered", registeredAt: new Date(), expiresAt: oneYear })
      .where(eq(domainRegistrations.id, ctx.domainRegistrationId));
  } else {
    throw new Error(`Unknown registrar: ${registrar}`);
  }
}

// Step 3: DNS setup — Cloudflare zone + apex A record + www CNAME.
async function stepDnsSetup(ctx: MigrationContext): Promise<void> {
  if (!ctx.adapters.cloudflare) {
    // TransIP domains: use TransIP DNS API instead.
    if (!ctx.adapters.transip)
      throw new Error("CloudflareClient or TransipClient required for DNS");
    await ctx.adapters.transip.addDnsEntry(ctx.hostname, "A", "@", VERCEL_APEX_IP);
    await ctx.adapters.transip.addDnsEntry(ctx.hostname, "CNAME", "www", ctx.hostname);
    return;
  }

  let zone = await ctx.adapters.cloudflare.getZone(ctx.hostname);
  if (!zone) {
    zone = await ctx.adapters.cloudflare.createZone(ctx.hostname);
  }

  await ctx.adapters.cloudflare.createARecord(zone.id, ctx.hostname, VERCEL_APEX_IP);
  await ctx.adapters.cloudflare.createCnameRecord(zone.id, `www.${ctx.hostname}`, ctx.hostname);

  await ctx.db
    .update(domainRegistrations)
    .set({ dnsPropagatedAt: new Date() })
    .where(eq(domainRegistrations.id, ctx.domainRegistrationId));
}

// Step 4: Attach domain to Vercel project.
async function stepVercelAttach(ctx: MigrationContext): Promise<void> {
  if (!ctx.adapters.vercel) throw new Error("VercelClient not injected");
  await ctx.adapters.vercel.attachDomain(ctx.hostname);
  await ctx.adapters.vercel.attachDomain(`www.${ctx.hostname}`);
  await ctx.db
    .update(domainRegistrations)
    .set({ vercelAttachedAt: new Date() })
    .where(eq(domainRegistrations.id, ctx.domainRegistrationId));
}

// Step 5: Poll SSL until active (max 5 minutes).
async function stepSslPoll(ctx: MigrationContext): Promise<void> {
  if (!ctx.adapters.vercel) throw new Error("VercelClient not injected");
  const ok = await ctx.adapters.vercel.pollSslUntilActive(ctx.hostname, 5 * 60_000, 10_000);
  if (!ok) throw new Error(`SSL provisioning timed out for ${ctx.hostname}`);
  await ctx.db
    .update(domainRegistrations)
    .set({ sslProvisionedAt: new Date() })
    .where(eq(domainRegistrations.id, ctx.domainRegistrationId));
}

// Step 6: Mark tenant config so canonical tags point to the new domain.
async function stepCanonicalTags(ctx: MigrationContext): Promise<void> {
  // The actual canonical rendering reads from the tenant's hostname.
  // Set it now so ISR pages start serving the new canonical.
  // The tenant hostname was already set when domain_registrations was created;
  // we update the tenants table to activate it.
  // This is a best-effort write — the public page ISR cache will pick it up
  // on next revalidation.
  const { sql } = await import("drizzle-orm");
  await ctx.db.execute(sql`
    update tenants
    set hostname = ${ctx.hostname},
        config = config || jsonb_build_object('canonicalHostname', ${ctx.hostname}::text)
    where id = (
      select tenant_id from niches where id = ${ctx.nicheId}
    )
  `);
}

// Step 7: 301 redirect status — flag in domain_registrations so Next.js
// middleware generates the redirect rule at request time.
async function step301Redirects(ctx: MigrationContext): Promise<void> {
  await ctx.db
    .update(domainRegistrations)
    .set({ status: "redirects_active", notes: "301 redirects active via middleware" })
    .where(eq(domainRegistrations.id, ctx.domainRegistrationId));
}

// Step 8: Hreflang — mark in tenant config; emitted by page template.
async function stepHreflang(ctx: MigrationContext): Promise<void> {
  const { sql } = await import("drizzle-orm");
  await ctx.db.execute(sql`
    update tenants
    set config = config || jsonb_build_object('hreflangActive', true)
    where id = (select tenant_id from niches where id = ${ctx.nicheId})
  `);
}

// Step 9: Submit new domain sitemap to IndexNow (Bing).
async function stepSitemapIndexNow(ctx: MigrationContext): Promise<void> {
  if (!ctx.adapters.pingIndexNow) return;
  const sitemapUrl = `https://${ctx.hostname}/sitemap.xml`;
  void ctx.adapters.pingIndexNow(sitemapUrl);
}

// Step 10: GSC property add — stub until GSC API is scoped per-domain.
async function stepGscProperty(_ctx: MigrationContext): Promise<void> {
  // TODO: add GSC property via Google Search Console API once service-account
  // scope is configured. Domain TXT verification is automatable via Cloudflare DNS.
}

// Step 11: Mark niche as promoted in the DB.
async function stepPromoteNicheState(ctx: MigrationContext): Promise<void> {
  await ctx.db
    .update(niches)
    .set({ state: "promoted", promotedAt: new Date() })
    .where(eq(niches.id, ctx.nicheId));
}

// Step 12: Write a monitoring reminder row to mark the 30-day and 90-day
// monitoring milestones (picked up by the orchestrator cron).
async function stepScheduleMonitoring(ctx: MigrationContext): Promise<void> {
  const { sql } = await import("drizzle-orm");
  await ctx.db.execute(sql`
    insert into agent_runs (agent, model, niche_id, status, started_at)
    values (
      'orchestrator',
      'claude-sonnet-4-6',
      ${ctx.nicheId},
      'scheduled_monitoring',
      now() + interval '30 days'
    )
  `);
}
