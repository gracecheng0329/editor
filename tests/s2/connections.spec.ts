import { expect } from '@playwright/test'
import { addNode, checkpointRecords, openObjectPanel, selectNode, test } from './canvas-fixtures'

test('labeled directional connections and text synchronize, detach and survive restart', async ({
   participants: { alice, bob, closeBob },
}) => {
   await addNode(alice, 'API')
   await expect(bob.getByLabel('畫布節點')).toContainText('API', { timeout: 2000 })
   await addNode(bob, 'Database')
   await expect(alice.getByLabel('畫布節點')).toContainText('Database', { timeout: 2000 })
   await expect(alice.getByLabel('連線起點', { exact: true })).toBeVisible()
   await alice.getByLabel('連線起點', { exact: true }).selectOption({ label: 'API' })
   await alice.getByLabel('連線終點', { exact: true }).selectOption({ label: 'Database' })
   await alice.getByLabel('新增連線標籤').fill('requests')
   await alice.getByRole('button', { name: '新增連線', exact: true }).click()
   await expect(bob.getByLabel('畫布連線')).toContainText('requests', { timeout: 2000 })
   await expect(bob.getByLabel('畫布連線')).toContainText('API → Database')
   await bob.getByLabel('新增文字內容').fill('Architecture notes')
   await bob.getByRole('button', { name: '新增文字', exact: true }).click()
   await expect(alice.getByLabel('畫布文字')).toContainText('Architecture notes', { timeout: 2000 })
   await alice.getByRole('button', { name: '選取文字 Architecture notes', exact: true }).click()
   await alice.getByLabel('選取文字內容').fill('Reviewed notes')
   await alice.getByLabel('物件 x', { exact: true }).fill('250')
   await alice.getByLabel('物件 y', { exact: true }).fill('420')
   await alice.getByLabel('物件寬度').fill('360')
   await expect(bob.getByLabel('畫布文字')).toContainText('Reviewed notes', { timeout: 2000 })
   await selectNode(bob, 'Database')
   await bob.getByLabel('物件寬度').fill('300')
   await expect(alice.getByLabel('畫布節點')).toContainText('300 × 98', { timeout: 2000 })
   await selectNode(alice, 'API')
   await alice.getByRole('button', { name: '刪除選取節點', exact: true }).click()
   await expect(bob.getByLabel('畫布連線')).toContainText('世界座標', { timeout: 5000 })
   await expect(bob.getByLabel('畫布連線')).toContainText('→ Database')
   await expect(bob.getByLabel('畫布連線').getByRole('listitem')).toHaveCount(1)
   await expect(alice.getByLabel('保存狀態')).toHaveText('已確認持久化')
   await expect(bob.getByLabel('保存狀態')).toHaveText('已確認持久化')
   const connections = await bob.getByLabel('畫布連線').textContent()
   await closeBob()
   const restart = await fetch('http://127.0.0.1:8790/restart', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.SYNC_TEST_SECRET}` },
   })
   expect(restart.status).toBe(200)
   const runtimes = await restart.json()
   expect(runtimes.runtimeId).not.toBe(runtimes.previousRuntimeId)
   await alice.reload()
   await openObjectPanel(alice)
   await expect(alice.getByLabel('畫布連線')).toHaveText(connections ?? '')
   await expect(alice.getByLabel('畫布文字')).toContainText('Reviewed notes')
   await expect(alice.getByLabel('畫布文字')).toContainText('x:250, y:420')
   await alice.getByRole('button', { name: '選取文字 Reviewed notes', exact: true }).click()
   await expect(alice.getByLabel('物件寬度')).toHaveValue('360')
   await expect(alice.getByLabel('畫布節點')).not.toContainText('API')
   await expect(alice.getByLabel('畫布節點')).toContainText('300 × 98')
   await expect(alice.getByLabel('保存狀態')).toHaveText('已確認持久化')
   await alice.getByLabel('保存狀態').scrollIntoViewIfNeeded()
   await alice
      .getByLabel('文件畫布', { exact: true })
      .screenshot({ path: '/private/tmp/s2-6-canvas.png' })
})

test('node deletion preserves the last endpoint while a collaborator moves it and edits the connection', async ({
   participants: { alice, bob },
}) => {
   await addNode(alice, 'Transient')
   await expect(bob.getByLabel('畫布節點')).toContainText('Transient', { timeout: 2000 })
   await alice.getByLabel('連線起點', { exact: true }).selectOption({ label: 'Transient' })
   await alice.getByLabel('新增連線標籤').fill('outbound')
   await alice.getByRole('button', { name: '新增連線', exact: true }).click()
   await expect(bob.getByLabel('畫布連線')).toContainText('outbound', { timeout: 2000 })
   await expect(alice.getByLabel('連線端點 outbound')).toBeVisible()
   const before = await alice.getByLabel('連線端點 outbound').textContent()
   await selectNode(alice, 'Transient')
   await alice.getByRole('button', { name: '刪除選取節點', exact: true }).click()
   await expect(bob.getByLabel('連線端點 outbound')).toHaveText(before ?? '', { timeout: 5000 })
   await expect(bob.getByLabel('畫布連線')).toContainText('世界座標')
   // A fresh node exercises deletion racing with a remote move; the arrow label
   // is an unrelated concurrent edit that must survive that race.
   await addNode(alice, 'Racing')
   await expect(bob.getByLabel('畫布節點')).toContainText('Racing', { timeout: 2000 })
   await alice.getByLabel('連線起點', { exact: true }).selectOption({ label: 'Racing' })
   await alice.getByLabel('新增連線標籤').fill('race')
   await alice.getByRole('button', { name: '新增連線', exact: true }).click()
   await expect(bob.getByLabel('畫布連線')).toContainText('race', { timeout: 2000 })
   await Promise.all([selectNode(alice, 'Racing'), selectNode(bob, 'Racing')])
   await Promise.all([
      alice.getByRole('button', { name: '刪除選取節點', exact: true }).click(),
      bob.getByRole('button', { name: '向右移動節點', exact: true }).click(),
   ])
   await bob.getByRole('button', { name: '選取連線 race', exact: true }).click()
   await bob.getByLabel('選取連線標籤').fill('surviving edit')
   await expect(alice.getByLabel('畫布節點').getByRole('listitem')).toHaveCount(0, {
      timeout: 5000,
   })
   await expect(bob.getByLabel('畫布節點').getByRole('listitem')).toHaveCount(0, { timeout: 5000 })
   await expect(alice.getByLabel('畫布連線')).toHaveText(
      (await bob.getByLabel('畫布連線').textContent()) ?? '',
      { timeout: 5000 },
   )
   await expect(alice.getByLabel('畫布連線').getByRole('listitem')).toHaveCount(2)
   await expect(alice.getByLabel('畫布連線')).toContainText('surviving edit')
   await expect(alice.getByLabel('保存狀態')).toHaveText('已確認持久化')
   const records = await checkpointRecords(alice)
   expect(Object.values(records).filter((record) => record.typeName === 'binding')).toHaveLength(0)
})

test('free world endpoints remain directional when a connection is labeled and moved', async ({
   participants: { alice, bob },
}) => {
   await alice.getByLabel('新增連線標籤').fill('free relation')
   await alice.getByRole('button', { name: '新增連線', exact: true }).click()
   await expect(bob.getByLabel('連線端點 free relation')).toHaveText('(100, 100) → (420, 100)', {
      timeout: 2000,
   })
   await bob.getByRole('button', { name: '選取連線 free relation', exact: true }).click()
   await bob.getByLabel('選取連線標籤').fill('moved relation')
   await bob.getByLabel('物件 x', { exact: true }).fill('500')
   await expect(alice.getByLabel('連線端點 moved relation')).toHaveText('(500, 100) → (820, 100)', {
      timeout: 2000,
   })
   await expect(bob.getByLabel('保存狀態')).toHaveText('已確認持久化')
   const records = Object.values(await checkpointRecords(bob))
   const arrow = records.find((record) => record.typeName === 'shape' && record.type === 'arrow')
   expect(arrow).toMatchObject({ props: { arrowheadStart: 'none', arrowheadEnd: 'arrow' } })
   expect(records.filter((record) => record.typeName === 'binding')).toHaveLength(0)
})
