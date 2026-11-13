import { readFile } from 'node:fs/promises'
import { expect, test, type Browser, type Page, type WebSocketRoute } from '@playwright/test'
import { registeredUser } from '../s1/sharing-fixtures'
import { addNode, checkpointRecords, openObjectPanel, selectNode } from '../s2/canvas-fixtures'

const origin = 'http://127.0.0.1:3102'

async function drawStroke(page: Page) {
   const canvas = page.locator('.tl-canvas').first()
   const bounds = await canvas.boundingBox()
   if (!bounds) throw new Error('Canvas drawing surface is not visible')
   const start = { x: bounds.x + 440, y: bounds.y + 300 }
   await page.mouse.move(start.x, start.y)
   await page.mouse.down()
   await page.mouse.move(start.x + 60, start.y + 24, { steps: 6 })
   await page.mouse.move(start.x + 120, start.y + 48, { steps: 6 })
   await page.mouse.up()
}

async function openPair(browser: Browser, withShareLink = false) {
   const owner = await registeredUser(true, 'Offline owner')
   const editor = await registeredUser(true, 'Offline editor')
   const ownerContext = await browser.newContext()
   const editorContext = await browser.newContext()
   let editorOffline = false
   let editorIdentityChecks = 0
   let editorTicketIssues = 0
   const editorSockets: WebSocketRoute[] = []
   try {
      await ownerContext.addCookies(
         owner.browserCookies().map((cookie) => ({ ...cookie, url: origin })),
      )
      await editorContext.addCookies(
         editor.browserCookies().map((cookie) => ({ ...cookie, url: origin })),
      )
      const created = await ownerContext.request.post('/api/documents', {
         headers: { Origin: origin },
         data: { title: 'Offline reconnect' },
      })
      expect(created.status()).toBe(201)
      const document = (await created.json()) as { id: string }
      const granted = await ownerContext.request.post(`/api/documents/${document.id}/editors`, {
         headers: { Origin: origin },
         data: { userId: editor.id },
      })
      expect(granted.status()).toBe(200)
      let shareToken = ''
      if (withShareLink) {
         const share = await owner.client.rpc('set_document_share', {
            target_id: document.id,
            enable: true,
         })
         if (share.error || !share.data?.token) throw new Error('Could not enable test share link')
         shareToken = share.data.token
      }

      const ownerPage = await ownerContext.newPage()
      const editorPage = await editorContext.newPage()
      editorPage.on('request', (request) => {
         if (request.url().includes(`/api/documents/${document.id}/sync-session`))
            editorIdentityChecks += 1
         if (
            request.method() === 'POST' &&
            request.url() === `http://127.0.0.1:8789/documents/${document.id}/session`
         )
            editorTicketIssues += 1
      })
      await editorPage.routeWebSocket('ws://127.0.0.1:8789/**', (client) => {
         if (editorOffline) {
            void client.close()
            return
         }
         const server = client.connectToServer()
         editorSockets.push(client, server)
      })
      await Promise.all([
         ownerPage.goto(`/documents/${document.id}`),
         editorPage.goto(`/documents/${document.id}${shareToken ? `#${shareToken}` : ''}`),
      ])
      await Promise.all([openObjectPanel(ownerPage), openObjectPanel(editorPage)])
      await Promise.all([
         expect(ownerPage.getByLabel('保存狀態')).toHaveText('已確認持久化'),
         expect(editorPage.getByLabel('保存狀態')).toHaveText('已確認持久化'),
      ])

      return {
         owner,
         editor,
         ownerContext,
         editorContext,
         ownerPage,
         editorPage,
         documentId: document.id,
         shareToken,
         editorIdentityChecks: () => editorIdentityChecks,
         editorTicketIssues: () => editorTicketIssues,
         async disconnectEditor() {
            editorOffline = true
            await editorContext.setOffline(true)
            const sockets = editorSockets.splice(0)
            await Promise.all(sockets.map((socket) => socket.close()))
            await expect(editorPage.getByLabel('保存狀態')).toHaveText('離線／待同步')
         },
         async reconnectEditor() {
            editorOffline = false
            await editorContext.setOffline(false)
         },
         async cleanup() {
            await Promise.all([ownerContext.close(), editorContext.close()])
            await Promise.all([owner.cleanup(), editor.cleanup()])
         },
      }
   } catch (error) {
      await Promise.all([ownerContext.close(), editorContext.close()])
      await Promise.all([owner.cleanup(), editor.cleanup()])
      throw error
   }
}

test('offline edits stay local and visible when the editor loses write access before reconnect', async ({
   browser,
}) => {
   test.setTimeout(120_000)
   const pair = await openPair(browser, true)
   try {
      await addNode(pair.ownerPage, 'Saved service')
      await expect(pair.ownerPage.getByLabel('保存狀態')).toHaveText('已確認持久化')
      await expect(pair.editorPage.getByLabel('畫布節點')).toContainText('Saved service')

      await pair.disconnectEditor()
      await addNode(pair.editorPage, 'Private pending service')
      await pair.editorPage.getByLabel('筆畫顏色').selectOption('violet')
      await pair.editorPage.getByRole('button', { name: '自由手繪工具', exact: true }).click()
      await drawStroke(pair.editorPage)
      await expect(pair.editorPage.getByLabel('畫布節點')).toContainText('Private pending service')
      await expect(pair.editorPage.getByLabel('畫布筆畫').getByRole('listitem')).toHaveCount(1)
      await expect(pair.editorPage.getByLabel('保存狀態')).toHaveText('離線／待同步')

      const revoked = await pair.ownerContext.request.delete(
         `/api/documents/${pair.documentId}/editors/${pair.editor.id}`,
         { headers: { Origin: origin } },
      )
      expect(revoked.status()).toBe(200)

      await pair.reconnectEditor()
      await expect(pair.editorPage.getByLabel('待同步內容已保留')).toBeVisible({ timeout: 10_000 })
      await expect(pair.editorPage.getByLabel('待同步內容已保留')).toContainText('寫入資格已失效')
      await expect(
         pair.editorPage.getByRole('button', { name: '下載待同步內容', exact: true }),
      ).toBeVisible()
      await expect(pair.editorPage.getByLabel('畫布節點')).toContainText('Private pending service')
      await expect(pair.editorPage.getByLabel('畫布筆畫').getByRole('listitem')).toHaveCount(1)
      const downloadPromise = pair.editorPage.waitForEvent('download')
      await pair.editorPage.getByRole('button', { name: '下載待同步內容', exact: true }).click()
      const download = await downloadPromise
      expect(download.suggestedFilename()).toBe(`canvas-${pair.documentId}-pending.json`)
      const downloadPath = await download.path()
      if (!downloadPath) throw new Error('The retained canvas download has no local file')
      const retained: {
         snapshot: {
            store: Record<
               string,
               { type: string; props?: Record<string, unknown> }
            >
         }
      } = JSON.parse(await readFile(downloadPath, 'utf8'))
      const retainedRecords = Object.values(retained.snapshot.store)
      expect(
         retainedRecords.some(
            (record) =>
               record.type === 'architecture-node' &&
               record.props?.title === 'Private pending service',
         ),
      ).toBe(true)
      expect(retainedRecords.some((record) => record.type === 'draw')).toBe(true)

      await pair.ownerPage.reload()
      await openObjectPanel(pair.ownerPage)
      await expect(pair.ownerPage.getByLabel('畫布節點')).toContainText('Saved service')
      await expect(pair.ownerPage.getByLabel('畫布節點')).not.toContainText('Private pending service')
      await expect(pair.ownerPage.getByLabel('畫布筆畫').getByRole('listitem')).toHaveCount(0)
   } finally {
      await pair.cleanup()
   }
})

test('same-generation reconnect reauthorizes and merges offline strokes with a peer node', async ({
   browser,
}) => {
   test.setTimeout(120_000)
   const pair = await openPair(browser)
   try {
      await pair.disconnectEditor()
      await addNode(pair.editorPage, 'Offline service')
      await pair.editorPage.getByLabel('筆畫顏色').selectOption('violet')
      await pair.editorPage.getByLabel('筆畫粗細').selectOption('m')
      await pair.editorPage.getByRole('button', { name: '自由手繪工具', exact: true }).click()
      await drawStroke(pair.editorPage)
      await expect(pair.editorPage.getByLabel('保存狀態')).toHaveText('離線／待同步')

      await addNode(pair.ownerPage, 'Online service')
      await expect(pair.ownerPage.getByLabel('保存狀態')).toHaveText('已確認持久化')
      const reconnectStarted = Date.now()
      const identityChecksBeforeReconnect = pair.editorIdentityChecks()
      const ticketsBeforeReconnect = pair.editorTicketIssues()
      await pair.reconnectEditor()
      await expect(pair.editorPage.getByLabel('同步狀態')).toHaveText('已連線', {
         timeout: 10_000,
      })
      expect(Date.now() - reconnectStarted).toBeLessThanOrEqual(10_000)
      expect(pair.editorIdentityChecks()).toBeGreaterThan(identityChecksBeforeReconnect)
      expect(pair.editorTicketIssues()).toBeGreaterThan(ticketsBeforeReconnect)

      const convergenceStarted = Date.now()
      await Promise.all([
         expect(pair.editorPage.getByLabel('畫布節點')).toContainText('Offline service', {
            timeout: 5_000,
         }),
         expect(pair.editorPage.getByLabel('畫布節點')).toContainText('Online service', {
            timeout: 5_000,
         }),
         expect(pair.ownerPage.getByLabel('畫布節點')).toContainText('Offline service', {
            timeout: 5_000,
         }),
         expect(pair.ownerPage.getByLabel('畫布筆畫').getByRole('listitem')).toHaveCount(1, {
            timeout: 5_000,
         }),
      ])
      expect(Date.now() - convergenceStarted).toBeLessThanOrEqual(5_000)
      await expect(pair.editorPage.getByLabel('保存狀態')).toHaveText('已確認持久化', {
         timeout: 10_000,
      })

      await pair.editorPage.reload()
      await openObjectPanel(pair.editorPage)
      await expect(pair.editorPage.getByLabel('畫布節點')).toContainText('Offline service')
      await expect(pair.editorPage.getByLabel('畫布節點')).toContainText('Online service')
      await expect(pair.editorPage.getByLabel('畫布筆畫').getByRole('listitem')).toHaveCount(1)
   } finally {
      await pair.cleanup()
   }
})

test('offline node deletion racing with an online edit leaves no dangling connection binding', async ({
   browser,
}) => {
   test.setTimeout(120_000)
   const pair = await openPair(browser)
   try {
      await addNode(pair.ownerPage, 'Racing service')
      await pair.ownerPage.getByLabel('連線起點', { exact: true }).selectOption({
         label: 'Racing service',
      })
      await pair.ownerPage.getByLabel('新增連線標籤').fill('racing path')
      await pair.ownerPage.getByRole('button', { name: '新增連線', exact: true }).click()
      await expect(pair.editorPage.getByLabel('畫布連線')).toContainText('racing path')
      await expect(pair.ownerPage.getByLabel('保存狀態')).toHaveText('已確認持久化')

      await pair.disconnectEditor()
      await selectNode(pair.editorPage, 'Racing service')
      await pair.editorPage.getByRole('button', { name: '刪除選取節點', exact: true }).click()
      await expect(pair.editorPage.getByLabel('畫布節點')).not.toContainText('Racing service')

      await selectNode(pair.ownerPage, 'Racing service')
      await pair.ownerPage.getByRole('button', { name: '向右移動節點', exact: true }).click()
      await pair.ownerPage.getByRole('button', { name: '選取連線 racing path', exact: true }).click()
      await pair.ownerPage.getByLabel('選取連線標籤').fill('edit survived reconnect')
      await expect(pair.ownerPage.getByLabel('保存狀態')).toHaveText('已確認持久化')

      await pair.reconnectEditor()
      await expect(pair.editorPage.getByLabel('同步狀態')).toHaveText('已連線', {
         timeout: 10_000,
      })
      await expect(pair.ownerPage.getByLabel('畫布節點').getByRole('listitem')).toHaveCount(0, {
         timeout: 5_000,
      })
      await expect(pair.editorPage.getByLabel('畫布節點').getByRole('listitem')).toHaveCount(0, {
         timeout: 5_000,
      })
      await expect(pair.ownerPage.getByLabel('畫布連線')).toContainText(
         'edit survived reconnect',
      )
      await expect(pair.editorPage.getByLabel('畫布連線')).toContainText(
         'edit survived reconnect',
      )
      await expect(pair.ownerPage.getByLabel('畫布連線')).toContainText('世界座標')
      await expect(pair.editorPage.getByLabel('畫布連線')).toContainText('世界座標')
      const records = await checkpointRecords(pair.ownerPage)
      expect(Object.values(records).filter((record) => record.typeName === 'binding')).toHaveLength(0)
   } finally {
      await pair.cleanup()
   }
})

test('a page from an old generation retains its offline document without replaying it', async ({
   browser,
}) => {
   test.setTimeout(120_000)
   const pair = await openPair(browser)
   try {
      await pair.disconnectEditor()
      await addNode(pair.editorPage, 'Old generation service')
      await expect(pair.editorPage.getByLabel('畫布節點')).toContainText('Old generation service')
      const session = (await pair.owner.client.auth.getSession()).data.session
      expect(session).not.toBeNull()
      const control = await fetch('http://127.0.0.1:8790/generation', {
         method: 'POST',
         headers: {
            Authorization: `Bearer ${process.env.SYNC_TEST_SECRET}`,
            'Content-Type': 'application/json',
         },
         body: JSON.stringify({ documentId: pair.documentId, accessToken: session?.access_token }),
      })
      expect(control.status).toBe(200)
      expect(await control.json()).toEqual({ generation: 1 })

      await pair.reconnectEditor()
      await expect(pair.editorPage.getByLabel('待同步內容已保留')).toBeVisible({ timeout: 10_000 })
      await expect(pair.editorPage.getByLabel('待同步內容已保留')).toContainText('畫布世代已變更')
      await expect(pair.editorPage.getByLabel('畫布節點')).toContainText('Old generation service')

      const authoritative = await checkpointRecords(pair.ownerPage)
      expect(
         Object.values(authoritative).some(
            (record) =>
               record.typeName === 'shape' &&
               record.type === 'architecture-node' &&
               record.props.title === 'Old generation service',
         ),
      ).toBe(false)
   } finally {
      await pair.cleanup()
   }
})
