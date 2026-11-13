import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173', launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } },
  webServer: { command: 'pnpm dev --host 127.0.0.1 --port 4173', url: 'http://127.0.0.1:4173/', reuseExistingServer: !process.env.CI, timeout: 30_000 },
})
