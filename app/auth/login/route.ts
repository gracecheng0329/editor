import { requestOrigin } from '@/lib/http';
import { createClient } from '@/lib/supabase/server';
import { NextResponse, type NextRequest } from 'next/server';

function redirect(url: URL | string, status = 307) {
  const response = NextResponse.redirect(url, status);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const client = await createClient();
    const callback = new URL('/auth/callback', requestOrigin(request));
    const next = request.nextUrl.searchParams.get('next');
    if (next) callback.searchParams.set('next', next);
    const { data, error } = await client.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: callback.toString() } });
    if (!error && data.url) return redirect(data.url);
  } catch { /* Present a retryable failure without provider details. */ }
  return redirect(new URL('/?auth=failed', requestOrigin(request)));
}
