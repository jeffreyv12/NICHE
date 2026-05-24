// Magic-link callback — Supabase redirects here with a `code` query param.
// Exchange it for a session, then redirect to ?next= (default /admin).

import { NextResponse, type NextRequest } from 'next/server';
import { getServerSupabase } from '../../../lib/supabase';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/admin';

  if (!code) {
    return NextResponse.redirect(new URL('/admin/login?error=send_failed', request.url));
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error('[auth] exchangeCodeForSession failed', error);
    return NextResponse.redirect(new URL('/admin/login?error=send_failed', request.url));
  }

  return NextResponse.redirect(new URL(next, request.url));
}
