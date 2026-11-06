import assert from 'node:assert/strict'
import { expect, test } from '@playwright/test'
import { openCollaborator } from './helpers'

test('TV-04: confirmed authoritative snapshots survive workerd restart and preview is isolated', async ({
   browser,
   request,
}) => {
   const owner = await openCollaborator(browser)
   const observer = await openCollaborator(browser, owner.room)
   try {
      await owner.add('BEFORE-SNAPSHOT')
      await expect(observer.page.getByLabel('節點內容')).toHaveText('BEFORE-SNAPSHOT')
      await owner.page.getByRole('button', { name: '建立權威快照' }).click()
      await expect(owner.page.getByLabel('保存狀態')).toHaveText('已確認持久化')
      const firstVersion = await owner.page.getByLabel('版本ID').textContent()
      assert(firstVersion, 'Expected a saved version ID')

      await owner.add('AFTER-SNAPSHOT')
      await expect(owner.page.getByLabel('保存狀態')).toHaveText('尚未確認保存')
      await expect(observer.page.getByLabel('物件數')).toHaveText('2')
      await owner.page.getByRole('button', { name: '預覽快照' }).click()
      await expect(owner.page.getByLabel('預覽內容')).toHaveText('BEFORE-SNAPSHOT')
      for (const page of [owner.page, observer.page]) {
         await expect(page.getByLabel('節點內容', { exact: true })).toHaveText(
            'AFTER-SNAPSHOT,BEFORE-SNAPSHOT',
         )
      }
      await owner.page.getByRole('button', { name: '建立權威快照' }).click()
      await expect(owner.page.getByLabel('保存狀態')).toHaveText('已確認持久化')
      await expect(owner.page.getByLabel('版本ID')).not.toHaveText(firstVersion)
      const latestVersion = await owner.page.getByLabel('版本ID').textContent()
      await owner.context.close()
      await observer.context.close()

      const restarted = await request.post('http://127.0.0.1:8788/restart', {
         headers: { Authorization: `Bearer ${process.env.G0_TEST_SECRET}` },
      })
      expect(restarted.status()).toBe(200)
      const restart = await restarted.json()
      expect(restart.runtimeId).not.toBe(restart.previousRuntimeId)
      const reopened = await openCollaborator(browser, owner.room)
      try {
         await expect(reopened.page.getByLabel('節點內容')).toHaveText(
            'AFTER-SNAPSHOT,BEFORE-SNAPSHOT',
         )
         for (const [id, labels] of [
            [firstVersion, ['BEFORE-SNAPSHOT']],
            [latestVersion, ['AFTER-SNAPSHOT', 'BEFORE-SNAPSHOT']],
         ] as const) {
            const result = await request.get(
               `http://127.0.0.1:8787/rooms/${owner.room}/snapshots/${id}?token=${reopened.token}`,
               {
                  headers: { Origin: 'http://127.0.0.1:3100' },
               },
            )
            expect(result.status()).toBe(200)
            const saved = await result.json()
            expect(saved.labels).toEqual(labels)
            expect(saved.revision).toBeGreaterThan(0)
            expect(saved.generation).toBe(0)
         }
      } finally {
         await reopened.context.close()
      }
   } finally {
      await owner.context.close()
      await observer.context.close()
   }
})
