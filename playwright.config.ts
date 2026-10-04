import { defineConfig } from '@playwright/test';
import * as os from 'os';

// Each worker is a full Chrome rendering 450x450 scenes; more workers than half the cores makes timing-sensitive
// specs flaky under load. Cap at 3 (2 on small machines); CI uses 2.
const DEFAULT_WORKERS = process.env.CI ? 2 : Math.min(3, Math.max(1, Math.floor(os.cpus().length / 2)));

/**
 * Static-server port, per checkout: 4000 + FNV-1a(absolute checkout path) % 1000, so runs in different checkouts
 * (main repo, .worktrees/*, scratch worktrees) never share a server and never test each other's code. PW_PORT
 * overrides it. The server is reused only with PW_REUSE_SERVER=1; by default a busy port fails the run loudly.
 */
export function checkoutPort(dir: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < dir.length; i++) { h ^= dir.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 4000 + (h % 1000);
}
const PORT = Number(process.env.PW_PORT) || checkoutPort(__dirname);
const BASE_URL = `http://localhost:${PORT}`;
// Runs that legitimately take long get no global cap; everything else is stopped after 25 min (runaway guard).
const LONG_RUN = !!(process.env.FULL_EQUIV || process.env.MEASURE_HARNESS || process.env.MEASURE_UNDO || process.env.UPDATE_BASELINE);

export default defineConfig({
  testDir: './tests',
  // *.measure.spec.ts are opt-in measurement harnesses (e.g. MEASURE_HARNESS=1), not part of the default run.
  testIgnore: process.env.MEASURE_HARNESS ? [] : ['**/*.measure.spec.ts'],
  fullyParallel: true,
  retries: 0,
  // > 2 x helpers.STARTUP_CAP_MS (20 s per startup attempt, one retry) so a startup failure reports its own diagnostic
  // before the test times out; heavy specs set their own.
  timeout: 60_000,
  globalTimeout: LONG_RUN ? 0 : 25 * 60_000,   // runaway guard (a full run takes ~2-3 min); 0 = off
  globalSetup: './tests/global-setup.ts',   // macOS: keep the machine awake during the run (T2.H root cause)
  workers: (process.env.UPDATE_BASELINE || process.env.MEASURE_UNDO) ? 1 : DEFAULT_WORKERS,   // baseline JSON is a read-modify-write
  reporter: [['list'], ['./tests/startup-retry-reporter.ts']],   // the second prints how many startup retries were used
  // Uses the system Chrome (no bundled Chromium download).
  // navigationTimeout bounds goto/reload in specs that do not go through the helpers (Playwright's default is none).
  use: { baseURL: BASE_URL, headless: true, channel: 'chrome', navigationTimeout: 30_000 },
  webServer: {
    command: `npx serve -l ${PORT} --no-clipboard --no-request-logging .`,
    url: `${BASE_URL}/zone-painter.js`,
    reuseExistingServer: process.env.PW_REUSE_SERVER === '1',
    timeout: 30_000,
  },
});
