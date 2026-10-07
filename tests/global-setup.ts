import { spawn } from 'child_process';

/**
 * macOS: keep the machine awake for the whole test run.
 *
 * Root cause of the "intermittent editor-startup stall" (task T2.H): with nobody at the keyboard the Mac idle-sleeps
 * (pmset `sleep 1`) and then only runs in ~45 s maintenance dark-wake windows every ~9 minutes. Every wait that spans
 * a sleep (startup readiness, the test timeout itself) ends only at the next wake, ~8 minutes later, so a 2-3 minute
 * suite took 20+ minutes with a burst of timeouts after each wake. `caffeinate -i -s -w <runner pid>` holds
 * PreventUserIdleSystemSleep + PreventSystemSleep (the latter applies on AC power) until the runner exits.
 *
 * End-of-plan suite (2026-10-06): a run STARTED inside a dark wake (machine already asleep, on battery) is not saved
 * by those assertions: the dark wake still ends after ~45 s and the run continues in 45 s slices ~500 s apart. A
 * short `caffeinate -u` (declare user activity) promotes the dark wake to a full wake ("DarkWake to FullWake ... due
 * to HID Activity" in `pmset -g log`; it turns the display on), after which -i keeps the machine from idle-sleeping.
 * The startup-retry reporter lists every sleep that still happened during the run.
 * Set PW_ALLOW_SLEEP=1 (or NO_CAFFEINATE=1) to skip both.
 */
export default function globalSetup() {
  if (process.platform !== 'darwin' || process.env.PW_ALLOW_SLEEP === '1' || process.env.NO_CAFFEINATE === '1') return;
  const wake = spawn('caffeinate', ['-u', '-t', '2'], { stdio: 'ignore' });
  wake.on('error', () => { /* caffeinate unavailable */ });
  wake.unref();
  const child = spawn('caffeinate', ['-i', '-s', '-w', String(process.pid)], { stdio: 'ignore' });
  child.on('error', () => { /* caffeinate unavailable: run without it */ });
  child.unref();
  return () => { child.kill(); };
}
