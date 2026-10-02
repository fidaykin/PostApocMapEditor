import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  workers: process.env.UPDATE_BASELINE ? 1 : undefined,   // baseline JSON is a read-modify-write
  reporter: [['list']],
  // Uses the system Chrome (no bundled Chromium download).
  use: { baseURL: 'http://localhost:4173', headless: true, channel: 'chrome' },
  webServer: {
    command: 'npx serve -l 4173 --no-clipboard --no-request-logging .',
    url: 'http://localhost:4173/zone-painter.js',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
