import { test as base, expect, type Page } from '@playwright/test'
import { registeredUser } from '../s1/sharing-fixtures'

const origin = 'http://127.0.0.1:3102'
export const test = base.extend<{
   objectPanel: boolean
   participants: { alice: Page; bob: Page; closeBob: () => Promise<void> }
}>({
   objectPanel: [true, { option: true }],
   participants: async ({ browser, objectPanel }, runWith) => {
      const owner = await registeredUser(true, 'Alice')
      const editor = await registeredUser(true, 'Bob')
      const a = await browser.newContext()
      const b = await browser.newContext()
      try {
         await a.addCookies(owner.browserCookies().map((cookie) => ({ ...cookie, url: origin })))
         await b.addCookies(editor.browserCookies().map((cookie) => ({ ...cookie, url: origin })))
         const created = await a.request.post('/api/documents', {
            headers: { Origin: origin },
            data: { title: 'Collaboration' },
         })
         expect(created.status()).toBe(201)
         const doc = await created.json()
         expect(
            (
               await a.request.post(`/api/documents/${doc.id}/editors`, {
                  headers: { Origin: origin },
                  data: { userId: editor.id },
               })
            ).status(),
         ).toBe(200)
         const alice = await a.newPage()
         const bob = await b.newPage()
         await Promise.all([alice.goto(`/documents/${doc.id}`), bob.goto(`/documents/${doc.id}`)])
         await expect(alice.getByLabel('協作者')).toContainText('Bob')
         await expect(bob.getByLabel('協作者')).toContainText('Alice')
         if (objectPanel) await Promise.all([openObjectPanel(alice), openObjectPanel(bob)])
         await runWith({ alice, bob, closeBob: () => b.close() })
      } finally {
         await a.close()
         await b.close()
         await editor.cleanup()
         await owner.cleanup()
      }
   },
})

export async function addNode(page: Page, name: string) {
   await page.getByLabel('新增節點名稱').fill(name)
   await page.getByRole('button', { name: '新增節點', exact: true }).click()
}
export async function selectNode(page: Page, name: string) {
   await page.getByRole('button', { name: `選取 ${name}`, exact: true }).click()
}

/** Inspect only the documented, authenticated authoritative checkpoint contract. */
export async function checkpointRecords(page: Page) {
   const documentId = new URL(page.url()).pathname.split('/').at(-1)
   const session = await page.request.get(`/api/documents/${documentId}/sync-session`)
   expect(session.status()).toBe(200)
   const { accessToken } = await session.json()
   const response = await page.request.post(
      `http://127.0.0.1:8789/documents/${documentId}/checkpoint`,
      {
         headers: { Origin: origin, Authorization: `Bearer ${accessToken}` },
      },
   )
   expect(response.status()).toBe(200)
   const checkpoint: { snapshot: { store: Record<string, import('@tldraw/tlschema').TLRecord> } } =
      await response.json()
   return checkpoint.snapshot.store
}

export async function openObjectPanel(page: Page) {
   if (!(await page.getByLabel('節點工具', { exact: true }).isVisible()))
      await page.getByRole('button', { name: '物件與連線', exact: true }).click()
}
