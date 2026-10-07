# T1.10 report: Generator in the worker

Status: DONE. Commit 9e5c1c0.

## Implemented
- map-jobs.js: generator core moved here (noise, classify, smooth, river carving, scatter) plus `_resolveEdgeTile` (port of EdgeTiling.resolveEdgeTile, same neighbour order and one rng draw per tile) and `MapJobs.generate(job, onProgress)` returning `{names, grid: Uint16Array, elev?, moist?}` (Uint16 instead of Uint8 so >255 distinct ids cannot overflow). One implementation for worker and fallback. DOM/HexDB free.
- Page: `EdgeTiling.getMaskTable/FACE_NAMES`; `Generator._edgeContext()` builds structured-clone tables (typeByLowerId first-match, mask table, dirs) from HexDB. `_getGenT` (K5 cache) untouched. `Generator._buildJob` exposed for tests; `Satellite.isBusy()` added.
- Preview: async, token + cancel of owner 'generator' (previous worker terminated), size check, errors toasted; close() cancels (not during an Apply). Debounce unchanged. Preview is off the main thread.
- Apply: gated by Tools.isFillBusy and Satellite.isBusy, re-entry guard, button disabled, progress via UI.progress with progressDone in finally, size check and fill re-check at completion, then History.push once, expand grid to strings (sub-ms to ~few ms; not time-sliced, measured gap 5 ms total), settlements, close, render, minimap, IO.scheduleAutoSave. Errors: toast, modal not stuck.
- Version: MapJobs.VERSION = 2; page constant MAP_JOBS_VERSION = 2 is sent in the handshake and WorkerJobs.run rejects (message "does not match this page ... reload") if the loaded MapJobs.VERSION differs; `?v=2` on script tag, Worker URL, worker importScripts; deploy-dev.yml greps now assert `?v=2` for both rewrites (the sed patterns are prefix-based, so unchanged). No new files, so no new allowlist.
- Callers made async-aware: perf-undo-measure awaits Generator.apply (perf-fill calls it while a fill runs and only needs the sync refusal).

## Tests (tests/perf-workers.spec.ts, 16 new; file now 34)
worker==baseline, forced sync==baseline, Worker-ctor-throws==baseline, version-mismatch fallback==baseline (all generator_seed42, baseline NOT regenerated, hash unchanged), seed 9137 with 6 rivers: whole-map hash and river-tile count (>20) identical worker vs sync, preview job (plain and debug) worker == direct MapJobs, responsiveness (ticker ticks >5 during job, gap <150), block measurement, rapid-cancel, newer preview terminates older and close terminates last (fake workers, counted), owner-scoped cancel both directions with real workers, size-change discard (no write, no undo entry, button re-enabled), one undo entry and undo restores, worker error toast/cleanup, page-vs-file VERSION refusal, version/?v=/yml agreement lint, no duplicate generator core in the page.
RED caveat: I wrote implementation before the tests, so I did not capture a separate RED run.
Full suite: 236 passed, 4 skipped, 0 failed (240).

## Longest main-thread block (450x450, setTimeout(0) ticker, includes everything on the page)
- Apply: before (forced-sync path = old behaviour) 107 ms; after (worker) 5 ms (job wall 125 ms).
- Preview refresh: before 52 ms; after 17 ms (the rest is page-side canvas painting of the 270x270 preview).

## Concerns
- Sync fallback is still one uninterrupted block (as with Satellite).
- Preview cancels via WorkerJobs.cancel('generator'); apply() relies on _applying to avoid being cancelled by a debounced preview.
- K5 (stale _genT cache) intentionally not fixed (T3.9).
