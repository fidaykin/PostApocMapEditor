import { spawn } from 'child_process';

/**
 * macOS: keep the machine awake for the whole test run.
 *
 * Root cause of the "intermittent editor-startup stall" (task T2.H): with nobody at the keyboard the Mac idle-sleeps
 * (pmset `sleep 1`) and then only runs in ~45 s maintenance dark-wake windows every ~9 minutes. Every wait that spans
 * a sleep (startup readiness, the test timeout itself) ends only at the next wake, ~8 minutes later, so a 2-3 minute
 * suite took 20+ minutes with a burst of timeouts after each wake. `caffeinate -i -s -w <runner pid>` holds
 * PreventUserIdleSystemSleep + PreventSystemSleep (the latter applies on AC power) until the runner exits.
 * Set PW_ALLOW_SLEEP=1 (or NO_CAFFEINATE=1) to skip.
 */
export default function globalSetup() {
  if (process.platform !== 'darwin' || process.env.PW_ALLOW_SLEEP === '1' || process.env.NO_CAFFEINATE === '1') return;
  const child = spawn('caffeinate', ['-i', '-s', '-w', String(process.pid)], { stdio: 'ignore' });
  child.on('error', () => { /* caffeinate unavailable: run without it */ });
  child.unref();
  return () => { child.kill(); };
}
