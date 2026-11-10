import { expect, test, type WebSocketRoute } from '@playwright/test'
import { registeredUser } from '../s1/sharing-fixtures'
import { openObjectPanel } from './canvas-fixtures'

test('live canvas retains pending edits while offline and automatically confirms after reconnect', async ({
   browser,
}) => {
   const owner = await registeredUser(false)
   const context = await browser.newContext()
   let offline = false
   const sockets: WebSocketRoute[] = []
   try {
      await context.addCookies(
         owner.browserCookies().map((cookie) => ({ ...cookie, url: 'http://127.0.0.1:3102' })),
      )
      const page = await context.newPage()
      await page.routeWebSocket('ws://127.0.0.1:8789/**', (client) => {
         if (offline) {
            void client.close()
            return
         }
         const server = client.connectToServer()
         sockets.push(client, server)
      })
      const creation = await context.request.post('/api/documents', {
         headers: { Origin: 'http://127.0.0.1:3102' },
         data: { title: 'Pending offline changes' },
      })
      expect(creation.status()).toBe(201)
      const document = await creation.json()
      await page.goto(`/documents/${document.id}`)
      await openObjectPanel(page)
      await expect(page.getByLabel('保存狀態')).toHaveText('已確認持久化')
      offline = true
      await context.setOffline(true)
      await Promise.all(sockets.splice(0).map((socket) => socket.close()))
      await expect(page.getByLabel('保存狀態')).toHaveText('離線／待同步')
      await page.getByLabel('新增節點名稱').fill('Pending service')
      await page.getByRole('button', { name: '新增節點', exact: true }).click()
      await expect(page.getByLabel('畫布節點')).toContainText('Pending service')
      await expect(page.getByLabel('保存狀態')).toHaveText('離線／待同步')
      offline = false
      await context.setOffline(false)
      await expect(page.getByLabel('保存狀態')).toHaveText('已確認持久化', { timeout: 15000 })
      await page.reload()
      await openObjectPanel(page)
      await expect(page.getByLabel('畫布節點')).toContainText('Pending service')
   } finally {
      await context.close()
      await owner.cleanup()
   }
})
