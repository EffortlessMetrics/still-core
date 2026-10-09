import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser', workers: 1, retries: 0,
  use: { baseURL: 'http://127.0.0.1:4390', browserName: 'chromium', serviceWorkers: 'block', launchOptions: process.env.STILL_BROWSER_EXECUTABLE ? { executablePath: process.env.STILL_BROWSER_EXECUTABLE } : {} },
  webServer: { command: process.env.STILL_PACKED_CONSUMER ? 'npm run preview -- --host 127.0.0.1 --port 4390' : 'npm run preview --workspace starter -- --host 127.0.0.1 --port 4390', cwd: process.env.STILL_PACKED_CONSUMER, url: 'http://127.0.0.1:4390', reuseExistingServer: false }
});
