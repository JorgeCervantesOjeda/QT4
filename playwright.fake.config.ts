import { defineConfig, devices } from '@playwright/test'

export default defineConfig( {
  testDir: './src/test/e2e',
  timeout: 30000,
  workers: 1,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev:e2e -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
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
