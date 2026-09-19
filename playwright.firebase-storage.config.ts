import { defineConfig, devices } from '@playwright/test'

export default defineConfig( {
  testDir: './src/test/e2e-real',
  metadata: {
    firebaseStorageE2eEmail: process.env.QT4_E2E_EMAIL ?? '',
    firebaseStorageE2ePassword: process.env.QT4_E2E_PASSWORD ?? '',
  },
  timeout: 60000,
  workers: 1,
  expect: {
    timeout: 15000,
  },
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:4175',
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4175',
    url: 'http://localhost:4175',
    reuseExistingServer: false,
    timeout: 120000,
  },
  projects: [
    {
      name: 'firefox-firebase-storage',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
} )
