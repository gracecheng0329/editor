import { createClient } from '@/lib/supabase/server';
import { NextResponse, type NextRequest } from 'next/server';
import { requestOrigin, validOrigin } from '@/lib/http';

function redirect(url: URL | string, status = 307) {
  const response = NextResponse.redirect(url, status);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return new NextResponse('Forbidden', { status: 403 });
  try {
    const client = await createClient();
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (!error) return redirect(new URL('/', requestOrigin(request)), 303);
  } catch { /* Keep the user on a retryable error state. */ }
  return redirect(new URL('/documents?logout=failed', requestOrigin(request)), 303);
}
