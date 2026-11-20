import { NextResponse } from 'next/server'
import { documentCommentAccess, safeShareToken, validMentionIds, validAnchorUpdates, validCommentAnchor } from '@/lib/document-comments'
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

function noAccess(
   access: Awaited<ReturnType<typeof documentCommentAccess>>,
   shareToken: string | null,
) {
   if (!access.user && !shareToken) return fail('UNAUTHENTICATED', 401)
   return fail('FORBIDDEN', 403)
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
   const { id } = await params
   if (!uuid(id)) return fail('NOT_FOUND', 404)
   const url = new URL(request.url)
   const shareToken = safeShareToken(
      request.headers.get('x-document-share-token') ?? url.searchParams.get('shareToken'),
   )
   try {
      const access = await documentCommentAccess(request, id, shareToken)
      if (!access.role) return noAccess(access, shareToken)
      const { data, error } = await access.client.rpc('get_document_comments', {
         target_doc: id,
         share_token: shareToken,
      })
      if (error) return rpcFailure(error)
      return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
   } catch {
      return fail('SERVICE_UNAVAILABLE', 503)
   }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
   if (!validOrigin(request)) return fail('FORBIDDEN', 403)
   const { id } = await params
   if (!uuid(id)) return fail('NOT_FOUND', 404)
   const input = await request.json().catch(() => null)
   if (!input || typeof input !== 'object') return fail('VALIDATION_FAILED', 422)
   const mentions = validMentionIds(input?.mentions)
   if (!mentions || ['authorId', 'author', 'createdBy', 'resolvedBy', 'resolvedAt'].some((key) => key in (input ?? {})))
      return fail('VALIDATION_FAILED', 422)
   const body = typeof input.body === 'string' ? input.body.trim() : ''
   const anchor = validCommentAnchor(input.anchor)
   const shareToken = safeShareToken(input.shareToken)
   if (!body || body.length > 5000 || !anchor) return fail('VALIDATION_FAILED', 422)

   try {
      const access = await documentCommentAccess(request, id, shareToken)
      if (!access.user || !access.sessionActive) return fail('UNAUTHENTICATED', 401)
      if (!access.role) return fail('FORBIDDEN', 403)
      const { data, error } = await access.client.rpc('write_document_comment', {
         target_doc: id,
         anchor,
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

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
   if (!validOrigin(request)) return fail('FORBIDDEN', 403)
   const { id } = await params
   if (!uuid(id)) return fail('NOT_FOUND', 404)
   const input = await request.json().catch(() => null)
   if (!input || typeof input !== 'object') return fail('VALIDATION_FAILED', 422)
   const updates = validAnchorUpdates(input.updates)
   const shareToken = safeShareToken(input.shareToken)
   if (!updates) return fail('VALIDATION_FAILED', 422)

   try {
      const access = await documentCommentAccess(request, id, shareToken)
      if (!access.user || !access.sessionActive) return fail('FORBIDDEN', 403)
      if (!access.role) return noAccess(access, shareToken)
      const { data, error } = await access.client.rpc('update_document_comment_anchors', {
         target_doc: id,
         updates,
         share_token: shareToken,
      })
      if (error) return rpcFailure(error)
      return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
   } catch {
      return fail('SERVICE_UNAVAILABLE', 503)
   }
}
