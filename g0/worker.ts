import { DurableObject } from 'cloudflare:workers'
import { DurableObjectSqliteSyncWrapper, SQLiteSyncStorage, TLSocketRoom } from '@tldraw/sync-core'
import type { TLRecord } from '@tldraw/tlschema'
import type { G0Checkpoint } from '../app/g0/g0-contract'

interface Env {
   ROOMS: DurableObjectNamespace<VerificationRoom>
   G0_TEST_SECRET: string
   G0_ENABLED: string
}

interface Capability {
   room: string
   role: 'owner' | 'editor' | 'viewer'
   generation: number
   exp: number
}

function decode(value: string) {
   return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) =>
      char.charCodeAt(0),
   )
}

async function authorize(request: Request, env: Env, room: string): Promise<Capability | null> {
   const token = new URL(request.url).searchParams.get('token')
   if (!token || token.length > 2048) return null
   try {
      const [payload, signature, extra] = token.split('.')
      if (!payload || !signature || extra !== undefined) return null
      const key = await crypto.subtle.importKey(
         'raw',
         new TextEncoder().encode(env.G0_TEST_SECRET),
         { name: 'HMAC', hash: 'SHA-256' },
         false,
         ['verify'],
      )
      if (
         !(await crypto.subtle.verify(
            'HMAC',
            key,
            decode(signature),
            new TextEncoder().encode(payload),
         ))
      )
         return null
      const claims: Capability = JSON.parse(new TextDecoder().decode(decode(payload)))
      if (
         claims.room !== room ||
         !['owner', 'editor', 'viewer'].includes(claims.role) ||
         !Number.isSafeInteger(claims.generation) ||
         claims.generation < 0 ||
         !Number.isSafeInteger(claims.exp) ||
         claims.exp <= Date.now() / 1000 ||
         claims.exp > Date.now() / 1000 + 360
      )
         return null
      return claims
   } catch {
      return null
   }
}

// Local G0 harness only. It has no token-minting endpoint and is not a production auth service.
const worker = {
   async fetch(request: Request, env: Env) {
      if (env.G0_ENABLED !== '1') return new Response('Not found', { status: 404 })
      const url = new URL(request.url)
      if (url.pathname === '/health') return new Response('g0-ready')
      const match = /^\/rooms\/([a-zA-Z0-9-]{1,80})(?:\/.*)?$/.exec(url.pathname)
      if (!match) return new Response('Not found', { status: 404 })
      if (request.headers.get('Origin') !== 'http://127.0.0.1:3100')
         return new Response('Forbidden', { status: 403 })
      const response = await env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request)
      if (response.status === 101) return response
      const headers = new Headers(response.headers)
      headers.set('Access-Control-Allow-Origin', 'http://127.0.0.1:3100')
      headers.set('Cache-Control', 'no-store')
      return new Response(response.body, { status: response.status, headers })
   },
}

export default worker

export class VerificationRoom extends DurableObject<Env> {
   private room: TLSocketRoom<TLRecord>
   private sqlite: SQLiteSyncStorage<TLRecord>
   private restoring = false

   constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env)
      this.sqlite = new SQLiteSyncStorage({ sql: new DurableObjectSqliteSyncWrapper(ctx.storage) })
      this.room = new TLSocketRoom({ storage: this.sqlite })
      ctx.storage.sql.exec(
         'CREATE TABLE IF NOT EXISTS g0_versions (id TEXT PRIMARY KEY, payload TEXT NOT NULL)',
      )
      ctx.storage.sql.exec(
         'CREATE TABLE IF NOT EXISTS g0_state (id INTEGER PRIMARY KEY CHECK(id = 1), generation INTEGER NOT NULL)',
      )
      ctx.storage.sql.exec('INSERT OR IGNORE INTO g0_state (id, generation) VALUES (1, 0)')
      ctx.storage.sql.exec(
         'CREATE TABLE IF NOT EXISTS g0_restores (id TEXT PRIMARY KEY, version_id TEXT NOT NULL, payload TEXT NOT NULL)',
      )
   }

   private get generation() {
      return this.ctx.storage.sql
         .exec<{ generation: number }>('SELECT generation FROM g0_state WHERE id = 1')
         .one().generation
   }

   private mismatch() {
      return Response.json(
         { code: 'GENERATION_MISMATCH', generation: this.generation },
         { status: 409 },
      )
   }

   private version(id: string): G0Checkpoint | null {
      const row = this.ctx.storage.sql
         .exec<{ payload: string }>('SELECT payload FROM g0_versions WHERE id = ?', id)
         .toArray()[0]
      return row ? JSON.parse(row.payload) : null
   }

   private async checkpoint(): Promise<G0Checkpoint> {
      const captured = this.sqlite.getSnapshot()
      if (!captured.schema) throw new Error('Snapshot schema missing')
      const records = captured.documents.map(({ state }) => state as TLRecord)
      const result: G0Checkpoint = {
         id: crypto.randomUUID(),
         generation: this.generation,
         revision: captured.documentClock ?? 0,
         labels: records
            .filter((record) => record.typeName === 'shape')
            .map((shape) => String(shape.meta.label ?? ''))
            .sort(),
         snapshot: {
            store: Object.fromEntries(records.map((record) => [record.id, record])),
            schema: captured.schema,
         },
      }
      this.ctx.storage.sql.exec(
         'INSERT INTO g0_versions (id, payload) VALUES (?, ?)',
         result.id,
         JSON.stringify(result),
      )
      // SQL writes and the captured revision must be flushed before success is returned.
      await this.ctx.storage.sync()
      return result
   }

   private async restore(request: Request, claims: Capability) {
      if (claims.role !== 'owner') return new Response('Forbidden', { status: 403 })
      let command: { versionId: string; operationId: string }
      try {
         const body = await request.text()
         if (body.length > 4096) return new Response('Invalid command', { status: 400 })
         command = JSON.parse(body)
         if (
            !command ||
            typeof command.versionId !== 'string' ||
            typeof command.operationId !== 'string' ||
            !/^[a-f0-9-]{36}$/.test(command.operationId)
         )
            return new Response('Invalid command', { status: 400 })
      } catch {
         return new Response('Invalid command', { status: 400 })
      }
      const existing = this.ctx.storage.sql
         .exec<{ version_id: string; payload: string }>(
            'SELECT version_id, payload FROM g0_restores WHERE id = ?',
            command.operationId,
         )
         .toArray()[0]
      if (existing) {
         if (existing.version_id !== command.versionId)
            return new Response('Operation ID conflict', { status: 409 })
         await this.ctx.storage.sync()
         return Response.json(JSON.parse(existing.payload))
      }
      if (claims.generation !== this.generation) return this.mismatch()
      if (this.restoring) return new Response('Restore busy', { status: 503 })
      const target = this.version(command.versionId)
      if (!target) return new Response('Not found', { status: 404 })
      this.restoring = true
      try {
         const before = await this.checkpoint()
         const result = {
            operationId: command.operationId,
            generation: this.generation + 1,
            preRestoreId: before.id,
         }
         // Same DO SQLite transaction: canvas, generation, and operation result change together.
         this.ctx.storage.transactionSync(() => {
            this.room.loadSnapshot(target.snapshot)
            this.ctx.storage.sql.exec(
               'UPDATE g0_state SET generation = ? WHERE id = 1',
               result.generation,
            )
            this.ctx.storage.sql.exec(
               'INSERT INTO g0_restores (id, version_id, payload) VALUES (?, ?, ?)',
               command.operationId,
               command.versionId,
               JSON.stringify(result),
            )
         })
         for (const session of this.room.getSessions()) this.room.closeSession(session.sessionId)
         await this.ctx.storage.sync()
         return Response.json(result)
      } finally {
         this.restoring = false
      }
   }

   async fetch(request: Request) {
      const url = new URL(request.url)
      const [, , roomName, operation, versionId] = url.pathname.split('/')
      const claims = await authorize(request, this.env, roomName)
      if (!claims) return new Response('Unauthorized', { status: 401 })
      if (operation === 'restore' && request.method === 'POST') return this.restore(request, claims)
      if (claims.generation !== this.generation) return this.mismatch()
      if (this.restoring) return new Response('Restore busy', { status: 503 })
      if (operation === 'session' && request.method === 'GET')
         return Response.json({ generation: this.generation })
      if (operation === 'snapshots') {
         if (request.method === 'POST' && !versionId) {
            if (claims.role === 'viewer') return new Response('Forbidden', { status: 403 })
            return Response.json(await this.checkpoint())
         }
         if (request.method === 'GET' && versionId) {
            const snapshot = this.version(versionId)
            return snapshot ? Response.json(snapshot) : new Response('Not found', { status: 404 })
         }
         return new Response('Method not allowed', { status: 405 })
      }
      if (operation) return new Response('Not found', { status: 404 })
      const sessionId = url.searchParams.get('sessionId')
      if (
         request.headers.get('Upgrade')?.toLowerCase() !== 'websocket' ||
         !sessionId ||
         sessionId.length > 128
      )
         return new Response('WebSocket required', { status: 400 })
      const { 0: client, 1: server } = new WebSocketPair()
      server.accept()
      // Do not give the SDK event listeners: every frame must pass the generation gate first.
      this.room.handleSocketConnect({
         sessionId,
         socket: {
            send: (data) => server.send(data),
            close: (code, reason) => server.close(code, reason),
            get readyState() {
               return server.readyState
            },
         },
         isReadonly: claims.role === 'viewer',
         objectAccess: 'read',
      })
      server.addEventListener('message', (event) => {
         if (
            this.restoring ||
            claims.generation !== this.generation ||
            claims.exp * 1000 <= Date.now()
         ) {
            server.close(1008, 'Stale capability')
            return
         }
         this.room.handleSocketMessage(sessionId, event.data)
      })
      server.addEventListener('error', () => this.room.handleSocketError(sessionId))
      const expiry = setTimeout(
         () => server.close(1008, 'Capability expired'),
         claims.exp * 1000 - Date.now(),
      )
      server.addEventListener('close', () => {
         clearTimeout(expiry)
         this.room.handleSocketClose(sessionId)
      })
      return new Response(null, { status: 101, webSocket: client })
   }
}
