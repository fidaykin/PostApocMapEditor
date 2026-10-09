# Tile icon audit: palette icon vs the tile drawn on the map

Owner request (2026-10-07): check ALL existing tiles for conformity between the tile ICON (palette) and the ACTUAL tile
drawn on the map. Branch `feature/editor-roadmap`, base commit 2014a5d. Everything below was measured; nothing is
estimated.

## What was run

- **Base package (repo)**: `tests/tile-icon-audit.spec.ts` (default suite) audits all 90 tiles of
  `packages/postapoc/hex_database.json`.
- **Live data**: `AUDIT_LIVE=1 AUDIT_LIVE_DIR=/private/tmp/claude-501/-Users-sergii-tyshchenko-Post-Apo-Map-Editor/e45eed36-0f4f-414d-a15a-98ac234b80cd/scratchpad/audit-live npx playwright test tests/tile-icon-audit.live.spec.ts`
  (2026-10-07 17:35 UTC). Plain GETs of the live `packages/registry.json` (postapoc 1.0.0, decameroon 1.0.10),
  `packages/decameroon/package.json`, `packages/decameroon/hex_database.json` (60 tiles) and the 60 sprites under
  `packages/decameroon/sprites/hex/` (all HTTP 200, 37 771 to 1 716 858 bytes) into the scratchpad (not committed). They
  were served to the editor through FakeGitHub, i.e. the real package machinery (registry, startup sync, Pages sprite
  URLs), and the base 90 + Decameroon 60 tiles were audited twice: pass A with the default package active, pass B with
  Decameroon active (every tile painted from its own package's palette chip while the other package is active).
  **Pass A and pass B gave identical verdicts and reasons for all 150 tiles** (0 differences).

Per tile (method in `tests/tile-audit-helpers.ts`):

1. **Palette**: the tile's chip inside its package group: `<img>` src, decoded, naturalWidth/Height (placeholder if
   < 8 px), computed box (38x38, object-fit fill = the square stretch the map uses), tooltip label = id, category header,
   button background; the chip is clicked (the real handler): selected id, the active-terrain preview
   (`#palette-sel-img` src = chip src, id text).
2. **Map**: a radius-3 disc of the same tile around the cell (no neighbour of another type), the centre on another
   background; the Paint tool (radius 0) left-clicks the cell; mouse moved off the canvas; zoom 200 %, cell centred,
   off the dashed block-grid lines. Checks: `mapData` holds the id (and did not before the click),
   `Terrain.byHexId(id)` = the entry (id, type, package, spriteName), sprite state `loaded`, the map's sprite URL and the
   chip URL are the entry's own file (`packages/<pkg>/sprites/hex/<spriteName>.png`), HTTP status of that URL.
3. **Pixels**: the painted cell is read back (getImageData; a screenshot of the same box once a cross-origin package
   sprite has tainted the canvas) and compared with the chip's `src` loaded as a fresh `new Image()` and drawn the way a
   hex sprite is placed (2r box at the cell centre from `Canvas.hexCenterWorld` + camera; anchors at the cluster scale)
   on the map canvas itself. Scored: pixels inside 0.85 r whose reference pixel and its 8 neighbours are fully opaque;
   verdict score = mean |RGB| on 4x4 block means (0..1). What the map shows through transparent sprite pixels is
   compared with the chip background (layered tiles) or flagged (non-layered tiles show the black canvas).
4. **HEX DB editor**: each tile's row clicked, the preview `<img>` src = the entry's file, decodes, label = id.
5. **Data checks**: spriteName present / no extension / exact-case file in the package (repo: directory listing;
   live: the exact name answered 200, GitHub Pages is case-sensitive), spriteName shared by two tiles, spriteName equal to
   another tile's id, case-insensitive id collisions, palette category vs type. Informational: minimap colour
   (`Terrain.color`) vs the sprite's mean colour, non-square sprites, footprint cells claimed by the anchor.

Verdicts: SPRITE MISSING > MISMATCH > DATA ISSUE > MATCH (the first that applies).

## Summary

| package | tiles | MATCH | MISMATCH | SPRITE MISSING | DATA ISSUE |
|---|---|---|---|---|---|
| postapoc (repo) | 90 | 79 | 1 | 0 | 10 |
| decameroon (live 1.0.10) | 60 | 55 | 0 | 0 | 5 |

The counts are after the palette fix in 42368cb (see below); before it, postapoc had 3 MISMATCH (Snail_Medieval_1 and
Shail_Flat_1 additionally).

All 150 tiles: the chip click selected the tile, the Paint click stored exactly that id in `mapData`,
`Terrain.byHexId` returned the same entry, the chip, the map sprite, the active-terrain preview and the HEX DB editor
preview all point to the entry's own sprite file, every sprite answered HTTP 200 and decoded at full size, every chip box
is 38x38 fill, and every footprint anchor claimed all its footprint cells (13 base anchors 6/6 or 3/3, Decameroon_SettementsBig_1 6/6).

### Mismatches and data issues

| package | tile | verdict | reason | class |
|---|---|---|---|---|
| postapoc | Forest_5_Test | MISMATCH | sprite Forest_red.png is at most 80 % opaque (max alpha 204) and the tile is not layered: the map draws it over the black canvas, the palette over the button background (score 0.0193) | DATA (KNOWN_MISMATCHES) |
| postapoc | Snail_Medieval_1 | MISMATCH before 42368cb | palette showed rgb(85,85,85) behind the transparent 25 % of the sprite, the map draws rgb(122,154,74) (distance 79) | CODE, fixed |
| postapoc | Shail_Flat_1 | MISMATCH before 42368cb | same: palette rgb(85,85,85), map rgb(122,154,74) behind the transparent 22 % | CODE, fixed |
| postapoc | Forest_3, Forest_4_Test | DATA ISSUE | both use spriteName "Forest_3": two tiles, one picture | DATA |
| postapoc | Settlements_TEST_Big_1, Settlement_Kaiju_1, Crustal_Kaiju_Alive_1, Crustal_Kaiju_Defeat_1, Crustal_Kaiju_Die_1, Crustal_Kaiju_Sceleton_V_1, Crustal_Kaiju_Sceleton_V_2, Crustal_Kaiju_Sceleton_V_3 | DATA ISSUE | type Special but listed under "💎 RESOURCES" | DATA |
| decameroon | Decameroon_SettementsBig_1, Decameroon_Settlements_1 | DATA ISSUE | type Special but listed under "🏜️ BARREN/DESERT" | DATA |
| decameroon | Decameroon_WaterStones_1, Decameroon_BrokenShip_1, Decameroon_Fish_1 | DATA ISSUE | 47 % / 61 % / 88 % of the hex is transparent in the sprite and the tile is not layered: the map shows the black canvas rgb(10,10,10) there, no water under the stones / ship / fish (the base equivalents Water_Rock_1, Water_BrokenBoat_1, Fish_1 carry `isLayered: true` and draw the Water sprite under) | DATA |

Compared images (map frame and icon reference, 165x165 px) for every non-MATCH tile, both passes, not committed:
`/private/tmp/claude-501/-Users-sergii-tyshchenko-Post-Apo-Map-Editor/e45eed36-0f4f-414d-a15a-98ac234b80cd/scratchpad/audit-live/images/<pass>__<package>__<id>__map.png` and `__ref.png`, e.g.
`/private/tmp/claude-501/-Users-sergii-tyshchenko-Post-Apo-Map-Editor/e45eed36-0f4f-414d-a15a-98ac234b80cd/scratchpad/audit-live/images/A-postapoc-active__postapoc__Forest_5_Test__map.png`.

### Informational (no verdict)

- **Minimap colour**: `Terrain.color(id)` is a hard-coded table of legacy ids; 72 of 90 base tiles and all 60 Decameroon
  tiles get the default rgb(120,155,85). 28 base and 12 Decameroon tiles are farther than 80 (RGB) from their sprite's
  mean colour, e.g. Water_1 rgb(120,155,85) vs sprite mean rgb(18,111,169) (139), Lake_1..7 and Decameroon_Lake_1..7
  (124-126), Rift_1 rgb(35,25,25) vs rgb(138,163,71) (178), Rubble_1..3 (84-120). Water and lakes show green on the
  minimap and in the zoom < 10 % overview.
- **Non-square sprites** (stretched to a square in both palette and map): Monster_TEST_Chicken_Big_2 697x941,
  Snail_Medieval_1 967x890. Cluster sprites the palette squeezes to a square while the map keeps the aspect:
  Crustal_Kaiju_Alive_1 1054x987, Crustal_Kaiju_Defeat_1 1151x783, Crustal_Kaiju_Die_1 1054x810,
  Crustal_Kaiju_Sceleton_V_1..3 (1065x693, 1068x757, 1046x667), Rabbit_Flat_1 913x969.
- **Decameroon pictures identical to base pictures**: 21 of the 60 Decameroon sprites are different files but the same
  picture as a base sprite (mean premultiplied RGBA difference 0.0000 at 64x64): Decameroon_<X> = <X> for
  DestroyedBuilding_1, Fish_1, Lake_7, Lava_Plain_1, Lava_Rift_1, Rift_1, Water_1, River_D_L_EE_2, River_L_D_E_1,
  River_L_L_E_5, River_L_R_E_5, River_L_U_E_1, River_U_D_E_4, River_U_L_EE_2, River_U_R_EE_2, River_U_U_E_4;
  Decameroon_DirtyWater_1 = Water_Dirty_1, Decameroon_Mountain_2 = Mountain_Kaiju_1, Decameroon_SettementsBig_1 =
  Settlement_Medieval_1, Decameroon_Settlements_1 = Chapel_Medieval_1, Decameroon_River_D_L_RE_2 = River_D_R_EE_2
  (its spriteName is Decameroon_River_D_R_EE_2 while its id says D_L_RE_2).
- spriteName differs from id for many tiles (e.g. Desert_1 -> "Dessert", Shail_Flat_1 -> "Snail_Flat_1",
  Decameroon_SettementsBig_1 -> "Decameroon_Settlements_Big_1"); the files exist, so the tiles render; listed per tile in
  the table notes.

## Calibrated threshold

Verdict score threshold **0.001** (`DIFF_THRESHOLD` in `tests/tile-audit-helpers.ts`), from the live run (pass A):

- Self-scores (map frame vs its own icon) of the 149 tiles whose drawn hex is their icon: max 0.00027 (block score),
  0.00032 per pixel; Forest_5_Test (genuinely different, see above) 0.0193.
- Closest pair of DIFFERENT base pictures (each base frame vs the icon of every other base sprite file with different
  bytes, drawn at the same offset on the map canvas): Lake_5 / Lake_7 0.0047, then Lake_1 / Lake_7 0.0094,
  River_L_R_E_5 / River_L_5 0.0104.
- 0.001 is 3.7x the worst self-score and 4.7x below the closest distinct pair.
- The screenshot read path equals the canvas read path: max channel difference 0 over the 90 base tiles read both ways
  before the canvas was tainted.
- Earlier variants were rejected on evidence: a reference drawn on a small scratch canvas had self-scores up to 0.0049
  (Chrome resamples a small canvas differently: uniform -1 level offset) against 0.0047 for Lake_5 / Lake_7; the
  alpha >= 250 mask let 1-2 % of the base colour through (Special tiles +1 green); dashed block-grid lines crossed cells
  in every 20th column (cells now avoid them).

## Positive controls (tests/tile-icon-audit.spec.ts, second test, same batch as a good Forest_1 = MATCH, score 0)

- Audit_Ctl_Icon_1 (own unused sprite RockySwamp.png; its chip `<img>` swapped to Forest_1.png after the palette was
  built): MISMATCH, score above the threshold, "drawn hex differs from the icon", "icon src ... is not the entry's
  sprite file".
- Audit_Ctl_Points_1 (spriteName Rubble_2, another tile's file): DATA ISSUE "spriteName "Rubble_2" is shared with Rubble_2".
- Audit_Ctl_Missing_1 (spriteName Audit_No_Such_Sprite): SPRITE MISSING, HTTP 404, sprite state failed, no file.
- forest_2 in package auditpkg (collides case-insensitively with base Forest_2): MISMATCH, `Terrain.byHexId` resolves
  to Forest_2 [postapoc], "id collides (case-insensitive) with Forest_2 [postapoc]".

## Code fix (RED first)

- 42368cb `fix(palette)`: the palette tinted layered tile buttons from its own switch (water, forests, plains, else
  #555) while the map draws `_terrainTypeFallbackColor(type)` under a layered sprite whose type has no base sprite
  (Special #7a9a4a, Swamp #4a6a3a). The palette now calls `Canvas.terrainFallbackColor` (the map's table, exported).
- RED (pre-fix MapEditorPro.html, same spec): "Snail_Medieval_1: MISMATCH: behind the sprite (25% of the hex is
  transparent) the palette shows rgb(85, 85, 85) but the map draws rgb(122,154,74) (distance 79)" and the same for
  Shail_Flat_1 (22 %). GREEN after the fix: chip rgb(122,154,74) = map rgb(122,154,74), distance 0.
- Measured distances for the other layered tiles (kept under `BG_MAX_DIST` 40): water 23-27 (flat #2a6fad button vs
  the Water sprite under), forests 0.

## Recommended fixes

### CODE (editor)

1. Done (42368cb): palette button tint for layered tiles = the map's fallback colour.
2. Not fixed: minimap / overview colour table (`Terrain.COLORS`) only knows legacy ids; water, lakes, all package tiles
   fall back to green. Derive the colour from the sprite (mean opaque colour at load) or from the type fallback. It
   changes zoom < 10 % output and the minimap, so it needs an owner decision and its own task (not done here).
3. Latent, not observed in the data: `Terrain`'s sprite cache and `byHexId` are keyed by the bare id, while HexDB
   allows the same id in two packages (`package::id`). Control forest_2 [auditpkg] shows the effect (`Terrain.byHexId`
   returns the other package's entry for the painted cell). Import/edit could refuse ids that collide case-insensitively across packages.
4. Test environment only: package sprites load cross-origin on localhost (no `crossOrigin`), which taints the map
   canvas; on GitHub Pages they are same-origin. The audit reads such frames by screenshot (proved equal to the canvas read).

### DATA (content owner only; the audit did not change any HexDB entry or sprite)

1. Forest_5_Test: Forest_red.png is at most 80 % opaque; make it opaque or mark the tile `isLayered` (test tile).
2. Decameroon_WaterStones_1, Decameroon_BrokenShip_1, Decameroon_Fish_1: set `isLayered: true` (as the base
   Water_Rock_1 / Water_BrokenBoat_1 / Fish_1) so the map draws water under the transparent sprite instead of black.
3. Palette placement: 8 Special base tiles under "💎 RESOURCES" and Decameroon_SettementsBig_1 /
   Decameroon_Settlements_1 under "🏜️ BARREN/DESERT"; give them the Special category (empty or ⚙️ SPECIAL) or a type
   that matches the category.
4. Forest_4_Test shares Forest_3's sprite; give it its own picture or drop it.
5. Review the 21 Decameroon sprites that are the base picture (listed above), and Decameroon_River_D_L_RE_2 whose
   picture is River_D_R_EE_2 (id and spriteName name different pieces).

## Test runs

- `npx playwright test tests/tile-icon-audit.spec.ts`: 2 passed (8 s; base audit of 90 tiles ~7 s in one page).
- Live audit: 1 passed (1.2 min, 2 passes x 150 tiles plus calibration).
- Full default suite at 9ec9433 + this report: 1672 passed, 5 skipped, 0 failed, 9.8 min, startup retries 0, machine
  sleeps 0, load average 4.5 before / 8.4 after. The live spec is not in the default suite (ignored unless AUDIT_LIVE).

## Full table (live run, pass A; pass B identical)

Sprite HTTP / bytes: base = the repo file through the local test server; decameroon = the live GitHub Pages GET.
Score = block / pixel score of the map frame against the icon (threshold 0.001 on the block score).

| package | id | type | category | spriteName | sprite HTTP / bytes | score (block / pixel) | verdict | reason / notes |
|---|---|---|---|---|---|---|---|---|
| postapoc | Plain_1 | Plains | 🌾 PLAINS | Plain_1 | 200 / 238687 (repo) | 0.00000 / 0.00000 | MATCH |  |
| postapoc | Plain_2 | Plains | 🌾 PLAINS | Plain_2 | 200 / 273104 (repo) | 0.00006 / 0.00006 | MATCH |  |
| postapoc | Forest_1 | Forests | 🌲 FOREST | Forest_1 | 200 / 275713 (repo) | 0.00009 / 0.00009 | MATCH |  |
| postapoc | Forest_2 | Forests | 🌲 FOREST | Forest_2 | 200 / 299843 (repo) | 0.00011 / 0.00012 | MATCH |  |
| postapoc | Forest_3 | Forests | 🌲 FOREST | Forest_3 | 200 / 338446 (repo) | 0.00012 / 0.00014 | DATA ISSUE | spriteName "Forest_3" is shared with Forest_4_Test (two tiles, one picture) |
| postapoc | Forest_4_Test | Forests | 🌲 FOREST | Forest_3 | 200 / 338446 (repo) | 0.00012 / 0.00014 | DATA ISSUE | spriteName "Forest_3" is shared with Forest_3 (two tiles, one picture); note: spriteName "Forest_3" differs from id; note: minimap colour rgb(120,155,85) is far (96) from the sprite's mean rgb(33,117,68) |
| postapoc | Forest_5_Test | Forests | 🌲 FOREST | Forest_red | 200 / 393506 (repo) | 0.01933 / 0.01933 | MISMATCH | drawn hex differs from the icon: score 0.0193 > 0.001 (semi-transparent over the palette background); note: spriteName "Forest_red" differs from id; note: minimap colour rgb(120,155,85) is far (147) from the sprite's mean rgb(74,26,32) |
| postapoc | Hills_1 | Hills/Mountains | ⛰️ ROCKY/MOUNTAIN | Hills | 200 / 323033 (repo) | 0.00008 / 0.00009 | MATCH | note: spriteName "Hills" differs from id |
| postapoc | Mountain_1 | Hills/Mountains | ⛰️ ROCKY/MOUNTAIN | Mountain | 200 / 299478 (repo) | 0.00010 / 0.00011 | MATCH | note: spriteName "Mountain" differs from id |
| postapoc | Rubble_1 | Rubble | 🏚️ RUBBLE/WASTELAND | Rubble_1 | 200 / 319907 (repo) | 0.00011 / 0.00013 | MATCH | note: minimap colour rgb(100,85,65) is far (83) from the sprite's mean rgb(134,157,88) |
| postapoc | Rubble_2 | Rubble | 🏚️ RUBBLE/WASTELAND | Rubble_2 | 200 / 336217 (repo) | 0.00011 / 0.00014 | MATCH | note: minimap colour rgb(85,70,50) is far (110) from the sprite's mean rgb(131,146,115) |
| postapoc | Rubble_3 | Rubble | 🏚️ RUBBLE/WASTELAND | Rubble_3 | 200 / 337816 (repo) | 0.00014 / 0.00015 | MATCH | note: minimap colour rgb(65,50,35) is far (118) from the sprite's mean rgb(119,140,90) |
| postapoc | Water_1 | Water | 💧 WATER / RIVER | Water | 200 / 106730 (repo) | 0.00002 / 0.00002 | MATCH | note: spriteName "Water" differs from id; note: minimap colour rgb(120,155,85) is far (140) from the sprite's mean rgb(17,111,169) |
| postapoc | Water_Dirty_1 | Water | 💧 WATER / RIVER | DirtyWater | 200 / 133889 (repo) | 0.00002 / 0.00002 | MATCH | note: spriteName "DirtyWater" differs from id; note: minimap colour rgb(120,155,85) is far (137) from the sprite's mean rgb(7,93,130) |
| postapoc | GoldVein_1 | Resources | 💎 RESOURCES | GoldVein | 200 / 357094 (repo) | 0.00008 / 0.00010 | MATCH | note: spriteName "GoldVein" differs from id; note: minimap colour rgb(200,170,25) is far (102) from the sprite's mean rgb(113,121,45) |
| postapoc | Rift_1 | Volcanic/Rift | 🌋 VOLCANIC/RIFT | Rift | 200 / 302616 (repo) | 0.00011 / 0.00012 | MATCH | note: spriteName "Rift" differs from id; note: minimap colour rgb(35,25,25) is far (177) from the sprite's mean rgb(137,162,70) |
| postapoc | GemField_1 | Resources | 💎 RESOURCES | GemField | 200 / 363023 (repo) | 0.00014 / 0.00015 | MATCH | note: spriteName "GemField" differs from id; note: minimap colour rgb(120,155,85) is far (86) from the sprite's mean rgb(134,93,143) |
| postapoc | Desert_1 | Barren/Desert | 🏜️ BARREN/DESERT | Dessert | 200 / 379513 (repo) | 0.00006 / 0.00007 | MATCH | note: spriteName "Dessert" differs from id |
| postapoc | Barren_1 | Barren/Desert | 🏜️ BARREN/DESERT | Barren | 200 / 346441 (repo) | 0.00008 / 0.00010 | MATCH | note: spriteName "Barren" differs from id; note: minimap colour rgb(150,130,95) is far (101) from the sprite's mean rgb(229,189,118) |
| postapoc | Oil_1 | Resources | 💎 RESOURCES | Oil_1 | 200 / 340588 (repo) | 0.00011 / 0.00013 | MATCH | note: minimap colour rgb(50,50,50) is far (113) from the sprite's mean rgb(134,111,95) |
| postapoc | Swamp_1 | Swamp | 🟫 SWAMP | Swamp | 200 / 361055 (repo) | 0.00013 / 0.00014 | MATCH | note: spriteName "Swamp" differs from id |
| postapoc | BrokenPlane_1 | Special | (none) | BrokenPlane | 200 / 359660 (repo) | 0.00012 / 0.00013 | MATCH | note: spriteName "BrokenPlane" differs from id |
| postapoc | BrokenRails_1 | Special | (none) | BrokenRails | 200 / 356730 (repo) | 0.00014 / 0.00016 | MATCH | note: spriteName "BrokenRails" differs from id |
| postapoc | DestroyedBuilding_1 | Plains | 🌾 PLAINS | DestroyedBuilding_1 | 200 / 377834 (repo) | 0.00012 / 0.00014 | MATCH |  |
| postapoc | Water_Rock_1 | Water | 💧 WATER / RIVER | Stones_1 | 200 / 160550 (repo) | 0.00008 / 0.00009 | MATCH | note: spriteName "Stones_1" differs from id; note: 43% of the hex is transparent in the sprite: palette shows rgb(42, 111, 173) there, map shows rgb(17,111,169) |
| postapoc | Lava_Plain_1 | Volcanic/Rift | 🌋 VOLCANIC/RIFT | LavaPlain | 200 / 316447 (repo) | 0.00012 / 0.00012 | MATCH | note: spriteName "LavaPlain" differs from id |
| postapoc | Lava_Rift_1 | Volcanic/Rift | 🌋 VOLCANIC/RIFT | LavaRift | 200 / 317278 (repo) | 0.00011 / 0.00013 | MATCH | note: spriteName "LavaRift" differs from id |
| postapoc | Fish_1 | Water | 💧 WATER / RIVER | Fish_1 | 200 / 45002 (repo) | 0.00002 / 0.00001 | MATCH | note: 88% of the hex is transparent in the sprite: palette shows rgb(42, 111, 173) there, map shows rgb(17,111,169); note: minimap colour rgb(120,155,85) is far (139) from the sprite's mean rgb(24,55,95) |
| postapoc | Water_Ship_Test_1 | Water | 💧 WATER / RIVER | SmallShip | 200 / 183777 (repo) | 0.00019 / 0.00023 | MATCH | note: spriteName "SmallShip" differs from id; note: 49% of the hex is transparent in the sprite: palette shows rgb(42, 111, 173) there, map shows rgb(17,111,169) |
| postapoc | Water_SmallShipyard_Test_1 | Water | 💧 WATER / RIVER | SmallShipyard | 200 / 340896 (repo) | 0.00014 / 0.00016 | MATCH | note: spriteName "SmallShipyard" differs from id; note: 14% of the hex is transparent in the sprite: palette shows rgb(42, 111, 173) there, map shows rgb(19,113,171) |
| postapoc | Water_BrokenBoat_1 | Water | 💧 WATER / RIVER | BrokenBoat | 200 / 115230 (repo) | 0.00022 / 0.00018 | MATCH | note: spriteName "BrokenBoat" differs from id; note: 71% of the hex is transparent in the sprite: palette shows rgb(42, 111, 173) there, map shows rgb(17,111,169) |
| postapoc | Water_OilSpill_1 | Water | 💧 WATER / RIVER | OilWater | 200 / 233179 (repo) | 0.00005 / 0.00005 | MATCH | note: spriteName "OilWater" differs from id; note: 11% of the hex is transparent in the sprite: palette shows rgb(42, 111, 173) there, map shows rgb(16,109,168); note: minimap colour rgb(120,155,85) is far (141) from the sprite's mean rgb(36,43,72) |
| postapoc | River_L_1 | Rivers | 💧 WATER / RIVER | River_L_1 | 200 / 276711 (repo) | 0.00013 / 0.00013 | MATCH |  |
| postapoc | River_R_1 | Rivers | 💧 WATER / RIVER | River_R_1 | 200 / 276729 (repo) | 0.00013 / 0.00013 | MATCH |  |
| postapoc | River_D_2 | Rivers | 💧 WATER / RIVER | River_D_2 | 200 / 293155 (repo) | 0.00005 / 0.00006 | MATCH |  |
| postapoc | River_U_2 | Rivers | 💧 WATER / RIVER | River_U_2 | 200 / 294078 (repo) | 0.00005 / 0.00006 | MATCH |  |
| postapoc | River_D_3 | Rivers | 💧 WATER / RIVER | River_D_3 | 200 / 299163 (repo) | 0.00008 / 0.00010 | MATCH |  |
| postapoc | River_U_3 | Rivers | 💧 WATER / RIVER | River_U_3 | 200 / 302609 (repo) | 0.00008 / 0.00010 | MATCH |  |
| postapoc | River_R_4 | Rivers | 💧 WATER / RIVER | River_R_4 | 200 / 290454 (repo) | 0.00009 / 0.00010 | MATCH |  |
| postapoc | River_L_4 | Rivers | 💧 WATER / RIVER | River_L_4 | 200 / 300821 (repo) | 0.00008 / 0.00010 | MATCH |  |
| postapoc | River_U_4 | Rivers | 💧 WATER / RIVER | River_U_4 | 200 / 281790 (repo) | 0.00009 / 0.00010 | MATCH |  |
| postapoc | River_D_4 | Rivers | 💧 WATER / RIVER | River_D_4 | 200 / 288444 (repo) | 0.00010 / 0.00011 | MATCH |  |
| postapoc | River_R_5 | Rivers | 💧 WATER / RIVER | River_R_5 | 200 / 299723 (repo) | 0.00009 / 0.00010 | MATCH |  |
| postapoc | River_L_5 | Rivers | 💧 WATER / RIVER | River_L_5 | 200 / 299984 (repo) | 0.00008 / 0.00009 | MATCH |  |
| postapoc | Lake_1 | Rivers | 💧 WATER / RIVER | Lake_1 | 200 / 311953 (repo) | 0.00006 / 0.00007 | MATCH | note: minimap colour rgb(120,155,85) is far (125) from the sprite's mean rgb(28,131,166) |
| postapoc | Lake_2 | Rivers | 💧 WATER / RIVER | Lake_2 | 200 / 303716 (repo) | 0.00005 / 0.00007 | MATCH | note: minimap colour rgb(120,155,85) is far (126) from the sprite's mean rgb(28,132,168) |
| postapoc | Lake_3 | Rivers | 💧 WATER / RIVER | Lake_3 | 200 / 304207 (repo) | 0.00005 / 0.00007 | MATCH | note: minimap colour rgb(120,155,85) is far (126) from the sprite's mean rgb(28,132,168) |
| postapoc | Lake_4 | Rivers | 💧 WATER / RIVER | Lake_4 | 200 / 312284 (repo) | 0.00005 / 0.00006 | MATCH | note: minimap colour rgb(120,155,85) is far (125) from the sprite's mean rgb(28,131,166) |
| postapoc | Lake_5 | Rivers | 💧 WATER / RIVER | Lake_5 | 200 / 306182 (repo) | 0.00005 / 0.00007 | MATCH | note: minimap colour rgb(120,155,85) is far (124) from the sprite's mean rgb(29,133,167) |
| postapoc | Lake_6 | Rivers | 💧 WATER / RIVER | Lake_6 | 200 / 305832 (repo) | 0.00006 / 0.00007 | MATCH | note: minimap colour rgb(120,155,85) is far (125) from the sprite's mean rgb(28,130,166) |
| postapoc | Lake_7 | Rivers | 💧 WATER / RIVER | Lake_7 | 200 / 311958 (repo) | 0.00005 / 0.00007 | MATCH | note: minimap colour rgb(120,155,85) is far (124) from the sprite's mean rgb(30,133,167) |
| postapoc | River_D_L_EE_2 | Rivers | 💧 WATER / RIVER | River_D_L_EE_2 | 200 / 273443 (repo) | 0.00005 / 0.00007 | MATCH |  |
| postapoc | River_D_R_EE_2 | Rivers | 💧 WATER / RIVER | River_D_R_EE_2 | 200 / 255968 (repo) | 0.00006 / 0.00007 | MATCH |  |
| postapoc | River_L_D_E_1 | Rivers | 💧 WATER / RIVER | River_L_D_E_1 | 200 / 286913 (repo) | 0.00012 / 0.00012 | MATCH |  |
| postapoc | River_L_U_E_1 | Rivers | 💧 WATER / RIVER | River_L_U_E_1 | 200 / 270992 (repo) | 0.00012 / 0.00013 | MATCH |  |
| postapoc | River_U_L_EE_2 | Rivers | 💧 WATER / RIVER | River_U_L_EE_2 | 200 / 256142 (repo) | 0.00005 / 0.00007 | MATCH |  |
| postapoc | River_U_R_EE_2 | Rivers | 💧 WATER / RIVER | River_U_R_EE_2 | 200 / 261326 (repo) | 0.00005 / 0.00006 | MATCH |  |
| postapoc | River_U_D_E_4 | Rivers | 💧 WATER / RIVER | River_U_D_E_4 | 200 / 270733 (repo) | 0.00009 / 0.00010 | MATCH |  |
| postapoc | River_U_U_E_4 | Rivers | 💧 WATER / RIVER | River_U_U_E_4 | 200 / 266117 (repo) | 0.00010 / 0.00010 | MATCH |  |
| postapoc | River_L_L_E_5 | Rivers | 💧 WATER / RIVER | River_L_L_E_5 | 200 / 286694 (repo) | 0.00007 / 0.00008 | MATCH |  |
| postapoc | River_L_R_E_5 | Rivers | 💧 WATER / RIVER | River_L_R_E_5 | 200 / 288552 (repo) | 0.00007 / 0.00007 | MATCH |  |
| postapoc | Plain_TEST_Cat_1 | Plains | 🌾 PLAINS | Plain_Cat_1 | 200 / 270632 (repo) | 0.00004 / 0.00004 | MATCH | note: spriteName "Plain_Cat_1" differs from id |
| postapoc | Plain_TEST_Chicken_1 | Plains | 🌾 PLAINS | Plain_Chicken_1 | 200 / 291615 (repo) | 0.00004 / 0.00005 | MATCH | note: spriteName "Plain_Chicken_1" differs from id; note: minimap colour rgb(120,155,85) is far (89) from the sprite's mean rgb(168,162,10) |
| postapoc | Altar_TEST_Chicken_1 | Forests | 🌲 FOREST | Altar_Chicken_1 | 200 / 379641 (repo) | 0.00012 / 0.00013 | MATCH | note: spriteName "Altar_Chicken_1" differs from id |
| postapoc | Monster_TEST_Chicken_Small_1 | Forests | 🌲 FOREST | Monster_Chicken_Small_1 | 200 / 290964 (repo) | 0.00012 / 0.00013 | MATCH | note: spriteName "Monster_Chicken_Small_1" differs from id; note: 14% of the hex is transparent in the sprite: palette shows rgb(45, 106, 45) there, map shows rgb(45,106,45); note: minimap colour rgb(120,155,85) is far (120) from the sprite's mean rgb(238,175,75) |
| postapoc | Monster_TEST_Chicken_Big_2 | Forests | 🌲 FOREST | Monster_Chicken_Big_2 | 200 / 840416 (repo) | 0.00000 / 0.00000 | MATCH | note: spriteName "Monster_Chicken_Big_2" differs from id; note: 697x941 sprite is stretched to a square in both palette and map; note: 6% of the hex is transparent in the sprite: palette shows rgb(45, 106, 45) there, map shows rgb(45,106,45); note: minimap colour rgb(120,155,85) is far (89) from the sprite's mean rgb(209,161,92) |
| postapoc | Settlements_TEST_Big_1 | Special | 💎 RESOURCES | Setlements_Big_Chicken_1 | 200 / 2365129 (repo) | 0.00005 / 0.00006 | DATA ISSUE | listed under "💎 RESOURCES" but its type is Special; note: spriteName "Setlements_Big_Chicken_1" differs from id; note: footprint 6/6 cells claimed |
| postapoc | Forest_Kaiju_1 | Forests | 🌲 FOREST | Forest_Kaiju_1 | 200 / 323689 (repo) | 0.00007 / 0.00008 | MATCH |  |
| postapoc | Plain_Kaiju_1 | Plains | 🌾 PLAINS | Plain_Kaiju_1 | 200 / 280776 (repo) | 0.00003 / 0.00003 | MATCH |  |
| postapoc | Forest_Kaiju_2 | Forests | 🌲 FOREST | Forest_Kaiju_2 | 200 / 374383 (repo) | 0.00013 / 0.00015 | MATCH |  |
| postapoc | Mountain_Kaiju_1 | Hills/Mountains | ⛰️ ROCKY/MOUNTAIN | Mountain_Kaiju_1 | 200 / 318386 (repo) | 0.00010 / 0.00010 | MATCH |  |
| postapoc | Mountain_Kaiju_2 | Hills/Mountains | ⛰️ ROCKY/MOUNTAIN | Mountain_Kaiju_2 | 200 / 360341 (repo) | 0.00012 / 0.00013 | MATCH |  |
| postapoc | GoldVein_Kaiju_1 | Resources | 💎 RESOURCES | GoldenMine_Kaiju_1 | 200 / 388129 (repo) | 0.00014 / 0.00015 | MATCH | note: spriteName "GoldenMine_Kaiju_1" differs from id |
| postapoc | Settlement_Kaiju_1 | Special | 💎 RESOURCES | MainSettlement_Kaiju_1 | 200 / 2456943 (repo) | 0.00008 / 0.00009 | DATA ISSUE | listed under "💎 RESOURCES" but its type is Special; note: spriteName "MainSettlement_Kaiju_1" differs from id; note: footprint 6/6 cells claimed |
| postapoc | Crustal_Kaiju_Alive_1 | Special | 💎 RESOURCES | Crystal_Kaiju_Alife_V_1 | 200 / 1277190 (repo) | 0.00000 / 0.00000 | DATA ISSUE | listed under "💎 RESOURCES" but its type is Special; note: spriteName "Crystal_Kaiju_Alife_V_1" differs from id; note: 1054x987 cluster sprite: the palette stretches it to a square, the map keeps its aspect; note: footprint 6/6 cells claimed |
| postapoc | Crustal_Kaiju_Defeat_1 | Special | 💎 RESOURCES | Crystal_Kaiju_Defeat_V_1 | 200 / 1220285 (repo) | 0.00001 / 0.00000 | DATA ISSUE | listed under "💎 RESOURCES" but its type is Special; note: spriteName "Crystal_Kaiju_Defeat_V_1" differs from id; note: 1151x783 cluster sprite: the palette stretches it to a square, the map keeps its aspect; note: footprint 6/6 cells claimed |
| postapoc | Crustal_Kaiju_Die_1 | Special | 💎 RESOURCES | Crystal_Kaiju_Die_V1 | 200 / 1232519 (repo) | 0.00010 / 0.00001 | DATA ISSUE | listed under "💎 RESOURCES" but its type is Special; note: spriteName "Crystal_Kaiju_Die_V1" differs from id; note: 1054x810 cluster sprite: the palette stretches it to a square, the map keeps its aspect; note: footprint 6/6 cells claimed |
| postapoc | Crustal_Kaiju_Sceleton_V_1 | Special | 💎 RESOURCES | Crystal_Kaiju_skeleton_V_1 | 200 / 1015615 (repo) | 0.00003 / 0.00000 | DATA ISSUE | listed under "💎 RESOURCES" but its type is Special; note: spriteName "Crystal_Kaiju_skeleton_V_1" differs from id; note: 1065x693 cluster sprite: the palette stretches it to a square, the map keeps its aspect; note: footprint 6/6 cells claimed; note: 13% of the hex is transparent in the sprite: palette shows rgb(122, 154, 74) there, map shows rgb(103,162,29); note: minimap colour rgb(120,155,85) is far (126) from the sprite's mean rgb(210,196,163) |
| postapoc | Crustal_Kaiju_Sceleton_V_2 | Special | 💎 RESOURCES | Crystal_Kaiju_skeleton_V_2 | 200 / 984163 (repo) | 0.00000 / 0.00000 | DATA ISSUE | listed under "💎 RESOURCES" but its type is Special; note: spriteName "Crystal_Kaiju_skeleton_V_2" differs from id; note: 1068x757 cluster sprite: the palette stretches it to a square, the map keeps its aspect; note: footprint 6/6 cells claimed; note: 8% of the hex is transparent in the sprite: palette shows rgb(122, 154, 74) there, map shows rgb(103,158,27) |
| postapoc | Crustal_Kaiju_Sceleton_V_3 | Special | 💎 RESOURCES | Crystal_Kaiju_skeleton_V_3 | 200 / 914625 (repo) | 0.00027 / 0.00000 | DATA ISSUE | listed under "💎 RESOURCES" but its type is Special; note: spriteName "Crystal_Kaiju_skeleton_V_3" differs from id; note: 1046x667 cluster sprite: the palette stretches it to a square, the map keeps its aspect; note: footprint 6/6 cells claimed; note: 17% of the hex is transparent in the sprite: palette shows rgb(122, 154, 74) there, map shows rgb(105,162,30); note: minimap colour rgb(120,155,85) is far (111) from the sprite's mean rgb(213,185,137) |
| postapoc | Settlement_Medieval_1 | Special | (none) | Settlements_Medieval_Town_1 | 200 / 2370199 (repo) | 0.00005 / 0.00006 | MATCH | note: spriteName "Settlements_Medieval_Town_1" differs from id; note: footprint 6/6 cells claimed |
| postapoc | Chapel_Medieval_1 | Special | (none) | Chapel_Medieval_1 | 200 / 391469 (repo) | 0.00019 / 0.00021 | MATCH |  |
| postapoc | Dragon_Medieval_1 | Special | (none) | Dragon_Medieval_1 | 200 / 1172536 (repo) | 0.00003 / 0.00003 | MATCH | note: footprint 6/6 cells claimed |
| postapoc | Snail_Medieval_1 | Special | (none) | Snail_Medieval_1 | 200 / 873698 (repo) | 0.00022 / 0.00031 | MATCH | note: 967x890 sprite is stretched to a square in both palette and map; note: 25% of the hex is transparent in the sprite: palette shows rgb(122, 154, 74) there, map shows rgb(122,154,74) |
| postapoc | Plain_Flat_1 | Special | (none) | Plain_Flat_1 | 200 / 258445 (repo) | 0.00005 / 0.00006 | MATCH |  |
| postapoc | Settlement_Town_Flat_1 | Special | (none) | Settlement_Town_Flat_1 | 200 / 1997375 (repo) | 0.00006 / 0.00008 | MATCH | note: footprint 6/6 cells claimed |
| postapoc | Chapel_Flat_1 | Special | (none) | Chapel_Flat_1 | 200 / 322730 (repo) | 0.00023 / 0.00028 | MATCH |  |
| postapoc | Shail_Flat_1 | Special | (none) | Snail_Flat_1 | 200 / 752644 (repo) | 0.00027 / 0.00032 | MATCH | note: spriteName "Snail_Flat_1" differs from id; note: 22% of the hex is transparent in the sprite: palette shows rgb(122, 154, 74) there, map shows rgb(122,154,74); note: minimap colour rgb(120,155,85) is far (84) from the sprite's mean rgb(101,77,62) |
| postapoc | Dragon_Flat_1 | Special | (none) | Dragon_Flat_1 | 200 / 917315 (repo) | 0.00000 / 0.00000 | MATCH | note: footprint 6/6 cells claimed; note: 41% of the hex is transparent in the sprite: palette shows rgb(122, 154, 74) there, map shows rgb(108,166,24); note: minimap colour rgb(120,155,85) is far (163) from the sprite's mean rgb(30,34,24) |
| postapoc | Rabbit_Flat_1 | Special | (none) | Rabbit_Flat_1 | 200 / 749104 (repo) | 0.00009 / 0.00010 | MATCH | note: 913x969 cluster sprite: the palette stretches it to a square, the map keeps its aspect; note: footprint 3/3 cells claimed |
| decameroon | Decameroon_SettementsBig_1 | Special | 🏜️ BARREN/DESERT | Decameroon_Settlements_Big_1 | 200 / 1716858 (live) | 0.00005 / 0.00006 | DATA ISSUE | listed under "🏜️ BARREN/DESERT" but its type is Special; note: spriteName "Decameroon_Settlements_Big_1" differs from id; note: footprint 6/6 cells claimed |
| decameroon | Decameroon_Settlements_1 | Special | 🏜️ BARREN/DESERT | Decameroon_Settlements_Small_1 | 200 / 308708 (live) | 0.00019 / 0.00021 | DATA ISSUE | listed under "🏜️ BARREN/DESERT" but its type is Special; note: spriteName "Decameroon_Settlements_Small_1" differs from id |
| decameroon | Decameroon_Forest_1 | Forests | 🌲 FOREST | Decameroon_Forest_1 | 200 / 239972 (live) | 0.00007 / 0.00008 | MATCH |  |
| decameroon | Decameroon_Plain_1 | Plains | 🌾 PLAINS | Decameroon_Plain_1 | 200 / 190259 (live) | 0.00003 / 0.00003 | MATCH |  |
| decameroon | Decameroon_Plain_2 | Plains | 🌾 PLAINS | Decameroon_Plain_2 | 200 / 265041 (live) | 0.00010 / 0.00013 | MATCH |  |
| decameroon | Decameroon_Forest_2 | Forests | 🌲 FOREST | Decameroon_Forest_2 | 200 / 265619 (live) | 0.00011 / 0.00013 | MATCH |  |
| decameroon | Decameroon_Forest_3 | Forests | 🌲 FOREST | Decameroon_Forest_3 | 200 / 297575 (live) | 0.00013 / 0.00015 | MATCH |  |
| decameroon | Decameroon_Hills_1 | Hills/Mountains | ⛰️ ROCKY/MOUNTAIN | Decameroon_Hills_1 | 200 / 261642 (live) | 0.00011 / 0.00012 | MATCH |  |
| decameroon | Decameroon_Mountain_1 | Hills/Mountains | ⛰️ ROCKY/MOUNTAIN | Decameroon_Mountain_1 | 200 / 260989 (live) | 0.00013 / 0.00014 | MATCH |  |
| decameroon | Decameroon_Rubble_1 | Rubble | 🏚️ RUBBLE/WASTELAND | Decameroon_Rubble_1 | 200 / 285899 (live) | 0.00014 / 0.00016 | MATCH |  |
| decameroon | Decameroon_Rubble_2 | Rubble | 🏚️ RUBBLE/WASTELAND | Decameroon_Rubble_2 | 200 / 257522 (live) | 0.00012 / 0.00014 | MATCH |  |
| decameroon | Decameroon_Rubble_3 | Rubble | 🏚️ RUBBLE/WASTELAND | Decameroon_Rubble_3 | 200 / 280239 (live) | 0.00014 / 0.00017 | MATCH |  |
| decameroon | Decameroon_GoldVein_1 | Resources | 💎 RESOURCES | Decameroon_GoldVein_1 | 200 / 252223 (live) | 0.00014 / 0.00016 | MATCH |  |
| decameroon | Decameroon_Grain_1 | Resources | 💎 RESOURCES | Decameroon_Grain_1 | 200 / 303603 (live) | 0.00024 / 0.00027 | MATCH |  |
| decameroon | Decameroon_Herbs_1 | Resources | 💎 RESOURCES | Decameroon_Herbs_1 | 200 / 305712 (live) | 0.00015 / 0.00018 | MATCH |  |
| decameroon | Decameroon_Desert_1 | Barren/Desert | 🏜️ BARREN/DESERT | Decameroon_Desert_1 | 200 / 158951 (live) | 0.00003 / 0.00004 | MATCH | note: minimap colour rgb(120,155,85) is far (93) from the sprite's mean rgb(207,155,118) |
| decameroon | Decameroon_Barren_1 | Barren/Desert | 🏜️ BARREN/DESERT | Decameroon_Barren_1 | 200 / 186768 (live) | 0.00005 / 0.00006 | MATCH | note: minimap colour rgb(120,155,85) is far (104) from the sprite's mean rgb(216,167,124) |
| decameroon | Decameroon_Mountain_2 | Hills/Mountains | ⛰️ ROCKY/MOUNTAIN | Decameroon_Mountain_2 | 200 / 235997 (live) | 0.00010 / 0.00010 | MATCH |  |
| decameroon | Decameroon_Water_1 | Water | 💧 WATER / RIVER | Decameroon_Water | 200 / 64734 (live) | 0.00002 / 0.00002 | MATCH | note: spriteName "Decameroon_Water" differs from id; note: minimap colour rgb(120,155,85) is far (140) from the sprite's mean rgb(17,111,169) |
| decameroon | Decameroon_DirtyWater_1 | Water | 💧 WATER / RIVER | Decameroon_DirtyWater_1 | 200 / 78511 (live) | 0.00002 / 0.00002 | MATCH | note: minimap colour rgb(120,155,85) is far (137) from the sprite's mean rgb(7,93,130) |
| decameroon | Decameroon_SilverVein_1 | Resources | 💎 RESOURCES | Decameroon_SilverVein_1 | 200 / 256223 (live) | 0.00013 / 0.00015 | MATCH |  |
| decameroon | Decameroon_GemField_1 | Resources | 💎 RESOURCES | Decameroon_GemField_1 | 200 / 257616 (live) | 0.00009 / 0.00011 | MATCH |  |
| decameroon | Decameroon_DestroyedBuilding_1 | Rubble | 🏚️ RUBBLE/WASTELAND | Decameroon_DestroyedBuilding_1 | 200 / 290869 (live) | 0.00012 / 0.00014 | MATCH |  |
| decameroon | Decameroon_WaterStones_1 | Water | 💧 WATER / RIVER | Decameroon_WaterStones_1 | 200 / 127309 (live) | 0.00009 / 0.00010 | DATA ISSUE | 47% of the hex is transparent in the sprite and the tile is not layered: the map shows the canvas background rgb(10,10,10) there (no base terrain) |
| decameroon | Decameroon_BrokenShip_1 | Water | 💧 WATER / RIVER | Decameroon_BrokenShip_1 | 200 / 140153 (live) | 0.00019 / 0.00024 | DATA ISSUE | 61% of the hex is transparent in the sprite and the tile is not layered: the map shows the canvas background rgb(10,10,10) there (no base terrain) |
| decameroon | Decameroon_Fish_1 | Water | 💧 WATER / RIVER | Decameroon_Fish_1 | 200 / 37771 (live) | 0.00001 / 0.00001 | DATA ISSUE | 88% of the hex is transparent in the sprite and the tile is not layered: the map shows the canvas background rgb(10,10,10) there (no base terrain); note: minimap colour rgb(120,155,85) is far (139) from the sprite's mean rgb(24,55,95) |
| decameroon | Decameroon_Lake_1 | Rivers | 💧 WATER / RIVER | Decameroon_Lake_1 | 200 / 213890 (live) | 0.00005 / 0.00007 | MATCH | note: minimap colour rgb(120,155,85) is far (126) from the sprite's mean rgb(27,130,166) |
| decameroon | Decameroon_Lake_2 | Rivers | 💧 WATER / RIVER | Decameroon_Lake_2 | 200 / 209492 (live) | 0.00005 / 0.00007 | MATCH | note: minimap colour rgb(120,155,85) is far (126) from the sprite's mean rgb(28,133,168) |
| decameroon | Decameroon_Lake_3 | Rivers | 💧 WATER / RIVER | Decameroon_Lake_3 | 200 / 214276 (live) | 0.00006 / 0.00007 | MATCH | note: minimap colour rgb(120,155,85) is far (124) from the sprite's mean rgb(29,133,167) |
| decameroon | Decameroon_Lake_4 | Rivers | 💧 WATER / RIVER | Decameroon_Lake_4 | 200 / 206553 (live) | 0.00004 / 0.00006 | MATCH | note: minimap colour rgb(120,155,85) is far (126) from the sprite's mean rgb(28,132,168) |
| decameroon | Decameroon_Lake_5 | Rivers | 💧 WATER / RIVER | Decameroon_Lake_5 | 200 / 212745 (live) | 0.00005 / 0.00007 | MATCH | note: minimap colour rgb(120,155,85) is far (126) from the sprite's mean rgb(27,130,166) |
| decameroon | Decameroon_Lake_6 | Rivers | 💧 WATER / RIVER | Decameroon_Lake_6 | 200 / 211197 (live) | 0.00006 / 0.00007 | MATCH | note: minimap colour rgb(120,155,85) is far (126) from the sprite's mean rgb(27,130,166) |
| decameroon | Decameroon_Lake_7 | Rivers | 💧 WATER / RIVER | Decameroon_Lake_7 | 200 / 218914 (live) | 0.00005 / 0.00007 | MATCH | note: minimap colour rgb(120,155,85) is far (124) from the sprite's mean rgb(30,133,167) |
| decameroon | Decameroon_Lava_Plain_1 | Volcanic/Rift | 🌋 VOLCANIC/RIFT | Decameroon_LavaPlain_1 | 200 / 285042 (live) | 0.00012 / 0.00012 | MATCH | note: spriteName "Decameroon_LavaPlain_1" differs from id |
| decameroon | Decameroon_Lava_Rift_1 | Volcanic/Rift | 🌋 VOLCANIC/RIFT | Decameroon_LavaRift_1 | 200 / 236486 (live) | 0.00011 / 0.00013 | MATCH | note: spriteName "Decameroon_LavaRift_1" differs from id |
| decameroon | Decameroon_Swamp_1 | Swamp | 🟫 SWAMP | Decameroon_Swamp_1 | 200 / 252332 (live) | 0.00011 / 0.00013 | MATCH |  |
| decameroon | Decameroon_RockySwamp_1 | Swamp | 🟫 SWAMP | Decameroon_RockySwamp_1 | 200 / 264490 (live) | 0.00012 / 0.00014 | MATCH |  |
| decameroon | Decameroon_River_D_2 | Rivers | 💧 WATER / RIVER | Decameroon_River_D_2 | 200 / 188073 (live) | 0.00005 / 0.00007 | MATCH |  |
| decameroon | Decameroon_River_D_3 | Rivers | 💧 WATER / RIVER | Decameroon_River_D_3 | 200 / 202027 (live) | 0.00009 / 0.00010 | MATCH |  |
| decameroon | Decameroon_River_D_4 | Rivers | 💧 WATER / RIVER | Decameroon_River_D_4 | 200 / 192775 (live) | 0.00010 / 0.00010 | MATCH |  |
| decameroon | Decameroon_River_D_L_EE_2 | Rivers | 💧 WATER / RIVER | Decameroon_River_D_L_EE_2 | 200 / 182910 (live) | 0.00005 / 0.00007 | MATCH |  |
| decameroon | Decameroon_River_D_L_RE_2 | Rivers | 💧 WATER / RIVER | Decameroon_River_D_R_EE_2 | 200 / 168105 (live) | 0.00006 / 0.00007 | MATCH | note: spriteName "Decameroon_River_D_R_EE_2" differs from id |
| decameroon | Decameroon_River_L_1 | Rivers | 💧 WATER / RIVER | Decameroon_River_L_1 | 200 / 195072 (live) | 0.00012 / 0.00013 | MATCH |  |
| decameroon | Decameroon_River_L_4 | Rivers | 💧 WATER / RIVER | Decameroon_River_L_4 | 200 / 205977 (live) | 0.00008 / 0.00010 | MATCH |  |
| decameroon | Decameroon_River_L_5 | Rivers | 💧 WATER / RIVER | Decameroon_River_L_5 | 200 / 204085 (live) | 0.00007 / 0.00008 | MATCH |  |
| decameroon | Decameroon_River_L_D_E_1 | Rivers | 💧 WATER / RIVER | Decameroon_River_L_D_E_1 | 200 / 205142 (live) | 0.00012 / 0.00012 | MATCH |  |
| decameroon | Decameroon_River_L_L_E_5 | Rivers | 💧 WATER / RIVER | Decameroon_River_L_L_E_5 | 200 / 197729 (live) | 0.00007 / 0.00008 | MATCH |  |
| decameroon | Decameroon_River_L_R_E_5 | Rivers | 💧 WATER / RIVER | Decameroon_River_L_R_E_5 | 200 / 199616 (live) | 0.00007 / 0.00007 | MATCH |  |
| decameroon | Decameroon_River_L_U_E_1 | Rivers | 💧 WATER / RIVER | Decameroon_River_L_U_E_1 | 200 / 193451 (live) | 0.00012 / 0.00013 | MATCH |  |
| decameroon | Decameroon_River_R_1 | Rivers | 💧 WATER / RIVER | Decameroon_River_R_1 | 200 / 196137 (live) | 0.00013 / 0.00014 | MATCH |  |
| decameroon | Decameroon_River_R_4 | Rivers | 💧 WATER / RIVER | Decameroon_River_R_4 | 200 / 201059 (live) | 0.00009 / 0.00010 | MATCH |  |
| decameroon | Decameroon_River_R_5 | Rivers | 💧 WATER / RIVER | Decameroon_River_R_5 | 200 / 206898 (live) | 0.00009 / 0.00009 | MATCH |  |
| decameroon | Decameroon_River_U_2 | Rivers | 💧 WATER / RIVER | Decameroon_River_U_2 | 200 / 188580 (live) | 0.00005 / 0.00007 | MATCH |  |
| decameroon | Decameroon_River_U_3 | Rivers | 💧 WATER / RIVER | Decameroon_River_U_3 | 200 / 200276 (live) | 0.00008 / 0.00010 | MATCH |  |
| decameroon | Decameroon_River_U_4 | Rivers | 💧 WATER / RIVER | Decameroon_River_U_4 | 200 / 190434 (live) | 0.00009 / 0.00010 | MATCH |  |
| decameroon | Decameroon_River_U_D_E_4 | Rivers | 💧 WATER / RIVER | Decameroon_River_U_D_E_4 | 200 / 186999 (live) | 0.00009 / 0.00010 | MATCH |  |
| decameroon | Decameroon_River_U_L_EE_2 | Rivers | 💧 WATER / RIVER | Decameroon_River_U_L_EE_2 | 200 / 171482 (live) | 0.00005 / 0.00007 | MATCH |  |
| decameroon | Decameroon_River_U_R_EE_2 | Rivers | 💧 WATER / RIVER | Decameroon_River_U_R_EE_2 | 200 / 170144 (live) | 0.00005 / 0.00006 | MATCH |  |
| decameroon | Decameroon_River_U_U_E_4 | Rivers | 💧 WATER / RIVER | Decameroon_River_U_U_E_4 | 200 / 183462 (live) | 0.00010 / 0.00010 | MATCH |  |
| decameroon | Decameroon_Rift_1 | Volcanic/Rift | 🌋 VOLCANIC/RIFT | Decameroon_Rift_1 | 200 / 217745 (live) | 0.00011 / 0.00012 | MATCH |  |
