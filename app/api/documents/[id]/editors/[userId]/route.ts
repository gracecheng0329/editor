import { fail } from '@/lib/documents'
import { ownerOperation, uuid } from '@/lib/sharing'

export async function DELETE(
   request: Request,
   { params }: { params: Promise<{ id: string; userId: string }> },
) {
   const { id, userId } = await params
   if (!uuid(userId)) return fail('VALIDATION_FAILED', 422)
   return ownerOperation(request, id, 'set_document_editor', { editor_id: userId, enable: false })
}
