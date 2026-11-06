import { expect, test } from '@playwright/test'
import { openCollaborator } from './helpers'

test("TV-05a: personal undo keeps the other collaborator's unrelated move", async ({ browser }) => {
   const a = await openCollaborator(browser)
   let b: Awaited<ReturnType<typeof openCollaborator>> | undefined
   try {
      await a.add('OBJECT-A')
      await a.add('OBJECT-B')
      b = await openCollaborator(browser, a.room)
      await expect(b.page.getByLabel('物件數')).toHaveText('2')
      await a.page.getByLabel('新物件標記').fill('OBJECT-A')
      await a.page.getByRole('button', { name: '移動標記物件' }).click()
      await expect(b.page.getByLabel('物件位置')).toHaveText('OBJECT-A:140,OBJECT-B:140')
      await b.page.getByLabel('新物件標記').fill('OBJECT-B')
      await b.page.getByRole('button', { name: '移動標記物件' }).click()
      await expect(a.page.getByLabel('物件位置')).toHaveText('OBJECT-A:140,OBJECT-B:180')
      await a.page.getByRole('button', { name: '撤回我的操作' }).click()
      for (const page of [a.page, b.page]) {
         await expect(page.getByLabel('物件位置')).toHaveText('OBJECT-A:100,OBJECT-B:180')
         await expect(page.getByLabel('物件數')).toHaveText('2')
      }
   } finally {
      await a.context.close()
      await b?.context.close()
   }
})
