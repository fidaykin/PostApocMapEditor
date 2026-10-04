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
