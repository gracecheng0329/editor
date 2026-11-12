import assert from 'node:assert/strict'
import { expect, test } from '@playwright/test'
import { registeredUser } from '../s1/sharing-fixtures'
import { addNode, openObjectPanel } from './canvas-fixtures'
import { attemptReadOnlyWrite } from './sync-probe'

const origin = 'http://127.0.0.1:3102'
const service = 'http://127.0.0.1:8789'
const upgrade = {
   Origin: origin,
   Upgrade: 'websocket',
   Connection: 'Upgrade',
   'Sec-WebSocket-Version': '13',
   'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
}

function trackRoom(page: import('@playwright/test').Page, documentId: string) {
   const tickets: string[] = []
   const closedAt: number[] = []
   page.on('websocket', (socket) => {
      const url = new URL(socket.url())
      if (url.pathname !== `/documents/${documentId}`) return
      const ticket = url.searchParams.get('ticket')
      if (ticket) tickets.push(ticket)
      socket.on('close', () => closedAt.push(Date.now()))
   })
   return { tickets, closedAt }
}

async function newDocument(context: import('@playwright/test').BrowserContext, title: string) {
   const response = await context.request.post('/api/documents', {
      headers: { Origin: origin },
      data: { title },
   })
   expect(response.status()).toBe(201)
   return response.json() as Promise<{ id: string; title: string }>
}

test('revoked editors lose their live lease, while a valid share token reconnects read-only', async ({
   browser,
   request,
}) => {
   test.setTimeout(120_000)
   const owner = await registeredUser(false, 'Revocation owner')
   const withShare = await registeredUser(true, 'Revoked editor with share')
   const withoutShare = await registeredUser(true, 'Revoked editor without share')
   const ownerContext = await browser.newContext()
   const shareEditorContext = await browser.newContext()
   const privateEditorContext = await browser.newContext()
   try {
      await ownerContext.addCookies(
         owner.browserCookies().map((cookie) => ({ ...cookie, url: origin })),
      )
      await shareEditorContext.addCookies(
         withShare.browserCookies().map((cookie) => ({ ...cookie, url: origin })),
      )
      await privateEditorContext.addCookies(
         withoutShare.browserCookies().map((cookie) => ({ ...cookie, url: origin })),
      )
      const document = await newDocument(ownerContext, 'Editor revocation')
      for (const editor of [withShare, withoutShare]) {
         const granted = await ownerContext.request.post(`/api/documents/${document.id}/editors`, {
            headers: { Origin: origin },
            data: { userId: editor.id },
         })
         expect(granted.status()).toBe(200)
      }
      const share = await owner.client.rpc('set_document_share', {
         target_id: document.id,
         enable: true,
      })
      expect(share.error).toBeNull()
      assert(share.data?.token, 'Expected an active share token')

      const ownerPage = await ownerContext.newPage()
      await ownerPage.goto(`/documents/${document.id}`)
      await openObjectPanel(ownerPage)
      await addNode(ownerPage, 'Orders API')
      await expect(ownerPage.getByLabel('保存狀態')).toHaveText('已確認持久化')

      const sharePage = await shareEditorContext.newPage()
      const privatePage = await privateEditorContext.newPage()
      const shareSockets = trackRoom(sharePage, document.id)
      const privateSockets = trackRoom(privatePage, document.id)
      await Promise.all([
         sharePage.goto(`/documents/${document.id}#${share.data.token}`),
         privatePage.goto(`/documents/${document.id}`),
      ])
      await Promise.all([
         expect(sharePage.getByLabel('同步狀態')).toHaveText('已連線'),
         expect(privatePage.getByLabel('同步狀態')).toHaveText('已連線'),
      ])
      expect(shareSockets.tickets.length).toBeGreaterThan(0)
      expect(privateSockets.tickets.length).toBeGreaterThan(0)

      const staleShareEditorTicket = shareSockets.tickets.at(-1)
      const stalePrivateEditorTicket = privateSockets.tickets.at(-1)
      assert(staleShareEditorTicket && stalePrivateEditorTicket)
      const shareCloseCount = shareSockets.closedAt.length
      const privateCloseCount = privateSockets.closedAt.length
      const revokedAt = Date.now()
      for (const editor of [withShare, withoutShare]) {
         const revoked = await ownerContext.request.delete(
            `/api/documents/${document.id}/editors/${editor.id}`,
            { headers: { Origin: origin } },
         )
         expect(revoked.status()).toBe(200)
      }

      const editorSession = (await withShare.client.auth.getSession()).data.session
      assert(editorSession, 'Expected the revoked editor session to remain in the browser')
      const memberRenewal = await request.post(`${service}/documents/${document.id}/session`, {
         headers: { Origin: origin, Authorization: `Bearer ${editorSession.access_token}` },
      })
      expect(memberRenewal.status()).toBe(404)
      const viewerRenewal = await request.post(`${service}/documents/${document.id}/session`, {
         headers: { Origin: origin, 'X-Share-Token': share.data.token },
      })
      expect(viewerRenewal.status()).toBe(200)
      expect(viewerRenewal.headers()['cache-control']).toContain('no-store')

      await Promise.all([
         expect
            .poll(() => shareSockets.closedAt.length, { timeout: 62_000 })
            .toBeGreaterThan(shareCloseCount),
         expect
            .poll(() => privateSockets.closedAt.length, { timeout: 62_000 })
            .toBeGreaterThan(privateCloseCount),
      ])
      const shareClosedAt = shareSockets.closedAt.at(-1)
      const privateClosedAt = privateSockets.closedAt.at(-1)
      assert(shareClosedAt !== undefined && privateClosedAt !== undefined)
      expect(shareClosedAt - revokedAt).toBeLessThanOrEqual(60_000)
      expect(privateClosedAt - revokedAt).toBeLessThanOrEqual(60_000)

      await expect(sharePage.getByLabel('畫布節點')).toContainText('Orders API')
      await expect(sharePage.getByText('觀看者・唯讀').first()).toBeVisible()
      await expect(sharePage.getByRole('button', { name: '新增節點', exact: true })).toHaveCount(0)
      await expect(privatePage.getByLabel('畫布存取已撤銷')).toBeVisible()
      await expect(privatePage.getByLabel('保存狀態')).toHaveCount(0)

      for (const ticket of [staleShareEditorTicket, stalePrivateEditorTicket]) {
         const denied = await request.get(
            `${service}/documents/${document.id}?ticket=${encodeURIComponent(ticket)}&sessionId=${crypto.randomUUID()}`,
            { headers: upgrade },
         )
         expect(denied.status()).toBe(401)
      }

      await attemptReadOnlyWrite(browser, document.id, share.data.token, 'Unauthorized')

      await addNode(ownerPage, 'Billing API')
      await expect(ownerPage.getByLabel('保存狀態')).toHaveText('已確認持久化')
      await expect(sharePage.getByLabel('畫布節點')).toContainText('Billing API')
      await expect(privatePage.getByLabel('畫布存取已撤銷')).toBeVisible()
      await ownerPage.reload()
      await openObjectPanel(ownerPage)
      await expect(ownerPage.getByLabel('畫布節點')).toContainText('Orders API')
      await expect(ownerPage.getByLabel('畫布節點')).toContainText('Billing API')
      await expect(ownerPage.getByLabel('畫布節點')).not.toContainText('Unauthorized')
   } finally {
      await Promise.all([
         ownerContext.close(),
         shareEditorContext.close(),
         privateEditorContext.close(),
      ])
      await Promise.all([owner.cleanup(), withShare.cleanup(), withoutShare.cleanup()])
   }
})

test('revoking a share token closes its viewer lease without interrupting owner or editor', async ({
   browser,
   request,
}) => {
   test.setTimeout(120_000)
   const owner = await registeredUser(false, 'Share owner')
   const editor = await registeredUser(true, 'Share editor')
   const ownerContext = await browser.newContext()
   const editorContext = await browser.newContext()
   const viewerContext = await browser.newContext()
   try {
      await ownerContext.addCookies(
         owner.browserCookies().map((cookie) => ({ ...cookie, url: origin })),
      )
      await editorContext.addCookies(
         editor.browserCookies().map((cookie) => ({ ...cookie, url: origin })),
      )
      const document = await newDocument(ownerContext, 'Share revocation')
      const granted = await ownerContext.request.post(`/api/documents/${document.id}/editors`, {
         headers: { Origin: origin },
         data: { userId: editor.id },
      })
      expect(granted.status()).toBe(200)
      const share = await owner.client.rpc('set_document_share', {
         target_id: document.id,
         enable: true,
      })
      expect(share.error).toBeNull()
      assert(share.data?.token, 'Expected an active share token')

      const ownerPage = await ownerContext.newPage()
      const editorPage = await editorContext.newPage()
      const viewerPage = await viewerContext.newPage()
      const viewerSockets = trackRoom(viewerPage, document.id)
      await Promise.all([
         ownerPage.goto(`/documents/${document.id}`),
         editorPage.goto(`/documents/${document.id}`),
         viewerPage.goto(`/share#${share.data.token}`),
      ])
      await Promise.all([
         expect(ownerPage.getByLabel('同步狀態')).toHaveText('已連線'),
         expect(editorPage.getByLabel('同步狀態')).toHaveText('已連線'),
         expect(viewerPage.getByLabel('同步狀態')).toHaveText('已連線'),
      ])
      expect(viewerSockets.tickets.length).toBeGreaterThan(0)
      const staleViewerTicket = viewerSockets.tickets.at(-1)
      assert(staleViewerTicket)
      const closeCount = viewerSockets.closedAt.length
      const revokedAt = Date.now()

      const disabled = await owner.client.rpc('set_document_share', {
         target_id: document.id,
         enable: false,
      })
      expect(disabled.error).toBeNull()
      const invalidShare = await request.post(`${service}/documents/${document.id}/session`, {
         headers: { Origin: origin, 'X-Share-Token': share.data.token },
      })
      expect(invalidShare.status()).toBe(404)
      for (const user of [owner, editor]) {
         const session = (await user.client.auth.getSession()).data.session
         assert(session)
         const member = await request.post(`${service}/documents/${document.id}/session`, {
            headers: { Origin: origin, Authorization: `Bearer ${session.access_token}` },
         })
         expect(member.status()).toBe(200)
      }
      const invalidResolve = await request.post(`${origin}/api/share/resolve`, {
         data: { token: share.data.token },
      })
      expect(invalidResolve.status()).toBe(404)

      await expect
         .poll(() => viewerSockets.closedAt.length, { timeout: 62_000 })
         .toBeGreaterThan(closeCount)
      const viewerClosedAt = viewerSockets.closedAt.at(-1)
      assert(viewerClosedAt !== undefined)
      expect(viewerClosedAt - revokedAt).toBeLessThanOrEqual(60_000)
      await expect(viewerPage.getByRole('alert')).toHaveText('分享連結無效或已撤銷。')
      const stale = await request.get(
         `${service}/documents/${document.id}?ticket=${encodeURIComponent(staleViewerTicket)}&sessionId=${crypto.randomUUID()}`,
         { headers: upgrade },
      )
      expect(stale.status()).toBe(401)

      await addNode(ownerPage, 'Owner remains connected')
      await expect(ownerPage.getByLabel('保存狀態')).toHaveText('已確認持久化')
      await openObjectPanel(editorPage)
      await expect(editorPage.getByLabel('畫布節點')).toContainText('Owner remains connected')
      await expect(editorPage.getByLabel('保存狀態')).toHaveText('已確認持久化')
   } finally {
      await Promise.all([ownerContext.close(), editorContext.close(), viewerContext.close()])
      await Promise.all([owner.cleanup(), editor.cleanup()])
   }
})
