import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: '.agent-work/runtime/evidence/playwright',
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4187', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:4187',
    reuseExistingServer: !process.env.CI,
  },
});
