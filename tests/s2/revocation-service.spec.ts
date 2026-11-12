import { expect, test } from '@playwright/test'
import { registeredUser } from '../s1/sharing-fixtures'

const origin = 'http://127.0.0.1:3102'
const service = 'http://127.0.0.1:8789'
const upgrade = {
   Origin: origin,
   Upgrade: 'websocket',
   Connection: 'Upgrade',
   'Sec-WebSocket-Version': '13',
   'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
}

test('share tickets follow token revocation while owner sessions remain valid', async ({
   request,
}) => {
   const owner = await registeredUser(false, 'Revocation service owner')
   try {
      const created = await request.post('/api/documents', {
         headers: { Origin: origin, ...owner.headers },
         data: { title: 'Revocation service contract' },
      })
      expect(created.status()).toBe(201)
      const document = (await created.json()) as { id: string }

      const share = await owner.client.rpc('set_document_share', {
         target_id: document.id,
         enable: true,
      })
      expect(share.error).toBeNull()
      expect(typeof share.data?.token).toBe('string')
      const token = share.data?.token as string
      const shareTicket = await request.post(`${service}/documents/${document.id}/session`, {
         headers: { Origin: origin, 'X-Share-Token': token },
      })
      expect(shareTicket.status()).toBe(200)
      expect(shareTicket.headers()['cache-control']).toContain('no-store')
      const issued = (await shareTicket.json()) as { ticket: string; expiresAt: number }
      expect(issued.expiresAt).toBeGreaterThan(Date.now())
      expect(issued.expiresAt - Date.now()).toBeLessThanOrEqual(60_000)

      const viewerCheckpoint = await request.post(
         `${service}/documents/${document.id}/checkpoint`,
         { headers: { Origin: origin, 'X-Share-Token': token } },
      )
      expect(viewerCheckpoint.status()).toBe(403)

      const unknownShare = await request.post(`${service}/documents/${document.id}/session`, {
         headers: { Origin: origin, 'X-Share-Token': 'A'.repeat(43) },
      })
      expect(unknownShare.status()).toBe(404)

      const ownerSession = (await owner.client.auth.getSession()).data.session
      expect(ownerSession).not.toBeNull()
      const ownerTicket = await request.post(`${service}/documents/${document.id}/session`, {
         headers: { Origin: origin, Authorization: `Bearer ${ownerSession?.access_token}` },
      })
      expect(ownerTicket.status()).toBe(200)
      const stillValidShare = await request.post(`${service}/documents/${document.id}/session`, {
         headers: { Origin: origin, 'X-Share-Token': token },
      })
      expect(stillValidShare.status()).toBe(200)

      const disabled = await owner.client.rpc('set_document_share', {
         target_id: document.id,
         enable: false,
      })
      expect(disabled.error).toBeNull()
      const deniedShareRenewal = await request.post(`${service}/documents/${document.id}/session`, {
         headers: { Origin: origin, 'X-Share-Token': token },
      })
      expect(deniedShareRenewal.status()).toBe(404)

      const invalidResolve = await request.post(`${origin}/api/share/resolve`, {
         headers: { Origin: origin },
         data: { token },
      })
      expect(invalidResolve.status()).toBe(404)

      await expect
         .poll(() => Date.now() >= issued.expiresAt, {
            timeout: Math.max(0, issued.expiresAt - Date.now()) + 2000,
         })
         .toBe(true)
      const staleTicket = await request.get(
         `${service}/documents/${document.id}?ticket=${encodeURIComponent(issued.ticket)}&sessionId=${crypto.randomUUID()}`,
         { headers: upgrade },
      )
      expect(staleTicket.status()).toBe(401)
   } finally {
      await owner.cleanup()
   }
})
