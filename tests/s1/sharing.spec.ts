import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { anonymous, registeredUser } from './sharing-fixtures'

test('owner enables a private document share and anonymous token holders read limited viewer metadata', async ({
   request,
}) => {
   const owner = await registeredUser()
   try {
      const creation = await request.post('/api/documents', {
         headers: owner.headers,
         data: { title: 'Shared architecture' },
      })
      expect(creation.status()).toBe(201)
      const doc = await creation.json()
      expect((await request.post('/api/share/resolve', { data: { token: doc.id } })).status()).toBe(
         404,
      )
      expect((await anonymous().from('documents').select().eq('id', doc.id)).data ?? []).toEqual([])
      const enable = await request.post(`/api/documents/${doc.id}/share`, {
         headers: owner.headers,
      })
      expect(enable.status()).toBe(200)
      const share = await enable.json()
      expect(share.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      const view = await request.post('/api/share/resolve', { data: { token: share.token } })
      expect(view.status()).toBe(200)
      expect(await view.json()).toEqual({
         id: doc.id,
         title: 'Shared architecture',
         role: 'viewer',
      })
      expect(
         JSON.stringify(
            await (
               await request.get(`/api/documents/${doc.id}`, { headers: owner.headers })
            ).json(),
         ),
      ).not.toContain(share.token)
   } finally {
      await owner.cleanup()
   }
})

test('owner grants a registered GitHub identity editor access; editor cannot manage title or access and revocation is immediate', async ({
   request,
}) => {
   const owner = await registeredUser()
   const editor = await registeredUser()
   const outsider = await registeredUser(false)
   try {
      const doc = await (
         await request.post('/api/documents', {
            headers: owner.headers,
            data: { title: 'Invited architecture' },
         })
      ).json()
      const other = await (
         await request.post('/api/documents', {
            headers: owner.headers,
            data: { title: 'Other private' },
         })
      ).json()
      const path = `/api/documents/${doc.id}/editors`
      expect(
         (
            await request.post(path, { headers: owner.headers, data: { userId: outsider.id } })
         ).status(),
      ).toBe(422)
      expect(
         (
            await request.post(path, { headers: owner.headers, data: { userId: randomUUID() } })
         ).status(),
      ).toBe(422)
      const grants = await Promise.all(
         [1, 2].map(() =>
            request.post(path, { headers: owner.headers, data: { userId: editor.id } }),
         ),
      )
      expect(grants.map((value) => value.status())).toEqual([200, 200])
      const listed = await (await request.get(path, { headers: owner.headers })).json()
      expect(listed.editors).toEqual([{ user_id: editor.id }])
      expect(
         (await (await request.get(`/api/documents/${doc.id}`, { headers: editor.headers })).json())
            .role,
      ).toBe('editor')
      expect(
         (await (await request.get('/api/documents', { headers: editor.headers })).json()).map(
            (row: { id: string }) => row.id,
         ),
      ).toContain(doc.id)
      expect((await editor.client.from('documents').select().eq('id', doc.id)).data).toHaveLength(1)
      expect(
         (await request.get(`/api/documents/${other.id}`, { headers: editor.headers })).status(),
      ).toBe(404)
      expect(
         (
            await request.patch(`/api/documents/${doc.id}`, {
               headers: editor.headers,
               data: { title: 'Stolen' },
            })
         ).status(),
      ).toBe(404)
      expect(
         (
            await editor.client
               .from('documents')
               .update({ title: 'Stolen' })
               .eq('id', doc.id)
               .select()
         ).data,
      ).toEqual([])
      expect((await request.get(path, { headers: editor.headers })).status()).toBe(404)
      expect(
         (
            await request.post(path, { headers: editor.headers, data: { userId: outsider.id } })
         ).status(),
      ).toBe(404)
      expect(
         (await request.delete(`${path}/${editor.id}`, { headers: editor.headers })).status(),
      ).toBe(404)
      expect(
         (
            await request.post(`/api/documents/${doc.id}/share`, { headers: editor.headers })
         ).status(),
      ).toBe(404)
      const share = await (
         await request.post(`/api/documents/${doc.id}/share`, { headers: owner.headers })
      ).json()
      expect(
         (await request.delete(`${path}/${editor.id}`, { headers: owner.headers })).status(),
      ).toBe(200)
      expect(
         (await request.delete(`${path}/${editor.id}`, { headers: owner.headers })).status(),
      ).toBe(200)
      expect(
         (await request.get(`/api/documents/${doc.id}`, { headers: editor.headers })).status(),
      ).toBe(404)
      expect((await editor.client.from('documents').select().eq('id', doc.id)).data).toEqual([])
      expect(
         (
            await (
               await request.post('/api/share/resolve', {
                  headers: editor.headers,
                  data: { token: share.token },
               })
            ).json()
         ).role,
      ).toBe('viewer')
   } finally {
      await outsider.cleanup()
      await editor.cleanup()
      await owner.cleanup()
   }
})

test('only owner can manage links; rotation and revocation immediately invalidate old tokens', async ({
   request,
}) => {
   const owner = await registeredUser()
   const stranger = await registeredUser()
   try {
      const doc = await (
         await request.post('/api/documents', {
            headers: owner.headers,
            data: { title: 'Revocable' },
         })
      ).json()
      const path = `/api/documents/${doc.id}/share`
      const first = await (await request.post(path, { headers: owner.headers })).json()
      expect(
         (
            await stranger.client.rpc('set_document_share', {
               target_id: doc.id,
               share_token: 'A'.repeat(43),
            })
         ).error,
      ).not.toBeNull()
      expect((await request.post(path, { headers: stranger.headers })).status()).toBe(404)
      expect((await request.delete(path, { headers: stranger.headers })).status()).toBe(404)
      expect(
         (await request.get(`/api/documents/${doc.id}`, { headers: stranger.headers })).status(),
      ).toBe(404)
      // The public database operation itself owns token generation: callers cannot
      // override entropy even when bypassing Next's route.
      expect(
         (
            await owner.client.rpc('set_document_share', {
               target_id: doc.id,
               share_token: 'A'.repeat(43),
            })
         ).error,
      ).not.toBeNull()
      const second = await (await request.post(path, { headers: owner.headers })).json()
      expect(second.token).not.toBe(first.token)
      expect(
         (await request.post('/api/share/resolve', { data: { token: first.token } })).status(),
      ).toBe(404)
      expect(
         (await request.post('/api/share/resolve', { data: { token: second.token } })).status(),
      ).toBe(200)
      expect((await request.delete(path, { headers: owner.headers })).status()).toBe(200)
      expect((await request.delete(path, { headers: owner.headers })).status()).toBe(200)
      expect(
         (await request.post('/api/share/resolve', { data: { token: second.token } })).status(),
      ).toBe(404)
      expect(
         (await request.get(`/api/documents/${doc.id}`, { headers: owner.headers })).status(),
      ).toBe(200)
      expect(
         (await anonymous().schema('private').from('document_shares').select()).error,
      ).not.toBeNull()
   } finally {
      await stranger.cleanup()
      await owner.cleanup()
   }
})

test('trusted identities and active sessions also protect direct RPC calls; share revocation preserves identity-based access', async ({
   request,
}) => {
   const owner = await registeredUser()
   const editor = await registeredUser()
   const unregistered = await registeredUser(false)
   try {
      const doc = await (
         await request.post('/api/documents', {
            headers: owner.headers,
            data: { title: 'Protected management' },
         })
      ).json()
      expect(
         (
            await unregistered.client.auth.updateUser({
               data: { provider: 'github', providers: ['github'], sub: editor.id },
            })
         ).error,
      ).toBeNull()
      expect(
         (
            await owner.client.rpc('set_document_editor', {
               target_id: doc.id,
               editor_id: unregistered.id,
               enable: true,
            })
         ).error,
      ).not.toBeNull()
      expect(
         (
            await owner.client.rpc('set_document_editor', {
               target_id: doc.id,
               editor_id: owner.id,
               enable: true,
            })
         ).error,
      ).not.toBeNull()
      expect(
         (
            await owner.client.rpc('set_document_editor', {
               target_id: doc.id,
               editor_id: editor.id,
               enable: true,
            })
         ).error,
      ).toBeNull()
      expect(
         (
            await editor.client.rpc('set_document_editor', {
               target_id: doc.id,
               editor_id: unregistered.id,
               enable: true,
            })
         ).error,
      ).not.toBeNull()
      expect(
         (await editor.client.rpc('document_access_settings', { target_id: doc.id })).error,
      ).not.toBeNull()
      expect((await editor.client.from('document_editors').select()).error).not.toBeNull()
      expect(
         (await anonymous().rpc('set_document_share', { target_id: doc.id, enable: true })).error,
      ).not.toBeNull()
      const share = await (
         await request.post(`/api/documents/${doc.id}/share`, { headers: owner.headers })
      ).json()
      expect(
         (
            await request.post(`/api/documents/${doc.id}/share`, {
               headers: { ...owner.headers, origin: 'https://evil.example' },
            })
         ).status(),
      ).toBe(403)
      expect(
         (
            await request.delete(`/api/documents/${doc.id}/share`, { headers: owner.headers })
         ).status(),
      ).toBe(200)
      expect(
         (await request.post('/api/share/resolve', { data: { token: share.token } })).status(),
      ).toBe(404)
      expect(
         (await request.get(`/api/documents/${doc.id}`, { headers: editor.headers })).status(),
      ).toBe(200)
      expect(
         (await request.get(`/api/documents/${doc.id}`, { headers: owner.headers })).status(),
      ).toBe(200)
      expect(
         (await request.post('/auth/logout', { headers: owner.headers, maxRedirects: 0 })).status(),
      ).toBe(303)
      // This client retains its old legitimate access JWT, independently of the
      // cookie cleared by the HTTP logout. Database authorization must reject it.
      expect(
         (await owner.client.rpc('set_document_share', { target_id: doc.id, enable: true })).error,
      ).not.toBeNull()
      expect(
         (
            await owner.client.rpc('set_document_editor', {
               target_id: doc.id,
               editor_id: editor.id,
               enable: false,
            })
         ).error,
      ).not.toBeNull()
      expect(
         (await owner.client.rpc('document_access_settings', { target_id: doc.id })).error,
      ).not.toBeNull()
      expect((await owner.client.from('documents').select().eq('id', doc.id)).data).toEqual([])
      expect(
         (await request.get(`/api/documents/${doc.id}`, { headers: editor.headers })).status(),
      ).toBe(200)
   } finally {
      await unregistered.cleanup()
      await editor.cleanup()
      await owner.cleanup()
   }
})
