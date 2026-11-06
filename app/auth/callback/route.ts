import { type NextRequest, NextResponse } from 'next/server'
import { requestOrigin } from '@/lib/http'
import { createClient } from '@/lib/supabase/server'

function safeReturn(value: string | null) {
   if (
      !value?.startsWith('/') ||
      value.startsWith('//') ||
      value.includes('\\') ||
      Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
   )
      return '/documents'
   return value
}
function redirect(url: URL | string, status = 307) {
   const response = NextResponse.redirect(url, status)
   response.headers.set('Cache-Control', 'private, no-store')
   return response
}

export async function GET(request: NextRequest) {
   const code = request.nextUrl.searchParams.get('code')
   if (code && !request.nextUrl.searchParams.has('error')) {
      try {
         const client = await createClient()
         const { error } = await client.auth.exchangeCodeForSession(code)
         if (!error)
            return redirect(
               new URL(
                  safeReturn(request.nextUrl.searchParams.get('next')),
                  requestOrigin(request),
               ),
            )
      } catch {
         /* Show the same retry state for exchange failures. */
      }
   }
   return redirect(new URL('/?auth=failed', requestOrigin(request)))
}
