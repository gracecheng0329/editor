import { expect, test } from '@playwright/test'
import { registeredUser } from './sharing-fixtures'

test('short invitation route uses UUIDs even when GitHub display names match', async ({
   request,
}) => {
   const owner = await registeredUser()
   const editor = await registeredUser(true, owner.displayName)
   try {
      const creation = await request.post('/api/documents', {
         headers: owner.headers,
         data: { title: 'ID invitation' },
      })
      expect(creation.status()).toBe(201)
      const doc = await creation.json()
      const path = `/api/docs/${doc.id}/editors`
      for (const data of [
         { displayName: editor.displayName },
         { userId: '9gvm2xnZ41EQdyrVpmRxb' },
         { userId: '   ' },
      ]) {
         expect((await request.post(path, { headers: owner.headers, data })).status()).toBe(422)
      }
      expect(
         (
            await request.post(path, {
               headers: owner.headers,
               data: { userId: editor.id },
            })
         ).status(),
      ).toBe(200)
      const settings = await request.get(path, { headers: owner.headers })
      expect(settings.status()).toBe(200)
      expect((await settings.json()).editors).toEqual([
         { user_id: editor.id, display_name: editor.displayName },
      ])
      expect(
         (
            await request.post(path, {
               headers: editor.headers,
               data: { userId: owner.id },
            })
         ).status(),
      ).toBe(404)
      expect(
         (await request.delete(`${path}/${editor.id}`, { headers: owner.headers })).status(),
      ).toBe(200)
      expect((await editor.client.from('documents').select().eq('id', doc.id)).data).toEqual([])
   } finally {
      await editor.cleanup()
      await owner.cleanup()
   }
})
