# T2.12 report: stamp store (IndexedDB `MapEditorStamps`)

Commits: faab930 (RED tests), 44419e0 (module + CHANGELOG), 3843c71 (test hardening after a surviving mutation).

## API (global `Stamps`, in MapEditorPro.html right after `Clipboard`)
All functions return a Promise and never throw synchronously.
- `save(name, buf) -> Promise<Record>`; `buf` is a `Clipboard.capture` buffer. Cells are validated and stored as a clean deep copy (unknown fields dropped). Record = `{ id, name, created, v:1, cells }`.
- `list() -> Promise<Record[]>` newest first; equal `created` ordered by id descending (deterministic).
- `remove(id) -> Promise` (unknown id is a no-op; drops cached thumbnails of that id).
- `exportJson() -> Promise<string>`: `{format:'mapeditor-stamps', version:1, stamps:[...]}`.
- `importJson(text) -> Promise<number>` count. Validates everything first, then ONE readwrite transaction; malformed input writes nothing.
- `toBuffer(rec)`: fresh deep copy `{v:1, origin:null, cells}`; accepted by `Clipboard.plan/place/write`.
- `thumbnail(rec, size=48)`: PNG data URL, transparent square, flat-top hexes (radius HEX_SIZE, scaled uniformly, centred) filled with `Terrain.color`; size clamped 8..512 (NaN -> 48); cached per id+size+cell count (max 256, FIFO), dropped by `remove`. Layout: x = COL_PITCH*dq, y = -ROW_PITCH*(dr + dq/2) (HexUtils has no `cubeToPixel`; this is the same layout as `Canvas.hexCenterWorld`, linear in cube offsets so both stagger parities work).

## Decisions
- Cells are stored exactly as `capture` produces them, including the `sat` footprint flag and every layer (`o`, `rd` any type, `b` any integer axis, `x`, `z`), so the T2.10 carry/skip rules behave identically after a reload (tested: plan items, carry and dropped counts equal, and placed maps identical, for identity and three transforms).
- Validation (shared by save and import): cells array 1..250000, integer dq/dr (|v| <= 1e6), `t` non-empty string (<= 200), no duplicate (dq,dr), optional `sat` boolean, `o` string, `rd`/`x` JSON-only plain objects (depth <= 8, <= 100 keys, strings <= 2000), `b` integer, `z` integer 0..65535. Unknown extra fields on cells and stamps are IGNORED (not stored); `v` is always written as 1. Keys `__proto__`, `constructor`, `prototype` anywhere (stamp, cell, rd, x) reject the file. Import limits: <= 10000 stamps, <= 2,000,000 cells total; the library also refuses to grow past 10000 stamps (checked in the same transaction). Version must be exactly 1, format `mapeditor-stamps`. Stamp `name` must be a string on import (empty/blank -> 'Stamp N').
- Names: trimmed, 80 chars (a surrogate pair is never cut in half), empty/non-string -> 'Stamp N' (N = stored count + 1, counted in the same transaction). Stored RAW (no escaping): T2.13 must render with `textContent`. Documented in a code comment.
- Ids: `'s' + time + counter + '-' + crypto.getRandomValues(3 x uint32)` (Math.random fallback). `created` is strictly increasing within a session (`max(Date.now(), last+1)`), so quick saves list newest first even in one millisecond; across sessions a clock that went backwards could misorder (id tiebreak keeps it deterministic). Import keeps a valid `created` from the file, else uses now. Importing the same file twice adds copies (fresh ids).
- Durability: every operation resolves on the transaction's `complete`, not on a request's success.
- Robustness: the DB is opened lazily on first use (nothing at startup, so a broken IndexedDB cannot affect startup). `indexedDB.open` throwing synchronously (SecurityError), async error and `onblocked` all reject with `Stamp storage is unavailable (...)`; the failed promise is not cached, so a later call retries. QuotaExceededError -> `Stamp storage is full ...`. `versionchange`/`close` drop the cached connection; an `InvalidStateError` from `db.transaction` reopens once and retries. Throws inside request callbacks are caught and abort the transaction with the real error (found by the quota test: an uncaught throw in `count.onsuccess` produced "Uncaught exception in event handler"). No toast is emitted by the module (the UI in T2.13 shows `err.message`).
- `origin` of `toBuffer` is null as the brief says; only `Tools.beginMove` reads `buf.origin` and it always uses a live capture. Note for T2.13: do not feed a stamp buffer to the move path.

## Tests: tests/stamps.spec.ts, 52 tests (all real IndexedDB in Chrome, ~20 s)
persist across a real `page.reload()`; stamps absent from map JSON / localStorage / every store of the `MapEditorPro` autosave DB (marker name searched) and `indexedDB.databases()` lists `MapEditorStamps`; New Map keeps stamps; export/import round trip; 28 individually named malformed imports (each: rejected `Invalid stamp file...`, no sync throw, list empty, `Object.prototype` not polluted); non-string input, 10001 stamps, 250001 cells; exactly 250000 cells accepted; unknown fields ignored; import is one transaction (third `add` made to throw: nothing stored); save validation; names; two concurrent saves distinct ids, 40 concurrent saves, frozen clock + frozen Math.random (30 distinct ids), strict newest-first with a frozen clock, equal-created tiebreak; remove / deep copy; toBuffer + place; RICH buffer (terrain, objects, two road types, two bridge axes, extras, zones, real `Rabbit_Flat_1` anchor with 3 `sat` cells carrying object/road/zone) saved, then a brand-new page session (`freshEditor` again) compared by deep equality to the original capture and placed under 4 transforms against the original with whole-map snapshot equality (preconditions assert each layer is really in the capture); transformed plan/carry/dropped equal and non-trivial; IndexedDB `open` throwing (SecurityError via init script) with editor startup unaffected and recovery afterwards, async open error and blocked, quota, closed connection reopen; thumbnail PNG/deterministic/cache count (canvases created == 2 for sizes 48 and 64)/clamping; thumbnail pixel test: three cells (Forest_1, Mountain_1, Desert_1, literal COLORS values) located from `Canvas.hexCenterWorld` (independent of the module's cube formula), exact RGBA at each centre, transparent corner, painted just inside each hex edge.

## RED evidence
Tests committed first (faab930) and run on the base (f73eb85 code): `52 failed`, every one `ReferenceError: Stamps is not defined` (saved at scratchpad/red.txt). GREEN after implementation: 52 passed. The brief's three sample tests are included in adapted form (real helpers: `freshEditor` from editor-helpers, `Clipboard.capture(Selection.getCells())`, `Selection.setCells`; brief's `clickCell`/`openEditor` imports unused; `Water_1` replaced by `Mountain_1` for the thumbnail colour table, see below).

## Mutation table (each applied to MapEditorPro.html, tests/stamps.spec.ts run, restored from a saved copy, `cmp` verified)
| # | Mutation | Failing of 52 |
|---|---|---|
| 1 | id = time only (no counter/random) | 6 |
| 2 | `created` not monotonic | 1 |
| 3 | list ascending | 1 |
| 4 | list without id tiebreak | 1 |
| 5 | `dr` not validated | 1 |
| 6 | prototype keys allowed | 4 |
| 7 | import swallows a failed add (not atomic) | 1 |
| 8 | toBuffer shares the record's cells | 1 |
| 9 | save stores the caller's cells (no copy/clean) | 0 at first (survived), then 1 after adding assertions in 3843c71 |
| 10 | name cap 200 | 1 |
| 11 | thumbnail cache ignores size | 1 |
| 12 | thumbnail y not flipped | 1 |
| 13 | failed open stays cached | 2 |
| 14 | `sat` dropped on save | 3 |
| 15 | cell limit off by one | 1 |
| 16 | version unchecked | 2 |
| 17 | no reopen on closed connection | 1 |
| 18 | quota not mapped to "full" | 1 |
| 19 | resolve before the transaction completes | 18 |
All 19 caught. (Mutation runs are slow in wall time only because each is a full spec run.)

## Suite evidence
Full default suite run once to completion on 3843c71 (before this report file was added): 698 passed, 5 skipped, 0 failed, wall 4.2 min (4:14 total), `startup retries: 0`, uptime load averages 12.62 10.15 8.11 (machine busy). 646 earlier + 52 new. tests/perf-baseline.json untouched; test-results/ not committed.

## Not done / honesty
- No UI, no paste-from-stamp, no toasts (T2.13). Library-size and cell limits are my choices from the brief's examples (plus a 2M total-cell cap).
- `Terrain.color` has no entry for many ids (e.g. Water_1), which render the default plain green in thumbnails; the thumbnail is faithful to `Terrain.color`, not to sprites.
- Not tested: a second tab holding the DB open during an upgrade (`onblocked` is only simulated), and `versionchange` handling is untested.
- Stamps saved with a custom-package tile id place an unknown tile if the package is not loaded (the brief's review-focus note); no warning is wired here.
- `created` monotonicity is per session only (see Decisions).
- Not tested: real quota exhaustion (simulated by throwing `QuotaExceededError`).
- The brief's literal Record had no `sat`; the module stores `sat` because capture emits it.

# Fix round 1

Wording correction (finding 8): the API note "All functions return a Promise and never throw synchronously" was wrong for two functions. `save`, `list`, `remove`, `exportJson` and `importJson` return Promises and never throw synchronously; `toBuffer(rec)` and `thumbnail(rec, size)` are SYNCHRONOUS. `toBuffer(null)` (or a record without `cells`) throws a TypeError (deliberately not guarded: it is a programming error, callers pass a record from `list()`). `thumbnail` tolerates a missing record/cells (blank image).

## Findings
- IMPORTANT 1a zones: `z` is now an integer 0..255 (the zone layer is a Uint8Array; zone ids come from the ZonePainter as small numbers). RED: BAD rows "z 256" and "z 300" were accepted (failed), plus save test.
- IMPORTANT 1b roads/extras: read the exporter (`{ col, row, ...v }`) and loader (`const { col, row, ...rest }`): only TOP-LEVEL `col`/`row` are position fields (nothing recursive), so `rd` and `x` now reject top-level `col`/`row` (`_cleanRecord`). `rd.type` must be a non-empty string (<= 200); the editor writes 'road_hex' and the loader/capture of any road has a type. Applied in `_cleanCells`, which `save` and import share (so save validates too); `toBuffer` unchanged. RED: 9 new BAD rows (z 256, z 300, road col/row, road row only, extras col/row, extras col only, road no type, type non-string, type empty) all failed against the old code (z negative already rejected, kept as a row); plus the save test and an import boundary test (z 255, road_hex accepted) which passes before and after by design. Round-trip tests (rich capture) stay green.
- MINOR 3: imported `created` greater than now is treated as invalid and replaced by the strictly increasing `_stamp()`; past values kept. RED: future-created test failed.
- MINOR 4: ids are now `'s' + time(base36, padded 9) + seq(base36, padded 6) + '-' + random`, so lexical order is creation order. New test imports 80 equal-`created` stamps (crossing the counter 36 rollover) and expects exact reverse order (RED failed). Old test title no longer says "newest id first". No migration (feature unreleased); the comparison still works for old ids, just not in creation order.
- MINOR 6: thumbnail test now counts canvases created after `remove` (must be 1, so `f === a` cannot pass without invalidation). `versionchange` test added: `indexedDB.deleteDatabase('MapEditorStamps')` while the module holds a connection must not fire `onblocked`, and the next `list()`/`save()` reopen (a higher-version open was not used: the module's later `open(…, 1)` would legitimately fail with VersionError). It passed on existing code (that handling existed), and fails when the handler is removed (mutation).
- MINOR 1 (thumbnail cost): when cells > 2*size*size, only every Nth cell is drawn (N = ceil(cells/size^2), deterministic), bounding box still from all cells and no per-cell point objects built. Work-counter test via `beginPath` count: 40 cells -> 40; exactly 2*48*48 cells -> all drawn; 250000 cells -> 0 < paths <= 48*48 (RED: 250000 paths). Pixel geometry test unchanged and green.
- MINOR 7: CHANGELOG reworded (rejected with a clear message, shown once the Stamps panel exists) and the 2,000,000 total-cell import cap, zone range and position fields mentioned.
- Skipped as instructed: 2 (fallback colour), 5.

## Mutation table (new/changed tests; MapEditorPro.html restored from a saved copy, `cmp` verified)
| # | Mutation | Failing of 68 |
|---|---|---|
| 1 | z limit 65535 | 3 |
| 2 | `col`/`row` allowed in rd/x | 5 |
| 3 | road `type` not required | 4 |
| 4 | future `created` kept | 1 |
| 5 | id counter not zero-padded | 1 |
| 6 | thumbnail sampling removed | 1 |
| 7 | sampling threshold far too low (> 10 cells) | 1 |
| 8 | `remove` keeps cached thumbnails | 1 |
| 9 | no `onversionchange` close | 1 |
| 10 | road cleaned with `_cleanJson` only (no record checks) | 6 |
All caught.

## Suite evidence
Full default suite once on the final code (before this report edit): 714 passed, 5 skipped, 0 failed, wall 4.2 min (4:15 total). That is 698 earlier + 16 new. No `startup retries` line appeared in the reporter output of this run (nothing printed, so no retry message was seen). uptime load averages 9.11 10.22 8.95. tests/perf-baseline.json untouched; test-results/ not committed.

## Not done
- Finding 2 and 5 skipped by instruction. A true second-tab version upgrade is not tested (deleteDatabase exercises the same `versionchange` path).
