import { NextResponse } from 'next/server'
import { fail, identity, titleFrom } from '@/lib/documents'
import { validOrigin } from '@/lib/http'

export async function POST(request: Request) {
   if (!validOrigin(request)) return fail('FORBIDDEN', 403)
   try {
      const { client, user } = await identity()
      if (!user) return fail('UNAUTHENTICATED', 401)
      const title = titleFrom(await request.json().catch(() => null))
      if (!title) return fail('VALIDATION_FAILED', 422)
      const { data, error } = await client
         .from('documents')
         .insert({ owner_id: user.id, title })
         .select()
         .single()
      if (error) return fail('SERVICE_UNAVAILABLE', 503)
      return NextResponse.json(data, { status: 201 })
   } catch {
      return fail('SERVICE_UNAVAILABLE', 503)
   }
}

export async function GET() {
   try {
      const { client, user } = await identity()
      if (!user) return fail('UNAUTHENTICATED', 401)
      const { data, error } = await client
         .from('documents')
         .select()
         .order('created_at', { ascending: false })
      if (error) return fail('SERVICE_UNAVAILABLE', 503)
      return NextResponse.json(
         data.map((doc) => ({ ...doc, role: doc.owner_id === user.id ? 'owner' : 'editor' })),
      )
   } catch {
      return fail('SERVICE_UNAVAILABLE', 503)
   }
}
