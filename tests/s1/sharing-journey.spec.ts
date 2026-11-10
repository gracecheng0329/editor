import { expect, test } from '@playwright/test'
import { registeredUser } from './sharing-fixtures'

test('owner invites an editor and shares with an anonymous viewer through separate browser contexts', async ({
   browser,
}) => {
   test.setTimeout(90_000)
   const owner = await registeredUser()
   const editor = await registeredUser()
   const ownerContext = await browser.newContext()
   const editorContext = await browser.newContext()
   const viewerContext = await browser.newContext()
   try {
      await ownerContext.addCookies(owner.browserCookies())
      await editorContext.addCookies(editor.browserCookies())
      const ownerPage = await ownerContext.newPage()
      ownerPage.setDefaultTimeout(10000)
      const editorPage = await editorContext.newPage()
      editorPage.setDefaultTimeout(10000)
      await editorPage.goto('/documents')
      await expect(editorPage.getByText(editor.id, { exact: true })).toBeVisible()
      await expect(editorPage.locator('nav .account-actions:visible')).toHaveText(
         `${editor.displayName}登出`,
      )
      await ownerPage.goto('/documents')
      await ownerPage.getByLabel('新文件標題').fill('Shared browser architecture')
      await ownerPage.getByRole('button', { name: '建立文件' }).click()
      const [ownerRead] = await Promise.all([
         ownerPage.waitForResponse(
            (response) =>
               /\/api\/documents\/[^/]+$/.test(new URL(response.url()).pathname) &&
               response.request().method() === 'GET',
            { timeout: 10000 },
         ),
         ownerPage.getByRole('link', { name: 'Shared browser architecture' }).click(),
      ])
      expect(ownerRead.status()).toBe(200)
      await expect(ownerPage.getByText('擁有者', { exact: true })).toBeVisible()
      const docURL = ownerPage.url()
      await ownerPage.getByRole('button', { name: '文件選單', exact: true }).click()
      await expect(ownerPage.locator('.account-actions:visible')).toHaveText(
         `${owner.displayName}登出`,
      )
      await ownerPage.getByRole('button', { name: '文件選單', exact: true }).click()
      await ownerPage.getByRole('button', { name: '分享', exact: true }).click()
      await ownerPage.getByLabel('編輯者的協作邀請 ID').fill(editor.id)
      const invitation = ownerPage.waitForRequest(
         (request) =>
            new URL(request.url()).pathname === `/api/docs/${docURL.split('/').pop()}/editors` &&
            request.method() === 'POST',
         { timeout: 10000 },
      )
      await ownerPage.getByRole('button', { name: '授予編輯資格' }).click()
      expect((await invitation).postDataJSON()).toEqual({ userId: editor.id })
      await expect(
         ownerPage.getByLabel('文件存取設定').getByText(editor.displayName, { exact: true }),
      ).toBeVisible()
      await expect(ownerPage.getByText(editor.id, { exact: true })).toBeVisible()
      await ownerPage.getByRole('button', { name: '關閉對話框', exact: true }).click()
      await editorPage.reload()
      await editorPage.getByRole('link', { name: 'Shared browser architecture' }).click()
      await expect(editorPage.getByText('編輯者', { exact: true })).toBeVisible()
      await expect(editorPage.getByRole('button', { name: '儲存標題' })).toHaveCount(0)
      await expect(editorPage.getByRole('button', { name: '授予編輯資格' })).toHaveCount(0)
      await ownerPage.getByRole('button', { name: '分享', exact: true }).click()
      await ownerPage.getByRole('button', { name: '啟用觀看連結' }).click()
      const link = await ownerPage.getByLabel('觀看連結', { exact: true }).inputValue()
      expect(new URL(link).search).toBe('')
      expect(new URL(link).hash).not.toBe('')
      await ownerPage.getByRole('button', { name: '關閉對話框', exact: true }).click()
      const viewer = await viewerContext.newPage()
      await viewer.goto(link)
      await expect(
         viewer.getByRole('heading', { name: 'Shared browser architecture' }),
      ).toBeVisible()
      await expect(viewer.getByText('觀看者・唯讀', { exact: true })).toBeVisible()
      await expect(viewer.getByRole('button', { name: '儲存標題' })).toHaveCount(0)
      await ownerPage.getByRole('button', { name: '分享', exact: true }).click()
      await ownerPage.getByRole('button', { name: '撤銷編輯資格' }).click()
      await expect(
         ownerPage.getByLabel('文件存取設定').getByText(editor.displayName, { exact: true }),
      ).toHaveCount(0)
      await ownerPage.getByRole('button', { name: '關閉對話框', exact: true }).click()
      await editorPage.reload()
      await expect(editorPage.getByRole('alert').filter({ hasText: '找不到文件' })).toBeVisible()
      await editorPage.goto(link)
      await expect(editorPage.getByText('觀看者・唯讀', { exact: true })).toBeVisible()
      await ownerPage.getByRole('button', { name: '分享', exact: true }).click()
      await ownerPage.getByRole('button', { name: '撤銷觀看連結' }).click()
      await expect(ownerPage.getByText('尚未啟用觀看連結。')).toBeVisible()
      await viewer.reload()
      await expect(
         viewer.getByRole('alert').filter({ hasText: '分享連結無效或已撤銷' }),
      ).toBeVisible()
      await expect(
         viewer.getByRole('heading', { name: 'Shared browser architecture' }),
      ).toHaveCount(0)
      const denied = await viewerContext.newPage()
      await denied.goto(docURL)
      await expect(denied.getByRole('alert').filter({ hasText: '請先登入' })).toBeVisible()
   } finally {
      await Promise.all([ownerContext.close(), editorContext.close(), viewerContext.close()])
      await editor.cleanup()
      await owner.cleanup()
   }
})
