import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { Miniflare } from 'miniflare'

if (!process.env.G0_TEST_SECRET) throw new Error('G0_TEST_SECRET is required')
const bundle = await build({
   entryPoints: ['g0/worker.ts'],
   bundle: true,
   write: false,
   format: 'esm',
   platform: 'browser',
   target: 'es2022',
   external: ['cloudflare:workers'],
})
const persistence = await mkdtemp(join(tmpdir(), 'editor-g0-'))
const options = {
   modules: true,
   script: bundle.outputFiles[0].text,
   compatibilityDate: '2026-07-01',
   host: '127.0.0.1',
   port: 8787,
   bindings: { G0_ENABLED: '1', G0_TEST_SECRET: process.env.G0_TEST_SECRET },
   durableObjects: { ROOMS: { className: 'VerificationRoom', useSQLite: true } },
   durableObjectsPersist: persistence,
}
let runtime = new Miniflare(options)
let runtimeId = randomUUID()
await runtime.ready
let restarting = false
// Node-side test controller, never served by the Worker or given to the browser.
const controller = createServer(async (request, response) => {
   if (request.headers.authorization !== `Bearer ${process.env.G0_TEST_SECRET}`) {
      response.writeHead(401).end()
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
   controller.listen(8788, '127.0.0.1', resolve)
})
console.log('G0 workerd ready on 127.0.0.1:8787')
for (const signal of ['SIGINT', 'SIGTERM']) {
   process.once(signal, async () => {
      controller.close()
      await runtime.dispose()
      await rm(persistence, { recursive: true, force: true })
      process.exit(0)
   })
}
