# T2.13 report: Stamps panel

Commits: c8e806f (RED tests), 0444e60 (panel + CHANGELOG), plus this report commit.

## API (inside `Stamps`)
`initPanel()` (idempotent, called from the load handler after `Tools.init()`), `refresh() -> Promise`, `saveSelection() -> Promise`, `exportFile() -> Promise`, `importFile(event) -> Promise`. DOM: `#stamp-panel` (right panel body, between `#brush-panel` and `#right-active-terrain`), `#stamp-name` (maxlength 80, aria-label), `#stamp-save-btn`, `#stamp-export-btn`, `#stamp-import-btn`, hidden `#stamp-import-file`, `#stamp-list`, rows `.stamp-row[data-id]` containing `button.stamp-place` (thumb, `.stamp-name`, `.stamp-count`) and `button.stamp-del`, `#stamp-more`.

## Decisions
- Place: clicking anywhere on the row (or Enter/Space on the focused native `.stamp-place` button) calls `Tools.beginPaste`. Refused with a toast while a fill runs or while a move is lifted/stroke active (`Tools.isStroking`). One `toBuffer` per stamp (single-entry cache keyed by id, called through the public object so it is countable); same buffer object reused for repeat clicks, so the Clipboard geometry cache is hit. Never goes through `beginMove`.
- Unknown ids: paste proceeds, toast `N cells use tiles that are not loaded` (computed per paste session from distinct ids with `Terrain.byHexId`; not repeated while re-clicking the same stamp during the same paste).
- Save: refuses (toast, name kept) on empty/stale selection (`Selection.isEmpty` runs `sync`), running fill; store errors show `Could not save stamp: <message>` and keep the name; success clears the name only if it was not edited meanwhile; `_saving` flag blocks double submit. Enter in `#stamp-name` saves (T2.10 lift and all shortcuts are blocked by `_isTypingOrModal`, tested incl. Delete/Backspace/Esc/brackets/punctuation).
- Names only via `textContent`; delete confirm via `UI.confirm` (message is textContent too).
- Export: Blob link `stamps-YYYY-MM-DD.json` (local date); empty library toasts. Import: `file.text()` -> atomic `importJson`; toast `Imported N stamp(s)` or the Error message; input value reset before reading; 64 MB file cap.
- Lists: newest first; 100 rows per page with `Show more (N left)`; thumbnails (size 32) generated lazily through an IntersectionObserver rooted at `#stamp-list` (fallback eager if the API is missing). Work counter in tests: `toDataURL` calls.
- Refresh after save/delete/import and on load; a sequence token drops superseded refreshes. Panel never touches mapData, History, selection or autosave (tested).

## Deviations / honesty
- **1100x700**: the whole app has a fixed ~1931 px layout (canvas 1491 + two 220 px panels, `#main` overflow hidden). At 1100 px width the right panel (minimap, brush, my panel) is entirely off screen; this is pre-existing and affects the minimap too. I kept the panel on the right as the brief says and test usability at 1931x700 (narrowest width where the right panel is visible; height 700 is the binding constraint): save button in view, 12 rows reachable via the list scroll, a last row placeable. NOT done: making the right panel reachable on narrow windows (layout work, out of scope). Owner decision: move Stamps to the left palette, or fix narrow layouts.
- Hash-colour fallback for ids missing from `Terrain.color`: not done (would touch the colour path shared with the minimap); such cells still draw plain green in thumbnails.
- One T2.12 test ("IndexedDB open that fails asynchronously...") assumed no open connection at page start; the panel now opens one at load, so the test first drops the connection (deleteDatabase triggers the versionchange close). No product change.
- Ran `git checkout -- test-results/.last-run.json` (tracked run artifact, per implementer-rules) despite the "never checkout a file" instruction for source files.

## RED evidence
Commit c8e806f: 15 new tests, all 15 failed with `page.fill: Test timeout ... waiting for locator('#stamp-name')` (panel missing). After the panel: 83/83 in tests/stamps.spec.ts; first run had 4 failures (the T2.12 cold-open test, the 1100 viewport assumption, a non-counted `toBuffer` call, an async toast read) which were fixed as described above.

## Mutation table (T2.13 tests: 15; each mutation applied to a saved copy, restored and `cmp` verified)
| # | Mutation | Failing of 15 |
|---|---|---|
| 1 | no double-submit guard | 1 |
| 2 | names via innerHTML | 1 |
| 3 | name cleared even when save fails | 1 |
| 4 | import input value not reset | 1 |
| 5 | save ignores running fill | 1 |
| 6 | place ignores a lifted move | 1 |
| 7 | buffer rebuilt on every click | 1 |
| 8 | no paging (PAGE 100000) | 1 |
| 9 | thumbnails eager (no observer) | 1 |
| 10 | no unknown-tile toast | 1 |
| 11 | export name without date | 1 |
| 12 | delete without confirmation | 1 |
| 13 | Enter in the name field does not save | 1 |
| 14 | same-stamp re-click warns again | 1 |
| 15 | Enter/Space not isolated on the place button | 1 |

## Suite
`npx playwright test` (default): 729 passed, 5 skipped, 0 failed, 4.3 min, `startup retries: 0`, load average 9.1 during the run. tests/perf-baseline.json untouched.
