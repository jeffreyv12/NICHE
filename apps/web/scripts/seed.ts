// Phase 1.2.4 seed script.
// Inserts on a fresh DB:
//   1. main authority tenant (slug='main', kind='main_authority', hostname=PRIMARY_TENANT_HOSTNAME)
//   2. allowed_admins row per email in ADMIN_ALLOWED_EMAILS
//
// Idempotent: re-running won't duplicate rows.
// Run with: pnpm db:seed
//
// Requires DATABASE_URL + ADMIN_ALLOWED_EMAILS + PRIMARY_TENANT_HOSTNAME in env.

import { allowedAdmins, getServiceDb, tenants } from '@nichefinder/db';
import { sql } from 'drizzle-orm';

async function main() {
  const hostname = process.env.PRIMARY_TENANT_HOSTNAME?.trim().toLowerCase();
  if (!hostname) {
    console.error('PRIMARY_TENANT_HOSTNAME is required.');
    process.exit(1);
  }

  const adminCsv = process.env.ADMIN_ALLOWED_EMAILS ?? '';
  const adminEmails = adminCsv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s.includes('@'));

  if (adminEmails.length === 0) {
    console.error('ADMIN_ALLOWED_EMAILS must list at least one email.');
    process.exit(1);
  }

  const db = getServiceDb();

  // 1. main authority tenant — onConflictDoNothing on slug='main'
  console.log(`Seeding main tenant for hostname=${hostname} ...`);
  await db
    .insert(tenants)
    .values({
      slug: 'main',
      kind: 'main_authority',
      hostname,
      isActive: true,
      isPromoted: false,
      config: {
        brand: { name: 'NicheFinder' },
        locale: { primary: 'nl-NL' },
        affiliate: {
          disclosureText: {
            nl: 'Deze pagina bevat affiliate links. Als je via een link iets koopt ontvangen wij een commissie, zonder extra kosten voor jou.',
            en: 'This page contains affiliate links. If you buy something through them we earn a small commission at no extra cost to you.',
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

  // Quick sanity check
  const tenantCount = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from tenants`,
  );
  const adminCount = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from allowed_admins`,
  );
  console.log(
    `Done. tenants=${tenantCount[0]?.count ?? '?'} admins=${adminCount[0]?.count ?? '?'}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
