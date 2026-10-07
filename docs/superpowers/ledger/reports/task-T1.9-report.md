# T1.9 report: Worker infrastructure and Satellite classification

Status: DONE (with minor notes)

## Implemented
- map-jobs.js: DOM-free `MapJobs.satellite(job, onProgress)` plus the moved `_rgbToHsl/_sample/_classifyColor` (parameterised). ONE implementation, used by the worker and the sync fallback.
- map-worker.js: `importScripts('map-jobs.js?v=1')`, runs the job, transfers result typed arrays.
- MapEditorPro.html: script tag after zone-painter.js; `WorkerJobs` module (run / cancelAll / usingWorker / forceSync). Any failure (constructor throws, onerror/404, postMessage failure) falls back to MapJobs on the main thread; pending jobs are retried synchronously on onerror. Pixel buffer is copied then transferred (caller keeps its own for re-classification).
- Satellite: `_classify` async with job token (`_classTok`), `_busy`, try/catch/finally with `UI.progressDone` always called for the live job; errors toast. Result applied only if MAP_WIDTH/HEIGHT and the `mapData` reference at completion equal those at start (else toast + discard). `apply()` refuses while busy and re-validates the same identity (then History.push once, as before). `open()`/`close()` cancel: token bump + `WorkerJobs.cancelAll()` (terminates worker) + progress cleared; close clears `_classified`. A new classification supersedes a running one (terminates its worker). Exposed `Satellite._getT` and `Satellite.reclassify()` (returns the promise; used by tests, the debounce calls it too).
- Deploy: no change needed. deploy.sh merges the whole branch into gh-pages; deploy-dev.yml copies only the HTML (with `<base href="../">`, so map-jobs.js/map-worker.js resolve from the gh-pages root) and neither lists zone-painter.js. A lint test asserts this (and would require the new files if zone-painter.js were ever listed).
- Brief drift: `_classify` line numbers stale; used `Satellite.reclassify` instead of the brief's onParamChange-only test; `Worker` created with `?v=1` URL.

## Tests (tests/perf-workers.spec.ts, 11 tests)
RED: first run, all 11 failed (MapJobs undefined). GREEN: 11 passed.
Covers: worker == baseline (usingWorker true); forced sync == baseline; Worker ctor throws -> fallback == baseline; worker onerror -> fallback == baseline; worker vs direct MapJobs byte-identical; stale discard on IO.newMap mid-job; close mid-job terminates worker (counted) and applies nothing, next job works; UI ticker ticks during job (read right after promise resolves); sync reference measurement; lint (script tag before WorkerJobs, map-jobs.js DOM-free, worker importScripts, deploy files).
Full suite: 212 passed, 4 skipped (216), 0 failed.

## Longest main-thread block, 1024x1024 image -> 450x450 map, sampleR 3
Before (sync, also the fallback path): 39 ms single block. After (worker): about 6 ms longest gap (result array conversion + preview); job 38 ms wall, 6 ticks at 5 ms during it.
satellite_synth hash unchanged (744f6a72); baseline not regenerated.

## Concerns
- The sync fallback (file://) is still one uninterrupted block, as the brief specifies (not time-sliced).
- No explicit hooks in New Map/Load to cancel; they are handled by the completion identity check (discard + toast) rather than worker termination.
- Other bulk writers (Generator) are not gated by a running satellite job; the result-identity check protects correctness.

## Fix round 1
Changes:
- I1 dev deploy: deploy-dev.yml now triggers on map-jobs.js/map-worker.js too, copies both into dev/ (via /tmp, since the step checks out gh-pages), and rewrites the script tag to `dev/map-jobs.js` and the Worker URL to `dev/map-worker.js` (base href is `../`; importScripts follows the worker URL). The step greps that both rewrites applied. YAML validated (ruby YAML.load_file; no PyYAML here). Handshake: `MapJobs.VERSION = 1`; page sends it per job; worker replies `version-mismatch`, treated as worker failure (sticky) with sync fallback.
- I2 lint: replaced with a test that checks paths/cp/commit/rewrite patterns in deploy-dev.yml and that each local `<script src>` in the HTML is published into dev/ or in an allowlist (zone-painter.js).
- M3: `onmessageerror` handled like onerror; watchdog (`WorkerJobs._watchdogMs`, default 20 s, reset by progress) falls back with the toast.
- M4: one worker per job run, terminated on completion/cancel; `run(type, job, {owner, onProgress})` (function third arg still works); `cancel(owner)` / `cancelAll()`. Satellite uses owner 'satellite'.
- M5: completion compares map SIZE only; on mismatch the result is discarded and classification re-runs; apply keeps the identity check, and on mismatch re-classifies (no stale preview with Apply disabled).
- M9: GENERATOR MODULE banner restored above `const Generator`.
- M8: onerror test asserts usingWorker()===false; the sync reference test records an annotation; added equivalence test against a verbatim copy of the old classifier (sampleR 4, sens 0.2, flipY, 37x29).
Tests: perf-workers.spec.ts 18 passed (new: version mismatch, VERSION accepted by real worker, messageerror, watchdog, owner-scoped cancel, legacy equivalence, size-change/same-size, deploy lint). perf-equivalence passes, baseline untouched. Full suite: 219 passed, 4 skipped, 0 failed.
Follow-up (not done): zone-painter.js has the same dev-staleness issue (dev resolves it from the gh-pages root); it is allowlisted in the lint test.
