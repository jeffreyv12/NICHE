// Health check: cheap, side-effect-free DB ping. Used by Vercel deploy gates
// and uptime monitors.

import { NextResponse } from 'next/server';
import { getServiceRoleSupabase } from '../../../lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const startedAt = Date.now();
  try {
    const supabase = getServiceRoleSupabase();
    // count(*) on tenants — small, indexed, no RLS round trip (service role).
    const { error } = await supabase
      .from('tenants')
      .select('id', { count: 'exact', head: true });
    if (error) {
      return NextResponse.json(
        { ok: false, db: 'error', error: error.message, latencyMs: Date.now() - startedAt },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { ok: true, db: 'ok', latencyMs: Date.now() - startedAt },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        db: 'unreachable',
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - startedAt,
      },
      { status: 503 },
    );
  }
}
