import { type Browser, expect } from '@playwright/test'
import { build } from 'esbuild'

let bundle: Promise<string> | undefined

/** Independent client served only by Playwright, never by the deployed application. */
async function attemptReadOnlyMutation(
   browser: Browser,
   documentId: string,
   shareToken: string,
   title: string,
   kind: 'node' | 'stroke',
) {
   bundle ??= build({
      entryPoints: ['tests/s2/fixtures/sync-probe.tsx'],
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      define: { 'process.env.NODE_ENV': '"production"' },
   }).then((result) => result.outputFiles[0].text)
   const script = await bundle
   const context = await browser.newContext()
   try {
      // Chrome's Local Network Access permission is separate from CORS; the probe connects
      // directly to the loopback Worker from its isolated browser context.
      await context.grantPermissions(['local-network-access'], {
         origin: 'http://127.0.0.1:3102',
      })
      const page = await context.newPage()
      let attempts = 0
      const diagnostics: string[] = []
      page.on('pageerror', (error) => diagnostics.push(`pageerror: ${error.message}`))
      page.on('console', (message) => {
         if (message.type() === 'error') diagnostics.push(`console: ${message.text()}`)
      })
      page.on('request', (request) => {
         if (request.url().includes(':8789/'))
            diagnostics.push(`request ${request.method()} ${request.url()}`)
      })
      page.on('requestfailed', (request) =>
         diagnostics.push(`request failed ${request.url()}: ${request.failure()?.errorText}`),
      )
      page.on('response', (response) => {
         if (response.url().includes(':8789/'))
            diagnostics.push(`HTTP ${response.status()} ${response.url()}`)
      })
      page.on('websocket', (socket) => {
         if (new URL(socket.url()).pathname !== `/documents/${documentId}`) return
         diagnostics.push(`websocket: ${socket.url()}`)
         socket.on('socketerror', (error) => diagnostics.push(`websocket error: ${error}`))
         socket.on('framesent', ({ payload }) => {
            // Observe the unique attack marker leaving the browser, not SDK protocol fields.
            if (payload.toString().includes(title)) attempts++
         })
      })
      await page.route('http://127.0.0.1:3102/__s2-sync-probe', (route) =>
         route.fulfill({
            contentType: 'text/html',
            body: '<div id="root"></div><script src="/__s2-sync-probe.js"></script>',
         }),
      )
      await page.route('http://127.0.0.1:3102/__s2-sync-probe.js', (route) =>
         route.fulfill({ contentType: 'application/javascript', body: script }),
      )
      const config = encodeURIComponent(JSON.stringify({ documentId, shareToken, title, kind }))
      await page.goto(`http://127.0.0.1:3102/__s2-sync-probe#${config}`)
      try {
         await expect(page.getByLabel('Probe status')).toHaveText('synced-remote')
      } catch (error) {
         const status = await page.getByLabel('Probe status').textContent()
         throw new Error(`Sync probe status ${status}; ${diagnostics.join(' | ')}`, { cause: error })
      }
      const result = page.getByLabel(kind === 'stroke' ? 'Probe strokes' : 'Probe nodes')
      await expect(result).toContainText(kind === 'stroke' ? 'green' : 'Orders API')
      await page.getByRole('button', { name: 'Attempt write' }).click()
      await expect.poll(() => attempts).toBeGreaterThan(0)
      // A settled optimistic edit shows that the real server processed the attempted write.
      await expect(result).not.toContainText(title)
      await expect(result).toContainText(kind === 'stroke' ? 'green' : 'Orders API')
   } finally {
      await context.close()
   }
}

export function attemptReadOnlyWrite(
   browser: Browser,
   documentId: string,
   shareToken: string,
   title: string,
) {
   return attemptReadOnlyMutation(browser, documentId, shareToken, title, 'node')
}

export function attemptReadOnlyStrokeWrite(
   browser: Browser,
   documentId: string,
   shareToken: string,
   title: string,
) {
   return attemptReadOnlyMutation(browser, documentId, shareToken, title, 'stroke')
}
