import { defineConfig } from '@playwright/test';
import * as os from 'os';

// Each worker is a full Chrome rendering 450x450 scenes; more workers than half the cores makes timing-sensitive
// specs flaky under load. Cap at 3 (2 on small machines); CI uses 2.
const DEFAULT_WORKERS = process.env.CI ? 2 : Math.min(3, Math.max(1, Math.floor(os.cpus().length / 2)));

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  timeout: 60_000,   // editor startup under load can take a while (helpers.waitForEditor waits up to 90 s); heavy specs set their own
  workers: (process.env.UPDATE_BASELINE || process.env.MEASURE_UNDO) ? 1 : DEFAULT_WORKERS,   // baseline JSON is a read-modify-write
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
