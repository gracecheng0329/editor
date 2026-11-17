import { expect, test } from '@playwright/test'
import { admin, registeredUser } from '../s1/sharing-fixtures'

test('comment API rejects a document request without a session or share link', async ({
   request,
}) => {
   const response = await request.get(
      '/api/documents/11111111-1111-4111-8111-111111111111/comments',
   )

   expect(response.status()).toBe(401)
   expect(await response.json()).toEqual({ error: 'UNAUTHENTICATED' })
})

test('Postgres comments enforce document access and keep object anchor history', async ({ request }) => {
   const owner = await registeredUser(true, 'Comment owner')
   const editor = await registeredUser(true, 'Comment editor')
   const viewer = await registeredUser(true, 'Comment viewer')
   const stranger = await registeredUser(true, 'Comment stranger')
   try {
      const created = await request.post('/api/documents', {
         headers: owner.headers,
         data: { title: 'Persistent comments' },
      })
      expect(created.status()).toBe(201)
      const document = await created.json()
      const secondDocument = await admin
         .from('documents')
         .insert({ owner_id: stranger.id, title: 'Another private document' })
         .select('id')
         .single()
      expect(secondDocument.error).toBeNull()
      if (!secondDocument.data) throw new Error('Could not create private cross-document fixture')

      const share = await owner.client.rpc('set_document_share', {
         target_id: document.id,
         enable: true,
      })
      expect(share.error).toBeNull()
      const shareToken = share.data?.token as string
      const grantEditor = await owner.client.rpc('set_document_editor', {
         target_id: document.id,
         editor_id: editor.id,
         enable: true,
      })
      expect(grantEditor.error).toBeNull()
      const ownerSession = await owner.client.auth.getSession()
      const editorSession = await editor.client.auth.getSession()
      const viewerSession = await viewer.client.auth.getSession()
      const strangerSession = await stranger.client.auth.getSession()
      const ownerHeaders = { Authorization: `Bearer ${ownerSession.data.session?.access_token}` }
      const editorHeaders = { Authorization: `Bearer ${editorSession.data.session?.access_token}` }
      const viewerHeaders = { Authorization: `Bearer ${viewerSession.data.session?.access_token}` }
      const strangerHeaders = {
         Authorization: `Bearer ${strangerSession.data.session?.access_token}`,
      }
      const path = `/api/documents/${document.id}/comments`
      const list = (url: string, headers: Record<string, string> = {}) =>
         request.get(url, { headers })
      const anonymousRead = await list(`${path}?shareToken=${shareToken}`)
      expect(anonymousRead.status()).toBe(200)
      expect((await anonymousRead.json()).canWrite).toBe(false)
      expect((await request.get(`/api/documents/${secondDocument.data.id}/comments?shareToken=${shareToken}`)).status()).toBe(403)
      expect((await list(path, viewerHeaders)).status()).toBe(403)
      expect((await list(path, strangerHeaders)).status()).toBe(403)
      expect((await list(path, editorHeaders)).status()).toBe(200)
      const editorThread = await request.post(path, {
         headers: editorHeaders,
         data: { body: 'Editors can start discussions', anchor: { type: 'world', x: 5, y: 8 } },
      })
      expect(editorThread.status()).toBe(201)
      expect(
         (
            await request.post(path, {
               data: {
                  body: 'Anonymous writes are denied',
                  anchor: { type: 'world', x: 10, y: 20 },
                  shareToken,
               },
            })
         ).status(),
      ).toBe(401)

      const anchor = {
         type: 'object',
         objectId: 'shape:stable-object-id',
         offset: { x: 12, y: -5 },
         world: { x: 140, y: 90 },
      }
      const createdThread = await request.post(path, {
         headers: ownerHeaders,
         data: { body: 'Object stays linked by stable ID', anchor },
      })
      expect(createdThread.status()).toBe(201)
      const thread = await createdThread.json()
      expect(
         (
            await request.patch(path, {
               data: {
                  shareToken,
                  updates: [{ threadId: thread.id, exists: false, worldX: 20, worldY: 30 }],
               },
            })
         ).status(),
      ).toBe(403)

      const reply = await request.post(`${path}/threads/${thread.id}/replies`, {
         headers: viewerHeaders,
         data: { body: 'A signed-in share viewer can reply', shareToken },
      })
      expect(reply.status()).toBe(201)
      expect(
         (
            await stranger.client.rpc('reply_document_comment_thread', {
               target_doc: document.id,
               target_thread: thread.id,
               body: 'Direct cross-document write',
               share_token: null,
            })
         ).error,
      ).not.toBeNull()

      const moved = await request.patch(path, {
         headers: viewerHeaders,
         data: {
            shareToken,
            updates: [{ threadId: thread.id, exists: true, worldX: 220, worldY: 120 }],
         },
      })
      expect(moved.status()).toBe(200)
      const deleted = await request.patch(path, {
         headers: viewerHeaders,
         data: {
            shareToken,
            updates: [{ threadId: thread.id, exists: false, worldX: 220, worldY: 120 }],
         },
      })
      expect(deleted.status()).toBe(200)
      const afterDelete = await (await list(path, ownerHeaders)).json()
      expect(afterDelete.threads[0].anchor).toEqual({
         type: 'object',
         objectId: 'shape:stable-object-id',
         offset: { x: 12, y: -5 },
         world: { x: 220, y: 120 },
         exists: false,
      })
      expect(afterDelete.threads[0].messages.map((message: { body: string }) => message.body)).toEqual([
         'Object stays linked by stable ID',
         'A signed-in share viewer can reply',
      ])

      const restored = await request.patch(path, {
         headers: { Authorization: `Bearer ${ownerSession.data.session?.access_token}` },
         data: {
            updates: [{ threadId: thread.id, exists: true, worldX: 320, worldY: 160 }],
         },
      })
      expect(restored.status()).toBe(200)
      const afterRestore = await (await list(path, ownerHeaders)).json()
      expect(afterRestore.threads[0].anchor).toMatchObject({
         objectId: 'shape:stable-object-id',
         offset: { x: 12, y: -5 },
         world: { x: 320, y: 160 },
         exists: true,
      })

      const ownerTicket = await request.post(`${path}/ticket`, {
         headers: ownerHeaders,
         data: {},
      })
      expect(ownerTicket.status()).toBe(200)
      expect((await ownerTicket.json()).expiresAt).toBeGreaterThan(Date.now() + 200_000)
      const viewerTicket = await request.post(`${path}/ticket`, {
         headers: viewerHeaders,
         data: { shareToken },
      })
      expect(viewerTicket.status()).toBe(200)
      const viewerTicketData = await viewerTicket.json()
      expect(viewerTicketData.role).toBe('viewer')
      expect(viewerTicketData.expiresAt).toBeLessThanOrEqual(Date.now() + 45_000)

      const revoke = await owner.client.rpc('set_document_share', {
         target_id: document.id,
         enable: false,
      })
      expect(revoke.error).toBeNull()
      expect((await list(`${path}?shareToken=${shareToken}`)).status()).toBe(403)
      expect(
         (
            await request.post(`${path}/ticket`, {
               headers: viewerHeaders,
               data: { shareToken },
            })
         ).status(),
      ).toBe(403)
      expect((await list(path, ownerHeaders)).status()).toBe(200)
      const revokeEditor = await owner.client.rpc('set_document_editor', {
         target_id: document.id,
         editor_id: editor.id,
         enable: false,
      })
      expect(revokeEditor.error).toBeNull()
      expect((await list(path, editorHeaders)).status()).toBe(403)
   } finally {
      await stranger.cleanup()
      await viewer.cleanup()
      await editor.cleanup()
      await owner.cleanup()
   }
})

test('separate document pages receive and persist a real shared discussion', async ({ browser, request }) => {
   const owner = await registeredUser(true, 'Discussion owner')
   const viewer = await registeredUser(true, 'Discussion viewer')
   const ownerContext = await browser.newContext()
   const viewerContext = await browser.newContext()
   const anonymousContext = await browser.newContext()
   const origin = 'http://127.0.0.1:3103'
   try {
      await ownerContext.addCookies(owner.browserCookies().map((cookie) => ({ ...cookie, url: origin })))
      const created = await ownerContext.request.post('/api/documents', {
         headers: { Origin: origin },
         data: { title: 'Browser discussion' },
      })
      expect(created.status()).toBe(201)
      const document = await created.json()
      const share = await owner.client.rpc('set_document_share', {
         target_id: document.id,
         enable: true,
      })
      expect(share.error).toBeNull()
      const shareToken = share.data?.token as string
      await viewerContext.addCookies(viewer.browserCookies().map((cookie) => ({ ...cookie, url: origin })))

      const ownerPage = await ownerContext.newPage()
      const viewerPage = await viewerContext.newPage()
      const anonymousPage = await anonymousContext.newPage()
      await Promise.all([
         ownerPage.goto(`/documents/${document.id}`),
         viewerPage.goto(`/share#${shareToken}`),
      ])
      await expect(ownerPage.getByLabel('文件畫布')).toBeVisible()
      await expect(viewerPage.getByLabel('分享畫布')).toBeVisible()
      await ownerPage.getByRole('button', { name: '留言討論' }).click()
      await viewerPage.getByRole('button', { name: '留言討論' }).click()
      await expect(ownerPage.getByText('即時更新已連線')).toBeVisible()
      await expect(viewerPage.getByText('即時更新已連線')).toBeVisible()
      await expect(ownerPage.getByLabel('留言內容')).toBeVisible()
      await expect(viewerPage.getByLabel('留言內容')).toBeVisible()

      const firstMessage = `owner thread ${crypto.randomUUID()}`
      const replyMessage = `viewer reply ${crypto.randomUUID()}`
      await ownerPage.getByLabel('討論位置').selectOption('world')
      await ownerPage.getByLabel('提及參與者').selectOption(viewer.id)
      await ownerPage.getByLabel('留言內容').fill(firstMessage)
      const firstPost = ownerPage.waitForResponse(
         (response) =>
            new URL(response.url()).pathname === `/api/documents/${document.id}/comments` &&
            response.request().method() === 'POST',
      )
      await ownerPage.getByRole('button', { name: '送出留言' }).click()
      const firstPostResponse = await firstPost
      expect(firstPostResponse.status(), await firstPostResponse.text()).toBe(201)
      await expect(ownerPage.getByText(firstMessage)).toBeVisible()
      await expect(viewerPage.getByText(firstMessage)).toBeVisible()

      await expect(viewerPage.getByTitle(viewer.id)).toHaveText('@Discussion viewer')
      await expect(viewerPage.getByRole('button', { name: '解決討論', exact: true })).toHaveCount(0)
      await ownerPage.getByRole('button', { name: '解決討論', exact: true }).click()
      await expect(viewerPage.getByText('已解決', { exact: true })).toBeVisible()
      await ownerPage.getByRole('button', { name: '重新開啟討論' }).click()
      await expect(viewerPage.getByText('討論中', { exact: true })).toBeVisible()
      await viewerPage.getByRole('button', { name: '回覆' }).click()
      await viewerPage.getByLabel('留言內容').fill(replyMessage)
      await viewerPage.getByRole('button', { name: '送出留言' }).click()
      await expect(viewerPage.getByText(replyMessage)).toBeVisible()
      await expect(ownerPage.getByText(replyMessage)).toBeVisible()

      await anonymousPage.goto(`/share#${shareToken}`)
      await expect(anonymousPage.getByLabel('分享畫布')).toBeVisible()
      await anonymousPage.getByRole('button', { name: '留言討論' }).click()
      await expect(anonymousPage.getByText(firstMessage)).toBeVisible()
      await expect(anonymousPage.getByText(replyMessage)).toBeVisible()
      await expect(anonymousPage.getByLabel('留言內容')).toHaveCount(0)

      await ownerPage.reload()
      await expect(ownerPage.getByLabel('文件畫布')).toBeVisible()
      await ownerPage.getByRole('button', { name: '留言討論' }).click()
      await expect(ownerPage.getByText(firstMessage)).toBeVisible()
      await expect(ownerPage.getByText(replyMessage)).toBeVisible()
      const stored = await request.get(`/api/documents/${document.id}/comments`, {
         headers: owner.headers,
      })
      expect(stored.status()).toBe(200)
      expect((await stored.json()).threads).toHaveLength(1)
   } finally {
      await anonymousContext.close()
      await viewerContext.close()
      await ownerContext.close()
      await viewer.cleanup()
      await owner.cleanup()
   }
})
