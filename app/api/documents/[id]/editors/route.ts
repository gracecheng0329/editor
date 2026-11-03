import { ownerOperation, uuid } from '@/lib/sharing';
import { fail } from '@/lib/documents';

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return ownerOperation(request, (await params).id, 'document_access_settings', {});
}
export async function POST(request: Request, { params }: Context) {
  const body = await request.json().catch(() => null);
  if (!uuid(body?.userId)) return fail('VALIDATION_FAILED', 422);
  return ownerOperation(request, (await params).id, 'set_document_editor', { editor_id: body.userId, enable: true });
}
