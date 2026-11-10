import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

const credentials = JSON.parse(
   readFileSync(process.env.S1_CREDENTIALS_FILE ?? '.local-supabase/credentials.json', 'utf8'),
)
const url = 'http://127.0.0.1:54321'

test('owner creates, reopens and renames a private document, then logout rejects a copied session', async ({
   browser,
}) => {
   test.setTimeout(90_000)
   const admin = createClient(url, credentials.serviceKey, { auth: { persistSession: false } })
   const email = `${randomUUID()}@example.test`
   const password = randomUUID()
   const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
   expect(created.error).toBeNull()
   const context = await browser.newContext()
   const otherContext = await browser.newContext()
   const cookies = new Map<string, string>()
   const client = createServerClient(url, credentials.anonKey, {
      cookies: {
         getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
         setAll: (values) =>
            values.forEach(({ name, value }) => {
               cookies.set(name, value)
            }),
      },
   })
   try {
      const signedIn = await client.auth.signInWithPassword({ email, password })
      expect(signedIn.error).toBeNull()
      assert(signedIn.data.session, 'Expected an authenticated session')
      await context.addCookies(
         [...cookies].map(([name, value]) => ({ name, value, url: 'http://127.0.0.1:3101' })),
      )
      const copiedCookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
      const page = await context.newPage()
      await page.goto('/documents')
      await page.getByLabel('新文件標題').fill('Browser architecture')
      const [creation] = await Promise.all([
         page.waitForResponse(
            (response) =>
               response.url().endsWith('/api/documents') && response.request().method() === 'POST',
         ),
         page.getByRole('button', { name: '建立文件' }).click(),
      ])
      expect(creation.status()).toBe(201)
      await page.getByRole('link', { name: 'Browser architecture' }).click()
      await expect(page.getByLabel('文件標題', { exact: true })).toHaveValue('Browser architecture')
      const documentURL = page.url()
      const id = documentURL.split('/').at(-1)
      assert(id, 'Expected a document ID in the URL')
      await page.getByLabel('文件標題', { exact: true }).fill('Saved architecture')
      await page.getByRole('button', { name: '儲存標題' }).click()
      await expect(page.getByLabel('標題儲存結果', { exact: true })).toHaveText('標題已儲存。')
      await page.reload()
      await expect(page.getByLabel('文件標題', { exact: true })).toHaveValue('Saved architecture')
      await page.getByRole('button', { name: '文件選單', exact: true }).click()
      await page.getByRole('link', { name: '我的文件' }).click()
      await page.getByRole('link', { name: 'Saved architecture' }).click()
      await expect(page).toHaveURL(documentURL)
      const stranger = await otherContext.newPage()
      await stranger.goto(documentURL)
      await expect(stranger.getByRole('alert').filter({ hasText: '請先登入' })).toContainText(
         '請先登入',
      )
      await page.screenshot({ path: '/private/tmp/editor-s1-document.png', fullPage: true })
      await page.getByRole('button', { name: '文件選單', exact: true }).click()
      await page.getByRole('button', { name: '登出' }).click()
      await expect(page).toHaveURL('http://127.0.0.1:3101/')
      expect(
         (
            await context.request.patch(`/api/documents/${id}`, { data: { title: 'After logout' } })
         ).status(),
      ).toBe(401)
      expect(
         (
            await otherContext.request.patch(`/api/documents/${id}`, {
               data: { title: 'Replayed session' },
               headers: { cookie: copiedCookie },
            })
         ).status(),
      ).toBe(401)
      const replay = await fetch(`${url}/rest/v1/documents?id=eq.${id}`, {
         method: 'PATCH',
         headers: {
            apikey: credentials.anonKey,
            Authorization: `Bearer ${signedIn.data.session.access_token}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
         },
         body: JSON.stringify({ title: 'Direct REST replay' }),
      })
      expect(await replay.json()).toEqual([])
   } finally {
      if (created.data.user) {
         await admin.from('documents').delete().eq('owner_id', created.data.user.id)
         await admin.auth.admin.deleteUser(created.data.user.id)
      }
      await context.close()
      await otherContext.close()
   }
})
