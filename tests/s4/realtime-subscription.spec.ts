import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { registeredUser } from '../s1/sharing-fixtures'

type User = Awaited<ReturnType<typeof registeredUser>>

async function accessToken(user: User) {
   const session = await user.client.auth.getSession()
   expect(session.error).toBeNull()
   const token = session.data.session?.access_token
   expect(token).toBeTruthy()
   if (!token) throw new Error('Registered user is missing an access token')
   return token
}

async function content(
   page: import('@playwright/test').Page,
   documentId: string,
   commentId: string,
   options: { token?: string; shareToken?: string } = {},
) {
   const query = new URLSearchParams({ documentId, commentId })
   if (options.shareToken) query.set('shareToken', options.shareToken)
   return page.request.get(`/api/content?${query}`, {
      headers: options.token ? { Authorization: `Bearer ${options.token}` } : {},
   })
}

async function join(
   page: import('@playwright/test').Page,
   input: {
      documentId: string
      shareToken?: string
      topic?: string
      expired?: boolean
      expectedStatus?: 'SUBSCRIBED' | 'CHANNEL_ERROR'
   },
) {
   const result = await page.evaluate((value) => window.s4Realtime.join(value), input)
   if (result.status === 200)
      await expect(page.getByLabel('訂閱狀態')).toHaveText(input.expectedStatus ?? 'SUBSCRIBED', {
         timeout: 15000,
      })
   return result
}

async function publish(
   page: import('@playwright/test').Page,
   token: string,
   documentId: string,
   commentId: string,
   body: string,
) {
   return page.request.post('/api/publish', {
      headers: { Authorization: `Bearer ${token}` },
      data: { documentId, commentId, body },
   })
}

test('private Broadcast authorizes share holders and stops revoked subscriptions within one minute', async ({
   browser,
}) => {
   const owner = await registeredUser(true, 'Realtime owner')
   const editor = await registeredUser(true, 'Realtime editor')
   const loggedViewer = await registeredUser(true, 'Realtime share viewer')
   const stranger = await registeredUser(true, 'Realtime non-member')
   const users = [owner, editor, loggedViewer, stranger]
   const contexts: import('@playwright/test').BrowserContext[] = []
   let documentId = ''
   let shareToken = ''
   try {
      const created = await owner.client
         .from('documents')
         .insert({ owner_id: owner.id, title: 'S4 private Broadcast probe' })
         .select('id')
         .single()
      expect(created.error).toBeNull()
      if (created.error || !created.data) throw new Error('Could not create probe document')
      documentId = created.data.id

      const share = await owner.client.rpc('set_document_share', {
         target_id: documentId,
         enable: true,
      })
      expect(share.error).toBeNull()
      expect(typeof share.data?.token).toBe('string')
      shareToken = share.data.token

      const grantEditor = await owner.client.rpc('set_document_editor', {
         target_id: documentId,
         editor_id: editor.id,
         enable: true,
      })
      expect(grantEditor.error).toBeNull()

      const ownerToken = await accessToken(owner)
      const editorToken = await accessToken(editor)
      const viewerToken = await accessToken(loggedViewer)
      const strangerToken = await accessToken(stranger)
      const commentId = randomUUID()
      const commentBody = 'private comment body controlled by the read endpoint'

      const open = async (token?: string) => {
         const context = await browser.newContext()
         contexts.push(context)
         const page = await context.newPage()
         await page.goto('/')
         if (token) await page.evaluate((value) => window.s4Realtime.setIdentity(value), token)
         return page
      }
      const ownerPage = await open(ownerToken)
      const editorPage = await open(editorToken)
      const anonymousViewerPage = await open()
      const loggedViewerPage = await open(viewerToken)
      const strangerPage = await open(strangerToken)

      const ownerTicket = await join(ownerPage, { documentId })
      const editorTicket = await join(editorPage, { documentId })
      const anonymousViewerTicket = await join(anonymousViewerPage, {
         documentId,
         shareToken,
      })
      const loggedViewerTicket = await join(loggedViewerPage, {
         documentId,
         shareToken,
      })
      expect([ownerTicket.status, editorTicket.status]).toEqual([200, 200])
      expect([anonymousViewerTicket.status, loggedViewerTicket.status]).toEqual([200, 200])
      expect(ownerTicket.expiresAt).toBeGreaterThan(Date.now() + 200_000)
      expect(editorTicket.expiresAt).toBeGreaterThan(Date.now() + 200_000)
      expect(anonymousViewerTicket.expiresAt).toBeLessThanOrEqual(Date.now() + 45_000)
      expect(loggedViewerTicket.expiresAt).toBeLessThanOrEqual(Date.now() + 45_000)

      const loginOnly = await strangerPage.request.post('/api/ticket', {
         headers: { Authorization: `Bearer ${strangerToken}` },
         data: { documentId },
      })
      expect(loginOnly.status()).toBe(403)

      const fakeDocument = await strangerPage.request.post('/api/ticket', {
         data: { documentId: randomUUID(), shareToken },
      })
      expect(fakeDocument.status()).toBe(403)

      const crossDocumentPage = await open()
      const crossDocument = await join(crossDocumentPage, {
         documentId,
         shareToken,
         topic: `s4-document:${randomUUID()}`,
         expectedStatus: 'CHANNEL_ERROR',
      })
      expect(crossDocument.status).toBe(200)
      await expect(crossDocumentPage.getByLabel('訂閱狀態')).toHaveText('CHANNEL_ERROR', {
         timeout: 15000,
      })

      const expiredPage = await open()
      const expiredTicket = await join(expiredPage, {
         documentId,
         shareToken,
         expired: true,
         expectedStatus: 'CHANNEL_ERROR',
      })
      expect(expiredTicket.status).toBe(200)
      await expect(expiredPage.getByLabel('訂閱狀態')).toHaveText('CHANNEL_ERROR', {
         timeout: 15000,
      })

      const published = await publish(ownerPage, ownerToken, documentId, commentId, commentBody)
      expect(published.status()).toBe(200)
      for (const page of [ownerPage, editorPage, anonymousViewerPage, loggedViewerPage])
         await expect(page.getByLabel('收到的事件')).toContainText(commentId)

      for (const [page, token, viewer] of [
         [ownerPage, ownerToken, undefined],
         [editorPage, editorToken, undefined],
         [anonymousViewerPage, undefined, shareToken],
         [loggedViewerPage, viewerToken, shareToken],
      ] as const) {
         const response = await content(page, documentId, commentId, {
            ...(token ? { token } : {}),
            ...(viewer ? { shareToken: viewer } : {}),
         })
         expect(response.status()).toBe(200)
         expect((await response.json()).body).toBe(commentBody)
      }

      for (const page of [ownerPage, editorPage, anonymousViewerPage, loggedViewerPage]) {
         const eventText = await page.getByLabel('收到的事件').locator('li').first().textContent()
         expect(eventText).not.toBeNull()
         if (!eventText) throw new Error('Realtime event payload was not rendered')
         const event = JSON.parse(eventText)
         expect(event).toEqual({ id: commentId, revision: 1 })
         expect(JSON.stringify(event)).not.toContain(commentBody)
      }

      const revokeStartedAt = Date.now()
      const revoke = await owner.client.rpc('set_document_share', {
         target_id: documentId,
         enable: false,
      })
      expect(revoke.error).toBeNull()

      for (const [page, token] of [
         [anonymousViewerPage, undefined],
         [loggedViewerPage, viewerToken],
      ] as const) {
         const freshTicket = await page.request.post('/api/ticket', {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            data: { documentId, shareToken },
         })
         expect(freshTicket.status()).toBe(403)
         expect((await content(page, documentId, commentId, { token, shareToken })).status()).toBe(
            403,
         )
      }
      for (const [page, token] of [
         [ownerPage, ownerToken],
         [editorPage, editorToken],
      ] as const)
         expect((await content(page, documentId, commentId, { token })).status()).toBe(200)

      const postRevokeId = randomUUID()
      const postRevoke = await publish(
         ownerPage,
         ownerToken,
         documentId,
         postRevokeId,
         'after revoke',
      )
      expect(postRevoke.status()).toBe(200)
      for (const page of [ownerPage, editorPage])
         await expect(page.getByLabel('收到的事件')).toContainText(postRevokeId)

      const anonymousExpiry = anonymousViewerTicket.expiresAt
      const loggedViewerExpiry = loggedViewerTicket.expiresAt
      expect(anonymousExpiry).toBeDefined()
      expect(loggedViewerExpiry).toBeDefined()
      if (anonymousExpiry === undefined || loggedViewerExpiry === undefined)
         throw new Error('Viewer ticket is missing its expiry')
      const expiries = [anonymousExpiry, loggedViewerExpiry]
      for (const page of [anonymousViewerPage, loggedViewerPage]) {
         await expect
            .poll(() => page.evaluate(() => window.s4Realtime.state().closedAt), {
               timeout: 60_000,
               intervals: [250, 500, 1000],
            })
            .toBeGreaterThan(0)
         const closedAt = await page.evaluate(() => window.s4Realtime.state().closedAt)
         expect(closedAt).not.toBeNull()
         if (closedAt === null) throw new Error('Viewer Realtime channel did not close')
         expect(closedAt - revokeStartedAt).toBeLessThanOrEqual(60_000)
         expect(closedAt).toBeLessThanOrEqual(Math.max(...expiries) + 15_000)
      }

      const finalId = randomUUID()
      const finalBroadcast = await publish(
         ownerPage,
         ownerToken,
         documentId,
         finalId,
         'after subscription expiry',
      )
      expect(finalBroadcast.status()).toBe(200)
      for (const page of [ownerPage, editorPage])
         await expect(page.getByLabel('收到的事件')).toContainText(finalId)
      for (const page of [anonymousViewerPage, loggedViewerPage])
         await expect(page.getByLabel('收到的事件')).not.toContainText(finalId)
   } finally {
      try {
         await Promise.all(contexts.map((context) => context.close()))
         for (const user of users) await user.cleanup()
      } finally {
         const cleanup = await fetch('http://127.0.0.1:8791/api/cleanup', { method: 'POST' })
         expect(cleanup.status).toBe(204)
      }
   }
})
