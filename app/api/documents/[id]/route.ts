import { NextResponse } from 'next/server';
import { fail, identity, titleFrom } from '@/lib/documents';
import { validOrigin } from '@/lib/http';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { client, user } = await identity();
    if (!user) return fail('UNAUTHENTICATED', 401);
    const { id } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return fail('NOT_FOUND', 404);
    const { data, error } = await client.from('documents').select().eq('id', id).maybeSingle();
    if (error) return fail('SERVICE_UNAVAILABLE', 503);
    return data ? NextResponse.json({ ...data, role: data.owner_id === user.id ? 'owner' : 'editor' }) : fail('NOT_FOUND', 404);
  } catch { return fail('SERVICE_UNAVAILABLE', 503); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!validOrigin(request)) return fail('FORBIDDEN', 403);
  try {
    const { client, user } = await identity();
    if (!user) return fail('UNAUTHENTICATED', 401);
    const title = titleFrom(await request.json().catch(() => null));
    if (!title) return fail('VALIDATION_FAILED', 422);
    const { id } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return fail('NOT_FOUND', 404);
    const { data, error } = await client.from('documents').update({ title }).eq('id', id).eq('owner_id', user.id).select().maybeSingle();
    if (error) return fail('SERVICE_UNAVAILABLE', 503);
    return data ? NextResponse.json(data) : fail('NOT_FOUND', 404);
  } catch { return fail('SERVICE_UNAVAILABLE', 503); }
}
