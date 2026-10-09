# Task report: water re-resolution and duplicated package entries (owner defects 1 and 2)

Branch feature/editor-roadmap, start f22f9b9 (= origin/dev). Debugging agent, single writer, port 4476 (scratch worktrees used 4477/4478).

## Defect 2: "it duplicated all buildings again" (red ids in HEX DB)

### Root cause (confirmed by reproduction)

1. `GitHubSync.publishHexDbOnly` and `GitHubSync.publishBuildingsDb` (menu bar Publish > Publish HexDB / Publish Buildings DB, also called by PACKAGES > Publish for `postapoc` and by HEX DB "migrate to building") serialised the WHOLE in-memory list (`HexDB.getData()`, `BldDB.getJson()`) into `packages/postapoc/*_database.json` AND the root compat copies. Every content package's entries (package field `decameroon`) therefore landed in the base DB files too.
2. On the next startup `syncContentFromServer` merges `packages/postapoc/hex_database.json` with `HexDB.mergeFromServer('postapoc', ...)`: the local side is filtered to `package == postapoc`, the server side was NOT, so every `decameroon` entry of the file looked "new on the server" and was pushed into the merged list, while the local `decameroon` entries were appended again as "others": the same (package, id) twice. `SyncMerge.merge3` passes repeated keys through as extras, so the duplicates were never collapsed afterwards. Same for buildings.

Live data (read-only GETs of https://fidaykin.github.io/PostApocMapEditor/, 2026-10-07) is exactly this shape: root and `packages/postapoc` hex DB = 82 base + 60 `decameroon` entries, building DB = 13 base + 25 `decameroon`; `packages/decameroon/*` hold the same 25 buildings / 60 hexes. No duplicate inside any single file.

### Evidence

- New spec `tests/package-duplicates.spec.ts`, run against HEAD in a scratch worktree (`git worktree add --detach /private/tmp/wd-head f22f9b9`, PW_PORT=4477): **7 failed / 7**. Owner workflow (Publish HexDB, Publish Buildings DB, Publish package with `decameroon` active): server check fails with `hex_database.json` holding 4 `decameroon` entries. With the server assertion skipped (evidence run), the editor after `reloadEditor` holds `decameroon::Decameroon_Plain_1`, `Decameroon_Forest_1`, `Decameroon_Water_1`, `Decameroon_Hills_1` twice: the owner's duplicates.
- After the fix: **7 passed**.

### Fix (commit 4ad22db)

- Base publish writes the base package only: `(e.package || 'postapoc') === 'postapoc'` for both files and both copies (root + `packages/postapoc`), whichever package is active. The toast says how many entries of other packages were left out ("use Publish Package for those"). Decision (guide section 11 and the UI): the menu bar Publish HexDB / Buildings DB are the base-game publishers; packages are published from PACKAGES > Publish (it already filtered `h.package === id`). Refusing while a package is active would break the owner's 3-step workflow, and publishing the active package from the menu would duplicate PACKAGES > Publish, so neither was done. All three orders are tested.
- `SyncMerge.splitForeign`: `HexDB/BldDB.mergeFromServer` merge only the file's own entries (no package field = the file's package); entries tagged with another package are returned as `foreign` and the stored merge base holds only own entries.
- `HexDB/BldDB.adoptForeign` (called once after every package of the startup sync): a foreign entry is dropped when its (package, id) already exists locally (the package's own copy wins), skipped when that package's sync base lists it (deleted locally on purpose), otherwise kept attributed to its package (an entry that exists only in the polluted base file is not lost).
- `SyncMerge.dedupe` (one copy per package+id): run on autosave restore (HexDB and BldDB init), after every `mergeFromServer`, in `addEntries`, `restoreEntries`, `load`, `loadFromObject`. Which copy stays: one that differs from its package's stored sync base (a local edit; the last such copy), otherwise the last copy (the package DB's one, since the package merge and addEntries append). Toast: "Hex DB: N duplicate entries merged (same package and id; a locally edited copy is kept)".
- The bundled root `hex_database.json` read at startup (`HexDB.init` static merge and `_tryAutoLoadDefaultDb`) is treated as base-only (the live root file is polluted), matched by package+id (a same-id reskin of a package is no longer dropped by the old id-only match).

### Tests (tests/package-duplicates.spec.ts, all RED at f22f9b9, GREEN after)

1-3. Owner workflow in three orders (hex/bld/pkg, pkg/hex/bld, bld/pkg/hex) through the real UI (Publish dropdown buttons, PACKAGES publish confirm + dialog), package active, a new local tile and building first: every server DB file holds only its own package; after two reloads no duplicate (package, id); per-package counts equal the server files.
4. Polluted server fixture (base DBs = disk base + `decameroon` copies + `Decameroon_OnlyInBase`; package DB with a differing `Decameroon_Water_1`; the editor's own root fetch also polluted): no duplicates, the package copy wins, `Decameroon_OnlyInBase` kept in `decameroon`, base count = file base count, stable across a reload.
5. One-time repair: from that polluted server, Publish HexDB + Publish Buildings DB rewrite root and `packages/postapoc` with base entries only (counts = base), no write under `packages/decameroon/`, toast names the skipped entries.
6. Local duplicates already in the autosave (one copy locally edited): merged on load, the edited copy kept and still kept after the next session, toasts "Hex DB: 2 duplicate entries merged" / "Buildings DB: 1 duplicate entry merged".
7. Merge paths (`mergeFromServer` with foreign entries for hexes and buildings, `addEntries`, `restoreEntries`) never leave a second copy.

### One-time repair for the owner (the live files cannot be fixed by code alone)

The live `hex_database.json`, `building_database.json`, `packages/postapoc/hex_database.json` and `packages/postapoc/building_database.json` still contain the 60 / 25 `decameroon` entries. After this build is deployed: open the editor (with the GitHub token), check HEX DB and BUILDINGS show no red duplicate ids (a toast reports how many local duplicates were merged), then press **Publish > Publish HexDB** and **Publish > Publish Buildings DB** once. Each toast says "... base tiles (60 entries of other packages not included ...)" and the four base files are rewritten with base entries only. The `packages/decameroon/` files are not touched; publish the package as usual. Nothing was written to the live server by this task.

## Defect 1: "water places random sprites, rocks and shores inside a water mass; the coastline works incorrectly"

### Root cause

`_autoResolveEdgesAround` re-resolves directional water cells with `EdgeTiling.resolveEdgeTile`, whose mask table held the directional pieces of EVERY package's `Water`/`Rivers` tiles and whose fallback for an unmatched mask was the BASE roles `[WATER_DARK, WATER_LIGHT, WATER_ROCK]` = `Water_Dirty_1`, `Water_1`, `Water_Rock_1`, picked at random. So in the Decameroon package:
- a cell whose mask has no piece (inside the water, e.g. a lake piece now surrounded by water, mask 63) became a random BASE `Water_1` / `Water_Dirty_1` / `Water_Rock_1` = "random water sprites and rocks inside the water mass";
- a matched mask picked at random between the base piece and the Decameroon piece with the same faces (base `River_D_L_EE_2` vs `Decameroon_River_D_L_EE_2`, base `Lake_3` vs `Decameroon_Lake_4`) = base "shores" in the Decameroon water; base `Water_*` cells inside a `Decameroon_Lake_7` (type Rivers) mass then drew Coastline segments around them, inside the lake.
Water/land membership itself is by HexDB `type` everywhere (no hard-coded ids in the resolver or in `Coastline.computeEdges`), so a Decameroon water cell next to base `Water_1` is correctly not a coast; the defect is the package-blind piece/fallback choice.

### Evidence

- Exploration (40x40 map, floor(40/2) even so K1 plays no part), Decameroon fixture from the live package DB: painting `Decameroon_Lake_3` inside a 20x20 `Decameroon_Water_1` block left `Water_1` x4, `Water_Dirty_1` x2, `Water_Rock_1` x1 in the interior; a painted river column mixed `River_U_2`/`River_D_2` (base) with `Decameroon_River_*`; `Decameroon_Lake_7` mass + one `Decameroon_Lake_1` gave `Water_Rock_1` x2, `Water_1` x2, `Water_Dirty_1` x3. With the base DB alone the same random dark/light/rock fallback happens with base tiles (painting `Lake_3` inside `Water_1`: `Water_Dirty_1` x3, `Water_Rock_1` x1): long-standing design, also used by the generator's river carving.
- Bisect (standalone harness `bisect-water.spec.ts`, own config, scratch worktree `/private/tmp/wd-bisect`, real mouse Paint click, `Math.random = () => 0` for determinism):
  - check "paint a DIRECTIONAL Decameroon piece into Decameroon water": already BAD at f828eaa (end of Phase 1): `["Decameroon_Lake_3","Decameroon_Plain_1","Decameroon_Water_1","Water_1","Water_Dirty_1","Water_Rock_1"]`. Long-standing package-awareness gap (Phase 1 re-resolved a painted directional cell and all its water neighbours with the same package-blind table and base fallbacks).
  - check "paint PLAIN Decameroon water next to an authored Decameroon shore piece": good at f828eaa, `git bisect run` between f828eaa (good) and f22f9b9 (bad): first bad commit **d7c4a55** "feat(tools): shared applyTerrainCells with edge re-resolution; hex-correct Fill" (T2.2), which (correctly) made a water cell appearing next to a directional piece re-resolve that piece; that exposed the gap to plain water painting: the shore piece turned into base `River_D_L_EE_2`. Bisect log: good 3a4c430, bad d7c4a55 f9f2ce6 dfcea86 e281dcb c9a88de b222a40 4580717. (A first bisect attempt without the RNG pin and with a too-narrow viewport for pre-layout commits gave meaningless results and was discarded.)
  - Not the cause: T3.9 roles, B5 8df2aec (it only renamed the same three base fallbacks to roles), T5.11 (scatter variants are already package-restricted), T2.11 Replace, T5.3.
- K1: `tests/zz` probe (not committed): a radius-6 `Water_1` lake (127 cells) has the WRONG number of Coastline sides on 0 cells at H=40 but on **35 of 127 cells at H=42 and H=450** (floor(H/2) odd; the default 450x450 map). The Coastline overlay and the EdgeTiling mask read the legacy `_DIRS` tables (K1), so on the default map size coast segments are drawn on sides that are water and missing on sides that are land, and a cell within two cells of the shore can read a "land" neighbour and get a shore piece inside the water. This part of "the coastline works incorrectly" is K1, pre-existing and package-independent. Per the ruling K1 stays unfixed. Least invasive mitigation to propose: make only `Coastline.computeEdges` (purely visual, never touches mapData) take its six neighbours from `HexUtils` true adjacency mapped to FACE_NAMES; that changes overlay pixels only where the overlay is on and K1 differs (no map data, no generator, no edge-tiling change), so it needs an owner decision and a check that no perf hash scene renders the Coastline overlay.

### Fix (commit c09ebaf)

- `EdgeTiling._buildEdgeMaskTable(familyTypes, pkg)` / `resolveEdgeTile(..., pkg)`: optional package filter (`postapoc` = no package field); the table cache is now keyed on `HexDB.getRev()` (it was never invalidated, so pieces of a package loaded after the first resolve were invisible, or a removed package's pieces stayed).
- `_autoResolveEdgesAround`: each cell is resolved with the pieces of the package of the tile it holds. Base cells: base pieces and the unchanged role fallbacks (identical behaviour and rng use for the shipped base DB). Cells of another package: `_packageWaterFallback` = the cell's own id when it already is flat water/lake, else the flat water/lake tile of the same package most of its true neighbours hold, else the package's first flat `Water` tile, else the base roles. One id, so one rng draw per cell as before.
- Generator: `_edgeContext` table limited to the package of the `WATER_LIGHT` role tile (`postapoc` for the shipped DB, identical table there), so a loaded package no longer changes generated rivers.
- Coastline unchanged (already type-based; Unity mirror). A `Water` cell next to `Lake_7` (type Rivers, no faces) still draws a coast, as in the game rule it mirrors.

### Tests (tests/package-water.spec.ts; fixture = 26 rows trimmed from the live `packages/decameroon/hex_database.json`, exact id/type/spriteName/edgeFaces)

At f22f9b9: 4 failed, 1 passed (the coastline characterization below). After the fix: 5 passed.
1. Paint (real mouse) `Decameroon_Lake_3` inside Decameroon water: no non-Decameroon id on the map, interior (2+ cells inside) only flat Decameroon water. HEAD: `Water_Dirty_1`.
2. Paint plain `Decameroon_Water_1` next to an authored `Decameroon_Lake_3` shore: no base id; the piece stays in `decameroon`. HEAD: `River_D_L_EE_2`.
3. Rectangle (drag), Fill (click, `whenIdle`), Replace (`Tools.replaceTerrain`), Scatter (`Tools.scatterCells`): no base id, flat interior after each. HEAD: `Water_Dirty_1` after Rectangle.
4. Mixed boundary (characterization, passes at HEAD too): Decameroon water next to base `Water_1` (true neighbours via HexUtils) has 0 Coastline sides; next to land > 0.
5. Generator seed 42 with the Decameroon package loaded: no Decameroon id and the map hash equals `generator_seed42` from tests/perf-baseline.json (read-only). HEAD: differs.

## Files changed

- MapEditorPro.html (SyncMerge.dedupe/splitForeign/noteDuplicates; GitHubSync base publish filter and sync adoption; HexDB/BldDB merge, adoption, dedupe, base-only static file; EdgeTiling package tables; Tools edge re-resolution; Generator edge context). No served script changed (gen-utils.js, map-jobs.js untouched), so no `?v=` bump or deploy tie was needed.
- tests/package-duplicates.spec.ts, tests/package-water.spec.ts (new).
- CHANGELOG.md (Data safety: publish fix + one-time repair; Packages: water fix), docs/guides/editor-guide.{en,uk}.md + rebuilt HTML (base publish scope, water stays in its package).
- tests/perf-baseline.json untouched; no top-toolbar change.

## Focused runs

- packages-*, package-*, startup-sync, sync-merge, registry-fresh-read, fixwave1, final-wave-a-packages: 274 passed (after D2).
- edge-drift, paint-tools, tile-classes, generation, perf-baseline-guard, perf-equivalence, perf-minimap, perf-workers, fixwave1, final-wave-a/b editor/modals/packages, unit, the two new specs: 382 passed.
- perf-overlays, perf-lod, perf-culling, perf-fill, selection, startup-sync, dead-code, phase1-cleanup: 289 passed.
- docs-lint, help-menu: 14 passed.

## Full suite

`PW_PORT=4476 npx playwright test` once at c09ebaf: **1641 passed, 5 skipped, 0 failed, 0 flaky**, 9.8 min (592 s wall), startup retries: 0, machine sleeps during the run: 0; load average at start 8.55 (uptime 8 days). No sleeps added; no re-runs needed.

## Self-review / concerns

- `adoptForeign` re-adds an entry that exists only in a polluted base file on every startup until the base files are republished, unless the package's sync base lists it; a user who deletes such an orphan locally before the one-time repair may see it come back once. After the repair publish there are no foreign entries left.
- `dedupe` without any stored sync base (a browser that never synced) cannot tell which differing copy is the local edit; it keeps the last copy (the package's own) and says how many were merged.
- The base package's random dark/light/rock fallback inside water (painting a lake piece into base water) is unchanged on purpose (byte-identical base behaviour and generator parity); if the owner considers that wrong too, the same `_packageWaterFallback` rule could be applied to the base package, which changes base painting results (not the generator) and needs an owner decision.
- K1 part of the coastline complaint: not fixed (ruling); mitigation proposed above.
