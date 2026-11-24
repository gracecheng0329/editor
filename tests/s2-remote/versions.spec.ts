import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const origin = new URL(process.env.S2_APP_ORIGIN ?? '').origin
const service = new URL(process.env.S2_WORKER_ORIGIN ?? '').origin
const workerAllowedOrigin = new URL(process.env.S2_WORKER_ALLOWED_ORIGIN ?? origin).origin
const ownerState = '.s2-remote/owner.json'
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

test('versions: Cloudflare stores signed milestones in the Postgres index', async ({ browser }) => {
   assert(supabaseUrl && anonKey, 'Remote Supabase public configuration is available')
   const owner = await browser.newContext({ storageState: ownerState, baseURL: origin })
   try {
      const createdDocument = await owner.request.post('/api/documents', {
         headers: { Origin: origin },
         data: { title: `Version index smoke ${new Date().toISOString()}` },
      })
      expect(createdDocument.status()).toBe(201)
      const document = await createdDocument.json()
      const session = await owner.request.get(`/api/documents/${document.id}/sync-session`)
      expect(session.status()).toBe(200)
      const { accessToken } = await session.json()
      assert(typeof accessToken === 'string' && accessToken.length > 100, 'Owner session is valid')

      const operationId = crypto.randomUUID()
      const create = () =>
         owner.request.post(`${service}/documents/${document.id}/versions`, {
            headers: { Origin: workerAllowedOrigin, Authorization: `Bearer ${accessToken}` },
            data: { name: 'Cloudflare Postgres smoke', operationId },
         })
      const created = await create()
      expect(created.status(), await created.text()).toBe(201)
      const version = await created.json()
      expect(version).toMatchObject({
         id: operationId,
         documentId: document.id,
         name: 'Cloudflare Postgres smoke',
         createdBy: document.owner_id,
         sdkVersion: '5.5.2',
      })
      assert(version.snapshot?.store, 'Worker captured the authoritative canvas snapshot')

      const replay = await create()
      expect(replay.status()).toBe(200)
      expect(await replay.json()).toMatchObject({ id: operationId, duplicate: true })

      const headers = { Origin: workerAllowedOrigin, Authorization: `Bearer ${accessToken}` }
      const [list, detail] = await Promise.all([
         owner.request.get(`${service}/documents/${document.id}/versions`, { headers }),
         owner.request.get(`${service}/documents/${document.id}/versions?id=${operationId}`, {
            headers,
         }),
      ])
      expect(list.status()).toBe(200)
      expect((await list.json()).versions).toContainEqual(
         expect.objectContaining({ id: operationId, name: 'Cloudflare Postgres smoke' }),
      )
      expect(detail.status()).toBe(200)
      expect(await detail.json()).toMatchObject({ id: operationId, snapshot: version.snapshot })

      const indexed = await owner.request.post(
         `${supabaseUrl}/rest/v1/rpc/read_document_versions`,
         {
            headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
            data: { target_doc: document.id, version_id: operationId, share_token: null },
         },
      )
      expect(indexed.status()).toBe(200)
      expect(await indexed.json()).toMatchObject({ id: operationId, snapshot: version.snapshot })

      const forged = await owner.request.post(`${supabaseUrl}/rest/v1/rpc/store_document_version`, {
         headers: {
            apikey: anonKey,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
         },
         data: {
            target_key_id: 'acceptance',
            payload_text: JSON.stringify(version),
            signature_hex: '0'.repeat(64),
         },
      })
      expect(forged.ok()).toBe(false)

      mkdirSync('.s2-remote', { recursive: true, mode: 0o700 })
      writeFileSync(
         '.s2-remote/version-index-smoke.json',
         JSON.stringify(
            {
               appCommit: process.env.S2_DEPLOYMENT_COMMIT,
               appOrigin: origin,
               workerAllowedOrigin,
               workerOrigin: service,
               supabaseProject: new URL(supabaseUrl).hostname.split('.')[0],
               date: new Date().toISOString(),
               documentId: document.id,
               versionId: operationId,
               result: 'passed',
               retainedTestDocument: true,
            },
            null,
            2,
         ),
         { mode: 0o600 },
      )
   } finally {
      await owner.close()
   }
})
