// Service-role DB client. BYPASSES RLS.
//
// Use only:
// - From agent plane (apps/scrapers) for writes
// - From Next.js Route Handlers that have verified admin auth themselves
// - From migration tooling
//
// NEVER import this from a client component. NEVER expose service-role
// connection strings to the browser.

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

let cached: PostgresJsDatabase<typeof schema> | undefined;

/**
 * Returns the service-role DB client (bypasses RLS).
 *
 * Uses DATABASE_URL (direct, unpooled). In Supabase, this connects as the
 * postgres role which has BYPASSRLS by default. Treat every query from this
 * client as security-sensitive.
 */
export function getServiceDb(): PostgresJsDatabase<typeof schema> {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL must be set for service-role client. See .env.example.');
  }

  const client = postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    // Direct connection: prepared statements OK.
    prepare: true,
  });

  cached = drizzle(client, { schema });
  return cached;
}

export type ServiceDb = ReturnType<typeof getServiceDb>;
