// playwright.reputation.config.ts: Runs reputation UI smoke tests against Firebase emulators.

import { defineConfig, devices } from '@playwright/test'

export default defineConfig( {
  testDir: './src/test/e2e',
  timeout: 30000,
  workers: 1,
  expect: { timeout: 10000 },
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev:emulator -- --host 127.0.0.1 --port 4175',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: true,
    timeout: 120000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
} )
