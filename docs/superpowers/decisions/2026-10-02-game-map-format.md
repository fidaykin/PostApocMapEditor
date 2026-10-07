# Decision: does the game need a different map format than the editor JSON?

Status: OPEN. Owner: project owner. Raised: 2026-10-02 (roadmap "Open questions", Phase 4 item 4). Evidence refreshed 2026-10-06 against the Phase 4 editor.

## What the editor writes today
Read from `IO._buildJson` (MapEditorPro.html). Always present:

- `version: 2`, `packages` (sorted package ids used by the map, always includes `postapoc`), `width`, `height`
- `data`: rows of hex id strings, `data[row][col]`
- `settlements`: `[{col,row,type}]`, includes the city (`type: 'city'`; default 225,224 on 450x450, movable since T3.5)
- `settlement_priorities`: `{p1: [...ids], p2: [...ids]}`

Present only when the layer is non-empty (shapes pinned by `tests/map-json-contract.spec.ts`):

| Key | Shape |
|---|---|
| `bridges` | `[{col,row,axis}]` (`axis` is a number; the loader drops anything else) |
| `objects` | `[{col,row,id}]` |
| `tileExtras` | `[{col,row,...extra}]` (for example `underTerrainId`) |
| `roads` | `[{col,row,type}]` |
| `settlement_slots` | `[{minDist,maxDist,count,type,tapMultiplier,level,minSpacing,nearPct,midPct,farPct}]` |
| `zones`, `zoneMap`, `biomePresets`, `_zoneNextId` | all four together, when at least one zone exists (`zoneMap` is a base64 byte per cell) |
| `distance_bands` | ascending whole numbers, up to 10 (T3.6), omitted when unset |

Autosave additionally stamps `_autosavedAt`; that key is NOT part of exported files (`getMapJson`/Save write `_buildJson` output).

### Keys that exist only for the editor (candidates to strip in an exported game file)
`distance_bands` (T3.6, editor view/placement helper), `zones`/`zoneMap`/`biomePresets`/`_zoneNextId` (zone painter), `settlement_slots` and `settlement_priorities` (generator input; may or may not be read by the game), `tileExtras.underTerrainId` (bridge editing aid), `_autosavedAt` (autosave only). No other key was added in Phases 2 to 4: stamps, validator, bookmarks, history labels and PNG export do not write into the map JSON (bookmarks live in browser storage).

## What is unknown about the game
Nothing in this repository shows which loader the game uses for `maps/*.json`, whether it ignores unknown keys, or what ids it accepts. The editor does not reach the game repo.

## Owner questions (carried over from the phase ledgers)
1. Which loader reads `maps/*.json`, and does it accept this shape unchanged (option A) or reject/ignore the editor-only keys above?
2. Does the game accept an off-centre city? An older editor that reads a file with a moved city adds a second city at the default centre.
3. `bunker` and `megacity` settlement type ids: the placement tool uses assumed ids kept in one CONFIG object.
4. Artifacts: placed as objects (`Artefact_Test_1`) or as settlements?
5. Ore tile ids: `CopperVein_1` and `Uranium_1` are not in `hex_database.json` (copper and uranium are skipped); are there real ids? Cluster counts and sizes are assumed (gold 10x4, copper 10x4, gems 6x3, uranium 4x3).
6. Package reskins (no decision here): the editor's Reskin+ now defaults to a prefixed copy (`Medieval_Plain_1`); the optional same-id mode relies on the game letting an entry of the active package replace the base tile with the same id at runtime (the SP5 slot-override semantic). Does the game do that, and does its loader tolerate an extra optional field such as `basedOn` (the editor does not write one today)?

## Options
| Option | Meaning | Editor work |
|---|---|---|
| A | The editor JSON is the game format | None. Close this record. |
| B | The game wants a trimmed or reshaped file (no editor-only keys, flat array, numeric ids, ...) | Add `IO.exportGameJson()` as a pure adapter `editorJson -> gameJson`, unit-tested, new File menu entry. It must go through `gateExport()` (the shared wait-for-fill, `MapValidator.gate()` and map identity re-check used by Save, Export CSV and Publish, T4.7) before any file write. |
| C | Both formats must be published | B plus a "Publish game format" entry that writes `maps/game/<name>.json` and lists it in `map_list.json`, also behind the gate. |

## How to decide
1. In the game repo find the map loader (`grep -rn "map_list.json\|maps/" <game-repo>`).
2. List the keys it reads and any key it rejects. Compare with the tables above.
3. Answer the owner questions, record the answer here and mark Status DECIDED (A, B or C).

## Gate
Do not implement B or C before this record says DECIDED. Any change to the editor's emitted keys must update `tests/map-json-contract.spec.ts` in the same commit.
