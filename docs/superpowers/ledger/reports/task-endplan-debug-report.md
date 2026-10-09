# End-of-plan full-suite failures: debug report

Branch `feature/editor-roadmap`, start HEAD 78838a2, end HEAD b556820. Date 2026-10-06.

## Root cause (with evidence)

The editor and the harness were not stalling. **The Mac was asleep.** On battery, it went into idle sleep at 21:15:50
(`Entering Sleep state due to 'Idle Sleep' ... Using Batt`). After that it ran only in about 45 s maintenance dark
wakes, roughly every 502 s. Both full runs (22:09-22:36 and 22:36-23:03) ran entirely inside those slices. From
`pmset -g log`:

```
22:28:02 Sleep    Entering Sleep state due to 'Maintenance Sleep' ... Using Batt (Charge:100%) 502 secs
22:36:24 DarkWake DarkWake from Deep Idle [CDNP] : due to ... rtc/Maintenance Using BATT ... 45 secs
22:37:09 Sleep    ... 'Maintenance Sleep' ... 502 secs
22:45:31 DarkWake ...            (repeats every ~9 min until 23:18:35)
```

- The signature matches this. In each stall, all three workers failed together after about 500 s (`8.4m`), and the
  `startup retry: ... after 500.7 s` lines arrived in pairs or threes. The sleep was 502 s. Even Playwright's own 60 s
  test timeout did not fire until the next wake.
- The caffeinate assertions were taken during a dark wake. `caffeinate -i -s` (global-setup) does not end a dark wake,
  and `-s` only applies on AC power, so the slices continued.
- **Why the 20 s cap "lasted 500 s":** Node timers do not advance while macOS sleeps. The cap held in awake time, and
  the extra wall time was the sleep. The harness bug was in the diagnosis, not the bound. The freeze detector did see
  the gap, but its `NOTE` line was only in the annotation. The logged first line did not mention it.
- **Product cleared:** with the machine fully awake, the same specs ran green at 78838a2 and no bisect was needed:
  hex-utils + city + layers + fixwave1 + help-menu gave 245 passed, 1 skipped, 0 stalls, 1.4 min. The only failure was
  the known fixwave1:478. No startup request stays pending.
- **Proof of the fix:** a single `caffeinate -u` (declare user activity) turned the dark wake into a full wake:
  `23:19:01 Wake  DarkWake to FullWake from Deep Idle [CDNVA] : due to HID Activity`.

## What changed

1. `9ae1f4b fix(harness)`
   - `tests/global-setup.ts`: adds a one-shot `caffeinate -u -t 2` before `caffeinate -i -s -w <pid>`. It promotes a
     dark wake to a full wake and turns the display on. `PW_ALLOW_SLEEP=1` / `NO_CAFFEINATE=1` skip it.
   - New `tests/sleep-guard.ts`: a `pmset -g log` parser (`parsePmsetLog`, `sleepsBetween`, `readPmsetLog`).
   - `tests/startup-retry-reporter.ts`: prints `machine sleeps during the run: N`, with a warning when N > 0.
   - `tests/helpers.ts`: adds `startupHeadline()`. The first diagnostic line, which is the one the retry log prints,
     now includes `test process frozen ~N s (machine asleep?)`.
   - Tests: the new `tests/sleep-guard.spec.ts` was written RED first (module missing), then GREEN. It parses the
     real log lines from tonight and checks the frozen headline.
   - `tests/README.md` documents all of the above.
2. `4ddc9dd test(security)`: fixwave1 W1-3 package panel (see below).
3. `b556820 test(config)`: `globalTimeout` raised from 25 to 45 min in `playwright.config.ts` and `tests/README.md`.
   This was done only after the healthy full run below. The stale "~2-3 min" comment now says ~9-10 min.

The product code is unchanged. `tests/perf-baseline.json` and the perf hashes are untouched. No test was weakened.

## Tests changed (before / after)

- **fixwave1.spec.ts:478, W1-3 package panel and chips.**
  - Before: required every `#pkg-panel button[data-pkg-id]` and chip to have an inline `onclick` that matches
    `this.dataset.pkgId`. T5.1 rebuilt the panel with DOM APIs, so the panel buttons have no inline handler and the
    check failed.
  - After: asserts the safe property against the current DOM:
    - The raw hostile id is carried as `data-pkg-id` on the panel buttons and on the chips.
    - The id is rendered as text (`<code>`) and is the `tr[data-pkg]` key.
    - Panel buttons have zero `on*` attributes.
    - Chips have exactly one fixed handler, `Packages.togglePkgFilter(this.dataset.pkgId)`.
    - No `on*` attribute anywhere in the panel or chips contains the payload or `__pwn`.
    - Clicking Set active on the hostile row makes `Packages.getActive() === P2`, so the id travels as a property.
    - The chip click plus `noPwn` shows nothing executed.
  - Mutation check: interpolating `${p.id}` into the chip handler makes the test fail ("chips: one fixed handler").
- **Stall victims, unchanged and green when awake:** city.spec:92/114/141, hex-utils:14/28, help-menu:84,
  layers:352/373/391 and fixwave1:248/289/309. All of them failed at `openEditor` with a test timeout after 8.4 min.
  - help-menu:84 passes, so neither the guides nor the shortcut registry drifted, and no source of truth needed a fix.
  - The city failures are not real defects.

## Final full-suite evidence

`npx playwright test` (default config, list reporter, 3 workers), capped by a perl alarm at 2700 s because macOS has
no `timeout`. Log: scratchpad `final-suite-3.log`.

```
  5 skipped
  1513 passed (9.0m)
  startup retries: 0
  machine sleeps during the run: 0
real 9:00.81, exit 0
load average: 2.36 4.96 5.99 at start, 9.57 9.14 7.68 at end
```

0 failed. The 1518 tests are the 1515 before plus the 3 new sleep-guard tests.

## Note for whoever runs suites next

If the Mac is on battery and nobody is at it, check `pmset -g log | grep -E " (Sleep|DarkWake|Wake) "` before trusting
a stall. The reporter now prints the sleep count for every run.
