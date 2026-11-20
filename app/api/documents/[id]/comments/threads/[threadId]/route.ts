import { NextResponse } from 'next/server'
import { documentCommentAccess, safeShareToken } from '@/lib/document-comments'
import { fail } from '@/lib/documents'
import { validOrigin } from '@/lib/http'
import { uuid } from '@/lib/sharing'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; threadId: string }> }) {
   if (!validOrigin(request)) return fail('FORBIDDEN', 403)
   const { id, threadId } = await params
   if (!uuid(id) || !uuid(threadId)) return fail('NOT_FOUND', 404)
   const input = await request.json().catch(() => null)
   if (!input || !['open', 'resolved'].includes(input.status) ||
      Object.keys(input).some((key) => !['status', 'shareToken'].includes(key))) return fail('VALIDATION_FAILED', 422)
   const shareToken = safeShareToken(input.shareToken)
   try {
      const access = await documentCommentAccess(request, id, shareToken)
      if (!access.user || !access.sessionActive) return fail('UNAUTHENTICATED', 401)
      if (!access.role) return fail('FORBIDDEN', 403)
      const { data, error } = await access.client.rpc('set_document_comment_status', {
         target_doc: id, target_thread: threadId, next_status: input.status, share_token: shareToken,
      })
      if (error) {
         if (error.code === '42501') return fail('FORBIDDEN', 403)
         if (error.code === 'P0002') return fail('NOT_FOUND', 404)
         if (error.code === '22023') return fail('VALIDATION_FAILED', 422)
         return fail('SERVICE_UNAVAILABLE', 503)
      }
      return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
   } catch {
      return fail('SERVICE_UNAVAILABLE', 503)
   }
}
