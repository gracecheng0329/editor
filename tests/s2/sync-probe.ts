import { type Browser, expect } from '@playwright/test'
import { build } from 'esbuild'

let bundle: Promise<string> | undefined

/** Independent client served only by Playwright, never by the deployed application. */
export async function attemptReadOnlyWrite(
   browser: Browser,
   documentId: string,
   shareToken: string,
   title: string,
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
      const page = await context.newPage()
      let attempts = 0
      page.on('websocket', (socket) => {
         if (new URL(socket.url()).pathname !== `/documents/${documentId}`) return
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
      const config = encodeURIComponent(JSON.stringify({ documentId, shareToken, title }))
      await page.goto(`http://127.0.0.1:3102/__s2-sync-probe#${config}`)
      await expect(page.getByLabel('Probe nodes')).toContainText('Orders API')
      await page.getByRole('button', { name: 'Attempt write' }).click()
      await expect.poll(() => attempts).toBeGreaterThan(0)
      // A settled optimistic edit shows that the real server processed the attempted write.
      await expect(page.getByLabel('Probe nodes')).not.toContainText(title)
      await expect(page.getByLabel('Probe nodes')).toContainText('Orders API')
   } finally {
      await context.close()
   }
}
