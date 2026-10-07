# T4.1 report: Go to coordinates

Where: MapEditorPro.html. Canvas: `_parseGotoEx`, `parseGoto`, `centerOnTile`, `getViewCenterTile`, `gotoText` (before `_rulerColAtScreenX`, exported). Palette: `#goto-panel` (`#goto-input`, `#goto-btn`) in the LEFT palette above Stamps, so the toolbar row and the 1491x808 canvas are untouched. Wiring in `Canvas.init` next to `#block-nav-input` (which is unchanged). tests/nav-goto.spec.ts (new); tests/editor-globals.d.ts NOT overwritten (it already exists). CHANGELOG entry.

Decisions
- No `G` shortcut (Polygon owns it); the input stops key propagation, so typing never triggers tool keys; Escape blurs; a pointer click on Go returns focus to the map (keyboard keeps it).
- Formats: `col,row` (comma or space), `app:x,y` (exact inverse of the status-bar formula), block `B:4` (centre as in `jumpToBlock`, same bounds as the ruler). Malformed and out-of-bounds are different toasts (no alert); the input gets `.invalid` + `aria-invalid`; the camera never moves on failure.
- `centerOnTile` is camera-only: no History step, no gates (works during strokes/fill), clamps like every camera move (a corner tile stays on screen but is not centred).

RED: before implementing, 12/12 tests of tests/nav-goto.spec.ts failed (`Canvas.parseGoto is not a function`, `#goto-input` missing). GREEN: 12/12. Tests use the hand-written hex geometry (pitches 60 / 40*sqrt3, odd worldX up) for both stagger parities at zoom 100 and 50, a hover round trip through the status bar (`App:` and tile), 1400x900 canvas 1491x808 and reachability at 1100x700.
Focused run: nav-goto, layout-narrow, stamps, layers, shortcut-layouts, modal = 304 passed, 0 failed (1.8 min). Perf specs not run (no render/pan/zoom code touched). Sanity mutation (app inverse col +1): parseGoto and round-trip tests failed; restored (cmp clean).
Not done / FYI: `app:` stays map-centre based while `Dist:` is city-relative (A17). Block `Z:99` and such report "outside the map".
