import { expect, test } from '@playwright/test'
import { registeredUser } from '../s1/sharing-fixtures'
import { addNode, openObjectPanel } from './canvas-fixtures'
import { attemptReadOnlyWrite } from './sync-probe'

const origin = 'http://127.0.0.1:3102'
const service = 'http://127.0.0.1:8789'

test('a valid share token opens a live read-only canvas and cannot persist forged writes', async ({
   browser,
   request,
}) => {
   const owner = await registeredUser(false, 'Canvas owner')
   const ownerContext = await browser.newContext()
   const viewerContext = await browser.newContext()
   try {
      await ownerContext.addCookies(
         owner.browserCookies().map((cookie) => ({ ...cookie, url: origin })),
      )
      const created = await ownerContext.request.post('/api/documents', {
         headers: { Origin: origin },
         data: { title: 'Shared canvas' },
      })
      expect(created.status()).toBe(201)
      const document = await created.json()
      const share = await owner.client.rpc('set_document_share', {
         target_id: document.id,
         enable: true,
      })
      expect(share.error).toBeNull()
      expect(typeof share.data?.token).toBe('string')

      const ownerPage = await ownerContext.newPage()
      await ownerPage.goto(`/documents/${document.id}`)
      await openObjectPanel(ownerPage)
      await addNode(ownerPage, 'Orders API')
      await expect(ownerPage.getByLabel('保存狀態')).toHaveText('已確認持久化')

      const viewerPage = await viewerContext.newPage()
      await viewerPage.goto(`/share#${share.data.token}`)
      await expect(viewerPage.getByLabel('分享畫布')).toBeVisible()
      await expect(viewerPage.getByLabel('畫布節點')).toContainText('Orders API')
      await expect(
         viewerPage.getByLabel('分享畫布').locator('header').getByText('觀看者・唯讀'),
      ).toBeVisible()
      await expect(viewerPage.getByRole('button', { name: '新增節點', exact: true })).toHaveCount(0)

      const ticket = await request.post(`${service}/documents/${document.id}/session`, {
         headers: { Origin: origin, 'X-Share-Token': share.data.token },
      })
      expect(ticket.status()).toBe(200)
      expect(ticket.headers()['cache-control']).toContain('no-store')
      const checkpoint = await request.post(`${service}/documents/${document.id}/checkpoint`, {
         headers: { Origin: origin, 'X-Share-Token': share.data.token },
      })
      expect(checkpoint.status()).toBe(403)

      await attemptReadOnlyWrite(
         browser,
         document.id,
         share.data.token,
         'Unauthorized viewer write',
      )

      await addNode(ownerPage, 'Billing API')
      await expect(ownerPage.getByLabel('保存狀態')).toHaveText('已確認持久化')
      await expect(viewerPage.getByLabel('畫布節點')).toContainText('Billing API')
      await ownerPage.reload()
      await openObjectPanel(ownerPage)
      await expect(ownerPage.getByLabel('畫布節點')).toContainText('Billing API')
      await expect(ownerPage.getByLabel('畫布節點')).not.toContainText('Unauthorized viewer write')
   } finally {
      await viewerContext.close()
      await ownerContext.close()
      await owner.cleanup()
   }
})
