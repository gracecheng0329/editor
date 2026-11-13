import { DurableObject } from 'cloudflare:workers'
import { DurableObjectSqliteSyncWrapper, SQLiteSyncStorage, TLSocketRoom } from '@tldraw/sync-core'
import type { TLRecord } from '@tldraw/tlschema'
import { canvasSchema } from '../packages/canvas/schema'

interface Env {
   ROOMS: DurableObjectNamespace<CanvasRoom>
   SUPABASE_URL: string
   SUPABASE_ANON_KEY: string
   APP_ORIGIN: string
   ROOM_SIGNING_SECRET: string
   TEST_CONTROL_SECRET?: string
   SESSION_LEASE_MS?: string
}
interface Access {
   userId: string
   role: 'owner' | 'editor' | 'viewer'
   expiresAt: number
   roomId: string
   documentId: string
   generation: number
}
const noStore = { 'Cache-Control': 'private, no-store' }
const maxSessionLeaseMs = 60000

function sessionLeaseMs(env: Env) {
   const configured = Number(env.SESSION_LEASE_MS)
   return Number.isFinite(configured) && configured > 0
      ? Math.min(configured, maxSessionLeaseMs)
      : maxSessionLeaseMs
}

async function authorizeShare(
   request: Request,
   env: Env,
   documentId: string,
): Promise<Access | Response> {
   const token = request.headers.get('X-Share-Token')
   if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      return new Response('Not found', { status: 404 })
   const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/resolve_document_share_room`, {
      method: 'POST',
      headers: {
         apikey: env.SUPABASE_ANON_KEY,
         Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
         'Content-Type': 'application/json',
      },
      body: JSON.stringify({ share_token: token }),
   })
   if (!response.ok) return new Response('Authorization unavailable', { status: 503 })
   const room: { id?: string; room_id?: string } | null = await response.json()
   if (
      !room ||
      room.id !== documentId ||
      typeof room.room_id !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(room.room_id)
   )
      return new Response('Not found', { status: 404 })
   return {
      userId: crypto.randomUUID(),
      role: 'viewer',
      expiresAt: Date.now() + sessionLeaseMs(env),
      roomId: room.room_id,
      documentId,
      generation: 0,
   }
}

async function authorize(
   request: Request,
   env: Env,
   documentId: string,
): Promise<Access | Response> {
   if (request.headers.has('X-Share-Token')) return authorizeShare(request, env, documentId)
   const token = request.headers.get('Authorization')?.replace(/^Bearer /, '')
   if (!token || token.length > 8192) return new Response('Unauthorized', { status: 401 })
   const headers = { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
   // Auth verifies the signature/expiry; RLS additionally verifies the live session
   // and document membership, including logged-out access tokens.
   const auth = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers })
   if (!auth.ok) return new Response('Unauthorized', { status: auth.status >= 500 ? 503 : 401 })
   const user: { id: string } = await auth.json()
   const result = await fetch(
      `${env.SUPABASE_URL}/rest/v1/documents?id=eq.${documentId}&select=id,room_id,owner_id`,
      { headers },
   )
   if (!result.ok) return new Response('Authorization unavailable', { status: 503 })
   const documents: { room_id: string; owner_id: string }[] = await result.json()
   if (documents.length !== 1) return new Response('Not found', { status: 404 })
   const expiry = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp
   if (!Number.isFinite(expiry) || expiry * 1000 <= Date.now())
      return new Response('Unauthorized', { status: 401 })
   return {
      userId: user.id,
      role: documents[0].owner_id === user.id ? 'owner' : 'editor',
      expiresAt: Math.min(expiry * 1000, Date.now() + sessionLeaseMs(env)),
      roomId: documents[0].room_id,
      documentId,
      generation: 0,
   }
}

function encode(bytes: Uint8Array) {
   return btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '')
}
function allowedOrigins(env: Env) {
   return env.APP_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
}
function decode(value: string) {
   return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) =>
      char.charCodeAt(0),
   )
}
async function signingKey(env: Env) {
   return crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.ROOM_SIGNING_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
   )
}
async function issueTicket(access: Access, env: Env) {
   const payload = encode(new TextEncoder().encode(JSON.stringify(access)))
   const signature = await crypto.subtle.sign(
      'HMAC',
      await signingKey(env),
      new TextEncoder().encode(payload),
   )
   return `${payload}.${encode(new Uint8Array(signature))}`
}
async function currentSession(
   access: Access,
   env: Env,
): Promise<{ generation: number } | Response> {
   const request = new Request(`http://canvas.internal/documents/${access.documentId}/session`, {
      method: 'POST',
      headers: { 'X-Canvas-Access': JSON.stringify(access) },
   })
   const response = await env.ROOMS.get(env.ROOMS.idFromName(access.roomId)).fetch(request)
   if (!response.ok) return response
   const result = (await response.json()) as { generation?: unknown }
   if (!Number.isSafeInteger(result.generation) || (result.generation as number) < 0)
      return new Response('Invalid room generation', { status: 503 })
   return { generation: result.generation as number }
}
async function verifyTicket(
   request: Request,
   env: Env,
   documentId: string,
): Promise<Access | Response> {
   try {
      const token = new URL(request.url).searchParams.get('ticket') ?? ''
      if (token.length > 2048) throw new Error('Invalid ticket')
      const [payload, signature, extra] = token.split('.')
      if (
         !payload ||
         !signature ||
         extra !== undefined ||
         !(await crypto.subtle.verify(
            'HMAC',
            await signingKey(env),
            decode(signature),
            new TextEncoder().encode(payload),
         ))
      )
         throw new Error('Invalid ticket')
      const access: Access = JSON.parse(new TextDecoder().decode(decode(payload)))
      if (
         access.documentId !== documentId ||
         !['owner', 'editor', 'viewer'].includes(access.role) ||
         !Number.isSafeInteger(access.generation) ||
         access.generation < 0 ||
         !Number.isFinite(access.expiresAt) ||
         access.expiresAt <= Date.now() ||
         access.expiresAt > Date.now() + 60000
      )
         throw new Error('Invalid scope')
      return access
   } catch {
      return new Response('Unauthorized', { status: 401 })
   }
}

const worker = {
   async fetch(request: Request, env: Env) {
      const url = new URL(request.url)
      if (url.pathname === '/health') return new Response('ready', { headers: noStore })
      const generationControl = /^\/__test\/documents\/([0-9a-f-]{36})\/generation$/.exec(
         url.pathname,
      )
      if (generationControl) {
         if (
            !env.TEST_CONTROL_SECRET ||
            request.headers.get('X-Test-Control-Secret') !== env.TEST_CONTROL_SECRET
         )
            return new Response('Not found', { status: 404, headers: noStore })
         if (request.method !== 'POST')
            return new Response('Method not allowed', { status: 405, headers: noStore })
         const access = await authorize(request, env, generationControl[1])
         if (access instanceof Response)
            return new Response(access.body, { status: access.status, headers: noStore })
         if (access.role !== 'owner')
            return new Response('Forbidden', { status: 403, headers: noStore })
         const internal = new Request(
            `http://canvas.internal/documents/${generationControl[1]}/__test/generation`,
            {
               method: 'POST',
               headers: {
                  'X-Canvas-Access': JSON.stringify(access),
                  'X-Test-Control-Secret': env.TEST_CONTROL_SECRET,
               },
            },
         )
         return env.ROOMS.get(env.ROOMS.idFromName(access.roomId)).fetch(internal)
      }
      const match = /^\/documents\/([0-9a-f-]{36})(?:\/(checkpoint|session))?$/.exec(url.pathname)
      const origins = allowedOrigins(env)
      const origin = request.headers.get('Origin')
      // A browser address-bar visit to the session API is a document navigation, not an API call.
      // Send it to the actual document UI; API clients still need POST + auth.
      const isNavigation = request.headers.get('Sec-Fetch-Mode') === 'navigate'
      if (match?.[2] === 'session' && request.method === 'GET' && (isNavigation || !origin)) {
         return new Response(null, {
            status: 302,
            headers: {
               ...noStore,
               Location: new URL(`/documents/${match[1]}`, origins[0]).toString(),
            },
         })
      }
      if (!origin || !origins.includes(origin))
         return new Response('Forbidden', { status: 403, headers: noStore })
      const cors = { ...noStore, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
      if (request.method === 'OPTIONS')
         return new Response(null, {
            status: 204,
         headers: {
               ...cors,
               'Access-Control-Allow-Methods': 'GET, POST',
               'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Share-Token',
            },
         })
      if (!match) return new Response('Not found', { status: 404, headers: cors })
      try {
         let access = await (match[2]
            ? authorize(request, env, match[1])
            : verifyTicket(request, env, match[1]))
         if (access instanceof Response)
            return new Response(access.body, { status: access.status, headers: cors })
         if (match[2] === 'session') {
            if (request.method !== 'POST')
               return new Response('Method not allowed', { status: 405, headers: cors })
            const session = await currentSession(access, env)
            if (session instanceof Response)
               return new Response(session.body, { status: session.status, headers: cors })
            access = { ...access, generation: session.generation }
            return Response.json(
               {
                  ticket: await issueTicket(access, env),
                  generation: access.generation,
                  expiresAt: access.expiresAt,
               },
               { headers: cors },
            )
         }
         if (match[2] === 'checkpoint' && request.method === 'POST') {
            const session = await currentSession(access, env)
            if (session instanceof Response)
               return new Response(session.body, { status: session.status, headers: cors })
            access = { ...access, generation: session.generation }
         }
         // Room identifiers come from the authorized document row, never a client-supplied room.
         const internal = new Request(request)
         internal.headers.set('X-Canvas-Access', JSON.stringify(access))
         const response = await env.ROOMS.get(env.ROOMS.idFromName(access.roomId)).fetch(internal)
         if (response.status === 101)
            return new Response(null, {
               status: 101,
               webSocket: response.webSocket,
               headers: noStore,
            })
         return new Response(response.body, {
            status: response.status,
            headers: { ...Object.fromEntries(response.headers), ...cors },
         })
      } catch {
         return new Response('Service unavailable', { status: 503, headers: cors })
      }
   },
}

export default worker

export class CanvasRoom extends DurableObject<Env> {
   private readonly instanceId = crypto.randomUUID()
   private room: TLSocketRoom<TLRecord>
   private sqlite: SQLiteSyncStorage<TLRecord>
   constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env)
      this.sqlite = new SQLiteSyncStorage({ sql: new DurableObjectSqliteSyncWrapper(ctx.storage) })
      ctx.storage.sql.exec(
         'CREATE TABLE IF NOT EXISTS canvas_state (id INTEGER PRIMARY KEY CHECK(id = 1), generation INTEGER NOT NULL)',
      )
      ctx.storage.sql.exec('INSERT OR IGNORE INTO canvas_state (id, generation) VALUES (1, 0)')
      this.room = new TLSocketRoom({ storage: this.sqlite, schema: canvasSchema })
   }
   async fetch(request: Request) {
      const accessHeader = request.headers.get('X-Canvas-Access')
      if (!accessHeader) return new Response('Unauthorized', { status: 401 })
      const access: Access = JSON.parse(accessHeader)
      const url = new URL(request.url)
      const generation = this.ctx.storage.sql
         .exec<{ generation: number }>('SELECT generation FROM canvas_state WHERE id = 1')
         .one().generation
      if (url.pathname.endsWith('/__test/generation')) {
         if (
            !this.env.TEST_CONTROL_SECRET ||
            request.headers.get('X-Test-Control-Secret') !== this.env.TEST_CONTROL_SECRET
         )
            return new Response('Not found', { status: 404 })
         if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
         if (access.role !== 'owner') return new Response('Forbidden', { status: 403 })
         const nextGeneration = generation + 1
         this.ctx.storage.sql.exec(
            'UPDATE canvas_state SET generation = ? WHERE id = 1',
            nextGeneration,
         )
         return Response.json({ generation: nextGeneration }, { headers: noStore })
      }
      if (url.pathname.endsWith('/session')) {
         if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
         return Response.json({ generation }, { headers: noStore })
      }
      if (access.generation !== generation)
         return Response.json({ code: 'GENERATION_MISMATCH', generation }, { status: 409 })
      if (url.pathname.endsWith('/checkpoint')) {
         if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
         if (access.role === 'viewer')
            return Response.json({ error: 'READ_ONLY' }, { status: 403 })
         // Capture authoritative accepted records before waiting for physical durability.
         // A later local edit cannot be covered by this earlier checkpoint.
         const captured = this.sqlite.getSnapshot()
         const store = Object.fromEntries(captured.documents.map(({ state }) => [state.id, state]))
         await this.ctx.storage.sync()
         return Response.json({
            instanceId: this.instanceId,
            generation,
            revision: captured.documentClock ?? 0,
            snapshot: { store, schema: captured.schema },
         })
      }
      const sessionId = url.searchParams.get('sessionId')
      if (
         request.method !== 'GET' ||
         request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' ||
         !sessionId ||
         sessionId.length > 128
      )
         return new Response('WebSocket required', { status: 400 })
      const { 0: client, 1: server } = new WebSocketPair()
      server.accept()
      this.room.handleSocketConnect({
         sessionId,
         socket: {
            send: (data) => server.send(data),
            close: (code, reason) => server.close(code, reason),
            get readyState() {
               return server.readyState
            },
         },
         isReadonly: access.role === 'viewer',
         objectAccess: 'read',
      })
      server.addEventListener('message', (event) => {
         if (access.expiresAt <= Date.now()) {
            server.close(1008, 'Session expired')
            return
         }
         this.room.handleSocketMessage(sessionId, event.data)
      })
      server.addEventListener('error', () => this.room.handleSocketError(sessionId))
      const expiry = setTimeout(
         () => server.close(1008, 'Session expired'),
         Math.min(access.expiresAt - Date.now(), 2147483647),
      )
      server.addEventListener('close', () => {
         clearTimeout(expiry)
         this.room.handleSocketClose(sessionId)
      })
      return new Response(null, { status: 101, webSocket: client })
   }
}
