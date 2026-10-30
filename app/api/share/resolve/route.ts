import { createClient } from '@/lib/supabase/server';
import { fail } from '@/lib/documents';
import { validOrigin } from '@/lib/http';

export async function POST(request: Request) {
  if (!validOrigin(request)) return fail('FORBIDDEN', 403);
  try {
    const body = await request.json().catch(() => null);
    if (typeof body?.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) return fail('NOT_FOUND', 404);
    const client = await createClient();
    const { data, error } = await client.rpc('resolve_document_share', { share_token: body.token });
    if (error) return fail('SERVICE_UNAVAILABLE', 503);
    return data ? Response.json(data) : fail('NOT_FOUND', 404);
  } catch { return fail('SERVICE_UNAVAILABLE', 503); }
}
