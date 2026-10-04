import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/** Prints how many editor launches needed the startup retry in helpers.openEditor (annotation 'startup-retry'). */
export default class StartupRetryReporter implements Reporter {
  private retried: string[] = [];
  onTestEnd(test: TestCase, result: TestResult) {
    const n = result.annotations.filter(a => a.type === 'startup-retry').length;
    if (n) this.retried.push(`${test.titlePath().slice(1).join(' > ')}${n > 1 ? ` (x${n})` : ''}`);
  }
  onEnd() {
    console.log(`\n  startup retries: ${this.retried.length}`);
    for (const t of this.retried) console.log(`    ${t}`);
  }
  printsToStdio() { return true; }
}
