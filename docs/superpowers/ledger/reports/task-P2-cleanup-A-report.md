# Phase 2 cleanup batch A (behavioural fixes) - report

All 7 items done, one commit each (A7 plus one test-fix commit). Tree clean apart from test-results/.

| Item | Commit | Notes |
|---|---|---|
| A1 shortcut layouts | 61b0171 | Letter shortcuts unified: typed Latin letter wins; physical key only when the typed key is not a Latin letter (Cyrillic) or, for the physical tools, not a letter at all (punctuation). Y symmetry joined the same table. Test tests/shortcut-layouts.spec.ts: 9 layouts (QWERTY, AZERTY, QWERTZ, Dvorak, Colemak, Workman, Turkish-F, Ukrainian, Russian), every tool reachable, each press triggers exactly its tool (two sentinels), plus concrete regressions. Limit: on Turkish-F typed q/w sit on the bracket keys (brush radius by design), so Road and Erase Road have no shortcut there (asserted explicitly). |
| A2 _ownsOwnKeys | 4146e94 | Restricted to role=button, .bld-card, button, a, input, select, textarea; removed from the transform-key branch. |
| A3 Connect Road start | 95d4e5a | Tools.clearRoadStart exported; called in History._restore (undo/redo/rollback), Clear Map, Fill Map, Satellite apply, QA placer, Generator apply; Esc on a pending start now preventDefault. |
| A4 bridge | 1963bd3 | (a) same-id removal before the terrain check; (b) stale id revalidated in _onDown; (c) object selectBuilding refuses Bridge ids ('Not a building for this tool'); (d) bridge button disabled + tooltip, refreshed from Tools.setActive and UI.buildPalette (the package-change hook). |
| A5 locks | d39667a (a), cd2e101 (b-e) | (a) priority inputs revert + one toast; (b) zone definitions ARE saved map data (toSaveObject writes zones and user presets) so gated by the zones lock: add, rename, colour, preset select, sliders (one toast per second), save preset; zone-painter.js tag now ?v=11, CHANGELOG notes dev staleness; (c) _fillZonesStep: with terrain locked the settlement result is computed on the side and a step is pushed only if the list changes, written after History.push; (d) polygon commit refuses and keeps the corners when terrain is locked; (e) Randomize & Fill with terrain+settlements locked randomises only the zone layer; History.push now precedes the zone list and layer writes. The existing T2.18 fill test still passes unchanged (its zone preset really places settlements); the empty case is covered by the new tests. |
| A6 Clear Map | 0cb6240 | (a) mapData identity and size captured at open, cancel with toast on mismatch; vacuous test replaced by one whose replacement map has content; (b) '(hidden)' suffix; (c) kept list = locked layers only, Bridges listed with reason text. |
| A7 layers | a18edf7, bbe1c01 | Status-bar element #st-layers (role=status, aria-live=polite, empty and display:none when nothing hidden or locked, text 'Hidden: Roads · Locked: Terrain'); canvas stays 1491x808 at 1400x900 (asserted). setActive('settlement') with Settlements hidden and locked: no unhide, no toast, no render; unlocked: one toast, one render. |

## RED evidence
- A1: 8 layout tests + concrete test failed before the fix (e.g. AZERTY KeyW/'z' gave road).
- A2: selection test failed on Enter-lift with a tabindex=-1 div focused.
- A3: 3 new tests failed (undo/redo, Fill/Clear Map, Esc preventDefault).
- A4: 4 new tests failed.
- A5a: passed with fix, failed with the guard mutated (mutation as RED). A5b-e: all 5 new tests failed against the HEAD code, passed after.
- A6: 4 tests failed against the HEAD html (3 new plus the rewritten text test), passed after.
- A7: 3 new tests failed against the HEAD html, passed after.

## Tests deliberately rewritten
- object-tools 'a bridge that sits on a non-river tile ...' before: clicking the same bridge on land was refused and kept; after: placing on empty land is refused, same-bridge click removes it in one step, undo restores it.
- layers 'the dialog text lists what will be cleared...' before: 'Kept (locked): Terrain, Bridges.'; after: 'Bridges (follow the Terrain and Buildings locks).'
- layers 'the map replaced while the dialog is open' (vacuous) replaced by a version with content in the new map and a positive control.
- layers 'hover shows only coordinates...': the status text now excludes #st-layers (the summary legitimately names the hidden layer).

## Mutations (each caught, files restored and cmp-checked)
1. A1 letter priority swapped (physical first): 3 tests failed.
2. A2 `[tabindex]` back in the selector = the RED run.
3. A3 clear in History._restore removed: 1 failed.
4. A4 removal-before-check disabled: 2 failed; stale-selection check removed: 1; object-mode bridge refusal removed: 1; button disabled flag removed: 1.
5. A5a guard disabled: 1 failed; dry-run no-change early exit disabled: 2 failed; polygon lock check disabled: 1; _uiAddZone gate removed: 1; zone write before History.push: 1 failed.
6. A6, A7: covered by the RED-against-HEAD runs (the HEAD code is the mutation).
Total: 12 explicit mutations (items 1-5 above list 12) plus RED-against-HEAD for A5b-e, A6, A7. A3 Generator/QA clears are not covered by tests (Fill/Clear Map, undo/redo are).

## Full suite
Before the final test edit: 989 passed, 5 skipped, 1 failed (the hover/status-bar test above, caused by the new element), 5.9 min wall (5:53), `startup retries: 0`, load average 8.56 7.17 6.57 (other sessions on the machine). The failing test was fixed and re-run alone (passed); no further full run. Count: 961 + 29 new = 990 expected.

## Not done
Nothing skipped. Decisions worth knowing: Turkish-F Road/Erase Road shortcut limit (brush bracket keys win by design); no test for Generator/QA-placer clearing the Connect start (code path added, same helper).

## Fix round (review findings I1-I12)
Commits: 34b94f8 (I1, I3, I4), 4b8148b (I2), 42d5837 (I5), 82dbcb3 (I6, I8), 04fecb5 (I7), 2513ff4 (I9, I10), d46bc66 (I11), d10f4c3 (I12 changelog). I12 rules/report edits live in the git-ignored .superpowers tree.
- I1: key names (Dead/Process/Unidentified) and isComposing return early; typed char must be ONE code point; physical key-switch fallback requires a single non-Latin letter and !alt/!shift/!repeat; key-switch also ignores repeat. RED: new Option/dead/IME test failed against HEAD (Option+E gave eye). Mutations (each caught, restored + cmp): early return removed; altKey check removed; typedLatin guard removed; repeat guard removed.
- I3/I4: `\p{Script=Latin}` typed letters never use the physical key. Layout test now has a hand-written expected tool per (layout, physical key); Turkish-F x on Backslash and s-cedilla on Quote; QWERTZ Semicolon types o-umlaut, Slash types '-'. RED against HEAD: turkishF layout test failed (g-breve/dotless-i fell back to the physical key). AZERTY KeyM types ',' and correctly falls back to the physical m (expected written by hand).
- I2: findIndex(startsWith('Buildings')) and Bridges '(hidden)'. RED: dialog read 'Clear: Bridges, Terrain, Buildings (hidden), ...'. Mutations: indexOf variant, suffix removed: both caught.
- I5: `.tool-btn:disabled` style; object-mode selectBuilding refuses isRoad ids. RED against HEAD for both tests.
- I6: rename refusal rebuilds config; dblclick refuses while locked; Esc cancels without writing/toasting; colour input re-checks the lock; zone-painter.js tag now ?v=13 (v=12 then v=13 after I7), CHANGELOG dev note updated. RED against HEAD zone-painter.js: 3 of 4 new tests (the slider test passes on HEAD: it pins existing behaviour). Mutations: dblclick gate, cancelled flag, colour lock check, config rebuild, slider throttle (to always toast): all caught.
- I7: toast 'Terrain and Settlements are locked: randomised zones only'; CHANGELOG states zone definitions are outside Undo. RED: toast absent on HEAD.
- I8: zone-definitions test asserts exactly 6 refusal toasts; slider throttle test uses a mocked Date.now barrier (no sleeping).
- I9/I10: #st-layers nowrap/overflow/ellipsis/max-width 420, title with full text, no rewrite when unchanged. RED against HEAD: width 767 > 420; 5 mutations over a no-op sequence. Mutation: overflow:hidden removed: caught.
- I11: one test for Generator apply, Satellite apply, QA placer (each really applies: undo size +1). Mutations: each of the three clearRoadStart calls removed individually: caught each time.
- I12: rules line and mutation count (12) corrected; CHANGELOG notes shortcut rule and the Ctrl+A/C/X/V/D physical vs undo/redo typed caveat.
- Tests changed: shortcut-layouts per-layout tests (same names, hand-written table instead of derived); layers zone-definitions test `>= 5` toasts now `toBe(6)`; layers randomize-lock test gained toast assertions; Clear Map hidden-text expectations unchanged.
- Full suite: 1009 passed, 5 skipped, 0 failed, 6.0 min (6:00.6), `startup retries: 0`, load average 9.44 7.37 6.30 after (5.26 before). 998 + 11 new.
