# Tile data fixes (owner list, nothing applied)

Source: `docs/superpowers/ledger/reports/tile-icon-audit-report.md` (audit of 2026-10-07: base package from the repo, Decameroon 1.0.10 from the live site) plus a re-read of the live `packages/decameroon/hex_database.json` on 2026-10-08 (byte-identical to the audited copy, 60 tiles) and of `packages/postapoc/hex_database.json` in the repo. No data file was changed; every item below is for the content owner to do.

## How the HEX DB editor behaves (read this first)

Verified in `MapEditorPro.html`:

- The HEX DB tab edits one list that holds the entries of ALL packages together; the package dropdown on the toolbar only sets which package NEW entries are tagged to.
- The record form has NO control for `isLayered` and NO control for `category`. Editing a record writes back only the fields that have a control, so these two fields are read and kept but cannot be changed in the form. (The form has Type, Biome, Filter, SpriteName with the sprite picker, costs, destroy/build fields and so on.)
- `category` is back-filled from `type` when a DB is loaded, but only for types that have a palette category (Water, Rubble, Plains, Forests, Hills/Mountains, Resources, Barren/Desert, Swamp, Volcanic/Rift). `Special` has none, so an empty category stays empty and a non-empty one is left alone. An empty category is shown by the palette under "⚙️ SPECIAL".
- Therefore the route for `isLayered` and `category` is: HEX DB tab > **💾 Save DB** (downloads `hex_database.json` with every package's entries) > edit the JSON text > **📂 Load DB** (replaces the whole list with the file; always load the complete file you saved, never a file with only one package's tiles). Tip: change only the lines named below.
- `Special` tiles are always drawn layered (terrain of their type underneath, sprite on top) whatever `isLayered` says; `Water` tiles are layered only with `isLayered: true` (or the hard-coded base ids Water_Rock_1, Fish_1, Water_Ship_Test_1, Water_SmallShipyard_Test_1, Water_BrokenBoat_1, Water_OilSpill_1, which do not include any Decameroon id).

## (a) Three live Decameroon tiles that need `isLayered: true`

Problem (audit): their sprites are mostly transparent (47 % / 61 % / 88 % of the hex) and the tiles are not layered, so the map shows the black canvas through the sprite instead of water. The base twins (Water_Rock_1, Water_BrokenBoat_1, Fish_1) carry `"isLayered": true`. None of the 60 live Decameroon entries has an `isLayered` key at all.

| id | type | category | spriteName | current `isLayered` |
|---|---|---|---|---|
| Decameroon_WaterStones_1 | Water | 💧 WATER / RIVER | Decameroon_WaterStones_1 | absent |
| Decameroon_BrokenShip_1 | Water | 💧 WATER / RIVER | Decameroon_BrokenShip_1 | absent |
| Decameroon_Fish_1 | Water | 💧 WATER / RIVER | Decameroon_Fish_1 | absent |

Steps:

1. Make Decameroon the active package (Packages panel, or the package dropdown on the HEX DB toolbar) so the Decameroon tiles are listed.
2. HEX DB tab > **💾 Save DB**.
3. In the saved JSON find the three entries by `"id"` and add the field to each, next to `"category"`:
   `"isLayered": true,`
4. HEX DB tab > **📂 Load DB** and pick the edited file. Check the toast "Loaded N hexes" (N = the number in the file) and that the three tiles show water under the stones, ship and fish on the map.
5. Publish: see (f).

## (b) Forest_5_Test (base)

Problem: sprite `Forest_red.png` is at most 80 % opaque (max alpha 204) and the tile is not layered; the map draws it over the black canvas, the palette over the button background (audit score 0.0193; the only base tile the icon audit still reports as MISMATCH, allow-listed in `tests/tile-icon-audit.spec.ts` under KNOWN_MISMATCHES). Current entry: type Forests, category 🌲 FOREST, `isLayered: false`, spriteName `Forest_red`.

Options (owner decides):

- Option 1: set `"isLayered": true` on Forest_5_Test (same JSON route as (a)). The map then draws the Forests terrain under the semi-transparent sprite.
- Option 2: replace the picture with an opaque one: HEX DB > select Forest_5_Test > SpriteName 🖼 > pick or upload a new sprite, then Publish Sprites.

After either fix remove the Forest_5_Test line from KNOWN_MISMATCHES in `tests/tile-icon-audit.spec.ts` (the spec fails when an allow-listed tile starts to pass).

## (c) Forest_3 and Forest_4_Test share one sprite

Both entries have `"spriteName": "Forest_3"` (file `packages/postapoc/sprites/hex/Forest_3.png`): two tiles, one picture. Facts from the data:

| id | terrainTypeId | notes |
|---|---|---|
| Forest_3 | 17 | no "_Test" in the id; economy values of a real tile (baseCostTaps 20, buildMinLevel 51) |
| Forest_4_Test | none | "_Test" id; baseCostTaps 10, buildMinLevel 5, destroyTransformTo Forest_2 |

Proposal (owner decides): leave Forest_3 as it is and give **Forest_4_Test** its own sprite (a distinct picture), because it is the test entry and the one without a `terrainTypeId`. In HEX DB select Forest_4_Test > SpriteName 🖼 > pick or upload a distinct sprite (for example `Forest_4_Test`), then Publish Sprites. Alternative: delete Forest_4_Test if it is not needed.

## (d) Special tiles filed under the wrong palette category (all `type: "Special"`)

The audit lists these as DATA ISSUE: the tile's type is Special, but its category puts it into a terrain group of the palette. Category cannot be edited in the form (see the top), so use the JSON route of (a), changing the `"category"` line.

Base package, currently category `💎 RESOURCES` (8 tiles):

| id | type | current category | spriteName | footprint | proposal (owner decides) |
|---|---|---|---|---|---|
| Settlements_TEST_Big_1 | Special | 💎 RESOURCES | Setlements_Big_Chicken_1 | 6 cells | category `""` (palette group ⚙️ SPECIAL) |
| Settlement_Kaiju_1 | Special | 💎 RESOURCES | MainSettlement_Kaiju_1 | 6 cells | category `""` |
| Crustal_Kaiju_Alive_1 | Special | 💎 RESOURCES | Crystal_Kaiju_Alife_V_1 | 6 cells | category `""` |
| Crustal_Kaiju_Defeat_1 | Special | 💎 RESOURCES | Crystal_Kaiju_Defeat_V_1 | 6 cells | category `""` |
| Crustal_Kaiju_Die_1 | Special | 💎 RESOURCES | Crystal_Kaiju_Die_V1 | 6 cells | category `""` |
| Crustal_Kaiju_Sceleton_V_1 | Special | 💎 RESOURCES | Crystal_Kaiju_skeleton_V_1 | 6 cells | category `""` |
| Crustal_Kaiju_Sceleton_V_2 | Special | 💎 RESOURCES | Crystal_Kaiju_skeleton_V_2 | 6 cells | category `""` |
| Crustal_Kaiju_Sceleton_V_3 | Special | 💎 RESOURCES | Crystal_Kaiju_skeleton_V_3 | 6 cells | category `""` |

(Proposal, owner decides.) Reason: the other 12 base Special tiles (BrokenPlane_1, BrokenRails_1, Settlement_Medieval_1, Chapel_Medieval_1, Dragon_Medieval_1, Snail_Medieval_1, Plain_Flat_1, Settlement_Town_Flat_1, Chapel_Flat_1, Shail_Flat_1, Dragon_Flat_1, Rabbit_Flat_1) already have an empty category. Alternative if the crystal tiles should stay in RESOURCES: change their `type` to `Resources` instead, but note that this changes how they are drawn (Special tiles are always layered; Resources tiles are not) and is not a pure palette change, so it needs a look at the map first.

Decameroon package (live), currently category `🏜️ BARREN/DESERT` (2 tiles):

| id | type | current category | spriteName | footprint | proposal (owner decides) |
|---|---|---|---|---|---|
| Decameroon_SettementsBig_1 | Special | 🏜️ BARREN/DESERT | Decameroon_Settlements_Big_1 | 6 cells | category `""` (⚙️ SPECIAL); id typo, see below |
| Decameroon_Settlements_1 | Special | 🏜️ BARREN/DESERT | Decameroon_Settlements_Small_1 | none | category `""` |

Id typo: `Decameroon_SettementsBig_1` is spelled "Settements" (compare the spriteName `Decameroon_Settlements_Big_1`, the file exists, so the tile renders). Renaming the id is NOT a palette fix: maps that already hold the old id would show an unknown tile, and the footprint map and any saved stamps use the id too. Proposal (owner decides): keep the id; if it must be corrected, add a new entry `Decameroon_SettlementsBig_1` as a copy and keep the old one until no map uses it.

## (e) Informational: 21 Decameroon sprites are the same picture as a base sprite

Different files, same picture (mean premultiplied RGBA difference 0.0000 at 64x64). Nothing to fix unless Decameroon should look different. Decameroon_X = base X for: DestroyedBuilding_1, Fish_1, Lake_7, Lava_Plain_1, Lava_Rift_1, Rift_1, Water_1, River_D_L_EE_2, River_L_D_E_1, River_L_L_E_5, River_L_R_E_5, River_L_U_E_1, River_U_D_E_4, River_U_L_EE_2, River_U_R_EE_2, River_U_U_E_4. Plus: Decameroon_DirtyWater_1 = Water_Dirty_1, Decameroon_Mountain_2 = Mountain_Kaiju_1, Decameroon_SettementsBig_1 = Settlement_Medieval_1, Decameroon_Settlements_1 = Chapel_Medieval_1, Decameroon_River_D_L_RE_2 = River_D_R_EE_2.

One related oddity worth a look: `Decameroon_River_D_L_RE_2` has spriteName `Decameroon_River_D_R_EE_2` (id says D_L_RE_2, the picture is the D_R_EE_2 piece), so id and picture name different river pieces.

## (f) How to publish the fix

What each publish writes (verified in the code): **Publish HexDB** and **Publish Buildings DB** write only the base package (`postapoc`) entries to `hex_database.json` / `building_database.json` (root and `packages/postapoc/`). A package is published by its own **Publish** (Packages panel > the package > Publish, with a version bump and a changelog note), which writes `packages/<id>/hex_database.json` (only that package's tiles), the buildings file and its sprites. So the Decameroon fixes (a) and (d, Decameroon rows) reach the live site only through the package publish; the base fixes (b), (c), (d, base rows) through Publish HexDB.

Order:

1. Edit with the right package active (Decameroon for (a) and the Decameroon rows of (d); Post-Apocalypse for the base items), using the Save DB / edit / Load DB route described at the top.
2. For base fixes: Publish menu > **☁ Publish HexDB**, then **☁ Publish Buildings DB** (the base files now hold only base entries, so Decameroon tiles are no longer duplicated into them). New or replaced sprites: **☁ Publish Sprites** first.
3. For the Decameroon fixes: Packages panel > Decameroon > **Publish**, pick the version bump (Patch), add a changelog note such as "isLayered for the water decoration tiles; Special tiles out of Barren/Desert", confirm. New sprites for the package go out with the package publish.
4. Reload the editor (so the startup sync reads the new package version) and check the tiles; then run `tests/tile-icon-audit.spec.ts` (and, with `AUDIT_LIVE=1`, `tests/tile-icon-audit.live.spec.ts`) to see the verdicts change.
