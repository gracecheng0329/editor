import { randomBytes } from 'node:crypto'
import { defineConfig } from '@playwright/test'

process.env.G0_TEST_SECRET ??= randomBytes(32).toString('hex')

export default defineConfig({
   testDir: './tests/g0',
   fullyParallel: false,
   workers: 1,
   retries: 0,
   timeout: 45_000,
   expect: { timeout: 10_000 },
   reporter: 'list',
   use: {
      baseURL: 'http://127.0.0.1:3100',
      browserName: 'chromium',
      channel: 'chrome',
      trace: 'off',
      actionTimeout: 10_000,
   },
   webServer: [
      {
         command: 'node scripts/g0-worker.mjs',
         url: 'http://127.0.0.1:8787/health',
         reuseExistingServer: false,
         timeout: 60_000,
         env: { G0_TEST_SECRET: process.env.G0_TEST_SECRET },
      },
      {
         command:
            'node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3100',
         url: 'http://127.0.0.1:3100',
         reuseExistingServer: false,
         timeout: 120_000,
         env: { G0_ENABLED: '1' },
      },
   ],
})
