import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { checkpointRecords, openObjectPanel, test } from '../s2/canvas-fixtures'

async function drawStroke(page: import('@playwright/test').Page) {
   const canvas = page.locator('.tl-canvas').first()
   const bounds = await canvas.boundingBox()
   if (!bounds) throw new Error('Canvas drawing surface is not visible')

   const start = { x: bounds.x + 440, y: bounds.y + 300 }
   await page.mouse.move(start.x, start.y)
   await page.mouse.down()
   await page.mouse.move(start.x + 60, start.y + 24, { steps: 6 })
   await page.mouse.move(start.x + 120, start.y + 48, { steps: 6 })
   await page.mouse.up()
}

test('smoke: a locally authenticated editor saves and reloads a stroke', async ({
   participants: { alice, bob },
}) => {
   await openObjectPanel(alice)
   await alice.getByLabel('筆畫顏色').selectOption('green')
   await alice.getByLabel('筆畫粗細').selectOption('m')
   await alice.getByRole('button', { name: '自由手繪工具', exact: true }).click()
   await drawStroke(alice)

   await expect(alice.getByLabel('畫布筆畫').getByRole('listitem')).toHaveCount(1)
   await expect(bob.getByLabel('畫布筆畫')).toContainText('綠色')
   await expect(bob.getByLabel('畫布筆畫')).toContainText('中')
   await expect(alice.getByLabel('保存狀態')).toHaveText('已確認持久化')

   const records = Object.values(await checkpointRecords(alice))
   assert(
      records.some(
         (record) =>
            record.typeName === 'shape' &&
            record.type === 'draw' &&
            record.props.color === 'green' &&
            record.props.size === 'm',
      ),
      'The local authoritative checkpoint contains the saved green medium stroke',
   )

   await alice.reload()
   await openObjectPanel(alice)
   await expect(alice.getByLabel('畫布筆畫').getByRole('listitem')).toHaveCount(1)
   await expect(alice.getByLabel('畫布筆畫')).toContainText('綠色')
   await expect(alice.getByLabel('畫布筆畫')).toContainText('中')
   await expect(alice.getByLabel('保存狀態')).toHaveText('已確認持久化')
})
