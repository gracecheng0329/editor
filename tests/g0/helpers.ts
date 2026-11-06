import { createHmac, randomUUID } from 'node:crypto'
import { type Browser, expect, type WebSocketRoute } from '@playwright/test'

export function capability(room: string, role: 'owner' | 'editor' | 'viewer', generation = 0) {
   const secret = process.env.G0_TEST_SECRET
   if (!secret) throw new Error('G0_TEST_SECRET is required')
   const payload = Buffer.from(
      JSON.stringify({ room, role, generation, exp: Math.floor(Date.now() / 1000) + 300 }),
   ).toString('base64url')
   return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}

export async function openCollaborator(
   browser: Browser,
   room = randomUUID(),
   role: 'owner' | 'editor' = 'owner',
   generation = 0,
) {
   const context = await browser.newContext()
   const page = await context.newPage()
   let offline = false
   const sockets: WebSocketRoute[] = []
   await page.routeWebSocket('ws://127.0.0.1:8787/**', (client) => {
      if (offline) {
         void client.close()
         return
      }
      const server = client.connectToServer()
      sockets.push(client, server)
   })
   const token = capability(room, role, generation)
   await page.goto(`/g0?room=${room}#${token}`)
   await expect(page.getByLabel('同步狀態')).toHaveText('online')
   return {
      room,
      token,
      context,
      page,
      async disconnect() {
         offline = true
         await context.setOffline(true)
         await Promise.all(sockets.splice(0).map((socket) => socket.close()))
         await expect(page.getByLabel('同步狀態')).toHaveText('offline')
      },
      async reconnect() {
         offline = false
         await context.setOffline(false)
      },
      async add(label: string) {
         await page.getByLabel('新物件標記').fill(label)
         await page.getByRole('button', { name: '新增節點', exact: true }).click()
         await expect(page.getByLabel('節點內容')).toContainText(label)
      },
   }
}
