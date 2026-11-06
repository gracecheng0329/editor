import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
   const store = await cookies()
   const url = process.env.NEXT_PUBLIC_SUPABASE_URL
   const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
   if (!url || !anonKey) throw new Error('Supabase environment is not configured')
   return createServerClient(url, anonKey, {
      cookies: {
         getAll: () => store.getAll(),
         setAll(values) {
            try {
               values.forEach(({ name, value, options }) => {
                  store.set(name, value, options)
               })
            } catch {
               // Server Components cannot write cookies; proxy refreshes them before rendering.
            }
         },
      },
   })
}
