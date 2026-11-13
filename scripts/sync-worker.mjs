import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'

if (!process.env.SYNC_TEST_SECRET) throw new Error('SYNC_TEST_SECRET is required')
const bundle = await build({
   entryPoints: ['sync/worker.ts'],
   bundle: true,
   write: false,
   format: 'esm',
   platform: 'browser',
   target: 'es2022',
   external: ['cloudflare:workers'],
})
const persistence = await mkdtemp(join(tmpdir(), 'editor-sync-'))
const options = {
   modules: true,
   script: bundle.outputFiles[0].text,
   compatibilityDate: '2026-07-01',
   host: '127.0.0.1',
   port: 8789,
   bindings: {
      ROOM_SIGNING_SECRET: process.env.SYNC_TEST_SECRET,
      TEST_CONTROL_SECRET: process.env.SYNC_TEST_SECRET,
      SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321',
      SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      APP_ORIGIN: process.env.APP_ORIGIN ?? 'http://127.0.0.1:3102',
      SESSION_LEASE_MS: process.env.SESSION_LEASE_MS ?? '60000',
   },
   durableObjects: { ROOMS: { className: 'CanvasRoom', useSQLite: true } },
   durableObjectsPersist: persistence,
}
let runtime = new Miniflare(options)
let runtimeId = randomUUID()
await runtime.ready
let restarting = false
// Node-side test controller, never served by the Worker or given to the browser.
const controller = createServer(async (request, response) => {
   if (request.headers.authorization !== `Bearer ${process.env.SYNC_TEST_SECRET}`) {
      response.writeHead(401).end()
      return
   }
   if (request.method === 'POST' && request.url === '/generation') {
      try {
         const chunks = []
         for await (const chunk of request) chunks.push(chunk)
         const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
         if (
            typeof body.documentId !== 'string' ||
            !/^[0-9a-f-]{36}$/.test(body.documentId) ||
            typeof body.accessToken !== 'string' ||
            body.accessToken.length > 8192
         ) {
            response.writeHead(400).end('Invalid generation request')
            return
         }
         const result = await fetch(
            `http://127.0.0.1:8789/__test/documents/${body.documentId}/generation`,
            {
               method: 'POST',
               headers: {
                  Origin: options.bindings.APP_ORIGIN,
                  Authorization: `Bearer ${body.accessToken}`,
                  'X-Test-Control-Secret': process.env.SYNC_TEST_SECRET,
               },
            },
         )
         response
            .writeHead(result.status, {
               'Content-Type': result.headers.get('content-type') ?? 'text/plain',
            })
            .end(await result.text())
      } catch {
         response.writeHead(400).end('Invalid generation request')
      }
      return
   }
   if (request.method !== 'POST' || request.url !== '/restart') {
      response.writeHead(404).end()
      return
   }
   if (restarting) {
      response.writeHead(409).end()
      return
   }
   restarting = true
   try {
      const previousRuntimeId = runtimeId
      await runtime.dispose()
      runtime = new Miniflare(options)
      await runtime.ready
      runtimeId = randomUUID()
      response
         .writeHead(200, { 'Content-Type': 'application/json' })
         .end(JSON.stringify({ previousRuntimeId, runtimeId }))
   } catch {
      response.writeHead(500).end('Restart failed')
   } finally {
      restarting = false
   }
})
await new Promise((resolve, reject) => {
   controller.once('error', reject)
   controller.listen(8790, '127.0.0.1', resolve)
})
console.log('Canvas workerd ready on 127.0.0.1:8789')
for (const signal of ['SIGINT', 'SIGTERM']) {
   process.once(signal, async () => {
      controller.close()
      await runtime.dispose()
      await rm(persistence, { recursive: true, force: true })
      process.exit(0)
   })
}
