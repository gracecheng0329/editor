import { expect, test } from '@playwright/test'
import { registeredUser } from '../s1/sharing-fixtures'

test('owner edits architecture nodes on the formal document canvas and reopens confirmed content', async ({
   browser,
}) => {
   const owner = await registeredUser(false)
   const context = await browser.newContext()
   try {
      await context.addCookies(
         owner.browserCookies().map((cookie) => ({ ...cookie, url: 'http://127.0.0.1:3102' })),
      )
      const creation = await context.request.post('/api/documents', {
         headers: { Origin: 'http://127.0.0.1:3102' },
         data: { title: 'Owner canvas' },
      })
      expect(creation.status()).toBe(201)
      const document = await creation.json()
      const page = await context.newPage()
      await page.goto(`/documents/${document.id}`)
      await expect(page.getByRole('button', { name: '新增節點', exact: true })).toBeVisible()
      await page.getByLabel('新增節點名稱').fill('API service')
      await page.getByRole('button', { name: '新增節點', exact: true }).click()
      await expect(page.getByLabel('畫布節點')).toContainText('API service')
      await expect(page.getByLabel('保存狀態')).toHaveText('已確認持久化')
      const restart = await fetch('http://127.0.0.1:8790/restart', {
         method: 'POST',
         headers: { Authorization: `Bearer ${process.env.SYNC_TEST_SECRET}` },
      })
      expect(restart.status).toBe(200)
      const runtimes = await restart.json()
      expect(runtimes.runtimeId).not.toBe(runtimes.previousRuntimeId)
      await page.reload()
      await expect(page.getByLabel('畫布節點')).toContainText('API service')
      await page.getByRole('button', { name: '選取 API service', exact: true }).click()
      await page.getByLabel('選取節點名稱').fill('Renamed service')
      await page.getByRole('button', { name: '向右移動節點', exact: true }).click()
      await expect(page.getByLabel('保存狀態')).toHaveText('已確認持久化')
      await page.reload()
      await expect(page.getByLabel('畫布節點')).toContainText('Renamed service')
      await expect(page.getByLabel('畫布節點')).toContainText('x:140')
      await expect(page.getByLabel('保存狀態')).toHaveText('已確認持久化')
      await page
         .getByLabel('文件畫布', { exact: true })
         .screenshot({ path: '/private/tmp/editor-s2-owner.png' })
      await page.getByRole('button', { name: '選取 Renamed service', exact: true }).click()
      await page.getByRole('button', { name: '刪除選取節點', exact: true }).click()
      await expect(page.getByLabel('保存狀態')).toHaveText('已確認持久化')
      await page.reload()
      await expect(page.getByLabel('畫布節點')).not.toContainText('Renamed service')
      await expect(page.getByLabel('保存狀態')).toHaveText('已確認持久化')
   } finally {
      await context.close()
      await owner.cleanup()
   }
})
