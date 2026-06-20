// Phase 1.2.4 seed script.
// Inserts on a fresh DB:
//   1. main authority tenant (slug='main', kind='main_authority', hostname=PRIMARY_TENANT_HOSTNAME)
//   2. allowed_admins row per email in ADMIN_ALLOWED_EMAILS
//
// Idempotent: re-running won't duplicate rows.
// Run with: pnpm db:seed
//
// Requires DATABASE_URL + ADMIN_ALLOWED_EMAILS + PRIMARY_TENANT_HOSTNAME in env.

import {
  allowedAdmins,
  getServiceDb,
  nicheCandidates,
  niches,
  pages,
  tenants,
} from "@nichefinder/db";
import { eq, sql } from "drizzle-orm";

async function main() {
  const hostname = process.env.PRIMARY_TENANT_HOSTNAME?.trim().toLowerCase();
  if (!hostname) {
    console.error("PRIMARY_TENANT_HOSTNAME is required.");
    process.exit(1);
  }

  const adminCsv = process.env.ADMIN_ALLOWED_EMAILS ?? "";
  const adminEmails = adminCsv
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s.includes("@"));

  if (adminEmails.length === 0) {
    console.error("ADMIN_ALLOWED_EMAILS must list at least one email.");
    process.exit(1);
  }

  const db = getServiceDb();

  // 1. main authority tenant — onConflictDoNothing on slug='main'
  console.log(`Seeding main tenant for hostname=${hostname} ...`);
  await db
    .insert(tenants)
    .values({
      slug: "main",
      kind: "main_authority",
      hostname,
      isActive: true,
      isPromoted: false,
      config: {
        brand: { name: "NicheFinder" },
        locale: { primary: "nl-NL" },
        affiliate: {
          disclosureText: {
            nl: "Deze pagina bevat affiliate links. Als je via een link iets koopt ontvangen wij een commissie, zonder extra kosten voor jou.",
            en: "This page contains affiliate links. If you buy something through them we earn a small commission at no extra cost to you.",
          },
        },
      },
    })
    .onConflictDoNothing({ target: tenants.slug });

  // 2. allowed_admins per email
  console.log(`Seeding ${adminEmails.length} admin email(s) ...`);
  for (const email of adminEmails) {
    await db
      .insert(allowedAdmins)
      .values({ email })
      .onConflictDoNothing({ target: allowedAdmins.email });
  }

  // 3. Demo niches + pages for local smoke testing (skipped in production)
  const [mainRow] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(sql`slug = 'main'`)
    .limit(1);
  if (mainRow) {
    await seedDemoData(db, mainRow.id);
  }

  // Quick sanity check
  const tenantCount = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from tenants`,
  );
  const adminCount = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from allowed_admins`,
  );
  console.log(
    `Done. tenants=${tenantCount[0]?.count ?? "?"} admins=${adminCount[0]?.count ?? "?"}`,
  );
}

// ---------------------------------------------------------------------------
// Demo data (local/staging only — never runs in production)
// ---------------------------------------------------------------------------

async function seedDemoData(db: ReturnType<typeof getServiceDb>, mainTenantId: string) {
  const APP_ENV = process.env.APP_ENV ?? "local";
  if (APP_ENV === "production") {
    console.log("Skipping demo data in production.");
    return;
  }

  console.log("Seeding demo niches + pages ...");

  // 3 demo niche candidates in different pipeline states
  const demoNiches = [
    { topic: "Koffiezetapparaten", topicSlug: "koffiezetapparaten", state: "building" as const },
    { topic: "Staande Bureaus", topicSlug: "staande-bureaus", state: "validation" as const },
    {
      topic: "Ergonomische Stoelen",
      topicSlug: "ergonomische-stoelen",
      state: "candidate" as const,
    },
    { topic: "Robot Grasmaaiers", topicSlug: "robot-grasmaaiers", state: "killed" as const },
  ];

  for (const n of demoNiches) {
    // Skip if this topicSlug was already seeded (nicheCandidates has no unique constraint)
    const existing = await db
      .select({ id: nicheCandidates.id })
      .from(nicheCandidates)
      .where(eq(nicheCandidates.topicSlug, n.topicSlug))
      .limit(1);
    if (existing.length > 0) {
      console.log(`  skip ${n.topicSlug} (already seeded)`);
      continue;
    }

    // Insert candidate
    const [candidate] = await db
      .insert(nicheCandidates)
      .values({
        source: "demo_seed",
        topic: n.topic,
        topicSlug: n.topicSlug,
        raw: { demo: true },
        relatedKeywords: [n.topicSlug, `beste-${n.topicSlug}`],
        trademarkCheckState: "clear",
      })
      .returning({ id: nicheCandidates.id });

    if (!candidate) continue;

    // Insert niche — cast needed: Drizzle doesn't expose nullable FK cols in insert type
    // biome-ignore lint/suspicious/noExplicitAny: drizzle FK inference limitation
    const [niche] = (await (db.insert(niches) as any)
      .values({
        tenantId: mainTenantId,
        topic: n.topic,
        topicSlug: n.topicSlug,
        state: n.state,
        killedAt: n.state === "killed" ? new Date() : undefined,
        killReason: n.state === "killed" ? "low_commercial_intent" : undefined,
      })
      .onConflictDoNothing({ target: niches.topicSlug })
      .returning({ id: niches.id })) as [{ id: string } | undefined];

    const nicheId = niche?.id;
    if (!nicheId || n.state !== "building") {
      console.log(`  seeded niche ${n.topicSlug} (${n.state})`);
      continue;
    }

    // Draft page for the 'building' niche only
    await db
      .insert(pages)
      .values({
        tenantId: mainTenantId,
        nicheId,
        slug: `beste-${n.topicSlug}`,
        fullPath: `/test/${n.topicSlug}/beste-${n.topicSlug}`,
        kind: "comparison",
        state: "draft",
        title: `Beste ${n.topic} — Vergelijking & Koopgids`,
        metaDescription: `Ontdek de beste ${n.topic.toLowerCase()} van dit moment. Onze experts testten en vergeleken de topmodellen voor je.`,
        bodyMd: `# Beste ${n.topic}\n\nDit is demo-inhoud gegenereerd door het seed-script. Vervang dit met echte inhoud.\n`,
        bodyHtml: `<h1>Beste ${n.topic}</h1><p>Demo-inhoud.</p>`,
        aiAssisted: true,
      })
      .onConflictDoNothing();

    console.log(`  seeded niche ${n.topicSlug} (${n.state}) + draft page`);
  }

  console.log(`Demo data done (${demoNiches.length} candidates processed).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
