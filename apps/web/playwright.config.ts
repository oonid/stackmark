import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:1420',
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev --host 0.0.0.0',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
