import { readFileSync } from 'node:fs'
import { defineConfig } from '@playwright/test'

const credentials = JSON.parse(
   readFileSync(process.env.S1_CREDENTIALS_FILE ?? '.local-supabase/credentials.json', 'utf8'),
)

export default defineConfig({
   testDir: './tests/s1',
   workers: 1,
   retries: 0,
   reporter: 'list',
   use: { baseURL: 'http://127.0.0.1:3101', browserName: 'chromium', channel: 'chrome' },
   webServer: {
      command:
         'node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3101',
      url: 'http://127.0.0.1:3101',
      reuseExistingServer: false,
      timeout: 120000,
      env: {
         S1_ENABLED: '1',
         NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
         NEXT_PUBLIC_SUPABASE_ANON_KEY: credentials.anonKey,
      },
   },
})
