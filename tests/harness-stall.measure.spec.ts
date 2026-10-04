// MEASUREMENT ONLY, skipped (no browser launched) unless MEASURE_HARNESS=1:
//   MEASURE_HARNESS=1 [MEASURE_N=120] [MEASURE_OUT=/path/launches.jsonl] \
//     npx playwright test tests/harness-stall.measure.spec.ts --workers=3
// Launches the editor MEASURE_N times through helpers.openEditor and appends one JSON line per launch to MEASURE_OUT
// (default test-results/harness-stall.jsonl): ms to ready, startup retries used, os.loadavg(), and, for launches slower
// than 10 s, a diagnostic snapshot taken while the launch is still pending (readyState, startup flags, requests that
// never finished, console errors). Used by task T2.H to characterise the intermittent editor-startup stall.
import { test } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openEditor } from './helpers';

const N = Number(process.env.MEASURE_N || 120);
const OUT = process.env.MEASURE_OUT || path.join(__dirname, '..', 'test-results', 'harness-stall.jsonl');
const SLOW_MS = 10_000;

test.describe.configure({ mode: 'parallel' });

for (let i = 0; i < N; i++) {
  test(`launch ${i}`, async ({ page }, testInfo) => {
    test.skip(!process.env.MEASURE_HARNESS, 'measurement only: run with MEASURE_HARNESS=1');
    // Default: let a stall run its natural course so its real cost is visible; MEASURE_TEST_TIMEOUT=60000 mimics the suite.
    test.setTimeout(Number(process.env.MEASURE_TEST_TIMEOUT || 300_000));
    const t0 = Date.now();
    const pending = new Map<any, { url: string; t: number }>();
    const failed: string[] = [];
    const consoleErrors: string[] = [];
    page.on('request', r => pending.set(r, { url: r.url(), t: Date.now() - t0 }));
    page.on('requestfinished', r => pending.delete(r));
    page.on('requestfailed', r => { pending.delete(r); failed.push(`${r.url()} ${r.failure()?.errorText}`); });
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
    page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message.slice(0, 300)));
    let diag: any = null;
    const snap = setTimeout(async () => {
      const evalP = page.evaluate(() => {
        const w = window as any;
        const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        return {
          readyState: document.readyState,
          startupSyncDone: !!w.__startupSyncDone,
          lastSync: !!w.__lastSyncSummary,
          hexDb: typeof w.HexDB !== 'undefined' ? (() => { try { return w.HexDB.getAll().length; } catch (e) { return 'err'; } })() : 'undef',
          mapData: typeof w.mapData !== 'undefined' && !!w.mapData,
          resources: res.length,
          slowResources: res.filter(r => r.duration > 2000).map(r => `${r.name} ${Math.round(r.duration)}ms`).slice(0, 20),
          sinceNav: Math.round(performance.now()),
        };
      }).catch(e => ({ evalError: String(e).slice(0, 200) }));
      const timeoutP = new Promise(r => setTimeout(() => r({ evalError: 'page.evaluate did not answer within 5 s' }), 5000));
      diag = {
        atMs: Date.now() - t0,
        loadavg: os.loadavg().map(x => +x.toFixed(2)),
        page: await Promise.race([evalP, timeoutP]),
        pendingRequests: [...pending.values()].map(p => `${p.url} (since ${p.t} ms)`).slice(0, 30),
        failed: failed.slice(0, 20),
        consoleErrors: consoleErrors.slice(0, 20),
      };
    }, SLOW_MS);
    // MEASURE_THROTTLE=N slows the renderer's main thread N-fold (CDP CPU throttling) to emulate a starved machine.
    if (process.env.MEASURE_THROTTLE) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.MEASURE_THROTTLE) });
    }
    // Fault injection (failure-mode measurement): MEASURE_INJECT=hang-once never answers one startup sprite request
    // during the first page load only (a stuck request that holds network-idle); hang-always does it on every load.
    const inject = process.env.MEASURE_INJECT;
    if (inject) {
      let docs = 0;
      page.on('request', r => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) docs++; });
      await page.route(/coastline\/Coastline_2_Bottom\.png/, route => {
        if (inject === 'hang-always' || docs <= 1) return;   // never fulfilled
        return route.continue();
      });
    }
    let error: string | null = null;
    try { await openEditor(page); }
    catch (e) { error = String(e).slice(0, 2000); }
    finally { clearTimeout(snap); }
    const ms = Date.now() - t0;
    const retries = testInfo.annotations.filter(a => a.type === 'startup-retry').length;
    if (diag) diag.pendingAtEnd = [...pending.values()].map(p => `${p.url} (since ${p.t} ms)`).slice(0, 30);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.appendFileSync(OUT, JSON.stringify({
      i, worker: testInfo.workerIndex, ms, retries, error, loadavg: os.loadavg().map(x => +x.toFixed(2)), diag,
    }) + '\n');
    if (error) throw new Error(error);
  });
}
