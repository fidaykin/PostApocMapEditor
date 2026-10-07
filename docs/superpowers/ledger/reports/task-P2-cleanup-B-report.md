# Phase 2 cleanup batch B (tests, comments, docs) - report

Base bbe1c01, HEAD fbdaa9d, 13 commits, tree clean. No behaviour change: the diff of MapEditorPro.html against bbe1c01 contains only comment lines plus the pre-commit hook's COMMIT stamp. tests/perf-baseline.json untouched. No subagents, no stash, no `git checkout -- file` (mutations restored from saved copies and `cmp`-checked).

## Done, per ledger item

| Ledger item | Result | Mutation check (each restored + cmp) |
|---|---|---|
| T2.1 odd-parity centre pixel tests | New test: random centres on 451x451 and 13x12, both q parities asserted as a positive control (neighbour pitch, rotate, mirror h/v vs `hexCenterWorld`) | `fromCube` row formula shifted: caught |
| T2.1 exact corner assertion | New test: four corners of 450x450 and 451x451 vs an independent pixel-distance count, literals pinned `[7,7,8,8]` for the default map | `_distinctCells` col lower bound -1: caught |
| T2.1 integer contract | New test: integer in gives integer, non -0 out (toCube/fromCube/disc/ring/neighbors/line/rotate/mirror) | `half` parity dropped in `_distinctCells`: caught |
| T2.1 deploy-lint `?v=` tie | perf-workers 'version, ?v= ...' now also ties the workflow's `dev/hex-utils.js?v=N` to the HTML's | workflow `?v=9`: caught |
| T2.4 circle test counts only | Ring and disc cells now asserted against a BFS over pixel adjacency (independent), plus counts | ring cell dropped in `_expandByBrush(ringCells)`: caught |
| T2.5 dead `window.__t` line | Removed (paint-tools rectangle/map-replaced test) | n/a |
| T2.6 hover-test restore | The wrapper is restored from a saved original, not a guess | n/a (cleanup) |
| T2.7 counted-rebuild vacuous | Per family: variants >= 1, 61 cells written, rebuilds in [1,2]; River_L_1 asserted as exactly `{0,0,0}`; Lake_1 note (only Lake_7 is a variant) in the test | `_writeTerrain` in scatter replaced by `return 0`: caught |
| T2.7 stale header comment | "grouped per variant" corrected to one pass through `_writeTerrain` (comment only) | n/a |
| T2.8 `_clampedCell` odd H | The marquee and rect edge/corner drag tests now also run on 31x31 and 30x31 | see note 1 |
| T2.8 order docs | Comment on `_rectCells` (column-major vs row-major `getCells`) | n/a |
| T2.9 N1 vacuous sub-assertion | A pasted `T_S` on ring[1] now proves cleanup-before-write (ring1 survives, count 2) | cleanup moved after the write: caught |
| T2.9 N2 `_floatCell` | Known-gap comment at the declaration (drop is guarded by `_floatStale`) | n/a, behaviour left alone |
| T2.9 N3 Eraser doc comment | Moved from above `_resettable` to `_resetCells`; two-pasted-anchors test now also runs the reversed buffer order (the earlier BUFFER cell wins) | plan items sorted row-major: caught |
| T2.10 toast wording | New test pins the exact singular and plural 'fell off' toast text | singular/plural logic removed: caught |
| T2.11 sweep conflict count | The 200-layout sweep asserts >= 30 conflicting layouts (seeded: 59) | `info.skipped = 0`: caught (by the count identity check, see note 2) |
| T2.11 try/finally restore | Both page-local Rabbit footprint mutations restore the offsets in `finally` | n/a |
| T2.12/13 startup isolation | Asserts the failure toast text 'Stamps panel failed to start: io boom' (recorded by a MutationObserver from startup), `HexDB.getAll().length > 0`, and that paint + Ctrl+Z still work | toast text changed: caught |
| T2.13 thumbnail test | Both `waitForTimeout(200)` replaced (`expect.poll` plus two animation frames) | observer made eager (`isIntersecting` ignored): caught |
| T2.13 CSS comment, CHANGELOG | `#stamp-panel` comment says left palette; 'Stamps panel's toast' now 'a toast' | n/a |
| T2.14 stale map on mouseup | Comment in `_onUp` | n/a |
| T2.14 'Pick a building first' | Already unreachable through the UI (selection never becomes null); no test | n/a |
| T2.15 unused `hash` | Removed from the road describe | n/a |
| T2.15 blur test | Second gesture now draws a NEW tile, then blur: step and tile must stay (distinguishes commit from rollback) | blur handler made to roll back: caught |
| T2.15 Cmd shortcuts | 'Meta' added to the modifier list (Cmd+W/C/Q do not switch tools) | `metaKey` dropped from the shortcut guard: caught |
| T2.15 7-cell path | Exact list 222..228 @ row 224, plus an independent `lineCells` reference | no code mutation (strictly stronger than the old 3..12 bound; RED not captured) |
| T2.15 CHANGELOG | 'a shortest path' with the legacy-adjacency caveat; Connect Road crosses water, city, settlements and footprints | n/a |
| T2.16 dedupe test title | Retitled: the bridge tool acts on the press only, so no per-stroke dedupe is exercised | n/a |
| T2.16 redo pixel equality | Investigated, NOT established: after redo the river tile, bridge object and camera equal the live state, yet ~94% of pixels differ (mean abs 1.5/255, max 88), stable and repeatable. Comment with the hypothesis (restore rebuilds caches from scratch, live click updates incrementally) left in the test | n/a |
| T2.16 CHANGELOG | Bridge replaces any building on the tile; Lake tiles named | n/a |
| T2.17-19 | Lock matrix asserts the exact toast count (`toBe`, 1 by default, Polygon 3 and Connect Road 2: one per refused click; field `toasts` in the scenario); dead `W_`, `idx`, `CONTENT` removed; `Layers_NAMES` declared before use | `Layers.refuse` toasting twice: caught (27 failures) |
| T2.18/T2.19 CHANGELOG | 'never changed by any editing action' replaced by what is NOT covered (Expand Map shifts locked layers; hidden-but-unlocked layers stay editable; a running fill is not interrupted); Clear Map hidden-layer clause | n/a |
| T0/T1 | Fixed 300 ms sleeps in package-delete (2), package-publish (1), startup-sync (1) replaced with `quiesceAfterDialog` (dialog closed + 2 frames + one mocked round trip); zoom-floor `waitForTimeout(100)` x2 replaced by `expect.poll`; stale 'bumps the generation' comment (perf-fill); legacy-classifier comment in perf-workers now names `7ceb3a0^`; one-element loops in perf-lod | publish confirm made to publish without confirming: caught |
| tests/README.md | 'Reading a run' (default reporter is needed for `startup retries`, per-checkout port, no overlapping runs, mutation-run advice `--workers=2 --max-failures=1 --timeout=15000` and the copy + `cmp` restore) and the 'writing tests here' list of standing rules | n/a |

Note 1: the odd-H clamp tests pass, but mutating the stagger/half-height constants in `_clampedCell` is NOT caught on any size (the nearest-cell search over r+-1 and floor/ceil columns tolerates it). The tests are real regressions guards for the edge flip, not for that constant; it is effectively an equivalent mutation.
Note 2: the conflict-count minimum itself has no dedicated mutation (it only guards against the generator silently producing no conflicts).

## Skipped (tests/docs only scope)

Needs a product decision or a code change:
- T2.1 `mirrorCube` unknown-axis throw: the code does not throw (any axis other than 'h' is 'v'); no contract test written. Fractional input has no contract either.
- T2.3 persistence test: brush size is not persisted today; a test would pin current behaviour. Decide first.
- T2.6 `_eraseToken` retention test: the token is already nulled in `_onUp`; there is no accessor to test it from outside.
- T2.10 toast grammar ('1 objects') and off-map zone/road counted as objects: code change.
- T2.9 N2 `_floatCell` clearing on map replacement: code change (documented by comment only).
- T2.4 Escape cancelling a shape with modal or text focus, T2.6 Ctrl+Z ignored after a lost mouseup: behaviour.
- T2.15 Draw Road / Connect Road legacy adjacency (K1), road writes without terrain gates: owner decisions.

Not done for effort/risk reasons: negative-wait sleeps still present in autosave-recovery (3), no-native-dialogs (2), storage-errors (2), perf-fill (2), dialogs (2600 ms sticky-toast lifetime: needs `page.clock`); T0.13/T0.14 lint regex and dialog-content assertions; the 'mutation row notes' and 'report-count' items are report-only (this report states counts and mutation per item). The progress.md ledger claims a test comment should name 17a3fce; the one comment that named 7ceb3a0 is actually accurate for the removed classifier, so I only clarified it.

## Full suite

`npx playwright test` (default reporter, three workers), once, to completion on HEAD fbdaa9d: 998 passed, 5 skipped, 0 failed, 5.9m (357 s wall), `startup retries: 0`. Expected 990 + 8 new = 998 (hex-utils +3, marquee/rect odd-H +4, toast wording +1). Load average at the end 8.81 7.08 6.05 (other sessions on the machine). No background runs left.
