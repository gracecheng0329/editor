import { NextResponse } from 'next/server'
import { documentCommentAccess, makeCommentRealtimeTicket, safeShareToken } from '@/lib/document-comments'
import { fail } from '@/lib/documents'
import { validOrigin } from '@/lib/http'
import { uuid } from '@/lib/sharing'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
   if (!validOrigin(request)) return fail('FORBIDDEN', 403)
   const { id } = await params
   if (!uuid(id)) return fail('NOT_FOUND', 404)
   const input = await request.json().catch(() => null)
   const shareToken = safeShareToken(input?.shareToken)
   try {
      const access = await documentCommentAccess(request, id, shareToken)
      if (!access.role) {
         if (!access.user && !shareToken) return fail('UNAUTHENTICATED', 401)
         return fail('FORBIDDEN', 403)
      }
      const ticket = makeCommentRealtimeTicket(access, id)
      return NextResponse.json(ticket, { headers: { 'Cache-Control': 'private, no-store' } })
   } catch {
      return fail('SERVICE_UNAVAILABLE', 503)
   }
}
