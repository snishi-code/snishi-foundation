import { defineConfig, devices } from '@playwright/test';

// E2E は本番ビルドを vite preview で配信して検証する（凍結 SW / manifest を含む実体に近い状態）。
// 形式は移植元 e2e（hospital-rounds / simple-ledger-src）準拠。chromium のみ。
// 各テストはまっさらな context で走る（IDB/localStorage を持ち越さない）。
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4174/',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4174 --strictPort',
    url: 'http://localhost:4174/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
