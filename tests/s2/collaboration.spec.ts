import assert from 'node:assert/strict'
import { test as base, expect, type Page } from '@playwright/test'
import { registeredUser } from '../s1/sharing-fixtures'

const origin = 'http://127.0.0.1:3102'
const test = base.extend<{
   participants: { alice: Page; bob: Page; closeBob: () => Promise<void> }
}>({
   participants: async ({ browser }, runWith) => {
      const owner = await registeredUser()
      const editor = await registeredUser()
      const a = await browser.newContext()
      const b = await browser.newContext()
      try {
         await owner.client.auth.updateUser({ data: { name: 'Alice' } })
         await editor.client.auth.updateUser({ data: { name: 'Bob' } })
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
         await runWith({ alice, bob, closeBob: () => b.close() })
      } finally {
         await a.close()
         await b.close()
         await editor.cleanup()
         await owner.cleanup()
      }
   },
})

async function addNode(page: Page, name: string) {
   await page.getByLabel('新增節點名稱').fill(name)
   await page.getByRole('button', { name: '新增節點', exact: true }).click()
}
async function selectNode(page: Page, name: string) {
   await page.getByRole('button', { name: `選取 ${name}`, exact: true }).click()
}

test('collaborators see identities and a live cursor until disconnect', async ({
   participants: { alice, bob, closeBob },
}) => {
   await addNode(alice, 'Shared service')
   await expect(bob.getByLabel('畫布節點')).toContainText('Shared service', { timeout: 2000 })
   const canvas = alice.getByLabel('文件畫布', { exact: true })
   await Promise.all([
      canvas.scrollIntoViewIfNeeded(),
      bob.getByLabel('文件畫布', { exact: true }).scrollIntoViewIfNeeded(),
   ])
   const box = await canvas.boundingBox()
   assert(box, 'Expected the canvas to have layout bounds')
   let cursorMove = 0
   await expect
      .poll(
         async () => {
            cursorMove += 1
            await alice.mouse.move(box.x + 280 + (cursorMove % 20), box.y + 230 + (cursorMove % 20))
            return bob.locator('.tl-collaborator__cursor').isVisible()
         },
         { timeout: 10000 },
      )
      .toBe(true)
   await bob
      .getByLabel('文件畫布', { exact: true })
      .screenshot({ path: '/private/tmp/editor-s2-collaboration.png' })
   await closeBob()
   await expect(alice.getByLabel('協作者')).not.toContainText('Bob')
   await alice.reload()
   await expect(alice.getByLabel('協作者')).not.toContainText('Bob')
   await expect(alice.locator('.tl-collaborator__cursor')).toHaveCount(0)
})

test('both editors see node creation, editing, movement and deletion within two seconds', async ({
   participants: { alice, bob },
}) => {
   await addNode(alice, 'Shared service')
   await expect(bob.getByLabel('畫布節點')).toContainText('Shared service', { timeout: 2000 })
   await selectNode(bob, 'Shared service')
   await bob.getByLabel('選取節點名稱').fill('Edited by Bob')
   await expect(alice.getByLabel('畫布節點')).toContainText('Edited by Bob', { timeout: 2000 })
   await bob.getByRole('button', { name: '向右移動節點' }).click()
   await expect(alice.getByLabel('畫布節點')).toContainText('x:140', { timeout: 2000 })
   await addNode(bob, 'Temporary node')
   await expect(alice.getByLabel('畫布節點')).toContainText('Temporary node', { timeout: 2000 })
   await selectNode(alice, 'Temporary node')
   await alice.getByRole('button', { name: '刪除選取節點' }).click()
   await expect(bob.getByLabel('畫布節點')).not.toContainText('Temporary node', { timeout: 2000 })
})

test('each editor keeps their own selection and viewport', async ({
   participants: { alice, bob },
}) => {
   await addNode(alice, 'Shared service')
   await expect(bob.getByLabel('畫布節點')).toContainText('Shared service', { timeout: 2000 })
   await selectNode(bob, 'Shared service')
   await expect(alice.getByLabel('選取節點名稱')).toHaveCount(0)
   await selectNode(alice, 'Shared service')
   const bobShape = bob.locator('.tl-shape').filter({ hasText: 'Shared service' }).first()
   const aliceShape = alice.locator('.tl-shape').filter({ hasText: 'Shared service' }).first()
   const beforeBob = await bobShape.boundingBox()
   const beforeAlice = await aliceShape.boundingBox()
   const canvas = alice.getByLabel('文件畫布', { exact: true })
   const box = await canvas.boundingBox()
   assert(box, 'Expected the canvas to have layout bounds')
   await alice.mouse.move(box.x + 350, box.y + 300)
   await alice.mouse.wheel(0, -400)
   await expect.poll(async () => aliceShape.boundingBox()).not.toEqual(beforeAlice)
   await expect.poll(async () => bobShape.boundingBox()).toEqual(beforeBob)
   await alice.mouse.click(box.x + 40, box.y + 40)
   await expect(bob.getByLabel('選取節點名稱')).toHaveValue('Shared service')
})

test('simultaneous moves of the same node converge without a duplicate', async ({
   participants: { alice, bob },
}) => {
   await addNode(alice, 'Shared service')
   await expect(bob.getByLabel('畫布節點')).toContainText('Shared service', { timeout: 2000 })
   await Promise.all([selectNode(alice, 'Shared service'), selectNode(bob, 'Shared service')])
   await Promise.all([
      alice.getByRole('button', { name: '向右移動節點' }).click(),
      bob.getByRole('button', { name: '向右移動節點' }).click(),
   ])
   await expect
      .poll(
         async () =>
            (await alice.getByLabel('畫布節點').textContent()) ===
            (await bob.getByLabel('畫布節點').textContent()),
         { timeout: 5000 },
      )
      .toBe(true)
   await expect(alice.getByLabel('畫布節點').getByRole('listitem')).toHaveCount(1)
   await expect(bob.getByLabel('畫布節點').getByRole('listitem')).toHaveCount(1)
})

test('both editors’ confirmed changes survive reopening and a service restart', async ({
   participants: { alice, bob, closeBob },
}) => {
   await addNode(alice, 'Shared service')
   await expect(bob.getByLabel('畫布節點')).toContainText('Shared service', { timeout: 2000 })
   await selectNode(bob, 'Shared service')
   await bob.getByLabel('選取節點名稱').fill('Edited by Bob')
   await bob.getByRole('button', { name: '向右移動節點' }).click()
   await expect(alice.getByLabel('畫布節點')).toContainText('x:140', { timeout: 2000 })
   await expect(bob.getByLabel('保存狀態')).toHaveText('已確認持久化')
   await expect(alice.getByLabel('保存狀態')).toHaveText('已確認持久化')
   await closeBob()
   const restart = await fetch('http://127.0.0.1:8790/restart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.SYNC_TEST_SECRET}` },
   })
   expect(restart.status).toBe(200)
   const runtimes = await restart.json()
   expect(runtimes.runtimeId).not.toBe(runtimes.previousRuntimeId)
   await alice.reload()
   await expect(alice.getByLabel('畫布節點')).toContainText('Edited by Bob')
   await expect(alice.getByLabel('畫布節點')).toContainText('x:140')
   await selectNode(alice, 'Edited by Bob')
   await alice.getByRole('button', { name: '刪除選取節點' }).click()
   await expect(alice.getByLabel('保存狀態')).toHaveText('已確認持久化')
   await alice.reload()
   await expect(alice.getByLabel('畫布節點')).not.toContainText('Edited by Bob')
})
