import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/s1',
  testMatch: 'auth-ui.spec.ts',
  workers: 1,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:3102', channel: 'chrome' },
  webServer: {
    command: 'node node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1 --port 3102',
    url: 'http://127.0.0.1:3102',
    reuseExistingServer: false,
    timeout: 120000,
    env: { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test' },
  },
});
