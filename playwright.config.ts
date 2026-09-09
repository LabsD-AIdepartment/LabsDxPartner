import { defineConfig } from '@playwright/test';
const runId =
  process.env.LABSD_E2E_RUN_ID ??
  `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
process.env.LABSD_E2E_RUN_ID = runId;
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: `.agent-work/runtime/evidence/playwright/${runId}`,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4187', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:4187',
    reuseExistingServer: !process.env.CI,
  },
});
