# T4.6 report: Validator results panel

Where: MapEditorPro.html. HTML `<details id="validator-panel">` in the LEFT palette (before the Help section, collapsed by default): `#val-run`, `#val-filter` (All/Errors/Warnings), `#val-clear`, `#val-summary` (role=status, aria-live polite), `#val-list`. Panel code lives in the `MapValidator` module (`initPanel`, `runPanel`, `invalidate`, `jumpTo(key)`, `clearMarks`, `getReport`); `MapValidator.initPanel()` runs at startup in a try/catch next to the other panels. tests/validator-ui.spec.ts (new, 9 tests). CHANGELOG entry.
- No new shortcut and no menu item (rulings: prefer none; the brief's `V` would have needed all nine shortcut-layouts rows). Canvas stays 1491x808 at 1400x900 (tested).
- Click/Enter/Space on an issue = `Canvas.setHighlight('validator', cells)` (existing highlight layer, red) + `Canvas.centerOnTile(first cell)`; view only: no map write, no History step, no gate (tested mid eraser stroke). Highlight drops automatically when mapData is replaced. Clear marks removes it.
- Keyboard: real `<button type=button>` rows, Enter/Space stop propagation (no Space-pan/Enter-lift); pointer activation blurs the control (focus back to the map shortcuts, same pattern as Bookmarks), keyboard keeps focus.
- Untrusted ids: rows built with createElement + textContent/setAttribute only (test with `<img onerror>` ids: no img, no script, literal text).
- Stale handling: `_validatorStale()` -> `MapValidator.invalidate()` from History push/undo/redo/rollback/clear, `IO.scheduleAutoSave` and `bumpMapWrite` (covers new/loaded maps and bulk writers). The list stays, summary says "Results outdated (the map changed): press Run again." and the list dims. A jump does not make it stale. No auto-run: a spy on `IO.analyzeMap` counts exactly one call per Run click across edits, undo and New Map.
- Cost: only Run does work (core is bounded, see T4.5); invalidate is a flag check; rows are bounded by the core (<= ~100 issues, cells capped 200).

RED: 9/9 of validator-ui failed before the implementation. GREEN 9/9. Two test bugs fixed on the way (isStroking is erase/move only, so the stroke test uses the eraser; a same-tile paint is not an edit).
Sanity mutations (restored, cmp clean): invalidate no-op -> stale test fails; msg.innerHTML -> XSS test fails.
Focused specs: validator-core 16 + validator-ui 9 + map-load-warnings 3 + nav-goto + nav-bookmarks + shortcuts + shortcut-layouts + modal + layers + layout-narrow = 321 passed, 0 failed (2.0 min). perf-workers deploy lint not run (no new root script).
Not done / notes: highlight survives edits (cells may then be wrong until Run); the filter choice is not persisted; the Tab mode switch question from T4.0 is unchanged.
