import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:8788', headless: true, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run build && npm run dev:pages',
    url: 'http://127.0.0.1:8788',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
