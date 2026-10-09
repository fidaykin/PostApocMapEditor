import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { parsePmsetLog, readPmsetLog, sleepsBetween } from './sleep-guard';

/**
 * Prints how many editor launches needed the startup retry in helpers.openEditor (annotation 'startup-retry') and,
 * on macOS, how often the machine slept during the run (from `pmset -g log`). Results from a run during which the
 * machine slept are not evidence of editor stalls: every wait that spans a sleep ends only after it.
 */
export default class StartupRetryReporter implements Reporter {
  private retried: string[] = [];
  private started = Date.now();
  onBegin() { this.started = Date.now(); }
  onTestEnd(test: TestCase, result: TestResult) {
    const n = result.annotations.filter(a => a.type === 'startup-retry').length;
    if (n) this.retried.push(`${test.titlePath().slice(1).join(' > ')}${n > 1 ? ` (x${n})` : ''}`);
  }
  onEnd() {
    console.log(`\n  startup retries: ${this.retried.length}`);
    for (const t of this.retried) console.log(`    ${t}`);
    const log = readPmsetLog();
    if (!log) return;
    // pmset stamps whole seconds: widen the window by 1 s on each side.
    const sleeps = sleepsBetween(parsePmsetLog(log), this.started - 1000, Date.now() + 1000);
    console.log(`  machine sleeps during the run: ${sleeps.length}`);
    for (const s of sleeps.slice(0, 20)) console.log(`    ${new Date(s.t).toISOString()} ${s.text.slice(0, 120)}`);
    if (sleeps.length)
      console.log('  WARNING: the machine slept during this run; timeouts and timings after a sleep are not editor failures. Re-run awake.');
  }
  printsToStdio() { return true; }
}
