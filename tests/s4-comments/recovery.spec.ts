import { expect, test } from '@playwright/test'
import { anonymous, registeredUser } from '../s1/sharing-fixtures'

test('every comment subscription lease bounds revoked capabilities to 45 seconds', async ({
   request,
}) => {
   const owner = await registeredUser(true, 'Lease owner')
   const editor = await registeredUser(true, 'Lease editor')
   try {
      const created = await request.post('/api/documents', {
         headers: owner.headers,
         data: { title: 'Lease limits' },
      })
      const { id } = await created.json()
      await owner.client.rpc('set_document_editor', {
         target_id: id,
         editor_id: editor.id,
         enable: true,
      })
      for (const user of [owner, editor]) {
         const ticket = await request.post(`/api/documents/${id}/comments/ticket`, {
            headers: user.headers,
            data: {},
         })
         expect(ticket.status()).toBe(200)
         expect((await ticket.json()).expiresAt).toBeLessThanOrEqual(Date.now() + 45_000)
      }
   } finally {
      await editor.cleanup()
      await owner.cleanup()
   }
})

test('formal discussion receives changes after a Realtime heartbeat without waiting for reconciliation', async ({
   browser,
   request,
}) => {
   const owner = await registeredUser(true, 'Heartbeat owner')
   const context = await browser.newContext()
   const origin = 'http://127.0.0.1:3103'
   const readTimes: number[] = []
   let blockReads = false
   try {
      const created = await request.post('/api/documents', {
         headers: owner.headers,
         data: { title: 'Realtime heartbeat delivery' },
      })
      const { id } = await created.json()
      const path = `/api/documents/${id}/comments`
      const initial = await request.post(path, {
         headers: owner.headers,
         data: { body: 'Before subscribing', anchor: { type: 'world', x: 0, y: 0 } },
      })
      expect(initial.status()).toBe(201)

      await context.addCookies(owner.browserCookies().map((cookie) => ({ ...cookie, url: origin })))
      const page = await context.newPage()
      await page.route(`**${path}`, async (route) => {
         if (route.request().method() === 'GET' && blockReads) {
            readTimes.push(Date.now())
            await route.fulfill({ status: 503, body: 'temporary read outage' })
         } else await route.continue()
      })
      await page.goto(`/documents/${id}`)
      await page.getByRole('button', { name: '留言討論' }).click()
      await expect(page.getByText('Before subscribing', { exact: true })).toBeVisible()
      await expect(page.getByText('即時更新已連線')).toBeVisible()

      const started = Date.now()
      blockReads = true
      await expect
         .poll(() => readTimes.some((time) => time - started >= 25_000), { timeout: 40_000 })
         .toBe(true)
      const beforeEvent = readTimes.length
      const afterHeartbeat = await request.post(path, {
         headers: owner.headers,
         data: { body: 'After Realtime heartbeat', anchor: { type: 'world', x: 0, y: 0 } },
      })
      expect(afterHeartbeat.status()).toBe(201)
      await expect
         .poll(() => readTimes.length, { intervals: [50], timeout: 1500 })
         .toBe(beforeEvent + 1)
   } finally {
      await context.close()
      await owner.cleanup()
   }
})

test('formal discussion recovers failed connection and missed messages, then clears revoked content', async ({
   browser,
   request,
}) => {
   const owner = await registeredUser(true, 'Recovery owner')
   const viewer = await registeredUser(true, 'Recovery viewer')
   const context = await browser.newContext()
   const ownerContext = await browser.newContext()
   const origin = 'http://127.0.0.1:3103'
   try {
      const created = await request.post('/api/documents', {
         headers: owner.headers,
         data: { title: 'Recovery journey' },
      })
      const { id } = await created.json()
      const share = await owner.client.rpc('set_document_share', { target_id: id, enable: true })
      const shareToken = share.data.token
      await context.addCookies(
         viewer.browserCookies().map((cookie) => ({ ...cookie, url: origin })),
      )
      let initial = true
      await context.route(`**/api/documents/${id}/comments/ticket`, async (route) => {
         if (initial) {
            initial = false
            await route.abort('failed')
         } else await route.continue()
      })
      const page = await context.newPage()
      await page.goto(`/share#${shareToken}`)
      await expect(page.getByLabel('分享畫布')).toBeVisible()
      await page.getByRole('button', { name: '留言討論' }).click()
      await expect(page.getByText('即時更新已連線')).toBeVisible({ timeout: 15_000 })
      await context.setOffline(true)
      const body = `Missed during outage ${crypto.randomUUID()}`
      const written = await request.post(`/api/documents/${id}/comments`, {
         headers: owner.headers,
         data: { body, anchor: { type: 'world', x: 5, y: 5 } },
      })
      expect(written.status()).toBe(201)
      const thread = await written.json()
      expect(
         (
            await request.post(`/api/documents/${id}/comments/threads/${thread.id}/replies`, {
               headers: owner.headers,
               data: { body: 'Persisted missed reply' },
            })
         ).status(),
      ).toBe(201)
      await context.setOffline(false)
      await expect(page.getByText(body, { exact: true })).toHaveCount(1, { timeout: 15_000 })
      await expect(page.getByText('Persisted missed reply', { exact: true })).toHaveCount(1)
      await page.getByRole('button', { name: '重新連線留言' }).click()
      await expect(page.getByText('即時更新已連線')).toBeVisible()
      await expect(page.getByText(body, { exact: true })).toHaveCount(1)
      await ownerContext.addCookies(
         owner.browserCookies().map((cookie) => ({ ...cookie, url: origin })),
      )
      const ownerPage = await ownerContext.newPage()
      await ownerPage.goto(`/documents/${id}`)
      await ownerPage.getByRole('button', { name: '分享', exact: true }).click()
      await ownerPage.getByRole('button', { name: '撤銷觀看連結', exact: true }).click()
      await expect(ownerPage.getByText('尚未啟用觀看連結。')).toBeVisible()
      const discussionButton = page.getByRole('button', { name: '留言討論' })
      if ((await discussionButton.getAttribute('aria-pressed')) !== 'true')
         await discussionButton.click()
      await expect(page.getByText('目前沒有讀取此文件討論的資格。')).toBeVisible({
         timeout: 30_000,
      })
      await expect(page.getByText(body, { exact: true })).toHaveCount(0)
      await expect(page.getByLabel('留言內容')).toHaveCount(0)
      expect(
         (
            await context.request.get(`/api/documents/${id}/comments?shareToken=${shareToken}`)
         ).status(),
      ).toBe(403)
   } finally {
      await ownerContext.close()
      await context.close()
      await viewer.cleanup()
      await owner.cleanup()
   }
})

test('production tickets expire joined subscriptions without client renewal after revocation', async ({
   request,
}) => {
   const owner = await registeredUser(true, 'Expiry owner')
   const editor = await registeredUser(true, 'Revoked editor')
   const viewer = await registeredUser(true, 'Expiry viewer')
   const retained = await registeredUser(true, 'Retained editor')
   const clients: ReturnType<typeof anonymous>[] = []
   try {
      const created = await request.post('/api/documents', {
         headers: owner.headers,
         data: { title: 'Uncooperative subscriptions' },
      })
      const { id } = await created.json()
      const path = `/api/documents/${id}/comments`
      for (const user of [editor, retained])
         expect(
            (
               await owner.client.rpc('set_document_editor', {
                  target_id: id,
                  editor_id: user.id,
                  enable: true,
               })
            ).error,
         ).toBeNull()
      const share = await owner.client.rpc('set_document_share', { target_id: id, enable: true })
      const shareToken = share.data.token
      const joined: { status: string; events: number }[] = []
      for (const headers of [undefined, viewer.headers, editor.headers]) {
         const response = await request.post(`${path}/ticket`, { headers, data: { shareToken } })
         expect(response.status()).toBe(200)
         const ticket = await response.json()
         const client = anonymous()
         clients.push(client)
         const state = { status: '', events: 0 }
         joined.push(state)
         await client.realtime.setAuth(ticket.accessToken)
         client
            .channel(`document-comments:${id}`, { config: { private: true } })
            .on('broadcast', { event: 'comment_changed' }, () => {
               state.events++
            })
            .subscribe((status) => {
               state.status = status
            })
      }
      await expect.poll(() => joined.every((state) => state.status === 'SUBSCRIBED')).toBe(true)
      const publish = (body: string) =>
         request.post(path, {
            headers: owner.headers,
            data: { body, anchor: { type: 'world', x: 0, y: 0 } },
         })
      expect((await publish('Before revocation')).status()).toBe(201)
      await expect.poll(() => joined.map((state) => state.events)).toEqual([1, 1, 1])
      expect(
         (
            await owner.client.rpc('set_document_editor', {
               target_id: id,
               editor_id: editor.id,
               enable: false,
            })
         ).error,
      ).toBeNull()
      expect((await request.get(path, { headers: editor.headers })).status()).toBe(403)
      expect(
         (
            await request.get(`${path}?shareToken=${shareToken}`, { headers: editor.headers })
         ).status(),
      ).toBe(200)
      const downgrade = await request.post(`${path}/ticket`, {
         headers: editor.headers,
         data: { shareToken },
      })
      expect((await downgrade.json()).role).toBe('viewer')
      const revokedAt = Date.now()
      expect(
         (await owner.client.rpc('set_document_share', { target_id: id, enable: false })).error,
      ).toBeNull()
      for (const headers of [undefined, viewer.headers, editor.headers]) {
         expect((await request.get(`${path}?shareToken=${shareToken}`, { headers })).status()).toBe(
            403,
         )
         expect(
            (await request.post(`${path}/ticket`, { headers, data: { shareToken } })).status(),
         ).toBe(403)
      }
      for (const user of [owner, retained]) {
         expect((await request.get(path, { headers: user.headers })).status()).toBe(200)
         expect(
            (
               await request.post(`${path}/ticket`, { headers: user.headers, data: { shareToken } })
            ).status(),
         ).toBe(200)
      }
      await expect
         .poll(() => joined.every((state) => state.status !== 'SUBSCRIBED'), { timeout: 60_000 })
         .toBe(true)
      expect(Date.now() - revokedAt).toBeLessThan(60_000)
      expect((await publish('After expired revoked leases')).status()).toBe(201)
      // Give a live owner channel the same real notification as a delivery barrier.
      const liveTicket = await request.post(`${path}/ticket`, { headers: owner.headers, data: {} })
      const live = anonymous()
      clients.push(live)
      await live.realtime.setAuth((await liveTicket.json()).accessToken)
      let liveStatus = ''
      let received = 0
      live
         .channel(`document-comments:${id}`, { config: { private: true } })
         .on('broadcast', { event: 'comment_changed' }, () => {
            received++
         })
         .subscribe((status) => {
            liveStatus = status
         })
      await expect.poll(() => liveStatus).toBe('SUBSCRIBED')
      expect((await publish('Delivery barrier')).status()).toBe(201)
      await expect.poll(() => received).toBe(1)
      expect(joined.map((state) => state.events)).toEqual([1, 1, 1])
   } finally {
      await Promise.all(clients.map((client) => client.removeAllChannels()))
      for (const client of clients) client.realtime.disconnect()
      await retained.cleanup()
      await viewer.cleanup()
      await editor.cleanup()
      await owner.cleanup()
   }
})

test('delayed authoritative reads and repeated notifications cannot roll discussion content back', async ({
   browser,
   request,
}) => {
   const owner = await registeredUser(true, 'Ordered reader')
   const context = await browser.newContext()
   let release = () => {}
   try {
      const made = await request.post('/api/documents', {
         headers: owner.headers,
         data: { title: 'Read ordering' },
      })
      const { id } = await made.json()
      const path = `/api/documents/${id}/comments`
      const created = await request.post(path, {
         headers: owner.headers,
         data: { body: 'Original content', anchor: { type: 'world', x: 0, y: 0 } },
      })
      const thread = await created.json()
      await context.addCookies(
         owner.browserCookies().map((cookie) => ({ ...cookie, url: 'http://127.0.0.1:3103' })),
      )
      const page = await context.newPage()
      await page.goto(`/documents/${id}`)
      await page.getByRole('button', { name: '留言討論' }).click()
      await expect(page.getByText('Original content', { exact: true })).toBeVisible()
      await expect(page.getByText('即時更新已連線')).toBeVisible()
      let captured = () => {}
      const capturedRead = new Promise<void>((resolve) => {
         captured = resolve
      })
      const gate = new Promise<void>((resolve) => {
         release = resolve
      })
      let hold = true
      await page.route(`**${path}`, async (route) => {
         if (hold && route.request().method() === 'GET') {
            hold = false
            const response = await route.fetch()
            captured()
            await gate
            await route.fulfill({ response })
         } else await route.continue()
      })
      await page.evaluate(() => window.dispatchEvent(new Event('online')))
      await capturedRead
      for (const body of ['Latest reply A', 'Latest reply B']) {
         const reply = await request.post(`${path}/threads/${thread.id}/replies`, {
            headers: owner.headers,
            data: { body },
         })
         expect(reply.status()).toBe(201)
      }
      // One response deliberately contains the older real database state.
      release()
      await expect(page.getByText('Latest reply A', { exact: true })).toHaveCount(1)
      await expect(page.getByText('Latest reply B', { exact: true })).toHaveCount(1)
      await page.getByRole('button', { name: '重新連線留言' }).click()
      await expect(page.getByText('即時更新已連線')).toBeVisible()
      await expect(page.getByText('Latest reply B', { exact: true })).toHaveCount(1)
      const final = await request.get(path, { headers: owner.headers })
      expect(
         (await final.json()).threads[0].messages.map((message: { body: string }) => message.body),
      ).toEqual(['Original content', 'Latest reply A', 'Latest reply B'])
   } finally {
      release()
      await context.close()
      await owner.cleanup()
   }
})
