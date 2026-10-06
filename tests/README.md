# Tests

Playwright with the system Chrome (`channel: 'chrome'`). GitHub and the CDN are mocked in `tests/helpers.ts`.

```sh
npm install
npx playwright test                      # full default suite (~2-3 min, 3 workers)
npx playwright test tests/harness.spec.ts
npx playwright test --list               # list tests without running them
```

The static server (`npx serve`) is started by Playwright on a **per-checkout port**: 4000 + a hash of the
checkout path, so the main checkout and every worktree get their own server and never test each other's code.

## Environment switches

| Variable | Effect |
|---|---|
| `PW_PORT=<n>` | use this server port instead of the per-checkout one |
| `PW_REUSE_SERVER=1` | reuse a server already listening on the port (default: a busy port fails the run) |
| `PW_ALLOW_SLEEP=1` / `NO_CAFFEINATE=1` | macOS: do not hold `caffeinate` during the run |
| `HARNESS_STARTUP_CAP_MS=<ms>` | per-attempt editor startup cap (default 20000) |
| `HARNESS_NO_STARTUP_RETRY=1` | no startup retry in `openEditor`: the first startup failure fails the test (stall hunting) |
| `FULL_EQUIV=1` | exhaustive perf-culling equivalence sweeps (long) |
| `UPDATE_BASELINE=1` | rewrite `perf-baseline.json` (pre-change code only; see `perf-scene.ts`) |
| `MEASURE_UNDO=1`, `MEASURE_HARNESS=1` | opt-in measurement specs (`perf-undo-measure`, `*.measure.spec.ts`) |

`globalTimeout` stops a run after 25 min (a runaway guard). It is turned off when `FULL_EQUIV`,
`MEASURE_HARNESS`, `MEASURE_UNDO` or `UPDATE_BASELINE` is set.

## Startup failures and the sleeping Mac

The old "intermittent editor-startup stall" (task T2.H) was macOS idle sleep. With nobody at the keyboard the Mac
runs only in ~45 s maintenance wake windows every ~9 min, so any wait that spans a sleep ends ~8 min later.
`tests/global-setup.ts` holds `caffeinate -i -s` for the run. A startup failure prints the step it waited for, the
page state, the requests still in flight and whether the test process was frozen (asleep).
**Suite numbers from a machine that slept during the run are unreliable.** Re-run while the machine is awake.
The output ends with `startup retries: N`, and each retry is a `startup-retry` annotation on its test.

## Reading a run

- The default `list` reporter is required to see the final `startup retries: N` line (a second reporter prints it).
  `--reporter=line` or `--reporter=dot` replaces the config reporters and hides it. A run with retries above 0 hit a
  slow editor startup: look at the `startup-retry` annotations before trusting timing-sensitive results.
- Expected totals move as specs are added: record `passed / skipped / failed`, wall time, `startup retries` and `uptime`
  (load average) for any "suite is green" claim. Do not start a second run while one is going (one machine, one
  per-checkout server port); a busy port fails the run on purpose.
- Mutation runs (change the editor, run a focused subset, restore from a saved copy and `cmp`): use
  `--workers=2 --max-failures=1 --timeout=15000` and `-g "<test title>"` so a caught mutation stops at once. A cap
  like `--max-failures=3` makes failure counts "at least", not exact. Never restore with `git checkout -- <file>`:
  copy the file first (`cp MapEditorPro.html /tmp/h.bak`) and `cmp` after restoring.
- Focused runs share the default 60 s per-test timeout; heavy specs set their own.

## Writing tests here (standing rules)

- No vacuous assertions: a `>= 1`, `<= n` or "did not throw" check must be paired with proof that work happened
  (counts of cells written, rebuilds, calls). Give every negative check a positive control (the same gesture works
  unlocked / on the other layer) so a broken setup cannot pass.
- Independent references: compute expectations from pixel geometry (`Canvas.hexCenterWorld`, `ROW_PITCH`) or from a
  hand-written model, never from the function under test. Cover both parities (even and odd map height, odd and even
  q) and the map corners.
- No wall-clock: no `waitForTimeout`, no millisecond thresholds. Count work (renders, calls, rebuilds, ticks), compare
  ratios inside the same page, `expect.poll` for something that must happen, and for "nothing happened" use an
  ordering barrier (`quiesceAfterDialog` in `helpers.ts`, or two animation frames) instead of a sleep.
- Page state: inside `page.evaluate`, assign the bare binding (`MAP_WIDTH = 31`, `mapData = ...`). `window.MAP_WIDTH = ...`
  does not touch a top-level `let` and makes a test pass vacuously. Restore any page-local mutation of shared data
  (HexDB entries, wrapped functions) in a `try/finally`.
- Keep tests cheap: bare maps, few renders, low zoom. `openEditor` gives a 30x30 map; `freshEditor` (editor-helpers.ts) gives a blank 450x450 map with the city centred. Prefer small maps (`IO.newMap` then replace `mapData`) when the test does not need the default size.
- Make a changed or new test fail first (RED) for the right reason, and for a tightened test run one mutation of the
  code it guards.
- Layout-sensitive tests: new controls go in the left palette, not the top toolbar (the toolbar width sets the canvas
  width and the perf hash baselines). `tests/perf-baseline.json` is never edited by hand.
