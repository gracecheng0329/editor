import { writeFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { expect, test } from '@playwright/test'
import { registeredUser } from '../s1/sharing-fixtures'
import { openObjectPanel } from '../s2/canvas-fixtures'

async function drawStroke(page: import('@playwright/test').Page, x: number, y: number) {
   const canvas = page.locator('.tl-canvas').first()
   const bounds = await canvas.boundingBox()
   if (!bounds) throw new Error('Canvas drawing surface is not visible')
   await page.mouse.move(bounds.x + x, bounds.y + y)
   await page.mouse.down()
   await page.mouse.move(bounds.x + x + 30, bounds.y + y + 12, { steps: 2 })
   await page.mouse.move(bounds.x + x + 60, bounds.y + y + 20, { steps: 2 })
   await page.mouse.up()
}

test('AC-15 S3 baseline: five sessions with 300 nodes, 100 connections and 100 strokes', async ({
   browser,
}) => {
   test.skip(process.env.S3_LOAD !== '1', 'Run explicitly with S3_LOAD=1')
   test.setTimeout(600_000)
   const origin = 'http://127.0.0.1:3102'
   const users = await Promise.all(
      Array.from({ length: 5 }, (_, i) => registeredUser(true, `S3 load ${i}`)),
   )
   const contexts = await Promise.all(users.map(() => browser.newContext()))
   const failures: string[] = []
   const samples: number[] = []
   const errors: string[] = []
   const began = Date.now()
   let completed = false
   let operationWindowSeconds = 0
   try {
      await Promise.all(
         contexts.map((context, i) =>
            context.addCookies(
               users[i].browserCookies().map((cookie) => ({ ...cookie, url: origin })),
            ),
         ),
      )
      const response = await contexts[0].request.post('/api/documents', {
         headers: { Origin: origin },
         data: { title: 'S3 AC-15 measured baseline' },
      })
      expect(response.status()).toBe(201)
      const document = await response.json()
      for (const user of users.slice(1)) {
         expect(
            (
               await contexts[0].request.post(`/api/documents/${document.id}/editors`, {
                  headers: { Origin: origin },
                  data: { userId: user.id },
               })
            ).status(),
         ).toBe(200)
      }

      const pages = await Promise.all(contexts.map((context) => context.newPage()))
      for (const page of pages) page.on('pageerror', (error) => errors.push(error.message))
      await Promise.all(pages.map((page) => page.goto(`/documents/${document.id}`)))
      await Promise.all(pages.map(openObjectPanel))
      const author = pages[0]
      for (let i = 0; i < 300; i++) {
         await author.getByLabel('新增節點名稱').fill(`Node ${i}`)
         await author.getByRole('button', { name: '新增節點', exact: true }).click()
      }
      for (let i = 0; i < 100; i++) {
         await author.getByLabel('連線起點', { exact: true }).selectOption({ label: `Node ${i}` })
         await author
            .getByLabel('連線終點', { exact: true })
            .selectOption({ label: `Node ${i + 100}` })
         await author.getByRole('button', { name: '新增連線', exact: true }).click()
      }
      await author.getByLabel('筆畫顏色').selectOption('blue')
      await author.getByLabel('筆畫粗細').selectOption('m')
      await author.getByRole('button', { name: '自由手繪工具', exact: true }).click()
      for (let i = 0; i < 100; i++) {
         await drawStroke(author, 420 + (i % 10) * 28, 220 + Math.floor(i / 10) * 28)
      }

      await Promise.all(
         pages.map(async (page, i) => {
            await expect(page.getByLabel('畫布節點').getByRole('listitem')).toHaveCount(300)
            await expect(page.getByLabel('畫布連線').getByRole('listitem')).toHaveCount(100)
            await expect(page.getByLabel('畫布筆畫').getByRole('listitem')).toHaveCount(100)
            await page.getByRole('button', { name: `選取 Node ${i}`, exact: true }).click()
            await expect(page.getByLabel('保存狀態')).toHaveText('已確認持久化')
         }),
      )
      console.info('AC-15 baseline: 500 objects synchronized; starting five-minute operation window')
      const started = performance.now()
      for (let round = 0; round < 300; round++) {
         const due = started + round * 1000
         const delay = due - performance.now()
         if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
         if (performance.now() - due > 1000)
            failures.push(`Round ${round}: missed one-second cadence`)
         await Promise.all(
            pages.map(async (page, i) => {
               const sent = performance.now()
               const x = 2000 + round * 10 + i
               await page.getByLabel('物件 x', { exact: true }).fill(String(x))
               const peer = pages[(i + 1) % pages.length]
               await expect(
                  peer.getByRole('button', { name: `選取 Node ${i}`, exact: true }),
               ).toContainText(`x:${x},`, { timeout: 2000 })
               const elapsed = performance.now() - sent
               samples.push(elapsed)
               if (elapsed > 2000)
                  failures.push(`Round ${round}, session ${i}: ${elapsed.toFixed(0)}ms`)
            }),
         )
      }
      const remaining = started + 300_000 - performance.now()
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
      operationWindowSeconds = (performance.now() - started) / 1000
      const referenceNodes = await author.getByLabel('畫布節點').textContent()
      const referenceConnections = await author.getByLabel('畫布連線').textContent()
      const referenceStrokes = await author.getByLabel('畫布筆畫').textContent()
      await Promise.all(
         pages.map(async (page) => {
            await expect(page.getByLabel('畫布節點')).toHaveText(referenceNodes ?? '', {
               timeout: 5000,
            })
            await expect(page.getByLabel('畫布連線')).toHaveText(referenceConnections ?? '', {
               timeout: 5000,
            })
            await expect(page.getByLabel('畫布筆畫')).toHaveText(referenceStrokes ?? '', {
               timeout: 5000,
            })
            await expect(page.getByLabel('保存狀態')).toHaveText('已確認持久化')
         }),
      )
      expect(errors).toEqual([])
      expect(failures).toEqual([])
      completed = true
   } finally {
      const ordered = samples.toSorted((a, b) => a - b)
      writeFileSync(
         '/private/tmp/s3-8-load.json',
         JSON.stringify(
            {
               date: new Date().toISOString(),
               elapsedSeconds: (Date.now() - began) / 1000,
               browser: browser.version(),
               node: process.version,
               next: '16.4.5',
               tldrawSync: '5.5.2',
               cpu: cpus()[0].model,
               cores: cpus().length,
               memoryGiB: totalmem() / 1024 ** 3,
               region: process.env.S3_LOAD_REGION ?? 'local',
               network: 'loopback; Next production, local workerd/SQLite and Supabase; no WAN',
               sessions: 5,
               nodes: 300,
               connections: 100,
               strokes: 100,
               durationTargetSeconds: 300,
               completed,
               operationWindowSeconds,
               samples: samples.length,
               maxMs: ordered.at(-1),
               p95Ms: ordered[Math.floor(ordered.length * 0.95)],
               failures,
               errors,
            },
            null,
            2,
         ),
      )
      await Promise.all(contexts.map((context) => context.close()))
      await Promise.all(users.map((user) => user.cleanup()))
   }
})
