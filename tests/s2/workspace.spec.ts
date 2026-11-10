import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { checkpointRecords, test } from './canvas-fixtures'

test.use({ objectPanel: false })

test('formal documents use the shared FigJam workspace with real synchronization and no prototype data', async ({
   participants: { alice, bob },
}) => {
   await expect(alice.getByRole('navigation', { name: '畫布工具列' })).toBeVisible()
   await expect(alice.getByLabel('架構元件庫')).toBeVisible()
   await expect(alice.getByLabel('節點工具')).toHaveCount(0)
   await expect(alice.getByText('本機模式', { exact: true })).toHaveCount(0)
   await expect(alice.getByLabel('文件標題', { exact: true })).toHaveValue('Collaboration')
   await alice.getByLabel('文件標題', { exact: true }).fill('Shared workspace')
   await alice.getByRole('button', { name: '儲存標題', exact: true }).click()
   await expect(alice.getByText('標題已儲存。', { exact: true })).toBeVisible()
   await alice.getByRole('button', { name: '服務 API 與應用程式' }).click()
   await expect(bob.locator('.architecture-node').filter({ hasText: '服務' })).toBeVisible({
      timeout: 2000,
   })
   await alice.getByLabel('架構節點名稱', { exact: true }).fill('Shared API')
   await expect(bob.locator('.architecture-node')).toContainText('Shared API', { timeout: 2000 })
   await expect(alice.getByLabel('保存狀態')).toHaveText('已確認持久化')
   await alice.getByRole('button', { name: '留言討論', exact: true }).click()
   await expect(alice.getByLabel('留言面板')).toContainText('S4')
   await expect(alice.getByLabel('留言內容')).toHaveCount(0)
   await alice.getByRole('button', { name: '關閉側欄', exact: true }).click()
   await alice.getByRole('button', { name: '版本歷史', exact: true }).click()
   await expect(alice.getByLabel('版本面板')).toContainText('S5')
   await expect(alice.getByRole('button', { name: '建立本機里程碑' })).toHaveCount(0)
   await alice.getByRole('button', { name: '關閉側欄', exact: true }).click()
   await alice.getByRole('button', { name: '分享', exact: true }).click()
   await expect(alice.getByLabel('文件存取設定')).toBeVisible()
   await expect(alice.getByRole('button', { name: '啟用觀看連結', exact: true })).toBeEnabled()
   await alice.getByRole('button', { name: '關閉對話框', exact: true }).click()
   const records = await checkpointRecords(alice)
   expect(Object.values(records).filter((record) => record.typeName === 'shape')).toHaveLength(1)
   await alice.reload()
   await expect(alice.getByLabel('文件標題', { exact: true })).toHaveValue('Shared workspace')
   await expect(alice.locator('.architecture-node')).toContainText('Shared API')
   await alice.screenshot({ path: '/private/tmp/editor-formal-figjam.png' })
})

test('document metadata and access remain available when canvas authentication fails', async ({
   participants: { alice },
}) => {
   await alice.route('**/sync-session', (route) =>
      route.fulfill({ status: 503, body: 'Unavailable' }),
   )
   await alice.reload()
   await expect(alice.getByText('同步連線失敗，請重試。', { exact: true })).toBeVisible()
   await alice.getByLabel('文件標題', { exact: true }).fill('Metadata remains available')
   await alice.getByRole('button', { name: '儲存標題', exact: true }).click()
   await expect(alice.getByLabel('標題儲存結果')).toHaveText('標題已儲存。')
   await alice.getByRole('button', { name: '分享', exact: true }).click()
   await expect(alice.getByLabel('文件存取設定')).toBeVisible()
   await alice.getByRole('button', { name: '關閉對話框', exact: true }).click()
   await alice.unroute('**/sync-session')
   await alice.getByRole('button', { name: '重新連線', exact: true }).click()
   await expect(alice.getByLabel('保存狀態', { exact: true })).toHaveText('已確認持久化')
   await expect(alice.getByLabel('文件標題', { exact: true })).toHaveValue(
      'Metadata remains available',
   )
})

test('the prototype keeps its local workspace and draft independently', async ({ page }) => {
   await page.goto('/prototype')
   await expect(page.getByRole('navigation', { name: '畫布工具列' })).toBeVisible()
   await expect(page.getByText('本機模式', { exact: true })).toBeVisible()
   await page.getByLabel('文件名稱', { exact: true }).fill('Prototype draft')
   await page.reload()
   await expect(page.getByLabel('文件名稱', { exact: true })).toHaveValue('Prototype draft')
   await page.getByRole('button', { name: '留言討論', exact: true }).click()
   await expect(page.getByLabel('留言內容')).toBeVisible()
   await expect(page.getByText('本機預覽 · 尚未同步至雲端', { exact: true })).toBeVisible()
})

test('an open share dialog survives the canvas connecting', async ({ participants: { alice } }) => {
   let release: (() => Promise<void>) | undefined
   let hold = true
   await alice.route('**/sync-session', async (route) => {
      if (!hold) return route.continue()
      hold = false
      const response = await route.fetch()
      release = () => route.fulfill({ response })
   })
   await alice.reload()
   await expect.poll(() => Boolean(release)).toBe(true)
   await alice.getByRole('button', { name: '分享', exact: true }).click()
   await expect(alice.getByLabel('文件存取設定')).toBeVisible()
   assert(release, 'Expected a held real authorization response')
   await release()
   await expect(alice.getByRole('navigation', { name: '畫布工具列' })).toBeVisible()
   await expect(alice.getByLabel('文件存取設定')).toBeVisible()
   await alice.getByRole('button', { name: '啟用觀看連結', exact: true }).click()
   await expect(alice.getByLabel('觀看連結', { exact: true })).toHaveValue(/\/share#.+/)
})
