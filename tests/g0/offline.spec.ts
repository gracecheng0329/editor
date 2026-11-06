import { expect, test } from '@playwright/test'
import { openCollaborator } from './helpers'

test("TV-03: same-generation reconnect keeps both collaborators' independent additions", async ({
   browser,
}) => {
   const a = await openCollaborator(browser)
   const b = await openCollaborator(browser, a.room)
   try {
      await a.disconnect()
      await a.add('OFFLINE-A')
      await expect(a.page.getByLabel('保存狀態')).toHaveText('離線／待同步')
      await b.add('ONLINE-B')
      await expect(b.page.getByLabel('物件數')).toHaveText('1')
      await a.reconnect()
      await expect(a.page.getByLabel('同步狀態')).toHaveText('online', { timeout: 10_000 })
      for (const page of [a.page, b.page]) {
         await expect(page.getByLabel('節點內容')).toHaveText('OFFLINE-A,ONLINE-B', {
            timeout: 5_000,
         })
         await expect(page.getByLabel('物件數')).toHaveText('2')
      }
   } finally {
      await a.context.close()
      await b.context.close()
   }
})
