import { defineConfig } from '@playwright/test'

export default defineConfig({
   testDir: './tests/s4',
   workers: 1,
   retries: 0,
   timeout: 150_000,
   reporter: 'list',
   expect: { timeout: 10_000 },
   use: {
      baseURL: 'http://127.0.0.1:8791',
      browserName: 'chromium',
      channel: 'chrome',
   },
   webServer: {
      command: 'node scripts/s4-realtime-harness.mjs',
      url: 'http://127.0.0.1:8791/health',
      reuseExistingServer: false,
      timeout: 30_000,
   },
})
