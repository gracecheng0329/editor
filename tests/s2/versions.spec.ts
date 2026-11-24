import { expect, test } from '@playwright/test'
import { registeredUser } from '../s1/sharing-fixtures'
import { addNode, checkpointRecords, openObjectPanel } from './canvas-fixtures'

async function sessionToken(
   request: import('@playwright/test').APIRequestContext,
   documentId: string,
) {
   const response = await request.get(`/api/documents/${documentId}/sync-session`)
   expect(response.status()).toBe(200)
   return (await response.json()).accessToken as string
}

async function createVersion(
   request: import('@playwright/test').APIRequestContext,
   documentId: string,
   token: string,
   name: string,
   operationId = crypto.randomUUID(),
) {
   return request.post(`http://127.0.0.1:8789/documents/${documentId}/versions`, {
      headers: { Origin: 'http://127.0.0.1:3102', Authorization: `Bearer ${token}` },
      data: { name, operationId },
   })
}

test('milestone contract isolates documents and survives a Durable Object restart', async ({
   browser,
}) => {
   test.setTimeout(45_000)
   const owner = await registeredUser(false)
   const editor = await registeredUser(true)
   const context = await browser.newContext()
   const editorContext = await browser.newContext()
   const viewerContext = await browser.newContext()
   try {
      await context.addCookies(
         owner.browserCookies().map((cookie) => ({ ...cookie, url: 'http://127.0.0.1:3102' })),
      )
      await editorContext.addCookies(
         editor.browserCookies().map((cookie) => ({ ...cookie, url: 'http://127.0.0.1:3102' })),
      )
      const create = () =>
         context.request.post('/api/documents', {
            headers: { Origin: 'http://127.0.0.1:3102' },
            data: { title: 'Version contract' },
         })
      const firstResponse = await create()
      const secondResponse = await editorContext.request.post('/api/documents', {
         headers: { Origin: 'http://127.0.0.1:3102' },
         data: { title: 'Separate owner document' },
      })
      expect(firstResponse.status()).toBe(201)
      expect(secondResponse.status()).toBe(201)
      const first = await firstResponse.json()
      const second = await secondResponse.json()
      const grant = await context.request.post(`/api/documents/${first.id}/editors`, {
         headers: { Origin: 'http://127.0.0.1:3102' },
         data: { userId: editor.id },
      })
      expect(grant.status()).toBe(200)
      const token = await sessionToken(context.request, first.id)
      const editorToken = await sessionToken(editorContext.request, first.id)
      const operationId = crypto.randomUUID()
      const created = await createVersion(
         context.request,
         first.id,
         token,
         'Initial proposal',
         operationId,
      )
      expect(created.status(), await created.text()).toBe(201)
      const version = await created.json()
      expect(version).toMatchObject({
         id: operationId,
         documentId: first.id,
         kind: 'milestone',
         name: 'Initial proposal',
         createdBy: owner.id,
         generation: 0,
         revision: 0,
      })
      expect(version.snapshot).toHaveProperty('schema')
      expect(version.snapshot).toHaveProperty('store')
      const indexed = await owner.client.rpc('read_document_versions', {
         target_doc: first.id,
         version_id: operationId,
         share_token: null,
      })
      expect(indexed.error).toBeNull()
      expect(indexed.data).toMatchObject({
         id: operationId,
         documentId: first.id,
         snapshot: version.snapshot,
      })
      const forgedRpc = await owner.client.rpc('store_document_version', {
         target_key_id: 'local',
         payload_text: JSON.stringify(version),
         signature_hex: '0'.repeat(64),
      })
      expect(forgedRpc.error).not.toBeNull()

      const forged = await context.request.post(
         `http://127.0.0.1:8789/documents/${first.id}/versions`,
         {
            headers: { Origin: 'http://127.0.0.1:3102', Authorization: `Bearer ${token}` },
            data: {
               name: 'Forged',
               operationId: crypto.randomUUID(),
               createdBy: editor.id,
               snapshot: version.snapshot,
            },
         },
      )
      expect(forged.status()).toBe(422)
      const anonymous = await context.request.post(
         `http://127.0.0.1:8789/documents/${first.id}/versions`,
         {
            headers: { Origin: 'http://127.0.0.1:3102' },
            data: { name: 'Anonymous', operationId: crypto.randomUUID() },
         },
      )
      expect(anonymous.status()).toBe(401)

      const replay = await createVersion(
         context.request,
         first.id,
         token,
         'Initial proposal',
         operationId,
      )
      expect(replay.status()).toBe(200)
      expect((await replay.json()).duplicate).toBe(true)
      const conflictingReplay = await createVersion(
         context.request,
         first.id,
         token,
         'Different name',
         operationId,
      )
      expect(conflictingReplay.status()).toBe(409)
      const editorCreated = await createVersion(
         editorContext.request,
         first.id,
         editorToken,
         'Editor milestone',
      )
      expect(editorCreated.status()).toBe(201)
      expect((await editorCreated.json()).createdBy).toBe(editor.id)
      const foreign = await context.request.get(
         `http://127.0.0.1:8789/documents/${second.id}/versions?id=${operationId}`,
         {
            headers: { Origin: 'http://127.0.0.1:3102', Authorization: `Bearer ${token}` },
         },
      )
      expect(foreign.status()).toBe(404)
      const foreignCreate = await createVersion(
         context.request,
         second.id,
         token,
         'Cross-document attempt',
      )
      expect(foreignCreate.status()).toBe(404)

      const restart = await fetch('http://127.0.0.1:8790/restart', {
         method: 'POST',
         headers: { Authorization: `Bearer ${process.env.SYNC_TEST_SECRET}` },
      })
      expect(restart.status).toBe(200)
      const restored = await context.request.get(
         `http://127.0.0.1:8789/documents/${first.id}/versions?id=${operationId}`,
         {
            headers: { Origin: 'http://127.0.0.1:3102', Authorization: `Bearer ${token}` },
         },
      )
      expect(restored.status()).toBe(200)
      expect(await restored.json()).toMatchObject({
         id: operationId,
         name: 'Initial proposal',
         snapshot: version.snapshot,
      })
      const list = await context.request.get(
         `http://127.0.0.1:8789/documents/${first.id}/versions`,
         {
            headers: { Origin: 'http://127.0.0.1:3102', Authorization: `Bearer ${token}` },
         },
      )
      expect(list.status()).toBe(200)
      expect((await list.json()).versions).toHaveLength(2)

      const share = await owner.client.rpc('set_document_share', {
         target_id: first.id,
         enable: true,
      })
      expect(share.error).toBeNull()
      const viewerList = await context.request.get(
         `http://127.0.0.1:8789/documents/${first.id}/versions`,
         { headers: { Origin: 'http://127.0.0.1:3102', 'X-Share-Token': share.data.token } },
      )
      expect(viewerList.status()).toBe(200)
      expect((await viewerList.json()).versions).toHaveLength(2)
      const viewerDetail = await context.request.get(
         `http://127.0.0.1:8789/documents/${first.id}/versions?id=${operationId}`,
         { headers: { Origin: 'http://127.0.0.1:3102', 'X-Share-Token': share.data.token } },
      )
      expect(viewerDetail.status()).toBe(200)
      expect(await viewerDetail.json()).toMatchObject({
         id: operationId,
         snapshot: version.snapshot,
      })
      const viewerCreate = await context.request.post(
         `http://127.0.0.1:8789/documents/${first.id}/versions`,
         {
            headers: { Origin: 'http://127.0.0.1:3102', 'X-Share-Token': share.data.token },
            data: { name: 'Viewer attempt', operationId: crypto.randomUUID() },
         },
      )
      expect(viewerCreate.status()).toBe(403)

      const page = await context.newPage()
      const editorPage = await editorContext.newPage()
      await page.goto(`/documents/${first.id}`)
      await editorPage.goto(`/documents/${first.id}`)
      await openObjectPanel(page)
      await openObjectPanel(editorPage)
      await addNode(page, 'At the milestone')
      await expect(page.getByLabel('保存狀態')).toHaveText('已確認持久化')
      await page.getByRole('button', { name: '版本歷史', exact: true }).click()
      await page.getByLabel('里程碑名稱').fill('Review ready')
      await page.getByRole('button', { name: '建立里程碑', exact: true }).click()
      await expect(page.getByRole('button', { name: /Review ready/ })).toBeVisible()
      await page.getByRole('button', { name: '版本歷史', exact: true }).click()
      await expect(page.getByLabel('版本面板')).toHaveCount(0)
      await openObjectPanel(page)
      await addNode(page, 'After the milestone')
      await expect(page.getByLabel('保存狀態')).toHaveText('已確認持久化')
      await expect(
         editorPage.getByRole('button', { name: '選取 After the milestone', exact: true }),
      ).toBeVisible()
      const liveBeforePreview = await checkpointRecords(page)
      const editorBeforePreview = await checkpointRecords(editorPage)
      expect(editorBeforePreview).toEqual(liveBeforePreview)
      await page.getByRole('button', { name: '版本歷史', exact: true }).click()
      await page.getByRole('button', { name: /Review ready/ }).click()
      await expect(page.getByRole('heading', { name: /版本預覽 · Review ready/ })).toBeVisible()
      await expect(page.locator('.milestone-preview')).toContainText('At the milestone')
      await expect(page.locator('.milestone-preview')).not.toContainText('After the milestone')
      expect(await checkpointRecords(page)).toEqual(liveBeforePreview)
      expect(await checkpointRecords(editorPage)).toEqual(editorBeforePreview)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await openObjectPanel(page)
      await expect(page.getByLabel('畫布節點')).toContainText('After the milestone')

      const viewerPage = await viewerContext.newPage()
      viewerPage.on('pageerror', (error) => console.error('Viewer page error', error.message))
      await viewerPage.goto(`/share#${share.data.token}`)
      await expect(viewerPage.getByText('觀看者・唯讀').first()).toBeVisible()
      await viewerPage.getByRole('button', { name: '版本歷史', exact: true }).click()
      await expect(viewerPage.getByLabel('版本面板')).toContainText('Review ready')
      await viewerPage.getByRole('button', { name: /Review ready/ }).click()
      await expect(
         viewerPage.getByRole('heading', { name: /版本預覽 · Review ready/ }),
      ).toBeVisible()
      await expect(viewerPage.locator('.milestone-preview')).toContainText('At the milestone')
      await expect(viewerPage.locator('.milestone-preview')).not.toContainText(
         'After the milestone',
      )
   } finally {
      await context.close()
      await editorContext.close()
      await viewerContext.close()
      await editor.cleanup()
      await owner.cleanup()
   }
})
