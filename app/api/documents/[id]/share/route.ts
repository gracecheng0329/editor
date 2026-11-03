import { ownerOperation } from '@/lib/sharing';

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return ownerOperation(request, id, 'set_document_share', { enable: true });
}
export async function DELETE(request: Request, { params }: Context) {
  const { id } = await params;
  return ownerOperation(request, id, 'set_document_share', { enable: false });
}
