// App-runtime DB client. Connects via Supavisor connection pooler (DATABASE_POOL_URL).
// Use this from Next.js Route Handlers and server components.
// For RLS-bypassing operations (agents, migrations), use ./service-client.ts.

import { type PostgresJsDatabase, drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let cached: PostgresJsDatabase<typeof schema> | undefined;

/**
 * Returns the app DB client, lazily instantiated and singletoned per process.
 *
 * The Supavisor pool URL must be set in DATABASE_POOL_URL. This client respects
 * RLS — anon and authenticated user roles will see only what their policies allow.
 *
 * For direct unpooled access (migrations, batch jobs that need session-level
 * features), use the service client instead.
 */
export function getDb(): PostgresJsDatabase<typeof schema> {
  if (cached) return cached;

  const url = process.env.DATABASE_POOL_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_POOL_URL (or DATABASE_URL) must be set. See .env.example.");
  }

  // postgres-js client. `prepare: false` is mandatory for Supavisor transaction-mode pooling.
  const client = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });

  cached = drizzle(client, { schema, logger: process.env.NODE_ENV === "development" });
  return cached;
}

export type Db = ReturnType<typeof getDb>;
