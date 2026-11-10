import { expect } from '@playwright/test'
import { checkpointRecords, test } from './canvas-fixtures'

test.use({ objectPanel: false })

test('the sharing dialog keeps Delete away from the selected canvas node', async ({
   participants: { alice, bob },
}) => {
   await alice.getByRole('button', { name: '服務 API 與應用程式' }).click()
   await expect(bob.locator('.architecture-node')).toContainText('服務', { timeout: 2000 })
   await expect(alice.getByLabel('架構節點名稱', { exact: true })).toHaveValue('服務', {
      timeout: 2000,
   })
   await expect(alice.getByLabel('保存狀態', { exact: true })).toHaveText('已確認持久化')
   await alice.getByRole('button', { name: '分享', exact: true }).click()
   await alice.getByRole('button', { name: '關閉對話框', exact: true }).focus()
   await alice.keyboard.press('Delete')
   await expect(alice.getByLabel('架構節點名稱', { exact: true })).toHaveValue('服務', {
      timeout: 2000,
   })
   await alice.getByRole('button', { name: '關閉對話框', exact: true }).click()
   await expect(alice.getByLabel('保存狀態', { exact: true })).toHaveText('已確認持久化')
   const records = Object.values(await checkpointRecords(alice))
   expect(records.filter((record) => record.typeName === 'shape')).toHaveLength(1)
})
