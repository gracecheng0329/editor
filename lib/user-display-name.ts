import type { User } from '@supabase/supabase-js'

export function userDisplayName(user: Pick<User, 'user_metadata'>): string {
   const metadata = user.user_metadata
   for (const value of [metadata?.full_name, metadata?.name, metadata?.user_name, metadata?.preferred_username]) {
      if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 80)
   }
   return 'GitHub 使用者'
}
