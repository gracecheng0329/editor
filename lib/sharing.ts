import { NextResponse } from 'next/server'
import { fail, identity } from './documents'
import { validOrigin } from './http'

export const uuid = (value: unknown): value is string =>
   typeof value === 'string' &&
   /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

export async function ownerOperation(
   request: Request,
   id: string,
   name: string,
   args: Record<string, unknown>,
) {
   if (!validOrigin(request)) return fail('FORBIDDEN', 403)
   try {
      const { client, user } = await identity()
      if (!user) return fail('UNAUTHENTICATED', 401)
      if (!uuid(id)) return fail('NOT_FOUND', 404)
      const { data, error } = await client.rpc(name, { target_id: id, ...args })
      if (error) {
         if (error.code === 'P0002') return fail('NOT_FOUND', 404)
         if (error.code === '22023') return fail('VALIDATION_FAILED', 422)
         return fail('SERVICE_UNAVAILABLE', 503)
      }
      return NextResponse.json(data)
   } catch {
      return fail('SERVICE_UNAVAILABLE', 503)
   }
}
