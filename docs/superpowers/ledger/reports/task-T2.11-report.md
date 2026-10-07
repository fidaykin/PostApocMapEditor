# T2.11 report: Replace X with Y

Status: DONE. Commits: 924c690 (tests RED, 34/36 fail on 8fc1686), 29db7d4 (implementation, previous implementer), 9c42778 (finish: extra test, CHANGELOG placement).

## API
- `Tools.replaceTerrain(fromId, toId, cells|null, opts?) -> n` (null = whole map; opts.beforeWrite runs once, only when something will change; refused with 0 while a fill runs or a lifted region is moving), `Tools.replaceInfo() -> {scanned, matched, replaced, skipped}`, `openReplace/closeReplace/applyReplace`, tool `'replace'` (key H via `CODE_TOOLS`, e.code).
- Edit > Replace Tile... modal (ids `replace-from/to/sel-only/apply`), palette button in the left tool row (canvas stays 1491x808 at 1400x900, tested).

## Decisions
Exact, case-sensitive id match; target must exist in the DB; terrain only (zones/buildings/roads/under-terrain stay, bridge on a replaced cell removed); symmetry not applied; one planning pass then write; multi-tile anchors use shared `footprintCells()` with a fixed-point skip for clipped/overlapping footprints (row-major wins; skipped counted in toast); H on a footprint cell uses the anchor id; edges re-resolved via `_autoResolveEdgesAround` over written cells only; modal cancels with a toast if the map was replaced while open; Esc closes, Enter in a text field applies; `_isTypingOrModal(e)` used for H. The scan is synchronous (202,500 cells in one pass), as the brief allows. H is a click, not a drag, so Escape/lost-mouseup rules do not apply; non-left buttons are ignored (tested).

## Audit
Checked against the brief and standing rules: one History step with `History.push` inside beforeWrite (no step for no-op); isFillBusy refusal (API, modal, H, synthetic mousedown); stale-map cancel; multi-tile; edges; selection scope; 450x450 work-counter tests; layout; shortcuts; toasts with counts; one-step undo/redo. All present.
Findings: (1) CHANGELOG bullet had been placed below the `---` after Unreleased, outside the section: moved (fixed). (2) Mutation survivor: the row-major sort of selection cells was untested: added RED-first test (fails with the sort removed, passes otherwise). Nothing else needed.
tests/selection.spec.ts edits in 29db7d4: ALL inside the T2.11 `replace` describe added in 924c690 (corrections after the implementation showed the real footprint sizes: Dragon 6 satellites, odd-row legacy table K1 defect, compare against shared footprintCells; one fixture used Plain_3 that does not exist; edge test rewritten with independent resolveEdgeTile reference and stricter assertions). No pre-existing test was touched; none weakened (the changes made the T2.11 tests stricter or fixed their fixtures).

## Mutations (replace describe, 36 tests then 37)
| # | Mutation | Result |
|---|---|---|
| 1 | drop fill/stroke busy guard | 2 fail |
| 2 | beforeWrite called twice | 6 fail |
| 3 | drop empty-plan early return (empty step) | 3 fail |
| 4 | skip edge re-resolution | 2 fail |
| 5 | replace cells under another footprint | 1 fail |
| 6 | drop duplicate-cell dedupe | 1 fail |
| 7 | drop out-of-map footprint check | 1 fail |
| 8 | H shortcut ignores e.target typing check | 1 fail |
| 9 | H ignores footprint-cell anchor | 1 fail |
| 10 | keep bridge on replaced cell | 1 fail |
| 11 | drop overlap claim (winner) check | 1 fail |
| 12 | H ignores selection scope | 2 fail |
| 13 | drop stale-map check in modal | 1 fail |
| 14 | drop row-major sort | SURVIVED (36 pass) -> test added -> 1 fail |
Restored from a saved copy with cmp after each; `git checkout -- <file>` never used.

## Suite
`npx playwright test` once, alone: 640 passed, 5 skipped, 0 failed, 3.9 min (603 prior + 37 replace tests). No retries or flaky lines reported in output. uptime load averages 8.36 9.63 7.54. tests/perf-baseline.json and test-results/ not touched/committed.

## Not done
Replace stays synchronous (not chunked): single pass, brief permits.

## Fix round 1
Commits: df1df60 (planner fix, canonical id compare, Escape guard, tests, CHANGELOG), f73eb85 (test strengthened after a mutation survivor).

### Per finding
1. CRITICAL (overlapping multi-tile footprints). `_planReplace`: the overlap-claim pass now runs INSIDE the fixed-point loop. State is a set S of anchors that really change; every candidate not in S stays an X anchor and keeps its old footprint and cell occupied. Each pass walks S in row-major order and drops a candidate when its footprint leaves the map, hits a cell already claimed in the pass (anchor cell or footprint of an earlier winner), lies on the footprint of an anchor that is not in S, or covers a multi-tile anchor not in S. Drops only grow, so it terminates; each pass is linear in the survivors' footprint cells (no per-cell O(n^2)). Row-major winner determinism kept (existing tests pass). Known, valid but not optimal: when the earlier anchor A is dropped only because a later anchor B (dropped by the claim) now "stays" under A's footprint, both stay; B is not re-admitted.
   Tests (RED on 9c42778 code, GREEN on fix): reproduced scenario (Rabbit at 200,200 and 201,202 to Dragon), winner covering another X anchor's own cell (page-local Rabbit shrunk to 1 satellite NW, because in the real DB larger-Y footprints are adjacent to X so such layouts cannot exist; both row-major orders exercised), 3-anchor cascade, and a 200-layout seeded (LCG 20260705) invariant sweep on a 20x20 region in both directions (also asserts >100 replaced, >20 skipped, counts add up). Shared in-page invariant checker `__inv`: no cell claimed by two anchors (anchor cell included), every footprint cell registered to its anchor in the satellite map, no orphan satellites. RED evidence: reproduced scenario fails with "footprint cell 201,201 is registered to 201,200" / "cell claimed by Dragon@200,200 and Rabbit@201,200"; the sweep failed on layouts 15, 61, 65, 71, 109 (first 5 shown). Two of my fixtures first returned found:false (no valid adjacent layout with the real Rabbit) before the Rabbit shrink: not counted as RED.
2. IMPORTANT (vacuous toast). Fill-busy test split: (a) API returns 0 with no toast, openReplace's toast read BEFORE `await p` equals exactly ['Wait for the fill to finish'], modal not opened; (b) dialog opened and filled before the fill, applyReplace during the fill reaches the `_runReplace` guard: exact toast, nothing written, no step, dialog stays open. Both mutation-checked (below).
3. Escape: the shape/polygon branch now checks `!e.defaultPrevented`. Test: pending polygon (3 clicks), open dialog, Escape, then Enter still commits it (one step, terrain written).
4. Case-only ids: `applyReplace` and `_runReplace` compare with `Terrain.byHexId(to).id`; modal case ('Rubble_1','rubble_1') expects the "different" toast.
5. Titles: selected-scope test retitled (nothing outside changes because plain tiles have no edges); edge test retitled (neighbours outside the replaced list ARE rewritten, which it already asserted); stale-map test retitled and now also asserts the "map changed" toast.
6. Footprint test: Rabbit pixel-verified on an even row (pitchOk) before the replace, Dragon must keep exactly those cells and add 3 distinct new ones; comment explains that the added SE/S/SW offsets are 2 steps on even rows (K1) and why odd rows only have the shared definition.
9. CHANGELOG: multi-tile rule rewritten to the real behaviour, canonical id note, and the `e.target` typing guard now covering L O G X A M H plus Escape not cancelling a pending shape.
Skipped: (7), (8) as allowed.

### Mutations (replace describe, 43 -> 47 tests)
| # | Mutation | Result |
|---|---|---|
| 1 | single planner pass (no re-check) | 4 fail (reported, covered, cascade, sweep) |
| 2 | drop in-pass `claimed` footprint check | 2 fail (reported, sweep) |
| 3 | drop "footprint of an anchor that stays" check | 3 fail |
| 4 | drop "multi-tile anchor that stays" check | SURVIVED (43 pass) -> covered-cell test now runs both row-major orders -> 1 fail |
| 5 | remove openReplace busy toast | 1 fail |
| 6 | remove `_runReplace` busy guard | 1 fail |
| 7 | drop `!e.defaultPrevented` on shape Escape | 1 fail |
| 8 | drop canonical check in applyReplace only | survives by design (the identical check in `_runReplace` is a second line of defence) |
| 8b | drop both canonical checks | 1 fail |
| 9 | drop own-cell claim check | 2 fail (existing overlap tests) |
Each restored from a saved copy and verified with cmp; `git checkout -- <file>` never used. tests/perf-baseline.json and test-results/ untouched.

### Suite (fix round 1)
`npx playwright test` once, alone, to completion at f73eb85: 646 passed, 5 skipped, 0 failed, 3.9 min, `startup retries: 0` (640 existing + 6 new: 4 multi-tile, 1 from splitting the fill-busy test, 1 Escape). uptime load averages 8.30 8.20 7.00. git status clean (test-results/ ignored; perf-baseline.json untouched).
