import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { defineConfig } from '@playwright/test'

process.env.SYNC_TEST_SECRET ??= randomBytes(32).toString('hex')
const credentials = JSON.parse(
   readFileSync(process.env.S1_CREDENTIALS_FILE ?? '.local-supabase/credentials.json', 'utf8'),
)

export default defineConfig({
   testDir: './tests/s4-comments',
   workers: 1,
   retries: 0,
   timeout: 90_000,
   reporter: 'list',
   expect: { timeout: 10_000 },
   use: { baseURL: 'http://127.0.0.1:3103', browserName: 'chromium', channel: 'chrome' },
   webServer: [
      {
         command: 'node scripts/sync-worker.mjs',
         url: 'http://127.0.0.1:8789/health',
         reuseExistingServer: false,
         timeout: 60_000,
         env: {
            SYNC_TEST_SECRET: process.env.SYNC_TEST_SECRET,
            NEXT_PUBLIC_SUPABASE_ANON_KEY: credentials.anonKey,
            APP_ORIGIN: 'http://127.0.0.1:3103',
            SESSION_LEASE_MS: '60000',
         },
      },
      {
         command: 'node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3103',
         url: 'http://127.0.0.1:3103',
         reuseExistingServer: false,
         timeout: 120_000,
         env: {
            NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
            NEXT_PUBLIC_SUPABASE_ANON_KEY: credentials.anonKey,
            NEXT_PUBLIC_SYNC_URL: 'http://127.0.0.1:8789',
            SUPABASE_JWT_SECRET: credentials.jwtSecret,
         },
      },
   ],
})
