import { defineConfig } from '@playwright/test';
import * as os from 'os';

// Each worker is a full Chrome rendering 450x450 scenes; more workers than half the cores makes timing-sensitive
// specs flaky under load. Cap at 3 (2 on small machines); CI uses 2.
const DEFAULT_WORKERS = process.env.CI ? 2 : Math.min(3, Math.max(1, Math.floor(os.cpus().length / 2)));

export default defineConfig({
  testDir: './tests',
  // *.measure.spec.ts are opt-in measurement harnesses (e.g. MEASURE_HARNESS=1), not part of the default run.
  testIgnore: process.env.MEASURE_HARNESS ? [] : ['**/*.measure.spec.ts'],
  fullyParallel: true,
  retries: 0,
  // > 2 x helpers.STARTUP_CAP_MS (20 s per startup attempt, one retry) so a startup failure reports its own diagnostic
  // before the test times out; heavy specs set their own.
  timeout: 60_000,
  globalSetup: './tests/global-setup.ts',   // macOS: keep the machine awake during the run (T2.H root cause)
  workers: (process.env.UPDATE_BASELINE || process.env.MEASURE_UNDO) ? 1 : DEFAULT_WORKERS,   // baseline JSON is a read-modify-write
  reporter: [['list'], ['./tests/startup-retry-reporter.ts']],   // the second prints how many startup retries were used
  // Uses the system Chrome (no bundled Chromium download).
  // navigationTimeout bounds goto/reload in specs that do not go through the helpers (Playwright's default is none).
  use: { baseURL: 'http://localhost:4173', headless: true, channel: 'chrome', navigationTimeout: 30_000 },
  webServer: {
    command: 'npx serve -l 4173 --no-clipboard --no-request-logging .',
    url: 'http://localhost:4173/zone-painter.js',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
