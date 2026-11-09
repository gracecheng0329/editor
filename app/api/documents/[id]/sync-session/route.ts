import { NextResponse } from 'next/server'
import { fail, identity } from '@/lib/documents'
import { uuid } from '@/lib/sharing'
import { userDisplayName } from '@/lib/user-display-name'

/** The browser receives its own Auth access token, never an administrative credential. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
   try {
      const { client, user } = await identity()
      if (!user) return fail('UNAUTHENTICATED', 401)
      const { id } = await params
      if (!uuid(id)) return fail('NOT_FOUND', 404)
      const { data, error } = await client.from('documents').select('id').eq('id', id).maybeSingle()
      if (error) return fail('SERVICE_UNAVAILABLE', 503)
      if (!data) return fail('NOT_FOUND', 404)
      const {
         data: { session },
      } = await client.auth.getSession()
      if (!session) return fail('UNAUTHENTICATED', 401)
      const name = userDisplayName(user)
      return NextResponse.json(
         { accessToken: session.access_token, user: { id: user.id, name } },
         { headers: { 'Cache-Control': 'private, no-store' } },
      )
   } catch {
      return fail('SERVICE_UNAVAILABLE', 503)
   }
}
