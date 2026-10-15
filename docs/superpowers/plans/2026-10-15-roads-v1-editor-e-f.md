# Roads/Bridges V1 - Editor phases E and F

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Map Editor the Roads/Bridges V1 authoring surface: a per-tile `allowedRoads` list (Hex DB), validation against the Building DB, locked `Available Tiles` for road/bridge buildings, a transitional dual write that old Unity builds can still read (phase E); then defaults by tile type, the tiles x types matrix with bulk actions (one Undo step each), backfill, Reskin+/Paste carrying the fields and the map-side checks (phase F).

**Branch:** `feature/roads-v1-editor` from `dev` (e29159c). All work in `MapEditorPro.html` (single file), `tests/`, `docs/contracts/`, `CHANGELOG.md`, the two user guides. Never push from this plan. Working directory for every command: `/Users/sergii.tyshchenko/Post Apo Map Editor`.

**Sources (read before starting):**
- Spec: `/Users/sergii.tyshchenko/PostApocCityBuilder/docs/superpowers/specs/2026-10-14-roads-v1-design.md` - sections 3, 4, 6, 7 (E, F) and **8 (the authors' final decisions; section 8 overrides earlier text)**. Referred to below as `spec §n`.
- Unity plan (the data contract Unity already reads): `/Users/sergii.tyshchenko/PostApocCityBuilder/docs/superpowers/plans/2026-10-14-roads-v1-unity-b-d.md` (B2: `HexDatabase.roadsSchema` int + `HexRecord.allowedRoads` string[] + legacy `roadAllowed`; absent `roadsSchema` = old path, per FILE; missing/`null`/`[]` `allowedRoads` = nothing allowed). Referred to as `Unity plan`.

---

## Global constraints (every task)

1. **Production server, no publish without the owner.** No task, test or manual step may write to the real GitHub Pages repo. Tests use `FakeGitHub` only. The owner presses Publish; the plan only builds and verifies the capability. The release gate (task F9) ends at "ready for owner", not at a publish.
2. **Additive, back-compatible server data.** Old Unity builds (and the daily Unity `scripts/check-building-schema-sync.js`) must keep working. Rules the code must enforce:
   - `roadAllowed` stays in every record that is written, and is always the derived value (see decision D2).
   - `allowedRoads` and file-level `roadsSchema: 1` and `common.roadDefaults` are written **only when the owner switched the Roads write mode on** (decision D1). Default mode writes exactly what the editor writes today.
   - Publishing `allowedRoads` before the Unity build with `HexRecord.allowedRoads` (Unity plan B2) is merged makes the Unity CI FAIL (spec §3.6). The default-off mode is the guard.
3. **Four launch types**: two roads and two bridges, ids validated against the Building DB (decision D3 fixes the ids). Everything is data-driven: a fifth type added in the Building DB appears in the form and matrix without code changes (spec §1 success criterion 3).
4. **Hard fixture**: the spec §8 lists (Decameroon) must be expressible, and one shared test fixture (`tests/roads-fixtures.ts`, task E0) reproduces them exactly. See "Fixture: spec §8 lists" below.
5. TDD per task: write the Playwright test, run it RED, implement, run GREEN, commit. While iterating run only the touched spec (`npx playwright test tests/<file>.spec.ts -g "<title>"`); the full suite (`npx playwright test`, ~9-10 min, machine awake, no second run in parallel) only at the gates E8 and F9. See `tests/README.md` for the standing test rules (no wall-clock waits, positive controls for every negative check, assign bare bindings inside `page.evaluate`).
6. Commit per task with a conventional prefix; every commit message ends with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Stage files by name; **never `git add -A`**. The untracked `docs/guides/content-packages-editor-guide.pdf` and `docs/superpowers/plans/2026-07-21-content-packages-sp2.md` must stay untouched and uncommitted.
7. The injected-text / DOM rule of this file: new UI that shows ids, sprite names or package data is built with DOM APIs (`textContent`), not `innerHTML` (ids come from imported packages and are untrusted). The Hex DB form is the one place that builds HTML strings with `_esc(...)`; keep `_esc` on every interpolated id there.

---

## Decisions this plan takes (owner can overrule; each is also listed under "Open questions")

| # | Decision | Why |
|---|---|---|
| D1 | **Roads write mode**, a per-browser setting `roadsWriteMode` in localStorage, values `off` (default), `stage`, `active`. `off` = today's output byte for byte (no `allowedRoads`, no `roadsSchema`, no `roadDefaults`; `roadAllowed` as authored/derived). `stage` = adds `allowedRoads` on every record + derived `roadAllowed`, still **no** `roadsSchema` (Unity keeps the old path per file; this is spec §6 step 2). `active` = `stage` + `roadsSchema: 1` (+ `common.roadDefaults` in the base file) = Unity switches that file to the new path (spec §6 step 3). | Spec §6 step 2 vs step 3 and §3.5 contradict each other (see Findings F-1); three explicit states are the only way to satisfy "dual write during transition" and "publish blocked without backfill" together. Switching modes is a deliberate owner action with a confirm. |
| D2 | **Derived `roadAllowed` = true iff `allowedRoads` contains at least one id whose Building DB record has `isRoad: true`** (spec §4.5). The task brief said "true iff allowedRoads non-empty"; that rule is **not** used because it turns on the old flag for tiles that only list a bridge, and for `Water` tiles (Bridge_2 only) old Unity then allows the plain `road` on water. See Findings F-2. | Old Unity reads `roadAllowed` for custom ids (`RuntimeDatabaseSync.cs:297`, `BuildingManager.cs:550-555` per spec §2.2). |
| D3 | Type ids stay the live ids **`road`** and **`bridge`** (Road_1 / Bridge_1 = display names); new ids **`road_2`**, **`bridge_2`** (these are the ids the Unity plan's tests use). All ids are constants in one place of the fixture; a rename is a one-line change. | Spec §8 says "Road_1/Road_2/Bridge_1/Bridge_2" without saying whether these are ids or names; live ids are `road` and `bridge`, referenced by saves (`BuildingId`), map `objects[]` and Unity fallbacks. See Findings F-4. |
| D4 | **Hex DB has no undo stack** (`History` is map-only, `MapEditorPro.html:8599`). "Each bulk action is one Undo step" is implemented as a small **roads history** (`RoadsHistory`, snapshot of `{key -> allowedRoads}` for the touched records) owned by the matrix modal: Undo/Redo buttons and Ctrl+Z / Ctrl+Y while the modal is open (the global handler already stands down while a modal is open, `MapEditorPro.html:8860`). | Findings F-3. Alternative (rejected): extend `History` snapshots with Hex DB data; it would balloon every map snapshot and change a heavily tested module. |
| D5 | **Migration never invents `allowedRoads`.** A record that arrives without the field stays without it ("not backfilled"); `_blank()` creates `allowedRoads: []`. Backfill (F4) is the only thing that fills missing fields, and only the missing ones. | Spec §3.5 blocks publish for records without the field; normalising to `[]` on load would hide the need for backfill and silently remove every road (a regression). |
| D6 | Bridge-on-non-water and road-on-water are **warnings, not errors**, and the bridge checkbox is **not** disabled on non-water tiles. | Spec §8.2 replaces the "bridge only on Rivers/Water" check by the per-type tile list; spec §3.5/§4.1 still say error/disabled. See Findings F-5. |

---

## Verified code map (dev e29159c; every line number re-checked with `grep`/`sed` on 2026-10-15)

The spec's own `MEP:` numbers are from d97aa35 and have drifted (+60..+90 lines in the Hex DB module). Use these.

| Anchor | Location now (spec's old number) |
|---|---|
| `GitHubSync._withPublishBtn` (publish gate wrapper) | `:9683` |
| `GitHubSync._isBaseEntry` | `:9707` |
| `GitHubSync.publishHexDbOnly` (base file: `data = {...all, hexes}`, writes `packages/postapoc/hex_database.json` then root `hex_database.json`, then `refreshBaseManifestSafely`) | `:9713-9732` |
| `GitHubSync.publishBuildingsDb` | `:9781-9798` |
| `GitHubSync.loadHexDbIntoEditor` (wholesale load of the server base file) | `:9920-9937` |
| `GitHubSync.syncContentFromServer` (startup merge per package, calls `HexDB.mergeFromServer` / `BldDB.mergeFromServer`) | `:9961-10010` |
| `buildManifest` / `refreshBaseManifestSafely` (hash of the hex DB goes in automatically) | `:9482` / `:9616` |
| `History` module (map undo only; `push`, `undo`, `initKeyboard` skips while a modal is open) | `:8599`, `:8856-8860` |
| `Tools._bridgeBuildings`, `_isRiverTile`, `_placeBridge` (hard `type === 'Rivers'`), `_isRoadNetworkNeighbor`, `_paintRoad` (writes `{ type: 'road_hex' }`) | `:6819`, `:6885-6891`, `:7627-7647`, `:7669-7690` |
| `MapValidator` (`RULE_ORDER` `:16277`, `validate(st)` `:16304`, check 4 orphan roads `:16388`, check 5 `:16409`, `needRoad` state `:16439`) | `:16264-16460` |
| `Packages.exportPackage` hex file text (`{version:1, package, hexes}`) | `:14447` |
| `Packages.publishPackage` / `_publishPackageRun` (`hexPayload` `:14936`, first write `:14937`) | `:14875`, `:14936` |
| `Packages.validatePackageZip` (import checks, errors list) | `:15341-15470` |
| `Packages` import-to-server hex write | `:15851` |
| `HexDB` module | `:17214-18895` (`window.HexDB = HexDB` `:18895`) |
| `HexDB._blank` (`roadAllowed:false` `:17255`) | `:17248-17275` |
| `HexDB._DB_VERSION = 5`, `_tryAutoLoadDefaultDb` | `:17314`, `:17317` |
| `HexDB._autoSave` (`_rev++`, validator stale, StorageGuard) | `:17293` |
| `HexDB._migrateAll` (the pipeline run on server clones) | `:17393` |
| `HexDB._row`, `_checkRow`, `_selectInput`, `_sourceTagsHTML`, `_resourceBlockHTML` | `:17490`, `:17499`, `:17508`, `:17515`, `:17541` |
| `HexDB._renderRecord`; the **`roadAllowed` checkbox row** | `:17643`; `:17673` (spec: 17608) |
| `HexDB` input wiring (generic `[data-field]` listeners), Type select handler | `:17857-17866`, `:17872-17882` |
| `HexDB._readRecord` (**writes `h[f] = el.checked` for every `[data-field]` checkbox**) | `:18065-18098` (loop `:18071`) |
| `HexDB.init` (autosave restore + migrations) | `:18126-18250` |
| `HexDB.add`, `addReskin` (`structuredClone(base)` `:18297`), `copy`/`paste` (`structuredClone` `:18341`, `:18347`) | `:18254`, `:18273-18307`, `:18339-18356` |
| `HexDB._migrateSpecialFields` (`roadAllowed` normalisation `:18439`; spec: 18374) | `:18437-18455` |
| `HexDB.loadFromObject`, `load`, `save` (JSON of the whole `_data`) | `:18458-18480`, `:18482-18508`, `:18510-18522` |
| `HexDB.mergeFromServer` (3-way by package+id; `common` taken only when local equals `{goldPerTap:10}` `:18576`) | `:18562-18600` |
| `HexDB.setCommonGoldPerTap`, `_syncCommonUI`, `getData` | `:18680-18700` |
| `BldDB` module; `_blank` (`isRoad:false` `:18927`, `availableTiles:[]` `:18928`) | `:18897`; `:18908-18966` |
| `BldDB._migrate` | `:18968-19013` |
| `BldDB._renderRecord`: Category select `:19222-19228`, **Is Road checkbox `:19229-19230`**, Under Terrain (Bridge only) `:19245-19249`, **Available Tiles row `:19295-19296`** (spec: 19230) | `:19164` |
| `BldDB` re-render list `reRenderIds` (does **not** contain category or isRoad) | `:19640-19649` |
| `BldDB` tag add/remove wiring | `:19660-19700` |
| `BldDB._readRecord` (`buildingCategory` `:19792`, `isRoad` `:19809`) | `:19780-19900` |
| `BldDB.add`, `addReskin` (`structuredClone` `:19887`), `copy`/`paste`, `getJson`, `mergeFromServer` | `:19863`, `:19877-19902`, `:19974-19990`, `:20094`, `:20183` |
| `Packages.openReskinPicker` callers | `:18305`, `:19915` |

**Code reality that matters for the data**
- The dev checkout's root `hex_database.json` / `building_database.json` are **stale** (90 hexes, bridges named `Road_Bridge_NEWS_1`/`NS_1`/`SENW_1`, **no** `road` building). The live server has `road` (isRoad, price Gold 50, textId `building_road`) and `bridge` (category Bridge, price Gold 6500, `textId` empty, no `underTerrainId`). `openEditor` + `FakeGitHub` fall back to the checkout files, so **no roads test may rely on them**: every roads spec seeds its own Building DB/Hex DB (task E0 helper).
- Live Decameroon hex ids carry the package prefix: `Decameroon_Plain_1`, `Decameroon_River_L_1`, `Decameroon_Water_1`, `Decameroon_Fish_1`, `Decameroon_DirtyWater_1` (verified by GET of `packages/decameroon/hex_database.json` on 2026-10-15: 60 hexes, 29 Rivers incl. `Lake_1..7`, 5 Water incl. `BrokenShip_1`, `terrainTypeId: -1` everywhere).
- `terrainTypeId` in base hex records is the Unity `TerrainType` enum value (`Rubble_1..3 = 9..11`, `Plain_1/2 = 12/13`, verified in `Assets/_Project/ScriptableObjects/TerrainTypeDefinition.cs`). `Plain_Kaiju_1` has `terrainTypeId: 12` and `roadAllowed: true`. This makes the spec §6 backfill rule computable in the editor (task F4).
- The editor's map data has **no road type**: `roadsData[key] = { type: 'road_hex' }` (`:7684`), and Unity does not import map roads (spec §2.3). Bridges on the map are `objectsData[key] = <bridge building id>`.

**Fixture: spec §8 lists** (single source for `tests/roads-fixtures.ts`)
- Road_1 (`road`), 7 tiles: `Decameroon_{Plain_1, Plain_2, Rubble_1, Rubble_2, Rubble_3, Desert_1, Barren_1}`.
- Road_2 (`road_2`, test), 3 tiles: `Decameroon_{Plain_1, Plain_2, Rubble_1}`.
- Bridge_1 (`bridge`), 15 tiles: `Decameroon_River_{L_1, L_4, D_2, D_4, L_5, L_D_E_1, L_L_E_5, L_R_E_5, L_U_E_1, R_1, R_4, R_5, U_2, U_4, U_D_E_4}`.
- Bridge_2 (`bridge_2`), 3 tiles: `Decameroon_{Water_1, Fish_1, DirtyWater_1}`.
- Explicitly **not** in any bridge (spec §8.6, owner to confirm): `Decameroon_River_{D_3, D_L_EE_2, D_L_RE_2, U_3, U_L_EE_2, U_R_EE_2, U_U_E_4}`, `Decameroon_WaterStones_1`, `Decameroon_Lake_1..7`. Not mentioned by the spec at all: `Decameroon_BrokenShip_1` (type Water) and `Decameroon_DestroyedBuilding_1` (was a step-0 candidate): the fixture leaves both empty (Findings F-6).
- The fixture also carries: all 60 live Decameroon ids (type + `terrainTypeId: -1`), a trimmed live base set (`Plain_1`, `Plain_2`, `Rubble_1..3`, `Plain_Kaiju_1` with `roadAllowed: true`, `Hills_1`, `Mountain_1`, `Swamp_1`, 2 Rivers, 1 Water, with real `terrainTypeId`), and the four Building DB records.

---

## File structure

**Modified**
- `MapEditorPro.html` - new module `RoadPerms` (pure logic) before `HexDB`; `RoadsHistory`; Roads block in the Hex DB form; matrix + defaults modals; exporter; publish gates; Building DB lock; map checks.
- `tests/editor-globals.d.ts` - declare `RoadPerms`, `RoadsHistory`.
- `CHANGELOG.md` (Unreleased), `docs/guides/editor-guide.en.md`, `docs/guides/editor-guide.uk.md` and the generated `.html` guides (`node scripts/build-guides.js`; `tests/docs-lint.spec.ts` requires the HTML to be the rendering of the Markdown).

**Created**
- `tests/roads-fixtures.ts` - shared fixture + seeding helpers (E0).
- `tests/roads-core.spec.ts` (E1/E5 pure-logic checks through `page.evaluate`), `tests/roads-hexdb-form.spec.ts` (E3), `tests/roads-blddb.spec.ts` (E4), `tests/roads-publish.spec.ts` (E6/F4), `tests/roads-contract.spec.ts` (E7), `tests/roads-defaults.spec.ts` (F1), `tests/roads-matrix.spec.ts` (F2/F3), `tests/roads-backfill.spec.ts` (F4), `tests/roads-reskin.spec.ts` (F5), `tests/roads-map.spec.ts` (F6), `tests/roads-spec8.spec.ts` (F7).
- `docs/contracts/roads-hex-db.md` (E7).

---

# Phase E - Roads/Bridges block, validation, Building DB lock, dual write (estimate 2-3 days; depends on Unity phase B being in QA)

**Release criterion:** with the write mode at its default (`off`) the editor's published files are byte-identical to today's for unchanged data (proved by a golden test), the new form and validation work locally, and nothing the old Unity or its CI reads changes.

## Task E0 - branch, harness fixture and globals

**Files:** create `tests/roads-fixtures.ts`; modify `tests/editor-globals.d.ts`.

- [ ] **Step 1: branch and baseline.** `git status --short` must show only the two untracked files named in the constraints; `git checkout -b feature/roads-v1-editor dev` (already done when the plan was written; verify with `git branch --show-current`). Run `npx playwright test tests/hexdb-copy-tile.spec.ts tests/package-manifest.spec.ts` once to record a green baseline in the commit body.
- [ ] **Step 2: fixture module.** `tests/roads-fixtures.ts` exports: `ROAD_IDS = { road: 'road', road2: 'road_2', bridge: 'bridge', bridge2: 'bridge_2' }` (single place for decision D3); `bldRoads()` returning the four Building DB records (`road`/`road_2`: `isRoad: true`, `buildingCategory: 'Standard'`, `price` Gold 50 / 75, `availableTiles: []`; `bridge`/`bridge_2`: `buildingCategory: 'Bridge'`, `isRoad: false`, price Gold 6500 / 9000, `availableTiles: []`, `bridge_2` with `underTerrainId: 'Decameroon_Water_1'`); `DEC_HEXES` (the 60 live Decameroon ids with type and `terrainTypeId: -1`, `roadAllowed: false`, package `decameroon`); `BASE_HEXES` (the trimmed live base set above); `SPEC8` (the four lists above, as arrays of full ids); `seedRoadsWorld(page, gh)` which: puts the base hexes/buildings and the Decameroon package on `gh` (`seedServerPackage`, `gh.setJson('packages/postapoc/hex_database.json', ...)` and `building_database.json`), opens the editor (`openEditor(page, { gh, pat: true })`) and waits for the startup sync (`expect.poll(() => HexDB.getAll().length)`); `applySpec8(page)` which sets `allowedRoads` on the Decameroon records via the real API added in E2 (`HexDB.setAllowedRoads`) so later specs start from the §8 state.
- [ ] **Step 3: RED test for the fixture itself** (`tests/roads-fixtures.spec.ts`, not counted as a feature spec): the SPEC8 lists have 7 / 3 / 15 / 3 entries; every id exists in `DEC_HEXES`; Bridge_1 ids are all `Rivers`, Bridge_2 ids all `Water`; the 7 excluded rivers, `WaterStones_1` and `Lake_1..7` are in no list; `bridge`/`road` ids exist in `bldRoads()`. (Protects the fixture from typos, since every later spec leans on it.)
- [ ] **Step 4:** add `RoadPerms`, `RoadsHistory` to `tests/editor-globals.d.ts` (`declare const RoadPerms: any, RoadsHistory: any;`). Commit: `test(roads): shared Roads V1 fixture with the spec section 8 lists`.

## Task E1 - `RoadPerms`: pure helpers (no UI, no storage)

**Files:** `MapEditorPro.html` - new `const RoadPerms = (() => { ... })();` placed immediately before `const HexDB` (`:17214`), exposed as a top-level const like the other modules; test `tests/roads-core.spec.ts`.

API (all pure, take their inputs; none reads `HexDB`/`BldDB` internally except the two convenience getters at the end):
- `typesFrom(buildings)` -> `{ roads: [b...], bridges: [b...] }` from the **base-package** Building DB entries (`(b.package || 'postapoc') === 'postapoc'`), roads = `b.isRoad`, bridges = `b.buildingCategory === 'Bridge'`, order = Building DB order (spec §4.1); an entry that is both is reported by `validate` and listed under roads only.
- `normalize(list)` -> array of unique non-empty strings (case preserved, trimmed), order preserved; non-arrays -> `null` (meaning "not set", decision D5).
- `sortLike(list, types)` -> list ordered by Building DB order, unknown ids last in original order (spec §3.1).
- `deriveRoadAllowed(list, types)` -> boolean per D2.
- `isWaterLike(hex)` -> `hex.type === 'Rivers' || hex.type === 'Water'`.
- `stateOf(hex)` -> `'unset'` (field absent / not an array), `'none'` (`[]`), `'some'`.
- `LEGACY_ROAD_ENUM_IDS = ['Plain_1','Plain_2','Rubble_1','Rubble_2','Rubble_3']` and `LEGACY_ROAD_TERRAIN_IDS = [9,10,11,12,13]` (for F4).
- `validate({ hexes, buildings, scope })` -> `{ errors: [], warnings: [] }`, each item `{ rule, hexId, pkg, message, fix? }`. Rules (spec §3.5, adjusted by D6): `unknown-id` (error: id in `allowedRoads` is not a road/bridge of the base Building DB), `duplicate` (error with `fix: 'dedupe'`), `bridge-on-land` (**warning**, D6), `road-on-water` (warning), `both-flags` (error: `isRoad` and `Bridge` together), `road-in-package-bld` (error: road/bridge building with a non-base `package`), `tiles-not-empty` (warning with `fix: 'clear-tiles'`: `availableTiles` non-empty on a road/bridge), `water-bridge-no-under` (warning: a bridge listed on a `Water` tile whose building has no `underTerrainId`), `unset` (error, only raised when `scope.requireField` is true: a record without `allowedRoads`), `override-differs` (warning with `fix: 'take-base'`: a same-id record of a non-base package whose list differs from the base record, spec §6.7).

Steps:
- [ ] **Step 1: RED.** `tests/roads-core.spec.ts` drives `RoadPerms` via `page.evaluate` on a bare `openEditor`. Cases (each with a positive control): `typesFrom` order and the both-flags entry; `normalize(['road','road',' bridge '])` -> `['road','bridge']`, `normalize(null)` -> `null`, `normalize('road')` -> `null`; `sortLike`; `deriveRoadAllowed(['bridge'])` false, `(['bridge','road_2'])` true, `([])` false, an id unknown to the Building DB does not count; `stateOf`; every `validate` rule fires on a minimal hand-built input and does **not** fire on the control input (e.g. `bridge-on-land` fires for a bridge on a `Plains` hex and not on a `Rivers` hex; `unknown-id` fires for `road_old`; `unset` fires only with `requireField`); the SPEC8 world validates with zero errors and zero warnings (Decameroon `Water` tiles for `bridge_2` have `underTerrainId` on the building).
- [ ] **Step 2: implement** until GREEN. Keep it free of DOM and of `HexDB`/`BldDB` state so F-phase code and the exporter reuse it.
- [ ] **Step 3: commit** `feat(roads): RoadPerms pure helpers and validation rules`.

## Task E2 - data model: `allowedRoads` on records, normalisation, mutators

**Files:** `MapEditorPro.html` (`HexDB._blank` `:17248`, `_migrateSpecialFields` `:18437`, new mutators, exports `:18893`); test `tests/roads-hexdb-form.spec.ts` (data part).

- [ ] **Step 1: RED tests** (page.evaluate on a seeded world): (a) `HexDB.add()` creates a record with `allowedRoads: []` and `roadAllowed: false` (spec §4.2; `_blank` currently has no such field); (b) a record loaded **without** `allowedRoads` (through `HexDB.load(JSON)` and through `mergeFromServer`) still has no `allowedRoads` property afterwards (D5; the assertion `'allowedRoads' in rec === false` is the regression guard); (c) a record with `allowedRoads: ['road','road',7,'']` is normalised to `['road']` by the migration; a non-array value (`'road'`, `{}`) is removed (back to "unset"), not turned into `[]`; (d) when the field is an array, `roadAllowed` is rewritten to `deriveRoadAllowed(...)` by the migration (keeps the local copy equal to what is written, so `SyncMerge.merge3` never sees a phantom local change after a publish); when the field is absent, `roadAllowed` keeps the existing boolean normalisation (`typeof !== 'boolean' -> false`, today's `:18439`); (e) `HexDB.setAllowedRoads(realIdx|key, list)` (new): sorts via `sortLike`, dedupes, re-derives `roadAllowed`, calls `_autoSave` exactly once (assert `HexDB.getRev()` delta of 1), and `HexDB.getAllowedRoads(key)`.
- [ ] **Step 2: implement.**
  - `_blank` (`:17248`): add `allowedRoads: []` after `roadAllowed:false` (`:17255`).
  - `_migrateSpecialFields` (`:18437-18455`): replace the single `roadAllowed` line (`:18439`) by: boolean normalisation as today; then `const n = RoadPerms.normalize(h.allowedRoads); if (n) { h.allowedRoads = n; h.roadAllowed = RoadPerms.deriveRoadAllowed(n, RoadPerms.currentTypes()); } else delete h.allowedRoads;`. `RoadPerms.currentTypes()` reads `BldDB.getAll()`; when the Building DB is still empty at startup (load order), `deriveRoadAllowed` falls back to "any id" for this one call and is re-run by the startup pass of E6 (`HexDB.refreshDerived()`) once `BldDB` has loaded. Add a test for exactly this ordering (autosave restore with a record carrying `['road']` before the Building DB loaded).
  - Do **not** remove the `roadAllowed` migration (it stays until Unity step 5; spec §6 step 5 / §4.5 last sentence).
  - New `setAllowedRoads` / `getAllowedRoads` / `refreshDerived`; add to the `return {...}` list at `:18893`. Every mutator ends in `_autoSave()` (the Terrain memo depends on `getRev()`, comment at `:18525`).
- [ ] **Step 3: GREEN**, then run `tests/hexdb-copy-tile.spec.ts tests/sync-merge.spec.ts tests/startup-sync.spec.ts` (these exercise migration + merge paths). Commit: `feat(roads): allowedRoads on Hex DB records with derived roadAllowed (no silent defaults)`.

## Task E3 - Hex DB form: ROADS / BRIDGES block

**Files:** `MapEditorPro.html` `HexDB._renderRecord` (`:17643`, replacing the `_checkRow('roadAllowed', ...)` at `:17673`), small CSS next to `.hexdb-row`; test `tests/roads-hexdb-form.spec.ts` (UI part).

Design (spec §4.1) - the block is a `hexdb-section` or an extra block in the main section after "Base Cost Taps":
```
ROADS / BRIDGES
[x] Roads/Bridges allowed on this tile
    Roads:   [x] road (Road, 50 Gold)   [ ] road_2 (...)
    Bridges: [x] bridge (...)           [ ] bridge_2 (...)
    ! unknown id "road_old" [x]
    [Apply type defaults]   [Copy from tile...]
```
- **Critical:** `_readRecord` (`:18065`) iterates **every** `#hexdb-right [data-field]` and writes `h[f] = el.checked` for checkboxes. The new checkboxes therefore must **not** carry `data-field`; they use `data-road-id="<id>"` and their own handler. Also remove the old `roadAllowed` checkbox so `_readRecord` stops overwriting `h.roadAllowed`; `roadAllowed` is now written only by `setAllowedRoads`/migration. (RED test: toggling a road checkbox must not create a property named after the id on the record.)
- Rows come from `RoadPerms.typesFrom(BldDB.getAll())` in Building DB order; each label shows `id (textId-or-id, price)`; price from `b.price` joined (`Gold 50`).
- States: `unset` records show a yellow notice "No road permissions yet - run Backfill roads" and all boxes unchecked, **enabled** (the first click sets the field); `none` = master unchecked; `some` = master checked. Master uncheck: remember the previous list in a per-session `Map` keyed by `package::id`, then `setAllowedRoads(h, [])`; re-check restores it, else applies the type default (F1; until F1 lands: `['road']` if a road exists else `[]`... see Step 3 note).
- Unknown ids (from import, or after a Building DB deletion): red row with a remove button (`RoadPerms.validate` `unknown-id`).
- Bridge boxes are **not** disabled on non-water tiles (D6); a bridge on land and a road on water show a `!` hint from `validate`.
- "Apply type defaults" is wired in F1; "Copy from tile..." (a datalist `hexdb-id-list` input + button, same pattern as `Under Terrain` `:17675`) is built here: copies `allowedRoads` of the named tile of any package.
- A Type change (the handler at `:17872`) that leaves the current list non-default offers (via `UI.showConfirm`) to apply the new type's default; wired in F1, here it only re-renders.
- All user-visible strings that include ids go through `_esc`.

Steps:
- [ ] **Step 1: RED** (`tests/roads-hexdb-form.spec.ts`, fixture world): block exists in HexDB mode and lists exactly the 4 fixture types in Building DB order; a 5th road type added through `BldDB.addEntries` appears after `HexDB` re-selects the row with **no code change** (success criterion 3); ticking `bridge` on `Decameroon_River_L_1` sets `allowedRoads == ['bridge']`, `roadAllowed == false`, one autosave; ticking `road` makes `roadAllowed == true`; master untick empties, retick restores the previous list; typing in any other field (`textId`) leaves `allowedRoads` untouched (guards the `_readRecord` interaction); `unset` notice for a record without the field and absence of the notice after the first tick; unknown id row appears in red and its remove button drops only that id; "Copy from tile..." copies from a tile of another package; a duplicate in the stored list is shown once and flagged.
- [ ] **Step 2: implement.**
- [ ] **Step 3:** commit `feat(roads): ROADS / BRIDGES block in the Hex DB form`. Note for the implementer: the master-recheck default is only a placeholder until F1; leave a `// F1:` comment and a test marked `test.fixme` is NOT used - assert the placeholder behaviour and update that single assertion in F1.

## Task E4 - Building DB: lock `Available Tiles` for road/bridge, keep them global

**Files:** `MapEditorPro.html` `BldDB._renderRecord` (Available Tiles row `:19295-19296`, `reRenderIds` `:19640`), `BldDB.add` (`:19863`), `addReskin` (`:19877`), `paste` (`:19980`); test `tests/roads-blddb.spec.ts`.

- [ ] **Step 1: RED tests.** (a) For `isRoad` and for `buildingCategory === 'Bridge'` the Available Tiles row is rendered disabled (`pointer-events:none`, tag inputs `disabled`, remove buttons disabled) with the hint "Set in Hex DB > Roads/Bridges"; for a normal building it stays editable (positive control). (b) Ticking `Is Road` or switching Category to Bridge on an open record re-renders and locks without selecting another row (today neither id is in `reRenderIds`, `:19640-19649`). (c) A road with non-empty `availableTiles` shows the `tiles-not-empty` warning and a "Clear (permissions are set in Hex DB)" button that empties it in one autosave. (d) In a non-base package: Reskin+ (`addReskin`) of `road`/`bridge` refuses with a toast; `+ Add Building` with Category Bridge or Is Road produces a `road-in-package-bld` error line in the form (cannot be prevented while typing, so it is validated); Paste of a road/bridge into a non-base active package refuses.
- [ ] **Step 2: implement.** Add `'bld-f-isRoad'` and `'bld-f-buildingCategory'` to `reRenderIds`. Lock logic in one helper `_isRoadLike(bld)`. The `_readRecord` code at `:19809` is unchanged (the lock is UI-level; stored data is not rewritten, spec §3.4: "ignored", not deleted - except through the explicit Clear button).
- [ ] **Step 3: GREEN**; run `tests/packages-reskin.spec.ts tests/hexdb-copy-tile.spec.ts`. Commit `feat(roads): road and bridge buildings cannot carry Available Tiles; roads stay in the base package`.

## Task E5 - validation surfaces and the publish gate

**Files:** `MapEditorPro.html`: Hex DB form (inline messages under the block), `GitHubSync.publishHexDbOnly` (`:9713`), `Packages._publishPackageRun` (`:14875`, before the first write at `:14936`), `Packages.openPublishConfirm` (`:14720`), `Packages.validatePackageZip` (`:15341`); test `tests/roads-publish.spec.ts` (gate part).

- [ ] **Step 1: gate function.** `RoadPerms.gate({ pkg, mode })` calls `validate` over the records that would be written (base: `_isBaseEntry`; package: `h.package === id`) plus the Building DB, with `requireField: mode !== 'off'` (decision D1), and returns `{ ok, errors, warnings }`. In `off` mode only errors that are about data the editor would write anyway are blocking: **none** (so `off` publishes exactly like today). In `stage`/`active`: `unknown-id`, `duplicate` (auto-fixable: the gate offers "Fix and continue"), `both-flags`, `road-in-package-bld`, `unset` block; warnings are shown in the confirm.
- [ ] **Step 2: RED tests** (FakeGitHub): in `stage` mode a base publish with one record lacking the field throws before any `gh.puts` entry (assert `gh.puts.length === 0`; the same pattern as other write-free abort tests, e.g. `tests/package-manifest.spec.ts`); with the field everywhere it writes both hex files; in `off` mode the same unset record publishes (positive control); a road defined in a package Building DB blocks `Packages.publishPackage` in `stage`/`active`; `validatePackageZip` of a zip whose Building DB has a road/bridge returns it in `errors` (always, any mode: roads are global, spec §3.4); an imported package hex file with an unknown road id gives a warning in the plan, not an error.
- [ ] **Step 3: implement.** Hook points: the `throw new Error(...)` pattern before the first write (as `if (!dv.ok) throw new Error(dv.errors[0])` at `:14909`), so `_withPublishBtn` reports it (`:9683`). Message names the first three offending ids and the count.
- [ ] **Step 4:** commit `feat(roads): validate road permissions before any publish write`.

## Task E6 - Roads write mode, exporter and the dual write

**Files:** `MapEditorPro.html`: new `HexDB.exportFor(scope)`; `GitHubSync.publishHexDbOnly` (`:9713-9732`), `Packages._publishPackageRun` (`:14936`), `Packages.exportPackage` (`:14447`), `HexDB.save` (`:18510`); mode UI in `#hexdb-tools` (`:1573-1600`); test `tests/roads-publish.spec.ts` (writer part), golden fixture `tests/fixtures/roads/off-mode-hex-database.json` (generated once from the **pre-change** code, see Step 1).

`exportFor({ pkg, mode })` returns the object that is serialised (never mutates `_data`):
- Always: every record is a `structuredClone` with `roadAllowed` equal to the stored (already derived) value.
- `off`: records have `allowedRoads` **removed**; no `roadsSchema`; `common` without `roadDefaults`. Output equals today's.
- `stage`: records have `allowedRoads` (sorted, deduped) and the derived `roadAllowed`; no `roadsSchema`.
- `active`: `stage` + top-level `roadsSchema: 1` (every file: base and package) + base file `common.roadDefaults` (F1).
- The base file keeps `version`, `dbVersion`, `common` handling of `publishHexDbOnly` (`:9718-9722`); the package files keep `{ version: 1, package: id, hexes }`. `roadsSchema` is placed right after `version`.
- `HexDB.save()` (local "Save DB") stays a full local snapshot: it always keeps `allowedRoads` (round trip through Load DB) and writes `roadsSchema` per mode.
- Package export ZIP (`:14447`) and `_publishPackageRun` (`:14936`) go through `exportFor`. The import-to-server writer (`:15851`) deliberately passes the imported records through verbatim (never strips someone else's data).

Mode setting: a `<select id="roads-write-mode">` ("Roads data: Legacy only / Stage (both fields) / Active (new schema)") in `#hexdb-tools`; changing it to anything above `off` asks `UI.showConfirm` ("Old game builds read roadAllowed; publishing allowedRoads needs the Unity build with the new parser, otherwise its CI fails. Continue?"); switching to `active` additionally requires the Backfill state of the files that will be published (F4 provides `RoadPerms.coverage(...)`; until F4 the option is listed but `active` is refused with "Run Backfill roads first"). Persist in `localStorage['roadsWriteMode']` inside try/catch (storage can be unavailable, `tests/storage-errors.spec.ts` shows the pattern).

- [ ] **Step 1: golden test first, on unchanged code.** Before touching any writer, add the test "off mode writes exactly the current bytes": seed a world (fixture), run `GitHubSync.publishHexDbOnly()` against `FakeGitHub`, save `gh.read('packages/postapoc/hex_database.json')` and the root file as the golden files. Commit this test **and the golden files** first (`test(roads): golden hex_database output before the roads writer change`) so the later change is provably a no-op in `off`.
- [ ] **Step 2: RED tests** for the new behaviour: `stage` -> every base record has `allowedRoads` + derived `roadAllowed`, file has no `roadsSchema`; `active` -> `roadsSchema === 1` in the base file **and** in a package file, `roadAllowed` derivation checked for the three interesting records (Plain_1 with `['road']` -> true; a Rivers tile with `['bridge']` -> false; a `Water` tile with `['bridge_2']` -> **false**, i.e. D2 vs the "non-empty" rule); `off` after `active` strips again; the in-memory `HexDB.getData()` is untouched by an export (deep-equal before/after); `Packages.exportPackage` ZIP content equals the publish payload in the same mode; an unset-field record never gets a synthetic `[]` in any mode; manifest: after a publish in `active` mode the `packages/postapoc/manifest.json` entry for `hex_database.json` has the sha256 of the written bytes (reuse the assertion style of `tests/package-manifest.spec.ts:189-198`).
- [ ] **Step 3: implement** the exporter, the mode selector and the three writer call sites. Keep `_isBaseEntry` filtering exactly as is (`:9707`).
- [ ] **Step 4: GREEN** + `tests/package-manifest.spec.ts tests/package-publish.spec.ts tests/packages-publish.spec.ts`. Commit `feat(roads): Roads write mode with dual write (allowedRoads + derived roadAllowed), default off`.

## Task E7 - contract document, schema-sync field list, CHANGELOG

**Files:** create `docs/contracts/roads-hex-db.md`; create `tests/roads-contract.spec.ts`; modify `CHANGELOG.md`.

- [ ] **Step 1: contract doc** in the style of `docs/contracts/package-manifest.md`: the record field `allowedRoads: string[]` (semantics: ids of road/bridge buildings of the base Building DB allowed on the tile; missing/`null`/`[]` = nothing; order by Building DB; unique), the legacy `roadAllowed` and its derivation rule (D2), file-level `roadsSchema` (absent = legacy per file; `1` = authoritative), `common.roadDefaults` (editor-only presets; Unity ignores), the three write modes and which fields each emits, the transition order (Unity B -> editor `stage` -> backfill -> `active` -> Unity H removal), and the **set of hex record keys the editor may write** (the list `scripts/check-building-schema-sync.js` compares in Unity: `allowedRoads` is the only new key; `roadsSchema` and `roadDefaults` are not record keys).
- [ ] **Step 2: RED/GREEN contract test** (no editor page needed, like `docs-lint.spec.ts`): parses the doc's fenced JSON samples and asserts the rules above with a small checker; asserts that a record produced by `HexDB.exportFor` in each mode (driven in a page) uses only keys from `KNOWN_RECORD_KEYS` = the keys of a live record (copied into the test from the verified 2026-10-15 GET: `id textId type biome filterCategory spriteName category terrainTypeId fallback roadAllowed descriptionIdleId ... edgeFaces occupiedOffsets package`) plus `allowedRoads`; a stray new key fails the test (the editor-side twin of the Unity CI check).
- [ ] **Step 3: CHANGELOG** `### UI` entry under Unreleased (what the block does, the default-off write mode, and that nothing is published automatically).
- [ ] **Step 4:** `npx playwright test tests/roads-contract.spec.ts tests/docs-lint.spec.ts`. Commit `docs(roads): hex database roads contract and changelog`.

## Task E8 - Phase E verification gate

- [ ] Whole suite green: `npx playwright test` (record `passed / skipped / failed`, wall time, `startup retries`, `machine sleeps during the run`; a run on a machine that slept is not valid, see `tests/README.md`).
- [ ] Golden test (E6 step 1) green: `off` output unchanged.
- [ ] Manual smoke on the dev editor (`npx serve`, `FakeGitHub`-free): open HEX DB, edit a tile, switch the mode selector between all three values and confirm nothing is sent without the Publish buttons (DevTools Network tab shows no request to `api.github.com`).
- [ ] `git diff dev --stat` limited to the files named in E0-E7. `git log` shows one commit per task.
- [ ] Phase E count: **9 tasks (E0-E8).**

---

# Phase F - defaults, matrix, bulk actions, backfill, Reskin+/Paste, map (estimate 2-3 days; depends on E)

**Release criterion:** the owner can reproduce the spec §8 state for Decameroon from the matrix, back-fill the base DB with the spec §6 step 3 result (road on 6 tiles, bridge on 29), see the validation, and nothing is published until the owner switches the mode and presses Publish.

## Task F1 - defaults by tile type (`common.roadDefaults`)

**Files:** `MapEditorPro.html`: `RoadPerms.defaultsFor`, `HexDB` defaults state in `_data.common`, `HexDB.mergeFromServer` (`:18576`), `HexDB.add` (`:18254`), Type handler (`:17872`), master-checkbox default (E3), settings modal; test `tests/roads-defaults.spec.ts`.

- Data: `_data.common.roadDefaults = { "<TYPE_GROUP>": ["road", ...] }` keyed by the `TYPE_GROUPS` names (`:17219-17238`). **Initial values (spec §3.3):** `Plains` and `Rubble` -> `["road"]`; `Rivers` -> `["bridge"]`; every other group (including `Water`) -> `[]`. Missing group = `[]`.
- Sync: `mergeFromServer` takes the server `common` only when local equals `{goldPerTap: 10}` (`:18576`). A local `common` that already has `roadDefaults` or a different `goldPerTap` would never receive the server's presets, and the reverse (server presets overwritten by the local default) must not happen either. Change: merge `common` by key: server `goldPerTap` still follows the existing rule; `roadDefaults` is taken from the server when local has none; if both have it, local wins (it may hold unpublished edits). Test it.
- UI: toolbar button "Road defaults" opens `UI.showModal` with a table rows = type groups, columns = the Building DB roads/bridges (checkboxes), saved with one autosave. "Apply type defaults" in the form (E3) and in the matrix (F3) use `RoadPerms.defaultsFor(group)`.
- Defaults apply only explicitly (spec §3.3): at `HexDB.add()` (a new blank tile gets `[]` per spec §4.2; the toast offers "Apply defaults"), on a Type change (confirm dialog), and via bulk actions. Never silently at load or publish.
- [ ] **Step 1: RED** (defaults seeded as above; Type change `Plains -> Rivers` on a tile with `['road']` asks, and "Apply" yields `['bridge']`, "Keep" leaves `['road']`; an unset tile is not touched by a Type change; the modal edits persist across `HexDB.save()`/`load()`; `mergeFromServer` combination cases; the E3 placeholder assertion is replaced by "master re-check with no remembered list applies the type default").
- [ ] **Step 2: implement; Step 3: commit** `feat(roads): road defaults by tile type (common.roadDefaults)`.

## Task F2 - matrix modal (view, filter, per-cell edit) and `RoadsHistory`

**Files:** `MapEditorPro.html`: `RoadsHistory`, `HexDB.openRoadsMatrix()`, button "Roads matrix" in `#hexdb-tools`; test `tests/roads-matrix.spec.ts`.

- Modal via `UI.showModal` (`:10941`, id `roads-matrix`): rows = hexes matching the current Hex DB filter (`_filter`/`_applyFilter`: package, type, search; reuse `_filtered`), columns = types from `RoadPerms.typesFrom`. Cell = checkbox; unset records render as a dashed "-" cell that becomes a checkbox on first click (and mark the record "set"). Row header: tile id + type badge; a `!` marker from `validate`. 400+ rows must stay responsive: render rows lazily in chunks of 100 via `requestAnimationFrame`, no per-cell listeners (one delegated listener on the table).
- `RoadsHistory`: `begin(label)` captures `{ key -> previous list|undefined }` for the records an action touches, `commit()` pushes one step with the after-state, `undo()`/`redo()` restore through `HexDB.setAllowedRoads` in a single batch (one `_autoSave`), max 50 steps, cleared when the modal closes. Undo/Redo buttons and Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z inside the modal (the `History.initKeyboard` handler returns while `anyModalOpen()`, `:8860`).
- [ ] **Step 1: RED:** modal opens, one row per filtered tile and one column per type; filter by package `decameroon` shows 60 rows; toggling a cell updates `allowedRoads` and `roadAllowed`, is one `RoadsHistory` step and one autosave; Undo restores exactly the previous value including "unset"; Redo re-applies; 51 steps evict the oldest; closing the modal clears the history; the global map `History.undoSize()` is unchanged by matrix edits (proves the two stacks are independent); unset cell first click sets `[id]`.
- [ ] **Step 2: implement; Step 3: commit** `feat(roads): tiles x types matrix with its own undo steps`.

## Task F3 - bulk actions (each one undo step)

**Files:** matrix modal toolbar/column headers; `RoadPerms` pure helpers `planAllow(hexes, typeId)`, `planRemove`, `planApplyDefaults`, `planAddWhere(hexes, typeId, whereTypeId)`, `planCopyFrom`, `planSetExact(hexes, typeId, ids)`; test `tests/roads-matrix.spec.ts`.

Actions (spec §4.2): (1) "Apply type defaults to filtered" (skips tiles whose list already equals the default; reports the count); (2) column header menu "Allow X on all filtered" / "Remove X from all filtered"; (3) "Add X wherever Y is allowed" (new type rolled out row by row from `road`); (4) "Copy from tile..." onto the selected rows; (5) **"Set X to exactly these ids..."** (textarea, one id per line; ids outside the filter or unknown are listed and skipped; this is an addition beyond the spec, needed to reproduce the §8 lists precisely and reviewably - flagged in Open questions). Every action = `RoadsHistory.begin/commit` = **one** Undo step and one `_autoSave`; every action shows a toast with the number of tiles changed (and 0 changes create no step).

- [ ] **Step 1: RED** (fixture world, filter = package decameroon): (1) defaults on the 60 Decameroon tiles set Plain/Rubble (exactly the tiles whose type is `Plains` or `Rubble` in the fixture) to `['road']`, Rivers to `['bridge']`, others `[]`, and a second run changes 0 tiles / pushes no step; (2) "Allow road_2 on all filtered" then Undo returns to the exact previous state (deep-equal of all 60 records); (3) "Add road_2 wherever road is allowed" touches only tiles that have `road`; (4) copy-from; (5) **set-exact reproduces the spec §8 state**: running it four times (road, road_2, bridge, bridge_2 with the SPEC8 lists) yields exactly the §8 table (assert per list: the set of tile ids holding each type equals SPEC8, and the excluded tiles hold nothing), and one Ctrl+Z reverts only the last of the four; each action is exactly one step (`RoadsHistory` depth +1) and one `HexDB.getRev()` increment; a filtered subset only touches filtered rows (positive control: the unfiltered rows are deep-equal before/after).
- [ ] **Step 2: implement the pure planners first (unit-tested through `page.evaluate`), then the UI.** Step 3: commit `feat(roads): matrix bulk actions, one undo step each`.

## Task F4 - Backfill roads

**Files:** `RoadPerms.backfillPlan(hexes, ctx)`, `RoadPerms.coverage(hexes)`, a "Backfill roads" button in the matrix modal and in the mode-change confirm; test `tests/roads-backfill.spec.ts`.

Rule (spec §6 step 3; legacy "today's effective rule", computed from fields the editor has): for each record **without** `allowedRoads`: `road` when `LEGACY_ROAD_ENUM_IDS` contains `h.id` (case-insensitive), **or** (`h.roadAllowed === true` **and** (`terrainTypeId < 0` or `terrainTypeId` in `LEGACY_ROAD_TERRAIN_IDS` = 9..13)); `bridge` when `h.type === 'Rivers'`; else `[]`. Only missing fields are filled (D5), never an existing list; applied to the chosen scope (base package, or one package) as **one** `RoadsHistory` step; shows a preview dialog first (counts per type and the list of tiles getting `road`) and an after-toast. It does not change the write mode; `RoadPerms.coverage(hexes)` returns `{ total, set, unset }` and mode `active` is refused while `unset > 0` for any file that would be published (this closes the F-1 contradiction in a verifiable way).

- [ ] **Step 1: RED, regression matrix on the live-like base fixture:** `Plain_1/2` and `Rubble_1..3` get `['road']` (enum match with `roadAllowed: false`, flag not consulted); `Plain_Kaiju_1` (`terrainTypeId 12`, `roadAllowed: true`) gets `['road']`; `Hills_1`, `Mountain_1`, `Swamp_1`, any `roadAllowed: false` custom tile get `[]`; every `Rivers` tile gets `['bridge']`; `Water` tile gets `[]`; **live counts: road on exactly 6 base tiles, bridge on exactly the number of Rivers tiles in the fixture (29 in the live base: use a fixture with the live 29)**; Decameroon after the spec §6 step 0 (7 tiles with `roadAllowed: true`) -> road on exactly those 7, bridge on all 29 Rivers (the matrix `set-exact` of F3 then trims to the §8 lists); a record with an existing list is untouched (positive control); running twice changes nothing; `terrainTypeId` 12 with `roadAllowed: false` and a non-enum id (`Plain_X`) -> `[]` (the legacy rule would not allow it).
- [ ] **Step 2: implement; Step 3: commit** `feat(roads): Backfill roads reproduces today's effective road/bridge rule`.

## Task F5 - Reskin+, Copy/Paste carry the fields; same-id mismatch warning

**Files:** `HexDB.addReskin` (`:18273`), `paste` (`:18345`), `BldDB.addReskin` (`:19877`) unchanged in logic (both already `structuredClone` the whole record, so `allowedRoads` rides along) + the same-id warning UI; test `tests/roads-reskin.spec.ts`.

- [ ] **Step 1: RED:** Reskin+ `prefix` and `same` of `Plain_1` (base list `['road']`) into package `decameroon` keep `allowedRoads == ['road']` and `roadAllowed == true` (pure fixation test, spec §4.3: no code change expected); Paste of a tile carries the list (the copy has the same list but a distinct array instance: mutate the copy, original unchanged); `structuredClone` of a record **without** the field stays without it; **same-id override whose list differs from the base record** -> `validate` returns `override-differs`, the form shows the warning with a "Take from base" button that copies the base list (one autosave), and Publish Package in `stage`/`active` lists it as a warning in the confirm (spec §6.7); a prefix reskin shows no such warning (positive control); an override created **before** backfill (unset) while the base is set also warns.
- [ ] **Step 2: implement** the warning + button only. Step 3: commit `feat(roads): warn when a same-id override differs from the base road permissions`.

## Task F6 - map view: Bridge tool and validator

**Files:** `MapEditorPro.html`: `Tools._placeBridge` (`:7627`), `_isRiverTile` (`:6885`), `MapValidator` (`RULE_ORDER` `:16277`, new check after check 4 `:16407`, state build near `:16439`); test `tests/roads-map.spec.ts` (+ extend `tests/validator-core.spec.ts` style).

- Bridge tool: the hard `type === 'Rivers'` gate (`:7633`) becomes: if the **base** hex record of the clicked tile has `allowedRoads` set (array) -> allowed iff it includes the selected bridge id; if the record is unset (not backfilled) or the selected bridge has no record -> today's rule (`Rivers` only). Refusal message: "<bridge id> is not allowed on <tile id> (Hex DB > Roads/Bridges)". Removing the same bridge still works anywhere (`:7634` comment).
- Validator: new rule `road-not-allowed` (warning, spec §3.5 last row, §4.6): a bridge object whose hex has `allowedRoads` set and not including that bridge id; a road cell (`roadsData`) on a hex whose list is set and contains **no** `isRoad` id (the map stores no road type, so only "any road type" is checkable - Findings F-7). Cells capped by `CELL_CAP`; add to `RULE_ORDER`; pass hex/building lookups through `st` like `needRoad` (`:16439`). Tiles with an unset list are skipped (no noise before backfill).
- [ ] **Step 1: RED:** Bridge tool places `bridge_2` on `Decameroon_Water_1` when listed and refuses on `Decameroon_Plain_1`; places `bridge` on a listed river, refuses `bridge` on `Decameroon_Water_1`; with an unset record behaves as today (Rivers only; positive control keeps `tests/placement.spec.ts` style expectations); validator warns for a `bridge_2` on a river, for a road on `Decameroon_Hills_1`, and is silent for the §8 state; the road tools still ignore permissions (Unity does not import map roads).
- [ ] **Step 2: implement; Step 3: commit** `feat(roads): bridge tool and map validator follow the Hex DB road permissions`. Run `tests/placement.spec.ts tests/validator-core.spec.ts tests/validator-ui.spec.ts tests/object-tools.spec.ts`.

## Task F7 - end-to-end spec section 8 test

**Files:** `tests/roads-spec8.spec.ts`.

- [ ] One scenario with `FakeGitHub`: seed the world (E0) with Decameroon tiles having `roadAllowed: true` on the 7 step-0 tiles; backfill the package; apply the four `set-exact` lists; assert the exact §8 table; switch mode to `active`; `Packages.publishPackage('decameroon')` and `GitHubSync.publishHexDbOnly()` against `FakeGitHub`; read the written files: `roadsSchema === 1` in both, every record has `allowedRoads`, derived `roadAllowed` true exactly on the 7 Road_1 tiles, **false on all bridge-only tiles** (D2), `Decameroon_Water_1` is `['bridge_2']`, the 7 excluded rivers `[]`; manifest sha256 of both hex files matches the bytes; old-reader simulation: a tiny `readLegacy(file)` helper that reads only `roadAllowed` returns exactly the 7 Road_1 ids as buildable (what an old Unity build sees); switching back to `off` and publishing writes neither field nor schema.
- [ ] Commit `test(roads): spec section 8 end to end (Decameroon lists, dual write, old reader view)`.

## Task F8 - documentation

- [ ] `docs/guides/editor-guide.en.md` and `editor-guide.uk.md`: sections "Roads and bridges" (the block, the matrix and bulk actions, defaults, Backfill, the three write modes and the rule "nothing is sent until you press Publish"); `node scripts/build-guides.js`; `npx playwright test tests/docs-lint.spec.ts`; CHANGELOG entries for F. Commit `docs(roads): guides and changelog for the roads matrix, defaults and backfill`.

## Task F9 - release / verification gate (ends at "ready for the owner")

- [ ] Whole suite green once more (same recording rules as E8).
- [ ] Golden `off` test still green; contract test green.
- [ ] Manual QA on the dev editor against a **copy** of the data (never the real server): Load DB from a saved copy of the live base file, run Backfill, check the counts (road 6, bridge 29), open the matrix on Decameroon and reproduce the §8 lists with "Set exactly", Undo each action, use the mode selector, press Save DB (local file) and diff it against the contract.
- [ ] Ordering checklist handed to the owner (a plan, not an action): (1) Unity phase B merged and in QA; (2) editor deployed (`deploy-dev.yml` CI deploys `dev/MapEditorPro.html`; the owner promotes to production); (3) owner sets mode `stage`, publishes base + Decameroon once and checks the Unity CI is green; (4) Backfill + matrix review; (5) owner sets `active`, publishes; (6) Unity step 5 removal later, after which a separate small editor change stops writing/deleting `roadAllowed` (`_migrateSpecialFields`, `:18439`) - **not in this plan**.
- [ ] `git show --stat HEAD` and `git log dev..HEAD --stat`: only `MapEditorPro.html`, `tests/`, `docs/`, `CHANGELOG.md`; the two untracked files still untracked.
- [ ] Phase F count: **9 tasks (F1-F9).**

---

## Playwright conventions used (summary)

`openEditor(page, { gh, pat: true })` + `FakeGitHub` for every publish test (assert `gh.puts`, `gh.writeLog`, `gh.read(path)`); `seedHexes`/`seedBuildings`/`seedServerPackage` from `tests/helpers.ts`; wait with `expect.poll`, never timers; check negatives with a positive control; page-local state is assigned as bare bindings; modals located by `.ui-modal` / the `-modal` id suffix as in `tests/modal.spec.ts`; one assertion style for "one undo step" = `RoadsHistory` depth +1 **and** `HexDB.getRev()` +1 **and** `History.undoSize()` unchanged.

## Risks

1. **CI break on early publish** (Unity CI fails on a live field without a parser): mitigated by default-off mode, the explicit confirm, and the ordering checklist (F9). Residual: another browser/profile starts at `off` (safe), a second owner device has its own setting.
2. **Old Unity reads the derived flag**: D2 keeps the flag to road-type ids only. Residual: a tile listing only `road_2` turns the old flag on for the plain `road` on old builds (acceptable for the test type; flagged to the owner, Findings F-2).
3. **`_readRecord` clobbering** (it writes every `[data-field]` checkbox): the Roads block deliberately uses `data-road-id`; E3 has a dedicated regression test.
4. **Merge noise**: local `roadAllowed` kept equal to the derived value (E2) so `SyncMerge.merge3` sees no phantom edits after publishing; `common.roadDefaults` merge rule (F1) must not regress `goldPerTap` sync. Covered by the F1/E2 tests and the existing `sync-merge`/`startup-sync` specs.
5. **Same-id override trap** (spec §6.7): covered by F5 (warning, "Take from base"), but a package published before the field existed stays unset until backfilled; the gate blocks `stage`/`active` publishes with unset records.
6. **Stale checkout data** (no `road` building, old bridge ids): all roads specs seed their own world (E0). Do not "fix" the stale root files in this branch.
7. **Matrix performance** on 400+ rows x 5-10 columns: chunked render + delegated listener (F2); a test creates 600 hexes and asserts the first chunk renders within a count of rAF ticks (no millisecond thresholds).
8. **Sprites of `Road_Bridge_*` ids vs live `bridge`**: the editor's Bridge tool and sprite folders key off Building DB entries (`:6819`, `:13486`); the plan changes neither.
9. **Disassembly price / income for roads (spec §8.4)** has no field in the Building DB form or in the Unity record; not planned here (blocked on the same contract gap as Unity plan C7/GAP-6).
10. **Guide HTML drift**: `docs-lint` fails if the HTML is not regenerated (F8 runs the generator).

---

## Findings: spec gaps, contradictions and code reality (none silently resolved)

- **F-1 (spec §3.5 vs §6 vs the task brief).** §3.5: "a file without `roadsSchema` or a record without `allowedRoads` blocks publish until Backfill". §6 step 2: the editor dual-writes `allowedRoads` + `roadAllowed` (no `roadsSchema` yet) and step 3 adds `roadsSchema` after Backfill. A file in step 2 is exactly "without `roadsSchema`", so §3.5 would forbid step 2. The task brief adds "only when the owner opts in". Plan: three explicit modes (D1); `off` publishes as today, `stage` requires the field on every record but not the schema, `active` requires both. Needs owner confirmation.
- **F-2 (task brief vs spec §4.5).** Brief: derived `roadAllowed` = "true iff allowedRoads non-empty". Spec §4.5: `some(id -> isRoad)`. They differ for bridge-only tiles. With the brief's rule, `Decameroon_Water_1 = ['bridge_2']` gets `roadAllowed: true`; old Unity treats an unknown custom id as `Plain_1`, so the flag would allow the plain `road` on water (spec §2.2, Decameroon row). Plan follows spec §4.5 (D2). A `Rivers` tile with `['bridge']` is harmless either way (river rules skip the flag) but is also `false` under D2.
- **F-3 (spec §4.2 vs code).** "All bulk actions go into Undo/History as one step and into autosave." The editor's `History` is map-only (`MapEditorPro.html:8599`); the Hex DB has no undo at all. Plan: `RoadsHistory` inside the matrix modal (D4).
- **F-4 (spec §8 naming).** §8 names the types Road_1/Road_2/Bridge_1/Bridge_2; live Building DB ids are `road` and `bridge` (spec §2.1); spec §3.1 examples use `road_2`; the Unity plan tests use `road_2`/`bridge_2`. Plan: ids `road`, `road_2`, `bridge`, `bridge_2` (D3), names Road_1 etc. as display names via `textId`. The live `bridge` has an empty `textId` (spec §5.8) and no `underTerrainId`; `bridge_2` over water needs one (warning `water-bridge-no-under`).
- **F-5 (spec §3.5/§4.1 vs §8.2).** §3.5 "bridge on a tile that is not Rivers/Water = error" and §4.1 "bridge boxes disabled outside Rivers/Water" vs §8.2 "a separate Rivers/Water check is not needed, the list replaces it". Plan: warning, not disabled (D6). (Same contradiction the Unity plan records as GAP-2.)
- **F-6 (spec §8.6 coverage).** §8.6 asks to confirm the 7 excluded rivers, `WaterStones_1` and `Lake_1..7` are deliberate. Not mentioned: `Decameroon_BrokenShip_1` (type Water, in the live file) and `Decameroon_DestroyedBuilding_1` (step-0 candidate in §6, absent from §8's Road_1 list). The fixture leaves both without any type; confirm.
- **F-7 (code reality).** The editor stores no type for map roads (`roadsData[key] = { type: 'road_hex' }`, `:7684`) and Unity does not import them, so the map validator can only check "a road tile lies on a tile that allows at least one road type"; Road_2 cannot be drawn separately in the editor (spec §4.6 "stays as is").
- **F-8 (code reality, spec §3.6).** There is no editor-side "schema-sync"; the check lives in Unity CI (`scripts/check-building-schema-sync.js`, hex *record* fields only). Plan substitute: contract doc + `tests/roads-contract.spec.ts` with a known-key set (E7), plus the default-off mode.
- **F-9 (code reality).** `HexDB.mergeFromServer` accepts the server `common` only if the local `common` equals `{goldPerTap: 10}` (`:18576`), so `common.roadDefaults` published to the server would never reach a client that already has any `common` customisation, and a local `roadDefaults` blocks the server's `goldPerTap`. Fixed by a per-key merge in F1.
- **F-10 (spec §6 step 3 wording).** "id unknown to the registry" cannot be evaluated in the editor (the registry is Unity's). Plan uses `terrainTypeId` (Unity enum value, verified: Rubble 9-11, Plain 12-13) plus the `roadAllowed` flag; this reproduces the spec's result (road on 6 base tiles incl. `Plain_Kaiju_1`) on the live data but is an editor-side reimplementation - verify once against the live file (F4 test uses the live-like fixture; the F9 manual step uses a saved copy of the real file).
- **F-11 (spec §8.4).** Disassembly price and income for roads/bridges "are configured in Buildings"; the Building DB form has no such field and Unity's record parser ignores the income fields (Unity plan GAP-6/7). Out of scope until the field names are agreed.
- **F-12 (spec §4.4).** "Reskin+ and + Add for roads/bridges in a non-base package are blocked": Reskin+ and Paste can be blocked outright, but `+ Add` produces a blank record the user then edits to `isRoad`; only validation can catch that (E4/E5).
- **F-13 (reference drift).** The spec's `MEP:` lines are from d97aa35; all of them moved (table above). Notable: `roadAllowed` checkbox `:17608 -> :17673`, normalisation `:18374 -> :18439`, Reskin `:18224 -> :18297`, Paste `:18282 -> :18347`, Building DB Available Tiles `:19230 -> :19296`.

## Open questions for the owner (with the recommended answer)

1. **Write-mode model (F-1).** Is `off` / `stage` / `active` acceptable, with `off` the default? *Recommend yes.* It is the only way to let the editor ship before the Unity parser and still follow the transitional dual write.
2. **Derived `roadAllowed` rule (F-2).** Spec §4.5 (any `isRoad` id) or the brief (non-empty)? *Recommend spec §4.5.* The brief's rule enables plain roads on water for old builds.
3. **Type ids (F-4).** Keep `road`/`bridge` and add `road_2`/`bridge_2`, with Road_1/Bridge_1 as display names? *Recommend yes;* renaming `road`/`bridge` breaks saves and map references. Also: should `bridge` get a `textId` and `bridge_2` an `underTerrainId` now (data work in the Building DB, owner/editor)?
4. **Bridge on land / road on water severity (F-5).** Warning (plan) or error (spec §3.5)? *Recommend warning,* per §8.2.
5. **Undo (F-3).** Is an undo stack local to the matrix modal enough for "each bulk action is one Undo step"? *Recommend yes.* A global Hex DB undo is a separate project.
6. **"Set X to exactly these ids" bulk action (F3 step 5).** Not in the spec; it is how the §8 lists are applied and reviewed. *Recommend keep.* Without it the 15-tile Bridge_1 list is 15 manual clicks per type.
7. **Decameroon edge tiles (F-6).** Confirm `BrokenShip_1` and `DestroyedBuilding_1` get no type, and that the 7 rivers, `WaterStones_1` and `Lake_1..7` are deliberately excluded. *Recommend yes (all excluded).*
8. **Map view scope (F6).** Only Bridge tool + validator, as in spec §4.6, or also a read-only overlay of "where can I build road X"? *Recommend no overlay in V1;* the matrix already shows it.
9. **Disassembly price/income fields (F-11).** Who names the Building DB fields, and does the editor form get them in V1? *Recommend:* agree the field names with the Unity side first (one contract), then add a small E-phase follow-up task; not blocking E/F.
10. **Who flips the mode and when.** *Recommend:* only the owner, after the Unity phase B build is in QA and its CI is green with `stage`; `active` only after Backfill review. The plan never publishes.
11. **Import of packages that carry road/bridge buildings (E5).** Reject the import with an error (plan) or import and warn? *Recommend reject:* roads are global (spec §3.4) and Unity ignores such records anyway.
