# T4.7 report: validator gate before export

Where: MapEditorPro.html (`MapValidator.gate/showIssues`, `IO.gateExport`, `IO.saveMap/exportCSV` now async, `GitHubSync.publishMap`), CHANGELOG, tests/validator-gate.spec.ts (new, 14 tests).
- Entry points found by grep: `IO.saveMap` (File > Save, Ctrl+S via initKeyboard, HexDB-mode Save button), `IO.exportCSV`, `GitHubSync.publishMap`. There is no separate save-as.
- `IO.gateExport()` (exported): waits for a running fill (`Tools.isFillBusy` loop on `whenIdle`), runs `MapValidator.gate()` once, re-checks map identity / fill-busy afterwards (toast, nothing written if the map was replaced while the summary was open). Replaces saveMap's old `.then(saveMap, saveMap)` re-entry.
- `gate()`: no issues -> true; warnings only -> toast "N validation warning(s)", true; errors -> `UI.showModal` (`#validator-gate-modal`) with Show issues / Cancel / Export anyway (danger); Escape, backdrop, Cancel, Show issues = false. Single-shot finish; a second request while the summary is open returns false (no stacked modals). Show issues opens the panel with the gate's own report (`showIssues(report)`, no second run) and jumps to the first error.
- Publish: gate after the name prompt (cancelling the prompt never validates); the JSON is rebuilt after the gate (map may change during prompt/fill).
- Deviation from brief: button labels per ruling ('Export anyway', 'Show issues'), not 'Save map anyway'; no `#gate-errors`; CSV is gated as well (brief did too). Autosave is not gated. No "skip validation" setting.
- Saved file is byte-identical: test compares the downloaded file to `IO.getMapJson()` for a clean map and a warnings-only map. Cancelled export: no download, JSON unchanged, undo/redo sizes unchanged, no 'Map saved' toast.
- Cost: one run per export (spy on the collectState `HexDB.getAll` read, filtered by stack), also one for Show issues.

RED: 13 of 14 failed before the implementation (the 'cancel publish name' test passed trivially). GREEN 14/14. Sanity mutation: skipping the fill-idle wait fails the "waits for a running fill" test (restored, cmp clean).
Focused: validator-gate 14 + validator-core 16 + validator-ui 9 + map-load-warnings 3 + no-native-dialogs + modal + storage-errors + autosave-recovery + startup-sync = 127 passed (1.1 min); plus phase1-cleanup + perf-fill + shortcuts + nav-bookmarks = 93 passed.
Not tested: HexDB Save button was click-tested through its onclick; Ctrl+S via real keypress.
