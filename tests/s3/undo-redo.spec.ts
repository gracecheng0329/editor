import { expect } from '@playwright/test'
import {
   addNode,
   checkpointRecords,
   openObjectPanel,
   selectNode,
   test,
} from '../s2/canvas-fixtures'

async function expectSavedNodePosition(
   page: import('@playwright/test').Page,
   title: string,
   x: number,
) {
   await expect(page.getByLabel('保存狀態')).toHaveText('已確認持久化')
   const records = Object.values(await checkpointRecords(page))
   const node = records.find(
      (record) =>
         record.typeName === 'shape' &&
         record.type === 'architecture-node' &&
         record.props.title === title,
   )
   expect(node && 'x' in node ? node.x : undefined).toBe(x)
}

async function drawStroke(page: import('@playwright/test').Page) {
   const canvas = page.locator('.tl-canvas').first()
   const bounds = await canvas.boundingBox()
   if (!bounds) throw new Error('Canvas drawing surface is not visible')
   await page.mouse.move(bounds.x + 440, bounds.y + 300)
   await page.mouse.down()
   await page.mouse.move(bounds.x + 560, bounds.y + 345, { steps: 8 })
   await page.mouse.up()
}

async function undoAndRedo(page: import('@playwright/test').Page, label: string) {
   await page.getByRole('button', { name: '復原我的操作', exact: true }).click()
   await expect(page.getByLabel(label)).toHaveCount(0)
   await page.getByRole('button', { name: '重做我的操作', exact: true }).click()
   await expect(page.getByLabel(label)).toHaveCount(1)
}

test('personal undo and redo preserve a collaborator’s unrelated canvas change', async ({
   participants: { alice, bob },
}) => {
   await addNode(alice, 'UNDO-NODE')
   await addNode(bob, 'REMOTE-NODE')
   await expect(alice.getByLabel('畫布節點')).toContainText('REMOTE-NODE (x:380')

   await selectNode(alice, 'UNDO-NODE')
   await alice.getByRole('button', { name: '向右移動節點' }).click()
   await selectNode(bob, 'REMOTE-NODE')
   await bob.getByRole('button', { name: '向右移動節點' }).click()
   await expect(alice.getByLabel('畫布節點')).toContainText('UNDO-NODE (x:140')
   await expect(alice.getByLabel('畫布節點')).toContainText('REMOTE-NODE (x:420')

   await alice.getByRole('button', { name: '復原我的操作', exact: true }).click()
   for (const page of [alice, bob]) {
      await expect(page.getByLabel('畫布節點')).toContainText('UNDO-NODE (x:100')
      await expect(page.getByLabel('畫布節點')).toContainText('REMOTE-NODE (x:420')
      await expectSavedNodePosition(page, 'UNDO-NODE', 100)
      await expectSavedNodePosition(page, 'REMOTE-NODE', 420)
   }

   await alice.getByRole('button', { name: '重做我的操作', exact: true }).click()
   for (const page of [alice, bob]) {
      await expect(page.getByLabel('畫布節點')).toContainText('UNDO-NODE (x:140')
      await expect(page.getByLabel('畫布節點')).toContainText('REMOTE-NODE (x:420')
      await expectSavedNodePosition(page, 'UNDO-NODE', 140)
      await expectSavedNodePosition(page, 'REMOTE-NODE', 420)
   }
})

test('undo and redo cover connections, text, and whole strokes', async ({
   participants: { alice },
}) => {
   await openObjectPanel(alice)
   await addNode(alice, 'NODE-A')
   await addNode(alice, 'NODE-B')

   await alice.getByLabel('連線起點', { exact: true }).selectOption({ label: 'NODE-A' })
   await alice.getByLabel('連線終點', { exact: true }).selectOption({ label: 'NODE-B' })
   await alice.getByLabel('新增連線標籤').fill('DEPENDS-ON')
   await alice.getByRole('button', { name: '新增連線', exact: true }).click()
   await expect(alice.getByLabel('畫布連線')).toContainText('DEPENDS-ON')
   await undoAndRedo(alice, '選取連線 DEPENDS-ON')

   await alice.getByLabel('新增文字內容').fill('REVIEW-NOTE')
   await alice.getByRole('button', { name: '新增文字', exact: true }).click()
   await expect(alice.getByLabel('畫布文字')).toContainText('REVIEW-NOTE')
   await undoAndRedo(alice, '選取文字 REVIEW-NOTE')

   await alice.getByRole('button', { name: '自由手繪工具', exact: true }).click()
   await drawStroke(alice)
   await expect(alice.getByLabel('畫布筆畫').getByRole('listitem')).toHaveCount(1)
   await alice.getByRole('button', { name: '復原我的操作', exact: true }).click()
   await expect(alice.getByLabel('畫布筆畫').getByRole('listitem')).toHaveCount(0)
   await alice.getByRole('button', { name: '重做我的操作', exact: true }).click()
   await expect(alice.getByLabel('畫布筆畫').getByRole('listitem')).toHaveCount(1)
})
