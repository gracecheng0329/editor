import { defineConfig } from '@playwright/test'

const origin = new URL(process.env.S2_APP_ORIGIN ?? '')
const worker = new URL(process.env.S2_WORKER_ORIGIN ?? '')
const localFrontend = process.env.S2_LOCAL_FRONTEND === '1'
for (const url of [origin, worker]) {
   const allowedLocal = localFrontend && url === origin && url.origin === 'http://127.0.0.1:3103'
   if (
      (url.protocol !== 'https:' && !allowedLocal) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
   )
      throw new Error(
         'S2 origins must be HTTPS origins without credentials, paths or query strings',
      )
}
if (localFrontend && origin.origin !== 'http://127.0.0.1:3103')
   throw new Error('Local development acceptance uses http://127.0.0.1:3103')
const mode = process.env.S2_REMOTE_MODE ?? 'smoke'
if (origin.origin === worker.origin) throw new Error('App and Worker must have separate origins')
if (!['smoke', 'prepare', 'verify'].includes(mode)) throw new Error('Invalid S2_REMOTE_MODE')
if (!process.env.S2_DEPLOYMENT_COMMIT)
   throw new Error('Set S2_DEPLOYMENT_COMMIT to the deployed app commit')

export default defineConfig({
   testDir: './tests/s2-remote',
   grep: new RegExp(`\\b${mode}:`),
   workers: 1,
   retries: 0,
   timeout: 120_000,
   reporter: 'list',
   expect: { timeout: 15_000 },
   use: {
      baseURL: origin.origin,
      browserName: 'chromium',
      channel: 'chrome',
      trace: 'off',
      screenshot: 'off',
      video: 'off',
   },
   webServer: localFrontend
      ? {
           command: 'node scripts/s2-local-frontend.mjs',
           url: origin.origin,
           reuseExistingServer: true,
           timeout: 120_000,
        }
      : undefined,
})
