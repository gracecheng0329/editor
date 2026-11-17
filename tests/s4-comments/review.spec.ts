import { expect, test } from '@playwright/test'
import { registeredUser } from '../s1/sharing-fixtures'

test('mentions use eligible IDs and thread state enforces creator and editor roles', async ({ request }) => {
   const owner = await registeredUser(true, 'Review owner')
   const editor = await registeredUser(true, 'Review editor')
   const viewer = await registeredUser(true, 'Review viewer')
   const stranger = await registeredUser(true, 'Private stranger')
   try {
      const created = await request.post('/api/documents', { headers: owner.headers, data: { title: 'Review' } })
      expect(created.status()).toBe(201)
      const { id } = await created.json()
      const path = `/api/documents/${id}/comments`
      await owner.client.rpc('set_document_editor', { target_id: id, editor_id: editor.id, enable: true })
      const share = await owner.client.rpc('set_document_share', { target_id: id, enable: true })
      const shareToken = share.data.token
      const read = () => request.get(path, { headers: owner.headers })
      await request.get(`${path}?shareToken=${shareToken}`, { headers: viewer.headers })
      const listing = await (await read()).json()
      expect(listing.participants.map((p: { id: string }) => p.id).sort()).toEqual([owner.id, editor.id, viewer.id].sort())
      const anchor = { type: 'world', x: 10, y: 20 }
      const invalid = await request.post(path, { headers: owner.headers, data: { anchor, body: 'Private mention', mentions: [stranger.id] } })
      expect(invalid.status()).toBe(422)
      const forged = await request.post(path, { headers: viewer.headers, data: { anchor, body: 'Forged', shareToken, authorId: owner.id } })
      expect(forged.status()).toBe(422)
      const made = await request.post(path, { headers: owner.headers, data: { anchor: { type: 'object', objectId: 'shape:review', offset: { x: 0, y: 0 }, world: { x: 10, y: 20 } }, body: '@Review viewer please review', mentions: [viewer.id] } })
      expect(made.status()).toBe(201)
      const thread = await made.json()
      const statePath = `${path}/threads/${thread.id}`
      expect((await request.patch(statePath, { headers: viewer.headers, data: { status: 'resolved', shareToken } })).status()).toBe(403)
      expect((await request.patch(statePath, { headers: editor.headers, data: { status: 'resolved' } })).status()).toBe(200)
      expect((await request.patch(path, { headers: owner.headers, data: { updates: [{ threadId: thread.id, exists: false, worldX: 100, worldY: 200 }] } })).status()).toBe(200)
      const resolved = (await (await read()).json()).threads[0]
      expect(resolved).toMatchObject({ status: 'resolved', resolvedBy: editor.id, anchor: { objectId: 'shape:review', exists: false, world: { x: 100, y: 200 } } })
      expect(Date.parse(resolved.resolvedAt)).toBeGreaterThan(0)
      expect(resolved.messages[0].mentions).toEqual([{ id: viewer.id, name: 'Review viewer' }])
      expect((await request.patch(statePath, { headers: owner.headers, data: { status: 'open' } })).status()).toBe(200)
      expect((await (await read()).json()).threads[0]).toMatchObject({ status: 'open', resolvedBy: null, resolvedAt: null })
      const own = await request.post(path, { headers: viewer.headers, data: { anchor, body: 'Viewer thread', shareToken } })
      const ownThread = await own.json()
      expect((await request.patch(`${path}/threads/${ownThread.id}`, { headers: viewer.headers, data: { status: 'resolved', shareToken } })).status()).toBe(200)
      const second = await request.post('/api/documents', { headers: owner.headers, data: { title: 'Other' } })
      const other = await second.json()
      expect((await request.patch(`/api/documents/${other.id}/comments/threads/${thread.id}`, { headers: owner.headers, data: { status: 'resolved' } })).status()).toBe(404)
      const direct = await viewer.client.rpc('set_document_comment_status', { target_doc: id, target_thread: thread.id, next_status: 'resolved', share_token: shareToken })
      expect(direct.error?.code).toBe('42501')
      await owner.client.rpc('set_document_share', { target_id: id, enable: false })
      expect((await (await read()).json()).participants.map((p: { id: string }) => p.id)).not.toContain(viewer.id)
   } finally {
      await stranger.cleanup()
      await viewer.cleanup()
      await editor.cleanup()
      await owner.cleanup()
   }
})
