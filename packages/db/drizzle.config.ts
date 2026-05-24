import type { Config } from 'drizzle-kit';

// Drizzle Kit config — used by `pnpm db:generate` (diff a schema change into a
// new SQL migration) and `pnpm db:migrate` (apply pending migrations).
//
// The SQL migrations under ./migrations are the canonical schema.
// ./src/schema.ts mirrors them for type-safe queries from app code.

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  // Loud, deterministic failure — surfaces missing env to the operator
  // before drizzle-kit silently writes a broken config.
  throw new Error(
    'DATABASE_URL is required for drizzle-kit. Copy .env.example to .env.local and fill it in.',
  );
}

export default {
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl },
  // Migrations are hand-written SQL for full control over RLS and triggers.
  // `db:generate` only assists with diffs; review and edit before committing.
  verbose: true,
  strict: true,
} satisfies Config;
