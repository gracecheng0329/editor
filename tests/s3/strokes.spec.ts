import { expect } from '@playwright/test'
import { registeredUser } from '../s1/sharing-fixtures'
import { checkpointRecords, openObjectPanel, test } from '../s2/canvas-fixtures'
import { attemptReadOnlyStrokeWrite } from '../s2/sync-probe'

async function drawStroke(page: import('@playwright/test').Page, x: number, y: number) {
   const canvas = page.locator('.tl-canvas').first()
   const bounds = await canvas.boundingBox()
   if (!bounds) throw new Error('Canvas drawing surface is not visible')
   const start = { x: bounds.x + x, y: bounds.y + y }
   const end = { x: start.x + 120, y: start.y + 45 }
   await page.mouse.move(start.x, start.y)
   await page.mouse.down()
   await page.mouse.move(start.x + 60, start.y + 22, { steps: 6 })
   await page.mouse.move(end.x, end.y, { steps: 6 })
   await page.mouse.up()
   return { start, end }
}

test('collaborators draw strokes with different colors and thicknesses', async ({
   participants: { alice, bob },
}) => {
   await openObjectPanel(alice)
   await openObjectPanel(bob)

   await alice.getByLabel('筆畫顏色').selectOption('blue')
   await alice.getByLabel('筆畫粗細').selectOption('l')
   await alice.getByRole('button', { name: '自由手繪工具', exact: true }).click()
   await drawStroke(alice, 440, 300)

   await expect(alice.getByLabel('畫布筆畫').getByRole('listitem')).toHaveCount(1)
   await expect(bob.getByLabel('畫布筆畫')).toContainText('藍色')
   await expect(bob.getByLabel('畫布筆畫')).toContainText('粗')

   await bob.getByLabel('筆畫顏色').selectOption('red')
   await bob.getByLabel('筆畫粗細').selectOption('s')
   await bob.getByRole('button', { name: '自由手繪工具', exact: true }).click()
   await drawStroke(bob, 440, 470)
   await expect(alice.getByLabel('畫布筆畫')).toContainText('紅色')
   await expect(alice.getByLabel('畫布筆畫')).toContainText('細')
   await expect(alice.getByLabel('畫布筆畫').getByRole('listitem')).toHaveCount(2)
   await expect(bob.getByLabel('保存狀態')).toHaveText('已確認持久化')

   const records = Object.values(await checkpointRecords(alice))
      .filter((record) => record.typeName === 'shape' && record.type === 'draw')
      .map((record) => record.props)
   expect(records).toEqual(
      expect.arrayContaining([
         expect.objectContaining({ color: 'blue', size: 'l' }),
         expect.objectContaining({ color: 'red', size: 's' }),
      ]),
   )
})

test('a stroke moves, scales and deletes as one object, and erasing it removes the whole stroke', async ({
   participants: { alice, bob },
}) => {
   await openObjectPanel(alice)
   await openObjectPanel(bob)

   await alice.getByLabel('筆畫顏色').selectOption('blue')
   await alice.getByLabel('筆畫粗細').selectOption('l')
   await alice.getByRole('button', { name: '自由手繪工具', exact: true }).click()
   await drawStroke(alice, 440, 300)

   await bob.getByLabel('筆畫顏色').selectOption('red')
   await bob.getByLabel('筆畫粗細').selectOption('s')
   await bob.getByRole('button', { name: '自由手繪工具', exact: true }).click()
   const redStroke = await drawStroke(bob, 440, 470)
   await expect(alice.getByLabel('畫布筆畫').getByRole('listitem')).toHaveCount(2)

   await alice.getByRole('button', { name: /選取筆畫 藍色/ }).click()
   const x = Number(await alice.getByLabel('物件 x').inputValue())
   await alice.getByLabel('物件 x').fill(String(x + 80))
   await alice.getByLabel('物件寬度').fill('240')
   await expect(bob.getByLabel('畫布筆畫')).toContainText(`x:${x + 80}`)
   await expect(bob.getByLabel('畫布筆畫')).toContainText('240 ×')

   await alice.getByRole('button', { name: '刪除選取物件', exact: true }).click()
   await expect(alice.getByLabel('畫布筆畫').getByRole('listitem')).toHaveCount(1)
   await expect(bob.getByLabel('畫布筆畫').getByRole('listitem')).toHaveCount(1)

   await bob.getByRole('button', { name: '整筆橡皮擦工具', exact: true }).click()
   const middle = {
      x: (redStroke.start.x + redStroke.end.x) / 2,
      y: (redStroke.start.y + redStroke.end.y) / 2,
   }
   await bob.mouse.move(middle.x - 20, middle.y - 15)
   await bob.mouse.down()
   await bob.mouse.move(middle.x + 20, middle.y + 15, { steps: 5 })
   await bob.mouse.up()
   await expect(alice.getByLabel('畫布筆畫').getByRole('listitem')).toHaveCount(0)
   await expect(bob.getByLabel('畫布筆畫').getByRole('listitem')).toHaveCount(0)
})

test('a confirmed stroke survives page reload and a real sync service restart', async ({
   participants: { alice, closeBob },
}) => {
   await openObjectPanel(alice)
   await alice.getByLabel('筆畫顏色').selectOption('green')
   await alice.getByLabel('筆畫粗細').selectOption('xl')
   await alice.getByRole('button', { name: '自由手繪工具', exact: true }).click()
   await drawStroke(alice, 440, 300)
   await expect(alice.getByLabel('保存狀態')).toHaveText('已確認持久化')

   const checkpoint = await checkpointRecords(alice)
   expect(
      Object.values(checkpoint).some(
         (record) =>
            record.typeName === 'shape' &&
            record.type === 'draw' &&
            record.props.color === 'green' &&
            record.props.size === 'xl',
      ),
   ).toBe(true)

   await closeBob()
   const restart = await fetch('http://127.0.0.1:8790/restart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.SYNC_TEST_SECRET}` },
   })
   expect(restart.status).toBe(200)
   const runtimes = await restart.json()
   expect(runtimes.runtimeId).not.toBe(runtimes.previousRuntimeId)

   await alice.reload()
   await openObjectPanel(alice)
   await expect(alice.getByLabel('畫布筆畫')).toContainText('綠色')
   await expect(alice.getByLabel('畫布筆畫')).toContainText('特粗')
   await expect(alice.getByLabel('保存狀態')).toHaveText('已確認持久化')
})

test('the sync service rejects a viewer stroke write sent through the public store API', async ({
   browser,
}) => {
   const owner = await registeredUser(false, 'Stroke owner')
   const ownerContext = await browser.newContext()
   const viewerContext = await browser.newContext()
   const origin = 'http://127.0.0.1:3102'
   try {
      await ownerContext.addCookies(
         owner.browserCookies().map((cookie) => ({ ...cookie, url: origin })),
      )
      const created = await ownerContext.request.post('/api/documents', {
         headers: { Origin: origin },
         data: { title: 'Stroke viewer write rejection' },
      })
      expect(created.status()).toBe(201)
      const document = await created.json()
      const share = await owner.client.rpc('set_document_share', {
         target_id: document.id,
         enable: true,
      })
      expect(share.error).toBeNull()
      expect(typeof share.data?.token).toBe('string')

      const ownerPage = await ownerContext.newPage()
      await ownerPage.goto(`/documents/${document.id}`)
      await openObjectPanel(ownerPage)
      await ownerPage.getByLabel('筆畫顏色').selectOption('green')
      await ownerPage.getByLabel('筆畫粗細').selectOption('xl')
      await ownerPage.getByRole('button', { name: '自由手繪工具', exact: true }).click()
      await drawStroke(ownerPage, 440, 300)
      await expect(ownerPage.getByLabel('保存狀態')).toHaveText('已確認持久化')

      const viewerPage = await viewerContext.newPage()
      await viewerPage.goto(`/share#${share.data.token}`)
      await expect(viewerPage.getByLabel('分享畫布')).toBeVisible()
      await expect(viewerPage.getByRole('button', { name: '自由手繪工具', exact: true })).toHaveCount(0)

      await attemptReadOnlyStrokeWrite(
         browser,
         document.id,
         share.data.token,
         'Unauthorized stroke write',
      )

      await ownerPage.reload()
      await openObjectPanel(ownerPage)
      await expect(ownerPage.getByLabel('畫布筆畫').getByRole('listitem')).toHaveCount(1)
      await expect(ownerPage.getByLabel('畫布筆畫')).not.toContainText('Unauthorized stroke write')
   } finally {
      await viewerContext.close()
      await ownerContext.close()
      await owner.cleanup()
   }
})
