import { NextResponse } from 'next/server'
import { documentCommentAccess, safeShareToken, validMentionIds } from '@/lib/document-comments'
import { fail } from '@/lib/documents'
import { validOrigin } from '@/lib/http'
import { uuid } from '@/lib/sharing'

function rpcFailure(error: { code?: string }) {
   if (error.code === 'P0002') return fail('NOT_FOUND', 404)
   if (error.code === '42501') return fail('FORBIDDEN', 403)
   if (['22023', '22P02', '23502', '23514'].includes(error.code ?? ''))
      return fail('VALIDATION_FAILED', 422)
   return fail('SERVICE_UNAVAILABLE', 503)
}

export async function POST(
   request: Request,
   { params }: { params: Promise<{ id: string; threadId: string }> },
) {
   if (!validOrigin(request)) return fail('FORBIDDEN', 403)
   const { id, threadId } = await params
   if (!uuid(id) || !uuid(threadId)) return fail('NOT_FOUND', 404)
   const input = await request.json().catch(() => null)
   if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('VALIDATION_FAILED', 422)
   const mentions = validMentionIds(input.mentions)
   if (!mentions || ['authorId', 'author', 'createdBy', 'resolvedBy', 'resolvedAt'].some((key) => key in (input ?? {})))
      return fail('VALIDATION_FAILED', 422)
   const body = typeof input?.body === 'string' ? input.body.trim() : ''
   const shareToken = safeShareToken(input?.shareToken)
   if (!body || body.length > 5000) return fail('VALIDATION_FAILED', 422)

   try {
      const access = await documentCommentAccess(request, id, shareToken)
      if (!access.user || !access.sessionActive) return fail('UNAUTHENTICATED', 401)
      if (!access.role) return fail('FORBIDDEN', 403)
      const { data, error } = await access.client.rpc('write_document_comment', {
         target_doc: id,
         target_thread: threadId,
         body,
         mention_ids: mentions,
         share_token: shareToken,
      })
      if (error) return rpcFailure(error)
      return NextResponse.json(data, { status: 201, headers: { 'Cache-Control': 'no-store' } })
   } catch {
      return fail('SERVICE_UNAVAILABLE', 503)
   }
}
