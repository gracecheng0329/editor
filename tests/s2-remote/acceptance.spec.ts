import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

const origin = new URL(process.env.S2_APP_ORIGIN ?? '').origin
const service = new URL(process.env.S2_WORKER_ORIGIN ?? '').origin
const directory = '.s2-remote'
const baselineFile = `${directory}/baseline.json`
const ownerState = `${directory}/owner.json`
const editorState = `${directory}/editor.json`
const frontendMode =
   process.env.S2_LOCAL_FRONTEND === '1' ? 'local-development' : 'deployed-production'

async function createDocument(request: APIRequestContext) {
   const response = await request.post('/api/documents', {
      headers: { Origin: origin },
      data: { title: `S2 remote acceptance ${new Date().toISOString()}` },
   })
   expect(response.status(), 'Authenticated document creation').toBe(201)
   return response.json()
}

async function checkpoint(request: APIRequestContext, documentId: string) {
   const session = await request.get(`/api/documents/${documentId}/sync-session`)
   expect(session.status(), 'Formal document authorization').toBe(200)
   expect(session.headers()['cache-control']).toContain('no-store')
   const { accessToken } = await session.json()
   const response = await request.post(`${service}/documents/${documentId}/checkpoint`, {
      headers: { Origin: origin, Authorization: `Bearer ${accessToken}` },
   })
   expect(response.status(), 'Remote durable checkpoint').toBe(200)
   expect(response.headers()['cache-control']).toContain('no-store')
   const result = await response.json()
   assert(typeof result.instanceId === 'string', 'Deploy the Worker with instance identity support')
   return result
}

async function addNode(page: Page, name: string) {
   await page.getByLabel('新增節點名稱').fill(name)
   await page.getByRole('button', { name: '新增節點', exact: true }).click()
}
async function saved(page: Page) {
   await expect(page.getByLabel('保存狀態')).toHaveText('已確認持久化')
}

// Separate real OAuth storage states; no admin key, seeded provider or local service.
test('smoke: real identities collaborate, reject unauthorized access and recover pending changes', async ({
   browser,
}) => {
   const owner = await browser.newContext({ storageState: ownerState, baseURL: origin })
   const editor = await browser.newContext({ storageState: editorState, baseURL: origin })
   const anonymous = await browser.newContext({ baseURL: origin })
   try {
      const document = await createDocument(owner.request)
      const editorDocument = await createDocument(editor.request)
      expect(document.owner_id).not.toBe(editorDocument.owner_id)
      // Before granting access, the second real identity is a stranger.
      expect(
         (await editor.request.get(`/api/documents/${document.id}/sync-session`)).status(),
      ).toBe(404)
      const grant = await owner.request.post(`/api/documents/${document.id}/editors`, {
         headers: { Origin: origin },
         data: { userId: editorDocument.owner_id },
      })
      expect(grant.status()).toBe(200)
      const alice = await owner.newPage()
      const bob = await editor.newPage()
      await Promise.all([
         alice.goto(`/documents/${document.id}`),
         bob.goto(`/documents/${document.id}`),
      ])
      const aSession = await owner.request.get(`/api/documents/${document.id}/sync-session`)
      const bSession = await editor.request.get(`/api/documents/${document.id}/sync-session`)
      expect(aSession.status()).toBe(200)
      expect(bSession.status()).toBe(200)
      const aIdentity = await aSession.json()
      const bIdentity = await bSession.json()
      await expect(alice.getByLabel('協作者')).toContainText(bIdentity.user.name)
      await expect(bob.getByLabel('協作者')).toContainText(aIdentity.user.name)
      await addNode(alice, 'Remote service')
      await expect(bob.getByLabel('畫布節點')).toContainText('Remote service', { timeout: 2000 })
      await bob.getByRole('button', { name: '選取 Remote service', exact: true }).click()
      await expect(alice.getByLabel('選取節點名稱')).toHaveCount(0)
      await bob.getByLabel('選取節點名稱').fill('Edited remotely')
      await expect(alice.getByLabel('畫布節點')).toContainText('Edited remotely', { timeout: 2000 })
      const canvas = alice.getByLabel('文件畫布', { exact: true })
      await Promise.all([
         canvas.scrollIntoViewIfNeeded(),
         bob.getByLabel('文件畫布', { exact: true }).scrollIntoViewIfNeeded(),
      ])
      const bounds = await canvas.boundingBox()
      assert(bounds, 'Canvas has layout bounds')
      let cursorMove = 0
      await expect
         .poll(async () => {
            cursorMove += 1
            await alice.mouse.move(bounds.x + 280 + (cursorMove % 20), bounds.y + 230)
            return bob.locator('.tl-collaborator__cursor').isVisible()
         })
         .toBe(true)
      const bobShape = bob.locator('.tl-shape').filter({ hasText: 'Edited remotely' }).first()
      const aliceShape = alice.locator('.tl-shape').filter({ hasText: 'Edited remotely' }).first()
      const beforeBob = await bobShape.boundingBox()
      const beforeAlice = await aliceShape.boundingBox()
      await alice.mouse.wheel(0, -400)
      await expect.poll(() => aliceShape.boundingBox()).not.toEqual(beforeAlice)
      await expect.poll(() => bobShape.boundingBox()).toEqual(beforeBob)
      await alice.getByRole('button', { name: '選取 Edited remotely', exact: true }).click()
      await Promise.all([
         alice.getByRole('button', { name: '向右移動節點' }).click(),
         bob.getByRole('button', { name: '向右移動節點' }).click(),
      ])
      await expect
         .poll(
            async () =>
               (await alice.getByLabel('畫布節點').textContent()) ===
               (await bob.getByLabel('畫布節點').textContent()),
            { timeout: 5000 },
         )
         .toBe(true)
      await expect(bob.getByLabel('畫布節點').getByRole('listitem')).toHaveCount(1)
      await saved(alice)
      await saved(bob)
      // Failure is injected only at the public HTTP boundary; synchronization remains real.
      await alice.route(`${service}/documents/${document.id}/checkpoint`, (route) =>
         route.fulfill({ status: 503 }),
      )
      await addNode(alice, 'Pending remote node')
      await expect(alice.getByLabel('保存狀態')).not.toHaveText('已確認持久化')
      await expect(bob.getByLabel('畫布節點')).toContainText('Pending remote node', {
         timeout: 2000,
      })
      await expect(alice.getByLabel('保存狀態')).toHaveText('保存失敗／待同步')
      await alice.unroute(`${service}/documents/${document.id}/checkpoint`)
      await saved(alice)
      await bob.getByRole('button', { name: '選取 Pending remote node', exact: true }).click()
      await bob.getByRole('button', { name: '刪除選取節點', exact: true }).click()
      await expect(alice.getByLabel('畫布節點')).not.toContainText('Pending remote node', {
         timeout: 2000,
      })
      await saved(alice)
      const before = await checkpoint(owner.request, document.id)
      const headers = { Origin: origin }
      expect(
         (
            await anonymous.request.post(`${service}/documents/${document.id}/checkpoint`, {
               headers,
            })
         ).status(),
      ).toBe(401)
      const upgrade = {
         ...headers,
         Upgrade: 'websocket',
         Connection: 'Upgrade',
         'Sec-WebSocket-Version': '13',
         'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      }
      expect(
         (
            await anonymous.request.get(
               `${service}/documents/${document.id}?ticket=invalid&sessionId=remote`,
               { headers: upgrade },
            )
         ).status(),
      ).toBe(401)
      const issued = await owner.request.post(`${service}/documents/${document.id}/session`, {
         headers: { ...headers, Authorization: `Bearer ${aIdentity.accessToken}` },
      })
      expect(issued.status()).toBe(200)
      const { ticket } = await issued.json()
      expect(
         (
            await owner.request.get(
               `${service}/documents/${editorDocument.id}?ticket=${encodeURIComponent(ticket)}&sessionId=cross-document`,
               { headers: upgrade },
            )
         ).status(),
      ).toBe(401)
      expect(
         (
            await owner.request.post(`${service}/documents/${document.id}/checkpoint`, {
               headers: {
                  Origin: 'https://untrusted.example',
                  Authorization: `Bearer ${aIdentity.accessToken}`,
               },
            })
         ).status(),
      ).toBe(403)
      const after = await checkpoint(owner.request, document.id)
      expect(after.snapshot.store).toEqual(before.snapshot.store)
      await alice.reload()
      await expect(alice.getByLabel('畫布節點')).toContainText('Edited remotely')
      await expect(alice.getByLabel('畫布節點')).not.toContainText('Pending remote node')
      await saved(alice)
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      writeFileSync(
         `${directory}/collaboration.json`,
         JSON.stringify(
            {
               origin,
               service,
               appCommit: process.env.S2_DEPLOYMENT_COMMIT,
               frontendMode,
               date: new Date().toISOString(),
               documentId: document.id,
               result: 'passed',
               limitations: [
                  'Share viewer result is a separate test',
                  'Remote restart requires prepare and verify',
                  'Checkpoint failure uses browser HTTP fault injection',
               ],
            },
            null,
            2,
         ),
         { mode: 0o600 },
      )
   } finally {
      await Promise.all([owner.close(), editor.close(), anonymous.close()])
   }
})

test('smoke: anonymous and signed-in share viewers see live canvas without edit controls', async ({
   browser,
}) => {
   const owner = await browser.newContext({ storageState: ownerState, baseURL: origin })
   const signedIn = await browser.newContext({ storageState: editorState, baseURL: origin })
   const anonymous = await browser.newContext({ baseURL: origin })
   try {
      const document = await createDocument(owner.request)
      const share = await owner.request.post(`/api/documents/${document.id}/share`, {
         headers: { Origin: origin },
      })
      expect(share.status()).toBe(200)
      const { token } = await share.json()
      assert(typeof token === 'string', 'Share token issued')
      const page = await owner.newPage()
      await page.goto(`/documents/${document.id}`)
      await addNode(page, 'Shared remote node')
      await saved(page)
      for (const context of [anonymous, signedIn]) {
         const viewer = await context.newPage()
         await viewer.goto(`/share#${token}`)
         await expect(viewer.getByText('觀看者・唯讀', { exact: true })).toBeVisible()
         await expect(viewer.getByLabel('文件畫布', { exact: true })).toBeVisible()
         await expect(viewer.getByRole('button', { name: '新增節點', exact: true })).toHaveCount(0)
         await expect(
            viewer.locator('.tl-shape').filter({ hasText: 'Shared remote node' }),
         ).toBeVisible()
         await addNode(page, 'Owner subsequent change')
         await expect(
            viewer.locator('.tl-shape').filter({ hasText: 'Owner subsequent change' }),
         ).toBeVisible({ timeout: 2000 })
         await page
            .getByRole('button', { name: '選取 Owner subsequent change', exact: true })
            .click()
         await page.getByRole('button', { name: '刪除選取節點', exact: true }).click()
         await saved(page)
         expect(
            (
               await context.request.post(
                  `${service}/documents/${document.id}/checkpoint?shareToken=${encodeURIComponent(token)}`,
                  { headers: { Origin: origin } },
               )
            ).status(),
         ).toBe(401)
         await viewer.close()
      }
   } finally {
      await Promise.all([owner.close(), signedIn.close(), anonymous.close()])
   }
})

test('prepare: record confirmed content before remote restart', async ({ browser }) => {
   const context = await browser.newContext({ storageState: ownerState, baseURL: origin })
   const editor = await browser.newContext({ storageState: editorState, baseURL: origin })
   try {
      const document = await createDocument(context.request)
      const editorDocument = await createDocument(editor.request)
      expect(editorDocument.owner_id).not.toBe(document.owner_id)
      const grant = await context.request.post(`/api/documents/${document.id}/editors`, {
         headers: { Origin: origin },
         data: { userId: editorDocument.owner_id },
      })
      expect(grant.status()).toBe(200)
      const page = await context.newPage()
      const peer = await editor.newPage()
      await Promise.all([
         page.goto(`/documents/${document.id}`),
         peer.goto(`/documents/${document.id}`),
      ])
      await addNode(page, 'Survives remote restart')
      await expect(peer.getByLabel('畫布節點')).toContainText('Survives remote restart')
      await peer.getByRole('button', { name: '選取 Survives remote restart', exact: true }).click()
      await peer.getByLabel('選取節點名稱').fill('Edited before restart')
      await peer.getByRole('button', { name: '向右移動節點', exact: true }).click()
      await expect(page.getByLabel('畫布節點')).toContainText('Edited before restart')
      await expect(page.getByLabel('畫布節點')).toContainText('x:140')
      await addNode(peer, 'Created by editor before restart')
      await expect(page.getByLabel('畫布節點')).toContainText('Created by editor before restart')
      await saved(peer)
      await saved(page)
      await addNode(page, 'Deleted before restart')
      await saved(page)
      await page.getByRole('button', { name: '選取 Deleted before restart', exact: true }).click()
      await page.getByRole('button', { name: '刪除選取節點', exact: true }).click()
      await expect(peer.getByLabel('畫布節點')).not.toContainText('Deleted before restart')
      await saved(peer)
      await saved(page)
      const baseline = await checkpoint(context.request, document.id)
      const peerBaseline = await checkpoint(editor.request, document.id)
      expect(peerBaseline.snapshot.store).toEqual(baseline.snapshot.store)
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      writeFileSync(
         baselineFile,
         JSON.stringify(
            {
               origin,
               service,
               documentId: document.id,
               appCommit: process.env.S2_DEPLOYMENT_COMMIT,
               frontendMode,
               ownerId: document.owner_id,
               editorId: editorDocument.owner_id,
               date: new Date().toISOString(),
               ...baseline,
            },
            null,
            2,
         ),
         { mode: 0o600 },
      )
   } finally {
      await Promise.all([context.close(), editor.close()])
   }
})

test('verify: a new remote instance restores the exact confirmed records', async ({ browser }) => {
   test.setTimeout(360_000)
   const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'))
   expect(baseline.origin).toBe(origin)
   expect(baseline.service).toBe(service)
   expect(baseline.appCommit).toBe(process.env.S2_DEPLOYMENT_COMMIT)
   expect(baseline.frontendMode).toBe(frontendMode)
   const context = await browser.newContext({ storageState: ownerState, baseURL: origin })
   const editor = await browser.newContext({ storageState: editorState, baseURL: origin })
   try {
      await expect
         .poll(async () => (await checkpoint(context.request, baseline.documentId)).instanceId, {
            message:
               'Waiting for Cloudflare to replace the room instance without deleting its storage',
            timeout: 330_000,
            intervals: [5000, 10000, 15000],
         })
         .not.toBe(baseline.instanceId)
      const current = await checkpoint(context.request, baseline.documentId)
      expect(current.instanceId, 'Same DO instance: restart has not been established').not.toBe(
         baseline.instanceId,
      )
      expect(current.generation).toBe(baseline.generation)
      expect(current.snapshot.store).toEqual(baseline.snapshot.store)
      for (const [participant, expectedId] of [
         [context, baseline.ownerId],
         [editor, baseline.editorId],
      ] as const) {
         const session = await participant.request.get(
            `/api/documents/${baseline.documentId}/sync-session`,
         )
         expect(session.status()).toBe(200)
         expect((await session.json()).user.id).toBe(expectedId)
         const restored = await checkpoint(participant.request, baseline.documentId)
         expect(restored.snapshot.store).toEqual(baseline.snapshot.store)
         const page = await participant.newPage()
         await page.goto(`/documents/${baseline.documentId}`)
         await expect(page.getByLabel('畫布節點')).toContainText('Edited before restart')
         await expect(page.getByLabel('畫布節點')).toContainText('Created by editor before restart')
         await expect(page.getByLabel('畫布節點')).toContainText('x:140')
         await expect(page.getByLabel('畫布節點')).not.toContainText('Deleted before restart')
         await saved(page)
      }
      writeFileSync(
         `${directory}/recovery.json`,
         JSON.stringify(
            {
               origin,
               service,
               appCommit: baseline.appCommit,
               frontendMode,
               documentId: baseline.documentId,
               previousInstanceId: baseline.instanceId,
               instanceId: current.instanceId,
               date: new Date().toISOString(),
               result: 'passed',
            },
            null,
            2,
         ),
         { mode: 0o600 },
      )
   } finally {
      await Promise.all([context.close(), editor.close()])
   }
})
