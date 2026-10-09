# Task T2.H report: harness reliability (editor-startup stall)

Status: DONE_WITH_CONCERNS. Commit `251dba2` test(harness): keep the Mac awake during runs; bounded, diagnosable editor startup with one retry (base 5579d19).

## Root cause: macOS idle sleep, not the editor and not CPU load

The ~8-minute "stall" is the Mac sleeping. When nobody is at the keyboard, the machine (`pmset sleep 1`, `powernap 1`) goes into idle sleep. After that it runs only in maintenance **DarkWake windows of about 45 s, roughly every 9 minutes (about 500 s asleep each time)**. Every process freezes in between, Chrome and the Playwright workers included. A wait that spans a sleep can only end at the next wake. Once the machine wakes, the pending timeouts (startup waits, the 60 s test timeout) all fire together.

Evidence:
1. **The 8-minute cost reproduces with no editor involved.** In this session a plain `node -e "setInterval(tick, 5000)"` ticked at 5…35 s, and the next tick came at **402.5 s**. A probe test with a never-answered request logged 1 s heartbeats at 10.5 s and 20.5 s, then nothing until **+528.6 s**. At that point `waitForLoadState` (90 s cap) and the 60 s test timeout both fired at the same moment. A `sample` of the worker during the gap showed an idle event loop (`kevent`, 0 % CPU), not a blocked one.
2. **`pmset -g log` lines up with this.** From 19:12:15 on: `Entering Sleep state due to 'Idle Sleep'`. After that: `DarkWake ... 45 secs` → `Entering Sleep ... 'Maintenance Sleep' ... 500 secs`, repeating every ~9 min until the user woke the machine at 20:30:24 (`Wake ... pwrbtn`).
3. **The machine was in the same pattern during the earlier T2.4 work.** On 2026-10-04 there were DarkWakes every 5–9 min from 14:31 to 18:23, each 45–70 s long, with a full wake only at 18:31:54. Commits 79e33e6 (15:36:09) and a328e8c (17:42:35) were made inside DarkWake windows (15:35:39 and 17:42:00). So the "stalls under load 25–49" and the "20+ minute suites" came from work squeezed into 45 s windows. Load average spikes after each wake because everything that was frozen runs at once.
4. **Claude Code's own `caffeinate` doesn't prevent this.** It asserts only `PreventUserIdleSystemSleep` for 300 s per turn ("caffeinate asserting for 300 secs"). It lapses during long tool calls, and that assertion type doesn't stop maintenance sleep once the machine is in DarkWake.

### Candidates tested and ruled out (machine awake)
| Candidate | Experiment | Result |
|---|---|---|
| CPU load | 120 launches, workers=3, load avg 5–11 / 25–43 (CPU burners); full suite at load 17 and at 40–59 | 0 launches > 10 s; suites 2.2 / 3.0 min, 0 startup failures (372 launches each, max 8.3 s) |
| Overlapping full suites | 3 full suites staggered 15 s, sharing one server (load up to ~50) | all 3 finished in ~200 s; 1116 launches, p50 0.97 s, p95 1.3 s, max 8.3 s; 1 unrelated perf hash failure (perf-equivalence zoom 25) |
| (a) `networkidle` held by a pending request | fault injection: one startup sprite request never answered | awake: costs exactly the 60 s test timeout and teardown is fast. It only becomes 7–9 min when the machine sleeps during the wait |
| (b) `waitForFunction` raf polling starving | renderer CPU throttled 10x / 30x over CDP | startup 2.0 s / 5.2 s, slowing down linearly with no hang. Switched to timer polling anyway |
| (c) IndexedDB / profile sharing | fresh context per test | n/a. The bounded IndexedDB timeouts in the T0.12 restore path never showed up as slow |
| (d) goto racing / dying webServer | external server on 4173 killed and restarted every 2–8 s during 120-launch runs | dead server → immediate `ERR_CONNECTION_REFUSED` (14–47 ms), never a hang |
| teardown blocking | hung renderer (busy loop), never-fulfilled route + networkidle, never-resolving evaluate, 15 s test timeout | all torn down in 15–20 s. Teardown doesn't block while the machine is awake |

## What changed (commit 251dba2)
- `tests/global-setup.ts` (new, wired as `globalSetup`): on darwin it spawns `caffeinate -i -s -w <runner pid>`. That holds `PreventUserIdleSystemSleep` + `PreventSystemSleep` (the latter applies on AC power) until the runner exits. I confirmed with `pmset -g assertions` during the final run that both are held "on behalf of" the runner PID, and that no caffeinate is left over afterwards. `PW_ALLOW_SLEEP=1` turns it off.
- `tests/helpers.ts`:
  - `STARTUP_CAP_MS = 20 000` (env `HARNESS_STARTUP_CAP_MS`). Each attempt (goto + readiness) gets one deadline. All waits use `polling: 100`, not rAF. `__startupSyncDone` is awaited with a deadline race.
  - The readiness signal is the existing deterministic one; no product change was needed (no `__editorReady`). The editor is ready when: HexDB has rows and mapData is set; `window.__startupSyncDone` is assigned (the last async step of the load handler); its promise has resolved; and the network has been idle for 500 ms. I kept network-idle on purpose, but bounded. It stands for "startup sprite loads settled" (Coastline/Roads/building sprites), which the pixel-hash tests depend on. Removing it would trade a non-cause for flaky hashes.
  - `EditorStartupError` messages name the step it was waiting for, plus: page state (readyState, HexDB rows, mapData cells, sync flags, open modals), requests still in flight with their ages, failed requests, console/page errors, the underlying cause, and a **freeze note**. The note comes from a 1 s heartbeat; a gap > 5 s means the process didn't run (sleep, SIGSTOP or a starved loop). I verified it by SIGSTOPping a worker for 10 s: "NOTE: the test process was frozen for ~10 s during this wait …". Node's timers keep counting through a sleep, so the detector uses wall-clock gaps rather than the monotonic clock.
  - `openEditor` retries startup once, and only on a fresh page (about:blank at entry). It goes to about:blank, clears the origin's storage over CDP (`Storage.clearDataForOrigin`, so the seed init script re-seeds and the second attempt starts like the first), and resets `nativeDialogs`/`pageErrors`. The retry is recorded as a `startup-retry` test annotation plus a `[harness] startup retry:` log line. A second failure fails the test with both diagnostics. `reloadEditor` uses the same bounded wait with no retry, because a reload is part of what those tests check.
- `playwright.config.ts`:
  - `navigationTimeout: 30 000`, which bounds gotos in specs that don't use the helpers (the default is no limit).
  - The `timeout: 60 000` comment now explains it has to stay above 2 × the startup cap.
  - New reporter `tests/startup-retry-reporter.ts` prints `startup retries: N` and lists the tests that used one.
  - `testIgnore` skips `*.measure.spec.ts` unless `MEASURE_HARNESS` is set, so the measurement spec adds nothing to the default run.
- `tests/harness-stall.measure.spec.ts` (committed, opt-in). Records ms-to-ready, retries and loadavg per launch, with a diagnostic snapshot for launches slower than 10 s. `MEASURE_INJECT=hang-once|hang-always` injects faults, `MEASURE_THROTTLE=N` throttles the renderer, and `MEASURE_TEST_TIMEOUT` sets the test timeout.
- Untouched: MapEditorPro.html (only the pre-commit COMMIT restamp) and tests/perf-baseline.json (unchanged).

## Measurements (120 launches, `--workers=3`, machine awake)
| Run | load avg (1 min) during run | p50 | p95 | max | > 10 s | > 30 s | errors | retries |
|---|---|---|---|---|---|---|---|---|
| before (old helper), 6 burners | 5.4–10.9 (mean 6.8) | 828 ms | 875 ms | 1086 ms | 0 | 0 | 0 | – |
| before, 30 burners | 35.3–42.6 (mean 39.2) | 869 ms | 1131 ms | 1640 ms | 0 | 0 | 0 | – |
| after (new helper), 6 burners | 7.3–11.4 (mean 8.9) | 779 ms | 846 ms | 897 ms | 0 | 0 | 0 | 0 |
| after, 30 burners | 25.2–37.4 (mean 32.6) | 832 ms | 973 ms | 1352 ms | 0 | 0 | 0 | 0 |

So with the machine awake, the stall rate is 0/120 both before and after: there was no awake stall to remove. The cost of a failure is what changed.

Failure mode with fault injection (3 launches each, 60 s test timeout):
| Injection | before: awake | before: asleep (machine slept mid-run) | after |
|---|---|---|---|
| hang-once (first load only) | fails at 60 s (test timeout), message `waitForLoadState: Timeout 90000ms exceeded`, no hint why | **7.1 min per test** (suite wall 974 s for 6 tests) | **passes in 21 s** (retry; annotation and reporter count = 3) |
| hang-always | fails at 60 s | 9.1 min | **fails at 40.3 s** with a diagnostic naming the stuck request: `requests in flight: [".../coastline/Coastline_2_Bottom.png (19968 ms)"]` |

## Full default suite (once, `npx playwright test`, no flags, after the change)
- Wall time **132 s** (Playwright reports 2.2 m); **343 passed, 5 skipped, 0 failed**; **startup retries: 0**.
- Load average 11.5 / 12.2 / 10.7 at the start and 10.4 / 11.3 / 10.5 at the end (left over from the burner runs just before; no burners during the run).
- Afterwards, the 5 helper-heavy specs (harness, startup-sync, autosave-recovery, storage-errors, no-native-dialogs) were re-run following the final diagnostic-only edit (heartbeat): 70 passed, 0 retries.
- Note: this run reused an orphaned `serve` on 4173 that one of my killed measurement runs had started from this same worktree, so it served the same files. I killed it afterwards.

## Concerns
1. **I could not test caffeinate inside an already-running DarkWake** (the user was at the machine when I verified it). On AC power `PreventSystemSleep` should keep a dark wake alive, but that's unverified. If a run still spans a sleep, startup failures now say so ("test process was frozen for ~N s"). Tests whose own timeout spans the sleep will still fail when the machine wakes. On battery `-s` does nothing, and only `-i` (idle) applies.
2. **Port 4173 is shared across checkouts** and `reuseExistingServer` is on. A run in one worktree silently uses another checkout's server, which means it tests the other checkout's code. The server also disappears when its owner run ends (later launches then fail fast with `ERR_CONNECTION_REFUSED`, and the retry can't help). The phase-1 report already noted a stray editor-roadmap server breaking a scratch-worktree run. I didn't change this because it's outside the startup scope. Recommendation: a per-checkout port, or `reuseExistingServer: false`.
3. **Implementer full-suite numbers from earlier tasks** that ran while the user was away (DarkWake periods, e.g. 14:31–18:23 on 10-04) are unreliable for this reason, not because of CPU load.
4. Under 3 overlapping suites, perf-equivalence "render hash at zoom 25" failed once with a different hash. It is load-related (not startup) and worth watching.
5. A retry wipes the origin's storage. That's correct for openEditor's fresh-page contract (every caller uses it as the first navigation), but a future test that seeds IndexedDB through another page before calling openEditor would lose that seed on a retry.

## Fix round 1 (commit e281dcb)

Changes:
- **Per-checkout port (Important).** `grep -rn 4173 tests playwright.config.ts .github`: the only hard-coded uses were the 3 in playwright.config.ts and the fallback origin in helpers.ts (there is no `.github` directory and no test builds absolute localhost URLs). `checkoutPort(__dirname)` = 4000 + FNV-1a(absolute path) % 1000. It gives **4878** for the main checkout `/Users/sergii.tyshchenko/Post Apo Map Editor` and **4476** for `.worktrees/editor-roadmap`. `PW_PORT` overrides it. One `PORT`/`BASE_URL` feeds `use.baseURL`, `webServer.command` and `webServer.url`. `reuseExistingServer` is now `PW_REUSE_SERVER === '1'`.
  - Verified: with a server already listening on 4476, `npx playwright test tests/harness.spec.ts` fails loudly ("http://localhost:4476/zone-painter.js is already used … set reuseExistingServer:true"). With `PW_REUSE_SERVER=1` the same run passes (2 passed).
  - Verified: `npx playwright test --list` lists `Total: 348 tests in 30 files` (343 + 5 skipped, as before) with no server running, and starts none.
- (1) `global-setup.ts` skips caffeinate on `PW_ALLOW_SLEEP === '1'` or `NO_CAFFEINATE === '1'`. New `tests/README.md` covers how to run, every env switch (`PW_PORT`, `PW_REUSE_SERVER`, `PW_ALLOW_SLEEP`/`NO_CAFFEINATE`, `HARNESS_STARTUP_CAP_MS`, `HARNESS_NO_STARTUP_RETRY`, `FULL_EQUIV`, `UPDATE_BASELINE`, `MEASURE_*`), `globalTimeout`, the sleep root cause, and a warning that suite numbers from a sleeping machine are unreliable.
- (2) The retry always wipes `new URL(test.info().project.use.baseURL).origin`. `newCDPSession` and `Storage.clearDataForOrigin` each go through `raceDeadline` (5 s), and a failure now propagates instead of being swallowed.
- (3) `HARNESS_NO_STARTUP_RETRY=1` disables the retry. Verified with hang-once injection: the test fails at 20.2 s with the diagnostic and `startup retries: 0`. Without the switch, hang-once passes in 20.9 s with `startup retries: 2` (2 launches).
- (5) `globalTimeout: 25 min`, set to 0 (off) when `FULL_EQUIV`, `MEASURE_HARNESS`, `MEASURE_UNDO` or `UPDATE_BASELINE` is set.
- (6) Removed the `w.__editorReady` read from the measure spec.

Tests:
- Harness, startup and UI specs (`harness`, `startup-sync`, `autosave-recovery`, `storage-errors`, `dialogs`, `paint-tools`, `package-import`): 116 passed (52.3 s), startup retries: 0.
- **Full default suite, once** (`npx playwright test`, no flags): **wall 133 s (2.2 m), 343 passed, 5 skipped, 0 failed, startup retries: 0**. Load average was 10.64 / 6.41 / 7.71 at the start and 10.09 / 7.50 / 7.94 at the end; I ran no burners, so that load came from other activity on the machine. Afterwards no `serve` or caffeinate process was left. tests/perf-baseline.json is unchanged.
