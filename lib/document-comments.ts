import { createHash, createHmac, randomUUID } from 'node:crypto'
import { createClient as createSupabaseClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { createClient as createCookieClient } from '@/lib/supabase/server'
import { uuid } from '@/lib/sharing'

export type CommentRole = 'owner' | 'editor' | 'viewer'
export type CommentAccess = {
   client: SupabaseClient
   user: User | null
   accessToken: string | null
   sessionId: string | null
   sessionActive: boolean
   role: CommentRole | null
   shareToken: string | null
}

function publicSupabaseConfig() {
   const url = process.env.NEXT_PUBLIC_SUPABASE_URL
   const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
   if (!url || !anonKey) throw new Error('Supabase environment is not configured')
   return { url, anonKey }
}

function anonymousClient() {
   const { url, anonKey } = publicSupabaseConfig()
   return createSupabaseClient(url, anonKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
   })
}

function clientForBearer(token: string) {
   const { url, anonKey } = publicSupabaseConfig()
   return createSupabaseClient(url, anonKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
   })
}

function bearerToken(request: Request) {
   const match = /^Bearer\s+([^\s]+)$/i.exec(request.headers.get('authorization') ?? '')
   return match?.[1] ?? null
}

function jwtClaims(token: string | null): Record<string, unknown> {
   if (!token) return {}
   try {
      const payload = token.split('.')[1]
      return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
   } catch {
      return {}
   }
}

export function safeShareToken(value: unknown): string | null {
   return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null
}

export async function documentCommentAccess(
   request: Request,
   documentId: string,
   shareTokenValue: unknown,
): Promise<CommentAccess> {
   const shareToken = safeShareToken(shareTokenValue)
   const bearer = bearerToken(request)
   let client: SupabaseClient
   let user: User | null = null
   let accessToken: string | null = null

   if (bearer) {
      client = clientForBearer(bearer)
      const result = await client.auth.getUser(bearer)
      if (!result.error && result.data.user) {
         user = result.data.user
         accessToken = bearer
      } else {
         client = anonymousClient()
      }
   } else {
      client = await createCookieClient()
      const result = await client.auth.getUser()
      if (!result.error && result.data.user) {
         user = result.data.user
         const session = await client.auth.getSession()
         accessToken = session.data.session?.access_token ?? null
      }
   }

   let sessionActive = false
   let role: CommentRole | null = null
   if (user && accessToken) {
      const active = await client.rpc('document_session_active')
      if (active.error) throw active.error
      sessionActive = active.data === true
      if (sessionActive) {
         const document = await client
            .from('documents')
            .select('owner_id')
            .eq('id', documentId)
            .maybeSingle()
         if (document.error) throw document.error
         if (document.data?.owner_id === user.id) role = 'owner'
         else {
            const editor = await client.rpc('is_document_editor', { target_id: documentId })
            if (editor.error) throw editor.error
            if (editor.data === true) role = 'editor'
         }
      }
   }

   if (!role && shareToken) {
      // A valid share capability is independent of a logged-in identity. Use
      // the anonymous client when the current Auth session is absent or stale.
      const lookup = sessionActive ? client : anonymousClient()
      const resolved = await lookup.rpc('resolve_document_share', { share_token: shareToken })
      if (resolved.error) throw resolved.error
      if (resolved.data?.id === documentId) {
         client = lookup
         role = 'viewer'
      }
   }

   const sessionClaim = jwtClaims(accessToken).session_id
   const sessionId = typeof sessionClaim === 'string' ? sessionClaim : null
   return { client, user, accessToken, sessionId, sessionActive, role, shareToken }
}

export function validCommentAnchor(value: unknown) {
   if (!value || typeof value !== 'object') return null
   const anchor = value as Record<string, unknown>
   const point = (item: unknown) => {
      if (!item || typeof item !== 'object') return null
      const value = item as Record<string, unknown>
      if (
         typeof value.x !== 'number' ||
         typeof value.y !== 'number' ||
         !Number.isFinite(value.x) ||
         !Number.isFinite(value.y) ||
         Math.abs(value.x) > 100_000_000 ||
         Math.abs(value.y) > 100_000_000
      )
         return null
      return { x: value.x, y: value.y }
   }

   if (anchor.type === 'world') {
      const world = point(anchor)
      return world ? { type: 'world', ...world } : null
   }
   if (anchor.type === 'object') {
      if (typeof anchor.objectId !== 'string' || anchor.objectId.length < 1 || anchor.objectId.length > 256)
         return null
      const offset = point(anchor.offset)
      const world = point(anchor.world)
      if (!offset || !world) return null
      return { type: 'object', objectId: anchor.objectId, offset, world }
   }
   return null
}

export function validAnchorUpdates(value: unknown) {
   if (!Array.isArray(value) || value.length > 100) return null
   const updates = []
   for (const item of value) {
      if (!item || typeof item !== 'object') return null
      const update = item as Record<string, unknown>
      const world = {
         x: update.worldX,
         y: update.worldY,
      }
      if (
         typeof update.threadId !== 'string' ||
         !uuid(update.threadId) ||
         typeof update.exists !== 'boolean' ||
         typeof world.x !== 'number' ||
         typeof world.y !== 'number' ||
         !Number.isFinite(world.x) ||
         !Number.isFinite(world.y) ||
         Math.abs(world.x) > 100_000_000 ||
         Math.abs(world.y) > 100_000_000
      )
         return null
      updates.push({ threadId: update.threadId, exists: update.exists, worldX: world.x, worldY: world.y })
   }
   return updates
}

export function makeCommentRealtimeTicket(access: CommentAccess, documentId: string) {
   const secret = process.env.SUPABASE_JWT_SECRET
   if (!secret) throw new Error('SUPABASE_JWT_SECRET is not configured')
   if (!access.role || (access.role !== 'viewer' && !access.sessionId))
      throw new Error('A current document session is required')

   const now = Math.floor(Date.now() / 1000)
   const expiresAt = now + (access.role === 'viewer' ? 45 : 300)
   const payload: Record<string, unknown> = {
      iss: 'supabase',
      aud: 'authenticated',
      role: 'authenticated',
      sub: access.user?.id ?? randomUUID(),
      iat: now,
      exp: expiresAt,
      document_id: documentId,
      document_role: access.role,
   }
   if (access.role !== 'viewer') payload.session_id = access.sessionId
   if (access.role === 'viewer' && access.shareToken) {
      payload.share_hash = createHash('sha256').update(access.shareToken).digest('hex')
   }

   const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
   const input = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}`
   const signature = createHmac('sha256', secret).update(input).digest('base64url')
   return { accessToken: `${input}.${signature}`, expiresAt: expiresAt * 1000, role: access.role }
}

export function validMentionIds(value: unknown): string[] | null {
   if (value === undefined) return []
   if (!Array.isArray(value) || value.length > 20 || value.some((id) => typeof id !== 'string' || !uuid(id))) return null
   return [...new Set(value)]
}
