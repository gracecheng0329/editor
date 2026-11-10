import { writeFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'
import { expect, test } from '@playwright/test'
import { registeredUser } from '../s1/sharing-fixtures'
import { openObjectPanel } from './canvas-fixtures'

// An opt-in measured baseline, kept separate from the short regression suite.
test('S2 baseline: five sessions, 300 nodes and 100 connections, five minutes', async ({
   browser,
}) => {
   test.skip(process.env.S2_LOAD !== '1', 'Run explicitly with S2_LOAD=1')
   test.setTimeout(600_000)
   const origin = 'http://127.0.0.1:3102'
   const users = await Promise.all(
      Array.from({ length: 5 }, (_, i) => registeredUser(true, `Load ${i}`)),
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
         data: { title: 'S2 measured baseline' },
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
      await Promise.all(
         pages.map(async (page, i) => {
            await expect(page.getByLabel('畫布節點').getByRole('listitem')).toHaveCount(300)
            await expect(page.getByLabel('畫布連線').getByRole('listitem')).toHaveCount(100)
            await page.getByRole('button', { name: `選取 Node ${i}`, exact: true }).click()
         }),
      )
      console.info('S2 baseline: 400 objects synchronized; starting five-minute operation window')
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
      // The last operation happens near t=299s; observe the complete five-minute window.
      const remaining = started + 300_000 - performance.now()
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
      operationWindowSeconds = (performance.now() - started) / 1000
      const referenceNodes = await author.getByLabel('畫布節點').textContent()
      const referenceArrows = await author.getByLabel('畫布連線').textContent()
      await Promise.all(
         pages.map(async (page) => {
            await expect(page.getByLabel('畫布節點')).toHaveText(referenceNodes ?? '', {
               timeout: 5000,
            })
            await expect(page.getByLabel('畫布連線')).toHaveText(referenceArrows ?? '', {
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
         '/private/tmp/s2-6-load.json',
         JSON.stringify(
            {
               date: new Date().toISOString(),
               elapsedSeconds: (Date.now() - began) / 1000,
               browser: browser.version(),
               node: process.version,
               cpu: cpus()[0].model,
               cores: cpus().length,
               memoryGiB: totalmem() / 1024 ** 3,
               network: 'loopback; Next production, local workerd/SQLite and Supabase; no WAN',
               sessions: 5,
               nodes: 300,
               connections: 100,
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
