import { chmodSync, mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const role = process.argv[2]
const target = new URL(process.env.S2_APP_ORIGIN ?? '')
const origin = target.origin
const local = process.env.S2_LOCAL_FRONTEND === '1' && origin === 'http://127.0.0.1:3103'
if (
   !['owner', 'editor'].includes(role) ||
   (target.protocol !== 'https:' && !local) ||
   target.username ||
   target.password ||
   target.pathname !== '/' ||
   target.search ||
   target.hash
) {
   throw new Error(
      'Set S2_APP_ORIGIN to an HTTPS origin (or the explicit local acceptance origin) and run with owner or editor',
   )
}
mkdirSync('.s2-remote', { recursive: true, mode: 0o700 })
const browser = await chromium.launch({ headless: false, channel: 'chrome' })
let stage = 'creating test context'
try {
   const context = await browser.newContext({ baseURL: origin })
   const page = await context.newPage()
   page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return
      const url = new URL(frame.url())
      if (['http:', 'https:'].includes(url.protocol))
         console.log(`Waiting for ${role} login at ${url.origin}${url.pathname}`)
   })
   console.log(
      `Sign in as the ${role} in this isolated test window. No existing Chrome profile is used.`,
   )
   stage = 'opening documents'
   await page.goto('/documents', { timeout: 120_000 })
   const identity = page.getByLabel('協作邀請 ID', { exact: true })
   stage = 'waiting for GitHub login'
   await identity.waitFor({ state: 'visible', timeout: 3_600_000 })
   const id = await identity.inputValue()
   if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Authenticated user ID was not available')
   const path = `.s2-remote/${role}.json`
   await context.storageState({ path })
   chmodSync(path, 0o600)
   console.log(
      `Saved ${role} session privately; the test suite checks that the two identities differ.`,
   )
} catch {
   console.error(
      `Session capture incomplete at ${stage}. Complete GitHub OAuth and return to the document list.`,
   )
   process.exitCode = 1
} finally {
   await browser.close()
}
